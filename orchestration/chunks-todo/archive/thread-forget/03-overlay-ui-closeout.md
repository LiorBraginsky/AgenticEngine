> 🗄️ ARCHIVED 2026-07-28 — done. Historical record; do not edit.

# Chunk 3: overlay Memory window UI + feature closeout (LIVE demo)

**Status:** done (PR #112 merged 2026-07-22; behavioral §6.1 demo SIGNED by Lior 2026-07-28; the deferred closeout docs-reconcile + §4.4 archival executed 2026-07-28 in the `chunk/thread-forget-closeout` PR)
**Created:** 2026-07-22
**Phase:** memory 2e (thread-forget)
**Estimated size:** ~1 day
**Depends on:** 02 (the HTTP branch + `hatch.view` thread meta + the live-guard)

## Scope

**In:**
- **The affordance (spec §3.4, q#019 Q1/Q2):** one destructive "Forget conversation…" control in
  the thread DETAIL view (NOT on list rows); two-step arm→confirm with the **FROZEN §0.2 copy**
  — *"Erase this conversation's content (N messages)? Distilled facts remain. Cannot be
  undone."* — N = the real count wired at render time (the payload is in scope in the render
  fns, not controller state [critic m6]). On confirm → `memory-write.ts` gains
  `forgetThread(threadId)` (POST per spec §3.3) → existing `handleWriteResult` semantics
  (ok → `refreshCurrentView()`); **409 → a new honest message** ("This conversation is open —
  close it and try again"), additive to the write-result union.
- **The husk render (spec §0.3/§3.5, q#019 rider 1):** list rows with `status='forgotten'`
  badged, neutral label only (no content leak — title is NULL post-erase); detail view renders
  the banner (*"You erased this conversation's content on <date>"*) REPLACING the message list;
  facts section STILL renders with live fact controls (the visible Ruling-2 proof);
  distillation-events unchanged; audit section renders the §0.4 skeleton (`[forgotten]` texts).
- **Overlay tests** (happy-dom, the Theme-A pattern): arm→confirm→POST body; cancel disarms;
  409 message; husk badge + banner from the widened payload; facts controls live on the husk;
  no-content-leak assertion on the husk render.
- **Closeout (docs reconcile, PIPELINE §4.4 duties for the feature):** memory-backlog §C →
  shipped; roadmap 2e tick; ADR-0015 status-note cross-ref (the retained primitive is now
  consumed at thread level; the fact-sweep reconciliation executed); spec `status: draft →
  implemented` + archive ritual ride the ORCHESTRATOR's normal closeout after the demo.
- **Lior's LIVE §6.1 demo — items 1–9 of spec §5** (destructive user-facing flow —
  non-negotiable; includes the q#019 rider-4 mandated set: archive-search miss + fact survival +
  provenance-to-banner + 409/close-then-erase + erased-id re-summon + history.html parity +
  husk-leak check).

**Out:** (spec §7.2 rationale)
- Per-fact "(erased)" provenance badge in fact lists — deliberate cut (cross-view plumbing for
  marginal signal; revisit trigger: dogfood confusion at the provenance link — spec §3.5).
- Rendering the tombstone skeleton on the husk detail — banner only (spec §7; the [forgotten]
  rows are noise, not honesty).
- Any wire/frozen-surface change — the Memory window is daemon-HTTP + overlay render (Theme-A
  pattern).
- Bulk forget / undo — out per spec §1 (recorded with triggers).

## Done criteria

- [ ] **[mechanical]** Overlay test suite green (arm/confirm/cancel/409/husk/no-leak); full
      `bun test` + `lint:strict` + typecheck green; frozen surfaces byte-unchanged.
- [ ] **[behavioral]** The complete §6.1 LIVE demo, items 1–9, signed by Lior — including THE
      TRAP LIVE (fact survives + still recalled in a new thread) and the honest-asymmetry
      framing of item 4 (a facts-leg hit is Ruling 2 working, NOT a leak).
- [ ] **[mechanical]** Docs reconcile committed (backlog §C, roadmap, ADR-0015 cross-ref).

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 03 of thread-forget (2e) per orchestration/docs/specs/2026-07-22-thread-forget.md
§3.4 + §3.5 + §0.2/§0.3 (frozen copy + husk) + §5 (demo items 1–9).

Files to touch:
- apps/overlay/src/memory/render.ts (detail-view control + husk banner + badge + audit skeleton
  render)
- apps/overlay/src/memory/actions.ts (thread-forget arm→confirm, frozen copy w/ real count)
- apps/overlay/src/memory/controller.ts (wire action + 409 message + refresh)
- apps/overlay/src/memory/memory-write.ts (forgetThread POST + result-union widening)
- apps/overlay/src/memory/types.ts (HatchView thread-meta widening)
- overlay test files per the existing per-module pattern
- docs: orchestration/docs/memory-backlog.md §C, orchestration/docs/roadmap.md, ADR-0015
  status-note cross-ref (closeout commits AFTER the demo is signed — PIPELINE §6.1 sequencing)

Done when: the three checkboxes above are green; the demo is SIGNED BEFORE closeout docs commit.

ADRs in scope: ADR-0012 rider Ruling 2 (the demo proves it live); ADR-0013 (writes via bearer);
ADR-0016 (audit skeleton render only — no tool changes).
Runtime-coupling notes: spec §4 items 3/4/8.
```

## Notes / Open questions

- Exact copy/placement/banner styling are architect-time (spec §7) EXCEPT the frozen §0.2
  confirm sentence (q#019 rider 3 — verbatim, user-facing contract).
- **[carried from chunk-01 review 2026-07-22 — engine-reviewer NIT]** `forgetThread` is idempotent
  for tombstones (the `NOT EXISTS` filter adds zero new ones on repeat) but a repeat call still
  appends a SECOND `{event:"thread_forget", created_at}` line to the JSONL mirror (N re-erases → N
  lines; harmless + arguably audit-honest). The husk banner render (spec §3.5, "You erased this
  conversation's content on <date>") reads `thread_forget.created_at` — it must tolerate N such
  mirror lines and pick a DETERMINISTIC one (first = original erase date, recommended; or last).
  Don't assume exactly one.
