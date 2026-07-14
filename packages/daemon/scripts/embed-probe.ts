/**
 * embed-probe — manual dogfood smoke for LocalWasmEmbeddingProvider (hybrid-retrieval
 * chunk-03 Task 3.6). Reproduces the Task-1 spike INSIDE product code: warmup (download
 * gated on AGENTIC_EMBED_AUTODOWNLOAD=1), embed one Ukrainian + one English string,
 * print dims + norm + cross-lang cosine.
 *
 * NOT a `bun test` file — it downloads the model (~100-500 MB) on first run. CI never
 * executes this. STRIKE-5: this script existing + typechecking is NOT evidence; the
 * EXECUTED run's stdout (pasted into the PR) is.
 *
 * Invocation: bun run --cwd packages/daemon embed-probe -- --data-dir <tmp>
 *   (the package.json alias sets AGENTIC_EMBED_AUTODOWNLOAD=1)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { LocalWasmEmbeddingProvider } from "../src/memory/embedding/local-wasm-embedding-provider.js";

function l2norm(v: Float32Array): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // both L2-normalized, so dot === cosine
}

if (import.meta.main) {
  console.log("=== embed-probe (LocalWasmEmbeddingProvider dogfood smoke) ===");
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf("--data-dir");
  const dataDir = dirIdx >= 0 ? argv[dirIdx + 1]! : join(homedir(), ".agentic-engine");
  console.log(`[embed-probe] data dir: ${dataDir}`);

  const provider = new LocalWasmEmbeddingProvider({ dataDir });
  console.log(`[embed-probe] warming up (AGENTIC_EMBED_AUTODOWNLOAD=${process.env["AGENTIC_EMBED_AUTODOWNLOAD"] ?? "0"})...`);
  await provider.warmup();

  const ua = "мій улюблений колір синій";
  const en = "my favorite color is blue";
  const result = await provider.embed([ua, en]);

  if (result === null) {
    console.error("[embed-probe] FAIL: embed() returned null — model not available");
    process.exit(1);
  }

  const [uaVec, enVec] = result;
  console.log(`[embed-probe] modelId=${provider.modelId} dims=${provider.dims}`);
  console.log(`[embed-probe] UA_NORM=${l2norm(uaVec!)}`);
  console.log(`[embed-probe] EN_NORM=${l2norm(enVec!)}`);
  console.log(`[embed-probe] UA_EN_COSINE=${cosine(uaVec!, enVec!)}`);
  console.log("[embed-probe] PROBE OK");
  process.exit(0);
}
