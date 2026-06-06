import type { MemoryProvider, DistillResult } from "../memory-provider.js";
import type { MemoryStore } from "../store.js";
import type { SessionMessage } from "../../providers/provider.js";
import { REDACTION_MARKER } from "../schema.js";

/** Bounded slice retrieved from distilled_facts for injection (same as DumbTail). */
const RETRIEVE_SLICE_N = 20;

/**
 * FixedMarkerProvider — deliberately DIFFERENT from DumbTailProvider so the
 * swap-proof test is meaningful. Emits exactly ONE count-summary fact per thread
 * rather than verbatim message content.
 *
 * id = "fixed-marker". confidence = 0.5 (vs DumbTail's 1.0 — witnessable difference).
 * provenance = "thread:<threadId>" (thread-level ref, not message-level).
 */
export class FixedMarkerProvider implements MemoryProvider {
  readonly id = "fixed-marker";

  /**
   * Emit exactly ONE fact: "thread:<threadId> has <N> live messages"
   * where N counts only non-tombstoned messages.
   */
  async distill(store: MemoryStore, threadId: string): Promise<DistillResult> {
    const allMessages = store.readThreadMessagesForDistill(threadId);
    const liveCount = allMessages.filter((m) => m.content !== REDACTION_MARKER && !store.isMessageQuarantined(m.id)).length;

    const fact = {
      fact: `thread:${threadId} has ${liveCount} live message${liveCount === 1 ? "" : "s"}`,
      provenance: `thread:${threadId}`,
      scope: "cross-thread" as const,
      expiry: null,
      confidence: 0.5,
      authored_by: "machine" as const,
    };

    return Promise.resolve({ threadId, facts: [fact] });
  }

  /**
   * Same projection-read contract as DumbTailProvider — reads distilled_facts,
   * honors tombstones (defense-in-depth), formats as "[remembered] ..." messages.
   * Provider-agnostic retrieve is what makes the swap-proof meaningful: only
   * distill() output differs in shape.
   */
  async retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]> {
    // MF-04 (5f): scope-filtered read (same contract as DumbTail's retrieve).
    // FixedMarker provenance is "thread:<id>"; readDistilledFactsForThread resolves origin
    // via the substr branch. No isMessageTombstoned (thread-level provenance never matches a UUID).
    const rows = store.readDistilledFactsForThread(forThreadId, RETRIEVE_SLICE_N);
    return Promise.resolve(
      rows.map((f) => ({ role: "user" as const, content: `[remembered] ${f.fact}` })),
    );
  }
}
