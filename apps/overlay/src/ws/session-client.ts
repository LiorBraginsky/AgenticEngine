/**
 * DOM-free WS round-trip seam — pure TS, testable under bun test without
 * a live window or global WebSocket.
 *
 * FROZEN-CONTRACT RULE: import shapes from @agentic/protocol; NEVER redefine.
 * If a variant appears missing, STOP — it is not missing (session_start /
 * session_ack / session_end / tool_call / tool_cancel all exist; confirmed in
 * packages/protocol/src/envelope.ts).
 *
 * 02b-ii onToolCall flow (now driven by ConnectionManager — CM-02/CM-03):
 *   session_start → session_ack → tool_call → onToolCall(ctx) → sendResult|sendCancel → session_end
 * On receiving a tool_call whose session_id matches the confirmed session,
 * routeInbound invokes the injected onToolCall callback with a ToolCallContext
 * carrying the picker primitive and bound sendResult/sendCancel closures.
 * The renderer (not the seam) decides whether to call sendResult or sendCancel.
 * Unknown tools or unconfirmed sessions are silently ignored (gotcha #9).
 * The turn settles on session_end of ANY reason.
 *
 * CM-03 (carry-forward 1): the free per-turn-socket runSession that used to live
 * here was retired — ConnectionManager.runSession on the shared persistent socket
 * is the ONE socket-lifetime contract. This module keeps the pure building blocks:
 * buildSessionStart, routeInbound, SessionContext + the option/result types.
 */

import type { Envelope, ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { decideRender, decideTextRender, buildToolResult, buildToolCancel } from "./tool-call-handler.js";

export const WS_URL = "ws://127.0.0.1:7777";

/**
 * Default handshake timeout for real single-turn LLM latency.
 *
 * Calibrated for real single-turn LLM latency — the AnthropicApiProvider
 * bundles session_ack + tool_call + session_end all after the full Claude
 * messages.create() call completes, so "time to first envelope" ≈ generation
 * time.  30s aligns with the project's "30s tool timeout" sensible default
 * (known-gotchas #4).
 *
 * v0's 2000ms was calibrated for the instant mock.  Proper fix (emit
 * session_ack IMMEDIATELY on session_start, before the LLM call, then stream
 * content) is deferred — see known-gotchas #42 / #43.
 */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * The frozen session_start shape derived from the Envelope union.
 * Using Extract<Envelope, {type:"session_start"}> avoids a direct import of
 * the SessionStart Zod-schema value (which causes TS2749 under the root
 * typecheck program due to dual Package IDs from two workspace symlinks).
 * This is NOT a local redefinition — it reads through the frozen contract.
 */
type SessionStart = Extract<Envelope, { type: "session_start" }>;

export interface SessionResult {
  sessionId: string;
  reason: string;
}

/**
 * Context passed to the onToolCall callback. The renderer uses sendResult or
 * sendCancel to drive the wire round-trip; the seam owns the socket write.
 */
export interface ToolCallContext {
  picker: ColorPickerPrimitive;
  sessionId: string;
  callId: string;
  sendResult: (picked: ColorSwatch) => void;
  sendCancel: () => void;
}

export interface RunSessionOptions {
  onToolCall?: (ctx: ToolCallContext) => void;
  /** Called when a show_text tool_call arrives (display-only path).
   *  The promise stays open until session_end resolves it. */
  onShowText?: (content: string) => void;
  /**
   * Fired right after session_start is sent — frontend-only in-flight signal
   * for the thinking loader. NOT a wire event; NOT a protocol change.
   * The loader should be shown from this callback and replaced when the first
   * onToolCall or onShowText arrives.
   */
  onSessionStart?: () => void;
  /**
   * How long (ms) to wait for the daemon to send the first tool_call after
   * session_start is sent.  Defaults to DEFAULT_HANDSHAKE_TIMEOUT_MS (30s).
   * Tests that exercise the rejection path should pass a small value (e.g. 50)
   * so the suite stays fast.
   */
  handshakeTimeoutMs?: number;
  /**
   * CM-01 (spec §3.3): the durable thread to continue. The overlay mints this
   * client-side (crypto.randomUUID, same posture as client_session_id) on the
   * first submit of a conversation and passes it on every continuation turn;
   * the daemon ADOPTS an unknown-but-UUID-shaped value as the new thread's id
   * (session_ack carries no thread_id, so the client owns the mint). Absent ⇒
   * a brand-new conversation (daemon mints, MF-01 §3.1).
   * Designed as an option field (not a positional param) so chunk 02's
   * persistent-socket refactor reuses runSession unchanged.
   */
  threadId?: string;
}

/**
 * Constructs a frozen-contract session_start envelope with a freshly minted
 * client_session_id for correlation. Uses web-standard crypto.randomUUID()
 * which is available in both Bun and WKWebView (ADR-0004 discipline).
 *
 * CM-01 (spec §3.3): optional `threadId` is spread onto the message only when
 * present, so the no-thread_id frame stays byte-equivalent to the MF-01
 * single-turn shape. The field already exists in the frozen contract
 * (envelope.ts:39 — `session_start.thread_id: z.string().optional()`).
 */
export function buildSessionStart(text: string, threadId?: string): {
  msg: SessionStart;
  clientSessionId: string;
} {
  const clientSessionId = crypto.randomUUID();
  const msg: SessionStart = {
    type: "session_start",
    trigger: "user",
    text,
    client_session_id: clientSessionId,
    // CM-01: additive optional continuation handle (already in the frozen contract,
    // envelope.ts:39). Only included when present so the no-thread_id frame stays
    // byte-equivalent to the MF-01 single-turn shape.
    ...(threadId ? { thread_id: threadId } : {}),
  };
  return { msg, clientSessionId };
}

/**
 * Per-turn routing context held by the ConnectionManager's dispatcher (CM-02).
 * Single-flight today; the dispatcher Map holds at most one (gotcha #45 unchanged).
 */
export interface SessionContext {
  clientSessionId: string;
  confirmedSessionId?: string;
  options: RunSessionOptions;
  settle: (result: SessionResult) => void;       // resolve the turn promise
  failTurn: (err: Error) => void;                  // reject the turn promise
  disarmTimeout: () => void;
  send: (data: string) => void;                    // shared-socket write
  settled: boolean;
}

/**
 * Routes ONE parsed-and-validated inbound envelope into a SessionContext,
 * reusing the SAME logic as runSession's message handler (decideRender /
 * decideTextRender / buildToolResult / buildToolCancel). NEVER throws (gotcha #9).
 * Unknown/non-matching frames are silently dropped.
 */
export function routeInbound(env: Envelope, ctx: SessionContext): void {
  if (ctx.settled) return;

  if (env.type === "session_ack") {
    if (env.client_session_id === ctx.clientSessionId) {
      ctx.confirmedSessionId = env.session_id;
    }
    return;
  }
  if (env.type === "tool_call") {
    const decision = decideRender(env, ctx.confirmedSessionId);
    if (decision.kind === "render") {
      ctx.disarmTimeout();
      const { session_id, call_id, picker } = decision;
      ctx.options.onToolCall?.({
        picker, sessionId: session_id, callId: call_id,
        sendResult: (picked) => { if (!ctx.settled) ctx.send(JSON.stringify(buildToolResult(session_id, call_id, picked))); },
        sendCancel: () => { if (!ctx.settled) ctx.send(JSON.stringify(buildToolCancel(session_id, call_id))); },
      });
      return;
    }
    const textDecision = decideTextRender(env, ctx.confirmedSessionId);
    if (textDecision.kind === "render-text") {
      ctx.disarmTimeout();
      ctx.options.onShowText?.(textDecision.content);
    }
    return;
  }
  if (env.type === "session_end") {
    if (ctx.confirmedSessionId !== undefined && env.session_id === ctx.confirmedSessionId) {
      ctx.settle({ sessionId: env.session_id, reason: env.reason });
    }
    return;
  }
  // tool_result / tool_cancel / session_start inbound: not relevant to the overlay — ignore.
}
