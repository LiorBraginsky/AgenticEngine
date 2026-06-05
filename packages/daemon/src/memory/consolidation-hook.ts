import type { MemoryStore } from "./store.js";

export type ConsolidationTrigger = "dismiss";
export type ConsolidationHandler = (threadId: string, trigger: ConsolidationTrigger) => void | Promise<void>;

/**
 * 5b CONSOLIDATION-HOOK (spec §3.3) — the dismiss-lifecycle pass-through where
 * distillation will fire. MF-01 = a registration mechanism + a no-op default;
 * dismiss() flips threads.status→'dismissed' and invokes the registered handler.
 * MF-02 registers the real distiller (which writes the distillation_events row,
 * even on an empty consolidation). MF-01 deliberately writes NO event rows.
 */
export class ConsolidationHook {
  private handler: ConsolidationHandler = () => { /* no-op stub (MF-02 fills) */ };

  constructor(private readonly store: MemoryStore) {}

  register(handler: ConsolidationHandler): void {
    this.handler = handler;
  }

  /** Mark a thread dismissed and fire the consolidation pass-through. */
  async dismiss(threadId: string): Promise<void> {
    this.store.rawDb().query("UPDATE threads SET status = 'dismissed' WHERE thread_id = ?").run(threadId);
    await this.handler(threadId, "dismiss");
  }
}
