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
/** hybrid-04 MINOR-A3: the archive-leg (searchArchive) equivalent of seedFact — one message
 *  in a fresh thread, embedded under MODEL. */
function seedMessage(store: MemoryStore, content: string, vec: number[]): string {
  const t = store.createThread();
  const [id] = store.appendMessages(t, [{ role: "user", content }], "s1");
  store.upsertMessageEmbedding(id!, MODEL, DIMS, encodeVector(new Float32Array(vec)));
  return id!;
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

test("RRF: mirrored leg ranks produce a TRUE fused-score tie; tie-break is rowid DESC (D4b/D6c-flake invariant, reviewer MINOR-2)", async () => {
  const store = fresh();
  // Doc `a`: BM25 rank 1 (canonical matches BOTH query tokens "alpha"+"bravo"), cosine rank 2
  // (vector orthogonal to the query vector).
  const a = seedFact(store, "alpha bravo doc one", "alpha bravo", [0, 1, 0, 0]);
  // Doc `b`: BM25 rank 2 (canonical matches only ONE query token, "alpha"), cosine rank 1
  // (vector identical to the query vector). Mirrored ranks (a=1,2 / b=2,1) ⇒ RRF score
  // 1/61+1/62 for BOTH — addition commutes, so this is a GENUINE fused-score tie (unlike the
  // same-rank-pair test above, where equal per-leg ranks already differ in combined score and
  // the rowid-DESC branch in `fuse()` never executes).
  const b = seedFact(store, "alpha only doc two", "alpha", [1, 0, 0, 0]);
  const ranker = new HybridRanker(store, scripted({ "alpha bravo": [1, 0, 0, 0] }), { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("alpha bravo", 10);
  const hitA = hits.find((h) => h.id === a)!;
  const hitB = hits.find((h) => h.id === b)!;
  expect(hitA.legHits.bm25).toBe(1);
  expect(hitB.legHits.bm25).toBe(2);
  expect(hitA.legHits.cosine).toBe(2);
  expect(hitB.legHits.cosine).toBe(1);
  expect(hitA.score).toBeCloseTo(hitB.score, 10); // the TRUE fused-score tie
  const ids = hits.map((h) => h.id);
  expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a)); // tie-break: b (higher rowid, inserted later) ranks first
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
  // `id` is embedded under MODEL — findable via the cosine leg.
  const id = seedFact(store, "мій улюблений колір синій", "favorite color blue", [1, 0, 0, 0]);
  // `other` is a DIFFERENT fact, embedded under a DIFFERENT model_id, with a vector that would
  // otherwise score a near-perfect cosine match against the query — proving the exclusion is
  // load-bearing (not merely absent because nothing else was seeded).
  const other = store.insertFact(
    { fact: "unrelated other-model fact", canonical: "unrelated other model fact", topics: [], provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    "seed",
  );
  store.upsertFactEmbedding(other, "other-model", DIMS, encodeVector(new Float32Array([0.99, 0.01, 0, 0])));
  const ranker = new HybridRanker(store, scripted({ "колір": [0.99, 0.01, 0, 0] }), { legKFacts: 20, rrfK: 60 });
  const hits = await ranker.searchFacts("колір", 10); // Ukrainian → bm25 misses; cosine over MODEL vectors finds `id`
  expect(hits.some((h) => h.id === id)).toBe(true);
  expect(hits.some((h) => h.id === other)).toBe(false); // excluded — different model_id, never compared
  store.close();
});

// ── hybrid-04 MINOR-A3 (reviewer): the archive leg (searchArchive) ships as NEW production SQL
// (searchMessagesFts + readMessageVectors' rowid) exercised ONLY by the non-CI golden-eval probe
// before this fix — a JOIN/alias typo would not have been caught by `bun test`. Mirrors the
// facts-leg UNION + degrade tests above (searchArchive shares the same `fuse`/cosineLeg code,
// already covered for tie-break by the facts-leg RRF tests, so it is not duplicated here).

test("archive UNION: a message found ONLY by the cosine leg (no lexical overlap) still ranks (D-V4b)", async () => {
  const store = fresh();
  // Unlike the facts leg (which matches the ENGLISH canonical), the archive leg matches the
  // message's own CONTENT — so a same-script query (Ukrainian vs Ukrainian) would share tokens
  // literally. Use a cross-script (Latin query vs Cyrillic content) pair for a guaranteed-zero
  // token overlap, mirroring how the facts-leg UA cases isolate.
  const blue = seedMessage(store, "мій улюблений колір синій", [1, 0, 0, 0]);
  seedMessage(store, "user enjoys hiking", [0, 1, 0, 0]);
  const query = "I love the color blue the most";
  const ranker = new HybridRanker(store, scripted({ [query]: [0.99, 0.01, 0, 0] }), { legKArchive: 50, rrfK: 60 });
  const hits = await ranker.searchArchive(query, 10);
  const hit = hits.find((h) => h.id === blue);
  expect(hit).toBeDefined();
  expect(hit!.legHits.cosine).not.toBeNull();
  expect(hit!.legHits.bm25).toBeNull(); // English query never matched the Cyrillic message content
  store.close();
});

test("archive UNION: a message found ONLY by the BM25 leg (orthogonal vector) still ranks", async () => {
  const store = fresh();
  const lexOnly = seedMessage(store, "deploys the script nightly", [0, 0, 1, 0]);
  const ranker = new HybridRanker(store, scripted({ "deploy script": [1, 0, 0, 0] }), { legKArchive: 50, rrfK: 60 });
  const hits = await ranker.searchArchive("deploy script", 10);
  const hit = hits.find((h) => h.id === lexOnly);
  expect(hit).toBeDefined();
  expect(hit!.legHits.bm25).not.toBeNull();
  store.close();
});

test("archive degrade: provider null ⇒ cosine leg empty ⇒ BM25 still ranks (lexical-only, no throw)", async () => {
  const store = fresh();
  const id = seedMessage(store, "favorite color blue", [1, 0, 0, 0]);
  const ranker = new HybridRanker(store, null, { legKArchive: 50, rrfK: 60 });
  const hits = await ranker.searchArchive("favorite color blue", 10);
  expect(hits.some((h) => h.id === id && h.legHits.cosine === null && h.legHits.bm25 !== null)).toBe(true);
  store.close();
});

test("archive degrade: provider.embed returns null ⇒ same lexical-only path (no throw)", async () => {
  const store = fresh();
  const id = seedMessage(store, "favorite color blue", [1, 0, 0, 0]);
  const nullProvider: EmbeddingProvider = { id: "n", modelId: MODEL, dims: DIMS, async embed() { return null; } };
  const ranker = new HybridRanker(store, nullProvider, { legKArchive: 50, rrfK: 60 });
  const hits = await ranker.searchArchive("favorite color blue", 10);
  expect(hits.some((h) => h.id === id)).toBe(true);
  store.close();
});
