// apps/overlay/src/widget.ts
import { listen, emit } from "@tauri-apps/api/event";
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { renderColorPicker, renderConfirmation } from "./widgets/color-picker.js";
import { renderTextReply } from "./widgets/text-reply.js";
import { renderLoader, renderStatus } from "./widgets/status.js";
import type { StatusVariant } from "./widgets/status.js";

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

const host = document.getElementById("widget-host");
if (host === null) throw new Error("Required DOM element #widget-host not found");

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
      void emit(EV_RESULT, picked);
    },
    onCancel: () => { void emit(EV_CANCEL); },
  });
});

// Display-only text reply — wired with onDismiss so × and Escape can dismiss.
void listen<{ content: string }>(EV_SHOW_TEXT, (event) => {
  currentMode = "text";
  // Focus the body so Escape keydown is received (mirrors the picker path above).
  document.body.focus();
  renderTextReply(host, event.payload.content, () => {
    void emit(EV_TEXT_DISMISS);
  });
});

// Thinking loader — shown from onSessionStart until content/status arrives.
// Loader is "until-replaced" — no timer here; main.ts manages the lifecycle.
void listen(EV_SHOW_LOADER, () => {
  currentMode = "loader";
  renderLoader(host);
});

// Timed status card — error, timeout, or cancelled.
// main.ts drives the dismiss timer via HideScheduler (not here).
void listen<{ variant: StatusVariant; message: string }>(EV_SHOW_STATUS, (event) => {
  const { variant, message } = event.payload;
  currentMode = variant;
  renderStatus(host, variant, message);
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
