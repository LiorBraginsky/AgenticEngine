> 🗄️ ARCHIVED 2026-07-22 — done. Historical record; do not edit.

# Chunk 1: post-2d fix pass — demo findings (D1-lang · D2 · D4) + mechanical tail

**Status:** done
**Created:** 2026-07-22
**Phase:** memory-fix-pass (post-2d, backlog §D-post)
**Estimated size:** ~1 day
**Depends on:** 2d closed (PRs #97–#105 on main)

## Provenance (§7.2 — all items are routed demo findings / reviewer handoffs, NOT new scope)

Source of record: ledger `DEMO-GREEN hybrid-retrieval` (2026-07-21) + `DEMO-EVIDENCE` + backlog
§D-post. Lior rulings already taken: **D4 = update provenance to the replacing thread**
(AskUserQuestion 2026-07-22, option A — replaced_facts already keeps the history, so nothing is
lost); D1/D2 = steering fixes per the demo findings; language-agnostic rule binds (Lior 2026-07-14:
follow the USER's utterance language, never hardcode any language).

## Task

1. **D4 — REPLACE updates provenance (mechanical, ruled):** in the shared `applyFactOp` replace
   lane (and the tool-path REPLACE via `replaces_ordinal`), set the fact's provenance to the
   REPLACING thread (`thread:<current>`). The prior value+provenance is already recorded via the
   `replaced_facts` machinery — verify that record is written BEFORE the provenance flips (history
   intact). Human-fact protections (5e) untouched — this only affects machine-fact replaces.
   RED-first test: the demo repro (fact born in thread A, contradicted in thread B ⇒ provenance
   shows B; replaced_facts row carries A + old text).
2. **D1-lang — fact/reply language follows the USER's utterance (steering, 4 demo datapoints):**
   extend the capability-present system-prompt composition (2c §3.8 lane) + the memory_remember
   steering: the stored fact text AND the reply language should follow the language the USER spoke
   in that turn (EN statement ⇒ EN fact; UA statement ⇒ UA fact). LANGUAGE-AGNOSTIC wording — name
   no specific language (Lior 2026-07-14 positioning ruling). NOTE the canonical stays English by
   design (distiller keyword key — unchanged). LLM-fuzzy: test at the prompt-content level
   (substring assertions on the composed prompt), behavioral proof = next live use (no demo gate).
3. **D2 — no unprompted memory actions (steering):** same prompt lane: the agent must NOT
   forget/rewrite facts the user did not ask about in this turn; on noticing garbage (duplicates,
   contradictions) it PROPOSES cleanup and awaits consent (the sanctioned 2c-demo pattern).
   Boundaries stay honest with existing q#014-E text. Prompt-content tests as above.
4. **Mechanical tail (reviewer handoffs, small):**
   - Extract the shared `isFactVisibleToThread(row, threadId, now)` predicate; use it in BOTH
     `readDistilledFactsForThread` and `MemoryActionPort.search` fact-leg (PR #101 conductor minor
     — kills the visibility-rule drift risk). Behavior-identical refactor; existing suites green.
   - `doWarmup` early-exit when already `ready` (chunk-06 backlog: avoids a second
     InferenceSession on concurrent warmups).
   - Demo-harness arg-parse fail-closed: an unknown `--suite=` value must ERROR, not silently run
     the core suite (the 2026-07-21 confusion — Lior ran --suite=2d on main and got core).
5. **OUT (recorded):** query-pooling-dilution (watch — no incident), 7-seq-calls vs 30s handshake
   (rides streaming/#42/#43), O2/O3 (observations), Memory-window replace-history render (Lior
   declined option C — revisit only on demand).

## DoD

- [ ] **[mechanical]** D4 RED-first repro green; replaced_facts history verified intact.
- [ ] **[mechanical]** Prompt-content tests for D1/D2 (composed capability-present prompt carries
      the language-follow + no-unprompted-actions steering; capability-absent prompt byte-identical
      to pre-change).
- [ ] **[mechanical]** isFactVisibleToThread: one predicate, two call-sites, all existing 5f/search
      suites green untouched.
- [ ] **[mechanical]** Full gates: typecheck 0 · lint:strict 0 · bun test green · degrade suite
      green · frozen surfaces byte-diff empty.
- [ ] No behavioral demo gate (steering fixes prove out in daily dogfood; D4 is mechanical).

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 01 of memory-fix-pass per this file. Authority: ledger DEMO-GREEN/DEMO-EVIDENCE
lines (2026-07-21) + backlog §D-post + Lior rulings recorded above (D4 = provenance follows the
replacing thread; language-agnostic steering). Small pass — do not gold-plate; the OUT list is
deliberate (§7.2). Files expected: apply-fact-op.ts (+store if provenance write lives there),
system-prompt.ts (capability-present additions ONLY), memory-action-port.ts + store.ts (predicate
extraction), local-wasm-embedding-provider.ts (doWarmup), memory-demo-harness.ts (arg-parse).
On DONE: ready-to-merge per crawl §11.4 — conductor re-verifies + merges. This drains the
memory-fix-pass folder; queue then = 2e thread-forget.
```
