> 🗄️ ARCHIVED 2026-07-22 — done. Historical record; do not edit.

# Chunk 1: Ruling-2 reconciliation + the `forgetThread` primitive

**Status:** done
**Created:** 2026-07-22
**Phase:** memory 2e (thread-forget)
**Estimated size:** ~1 day
**Depends on:** none — but GATED on Lior's §5.2 acceptance of `specs/2026-07-22-thread-forget.md` (do not start before)

## Scope

**In:**
- **Ruling-2 reconciliation (spec §3.2):** remove the two fact-sweep calls from
  `WriteGate.forget` (`write-gate.ts:111-112`) + the trap comment they carry; DELETE the now
  caller-less `store.dropDistilledFactsByProvenance` / `dropDistilledFactsForThread`
  (`store.ts:786-797`); REWRITE (not delete/skip) the two tests pinning the sweep
  (`write-gate.test.ts:64,80`) to pin the OPPOSITE — facts SURVIVE a message scrub — RED-first
  (they fail on today's code). Migrate the `drop*` count-invariant intent
  (`store.test.ts:80,91,1037,1045`, `embedding-storage.test.ts:125,136`) into the new
  completeness tests.
- **`WriteGate.forgetThread(threadId, ctx, reason?)` (spec §3.1):** ONE tx over every
  not-yet-tombstoned message — tombstone row + `content = REDACTION_MARKER` +
  `deleteMessageDerived` — plus, in the SAME tx: `threads.status='forgotten'` + `title=NULL`
  (q#019 rider 1), `memory_action_events.fact_text` scrub (rows kept, §0.4),
  `mutations.replacement_content` scrub for corrections targeting the thread (critic MAJOR-2).
  **THE ATOMIC-ERASE INVARIANT (q#019 rider 2): no partial-erase state observable.** Machine ctx
  refused outright; unknown thread → typed not-found; idempotent (skip already-tombstoned,
  second call = success). **NO `bumpThreadMarker`** (deliberate — spec §3.1 [critic m5]).
  **STRUCTURAL Ruling-2 rule: zero references to `distilled_facts` / `forgotten_facts` /
  `fact_fts` / `fact_topics` / `fact_embeddings` anywhere in the method.**
- **`store.redactMirrorThread(threadId)` (spec §3.1a):** one pass over the per-thread JSONL —
  redact every `message` line's `content` AND every `edit` line's `replacement`; preserve all
  lines otherwise; missing file = no-op. Post-tx: mirror pass + one
  `mirrorEvent({event:"thread_forget", …})` line. DB-first ordering; the crash window is a
  documented accepted state (spec §3.1a) — do NOT build a reconcile.
- **Tests (spec §5):** the RULING-2 HEADLINE test (every fact row byte-identical across a
  forgetThread, incl. fts/embeddings/topics counts + `forgotten_facts` untouched + the fact
  still injects into a new thread); the erasure-completeness matrix; atomicity
  (mid-tx fault ⇒ fully un-erased); idempotence; distill-no-op over an erased thread (zero ops,
  no LLM call — spy on clientFactory); the thread-scale drain interleave (2d D3b pattern).

**Out:** (spec §7.2 rationale)
- HTTP route / Hatch façade / `isThreadLive` — chunk-02 (this chunk is store+gate only; the
  primitive must land tested before a caller exists).
- Any UI (overlay, history.html) — chunks 02/03.
- `beginTurn` erased-id adoption exclusion — chunk-02 (lifecycle surface, rides with the guard).
- Deleting facts of the erased thread — FORBIDDEN per ADR-0012 rider Ruling 2 (the ×2-flagged
  trap, `write-gate.ts:104-110`); the headline test proves the opposite.
- Startup mirror-reconcile for the crash window — deliberately not built (spec §3.1a).

## Done criteria

- [ ] **[mechanical]** RED-first evidence in the PR: the two flipped write-gate tests fail on
      pre-change code, pass after (facts survive a message scrub).
- [ ] **[mechanical]** `dropDistilledFactsByProvenance` / `dropDistilledFactsForThread` deleted;
      `grep -rn dropDistilledFacts packages/ apps/` → zero non-comment hits.
- [ ] **[mechanical]** Ruling-2 headline test green: after `forgetThread`, every
      `distilled_facts` row byte-identical; `fact_fts`/`fact_embeddings`/`fact_topics` counts
      unchanged; `forgotten_facts` untouched.
- [ ] **[mechanical]** Erasure-completeness matrix green (spec §3.1 table incl.
      `mutations.replacement_content`, `memory_action_events.fact_text`, `title=NULL`,
      `status='forgotten'`, zero `message_embeddings`/`message_fts` rows, mirror clean incl.
      `edit` lines + `thread_forget` event line).
- [ ] **[mechanical]** Atomicity (fault injection ⇒ all-or-nothing), idempotence (no new
      tombstones on repeat), distill-no-op, drain-interleave tests green.
- [ ] **[mechanical]** `bun test` + `bun run lint:strict` + typecheck green; frozen surfaces
      (`@agentic/protocol`, mock reducer) byte-unchanged (`git diff` empty on them).

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 01 of thread-forget (2e) per orchestration/docs/specs/2026-07-22-thread-forget.md
§3.1 + §3.1a + §3.2 + §5 (ONLY the store/gate layer — no HTTP, no UI).

Files to touch:
- packages/daemon/src/memory/write-gate.ts (remove :111-112 fact-sweep + trap comment; add
  forgetThread per spec §3.1 — one tx, machine-ctx refusal, idempotent, NO marker bump)
- packages/daemon/src/memory/store.ts (delete dropDistilledFactsByProvenance/ForThread; add the
  thread-scrub tx helpers the gate needs + redactMirrorThread per §3.1a)
- packages/daemon/src/memory/write-gate.test.ts (flip :64/:80 to facts-survive, RED-first; add
  forgetThread suites per spec §5)
- packages/daemon/src/memory/store.test.ts + embedding/embedding-storage.test.ts (migrate the
  drop* count-invariant intent into forgetThread completeness tests)

Done when: the six checkboxes above are green with command evidence.

ADRs in scope: ADR-0012 rider Ruling 2 (BINDING — facts survive, structural); ADR-0015 (B1
extended to the thread path — never touch fact-side tables); ADR-0016 (untouched).
Runtime-coupling notes: spec §4 items 1/2/5.
```

## Notes / Open questions

- The spec's §3.1 "typed not-found" vs throw: match the house never-throw posture (gotcha #9)
  where cheap; the HTTP mapping lands in chunk-02 either way (spec §7 open-at-build).
- **[orchestrator annotation 2026-07-22 — §7.2 reconciliation lane, not a scope change]** The
  §3.2 test-enumeration is INCOMPLETE. Beyond the listed `write-gate.test.ts:64,80`, grep found
  FOUR more tests that pin the forbidden fact-sweep and go RED once it is removed:
  `distiller-integration.daemon.test.ts:137,173,490` + `hatch.daemon.test.ts:187`. These
  reconcile the SAME way (flip to "facts survive" per Ruling 2) — same accepted-decision
  reconciliation as the enumerated pair, so folded into the plan (Task 1), not escalated. Recorded
  here so the frozen yardstick stays honest for the reviewer. Verified against main @ 951ded9 (spec
  anchors were @ 6785b35; no numeric drift, only under-enumeration).
