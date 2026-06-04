// MF-01 real-I/O smoke-probe (spec §4.2). Drives the REAL daemon → REAL SQLite
// once, asserts a thread + its messages persisted on disk, exits 0 / non-zero.
// NO mocked store, NO UI. Run: bun run memory-smoke
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const dataDir = mkdtempSync(join(tmpdir(), "mf01-smoke-"));
process.env.AGENTIC_DATA_DIR = dataDir;
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "mock";

const { startDaemon } = await import("../src/index.js");
const server = startDaemon(0);
const port = server.port!;

function fail(msg: string): never {
  console.error(`[memory-smoke] FAIL: ${msg}`);
  server.stop(true);
  process.exit(1);
}

await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: "tauri://localhost" } });
  let pickerSeen = false;
  ws.addEventListener("open", () =>
    ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "smoke probe", client_session_id: "smoke" })),
  );
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data as string);
    // mock path: answer the color picker so the session reaches 'done' and flushes.
    if (m.type === "tool_call" && m.payload.tool === "show_color_picker") {
      pickerSeen = true;
      const pick = m.payload.args.picker.palette[0];
      ws.send(JSON.stringify({ type: "tool_result", session_id: m.session_id, call_id: m.call_id, payload: { tool: "show_color_picker", result: { picked: pick } } }));
    }
    if (m.type === "session_end") { ws.close(); resolve(); }
    void pickerSeen;
  });
  ws.addEventListener("error", () => reject(new Error("ws error")));
  setTimeout(() => reject(new Error("timeout")), 3000);
}).catch((e) => fail(String(e)));

// Assert on-disk persistence.
const db = new Database(join(dataDir, "memory.sqlite"));
const threads = db.query("SELECT thread_id FROM threads").all() as { thread_id: string }[];
if (threads.length < 1) fail("no thread persisted");
const msgs = db.query("SELECT content FROM messages WHERE thread_id = ?").all(threads[0]!.thread_id) as { content: string }[];
if (!msgs.some((r) => r.content.includes("smoke probe"))) fail("turn message not persisted");
db.close();

console.log(`[memory-smoke] OK: thread=${threads[0]!.thread_id} messages=${msgs.length} dir=${dataDir}`);
server.stop(true);
process.exit(0);
