// apps/overlay/src/widgets/color-picker.ts
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";

/**
 * Renders a brief confirmation card into `host` after the user has picked a
 * color (C1 — visible completion confirmation, chunk-03 Finding 1, Q1=A).
 * Shows "✓ <Label>  <hex>" in the same dark card style as the picker.
 * The caller (widget.ts) triggers this on pick; main.ts moves hideWidgetWindow()
 * to the linger timer so this card is visible for ~1200ms before the window hides.
 *
 * DOM-only — no Tauri, no WebSocket. Runtime visibility is verified in Task V.
 */
export function renderConfirmation(host: HTMLElement, picked: ColorSwatch): void {
  host.replaceChildren();

  const card = document.createElement("div");
  card.className = "color-picker-widget cp-confirmation";

  const swatch = document.createElement("div");
  swatch.className = "cp-confirm-swatch";
  swatch.style.backgroundColor = picked.hex;
  card.appendChild(swatch);

  const label = document.createElement("div");
  label.className = "cp-confirm-label";
  label.textContent = `✓ ${picked.label}  ${picked.hex}`;
  card.appendChild(label);

  host.appendChild(card);
}

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

  // C2: prominent labeled cancel — "Cancel" text makes it unmissable
  // even if the × glyph alone is too small. aria-label kept for a11y.
  const close = document.createElement("button");
  close.className = "cp-close";
  close.type = "button";
  close.textContent = "Cancel";
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
