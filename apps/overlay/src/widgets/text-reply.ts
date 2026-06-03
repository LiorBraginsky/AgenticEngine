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
export function renderTextReply(host: HTMLElement, content: string): void {
  host.replaceChildren();

  const card = document.createElement("div");
  card.className = "color-picker-widget text-reply-card";

  const contentEl = document.createElement("div");
  contentEl.className = "text-reply-content";
  contentEl.textContent = content;
  card.appendChild(contentEl);

  host.appendChild(card);
}
