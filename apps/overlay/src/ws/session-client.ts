/**
 * DOM-free WS round-trip seam — pure TS, testable under bun test without
 * a live window or global WebSocket.
 *
 * FROZEN-CONTRACT RULE: import shapes from @agentic/protocol; NEVER redefine.
 * If a variant appears missing, STOP — it is not missing (session_start /
 * session_ack / session_end / tool_call / tool_cancel all exist; confirmed in
 * packages/protocol/src/envelope.ts).
 *
 * 02b-ii onToolCall flow:
 *   session_start → session_ack → tool_call → onToolCall(ctx) → sendResult|sendCancel → session_end
 * On receiving a tool_call whose session_id matches the confirmed session,
 * the seam invokes the injected onToolCall callback with a ToolCallContext
 * carrying the picker primitive and bound sendResult/sendCancel closures.
 * The renderer (not the seam) decides whether to call sendResult or sendCancel.
 * Unknown tools or unconfirmed sessions are silently ignored (gotcha #9).
 * Resolves on session_end of ANY reason.
 */

import { parseEnvelope } from "@agentic/protocol";
import type { Envelope, ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { decideRender, buildToolResult, buildToolCancel } from "./tool-call-handler.js";
import type { WebSocketFactory } from "./types.js";

const WS_URL = "ws://127.0.0.1:7777";
const ECHO_TIMEOUT_MS = 2000;

/**
 * The frozen session_start shape derived from the Envelope union.
 * Using Extract<Envelope, {type:"session_start"}> avoids a direct import of
 * the SessionStart Zod-schema value (which causes TS2749 under the root
 * typecheck program due to dual Package IDs from two workspace symlinks).
 * This is NOT a local redefinition — it reads through the frozen contract.
 */
type SessionStart = Extract<Envelope, { type: "session_start" }>;

export interface EchoResult {
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

export interface RunEchoOptions {
  onToolCall?: (ctx: ToolCallContext) => void;
}

/**
 * Constructs a frozen-contract session_start envelope with a freshly minted
 * client_session_id for correlation. Uses web-standard crypto.randomUUID()
 * which is available in both Bun and WKWebView (ADR-0004 discipline).
 */
export function buildSessionStart(text: string): {
  msg: SessionStart;
  clientSessionId: string;
} {
  const clientSessionId = crypto.randomUUID();
  const msg: SessionStart = {
    type: "session_start",
    trigger: "user",
    text,
    client_session_id: clientSessionId,
  };
  return { msg, clientSessionId };
}

/**
 * Opens a WebSocket via the injected factory, sends a session_start, and
 * resolves with the daemon-minted { sessionId, reason } on session_end.
 *
 * 02b-ii onToolCall flow: on receiving a tool_call whose session_id matches
 * the confirmed session, the seam invokes options.onToolCall(ctx) where ctx
 * carries the picker primitive and bound sendResult/sendCancel closures.
 * The renderer drives the result or cancel; the seam writes to the socket.
 * Unknown tools or unconfirmed sessions are silently ignored (no throw).
 * runEcho resolves on session_end of ANY reason.
 *
 * Correlation: strictly via the echoed client_session_id in session_ack.
 * A session_ack with a non-matching client_session_id is silently ignored.
 *
 * Rejects on: transport error, close-before-end, or the internal timeout.
 * Never throws on unknown/invalid frames (gotcha #9 discipline).
 *
 * 6.2 (MAJOR fix): ws.close() is called in finish() before resolve so no
 * socket leaks on the success path. Post-settle close/fail are no-ops against
 * the already-settled promise (existing design).
 */
export function runEcho(
  text: string,
  factory: WebSocketFactory,
  options: RunEchoOptions = {},
): Promise<EchoResult> {
  return new Promise<EchoResult>((resolve, reject) => {
    const { msg, clientSessionId } = buildSessionStart(text);
    const ws = factory(WS_URL);

    // 6.3: single source of truth — one closure variable, read directly in
    // handleInbound. The old double-guard (snapshot param + closure var) is removed.
    let confirmedSessionId: string | undefined;
    let settled = false;

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`runEcho timed out after ${ECHO_TIMEOUT_MS}ms`));
    }, ECHO_TIMEOUT_MS);

    // 6.2: close the socket before resolving to prevent the socket leak (MAJOR fix).
    function finish(result: EchoResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      resolve(result);
    }

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close(); // NIT-1: idempotent close — mirrors finish(); safe on already-closing/closed socket
      reject(err);
    }

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(msg));
    });

    ws.addEventListener("message", (ev) => {
      const result = parseEnvelope(tryParse(ev.data));

      if (result.kind === "unknown") {
        console.warn("[session-client] unknown envelope type ignored:", result.type);
        return;
      }
      if (result.kind === "invalid") {
        console.warn("[session-client] invalid envelope ignored:", result.error.message);
        return;
      }

      const envelope = result.message;

      if (envelope.type === "session_ack") {
        // 6.3: correlate strictly by echoed client_session_id; read confirmedSessionId directly.
        if (envelope.client_session_id === clientSessionId) {
          confirmedSessionId = envelope.session_id;
        } else {
          console.warn(
            "[session-client] session_ack client_session_id mismatch — ignored",
            { expected: clientSessionId, got: envelope.client_session_id },
          );
        }
        return;
      }

      if (envelope.type === "tool_call") {
        const decision = decideRender(envelope, confirmedSessionId);
        if (decision.kind === "render") {
          const { session_id, call_id, picker } = decision;
          options.onToolCall?.({
            picker,
            sessionId: session_id,
            callId: call_id,
            sendResult: (picked) => { if (!settled) ws.send(JSON.stringify(buildToolResult(session_id, call_id, picked))); },
            sendCancel: () => { if (!settled) ws.send(JSON.stringify(buildToolCancel(session_id, call_id))); },
          });
        }
        // unknown tool / unconfirmed session ⇒ ignore (graceful, no throw)
        return;
      }

      if (envelope.type === "session_end") {
        // Resolve on session_end of any reason.
        if (confirmedSessionId !== undefined && envelope.session_id === confirmedSessionId) {
          finish({ sessionId: envelope.session_id, reason: envelope.reason });
        }
        return;
      }

      // All other envelope types (tool_result, session_start) are not relevant — ignore.
    });

    ws.addEventListener("error", () => {
      fail(new Error("WebSocket transport error"));
    });

    ws.addEventListener("close", () => {
      // Only reject on unexpected close (before we've resolved).
      // If already settled, fail() is a no-op (settled guard).
      fail(new Error("WebSocket closed before session_end received"));
    });
  });
}

/**
 * Parses a raw frame value into a plain object.
 * Returns the value as-is if not a string, or the raw string if JSON.parse fails.
 * NEVER throws — the caller's parseEnvelope handles non-object gracefully.
 */
function tryParse(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("[session-client] non-JSON frame ignored");
    return raw;
  }
}
