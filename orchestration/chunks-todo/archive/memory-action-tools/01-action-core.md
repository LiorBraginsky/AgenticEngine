> 🗄️ ARCHIVED 2026-07-13 — done. Historical record; do not edit.

# Chunk 1: Action core — MemoryActionPort, guardrails, forget/remember paths (no LLM)

**Status:** done
**Created:** 2026-07-10
**Phase:** memory-action-tools (2c)
**Estimated size:** ~1 day
**Depends on:** none — BUT the whole feature is gated: do NOT start before Lior accepts the spec (`specs/2026-07-10-memory-action-tools.md`) + ADR-0016 (§5.2, hard-to-reverse tier)

## Scope

**In:**
- **The rule-gated apply EXTRACTION (spec §3.7a-bis — do this FIRST):** pull the per-op apply logic
  (optimistic-concurrency + never-replace-human demote + record-replaced) out of `distillOneThread`
  into a shared unit callable WITHOUT a `DistillDelta` and with NO watermark/distill-event
  side-effects; both the distiller and the port invoke it. Named DoD: all existing v2 distiller
  tests stay green through the refactor.
- `MemoryActionPort` (daemon-internal, `packages/daemon/src/memory/` neighborhood) implementing the
  two write actions — constructed over Hatch/WriteGate/store **+ the RuleBasedScanner + the
  extracted apply unit** (spec §3.4 D4b — the scanner is a mandatory 5d dependency; no existing gate
  method scans-and-inserts a distilled fact) — spec §3.2–§3.7:
  - **forget:** per-turn ordinal-map + `expected_text` optimistic-concurrency resolution (spec §3.3)
    → `Hatch.forgetFactById(factId, ctx={actor:'agent', authored_by:'machine'}, reason)`; writes the
    `forgotten_facts` record (spec §3.6 D6a) + the audit event (§3.9). Typed results are derived by
    the PORT (pre-resolve the row, confirm the mutation after) — `forgetFactById` returns void and
    cannot signal applied-vs-refused (spec §3.2 D2c derivation constraint).
  - **remember:** 5d scan (flagged ⇒ `rejected_by_scan` + quarantine record, NOT inserted) →
    routing per spec §3.7a (q#015 Ruling 1): explicit `replaces_ordinal`+`expected_text` ⇒ the
    extracted rule-gated replace; mismatched expected-text on an explicit target ⇒ `stale_target`
    with NO side effect (never a fall-through insert); no target ⇒ dedup-check-then-insert →
    stamped `authored_by:'machine'`, thread-shaped provenance (§3.7b — §0 point 3), cross-thread
    scope (§3.7c) + audit event. D6e: a remember matching a `forgotten_facts` row bypasses
    suppression AND clears the row, writing its OWN audit event type (re-assertion, distinct from
    plain remember — q#015 rider).
- **Audit storage + READ path (spec §3.9 D9a/D9b — chunk-04 owns the render):** the additive audit
  table; `hatch.view` returns it additively; `GET /memory/thread/:id` gains the additive field.
  Additive end-to-end, no `ALTER`.
  - **Build guards (spec §3.2/§3.5):** NEVER `deleteMachineFactsByForget` (multi-row over-delete);
    REPLACE via `updateFactById` through the extracted apply — NEVER `editFactById` (stamps human).
- **Per-turn action context** owns the ordinal map + the shared cap counter (ONE object; spec §7
  closure): this chunk enforces + tests the cap against it; chunk-02's loop consumes the same object.
- **d5 wiring (spec §3.6):** delta-apply (distiller-registration) consults `forgotten_facts` before
  applying `op:'new'|'append'` machine candidates whose normalized text matches (D6b); human
  un-forget clear on human fact-author/edit (D6c); distiller prompt nudge (soft layer). FIRST verify
  in-code the table's current dormancy (q#014 rider — do not assume it from the spec).
- **`editFact` machine-ctx guard fix** (write-gate.ts:203-206): reject machine ctx outright
  (defense-in-depth; the promote-to-human hazard) — spec §3.2 D2d note.
- Cap enforcement (`MEMORY_ACTIONS_MAX_PER_TURN = 3`, ONE exported constant — spec §3.4 D4c) +
  typed results for every path (`not_in_view`, `stale_target`, `refused_human_fact`,
  `rejected_by_scan`, `cap_exceeded`, `duplicate` — spec §3.2 D2c; never throw, gotcha #9).
- Audit-event records (spec §3.9 D9a): applied AND refused actions AND D6e re-assertions (own
  type), raw fact text, queryable by thread; `CREATE TABLE IF NOT EXISTS` only, NO `ALTER`.

**Out:** (each states WHY — PIPELINE §7.2)
- Any LLM/`tools[]`/provider change — chunk-02's job; this chunk is provable on real sqlite alone.
- `memory_update` tool — DELIBERATE CUT (spec §0 point 2 / §3.2 D2d): the "prompted edit" lane is
  remember→REPLACE; an explicit machine-edit path carries the editFact promote-to-human 5e hazard.
- Any source-message touch — frozen per ADR-0012 rider Ruling 2 + ADR-0015 B1 (fact path never
  touches `messages`/`mutations`).
- 2d search/read tools — later feature; only the `kind` discriminator slot exists (chunk-02).
- The self-concept prompt flip — chunk-03 (couples to capability detection, not to this core).

## Done criteria

(spec §5 mechanical block; PIPELINE §6.2 — command evidence for all)

- [ ] **[mechanical]** Forget round-trip on the prod boundary: resolved ordinal → row durably gone;
      `fact_fts`/`fact_topics` cleaned (trigger DoD: count-equality); `forgotten_facts` row present;
      audit event written; `messages`/`mutations` byte-intact (B1 carried).
- [ ] **[mechanical]** remember→REPLACE (spec §3.7a, q#015 Ruling 1): explicit target ⇒ REPLACE via
      the extracted apply (id stable, replaced text recorded); mismatched `expected_text` on an
      explicit target ⇒ `stale_target` + NO side effect (no insert, no replace); no target +
      exact-dup ⇒ `duplicate` no-op; human-fact target ⇒ never replaced (5e), competing machine
      insert with honest result message.
- [ ] **[mechanical]** Audit read path: `hatch.view` + `GET /memory/thread/:id` return the audit
      events additively (typed, no cast); D6e re-assertion event type distinct.
- [ ] **[mechanical]** Apply extraction: all pre-existing v2 distiller tests green; the port path
      advances NO watermark and writes NO distill event (spec §4 item 6 named DoD).
- [ ] **[mechanical]** d5 no-re-derivation across ALL THREE op shapes: tool-forget X → dismiss same
      thread with an echo-stub distiller emitting X as `new`, as `append`, AND as a `replace`
      replacement text ⇒ all suppressed/demoted by the D6b consult (test RED without it); human
      re-author/edit of matching text clears the `forgotten_facts` row (D6c); a prompted re-assert
      (D6e) bypasses + clears the row.
- [ ] **[mechanical]** Guardrail refusals, all typed, none throw: out-of-range ordinal ⇒
      `not_in_view`; concurrent text change ⇒ `stale_target`; human fact ⇒ `refused_human_fact`;
      scanner-flagged remember ⇒ `rejected_by_scan` + quarantine + not inserted; 4th action ⇒
      `cap_exceeded`. Machine-ctx `editFact` rejected.
- [ ] **[mechanical]** Real SQLite throughout; no mocked store/Hatch; `bun test` + typecheck +
      `lint:strict` green; frozen surfaces byte-diff empty.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 01 (action core) of memory-action-tools per
orchestration/docs/specs/2026-07-10-memory-action-tools.md §3.2–§3.7, §3.9 (+ §4 couplings 2,3).

GATE: confirm spec status is `accepted` and ADR-0016 is `accepted` before writing code.

Files to touch (expected):
- packages/daemon/src/memory/ — new MemoryActionPort module + audit-event storage (additive DDL);
- packages/daemon/src/memory/write-gate.ts — editFact machine-ctx guard; forgotten_facts write on
  tool-forget path (via the port);
- packages/daemon/src/memory/distiller-registration.ts — extract the rule-gated applyFactOp unit
  (spec §3.7a-bis) + the D6b forgotten_facts consult across new/append/replace-result (machine
  candidates only, 5e precedence chain) + D6c un-forget clear + prompt-nudge plumbing;
  DESIGN NOTE (Lior sign-off rider 2026-07-10, spec D7a-bis rider): applyFactOp = the one shared
  mutation primitive with a growable per-op handler set — simple but extensible; future
  topic-consolidation/append-style ops land as new handlers (backlog §E), build none of them here;
- packages/daemon/src/memory/hatch.ts + http-routes.ts — additive audit read (spec §3.9 D9b;
  render is chunk-04's);
- tests colocated per repo convention.

Do NOT touch: packages/protocol/** (frozen), mock-agent.ts (frozen), providers/anthropic-api-provider.ts
(chunk-02), providers/system-prompt.ts (chunk-03).

Done when: the five DoD blocks above pass with command evidence. §7.1 couplings you are touching:
spec §4 items 2 (port↔distiller shared state — optimistic-concurrency posture) and 3
(forgotten_facts live writer+reader again). Verify forgotten_facts dormancy in-code first and note
the finding in the PR.

ADRs in scope: 0016 (the capability + guardrails), 0015 (B1 + decision-6 contract), 0012 (5d/5e +
rider Ruling 2 source-independence).
```

## Notes / Open questions

- Audit-event storage shape is architect-time (new table expected; additive-only frozen — spec §7).
- The ordinal-map SOURCE (retrieve id-exposure) ships in chunk-02; chunk-01's port takes the map as
  an input and is testable by constructing it directly — keep the seam that way.
