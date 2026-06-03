import { test, expect } from "bun:test";
import { mockProvider } from "./mock-provider.js";
import type { ProviderSessionState } from "./provider.js";

// ── (v) id assertion — thin port, no kind field ───────────────────────────────
test("mockProvider.id === 'mock'", () => {
  expect(mockProvider.id).toBe("mock");
  // The port is THIN — there is no `kind` field
  expect("kind" in mockProvider).toBe(false);
});

// ── (i) session_start ⇒ session_ack + tool_call{show_color_picker} + messages ─
test("session_start ⇒ ok:true, session_ack + show_color_picker, messages:[{role:user, content:hi}], phase:awaiting_pick", async () => {
  const result = await mockProvider.advance(undefined, {
    type: "session_start",
    trigger: "user",
    text: "hi",
    client_session_id: "c-1",
  });

  expect(result.ok).toBe(true);
  expect(result.outbound).toHaveLength(2);

  const ack = result.outbound[0]!;
  expect(ack.type).toBe("session_ack");
  if (ack.type === "session_ack") expect(ack.client_session_id).toBe("c-1");

  const call = result.outbound[1]!;
  expect(call.type).toBe("tool_call");
  if (call.type === "tool_call") {
    expect(call.payload.tool).toBe("show_color_picker");
  }

  expect(result.nextState.phase).toBe("awaiting_pick");
  expect(result.nextState.messages).toEqual([{ role: "user", content: "hi" }]);
});

// ── (ii) tool_result {picked} from awaiting_pick ──────────────────────────────
test("tool_result {picked} from awaiting_pick ⇒ ok:true, session_end{completed}, finalText contains label, messages preserved", async () => {
  // First, establish awaiting_pick state by advancing session_start
  const startResult = await mockProvider.advance(undefined, {
    type: "session_start",
    trigger: "user",
    text: "pick something",
    client_session_id: "c-2",
  });
  expect(startResult.ok).toBe(true);
  const awaitingState = startResult.nextState as Extract<ProviderSessionState, { phase: "awaiting_pick" }>;
  expect(awaitingState.phase).toBe("awaiting_pick");
  expect(awaitingState.messages).toEqual([{ role: "user", content: "pick something" }]);

  const result = await mockProvider.advance(awaitingState, {
    type: "tool_result",
    session_id: awaitingState.session_id,
    call_id: awaitingState.call_id,
    payload: { tool: "show_color_picker", result: { picked: { label: "Azure", hex: "#1E90FF" } } },
  });

  expect(result.ok).toBe(true);
  expect(result.outbound).toHaveLength(1);
  const end = result.outbound[0]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") expect(end.reason).toBe("completed");

  if (result.ok) {
    expect(result.finalText).toContain("Azure");
    // messages[] is preserved on nextState (unchanged — session_start already appended it)
    expect(result.nextState.messages).toEqual([{ role: "user", content: "pick something" }]);
  }
});

// ── (iii) tool_cancel from awaiting_pick ──────────────────────────────────────
test("tool_cancel from awaiting_pick ⇒ ok:true, session_end{cancelled}", async () => {
  const startResult = await mockProvider.advance(undefined, {
    type: "session_start",
    trigger: "user",
    text: "cancel me",
    client_session_id: "c-3",
  });
  expect(startResult.ok).toBe(true);
  const awaitingState = startResult.nextState as Extract<ProviderSessionState, { phase: "awaiting_pick" }>;

  const result = await mockProvider.advance(awaitingState, {
    type: "tool_cancel",
    session_id: awaitingState.session_id,
    call_id: awaitingState.call_id,
  });

  expect(result.ok).toBe(true);
  expect(result.outbound).toHaveLength(1);
  const end = result.outbound[0]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") expect(end.reason).toBe("cancelled");
});

// ── (iv) malformed tool_result ⇒ ok:false, no throw, phase preserved ──────────
test("malformed tool_result ⇒ ok:false, error.kind==='malformed_tool_result', no throw, outbound empty, phase preserved", async () => {
  const startResult = await mockProvider.advance(undefined, {
    type: "session_start",
    trigger: "user",
    text: "malform me",
    client_session_id: "c-4",
  });
  expect(startResult.ok).toBe(true);
  const awaitingState = startResult.nextState as Extract<ProviderSessionState, { phase: "awaiting_pick" }>;

  const bad = {
    type: "tool_result" as const,
    session_id: awaitingState.session_id,
    call_id: awaitingState.call_id,
    payload: { tool: "show_color_picker", result: { picked: { label: "X", hex: "NOTHEX" } } },
  } as unknown as Extract<import("@agentic/protocol").Envelope, { type: "tool_result" }>;

  let threw = false;
  let result;
  try {
    result = await mockProvider.advance(awaitingState, bad);
  } catch {
    threw = true;
  }

  expect(threw).toBe(false);
  expect(result!.ok).toBe(false);
  if (!result!.ok) {
    expect(result!.error.kind).toBe("malformed_tool_result");
  }
  expect(result!.outbound).toHaveLength(0);
  expect(result!.nextState.phase).toBe("awaiting_pick");
});
