# Walking Skeleton v0 — Chunk 03: End-to-End Wiring + Definition-of-Done Demo — Implementation Plan

> **✅ SHIPPED — Walking Skeleton v0 (closed 2026-06-02, PR #1). Archived historical record; kept for provenance/audit trail.** Any "IN PROGRESS" status or "git commit declined by permission layer" notes below reflect mid-execution state and are **SUPERSEDED** — v0 is complete and autonomous git is now enabled (project CLAUDE.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The only *code* this chunk may touch is a low-risk rename (Step in Task 2); the substance is **verification + documentation reconciliation**. Verification on **real macOS** is the gate (manual checklist, Task 3) — automated tests alone do not close this chunk.

**Goal:** Close Walking Skeleton v0 by proving the real text-in → widget-out path works end-to-end on macOS over the frozen WS protocol (happy path *and* cancel path), landing follow-up **FU-1** (drop the agent fun-fact from the v0 wire-DoD across roadmap + chunk doc), and resolving known-gotcha **#2** (cancellation) for the skeleton.

**Architecture:** This is the JOIN chunk. The reality check below establishes that the join is **already wired and already manually verified** (chunks 02a + 02b-ii shipped the full path; the tree is clean and the chunks are archived). Therefore chunk 03 does **not** add wiring — it (a) re-runs the automated gate to confirm the committed slice is green on a fresh checkout, (b) re-runs the on-macOS manual demo as the authoritative DoD sign-off, (c) reconciles the v0 Definition-of-done docs per FU-1, and (d) marks gotcha #2 resolved. No `packages/protocol` change. No `packages/daemon` change. No new `apps/overlay` wiring.

**Tech Stack:** Bun (`bun test`, `bun run typecheck`, `bun run lint:strict`), Tauri v2 overlay on macOS, the frozen `@agentic/protocol` 6-variant envelope, WS on `localhost:7777`.

---

## Reality check

> **⚠️ SUPERSEDED by `## Reality check — REVISED (post-demo)` below.** The static read in this section was FALSIFIED by Lior's live macOS demo (2026-06-01): the slice is NOT docs-only — three overlay-only behavioral gaps surfaced (no visible confirmation, unreachable cancel ×, reopen-after-restart blocker). The wire contract held; the *behavioral* contract did not. Read the REVISED section as authoritative; this original is kept for the audit trail.

**Hypothesis (from the brief):** *"This is WIRING + VERIFICATION, not new design — 02a (mock agent loop) and 02b-ii (color-picker renderer) already code against the same frozen protocol/packages."*

**Verdict: HOLDS, and is in fact STRONGER than stated — the wiring is not just *codeable*, it is already *coded, committed, and manually verified on macOS*.** Chunk 03 is **verification + doc reconciliation + gotcha closure**, with effectively no new wiring code. I am surfacing this loudly because the brief is written as if the wiring still needs to be built; it does not. A worker who starts "writing the wiring" will either duplicate or churn shipped, review-clean code. **Do not re-wire.**

Evidence, both sides of the join (file:line):

**Daemon side (chunk 02a — on `main`, chunk archived):**
- `packages/daemon/src/index.ts:23-82` — `startDaemon` holds `sessions = Map<string, MockSessionState>` (`:8`), gates the WS upgrade on the Origin allowlist (`:29`, ADR-0003), drives the pure reducer on every inbound (`:55`), sends each `outbound` validated by `parseEnvelope` defence-in-depth (`:11-19, :74`), and cleans up orphaned sessions on socket `close` (`:76-79`, ADR-0001 leaked-session handling).
- `packages/daemon/src/mock-agent.ts:69-117` — `session_start` ⇒ `[session_ack, tool_call{show_color_picker}]`, parks `awaiting_pick`.
- `:140-177` — `tool_result{picked}` ⇒ computes `finalText` (`:167`) and emits `session_end{reason:"completed"}`; malformed result ⇒ typed error, no throw, session stays open (`:151-163`, gotcha #9).
- `:119-138` — `tool_cancel` ⇒ `session_end{reason:"cancelled"}`, graceful.
- `index.ts:59-62` — the fun-fact `finalText` is **logged daemon-side only** (`console.log("[daemon] agent final text:", …)`), explicitly *not* sent as a wire message. **This is FU-1 / Option A already implemented in code.**

**Overlay side (chunk 02b-ii — files present, tree clean, chunk archived):**
- `apps/overlay/src/ws/session-client.ts:98-213` — `runEcho` opens the WS (`ws://127.0.0.1:7777`, `:25` — port-aligned with the daemon default `DAEMON_PORT = 7777`), sends `session_start` on open (`:134-136`), correlates `session_ack` by `client_session_id` (`:152-162`), on a matching `tool_call` **disarms the handshake timeout** (`:178`, the post-02b-ii fix) and invokes `onToolCall(ctx)` with bound `sendResult`/`sendCancel` (`:180-186`), and resolves on `session_end` of any reason (`:192-198`).
- `apps/overlay/src/main.ts:80-102` — `onToolCall` relays the picker to the `widget` window via `emitTo("show-picker", …)` and shows the window; `picker-result` ⇒ `sendResult(swatch)`, `picker-cancel` ⇒ `sendCancel()`.
- `apps/overlay/src/widget.ts:15-20` + `apps/overlay/src/widgets/color-picker.ts` — the `widget` window renders the closed-set color-picker primitive (label + clickable swatches + ×) and emits the user's pick/cancel back.
- `apps/overlay/src/ws/tool-call-handler.ts:12-31` — the DOM-free decision/build layer; `buildToolResult`/`buildToolCancel` produce contract-valid envelopes (`ShowColorPickerResult.parse` on the way out, `:25`).
- `apps/overlay/src-tauri/tauri.conf.json:26-40` — the `widget` window (top-right, transparent, `alwaysOnTop`, `visible:false`) is statically declared (ADR-0006 two-zone realization).

**Manual macOS verification ALREADY PASSED (record):** `orchestration/docs/plans/walking-skeleton-v0-02b-ii-color-picker/plan.md:703-713` — `Status: SHIPPED ✅ (2026-06-01)`: "Manual macOS checklist PASSED by Lior (picker renders top-right; click→`completed` with daemon 'you picked …' log; ×→`cancelled`; click-through outside widget works; picker now PERSISTS until user acts after the timeout fix)." Items (2) pick→completed and (3) click-through confirmed working; the auto-vanish bug was fixed (timeout disarm at `session-client.ts:178`).

**Net correction to the brief's framing:**
1. **There is no wiring task.** The "wire the live path" work the brief lists under "Files to touch" (`wiring/config across apps/overlay and packages/daemon`) is already done and committed. Chunk 03 must NOT modify `packages/daemon`, `packages/protocol`, or the `apps/overlay` WS/window wiring. (`git diff` over those must stay empty.)
2. **The DoD demo was already run once on macOS during 02b-ii.** Chunk 03's macOS run is the *milestone* sign-off (the explicit, attributed close of Walking Skeleton v0), re-run on a clean checkout. It is still required — it is the authoritative DoD gate — but it is a re-confirmation, not a first proof.
3. **The substantive remaining deliverables are documentation:** FU-1 (roadmap lines 53-60 + this chunk's own doc) and gotcha #2 closure in `known-gotchas.md`. These were *decided* in 02a's Jimmy ruling and *deferred to chunk 03*; this is where they land.

**One naming nit found (non-blocking, optional):** `runEcho` (`session-client.ts:98`) is a stale name from the 02b-i echo-transport-proof era — it no longer echoes; it drives a full picker round-trip. Renaming is purely cosmetic and risks needless churn; handled as an **optional** step in Task 2, gated on the reviewer/Lior wanting it. The chunk does not depend on it.

---

## Reality check — REVISED (post-demo, 2026-06-01) — AUTHORITATIVE

**The "docs-only" verdict above is FALSIFIED by Lior's live macOS demo.** Three load-bearing claims did not survive runtime. Corrected verdict: **chunk 03 requires overlay-only code changes** to satisfy its own already-written DoD (spec lines 25-26), plus a **reopen blocker** that must be fixed first or nothing is re-verifiable. **The frozen contract (`packages/protocol`) and daemon (`packages/daemon`) remain correct and untouched — no stop-the-line.** Doc work (FU-1, gotcha #2, README, approved `runEcho→runSession` rename) and the Task-1 green gate are preserved.

**Live demo observations (authoritative):**
- Happy path functions (hotkey→input→picker→click Crimson→daemon log `you picked Crimson (#DC143C), fun fact: …` ✅) **but the overlay never visibly confirms** — Lior saw no `completed` confirmation; closes too fast / wrong window.
- **No reachable × / cancel control** in the integrated run; Lior fell back to ⌘Q (process-kill, not the `tool_cancel` graceful path). Cancel DoD **not demonstrable**.
- **Overlay won't reopen** after ⌘Q + restart — blocks all re-verification.

### Finding 1 — Visible completion confirmation NOT rendered
**Root cause:** completion text is written to the wrong, already-hidden window. `main.ts:85` hides the input (`main`) window; `main.ts:124-136` writes `setStatus("session … — completed")` to `#status` **in that hidden `main` window**; the `widget` window has no confirmation state — `main.ts:91-96` hides it immediately on result. The 1200ms linger lingers a window the user can't see.
**Scope:** IN-scope (spec line 25 requires "overlay visibly confirms the chosen color"). **Frozen-surface impact: NONE** (overlay-only; the `picked` swatch is already in-hand).
**Minimal fix:** widget window renders a brief confirmation (the picked swatch, e.g. "✓ Crimson #DC143C") for the linger window before hiding; move `hideWidgetWindow()` from the immediate result handler (`:95`) to the linger timer (`:131`). Files: `widgets/color-picker.ts` (+`renderConfirmation`), `widget.ts`, `main.ts`. **UX shape gated on Q1.**

### Finding 2 — Cancel × exists in DOM but is unreachable
**Root cause:** the × IS built+wired (`color-picker.ts:25-31` → `widget.ts:18` `emit("picker-cancel")` → `main.ts:97-102` `sendCancel()` → `tool_cancel`). But the widget window is hardcoded `x:1500, w:360` (`tauri.conf.json:30-32`) → right edge 1860px; on a narrower display the top-right × clips off-screen. No Escape fallback (window `focus:false`, `:38`). The 02b-ii "×→cancelled PASSED" record was on an isolated widget or has regressed.
**Scope:** IN-scope (spec line 26). **Frozen-surface impact: NONE** (`tool_cancel` already variant 5, `envelope.ts:57-61`; overlay-only).
**Minimal fix:** make × unmissable + on-screen (label it; runtime right-anchor the widget window at `main.ts:69` so never off-screen) and/or add Escape-to-cancel keydown in `widget.ts`. **Affordance gated on Q2.** First confirm clip-vs-offscreen via a display-bounds probe.

### Finding 3 — Reopen-after-restart BLOCKER
**Root cause (hypothesis):** global shortcut registered (`lib.rs:36`) but **never unregistered**, no single-instance guard (`Cargo.toml`) → after ⌘Q a stale OS hotkey registration or a zombie `tauri dev` process still owns `⌘⇧Space`; the relaunch's `register()` fails/no-ops → hotkey dead. Secondary suspects (lower): orphaned daemon on :7777 (would break round-trip, not the hotkey), Accessibility re-grant after rebuild.
**Scope:** IN-scope to UNBLOCK (must be first; nothing re-verifiable otherwise). **Frozen-surface impact: NONE** (`apps/overlay/src-tauri` only).
**Fix:** first probe with `superpowers:systematic-debugging` (`lsof -i :7777`, `ps aux | grep -iE "overlay|tauri|cargo"` after ⌘Q; read relaunch stderr for `register()` Err). Then add `global_shortcut().unregister_all()` on exit/`CloseRequested` in `lib.rs`. `tauri-plugin-single-instance` is a heavier no-go unless the probe demands it (new Rust dep → ADR). **Dependency-path gated on Q3.**

> **⚠️ Finding 3 root cause CORRECTED by live systematic-debugging (2026-06-01) — the hypothesis above was WRONG.** The first Task-R fix (`unregister_all()` on `WindowEvent::CloseRequested` in `lib.rs`) was INERT: (a) it hooked the wrong event — ⌘Q/SIGINT fire `RunEvent::Exit`, not `WindowEvent::CloseRequested` (windows are `.hide()`d, never `.close()`d), so it never ran; (b) macOS releases Carbon global hotkeys when the process dies, so a dead process does NOT orphan the registration — the whole "stale OS registration" mechanism was a red herring. **Actual root cause (evidence-backed):** `tauri dev` spawns `vite` on port **1420** with `strictPort: true` (load-bearing — daemon Origin-allowlist hardcodes `localhost:1420`, ADR-0003). On an unclean ⌘Q the Rust app dies but **vite is orphaned and keeps holding 1420** (confirmed live: orphaned `vite` pid on `[::1]:1420 LISTEN`, parent `tauri dev` gone); the next `tauri dev` cannot bind 1420 → app never comes up → "hotkey dead." **Corrected fix (Q2=A):** revert the inert `lib.rs` hook (→ main baseline) and add a **predev step that frees port 1420** before vite starts, so an unclean ⌘Q never wedges a restart. Overlay-only (`tauri.conf.json`/`package.json`/`README`); frozen surfaces untouched.

### Task V — macOS DoD VERIFIED (Lior, 2026-06-01)
- **Happy path: PASS** — picker → click → widget re-renders to `✓ <Name> #HEX` confirmation card (~1.2s) before hiding; daemon logs `agent final text` (Option A). The overlay now *visibly confirms the chosen color* (spec line 25 ✅).
- **Cancel path: PASS** — labeled **Cancel** button (now on-screen, window right-anchored) → `session_end{cancelled}`, graceful, no orphan, no crash (spec line 26 ✅). **Escape-to-cancel also works** (the highest-uncertainty item — confirmed). Note: the `"… — cancelled"` status text lives in the (normally-hidden) input window — NOT a DoD gap (cancel needs only graceful termination; visible cancel-confirmation is not required). Optional symmetric "cancelled" widget card deferred as a non-blocking polish follow-up.
- **Reopen: PASS** on clean restart; robustness against unclean ⌘Q handled by the predev port-1420-free fix above.
- All traffic over the real protocol; `git diff packages/protocol packages/daemon` stayed EMPTY throughout (stop-the-line invariant held).

### Decisions (Lior, 2026-06-01)
- **Q1 = Option A** — confirm-then-dismiss in the **widget** window: on pick, re-render to "✓ <Name> #HEX" (the held swatch), linger ~1200ms, then hide. (Triggers the one-line ADR-0006 amendment → adr-curator.)
- **Q2 = Option A** — prominent on-screen labeled **× ("Cancel") + Escape-to-cancel**; runtime right-anchor the widget window so it is never off-screen.
- **Q3 = Option A** — Finding 3 fix on the **no-new-dependency path**: `unregister_all()` on exit + clean-dev-shutdown README note; escalate to `tauri-plugin-single-instance` (+ADR) ONLY if Lior's runtime probe proves duplicate-instance contention. No speculative dependency.
- Lior confirmed the 02b-ii "×→cancelled PASSED" record was an incomplete test (he did not actually exercise the close button / confirmation text) — corroborates Finding 2's root cause and the behavioral-proof lesson.

> **Behavioral-proof rule (this chunk):** the worker produces code + automated tests only. It MUST NOT claim the behavioral DoD (visible confirmation, reachable cancel, reopen) is met — that is Lior's Task V macOS re-demo. Code-reading + prior PASS records are insufficient evidence here (they have been wrong 3×).

### Revised task ordering (supersedes Tasks 2 & 3 below)
- **Task 1** — green gate. ✅ DONE (preserved).
- **Task R** — unblock reopen (FIRST). R1 diagnose (systematic-debugging) → R2 fix in `lib.rs` (no-new-dep path preferred) → R3 verify reopen across quit/restart.
- **Task C** — DoD code fixes (GATED on Q1/Q2). C1 visible confirmation; C2 reachable cancel; C3 re-run automated gate + empty-diff invariant on protocol/daemon.
- **Task D** — preserved doc work (= original Task 2): FU-1 roadmap, gotcha #2, README intro, `runEcho→runSession` rename (Lior approved).
- **Task V** — authoritative macOS DoD re-demo (= original Task 3) after R+C land: confirmation visible, cancel via UI (not ⌘Q), reopen works; record `Status: done`; commit + PR.

### ADR — conditional
- Findings 1&2: no new ADR. BUT if the widget gains a confirm-then-dismiss state, that is a small new UX micro-pattern not covered by ADR-0006 Amendment 2026-05-31 → route a **one-line ADR-0006 amendment** ("Widget confirm-then-dismiss on resolve") to adr-curator. Low severity; do not block. **✅ LANDED (uncommitted): `## Amendment 2026-06-01` in `orchestration/docs/adr/0006-dual-hotkey-2zone-ux.md`** — combined confirm-then-dismiss (Q1=A) + cancel-reachability (Q2=A), additive, frozen surfaces untouched. (Follow-up, non-blocking: `architecture.md` does not yet reference this amendment.)
- Finding 3: no ADR if unregister-hook path; **YES ADR if `tauri-plugin-single-instance` adopted** (new Rust dep) — decide only after R1.

---

## Stop-the-line

**None — all 6 envelope variants are present and the join is not merely wireable, it is fully wired against the frozen contract.**

Enumeration of the frozen 6-variant envelope (`packages/protocol/src/envelope.ts:23-78`), each mapped to its use at the join:

| # | Variant | Schema (envelope.ts) | Used at the join by |
|---|---------|----------------------|---------------------|
| 1 | `session_start` | `:27-32` | overlay `runEcho` → daemon (`session-client.ts:134`) |
| 2 | `session_ack` | `:36-40` | daemon → overlay correlate (`mock-agent.ts:101`, `session-client.ts:152`) |
| 3 | `tool_call` | `:42-47` | daemon `show_color_picker` → overlay render (`mock-agent.ts:106`, `session-client.ts:165`) |
| 4 | `tool_result` | `:49-54` | overlay pick → daemon completed (`tool-call-handler.ts:23`, `mock-agent.ts:141`) |
| 5 | `tool_cancel` | `:57-61` | overlay × → daemon cancelled (`tool-call-handler.ts:29`, `mock-agent.ts:120`) |
| 6 | `session_end` | `:63-67` | daemon → overlay resolve (`mock-agent.ts:131,169`, `session-client.ts:192`) |

Every message the happy path and the cancel path require already exists, is already constructed, and is already validated on both send and receive. No field is missing. No ad-hoc patch exists or is needed. The frozen contract (`packages/protocol/**`) and the daemon (`packages/daemon/**`) MUST remain byte-untouched by this chunk — that empty-diff invariant is itself a verification step (Task 1, Task 3).

The "fun-fact" reconciliation that the brief flags is **not** a contract gap — it was resolved as Option A (daemon-side log, no 7th variant) in chunk 02a (Jimmy's binding ruling, `…02a-mock-agent/plan.md:68-76`) and is already implemented (`index.ts:59-62`). Chunk 03 only records that decision in the *documents* (FU-1), it does not change behavior.

---

## File Structure

No source files are created. The only files this chunk writes are **documentation**, plus one **optional** cosmetic rename.

| File | Action | Responsibility |
|---|---|---|
| `orchestration/docs/roadmap.md` | **Modify** (FU-1) | Lines 53-60: reframe the `"you picked X, fun fact: …"` tail (line ~57) as a Phase-2 `show_text` increment, not a v0 wire output; ensure the DoD (line ~60 "widget shows the result") reads as "widget confirms the selection," not "overlay shows fun-fact text." |
| `orchestration/chunks-todo/walking-skeleton-v0/03-end-to-end-wiring-and-demo.md` | **Modify** (FU-1 + status) | Its DoD is already FU-1-reconciled (line 25, per commit d7ffa99). Add a completion record / `Status: done` and an archive note, matching the 01/02a/02b-ii precedent. |
| `orchestration/docs/known-gotchas.md` | **Modify** | Row #2 (cancellation): mark resolved-in-skeleton-v0 with evidence pointer (the `tool_cancel` → `session_end{cancelled}` path, daemon + overlay + manual macOS). |
| `apps/overlay/README.md` | **Modify** (small) | One-line intro fix: line 5 says "sends an ECHO round-trip" — stale; the flow is now a picker round-trip. The rest of the README (lines 89-172) already documents the two-window picker flow correctly. |
| `apps/overlay/src/ws/session-client.ts` (+ its test, + `main.ts` callsite) | **Modify — OPTIONAL** | Rename `runEcho` → `runSession`. Cosmetic only; gated on reviewer/Lior approval. If skipped, leave a code comment noting the stale name is intentional-for-now. |

Untouched (and verified untouched as a gate): all of `packages/protocol/**`, all of `packages/daemon/**`, all `apps/overlay` WS/window wiring (`tool-call-handler.ts`, `widget.ts`, `widgets/color-picker.ts`, `tauri.conf.json`, `capabilities/default.json`, `main.ts` logic).

---

## Tasks

### Task 1: Verify the committed slice is green + the frozen surfaces are untouched

**Files:** none modified. This task is the automated-gate confirmation that the shipped slice still builds clean on the current checkout, and that nothing has drifted into the frozen contract or daemon.

> **✅ DONE (engine-worker, 2026-06-01).** `bun test` = **55 pass, 0 fail** (149 expect, 10 files); `bun run typecheck` root exit 0; overlay typecheck exit 0; `bun run lint:strict` exit 0; `git diff --stat packages/protocol packages/daemon` = **EMPTY** (frozen-surface invariant holds). Branch `chunk/03-e2e-wiring` created off `main`. VERDICT: GREEN — ready for Task 2 + Task 3.

- [ ] **Step 1: Run the whole-repo test suite**

Run (from repo root): `bun test`
Expected: all green. The 02b-ii record states **55 pass** at ship (`…02b-ii…/plan.md:713`); confirm the current count is ≥ that and **0 fail**. Paste the real `bun test` summary line into the worker report. If anything is red, STOP and surface it — a red baseline means the shipped slice regressed and chunk 03 cannot proceed to the macOS demo.

- [ ] **Step 2: Run typecheck (root) and overlay typecheck**

Run: `bun run typecheck` (root) → expect exit 0.
Run: `cd apps/overlay && bun run typecheck` → expect exit 0. (Watch for TS2749 from any accidental Zod-schema-value import; the codebase uses `Extract<Envelope,…>` to avoid it — `session-client.ts:35`.)
Paste both exit codes into the report.

- [ ] **Step 3: Run strict lint**

Run: `bun run lint:strict` (root, `eslint . --max-warnings=0`) → expect exit 0. Paste the result.

- [ ] **Step 4: Confirm the frozen-surface empty-diff invariant**

Run: `git diff --stat packages/protocol packages/daemon`
Expected: **empty output.** This is the structural proof that chunk 03 introduced no ad-hoc contract or daemon change (Done-criterion: "No ad-hoc contract change"). If non-empty, STOP — something violated the stop-the-line rule. (Run again at the end of the chunk, Task 3 Step 7, as the closing gate.)

- [ ] **Step 5: Commit the verification baseline (branch first)**

This task produces no file changes, so there is nothing to commit yet — but create the feature branch now so subsequent doc commits land off `main` (project CLAUDE.md git rails):
```bash
git checkout -b chunk/03-e2e-wiring
```
Record the green gate output in the worker report; the first actual commit is in Task 2.

---

### Task 2: Land FU-1 doc reconciliation + close gotcha #2 + fix the stale README line

**Files:**
- Modify: `orchestration/docs/roadmap.md` (lines 53-60)
- Modify: `orchestration/docs/known-gotchas.md` (row #2, line 23)
- Modify: `apps/overlay/README.md` (line 5)
- Modify (OPTIONAL, see Step 5): `apps/overlay/src/ws/session-client.ts`, `apps/overlay/src/ws/session-client.test.ts`, `apps/overlay/src/main.ts`

- [ ] **Step 1: FU-1 — reconcile the roadmap v0 DoD**

In `orchestration/docs/roadmap.md`, edit the Walking Skeleton block (lines 53-60).

Line 57 currently reads:
```
- [ ] Mock agent loop: hard-coded "find a color" → `show_color_picker` → "you picked X, fun fact: …"
```
Change it to (drop the fun-fact from the v0 wire output; mark it as a Phase-2 `show_text` increment):
```
- [ ] Mock agent loop: hard-coded "find a color" → `show_color_picker` → user picks → `session_end{completed}`. (The agent "fun fact" is computed and **logged daemon-side only** — Option A, ADR-0002-preserving; it is NOT a wire message in v0. A spoken/`show_text` reply is a Phase-2 increment, added as a TOOL, never as a 7th envelope variant. See chunk-02a plan, Jimmy's ruling 2026-05-30.)
```

Line 60 (the Definition of done) currently ends:
```
…clicks a color, and the widget shows the result — all driven by the (mocked) agent loop over the real WS protocol.
```
Append a clarifying clause so it is not misread as "overlay shows the fun-fact text":
```
…clicks a color, and the **widget confirms the chosen color** (the `picked` swatch the overlay already holds) — all driven by the (mocked) agent loop over the real WS protocol. The visible v0 result is the picker confirming the selection; the agent fun-fact is logged daemon-side only (Option A), not rendered as wire text.
```

- [ ] **Step 2: Close known-gotcha #2 (cancellation)**

In `orchestration/docs/known-gotchas.md`, row #2 (line 23) currently reads:
```
| 2 | **Cancellation when user closes widget mid-flow** — tool keeps running, wastes API quota | `blocking-MVP` | Pass `AbortSignal` to tool runner; engine triggers on widget-close |
```
Update the Note to record the skeleton-v0 resolution while keeping the forward-looking real-LLM concern explicit:
```
| 2 | **Cancellation when user closes widget mid-flow** — tool keeps running, wastes API quota | `blocking-MVP` | **Skeleton v0 (2026-06-01): cancel path resolved end-to-end.** Closing the picker (×) emits `tool_cancel` → daemon ends the session `session_end{reason:"cancelled"}` gracefully (no orphaned/leaked session, no crash); leaked sessions on socket disconnect are cleaned in the `close(ws)` hook (`packages/daemon/src/index.ts`). Verified on macOS, chunk 03. **Still open for Phase 3:** when a REAL tool/LLM call is in flight, cancel must also abort the running work (`AbortSignal` to the tool runner) — the v0 mock has no long-running work to abort, so that half is deferred to the real-LLM phase. |
```
(Keep severity `blocking-MVP` — the AbortSignal half is still owed before real tools land. Do not downgrade.)

- [ ] **Step 3: Fix the stale README intro line**

In `apps/overlay/README.md`, line 5 currently reads:
```
panel; typing and pressing Enter sends an ECHO round-trip to the daemon.
```
Change to:
```
panel; typing and pressing Enter starts a session — the daemon answers with a color-picker, which renders in a top-right widget window, and your pick completes the session.
```
(The rest of the README — the two-window section lines 89-110 and the round-trip flow lines 112-131 — already describes the picker flow correctly; no other change needed.)

- [ ] **Step 4: Verify docs lint clean and commit**

Docs are markdown; they do not affect `bun test`/`typecheck`. Run `bun run lint:strict` once more to confirm the README change did not trip a markdown/eslint rule (expect exit 0).
```bash
git add orchestration/docs/roadmap.md orchestration/docs/known-gotchas.md apps/overlay/README.md
git commit -m "docs(chunk-03): land FU-1 v0 DoD reconciliation + close gotcha #2 (cancellation) + fix stale overlay README intro

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: OPTIONAL — rename `runEcho` → `runSession` (gate on reviewer/Lior)**

Only do this if the reviewer or Lior approves the cosmetic rename. It is not required to close the chunk. If approved:
- In `apps/overlay/src/ws/session-client.ts`, rename the exported `runEcho` (`:98`) to `runSession`; update the two doc-comment mentions (`:77`, `:91-97`) and the `EchoResult`/`RunEchoOptions` type names only if you want full consistency (`EchoResult` → `SessionResult`, `RunEchoOptions` → `RunSessionOptions`) — otherwise leave the type names to minimize churn.
- In `apps/overlay/src/main.ts:124`, update the callsite `runEcho(text, factory, { onToolCall })` → `runSession(...)`.
- In `apps/overlay/src/ws/session-client.test.ts`, update every `runEcho` reference.
- Re-run `bun test` + both typechecks + `bun run lint:strict`; all must stay green.
- Confirm `git diff --stat packages/protocol packages/daemon` is still empty (the rename is overlay-only).
```bash
git add apps/overlay/src/ws/session-client.ts apps/overlay/src/ws/session-client.test.ts apps/overlay/src/main.ts
git commit -m "refactor(overlay): rename runEcho → runSession (no longer an echo; full picker round-trip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
If skipped: add a one-line comment above `session-client.ts:98` — `// NOTE: 'runEcho' is a legacy name from the 02b-i echo proof; it now drives a full picker round-trip. Rename deferred (cosmetic).` — and commit that single-line note with the same message minus the rename.

---

### Task 3: Real-macOS Definition-of-Done demo (the milestone gate) + close-out

**Files:** none modified by the worker. This task is the human (Lior) running the authoritative DoD demo on real macOS, then recording the result and closing the chunk. Automated tests do not substitute for this — the whole point of the walking skeleton is the *visible* widget on real macOS (roadmap line 43).

- [ ] **Step 1: Start the daemon**

```
cd packages/daemon && bun run dev
```
Expected log: `[daemon] listening on ws://127.0.0.1:7777`.

- [ ] **Step 2: Start the overlay**

```
cd apps/overlay && bun run tauri dev
```
Expected: app starts; NO visible window (`main` and `widget` both `visible:false` per `tauri.conf.json`).

- [ ] **Step 3: Grant Accessibility (one-time) and trigger the hotkey**

Grant macOS Accessibility to the terminal running `tauri dev` (System Settings → Privacy & Security → Accessibility), per `apps/overlay/README.md` lines 51-67. Press **`⌘⇧Space`** (the v0 default, ADR-0006 Amendment 2026-05-30).
Expected: centered input panel appears, focused, placeholder `(skeleton: type anything → shows picker)`.

- [ ] **Step 4: HAPPY PATH — type, pick, confirm completion**

Type anything (the mock ignores the text by design), press **Enter**.
Expected: input panel hides; the color-picker widget appears top-right (dark card, question `"Which color do you want?"`, three swatches Crimson / Forest / Azure).
Click a swatch (e.g. Azure).
Expected:
- The overlay status briefly shows `session <uuid> — completed` (the widget **visibly confirms the chosen color** — DoD satisfied).
- The widget window hides.
- In the **daemon terminal**, a line `[daemon] agent final text: you picked Azure (#1E90FF), fun fact: …` appears — this is the Option-A / FU-1 daemon-side log (NOT a wire message). Confirm it is present in the daemon log and absent from the overlay UI.
- Over the wire the session terminated with `session_end{reason:"completed"}` (resolved in `runEcho`'s `.then`).

- [ ] **Step 5: CANCEL PATH — open, close without picking, confirm graceful end**

Re-trigger (hotkey → type → Enter) to show the picker again. Click the **×** (close) button without picking a swatch.
Expected:
- The overlay status shows `session <uuid> — cancelled`.
- The widget window hides.
- No crash in either terminal; the daemon does not retain the session (the `tool_cancel` → `session_end{cancelled}` path ran; the Map entry was deleted at `index.ts:66-67`). **No orphaned/leaked session** — this is the gotcha #2 close-out evidence.

- [ ] **Step 6: CLICK-THROUGH + double-submit + transport-failure spot checks**

- **Click-through (ADR-0006 Option B hard requirement):** re-trigger to show the widget, click on the desktop/another app OUTSIDE the small widget card — the click must land on the app underneath (the widget must not intercept it). Then click a swatch to settle.
- **Double-submit guard:** while a session is pending, a second Enter must NOT open a second session (`main.ts` `inFlight` guard).
- **Transport failure:** stop the daemon, trigger and submit — status shows `error: …`, the panel stays open, Escape dismisses. (Restart the daemon afterward.)

- [ ] **Step 7: Final empty-diff gate + record the demo result**

Re-confirm the frozen surfaces stayed untouched:
```bash
git diff --stat packages/protocol packages/daemon
```
Expected: **empty.** (If the optional rename in Task 2 Step 5 was done, `apps/overlay/src/ws/session-client.ts` etc. will show in `git diff` of `apps/overlay` — that is expected and overlay-only; `packages/protocol`/`packages/daemon` must still be empty.)

Record in the chunk doc (`orchestration/chunks-todo/walking-skeleton-v0/03-end-to-end-wiring-and-demo.md`) a `## Status: done` section with: the `bun test` pass count, the macOS happy-path + cancel-path PASS confirmation (with the daemon `agent final text` log line quoted), the click-through PASS, and a note that all five Done criteria are met. Mirror the 02b-ii close-out format.

- [ ] **Step 8: Commit the chunk close-out + open the PR**

```bash
git add orchestration/chunks-todo/walking-skeleton-v0/03-end-to-end-wiring-and-demo.md
git commit -m "docs(chunk-03): record Walking Skeleton v0 DoD demo PASS on macOS — chunk done

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin chunk/03-e2e-wiring
gh pr create --base main --title "chunk(03): end-to-end wiring + Definition-of-done demo (Walking Skeleton v0 close)" --body "<summary of FU-1 doc reconciliation + gotcha #2 closure + macOS DoD demo result; Lior reviews & merges>"
```
(Archiving the chunk file to `orchestration/chunks-todo/archive/walking-skeleton-v0/` follows the 01/02a/02b-ii precedent — do it in the same PR or as Lior's manual close step, matching how prior chunks were archived.)

---

## Verification

**No "done" claim until every command below shows real output. Per superpowers:verification-before-completion.**

Automated (Task 1, re-confirmed Task 3 Step 7):
- [ ] `bun test` — whole repo green, 0 fail; pass count ≥ the 02b-ii ship count (55). Real summary pasted.
- [ ] `bun run typecheck` (root) — exit 0.
- [ ] `cd apps/overlay && bun run typecheck` — exit 0.
- [ ] `bun run lint:strict` (root) — exit 0.
- [ ] `git diff --stat packages/protocol packages/daemon` — **empty** (frozen contract + daemon byte-untouched; the stop-the-line invariant).

Manual macOS (Task 3 — the authoritative DoD gate, not automatable):
- [ ] Happy path: hotkey → type → picker top-right → click swatch → overlay confirms the chosen color + `session_end{completed}`; daemon logs `agent final text` (Option A, not on the wire, not in the overlay).
- [ ] Cancel path: open → × → `session_end{cancelled}`, graceful, no orphaned session, no crash.
- [ ] Click-through outside the widget works; double-submit guarded; transport-failure shows error + panel stays.

Docs:
- [ ] roadmap lines 57 & 60 FU-1-reconciled (fun-fact framed as Phase-2 `show_text`; DoD = widget confirms selection).
- [ ] `known-gotchas.md` #2 marked resolved-in-skeleton-v0 with the Phase-3 AbortSignal half kept open.
- [ ] chunk-03 doc carries the `Status: done` record.

---

## ADR worthy: no

This chunk records and reconciles already-accepted decisions; it makes no new architectural decision. The session lifecycle (ADR-0001), UI-as-tool-calls resolve/cancel (ADR-0002), WS transport + Origin allowlist (ADR-0003), closed-set primitive render (ADR-0005), and two-zone overlay UX (ADR-0006, with its 2026-05-31 amendment) are all already in force and already realized in the shipped code. FU-1 is the *documentation* execution of chunk-02a's binding Jimmy ruling (Option A), not a new decision; the forward note that agent text is a future `show_text` **tool** (not a 7th envelope variant) is explicitly ADR-0002-preserving. No new dependency, no new boundary, no contract change. Nothing to route to `adr-curator`.

---

## Status: REVIEW-COMPLETE — PR open, awaiting Lior merge (2026-06-02)

Walking Skeleton v0 closed. Behavioral DoD VERIFIED on macOS (happy/cancel/reopen — see `### Task V` above). All 5 chunk Done-criteria met; frozen surfaces (`packages/protocol`, `packages/daemon`) byte-untouched throughout (stop-the-line never triggered); no new runtime dependency.

- **engine-reviewer verdict:** APPROVE WITH NITS. All hard invariants pass. One **major** (multi-monitor `computeWidgetX` ignored `workArea.position`) + one **minor** (off-screen `1500` fallback) fixed in `c6a40e1`; single-monitor behavior unchanged. Remaining items were verified-safe (Escape idempotency, no listener leak, XSS-safe render, predev safety) or cosmetic nits (`ECHO_TIMEOUT_MS` naming — deferred to a future touch).
- **Branch:** `chunk/03-e2e-wiring` (5 commits). **PR:** https://github.com/LiorBraginsky/AgenticEngine/pull/1 → `main`. **Lior reviews & merges.**
- **Deferred (non-blocking follow-ups):**
  - **Overlay / window UX nuances surfaced in the chunk-03 macOS demo (2026-06-02) — documented in `known-gotchas.md` #32–#34, NOT chunk-03 regressions:**
    - #32 multi-monitor — overlay opens on the primary monitor, not the monitor the user is on (`currentMonitor()` on a hidden window → primary). Multi-monitor follow-up.
    - #33 + #34 (**coupled** — input-panel transient-state lifecycle): a stale hide/reset timer closes a freshly-reopened input (#33), and the input retains old text across opens (#34). Fix together in one coherent follow-up (not piecemeal); #33 becomes important once the transient status text is removed/reworked. Relates to the future "clear input after idle timeout" idea and to [[project_input_blur_dismiss_followup]].
  - optional symmetric "cancelled" widget card; `ECHO_TIMEOUT_MS` → `HANDSHAKE_TIMEOUT_MS` rename; `architecture.md` pointer to the ADR-0006 amendment.
