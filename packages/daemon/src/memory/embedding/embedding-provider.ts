/**
 * The `EmbeddingProvider` port (hybrid-retrieval spec §3.2 D2a; ADR-0017 decision 1) —
 * a THIRD swappable provider plane mirroring the established house pattern
 * (`AgentProvider` ADR-0010, `MemoryProvider` selector `memory-provider-selector.ts:51-73`):
 * a thin interface + a registry Map + env selection + loud-log graceful fallback.
 *
 * `embed()` NEVER throws — `null` = unavailable. Availability of every consumer (the
 * hybrid ranker, the distiller candidate-fetch, `memory_search`) never depends on the
 * embedding lane; only retrieval QUALITY does (degrade to lexical-only, ADR-0017 dec.1).
 */
export interface EmbeddingProvider {
  /** "local-wasm" | "fixture" | (future) "voyage" | "ollama" */
  readonly id: string;
  /** Stamped on every vector row — the swap-detection key (spec §3.3 D3a). Vectors from
   *  different `modelId`s are never compared (mixed rows excluded, loudly). */
  readonly modelId: string;
  readonly dims: number;
  /** Batch-shaped (backfill + distill-time embed are naturally batched). NEVER throws —
   *  any I/O/inference failure resolves to `null` for the WHOLE call. */
  embed(texts: string[]): Promise<Float32Array[] | null>;
  /**
   * OPTIONAL lifecycle hook: eagerly load/download the model in the background
   * (production daemon startup). Absent on providers that need no warmup (fixture,
   * hosted). Never throws. Not part of the consumer contract — only `embed()` is
   * consumed by the ranker/drain/search.
   */
  warmup?(): Promise<void>;
}

/**
 * NOT-BUILT adapter shapes (spec D2d) — documented here so a fast-follow chunk needs
 * no re-design. Neither is implemented in chunk-03; both are named, deliberate
 * deferrals gated on a real trigger (ADR-0017 decision 2 / "Explicitly NOT decided").
 *
 * **Voyage (hosted, opt-in-only — the fast-follow IFF the golden set fails every local
 * candidate model, spec D2d):**
 *   `POST https://api.voyageai.com/v1/embeddings` with body `{ input: texts, model:
 *   "voyage-multilingual-2" }`. API key resolved via the existing Keychain secret
 *   pattern — mirror `resolveAnthropicKey` in `../secrets/cloud-secrets.ts` (per-install
 *   Keychain entry, loud-log + `null`-degrade on no-key, never a shell-out in tests).
 *   `modelId = "voyage-multilingual-2"`, `dims = 1024`. Egress-gated: selecting this
 *   lane is never the default and never a silent fallback — an explicit env/config act
 *   is the informed-consent line (ADR-0017 decision 2).
 *
 * **Ollama (local sidecar, opt-in — a documented pattern, never the default):**
 *   `POST http://127.0.0.1:11434/api/embeddings` with body `{ model, prompt }`.
 *   Zero-infra posture (ADR-0012) means this is never selected by default; it requires
 *   the user to install and run a separate service, so it stays a pattern until real
 *   demand names a trigger.
 */
