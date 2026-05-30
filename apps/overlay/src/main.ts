/**
 * Overlay renderer — wires the panel DOM to the DOM-free seam.
 *
 * Origin notes (Branch A, confirmed 2026-05-31):
 *   dev:  WKWebView sends Origin: http://localhost:1420  (allowlisted)
 *   prod: WKWebView sends Origin: tauri://localhost      (allowlisted)
 * JS CANNOT and MUST NOT attempt to set Origin — WKWebView sets it.
 * No query-param / subprotocol token substitute (Lior threat-model, plan §D).
 */

import { invoke } from "@tauri-apps/api/core";
import type { WebSocketFactory } from "./ws/types.js";
import { runEcho } from "./ws/session-client.js";

// ---------------------------------------------------------------------------
// Real WebSocket factory — adapts browser WebSocket to the seam's WebSocketLike.
// ---------------------------------------------------------------------------
const factory: WebSocketFactory = (url) => {
  const s = new WebSocket(url);
  return {
    send: (d) => s.send(d),
    close: () => s.close(),
    addEventListener: (t, cb) =>
      s.addEventListener(t, (e) => cb({ data: (e as MessageEvent).data })),
  };
};

// ---------------------------------------------------------------------------
// DOM references — guarded lookups (NIT: no unchecked casts)
// ---------------------------------------------------------------------------
function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Required DOM element #${id} not found`);
  return el as T;
}

const input = getElement<HTMLInputElement>("query-input");
const status = getElement<HTMLDivElement>("status");

function setStatus(text: string): void {
  status.textContent = text;
}

async function hidePanel(): Promise<void> {
  await invoke("hide_panel");
}

// ---------------------------------------------------------------------------
// In-flight guard — prevents double-Enter opening a second session (6.5a)
// ---------------------------------------------------------------------------
let inFlight = false;

// ---------------------------------------------------------------------------
// Submit handler — Enter key
// ---------------------------------------------------------------------------
input.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    // Guard: ignore re-submit while a round-trip is in progress (6.5a).
    if (inFlight) return;

    const text = input.value.trim();
    if (!text) return;

    // Immediately show pending indicator and lock against re-submit (6.5a).
    inFlight = true;
    setStatus("…");

    runEcho(text, factory)
      .then(({ sessionId, reason }) => {
        // 6.5b SUCCESS: render result, keep visible briefly (~1200ms) so it's
        // readable, THEN hide and reset.
        setStatus(`session ${sessionId} — ${reason}`);
        setTimeout(() => {
          hidePanel().catch(() => {/* ignore hide errors */});
          input.value = "";
          inFlight = false;
        }, 1200);
      })
      .catch((err: unknown) => {
        // 6.5c FAILURE: render error, do NOT auto-hide — panel stays so the
        // user can see the error. Clear the in-flight latch so they can retry
        // or press Esc to dismiss.
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`error: ${msg}`);
        inFlight = false;
      });
  }

  if (e.key === "Escape") {
    hidePanel().catch(() => {/* ignore hide errors */});
  }
});

// ---------------------------------------------------------------------------
// On window focus (hotkey reveals the window): clear input + re-focus.
// Uses the pure DOM focus event — no Tauri event system needed,
// avoiding the need for core:event:* permissions.
// ---------------------------------------------------------------------------
window.addEventListener("focus", () => {
  if (inFlight) return;        // NIT-2: don't disturb an in-flight round-trip
  input.value = "";
  setStatus("");
  input.focus();
});
