import { test, expect, afterAll, beforeAll } from "bun:test";
import { MemoryStore } from "./store.js";
import { WriteGate, REDACTION_MARKER } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { ThreadLifecycle } from "./thread-lifecycle.js";
import { registerDistiller } from "./distiller-registration.js";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { TokenStore } from "./token-store.js";
import type { MemoryProvider, DistillDelta } from "./memory-provider.js";

let dataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;
let token: string;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mf01-int-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock"; // default production provider; set explicitly
  // hybrid-retrieval chunk-03 (reviewer MINOR fix): pin lexical-only so this daemon boot
  // never constructs a real LocalWasmEmbeddingProvider (ENOENT noise; CI never has the model).
  process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "none";
  const { startDaemon } = await import("../index.js");
  server = startDaemon(0);
  // server.port is number | undefined per Bun types; port 0 always resolves to a real port.
  PORT = server.port!;
  // chunk-02 step-3: read the per-install token minted by the daemon at boot.
  token = new TokenStore(dataDir).token();
});
afterAll(() => server.stop(true));

function openDb() {
  return new Database(join(dataDir, "memory.sqlite"));
}

/** Drive ONE full mock turn to `done` (answer the color-picker), with optional thread_id. */
function runTurn(text: string, threadId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // chunk-02 step-3: present token as Sec-WebSocket-Protocol subprotocol (layer-1 gate).
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN }, protocols: [token] });
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
  const gate = new WriteGate(store, new RuleBasedScanner());
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
  const gate = new WriteGate(store, new RuleBasedScanner());
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

test("dismiss invokes the registered consolidation-hook and flips status to dismissed", async () => {
  const store = new MemoryStore({ dataDir });
  const hook = new ConsolidationHook(store);
  const calls: Array<{ ids: string[]; trigger: string }> = [];
  hook.register((threadIds, triggerThreadId) => { calls.push({ ids: threadIds, trigger: triggerThreadId }); });
  const tid = (store.rawDb().query("SELECT thread_id FROM threads LIMIT 1").get() as { thread_id: string }).thread_id;
  await hook.dismiss([tid]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.ids).toEqual([tid]);
  expect((store.rawDb().query("SELECT status FROM threads WHERE thread_id=?").get(tid) as { status: string }).status).toBe("dismissed");
  store.close();
});

// ─── v2-06 FIX-A regression: whenIdle blocks new-thread retrieve until distill commits ────────

/**
 * FIX-A regression test (v2-06): dismiss(thread A with a deliberately-delayed distill)
 * → immediately lifecycle.beginTurn(new thread B) → assert B's retrieve sees
 * A's just-committed fact.
 *
 * Uses real SQLite, real ConsolidationHook, real ThreadLifecycle, real WriteGate.
 * Only the LLM clientFactory is stubbed (Strike-4: no real API call).
 * A 80ms artificial delay in distill() creates a deterministic race window:
 *   - WITHOUT whenIdle: beginTurn runs retrieve while distill is in-flight → stale 0 facts → RED
 *   - WITH whenIdle: beginTurn blocks until distill commits → sees the fact → GREEN
 */
test("FIX-A regression: new-thread retrieve sees fact committed by in-flight delayed distill (whenIdle blocks)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mf01-fia-"));
  const store = new MemoryStore({ dataDir: dir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hook = new ConsolidationHook(store);

  // Delayed distill stub — delays 80ms before committing the fact.
  // Without whenIdle, retrieve on the new thread runs BEFORE this resolves.
  const DELAY_MS = 80;
  const delayedDistillProvider: MemoryProvider = {
    id: "delayed-distill-stub",
    distill: async (s, threadId): Promise<DistillDelta> => {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      return {
        threadId,
        ops: [{ op: "new", fact: "city is Tel Aviv", canonical: "city tel aviv", topics: ["#about-user"] }],
        candidateIds: [],
        distilledThroughMarker: s.readThreadMarker(threadId),
        distilledThroughTurn: s.maxTurnIndex(threadId),
      };
    },
    retrieve: async (s) => {
      const facts = s.readDistilledFacts(50);
      return {
        messages: facts.map((f) => ({ role: "user" as const, content: `[remembered] ${f.fact}` })),
        injectedFactIds: [],
      };
    },
  };

  const { whenIdle } = registerDistiller(hook, store, delayedDistillProvider, new RuleBasedScanner());
  const lifecycle = new ThreadLifecycle(store, gate, delayedDistillProvider, whenIdle);

  // Step 1: Thread A — seed a message and dismiss (starts the delayed distill)
  const threadA = store.createThread();
  store.appendMessages(threadA, [{ role: "user", content: "Моє місто — Тель-Авів" }], "sA");

  // Start dismiss WITHOUT awaiting it — creates the race window
  const dismissPromise = hook.dismiss([threadA]);

  // Step 2: Immediately begin a NEW thread (no settle between dismiss and beginTurn).
  // WITHOUT whenIdle: retrieve runs before distill commits → sees 0 facts → RED
  // WITH whenIdle: beginTurn awaits the in-flight distill → sees the fact → GREEN
  const begin = await lifecycle.beginTurn({
    type: "session_start",
    trigger: "user",
    text: "Яке моє місто?",
  });

  // Let dismiss complete (for cleanup)
  await dismissPromise;

  // Step 3: Assert — priorMessages contains the city fact from the delayed distill.
  const recalledCity = begin.priorMessages.some(
    (m) => m.content.includes("Тель-Авів") || m.content.includes("Tel Aviv") || m.content.includes("місто"),
  );
  expect(recalledCity).toBe(true);

  store.close();
});
