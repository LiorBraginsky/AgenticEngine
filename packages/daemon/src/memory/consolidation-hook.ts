import type { MemoryStore } from "./store.js";

export type ConsolidationHandler = (threadIds: string[], triggerThreadId: string) => void | Promise<void>;

/**
 * 5b CONSOLIDATION-HOOK (spec §3.3) — the dismiss-lifecycle pass-through where
 * distillation will fire. MF-01 = a registration mechanism + a no-op default;
 * dismiss() flips threads.status→'dismissed' for EACH id and invokes the registered
 * handler ONCE with the full batch (batch-dismiss, D5: ONE re-projection per disconnect).
 * MF-02 registers the real distiller (which writes the distillation_events row,
 * even on an empty consolidation). MF-01 deliberately writes NO event rows.
 */
export class ConsolidationHook {
  private handler: ConsolidationHandler = () => { /* no-op stub (MF-02 fills) */ };

  constructor(private readonly store: MemoryStore) {}

  register(handler: ConsolidationHandler): void {
    this.handler = handler;
  }

  /**
   * Mark ALL threads in `threadIds` as dismissed (status='dismissed'), then fire
   * the consolidation handler ONCE with the full batch.
   *
   * Phase 1: flip ALL statuses first (before distillation runs, so the distiller
   * sees the current state). Phase 2: fire the handler ONCE — ONE code path runs
   * the projection (D5: one re-projection per disconnect).
   *
   * `triggerThreadId` defaults to `threadIds[0]` when omitted.
   */
  async dismiss(threadIds: string[], triggerThreadId?: string): Promise<void> {
    // Phase 1: flip ALL statuses first
    for (const id of threadIds) {
      this.store.rawDb().query("UPDATE threads SET status = 'dismissed' WHERE thread_id = ?").run(id);
    }
    // Phase 2: fire the handler ONCE (ONE code path runs the projection)
    await this.handler(threadIds, triggerThreadId ?? threadIds[0]!);
  }
}
