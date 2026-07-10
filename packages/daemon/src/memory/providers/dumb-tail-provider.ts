import type { MemoryProvider, DistillDelta, RetrievedSlice } from "../memory-provider.js";
import type { MemoryStore } from "../store.js";
import { REDACTION_MARKER } from "../schema.js";
import { REMEMBERED_LABEL } from "../../providers/system-prompt.js";
import { normalizeFactText } from "../normalize-fact-text.js";
import { memDebug, previewStr } from "../debug-log.js";

/** Bounded slice retrieved from distilled_facts to inject at new-thread start. */
const RETRIEVE_SLICE_N = 20;

/**
 * DumbTailProvider — v2-03 incremental distiller (keyless fallback + swap-proof second leg).
 *
 * id = "dumb-tail". Emits one `op:"new"` FactOp per surviving NEW-TAIL message
 * (verbatim content, canonical = normalizeFactText(content), topics = []).
 * No semantic selection, no LLM call, no candidate fetch.
 *
 * Incremental new-tail op:'new' delta; keyless fallback + swap-proof second leg.
 * Idempotence guaranteed by the registration marker-skip (D-V3b) + the corrected
 * -1-sentinel watermark (3.0a fix: turn_index > -1 includes turn_index=0 on first distill).
 * `retrieve` unchanged.
 */
export class DumbTailProvider implements MemoryProvider {
  readonly id = "dumb-tail";

  /**
   * Returns an incremental DistillDelta over the NEW TAIL only (since the last
   * distilled_through_turn watermark). Each surviving message emits one
   * `op:"new"` FactOp (verbatim content, normalized canonical, empty topics).
   *
   * Filters (same as before):
   *   - tombstone (content === REDACTION_MARKER)
   *   - quarantine (isMessageQuarantined)
   *   - fact-tombstone (isFactTombstoned — MF-05 T1.2)
   *
   * Returns {ops, candidateIds:[], distilledThroughMarker, distilledThroughTurn}.
   */
  async distill(store: MemoryStore, threadId: string): Promise<DistillDelta> {
    const state = store.readThreadDistillState(threadId);
    const sinceTurn = state.distilled_through_turn; // -1 = never distilled yet

    const allTail = store.readNewTailSince(threadId, sinceTurn);

    const ops = allTail
      .filter((m) => m.content !== REDACTION_MARKER)
      .filter((m) => !store.isMessageQuarantined(m.id))
      // MF-05 T1.2: projection-tombstone — skip facts whose provenance is tombstoned
      .filter((m) => !store.isFactTombstoned(m.id))
      .map((m) => ({
        op: "new" as const,
        fact: m.content,
        canonical: normalizeFactText(m.content),
        topics: [] as string[],
      }));

    const distilledThroughMarker = store.readThreadMarker(threadId);
    const distilledThroughTurn = store.maxTurnIndex(threadId);

    // ── D1 distill INPUT log (env-gated, zero-cost when OFF) ─────────────────
    // DumbTail has no candidate fetch; log tail only (candidates: []).
    memDebug("distill", {
      threadId,
      sinceTurn,
      tail: allTail
        .filter((m) => m.content !== REDACTION_MARKER)
        .filter((m) => !store.isMessageQuarantined(m.id))
        .filter((m) => !store.isFactTombstoned(m.id))
        .map((m) => ({
          id: m.id,
          role: m.role,
          len: m.content.length,
          preview: previewStr(m.content),
        })),
      candidates: [],
    });

    return Promise.resolve({
      threadId,
      ops,
      candidateIds: [],
      distilledThroughMarker,
      distilledThroughTurn,
    });
  }

  /**
   * Compose the bounded distilled slice for injection at a new thread's start.
   * Reads distilled_facts (the projection). Defense-in-depth: excludes any fact
   * whose provenance points at a now-tombstoned message (F1 backstop).
   */
  async retrieve(store: MemoryStore, forThreadId: string): Promise<RetrievedSlice> {
    // MF-04 (5f): scope-filtered read — thread-local facts of OTHER threads are excluded;
    // cross-thread/global cross. forThreadId is now load-bearing (was void in MF-02).
    const rows = store.readDistilledFactsForThread(forThreadId, RETRIEVE_SLICE_N);
    // MF-05 T1.2: isFactTombstoned is a strict superset of isMessageTombstoned —
    // covers both message-UUID provenances (DumbTail) and thread-level provenances.
    const live = rows.filter((f) => !store.isFactTombstoned(f.provenance));
    // ── D1 retrieve log (env-gated, zero-cost when OFF) ──────────────────────
    memDebug("retrieve", {
      forThreadId,
      injected: live.map((f, i) => ({
        id: f.id,
        factPreview: previewStr(f.fact),
        order: i,
      })),
    });
    return Promise.resolve({
      messages: live.map((f) => ({ role: "user" as const, content: `${REMEMBERED_LABEL}${f.fact}` })),
      injectedFactIds: live.map((f) => f.id),
    });
  }
}
