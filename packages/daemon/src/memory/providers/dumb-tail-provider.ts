import type { MemoryProvider, DistillResult } from "../memory-provider.js";
import type { MemoryStore } from "../store.js";
import type { SessionMessage } from "../../providers/provider.js";
import { REDACTION_MARKER } from "../schema.js";
import { REMEMBERED_LABEL } from "../../providers/system-prompt.js";

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
   * Returns the COMPLETE projection over the whole tombstone-honored archive
   * (iterates `listThreads()`). `threadId` is the TRIGGER thread (recorded in
   * `DistillResult.threadId`), not a filter.
   *
   * Per-thread: reads the tombstone-honored tail (via readThreadMessagesForDistill),
   * takes the LAST DISTILL_TAIL_N messages, and emits one fact per live message.
   * Tombstoned messages (content === REDACTION_MARKER) are skipped — F1.
   * DISTILL_TAIL_N=5 is applied PER THREAD (not across all threads).
   */
  async distill(store: MemoryStore, threadId: string): Promise<DistillResult> {
    const threads = store.listThreads();
    const allFacts: ReturnType<typeof this._distillOneThread> = [];

    for (const { thread_id } of threads) {
      const threadFacts = this._distillOneThread(store, thread_id);
      allFacts.push(...threadFacts);
    }

    return Promise.resolve({ threadId, facts: allFacts });
  }

  /**
   * Extract the tail-facts for a single thread (shared by distill loop).
   * Filters: tombstone, quarantine, fact-tombstone — unchanged from MF-02/MF-05.
   */
  private _distillOneThread(
    store: MemoryStore,
    tid: string,
  ): Array<{
    fact: string;
    provenance: string;
    scope: "cross-thread";
    expiry: null;
    confidence: number;
    authored_by: "machine";
  }> {
    const allMessages = store.readThreadMessagesForDistill(tid);
    // Take the last DISTILL_TAIL_N messages (already ordered ASC by turn_index)
    const tail = allMessages.slice(-DISTILL_TAIL_N);

    return tail
      .filter((m) => m.content !== REDACTION_MARKER)
      .filter((m) => !store.isMessageQuarantined(m.id))
      // MF-05 T1.2: projection-tombstone — skip facts whose provenance is tombstoned at the
      // fact level (isFactTombstoned is a strict superset of isMessageTombstoned; both
      // message-level and thread-level provenances are covered).
      .filter((m) => !store.isFactTombstoned(m.id))
      .map((m) => ({
        fact: m.content,
        provenance: m.id,
        scope: "cross-thread" as const,
        expiry: null,
        confidence: 1.0,
        authored_by: "machine" as const,
      }));
  }

  /**
   * Compose the bounded distilled slice for injection at a new thread's start.
   * Reads distilled_facts (the projection). Defense-in-depth: excludes any fact
   * whose provenance points at a now-tombstoned message (F1 backstop).
   */
  async retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]> {
    // MF-04 (5f): scope-filtered read — thread-local facts of OTHER threads are excluded;
    // cross-thread/global cross. forThreadId is now load-bearing (was void in MF-02).
    const rows = store.readDistilledFactsForThread(forThreadId, RETRIEVE_SLICE_N);
    // MF-05 T1.2: isFactTombstoned is a strict superset of isMessageTombstoned —
    // covers both message-UUID provenances (DumbTail) and thread-level provenances
    // (FixedMarker "thread:<id>"). No regression: message-UUID case is unchanged.
    const live = rows.filter((f) => !store.isFactTombstoned(f.provenance));
    return Promise.resolve(
      live.map((f) => ({ role: "user" as const, content: `${REMEMBERED_LABEL}${f.fact}` })),
    );
  }
}
