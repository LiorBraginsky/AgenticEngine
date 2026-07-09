/**
 * Hatch — transport-agnostic daemon-internal view/edit/forget façade (MF-05 T1).
 *
 * Spec §3.5: "the foundation freezes the transport-agnostic daemon-internal
 * read/edit/forget API". This module is the daemon-internal seam; transport
 * (HTTP routes, WS) is Tranche 2.
 *
 * Constructed over a real MemoryStore + WriteGate — no mocks, no DI bypass.
 *
 * USER FORGET OPERATION (v2-04 / D-V6a-bis — one user path):
 *   forgetFact(factText, provenance, ctx, reason?) → WriteGate.forgetFact
 *     Durable delete of the stable-id row. NO scrub of messages. The source
 *     conversation stays in the lossless archive (provenance is a READ affordance).
 *
 * WriteGate.forget (the hard-scrub PRIMITIVE) is RETAINED for the future THREAD-forget
 * and currently has no caller on the user-facing HTTP path.
 */

/**
 * Cap for the number of distilled facts returned by `view()`.
 *
 * `view` intentionally returns the FULL live projection slice (memory-management
 * semantics) — this cap is a safety bound, not a UI pagination decision.
 * Thread-scoping and pagination are Tranche-2 surface decisions; do NOT add
 * per-thread filtering here without a Tranche-2 scope agreement.
 */
export const HATCH_VIEW_FACT_CAP = 1000;
import type { MemoryStore, DistilledFactRow, DistillationEventRow } from "./store.js";
import type { WriteGate, WriteContext } from "./write-gate.js";

export interface HatchViewResult {
  /** Full archive for the thread — tombstoned rows surface as REDACTION_MARKER. */
  messages: { id: string; role: string; content: string }[];
  /** All distilled facts currently in the store (the live projection). */
  distilledFacts: DistilledFactRow[];
  /** Distillation events for this thread — verbatim including zero-count rows (5b). */
  distillationEvents: DistillationEventRow[];
}

export class Hatch {
  constructor(
    private readonly store: MemoryStore,
    private readonly gate: WriteGate,
  ) {}

  /**
   * Return the full archive view for a thread:
   *   - All messages in turn order (tombstoned → REDACTION_MARKER)
   *   - All distilled facts from the store (live projection)
   *   - All distillation events for this thread (verbatim, incl. zero-count rows)
   *
   * Additive SELECTs only — no write-path change.
   */
  async view(threadId: string): Promise<HatchViewResult> {
    const messages = this.store.readThreadArchive(threadId);
    // All distilled facts (not scoped to a single thread — the hatch shows the full slice).
    // HATCH_VIEW_FACT_CAP is a safety bound; thread-scoping/pagination is Tranche 2.
    const distilledFacts = this.store.readDistilledFacts(HATCH_VIEW_FACT_CAP);
    // T1.3 (5b): distillation_events returned VERBATIM — zero-count rows are NOT filtered.
    // A row with facts_produced===0 is the observable proof of "deliberately retained nothing"
    // vs "silently lost the thread" (spec §3.4, ADR-0012 5b).
    const distillationEvents = this.store.readDistillationEvents(threadId);
    return { messages, distilledFacts, distillationEvents };
  }

  /**
   * Edit a message (correction record, authored_by:human).
   * Delegates to the existing WriteGate.edit — no new write path.
   */
  edit(messageId: string, replacement: string, ctx: WriteContext, reason?: string): void {
    this.gate.edit(messageId, replacement, ctx, reason);
  }

  /**
   * Edit a FACT's text (chunk-05 FACT-EDIT; ADR-0012 5a "edit what the agent remembers").
   * Delegates to WriteGate.editFact — updates the text + stamps authored_by='human' (5e-protected),
   * never scrubs messages (B1). Returns true iff applied (false → 404 at the route).
   * Distinct from edit(messageId) above, which is the MESSAGE correction (blessed as-is, chunk-03).
   */
  editFact(factId: string, newText: string, ctx: WriteContext, reason?: string): boolean {
    return this.gate.editFact(factId, newText, ctx, reason);
  }

  /**
   * Forget a FACT — durable delete of the stable-id row, NO scrub.
   * Delegates to WriteGate.forgetFact. Never touches messages or mutations (B1 invariant).
   * This is the ONE user forget operation as of v2-04 (D-V6a-bis).
   */
  forgetFact(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
    this.gate.forgetFact(factText, provenance, ctx, reason);
  }

  /**
   * Forget a FACT by its stable id (v2-06 C-fix — forgetFactById intent path).
   * Delegates to WriteGate.forgetFactById. Deletes exactly one row; never scrubs messages (B1).
   * The Hatch.forgetFact passthrough survives as a primitive (test-only) but is no longer
   * HTTP-reachable post-v2-07 (the over-deleting HTTP fallback was removed).
   */
  forgetFactById(factId: string, ctx: WriteContext, reason?: string): void {
    this.gate.forgetFactById(factId, ctx, reason);
  }
}

