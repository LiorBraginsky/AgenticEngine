# Chunk 2: Input lifecycle hygiene (session-scoped timers + clear-on-open + blur-dismiss)

**Status:** todo
**Created:** 2026-06-03
**Phase:** overlay-ux-pass (frontend UX polish, post-llm-text-slice)
**Depends on:** chunk 1 (sequential — shared overlay session/window lifecycle, §7.1). **Hard prerequisite for chunk 3**: gotcha #33 explicitly says the stale-timer bug "must be fixed before the status text is removed/reworked."
**Estimated size:** ~0.5–1 day

## Scope

**In:**
- **gotcha #33 — session-scope the hide/reset timer.** Tag every hide/reset timeout with its session id; cancel any pending hide-timer when a new session opens, so a stale prior-session timer can never auto-hide a freshly-reopened input. (`apps/overlay/src/ws/session-client.ts` owns the timers; `main.ts` owns the window show/hide.)
- **gotcha #34 — clear the input on open.** The input `value` is reset on show, so a new open never shows the previous session's text. **Fix together with #33** (a naive "clear on hide" would also wipe an input that a #33 stale timer re-opened — the gotcha calls this out explicitly).
- **Blur-dismiss for the input panel.** The `main` (centered input) window hides on focus-loss / click-outside. Feasible here because `main` is a normal focusable window (unlike the click-through `widget`). (Realizes the deferred `input_blur_dismiss` follow-up.)

**Out:** (each states WHY)
- **The status zone / loader / error / cancelled card** — deferred to chunk 3; this chunk only makes the input/timer lifecycle *safe* so the status rework (chunk 3) can proceed without #33 biting.
- **Click-out dismiss for the `widget` (text) window** — OUT: that window is click-through outside its bounds (ADR-0006 2026-05-31); blur-dismiss here is for the `main` input window only.
- **"Clear input after idle timeout"** (a separate Lior nice-to-have noted in gotcha #34) — OUT/deferred; this chunk clears on open, not on an idle timer (idle-clear is a different trigger, additive later).
- **Any `packages/protocol` / daemon change** — OUT, frozen; frontend-only.

## Done criteria

- [ ] **[behavioral]** Repro #33 is gone: hotkey → type → resolve → quickly hotkey again → the fresh input stays open and is NOT auto-hidden by the prior session's timer (live macOS demo).
- [ ] **[behavioral]** Repro #34 is gone: the input never shows the previous session's text on a new open.
- [ ] **[behavioral]** Clicking outside the input panel (or it losing focus) hides it.
- [ ] **[mechanical]** A regression test asserts the hide-timer is cancelled / re-scoped when a new session opens (fake-timer test, since this is time-dependent — humble-object tests that fire events synchronously will miss it; see the 02b-ii timeout lesson).
- [ ] **[mechanical]** `git diff` only in `apps/overlay`; overlay typecheck + `lint:strict` clean; existing session-client tests green + new timer test added.

## Orchestrator brief (read by the orchestrator from this file)

```
Fix the overlay input-window lifecycle in apps/overlay: session-scope the hide/reset timer (gotcha #33), clear the input value on open (gotcha #34, fix together with #33), and hide the input panel on blur / click-outside (the deferred input_blur_dismiss follow-up).

Files to touch (frontend-only):
- apps/overlay/src/ws/session-client.ts (+ test) — tag timers with session id; cancel pending hide-timer on new session; fake-timer regression test
- apps/overlay/src/main.ts — clear input value on show; hide-on-blur for the main window
- apps/overlay/src-tauri/src/lib.rs — only if blur/focus-loss needs a window event from the Rust shell

Behaviour:
- A new session cancels any pending prior-session hide-timer (no stale timer hides a fresh input).
- Input opens empty every time. Input hides on focus-loss / click-outside.

Done when:
- #33 + #34 repros gone (demo); blur hides input; fake-timer regression test green; diff only in apps/overlay; overlay typecheck + lint:strict clean.

ADRs in scope: none new (within ADR-0006's existing two-zone model). The hotkey accelerator + window model are already pinned by ADR-0006 amendments — do not change them.
Out of scope: status zone / loader / error (chunk 3), widget click-out, idle-timeout-clear, protocol/daemon.
```

## Notes / Open questions

- **Why before chunk 3:** gotcha #33 is a documented hard prerequisite — reworking the status text (chunk 3) on top of an unscoped timer would re-trigger the stale-timer-kills-fresh-window bug. Order is load-bearing.
- **Time-dependent → fake-timer tests** (PIPELINE.md §6.1 lesson, 02b-ii): the timer bug is invisible to synchronous humble-object tests; the regression test must advance fake timers.
- Behavioral DoD → Lior's live macOS demo before closeout.
