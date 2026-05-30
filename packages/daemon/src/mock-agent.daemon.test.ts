import { test, expect, afterAll } from "bun:test";
import { startDaemon } from "./index.js";

const server = startDaemon(0); // ephemeral port
const PORT = server.port;
afterAll(() => server.stop(true));
const ORIGIN = "tauri://localhost";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = any;

function open(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
  return new Promise((res, rej) => {
    ws.addEventListener("open", () => res(ws));
    ws.addEventListener("error", () => rej(new Error("ws error")));
    setTimeout(() => rej(new Error("open timeout")), 2000);
  });
}

function nextN(ws: WebSocket, n: number, send?: () => void): Promise<Msg[]> {
  const msgs: Msg[] = [];
  return new Promise((res, rej) => {
    ws.addEventListener("message", (e) => {
      msgs.push(JSON.parse(e.data as string));
      if (msgs.length >= n) res(msgs);
    });
    setTimeout(() => rej(new Error(`expected ${n} msgs, got ${msgs.length}`)), 2000);
    send?.();
  });
}

test("RESOLVE path: start → ack + tool_call(show_color_picker); reply tool_result → session_end{completed}", async () => {
  const ws = await open();
  const first = await nextN(ws, 2, () =>
    ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "ignored", client_session_id: "c-1" })),
  );
  expect(first[0].type).toBe("session_ack");
  expect(first[0].client_session_id).toBe("c-1");
  expect(first[1].type).toBe("tool_call");
  expect(first[1].payload.tool).toBe("show_color_picker");
  const sessionId = first[0].session_id;
  const callId = first[1].call_id;
  const pick = first[1].payload.args.picker.palette[0];
  const end = await nextN(ws, 1, () =>
    ws.send(JSON.stringify({
      type: "tool_result", session_id: sessionId, call_id: callId,
      payload: { tool: "show_color_picker", result: { picked: pick } },
    })),
  );
  expect(end[0].type).toBe("session_end");
  expect(end[0].reason).toBe("completed");
  expect(end[0].session_id).toBe(sessionId);
  ws.close();
});

test("CANCEL path: start → tool_call; reply tool_cancel → session_end{cancelled}, no crash", async () => {
  const ws = await open();
  const first = await nextN(ws, 2, () => ws.send(JSON.stringify({ type: "session_start", trigger: "user" })));
  const sessionId = first[0].session_id;
  const callId = first[1].call_id;
  const end = await nextN(ws, 1, () =>
    ws.send(JSON.stringify({ type: "tool_cancel", session_id: sessionId, call_id: callId })),
  );
  expect(end[0].type).toBe("session_end");
  expect(end[0].reason).toBe("cancelled");
  ws.close();
});

test("MALFORMED tool_result: daemon does not crash, session not ended", async () => {
  const ws = await open();
  const first = await nextN(ws, 2, () => ws.send(JSON.stringify({ type: "session_start", trigger: "user" })));
  const sessionId = first[0].session_id;
  const callId = first[1].call_id;
  ws.send(JSON.stringify({
    type: "tool_result", session_id: sessionId, call_id: callId,
    payload: { tool: "show_color_picker", result: { picked: { label: "X", hex: "NOTHEX" } } },
  }));
  const valid = first[1].payload.args.picker.palette[0];
  const end = await nextN(ws, 1, () =>
    ws.send(JSON.stringify({
      type: "tool_result", session_id: sessionId, call_id: callId,
      payload: { tool: "show_color_picker", result: { picked: valid } },
    })),
  );
  expect(end[0].type).toBe("session_end");
  expect(end[0].reason).toBe("completed");
  ws.close();
});
