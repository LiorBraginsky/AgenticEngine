# Chunk 4: hybrid ranker (RRF) + distiller candidate-fetch + golden-set eval

**Status:** in-progress
**Created:** 2026-07-13
**Phase:** hybrid-retrieval (2d)
**Estimated size:** ~1–1.5 days
**Depends on:** 03

## Scope

**In (spec §3.4–3.5, §3.8):**
- The hybrid ranker module (spec D4): per-corpus `searchFacts(query,k)` / `searchArchive(query,k)`;
  legs = FTS5 `bm25()` (facts: `fact_fts` canonical; archive: `message_fts` content) + brute-force
  cosine over stored vectors; **RRF fusion (k=60), UNION-then-rank**, total tie-break
  (`rowid DESC` — the chunk-01 lesson, spec D4b); provider `null` ⇒ lexical-only.
- `fetchCandidates` above-cap lane swap (spec D5a): `store.ts:1135-1167` — below
  `ALL_FACTS_CAP` byte-identical; above, hybrid replaces BM25-only. Rewrite the
  `store.ts:16-24/1113-1133` "2d supersedes" comments (no stale contradictions — m3 lesson).
- **The golden-set eval (spec §3.8) — this chunk's acceptance instrument:**
  - fixture file: demo-3 UK/EN colour pair + change case; the 16-rephrase classes (from chunk-02's
    fixture); UA↔EN paraphrase (not-translation) pairs; negative controls.
  - **CONDUCTOR ANNOTATION (Lior ruling 2026-07-14, ledger): the product is NOT positioned as
    Ukrainian-language — frame the eval LANGUAGE-AGNOSTIC.** The UA↔EN pairs stay (they are the
    real dogfood defect cases), but ADD at least 2 non-UA cross-language paraphrase pairs (e.g.
    es↔EN, de↔EN) so the acceptance protects the GENERAL user-language↔canonical-language
    property, not one language. No UA-specific machinery (stemming/tokenizers) anywhere.
  - CI layer: fusion/tie-break determinism on fixture vectors.
  - EXECUTED probe `scripts/retrieval-golden-eval.ts` **on a seeded >`ALL_FACTS_CAP`(=50) store**
    (below the cap the lane under test never runs — spec D5b/[grill #4]): **RED BM25-only baseline
    first** (proves the defect), then hybrid pass with the REAL default-lane model — stdout in the PR.
  - Acceptance bar **pinned to consumer cutoffs** (spec D8b [grill #8]): distiller leg = positive
    cases within `CANDIDATE_TOP_K`(=10) of the FUSED list; search leg = within the result cap;
    zero negative-control violations at the same cutoffs. The eval measures CANDIDATE-SURFACING;
    the end-to-end REPLACE is demo item 1(b)'s job. Fail ⇒ next candidate model (spec D2c) ⇒ still
    fail ⇒ BLOCKED, escalate the §0.1 fork.
- The unicode61 re-check (spec D1b) re-run on the build machine, output in the PR — commit the
  check script here (`scripts/fts5-unicode61-check.ts`; the design pass deliberately did not —
  spec D1b [grill #12]).

**Out:** (WHY — §7.2)
- **`retrieve` (injected-slice) re-ranking** — deliberately out (spec §1 Out: the search tool is
  the designed answer; slice re-ranking is its own future pass with its own trigger).
- **The `memory_search` tool** — chunk-05 (this chunk ends at "the ranker ranks, the distiller
  consumes it").
- **RRF k / leg-K tuning beyond the golden set** — architect-time defaults (facts 20/leg, archive
  50/leg — spec-flagged INFERRED, not cited); do not gold-plate.

## Done criteria

- [ ] **[mechanical]** Ranker determinism tests green (fixture vectors, tie-breaks, UNION
      semantics: a doc found by ONE leg still ranks — D-V4b carried).
- [ ] **[mechanical]** `fetchCandidates` below-cap byte-identical (existing v2 suite green
      untouched); above-cap tests (seed >50 facts or injectable cap — spec §7) show the UK-tail →
      EN-canonical candidate surfacing (RED on BM25-only).
- [ ] **[mechanical]** **EXECUTED golden-set probe output in the PR**: RED baseline + hybrid pass +
      the acceptance bar met, real model, fresh store (Strike-5 — run it, don't just write it).
- [ ] **[mechanical]** unicode61 re-check output in the PR (build-machine versions recorded).
- [ ] **[mechanical]** typecheck 0 · `lint:strict` 0 · `bun test` green · frozen byte-diff empty.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 04 of hybrid-retrieval per orchestration/docs/specs/2026-07-13-hybrid-retrieval.md
§3.4 (ranker) + §3.5 (candidate-fetch) + §3.8 (golden set — the acceptance instrument).

Files to touch:
- packages/daemon/src/memory/embedding/hybrid-ranker.ts (new)
- packages/daemon/src/memory/store.ts (fetchCandidates above-cap lane + comment rewrite)
- packages/daemon/scripts/retrieval-golden-eval.ts (new) + fixture file
- tests: hybrid-ranker.test.ts (fixture vectors), store.test.ts (above-cap lane)

Done when: the Done criteria above hold — the golden-set bar is the gate; a model that fails it
is a BLOCKED escalation (spec D8b ladder), not a silently-lowered bar.

ADRs in scope: ADR-0012 d.6; distiller-v2 D-V4b invariant (hints never reduce the candidate set).
```

## Notes / Open questions

- §4.1 coupling: unchanged method signature, changed above-cap behavior — the reviewer should
  diff the distiller integration tests, not trust the signature.
