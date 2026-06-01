// apps/overlay/src/widget.ts
import { listen, emit } from "@tauri-apps/api/event";
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { renderColorPicker } from "./widgets/color-picker.js";

// Event channel names — shared contract between main.ts and widget.ts.
// (Intra-app only; NOT part of the frozen wire protocol.)
const EV_SHOW = "show-picker";        // main → widget : { picker }
const EV_RESULT = "picker-result";    // widget → main : ColorSwatch
const EV_CANCEL = "picker-cancel";    // widget → main : (no payload)

const host = document.getElementById("widget-host");
if (host === null) throw new Error("Required DOM element #widget-host not found");

void listen<{ picker: ColorPickerPrimitive }>(EV_SHOW, (event) => {
  renderColorPicker(host, event.payload.picker, {
    onPick: (picked: ColorSwatch) => { void emit(EV_RESULT, picked); },
    onCancel: () => { void emit(EV_CANCEL); },
  });
});
