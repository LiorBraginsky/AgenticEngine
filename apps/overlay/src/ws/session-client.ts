/**
 * DOM-free WS round-trip seam — pure TS, testable under bun test without
 * a live window or global WebSocket.
 *
 * FROZEN-CONTRACT RULE: import shapes from @agentic/protocol; NEVER redefine.
 * If a variant appears missing, STOP — it is not missing (session_start /
 * session_ack / session_end / tool_call / tool_cancel all exist; confirmed in
 * packages/protocol/src/envelope.ts).
 *
 * v0 cancel-to-complete flow (Step 6.1):
 *   session_start → session_ack → tool_call → (auto) tool_cancel → session_end{cancelled}
 * The seam sends tool_cancel when it receives a tool_call whose session_id
 * matches the confirmed session. Resolves on session_end of ANY reason.
 */

import { parseEnvelope } from "@agentic/protocol";
import type { Envelope } from "@agentic/protocol";
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
type ToolCancel = Extract<Envelope, { type: "tool_cancel" }>;

export interface EchoResult {
  sessionId: string;
  reason: string;
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
 * v0 cancel-to-complete flow: on receiving a tool_call whose session_id
 * matches the confirmed session, the seam auto-sends tool_cancel (because
 * widget rendering is chunk 02b-ii). The daemon replies session_end{cancelled}.
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
        // 6.1 cancel-to-complete: when a tool_call arrives for our confirmed session,
        // auto-send tool_cancel. The daemon replies session_end{cancelled}.
        // We do NOT render the widget (that is chunk 02b-ii).
        if (confirmedSessionId !== undefined && envelope.session_id === confirmedSessionId) {
          const cancel: ToolCancel = {
            type: "tool_cancel",
            session_id: envelope.session_id,
            call_id: envelope.call_id,
          };
          ws.send(JSON.stringify(cancel));
        }
        return;
      }

      if (envelope.type === "session_end") {
        // Resolve on session_end of any reason (v0: expect "cancelled" via cancel-to-complete).
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
