import type { Envelope } from "@agentic/protocol";

/**
 * Memory-ready conversation turn. Single-turn puts exactly one in messages[].
 * Multi-turn later = append more; NOT a rewrite. No tool/role taxonomy beyond
 * user|assistant yet (kept minimal per gotchas #29/#30 — deferred).
 */
export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Per-session state the provider reads/writes. Additive superset of the
 * mock's existing phase machine: phase fields stay; messages[] is new.
 */
export type ProviderSessionState =
  | { phase: "awaiting_pick"; session_id: string; call_id: string; messages: SessionMessage[] }
  | { phase: "done"; session_id: string; messages: SessionMessage[] };

/** The three inbound envelopes a provider consumes (= existing MockAgentInput). */
export type ProviderInput =
  | Extract<Envelope, { type: "session_start" }>
  | Extract<Envelope, { type: "tool_result" }>
  | Extract<Envelope, { type: "tool_cancel" }>;

export type ProviderError =
  | { kind: "malformed_tool_result"; detail: string }
  | { kind: "unexpected_message"; detail: string }
  | { kind: "provider_failure"; detail: string }; // reserved for chunk-03 real adapters

/**
 * Typed result — NEVER throw (gotcha #9 carried forward). Mirrors MockAgentResult.
 */
export type ProviderResult =
  | { ok: true; nextState: ProviderSessionState; outbound: Envelope[]; finalText?: string }
  | { ok: false; error: ProviderError; nextState: ProviderSessionState; outbound: Envelope[] };

/**
 * The swappable seam — THIN (no `kind` field). Auth is INTERNAL to the adapter
 * — the port has no credential surface. advance() is async (imperative shell)
 * so a network adapter (chunk-03) fits the same signature the mock satisfies
 * trivially. agent-harness providers get a SEPARATE future sub-seam, not a
 * branch here (Lior 2026-06-02; ADR-0010 revised).
 */
export interface AgentProvider {
  readonly id: string; // e.g. "mock", "anthropic-api" (chunk-03)
  advance(
    state: ProviderSessionState | undefined,
    inbound: ProviderInput,
  ): Promise<ProviderResult>;
}
