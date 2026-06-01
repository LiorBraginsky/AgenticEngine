// apps/overlay/src/widgets/color-picker.ts
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";

export interface ColorPickerCallbacks {
  onPick: (picked: ColorSwatch) => void;
  onCancel: () => void;
}

/**
 * Renders the color-picker primitive into `host` (replacing its contents):
 * a question label, a row of clickable swatch buttons, and a close (×) button.
 * DOM-only — no Tauri, no WebSocket. The caller wires the callbacks to the
 * cross-window event bridge (widget.ts).
 */
export function renderColorPicker(
  host: HTMLElement,
  picker: ColorPickerPrimitive,
  cb: ColorPickerCallbacks,
): void {
  host.replaceChildren();

  const card = document.createElement("div");
  card.className = "color-picker-widget";

  const close = document.createElement("button");
  close.className = "cp-close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Cancel");
  close.addEventListener("click", () => cb.onCancel());
  card.appendChild(close);

  const label = document.createElement("div");
  label.className = "cp-question";
  label.textContent = picker.question;
  card.appendChild(label);

  const row = document.createElement("div");
  row.className = "cp-swatches";
  for (const swatch of picker.palette) {
    const btn = document.createElement("button");
    btn.className = "cp-swatch";
    btn.type = "button";
    btn.style.backgroundColor = swatch.hex;
    btn.title = `${swatch.label} ${swatch.hex}`;
    btn.setAttribute("aria-label", swatch.label);
    btn.addEventListener("click", () => cb.onPick(swatch));

    const tag = document.createElement("span");
    tag.className = "cp-swatch-label";
    tag.textContent = swatch.label;
    btn.appendChild(tag);

    row.appendChild(btn);
  }
  card.appendChild(row);

  host.appendChild(card);
}
