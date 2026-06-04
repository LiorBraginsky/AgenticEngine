> 🗄️ ARCHIVED 2026-06-03 — done. Historical record; do not edit.

# Chunk 1: Persistent, readable LLM text answer (kill the auto-vanish)

**Status:** done
**Created:** 2026-06-03
**Phase:** overlay-ux-pass (frontend UX polish, post-llm-text-slice)
**Estimated size:** ~0.5 day
**Depends on:** none (headline felt-fix; isolated to the text-reply widget renderer). Sequential before chunks 2–3 only because all three share the overlay session/window lifecycle (§7.1) — but this one stands alone.

## Scope

**In:**
- The `show_text` answer (`apps/overlay/src/widgets/text-reply.ts`) **must persist until the user dismisses it** — remove the ~1200ms auto-dismiss linger that currently makes the answer vanish before it can be read.
- Human-driven dismiss for the text answer:
  - **Escape** dismisses it.
  - **A new request** (next `session_start` / hotkey-submit) dismisses the old answer and starts fresh.
  - **An explicit dismiss affordance** on the card (a `×`), consistent with the cancel control style ADR-0006 (Amendment 2026-06-01) already requires.
- ADR-0006 amendment: distinguish **persistent content** (an LLM text answer is content the user reads → persists, human-dismissed) from **ephemeral transient** (a pick-confirmation / status → auto-dismiss). This **refines, does not supersede**, the 2026-06-01 "confirm-then-dismiss" amendment (the picker confirmation stays ephemeral) and aligns with Decision p.2's original "slightly persistent" widget-zone intent.

**Out:** (each states WHY)
- **Click-outside-to-dismiss for the text widget** — OUT/flagged: the `widget` window is click-through outside its content bounds (ADR-0006 Amendment 2026-05-31), so it does not receive outside clicks; a reliable click-out catcher conflicts with that click-through design. Escape + new-request + explicit `×` cover dismissal; click-out is a stretch the architect may design separately. (Input-window blur-dismiss is different and lives in chunk 2.)
- **The dedicated status zone / loader / error display** — deferred to chunks 2–3 because they depend on the input-lifecycle timer fix (#33).
- **Crystallizing the explicit dismiss-policy abstraction** — deferred to chunk 3, where all three cases (text=persist here, status=timed, picker=auto) exist and rule-of-three justifies the abstraction. This chunk implements text-persist directly, no premature policy type.
- **Any `packages/protocol` / daemon change** — OUT, frozen; this is frontend-only (`apps/overlay`), no wire change, no stop-the-line.

## Done criteria

- [ ] **[behavioral]** An LLM text answer rendered in the widget **stays on screen** and does not auto-vanish on a timer (live macOS demo — Lior reads a multi-sentence reply at leisure).
- [ ] **[behavioral]** Escape dismisses the answer; pressing the hotkey / submitting a new request dismisses the old answer and shows the new flow; the on-card `×` dismisses it.
- [ ] **[behavioral]** The picker confirmation (`✓ Name #HEX`) is **unchanged** — it still auto-dismisses (~1200ms). The persist behavior is text-only, not a global change.
- [ ] **[mechanical]** `git diff` touches only `apps/overlay` (no `packages/protocol`, no `packages/daemon`).
- [ ] **[mechanical]** overlay typecheck + `lint:strict` clean; existing `text-reply` tests updated + green.

## Orchestrator brief (read by the orchestrator from this file)

```
Make the LLM show_text answer persistent and readable in apps/overlay — remove the ~1200ms auto-dismiss for the text reply; it must stay until the user dismisses it (Escape, a new request, or an on-card ×). This is the #1 felt UX pain: the answer currently vanishes before it can be read.

Files to touch (frontend-only):
- apps/overlay/src/widgets/text-reply.ts (+ its test) — persist instead of auto-dismiss; add Escape / new-request / × dismiss
- apps/overlay/src/main.ts and/or src/widget.ts — the event bridge that shows/hides the text widget (new-request must clear the old answer)
- apps/overlay/src/widget.css — the × affordance if needed

Behaviour:
- Text answer persists until human dismiss. Picker confirmation stays ephemeral (~1200ms) — do NOT make persist global.
- Click-outside-to-dismiss is OUT (widget is click-through outside bounds, ADR-0006 2026-05-31) — flag if you want to design it; Escape + new-request + × are the shipped dismissals.

Done when:
- text answer stays until dismissed (demo); picker confirmation unchanged; diff only in apps/overlay; overlay typecheck + lint:strict clean; text-reply tests green.

ADRs in scope: ADR-0006 amendment (content persists vs transient ephemeral — REFINES, not supersedes, the 2026-06-01 confirm-then-dismiss; aligns with Decision p.2 "slightly persistent"). Flag `## ADR worthy: yes` → architect drafts the amendment; adr-curator records it. No new ADR number — it is an amendment to 0006.
Out of scope: status zone / loader / error (chunks 2-3), click-out dismiss, protocol/daemon, dismiss-policy abstraction (chunk 3).
```

## Notes / Open questions

- **Behavioral DoD → live demo required** (PIPELINE.md §6.1): "the answer stays and I can read it" is exactly the kind of behavior code-reading cannot prove. Sequence Lior's macOS demo before closeout docs.
- The ADR-0006 amendment is the load-bearing framing — make sure it reads as a **refinement** (transient stays ephemeral; content persists), not a reversal of the 2026-06-01 amendment. Cite Decision p.2's "slightly persistent" as the original intent this restores.
