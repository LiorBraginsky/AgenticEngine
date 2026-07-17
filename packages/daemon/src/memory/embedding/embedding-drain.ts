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
 * Degrades to a no-op when `provider` is `null` (lexical-only, ADR-0017 decision 1). A `null`
 * batch is no longer a blanket leg-stop: the drain retries the batch's texts singly to isolate
 * a poison row (chunk-07 items 2+3), skipping only the row(s) that still fail and continuing
 * with the rest; a batch that embeds nothing at all stops the leg (provider truly unavailable
 * or all-poison — non-starvation, no wedge). NEVER throws — the store's write-observer
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
    const factsEmbedded = await this.drainLeg(
      (limit) => this.store.pendingFactEmbeddings(provider.modelId, limit).map((p) => ({ id: p.id, text: p.fact })),
      (id, vec) => this.store.upsertFactEmbedding(id, provider.modelId, provider.dims, encodeVector(vec)),
    );
    const messagesEmbedded = await this.drainLeg(
      (limit) => this.store.pendingMessageEmbeddings(provider.modelId, limit).map((p) => ({ id: p.id, text: p.content })),
      (id, vec) => this.store.upsertMessageEmbedding(id, provider.modelId, provider.dims, encodeVector(vec)),
    );
    return { factsEmbedded, messagesEmbedded };
  }

  /**
   * Drain one corpus leg to completion, ISOLATING poison rows (spec §3.3 D3 drain design;
   * chunk-07 items 2+3). `embed()` is all-or-nothing per call (frozen port contract, ADR-0017
   * dec.1 — a batch resolves `null` on ANY per-text failure), so on a `null` batch we retry the
   * batch's texts ONE AT A TIME to isolate the offender. A text that still fails is recorded as
   * skipped-THIS-PASS (never written as a zero vector — that would poison cosine ranking) and
   * left pending — it simply won't join the cosine leg; the lexical leg still finds it (D3b
   * "missing embedding = graceful").
   *
   * TERMINATION / NO-WEDGE: the leg always stops — either every un-skipped row has been scanned
   * (`pending.length === 0`), or a full page embeds NOTHING (`wroteAny === false`), which fires
   * on the FIRST all-poison page it meets. It never hangs.
   *
   * Honest caveat on the second stop condition: it is a "stop the leg", not "every good row
   * this pass" guarantee. If >= `batchSize` contiguous rows at the lowest rowids are ALL poison,
   * `wroteAny` goes false on that first page and the leg stops there — good rows sitting BEHIND
   * that block are not guaranteed to drain in this pass (they will on a later kick, once skipped
   * ids are filtered out of the scan). This is an accepted tradeoff, not a bug: the `break` keeps
   * the genuinely-unavailable-provider case cheap (one page's worth of attempts, not one per
   * backlog row), and after truncation (chunk-07 item 1) the known poison cause (>512 tokens) is
   * gone — a residual all-poison page of that size is implausible on real data.
   *
   * Skipped rows are re-attempted on the NEXT drain kick (skip-per-pass; a persisted retry-cap
   * is deliberately NOT built — chunk-07 anti-gold-plating).
   */
  private async drainLeg(
    scan: (limit: number) => { id: string; text: string }[],
    upsert: (id: string, vec: Float32Array) => "written" | "skipped",
  ): Promise<number> {
    const provider = this.provider!;
    const skipped = new Set<string>();
    let embedded = 0;
    for (;;) {
      const pending = scan(this.batchSize).filter((r) => !skipped.has(r.id));
      if (pending.length === 0) break; // nothing left but already-skipped rows this pass
      const vectors = await provider.embed(pending.map((r) => r.text));
      if (vectors !== null) {
        pending.forEach((row, i) => {
          if (upsert(row.id, vectors[i]!) === "written") embedded++;
        });
        continue;
      }
      // A batch resolved null: EITHER the provider is unavailable, OR >=1 poison row nulled it.
      // Isolate by embedding one text at a time.
      let wroteAny = false;
      for (const row of pending) {
        const single = await provider.embed([row.text]);
        const vec = single?.[0];
        if (!vec) {
          skipped.add(row.id); // still fails alone -> skip-this-pass, leave pending
          continue;
        }
        if (upsert(row.id, vec) === "written") embedded++;
        wroteAny = true;
      }
      if (!wroteAny) break; // provider down OR all remaining are poison -> stop this leg
    }
    return embedded;
  }
}
