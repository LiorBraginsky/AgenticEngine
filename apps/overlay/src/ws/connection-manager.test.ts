import { test, expect, jest } from "bun:test";
import { parseEnvelope } from "@agentic/protocol";
import { ConnectionManager } from "./connection-manager.js";
import type { ToolCallContext } from "./session-client.js";
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

// ---------------------------------------------------------------------------
// Fix 1 — CONNECTING-window send throw: timer leak guard
// ---------------------------------------------------------------------------

test("ConnectionManager: if ws.send throws (CONNECTING-window race), runSession rejects and handshake timer is disarmed", async () => {
  // Fake transport whose send() always throws (simulates CONNECTING-state InvalidStateError).
  const sendError = new Error("InvalidStateError: WebSocket is in CONNECTING state");
  sendError.name = "InvalidStateError";

  const listeners: Record<string, ((ev: { data?: unknown }) => void)[]> = {};
  const ws: WebSocketLike = {
    send: () => { throw sendError; },
    close: () => { (listeners["close"] ?? []).forEach((cb) => cb({})); },
    addEventListener: (t, cb) => { (listeners[t] ??= []).push(cb as (ev: { data?: unknown }) => void); },
  };
  const fire = (t: string, ev: { data?: unknown } = {}) => (listeners[t] ?? []).forEach((cb) => cb(ev));

  // Inject setTimeoutFn/clearTimeoutFn to track timer arm/disarm.
  const timerHandles: ReturnType<typeof setTimeout>[] = [];
  const clearedHandles: ReturnType<typeof setTimeout>[] = [];
  let timerSeq = 0;

  const mgr = new ConnectionManager(() => ws, {
    setTimeoutFn: () => {
      const handle = (++timerSeq) as unknown as ReturnType<typeof setTimeout>;
      timerHandles.push(handle);
      // Don't fire the callback — we just track that the timer was armed.
      return handle;
    },
    clearTimeoutFn: (h) => { clearedHandles.push(h); },
    random: () => 0,
  });
  mgr.connect();
  // Simulate open event so ws is not undefined (the guard passes).
  fire("open");

  let caught: unknown;
  try {
    await mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  } catch (e) {
    caught = e;
  }

  // runSession must reject (not hang).
  expect(caught).toBeInstanceOf(Error);
  // The handshake timer that was armed must have been cleared (no leak).
  // The handshake timer is armed BEFORE send. After send throws → failTurn → disarmTimeout.
  // The handshake timer handle must appear in clearedHandles.
  expect(timerHandles.length).toBeGreaterThanOrEqual(1);
  const handshakeHandle = timerHandles.at(-1)!; // last armed = handshake timer
  expect(clearedHandles).toContain(handshakeHandle);
});

test("ConnectionManager: onSessionStart is NOT called when send throws in CONNECTING-window", async () => {
  const sendError = new Error("InvalidStateError");
  sendError.name = "InvalidStateError";

  const listeners: Record<string, ((ev: { data?: unknown }) => void)[]> = {};
  const ws: WebSocketLike = {
    send: () => { throw sendError; },
    close: () => {},
    addEventListener: (t, cb) => { (listeners[t] ??= []).push(cb as (ev: { data?: unknown }) => void); },
  };
  const fire = (t: string, ev: { data?: unknown } = {}) => (listeners[t] ?? []).forEach((cb) => cb(ev));

  let sessionStartCalled = false;
  const mgr = new ConnectionManager(() => ws, {
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
    random: () => 0,
  });
  mgr.connect();
  fire("open"); // ws is now set; send will throw

  await mgr.runSession("hi", {
    handshakeTimeoutMs: 10_000,
    onSessionStart: () => { sessionStartCalled = true; },
  }).catch(() => {});

  expect(sessionStartCalled).toBe(false);
});

// ---------------------------------------------------------------------------
// 2e — Reconnect schedule fires after drop (backoff wired)
// ---------------------------------------------------------------------------

test("ConnectionManager: after a drop it schedules a reconnect and reopens the socket (factory called again)", () => {
  const fake1 = makeFake();
  const fake2 = makeFake();
  const fakes = [fake1, fake2];
  let i = 0;
  const factory = jest.fn(() => fakes[i++]!.ws);
  let scheduled: (() => void) | undefined;
  const mgr = new ConnectionManager(factory, {
    setTimeoutFn: (cb) => { scheduled = cb; return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeoutFn: () => {},
    random: () => 0, // deterministic delay (value irrelevant — we invoke cb directly)
  });
  mgr.connect();
  expect(factory).toHaveBeenCalledTimes(1);

  fake1.fire("open");
  fake1.fire("close");        // drop → schedules reconnect
  expect(scheduled).toBeDefined();
  scheduled!();               // fire the backoff timer
  expect(factory).toHaveBeenCalledTimes(2); // reconnected on a fresh socket
});

// ---------------------------------------------------------------------------
// CM-03 — voluntary dismiss() vs involuntary drop asymmetry
// ---------------------------------------------------------------------------

test("ConnectionManager.dismiss(): closes the socket and does NOT reconnect (voluntary)", () => {
  const fake1 = makeFake();
  const fake2 = makeFake();
  const fakes = [fake1, fake2];
  let i = 0;
  const factory = jest.fn(() => fakes[i++]!.ws);
  let scheduled: (() => void) | undefined;
  const mgr = new ConnectionManager(factory, {
    setTimeoutFn: (cb) => { scheduled = cb; return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeoutFn: () => {},
    random: () => 0,
  });
  mgr.connect();
  expect(factory).toHaveBeenCalledTimes(1);

  fake1.fire("open");
  mgr.dismiss();                 // VOLUNTARY close
  expect(fake1.closed).toBe(true);
  // No reconnect was scheduled (active=false before the close event fired).
  expect(scheduled).toBeUndefined();
  // Even if a stray timer were invoked, it must not reopen.
  scheduled?.();
  expect(factory).toHaveBeenCalledTimes(1);
});

test("ConnectionManager: an INVOLUNTARY drop still reconnects (asymmetry holds)", () => {
  const fake1 = makeFake();
  const fake2 = makeFake();
  const fakes = [fake1, fake2];
  let i = 0;
  const factory = jest.fn(() => fakes[i++]!.ws);
  let scheduled: (() => void) | undefined;
  const mgr = new ConnectionManager(factory, {
    setTimeoutFn: (cb) => { scheduled = cb; return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeoutFn: () => {},
    random: () => 0,
  });
  mgr.connect();
  fake1.fire("open");
  fake1.fire("close");           // INVOLUNTARY drop (active still true)
  expect(scheduled).toBeDefined();
  scheduled!();
  expect(factory).toHaveBeenCalledTimes(2); // reconnected
});

test("ConnectionManager.dismiss(): an in-flight turn settles cancelled-equivalent (no unhandled rejection)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws, {
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  mgr.dismiss(); // dismiss mid-flight — turn must settle, not hang or reject
  await expect(p).resolves.toEqual({ sessionId: "", reason: "cancelled" });
});

// ---------------------------------------------------------------------------
// Migrated from session-client.test.ts (CM-03 carry-forward 1): unique assertions
// of the retired free runSession, re-expressed against ConnectionManager. The
// behaviors live in shared routeInbound/buildSessionStart code — these pin the
// manager-path wire shapes so the coverage survives the runSession deletion.
// ---------------------------------------------------------------------------

test("ConnectionManager.runSession: onToolCall ctx carries sessionId/callId/picker, NO auto-cancel; session_start carries options.threadId (migrated)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  const tid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  let capturedCtx: ToolCallContext | undefined;
  const p = mgr.runSession("hi", { threadId: tid, onToolCall: (ctx) => { capturedCtx = ctx; } });
  fake.fire("open");
  const sent0 = JSON.parse(fake.sent[0]!) as { type: string; thread_id?: string; client_session_id: string };
  expect(sent0.type).toBe("session_start");
  expect(sent0.thread_id).toBe(tid);
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: sent0.client_session_id }) });
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "srv-1", call_id: "call-abc", payload: VALID_TOOL_CALL_PAYLOAD }) });
  expect(fake.sent).toHaveLength(1); // NOT auto-cancel: only the session_start was written
  expect(capturedCtx).toBeDefined();
  expect(capturedCtx!.sessionId).toBe("srv-1");
  expect(capturedCtx!.callId).toBe("call-abc");
  expect(capturedCtx!.picker.question).toBe("Pick a color");
  expect(capturedCtx!.picker.palette[0]!.label).toBe("Red");
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "completed" });
});

test("ConnectionManager.runSession: ctx.sendResult writes a parse-valid tool_result with picked nested under payload.result (migrated)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  let capturedCtx: ToolCallContext | undefined;
  const p = mgr.runSession("hi", { onToolCall: (ctx) => { capturedCtx = ctx; } });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }) });
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "srv-1", call_id: "call-abc", payload: VALID_TOOL_CALL_PAYLOAD }) });

  capturedCtx!.sendResult({ label: "Azure", hex: "#1E90FF" });
  expect(fake.sent).toHaveLength(2);
  expect(parseEnvelope(JSON.parse(fake.sent[1]!)).kind).toBe("ok"); // frozen-contract valid
  const resultMsg = JSON.parse(fake.sent[1]!) as { type: string; session_id: string; call_id: string; payload: { result: { picked: { label: string } } } };
  expect(resultMsg.type).toBe("tool_result");
  expect(resultMsg.session_id).toBe("srv-1");
  expect(resultMsg.call_id).toBe("call-abc");
  expect(resultMsg.payload.result.picked.label).toBe("Azure");

  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "completed" });
});

test("ConnectionManager.runSession: ctx.sendCancel writes a parse-valid tool_cancel with matching call_id (migrated)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  let capturedCtx: ToolCallContext | undefined;
  const p = mgr.runSession("hi", { onToolCall: (ctx) => { capturedCtx = ctx; } });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }) });
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "srv-1", call_id: "call-abc", payload: VALID_TOOL_CALL_PAYLOAD }) });

  capturedCtx!.sendCancel();
  expect(fake.sent).toHaveLength(2);
  expect(parseEnvelope(JSON.parse(fake.sent[1]!)).kind).toBe("ok"); // frozen-contract valid
  const cancelMsg = JSON.parse(fake.sent[1]!) as { type: string; session_id: string; call_id: string };
  expect(cancelMsg.type).toBe("tool_cancel");
  expect(cancelMsg.session_id).toBe("srv-1");
  expect(cancelMsg.call_id).toBe("call-abc");

  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "cancelled" }) });
  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "cancelled" });
});

test("ConnectionManager.runSession: garbage / unknown-type frames and unknown tools never throw; onToolCall NOT fired for unknown tool (migrated)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  let callbackFired = false;
  const p = mgr.runSession("hi", { onToolCall: () => { callbackFired = true; } });
  fake.fire("open");
  // Garbage and unknown-type frames are silently dropped (gotcha #9 discipline).
  expect(() => fake.fire("message", { data: "not-json" })).not.toThrow();
  expect(() => fake.fire("message", { data: JSON.stringify({ type: "telepathy" }) })).not.toThrow();
  const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }) });
  // Unknown tool — silently ignored, no callback, nothing extra on the wire.
  expect(() => fake.fire("message", {
    data: JSON.stringify({ type: "tool_call", session_id: "srv-1", call_id: "call-mystery", payload: { tool: "show_mystery", args: {} } }),
  })).not.toThrow();
  expect(callbackFired).toBe(false);
  expect(fake.sent).toHaveLength(1);
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "cancelled" }) });
  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "cancelled" });
});

test("ConnectionManager.runSession: onSessionStart fires once, right after session_start is sent, before any content (migrated)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  const order: string[] = [];
  const p = mgr.runSession("hi", {
    onSessionStart: () => order.push("start"),
    onShowText: () => order.push("text"),
  });
  fake.fire("open");
  expect(order).toEqual(["start"]); // fired right after send, no content yet
  const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s3", client_session_id: cid }) });
  fake.fire("message", {
    data: JSON.stringify({ type: "tool_call", session_id: "s3", call_id: "c3", payload: { tool: "show_text", args: { text: { primitive: "text", content: "hello" } } } }),
  });
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s3", reason: "completed" }) });
  await p;
  expect(order).toEqual(["start", "text"]); // start never fires again
});
