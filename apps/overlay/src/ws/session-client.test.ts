import { test, expect } from "bun:test";
import { parseEnvelope } from "@agentic/protocol";
import { buildSessionStart, runEcho } from "./session-client.js";
import type { ToolCallContext } from "./session-client.js";
import type { WebSocketLike } from "./types.js";

// A scriptable fake transport: captures sends, lets the test drive inbound frames.
function makeFake() {
  const listeners: Record<string, ((ev: { data?: unknown }) => void)[]> = {};
  const sent: string[] = [];
  let closed = false;
  const ws: WebSocketLike = {
    send: (d) => { sent.push(d); },
    close: () => { closed = true; },
    addEventListener: (t, cb) => { (listeners[t] ??= []).push(cb); },
  };
  const fire = (t: string, ev: { data?: unknown }) => (listeners[t] ?? []).forEach((cb) => cb(ev));
  return { ws, sent, fire, get closed() { return closed; } };
}

// A valid tool_call payload — palette must have ≥1 swatch (protocol constraint).
const VALID_TOOL_CALL_PAYLOAD = {
  tool: "show_color_picker",
  args: { picker: { primitive: "color-picker", question: "Pick a color", palette: [{ label: "Red", hex: "#FF0000" }] } },
};

test("buildSessionStart produces a valid frozen-contract session_start (trigger:user)", () => {
  const { msg } = buildSessionStart("hello");
  const parsed = parseEnvelope(msg);
  expect(parsed.kind).toBe("ok");
  expect(msg.type).toBe("session_start");
  expect(msg.trigger).toBe("user");
  expect(msg.text).toBe("hello");
  expect(typeof msg.client_session_id).toBe("string");
});

// ---------------------------------------------------------------------------
// Happy-path: onToolCall callback (Task 2 — replaces old auto-cancel flow)
// session_start → session_ack → tool_call → onToolCall(ctx) → sendResult|sendCancel → session_end
// ---------------------------------------------------------------------------
test("runEcho: tool_call fires onToolCall with ctx (picker, sessionId, callId, sendResult, sendCancel) — NOT auto-cancel", async () => {
  const fake = makeFake();
  let capturedCtx: ToolCallContext | undefined;

  const p = runEcho("hi", () => fake.ws, {
    onToolCall: (ctx) => { capturedCtx = ctx; },
  });

  // open → client sends session_start
  fake.fire("open", {});
  expect(fake.sent).toHaveLength(1);
  const sent0 = JSON.parse(fake.sent[0]!) as { type: string; client_session_id: string };
  expect(sent0.type).toBe("session_start");
  const cid = sent0.client_session_id;

  // daemon replies: session_ack (echoes cid, mints session_id)
  fake.fire("message", {
    data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }),
  });

  // daemon replies: tool_call — must NOT auto-send tool_cancel
  fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "srv-1",
      call_id: "call-abc",
      payload: VALID_TOOL_CALL_PAYLOAD,
    }),
  });

  // The seam must NOT have sent tool_cancel — only the original session_start was sent
  expect(fake.sent).toHaveLength(1);

  // onToolCall must have been called exactly once
  expect(capturedCtx).toBeDefined();
  expect(capturedCtx!.sessionId).toBe("srv-1");
  expect(capturedCtx!.callId).toBe("call-abc");
  expect(capturedCtx!.picker.question).toBe("Pick a color");
  expect(capturedCtx!.picker.palette[0]!.label).toBe("Red");

  // Drive completion via session_end so the promise settles (no timeout)
  fake.fire("message", {
    data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "completed" }),
  });

  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "completed" });
});

test("runEcho: ctx.sendResult sends a parse-valid tool_result with picked nested under payload.result; session_end{completed} resolves", async () => {
  const fake = makeFake();
  let capturedCtx: ToolCallContext | undefined;

  const p = runEcho("hi", () => fake.ws, {
    onToolCall: (ctx) => { capturedCtx = ctx; },
  });

  fake.fire("open", {});
  const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;

  fake.fire("message", {
    data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }),
  });
  fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "srv-1",
      call_id: "call-abc",
      payload: VALID_TOOL_CALL_PAYLOAD,
    }),
  });

  expect(capturedCtx).toBeDefined();

  // Call sendResult — the seam must send a tool_result
  capturedCtx!.sendResult({ label: "Azure", hex: "#1E90FF" });

  expect(fake.sent).toHaveLength(2);
  const resultMsg = JSON.parse(fake.sent[1]!) as {
    type: string;
    session_id: string;
    call_id: string;
    payload: { result: { picked: { label: string } } };
  };
  // Must be parse-valid per the frozen contract
  expect(parseEnvelope(JSON.parse(fake.sent[1]!)).kind).toBe("ok");
  expect(resultMsg.type).toBe("tool_result");
  expect(resultMsg.session_id).toBe("srv-1");
  expect(resultMsg.call_id).toBe("call-abc");
  expect(resultMsg.payload.result.picked.label).toBe("Azure");

  // daemon replies session_end{completed} → promise resolves
  fake.fire("message", {
    data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "completed" }),
  });

  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "completed" });
});

test("runEcho: ctx.sendCancel sends a parse-valid tool_cancel with matching call_id; session_end{cancelled} resolves", async () => {
  const fake = makeFake();
  let capturedCtx: ToolCallContext | undefined;

  const p = runEcho("hi", () => fake.ws, {
    onToolCall: (ctx) => { capturedCtx = ctx; },
  });

  fake.fire("open", {});
  const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;

  fake.fire("message", {
    data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }),
  });
  fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "srv-1",
      call_id: "call-abc",
      payload: VALID_TOOL_CALL_PAYLOAD,
    }),
  });

  expect(capturedCtx).toBeDefined();

  // Call sendCancel — the seam must send a tool_cancel
  capturedCtx!.sendCancel();

  expect(fake.sent).toHaveLength(2);
  const cancelMsg = JSON.parse(fake.sent[1]!) as {
    type: string;
    session_id: string;
    call_id: string;
  };
  // Must be parse-valid per the frozen contract
  expect(parseEnvelope(JSON.parse(fake.sent[1]!)).kind).toBe("ok");
  expect(cancelMsg.type).toBe("tool_cancel");
  expect(cancelMsg.session_id).toBe("srv-1");
  expect(cancelMsg.call_id).toBe("call-abc");

  // daemon replies session_end{cancelled} → promise resolves
  fake.fire("message", {
    data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "cancelled" }),
  });

  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "cancelled" });
});

// runEcho resolves on session_end regardless of reason value
test("runEcho resolves with the daemon-minted sessionId + reason for any reason value", async () => {
  const fake = makeFake();
  const p = runEcho("hi", () => fake.ws, {
    onToolCall: (ctx) => {
      // Simulate a result being sent (then session_end drives the resolve)
      ctx.sendResult({ label: "Red", hex: "#FF0000" });
    },
  });
  fake.fire("open", {});
  const sent = JSON.parse(fake.sent[0]!) as { client_session_id: string };
  const cid = sent.client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }) });
  fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "srv-1",
      call_id: "call-xyz",
      payload: VALID_TOOL_CALL_PAYLOAD,
    }),
  });
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "completed" });
});

// 6.2 — socket is closed on settle
test("runEcho closes the socket after resolving (no leak)", async () => {
  const fake = makeFake();
  const p = runEcho("hi", () => fake.ws, {
    onToolCall: (ctx) => { ctx.sendCancel(); },
  });
  fake.fire("open", {});
  const sent = JSON.parse(fake.sent[0]!) as { client_session_id: string };
  const cid = sent.client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-2", client_session_id: cid }) });
  fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "srv-2",
      call_id: "call-z",
      payload: VALID_TOOL_CALL_PAYLOAD,
    }),
  });
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-2", reason: "cancelled" }) });
  await p;
  expect(fake.closed).toBe(true);
});

// ---------------------------------------------------------------------------
// Kept from original test suite
// ---------------------------------------------------------------------------
test("runEcho ignores an ack whose client_session_id does NOT correlate (no false resolve)", async () => {
  const fake = makeFake();
  const p = runEcho("hi", () => fake.ws);
  fake.fire("open", {});
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "x", client_session_id: "WRONG" }) });
  // No session_end for our cid → must reject on timeout, never resolve on the wrong ack.
  await expect(p).rejects.toThrow();
}, 3000);

test("handleInbound never throws on unknown/invalid frames (gotcha #9 discipline)", async () => {
  const fake = makeFake();
  const p = runEcho("hi", () => fake.ws, {
    onToolCall: (ctx) => { ctx.sendResult({ label: "Red", hex: "#FF0000" }); },
  });
  fake.fire("open", {});
  expect(() => fake.fire("message", { data: "not-json" })).not.toThrow();
  expect(() => fake.fire("message", { data: JSON.stringify({ type: "telepathy" }) })).not.toThrow();
  const sent = JSON.parse(fake.sent[0]!) as { client_session_id: string };
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: sent.client_session_id }) });
  fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "s",
      call_id: "call-noop",
      payload: VALID_TOOL_CALL_PAYLOAD,
    }),
  });
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "s", reason: "completed" });
});

// Unknown tool in tool_call must NOT fire onToolCall and must NOT throw (gotcha #9 forward-compat).
test("runEcho: unknown tool in tool_call does NOT fire onToolCall and does not throw", async () => {
  const fake = makeFake();
  let callbackFired = false;

  const p = runEcho("hi", () => fake.ws, {
    onToolCall: () => { callbackFired = true; },
  });

  fake.fire("open", {});
  const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;

  fake.fire("message", {
    data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }),
  });

  // Unknown tool — should be silently ignored
  expect(() => fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "srv-1",
      call_id: "call-mystery",
      payload: { tool: "show_mystery", args: {} },
    }),
  })).not.toThrow();

  // onToolCall must NOT have been called
  expect(callbackFired).toBe(false);

  // No extra sends beyond the initial session_start
  expect(fake.sent).toHaveLength(1);

  // Drive completion directly via session_end (no tool interaction needed)
  fake.fire("message", {
    data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "cancelled" }),
  });

  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "cancelled" });
});
