import { test, expect } from "bun:test";
import { advanceMockAgent, MOCK_PALETTE, type MockSessionState } from "./mock-agent.js";
import { ShowColorPickerArgs } from "@agentic/protocol";

test("session_start ⇒ session_ack + valid show_color_picker tool_call; session stays open", () => {
  const r = advanceMockAgent(undefined, {
    type: "session_start",
    trigger: "user",
    text: "this text is ignored by design",
    client_session_id: "c-1",
  });
  expect(r.ok).toBe(true);
  expect(r.outbound).toHaveLength(2);

  const ack = r.outbound[0]!;
  expect(ack.type).toBe("session_ack");
  if (ack.type === "session_ack") expect(ack.client_session_id).toBe("c-1");

  const call = r.outbound[1]!;
  expect(call.type).toBe("tool_call");
  if (call.type === "tool_call" && call.payload.tool === "show_color_picker") {
    expect(call.payload.tool).toBe("show_color_picker");
    expect(ShowColorPickerArgs.safeParse(call.payload.args).success).toBe(true);
    expect(call.payload.args.picker.palette).toEqual(MOCK_PALETTE);
  }
  expect(r.nextState.phase).toBe("awaiting_pick");
});

test("mock ignores typed text — same color path regardless of input", () => {
  const a = advanceMockAgent(undefined, { type: "session_start", trigger: "user", text: "buy me a sandwich" });
  const b = advanceMockAgent(undefined, { type: "session_start", trigger: "user", text: "pick a color" });
  const callA = a.outbound[1]!; const callB = b.outbound[1]!;
  if (callA.type === "tool_call" && callA.payload.tool === "show_color_picker" &&
      callB.type === "tool_call" && callB.payload.tool === "show_color_picker") {
    expect(callA.payload.args.picker.palette).toEqual(callB.payload.args.picker.palette);
    expect(callA.payload.args.picker.question).toBe(callB.payload.args.picker.question);
  }
});

const awaiting: MockSessionState = { phase: "awaiting_pick", session_id: "s-1", call_id: "k-1" };

test("tool_result {picked} ⇒ finalText with the label + session_end{completed}", () => {
  const r = advanceMockAgent(awaiting, {
    type: "tool_result", session_id: "s-1", call_id: "k-1",
    payload: { tool: "show_color_picker", result: { picked: { label: "Azure", hex: "#1E90FF" } } },
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.finalText).toContain("Azure");
  expect(r.outbound).toHaveLength(1);
  const end = r.outbound[0]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") { expect(end.reason).toBe("completed"); expect(end.session_id).toBe("s-1"); }
  expect(r.nextState.phase).toBe("done");
});

test("tool_cancel ⇒ session_end{cancelled}, no throw", () => {
  const r = advanceMockAgent(awaiting, { type: "tool_cancel", session_id: "s-1", call_id: "k-1" });
  expect(r.ok).toBe(true);
  const end = r.outbound[0]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") expect(end.reason).toBe("cancelled");
  expect(r.nextState.phase).toBe("done");
});

test("malformed tool_result ⇒ TYPED error (gotcha #9), NEVER a throw, session stays open", () => {
  const bad = {
    type: "tool_result" as const, session_id: "s-1", call_id: "k-1",
    payload: { tool: "show_color_picker", result: { picked: { label: "X", hex: "NOTHEX" } } },
  } as unknown as Extract<import("@agentic/protocol").Envelope, { type: "tool_result" }>;
  let threw = false; let r;
  try { r = advanceMockAgent(awaiting, bad); } catch { threw = true; }
  expect(threw).toBe(false);
  expect(r!.ok).toBe(false);
  if (!r!.ok) expect(r!.error.kind).toBe("malformed_tool_result");
  expect(r!.outbound).toHaveLength(0);
  expect(r!.nextState.phase).toBe("awaiting_pick");
});

test("inbound after done ⇒ typed unexpected_message, no throw", () => {
  const done: MockSessionState = { phase: "done", session_id: "s-1" };
  const r = advanceMockAgent(done, { type: "tool_cancel", session_id: "s-1", call_id: "k-1" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe("unexpected_message");
});
