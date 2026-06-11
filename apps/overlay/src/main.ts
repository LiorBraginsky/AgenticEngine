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
import type { ToolCallContext } from "./ws/session-client.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import type { ColorSwatch } from "@agentic/protocol";
import { HideScheduler } from "./lifecycle/hide-scheduler.js";
import { statusForEndReason } from "./lifecycle/session-end-reason.js";
import type { StatusVariant } from "./widgets/status.js";

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

// CM-02: one persistent connection for the overlay's lifetime. Opened on activation.
// CM-03: a voluntary dismiss (EV_TEXT_DISMISS) closes this socket and re-creates a fresh
// manager for the next conversation — hence `let`, reassigned in the dismiss handler.
let connection = new ConnectionManager(factory);
connection.connect();

// ---------------------------------------------------------------------------
// DOM references — guarded lookups (NIT: no unchecked casts)
// ---------------------------------------------------------------------------
function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Required DOM element #${id} not found`);
  return el as T;
}

const input = getElement<HTMLInputElement>("query-input");

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
const EV_SHOW_TEXT = "show-text";       // main → widget : { content } (display-only)
const EV_TEXT_DISMISS = "text-dismiss"; // widget → main : user dismissed the text card
const EV_SHOW_LOADER = "show-loader";   // main → widget : {} — thinking loader (chunk 3)
const EV_SHOW_STATUS = "show-status";   // main → widget : { variant, message } (chunk 3)

// Only one picker is live at a time in v0 (single in-flight session, 6.5a guard).
let activeCtx: ToolCallContext | undefined;
let pickerSettled = false;

// Tracks what the widget last rendered, so the teardown timer hides the
// ephemeral picker confirmation but NEVER the persistent text answer.
// Status modes (loader, error, timeout, cancelled) are set here so the
// persist-content path is not confused with a real text answer.
let lastRenderKind: "picker" | "text" | "loader" | "error" | "timeout" | "cancelled" | undefined;

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
  // Chunk 3: symmetric confirm-then-dismiss for cancel (mirrors picker's confirmation).
  // Show a brief "Cancelled" card in the widget zone, then auto-dismiss after 1200ms.
  lastRenderKind = "cancelled";
  emitTo(WIDGET_LABEL, EV_SHOW_STATUS, { variant: "cancelled" satisfies StatusVariant, message: "Cancelled" }).catch(() => {/* ignore */});
  hideScheduler.scheduleHide(1200, () => { hideWidgetWindow().catch(() => {/* ignore */}); });
});

// Text card dismiss — fired by widget.ts on × click or Escape (when mode=text).
// CM-03: this is the user-visible "dismiss the conversation" affordance. It hides the
// widget AND deliberately closes the persistent socket (=> daemon close(ws) consolidates
// the thread) AND resets currentThreadId so the NEXT summon is a NEW conversation drawing
// on the distilled slice (spec §3.2/§3.3). Voluntary: dismiss() does NOT reconnect.
// A fresh manager is created+connected so the next submit has a live socket.
void listen(EV_TEXT_DISMISS, () => {
  if (lastRenderKind !== "text") return;
  hideWidgetWindow().catch(() => {/* ignore */});
  lastRenderKind = undefined;
  input.value = "";
  // CM-03 dismiss = close + reset (the voluntary side of the drop/dismiss asymmetry).
  try { connection.dismiss(); } catch { /* never throw out of the listener */ }
  currentThreadId = undefined;
  // Re-arm for the next conversation: dismiss() left the manager inactive (no reconnect),
  // so construct a fresh one and open its socket on activation-equivalent. The prior
  // manager is intentionally orphaned — active=false guarantees its trailing close
  // event neither reconnects nor reopens; GC reclaims it once the socket closes.
  connection = new ConnectionManager(factory);
  connection.connect();
});

// ---------------------------------------------------------------------------
// In-flight guard — prevents double-Enter opening a second session (6.5a)
// ---------------------------------------------------------------------------
let inFlight = false;

// ---------------------------------------------------------------------------
// CM-01 (spec §3.3): the durable thread the overlay is continuing. Minted on
// the first submit of a conversation (crypto.randomUUID — same client-mint
// posture as client_session_id; session_ack carries no thread_id so the client
// owns the id and the daemon ADOPTS it). Passed on EVERY subsequent session_start.
//
// CM-03 closed the chunk-01 interim wart: a voluntary dismiss (EV_TEXT_DISMISS
// handler above) resets this to undefined, so the next submit mints a fresh id —
// "new conversation" drawing on the distilled slice. Hide gestures (Escape/blur)
// do NOT reset — re-summon continues the same thread.
// ---------------------------------------------------------------------------
let currentThreadId: string | undefined;

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

    // Lock against re-submit (6.5a). Loader is shown via onSessionStart below.
    inFlight = true;

    // CM-01: mint the thread id once, on the first submit of the app run; reuse
    // it on every continuation turn. (No reset until chunk 03's dismiss.)
    if (currentThreadId === undefined) {
      currentThreadId = crypto.randomUUID();
    }

    connection.runSession(text, {
      threadId: currentThreadId,
      onToolCall,
      onShowText,
      onSessionStart: () => {
        // Chunk 3: show the thinking loader in the widget zone immediately after
        // session_start is sent — before any content arrives.
        // Loader is "until-replaced" (not timed) — it is replaced by the first
        // onToolCall / onShowText / error / cancel, never by a timer.
        lastRenderKind = "loader";
        emitTo(WIDGET_LABEL, EV_SHOW_LOADER, {}).catch(() => {/* ignore */});
        showWidgetWindow().catch(() => {/* ignore */});
      },
    })
      .then((result) => {
        // 6.5b SUCCESS: branch on what the widget rendered.
        // Status is shown in the widget zone (chunk 3) — #status in the main window
        // has been removed (Nit A: vestigial element gone).

        // ── D1 (chunk 4): wire-level error/timeout card ────────────────────
        // The daemon emits session_end{reason:"error"|"timeout"} on provider
        // failures (formatErrorEnd strips detail). runSession resolves (not
        // rejects) for all reason values — the .catch() path only fires on
        // transport-level failures. So D1 lives here, not in .catch().
        // Guard: only intercept when the widget is showing a loader or nothing
        // (if text/picker is already rendered, a race-condition session_end
        // must not override real content).
        const endStatus = statusForEndReason(result.reason);
        if (
          endStatus !== undefined &&
          (lastRenderKind === "loader" || lastRenderKind === undefined)
        ) {
          lastRenderKind = endStatus.variant;
          emitTo(WIDGET_LABEL, EV_SHOW_STATUS, {
            variant: endStatus.variant satisfies StatusVariant,
            message: endStatus.message,
          }).catch(() => {/* ignore */});
          showWidgetWindow().catch(() => {/* ignore */});
          hideScheduler.scheduleHide(endStatus.ms, () => {
            hideWidgetWindow().catch(() => {/* ignore */});
          });
          hidePanel().catch(() => {/* ignore */});
          inFlight = false;
          activeCtx = undefined;
          pickerSettled = false;
          return;
        }

        // ── Fix 2 (review hardening): single-owner cancel dismiss ──────────
        //
        // Exactly THREE paths reach .then():
        //   "text"      — content persists (no hide ever). Release latches only.
        //   "picker"    — ephemeral confirmation. Schedule the 1200ms teardown.
        //   "cancelled" — EV_CANCEL handler ALREADY owns the 1200ms timed dismiss.
        //                 Release latches immediately; do NOT schedule a second hide.
        //   "loader"    — session ended before any content (edge case). Hide immediately.
        //   undefined   — defensive fallback; behave like loader.
        //
        // INVARIANT (content-persist): No timer in this .then() ever auto-hides
        // a text answer. "text" is the ONLY content render kind; no other path
        // may set lastRenderKind to "text" before reaching this branch.

        if (lastRenderKind === "text") {
          // Content persists. Only release the input/session latches.
          // lastRenderKind stays "text" so dismiss handlers (Escape/×/new-request)
          // know a card is live and can hide the widget on demand.
          hidePanel().catch(() => {});
          inFlight = false;
          activeCtx = undefined;
          pickerSettled = false;
        } else if (lastRenderKind === "picker") {
          // Picker confirmation stays ephemeral (~1200ms, ADR-0006 2026-06-01).
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
        } else {
          // "cancelled": EV_CANCEL already scheduled the 1200ms hide — release
          //              latches here so a new request is not blocked, but do NOT
          //              schedule another hide (that would cancel the EV_CANCEL one).
          // "loader" / undefined: session ended before content — hide immediately.
          hidePanel().catch(() => {});
          if (lastRenderKind !== "cancelled") {
            // No cancel card is showing — tear down immediately.
            hideWidgetWindow().catch(() => {/* ignore */});
            lastRenderKind = undefined;
          }
          // For "cancelled": keep lastRenderKind so the EV_CANCEL hide callback
          // can identify what it's dismissing; it clears the window at 1200ms.
          inFlight = false;
          activeCtx = undefined;
          pickerSettled = false;
        }
      })
      .catch((err: unknown) => {
        // 6.5c FAILURE: classify the rejection and show a timed status card in
        // the widget zone (chunk 3 — moves status out of the hidden main window).
        //
        // Handshake-timeout (gotcha #42): discriminated by err.name === "HandshakeTimeoutError"
        // (set in session-client.ts), with a /timed out/i message fallback for safety.
        // Timeout renders a friendly "taking too long" card (~2500ms) — never the raw message.
        // Any other error renders the "error" card with the message (~2000ms).
        //
        // The widget window is already visible (shown on onSessionStart), so we
        // only need to schedule the auto-dismiss — no showWidgetWindow() needed.
        const isTimeout =
          (err instanceof Error && err.name === "HandshakeTimeoutError") ||
          (err instanceof Error && /timed out/i.test(err.message));

        if (isTimeout) {
          lastRenderKind = "timeout";
          emitTo(WIDGET_LABEL, EV_SHOW_STATUS, {
            variant: "timeout" satisfies StatusVariant,
            message: "No response — the model is taking too long. Try again.",
          }).catch(() => {/* ignore */});
          hideScheduler.scheduleHide(2500, () => { hideWidgetWindow().catch(() => {/* ignore */}); });
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          lastRenderKind = "error";
          emitTo(WIDGET_LABEL, EV_SHOW_STATUS, { variant: "error" satisfies StatusVariant, message: msg }).catch(() => {/* ignore */});
          hideScheduler.scheduleHide(2000, () => { hideWidgetWindow().catch(() => {/* ignore */}); });
        }
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
