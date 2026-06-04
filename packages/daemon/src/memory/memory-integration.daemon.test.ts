import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
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
  expect(contents).toContain("deploy is yeet.sh"); // turn 1, carried forward
  expect(contents).toContain("what's the deploy?"); // turn 2, appended after it
  expect(contents.indexOf("deploy is yeet.sh")).toBeLessThan(contents.indexOf("what's the deploy?"));
});
