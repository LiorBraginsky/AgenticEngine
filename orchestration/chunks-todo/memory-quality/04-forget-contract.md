# Chunk 4: Forget-flow contract — intent dispatch + durable fact-forget + option B

**Status:** todo
**Created:** 2026-06-13
**Phase:** memory-quality (spec `docs/specs/2026-06-13-forget-flow.md`; ADR-0015 `proposed`)
**Estimated size:** ~1.5 day (the headline corrective chunk; widest blast radius of the pass)
**Depends on:** 03 (smart distiller must exist; this fixes how it is forgotten)

> **Gated by §5.2 sign-off.** The spec + ADR-0015 are `proposed`/`draft`. Per PIPELINE
> Finding #5 this is the **hard-to-reverse tier** — do not start the build until Lior accepts
> the spec + ADR. (This file is the decompose output; the conductor escalates the gate.)

## Why this chunk exists

memory-quality chunk-03 shipped `SmartDistillerProvider`, but the human-facing forget flow was
built for the OLD DumbTail distiller and **silently breaks for smart facts** (a hard-review
finding): fact-forget either HARD-SCRUBS the source message (MAJOR-2, the source-deletion Lior
rejected at §4) or dead-tombstones so the fact re-derives with the §4 best-effort layers never
firing (MAJOR-1). Both are DORMANT today (smart is non-default) and go LIVE the instant
chunk 06 flips the default — so this is a hard flip precondition.

## Scope

**In** (spec §2 D-A/D-B/D-C/D-D/D-F; ADR-0015 decisions 1–5):

- **Intent dispatch (D-A).** Replace `Hatch.forget`'s `isMessageId` shape-router with named
  methods: `forgetMessage(messageId,…)` → `WriteGate.forget` (HARD scrub, unchanged);
  `forgetFact(factText, provenance,…)` (no scrub); `forgetFactAndSources(factText, provenance,…)`
  (option B). `POST /memory/forget` parses `target_type:"message"|"fact"` + optional
  `also_forget_sources:bool` and dispatches. `history.html` sends the shape per button.
- **The separate-table invariant (D-A, FROZEN by q#004 — the B1 fix).** The fact path writes
  ONLY the new `forgotten_facts` table, touches **neither `messages` nor `mutations`**, and
  **never calls `tombstoneFact`**. Keep the `isMessageId`-throw on the message path
  (`WriteGate.forget`/`store.tombstoneFact`). Safety is STRUCTURAL.
- **Durable fact-forget record (D-B).** New `forgotten_facts` table (additive
  `CREATE TABLE IF NOT EXISTS` in `schema.ts` + an index on `normalized_text`; NO `ALTER`).
  `forgetFact` captures `{normalized_text, raw_text, provenance, actor, reason, authored_by,
  created_at}` AND immediately purges the matching live machine row(s) by
  `(provenance = ? OR normalizeFactText(fact) = ?) AND authored_by != 'human'` (handles the
  comma-joined exact string AND the text — no purge-miss).
- **Honest layers (D-B, q#005(b)).** Re-source the suppression in
  `smart-distiller-provider.ts` from `forgotten_facts` (not a deleted `distilled_facts` row):
  **text-match = the one real best-effort layer**; provenance-set match + LLM-exclusion =
  opportunistic nudges. The spec/ADR/code comments must NOT say "3 layers of defense."
- **5e-aware filter + un-forget (D-B, q#005(c)).** The text filter must NOT suppress a
  candidate when a human-authored `distilled_fact` with the same normalized text exists; a
  human authoring/editing a fact whose normalized text matches a `forgotten_facts` row CLEARS
  that row (un-forget — wire it into the human-fact author/edit path). Precedence chain frozen:
  human fact (D6) ▷ human un-forget ▷ machine fact-forget record ▷ machine re-derivation.
- **Option B (D-C).** `forgetFactAndSources` enumerates `provenance.split(",")` → `isMessageId`
  components → hard-scrub each via the existing `WriteGate.forget`. A `thread:<id>` provenance
  → NO-OP with a clear message (never a whole-thread scrub). `history.html`'s fact confirm
  offers a distinct, separately-styled "⚠ also delete the N source message(s)" control whose
  copy surfaces the **source-message count AND the count of OTHER facts those messages feed**.
- **MINOR-1 (D-D).** Fix `readDistilledFactsForThread` so thread-local multi-source facts
  inject into their origin thread(s): resolve the origin-thread set **in code** (split
  provenance → message-id components → their `thread_id`s) rather than the `m.id = provenance`
  join; handles `thread:<id>` uniformly.
- **retrieve() backstop (D-F).** `SmartDistillerProvider.retrieve` filters live rows through
  BOTH the message-tombstone check (`isFactTombstoned`/`isMessageTombstoned`) AND a
  `forgotten_facts` normalized-text check (covers the window between a forget and the next
  re-projection).

**Out** (PIPELINE §7.2):
- MINOR-3 truncation guard → **chunk 05** (different concern; isolates the §7.1 handler change).
- The `MEMORY_PROVIDER` default flip + Lior's live demo → **chunk 06** (last).
- In-overlay memory UI — OUT (spec §1; the demo surface stays `history.html`). NOTE: the
  accepted memory-quality §1 "no chunk may touch `history-page.ts`" guard is **consciously
  lifted for this chunk** (the broken thing IS the forget UI; ADR-0015 records the lift).
- Removing dumb-tail / building 2c — OUT (2c reserves the same contract; spec §4).

## §7.1 runtime-coupling note (decompose flag)

NEW shared-mutable-state edge: **`WriteGate` writes `forgotten_facts`; `SmartDistiller­
Provider.distill` reads it** to build the suppression — two handlers that share no state today
(the 02a→02b-i scar pattern). The forget→distill interleave is **eventually-consistent** (a
forget lands next run; the immediate purge covers the live slice in the gap; MAJOR-3's
promise-queue serializes re-projections, the atomic `forgotten_facts` INSERT is not on it but
needs no ordering). Re-validate at integration: a forget during an in-flight distill must not
corrupt the projection. ALSO couples the human-edit path (`edit`) to the un-forget clear.

## Done criteria

- [ ] **[mechanical — B1 NAMED GATE]** a dedicated **no-downgrade test**:
      `{target_type:"fact", target:<bare-message-uuid>}` leaves `messages.content` byte-INTACT
      AND writes NO `mutations` row (the fact path cannot scrub); `{target_type:"message"}`
      still scrubs. (RED today — MAJOR-2 scrubs.)
- [ ] **[mechanical]** Layer-T fires on the PROD shape: forget a smart fact → SMART
      re-projection with an **echo-stub** `clientFactory` re-emitting it → suppressed via
      `forgotten_facts.normalized_text` (RED without the durable record). Layer-P must NOT
      carry the RED (test the real layer, not the nudge — Strike-4).
- [ ] **[mechanical]** 5e-aware: a human-authored fact with matching text is NOT suppressed;
      human re-authorship clears the `forgotten_facts` row (un-forget).
- [ ] **[mechanical]** option B: forget-fact + `also_forget_sources` scrubs the source(s);
      plain fact-forget leaves them intact; a `thread:<id>` fact → option-B no-op with message.
- [ ] **[mechanical]** MINOR-1: a thread-local multi-source fact injects into its origin
      thread(s) and no other.
- [ ] **[mechanical]** full `bun test` + `lint:strict` + typecheck exit 0; real SQLite + real
      daemon path; ONLY stub = the LLM `clientFactory`. Frozen surfaces
      (`@agentic/protocol`, `mock-agent.ts`) byte-unchanged.
- [ ] **[EXECUTED probe — Strike-5]** a forget round-trip probe RUN (not just written): create
      a smart fact via a real (or recorded) distill, forget it through the real
      Hatch→HTTP-body→WriteGate path, re-project with an echo stub, assert it stays gone +
      source intact. Output evidence in the PR body (no key value printed).
- [ ] **[behavioral]** DEFERRED to chunk 06's feature-closing Lior demo (spec §6) — NO
      behavioral gate this chunk; intermediate chunks are real-I/O proofs (MF posture).

## Orchestrator brief (read by the orchestrator from this file)

```
implement memory-quality chunk 04 per docs/specs/2026-06-13-forget-flow.md (§2 D-A/B/C/D/F,
§3, §6) and ADR-0015 (decisions 1–5). PRECONDITION: spec + ADR accepted by Lior (§5.2) — do
not start before the conductor confirms acceptance.

Files to touch:
- packages/daemon/src/memory/schema.ts          (new forgotten_facts table + index)
- packages/daemon/src/memory/store.ts           (recordForgottenFact / clear (un-forget) /
                                                  forgotten-text match; purge-by-text-or-prov;
                                                  MINOR-1 in-code origin-thread resolution)
- packages/daemon/src/memory/write-gate.ts       (forgetFact = no-scrub + forgotten_facts +
                                                  purge; forgetFactAndSources; un-forget on
                                                  human edit; message forget UNCHANGED)
- packages/daemon/src/memory/hatch.ts            (named methods, delete shape-router)
- packages/daemon/src/memory/http-routes.ts      (target_type + also_forget_sources dispatch)
- packages/daemon/src/memory/providers/smart-distiller-provider.ts
                                                  (layers re-sourced from forgotten_facts;
                                                  honest ranking; 5e-aware; retrieve backstop)
- packages/daemon/src/memory/history-page.ts     (target_type per button; option-B confirmed
                                                  control + co-fed-count) — guard lift per ADR-0015

Verification: TDD; each DoD test RED-without-fix → GREEN. Real SQLite, real daemon path; ONLY
the LLM clientFactory is stubbed. The B1 no-downgrade test is a NAMED gate — write it FIRST.
Do NOT say "3 layers of defense" anywhere (q#005(b)). Escalate the behavioral demo to chunk 06.

ADRs in scope: ADR-0015 (the contract being implemented), ADR-0012 (5a/5e — extended).
Frozen: @agentic/protocol, mock-agent.ts — byte-unchanged.
```

## Notes / Open questions

- The grill recommended splitting this into 04a-dispatch / 04b-record; the conductor (q#006)
  **rejected the split** — they are one inseparable contract (a no-scrub fact-forget with no
  durable record just re-derives → not shippable alone) and the separate-table invariant
  designs B1 out structurally. B1 stays a named DoD gate instead.
- `normalizeFactText` already exists (`smart-distiller-provider.ts:74`) — reuse it (single
  definition) for the store-side purge/match and the layer filter.
