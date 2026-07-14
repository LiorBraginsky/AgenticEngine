import type { MemoryStore } from "../store.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { encodeVector } from "./vector-codec.js";

/** Result of one completed drain pass — the count of rows actually WRITTEN (not
 *  "skipped" via the scrub-race / deleted-between-scan-and-upsert guards). */
export interface DrainResult {
  factsEmbedded: number;
  messagesEmbedded: number;
}

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_DEBOUNCE_MS = 50;

/**
 * The stateless, restart-safe write-time embedding drain (hybrid-retrieval spec §3.3
 * D3b). "Pending = a query" (store.ts's `pendingFactEmbeddings`/`pendingMessageEmbeddings`)
 * — the drain holds NO persisted queue; every `drain()` call re-derives its work from the
 * store, so a crash/restart mid-batch just resumes wherever the scan says work remains.
 *
 * Degrades to a no-op when `provider` is `null` (lexical-only, ADR-0017 decision 1) or when
 * `provider.embed()` resolves `null` mid-run (provider went unavailable — stop that leg,
 * leave the rest pending for the next kick). NEVER throws — the store's write-observer
 * (Task 4) calls `kick()` synchronously after every commit; a throw there would crash the
 * daemon's request path.
 */
export class EmbeddingDrain {
  private readonly batchSize: number;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private rerun = false;

  constructor(
    private readonly store: MemoryStore,
    private readonly provider: EmbeddingProvider | null,
    opts?: { batchSize?: number; debounceMs?: number },
  ) {
    this.batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Debounced, coalescing kick — schedules exactly one `drain()` call `debounceMs` from
   * now, regardless of how many times `kick()` is called in that window. No-op (never
   * schedules a timer) when the provider is `null`. Callers (the store's write-observer)
   * run inside a commit's caller frame, never inside the tx itself — `setTimeout` here is
   * what guarantees the actual drain always runs OUTSIDE any transaction.
   */
  kick(): void {
    if (this.provider === null) return;
    if (this.timer !== null) return; // already scheduled — coalesce
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.debounceMs);
  }

  /**
   * Cancel any pending debounced `kick()` timer — idempotent, safe to call even when
   * nothing is scheduled (including on a `null`-provider drain, where `kick()` never
   * schedules one in the first place). Does NOT cancel an in-flight `drain()` call
   * already running to completion; it only prevents a FUTURE scheduled drain from
   * firing after this call. Wired into the daemon's shutdown path (reviewer MINOR fix)
   * so no dangling `setTimeout` outlives a stopped server.
   */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run the drain to completion: embed every currently-pending fact, then every
   * currently-pending message, for the provider's `modelId`. Single-flight — a `drain()`
   * call while one is already running does not run a second pass concurrently; it flags
   * one more full re-scan to run immediately after the in-flight pass finishes (so work
   * enqueued mid-pass is not lost), then returns its own (empty) result immediately.
   * NEVER throws.
   */
  async drain(): Promise<DrainResult> {
    if (this.provider === null) return { factsEmbedded: 0, messagesEmbedded: 0 };
    if (this.running) {
      this.rerun = true;
      return { factsEmbedded: 0, messagesEmbedded: 0 };
    }
    this.running = true;
    try {
      const result = await this.drainOnce();
      while (this.rerun) {
        this.rerun = false;
        const again = await this.drainOnce();
        result.factsEmbedded += again.factsEmbedded;
        result.messagesEmbedded += again.messagesEmbedded;
      }
      return result;
    } catch (err) {
      console.error(`[embedding] drain failed (${err instanceof Error ? err.message : String(err)}); stopping this pass`);
      return { factsEmbedded: 0, messagesEmbedded: 0 };
    } finally {
      this.running = false;
    }
  }

  private async drainOnce(): Promise<DrainResult> {
    const provider = this.provider!;
    let factsEmbedded = 0;
    let messagesEmbedded = 0;

    for (;;) {
      const pending = this.store.pendingFactEmbeddings(provider.modelId, this.batchSize);
      if (pending.length === 0) break;
      const vectors = await provider.embed(pending.map((p) => p.fact));
      if (vectors === null) break; // provider went unavailable mid-run — degrade, stop this leg
      pending.forEach((row, i) => {
        const outcome = this.store.upsertFactEmbedding(row.id, provider.modelId, provider.dims, encodeVector(vectors[i]!));
        if (outcome === "written") factsEmbedded++;
      });
    }

    for (;;) {
      const pending = this.store.pendingMessageEmbeddings(provider.modelId, this.batchSize);
      if (pending.length === 0) break;
      const vectors = await provider.embed(pending.map((p) => p.content));
      if (vectors === null) break;
      pending.forEach((row, i) => {
        const outcome = this.store.upsertMessageEmbedding(row.id, provider.modelId, provider.dims, encodeVector(vectors[i]!));
        if (outcome === "written") messagesEmbedded++;
      });
    }

    return { factsEmbedded, messagesEmbedded };
  }
}
