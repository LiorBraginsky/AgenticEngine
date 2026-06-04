import { test, expect, afterAll, beforeAll } from "bun:test";
import { MemoryStore } from "./store.js";
import { WriteGate, REDACTION_MARKER } from "./write-gate.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

let dataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mf01-int-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock"; // default production provider; set explicitly
  const { startDaemon } = await import("../index.js");
  server = startDaemon(0);
  // server.port is number | undefined per Bun types; port 0 always resolves to a real port.
  PORT = server.port!;
});
afterAll(() => server.stop(true));

function openDb() {
  return new Database(join(dataDir, "memory.sqlite"));
}

/** Drive ONE full mock turn to `done` (answer the color-picker), with optional thread_id. */
function runTurn(text: string, threadId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({
        type: "session_start", trigger: "user", text, client_session_id: "c",
        ...(threadId ? { thread_id: threadId } : {}),
      })),
    );
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data as string);
      if (m.type === "tool_call" && m.payload.tool === "show_color_picker") {
        const pick = m.payload.args.picker.palette[0];
        ws.send(JSON.stringify({
          type: "tool_result", session_id: m.session_id, call_id: m.call_id,
          payload: { tool: "show_color_picker", result: { picked: pick } },
        }));
      }
      if (m.type === "session_end") { ws.close(); resolve(); }
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}

test("turn 1 persists a thread + its messages on disk (real daemon → real SQLite, mock provider)", async () => {
  await runTurn("deploy is yeet.sh");
  const db = openDb();
  const threads = db.query("SELECT thread_id FROM threads").all() as { thread_id: string }[];
  expect(threads.length).toBe(1);
  const msgs = db
    .query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threads[0]!.thread_id) as { content: string }[];
  expect(msgs.map((m) => m.content)).toContain("deploy is yeet.sh");
  db.close();
});

test("turn 2 with the minted thread_id hydrates turn-1's messages (within-thread multi-turn, default mock path)", async () => {
  const db = openDb();
  const threadId = (db.query("SELECT thread_id FROM threads LIMIT 1").get() as { thread_id: string }).thread_id;
  const tailBefore = db
    .query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { content: string }[];
  expect(tailBefore.map((m) => m.content)).toContain("deploy is yeet.sh");
  db.close();

  await runTurn("what's the deploy?", threadId);

  // The hydration EFFECT: after turn 2 the SAME thread has BOTH turns in order —
  // turn-2 flushed ONTO turn-1's hydrated history (criterion 2, over the real path).
  const db2 = openDb();
  const all = db2
    .query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { content: string }[];
  db2.close();
  const contents = all.map((m) => m.content);
  // EXACT equality: must be exactly 2 rows (turn-1 message + turn-2 message) in order.
  // If endTurn double-persists the hydrated tail this becomes ["deploy is yeet.sh",
  // "deploy is yeet.sh", "what's the deploy?"] (3 rows), and toEqual catches it.
  expect(contents).toEqual(["deploy is yeet.sh", "what's the deploy?"]);
});

test("forget hard-scrubs content on disk; message + tombstone rows remain; tail redacts", () => {
  const store = new MemoryStore({ dataDir }); // SAME on-disk DB the daemon wrote
  const gate = new WriteGate(store);
  const db = store.rawDb();
  const row = db.query("SELECT id, thread_id FROM messages WHERE content = 'deploy is yeet.sh' LIMIT 1").get() as { id: string; thread_id: string };
  gate.forget(row.id, { actor: "user", authored_by: "human" }, "test");
  const after = db.query("SELECT content FROM messages WHERE id = ?").get(row.id) as { content: string };
  expect(after.content).toBe(REDACTION_MARKER);
  expect(after.content).not.toContain("yeet.sh");
  const tomb = db.query("SELECT kind FROM mutations WHERE target_message_id = ? AND kind='tombstone'").get(row.id);
  expect(tomb).not.toBeNull();
  const stillThere = db.query("SELECT 1 FROM messages WHERE id = ?").get(row.id);
  expect(stillThere).not.toBeNull();
  expect(store.readThreadTail(row.thread_id, 50).some((m) => m.content === REDACTION_MARKER)).toBe(true);
  // Finding 2: verify the JSONL mirror no longer contains the plaintext (real erasure).
  const mirrorContent = readFileSync(join(dataDir, "threads", `${row.thread_id}.jsonl`), "utf8");
  expect(mirrorContent).not.toContain("yeet.sh");
  expect(mirrorContent).toContain(REDACTION_MARKER);
  store.close();
});

test("edit appends a correction; original message row is unchanged in place", () => {
  // Real-I/O: operates on the same on-disk DB the daemon wrote.
  // Adaptation: mock provider only appends user messages (no assistant turns in MF-01).
  // The edit test's intent — correction appended, original not mutated in place — is
  // identical regardless of role. We target a user message that still has real content
  // (not yet redacted by the forget test above).
  const store = new MemoryStore({ dataDir });
  const gate = new WriteGate(store);
  const db = store.rawDb();
  // Pick a user message that has NOT been redacted (content != REDACTION_MARKER).
  const row = db.query(
    "SELECT id FROM messages WHERE role='user' AND content != ? LIMIT 1",
  ).get(REDACTION_MARKER) as { id: string };
  const before = (db.query("SELECT content FROM messages WHERE id = ?").get(row.id) as { content: string }).content;
  gate.edit(row.id, "edited reply", { actor: "user", authored_by: "human" }, "test");
  const afterOriginal = (db.query("SELECT content FROM messages WHERE id = ?").get(row.id) as { content: string }).content;
  expect(afterOriginal).toBe(before); // NOT mutated in place
  const corr = db.query("SELECT kind, replacement_content FROM mutations WHERE target_message_id=? AND kind='correction'").get(row.id) as { kind: string; replacement_content: string };
  expect(corr.kind).toBe("correction");
  expect(corr.replacement_content).toBe("edited reply");
  // within-thread read surfaces the correction
  const msgRow = db.query("SELECT thread_id FROM messages WHERE id = ?").get(row.id) as { thread_id: string };
  const tail = store.readThreadTail(msgRow.thread_id, 50);
  expect(tail.some((m) => m.content === "edited reply")).toBe(true);
  store.close();
});

test("dismiss invokes the registered consolidation-hook and flips status to dismissed", () => {
  const store = new MemoryStore({ dataDir });
  const hook = new ConsolidationHook(store);
  const calls: string[] = [];
  hook.register((tid, trig) => calls.push(`${tid}:${trig}`));
  const tid = (store.rawDb().query("SELECT thread_id FROM threads LIMIT 1").get() as { thread_id: string }).thread_id;
  hook.dismiss(tid);
  expect(calls).toEqual([`${tid}:dismiss`]);
  expect((store.rawDb().query("SELECT status FROM threads WHERE thread_id=?").get(tid) as { status: string }).status).toBe("dismissed");
  store.close();
});
