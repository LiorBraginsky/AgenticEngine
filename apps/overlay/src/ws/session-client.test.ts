import { test, expect } from "bun:test";
import { parseEnvelope } from "@agentic/protocol";
import { buildSessionStart, runEcho } from "./session-client.js";
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
// Happy-path: the NEW cancel-to-complete flow (Step 6.1)
// session_start → session_ack → tool_call → (auto) tool_cancel → session_end{cancelled}
// ---------------------------------------------------------------------------
test("runEcho: session_ack + tool_call triggers outbound tool_cancel with matching call_id + session_id", async () => {
  const fake = makeFake();
  const p = runEcho("hi", () => fake.ws);

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

  // daemon replies: tool_call (triggers auto-cancel)
  fake.fire("message", {
    data: JSON.stringify({
      type: "tool_call",
      session_id: "srv-1",
      call_id: "call-abc",
      payload: VALID_TOOL_CALL_PAYLOAD,
    }),
  });

  // The seam must have sent tool_cancel by now (synchronous in the message handler)
  expect(fake.sent).toHaveLength(2);
  const cancelMsg = JSON.parse(fake.sent[1]!) as { type: string; session_id: string; call_id: string };
  expect(cancelMsg.type).toBe("tool_cancel");
  expect(cancelMsg.session_id).toBe("srv-1");
  expect(cancelMsg.call_id).toBe("call-abc");

  // daemon replies: session_end{cancelled}
  fake.fire("message", {
    data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "cancelled" }),
  });

  await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "cancelled" });
});

// runEcho resolves on session_end regardless of reason value
test("runEcho resolves with the daemon-minted sessionId + reason for any reason value", async () => {
  const fake = makeFake();
  const p = runEcho("hi", () => fake.ws);
  fake.fire("open", {});
  const sent = JSON.parse(fake.sent[0]!) as { client_session_id: string };
  const cid = sent.client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }) });
  // Send tool_call to advance to awaiting_pick, then session_end (any reason)
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
  const p = runEcho("hi", () => fake.ws);
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
  const p = runEcho("hi", () => fake.ws);
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
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s", reason: "cancelled" }) });
  await expect(p).resolves.toEqual({ sessionId: "s", reason: "cancelled" });
});
