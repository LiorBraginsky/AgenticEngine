# Chunk v2-09: candidate-pool = all facts (genuine change → replace, not duplicate) + over-correction prompt

**Status:** todo
**Created:** 2026-06-16
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md`; ADR-0012 + 2026-06-13 STABILITY amendment; spec §3.2 B1 full-corpus)
**Depends on / BRANCH:** the branch **`chunk/v2-09-candidate-pool-and-replace` ALREADY EXISTS and is checked out** (stacked on v2-08). **CONTINUE on it — do NOT re-branch.** On demo-green the conductor merges the whole stack (v2-05+06+07+08+09) to main.
**Why:** Lior's v2-08 live demo CONFIRMED the recall fix (multi-turn recall GREEN, recall-dedup GREEN, forget-one GREEN), but found TWO remaining related defects the green tests/harness missed (the harness stub *forced* replace, masking the real candidate-fetch gap).

## The two demo-3 defects (debug-log-proven) + the shared root
- **Defect 1 — a genuine preference CHANGE creates a DUPLICATE instead of replacing.** Live: user said
  "Мій улюблений колір тепер зелений" → distiller did `op:new "favorite color is green"`; the existing
  "Мій улюблений колір — синій" was NOT replaced → blue + green coexist. The agent then said (correctly)
  "у моїй памʼяті ДВА записи — синій, потім зелений" — disambiguates, but the STORE accumulates stale
  competing facts (anti-STABILITY; degrades over time).
  **Root (conductor-confirmed in code+log):** `store.fetchCandidates(tailText)` runs FTS5/BM25 matching
  the **Ukrainian tail** against the **English LLM canonical** in `fact_fts` (e.g. tail "колір тепер
  зелений" vs canonical "favorite color is blue") → cross-language lexical matching does NOT connect them
  → the colour fact was NOT in the candidate pool (log: candidates=[name,work], colour missing) → the
  distiller had no candidate to `op:replace` → fell back to `op:new`. CANDIDATE_TOP_K=10 was NOT the
  limit (only 3 facts) — the BM25 MATCH itself is the unreliable cross-language filter.
- **Defect 2 — over-correction ("онови стару інфо в History") still leaks.** Same turn: agent captured
  the change AND told the user to update the old blue info in History. Partly PROVOKED by defect 1 (the
  two-record state gives the agent a stale "old blue" to point at). The v2-07 cannot-self-forget nuance
  did not hold on the real LLM.

## Part 1 — candidate-pool = ALL facts at single-user scale (the structural fix)
- **`fetchCandidates` (store.ts) must return the FULL fact set at single-user scale**, NOT a
  cross-language BM25 MATCH filter. At our scale the corpus is a handful of facts — return ALL distilled
  facts (with their `fact_topics`), ordered stably (e.g. `derived_at DESC`), up to a GENEROUS cap
  (e.g. 50). This is MORE aligned with spec §3.2 B1 "full-corpus" intent than the MATCH filter (which was
  a premature optimization for scale we don't have). Then the distiller ALWAYS sees the same-attribute
  fact → a genuine change resolves to `op:replace` (one fact), not `op:new` (duplicate).
- **Keep a fallback for the future large-corpus case:** if the fact count EXCEEDS the cap, fall back to
  the BM25 MATCH path (the archive-summarization-tier trigger — roadmap). Below the cap, all-facts.
  Document the cap + the rationale.
- **⚠️ RUNTIME COUPLING — the distiller op:replace targeting.** The candidate pool feeds the distiller
  prompt as numbered candidates 1..K → ordinals; `op:replace` copies `targetOrdinal` + `expectedTargetText`.
  A larger pool must NOT break the ordinal mapping or the replace decision. **PRESERVE the
  `expectedTargetText` verification** on replace (a mis-targeted replace must be caught/rejected — the
  safety check against the LLM picking the wrong ordinal in a bigger pool). `candidateIds` logging stays.
  Suppress-only dedup (v2-08) and the B1 invariant must remain intact.
- **Frozen surfaces:** `@agentic/protocol` + `mock-agent.ts` byte-unchanged. This is daemon-internal
  (the candidate query + distiller prompt), NOT the wire.

## Part 2 — over-correction prompt re-tighten
- Re-tighten the agent prompt (system-prompt.ts MEMORY_SELF_CONCEPT) so that when the user STATES a change
  (incl. a correction), the agent acknowledges it and does NOT tell the user to "update the old info in
  History" — the change is captured automatically (now reliably, via Part 1's replace). Only mention
  History for viewing/editing/forgetting EXISTING memories the user did NOT just change. Note: Part 1
  removes the main TRIGGER (no stale "old blue" to point at), so this is the secondary, LLM-fuzzy line.

## Part 3 — harness regression assert (the gap the stub masked)
- **Add a preference-CHANGE → exactly-ONE-fact assert:** seed colour (thread A, dismiss) → in a SEPARATE
  new thread STATE the change ("Мій улюблений колір тепер зелений", dismiss) → assert **exactly ONE colour
  fact** exists (replaced, NOT duplicated) AND it is the new value. With Part 1 (all-facts-candidates) the
  colour fact is always a candidate → the (stub) distiller does `op:replace` → count stays 1. This is the
  assert the v2-08 harness lacked (its STEP 4 change-test was same-flow and the stub forced replace via a
  candidate that real BM25 dropped — make the stub's candidate pool reflect the all-facts behavior).
- Keep the `inject` MEMORY_DEBUG stage + the v2-08 STEP 2b / dedup-after-recall asserts.

## Done criteria
- [ ] **[mechanical]** preference-change→one-fact assert GREEN (no duplicate); v2-08 asserts stay GREEN;
      `bun test` green; typecheck + lint:strict 0; frozen byte-unchanged.
- [ ] **[EXECUTED]** harness (stub + real) green; real-mode shows a colour CHANGE replaces (one colour
      fact, the new value) — report the run (LLM-fuzzy on the exact op, but the candidate pool now
      DETERMINISTICALLY includes the colour fact — verify via MEMORY_DEBUG candidates list).
- [ ] **[behavioral — Lior's LIVE re-demo, §6.1]** the multi-turn demo: a colour CHANGE replaces (agent
      does NOT say "two records / update old in History"), recall multi-turn + dedup + forget-one stay
      GREEN. NOT done until Lior signs.

## Orchestrator brief
/engine-orchestrator do chunk v2-09 from this file. **CONTINUE on the existing `chunk/v2-09-candidate-pool-and-replace` branch** — do NOT re-branch. Runtime-coupling chunk (candidate pool → distiller op:replace targeting) → architect FIRST, then engine-worker, then **engine-reviewer** (+ hard-reviewer if Fable 5 is available; it has been unavailable v2-04..08 — not a precondition). Real-I/O (only the LLM clientFactory may be stubbed). Use MEMORY_DEBUG (the `candidates` list in the distill log) to verify the colour fact is now ALWAYS a candidate. No new ADR (within ADR-0012 + amendment + spec §3.2 B1 — this STRENGTHENS the full-corpus intent); FLAG a spec note if the candidate-pool semantics warrant one (BM25-filter → all-facts-below-cap). Report DONE-ready / BLOCKED-on-Lior-demo; the conductor re-verifies (runs the harness both modes) + routes the §6.1 re-demo.

## NOTE — memory ROADMAP (recorded at feature closeout)
v2-09 closes the demo-3 defects with a cheap structural fix. The roadmap stands: **2d** on-demand archive
retrieval / **semantic (embeddings) candidate-fetch** — the PROPER cross-language/reworded retrieval that
supersedes both BM25 and the all-facts-below-cap stopgap once the corpus grows (archive-summarization
tier is the scale trigger) · **variant B** facts→system-prompt · **2c** agent memory-action tools ·
**thread-forget** · **finer message-level provenance**. Recorded in `docs/roadmap.md` at closeout.
