import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

let dataDir: string;
let server: ReturnType<typeof import("./index.js").startDaemon>;
let PORT: number;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm03-dismiss-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("./index.js");
  server = startDaemon(0);
  PORT = server.port!;
});
afterAll(() => server.stop(true));

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

/**
 * Drive ONE full mock turn (session_start → ack → tool_call → tool_result → session_end)
 * over an ALREADY-OPEN socket. Resolves with the daemon-minted session_id when session_end
 * arrives. The mock provider emits show_color_picker (mock-agent.ts:106-109).
 */
function turnOver(ws: WebSocket, text: string, threadId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cid = crypto.randomUUID();
    let mySid: string | undefined;
    const onMsg = (e: MessageEvent) => {
      const m = JSON.parse(e.data as string);
      if (m.type === "session_ack" && m.client_session_id === cid) { mySid = m.session_id; return; }
      if (m.type === "tool_call" && m.session_id === mySid && m.payload.tool === "show_color_picker") {
        const pick = m.payload.args.picker.palette[0];
        ws.send(JSON.stringify({ type: "tool_result", session_id: mySid, call_id: m.call_id, payload: { tool: "show_color_picker", result: { picked: pick } } }));
        return;
      }
      if (m.type === "session_end" && m.session_id === mySid) { ws.removeEventListener("message", onMsg); resolve(mySid!); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ type: "session_start", trigger: "user", text, client_session_id: cid, ...(threadId ? { thread_id: threadId } : {}) }));
    setTimeout(() => reject(new Error("turn timeout")), 3000);
  });
}

/** Poll the on-disk DB until a distillation_events row exists for threadId (close handler is async). */
async function waitForDistillationEvent(threadId: string, tries = 20, gapMs = 50): Promise<{ facts_produced: number; trigger: string }[]> {
  for (let i = 0; i < tries; i++) {
    const db = new Database(join(dataDir, "memory.sqlite"));
    const rows = db.query("SELECT facts_produced, trigger FROM distillation_events WHERE thread_id = ? ORDER BY created_at ASC").all(threadId) as { facts_produced: number; trigger: string }[];
    db.close();
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return [];
}

function statusOf(threadId: string): string | undefined {
  const db = new Database(join(dataDir, "memory.sqlite"));
  const row = db.query("SELECT status FROM threads WHERE thread_id = ?").get(threadId) as { status: string } | null;
  db.close();
  return row?.status;
}

test("DoD — open socket → run a turn on thread T → close → status(T)=dismissed AND a distillation_events row exists", async () => {
  const threadId = crypto.randomUUID(); // client-minted (adoption posture)
  const ws = await openSocket();
  await turnOver(ws, "deploy is yeet.sh", threadId);
  ws.close(); // THE dismiss signal — fires the real close(ws) handler

  const events = await waitForDistillationEvent(threadId);
  expect(events.length).toBe(1);
  expect(events[0]!.trigger).toBe("dismiss");
  expect(statusOf(threadId)).toBe("dismissed");
});
