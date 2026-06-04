# Chunk 02: Distillation/retrieval provider-port + dumb distiller + cross-thread continuity

**Status:** todo
**Created:** 2026-06-04
**Phase:** Conversation & Interaction Model · route part 1 (Memory foundation)
**Estimated size:** ~1–1.5 days
**Depends on:** 01
**Spec:** `orchestration/docs/specs/2026-06-04-memory-foundation.md` (§3.2, §3.3, §3.4) · **ADR:** [[../../docs/adr/0012-conversation-and-memory-model]] (decisions 4, 6; transparency 5b; the swappable-provider posture borrowed from [[../../docs/adr/0010-pluggable-llm-provider-abstraction]])

## Scope

This chunk adds the **distillation/retrieval seam + the dumb v0 distiller + cross-thread continuity**, gated by the **HARD INVARIANT** (spec §3.2): the archive is the lossless source of truth; the distilled slice is a disposable, re-derivable **projection**; the swap is a real, test-covered path.

**In:**
- **MemoryProvider port** (e.g. `retrieve(thread/context) → distilledSlice`, `distill(thread) → facts`) — a **real** swappable interface mirroring the `AgentProvider` posture (spec §3.2 invariant 2). Not a hardcode past the port.
- **`DumbTailProvider` v0** (read recent thread tails / re-derive) conforming to the port — the deliberately dumb impl (spec §1 Out: smart distiller deferred).
- A **second trivial provider** existing solely to prove the swap (spec §3.2 invariant 3).
- **INJECTION-POINT** — the single place the distilled slice composes into agent context at new-thread start (spec §3.3).
- **`distilled_facts` populated** by the distiller with tags stamped (`provenance`/`scope`/`expiry`/`confidence`/`authored_by:machine`).
- **5b observable distillation:** the distiller fires on chunk-01's consolidation-hook (dismiss) and writes a `distillation_events` record **even when nothing is retained** (spec §3.4, §4.2 — the "deliberately nothing" vs "silently lost" distinction).
- **Tombstone-honoring re-derive + injection (F1):** a re-derived slice and injected context **never** resurface a tombstoned fact (the 01 storage half + this 02 read/inject half together close the forget loop). **Plus (grill S2):** a forget **immediately** invalidates any live `distilled_facts` row referencing the forgotten content — no window where a cached slice injects a just-forgotten fact.
- **Cross-thread continuity:** a new thread draws the distilled slice from prior threads through the real daemon→store path.

**Out:** (each states WHY)
- **Thread-isolation RULES** (scope-tag enforcement vs cross-thread bleed) — OUT, deferred to **chunk 04** (5f); 02 establishes the `scope` tag + the port, **not** the isolation policy.
- **Write-gate scan / no-overwrite** — OUT, **chunk 03** (5d/5e).
- **Hatch UI / read API** — OUT, **chunk 05** (5a).
- **Smart distiller, richer retrieval heuristics** — OUT / frozen per spec §1 + §7; the **port** is frozen, the heuristic is not.

## Done criteria

- [ ] **[mechanical]** `MemoryProvider` port defined; `DumbTailProvider` implements it; a second trivial provider implements it (for the swap-proof).
- [ ] **[mechanical]** real-I/O **swap-proof**: provider A distills → sliceA; drop `distilled_facts`; provider B re-derives → sliceB from the **same untouched `messages`**; `messages` byte-unchanged (lossless); sliceB matches provider B's contract.
- [ ] **[mechanical]** real-I/O **forget-survives-re-derive**: forget a fact (tombstone from 01) → re-derive → the fact is absent from the rebuilt slice **and** from injected context.
- [ ] **[mechanical]** real-I/O **forget-purges-the-LIVE-slice (spec §3.4, grill S2)**: a forget **immediately** invalidates any cached `distilled_facts` row whose `provenance` references the forgotten content — assert the fact is gone from the *current* (un-rebuilt) injected slice, not only after the next re-derive.
- [ ] **[mechanical]** real-I/O **cross-thread continuity**: a new thread's `session_start` injects the distilled slice from a prior thread, through the real daemon→store path.
- [ ] **[mechanical]** real-I/O **distillation-observable** (5b): dismissing a thread writes a `distillation_events` row **even when 0 facts retained**.
- [ ] **[mechanical]** real-I/O **lossless integrity**: the archive is byte-stable across distill / re-derive cycles.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

> No per-chunk live demo (spec §4). Cross-thread continuity is exercised **live** by the route-closing demo (chunk 05); here it is proven by **real-I/O tests**, not mocks.

## Orchestrator brief (read by the orchestrator from this file)

```
implement the distillation/retrieval provider-port + dumb distiller + cross-thread continuity
per orchestration/docs/specs/2026-06-04-memory-foundation.md §3.2/§3.3/§3.4 and ADR-0012.

Files to touch (indicative):
- packages/daemon/src/memory/        (MemoryProvider port; DumbTailProvider; a 2nd trivial provider;
                                      injection-point; distiller that fires on the 01 consolidation-hook)
- packages/daemon/src/index.ts       (compose the distilled slice at session_start{new thread} = the injection-point)
- tests: swap-proof, forget-survives-re-derive, cross-thread, distillation-observable, lossless (ALL real-I/O)

Done when (all real-I/O, no mocked store/injection-point):
- a real MemoryProvider port exists; DumbTailProvider + a 2nd provider conform to it;
- swap-proof: re-derive the slice from the untouched archive with a different provider, archive byte-stable;
- forget-survives-re-derive: a tombstoned fact never returns in slice or injected context;
- cross-thread: a new thread is injected with a prior thread's distilled slice;
- distillation-observable: dismiss writes a distillation_events row even when empty;
- typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0012 (decisions 4, 6; 5b), ADR-0010 (swappable-provider posture).
Frozen — DO NOT: make distilled_facts a separate source of truth (invariant 1); hardcode past the port (invariant 2);
add isolation RULES (chunk 04), write-gate policy (chunk 03), or UI (chunk 05). Dumb distiller only.
```

## Notes / Open questions

- **§7.1 runtime-coupling:** 02 sits on 01's store + consolidation-hook. Re-validate the reality check at integration — the 01 baseline (write-gate, hook, mutation model) must be intact, not assumed.
- **DumbTail retrieval heuristic** (recency vs scope-match) is architect-time (spec §7); only the **port** is frozen.
- **Additional consolidation triggers** (idle-timer) are an optional architect-time addition that must reuse the same hook + event record (spec §7) — not a second path.
