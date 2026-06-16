import type { MemoryStore } from "./store.js";
import type { SessionMessage } from "../providers/provider.js";

/**
 * A row in the STATEFUL, incrementally-accumulated derived fact store
 * (ADR-0012 Amendment 2026-06-13); stable id; auditable + forgettable,
 * NOT pure f(archive). Persists unchanged until (a) a genuinely-contradicting
 * new fact replaces it, (b) the user edits it, or (c) the user/forget removes it.
 */
export interface DistilledFact {
  fact: string;
  provenance: string; // a messages.id (or a JSON ref) the fact was derived FROM
  scope: "thread-local" | "cross-thread" | "global"; // stamped at distill; ENFORCED by retrieve via readDistilledFactsForThread (MF-04 5f)
  expiry: number | null; // epoch ms or null
  confidence: number; // 0..1
  authored_by: "machine"; // v0 distiller is always machine-authored
}

/** @deprecated Use DistillDelta instead. Left for reference by old providers during migration. */
export interface DistillResult {
  threadId: string;
  facts: DistilledFact[]; // may be [] — "deliberately retained nothing"
}

/** ONE targeted change to the stable-id fact store, proposed by the distiller (spec §3.1). */
export interface FactOp {
  op: "new" | "append" | "replace";
  fact: string;            // user-language DISPLAY text (D-V6e language preserved)
  canonical: string;       // LLM-normalized match key → fact_fts (D-V4c). Empty ⇒ caller falls back to normalizeFactText(fact).
  topics: string[];        // coarse LLM tags (§3.5); WIDEN recall only (B1)
  targetOrdinal?: number;  // 1..K index into the candidate list shown to the LLM (NOT a uuid — [grill B2])
  expectedTargetText?: string; // candidate text the LLM reasoned about (optimistic-concurrency — [grill M5])
  // NOTE: no scope field — machine facts are ALWAYS cross-thread (relay-006 MINOR-4);
  // thread-local is human-only (5f preserved in readDistilledFactsForThread).
}

/** The incremental delta a dismiss produces (spec §3.1). NOT a full projection. */
export interface DistillDelta {
  threadId: string;
  ops: FactOp[];
  candidateIds: string[];           // the candidate ids in ordinal order; candidateIds[targetOrdinal-1] resolves the target (orchestrator-blessed port extension)
  distilledThroughMarker: number;   // the mutation marker this delta covers ([grill M4])
  distilledThroughTurn: number;     // the max turn_index this delta covered (new-tail watermark, R2)
}

/**
 * The swappable distillation/retrieval seam.
 *
 * STATEFUL: the fact store is a STATEFUL, incrementally-accumulated derived store
 * (ADR-0012 Amendment 2026-06-13). NOT pure f(archive) — path-dependent.
 *
 * `distill` reads ONLY the just-ended thread's NEW TAIL (since its last distill
 * watermark — §3.1 [grill M4]) and proposes a DELTA of targeted FactOps over the
 * STABLE-id fact store. FTS5 + any LLM call run OUTSIDE any tx. NOT a re-derivable
 * projection — the fact store is STATEFUL (ADR-0012 Amendment 2026-06-13). A failure
 * rejects to registration's never-drop failure path.
 */
export interface MemoryProvider {
  readonly id: string;

  /**
   * Reads ONLY the just-ended thread's NEW TAIL (since its last distill watermark — §3.1 [grill M4])
   * and proposes a DELTA of targeted FactOps over the STABLE-id fact store. FTS5 + any LLM call run
   * OUTSIDE any tx. NOT a re-derivable projection — the fact store is STATEFUL (ADR-0012 Amendment
   * 2026-06-13). A failure rejects to registration's never-drop failure path.
   */
  distill(store: MemoryStore, threadId: string): Promise<DistillDelta>;

  /**
   * Compose the bounded distilled slice to inject at the start of a turn.
   * Called on the new-thread first turn AND on every known-thread turn (v2-08).
   * Reads distilled_facts (the projection). MUST honor tombstones (F1).
   * Returns the slice as SessionMessage[] ready to prepend to messages[].
   * MF-04 (5f): now enforces scope isolation — thread-local facts of OTHER threads
   * are excluded; cross-thread/global facts cross. Uses readDistilledFactsForThread.
   */
  retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]>;
}
