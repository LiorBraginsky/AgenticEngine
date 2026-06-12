# Chunk 2: Projection contract — global re-projection semantics (2b, NO LLM)

**Status:** in-progress
**Created:** 2026-06-12
**Phase:** memory-quality (spec `docs/specs/2026-06-12-memory-quality.md` §3.2)
**Estimated size:** ~1 day
**Depends on:** 01 (shared `system-prompt.ts` module + `REMEMBERED_LABEL` constant)

## Scope

**In:**
- **Redefine `MemoryProvider.distill()`** (doc-contract, `memory-provider.ts`): returns
  the **COMPLETE projection over the whole tombstone-honored archive**. Signature kept
  `distill(store, threadId)`; `threadId` = the trigger thread (event rows);
  `DistillResult.threadId` keeps the trigger meaning (grill #2). Projection iterates
  `listThreads()` (store.ts:437).
- **DumbTail + FixedMarker loop all threads** (one tail / one count-fact per thread);
  both stay registered (swap-proof stays meaningful).
- **`registerDistiller` → transactional replace** (spec D4): compute projection first →
  scan EACH fact (5d scanner + per-fact quarantine recording stay per-fact, pre-insert —
  grill #1) → ONE synchronous `db.transaction { dropAllDistilledFacts +
  insertDistilledFacts(clean) + event rows }`. Failure path: provider rejection ⇒ do NOT
  drop; per-thread `trigger="reprojection-failed"` event rows + console.error (test with
  a throwing fake provider).
- **Batch dismiss — ONE re-projection per disconnect** (spec D5): `close(ws)` flips ALL
  touched threads' statuses, then runs ONE re-projection. `ConsolidationHook` gains the
  batch entry point; the single-thread `dismiss()` path stays for compat or is migrated —
  architect's call, but ONE code path runs the projection.
- **Event semantics**: one `distillation_events` row PER dismissed thread in the run;
  `trigger="reprojection"`; `facts_produced` = clean facts in the RESULTING projection
  (same value across the run's rows; documented). Old `trigger="dismiss"` rows remain
  historically valid.
- **Expiry filter** (spec D7): `readDistilledFactsForThread` gains
  `(expiry IS NULL OR expiry > now)` + expired-fact-not-injected test.
- **Carried tests re-asserted under the new semantics** — the named breakages (grill #3,
  q#003 heads-up — so the worker isn't surprised):
  - `distiller-integration.daemon.test.ts` — single-thread swap-proof assertions become
    all-threads; the test uses a SHARED on-disk store and is racy under all-threads
    projection → isolate to a fresh store or convert to set-membership asserts;
  - `distiller-registration.test.ts` — `facts_produced === 1` count assertions change
    meaning (now = resulting-projection size);
  - `fixed-marker-provider.test.ts` — per-thread count-summary assertions become
    one-fact-per-thread set assertions;
  - lossless-integrity + forget-survives-re-derive + distillation-observable re-asserted
    (failure observably distinct from empty-success).

**Out:** (PIPELINE §7.2)
- The LLM / smart provider — deferred to chunk 03 so the contract change is reviewable
  in isolation (this chunk is deliberately deterministic).
- Incremental re-distill + merge — REJECTED per q#001 Sub-2 / q#003 Sub-1 (second source
  of truth).
- Widening `DistilledFact` (`kind` etc.) — REJECTED per q#001 Sub-1.
- An additive `outcome` column on `distillation_events` — the `trigger` values are the
  frozen mechanism; an extra column is architect-time IF needed, and beware: the existing
  `~/.agentic-engine/memory.sqlite` needs a real `ALTER TABLE` migration (`CREATE TABLE
  IF NOT EXISTS` won't alter it) — spec §7.
- `history-page.ts` — frozen OUT (spec §1).

## Done criteria

- [ ] **[mechanical]** new contract documented in `memory-provider.ts`; both providers
      project all threads; registration is compute-first + scan-per-fact + single-tx
      replace; throwing-provider test proves the failure path leaves the projection
      intact and writes `reprojection-failed` rows.
- [ ] **[mechanical]** one re-projection per multi-thread disconnect (real-I/O daemon
      test: one socket touching 2+ threads → close → exactly ONE projection rebuild,
      one event row per dismissed thread, `trigger="reprojection"`).
- [ ] **[mechanical]** expired fact not injected (D7 test).
- [ ] **[mechanical]** all carried proofs green under new semantics: swap-proof,
      forget-survives-re-derive, lossless integrity (messages/mutations byte-identical
      across a re-projection), distillation-observable. Full `bun test` + `lint:strict`
      + typecheck exit 0. Real SQLite I/O, no mocked store (Strike-4).
- [ ] **[mechanical]** frozen surfaces byte-unchanged.

## Orchestrator brief (read by the orchestrator from this file)

```
implement memory-quality chunk 02 per orchestration/docs/specs/2026-06-12-memory-quality.md §3.2 (D4, D5, D6, D7).

Files to touch:
- packages/daemon/src/memory/memory-provider.ts (contract docs)
- packages/daemon/src/memory/providers/dumb-tail-provider.ts, fixed-marker-provider.ts (loop all threads)
- packages/daemon/src/memory/distiller-registration.ts (scan-per-fact + transactional replace + events)
- packages/daemon/src/memory/consolidation-hook.ts (+ index.ts close(ws) wiring) — batch dismiss
- packages/daemon/src/memory/store.ts (expiry filter in readDistilledFactsForThread; tx helper if needed)
- the named test files above

Done when: DoD above green; D6 human-precedence rule honored (dropAllDistilledFacts
already 5e-guards human rows — do not weaken it; human-wins-at-injection ordering is
architect-time).

ADRs in scope: ADR-0012 (5b observability, 5d/5e guards, HARD INVARIANT 1/3).
§7.1 runtime-coupling warning: this chunk changes BEHAVIOR on the dismiss path shared
with index.ts close(ws) and with every test that dismisses threads — the wire stays
frozen; the behavioral contract moves deliberately. Re-validate at integration.
```

## Notes / Open questions

- The LLM-OUTSIDE-tx constraint (spec D4) is load-bearing even though this chunk has no
  LLM: the registration flow you build here is the one chunk 03 plugs into — keep the
  compute→scan→tx phases cleanly separated.
