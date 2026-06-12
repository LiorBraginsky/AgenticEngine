import type { ConsolidationHook } from "./consolidation-hook.js";
import type { MemoryStore } from "./store.js";
import type { MemoryProvider } from "./memory-provider.js";
import type { MemoryScanner } from "./scanner/memory-scanner.js";

/**
 * Wire the distiller as the consolidation-hook's batch handler.
 *
 * THREE-PHASE FLOW per dismiss (spec D4, R3, R4):
 *
 * Phase 1 — COMPUTE (outside any tx): `provider.distill(store, triggerThreadId)`.
 *   The ONLY await in the flow. The seam where chunk 03's LLM call will live —
 *   deliberately outside the transaction (grill #6: open-tx-await stalls the
 *   single-connection daemon). If it rejects/throws → failure path.
 *
 * Phase 2 — SCAN per-fact (outside the tx, pre-insert): per fact, scanner.scan();
 *   on !v.ok, record a quarantine marker iff provenance is a message UUID (not
 *   "thread:"). Produce `clean` = survivors. 5d quarantine recording stays
 *   per-fact, pre-insert — DO NOT MOVE IT INTO THE TRANSACTION.
 *
 * Phase 3 — ONE synchronous tx (the replace): build one event row per id in
 *   `dismissedThreadIds` with trigger="reprojection" and facts_produced=clean.length
 *   (the RESULTING projection size, same value across all rows in the run).
 *   Call store.replaceProjection(clean, provider.id, eventRows) — the single flat
 *   db.transaction doing drop(!= human) + insert(clean) + insert(events).
 *
 * FAILURE PATH (Phase 1 or 2 throws): do NOT call replaceProjection (no drop →
 *   existing projection stays intact; "never an empty projection"). Read the current
 *   persisted projection size (count all distilled_facts) for facts_produced.
 *   Write one trigger="reprojection-failed" row per id in dismissedThreadIds
 *   (independent inserts — no atomicity needed, nothing was dropped), then
 *   console.error. The existing projection is unchanged; next disconnect retries.
 */
export function registerDistiller(
  hook: ConsolidationHook,
  store: MemoryStore,
  provider: MemoryProvider,
  scanner: MemoryScanner,
): void {
  hook.register(async (dismissedThreadIds: string[], triggerThreadId: string) => {
    // ── Phase 1: COMPUTE (outside any transaction) ───────────────────────
    let result: Awaited<ReturnType<typeof provider.distill>>;
    try {
      result = await provider.distill(store, triggerThreadId);
    } catch (err) {
      // Failure path: provider threw — do NOT drop the existing projection.
      // facts_produced = count of the CURRENT persisted projection (unchanged).
      // This records the size of the projection that SURVIVED (no drop happened).
      const currentSize = (store.rawDb()
        .query("SELECT COUNT(*) AS n FROM distilled_facts")
        .get() as { n: number }).n;
      for (const id of dismissedThreadIds) {
        store.insertDistillationEvent(id, "reprojection-failed", currentSize, provider.id);
      }
      console.error("[distiller] provider.distill failed; existing projection preserved:", err);
      throw err; // surface so index.ts catch can log the non-fatal error
    }

    // ── Phase 2: SCAN per-fact (outside the tx, pre-insert) ─────────────
    // Per-fact quarantine recording stays HERE, pre-insert (5d unchanged).
    let clean: typeof result.facts;
    try {
      clean = result.facts.filter((f) => {
        const v = scanner.scan({ content: f.fact, scope: f.scope, authored_by: f.authored_by });
        if (!v.ok) {
          // Only record a quarantine marker when the provenance is a message UUID (not a
          // thread-level "thread:<uuid>" ref). isMessageQuarantined queries by message UUID
          // and can never match a thread-level provenance, making such a marker write-only.
          // Thread-level facts are re-blocked deterministically on every dismiss by the
          // scanner itself — no durable marker is needed for them.
          if (f.provenance && !f.provenance.startsWith("thread:")) {
            store.recordQuarantine({ target_id: f.provenance, rule: v.rule });
          }
          return false;
        }
        return true;
      });
    } catch (err) {
      // Phase 2 threw — same failure path as Phase 1.
      const currentSize = (store.rawDb()
        .query("SELECT COUNT(*) AS n FROM distilled_facts")
        .get() as { n: number }).n;
      for (const id of dismissedThreadIds) {
        store.insertDistillationEvent(id, "reprojection-failed", currentSize, provider.id);
      }
      console.error("[distiller] scan phase failed; existing projection preserved:", err);
      throw err;
    }

    // ── Phase 3: ONE synchronous tx (the replace) ────────────────────────
    // One event row per dismissed thread; facts_produced = clean.length (same
    // value across all rows in this run — documents the RESULTING projection size).
    const eventRows = dismissedThreadIds.map((id) => ({
      threadId: id,
      trigger: "reprojection",
      factsProduced: clean.length,
    }));
    store.replaceProjection(clean, provider.id, eventRows);
  });
}
