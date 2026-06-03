// apps/overlay/src/widget.ts
import { listen, emit } from "@tauri-apps/api/event";
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { renderColorPicker, renderConfirmation } from "./widgets/color-picker.js";
import { renderTextReply } from "./widgets/text-reply.js";

// Event channel names — shared contract between main.ts and widget.ts.
// (Intra-app only; NOT part of the frozen wire protocol.)
const EV_SHOW = "show-picker";           // main → widget : { picker }
const EV_RESULT = "picker-result";       // widget → main : ColorSwatch
const EV_CANCEL = "picker-cancel";       // widget → main : (no payload)
const EV_SHOW_TEXT = "show-text";        // main → widget : { content } (display-only)
const EV_TEXT_DISMISS = "text-dismiss";  // widget → main : user dismissed text card (× or Escape)

// Current render mode — tracks what the widget is showing so Escape can be
// routed to the right handler (cancel picker vs dismiss text card).
let currentMode: "picker" | "text" | undefined;

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

// C2: Escape-to-cancel — document-level keydown listener.
// Fires once per keypress regardless of which element has focus.
// Routes to the right dismiss event based on currentMode:
//   "picker" → EV_CANCEL (picker cancel, idempotent via pickerSettled in main.ts)
//   "text"   → EV_TEXT_DISMISS (text card dismiss, idempotent via lastRenderKind in main.ts)
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    if (currentMode === "text") {
      void emit(EV_TEXT_DISMISS);
    } else {
      void emit(EV_CANCEL);
    }
  }
});
