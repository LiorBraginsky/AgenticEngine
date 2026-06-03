// apps/overlay/src/widget.ts
import { listen, emit } from "@tauri-apps/api/event";
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { renderColorPicker, renderConfirmation } from "./widgets/color-picker.js";
import { renderTextReply } from "./widgets/text-reply.js";

// Event channel names — shared contract between main.ts and widget.ts.
// (Intra-app only; NOT part of the frozen wire protocol.)
const EV_SHOW = "show-picker";        // main → widget : { picker }
const EV_RESULT = "picker-result";    // widget → main : ColorSwatch
const EV_CANCEL = "picker-cancel";    // widget → main : (no payload)
const EV_SHOW_TEXT = "show-text";     // main → widget : { content } (display-only)

const host = document.getElementById("widget-host");
if (host === null) throw new Error("Required DOM element #widget-host not found");

void listen<{ picker: ColorPickerPrimitive }>(EV_SHOW, (event) => {
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

// Display-only text reply — no result/cancel wiring needed.
void listen<{ content: string }>(EV_SHOW_TEXT, (event) => {
  renderTextReply(host, event.payload.content);
});

// C2: Escape-to-cancel — document-level keydown listener.
// Fires once per keypress regardless of which element has focus.
// Guards against emitting cancel after a pick has already settled the session
// (the EV_RESULT listener in main.ts uses pickerSettled for idempotency, but
// emitting EV_CANCEL after EV_RESULT is harmless since main.ts guards with
// pickerSettled — belt-and-suspenders both sides).
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    void emit(EV_CANCEL);
  }
});
