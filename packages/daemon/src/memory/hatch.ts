/**
 * Hatch — transport-agnostic daemon-internal view/edit/forget façade (MF-05 T1).
 *
 * Spec §3.5: "the foundation freezes the transport-agnostic daemon-internal
 * read/edit/forget API". This module is the daemon-internal seam; transport
 * (HTTP routes, WS) is Tranche 2.
 *
 * Constructed over a real MemoryStore + WriteGate — no mocks, no DI bypass.
 * The three operations dispatch as follows:
 *   view(threadId)       → archive + distilledFacts + distillationEvents
 *   edit(messageId, ...) → existing WriteGate.edit (appends authored_by:human correction)
 *   forget(target, ...)  → message-id  → existing WriteGate.forget
 *                          provenance  → WriteGate.forgetFact (projection-tombstone, T1.2)
 */
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
    // All distilled facts (not scoped to a single thread — the hatch shows the full slice)
    const distilledFacts = this.store.readDistilledFacts(1000);
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
   * Forget a target:
   *   - If the target looks like a messages.id (UUID format) → WriteGate.forget.
   *   - If the target looks like a distilled-fact provenance (incl. "thread:<uuid>")
   *     → WriteGate.forgetFact (projection-tombstone, T1.2).
   *
   * The dispatch heuristic: a UUID-shaped string (8-4-4-4-12 hex) → message path;
   * anything else (e.g. "thread:<uuid>") → fact-provenance path.
   */
  forget(target: string, ctx: WriteContext, reason?: string): void {
    if (isMessageId(target)) {
      this.gate.forget(target, ctx, reason);
    } else {
      this.gate.forgetFact(target, ctx, reason);
    }
  }
}

/**
 * Heuristic: a string that matches the standard UUID format is treated as a
 * messages.id; everything else is a distilled-fact provenance (e.g. "thread:<uuid>").
 */
function isMessageId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
