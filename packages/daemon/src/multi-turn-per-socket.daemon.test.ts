import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { TokenStore } from "./memory/token-store.js";

let dataDir: string;
let server: ReturnType<typeof import("./index.js").startDaemon>;
let PORT: number;
let token: string;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm02-multiturn-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("./index.js");
  server = startDaemon(0);
  PORT = server.port!;
  token = new TokenStore(dataDir).token();
});
afterAll(() => server.stop(true));

/**
 * Run ONE full mock turn (start → ack → tool_call → tool_result → session_end) over an
 * ALREADY-OPEN socket. Resolves with the daemon-minted session_id when session_end arrives.
 * Mirrors the overlay's single-flight discipline: one turn at a time on the shared socket.
 */
function turnOver(ws: WebSocket, text: string, threadId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cid = crypto.randomUUID();
    let mySid: string | undefined;
    const onMsg = (e: MessageEvent) => {
      const m = JSON.parse(e.data as string) as { type: string; session_id?: string; client_session_id?: string; call_id?: string; payload?: { tool?: string; args?: { picker?: { palette?: { label: string; hex: string }[] } } }; reason?: string };
      if (m.type === "session_ack" && m.client_session_id === cid) {
        mySid = m.session_id;
        return;
      }
      if (m.type === "tool_call" && m.session_id === mySid && m.payload?.tool === "show_color_picker") {
        const pick = m.payload.args?.picker?.palette?.[0];
        ws.send(JSON.stringify({
          type: "tool_result",
          session_id: mySid,
          call_id: m.call_id,
          payload: { tool: "show_color_picker", result: { picked: pick } },
        }));
        return;
      }
      if (m.type === "session_end" && m.session_id === mySid) {
        ws.removeEventListener("message", onMsg);
        resolve(mySid!);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({
      type: "session_start",
      trigger: "user",
      text,
      client_session_id: cid,
      ...(threadId ? { thread_id: threadId } : {}),
    }));
    setTimeout(() => reject(new Error("turn timeout")), 3000);
  });
}

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // chunk-02 step-3: present token as Sec-WebSocket-Protocol subprotocol (layer-1 gate).
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN }, protocols: [token] });
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

test("DoD — ≥3 full session_start…session_end round-trips on ONE socket (no reconnect between turns)", async () => {
  const ws = await openSocket();
  const sid1 = await turnOver(ws, "turn one");
  const sid2 = await turnOver(ws, "turn two");
  const sid3 = await turnOver(ws, "turn three");
  // Three DISTINCT daemon-minted session_ids served over the SAME connection.
  expect(new Set([sid1, sid2, sid3]).size).toBe(3);
  ws.close();
}, 10000);

test("DoD — daemon 'restart' (new connection) → next turn carries the SAME thread_id; both turns land in ONE thread (reconnect continuation)", async () => {
  const threadId = crypto.randomUUID(); // client-minted (CM-01 adoption posture)

  // Connection #1 — first turn carrying the client-minted thread_id.
  const ws1 = await openSocket();
  await turnOver(ws1, "first turn", threadId);
  ws1.close(); // simulate the drop: the old socket goes away

  // Connection #2 (fresh socket, re-passes the origin gate) — continuation with the SAME thread_id.
  const ws2 = await openSocket();
  await turnOver(ws2, "second turn after reconnect", threadId);
  ws2.close();

  // Both turns persisted into the SAME adopted thread, in order (continuation survived the reconnect).
  const db = new Database(join(dataDir, "memory.sqlite"));
  const rows = db
    .query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { content: string }[];
  db.close();
  expect(rows.map((r) => r.content)).toEqual(["first turn", "second turn after reconnect"]);
}, 10000);
