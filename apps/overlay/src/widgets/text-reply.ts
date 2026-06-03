// apps/overlay/src/widgets/text-reply.ts

/**
 * Renders a display-only text reply card into `host` (C3-2).
 * Reuses the `.color-picker-widget` dark-card chrome, adds `.text-reply-card`
 * for text-specific sizing. Content is set via textContent (NEVER innerHTML)
 * because `content` is an unconstrained string (XSS safety, gotcha #9 spirit).
 * DOM-only — no Tauri, no WebSocket.
 *
 * Mirrors renderConfirmation's structure: replaceChildren(), build card, append.
 */
export function renderTextReply(host: HTMLElement, content: string, onDismiss?: () => void): void {
  host.replaceChildren();

  const card = document.createElement("div");
  card.className = "color-picker-widget text-reply-card";

  // Display-only content is *closed*, not *cancelled* — deliberately distinct
  // from the picker's "× Cancel" (ADR-0006 2026-06-01 labeled-control style).
  if (onDismiss !== undefined) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "cp-close";
    closeBtn.textContent = "× Close";
    closeBtn.addEventListener("click", onDismiss);
    card.appendChild(closeBtn);
  }

  const contentEl = document.createElement("div");
  contentEl.className = "text-reply-content";
  contentEl.textContent = content;
  card.appendChild(contentEl);

  host.appendChild(card);
}
