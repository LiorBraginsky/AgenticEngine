/**
 * ════════════════════════════════════════════════════════════════════════
 *  FROZEN WIRE-PROTOCOL CONTRACT — AgenticEngine Walking Skeleton v0
 * ════════════════════════════════════════════════════════════════════════
 *
 * This module is the SINGLE SOURCE OF TRUTH for the engine ↔ frontend wire
 * protocol. Chunks 02a (mock agent) and 02b-* (Tauri frontend) import it and
 * build against it INDEPENDENTLY and IN PARALLEL.
 *
 * ⛔ STOP-THE-LINE RULE: any change to this contract after merge is a
 *    stop-the-line event. Pause 02a + 02b-*, update the contract ATOMICALLY
 *    as a NEW chunk, then resume. Do NOT edit shapes here ad-hoc.
 *
 * ── Two forward-compatible levels ──────────────────────────────────────
 *  1. ENVELOPE — discriminated union on `type`. KNOWN types (6):
 *       session_start | session_ack | tool_call | tool_result |
 *       tool_cancel  | session_end
 *     Unknown `type` ⇒ graceful "unknown" classification, NEVER a throw.
 *  2. TOOL REGISTRY — discriminated union on `tool`. KNOWN tools (2):
 *       show_color_picker  (interactive — emits tool_call, awaits tool_result)
 *       show_text          (display-only — emits tool_call, no result, session_end)
 *     Unknown `tool` ⇒ graceful fallback, NEVER a throw.
 *     Display-only vs interactive is encoded as the static TOOL_INTERACTION
 *     table (keyed by tool name, total over KNOWN_TOOLS via `satisfies`).
 *     The daemon branches at dispatch time: interactive → park awaiting_*;
 *     display-only → no await → session_end. Future display-only tools (image)
 *     add one TOOL_INTERACTION row; `satisfies` totality forces every tool to
 *     declare its interaction class at compile time. ADR-0009 / ADR-A.
 *     Display-only tools additionally have NO ToolResultPayload variant.
 *     The envelope union is UNTOUCHED (still 6); show_text is a new TOOL (1→2).
 *
 * ── Forward-compat is the same DISCIPLINE, two different MECHANISMS ─────
 *  • `trigger` (session_start) is a CLOSED enum: ["user","cron","external"].
 *    It is a SEMANTIC DISCRIMINATOR. We NEVER emit an unknown trigger.
 *    Future granularity (webhook / system-event / file-change — see glossary
 *    "Inbound Trigger") all map onto trigger:"external"; finer detail arrives
 *    LATER as an ADDITIVE optional `source?` field — NEVER as a change to
 *    `trigger`. (Closed because the producer is us, not an external client.)
 *  • `session_end.reason` is an OPEN/degradable STATUS: enum-or-string.
 *    A hung session is just session_end{reason:"timeout"} — no new message
 *    type (honours gotcha #4 cheaply). Open because a status can degrade
 *    gracefully to an unknown label without breaking the receiver.
 *  Same goal (forward-compatibility); different FORM, ON PURPOSE.
 *
 * ── Cancel is modeled ONCE ──────────────────────────────────────────────
 *  Cancellation is the `tool_cancel` envelope. Tool returns carry NO cancel
 *  variant (ShowColorPickerResult is just {picked}). One source of truth.
 *
 * ── UI composition direction (ADR-0005) ────────────────────────────────
 *  The PRIMITIVE (ColorPickerPrimitive) is the base/source of truth. The TOOL
 *  (ShowColorPickerArgs) COMPOSES the primitive by a SINGLE reference — no
 *  duplicated question/palette fields. This scales ADDITIVELY when the 2nd
 *  primitive lands in Phase 2. (Tool-args-as-source was rejected: it would be
 *  a structural stop-the-line at the 2nd primitive.)
 *
 * ── Deferred (additive later; do NOT add now) ──────────────────────────
 *  • tool_progress — Phase 3, shape depends on stream semantics; gotcha #1
 *    stays open.
 *  • Multi-primitive composition — Phase 2. For v0 `question` stays INSIDE
 *    the color-picker primitive (NOT yet decomposed into a standalone `text`
 *    primitive; TextPrimitive ships as a standalone display-only tool, not
 *    as a decomposition of the color-picker).
 *  • Per-install auth token (ADR-0003 p.5) — release-driven, connection-level,
 *    outside this message contract; adds additively without touching the
 *    envelope union. v0 interim mitigation = Origin-allowlist (daemon).
 *  • Alpha / 3-digit-shorthand hex — additive to ColorSwatch later.
 * ════════════════════════════════════════════════════════════════════════
 */
export * from "./primitives.js";
export * from "./tools.js";
export * from "./envelope.js";
