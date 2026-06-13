/**
 * Hatch — transport-agnostic daemon-internal view/edit/forget façade (MF-05 T1).
 *
 * Spec §3.5: "the foundation freezes the transport-agnostic daemon-internal
 * read/edit/forget API". This module is the daemon-internal seam; transport
 * (HTTP routes, WS) is Tranche 2.
 *
 * Constructed over a real MemoryStore + WriteGate — no mocks, no DI bypass.
 *
 * INTENT-NAMED FORGET OPERATIONS (chunk 04 / ADR-0015 decision 1):
 * The old shape-routing `forget(target)` heuristic is REPLACED by three explicit methods:
 *   forgetMessage(messageId, ctx, reason?) → WriteGate.forget (HARD scrub + tombstone)
 *   forgetFact(factText, provenance, ctx, reason?) → WriteGate.forgetFact (BEST-EFFORT; no scrub)
 *   forgetFactAndSources(factText, provenance, ctx, reason?) → WriteGate.forgetFactAndSources (opt-in HARD escape)
 *
 * The separate-artifact invariant (ADR-0015 decision 2) is structural:
 *   - message-forget writes mutations tombstone + scrubs messages.content
 *   - fact-forget writes ONLY forgotten_facts, never touches messages or mutations
 *   No target_type value can downgrade a message scrub to a fact-forget.
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
   * Forget a MESSAGE — HARD scrub + mutations tombstone (unchanged message path).
   * Delegates to WriteGate.forget. The isMessageId assert lives INSIDE the message path.
   */
  forgetMessage(messageId: string, ctx: WriteContext, reason?: string): void {
    this.gate.forget(messageId, ctx, reason);
  }

  /**
   * Forget a FACT — durable forgotten_facts record + live purge, NO scrub.
   * Delegates to WriteGate.forgetFact. Never touches messages or mutations (B1 invariant).
   */
  forgetFact(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
    this.gate.forgetFact(factText, provenance, ctx, reason);
  }

  /**
   * Forget a FACT + its source messages — fact-forget record + option-B hard escape.
   * Delegates to WriteGate.forgetFactAndSources.
   * thread:<id> provenance → no-op on source scrub (never a whole-thread scrub).
   */
  forgetFactAndSources(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
    this.gate.forgetFactAndSources(factText, provenance, ctx, reason);
  }
}

