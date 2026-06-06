import type { MemoryProvider, DistillResult } from "../memory-provider.js";
import type { MemoryStore } from "../store.js";
import type { SessionMessage } from "../../providers/provider.js";
import { REDACTION_MARKER } from "../schema.js";

/** Tail recency heuristic: take the most recent N messages from a thread. */
const DISTILL_TAIL_N = 5;
/** Bounded slice retrieved from distilled_facts to inject at new-thread start. */
const RETRIEVE_SLICE_N = 20;

/**
 * DumbTailProvider — v0 distiller. Emits one fact per surviving tail message
 * (verbatim content, confidence=1.0, scope=cross-thread). No semantic selection.
 *
 * id = "dumb-tail". The second provider (FixedMarkerProvider) is deliberately
 * different so the swap-proof test is meaningful.
 */
export class DumbTailProvider implements MemoryProvider {
  readonly id = "dumb-tail";

  /**
   * Re-derive distilled facts for one thread.
   * Reads the tombstone-honored tail (via readThreadMessagesForDistill),
   * takes the LAST DISTILL_TAIL_N messages, and emits one fact per live message.
   * Tombstoned messages (content === REDACTION_MARKER) are skipped — F1.
   */
  async distill(store: MemoryStore, threadId: string): Promise<DistillResult> {
    const allMessages = store.readThreadMessagesForDistill(threadId);
    // Take the last DISTILL_TAIL_N messages (already ordered ASC by turn_index)
    const tail = allMessages.slice(-DISTILL_TAIL_N);

    const facts = tail
      .filter((m) => m.content !== REDACTION_MARKER)
      .filter((m) => !store.isMessageQuarantined(m.id))
      .map((m) => ({
        fact: m.content,
        provenance: m.id,
        scope: "cross-thread" as const,
        expiry: null,
        confidence: 1.0,
        authored_by: "machine" as const,
      }));

    return Promise.resolve({ threadId, facts });
  }

  /**
   * Compose the bounded distilled slice for injection at a new thread's start.
   * Reads distilled_facts (the projection). Defense-in-depth: excludes any fact
   * whose provenance points at a now-tombstoned message (F1 backstop).
   */
  async retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]> {
    void forThreadId; // cross-thread retrieve reads ALL distilled_facts (v0 has no isolation)
    const rows = store.readDistilledFacts(RETRIEVE_SLICE_N);
    const live = rows.filter((f) => !store.isMessageTombstoned(f.provenance));
    return Promise.resolve(
      live.map((f) => ({ role: "user" as const, content: `[remembered] ${f.fact}` })),
    );
  }
}
