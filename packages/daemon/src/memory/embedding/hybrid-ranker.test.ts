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
