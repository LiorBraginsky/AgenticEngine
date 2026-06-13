# Chunk v2-04: forget simplification (durable delete) + end-to-end forget probe

**Status:** todo
**Created:** 2026-06-13
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md` §3.6/§3.7, §5)
**Estimated size:** ~1 day
**Depends on:** v2-03

> **Gated by §5.2** (rides the spec + amendment acceptance; the forget contract is 2c-facing —
> hard-to-reverse tier). Do not start before the conductor confirms acceptance.

## Why this chunk exists

Under incremental + stable ids, fact-forget **simplifies and gets STRONGER**: a forgotten fact's row is
durably deleted and (because nothing re-derives the whole set) stays gone. This chunk delivers that,
narrows the now-mostly-vestigial `forgotten_facts` machinery to its remaining job, fixes a carried
provenance bug, and lands the executed end-to-end probe that demo finding 4 demands.

## Scope

**In** (spec §3.6 D-V6a/b/c, §3.7; carries ADR-0015):
- **fact-forget = durable delete of the stable-id row** (D-V6a). The ADR-0015 **separate-table B1
  invariant, intent dispatch, and HARD message-forget are CARRIED UNCHANGED** (fact-forget still
  touches neither `messages` nor `mutations`, never calls `tombstoneFact`).
- **Narrow `forgotten_facts`** (D-V6b): its only remaining job is suppressing re-derivation across the
  **replay / re-adoption** window. **Layer-T (canonical text-match) runs per-candidate at distill,
  before apply.** **Un-forget** on a high-confidence FRESH conversational re-statement OR a human
  re-pin clears the row. NAMED limits: forget stays sticky until re-pin otherwise; the **cross-lingual
  Layer-T gap** (forgotten-EN won't match re-derived-UK canonical) is documented, not silently broken
  [grill M3/m4].
- **Fix `dropDistilledFactsByProvenance` comma-joined miss** (D-V6c, [grill M4]): match provenance by
  **component** (like `purgeLiveMachineFactsByForget`) so message-forget removes facts derived from
  that message even inside an aggregate provenance.
- **EXECUTED end-to-end forget probe** through the real **`history.html → HTTP → Hatch`** path
  (finding 4 / §3.7): option-B + `GET /memory/cofed` proven correct end-to-end so a future demo can't
  be fooled by a stale build. **Do NOT "fix" the already-correct cofed handler** — prove it.
- Tests: fact-forget durable-delete *stays gone* across a re-dismiss (echo stub); carried B1
  no-downgrade; comma-joined message-forget drops the aggregate fact; un-forget on re-statement;
  cross-lingual limit documented (not a failing test); the executed probe (output in PR).

**Out** (PIPELINE §7.2):
- migration + default flip + demo — v2-05.
- 2c conversational forget — out (the self-concept honesty in v2-01 is the deferral).
- In-overlay UI — out. `@agentic/protocol`, `mock-agent.ts` — frozen.

## §7.1 runtime-coupling note

`WriteGate`(forget) ↔ distiller candidate-fetch (eventually-consistent, carried from chunk 04: immediate
delete covers the live slice; the next distill's Layer-T covers re-derivation). fact-delete must clean
`fact_fts`/`fact_topics` — handled structurally by v2-02's `AFTER DELETE` trigger; re-assert the
count-equality after each forget path here.

## Done criteria

- [ ] **[mechanical]** fact-forget durably deletes the stable-id row; the fact stays gone across a
      re-dismiss with an echo stub; `fact_fts`/`fact_topics` consistent after (count-equality).
- [ ] **[mechanical — carried B1]** `{target_type:"fact"}` on a bare-UUID never scrubs `messages`/
      writes `mutations`; message-forget still HARD-scrubs.
- [ ] **[mechanical]** comma-joined message-forget drops the aggregate-derived fact [grill M4]; un-forget
      clears the `forgotten_facts` row on re-statement/re-pin; cross-lingual gap documented.
- [ ] **[mechanical]** full `bun test` + `lint:strict` + typecheck exit 0; real SQLite, only LLM stubbed;
      frozen surfaces byte-unchanged.
- [ ] **[EXECUTED probe — Strike-5]** forget round-trip through the REAL `history.html→HTTP→Hatch` path
      (fact-forget leaves source intact; option-B scrubs + cofed count shown) RUN, output in the PR.
- [ ] **[behavioral — DEFERRED to v2-05 closing demo]** — no behavioral gate this chunk.

## Orchestrator brief

```
implement memory-distiller-v2 chunk v2-04 per docs/specs/2026-06-13-memory-distiller-v2.md §3.6/§3.7 + §5.
PRECONDITION: spec + ADR-0012 amendment accepted by Lior (§5.2).
Files: write-gate.ts (fact-forget durable delete + un-forget), store.ts (forgotten_facts narrowing,
dropDistilledFactsByProvenance comma-join fix), providers/smart-distiller-provider.ts (Layer-T per-candidate),
hatch.ts / http-routes.ts / history-page.ts (carry intent dispatch + cofed — prove, don't "fix"), probe + tests.
Verification: TDD; carried B1 no-downgrade stays a named gate; the end-to-end probe through the REAL
history.html→HTTP→Hatch path is the finding-4 gate (EXECUTED, output in PR). Real SQLite; only LLM stubbed.
ADRs in scope: ADR-0015 (carried, simplified) + ADR-0012 amendment (durable forget = the stronger 5a).
Frozen: @agentic/protocol, mock-agent.ts.
```

## Notes / Open questions

- Whether `forgotten_facts` shrinks further (since durable delete handles most cases) is architect-time —
  keep it for the replay/re-adopt window; do NOT over-remove (the un-forget + cross-lingual limits are named).
