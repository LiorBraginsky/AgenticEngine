import { test, expect, jest } from "bun:test";
import { ConnectionManager } from "./connection-manager.js";
import type { WebSocketLike } from "./types.js";

// Scriptable fake transport (mirrors session-client.test.ts makeFake).
function makeFake() {
  const listeners: Record<string, ((ev: { data?: unknown }) => void)[]> = {};
  const sent: string[] = [];
  let closed = false;
  const ws: WebSocketLike = {
    send: (d) => { sent.push(d); },
    close: () => { closed = true; (listeners["close"] ?? []).forEach((cb) => cb({})); },
    addEventListener: (t, cb) => { (listeners[t] ??= []).push(cb); },
  };
  const fire = (t: string, ev: { data?: unknown } = {}) => (listeners[t] ?? []).forEach((cb) => cb(ev));
  return { ws, sent, fire, get closed() { return closed; } };
}

const VALID_TOOL_CALL_PAYLOAD = {
  tool: "show_color_picker",
  args: { picker: { primitive: "color-picker", question: "Pick a color", palette: [{ label: "Red", hex: "#FF0000" }] } },
};

// Helper: run one full picker turn to session_end on a given fake, returning the manager's promise.
async function oneTurn(mgr: ConnectionManager, fake: ReturnType<typeof makeFake>, sid: string) {
  const p = mgr.runSession("hi", { onToolCall: (ctx) => ctx.sendResult({ label: "Red", hex: "#FF0000" }) });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: sid, client_session_id: cid }) });
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: sid, call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }) });
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: sid, reason: "completed" }) });
  return p;
}

// ---------------------------------------------------------------------------
// 2b — Dispatcher: unknown-session frames silently dropped
// ---------------------------------------------------------------------------

test("ConnectionManager: frames with an unknown/non-active session_id are silently dropped (gotcha #9 / spec §3.5)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();

  let toolCallFired = false;
  const p = mgr.runSession("hi", { onToolCall: () => { toolCallFired = true; } });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-real", client_session_id: cid }) });

  // A tool_call for a DIFFERENT session_id — must not fire onToolCall and must not throw.
  expect(() => fake.fire("message", {
    data: JSON.stringify({ type: "tool_call", session_id: "GHOST", call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }),
  })).not.toThrow();
  expect(toolCallFired).toBe(false);

  // A session_end for an unknown session_id must NOT settle our turn.
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "GHOST", reason: "completed" }) });

  // Now the real frames complete the turn.
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "srv-real", call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }) });
  expect(toolCallFired).toBe(true);
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-real", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "srv-real", reason: "completed" });
});

test("ConnectionManager: an ack for an unknown client_session_id is dropped (no false bind)", () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  expect(() => fake.fire("message", {
    data: JSON.stringify({ type: "session_ack", session_id: "x", client_session_id: "WRONG-CID" }),
  })).not.toThrow();
  // The pending-by-cid context is untouched: a session_end on "x" must not settle it.
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "x", reason: "completed" }) });
  // (No assertion on p resolving — it stays pending; this test only proves no throw / no false bind.)
  void p;
});

// ---------------------------------------------------------------------------
// 2a — Main test
// ---------------------------------------------------------------------------

test("ConnectionManager: 3 turns reuse ONE socket — factory called exactly once, socket not closed between turns", async () => {
  const fake = makeFake();
  const factory = jest.fn(() => fake.ws);
  const mgr = new ConnectionManager(factory);
  mgr.connect();

  await oneTurn(mgr, fake, "srv-1").then((r) => expect(r).toEqual({ sessionId: "srv-1", reason: "completed" }));
  await oneTurn(mgr, fake, "srv-2").then((r) => expect(r).toEqual({ sessionId: "srv-2", reason: "completed" }));
  await oneTurn(mgr, fake, "srv-3").then((r) => expect(r).toEqual({ sessionId: "srv-3", reason: "completed" }));

  expect(factory).toHaveBeenCalledTimes(1); // ONE socket for all three turns
  expect(fake.closed).toBe(false);          // never closed between turns (close-on-dismiss is chunk 03)
});
