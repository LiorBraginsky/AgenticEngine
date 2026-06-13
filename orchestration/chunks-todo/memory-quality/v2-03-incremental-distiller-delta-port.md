# Chunk v2-03: The incremental distiller — delta port + asymmetric-risk apply

**Status:** todo
**Created:** 2026-06-13
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md` §3.1/§3.2/§3.3, §6)
**Estimated size:** ~2 day (the heart of the re-architecture; the §7.1 port change)
**Depends on:** v2-02

> **Gated by §5.2** (the spec + amendment acceptance). This is the chunk that AMENDS ADR-0012's HARD
> INVARIANT in code — do not start before Lior accepts.

## Why this chunk exists

Replace the **global re-projection** strategy (`distill()`→FULL projection; `replaceProjection`=
DELETE-all+INSERT) — the churn root Lior's demo killed — with **incremental, stable-id** distillation.
This delivers the headline **STABILITY** guarantee.

## Scope

**In** (spec §3.1 D-V1, §3.2 D-V2, §3.3 D-V3, §6):
- **Redefine the `MemoryProvider` port** to return a **`DistillDelta`** (`{threadId, ops:FactOp[],
  distilledThroughMarker}`, `FactOp={op,fact,canonical,topics,targetOrdinal?,expectedTargetText?}`) —
  spec §3.1. The port is NOT frozen (only `@agentic/protocol`+mock are) — but this is a **§7.1
  behavioral-contract change**; flag it loudly.
- **Rewrite `SmartDistillerProvider.distill`**: read ONLY the just-ended thread's **new tail** (since
  its `distilled_through` marker — [grill M4]); per candidate, FTS5 BM25 over the **full corpus**
  (v2-02) → top-K as `{ordinal:1..K, fact, topics}`; the LLM proposes `op` + **`targetOrdinal`** (small
  int, NOT a uuid — [grill B2]) + `canonical` + `topics` + user-language `fact` + `expectedTargetText`.
  LLM + FTS5 OUTSIDE any tx (grill-#6 seam).
- **Registration delta-apply** (`distiller-registration.ts`): ONE synchronous tx applies the delta;
  **the `distilled_through` marker advances INSIDE the same tx** [grill M1]; scanner scans each
  new/changed fact pre-insert. **Rule-gated destructive path** [grill B2/M5]: resolve `targetOrdinal`→
  id (out-of-range → demote to `new`); **optimistic-concurrency** (target's current text ≠
  `expectedTargetText` → conflict → non-destructive); **machine never replaces a human fact** (5e);
  REPLACE records replaced text. **NO DELETE-all.**
- **Never-drop re-purpose** [grill M1]: no projection to drop; on failure the guard does not advance →
  retry next dismiss; record a per-thread `distill-failed` (re-use the chunk-05 `trigger` param), no
  misleading projection-size number. Keep the `stop_reason` guard → `distill-truncated` (defensive).
- **MAJOR-3 promise-queue KEPT** [grill M5]; update its comment — "latest-wins" → "non-destructive on
  concurrent same-target conflict" (the optimistic check is the mechanism).
- **Swap-proof story** [grill B3 / spec §6]: **retire `FixedMarkerProvider`**; **adapt
  `DumbTailProvider` to the delta port** (op:`'new'`-only, idempotence-guarded) = keyless fallback +
  swap-proof second leg; **rewrite the swap-proof test** to assert the delta-port + stability contract
  (not equal full-projections). Rewrite the now-false re-derivability doc comments
  (`memory-provider.ts`, `dropAllDistilledFacts` purpose) [grill m3 / amendment].
- **THE STABILITY TEST** (spec §5, the headline) + **idempotence test** + **asymmetric-risk tests** +
  **EXECUTED real-API probe** — all on a **FRESH store** (q#011 rider).

**Out** (PIPELINE §7.2):
- forget rewiring (durable delete, `forgotten_facts` narrowing) — v2-04.
- migration + default flip + demo — v2-05.
- `@agentic/protocol`, `mock-agent.ts` — frozen.

## §7.1 runtime-coupling note

THE port redefinition (full-projection → delta) ripples through `distiller-registration.ts`,
`memory-provider-selector.ts`, and both other providers [grill B3/M1]. The MAJOR-3 queue's correctness
now rests on the optimistic-concurrency check, not on DELETE-all latest-wins [grill M5]. Re-validate at
integration: two queued runs targeting the same stable fact id must not corrupt (conflict → non-destructive).

## Done criteria

- [ ] **[mechanical — STABILITY GATE]** with a deterministic echo/stub LLM, seed "User's name is Lior",
      run N dismisses producing overlapping candidates → the fact's **id unchanged**, text **byte-
      identical**, injected-slice **order stable**, **nothing vanished** (RED on the global-reprojection
      strategy) [finding 1].
- [ ] **[mechanical]** idempotence: re-distill an unchanged thread → 0 changes; re-adopt + 2 new
      messages → only new facts, no dups [grill M4].
- [ ] **[mechanical]** asymmetric-risk: out-of-range `targetOrdinal` → `new`; concurrency conflict →
      non-destructive; never-replace-human; REPLACE records replaced text [grill B2/M5].
- [ ] **[mechanical]** swap-proof rewritten + GREEN; FixedMarker retired; DumbTail delta-adapted +
      idempotence-guarded; re-derivability doc comments rewritten [grill B3/m3].
- [ ] **[mechanical]** full `bun test` + `lint:strict` + typecheck (incl. apps/overlay) exit 0; real
      SQLite, only the LLM `clientFactory` stubbed; frozen surfaces byte-unchanged.
- [ ] **[EXECUTED probe — Strike-5]** real conversation → incremental distill on a fresh store →
      stable facts; output evidence in the PR (no key printed).
- [ ] **[behavioral — DEFERRED to v2-05 closing demo]** — no behavioral gate this chunk (real-I/O proof).

## Orchestrator brief

```
implement memory-distiller-v2 chunk v2-03 per docs/specs/2026-06-13-memory-distiller-v2.md §3.1/§3.2/§3.3 + §6.
PRECONDITION: spec + ADR-0012 amendment accepted by Lior (§5.2).
Files: memory-provider.ts (delta port + rewritten docs), providers/smart-distiller-provider.ts (incremental
rewrite), distiller-registration.ts (delta-apply + guard-in-tx + never-drop re-purpose + concurrency),
providers/dumb-tail-provider.ts (delta op:'new' adapt), DELETE providers/fixed-marker-provider.ts,
memory-provider-selector.ts (registry), store.ts (consume v2-02 primitives), tests + probe.
Verification: TDD; the STABILITY test is the NAMED headline gate (write it FIRST, RED on the old strategy).
Real SQLite; ONLY the LLM clientFactory stubbed; EXECUTED probe on a FRESH store. Flag the port change §7.1.
ADRs in scope: ADR-0012 + its 2026-06-13 amendment (this chunk implements the amendment in code).
Frozen: @agentic/protocol, mock-agent.ts.
```

## Notes / Open questions

- K, canonical-normalization algorithm, BM25 query, high-confidence threshold encoding — §9 (architect).
- If DumbTail's delta-adaptation isn't cheap, retiring it too is acceptable — keep ONE production impl +
  one test-double either way (spec §6).
