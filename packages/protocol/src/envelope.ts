import { z } from "zod";
import { ToolCallPayload, ToolResultPayload } from "./tools.js";

/**
 * D1 — CLOSED enum (ADR-0001 Decision p.5). The skeleton sends only "user".
 * cron/inbound triggers (Phase 6 rituals) map onto these three; finer
 * granularity arrives later as an ADDITIVE optional `source?` field, NEVER as
 * a change to `trigger`. We NEVER emit an unknown trigger.
 */
export const Trigger = z.enum(["user", "cron", "external"]);
export type Trigger = z.infer<typeof Trigger>;

/**
 * D1 — OPEN/degradable status (covers gotcha #4 timeout cheaply). Known values
 * parse as the enum; any other string degrades gracefully to a raw label —
 * no new message type, no break.
 */
export const SessionEndReason = z
  .enum(["completed", "cancelled", "timeout", "error"])
  .or(z.string());
export type SessionEndReason = z.infer<typeof SessionEndReason>;

// ── The 6 KNOWN envelope variants (discriminant `type`) ──────────────────

/** Frontend → daemon. Carries the user's typed text (mock ignores it, but the
 *  field must exist if sent) + an optional client-side correlation id. */
export const SessionStart = z.object({
  type: z.literal("session_start"),
  trigger: Trigger,
  text: z.string().optional(),
  client_session_id: z.string().optional(),
});

/** Daemon → frontend. Daemon MINTS `session_id` (crypto.randomUUID) and echoes
 *  the client's correlation id so 02b-i can learn its session_id (D3). */
export const SessionAck = z.object({
  type: z.literal("session_ack"),
  session_id: z.string(),
  client_session_id: z.string().optional(),
});

export const ToolCall = z.object({
  type: z.literal("tool_call"),
  session_id: z.string(),
  call_id: z.string(),
  payload: ToolCallPayload,
});

export const ToolResult = z.object({
  type: z.literal("tool_result"),
  session_id: z.string(),
  call_id: z.string(),
  payload: ToolResultPayload,
});

/** The SINGLE representation of cancellation (D4). */
export const ToolCancel = z.object({
  type: z.literal("tool_cancel"),
  session_id: z.string(),
  call_id: z.string(),
});

export const SessionEnd = z.object({
  type: z.literal("session_end"),
  session_id: z.string(),
  reason: SessionEndReason,
});

/** The KNOWN envelope union — 6 variants (D3). */
export const Envelope = z.discriminatedUnion("type", [
  SessionStart,
  SessionAck,
  ToolCall,
  ToolResult,
  ToolCancel,
  SessionEnd,
]);
export type Envelope = z.infer<typeof Envelope>;

export const KNOWN_MESSAGE_TYPES = [
  "session_start",
  "session_ack",
  "tool_call",
  "tool_result",
  "tool_cancel",
  "session_end",
] as const;
export type KnownMessageType = (typeof KNOWN_MESSAGE_TYPES)[number];

/**
 * Graceful, NON-THROWING parse of a raw inbound message. Unknown `type`,
 * malformed body, or unknown trigger ⇒ { kind: "unknown" } / { kind: "invalid" }
 * — NEVER a throw (gotcha #9). The daemon classifies and does NOT crash.
 */
export function parseEnvelope(
  raw: unknown,
):
  | { kind: "ok"; message: Envelope }
  | { kind: "unknown"; type?: string }
  | { kind: "invalid"; error: z.ZodError } {
  const result = Envelope.safeParse(raw);
  if (result.success) return { kind: "ok", message: result.data };

  const type =
    raw && typeof raw === "object" && "type" in raw
      ? (raw as { type?: unknown }).type
      : undefined;
  const typeStr = typeof type === "string" ? type : undefined;
  if (typeStr === undefined || !(KNOWN_MESSAGE_TYPES as readonly string[]).includes(typeStr)) {
    return { kind: "unknown", type: typeStr };
  }
  // Known type, but body failed validation (incl. an unknown trigger value on
  // session_start, which fails the CLOSED Trigger enum) ⇒ invalid, not a throw.
  return { kind: "invalid", error: result.error };
}
