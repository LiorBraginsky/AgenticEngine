# v2-09: Candidate-Pool = All Facts (genuine change → replace, not duplicate) + Over-Correction Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All paths repo-relative to `/Users/lior/WebstormProjects/playground/AgenticEngine`.

**Goal:** Make `fetchCandidates` return the FULL distilled-fact set (stably ordered, up to a generous cap) at single-user scale so a genuine preference CHANGE always finds the same-attribute fact as a candidate and resolves to `op:replace` (one fact), not a cross-language BM25 miss → `op:new` (a blue+green duplicate); re-tighten the over-correction prompt; add the harness preference-change → exactly-one-fact regression assert.

**Architecture:** Three small daemon-internal changes — (1) `fetchCandidates` (store.ts) gets an all-facts-below-cap path with a BM25 fallback above the cap; (2) `MEMORY_SELF_CONCEPT` (system-prompt.ts) over-correction clause tightened; (3) the harness adds a separate-thread CHANGE → exactly-one-colour-fact assert and the stub candidate-pool now reflects all-facts behavior. The op:replace ordinal/`expectedTargetText` contract is invariant to pool size because the prompt's numbered pool AND `delta.candidateIds` derive from the SAME ordered candidate list (`fetchCandidates` order = ordinal order = `candidateIds` index order). No wire/port/dependency change. Build ON the checked-out `chunk/v2-09-candidate-pool-and-replace` branch (stacked on v2-08).

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (real, never mocked); `@anthropic-ai/sdk` (Haiku — only `clientFactory` stubbed); WS + HTTP over the real `startDaemon`. No new dependency.

---

## Status: Done

The plan is complete and worker-executable. No design fork requires Lior's input: the cap value (50), the order key (`derived_at DESC` realized via stable `rowid`), and the fallback boundary are architect-time `## 9 Open at build` items the spec explicitly delegates, and the all-facts direction is settled by the chunk + spec §3.2 B1 / §3.4 D-V4b (see `## Frozen-conflict check` — no conflict; one optional spec-note FLAG raised, flag-only, not blocking). One genuine ambiguity (cap value / fallback ordering) is resolved in `## Approaches` with the chosen option stated, not escalated.

---

## Reality check

Every claim below is grounded in file evidence read by the architect. **Behavioral/runtime claims are flagged "requires runtime demo to confirm" (PIPELINE §6.1) — never asserted "verified" from code-reading. Prior PASS records and the harness are NECESSARY-not-SUFFICIENT (the route lied 5× / falsified 3× in v0).**

### The cross-language BM25 failure is CONFIRMED (code-path) — and `CANDIDATE_TOP_K` is NOT the limiter

- `fetchCandidates(query)` is `packages/daemon/src/memory/store.ts:979-995`. It runs `toFtsOrQuery(query)` (`store.ts:140-144`: lowercase → strip non-word chars → quote each token → OR-join) then `SELECT … FROM fact_fts f JOIN distilled_facts d ON d.id = f.fact_id WHERE fact_fts MATCH ? ORDER BY bm25(fact_fts) LIMIT CANDIDATE_TOP_K`. **The MATCH is over `fact_fts.canonical`** (`store.ts:983-989`; the `fact_fts` column indexes `canonical`, per spec §3.4 D-V4c).
- The distiller passes the **tail text** (the user's just-said messages, role/id-prefixed) as `query`: `smart-distiller-provider.ts:543` `const candidates = store.fetchCandidates(tailText);`, where `tailText` is built at `smart-distiller-provider.ts:537-540` from the new-tail messages.
- The stored colour canonical is English-canonical (e.g. harness seed "Люблю синій колір" → stub stores `canonical: "user likes blue colour"`, `memory-demo-harness.ts:250`; real distiller produces an English/canonical match key per spec §3.4 D-V4c). The CHANGE tail is Ukrainian ("Тепер мій улюблений колір — зелений"). `toFtsOrQuery` tokenizes the Ukrainian words; none overlap the English canonical tokens → `fact_fts MATCH` returns 0 rows → the colour fact is **dropped from the candidate pool**. **This is the demo-3 duplicate-colour root the chunk describes.** *(The cross-language miss is deterministically reproducible with a real store + a Ukrainian-tail change against an English-canonical fact — Step 3 / Task 3 makes it a gate; the live-demo effect "requires runtime demo to confirm.")*
- `CANDIDATE_TOP_K = 10` (`store.ts:15`). The demo had only ~3 facts, so the `LIMIT 10` clause was NOT the limiter — **the BM25 MATCH filter itself dropped the colour fact** (chunk's claim CONFIRMED). The fix is therefore the MATCH predicate, not the limit.

### The op:replace ordinal → id contract is INVARIANT to pool size (CONFIRMED code-path — the runtime-coupling heart)

- The prompt's numbered candidate pool is built at `smart-distiller-provider.ts:546-554`: `candidates.map((c, i) => \`${i + 1}. ${c.fact}…\`)` — ordinal = array index + 1, in `fetchCandidates`'s returned order.
- `delta.candidateIds` is built from the **same array, same order**: `smart-distiller-provider.ts:544` `const candidateIds = candidates.map((c) => c.id);`.
- The apply loop resolves the target via `targetId = delta.candidateIds[op.targetOrdinal - 1]` (`distiller-registration.ts:184`). So `targetOrdinal` (the small integer the LLM copies back) indexes the same ordered list the LLM was shown. **As long as the prompt pool and `candidateIds` continue to derive from one ordered list (they do), enlarging the pool cannot break ordinal mapping** — a bigger pool just means more numbered lines and a longer `candidateIds`, all consistent. *(This is the structural reason the chunk routed to architect-first.)*
- **`expectedTargetText` verification is PRESERVED by construction** — it is checked in the apply loop, not in `fetchCandidates`: `distiller-registration.ts:199` `else if (currentRow.fact !== op.expectedTargetText)` → `effectiveOp = "new"; targetId = undefined` (non-destructive demote). Out-of-range ordinal → demote (`distiller-registration.ts:208-211`); target gone → demote (`:195-198`); human target → demote (`:203-206`). **None of these touch `fetchCandidates`; this plan does not modify `distiller-registration.ts`, so the entire mis-targeted-replace safety net is untouched.** A larger pool makes a wrong-ordinal pick statistically more possible, but `expectedTargetText` catches it deterministically — the safety net the chunk requires preserved is exactly this code, left byte-unchanged.
- `candidateIds` logging stays: the distill-input log at `smart-distiller-provider.ts:558-572` emits `candidates: candidates.map((c, i) => ({ ordinal: i+1, id, factPreview }))` — this is the MEMORY_DEBUG `candidates` verification surface the chunk names, and it will now show the colour fact ALWAYS present. The op-apply log carries `candidateIds` via `debug-log.ts:18`. Both are preserved (this plan only changes the rows `fetchCandidates` returns, not the logging).

### The v2-08 SUPPRESS-ONLY dedup guard does NOT use `fetchCandidates` (CONFIRMED — no collision)

- The dedup guard added in v2-07/v2-08 uses `store.factExistsByDedupKey(newItemCanonical)` (`distiller-registration.ts:255`, `:277`) — a full-table scan helper, NOT `fetchCandidates`. grep confirms `fetchCandidates` has exactly two production callers: `smart-distiller-provider.ts:543` (the candidate pool) and tests. **So enlarging `fetchCandidates` affects ONLY the distiller's contradiction-candidate pool, and the suppress-only dedup guard (which prevents the recall-reply duplicate) is structurally independent and stays intact.** The two duplicate-prevention layers compose: the bigger pool makes a CHANGE resolve to `op:replace` (no duplicate from a missed candidate); the suppress-only guard still no-ops a same-canonical `op:new` (no duplicate from a re-stated fact). Neither weakens the other.

### The B1 count-equality invariant (`fact_fts == distilled_facts`) is untouched (CONFIRMED)

- B1 (spec §3.4 D-V4d, §3.5) is maintained by the `AFTER DELETE ON distilled_facts` trigger + the in-code `fact_fts`/`fact_topics` writes at insert/update. `fetchCandidates` is **read-only** (a `SELECT`); changing which rows it returns cannot affect any count. The B1 invariant is not on the `fetchCandidates` path at all. *(No change to insert/delete paths in this plan → count-equality holds by the same mechanism as before; the harness still asserts it where it already did.)*

### Spec §3.2 B1 "full-corpus" intent — the chunk's reading is CORRECT (CONFIRMED doc-path)

- Spec §3.2 Failure-mode-B: *"Critically, B1's full-corpus fetch — not tag-scoping — is what keeps B [missed contradiction → duplicate] rare (see §3.4)."*
- Spec §3.4 D-V4a: *"FTS5/BM25, NOT embeddings"* — the chosen NOW tool, with the explicit caveat that *"the residual synonym/antonym gap … is judged by the LLM already in the distill call over the FTS5 hits"* and *"Local embeddings … deferred to 2d."*
- Spec §3.4 D-V4b (FROZEN INVARIANT): *"the contradiction-detection candidate set is never *reduced*… BM25 runs over the **full** `distilled_facts` corpus."*
- `store.ts:970-972` already documents `fetchCandidates` as *"BM25 candidate-fetch over the FULL distilled_facts corpus (spec §3.4 D-V4b — the FROZEN B1 invariant: tags WIDEN recall, they NEVER reduce the candidate set)."*
- **Reading confirmed:** the spec's *intent* is "the contradiction candidate set must include the contradicting fact." BM25 was the chosen *mechanism* (D-V4a) but is a **cross-language-lossy** realization of "full corpus, never reduced" — it silently reduces the set when the tail language ≠ the canonical language, the exact failure D-V4b forbids ("never *reduced*"). Returning **all facts below a cap** is a STRICTLY MORE FAITHFUL realization of D-V4b's "full corpus, never reduced" than the BM25 MATCH (which reduces on a cross-language miss). So the chunk STRENGTHENS the frozen B1 invariant rather than contradicting it. *(Doc-grounded; the falsifying behavior — BM25 dropping a cross-language fact — is reproduced in Task 3.)*

### Part 2 — the over-correction prompt reality (CONFIRMED code-path)

- `MEMORY_SELF_CONCEPT` (`system-prompt.ts:33-50`) ALREADY carries the v2-07 over-correction clause (`:46-48`): "New things the user tells you — including corrections — ARE captured automatically; do NOT tell the user to update the History page for information they just gave you. Only mention the History page for viewing, editing, or forgetting EXISTING remembered facts." The D1-8 comment (`:29-31`) documents it.
- The v2-07/v2-08 demos showed this clause leaks on the real LLM (chunk Defect 2: agent still said "онови стару інфо в History"), PARTLY because Defect 1 left a stale "old blue" fact to point at. **Part 1 removes the main trigger** (no duplicate → no stale "old blue"); Part 2 re-tightens the wording as the secondary line. This is an LLM-fuzzy prompt edit — *reliability requires runtime demo to confirm; never assert from code-reading.* The change is a string strengthening + a `system-prompt.test.ts` presence assert + the existing D1-1..D1-8 clauses MUST survive (don't drop one while adding one).

### Part 3 — the harness STEP 4 gap + why the stub masked it (CONFIRMED code-path)

- The harness CHANGE test today is STEP 4 (`memory-demo-harness.ts:641-676`). It is **same-flow** (the colour fact was seeded into the same store earlier in the same run at `:461`) and asserts only `colourNowGreen = factsAfterChange.some(f => f.fact.includes("зелений"))` (`:663`) + name/work-stable. **It does NOT assert exactly-one colour fact** — a blue+green duplicate still has a green fact, so `colourNowGreen` is true and STEP 4 passes while the store holds two competing colour facts. This is the gap.
- The stub op-derivation: `buildScriptedClient` (`memory-demo-harness.ts:196-283`) reads the candidate pool FROM the prompt's `EXISTING FACTS` section (`:210-216` `candidateLines`), finds the colour candidate (`:221-223` `colourCandidateIdx`), and does `op:replace` ONLY when `colourCandidateIdx !== -1` (`:262-273`), else falls to `op:new` (`:274-281`). **The stub faithfully mirrors production: replace only if the colour fact is in the pool.** Because `fetchCandidates` runs real BM25 even in stub mode (the LLM is stubbed, the store is real), the Ukrainian change tail vs the English colour canonical → BM25 returns 0 → `colourCandidateIdx === -1` → the stub does `op:new` → duplicate. So in stub mode STEP 4 today ALSO creates a duplicate, but its assert can't see it. **The chunk's "the stub forced replace via a candidate real BM25 dropped — that masked the gap" is CONFIRMED in its effect: STEP 4's assertion masked the duplicate; Part 1 (all-facts) makes the colour fact ALWAYS a candidate so the stub deterministically does `op:replace` and count stays 1.** *(The exactly-one-fact assertion is deterministic in stub mode once Part 1 lands; this is RED before Part 1, GREEN after — Task 4.)*
- `countColourFacts(dir)` already exists (`memory-demo-harness.ts:95-104`: `SELECT id FROM distilled_facts WHERE fact LIKE '%синій%' OR '%зелений%' OR '%колір%' OR '%Люблю%'`) — Part 3 reuses it for the before/after count. The v2-08 STEP 2b hard-assert (`:537-562`), the DEDUP-AFTER-RECALL assert (`:960-987`), and the `inject` MEMORY_DEBUG stage must all be kept (chunk Part 3).

### Frozen-surface check (FLAG-cleared)

- `@agentic/protocol` (`packages/protocol/`) and `packages/daemon/src/mock-agent.ts` are the ONLY byte-frozen surfaces (CLAUDE.md). NONE are touched: all edits are daemon-internal — `store.ts` (`fetchCandidates` query body + a const), `system-prompt.ts` (a string + comment), the harness (a script), and tests. `fetchCandidates` is a daemon-internal store method consumed only by the distiller provider (also daemon-internal); it is NOT on the wire, NOT a port method on `MemoryProvider`, and its TYPE signature (`(query: string): FactCandidate[]`) is unchanged. `FactCandidate` (`store.ts:46-50`) is unchanged. Every step DoD asserts `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty.

### Behavioral DoD

- The multi-turn live re-demo (a colour CHANGE replaces — one colour fact, the new value; agent does NOT say "two records / update old in History"; recall multi-turn + dedup + forget-one stay GREEN) is **behavioral — requires Lior's live demo to confirm; NOT verifiable by code-reading, tests, prior PASS records, or even the harness.** The conductor re-verifies (runs the harness both modes) + routes the §6.1 re-demo.

---

## Approaches

Two genuine design questions sit inside Part 1 (the chunk delegates both to architect-time per spec §9 "Open at build"). Both are resolved here; neither needs Lior.

### Q-A: How to realize "all facts below a cap, BM25 fallback above"

**Option 1 (CHOSEN): branch inside `fetchCandidates` on the corpus count.**
`fetchCandidates(query)` reads `COUNT(*)` of `distilled_facts`; if `count <= ALL_FACTS_CAP`, return ALL facts (with topics) stably ordered; else run the existing BM25 MATCH path (`LIMIT CANDIDATE_TOP_K`) unchanged.
- Pros: one method, one call site, signature unchanged → frozen-safe and zero ripple into the distiller; the BM25 path is preserved verbatim for the future large-corpus / archive-summarization-tier trigger (chunk + roadmap 2d); the all-facts ordering is the natural extension of "full corpus, never reduced" (D-V4b).
- Cons: `fetchCandidates`'s name now slightly under-describes it (it is "candidates" generally, BM25 only above the cap) — mitigated by a doc-comment rewrite.

**Option 2 (rejected): a new `fetchAllCandidates()` method + a branch in the distiller provider.**
- Pros: each method does one thing.
- Cons: pushes the cap policy into the provider (a behavioral decision belongs in the store with the corpus it counts); a second method to keep in sync with the FactCandidate shape; larger diff; the distiller would need a count read too. No benefit at dogfood scale. Rejected.

### Q-B: cap value + ordering key

- **Cap = 50** (`ALL_FACTS_CAP = 50`). Rationale: the chunk's "GENEROUS cap (e.g. 50)"; at single-user dogfood scale the corpus is a handful of facts, so 50 covers the real workload with wide headroom while bounding the prompt size (50 short facts ≈ a few hundred tokens — well within `SMART_MAX_TOKENS` budget headroom for the candidate section). Above 50, BM25 fallback kicks in (the archive-summarization-tier trigger — roadmap 2d supersedes both BM25 and this stopgap with embeddings).
- **Ordering = `derived_at DESC`, realized via the existing insertion order.** The chunk says "stably ordered (e.g. `derived_at DESC`)". Verify whether `distilled_facts` has a `derived_at`/`created_at` column at build (Task 1 step 1 checks `PRAGMA table_info`). **If a timestamp column exists, order by it DESC, tie-broken by `rowid` DESC for stability; if not, order by `rowid DESC`** (monotonic insertion order — newest first, byte-stable across reads). `rowid` is always present in a bun:sqlite table and gives a deterministic, stable order with zero schema dependency. The exact tie-break is `rowid DESC` either way so the order is total and stable (no churn between reads → STABILITY-friendly and ordinal-stable within a single distill call).

> Note: ordering only needs to be **stable within one distill call** (so the prompt pool and `candidateIds` agree) and **deterministic across reads** (so tests are reproducible). It does NOT affect correctness of op:replace — `expectedTargetText` re-checks the resolved row regardless of position. `DESC` (newest-first) is a mild quality nudge (recent facts likelier relevant) but not load-bearing.

---

## Frozen-conflict check

**No conflict with any frozen artifact.** The chunk asserts this is WITHIN ADR-0012 + STABILITY amendment + spec §3.2 B1, and STRENGTHENS the full-corpus intent. Verified:
- Spec §3.4 **D-V4a** ("FTS5/BM25, NOT embeddings") is a NOW-vs-2d-tool decision, NOT a frozen-forever mechanism — it explicitly defers embeddings to 2d and accepts the LLM judging FTS5 hits. Returning all-facts-below-cap does NOT introduce embeddings or a new dependency; it removes the cross-language *reduction* that D-V4a's BM25 realization caused, and keeps BM25 as the above-cap path. The all-facts path is "give the LLM the whole corpus to judge" — the same LLM-judges-the-hits posture D-V4a names, with a perfect (un-reduced) hit set below the cap.
- Spec §3.4 **D-V4b** (the FROZEN INVARIANT: "candidate set is never *reduced*… full corpus") is **more** honored by all-facts-below-cap than by BM25 (which *does* reduce on a cross-language miss). No contradiction — a strengthening.
- ADR-0012 Amendment STABILITY: unchanged. `fetchCandidates` is read-only; it cannot reword/reorder/vanish a stored fact. By making a genuine change resolve to op:replace (one fact) instead of op:new (duplicate), it *advances* STABILITY (no accumulating stale competing facts — the chunk's "anti-STABILITY; degrades over time").
- ADR-0012 decision 6 (vector retrieval = swappable provider, not a v1 bet): unchanged; the above-cap BM25 fallback + the 2d-embeddings roadmap note preserve exactly this posture.

## Flags

**FLAG (spec note — flag-only, route to Lior/adr-curator, NOT orchestrator-edited):** The candidate-pool semantics change from "BM25 MATCH filter (top-K)" to "all-facts-below-cap, BM25 fallback above cap." Spec §3.4 D-V4a documents BM25 as the candidate-fetch mechanism. This is a **within-D-V4b-invariant refinement** (full corpus, never reduced — strengthened), NOT a new/superseding decision, so **no ADR**. But §3.4 D-V4a's "FTS5/BM25" mechanism wording becomes a partial silent contradiction (BM25 is now the above-cap fallback, not the per-dismiss mechanism at dogfood scale). **Recommend a one-paragraph spec note in §3.4** recording: "v2-09 — at single-user scale `fetchCandidates` returns the full distilled-fact set below a cap (50); BM25 MATCH is retained as the above-cap fallback (the archive-summarization-tier / 2d-embeddings trigger). This more faithfully realizes D-V4b's never-reduced full-corpus invariant; the cross-language BM25 reduction it replaces was the demo-3 duplicate-colour root." **This is a flag-only spec note (documentation of a within-invariant refinement), NOT a new ADR.** The worker MAY reword the `store.ts:970-978` `fetchCandidates` doc-comment in-chunk (code doc-comment reconciliation to the shipping behavior — §7.2 citation-test: reconciliation-to-existing-behavior, annotation-only); do NOT edit the spec from the orchestrator — surface the spec note at the bus/PR for Lior.

## ADR worthy: no

This chunk fixes a defect WITHIN the already-accepted model: ADR-0012 + the 2026-06-13 STABILITY amendment + spec §3.2 B1 / §3.4 D-V4b. Specifically: Part 1 operationalizes D-V4b's FROZEN "full-corpus, never-reduced" invariant by removing the cross-language *reduction* the BM25 realization introduced (a more faithful realization, not a new rule); Part 2 re-tightens an existing v2-07 prompt clause; Part 3 closes a harness assertion gap. No new protocol, no new dependency, no new boundary, no wire change, no port-signature change. The cap + fallback are spec §9 "Open at build (architect-time, NOT spec-frozen)" decisions. **No new ADR.** (One flag-only spec note recommended — see `## Flags`.)

---

## File Structure (what each touched file is responsible for)

- `packages/daemon/src/memory/store.ts` — Part 1: `fetchCandidates` gains the all-facts-below-cap path (count-branch) + the BM25 fallback above the cap; add `ALL_FACTS_CAP`; rewrite the method doc-comment to the new semantics.
- `packages/daemon/src/memory/store.test.ts` — Part 1 RED→GREEN: a cross-language fact is returned as a candidate below the cap; ordering is stable/deterministic; the existing BM25-path tests still hold above the cap (and the existing D-V4b "different-tag fact still surfaced" test still passes — now trivially, since all facts are returned below the cap).
- `packages/daemon/src/providers/system-prompt.ts` — Part 2: re-tighten the over-correction clause in `MEMORY_SELF_CONCEPT` (keep all D1-1..D1-8 clauses).
- `packages/daemon/src/providers/system-prompt.test.ts` — Part 2: assert the tightened over-correction phrasing present AND every existing D1 clause survives.
- `packages/daemon/scripts/memory-demo-harness.ts` — Part 3: add a SEPARATE-thread preference-CHANGE → exactly-ONE-colour-fact assert (new value); keep STEP 2b hard-assert, DEDUP-AFTER-RECALL, the `inject` MEMORY_DEBUG stage; re-label banner v2-09.

---

## Steps

### Task 1 — Part 1: `fetchCandidates` returns all-facts-below-cap (the structural fix) — ✅ DONE (commit 5b8748c; ordering = `derived_at DESC, rowid DESC`; existing TOP_K test updated + above-cap BM25 test added; memory suite 294/294, typecheck/lint 0, frozen empty)

**Files:**
- Modify: `packages/daemon/src/memory/store.ts:15` (add `ALL_FACTS_CAP`), `store.ts:970-995` (`fetchCandidates`)
- Test: `packages/daemon/src/memory/store.test.ts`

- [ ] **Step 1: Confirm the ordering column at build.**

Run: `rg -n "distilled_facts" packages/daemon/src/memory/store.ts | rg -i "derived_at|created_at|CREATE TABLE"`
Expected: identify whether `distilled_facts` has a `derived_at`/`created_at` column. **Decision rule:** if such a column exists, the ORDER BY clause is `<that column> DESC, rowid DESC`; if not, it is `rowid DESC`. Use the result in Step 4. (This is a 1-line read; do not skip — it determines the literal ORDER BY string.)

- [ ] **Step 2: Write the failing test — a cross-language fact is a candidate below the cap.**

Add to `packages/daemon/src/memory/store.test.ts` (use the file's existing fresh-store + insertFact helpers — mirror the helper used at `store.test.ts:664-693`):

```ts
test("v2-09 fetchCandidates returns the FULL fact set below the cap — a cross-language fact is ALWAYS a candidate (BM25 would have dropped it)", () => {
  const store = freshStore();
  // English-canonical colour fact (as the real/stub distiller stores it).
  store.insertFact(
    { fact: "Люблю синій колір", canonical: "user likes blue colour", topics: ["#preferences"], provenance: "thread:a", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    "test",
  );
  store.insertFact(
    { fact: "Мене звати Ліор", canonical: "user name is lior", topics: ["#about-user"], provenance: "thread:a", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    "test",
  );
  // A Ukrainian CHANGE tail — BM25 MATCH on the English canonical would return 0 rows.
  const candidates = store.fetchCandidates("[user|m1] Тепер мій улюблений колір — зелений");
  // All-facts-below-cap: the colour fact MUST be present so the distiller can op:replace it.
  expect(candidates.some((c) => c.fact.includes("синій"))).toBe(true);
  expect(candidates.length).toBe(2); // ALL facts returned (corpus is below the cap)
  store.close();
});
```

(`FactCandidate` is `{id, fact, topics}` per `store.ts:46-50` — match on `c.fact`.)

- [ ] **Step 3: Run the test to verify it FAILS.**

Run: `bun test packages/daemon/src/memory/store.test.ts -t "returns the FULL fact set below the cap"`
Expected: FAIL — current `fetchCandidates` runs BM25 MATCH; the Ukrainian query matches no English canonical → `candidates.length === 0`.

- [ ] **Step 4: Implement the all-facts-below-cap path in `fetchCandidates`.**

Add the cap constant next to `CANDIDATE_TOP_K` (`store.ts:15`):

```ts
export const CANDIDATE_TOP_K = 10;
/**
 * v2-09: at single-user (dogfood) scale the distilled-fact corpus is a handful of
 * rows, so the contradiction-candidate pool is the WHOLE corpus (spec §3.4 D-V4b —
 * "full corpus, never reduced"). Below this cap fetchCandidates returns ALL facts;
 * above it, it falls back to the BM25 MATCH path (the future large-corpus /
 * archive-summarization-tier trigger — roadmap 2d supersedes both with embeddings).
 */
export const ALL_FACTS_CAP = 50;
```

Replace the body of `fetchCandidates` (`store.ts:979-995`). Use the ORDER BY chosen in Step 1 (shown here as `rowid DESC`; substitute `<col> DESC, rowid DESC` if a timestamp column exists):

```ts
fetchCandidates(query: string): FactCandidate[] {
  const total = (this.db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;

  let rows: { id: string; fact: string }[];
  if (total <= ALL_FACTS_CAP) {
    // v2-09 all-facts path: return the FULL corpus, stably ordered (newest first).
    // This is MORE faithful to D-V4b ("never reduced") than BM25, which silently
    // drops a same-attribute fact when the tail language ≠ the canonical language
    // (the demo-3 cross-language duplicate-colour root). LIMIT ALL_FACTS_CAP is a
    // belt-and-suspenders bound (== total here) so the prompt section stays bounded.
    rows = this.db.query(
      `SELECT id, fact FROM distilled_facts ORDER BY rowid DESC LIMIT ?`,
    ).all(ALL_FACTS_CAP) as { id: string; fact: string }[];
  } else {
    // Above the cap: the BM25 MATCH path (unchanged — the large-corpus fallback).
    const ftsQuery = toFtsOrQuery(query);
    if (ftsQuery === "") return [];
    rows = this.db.query(
      `SELECT f.fact_id AS id, d.fact AS fact
         FROM fact_fts f
         JOIN distilled_facts d ON d.id = f.fact_id
         WHERE fact_fts MATCH ?
         ORDER BY bm25(fact_fts)
         LIMIT ?`,
    ).all(ftsQuery, CANDIDATE_TOP_K) as { id: string; fact: string }[];
  }

  return rows.map((r) => ({
    id: r.id,
    fact: r.fact,
    topics: (this.db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(r.id) as { topic: string }[]).map((t) => t.topic),
  }));
}
```

Rewrite the method doc-comment (`store.ts:970-978`) to the new semantics (cite spec §3.4 D-V4b; note the all-facts-below-cap path + the BM25 above-cap fallback + that this strengthens the never-reduced invariant). This doc-comment rewrite is the in-chunk code-doc reconciliation noted in `## Flags`.

- [ ] **Step 5: Run the new test + the existing `fetchCandidates` tests to verify GREEN.**

Run: `bun test packages/daemon/src/memory/store.test.ts`
Expected: PASS. The new cross-language test passes. The existing `store.test.ts:664` ("contradicting fact carrying a DIFFERENT topic tag — tags WIDEN, never filter") still passes (now trivially — below the cap all facts are returned). The existing `store.test.ts:684` ("returns at most CANDIDATE_TOP_K rows and tolerates punctuation") — **this test asserts the BM25 path; below the cap it now returns all-facts.** If it inserts ≤ `ALL_FACTS_CAP` facts (it inserts a small number), it will return all of them, and `toBeLessThanOrEqual(10)` may still hold if the corpus is ≤10 — verify. **If that test now fails because the corpus is small and all-facts returns them un-MATCH-filtered, UPDATE it** to either (a) assert the all-facts behavior below the cap (length === corpus size, ≤ cap), and (b) add a separate above-cap case that seeds > `ALL_FACTS_CAP` facts and asserts the BM25 `LIMIT CANDIDATE_TOP_K` bound + punctuation tolerance still hold. Keep BOTH behaviors covered.

- [ ] **Step 6: Run the full memory suite + typecheck + lint + frozen check.**

Run: `bun test packages/daemon/src/memory && bun run typecheck && bun run lint:strict`
Expected: exit 0. The distiller-registration + distiller-integration tests that call `fetchCandidates` (e.g. `distiller-registration.test.ts:66,1127,1163`) still pass — they seed few facts (below cap) and assert a specific fact is among candidates, which all-facts satisfies a fortiori. **If any distiller test asserted that fetchCandidates EXCLUDES a fact via BM25 ranking, it must be re-examined** (grep `fetchCandidates` in tests — the matches found are inclusion/ordinal assertions, not exclusion, so expected to pass; confirm).
Run: `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` → empty.

- [ ] **Step 7: Commit.**

```bash
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/store.test.ts
git commit -m "fix(memory): v2-09 — fetchCandidates returns all-facts-below-cap (cross-language change finds its candidate → op:replace, not duplicate); BM25 retained as above-cap fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**DoD (command-evidence):** `bun test packages/daemon/src/memory/store.test.ts` PASS; the cross-language candidate test GREEN; both below-cap (all-facts) and above-cap (BM25 LIMIT) behaviors covered; `bun test packages/daemon/src/memory && typecheck && lint:strict` exit 0; op:replace contract code (`distiller-registration.ts` ordinal/`expectedTargetText`) byte-unchanged; frozen `git diff` empty.

---

### Task 2 — Part 2: re-tighten the over-correction prompt clause — ✅ DONE (commit 6ab9fa4; caught + fixed a false-RED in the planned test; reconciled 2 stale D1-8 tests; 27/27 pass, typecheck/lint 0, frozen empty)

**Files:**
- Modify: `packages/daemon/src/providers/system-prompt.ts:46-48` (the over-correction clause), `:29-31` (the D1-8 comment)
- Test: `packages/daemon/src/providers/system-prompt.test.ts`

- [ ] **Step 1: Write the failing test — the tightened phrasing is present AND all D1 clauses survive.**

Add to `packages/daemon/src/providers/system-prompt.test.ts` (mirror the existing presence-assert style):

```ts
test("v2-09: over-correction clause re-tightened — never redirect to History for a change/correction the user just stated", () => {
  // The strengthened directive (a STATED change is captured automatically — do not point at History):
  expect(MEMORY_SELF_CONCEPT).toContain("captured automatically");
  expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("do not tell the user to update");
  // It must explicitly cover a CHANGE/CORRECTION, not just "new things":
  expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("change");
  // History is only for EXISTING memories the user did NOT just change:
  expect(MEMORY_SELF_CONCEPT).toContain("EXISTING");
  // D1 clauses must all SURVIVE (don't drop one while tightening another):
  expect(MEMORY_SELF_CONCEPT).toContain("[remembered] ");          // D1-2
  expect(MEMORY_SELF_CONCEPT).toContain("not a stateless model");  // D1-1
  expect(MEMORY_SELF_CONCEPT).toContain("FIRST check");            // D1-7 (A′)
  expect(MEMORY_SELF_CONCEPT).toContain("cannot modify, delete, or forget your own memory"); // D1-6
  expect(MEMORY_SELF_CONCEPT).toContain("attached for you automatically"); // D1-5
});
```

(Adjust the exact substrings to match the final wording in Step 3 — the test and the prompt are edited together; keep the D1-1..D1-7 survival asserts verbatim from the current `system-prompt.ts` text. Verify each survival substring against the live file before running, since wording may have drifted across v2-01..08.)

- [ ] **Step 2: Run the test to verify it FAILS (or is too-weak-to-be-meaningful).**

Run: `bun test packages/daemon/src/providers/system-prompt.test.ts -t "over-correction clause re-tightened"`
Expected: FAIL — the current clause (`system-prompt.ts:46-48`) says "New things the user tells you — including corrections — ARE captured automatically" but does not say "change" explicitly nor "do NOT tell the user to update … the OLD info in History"; the `change`/strengthened-phrasing asserts fail.

- [ ] **Step 3: Re-tighten the clause in `MEMORY_SELF_CONCEPT` (`system-prompt.ts:46-48`).**

Replace the current over-correction sentences (`:46-48`) with a strengthened version, keeping the surrounding clauses byte-identical:

```ts
  'When the user STATES a change or correction to something you remember, simply acknowledge it — the change is captured automatically. ' +
  'Do NOT tell the user to update, change, or fix the old information in the History page: a stated change is saved for you, you do not point the user at History to do it. ' +
  'Only mention the History page for viewing, editing, or forgetting EXISTING remembered facts the user did NOT just change in this conversation. ' +
```

(This REPLACES the two sentences at `:46-48` — "New things the user tells you — including corrections — ARE captured automatically; do NOT tell the user to update the History page for information they just gave you. Only mention the History page for viewing, editing, or forgetting EXISTING remembered facts." Keep the `:44-45` "cannot modify…" sentences and the `:49-50` "Never invent…" sentence untouched.)

Update the D1-8 comment (`system-prompt.ts:29-31`) to: "D1-8 (v2-09 over-correction re-tighten): a STATED change/correction is captured automatically; NEVER redirect the user to History to update old info; History is only for viewing/editing/forgetting EXISTING memories the user did NOT just change."

- [ ] **Step 4: Run the test to verify GREEN.**

Run: `bun test packages/daemon/src/providers/system-prompt.test.ts`
Expected: PASS — the new asserts and all D1 survival asserts pass. `COMPOSED_SYSTEM_PROMPT` recomposes automatically (it concatenates `MEMORY_SELF_CONCEPT`).

- [ ] **Step 5: Typecheck + lint + frozen check, then commit.**

Run: `bun run typecheck && bun run lint:strict` → exit 0. `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` → empty.

```bash
git add packages/daemon/src/providers/system-prompt.ts packages/daemon/src/providers/system-prompt.test.ts
git commit -m "fix(memory): v2-09 over-correction re-tighten — a stated change/correction is captured automatically; never redirect to History to update old info

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**DoD (command-evidence):** `bun test …/system-prompt.test.ts` PASS; the tightened over-correction phrasing present AND all D1-1..D1-7 clauses survive; `typecheck`/`lint:strict` exit 0; frozen `git diff` empty. **Reliability is LLM-fuzzy — requires Lior's live demo to confirm; this step only locks the prompt string.**

---

### Task 3 — Part 3: harness preference-CHANGE → exactly-ONE-fact regression assert + final verification + §6.1 escalation — ✅ STEPS 1–5 DONE (commit 68fc6a8; stub CHANGE→ONE-FACT GREEN before=1/after=1, STEP 2b + DEDUP-AFTER-RECALL GREEN; full suite 519/0, lint/typecheck 0, frozen empty; real-mode candidates list shows colour fact ordinal:1 → real LLM op:replace = Done-criterion-2 deterministic proof; ⚠️ real-mode full run timed out at DEDUP-AFTER-RECALL — worker claims pre-existing, ROUTED TO REVIEWER for diff-level assessment). Step 6 (push/PR) held for orchestrator post-review.

**Files:**
- Modify: `packages/daemon/scripts/memory-demo-harness.ts`

- [ ] **Step 1: Add the SEPARATE-thread preference-CHANGE → exactly-one-colour-fact assert.**

The existing STEP 4 (`memory-demo-harness.ts:641-676`) is same-flow and asserts only `colourNowGreen`. Add a NEW, dedicated assert (place it after STEP 4, or repurpose STEP 4 to add the count assertion — prefer a NEW clearly-labeled block so STEP 4's other invariants stay). The colour fact is already seeded in thread A (`:461`). In a SEPARATE new thread, STATE the change and dismiss, then assert exactly ONE colour fact exists AND it is the new value. Reuse `countColourFacts` (`:95-104`) and the `wsTurnAndSettle` + rawDb snapshot patterns:

```ts
// ── v2-09: preference CHANGE in a SEPARATE thread → exactly ONE colour fact (replaced, not duplicated) ──
console.log("[demo-harness] CHANGE→ONE-FACT: state colour change in a NEW thread → exactly one colour fact (the new value)");
const colourCountBeforeChange = countColourFacts(tmpDir);
const threadChange = crypto.randomUUID();
await wsTurnAndSettle(PORT, token, { threadId: threadChange, text: "Мій улюблений колір тепер зелений" });
const colourCountAfterChange = countColourFacts(tmpDir);

const verifyStoreChange = new MemoryStore({ dataDir: tmpDir });
const colourFactsAfter = verifyStoreChange.rawDb()
  .query("SELECT id, fact FROM distilled_facts WHERE fact LIKE '%синій%' OR fact LIKE '%зелений%' OR fact LIKE '%колір%' OR fact LIKE '%Люблю%'")
  .all() as { id: string; fact: string }[];
verifyStoreChange.close();

const exactlyOneColour = colourFactsAfter.length === 1;
const isNewValue = colourFactsAfter.some((f) => f.fact.includes("зелений"));
const noStaleBlue = !colourFactsAfter.some((f) => f.fact.includes("синій"));
console.log(`[demo-harness] CHANGE→ONE-FACT: colour facts before=${colourCountBeforeChange} after=${colourCountAfterChange}; rows=[${colourFactsAfter.map((f) => `"${f.fact}"`).join(", ")}]`);

if (MODE === "stub") {
  if (!exactlyOneColour) {
    console.error(`[demo-harness] CHANGE→ONE-FACT: RED — expected exactly 1 colour fact, found ${colourFactsAfter.length} (a genuine change DUPLICATED instead of replacing — Part 1 all-facts-candidate not applied).`);
    await cleanup(); process.exit(1);
  }
  if (!isNewValue || !noStaleBlue) {
    console.error(`[demo-harness] CHANGE→ONE-FACT: RED — the single colour fact is not the new value (green) / a stale blue survives.`);
    await cleanup(); process.exit(1);
  }
  console.log("[demo-harness] CHANGE→ONE-FACT: GREEN — exactly one colour fact, replaced to the new value (no duplicate).");
} else {
  console.log(`[demo-harness] CHANGE→ONE-FACT: informational (real mode, LLM-fuzzy) — exactlyOne=${exactlyOneColour} isNewValue=${isNewValue} noStaleBlue=${noStaleBlue}. The candidate pool now DETERMINISTICALLY includes the colour fact (verify via the MEMORY_DEBUG distill 'candidates' list).`);
}
console.log("");
```

**Stub determinism note (why this is GREEN after Part 1, RED before):** the stub (`memory-demo-harness.ts:221-281`) does `op:replace` only when the colour candidate is in the pool (`colourCandidateIdx !== -1`). Before Part 1, `fetchCandidates(tailText)` runs BM25 on the Ukrainian change tail vs the English colour canonical → 0 hits → `colourCandidateIdx === -1` → stub does `op:new` → 2 colour facts (RED). After Part 1 (all-facts below cap), the colour fact is ALWAYS in the pool → `colourCandidateIdx !== -1` → stub does `op:replace` → 1 colour fact, value=green (GREEN). **No stub change is needed — the stub already mirrors all-facts behavior; Part 1 makes the real candidate pool feed it the colour candidate.** (This is the "make the stub's candidate pool reflect the all-facts behavior" requirement: it is satisfied structurally by Part 1, because the stub reads the pool from the real `fetchCandidates` output embedded in the prompt — confirm by reading the stub's `candidateLines` parse at `:210-216`; do NOT hardcode a candidate in the stub. Adjust the exact var names — `tmpDir`, `PORT`, `token`, `wsTurnAndSettle`, `MemoryStore`, `cleanup` — to the harness's actual identifiers.)

- [ ] **Step 2: Keep STEP 2b hard-assert, DEDUP-AFTER-RECALL, and the `inject` MEMORY_DEBUG stage; re-label the banner v2-09.**

Do NOT remove or weaken: STEP 2b (`memory-demo-harness.ts:537-562`), DEDUP-AFTER-RECALL (`:960-987`), or the `inject` MEMORY_DEBUG stage in `index.ts` (committed dev-env). Update the banner/summary strings (`:49-53`, the closing summary box near `:987`) from v2-08 → v2-09; add the CHANGE→ONE-FACT line to the summary box.

- [ ] **Step 3: Run the harness in STUB mode — CHANGE→ONE-FACT GREEN, all prior asserts stay GREEN.**

Run: `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub`
Expected: CHANGE→ONE-FACT GREEN (exactly one colour fact, value green); STEP 2b GREEN; DEDUP-AFTER-RECALL GREEN; STEP 3 STABILITY OK; all v2-06/v2-07/v2-08 defects stay GREEN. **Paste the full stdout into the PR**, marked "memory-demo-harness --mode=stub: EXECUTED, output below."

- [ ] **Step 4: Full-green gate + EXECUTE real mode + frozen check.**

Run from repo root: `bun test && bun run lint:strict && bun run typecheck`
Expected: exit 0.
Run: `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` → empty.
Run: `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=real` (real Haiku; skips-with-message if no Keychain key — note it; the conductor re-runs with a key). **For real mode, report whether the colour CHANGE replaced (exactly one colour fact, the new value) AND verify via the MEMORY_DEBUG distill `candidates` list that the colour fact IS in the candidate pool (Done criterion 2 — the deterministic part).** Paste the full real-mode stdout into the PR, marked "EXECUTED, output below."

- [ ] **Step 5: Commit.**

```bash
git add packages/daemon/scripts/memory-demo-harness.ts
git commit -m "test(memory): v2-09 harness — preference CHANGE in a separate thread → exactly ONE colour fact (replaced, not duplicated); banner v2-09; keep STEP 2b + dedup-after-recall + inject MEMORY_DEBUG

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Push + PR; escalate the §6.1 re-demo + the spec-note flag.**

Push `chunk/v2-09-candidate-pool-and-replace`. PR body carries: (a) the `fetchCandidates` cross-language RED→GREEN + the over-correction prompt RED→GREEN test outputs; (b) the EXECUTED stub+real harness stdouts (CHANGE→ONE-FACT + STEP 2b + DEDUP-AFTER-RECALL GREEN); (c) the real-mode "candidate pool includes the colour fact" report (MEMORY_DEBUG `candidates`); (d) the runtime-coupling summary (op:replace ordinal/`expectedTargetText` contract untouched — `distiller-registration.ts` byte-unchanged; suppress-only dedup + B1 count-equality intact); (e) the spec-note FLAG (BM25-filter → all-facts-below-cap, §3.4 — flag-only, route to Lior/adr-curator). **Does NOT auto-merge** — Done criterion 3 (Lior's LIVE re-demo: a colour CHANGE replaces, agent does NOT say "two records / update old in History", recall multi-turn + dedup + forget-one stay GREEN) is the whole-stack gate. Report DONE-ready / BLOCKED-on-Lior-demo to the ledger; the conductor re-verifies (runs the harness both modes) + routes the §6.1 re-demo, then merges the whole stack (v2-05..09).

**DoD (command-evidence):** repo-root `bun test && bun run lint:strict && bun run typecheck` exit 0; frozen `git diff` empty; harness EXECUTED both modes (stdout in PR, CHANGE→ONE-FACT + STEP 2b + DEDUP-AFTER-RECALL GREEN in stub); real-mode colour-CHANGE-replaces reported + candidate-pool-includes-colour verified via MEMORY_DEBUG; spec-note flag surfaced; behavioral §6.1 re-demo escalated to Lior — **NOT done until the live demo is green (requires runtime demo to confirm; code-reading/tests/harness are necessary, not sufficient).**

---

## Done criteria (mapped to the chunk's 3 criteria)

- **[mechanical]** (chunk criterion 1): preference-change→one-fact assert GREEN (no duplicate) → Task 3 Step 1/3 (CHANGE→ONE-FACT, stub-hard); v2-08 asserts stay GREEN (STEP 2b + DEDUP-AFTER-RECALL kept, Task 3 Step 2) → Task 3 Step 3; `bun test` green + typecheck + lint:strict 0 → Task 1 Step 6, Task 3 Step 4; frozen byte-unchanged → every Task DoD. ✓
- **[EXECUTED]** (chunk criterion 2): harness stub + real green → Task 3 Step 3/4; real-mode shows a colour CHANGE replaces (one colour fact, the new value) — reported; the candidate pool now DETERMINISTICALLY includes the colour fact, verified via the MEMORY_DEBUG `candidates` list → Task 3 Step 4 (the deterministic surface, even though the exact op is LLM-fuzzy in real mode). ✓
- **[behavioral — Lior's LIVE re-demo, §6.1]** (chunk criterion 3): the multi-turn demo — a colour CHANGE replaces (agent does NOT say "two records / update old in History"), recall multi-turn + dedup + forget-one stay GREEN → escalated Task 3 Step 6. **NOT done until Lior signs.** ✓ (escalated, not claimed)

---

## Self-review (chunk coverage)

- **Part 1 — fetchCandidates all-facts-below-cap + BM25 above-cap fallback + cap documented** → Task 1 (cap = `ALL_FACTS_CAP = 50`, ordering `rowid DESC` or timestamp DESC, doc-comment rewritten). ✓
- **Runtime coupling — op:replace ordinal mapping + `expectedTargetText` preserved + `candidateIds` logging stays + suppress-only dedup + B1 invariant intact** → Reality check (proven `distiller-registration.ts` untouched; the contract is invariant to pool size; dedup uses `factExistsByDedupKey` not `fetchCandidates`; B1 is on the insert/delete path, not the read path) + Task 1 DoD (frozen + full-suite green). ✓
- **Part 2 — over-correction prompt re-tighten (stated change captured; never redirect to History; History only for existing un-changed memories)** → Task 2 (LLM-fuzzy; presence-asserted + D1 survival; reliability = Lior demo). ✓
- **Part 3 — separate-thread CHANGE → exactly-one-fact assert (new value); stub reflects all-facts; keep STEP 2b + dedup-after-recall + inject MEMORY_DEBUG** → Task 3 (stub determinism satisfied structurally by Part 1, no stub hardcode). ✓
- **Frozen surfaces byte-unchanged (`@agentic/protocol`, `mock-agent.ts`); daemon-internal only; no port-signature change** → Reality check + every Task DoD. ✓
- **No new dependency; no ADR (within ADR-0012 + STABILITY amendment + spec §3.2 B1 / §3.4 D-V4b — strengthens)** → `## ADR worthy: no`. ✓
- **Spec-note flag raised (BM25-filter → all-facts-below-cap), flag-only not orchestrator-edited** → `## Flags`. ✓
- **No frozen-conflict (D-V4a is a NOW-tool decision, D-V4b never-reduced is strengthened)** → `## Frozen-conflict check`. ✓
- **Real-I/O verification (only LLM clientFactory stubbed); MEMORY_DEBUG candidates = the verification surface** → Task 3 Step 4. ✓

---

## Key file references (absolute paths)

- Candidate fetch: `packages/daemon/src/memory/store.ts` (`fetchCandidates` 979-995; `CANDIDATE_TOP_K` 15; `toFtsOrQuery` 140-144; `FactCandidate` 46-50)
- Candidate pool → prompt + `candidateIds`: `packages/daemon/src/memory/providers/smart-distiller-provider.ts` (`fetchCandidates` call 543; `candidateIds` 544; numbered pool 546-554; distill-input MEMORY_DEBUG candidates 558-572)
- op:replace targeting (PRESERVED, untouched): `packages/daemon/src/memory/distiller-registration.ts` (ordinal→id 183-184; `expectedTargetText` concurrency check 199-202; demotes 195-211; suppress-only dedup 255/277)
- Port types (unchanged): `packages/daemon/src/memory/memory-provider.ts` (`FactOp` 26-35; `DistillDelta.candidateIds` 41)
- Over-correction prompt: `packages/daemon/src/providers/system-prompt.ts` (`MEMORY_SELF_CONCEPT` 33-50; over-correction 46-48; D1-8 comment 29-31)
- Harness: `packages/daemon/scripts/memory-demo-harness.ts` (STEP 4 change-test 641-676; stub op-derivation 196-283; `countColourFacts` 95-104; STEP 2b 537-562; DEDUP-AFTER-RECALL 960-987; seed colour 461)
- Spec / ADR: `orchestration/docs/specs/2026-06-13-memory-distiller-v2.md` (§3.2 Failure-mode-B, §3.4 D-V4a/D-V4b, §9 Open-at-build); `orchestration/docs/adr/0012-conversation-and-memory-model.md` (Amendment STABILITY)
