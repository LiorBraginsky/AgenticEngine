import { homedir } from "node:os";
import { join } from "node:path";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { FixtureEmbeddingProvider } from "./fixture-embedding-provider.js";
import { LocalWasmEmbeddingProvider } from "./local-wasm-embedding-provider.js";

/** Options accepted by buildEmbeddingProvider. `dataDir` is where the local-wasm lane
 *  caches its model files (`<dataDir>/models/multilingual-e5-small/`); production callers
 *  pass the daemon's resolved dataDir. Omitted ⇒ the daemon's own default. */
export interface BuildEmbeddingProviderOpts {
  dataDir?: string;
}

/**
 * Select the active EmbeddingProvider by the EMBEDDING_PROVIDER env var (hybrid-retrieval
 * spec §3.2 D2a; ADR-0017 decision 1) — mirrors the `buildMemoryProvider` house pattern
 * (`memory-provider-selector.ts:51-73`): registry-shaped switch + env selection + loud-log
 * graceful fallback. Defaults to `local-wasm` (ADR-0017 decision 2 — local-first).
 * `"none"` explicitly disables embeddings (returns null — lexical-only, no log; this is a
 * deliberate opt-OUT, not a failure). An unknown id is a `console.error` + null. NEVER throws.
 */
export function buildEmbeddingProvider(opts?: BuildEmbeddingProviderOpts): EmbeddingProvider | null {
  const id = process.env["EMBEDDING_PROVIDER"] ?? "local-wasm";
  const dataDir = opts?.dataDir ?? join(homedir(), ".agentic-engine");

  switch (id) {
    case "local-wasm":
      return new LocalWasmEmbeddingProvider({ dataDir });
    case "fixture":
      return new FixtureEmbeddingProvider();
    case "none":
      return null;
    default:
      console.error(`[embedding] Unknown EMBEDDING_PROVIDER=${id} — embeddings disabled (lexical-only)`);
      return null;
  }
}
