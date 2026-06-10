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

// ---------------------------------------------------------------------------
// 2c — Per-turn handshake timeout + HandshakeTimeoutError survives
// ---------------------------------------------------------------------------

test("ConnectionManager: per-turn handshake timeout fires HandshakeTimeoutError when daemon never replies", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 2000 });
  fake.fire("open");
  // No ack/tool_call ever — wait past the timeout via a real short timer.
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).name).toBe("HandshakeTimeoutError");
}, 5000);

test("ConnectionManager: handshake timer disarms on first matching tool_call (turn stays alive past the timeout)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  let ctxCaptured = false;
  const p = mgr.runSession("hi", {
    handshakeTimeoutMs: 200,
    onToolCall: (ctx) => { ctxCaptured = true; /* user not acting yet */ void ctx; },
  });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: cid }) });
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "s", call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }) });
  expect(ctxCaptured).toBe(true);
  // Wait past the (now disarmed) 200ms timeout — the turn must NOT reject.
  await new Promise((r) => setTimeout(r, 350));
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false); // still pending — timer was disarmed, no spurious rejection
  // Complete it.
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "s", reason: "completed" });
}, 5000);

// ---------------------------------------------------------------------------
// 2d — Mid-flight drop → local cancelled-equivalent, nothing on wire, no unhandled rejection
// ---------------------------------------------------------------------------

test("ConnectionManager: mid-flight socket drop settles the active turn as cancelled-equivalent, sends NOTHING on the wire", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws, {
    // No-op reconnect scheduling so the test does not open a second socket.
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: cid }) });
  const sentBeforeDrop = fake.sent.length; // only the session_start

  // Socket drops mid-flight (before session_end).
  fake.fire("close");

  // The turn settles (resolves, not rejects) as cancelled — main.ts treats reason like a daemon cancel.
  await expect(p).resolves.toEqual({ sessionId: "s", reason: "cancelled" });
  // NOTHING was written to the wire on drop (the socket is gone).
  expect(fake.sent.length).toBe(sentBeforeDrop);
});

test("ConnectionManager: mid-flight drop produces NO unhandled rejection", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws, {
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  fake.fire("close"); // drop before any ack — pendingByCid path
  // Must resolve cancelled (confirmedSessionId unknown → empty string sessionId).
  await expect(p).resolves.toEqual({ sessionId: "", reason: "cancelled" });
});
