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
import { HideScheduler } from "./lifecycle/hide-scheduler.js";

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
const EV_SHOW_TEXT = "show-text";     // main → widget : { content } (display-only)
const EV_TEXT_DISMISS = "text-dismiss"; // widget → main : user dismissed the text card

// Only one picker is live at a time in v0 (single in-flight session, 6.5a guard).
let activeCtx: ToolCallContext | undefined;
let pickerSettled = false;

// Tracks what the widget last rendered, so the teardown timer hides the
// ephemeral picker confirmation but NEVER the persistent text answer.
let lastRenderKind: "picker" | "text" | undefined;

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
  lastRenderKind = "picker";
  // Hide the input window so the picker is the only surface (input already
  // hides on submit in main flow; this guards the click-away/Escape-less path).
  hidePanel().catch(() => {/* ignore */});
  emitTo(WIDGET_LABEL, EV_SHOW, { picker: ctx.picker }).catch(() => {/* ignore */});
  showWidgetWindow().catch(() => {/* ignore */});
}

/**
 * Display-only handler for show_text replies (C3-2).
 * Mirrors the onToolCall show path (hidePanel + emitTo + showWidgetWindow)
 * minus result/cancel wiring (display-only: no tool_result ever sent).
 * Text answers are CONTENT — they persist until human-dismissed (Escape / new
 * request / ×). The teardown timer is NOT invoked for text (see .then() branch).
 */
function onShowText(content: string): void {
  lastRenderKind = "text";
  hidePanel().catch(() => {/* ignore */});
  emitTo(WIDGET_LABEL, EV_SHOW_TEXT, { content }).catch(() => {/* ignore */});
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

// Text card dismiss — fired by widget.ts on × click or Escape (when mode=text).
// Hides the widget and clears the render kind so no stale state remains.
void listen(EV_TEXT_DISMISS, () => {
  if (lastRenderKind !== "text") return;
  hideWidgetWindow().catch(() => {/* ignore */});
  lastRenderKind = undefined;
  input.value = "";
});

// ---------------------------------------------------------------------------
// In-flight guard — prevents double-Enter opening a second session (6.5a)
// ---------------------------------------------------------------------------
let inFlight = false;

// ---------------------------------------------------------------------------
// Session-scoped hide timer (gotcha #33).
// A monotonic token stamps each submit; the picker-teardown callback checks it
// and no-ops if a newer session has already started. HideScheduler also
// cancels any pending handle on scheduleHide/cancelPending for belt-and-suspenders.
// ---------------------------------------------------------------------------
const hideScheduler = new HideScheduler();
let sessionToken = 0; // monotonic; incremented per submit

// ---------------------------------------------------------------------------
// Submit handler — Enter key
// ---------------------------------------------------------------------------
input.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    // Guard: ignore re-submit while a round-trip is in progress (6.5a).
    if (inFlight) return;

    const text = input.value.trim();
    if (!text) return;

    // A new request replaces any persistent answer (content dismiss-on-new-request).
    if (lastRenderKind !== undefined) {
      hideWidgetWindow().catch(() => {});
      lastRenderKind = undefined;
    }

    // #33: cancel any pending prior-session hide timer and bump the session
    // token so stale in-flight callbacks know they are superseded.
    hideScheduler.cancelPending();
    sessionToken += 1;

    // Immediately show pending indicator and lock against re-submit (6.5a).
    inFlight = true;
    setStatus("…");

    runSession(text, factory, { onToolCall, onShowText })
      .then(({ sessionId, reason }) => {
        // 6.5b SUCCESS: branch on what the widget rendered.
        setStatus(`session ${sessionId} — ${reason}`);
        // Picker confirmation stays ephemeral (~1200ms, ADR-0006 2026-06-01).
        // Text answer is CONTENT — it persists until the user dismisses it
        // (Escape / new request / ×). Do NOT hide the widget for text.
        if (lastRenderKind === "text") {
          // Content persists. Only release the input/session latches.
          hidePanel().catch(() => {});
          inFlight = false;
          activeCtx = undefined;
          pickerSettled = false;
          // lastRenderKind stays "text" so dismiss handlers know a card is live.
        } else {
          // #33: capture the token at schedule time; the callback is a no-op if a
          // newer session started before the 1200ms elapsed (belt-and-suspenders
          // alongside HideScheduler's own cancelPending).
          const myToken = sessionToken;
          hideScheduler.scheduleHide(1200, () => {
            if (myToken !== sessionToken) return; // superseded — abort
            hidePanel().catch(() => {/* ignore hide errors */});
            hideWidgetWindow().catch(() => {/* ignore */});
            input.value = "";
            inFlight = false;
            activeCtx = undefined;
            pickerSettled = false;
            lastRenderKind = undefined;
          });
        }
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
//
// #34 clear-on-open — two-part coverage:
//   (a) This focus handler clears input.value when not in-flight (primary path).
//   (b) #33 fix (hideScheduler + sessionToken) eliminates the stale-timer re-show
//       path that could have bypassed this guard — a cancelled timer never fires,
//       so there is no re-show event that would skip the clear. Together they make
//       #34 robust: the input is always empty when the user sees the panel again.
//   NOTE: No idle-timer clear — clearing on open is the only trigger (OUT per spec).
// ---------------------------------------------------------------------------
window.addEventListener("focus", () => {
  if (inFlight) return;        // NIT-2: don't disturb an in-flight round-trip
  input.value = "";
  setStatus("");
  input.focus();
});

// ---------------------------------------------------------------------------
// Blur-dismiss for the `main` input window (deferred input_blur_dismiss
// follow-up, chunk 2 Task 2.4). The main window is a normal focusable window;
// losing focus / click-outside hides it. Pure-DOM — no lib.rs change needed
// (the symmetric `focus` listener above already proves DOM events work here).
// This is for the INPUT window ONLY — the click-through `widget` window is NOT
// dismissed on outside clicks (ADR-0006 2026-05-31).
// Guarded by inFlight so a widget interaction mid-round-trip does not tear down
// the session (the widget window is focus:false per tauri.conf.json so normal
// usage will not trigger blur; the guard is defense-in-depth).
// ---------------------------------------------------------------------------
window.addEventListener("blur", () => {
  if (inFlight) return;
  hidePanel().catch(() => {/* ignore */});
});
