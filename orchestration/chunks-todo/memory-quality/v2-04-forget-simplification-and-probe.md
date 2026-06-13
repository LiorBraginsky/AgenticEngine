# Chunk v2-04: forget simplification — fact-forget ONLY (durable delete) + end-to-end probe

**Status:** todo
**Created:** 2026-06-13 (simplified 2026-06-13 per Lior relay-005 + the message-forget-drop refinement)
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md` §3.6/§3.7, §5)
**Estimated size:** ~0.5–1 day (SMALLER than the original — option B + the per-message user path are gone)
**Depends on:** v2-03

> **Gated by §5.2 (ACCEPTED 2026-06-13).** Lior accepted the spec + ADR-0012 amendment, with the
> simplification folded here: **drop option B AND drop the per-message message-forget user path.** The
> conductor confirms before the build starts.

## Why this chunk exists

Under incremental + stable ids, fact-forget **simplifies and gets STRONGER**: a forgotten fact's row is
durably deleted and (nothing re-derives the whole set) stays gone. v2 makes **fact-forget the user's
ONLY forget handle**, drops the now-redundant source-coupling (option B) and the per-message
message-forget user path, and lands the executed end-to-end probe demo finding 4 demands.

## Scope

**In** (spec §3.6 D-V6a/a-bis/b, §3.7; ADR-0015 B1 invariant carried, decision 5 superseded):
- **fact-forget = durable delete of the stable-id row** (D-V6a). The agent stops remembering it; the
  fact's **provenance → conversation link stays as a READ affordance** ("dig deeper"), **never a delete
  target**. The source conversation stays in the lossless archive as substrate.
- **DROP option B end-to-end** (D-V6a-bis): remove `forgetFactAndSources`, the `also_forget_sources`
  flag on `POST /memory/forget`, the `GET /memory/cofed` co-fed-count route, and the history.html
  "also delete N source message(s)" control. **ADR-0015 decision 5 is SUPERSEDED** (record the pointer
  in ADR-0015).
- **DROP the per-message message-forget USER PATH** (D-V6a-bis): remove the `history.html`
  message-"Forget" button and the `target_type:"message"` user route in `http-routes.ts`/`hatch.ts`.
  The user-facing forget is **fact-forget ONLY**. **KEEP the `WriteGate.forget` hard-scrub PRIMITIVE**
  (MF-05 mechanism) — it has no per-message user route now, but the **future THREAD-forget** content
  primitive reuses it. (Do NOT delete the primitive or its unit tests.)
- **`forgotten_facts` necessity — DECIDE and STATE** (D-V6b, architect-time): under durable-delete +
  no-re-derivation, a forgotten fact does not come back on a normal dismiss → the per-dismiss
  suppression job evaporates. Either **(a) retain ONLY as replay-safety** (Layer-T consulted during the
  §3.8 migration replay, NOT per-dismiss) **or (b) drop entirely** (if migration default = "wipe +
  re-distill forward"). **State the call in the PR; do NOT leave a silent contradiction.** Retire grill
  M3's per-dismiss un-forget machinery (no per-dismiss re-derivation to un-forget against).
- **EXECUTED end-to-end probe** through the real **`history.html → HTTP → Hatch`** path (finding 4 /
  §3.7) — proving **fact-forget durable-delete** (the fact stops being used; the row is gone; the
  source conversation is byte-intact). No option-B/cofed. A future demo can't be fooled by a stale build.
- Tests: fact-forget durable-delete *stays gone* across a re-dismiss (echo stub); carried B1
  no-downgrade (fact-forget never scrubs `messages`/writes `mutations`); `WriteGate.forget` primitive
  unit tests stay green; `forgotten_facts` behavior per the (a)/(b) call.

**Out** (PIPELINE §7.2):
- **Option B / per-message message-forget user path** — REMOVED (above), not deferred.
- **THREAD-forget (the future content-forget primitive)** — recorded in the spec §1/§3.6 + the roadmap;
  **NOT built here** (its own feature; pairs with 2d). The `WriteGate` primitive is retained for it.
- migration + default flip + demo — v2-05. 2c conversational forget — out. In-overlay UI — out.
- `@agentic/protocol`, `mock-agent.ts` — frozen.

## §7.1 runtime-coupling note

`WriteGate`(fact-forget) ↔ distiller candidate-fetch — eventually-consistent (carried: the immediate
delete covers the live slice; the §3.4 `AFTER DELETE` trigger keeps `fact_fts`/`fact_topics` in sync —
re-assert count-equality after the forget path). Removing the `target_type:"message"` route + the cofed
route is an HTTP-surface **reduction** (additive fields go away) — `@agentic/protocol` is untouched
(those were never on the frozen wire). The `WriteGate.forget` primitive stays callable internally.

## Done criteria

- [ ] **[mechanical]** fact-forget durably deletes the stable-id row; the fact stays gone across a
      re-dismiss with an echo stub; `fact_fts`/`fact_topics` consistent after (count-equality).
- [ ] **[mechanical — carried B1]** fact-forget never scrubs `messages` / writes `mutations`.
- [ ] **[mechanical]** option B removed (no `forgetFactAndSources`/`also_forget_sources`/`/memory/cofed`/
      button); the per-message message-forget **user path** removed (no button, no `target_type:"message"`
      route); the `WriteGate.forget` **primitive** + its unit tests REMAIN.
- [ ] **[mechanical]** `forgotten_facts` (a)/(b) call made + stated; no silent contradiction.
- [ ] **[mechanical]** full `bun test` + `lint:strict` + typecheck exit 0; real SQLite, only LLM stubbed;
      frozen surfaces byte-unchanged.
- [ ] **[EXECUTED probe — Strike-5]** fact-forget round-trip through the REAL `history.html→HTTP→Hatch`
      path (fact gone + source byte-intact) RUN, output in the PR.
- [ ] **[behavioral — DEFERRED to v2-05 closing demo]** — no behavioral gate this chunk.

## Orchestrator brief

```
implement memory-distiller-v2 chunk v2-04 per docs/specs/2026-06-13-memory-distiller-v2.md §3.6/§3.7 + §5.
PRECONDITION: spec + ADR-0012 amendment accepted by Lior (§5.2 — ACCEPTED 2026-06-13, this simplification folded).
Files: write-gate.ts (fact-forget durable delete; KEEP the hard-scrub primitive, remove no-longer-used
forgetFactAndSources), store.ts (forgotten_facts (a)/(b) call), providers/smart-distiller-provider.ts
(forget layers per the (a)/(b) call), hatch.ts / http-routes.ts (remove target_type:message + cofed +
also_forget_sources; fact-forget only), history-page.ts (remove message-Forget button + option-B control;
keep provenance link as READ affordance), probe + tests.
Verification: TDD; carried B1 no-downgrade stays a named gate; the end-to-end probe through the REAL
history.html→HTTP→Hatch path proves fact-forget durable-delete (finding 4, EXECUTED, output in PR). Real
SQLite; only LLM stubbed. KEEP WriteGate.forget primitive (future THREAD-forget reuses it) — do NOT delete.
ADRs in scope: ADR-0015 (B1 invariant carried; decision 5 SUPERSEDED — add the pointer) + ADR-0012 amendment.
Frozen: @agentic/protocol, mock-agent.ts.
```

## Notes / Open questions

- The future **THREAD-forget** content primitive (scrub a whole conversation's messages via the kept
  `WriteGate` hard-scrub + `dropDistilledFactsForThread`) is recorded in the spec + roadmap — NOT built
  here. The grill-M4 comma-join concern (`dropDistilledFactsByProvenance` exact-string miss) migrates to
  THAT future feature, not this chunk.
- `forgotten_facts` (a)/(b): lean toward **(b) drop** if v2-05 ships "wipe + re-distill forward" as the
  migration default (nothing to resurrect); retain **(a) replay-safety** only if the ordered-replay is
  the default. Architect decides with v2-05.
