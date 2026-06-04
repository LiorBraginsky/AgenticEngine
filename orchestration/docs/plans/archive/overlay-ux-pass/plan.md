> 🗄️ ARCHIVED 2026-06-03 — shipped. Historical record; do not edit.

# Overlay UX Pass — Combined Implementation Plan (Chunks 01 → 02 → 03)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LLM text answer persist and be human-dismissed; make the input-window timer/clear lifecycle session-safe; and give transient status (thinking / error / cancelled) a dedicated zone on a timer — all frontend-only in `apps/overlay`, shipped as one PR.

**Architecture:** The `widget` window (ADR-0006's top-right zone) gains an explicit render *mode* — `loader` | `text` | `picker` | `status` | `confirmation`. main.ts drives the mode from session-lifecycle callbacks. A single renderer-level `dismiss-policy` helper encodes the rule-of-three: content persists (human-dismiss), status is timed, picker-confirm is auto. No wire change; `packages/protocol` and the daemon are untouched.

**Tech Stack:** TypeScript on Bun, Tauri v2 (two windows), `bun test` + happy-dom, `jest.useFakeTimers()` for time-dependent paths.

---

## Status

shipped

---

## Reality check

Architect read the actual overlay source on `main` (== this branch for `apps/overlay`). Verified facts below; every chunk-file assumption that could be falsified is called out with `file:line`.

### What the chunk files got WRONG (overrides)

1. **Chunk 01 mislocates the timer.** Chunk 01 (`01-...md:12`, `:36`) and the code comment at `apps/overlay/src/widgets/text-reply.ts:11` both claim a "~1200ms auto-dismiss linger" lives in/around the text-reply renderer. **Falsified:** `apps/overlay/src/widgets/text-reply.ts` is pure DOM with **no timer at all** (verified, 24 lines, `renderTextReply` only does `replaceChildren` + build + append). The actual auto-dismiss is in `apps/overlay/src/main.ts:177-184` — a `setTimeout(..., 1200)` inside the `runSession().then()` SUCCESS branch that calls `hidePanel()` + `hideWidgetWindow()` + resets `inFlight`. This single timer fires for **every** completed session — both picker and text. So Chunk 1's fix is NOT "remove a text-specific linger in text-reply.ts" (none exists); it is "make the success-branch teardown in main.ts not hide the widget when the rendered content was a text answer, while keeping the 1200ms hide for the picker confirmation." The felt bug (text vanishes) is real; the location and mechanism in the chunk file are a hypothesis the code overrides.

2. **Chunk 01 / `text-reply.ts:11` claim "no new timer added (gotcha #33/#34 guard)" for `onShowText`.** True today — `onShowText` (`main.ts:130-134`) adds no timer; it relies on the shared success-branch timer. This confirms (1): the text path is dismissed by the *generic* success timer, not its own.

3. **The "status under the input / written to hidden main window" framing (Chunk 03 line 12) is accurate but needs precision.** Status is written via `setStatus()` (`main.ts:46-48`) to `#status` (`index.html:19`), a child of `#panel` in the **`main`** window. On the success path `main.ts:176` writes `session … — reason` there, but `main` is already hidden by `onToolCall`→`hidePanel()` (`main.ts:118`) or by the input's own submit flow — so the user never sees it. Chunk 03's premise holds.

4. **Chunk 02 says `lib.rs` may be needed for blur.** **Likely NOT needed.** `main.ts:209` already uses the pure-DOM `window` `focus` event deliberately "to avoid `core:event:*` permissions" (comment `main.ts:206-208`). The symmetric `blur` is also pure-DOM and needs no new Tauri permission and no `lib.rs` change; `hide_panel` already exists (`lib.rs:10-13`) and is in capabilities (`default.json:11`). Keep `lib.rs` strictly out of scope unless a runtime demo shows DOM `blur` does not fire for the WKWebView window (requires runtime demo to confirm).

### What the chunk files got RIGHT (verified)

5. **#34 clear-on-open is already half-done.** `main.ts:209-214` clears `input.value = ""` + `setStatus("")` on the DOM `focus` event when not `inFlight`. The gap: the `inFlight` guard (`main.ts:210`) means a stale-timer-driven re-show during an in-flight state would NOT clear — exactly the #34/#33 coupling the gotcha warns about. So #34 is *partially* present; chunk 2 must make it robust against the #33 timer, not write it from scratch.

6. **#33 timer is genuinely unscoped.** The `setTimeout` at `main.ts:177` captures no session id and is never stored in a cancellable handle. A second submit while a prior timer is pending will let the prior timer fire against the new session. Verified by inspection. (Behavioral repro #33 — requires runtime demo to confirm.)

7. **Two-window model is real and pinned.** `tauri.conf.json:13-41` declares exactly two windows: `main` (centered, `visible:false`, `focus` default) and `widget` (`x:1500`, `focus:false`, `visible:false`, `width:360`, `height:200`). `widget.html` hosts `#widget-host` + `widget.ts`. `computeWidgetX()` (`main.ts:84-96`) runtime right-anchors per ADR-0006 2026-06-01. Status-zone Option A (reuse `widget`) is the ADR-aligned choice (see below).

8. **`runSession` owns the in-flight transition.** `session-client.ts:159-161` sends `session_start` on `open`; the first `tool_call` (`:190`) routes to `onToolCall` or `onShowText`. There is **no** `onSessionStart` callback yet — chunk 3 adds one. No wire change involved.

9. **Fake-timer harness already exists.** `session-client.test.ts:319-405` uses `jest.useFakeTimers()` / `advanceTimersByTime` for the handshake-timer regressions — chunk 2 and 3 timer tests follow this exact pattern (the 02b-ii lesson is already internalized in this file).

10. **Widget window is `height:200` fixed** (`tauri.conf.json:36`) and does not resize to content — gotcha #44, accepted-as-PASS, explicitly deferred. The loader/status/text all render inside this fixed box. Not in scope; noted so no worker "fixes" it.

### Behavioral DoD note (PIPELINE §6.1)

Every `[behavioral]` DoD line in all three chunks (text persists & is readable; #33/#34 repros gone; blur hides input; loader→answer visible; error/cancelled in the zone) **requires a live macOS demo to confirm** and must NOT be marked "verified" from code-reading or green tests. The mechanical DoD lines (diff scope, typecheck, lint:strict, fake-timer tests green) are verifiable in CI.

---

## Combined ADR-0006 amendment (draft)

> For adr-curator to record as a new dated amendment **on ADR-0006** (no new ADR number). Append after the 2026-06-01 amendment, as a top-level `## Amendment 2026-06-03` section (match house style).

### Amendment 2026-06-03

**This is NOT a supersede; it is a REFINEMENT.** It refines *how the top-right `widget` zone (Decision p.2) manages the lifecycle of what it renders*, introducing an explicit **content-vs-transient dismiss policy**. It **does not** touch the activation hotkeys (2026-05-30), the two-window realization (2026-05-31), or the ephemeral picker confirmation (2026-06-01) — the picker confirmation **stays ephemeral (~1200ms auto-dismiss)**, exactly as the 2026-06-01 amendment requires. This amendment restores Decision p.2's original "slightly persistent" intent for the one surface that is *content the user reads*: the LLM text answer.

Surfaced by Lior post-llm-text-slice (overlay-ux-pass, 2026-06-03): the `show_text` answer was being auto-hidden by the same ~1200ms timer that dismisses the picker confirmation (`apps/overlay/src/main.ts` success branch), so multi-sentence replies vanished before they could be read.

1. **Dismiss policy — the rule of three.** The `widget` zone classifies everything it renders into exactly three dismiss behaviors, made explicit in the renderer:
   - **`content`** (the LLM `show_text` answer) — **persists until the user dismisses it.** Dismissals: **Escape**, **a new request** (next `session_start` / hotkey-submit replaces it), and an **on-card `×`** (consistent with the labeled cancel control the 2026-06-01 amendment requires). **No timer ever auto-hides content.**
   - **`status`** (thinking loader, error, cancelled) — **timed auto-dismiss.** The thinking loader is replaced when content/picker arrives; error lingers ~2s then auto-dismisses; cancelled shows a brief card. Status never auto-hides content that is still on screen.
   - **`picker-confirm`** (the `✓ Name #HEX` confirmation) — **auto-dismisses ~1200ms**, unchanged from the 2026-06-01 amendment.

2. **Dedicated status surface = a render *mode* of the existing `widget` window, NOT a third window.** ADR-0006 (2026-05-31) settled on **two windows** and rejected both "single large window" (Option A) and "resize `main` per render" (Option C). This amendment keeps two windows: the `widget` window renders one mode at a time (`loader` | `text` | `picker` | `status` | `confirmation`). Status moves **out from under the input** (where it was invisible — written to the already-hidden `main` window) into this zone. Adding a third dedicated status window was considered and **rejected** to preserve the two-window model and avoid a new window's positioning/focus/click-through/capabilities cost; loader→content→status are sequential within a single session and never need to coexist (a new session dismisses the prior answer first), so one window with modes suffices.

3. **The thinking loader is frontend-only.** The overlay infers "in-flight" from "`session_start` sent, no `tool_call` yet" — observed via a new frontend `onSessionStart` callback on `runSession`. **No wire/progress signal, no protocol change.** Rendering the model's partial output while it thinks (streaming) is explicitly deferred (needs a daemon/wire progress signal — gotchas #1/#43).

4. **Scope boundary — overlay-only, frozen surfaces untouched.** Nothing here changes `packages/protocol` (the 6-variant envelope) or the daemon. This per-session transient overlay status zone is **distinct from** the global daemon tray/menubar status indicator (Decision p.4, running/idle/error) — complementary surfaces, not the same; the tray remains deferred.

---

## ADR worthy: yes

Record the **Amendment 2026-06-03** above on `orchestration/docs/adr/0006-dual-hotkey-2zone-ux.md`. No new ADR number — it amends 0006.

## ADR: orchestration/docs/adr/0006-dual-hotkey-2zone-ux.md — **Amendment 2026-06-03 recorded** (content-persist + dedicated status zone Option A + rule-of-three dismiss-policy; refines, does not supersede, 2026-06-01)

---

## Steps

Branch: `chunks/overlay-ux-pass` (one branch, three focused commits — one per chunk). Per-chunk commit boundaries are marked. All steps touch only `apps/overlay`.

Worker note: run `bun test`, `bun run typecheck`, and `bun run lint:strict` from the overlay workspace at each "verify" step. If `lint:strict` exists, use it (per global verification rule).

### Chunk 1 — Persistent, readable text answer

Satisfies DoD 01: text persists (line 27), Escape/new-request/× dismiss (line 28), picker confirmation unchanged (line 29), diff only in overlay (line 30), typecheck+lint+tests green (line 31).

**Design for this chunk:** Branch the `main.ts` success-branch teardown on *what was rendered*. Track a module-level `lastRenderKind: "picker" | "text" | undefined`. The 1200ms timer's body must hide the widget ONLY when `lastRenderKind === "picker"`. When `lastRenderKind === "text"`, the widget stays; only `inFlight`/`activeCtx` reset. Add Escape + × dismissals that explicitly hide the widget and clear `lastRenderKind`. A new submit clears the prior text widget before starting.

#### Task 1.1: Make the text answer persist (don't hide the widget on text completion)

**Files:**
- Modify: `apps/overlay/src/main.ts` (success branch `:172-185`; `onToolCall` `:113-121`; `onShowText` `:130-134`)

- [ ] **Step 1 — Add a render-kind tracker.** Near `activeCtx`/`pickerSettled` (`main.ts:65-66`), add:
  ```ts
  // Tracks what the widget last rendered, so the teardown timer hides the
  // ephemeral picker confirmation but NEVER the persistent text answer.
  let lastRenderKind: "picker" | "text" | undefined;
  ```
  Set `lastRenderKind = "picker"` inside `onToolCall` (`main.ts:113`) and `lastRenderKind = "text"` inside `onShowText` (`main.ts:130`).

- [ ] **Step 2 — Branch the success-branch teardown.** Replace the unconditional `setTimeout(..., 1200)` body in the `.then()` success branch (`main.ts:177-184`) so it only hides the widget for the picker:
  ```ts
  .then(() => {
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
      setTimeout(() => {
        hidePanel().catch(() => {});
        hideWidgetWindow().catch(() => {});
        input.value = "";
        inFlight = false;
        activeCtx = undefined;
        pickerSettled = false;
        lastRenderKind = undefined;
      }, 1200);
    }
  })
  ```
  Note: the `sessionId`/`reason` status write (`main.ts:176`) is left as-is for now (chunk 3 reworks status).

- [ ] **Step 3 — New request dismisses the old answer.** At the top of the Enter handler, after the `inFlight` guard passes and before `runSession` (`main.ts:165-172`), clear any live widget content:
  ```ts
  // A new request replaces any persistent answer (content dismiss-on-new-request).
  if (lastRenderKind !== undefined) {
    hideWidgetWindow().catch(() => {});
    lastRenderKind = undefined;
  }
  ```

- [ ] **Step 4 — Verify typecheck + existing tests.** Run overlay `typecheck` and `bun test`. Expected: PASS (no behavioral test yet; renderer tests unaffected).

#### Task 1.2: Add the on-card `×` and Escape dismiss for the text widget

**Files:**
- Modify: `apps/overlay/src/widgets/text-reply.ts` (add an optional `onDismiss` callback + `×` affordance)
- Modify: `apps/overlay/src/widgets/text-reply.test.ts` (assert the `×` renders and fires `onDismiss`)
- Modify: `apps/overlay/src/widget.css` (style the text-card `×`, reusing `.cp-close` chrome)
- Modify: `apps/overlay/src/widget.ts` (wire the dismiss to a new `text-dismiss` intra-app event)
- Modify: `apps/overlay/src/main.ts` (listen for `text-dismiss`, hide widget + clear `lastRenderKind`)

- [ ] **Step 1 — Failing test for the `×`.** Add to `text-reply.test.ts`:
  ```ts
  test("renderTextReply renders a dismiss control that fires onDismiss when clicked", () => {
    const host = makeHost();
    let dismissed = false;
    renderTextReply(host, "hello", () => { dismissed = true; });
    const close = host.querySelector<HTMLButtonElement>(".cp-close");
    expect(close).not.toBeNull();
    close!.click();
    expect(dismissed).toBe(true);
  });
  ```

- [ ] **Step 2 — Run it, expect FAIL** (`renderTextReply` takes 2 args; no `.cp-close`). Run: overlay `bun test text-reply`. Expected: FAIL.

- [ ] **Step 3 — Implement the `×`.** Change `renderTextReply` signature to `(host, content, onDismiss?: () => void)`. When `onDismiss` is provided, prepend a `button.cp-close` labelled **`× Close`** (display-only content is *closed*, not *cancelled* — deliberately distinct from the picker's `× Cancel`; same labeled-control style as ADR-0006 2026-06-01) before the content `div`; on click call `onDismiss()`. Keep `textContent` (never innerHTML). Existing 2-arg test calls still pass (`onDismiss` optional).

- [ ] **Step 4 — Run tests, expect PASS.** Run: overlay `bun test text-reply`. Expected: PASS (new + existing green).

- [ ] **Step 5 — CSS.** In `widget.css`, ensure `.text-reply-card` has room for the absolute-positioned `.cp-close` (the `.cp-close` rule already exists `widget.css:27-46`; `.text-reply-card` `:83-85` already has padding — add `position: relative;` to `.text-reply-card` if not inherited, and bump top padding so text clears the button).

- [ ] **Step 6 — Wire `×` and Escape in widget.ts → main.ts.** In `widget.ts`, in the `EV_SHOW_TEXT` listener (`widget.ts:38-40`), pass `() => emit("text-dismiss")` as the 3rd arg; add `document.body.focus()` so Escape keydown is received (mirrors the picker path `widget.ts:23`); extend the existing document `keydown` Escape listener (`widget.ts:48-52`) to also `emit("text-dismiss")` (gated on current mode — see Chunk 3 Task 3.2 Step 10; idempotent — main.ts guards on `lastRenderKind`). In `main.ts`, register once:
  ```ts
  const EV_TEXT_DISMISS = "text-dismiss";
  void listen(EV_TEXT_DISMISS, () => {
    if (lastRenderKind !== "text") return;
    hideWidgetWindow().catch(() => {});
    lastRenderKind = undefined;
    input.value = "";
  });
  ```

- [ ] **Step 7 — Verify.** Run overlay `typecheck`, `bun test`, `lint:strict`. Expected: all PASS.

- [ ] **Step 8 — Commit (Chunk 1 boundary).**
  ```bash
  git add apps/overlay
  git commit -m "feat(overlay): persist LLM text answer; Escape/new-request/× dismiss (chunk 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

> Chunk 1 behavioral DoD (text stays & is readable; picker still ~1200ms) — requires live macOS demo to confirm before closeout.

---

### Chunk 2 — Input lifecycle hygiene (session-scoped timers + clear-on-open + blur-dismiss)

Satisfies DoD 02: #33 gone (line 24), #34 gone (line 25), blur hides input (line 26), fake-timer regression test (line 27), diff only in overlay + lint/typecheck/tests green (line 28). **Hard prerequisite for chunk 3.**

**Design for this chunk:** The session-unscoped hide timer is the `setTimeout` in `main.ts`'s picker teardown (after chunk 1, still present in the `else` branch of Task 1.1 Step 2). Introduce a monotonic **session token** and a single cancellable **pending-hide handle** so a new submit cancels a prior session's pending hide before it can fire. Compose with #34 by clearing the input on the *new-submit* path (deterministic), not only on the DOM `focus` event (which the `inFlight` guard can skip).

#### Task 2.1: Session-scope the hide timer (gotcha #33)

**Files:**
- Modify: `apps/overlay/src/main.ts` (the picker teardown timer; new submit path)

- [ ] **Step 1 — Add a cancellable hide handle + session token.** Near `inFlight` (`main.ts:155`):
  ```ts
  // #33: the picker-teardown hide timer must be cancellable so a stale prior-
  // session timer can never hide a freshly-reopened input/widget.
  let sessionToken = 0; // monotonic; increments per submit
  ```
  (The cancellable handle is provided by the `HideScheduler` extracted in Task 2.2.)

- [ ] **Step 2 — Tag and store the picker-teardown timer.** In the `else` branch from Task 1.1 Step 2, capture the token at schedule time and no-op if a newer session has started (belt-and-suspenders alongside the scheduler):
  ```ts
  const myToken = sessionToken;
  hideScheduler.scheduleHide(1200, () => {
    if (myToken !== sessionToken) return; // a newer session superseded us — abort
    hidePanel().catch(() => {});
    hideWidgetWindow().catch(() => {});
    input.value = "";
    inFlight = false;
    activeCtx = undefined;
    pickerSettled = false;
    lastRenderKind = undefined;
  });
  ```

- [ ] **Step 3 — New submit cancels pending hide + bumps token.** At the start of the Enter handler (right after the `inFlight` guard, alongside Task 1.1 Step 3's clear-old-answer block):
  ```ts
  hideScheduler.cancelPending();
  sessionToken += 1;
  ```

- [ ] **Step 4 — Verify typecheck.** Run overlay `typecheck`. Expected: PASS.

#### Task 2.2: Extract the timer logic into a testable, fake-timer-covered unit

The timer lives in `main.ts` (DOM-coupled). Per the 02b-ii lesson, a synchronous humble-object test would miss the bug. Extract the *cancellation policy* into a pure helper so a `jest.useFakeTimers()` test can prove it.

**Files:**
- Create: `apps/overlay/src/lifecycle/hide-scheduler.ts` (pure, DOM-free)
- Create: `apps/overlay/src/lifecycle/hide-scheduler.test.ts` (fake-timer test)
- Modify: `apps/overlay/src/main.ts` (use the helper instead of inline timer bookkeeping)

- [ ] **Step 1 — Failing fake-timer test.** Create `hide-scheduler.test.ts`:
  ```ts
  import { test, expect, jest } from "bun:test";
  import { HideScheduler } from "./hide-scheduler.js";

  test("a pending hide does NOT fire after a new session supersedes it", () => {
    jest.useFakeTimers();
    try {
      const fired: string[] = [];
      const s = new HideScheduler();
      s.scheduleHide(1200, () => fired.push("session-A"));
      s.cancelPending();                       // a new session starts
      s.scheduleHide(1200, () => fired.push("session-B"));
      jest.advanceTimersByTime(1200);
      expect(fired).toEqual(["session-B"]);    // A's hide was cancelled
    } finally {
      jest.useRealTimers();
    }
  });

  test("cancelPending before the timer elapses fires nothing", () => {
    jest.useFakeTimers();
    try {
      let fired = false;
      const s = new HideScheduler();
      s.scheduleHide(1200, () => { fired = true; });
      s.cancelPending();
      jest.advanceTimersByTime(5000);
      expect(fired).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  ```

- [ ] **Step 2 — Run it, expect FAIL** (`HideScheduler` not defined). Run: overlay `bun test hide-scheduler`. Expected: FAIL.

- [ ] **Step 3 — Implement `HideScheduler`.** Create `hide-scheduler.ts`:
  ```ts
  /**
   * Session-scoped hide-timer policy (gotcha #33). At most one pending hide
   * exists; scheduling a new one (or cancelling) guarantees a stale prior-
   * session timer can never fire against a fresh session. DOM-free + testable.
   */
  export class HideScheduler {
    private handle: ReturnType<typeof setTimeout> | undefined;
    scheduleHide(ms: number, onHide: () => void): void {
      this.cancelPending();
      this.handle = setTimeout(() => { this.handle = undefined; onHide(); }, ms);
    }
    cancelPending(): void {
      if (this.handle !== undefined) { clearTimeout(this.handle); this.handle = undefined; }
    }
  }
  ```

- [ ] **Step 4 — Run tests, expect PASS.** Run: overlay `bun test hide-scheduler`. Expected: PASS.

- [ ] **Step 5 — Use it in main.ts.** Add a single `const hideScheduler = new HideScheduler();` near the lifecycle state. The picker teardown uses `hideScheduler.scheduleHide(1200, ...)`; the new-submit cancel uses `hideScheduler.cancelPending();`. Keep the `sessionToken` guard inside the callback as belt-and-suspenders. Run overlay `typecheck` — expect PASS.

#### Task 2.3: Clear input on open (gotcha #34) — robust against #33

**Files:**
- Modify: `apps/overlay/src/main.ts` (new-submit path + focus handler)

- [ ] **Step 1 — Document + harden the clear path.** The `window` `focus` handler (`main.ts:209-214`) clears `input.value` when not `inFlight`. With #33 now fixed (Task 2.1/2.2), the stale-timer re-show path that would have bypassed the clear is gone. Add a comment documenting that #34 is covered by (a) focus-clear when not in-flight and (b) #33 cancellation removing the stale re-show path. No timer-based clear (idle-clear is OUT, chunk-02 line 19).

- [ ] **Step 2 — Verify.** Run overlay `typecheck` + `bun test`. Expected: PASS.

> #33 / #34 behavioral repros gone — requires live macOS demo to confirm (DoD 02 lines 24-25).

#### Task 2.4: Blur-dismiss for the `main` input window

**Files:**
- Modify: `apps/overlay/src/main.ts` (add a DOM `blur` listener)

- [ ] **Step 1 — Add blur-to-hide.** After the `window` `focus` listener (`main.ts:209-214`):
  ```ts
  // Blur-dismiss for the `main` input window (the deferred input_blur_dismiss
  // follow-up). main is a normal focusable window; losing focus / click-outside
  // hides it. This is the INPUT window only — the click-through `widget` window
  // is NOT dismissed on outside clicks (ADR-0006 2026-05-31). Guarded so an
  // in-flight round-trip is not torn down by the widget window taking attention.
  window.addEventListener("blur", () => {
    if (inFlight) return;
    hidePanel().catch(() => {/* ignore */});
  });
  ```
  Rationale (verified): no `lib.rs` change and no new permission needed — the focus path already proves pure-DOM window events work here (`main.ts:206-208`). The `widget` window is `focus:false` (`tauri.conf.json:38`) so showing it does not blur `main` mid-flow; the `inFlight` guard is defense-in-depth.

- [ ] **Step 2 — Verify.** Run overlay `typecheck`, `bun test`, `lint:strict`. Expected: all PASS.

- [ ] **Step 3 — Commit (Chunk 2 boundary).**
  ```bash
  git add apps/overlay
  git commit -m "fix(overlay): session-scope hide timer (#33) + clear-on-open (#34) + blur-dismiss input (chunk 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

> Blur hides input (DoD 02 line 26) — requires live macOS demo to confirm. If DOM `blur` does not fire for the WKWebView `main` window on macOS (verify in the demo), the fallback is a Rust window-focus event in `lib.rs` (`on_window_event` → `WindowEvent::Focused(false)` → hide) — flag to Lior before adding, as it touches `lib.rs` (Open Question Q3).

---

### Chunk 3 — Dedicated status zone + thinking loader + timed error/cancelled

Satisfies DoD 03: loader→answer visible (line 27), error/cancelled in dedicated zone, error ~2s, cancelled card (line 28), content still persists (line 29), explicit dismiss-policy + fake-timer test (line 30), diff only in overlay + lint/typecheck/tests green (line 31).

**Design for this chunk:**
- **In-flight detection:** add `onSessionStart?: () => void` to `RunSessionOptions`; `runSession` fires it right after `ws.send(session_start)` in the `open` handler. main.ts shows the loader on `onSessionStart`; the first `onToolCall`/`onShowText` replaces it; the error/cancel paths replace it with a status card.
- **Status realization:** Option A — reuse the `widget` window with a status render mode (justified in the amendment; respects the two-window click-through model; rejects a third window).
- **Dismiss-policy helper:** a tiny renderer-level helper that encodes the rule-of-three by render mode. Not a speculative type — a concrete switch over the modes that already exist.

#### Task 3.1: Frontend-only in-flight signal (`onSessionStart`)

**Files:**
- Modify: `apps/overlay/src/ws/session-client.ts` (add `onSessionStart` to `RunSessionOptions`; fire after send)
- Modify: `apps/overlay/src/ws/session-client.test.ts` (assert `onSessionStart` fires once, before any content)

- [ ] **Step 1 — Failing test.** Add to `session-client.test.ts`:
  ```ts
  test("runSession fires onSessionStart once, immediately after session_start is sent (before any content)", async () => {
    const fake = makeFake();
    const order: string[] = [];
    const p = runSession("hi", () => fake.ws, {
      onSessionStart: () => order.push("start"),
      onShowText: () => order.push("text"),
    });
    fake.fire("open", {});
    expect(order).toEqual(["start"]); // fired right after send, no content yet
    const cid = (JSON.parse(fake.sent[0]!) as { client_session_id: string }).client_session_id;
    fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: cid }) });
    fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "s", call_id: "c", payload: { tool: "show_text", args: { text: { content: "hello" } } } }) });
    fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s", reason: "completed" }) });
    await p;
    expect(order).toEqual(["start", "text"]);
  });
  ```
  (Adapt the exact envelope shapes to the existing `session-client.test.ts` helpers — the test must match the real fixtures in that file.)

- [ ] **Step 2 — Run it, expect FAIL** (`onSessionStart` unknown). Run: overlay `bun test session-client`. Expected: FAIL.

- [ ] **Step 3 — Implement.** In `session-client.ts`: add `onSessionStart?: () => void;` to `RunSessionOptions` (doc comment: "Fired right after session_start is sent — frontend-only in-flight signal for the thinking loader; NOT a wire event"). In the `open` handler (`:159-161`), after `ws.send(JSON.stringify(msg))`, call `options.onSessionStart?.();`.

- [ ] **Step 4 — Run tests, expect PASS.** Run: overlay `bun test session-client`. Expected: PASS (new + existing green).

#### Task 3.2: Render modes + dismiss-policy helper

**Files:**
- Create: `apps/overlay/src/widgets/status.ts` (renders loader / error / cancelled cards into the host)
- Create: `apps/overlay/src/widgets/status.test.ts` (DOM-harness assertions)
- Create: `apps/overlay/src/widgets/dismiss-policy.ts` (the rule-of-three helper)
- Create: `apps/overlay/src/widgets/dismiss-policy.test.ts`
- Modify: `apps/overlay/src/widget.ts` (handle new `show-status` / `show-loader` events; track current mode; gate Escape)
- Modify: `apps/overlay/src/widget.css` (loader spinner + status card styles)

- [ ] **Step 1 — Failing test for the dismiss-policy helper.** Create `dismiss-policy.test.ts`:
  ```ts
  import { test, expect } from "bun:test";
  import { dismissPolicy } from "./dismiss-policy.js";

  test("content persists (no timer)", () => {
    expect(dismissPolicy("text")).toEqual({ kind: "persist" });
  });
  test("status is timed (~2s error, ~2.5s timeout, ~1200ms cancelled, loader until replaced)", () => {
    expect(dismissPolicy("error")).toEqual({ kind: "timed", ms: 2000 });
    expect(dismissPolicy("timeout")).toEqual({ kind: "timed", ms: 2500 });
    expect(dismissPolicy("cancelled")).toEqual({ kind: "timed", ms: 1200 });
    expect(dismissPolicy("loader")).toEqual({ kind: "until-replaced" });
  });
  test("picker confirmation auto-dismisses ~1200ms", () => {
    expect(dismissPolicy("confirmation")).toEqual({ kind: "timed", ms: 1200 });
  });
  ```

- [ ] **Step 2 — Run it, expect FAIL.** Run: overlay `bun test dismiss-policy`. Expected: FAIL.

- [ ] **Step 3 — Implement `dismiss-policy.ts`.**
  ```ts
  /** Rule-of-three dismiss policy (ADR-0006 Amendment 2026-06-03). */
  export type RenderMode = "text" | "loader" | "error" | "timeout" | "cancelled" | "confirmation" | "picker";
  export type Dismiss =
    | { kind: "persist" }          // content: human-dismissed only (Escape/new-request/×)
    | { kind: "until-replaced" }   // loader: replaced when content arrives
    | { kind: "timed"; ms: number };
  export function dismissPolicy(mode: RenderMode): Dismiss {
    switch (mode) {
      case "text": return { kind: "persist" };
      case "picker": return { kind: "persist" }; // user-driven; settles via pick/cancel
      case "loader": return { kind: "until-replaced" };
      case "error": return { kind: "timed", ms: 2000 };
      case "timeout": return { kind: "timed", ms: 2500 }; // longer — friendly "taking too long" copy needs reading time
      case "cancelled": return { kind: "timed", ms: 1200 };
      case "confirmation": return { kind: "timed", ms: 1200 };
    }
  }
  ```

- [ ] **Step 4 — Run tests, expect PASS.** Run: overlay `bun test dismiss-policy`. Expected: PASS.

- [ ] **Step 5 — Failing test for status renderer.** Create `status.test.ts` asserting `renderLoader(host)` produces `.status-loader`, `renderStatus(host, "error", "boom")` produces `.status-card.status-error` with `textContent` containing `boom`, `renderStatus(host, "timeout", ...)` produces `.status-timeout`, and `renderStatus(host, "cancelled", ...)` produces `.status-cancelled`. (Follow the `text-reply.test.ts` `makeHost()` pattern.)

- [ ] **Step 6 — Run it, expect FAIL.** Run: overlay `bun test status`. Expected: FAIL.

- [ ] **Step 7 — Implement `status.ts`.** Export `renderLoader(host)` (replaceChildren → a `.color-picker-widget .status-loader` card with a spinner element) and `renderStatus(host, variant: "error" | "timeout" | "cancelled", message: string)` (replaceChildren → `.color-picker-widget .status-card .status-<variant>` with `textContent = message`, never innerHTML). DOM-only, no Tauri/WS.

- [ ] **Step 8 — Run tests, expect PASS.** Run: overlay `bun test status`. Expected: PASS.

- [ ] **Step 9 — CSS.** In `widget.css`, add `.status-loader` (a CSS `@keyframes spin` spinner) and `.status-card` / `.status-error` / `.status-cancelled` styles, reusing the dark `.color-picker-widget` chrome already present.

- [ ] **Step 10 — Wire widget.ts events + gate Escape by mode.** Add intra-app events `EV_SHOW_LOADER = "show-loader"`, `EV_SHOW_STATUS = "show-status"` (payload `{ variant: "error" | "cancelled"; message: string }`). Add `listen` handlers calling `renderLoader(host)` / `renderStatus(...)`. Track a `currentMode` module var set by each listener. The `text-dismiss` Escape handler (Chunk 1) must only `emit("text-dismiss")` when `currentMode === "text"` (status is timed, not human-dismissed).

- [ ] **Step 11 — Verify.** Run overlay `typecheck` + `bun test`. Expected: PASS.

#### Task 3.3: Drive the loader and timed status from main.ts

**Files:**
- Modify: `apps/overlay/src/main.ts` (loader on `onSessionStart`; timed status on error/cancel; stop writing status to `#status`)
- Create: `apps/overlay/src/lifecycle/status-timer.test.ts` (fake-timer error-auto-dismiss + session-scoped cancel)

- [ ] **Step 1 — Show loader on session start.** Pass `onSessionStart` into the `runSession` call (`main.ts:172`). Handler: set `lastRenderKind`/mode to `loader`, `emitTo(WIDGET_LABEL, "show-loader", {})`, `showWidgetWindow()`. The first `onToolCall`/`onShowText` shows real content and replaces the loader (the widget host `replaceChildren`s). Remove the now-redundant `setStatus("…")` under the input (the loader replaces it).

- [ ] **Step 2 — Timed error in the zone (fake-timer test first).** Create `apps/overlay/src/lifecycle/status-timer.test.ts` using the `HideScheduler` from Chunk 2:
  ```ts
  import { test, expect, jest } from "bun:test";
  import { HideScheduler } from "./hide-scheduler.js";

  test("error status auto-dismisses after 2000ms", () => {
    jest.useFakeTimers();
    try {
      let dismissed = false;
      const s = new HideScheduler();
      s.scheduleHide(2000, () => { dismissed = true; });
      jest.advanceTimersByTime(1999);
      expect(dismissed).toBe(false);
      jest.advanceTimersByTime(1);
      expect(dismissed).toBe(true);
    } finally { jest.useRealTimers(); }
  });

  test("a new session before 2000ms cancels the pending error dismiss (composes with #33)", () => {
    jest.useFakeTimers();
    try {
      const fired: string[] = [];
      const s = new HideScheduler();
      s.scheduleHide(2000, () => fired.push("old-error"));
      s.cancelPending(); // new session
      jest.advanceTimersByTime(3000);
      expect(fired).toEqual([]);
    } finally { jest.useRealTimers(); }
  });
  ```

- [ ] **Step 3 — Run it, expect PASS** (HideScheduler already exists). Run: overlay `bun test status-timer`. Expected: PASS.

- [ ] **Step 4 — Wire the error path (with the `timeout` distinction — Lior Q4).** In the `.catch()` branch (`main.ts:186-196`), instead of `setStatus(\`error: …\`)`, classify the rejection and emit the right status, `showWidgetWindow()`, and a session-scoped timed dismiss reusing the Chunk 2 scheduler:
  - **Handshake-timeout rejection** (gotcha #42 — read `session-client.ts` to find the cleanest discriminator; prefer a distinguishable error `name`/`code`, falling back to a `/timed out/i` test on the message if none exists — and add the discriminator to `runSession`'s reject if it's missing, still frontend-only): emit `show-status` `{ variant: "timeout", message: "No response — the model is taking too long. Try again." }`, then `hideScheduler.scheduleHide(2500, () => hideWidgetWindow())`.
  - **Any other error:** emit `show-status` `{ variant: "error", message }`, then `hideScheduler.scheduleHide(2000, () => hideWidgetWindow())`.
  Set mode/`lastRenderKind` to the status mode (NOT `text`) so the persist-content path is not confused. A new submit cancels the pending dismiss via `hideScheduler.cancelPending()` (Task 2.1 Step 3).

- [ ] **Step 5 — Wire the cancelled card.** In the `EV_CANCEL` listener (`main.ts:145-150`) after `sendCancel()`, instead of immediately `hideWidgetWindow()`, emit `show-status` `{ variant: "cancelled", message: "Cancelled" }`, then `hideScheduler.scheduleHide(1200, () => hideWidgetWindow())`. Mirrors the picker's confirm-then-dismiss symmetry (chunk-03 line 15).

- [ ] **Step 6 — Confirm content still persists.** Verify the text-persist path (Chunk 1) is unaffected: after `onShowText`, no loader/status timer hides the widget. The loader handler only runs on `onSessionStart` (before content), so by the time text renders, no loader timer is pending (loader is `until-replaced`, not timed). Add a comment asserting this invariant.

- [ ] **Step 7 — Verify.** Run overlay `typecheck`, `bun test`, `lint:strict`. Expected: all PASS.

- [ ] **Step 8 — Commit (Chunk 3 boundary).**
  ```bash
  git add apps/overlay
  git commit -m "feat(overlay): dedicated status zone, thinking loader, timed error/cancelled, explicit dismiss-policy (chunk 3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

> Chunk 3 behavioral DoD (loader→answer visible; error/cancelled in zone, not under input; content persists) — requires live macOS demo to confirm before closeout.

---

### Chunk 4 — Widget polish + error-card (demo follow-up, Lior-authorized 2026-06-03)

> Added AFTER the first live demo (Lior authorized full widget polish + the error-card gap). Same branch / same PR — one focused commit at the Chunk 4 boundary. Frontend-only (`apps/overlay`, + `tauri.conf.json`/capabilities config). **Brief-staleness note:** loader, status cards, the `timeout` variant, `×`/dismiss, `HideScheduler`, dismiss-policy are ALL already shipped in chunks 1-3 — do NOT rebuild them. Chunk 4's genuinely-new scope is only: D1 wire-error card, scroll cap, height auto-resize (#44), appearance polish.

**Goal:** Make the widget window resize to fit its content (gotcha #44), fix the broken internal scroll, polish all five render modes, and close the verified D1 gap where a wire-level `session_end{reason:"error"}` shows nothing in the overlay.

**Architecture:** Frontend-only. Height auto-resize via the Tauri JS window API (`setSize` after a measure step); **width stays fixed at 360** so the existing right-anchor (`computeWidgetX`, depends only on width) stays correct without recomputation — the 2026-06-01 off-screen-`×` bug zone is never re-entered. D1 is a `result.reason` branch in the existing `.then()` in `main.ts`, reusing the already-built `EV_SHOW_STATUS` / `renderStatus` path.

**Decisions (resolved by orchestrator on architect defaults; Lior authorized the scope):**
- **Q1 — `widget.resizable: false → true`** (programmatic `setSize` may be gated by `resizable:false` on macOS; `decorations:false` still blocks user-drag → zero UX regression). If the demo shows `setSize` works under `resizable:false`, revert the one line. If `setSize` needs a Rust command in `lib.rs`, STOP and flag (leaves frontend-only — like the blur fallback).
- **Q2 — appearance = refine the EXISTING dark `.color-picker-widget` language** (consistent padding/radius/shadow, semantic status tints, optional muted "Thinking…" label, thin dark scrollbar), max-height cap 65vh. No new visual language. Lior reacts/redirects at the re-demo.
- **Q3 — capabilities:** may need `core:window:allow-set-size` on the `widget` window's capability JSON (config edit, in scope). Only a Rust requirement escalates.
- **Q4 — D1 copy = generic** "Something went wrong. Try again." (wire strips `detail` by design; specifics need a protocol change = OUT).
- **ADR: none** — height auto-resize FULFILLS the 2026-05-31 "content-sized" intent (the fixed `height:200` was the unrealized shortcut); restating it would be amendment-noise. Resolves gotcha #44.

**Reality check (architect, verified against actual source + ADR-0006):**
- D1 is real and lives in the `.then()`, not `.catch()`: the daemon emits `session_end{reason:"error"}` (`packages/daemon/src/providers/anthropic-api-provider.ts:77-89` `formatErrorEnd`, strips `detail`); `runSession` RESOLVES on any reason (`session-client.ts:251-257`); `main.ts:225` `.then()` branches only on `lastRenderKind`, never `result.reason` (zero refs in `apps/overlay/src`) → loader silently hides. Protocol `SessionEndReason` already includes `error`/`timeout` (`packages/protocol/src/envelope.ts:18-21`) → frontend-only fixable.
- #44 verified: `tauri.conf.json:36` `height:200, resizable:false`; real content budget ~120px; `.text-reply-content max-height:320px` never engages `overflow-y:auto`; `html,body{overflow:hidden}` clips → no scroll.
- Right-anchor is width-driven only (`computeWidgetX` `main.ts:90-102`) → height-only resize keeps `×` on-screen with no x-recompute. Click-through (2026-05-31) is preserved (content-sizing strengthens it).
- All behavioral DoD below → live macOS demo (folded into the single closeout demo). #44 marked resolved ONLY after the demo passes.

#### Task 4.1: D1 — render an error/timeout card on a wire `session_end{reason}`
**Files:** create `apps/overlay/src/lifecycle/session-end-reason.ts` (+ `.test.ts`); modify `apps/overlay/src/main.ts` (`.then()` `:225-285`).
- [ ] Failing test `session-end-reason.test.ts`: `statusForEndReason("error")` → `{variant:"error", message:"Something went wrong. Try again.", ms:2000}`; `("timeout")` → `{variant:"timeout", message:"No response — the model is taking too long. Try again.", ms:2500}`; `("completed")`/`("cancelled")`/unknown → `undefined`. (`SessionEndReason` is an OPEN enum — never throw.)
- [ ] Run → FAIL. Implement `statusForEndReason(reason: string)` (pure, DOM-free; `import type { StatusVariant } from "../widgets/status.js"`). Run → PASS.
- [ ] Wire into `.then((result) => {...})` (currently `.then(() => {...})`): at the TOP, before the `lastRenderKind` switch, intercept a wire error/timeout:
  ```ts
  const endStatus = statusForEndReason(result.reason);
  if (endStatus !== undefined && (lastRenderKind === "loader" || lastRenderKind === undefined)) {
    lastRenderKind = endStatus.variant;
    emitTo(WIDGET_LABEL, EV_SHOW_STATUS, { variant: endStatus.variant satisfies StatusVariant, message: endStatus.message }).catch(() => {});
    showWidgetWindow().catch(() => {});
    hideScheduler.scheduleHide(endStatus.ms, () => { hideWidgetWindow().catch(() => {}); });
    hidePanel().catch(() => {}); inFlight = false; activeCtx = undefined; pickerSettled = false;
    return;
  }
  ```
  Guard `loader|undefined` ensures a legitimate `text`/`picker`/`cancelled` render is never overridden. Verify typecheck + `bun test`.
> Behavioral: a real provider error (invalid/missing API key → `session_end{reason:"error"}`) shows a card, not a silent hide — demo-gated.

#### Task 4.2: Fix the internal scroll cap
**Files:** `apps/overlay/src/widget.css` (`.text-reply-content`).
- [ ] Replace `max-height: 320px` with `max-height: calc(65vh - 80px)` (subtracts card+host chrome; matches `MAX_HEIGHT_FRACTION` 65vh of Task 4.3 — keep both in sync) so `overflow-y:auto` engages within the sized window. Verify typecheck + `bun test`.
> Behavioral: long reply scrolls inside the card, no clipped bottom — demo-gated.

#### Task 4.3: Height auto-resize the `widget` window (gotcha #44 core)
**Files:** create `apps/overlay/src/lifecycle/measure-height.ts` (+ `.test.ts`); modify `apps/overlay/src/widget.ts`; modify `apps/overlay/src-tauri/tauri.conf.json` (+ maybe `capabilities/default.json`).
- [ ] Failing test `measure-height.test.ts`: `clampWidgetHeight(20,1000)===WIDGET_MIN_HEIGHT`; `(300,1000)===300`; `(2000,1000)===floor(1000*MAX_HEIGHT_FRACTION)`; `MAX_HEIGHT_FRACTION` in [0.6,0.7].
- [ ] Run → FAIL. Implement (pure, DOM-free):
  ```ts
  export const WIDGET_MIN_HEIGHT = 64;
  export const MAX_HEIGHT_FRACTION = 0.65;
  export function clampWidgetHeight(contentHeight: number, screenHeight: number): number {
    const ceiling = Math.floor(screenHeight * MAX_HEIGHT_FRACTION);
    return Math.min(Math.max(contentHeight, WIDGET_MIN_HEIGHT), ceiling);
  }
  ```
  Run → PASS.
- [ ] In `widget.ts` add `resizeToContent()` (import `getCurrentWindow` from `@tauri-apps/api/window`, `LogicalSize` from `@tauri-apps/api/dpi`, `clampWidgetHeight`; `WIDGET_WIDTH_LOGICAL = 360` MUST match main.ts + tauri.conf):
  ```ts
  function resizeToContent(): void {
    requestAnimationFrame(() => {
      const content = host.scrollHeight + 24; // #widget-host 12px top+bottom padding
      const screenH = window.screen.availHeight || window.innerHeight || 800;
      const h = clampWidgetHeight(content, screenH);
      void getCurrentWindow().setSize(new LogicalSize(WIDGET_WIDTH_LOGICAL, h));
    });
  }
  ```
  Call `resizeToContent()` at the end of each `listen` handler (`EV_SHOW` picker, `EV_SHOW_TEXT`, `EV_SHOW_LOADER`, `EV_SHOW_STATUS`) and after the `onPick`/`renderConfirmation` render.
- [ ] `tauri.conf.json`: `widget.resizable: false → true` (keep `height:200` as initial). Flag Q1 at demo.
- [ ] Read `capabilities/default.json`; if the `widget` window lacks `core:window:allow-set-size`, add it (config edit, in scope). If a Rust change is required → STOP + flag Q3.
- [ ] Verify typecheck + `bun test` + `lint:strict`.
> Behavioral: each mode fits its content; long reply caps ≤65% + scrolls; loader small; `×` never clipped (width unchanged) — demo-gated. Resolve gotcha #44 ONLY after this demo passes.

#### Task 4.4: Appearance polish across all five modes (frontend-design skill)
**Files:** `apps/overlay/src/widget.css` (+ maybe `widgets/status.ts` for an optional loader label).
- [ ] Invoke `frontend-design` skill; refine the EXISTING dark `.color-picker-widget` language: unify padding/radius/shadow across loader/text/status/picker/confirmation; keep labeled `.cp-close` top-right (verify 40px top padding holds at min height); polish loader spinner (optional muted "Thinking…" label, ≤12px, `rgba(245,245,247,0.6)`); keep semantic status tints (error red / timeout orange / cancelled grey); thin dark scrollbar for `.text-reply-content`. Dark-theme only, system font stack, no web fonts, no new deps.
- [ ] Do NOT rename existing classes (`.status-card`, `.status-error/timeout/cancelled/loader`, `.text-reply-content`, `.cp-close`) — tests + main.ts/widget.ts depend on them. Verify `bun test` green.
- [ ] Verify typecheck + `bun test` + `lint:strict`.
> Behavioral: looks good across all modes — subjective, Lior confirms/redirects at demo.

#### Task 4.5: Commit (Chunk 4 boundary)
- [ ] Final verify: overlay typecheck + `lint:strict` + `bun test` green; `git diff` only `apps/overlay` (+ `src-tauri/tauri.conf.json`, maybe `capabilities/default.json`).
- [ ] Commit:
  ```
  git add apps/overlay
  git commit -m "feat(overlay): content-size widget (#44) + scroll fix + D1 wire-error card + appearance polish (chunk 4)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
> Chunk 4 behavioral DoD folded into the single closeout demo. Do NOT mark #44 resolved or any behavioral line done until the demo PASSES.

---

## Resolved decisions (Lior, 2026-06-03)

**Plan APPROVED — Phase 2 go.** One PR (01→02→03), one live macOS demo at the end.

1. **Status-zone realization = Option A** — status render-mode of the existing `widget` window, NOT a third window. Confirmed by Lior. Recorded in ADR-0006 Amendment 2026-06-03 §2 (preserves the two-window model the 2026-05-31 amendment pinned; loader/content/status are sequential within a session and never coexist).
2. **`×` label = `× Close`** on the text card — confirmed. Deliberately distinct from the picker's `× Cancel`: display-only content is *closed*, not *cancelled* (there is no tool-call to cancel). Same labeled-on-screen style as ADR-0006 2026-06-01.
3. **Blur-dismiss = pure-DOM `blur` first.** If the live demo shows WKWebView's `main` window does not emit DOM `blur` on click-outside, escalate to the Rust `WindowEvent::Focused(false)` fallback in `lib.rs` — flag to Lior before touching Rust.
4. **>30s handshake timeout → a friendly "taking too long" card, NOT a bare "error" (Lior, Q4).** The handshake-timeout rejection (gotcha #42, `session-client.ts`) renders a distinct `timeout` status variant worded like *"No response — the model is taking too long. Try again."* — never the raw `error: … timed out`. A genuine error still renders the `error` variant with its message. Both are timed status in the dedicated zone. The 30s timeout value itself is unchanged (streaming is the deferred real fix). See Task 3.2 / 3.3 for the `timeout` variant.

---

## Verification (closeout gate)

- **Mechanical (command evidence, PIPELINE §6.2):** overlay `typecheck`, `lint:strict`, `bun test` (incl. the new fake-timer tests) all green; `git diff main...HEAD` touches only `apps/overlay` + `orchestration/docs/adr` (+ chunk/plan lifecycle docs).
- **Behavioral (runtime proof, PIPELINE §6.1):** ONE live macOS demo by Lior at the end covering all behavioral DoD of chunks 01/02/03. Behavioral criteria are marked done ONLY after the demo PASSES. Sequence the demo BEFORE closeout docs.
