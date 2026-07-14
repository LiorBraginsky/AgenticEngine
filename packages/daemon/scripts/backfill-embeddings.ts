/**
 * backfill-embeddings — ONE-TIME, EXPLICIT, LOGGED, idempotent-per-model_id,
 * tombstone-honoring backfill (hybrid-retrieval spec §3.3 D3c) — the migrate-distiller-v2
 * posture. NOT auto-on-startup.
 *
 * Builds message_fts for every existing message (idempotent — Task 4's
 * store.backfillMessageFts()), then, IFF an EmbeddingProvider is available, drains every
 * currently-pending fact/message vector to completion via EmbeddingDrain — reusing the
 * SAME restart-safe "pending is a query" primitive the daemon's write-time drain uses
 * (backfill = "drain everything once, synchronously"). A null/unavailable provider still
 * builds fts (lexical-only degrade honesty) but embeds nothing — reported, not a failure
 * (`providerAvailable`).
 *
 * Invocation (real live store; downloads the model on first run if not cached):
 *   bun run --cwd packages/daemon backfill-embeddings
 * Throwaway run (executed DoD, fixture provider — no network/model download):
 *   EMBEDDING_PROVIDER=fixture bun run packages/daemon/scripts/backfill-embeddings.ts --data-dir <tmp>
 *
 * STRIKE-5: this script existing + typechecking is NOT evidence. The EXECUTED run against a
 * real (throwaway) sqlite — stdout pasted into the PR — is the DoD evidence (q#011 rider).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import type { EmbeddingProvider } from "../src/memory/embedding/embedding-provider.js";
import { buildEmbeddingProvider } from "../src/memory/embedding/embedding-provider-selector.js";
import { EmbeddingDrain } from "../src/memory/embedding/embedding-drain.js";

export interface BackfillReport {
  ftsInserted: number;
  factsEmbedded: number;
  messagesEmbedded: number;
  factsPendingAfter: number;
  messagesPendingAfter: number;
  providerAvailable: boolean;
}

// Dogfood single-user scale — a full-scan bound for the "how much is left pending"
// report, not real pagination (the drain itself already pages internally via batchSize).
const PENDING_REPORT_LIMIT = 1_000_000;

export async function runBackfill(
  store: MemoryStore,
  provider: EmbeddingProvider | null,
  opts: { quiet?: boolean } = {},
): Promise<BackfillReport> {
  const log = (m: string) => {
    if (!opts.quiet) console.log(`[backfill-embeddings] ${m}`);
  };

  const ftsInserted = store.backfillMessageFts();
  log(`message_fts: inserted ${ftsInserted} missing row(s)`);

  const providerAvailable = provider !== null;
  let factsEmbedded = 0;
  let messagesEmbedded = 0;

  if (provider) {
    await provider.warmup?.();
    const drain = new EmbeddingDrain(store, provider);
    const result = await drain.drain();
    factsEmbedded = result.factsEmbedded;
    messagesEmbedded = result.messagesEmbedded;
    log(`embedded ${factsEmbedded} fact(s), ${messagesEmbedded} message(s) (model=${provider.modelId})`);
  } else {
    log("no embedding provider available — lexical-only degrade (fts built above; 0 vectors embedded)");
  }

  // With no provider, there is no real model_id to scan against — an empty string never
  // matches a stamped row, so every fact/message correctly reports as still-pending
  // (honest: nothing has EVER been embedded under any model in that case).
  const modelId = provider?.modelId ?? "";
  const factsPendingAfter = store.pendingFactEmbeddings(modelId, PENDING_REPORT_LIMIT).length;
  const messagesPendingAfter = store.pendingMessageEmbeddings(modelId, PENDING_REPORT_LIMIT).length;
  log(`pending after: ${factsPendingAfter} fact(s), ${messagesPendingAfter} message(s)`);

  return { ftsInserted, factsEmbedded, messagesEmbedded, factsPendingAfter, messagesPendingAfter, providerAvailable };
}

if (import.meta.main) {
  console.log("=== backfill-embeddings (ONE-TIME; hybrid-retrieval spec §3.3 D3c) ===");
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf("--data-dir");
  const dataDir = dirIdx >= 0 ? argv[dirIdx + 1]! : join(homedir(), ".agentic-engine");
  console.log(`[backfill-embeddings] data dir: ${dataDir}`);
  const store = new MemoryStore({ dataDir });
  try {
    const provider = buildEmbeddingProvider({ dataDir });
    const report = await runBackfill(store, provider);
    console.log(`[backfill-embeddings] report: ${JSON.stringify(report)}`);
    if (report.providerAvailable) {
      const ok = report.factsPendingAfter === 0 && report.messagesPendingAfter === 0;
      console.log(ok ? "BACKFILL OK" : "BACKFILL INCOMPLETE — pending rows remain (see above)");
      store.close();
      process.exit(ok ? 0 : 1);
    } else {
      console.log("BACKFILL OK — lexical-only: fts built, embeddings skipped (no provider available)");
      store.close();
      process.exit(0);
    }
  } catch (err) {
    console.error(`[backfill-embeddings] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    store.close();
    process.exit(1);
  }
}
