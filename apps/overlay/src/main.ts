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
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { WebSocketFactory } from "./ws/types.js";
import { runSession } from "./ws/session-client.js";
import type { ToolCallContext } from "./ws/session-client.js";
import type { ColorSwatch } from "@agentic/protocol";

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

// ── Widget window (top-right zone, ADR-0006) ───────────────────────────────
// The widget lives in a separate Tauri window ("widget"). main.ts owns the WS
// session; it relays the picker to the widget over Tauri events and routes the
// user's choice/cancel back to the seam's sendResult/sendCancel.
const WIDGET_LABEL = "widget";
const EV_SHOW = "show-picker";
const EV_RESULT = "picker-result";
const EV_CANCEL = "picker-cancel";

// Only one picker is live at a time in v0 (single in-flight session, 6.5a guard).
let activeCtx: ToolCallContext | undefined;
let pickerSettled = false;

// Widget window dimensions — must match tauri.conf.json width:360.
const WIDGET_WIDTH_LOGICAL = 360;
const WIDGET_Y_LOGICAL = 24;
const WIDGET_MARGIN_RIGHT = 12; // gap from the right edge of the work area
// Fallback x used only when monitor detection fails (rare degraded path).
// Top-left inset is always on-screen; preferable to an off-screen position.
const WIDGET_X_FALLBACK = 24;

/**
 * C2 — runtime right-anchor: compute x so the widget is never off-screen.
 * Uses currentMonitor() to read the work area (excludes macOS menu-bar and
 * Dock) and the scale factor to convert physical→logical pixels.
 * Includes the work-area origin so the anchor is correct on secondary
 * monitors whose virtual x-origin is non-zero.
 * Falls back to WIDGET_X_FALLBACK if the monitor call fails (safety net).
 */
async function computeWidgetX(): Promise<number> {
  try {
    const monitor = await currentMonitor();
    if (monitor === null) return WIDGET_X_FALLBACK;
    const sf = monitor.scaleFactor;
    const workLeft = monitor.workArea.position.x / sf;
    const workWidth = monitor.workArea.size.width / sf;
    return Math.round(workLeft + workWidth - WIDGET_WIDTH_LOGICAL - WIDGET_MARGIN_RIGHT);
  } catch {
    // Defensive: keep the window visible at a best-effort position.
    return WIDGET_X_FALLBACK;
  }
}

async function showWidgetWindow(): Promise<void> {
  const w = await WebviewWindow.getByLabel(WIDGET_LABEL);
  if (w === null) return;
  const x = await computeWidgetX();
  await w.setPosition(new LogicalPosition(x, WIDGET_Y_LOGICAL));
  await w.setAlwaysOnTop(true);
  await w.show();
}

async function hideWidgetWindow(): Promise<void> {
  const w = await WebviewWindow.getByLabel(WIDGET_LABEL);
  if (w === null) return;
  await w.hide();
}

function onToolCall(ctx: ToolCallContext): void {
  activeCtx = ctx;
  pickerSettled = false;
  // Hide the input window so the picker is the only surface (input already
  // hides on submit in main flow; this guards the click-away/Escape-less path).
  hidePanel().catch(() => {/* ignore */});
  emitTo(WIDGET_LABEL, EV_SHOW, { picker: ctx.picker }).catch(() => {/* ignore */});
  showWidgetWindow().catch(() => {/* ignore */});
}

// Cross-window result/cancel — registered once.
void listen<ColorSwatch>(EV_RESULT, (event) => {
  if (activeCtx === undefined || pickerSettled) return;
  pickerSettled = true;
  activeCtx.sendResult(event.payload);
  // C1: do NOT hide the widget here — the confirmation card (rendered in
  // widget.ts onPick before this event arrives) must remain visible during
  // the linger window. hideWidgetWindow() is called in the linger timer below.
});
void listen(EV_CANCEL, () => {
  if (activeCtx === undefined || pickerSettled) return;
  pickerSettled = true;
  activeCtx.sendCancel();
  hideWidgetWindow().catch(() => {/* ignore */});
});

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

    runSession(text, factory, { onToolCall })
      .then(({ sessionId, reason }) => {
        // 6.5b SUCCESS: render result, keep visible briefly (~1200ms) so it's
        // readable, THEN hide and reset.
        setStatus(`session ${sessionId} — ${reason}`);
        setTimeout(() => {
          hidePanel().catch(() => {/* ignore hide errors */});
          hideWidgetWindow().catch(() => {/* ignore */});
          input.value = "";
          inFlight = false;
          activeCtx = undefined;
          pickerSettled = false;
        }, 1200);
      })
      .catch((err: unknown) => {
        // 6.5c FAILURE: render error, do NOT auto-hide — panel stays so the
        // user can see the error. Clear the in-flight latch so they can retry
        // or press Esc to dismiss.
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`error: ${msg}`);
        hideWidgetWindow().catch(() => {/* ignore */});
        inFlight = false;
        activeCtx = undefined;
        pickerSettled = false;
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
