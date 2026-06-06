import type { ConsolidationHook } from "./consolidation-hook.js";
import type { MemoryStore } from "./store.js";
import type { MemoryProvider } from "./memory-provider.js";
import type { MemoryScanner } from "./scanner/memory-scanner.js";

/**
 * Wire the distiller as the consolidation-hook's handler.
 * Fires on every dismiss — writes distilled_facts AND a distillation_events row
 * even when facts.length === 0 (5b: "deliberately retained nothing" is observable).
 *
 * MF-03 5d: each produced DistilledFact is scanned before insert. A flagged fact
 * is quarantined (recordQuarantine keyed on its provenance, NOT inserted into
 * distilled_facts). Only clean facts are inserted. The distillation_events row
 * records the clean count — poisoned facts are never counted as "produced."
 */
export function registerDistiller(
  hook: ConsolidationHook,
  store: MemoryStore,
  provider: MemoryProvider,
  scanner: MemoryScanner,
): void {
  hook.register(async (threadId, trigger) => {
    const result = await provider.distill(store, threadId);
    const clean = result.facts.filter((f) => {
      const v = scanner.scan({ content: f.fact, scope: f.scope, authored_by: f.authored_by });
      if (!v.ok) {
        store.recordQuarantine({ target_id: f.provenance, rule: v.rule });
        return false;
      }
      return true;
    });
    store.insertDistilledFacts(clean, provider.id);
    store.insertDistillationEvent(threadId, trigger, clean.length, provider.id);
  });
}
