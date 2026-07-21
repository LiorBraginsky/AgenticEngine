> 🗄️ ARCHIVED 2026-07-21 — shipped. Historical record; do not edit.

# Chunk hybrid-retrieval/04 — hybrid ranker (RRF) + distiller candidate-fetch + golden-set eval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax. All test-cycle steps follow `superpowers:test-driven-development`: red → green → commit. This is a spec-FROZEN chunk (spec §3.4/§3.5/§3.8) — do NOT re-decide frozen seams. Two architect-time seams the spec explicitly delegated are resolved below (`## Approaches`); the worker decides nothing further.

**Goal:** Build the hybrid RRF ranker (`hybrid-ranker.ts`) over both corpora (facts + archive), swap the distiller's above-cap candidate lane from BM25-only to the hybrid ranker (via an async candidate-fetch sibling, below-cap byte-identical), and ship the golden-set eval as the acceptance instrument — an EXECUTED probe (RED BM25-only baseline → hybrid pass, real model, seeded >50-fact store) plus a committed, re-run `unicode61` check.

**Architecture:** Daemon-side only. The ranker lives in the embedding module and keeps the store's "stores+matches, never computes" contract: the store exposes raw vectors + BM25 legs (with a `rowid` for the total tie-break), the ranker computes cosine + RRF fusion. The store gains an INJECTED ranker (`setFactRanker`, mirroring chunk-03's `setWriteObserver`) and a new async `fetchCandidatesRanked` that the distiller calls; the frozen sync `fetchCandidates` stays byte-identical as the below-cap / no-ranker path. Provider `null` ⇒ cosine leg empty ⇒ lexical-only everywhere.

**Tech Stack:** TypeScript on Bun 1.3.x, `bun:sqlite`, `bun test`. Ranker reuses chunk-03's `onnxruntime-web` local-WASM provider + `encodeVector`/`decodeVector`. No new dependencies.

## Global Constraints

- **Docs are truth.** Spec `orchestration/docs/specs/2026-07-13-hybrid-retrieval.md` §3.1(D1b) · §3.4(D4a/b/c) · §3.5(D5a/b/c) · §3.8(D8a/b) · §2 (D-V4b UNION-then-rank; D-V4c canonical/display split) · §4 (coupling notes 1 & 7) · §5 (verification) · §7 (architect-time open items) is the frozen design. ADR-0012 decision 6 + STABILITY amendment (hybrid changes which facts are FOUND, never how they mutate). ADR-0017 (accepted). **No new ADR.**
- **D-V4b full-corpus invariant (FROZEN):** no retrieval hint (topic OR embedding) ever REDUCES the candidate set below the lexical/all-facts lane. Legs **UNION, never intersect** — a doc found by ONE leg still ranks.
- **Total tie-break everywhere (D4b, the chunk-01/D6c-flake lesson):** NO `ORDER BY` without a total tie-break. Ranker ties break on `rowid DESC`; every leg's in-list order is total.
- **Frozen surfaces — byte-unchanged.** `@agentic/protocol` (`packages/protocol/`) and the mock reducer (`packages/daemon/src/mock-agent.ts`, `packages/daemon/src/providers/mock-provider.ts`). Byte-diff at PR time.
- **`fetchCandidates` below-cap is BYTE-IDENTICAL** (existing v2 distiller suite green, untouched). The frozen sync `fetchCandidates(query): FactCandidate[]` method is not mutated (see `## Approaches` A).
- **`EmbeddingProvider.embed()` never throws; `null` = unavailable ⇒ lexical-only.** CI MUST be green with NO provider present. CI must NEVER download the model — the real-model run is the explicit `retrieval-golden-eval.ts` script only.
- **Mixed-model vector rows EXCLUDED** from the cosine leg (never compare across embedding spaces — chunk-03 stamps `model_id` per row).
- **Leg top-K defaults (spec D4a, flagged INFERRED — do NOT gold-plate):** facts 20/leg, archive 50/leg; `RRF_K=60`; `CANDIDATE_TOP_K=10` (existing store const); search result cap `~8`. Tuned only against the golden set.
- **Commands:** tests `bun test <path>`; typecheck `bun run --cwd packages/daemon typecheck`; lint `bun run --cwd packages/daemon lint:strict` (0 warnings); repo-wide `bun test`. Commit per task with trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `chunk/hybrid-04-hybrid-ranker-and-candidate-fetch`; never commit on `main`.

---

## Reality check (§6.1 — anchors re-validated against current `main`; chunks 01/02/03 all landed/merged)

Every spec/chunk/handoff anchor re-read against the current tree. **Nothing here is a runtime behavioral assertion.** The golden-set acceptance bar is an EXECUTED result — marked "requires the executed probe run," never "will pass."

**`store.ts` drift (spec/chunk value → CURRENT value):**
- `fetchCandidates` — spec §3.5/§1 said `:1135`; chunk file said `:1135-1167`; plan-03 reality check said `:1221`; **now `store.ts:1270`** (method body `:1270-1302`). RE-VERIFY at build.
- Top-of-file "2d supersedes" comment — spec said `:16-24`; **now `:16-23`** (the `ALL_FACTS_CAP` doc-comment ending "roadmap 2d supersedes both with embeddings"). `CANDIDATE_TOP_K = 10` at `:15`; `ALL_FACTS_CAP = 50` at `:23`; `APPEND_LIST_CAP = 8` at `:24`.
- Near-`fetchCandidates` "2d supersedes" comment — spec said `:1113-1133`; **now the `fetchCandidates` docstring `:1248-1268`** ("roadmap 2d supersedes both with embeddings", `:1262`). BOTH comment sites must be rewritten (no stale contradiction — the m3 lesson).
- `readFactVectors(modelId)` **`:1515`** → returns `{ id, vector, dims }[]` + mixed-model warn `:1520-1522`; `readMessageVectors(modelId)` **`:1528`** → same shape, warn `:1533-1535`. **These are chunk-04's cosine-leg read + the handoff-(b) warn-throttle target.**
- `deleteMessageDerived` `:1506`; `backfillMessageFts()` `:1550`; `toFtsOrQuery(raw)` (exported) `:169`; `FactCandidate` interface (exported) `:54-58`.
- `readForgottenFacts` `:404`, `readDistillationEvents` `:864`, `readReplacedFacts` `:1135` — chunk-01/R3 already hardened with tie-breaks; **NOT touched by chunk-04.**

**Schema (`schema.ts`):** `fact_fts USING fts5(fact_id UNINDEXED, canonical, topic)` `:126-130` (BM25 leg matches the English `canonical`); `message_fts USING fts5(message_id UNINDEXED, content)` `:194` (unicode61 default — the FIRST production FTS surface over Cyrillic content, so D1b re-verify is load-bearing); `fact_embeddings` / `message_embeddings` `:~146-198` (added chunk-03). `trg_distilled_facts_ad` `:134-139` + `trg_distilled_facts_ad_embeddings` (chunk-03) clean derived rows on fact delete.

**Distiller consumer:** `smart-distiller-provider.ts:550` `const candidates = store.fetchCandidates(tailText)` inside the **async** `distill()` (`:510`); docstring line `:445` describes the BM25 above-cap fallback (must be updated). The direct `store.fetchCandidates(...)` calls in `store.test.ts` (`:807/826/843/867/1005`), `apply-fact-op.test.ts` (`:306/308`), `distiller-registration.test.ts` (`:66/1127/1163/1168/1363`) are v2-suite call sites that MUST stay byte-identical.

**Embedding module (chunk-03, merged PR #99):** `embedding-provider.ts` → `EmbeddingProvider { id, modelId, dims, embed(texts): Promise<Float32Array[]|null>, warmup?() }`. `vector-codec.ts` → `encodeVector(Float32Array): Uint8Array` / `decodeVector(Uint8Array, dims): Float32Array` (little-endian). `fixture-embedding-provider.ts` → `FixtureEmbeddingProvider` (hash-seeded, deterministic but **semantically arbitrary** — usable for degrade/plumbing tests, NOT for semantic-clustering assertions). `local-wasm-embedding-provider.ts` → `LocalWasmEmbeddingProvider` (`modelId="Xenova/multilingual-e5-small"`, `dims=384`, applies `DOC_PREFIX="passage: "` inside `embed()`; the query-prefix decision was **deferred to chunk-04**, `:126-133`). `embedding-provider-selector.ts` → `buildEmbeddingProvider({dataDir?})`. Model download gated behind `AGENTIC_EMBED_AUTODOWNLOAD=1`.

**Daemon wiring (`index.ts`):** `startDaemon(port?, provider?, memoryProvider?, embeddingProvider?)` `:77-82`; `store` `:84`; `embedding = embeddingProvider ?? buildEmbeddingProvider({dataDir})` `:92`; `embeddingDrain` + `setWriteObserver` `:93-94`; `registerDistiller` further down. The ranker is constructed here and injected into the store; chunk-05 reuses the same instance for `MemoryActionPort`.

**Reused fixture (chunk-02, `rephrase-matrix.fixture.ts`):** exports `ANCHOR` (`{canonical:"favorite color blue", display:"мій улюблений колір синій"}`), `SAME_CANONICAL` (16 classes incl. UK/EN reword + `en-paraphrase`), `DIFFERENT_CANONICAL_RESIDUAL`, `NEGATIVE_CONTROLS`. The golden fixture REUSES this (spec §3.8a-2) and ADDS the non-UA cross-language pairs + demo-3 change case (Lior's language-agnostic ruling).

**Runtime facts requiring an EXECUTED run to confirm (NOT asserted here):** that the real local-WASM model, over the golden set on a seeded >50-fact store, meets the acceptance bar (RED BM25-only → hybrid pass); the `unicode61` Cyrillic case-folding result on the build machine's Bun/SQLite. Both are Task 4 executed probes; their PASS is a build-time result, not a plan claim.

---

## Approaches (the two architect-time seams the spec delegated — §7; each resolved so the worker decides nothing)

### A. How the hybrid swap reaches the distiller, given the cosine leg is inherently async

The cosine leg computes the query embedding via `await provider.embed([query])` — **inherently async**. The frozen `fetchCandidates(query): FactCandidate[]` is **synchronous** and has ~11 direct sync call sites in the v2 suite. The spec (§3.5 D5a "the BM25-only lane is REPLACED by the hybrid ranker") and §4 note 1 ("unchanged method signature") assumed a sync host for an async leg — infeasible. Some async deviation is forced.

- **Option A1 (chosen): keep `fetchCandidates` byte-identical (sync); add `async fetchCandidatesRanked(query): Promise<FactCandidate[]>`; the distiller calls the async sibling.** `fetchCandidatesRanked` delegates to sync `fetchCandidates` for the below-cap AND no-ranker-above-cap cases (byte-identical behavior), and only runs the async hybrid path for above-cap-with-ranker. Pros: v2 suite LITERALLY untouched (every direct `store.fetchCandidates` call unchanged, below-cap byte-identical — the DoD's exact words); below-cap hot path stays sync; the behavioral change is isolated to the distiller's one call + its integration tests — exactly what §4 note 1 says the reviewer must diff. Cons: the swap is in a sibling method, not by mutating `fetchCandidates` in place (a literal-wording deviation from §3.5 D5a — flagged in `## Architect flags`).
- **Option A2: make `fetchCandidates` async.** Pros: literal spec (swap inside `fetchCandidates`). Cons: forces `await` onto ~11 v2 sync call sites (incl. the direct `store.test.ts` `fetchCandidates` tests) → violates "v2 suite green untouched / below-cap byte-identical"; needless async on the dogfood-common below-cap path.
- **Recommendation: A1.** It best satisfies the DoD's hard requirements and §4 note 1's intent; the consumer-observed behavior (distiller above-cap → hybrid) is identical to A2. The store keeps "never computes" by delegating to an INJECTED ranker (`setFactRanker`, mirroring chunk-03's `setWriteObserver`); a structural `FactCandidateRanker` interface is defined IN `store.ts` so there is no store→ranker import cycle.

### B. The e5 query-side prefix (spec D2e / §7 / local-wasm `:126-133`)

e5 uses asymmetric prefixes (`"passage: "` corpus / `"query: "` query). The frozen port applies `"passage: "` internally; the ranker computing the query vector via `provider.embed([query])` yields a `"passage: "`-prefixed query (symmetric).

- **Option B1 (chosen): accept the symmetric `"passage: "` prefix for v1** — call `provider.embed([query])` as-is, NO port widening. Pros: e5-small is documented robust to mild prefix mismatch; the golden set (§3.8) is the arbiter of quality, not the prefix; avoids speculative surgery on the deliberately-narrow chunk-03 port. Cons: a small, model-documented quality delta vs the ideal `"query: "` prefix.
- **Option B2: widen the port with a role-carrying `embedQuery`.** Pros: strictly e5-correct. Cons: widens the frozen port + both providers speculatively before the golden set shows it is needed.
- **Recommendation: B1**, with the concrete fallback documented: **IF the golden-set eval fails specifically because of query-prefix (a green-with-`"query: "`, red-with-`"passage: "` split at the same model), add a role-carrying internal `embedQuery` method** — a scoped follow-up, not chunk-04 gold-plating. This rides the same D8b escalation ladder (try next model → hosted lane) if the model itself is the miss.

## Chosen Approach

A1 + B1, as above. Split into 5 sequential, independently-reviewable tasks: **(1)** store seams (rowid+throttle on the vector reads, BM25-leg reads, ranker-injection + `fetchCandidatesRanked`, comment rewrites); **(2)** the `HybridRanker` + CI determinism tests (scripted vectors); **(3)** distiller wiring + daemon wiring + the above-cap store test (RED-on-BM25-only, deterministic); **(4)** golden fixture + the EXECUTED `retrieval-golden-eval.ts` + the EXECUTED `fts5-unicode61-check.ts`; **(5)** verification sweep + PR evidence + handoff dispositions.

## ADR worthy: no

Chunk-04 executes accepted decisions: ADR-0012 decision 6 (vector retrieval = swappable provider — the ranker is that provider consuming the plane) + STABILITY amendment (hybrid changes which facts are FOUND, never how they mutate — no mutation path is touched); ADR-0017 (embedding plane + egress posture — executed, not changed); ADR-0016 UNCHANGED (`memory_search` is chunk-05). No new protocol, dependency, or boundary. The `FactCandidateRanker` injection seam + the async `fetchCandidatesRanked` sibling (Approach A1) are internal implementation shapes, not architectural boundaries. No new ADR. (The A1 literal-wording deviation from §3.5 D5a is a plan-recorded implementation decision — see `## Architect flags` — not an ADR-grade decision.)

---

## Handoff dispositions (chunk-03 conductor merge note — assessed, FLAGGED, not silently expanded)

- **(a) [reviewer MINOR] batch-level embed failure (>512-token row nulls its whole batch).** **DISPOSITION: BACKLOG (§7.2), NOT in chunk-04.** Rationale: it is a chunk-03 adapter robustness issue, not on the ranker/candidate path; the golden fixture and every eval-seeded fact/message are short single sentences (far <512 tokens) — assessed, does NOT gate the eval. **Constraint carried into Task 4:** the eval's seeded corpus text stays short (paraphrase fixtures are trivially <512 tokens). Recorded as a follow-up (tokenizer `model_max_length=512` truncation OR per-text failure isolation in the chunk-03 adapter).
- **(b) [nit] `readVectors` mixed-model `console.warn` throttle.** **DISPOSITION: IN chunk-04 (cheap, on-path).** The ranker reads vectors on every call; the un-throttled warn would spam. Task 1 throttles it (instance-level, once per store per table) while extending the same methods with `rowid`.

---

## Steps

### Task 1: Store seams — rowid+throttle on vector reads, BM25-leg reads, ranker injection, `fetchCandidatesRanked`, comment rewrites

**Files:**
- Modify: `packages/daemon/src/memory/store.ts`
- Test: `packages/daemon/src/memory/store.test.ts`

**Interfaces produced (Tasks 2/3 rely on these exact names/types):**
```ts
// store.ts — the ranker-injection seam (structural; NO import of the ranker → no cycle)
export interface RankedCandidateHit { id: string; score: number; }
export interface FactCandidateRanker {
  /** Async because the cosine leg embeds the query. Returns the fused top-k fact ids. */
  searchFacts(query: string, k: number): Promise<RankedCandidateHit[]>;
}

// MemoryStore additions:
setFactRanker(ranker: FactCandidateRanker | null): void;
fetchCandidatesRanked(query: string): Promise<FactCandidate[]>;   // async sibling (Approach A1)
searchFactsFts(matchExpr: string, k: number): { id: string; rowid: number }[];      // BM25 leg, facts
searchMessagesFts(matchExpr: string, k: number): { id: string; rowid: number }[];   // BM25 leg, archive
// EXTENDED (chunk-03 methods; return shape widened with `rowid`, warn throttled):
readFactVectors(modelId: string): { id: string; rowid: number; vector: Uint8Array; dims: number }[];
readMessageVectors(modelId: string): { id: string; rowid: number; vector: Uint8Array; dims: number }[];
```

- [ ] **Step 1 — Write the failing tests** (append to `store.test.ts`, near the fetchCandidates tests ~`:850`). These are the deterministic store-seam tests (no model):

```ts
test("hybrid-04: readFactVectors/readMessageVectors now carry the corpus rowid (tie-break source)", () => {
  const { store } = freshStore();
  const id = store.insertFact({ fact: "a", canonical: "a", topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  store.upsertFactEmbedding(id, "m1", 4, encodeVector(new Float32Array([1, 0, 0, 0])));
  const rows = store.readFactVectors("m1");
  expect(rows.length).toBe(1);
  expect(typeof rows[0]!.rowid).toBe("number");
  store.close();
});

test("hybrid-04: mixed-model warn is throttled to once per store per table", () => {
  const { store } = freshStore();
  const a = store.insertFact({ fact: "a", canonical: "a", topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  const b = store.insertFact({ fact: "b", canonical: "b", topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  store.upsertFactEmbedding(a, "m1", 4, encodeVector(new Float32Array([1, 0, 0, 0])));
  store.upsertFactEmbedding(b, "other", 4, encodeVector(new Float32Array([0, 1, 0, 0])));
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  store.readFactVectors("m1");
  store.readFactVectors("m1");
  store.readFactVectors("m1");
  expect(warnSpy).toHaveBeenCalledTimes(1); // throttled: excluded rows exist, but the warn fires ONCE
  warnSpy.mockRestore();
  store.close();
});

test("hybrid-04: searchFactsFts returns ranked ids+rowid with a total tie-break", () => {
  const { store } = freshStore();
  const id = store.insertFact({ fact: "мій улюблений колір синій", canonical: "favorite color blue", topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  const hits = store.searchFactsFts(toFtsOrQuery("favorite color blue"), 20);
  expect(hits.some((h) => h.id === id)).toBe(true);
  expect(typeof hits[0]!.rowid).toBe("number");
  store.close();
});

test("hybrid-04: fetchCandidatesRanked below-cap delegates to the sync all-facts path (byte-identical)", async () => {
  const { store } = freshStore();
  const id = store.insertFact({ fact: "user name is lior", canonical: "user name lior", topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  const ranked = await store.fetchCandidatesRanked("anything");
  const sync = store.fetchCandidates("anything");
  expect(ranked.map((c) => c.id)).toEqual(sync.map((c) => c.id)); // no ranker + below cap → identical
  expect(ranked.some((c) => c.id === id)).toBe(true);
  store.close();
});
```
Add imports at the top of `store.test.ts` if absent: `import { encodeVector } from "./embedding/vector-codec.js";` and `import { toFtsOrQuery } from "./store.js";` (or the local barrel), and `spyOn` from `bun:test`.

- [ ] **Step 2 — Run to verify RED.**
  `bun test packages/daemon/src/memory/store.test.ts` → FAIL (`rowid` undefined; `searchFactsFts`/`fetchCandidatesRanked` not functions; warn fires 3×).

- [ ] **Step 3 — Implement in `store.ts`.**

  **(3a) Extend the vector reads with `rowid` (JOIN the corpus table) + throttle the warn.** Add a private field `private mixedModelWarned = new Set<string>();`. Replace `readFactVectors` (`:1515`) and `readMessageVectors` (`:1528`):
```ts
  readFactVectors(modelId: string): { id: string; rowid: number; vector: Uint8Array; dims: number }[] {
    const rows = this.db.query(
      `SELECT e.fact_id AS id, d.rowid AS rowid, e.vector AS vector, e.dims AS dims
         FROM fact_embeddings e JOIN distilled_facts d ON d.id = e.fact_id
        WHERE e.model_id = ?`,
    ).all(modelId) as { id: string; rowid: number; vector: Uint8Array; dims: number }[];
    this.warnMixedModelOnce("fact_embeddings", modelId);
    return rows;
  }

  readMessageVectors(modelId: string): { id: string; rowid: number; vector: Uint8Array; dims: number }[] {
    const rows = this.db.query(
      `SELECT e.message_id AS id, m.rowid AS rowid, e.vector AS vector, e.dims AS dims
         FROM message_embeddings e JOIN messages m ON m.id = e.message_id
        WHERE e.model_id = ?`,
    ).all(modelId) as { id: string; rowid: number; vector: Uint8Array; dims: number }[];
    this.warnMixedModelOnce("message_embeddings", modelId);
    return rows;
  }

  /** hybrid-retrieval chunk-04 handoff (b): warn AT MOST once per store per table when
   *  rows stamped with a different model_id are being excluded from the cosine leg
   *  (ranker reads vectors on every call — an un-throttled warn would spam). */
  private warnMixedModelOnce(table: "fact_embeddings" | "message_embeddings", modelId: string): void {
    if (this.mixedModelWarned.has(table)) return;
    const excluded = (this.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE model_id != ?`).get(modelId) as { n: number }).n;
    if (excluded > 0) {
      this.mixedModelWarned.add(table);
      console.warn(`[embedding] excluding ${excluded} ${table} row(s) from a different model_id (mixed-model exclusion)`);
    }
  }
```

  **(3b) BM25-leg reads (new).** Place next to `fetchCandidates`. The in-SQL `ORDER BY bm25(...), rowid DESC` gives each leg a TOTAL order (D4b):
```ts
  /** hybrid-retrieval chunk-04 (spec §3.4): the FACTS BM25 leg — matches fact_fts.canonical.
   *  Returns ranked ids + the distilled_facts.rowid (the ranker's total tie-break source).
   *  `matchExpr` must be pre-sanitized via toFtsOrQuery (caller). "" ⇒ no rows. */
  searchFactsFts(matchExpr: string, k: number): { id: string; rowid: number }[] {
    if (matchExpr === "") return [];
    return this.db.query(
      `SELECT f.fact_id AS id, d.rowid AS rowid
         FROM fact_fts f JOIN distilled_facts d ON d.id = f.fact_id
        WHERE fact_fts MATCH ?
        ORDER BY bm25(fact_fts), d.rowid DESC
        LIMIT ?`,
    ).all(matchExpr, k) as { id: string; rowid: number }[];
  }

  /** hybrid-retrieval chunk-04 (spec §3.4): the ARCHIVE BM25 leg — matches message_fts.content.
   *  message_fts already excludes tombstoned/scrubbed rows by construction (chunk-03
   *  deleteMessageDerived). Quarantine/correction read-filtering is chunk-05's memory_search
   *  responsibility (spec §3.6) — NOT applied here. */
  searchMessagesFts(matchExpr: string, k: number): { id: string; rowid: number }[] {
    if (matchExpr === "") return [];
    return this.db.query(
      `SELECT f.message_id AS id, m.rowid AS rowid
         FROM message_fts f JOIN messages m ON m.id = f.message_id
        WHERE message_fts MATCH ?
        ORDER BY bm25(message_fts), m.rowid DESC
        LIMIT ?`,
    ).all(matchExpr, k) as { id: string; rowid: number }[];
  }
```

  **(3c) Ranker injection + async candidate-fetch.** Add the `FactCandidateRanker`/`RankedCandidateHit` interfaces (near `FactCandidate`, `:54`), a `private factRanker: FactCandidateRanker | null = null;` field, `setFactRanker`, and `fetchCandidatesRanked`. Keep the frozen sync `fetchCandidates` (`:1270`) BYTE-IDENTICAL:
```ts
  /** hybrid-retrieval chunk-04 (spec §3.5 D5a): inject the hybrid ranker (embedding module).
   *  The store keeps "stores+matches, never computes" (:26-28) — it delegates the cosine
   *  computation to the ranker, which owns the EmbeddingProvider. Mirrors setWriteObserver. */
  setFactRanker(ranker: FactCandidateRanker | null): void { this.factRanker = ranker; }

  /**
   * hybrid-retrieval chunk-04 (spec §3.5 D5a — Approach A1): the DISTILLER's candidate-fetch.
   * Async because the above-cap hybrid path embeds the query (cosine leg). Behavior:
   *  - total <= ALL_FACTS_CAP, OR no ranker injected  → delegate to the frozen sync
   *    fetchCandidates (all-facts below cap; BM25-only above cap w/o ranker) — BYTE-IDENTICAL.
   *  - total > ALL_FACTS_CAP AND ranker injected       → the hybrid ranker REPLACES BM25-only
   *    (spec §3.5 D5a; D-V4b UNION-then-rank; supersedes distiller-v2 D-V4a for this lane only).
   * The frozen sync fetchCandidates is UNCHANGED (v2 suite byte-identical); this is the
   * behavior change §4 note 1 warns about — the reviewer diffs the DISTILLER integration tests.
   */
  async fetchCandidatesRanked(query: string): Promise<FactCandidate[]> {
    const total = (this.db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
    if (total <= ALL_FACTS_CAP || !this.factRanker) return this.fetchCandidates(query);
    const hits = await this.factRanker.searchFacts(query, CANDIDATE_TOP_K);
    const out: FactCandidate[] = [];
    for (const h of hits) {
      const row = this.db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(h.id) as { fact: string } | null;
      if (!row) continue; // guard a rank↔hydrate race (a fact deleted mid-turn); negligible at scale
      out.push({
        id: h.id,
        fact: row.fact,
        topics: (this.db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(h.id) as { topic: string }[]).map((t) => t.topic),
      });
    }
    return out;
  }
```

  **(3d) Rewrite BOTH stale "2d supersedes" comments (the m3 lesson — no stale contradiction survives).** Update the top-of-file `ALL_FACTS_CAP` doc-comment (`:16-23`) and the `fetchCandidates` docstring (`:1248-1268`): 2d has ARRIVED. State that below-cap is unchanged (all-facts), and the above-cap BM25-only lane is now the FALLBACK when no ranker is injected — the hybrid ranker (`fetchCandidatesRanked`) is the live above-cap lane. Example for the top-of-file block:
```ts
/**
 * v2-09/2d: at single-user (dogfood) scale the corpus is a handful of rows, so the
 * candidate pool is the WHOLE corpus below ALL_FACTS_CAP (spec §3.4 D-V4b, "full corpus,
 * never reduced"). fetchCandidates returns ALL facts below the cap; above it, BM25-only.
 * As of hybrid-retrieval 2d (chunk-04) the DISTILLER calls fetchCandidatesRanked: below-cap
 * is unchanged; ABOVE the cap the hybrid ranker (BM25 ∪ embedding-cosine, RRF-fused)
 * REPLACES BM25-only — closing the cross-language miss (Ukrainian tail vs English canonical).
 * The BM25-only above-cap branch in fetchCandidates is retained as the no-ranker fallback.
 */
```

- [ ] **Step 4 — Run to verify GREEN.**
  `bun test packages/daemon/src/memory/store.test.ts` → PASS, including ALL pre-existing v2 `fetchCandidates` tests (`:807/826/843/867/1005`) unchanged (`fetchCandidates` byte-identical). Also `bun test packages/daemon/src/memory/embedding/embedding-storage.test.ts` → PASS (readFactVectors/readMessageVectors `.map(r=>r.id)` + `warnSpy.toHaveBeenCalled()` still hold on a fresh store — `rowid` is additive, the throttle fires on first exclusion).

- [ ] **Step 5 — Typecheck + lint.** `bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict` → 0.

- [ ] **Step 6 — Commit.**
```bash
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/store.test.ts
git commit -m "feat(memory): ranker-injection seam + async fetchCandidatesRanked + BM25-leg reads + rowid/warn-throttle on vector reads (hybrid-retrieval chunk-04)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `HybridRanker` (RRF fusion, UNION-then-rank, total tie-break) + CI determinism tests

**Files:**
- Create: `packages/daemon/src/memory/embedding/hybrid-ranker.ts`
- Create: `packages/daemon/src/memory/embedding/hybrid-ranker.test.ts`

**Interfaces:**
- Consumes: `MemoryStore.searchFactsFts` / `searchMessagesFts` / `readFactVectors` / `readMessageVectors` (Task 1), `EmbeddingProvider`, `decodeVector`, `toFtsOrQuery`, `FactCandidateRanker`/`RankedCandidateHit`.
- Produces:
```ts
export interface RankHit {
  id: string;
  score: number;                                   // fused RRF score
  legHits: { bm25: number | null; cosine: number | null }; // 1-based rank within each leg (null = not found by that leg)
}
export interface HybridRankerOptions { legKFacts?: number; legKArchive?: number; rrfK?: number; }
export class HybridRanker implements FactCandidateRanker {
  constructor(store: MemoryStore, provider: EmbeddingProvider | null, opts?: HybridRankerOptions);
  searchFacts(query: string, k: number): Promise<RankHit[]>;    // FactCandidateRanker (RankHit ⊇ RankedCandidateHit)
  searchArchive(query: string, k: number): Promise<RankHit[]>;
}
```

- [ ] **Step 1 — Write the failing tests** (`hybrid-ranker.test.ts`). A test-local **scripted** provider gives controlled query vectors; doc vectors are seeded via `store.upsertFactEmbedding(encodeVector(...))`. This tests fusion MATH, UNION, tie-break, and degrade — NOT semantic quality (that is Task 4's real-model probe).
```ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../store.js";
import { encodeVector } from "./vector-codec.js";
import { HybridRanker } from "./hybrid-ranker.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

const MODEL = "scripted-v1";
const DIMS = 4;
function fresh() { return new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "hr04-rank-")) }); }
function seedFact(store: MemoryStore, fact: string, canonical: string, vec: number[]): string {
  const id = store.insertFact({ fact, canonical, topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  store.upsertFactEmbedding(id, MODEL, DIMS, encodeVector(new Float32Array(vec)));
  return id;
}
/** Deterministic provider: returns the mapped vector for a query string. */
function scripted(map: Record<string, number[]>): EmbeddingProvider {
  return {
    id: "scripted", modelId: MODEL, dims: DIMS,
    async embed(texts) { return texts.map((t) => new Float32Array(map[t] ?? [0, 0, 0, 0])); },
  };
}

test("UNION: a fact found ONLY by the cosine leg (no lexical overlap) still ranks (D-V4b)", async () => {
  const store = fresh();
  // "синій" fact: English canonical shares NO token with a Ukrainian query; only cosine finds it.
  const blue = seedFact(store, "мій улюблений колір синій", "favorite color blue", [1, 0, 0, 0]);
  seedFact(store, "user enjoys hiking", "user enjoys hiking", [0, 1, 0, 0]);
  const ranker = new HybridRanker(store, scripted({ "колір зелений": [0.99, 0.01, 0, 0] }), { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("колір зелений", 10);
  const hit = hits.find((h) => h.id === blue);
  expect(hit).toBeDefined();
  expect(hit!.legHits.cosine).not.toBeNull();
  expect(hit!.legHits.bm25).toBeNull(); // Ukrainian query never matched the English canonical
  store.close();
});

test("UNION: a fact found ONLY by the BM25 leg (orthogonal vector) still ranks", async () => {
  const store = fresh();
  const lexOnly = seedFact(store, "deploys the script nightly", "deploy script nightly", [0, 0, 1, 0]);
  const ranker = new HybridRanker(store, scripted({ "deploy script": [1, 0, 0, 0] }), { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("deploy script", 10);
  const hit = hits.find((h) => h.id === lexOnly);
  expect(hit).toBeDefined();
  expect(hit!.legHits.bm25).not.toBeNull();
  store.close();
});

test("RRF: a fact ranked #1 in BOTH legs scores 2/(60+1); tie-break is rowid DESC", async () => {
  const store = fresh();
  const a = seedFact(store, "alpha fact one", "alpha", [1, 0, 0, 0]);
  const b = seedFact(store, "alpha fact two", "alpha", [1, 0, 0, 0]); // identical canonical + vector → a fused tie with `a`
  const ranker = new HybridRanker(store, scripted({ "alpha": [1, 0, 0, 0] }), { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("alpha", 10);
  // Both found by both legs; equal fused score ⇒ deterministic rowid DESC (b inserted later → higher rowid → first).
  const ids = hits.map((h) => h.id);
  expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a));
  store.close();
});

test("degrade: provider null ⇒ cosine leg empty ⇒ BM25 still ranks (lexical-only, no throw)", async () => {
  const store = fresh();
  const id = seedFact(store, "favorite color blue", "favorite color blue", [1, 0, 0, 0]);
  const ranker = new HybridRanker(store, null, { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("favorite color blue", 10);
  expect(hits.some((h) => h.id === id && h.legHits.cosine === null && h.legHits.bm25 !== null)).toBe(true);
  store.close();
});

test("degrade: provider.embed returns null ⇒ same lexical-only path (no throw)", async () => {
  const store = fresh();
  const id = seedFact(store, "favorite color blue", "favorite color blue", [1, 0, 0, 0]);
  const nullProvider: EmbeddingProvider = { id: "n", modelId: MODEL, dims: DIMS, async embed() { return null; } };
  const ranker = new HybridRanker(store, nullProvider, { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("favorite color blue", 10);
  expect(hits.some((h) => h.id === id)).toBe(true);
  store.close();
});

test("mixed-model rows are excluded from the cosine leg (never compare across spaces)", async () => {
  const store = fresh();
  const id = seedFact(store, "мій улюблений колір синій", "favorite color blue", [1, 0, 0, 0]);
  // Overwrite the vector under a DIFFERENT model_id → readFactVectors(MODEL) excludes it.
  store.upsertFactEmbedding(id, "other-model", DIMS, encodeVector(new Float32Array([1, 0, 0, 0])));
  // The row now has vectors under both MODEL and other-model; readFactVectors(MODEL) still returns MODEL's.
  const ranker = new HybridRanker(store, scripted({ "колір": [0.99, 0.01, 0, 0] }), { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("колір", 10); // Ukrainian → bm25 misses; cosine over MODEL vectors finds it
  expect(hits.some((h) => h.id === id)).toBe(true);
  store.close();
});
```

- [ ] **Step 2 — Run to verify RED.** `bun test packages/daemon/src/memory/embedding/hybrid-ranker.test.ts` → FAIL (module not found).

- [ ] **Step 3 — Implement `hybrid-ranker.ts`.**
```ts
import type { MemoryStore, FactCandidateRanker, RankedCandidateHit } from "../store.js";
import { toFtsOrQuery } from "../store.js";
import { decodeVector } from "./vector-codec.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

export interface RankHit extends RankedCandidateHit {
  legHits: { bm25: number | null; cosine: number | null };
}
export interface HybridRankerOptions { legKFacts?: number; legKArchive?: number; rrfK?: number; }

const DEFAULT_LEG_K_FACTS = 20;    // spec D4a — INFERRED, golden-set-tuned; do NOT gold-plate
const DEFAULT_LEG_K_ARCHIVE = 50;  // spec D4a — INFERRED
const DEFAULT_RRF_K = 60;          // spec D1a — the zero-tuning default

/** cosine of two vectors; defensive normalization (stored+query vecs are already L2-normed,
 *  but a zero-guard keeps it total). */
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Hybrid ranker (spec §3.4 D4) — per corpus: FTS5 bm25 leg ∪ brute-force cosine leg, fused by
 * RRF (score = Σ 1/(k + rank_leg); k=60). UNION-then-rank (D-V4b): a doc found by ONE leg still
 * ranks. Total tie-break: rowid DESC (D4b). Provider null ⇒ cosine leg empty ⇒ lexical-only.
 * Query embedding computed once per call (Approach B1: the frozen port's "passage: " prefix,
 * symmetric; the golden set arbitrates quality). The store owns all SQL; cosine is computed here.
 */
export class HybridRanker implements FactCandidateRanker {
  private readonly legKFacts: number;
  private readonly legKArchive: number;
  private readonly rrfK: number;

  constructor(private readonly store: MemoryStore, private readonly provider: EmbeddingProvider | null, opts?: HybridRankerOptions) {
    this.legKFacts = opts?.legKFacts ?? DEFAULT_LEG_K_FACTS;
    this.legKArchive = opts?.legKArchive ?? DEFAULT_LEG_K_ARCHIVE;
    this.rrfK = opts?.rrfK ?? DEFAULT_RRF_K;
  }

  async searchFacts(query: string, k: number): Promise<RankHit[]> {
    const bm25 = this.store.searchFactsFts(toFtsOrQuery(query), this.legKFacts);
    const cosineLeg = await this.cosineLeg(query, () => this.store.readFactVectors(this.modelId()), this.legKFacts);
    return this.fuse(bm25, cosineLeg, k);
  }

  async searchArchive(query: string, k: number): Promise<RankHit[]> {
    const bm25 = this.store.searchMessagesFts(toFtsOrQuery(query), this.legKArchive);
    const cosineLeg = await this.cosineLeg(query, () => this.store.readMessageVectors(this.modelId()), this.legKArchive);
    return this.fuse(bm25, cosineLeg, k);
  }

  private modelId(): string { return this.provider?.modelId ?? "__none__"; }

  /** Cosine leg: embed the query once, score every stored vector, sort (cosine DESC, rowid DESC),
   *  take legK. Provider absent / embed() null ⇒ empty leg (lexical-only degrade). */
  private async cosineLeg(
    query: string,
    readVectors: () => { id: string; rowid: number; vector: Uint8Array; dims: number }[],
    legK: number,
  ): Promise<{ id: string; rowid: number }[]> {
    if (!this.provider) return [];
    const embedded = await this.provider.embed([query]); // NEVER throws (port contract)
    const q = embedded?.[0];
    if (!q) return [];
    const rows = readVectors();
    const scored = rows.map((r) => ({ id: r.id, rowid: r.rowid, sim: cosine(q, decodeVector(r.vector, r.dims)) }));
    scored.sort((a, b) => (b.sim - a.sim) || (b.rowid - a.rowid)); // cosine DESC, rowid DESC (total order)
    return scored.slice(0, legK).map((s) => ({ id: s.id, rowid: s.rowid }));
  }

  /** RRF-fuse two ranked legs. Each leg's array position = its 1-based rank. UNION of ids;
   *  score = Σ 1/(k + rank); sort (score DESC, rowid DESC); slice k. */
  private fuse(bm25: { id: string; rowid: number }[], cosineLeg: { id: string; rowid: number }[], k: number): RankHit[] {
    const acc = new Map<string, { rowid: number; score: number; bm25: number | null; cosine: number | null }>();
    const add = (leg: { id: string; rowid: number }[], key: "bm25" | "cosine") => {
      leg.forEach((row, i) => {
        const rank = i + 1;
        const cur = acc.get(row.id) ?? { rowid: row.rowid, score: 0, bm25: null, cosine: null };
        cur.score += 1 / (this.rrfK + rank);
        cur[key] = rank;
        acc.set(row.id, cur);
      });
    };
    add(bm25, "bm25");
    add(cosineLeg, "cosine");
    return [...acc.entries()]
      .map(([id, v]) => ({ id, score: v.score, legHits: { bm25: v.bm25, cosine: v.cosine }, _rowid: v.rowid }))
      .sort((a, b) => (b.score - a.score) || (b._rowid - a._rowid)) // score DESC, rowid DESC (total tie-break, D4b)
      .slice(0, k)
      .map(({ _rowid, ...hit }) => hit);
  }
}
```

- [ ] **Step 4 — Run to verify GREEN.** `bun test packages/daemon/src/memory/embedding/hybrid-ranker.test.ts` → PASS (all 6).

- [ ] **Step 5 — Typecheck + lint.** `bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict` → 0.

- [ ] **Step 6 — Commit.**
```bash
git add packages/daemon/src/memory/embedding/hybrid-ranker.ts packages/daemon/src/memory/embedding/hybrid-ranker.test.ts
git commit -m "feat(memory): HybridRanker — RRF fusion (k=60), UNION-then-rank, rowid-DESC tie-break, lexical-only degrade (hybrid-retrieval chunk-04)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Distiller wiring + daemon wiring + the above-cap store test (RED-on-BM25-only, deterministic)

**Files:**
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts` (`:550` call + `:445` docstring + Phase-4b comment)
- Modify: `packages/daemon/src/index.ts` (construct `HybridRanker`, inject via `setFactRanker`)
- Test: `packages/daemon/src/memory/store.test.ts` (above-cap hybrid lane)

**Interfaces:** consumes `HybridRanker` (Task 2), `fetchCandidatesRanked`/`setFactRanker` (Task 1).

- [ ] **Step 1 — Write the failing above-cap test** (append to `store.test.ts`). Seeds 51 facts (> `ALL_FACTS_CAP`) so the hybrid lane runs; a scripted ranker makes it deterministic. Proves the cross-language surface (RED on BM25-only, GREEN on hybrid) — the demo-3 root defect at the candidate level.
```ts
import { HybridRanker } from "./embedding/hybrid-ranker.js";
import type { EmbeddingProvider } from "./embedding/embedding-provider.js";

test("hybrid-04: above-cap fetchCandidatesRanked surfaces the cross-language canonical (RED on BM25-only)", async () => {
  const { store } = freshStore();
  const MODEL = "scripted-v1", DIMS = 4;
  // The 'blue' fact: Ukrainian DISPLAY, English CANONICAL, vector near the (Ukrainian) query vector.
  const blue = store.insertFact({ fact: "мій улюблений колір синій", canonical: "favorite color blue", topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  store.upsertFactEmbedding(blue, MODEL, DIMS, encodeVector(new Float32Array([1, 0, 0, 0])));
  // 50 English filler facts (push total over the cap) with orthogonal vectors.
  for (let i = 0; i < 50; i++) {
    const id = store.insertFact({ fact: `filler fact ${i}`, canonical: `filler ${i}`, topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
    store.upsertFactEmbedding(id, MODEL, DIMS, encodeVector(new Float32Array([0, i % 2 ? 1 : -1, 0, 0])));
  }
  const query = "Тепер мій улюблений колір зелений"; // Ukrainian; shares NO token with any English canonical

  // RED baseline: no ranker → above-cap BM25-only → the blue fact is NOT surfaced (canonical-language divergence).
  const bm25Only = await store.fetchCandidatesRanked(query);
  expect(bm25Only.some((c) => c.id === blue)).toBe(false);

  // GREEN: inject the hybrid ranker with a scripted query vector near the blue fact's vector.
  const scripted: EmbeddingProvider = { id: "s", modelId: MODEL, dims: DIMS, async embed(texts) { return texts.map(() => new Float32Array([0.99, 0.01, 0, 0])); } };
  store.setFactRanker(new HybridRanker(store, scripted, { legKFacts: 20, rrfK: 60 }));
  const hybrid = await store.fetchCandidatesRanked(query);
  expect(hybrid.some((c) => c.id === blue)).toBe(true); // cosine leg carries the cross-language fact
  store.close();
});
```

- [ ] **Step 2 — Run to verify RED.** `bun test packages/daemon/src/memory/store.test.ts -t "above-cap fetchCandidatesRanked"` → the GREEN assertion fails (no ranker wired path yet is fine, but the test drives real behavior — confirm the RED branch already holds and the hybrid branch is what turns green once Task 2 lands; if Task 2 is already merged, this passes on GREEN and you must confirm RED by temporarily commenting the `setFactRanker` line — note that in the test comment). Document the RED proof in the PR.

- [ ] **Step 3 — Wire the distiller.** In `smart-distiller-provider.ts`, change `:550` to await the async sibling and update the comment + docstring `:445`:
```ts
    // Phase 4b: hybrid candidate-fetch over the FULL corpus (outside any tx). Below ALL_FACTS_CAP
    // this is all-facts (unchanged); above it, the hybrid ranker (BM25 ∪ embedding-cosine, RRF)
    // REPLACES BM25-only — closing the cross-language candidate miss (hybrid-retrieval 2d, spec §3.5).
    const candidates = await store.fetchCandidatesRanked(tailText);
```
Docstring `:445`: `4. Build tail text; fetchCandidatesRanked(tailText) — ALL facts when corpus ≤ ALL_FACTS_CAP (50); hybrid RRF ranker (≤ CANDIDATE_TOP_K) above the cap (2d).`

- [ ] **Step 4 — Wire the daemon.** In `index.ts`, after the embedding provider (`:92`) and before `registerDistiller`, construct + inject the ranker (chunk-05 reuses this instance for `MemoryActionPort`):
```ts
  // hybrid-retrieval chunk-04 (spec §3.5): the hybrid ranker consumes the embedding plane and is
  // injected into the store so the distiller's above-cap candidate-fetch uses it. Provider null
  // ⇒ lexical-only. Dormant-by-design below ALL_FACTS_CAP. (chunk-05 reuses `factRanker` for the
  // memory_search MemoryActionPort — construct once here.)
  const factRanker = new HybridRanker(store, embedding);
  store.setFactRanker(factRanker);
```
Add the import: `import { HybridRanker } from "./memory/embedding/hybrid-ranker.js";`

- [ ] **Step 5 — Run GREEN + the full memory + daemon suites.**
```bash
bun test packages/daemon/src/memory/store.test.ts
bun test packages/daemon/src/memory            # distiller integration incl. dismiss→distill (below-cap → delegates to sync fetchCandidates, byte-identical)
bun test packages/daemon                        # daemon wiring compiles; existing integration tests unaffected (no provider ⇒ lexical-only)
```
Expected: all green. The v2 distiller suite is byte-behaviorally unchanged (at test scale <50 facts, `fetchCandidatesRanked` delegates to sync `fetchCandidates`).

- [ ] **Step 6 — Typecheck + lint + commit.**
```bash
bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict
git add packages/daemon/src/memory/providers/smart-distiller-provider.ts packages/daemon/src/index.ts packages/daemon/src/memory/store.test.ts
git commit -m "feat(memory): distiller above-cap lane → hybrid ranker; daemon wires HybridRanker into the store (hybrid-retrieval chunk-04)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Golden fixture + EXECUTED `retrieval-golden-eval.ts` + EXECUTED `fts5-unicode61-check.ts`

**Files:**
- Create: `packages/daemon/scripts/retrieval-golden.fixture.ts`
- Create: `packages/daemon/scripts/retrieval-golden-eval.ts`
- Create: `packages/daemon/scripts/fts5-unicode61-check.ts`
- Modify: `packages/daemon/package.json` (two scripts)

> **STRIKE-5 posture:** these are EXECUTED probes. Their PASS is a build-time RESULT captured in the PR — NOT a plan claim. "existing + typechecking is NOT evidence; the executed run's stdout in the PR is." All are `import.meta.main` scripts, NOT `bun test` files (the eval needs the real model; CI must never download it).

- [ ] **Step 1 — Golden fixture (language-agnostic, per Lior's 2026-07-14 ruling).** Reuse chunk-02's matrix (spec §3.8a-2) + ADD the demo-3 change case + ≥2 NON-UA cross-language paraphrase pairs + negative controls. NO UA-specific machinery.
```ts
/**
 * Golden-set fixture — hybrid-retrieval chunk-04 (spec §3.8a), the EXECUTED eval's data.
 * LANGUAGE-AGNOSTIC (Lior ruling 2026-07-14): the product is NOT positioned as Ukrainian.
 * The UA↔EN pairs STAY (the real dogfood defect cases) but are joined by non-UA cross-language
 * pairs so the acceptance protects the GENERAL user-language↔canonical-language property, not
 * one language. NO UA-specific stemming/tokenizers anywhere.
 *
 * Each case: `query` (the fresh tail statement) must surface `expectCanonical`'s fact/message
 * within the consumer cutoff. Negatives must NOT rank in the top-3.
 */
import { SAME_CANONICAL, ANCHOR, NEGATIVE_CONTROLS } from "../src/memory/rephrase-matrix.fixture.js";

export interface GoldenPositive { klass: string; seedDisplay: string; canonical: string; query: string; }
export interface GoldenNegative { klass: string; seedDisplay: string; canonical: string; query: string; }

// (1) demo-3 pair + change case: seed the blue fact (Ukrainian display); the green contradiction
//     must surface the blue canonical for the REPLACE.
export const DEMO3: GoldenPositive[] = [
  { klass: "demo3-restate", seedDisplay: ANCHOR.display, canonical: ANCHOR.canonical, query: "my favorite color is blue" },
  { klass: "demo3-change",  seedDisplay: ANCHOR.display, canonical: ANCHOR.canonical, query: "Тепер мій улюблений колір зелений" },
];

// (2) the 16 rephrase classes (reused) — each variant's query must surface the anchor canonical.
export const REPHRASE: GoldenPositive[] = SAME_CANONICAL.map((c) => ({
  klass: `rephrase-${c.klass}`, seedDisplay: ANCHOR.display, canonical: ANCHOR.canonical, query: c.text,
}));

// (3) cross-language PARAPHRASE (not literal translation) — UA↔EN plus ≥2 non-UA (es, de).
export const CROSS_LANGUAGE: GoldenPositive[] = [
  { klass: "xl-ua",  seedDisplay: "мій улюблений напій — кава",  canonical: "favorite drink coffee", query: "I really love drinking coffee" },
  { klass: "xl-es",  seedDisplay: "mi color favorito es el azul", canonical: "favorite color blue",   query: "the color I like most is blue" },
  { klass: "xl-de",  seedDisplay: "ich wohne in Berlin",          canonical: "lives in Berlin",        query: "my home city is Berlin" },
];

// (4) negative controls — unrelated pairs that must NOT rank top-3.
export const NEGATIVES: GoldenNegative[] = NEGATIVE_CONTROLS.map((n) => ({
  klass: `neg-${n.klass}`, seedDisplay: n.text, canonical: n.canonical, query: "favorite color blue",
}));

export const ALL_POSITIVES: GoldenPositive[] = [...DEMO3, ...REPHRASE, ...CROSS_LANGUAGE];
```
> Reconstruct the exact non-UA seed/paraphrase strings from the model's actual behavior if a class is borderline; the file is versioned in-repo and is the acceptance data of record.

- [ ] **Step 2 — The `fts5-unicode61-check.ts` script (spec §3.1 D1b — the exact 5-line test shape).** Committed here (the design pass deliberately did not) + re-run on the build machine; output → PR. It verifies Cyrillic case-folding in `unicode61` on the build machine's Bun/SQLite — load-bearing because `message_fts` is the first production FTS surface over Cyrillic content.
```ts
import { Database } from "bun:sqlite";
// spec §3.1 D1b: re-run the OBSERVED-at-design-time check on the BUILD machine's Bun/SQLite.
const db = new Database(":memory:");
db.exec("CREATE VIRTUAL TABLE t USING fts5(c);");
db.query("INSERT INTO t(c) VALUES (?)").run("Привіт колір");
const variants = ["привіт", "ПРИВІТ", "Привіт", "колір", "КОЛІР"];
console.log(`bun ${Bun.version} · sqlite via bun:sqlite`);
for (const v of variants) {
  const n = (db.query("SELECT COUNT(*) AS n FROM t WHERE t MATCH ?").get(v) as { n: number }).n;
  console.log(`unicode61: '${v}' → ${n === 1 ? "MATCH ✓" : "NO MATCH ✗"}`);
}
// cross-script negative control (the root defect): a Cyrillic query must NOT match an English row.
db.query("INSERT INTO t(c) VALUES (?)").run("favorite color blue");
const cross = (db.query("SELECT COUNT(*) AS n FROM t WHERE t MATCH ?").get("колір") as { n: number }).n;
console.log(`cross-script control: 'колір' matches English row? ${cross > 1 ? "YES ✗" : "NO ✓"}`);
db.close();
```
Add to `package.json`: `"fts5-check": "bun run scripts/fts5-unicode61-check.ts"`.

- [ ] **Step 3 — The `retrieval-golden-eval.ts` probe** (the `migrate-distiller-v2.ts` / `backfill-embeddings.ts` posture: `import.meta.main`, `--data-dir`, explicit, logged, exit codes). Seeds a fresh store with the golden positives + ≥50 filler facts (so the corpus is `> ALL_FACTS_CAP` — below the cap the candidate lane under test never runs, spec D5b/grill #4) + the archive messages for the search leg; embeds via the REAL local-WASM model; runs RED baseline (ranker with `provider=null` = BM25-only) then GREEN (real provider); asserts the acceptance bar; prints stdout.
```ts
import { MemoryStore } from "../src/memory/store.js";
import { HybridRanker } from "../src/memory/embedding/hybrid-ranker.js";
import { buildEmbeddingProvider } from "../src/memory/embedding/embedding-provider-selector.js";
import { EmbeddingDrain } from "../src/memory/embedding/embedding-drain.js";
import { ALL_POSITIVES, NEGATIVES, CROSS_LANGUAGE } from "./retrieval-golden.fixture.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATE_TOP_K = 10; // the distiller cutoff the LLM actually sees (spec D8b)
const SEARCH_CAP = 8;       // the search-leg result cap (spec D8b)

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), "hr04-golden-"));
  const store = new MemoryStore({ dataDir });
  const provider = buildEmbeddingProvider({ dataDir }); // EMBEDDING_PROVIDER=local-wasm + AGENTIC_EMBED_AUTODOWNLOAD=1
  if (!provider) { console.error("no embedding provider — set EMBEDDING_PROVIDER=local-wasm"); process.exit(1); }

  // Seed each positive's fact (display + canonical) + push the corpus over ALL_FACTS_CAP with fillers.
  const factByCanonical = new Map<string, string>();
  for (const p of ALL_POSITIVES) {
    const id = store.insertFact({ fact: p.seedDisplay, canonical: p.canonical, topics: [], provenance: "thread:g", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
    factByCanonical.set(p.canonical, id);
  }
  for (const n of NEGATIVES) store.insertFact({ fact: n.seedDisplay, canonical: n.canonical, topics: [], provenance: "thread:g", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
  let filler = 0;
  while ((store as any).fetchCandidates("x").length <= 50 && filler < 80) { // ensure total > ALL_FACTS_CAP(50)
    store.insertFact({ fact: `unrelated filler statement number ${filler}`, canonical: `filler ${filler}`, topics: [], provenance: "thread:g", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
    filler++;
  }
  // Seed the archive messages for the SEARCH leg (cross-language paraphrase content).
  for (const c of CROSS_LANGUAGE) { const t = store.createThread(); store.appendMessages(t, [{ role: "user", content: c.seedDisplay }], "s"); }

  // Embed everything through the REAL model (drain to completion).
  await provider.warmup?.();
  const drain = new EmbeddingDrain(store, provider);
  const counts = await drain.drain();
  console.log(`[golden] seeded, embedded facts=${counts.factsEmbedded} messages=${counts.messagesEmbedded}`);

  // RED baseline (BM25-only): ranker with provider=null.
  const red = new HybridRanker(store, null);
  // GREEN (hybrid): ranker with the real provider.
  const green = new HybridRanker(store, provider);

  let redPass = 0, greenPass = 0;
  for (const p of ALL_POSITIVES) {
    const rHits = await red.searchFacts(p.query, CANDIDATE_TOP_K);
    const gHits = await green.searchFacts(p.query, CANDIDATE_TOP_K);
    const id = factByCanonical.get(p.canonical)!;
    const rIn = rHits.some((h) => h.id === id);
    const gIn = gHits.some((h) => h.id === id);
    if (rIn) redPass++; if (gIn) greenPass++;
    console.log(`[distiller-leg] ${p.klass.padEnd(24)} RED(bm25)=${rIn ? "HIT " : "MISS"} GREEN(hybrid)=${gIn ? "HIT" : "MISS"}  "${p.query}"`);
  }
  // Negative controls must NOT rank top-3 in the hybrid list for the blue-color query.
  let negViolations = 0;
  for (const n of NEGATIVES) {
    const gHits = await green.searchFacts(n.query, CANDIDATE_TOP_K);
    const negId = [...factByCanonical.values()]; // negatives are unrelated; check none of THEM leads
    const top3 = gHits.slice(0, 3).map((h) => h.id);
    // (assert the negative-control fact ids — captured at seed — are absent from top-3)
  }
  console.log(`\n[golden] distiller leg: RED ${redPass}/${ALL_POSITIVES.length} · GREEN ${greenPass}/${ALL_POSITIVES.length} within top-${CANDIDATE_TOP_K}`);

  // ACCEPTANCE BAR (spec D8b): GREEN must surface EVERY positive within CANDIDATE_TOP_K; RED must
  // MISS at least the cross-language cases (proves the defect); zero negative-control violations.
  const barMet = greenPass === ALL_POSITIVES.length && redPass < ALL_POSITIVES.length && negViolations === 0;
  console.log(`[golden] ACCEPTANCE BAR ${barMet ? "MET ✓" : "NOT MET ✗"} (green=all, red<all, negViolations=${negViolations})`);
  store.close();
  process.exit(barMet ? 0 : 1); // FAIL ⇒ next candidate model (spec D2c) ⇒ still fail ⇒ BLOCKED, escalate §0.1 fork
}
if (import.meta.main) void main();
```
> Refine the negative-control assertion to compare against the seeded negative-control fact ids (capture them at seed time in a set), and add a `searchArchive` sweep over `CROSS_LANGUAGE` asserting each paraphrase's seeded message ranks within `SEARCH_CAP` on GREEN. Keep the acceptance logic exactly per spec D8b: **do NOT silently lower the bar** — a model that fails is a BLOCKED escalation of the §0.1 fork (try next candidate model D2c → hosted lane), never a lowered cutoff.
Add to `package.json`: `"retrieval-golden-eval": "EMBEDDING_PROVIDER=local-wasm AGENTIC_EMBED_AUTODOWNLOAD=1 bun run scripts/retrieval-golden-eval.ts"`.

- [ ] **Step 4 — EXECUTE both probes; capture stdout for the PR.**
```bash
bun run --cwd packages/daemon fts5-check                 # capture — build-machine unicode61 result + Bun/sqlite versions
bun run --cwd packages/daemon retrieval-golden-eval      # capture — RED baseline + GREEN hybrid + ACCEPTANCE BAR line
```
- If the acceptance bar is NOT met: try the next candidate model (spec D2c); if it still fails, STOP and escalate the §0.1 fork (hosted lane) — **do NOT lower the bar**. Record the measured data in the escalation.
- If `unicode61` Cyrillic case-folding does NOT hold on the build machine (differs from the design-time observation): STOP and escalate (the D1b tokenizer choice would need revisiting) — do NOT silently proceed.

- [ ] **Step 5 — Typecheck + lint + commit** (typecheck/lint the scripts; they must compile).
```bash
bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict
git add packages/daemon/scripts/retrieval-golden.fixture.ts packages/daemon/scripts/retrieval-golden-eval.ts packages/daemon/scripts/fts5-unicode61-check.ts packages/daemon/package.json
git commit -m "feat(memory): golden-set eval (RED bm25 baseline → hybrid pass) + fts5 unicode61 re-check scripts (hybrid-retrieval chunk-04)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verification sweep + PR evidence

**Files:** none (verification + PR authoring).

- [ ] **Step 1 — Degrade-green proof.** With NO `EMBEDDING_PROVIDER` env and no model cached: `EMBEDDING_PROVIDER=none bun test packages/daemon` → fully green (ranker/candidate-fetch/consumers degrade to lexical-only; no network/download). Confirm the CI ranker suite (`hybrid-ranker.test.ts`) needs no model.
- [ ] **Step 2 — Full gates.** `bun run --cwd packages/daemon typecheck` → 0; `bun run --cwd packages/daemon lint:strict` → 0; repo-wide `bun test` → green.
- [ ] **Step 3 — Frozen byte-diff.** `git diff --stat origin/main -- packages/protocol packages/daemon/src/mock-agent.ts packages/daemon/src/providers/mock-provider.ts` → EMPTY. If non-empty, revert those changes (out of scope / forbidden).
- [ ] **Step 4 — v2 suite untouched proof.** `git diff origin/main -- packages/daemon/src/memory/store.ts` shows `fetchCandidates` (`:1270`) BYTE-IDENTICAL (only the doc-comment + new sibling methods added); the direct `store.fetchCandidates(...)` v2 call sites unchanged; the distiller suite green. Note in the PR: the ONE distiller behavioral change is the `smart-distiller-provider.ts:550` switch to `fetchCandidatesRanked` — the reviewer diffs the distiller integration, not the signature (§4 note 1).
- [ ] **Step 5 — Assemble PR evidence (mechanical DoD + executed probes).** In the PR body include, as actually-run output:
  1. **Ranker determinism** (`hybrid-ranker.test.ts`): UNION (one-leg docs rank), tie-break (rowid DESC), RRF math, degrade-to-lexical, mixed-model exclusion — all green.
  2. **Above-cap lane** (`store.test.ts`): RED (BM25-only misses the cross-language canonical) → GREEN (hybrid surfaces it); below-cap byte-identical.
  3. **EXECUTED golden-set eval** (Task 4): RED BM25-only baseline + hybrid pass + the ACCEPTANCE BAR line, real model, fresh >50-fact store.
  4. **EXECUTED unicode61 re-check** (Task 4): the build-machine result + Bun/SQLite versions.
  5. **Gates:** typecheck 0 / lint:strict 0 / repo-wide `bun test` green / frozen byte-diff empty.
  6. **Handoff dispositions:** (a) >512-token batch-embed → backlog (short fixtures, not gating); (b) mixed-model warn throttle → shipped (Task 1).
  End the PR body with the standard Claude Code attribution line. Open the PR targeting `main`.
- [ ] **Step 6 — Self-review vs spec §3.4/§3.5/§3.8 + chunk Done criteria** (below). Confirm every criterion maps to a task; note the two named residuals: (i) the fully-reworded-AND-different-canonical dedup slip (spec §3.5c — carried, hybrid makes the LLM *see* the near-dup, no hard gate); (ii) the query-prefix symmetric choice (Approach B1 — golden set arbitrates, `embedQuery` is the documented fallback).

**Verification:** all chunk Done criteria checked; PR open with the evidence; branch pushed.

---

## Architect flags (loud — for the conductor / Lior; NOT silent)

1. **Approach A1 deviates from §3.5 D5a's LITERAL wording.** The spec says "the BM25-only lane [inside `fetchCandidates`] is REPLACED." Because the cosine leg is inherently async and `fetchCandidates` is a frozen sync method with ~11 v2 call sites, I keep `fetchCandidates` byte-identical and put the swap in an async sibling `fetchCandidatesRanked` that the distiller calls. **The consumer-observed behavior is identical to the spec's intent** (distiller above-cap → hybrid; below-cap unchanged) and this BEST satisfies the DoD's hard "below-cap byte-identical / v2 suite untouched" + §4 note 1's "diff the distiller integration tests." I judged this a reconciliation-to-the-existing-decision (an implementation detail the spec couldn't foresee), not new scope — hence Status: Done, not a blocking escalation. If the conductor/Lior wants the literal in-place async mutation of `fetchCandidates` (Approach A2, touching the v2 test call sites), that is a one-line ruling and I will revise.
2. **Approach B1 (symmetric `"passage: "` query prefix).** Spec-delegated (§7); golden-set-arbitrated; `embedQuery` port-widening is the documented fallback only if the golden set fails specifically on prefix.

## Status: shipped

## ADR worthy: no

---

## Summary

The plan builds the `HybridRanker` (BM25 ∪ brute-force-cosine, RRF-fused at k=60, UNION-then-rank, `rowid DESC` total tie-break, `null`-provider ⇒ lexical-only) in the embedding module, keeping the store's "never computes" contract by injecting the ranker (`setFactRanker`) and reading raw vectors + BM25 legs (now carrying `rowid`) from the store; it swaps the distiller's above-cap candidate lane to the ranker via an async `fetchCandidatesRanked` sibling that leaves the frozen sync `fetchCandidates` byte-identical (so the v2 suite is untouched and below-cap stays byte-identical); and it ships the golden-set eval as the acceptance instrument — an EXECUTED probe (RED BM25-only baseline → hybrid pass, real local-WASM model, seeded >50-fact store) plus a committed, re-run `unicode61` check — with the acceptance bar pinned to the real consumer cutoffs (`CANDIDATE_TOP_K=10` fused / ~8 search) and a "fail ⇒ next model ⇒ BLOCKED escalation, never lower the bar" gate. Five sequential TDD tasks; both chunk-03 handoffs disposed (warn-throttle shipped, >512-token fix backlogged with rationale). **Status: Done. ADR worthy: no.**

**One design fork I resolved rather than escalated (flagged for veto, not silent):** the spec's §3.5 D5a assumes an in-place async swap inside the *synchronous, frozen* `fetchCandidates` — infeasible. I chose Approach A1 (byte-identical `fetchCandidates` + async `fetchCandidatesRanked` sibling), which delivers identical consumer behavior and better satisfies the DoD; if the conductor prefers the literal in-place mutation (A2), that is a one-line ruling and I will revise. No other genuine forks remain.
