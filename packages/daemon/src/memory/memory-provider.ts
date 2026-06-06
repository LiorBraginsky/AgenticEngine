import type { MemoryStore } from "./store.js";
import type { SessionMessage } from "../providers/provider.js";

/** A re-derivable projection of the archive. Disposable; never a source of truth. */
export interface DistilledFact {
  fact: string;
  provenance: string; // a messages.id (or a JSON ref) the fact was derived FROM
  scope: "thread-local" | "cross-thread" | "global"; // stamped at distill; ENFORCED by retrieve via readDistilledFactsForThread (MF-04 5f)
  expiry: number | null; // epoch ms or null
  confidence: number; // 0..1
  authored_by: "machine"; // v0 distiller is always machine-authored
}

/** Distillation outcome — observable even when empty (5b). NEVER throws. */
export interface DistillResult {
  threadId: string;
  facts: DistilledFact[]; // may be [] — "deliberately retained nothing"
}

/**
 * The swappable distillation/retrieval seam (spec §3.2 invariant 2; ADR-0010 posture).
 * THIN, one id field, no `kind`. A new distiller later = a new impl of THIS port +
 * re-run the projection — no source-of-truth migration (invariant 3).
 *
 * ASYNC: matches AgentProvider precedent. DumbTailProvider returns Promise.resolve()
 * at zero cost. Smart distiller (future) will need network/LLM calls (Q3 — Lior approved).
 */
export interface MemoryProvider {
  readonly id: string; // "dumb-tail", "fixed-marker" (the swap-proof second impl)

  /**
   * Re-derive distilled facts for one thread from the UNTOUCHED archive.
   * Read-only over messages/mutations (lossless, §4.2). MUST honor tombstones —
   * a forgotten message never yields a fact (F1).
   */
  distill(store: MemoryStore, threadId: string): Promise<DistillResult>;

  /**
   * Compose the bounded distilled slice to inject at a NEW thread's start.
   * Reads distilled_facts (the projection). MUST honor tombstones (F1).
   * Returns the slice as SessionMessage[] ready to prepend to messages[].
   * MF-04 (5f): now enforces scope isolation — thread-local facts of OTHER threads
   * are excluded; cross-thread/global facts cross. Uses readDistilledFactsForThread.
   */
  retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]>;
}
