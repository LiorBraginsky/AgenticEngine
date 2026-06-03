/**
 * Rule-of-three dismiss policy (ADR-0006 Amendment 2026-06-03).
 *
 * Every render mode in the widget window maps to exactly one dismiss behaviour:
 *   - content (text, picker)  → persist until the user dismisses (Escape/×/new-request)
 *   - loader                  → until-replaced: shown until content/status arrives
 *   - status (error, timeout, cancelled, confirmation) → timed auto-dismiss
 *
 * DOM-free, no Tauri, no WebSocket. Pure policy helper — testable in isolation.
 */

export type RenderMode =
  | "text"
  | "picker"
  | "loader"
  | "error"
  | "timeout"
  | "cancelled"
  | "confirmation";

export type DismissPolicy =
  /** Content: human-dismissed only (Escape / new-request / ×). No timer ever auto-hides content. */
  | { kind: "persist" }
  /** Loader: replaced when content (text / picker / status) arrives. Never timed. */
  | { kind: "until-replaced" }
  /** Timed status: auto-dismisses after ms milliseconds. */
  | { kind: "timed"; ms: number };

/**
 * Returns the dismiss policy for a given render mode.
 * Exhaustive switch — adding a new mode without updating this function is a compile error.
 */
export function dismissPolicy(mode: RenderMode): DismissPolicy {
  switch (mode) {
    case "text":
      return { kind: "persist" };
    case "picker":
      // User-driven: settles via pick (→ confirmation) or cancel (→ EV_CANCEL).
      // The picker itself is not auto-dismissed; only the confirmation that follows is.
      return { kind: "persist" };
    case "loader":
      return { kind: "until-replaced" };
    case "error":
      return { kind: "timed", ms: 2000 };
    case "timeout":
      // Longer than error — "taking too long" copy needs reading time.
      return { kind: "timed", ms: 2500 };
    case "cancelled":
      return { kind: "timed", ms: 1200 };
    case "confirmation":
      // Picker confirmation (ADR-0006 2026-06-01): ~1200ms, unchanged.
      return { kind: "timed", ms: 1200 };
  }
}
