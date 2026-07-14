import type { EmbeddingProvider } from "./embedding-provider.js";

/** Options accepted by FixtureEmbeddingProvider. */
export interface FixtureEmbeddingProviderOptions {
  dims?: number;
  modelId?: string;
  /** Interleave hook — invoked with the exact texts passed to `embed`, BEFORE the
   *  vectors are computed. Used by embedding-drain.test.ts to simulate a scrub
   *  landing between the drain's pending-scan and its upsert (the headline
   *  scrub-race test, spec [grill #1]). */
  onEmbed?: (texts: string[]) => void;
}

/** FNV-1a 32-bit hash — deterministic, dependency-free. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small xorshift32 PRNG seeded from the FNV-1a hash — deterministic per-text stream. */
function xorshift32(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0xffffffff;
  };
}

/**
 * Deterministic vector provider (hybrid-retrieval spec §3.2 D2d) — the port's SECOND
 * implementation, used by every CI test (no I/O, no model, no network). Each distinct
 * text yields a bit-identical L2-normalized vector across calls; distinct texts yield
 * distinct vectors (hash-seeded PRNG, not random per-call).
 */
export class FixtureEmbeddingProvider implements EmbeddingProvider {
  readonly id = "fixture";
  readonly modelId: string;
  readonly dims: number;
  private readonly onEmbedHook?: (texts: string[]) => void;

  constructor(opts?: FixtureEmbeddingProviderOptions) {
    this.dims = opts?.dims ?? 8;
    this.modelId = opts?.modelId ?? "fixture-v1";
    this.onEmbedHook = opts?.onEmbed;
  }

  async embed(texts: string[]): Promise<Float32Array[] | null> {
    this.onEmbedHook?.(texts);
    return texts.map((t) => this.vectorFor(t));
  }

  private vectorFor(text: string): Float32Array {
    const rand = xorshift32(fnv1a(text));
    const v = new Float32Array(this.dims);
    for (let i = 0; i < this.dims; i++) v[i] = rand() * 2 - 1; // in [-1, 1]
    let normSq = 0;
    for (let i = 0; i < this.dims; i++) normSq += v[i]! * v[i]!;
    const norm = Math.sqrt(normSq) || 1;
    for (let i = 0; i < this.dims; i++) v[i] = v[i]! / norm;
    return v;
  }
}
