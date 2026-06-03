/**
 * D1 fix — Task 4.1 (chunk 4).
 *
 * Maps a wire `session_end.reason` to a status card descriptor so main.ts
 * can show the appropriate error/timeout card in the widget zone.
 *
 * SessionEndReason is an OPEN enum (packages/protocol/src/envelope.ts:18-21).
 * This function MUST NOT throw for unknown/future reason values — it returns
 * undefined, which the caller interprets as "no card to show".
 *
 * The daemon strips detail from error reasons by design (formatErrorEnd,
 * packages/daemon/src/providers/anthropic-api-provider.ts:77-89), so the
 * messages here are generic. Protocol-level detail would require a wire change.
 *
 * DOM-free, no Tauri, no WebSocket.
 */

import type { StatusVariant } from "../widgets/status.js";

export interface EndReasonStatus {
  variant: StatusVariant;
  message: string;
  /** Auto-dismiss duration in ms (matches dismissPolicy in dismiss-policy.ts). */
  ms: number;
}

/**
 * Returns a status card descriptor for actionable session_end reasons, or
 * undefined for reasons that require no overlay card (completed / cancelled /
 * any unknown future variant).
 */
export function statusForEndReason(reason: string): EndReasonStatus | undefined {
  switch (reason) {
    case "error":
      return {
        variant: "error" satisfies StatusVariant,
        message: "Something went wrong. Try again.",
        ms: 2000,
      };
    case "timeout":
      return {
        variant: "timeout" satisfies StatusVariant,
        message: "No response — the model is taking too long. Try again.",
        ms: 2500,
      };
    // "completed", "cancelled", and any unknown future variant → no card.
    default:
      return undefined;
  }
}
