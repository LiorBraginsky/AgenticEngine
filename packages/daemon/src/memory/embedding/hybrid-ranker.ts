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
      .map(([id, v]) => ({ id, score: v.score, legHits: { bm25: v.bm25, cosine: v.cosine }, rowid: v.rowid }))
      .sort((a, b) => (b.score - a.score) || (b.rowid - a.rowid)) // score DESC, rowid DESC (total tie-break, D4b)
      .slice(0, k)
      .map((hit) => ({ id: hit.id, score: hit.score, legHits: hit.legHits }));
  }
}
