import {
  type Envelope,
  ShowColorPickerArgs,
  ShowColorPickerResult,
  type ColorSwatch,
} from "@agentic/protocol";

/**
 * MOCK reasoning loop — Walking Skeleton v0 (NO real LLM, NO UI).
 *
 * PURE REDUCER (locked decision D-02a-1): advanceMockAgent(state, inbound) =>
 *   { nextState, outbound }. Knows NOTHING about WebSockets/async/timers.
 *   The daemon (index.ts) owns the Map<session_id,state> and all ws.send.
 *
 * BY DESIGN the mock IGNORES session_start.text — it always takes the
 * hard-coded "find a color" path (D-02a-3). Real input-driven reasoning
 * is Phase 3.
 *
 * The "final text" (you picked X, fun fact: …) is COMPUTED and asserted in
 * unit tests but only *rendered* once a frontend (02b) exists; there is
 * intentionally NO text wire-message in the frozen v0 contract (Option A —
 * a text primitive is Phase 2, per Jimmy's ruling 2026-05-30).
 *
 * Malformed tool_result ⇒ a TYPED error (D-02a-6 / gotcha #9), NEVER a throw.
 */

export const MOCK_PALETTE: ColorSwatch[] = [
  { label: "Crimson", hex: "#DC143C" },
  { label: "Forest",  hex: "#228B22" },
  { label: "Azure",   hex: "#1E90FF" },
];

const MOCK_QUESTION = "Which color do you want?";

// The reducer only ever consumes these three inbound variants.
export type MockAgentInput =
  | Extract<Envelope, { type: "session_start" }>
  | Extract<Envelope, { type: "tool_result" }>
  | Extract<Envelope, { type: "tool_cancel" }>;

// Minimal per-session memory: enough to correlate the tool_call we issued.
export type MockSessionState =
  | { phase: "awaiting_pick"; session_id: string; call_id: string }
  | { phase: "done"; session_id: string };

export type MockAgentError =
  | { kind: "malformed_tool_result"; detail: string }
  | { kind: "unexpected_message"; detail: string };

export type MockAgentResult =
  | { ok: true; nextState: MockSessionState; outbound: Envelope[]; finalText?: string }
  | { ok: false; error: MockAgentError; nextState: MockSessionState; outbound: Envelope[] };

export function advanceMockAgent(
  state: MockSessionState | undefined,
  inbound: MockAgentInput,
): MockAgentResult {
  // ── out-of-phase / unexpected guard ──────────────────────────────────────
  if (state?.phase === "done") {
    return {
      ok: false,
      error: { kind: "unexpected_message", detail: `inbound '${inbound.type}' after session is done` },
      nextState: state,
      outbound: [],
    };
  }

  // ── session_start ─────────────────────────────────────────────────────────
  if (inbound.type === "session_start") {
    if (state !== undefined) {
      // already have state — unexpected
      return {
        ok: false,
        error: { kind: "unexpected_message", detail: "session_start received while session already active" },
        nextState: state,
        outbound: [],
      };
    }
    const session_id = crypto.randomUUID();
    const call_id = crypto.randomUUID();
    const args = {
      picker: {
        primitive: "color-picker" as const,
        question: MOCK_QUESTION,
        palette: MOCK_PALETTE,
      },
    };
    // Self-validate the hard-coded palette against the frozen contract (proves correctness).
    const argsCheck = ShowColorPickerArgs.safeParse(args);
    if (!argsCheck.success) {
      // Defensive: hard-coded palette is invalid — should never happen.
      return {
        ok: false,
        error: { kind: "unexpected_message", detail: `MOCK_PALETTE failed contract validation: ${argsCheck.error.message}` },
        nextState: { phase: "done", session_id },
        outbound: [],
      };
    }
    const outbound: Envelope[] = [
      {
        type: "session_ack",
        session_id,
        client_session_id: inbound.client_session_id,
      },
      {
        type: "tool_call",
        session_id,
        call_id,
        payload: { tool: "show_color_picker", args: argsCheck.data },
      },
    ];
    return {
      ok: true,
      nextState: { phase: "awaiting_pick", session_id, call_id },
      outbound,
    };
  }

  // ── tool_cancel ───────────────────────────────────────────────────────────
  if (inbound.type === "tool_cancel") {
    if (state?.phase !== "awaiting_pick") {
      const fallbackState: MockSessionState = { phase: "done", session_id: inbound.session_id };
      return {
        ok: false,
        error: { kind: "unexpected_message", detail: `tool_cancel received while not awaiting_pick` },
        nextState: fallbackState,
        outbound: [],
      };
    }
    const outbound: Envelope[] = [
      { type: "session_end", session_id: state.session_id, reason: "cancelled" },
    ];
    return {
      ok: true,
      nextState: { phase: "done", session_id: state.session_id },
      outbound,
    };
  }

  // ── tool_result ───────────────────────────────────────────────────────────
  if (inbound.type === "tool_result") {
    if (state?.phase !== "awaiting_pick") {
      const fallbackState: MockSessionState = { phase: "done", session_id: inbound.session_id };
      return {
        ok: false,
        error: { kind: "unexpected_message", detail: `tool_result received while not awaiting_pick` },
        nextState: fallbackState,
        outbound: [],
      };
    }
    // Defensive parse of the result payload (gotcha #9 — typed error, no throw).
    const parsed = ShowColorPickerResult.safeParse(inbound.payload.result);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          kind: "malformed_tool_result",
          detail: `ShowColorPickerResult validation failed: ${parsed.error.message}`,
        },
        nextState: state, // session stays open — client may retry
        outbound: [],
      };
    }
    const picked = parsed.data.picked;
    // Option A (Jimmy's ruling): finalText is computed + asserted (unit) + logged (daemon).
    // It is NOT sent as a wire message — no text envelope variant in v0 frozen contract.
    const finalText = `you picked ${picked.label} (${picked.hex}), fun fact: ${picked.label} is a great choice!`;
    const outbound: Envelope[] = [
      { type: "session_end", session_id: state.session_id, reason: "completed" },
    ];
    return {
      ok: true,
      nextState: { phase: "done", session_id: state.session_id },
      outbound,
      finalText,
    };
  }

  // ── exhaustive fallback ───────────────────────────────────────────────────
  // TypeScript narrowing: inbound type is `never` here; this is a runtime guard.
  return {
    ok: false,
    error: { kind: "unexpected_message", detail: `unhandled inbound type: ${(inbound as { type: string }).type}` },
    nextState: state ?? { phase: "done", session_id: "" },
    outbound: [],
  };
}
