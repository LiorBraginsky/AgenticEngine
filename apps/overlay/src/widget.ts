// apps/overlay/src/widget.ts
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { renderColorPicker, renderConfirmation } from "./widgets/color-picker.js";
import { renderTextReply } from "./widgets/text-reply.js";
import { renderLoader, renderStatus } from "./widgets/status.js";
import type { StatusVariant } from "./widgets/status.js";
import { clampWidgetHeight } from "./lifecycle/measure-height.js";

// Event channel names — shared contract between main.ts and widget.ts.
// (Intra-app only; NOT part of the frozen wire protocol.)
const EV_SHOW = "show-picker";           // main → widget : { picker }
const EV_RESULT = "picker-result";       // widget → main : ColorSwatch
const EV_CANCEL = "picker-cancel";       // widget → main : (no payload)
const EV_SHOW_TEXT = "show-text";        // main → widget : { content } (display-only)
const EV_TEXT_DISMISS = "text-dismiss";  // widget → main : user dismissed text card (× or Escape)
const EV_SHOW_LOADER = "show-loader";    // main → widget : {} — thinking loader
const EV_SHOW_STATUS = "show-status";    // main → widget : { variant, message }

// Current render mode — tracks what the widget is showing so Escape can be
// routed to the right handler (cancel picker vs dismiss text card).
// Status modes (loader, error, timeout, cancelled) are timed — they are NOT
// human-dismissed via Escape (that would require the user to hunt for Escape
// while the card auto-dismisses anyway).
let currentMode: "picker" | "text" | "loader" | "error" | "timeout" | "cancelled" | undefined;

const hostEl = document.getElementById("widget-host");
if (hostEl === null) throw new Error("Required DOM element #widget-host not found");
// After the null guard, alias to a non-nullable reference so closures (e.g.
// resizeToContent's requestAnimationFrame callback) can use it without a
// possible-null narrowing error — TS doesn't narrow module-level vars inside
// nested functions because they can be re-assigned.
const host: HTMLElement = hostEl;

// Width must match tauri.conf.json width:360 and main.ts WIDGET_WIDTH_LOGICAL.
// Height-only resize keeps computeWidgetX() (right-anchor) correct without
// recomputation — the × close button stays on-screen (ADR-0006 2026-05-31).
const WIDGET_WIDTH_LOGICAL = 360;

/**
 * Resize the widget window to fit its current content (gotcha #44, Task 4.3).
 * Schedules inside requestAnimationFrame so the DOM has already painted.
 *
 * Measurement strategy (circular-vh fix):
 *   vh units inside the webview are relative to the WINDOW height, not the
 *   screen. A CSS max-height:65vh would lock to the initial 200px window, so
 *   the inner content clips to ~50px and host.scrollHeight under-measures —
 *   the window never grows (regression, Chunk 4 review).
 *
 *   Instead we measure the FULL natural height of the inner .text-reply-content
 *   via its own scrollHeight (which returns the scrollable height even when
 *   overflow:auto is set — it is NOT capped by a CSS max-height because we
 *   removed that rule). We add the card chrome (40px top-pad + 18px bot-pad = 58px)
 *   and the host shell padding (12px × 2 = 24px). For non-text cards (loader,
 *   status, picker) .text-reply-content is absent and we fall back to
 *   host.scrollHeight + 24 (same as before, unaffected).
 *
 *   After computing fullContent we clamp against screen.availHeight
 *   (SCREEN-stable, not window-relative) via clampWidgetHeight.
 *
 *   When the content exceeds the clamped ceiling we apply a px max-height to
 *   .text-reply-content so overflow-y:auto engages scrolling. The px value =
 *   clamped window height − card chrome − host shell padding, i.e. the exact
 *   space available for the scrollable content area.
 *
 * Width stays fixed at WIDGET_WIDTH_LOGICAL (360) — right-anchor invariant.
 * Uses window.screen.availHeight (logical pixels on macOS with DPI handled by
 * WebKit) with a fallback chain for rare environments where it is 0.
 */
function resizeToContent(): void {
  requestAnimationFrame(() => {
    // Card chrome constants (must match widget.css):
    //   .text-reply-card: padding-top:40px + padding-bottom:18px (var(--widget-pad-v)) = 58px
    //   #widget-host:     padding 12px top + 12px bottom = 24px
    const TEXT_CARD_CHROME_PX = 58; // .text-reply-card inner padding (top 40 + bottom 18)
    const HOST_SHELL_PX = 24;       // #widget-host padding (12 × 2)

    const contentEl = host.querySelector<HTMLElement>(".text-reply-content");

    let fullContent: number;
    if (contentEl !== null) {
      // Clear any previously applied JS-driven px cap so we see the FULL
      // natural height before deciding whether a cap is needed.
      contentEl.style.maxHeight = "";
      // scrollHeight always returns the full scrollable height regardless of
      // overflow:auto — it is NOT capped by the absence of a CSS max-height.
      fullContent = contentEl.scrollHeight + TEXT_CARD_CHROME_PX + HOST_SHELL_PX;
    } else {
      // Loader / status / picker / confirmation — no inner scroll container.
      // host.scrollHeight correctly reflects their natural height.
      fullContent = host.scrollHeight + HOST_SHELL_PX;
    }

    const screenH = window.screen.availHeight || window.innerHeight || 800;
    const h = clampWidgetHeight(fullContent, screenH);
    void getCurrentWindow().setSize(new LogicalSize(WIDGET_WIDTH_LOGICAL, h));

    // If the content is taller than the clamped window, engage scrolling by
    // setting a px max-height on the inner element = available scroll area.
    // This is screen-stable (no circular dependency on window height).
    if (contentEl !== null && fullContent > h) {
      const scrollArea = h - TEXT_CARD_CHROME_PX - HOST_SHELL_PX;
      contentEl.style.maxHeight = `${Math.max(scrollArea, 0)}px`;
    }
  });
}

void listen<{ picker: ColorPickerPrimitive }>(EV_SHOW, (event) => {
  currentMode = "picker";
  // C2: focus the document so Escape keydown is received.
  // The widget window is declared focus:false in tauri.conf.json (so it doesn't
  // steal focus from the user's running app), but we need keyboard events for
  // Escape-to-cancel. Focusing the body here gives us keydown without blocking
  // the pick flow — the user must click a swatch anyway to pick.
  document.body.focus();

  renderColorPicker(host, event.payload.picker, {
    onPick: (picked: ColorSwatch) => {
      // C1: show confirmation card before emitting the result.
      // main.ts has moved hideWidgetWindow() to the linger timer (~1200ms),
      // so this card remains visible until the window hides.
      renderConfirmation(host, picked);
      resizeToContent();
      void emit(EV_RESULT, picked);
    },
    onCancel: () => { void emit(EV_CANCEL); },
  });
  resizeToContent();
});

// Display-only text reply — wired with onDismiss so × and Escape can dismiss.
void listen<{ content: string }>(EV_SHOW_TEXT, (event) => {
  currentMode = "text";
  // Focus the body so Escape keydown is received (mirrors the picker path above).
  document.body.focus();
  renderTextReply(host, event.payload.content, () => {
    void emit(EV_TEXT_DISMISS);
  });
  resizeToContent();
});

// Thinking loader — shown from onSessionStart until content/status arrives.
// Loader is "until-replaced" — no timer here; main.ts manages the lifecycle.
void listen(EV_SHOW_LOADER, () => {
  currentMode = "loader";
  renderLoader(host);
  resizeToContent();
});

// Timed status card — error, timeout, or cancelled.
// main.ts drives the dismiss timer via HideScheduler (not here).
void listen<{ variant: StatusVariant; message: string }>(EV_SHOW_STATUS, (event) => {
  const { variant, message } = event.payload;
  currentMode = variant;
  renderStatus(host, variant, message);
  resizeToContent();
});

// C2: Escape-to-cancel — document-level keydown listener.
// Fires once per keypress regardless of which element has focus.
// Routes to the right dismiss event based on currentMode:
//   "picker" → EV_CANCEL (picker cancel, idempotent via pickerSettled in main.ts)
//   "text"   → EV_TEXT_DISMISS (text card dismiss, idempotent via lastRenderKind in main.ts)
//   status modes (loader/error/timeout/cancelled) → no Escape action (timed, not human-dismissed)
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    if (currentMode === "text") {
      void emit(EV_TEXT_DISMISS);
    } else if (currentMode === "picker") {
      void emit(EV_CANCEL);
    }
    // Status modes are timed auto-dismiss — Escape does nothing (the card goes away on its own).
  }
});
