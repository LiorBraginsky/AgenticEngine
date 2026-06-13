# Chunk v2-02: Incremental store foundation — FTS5 + fact_topics + stable-id delta primitives

**Status:** todo
**Created:** 2026-06-13
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md` §3.3/§3.4/§3.5)
**Estimated size:** ~1.5 day (the store-layer groundwork; widest schema surface of the series)
**Depends on:** v2-01

> **Gated by §5.2** (rides the spec + ADR-0012 amendment acceptance). This chunk lands the schema +
> primitives the incremental distiller (v2-03) builds on — but it carries NO distiller strategy itself,
> so it is safe to land first once the spec is accepted. The conductor confirms acceptance before start.

## Why this chunk exists

The incremental distiller needs store primitives that don't exist yet: a similarity-search surface, a
topic-tag store, and **targeted** (not DELETE-all) fact mutations keyed on a **stable id**. Build the
foundation first, fully tested, so v2-03 is pure strategy.

## Scope

**In** (spec §3.3 D-V3, §3.4 D-V4, §3.5 D-V5; all ADDITIVE — NO `ALTER` on the live sqlite):
- **`fact_topics(fact_id TEXT, topic TEXT)`** join table + index (`CREATE TABLE IF NOT EXISTS`), keyed
  on the now-stable `distilled_facts.id` (one fact → many tags).
- **`fact_fts`** — an FTS5 table over the **`canonical`** match key (+ `topic`, `fact_id UNINDEXED`).
  `canonical` is provided in code at insert/update (a SQL trigger can't compute it). [grill m4: match on
  canonical, display `distilled_facts.fact` in user language.] (Architect: standalone vs external-content
  — §9; confirm FTS5 + the optional trigram tokenizer are present in Bun's SQLite, research UNVERIFIED.)
- **`AFTER DELETE ON distilled_facts` trigger** → `DELETE FROM fact_fts WHERE fact_id = old.id` (and,
  if not handled by explicit deletes, `fact_topics`), so the derived tables can NEVER desync across the
  ~5 delete paths [grill M2 — §7.1].
- **Stable-id delta-apply primitives** (no DELETE-all): `insertFact`→returns the stable id;
  `updateFactById` (REPLACE, recording the replaced text durably for audit); `appendToFactById` (with a
  list-length cap, spec §3.2 m1); `recordReplacedFact`; **BM25 candidate-fetch over the FULL
  `distilled_facts` corpus** returning `{id, fact, topics}` top-K [grill B1 — tags WIDEN, never filter];
  fact-delete helpers that also clean `fact_topics`/`fact_fts`.
- **Per-thread mutation marker** bumped on `appendMessages` AND `edit` AND `forget` (NOT `last_active_at`)
  + a `distilled_through` marker — in an additive `thread_distill_state(thread_id, marker,
  distilled_through)` table (NO ALTER on `threads`) [grill M4 / spec §9].
- Tests: every new primitive RED→GREEN on real SQLite; the **count-equality DoD** below; BM25 returns a
  cross-tag contradicting fact (B1); cap-enforced append.

**Out** (PIPELINE §7.2):
- The distiller strategy / port change — v2-03.
- forget rewiring — v2-04. (This chunk only provides the delete-cleans-derived-tables primitives.)
- `@agentic/protocol`, `mock-agent.ts` — frozen.

## §7.1 runtime-coupling note

NEW derived-state edges: `fact_fts` + `fact_topics` must stay consistent with `distilled_facts` across
insert/update/REPLACE/forget-delete/migration-wipe. Solved structurally by the `AFTER DELETE` trigger +
the count-equality DoD — NOT by trusting each call site [grill M2]. The mutation-marker couples the
human `edit`/`forget` paths to the distiller's future skip decision (v2-03) [grill M4].

## Done criteria

- [ ] **[mechanical]** all new tables/index/trigger created additively; `grep` confirms **no `ALTER
      TABLE`** added; a fresh store and an EXISTING `~/.agentic-engine`-shaped store both open clean.
- [ ] **[mechanical — FROZEN SYNC GATE]** after each fact-delete primitive,
      `COUNT(fact_fts) == COUNT(distilled_facts)` AND no orphan `fact_topics` rows (a dedicated test
      per delete path) [grill M2].
- [ ] **[mechanical]** BM25 candidate-fetch surfaces a contradicting fact carrying a DIFFERENT topic
      tag (tags don't filter) [grill B1]; append cap enforced; `updateFactById` records the replaced text.
- [ ] **[mechanical]** full `bun test` + `lint:strict` + typecheck exit 0; real SQLite, no mocks;
      frozen surfaces byte-unchanged.

## Orchestrator brief

```
implement memory-distiller-v2 chunk v2-02 per docs/specs/2026-06-13-memory-distiller-v2.md §3.3/§3.4/§3.5.
PRECONDITION: spec + ADR-0012 amendment accepted by Lior (§5.2) — do not start before the conductor confirms.
Files: packages/daemon/src/memory/schema.ts (additive tables/FTS5/trigger), store.ts (delta primitives +
candidate-fetch + marker + derived-table cleanup), tests alongside.
Verification: TDD, RED→GREEN; real SQLite; the count-equality sync gate is a NAMED DoD — write it per
delete path. NO ALTER TABLE (grep-gate). NO distiller strategy here.
ADRs in scope: ADR-0012 (+ the 2026-06-13 amendment: stable id, stateful store). Frozen: @agentic/protocol, mock-agent.ts.
```

## Notes / Open questions

- `fact_fts` DDL shape + `fact_topics` cleanup (trigger vs explicit; FK stays OFF per store design) — §9.
- The mutation-marker home (`thread_distill_state` additive table) — architect's call, but **no ALTER**.
