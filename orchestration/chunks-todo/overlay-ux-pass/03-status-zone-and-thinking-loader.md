# Chunk 3: Dedicated status zone + thinking loader + timed error/cancelled

**Status:** todo
**Created:** 2026-06-03
**Phase:** overlay-ux-pass (frontend UX polish, post-llm-text-slice)
**Depends on:** chunk 2 (HARD — gotcha #33 session-scoped timers must be fixed before reworking status text) and chunk 1 (the persist-vs-transient distinction). Sequential, shared overlay lifecycle (§7.1).
**Estimated size:** ~1 day

## Scope

**In:**
- **Dedicated status surface.** Transient session status (thinking / error / cancelled) moves **out from under the input panel** into its own zone, so status no longer clutters the input. (Status is currently written under the input / to the hidden `main` window — both wrong placements.)
- **Frontend-only "thinking" loader.** From the moment a request is submitted until the first content renders (`show_text` / picker / result), show a loader in the status zone. **Frontend-only**: the overlay infers "in-flight" from "session_start sent, no tool_call yet" — **no wire/progress signal, no protocol change.**
- **Timed error status (~2s).** On a session error, show the error in the status zone for ~2s, then auto-dismiss.
- **Symmetric "cancelled" card.** A cancel resolves to a brief cancelled status (mirrors the picker's confirm-then-dismiss), instead of bare text under the input.
- **Crystallize the explicit dismiss-policy** now that all three cases exist: `content` = persist/human-dismiss (chunk 1), `status` = timed auto-dismiss (here), `picker-confirm` = auto ~1200ms (existing). Rule-of-three — a small explicit policy/helper in the renderer, not a speculative type.
- **ADR-0006 amendment**: the dedicated status zone + the unified dismiss-policy (content persists / transient is timed). Builds on chunk 1's content-vs-transient refinement.

**Out:** (each states WHY)
- **Wire-level progress / streaming the model's partial output** ("render what the LLM returns while thinking") — OUT, deferred: Lior explicitly wants this LATER; it needs daemon/protocol work (a progress/stream signal, `tool_progress` is deferred) and pairs with the streaming feature, not this frontend-only pass.
- **Tray/menubar status indicator** (ADR-0006 Decision p.4: running/idle/error) — OUT, deferred (separate menubar feature). This zone is the **per-session transient** overlay status; the tray is **global daemon** status — complementary, not the same surface. Don't conflate.
- **Multi-monitor placement (#32)** — OUT, deferred (window-positioning family, separate).
- **Any `packages/protocol` / daemon change** — OUT, frozen; frontend-only.

## Done criteria

- [ ] **[behavioral]** After submitting a request, a loader appears (LLM "thinking") and is replaced by the answer when it arrives — no "..." under the input (live macOS demo).
- [ ] **[behavioral]** Status (error / cancelled) renders in the dedicated zone, NOT under the input; an error lingers ~2s then auto-dismisses; a cancel shows a brief cancelled card.
- [ ] **[behavioral]** The persistent text answer (chunk 1) still persists; the loader/status do not auto-hide it — content vs transient lifecycle is respected.
- [ ] **[mechanical]** Dismiss-policy is explicit in the renderer (text=persist, status=timed, picker=auto) with a fake-timer test for the timed paths.
- [ ] **[mechanical]** `git diff` only in `apps/overlay`; overlay typecheck + `lint:strict` clean; tests green.

## Orchestrator brief (read by the orchestrator from this file)

```
Add a dedicated status zone to apps/overlay and a frontend-only thinking loader; move transient status (error/cancelled) out from under the input; error lingers ~2s; add a symmetric cancelled card; crystallize the explicit dismiss-policy (text=persist, status=timed, picker=auto).

PREREQUISITE: chunk 2 (gotcha #33 session-scoped timers) must be merged first — reworking status on an unscoped timer re-triggers the stale-timer bug.

Files to touch (frontend-only):
- apps/overlay/src/main.ts / widget.ts — the status surface + event bridge; loader on request-in-flight
- apps/overlay/src/ws/session-client.ts (+ test) — expose "in-flight" so the loader shows between submit and first content; session-scoped timed dismissals
- apps/overlay/src/widget.css / panel.css — status zone styling, loader
- a small dismiss-policy helper in the renderer (text=persist / status=timed / picker=auto)

Behaviour:
- Loader is frontend-only: shown when session_start is sent and no tool_call has arrived; hidden when content renders. NO protocol/wire change.
- Error status ~2s timed; cancelled = brief card; both in the dedicated zone, never under the input.
- Content (chunk 1) stays persistent; transient status is timed.

Done when:
- loader → answer flow visible (demo); error/cancelled in the zone (demo); content still persists; dismiss-policy explicit + fake-timer test; diff only in apps/overlay; overlay typecheck + lint:strict clean.

ADRs in scope: ADR-0006 amendment (dedicated status zone + unified dismiss-policy; builds on chunk 1's content-vs-transient refinement). Flag `## ADR worthy: yes` → architect/adr-curator record the amendment (no new ADR number — amend 0006). Note explicitly: this overlay status zone is per-session transient and is NOT the tray status indicator (Decision p.4, global daemon status) — complementary surfaces.
Out of scope: wire-progress/streaming partial output (deferred, needs protocol), tray icon, multi-monitor #32, protocol/daemon.
```

## Notes / Open questions

- **Status-zone realization is a design decision for the architect:** reuse the `widget` window with a status mode, or a small dedicated status window? ADR-0006 rejected "resize `main` per render" and "single large window." Whichever is chosen, it amends ADR-0006 and must respect the two-window click-through model.
- **Loader is deliberately frontend-only this pass.** Lior's later want — "render what the LLM returns while it thinks" — is the streaming feature (needs a daemon/wire progress signal); it is explicitly deferred, not forgotten.
- Behavioral DoD → Lior's live macOS demo before closeout; fake-timer tests for the timed dismissals (02b-ii lesson).
