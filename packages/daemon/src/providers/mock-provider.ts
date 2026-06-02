import {
  advanceMockAgent,
  type MockSessionState,
} from "../mock-agent.js";
import type { AgentProvider, ProviderError, ProviderResult, ProviderSessionState, SessionMessage } from "./provider.js";

/**
 * Mock provider — wraps the BYTE-UNCHANGED pure reducer behind the AgentProvider port.
 *
 * The adapter is trivially async (async wrapper over a sync reducer call) and
 * translates between ProviderSessionState (with messages[]) and the reducer's
 * MockSessionState (without messages[]).
 *
 * - On the way IN: strip messages[] to hand the reducer its existing MockSessionState.
 * - On the way OUT: re-attach messages[] to the reducer's nextState.
 * - For session_start: append { role:"user", content: inbound.text ?? "" } to messages.
 * - MockAgentError maps 1:1 onto ProviderError (malformed_tool_result, unexpected_message).
 * - finalText passes through unchanged.
 *
 * The mock's existing color-picker behaviour is IDENTICAL — messages[] is recorded
 * around the reducer but the reducer's logic is untouched (byte-unchanged).
 */
export const mockProvider: AgentProvider = {
  id: "mock",

  async advance(
    state: ProviderSessionState | undefined,
    inbound: Parameters<AgentProvider["advance"]>[1],
  ): Promise<ProviderResult> {
    // 1. Derive the reducer's MockSessionState | undefined by stripping messages[]
    let reducerState: MockSessionState | undefined;
    if (state === undefined) {
      reducerState = undefined;
    } else if (state.phase === "awaiting_pick") {
      reducerState = {
        phase: "awaiting_pick",
        session_id: state.session_id,
        call_id: state.call_id,
      };
    } else {
      // phase: "done"
      reducerState = {
        phase: "done",
        session_id: state.session_id,
      };
    }

    // 2. Call the unchanged reducer
    const result = advanceMockAgent(reducerState, inbound);

    // 3. Compute nextMessages: start from state?.messages ?? []
    //    If session_start, append the user message (memory-ready single-turn).
    const priorMessages: SessionMessage[] = state?.messages ?? [];
    const nextMessages: SessionMessage[] =
      inbound.type === "session_start"
        ? [...priorMessages, { role: "user", content: inbound.text ?? "" }]
        : [...priorMessages];

    // 4. Re-attach nextMessages onto result.nextState to form ProviderSessionState
    let nextState: ProviderSessionState;
    if (result.nextState.phase === "awaiting_pick") {
      nextState = {
        phase: "awaiting_pick",
        session_id: result.nextState.session_id,
        call_id: result.nextState.call_id,
        messages: nextMessages,
      };
    } else {
      nextState = {
        phase: "done",
        session_id: result.nextState.session_id,
        messages: nextMessages,
      };
    }

    // 5. Map MockAgentError → ProviderError 1:1; return same ok/outbound/finalText
    if (result.ok) {
      return {
        ok: true,
        nextState,
        outbound: result.outbound,
        ...(result.finalText !== undefined ? { finalText: result.finalText } : {}),
      };
    } else {
      // MockAgentError kinds are a strict subset of ProviderError kinds
      const error: ProviderError = result.error;
      return {
        ok: false,
        error,
        nextState,
        outbound: result.outbound,
      };
    }
  },
};
