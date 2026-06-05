import type { ConsolidationHook } from "./consolidation-hook.js";
import type { MemoryStore } from "./store.js";
import type { MemoryProvider } from "./memory-provider.js";

/**
 * Wire the distiller as the consolidation-hook's handler.
 * Fires on every dismiss — writes distilled_facts AND a distillation_events row
 * even when facts.length === 0 (5b: "deliberately retained nothing" is observable).
 */
export function registerDistiller(
  hook: ConsolidationHook,
  store: MemoryStore,
  provider: MemoryProvider,
): void {
  hook.register(async (threadId, trigger) => {
    const result = await provider.distill(store, threadId);
    store.insertDistilledFacts(result.facts, provider.id);
    store.insertDistillationEvent(threadId, trigger, result.facts.length, provider.id);
  });
}
