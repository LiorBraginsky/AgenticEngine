/**
 * Status renderers for the widget window (Task 3.2, chunk 3).
 *
 * renderLoader: shows a spinner card while the LLM is thinking
 *               (loader is "until-replaced" — not timed).
 * renderStatus: shows a timed status card for error / timeout / cancelled variants.
 *
 * Both reuse the dark `.color-picker-widget` chrome from widget.css.
 * Content is always set via textContent — NEVER innerHTML (XSS safety, gotcha #9 spirit).
 * DOM-only, no Tauri, no WebSocket.
 */

export type StatusVariant = "error" | "timeout" | "cancelled";

/**
 * Renders a thinking-loader spinner card into `host`.
 * Replaces any previous content (host.replaceChildren).
 */
export function renderLoader(host: HTMLElement): void {
  host.replaceChildren();

  const card = document.createElement("div");
  card.className = "color-picker-widget status-loader-card";

  const spinner = document.createElement("div");
  spinner.className = "status-loader";

  // Optional muted "Thinking…" label — polished in chunk 4 appearance pass.
  // Class .status-loader-label is styled at ≤12px, rgba(245,245,247,0.6).
  const label = document.createElement("span");
  label.className = "status-loader-label";
  label.textContent = "Thinking…";

  card.appendChild(spinner);
  card.appendChild(label);
  host.appendChild(card);
}

/**
 * Renders a timed status card into `host` for the given variant and message.
 * Replaces any previous content (host.replaceChildren).
 *
 * The dismiss timer is NOT managed here — main.ts drives it via HideScheduler.
 */
export function renderStatus(host: HTMLElement, variant: StatusVariant, message: string): void {
  host.replaceChildren();

  const card = document.createElement("div");
  card.className = "color-picker-widget";

  const statusEl = document.createElement("div");
  // .status-card is the base class; .status-<variant> for variant-specific styles.
  statusEl.className = `status-card status-${variant}`;
  // textContent only — never innerHTML (message is an unconstrained string).
  statusEl.textContent = message;

  card.appendChild(statusEl);
  host.appendChild(card);
}
