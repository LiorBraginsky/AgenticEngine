import type { ConsolidationHook } from "./consolidation-hook.js";
import type { MemoryStore } from "./store.js";
import type { MemoryProvider, DistillResult } from "./memory-provider.js";
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
 *
 * MAJOR-3 — SERIALIZE CONCURRENT RE-PROJECTIONS (promise-queue):
 *   Smart's Phase-1 distill() is async (network call). Two overlapping disconnects
 *   can interleave: run A computes slowly while run B computes+commits, then A
 *   commits its STALE projection clobbering B + writing stale success rows.
 *   Fix: serialize via a promise-queue. Enqueue order = disconnect-arrival order
 *   = latest-wins (last-enqueued is last-committed). The .catch() on lastRun isolates
 *   a prior run's failure so the chain survives (the prior run already recorded its
 *   reprojection-failed rows + rethrew to its own caller). `return thisRun` so the
 *   caller (hook.dismiss → close(ws)) still awaits THIS run's result + sees its rejection.
 *   Three-phase flow + recordReprojectionFailure contract byte-preserved inside doOneRun.
 */

/**
 * doOneRun — the three-phase distill+scan+replace body, verbatim from the pre-MAJOR-3
 * handler. Extracted so the promise-queue in registerDistiller can call it sequentially.
 * This function is the ONLY place the three-phase semantics + failure contract live.
 * Do NOT move the failure contract or phase ordering.
 */
async function doOneRun(
  store: MemoryStore,
  provider: MemoryProvider,
  scanner: MemoryScanner,
  dismissedThreadIds: string[],
  triggerThreadId: string,
): Promise<void> {
  // ── Local failure helper (DRY — used by all three phase catch blocks) ──
  // On any phase failure: read the surviving MACHINE projection size, write one
  // `reprojection-failed` event row per dismissed thread (independent inserts —
  // no atomicity needed since nothing was dropped), console.error, then the
  // caller rethrows so index.ts logs the non-fatal error.
  const recordReprojectionFailure = (err: unknown, phase: string): void => {
    const currentSize = (store.rawDb()
      .query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by != 'human'")
      .get() as { n: number }).n;
    for (const id of dismissedThreadIds) {
      store.insertDistillationEvent(id, "reprojection-failed", currentSize, provider.id);
    }
    console.error(`[distiller] ${phase} failed; existing projection preserved:`, err);
  };

  // ── Phase 1: COMPUTE (outside any transaction) ───────────────────────
  let result: DistillResult;
  try {
    result = await provider.distill(store, triggerThreadId);
  } catch (err) {
    recordReprojectionFailure(err, "provider.distill");
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
    recordReprojectionFailure(err, "scan phase");
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
  try {
    store.replaceProjection(clean, provider.id, eventRows);
  } catch (err) {
    // Phase 3 threw (e.g. constraint violation in the flat tx — bun:sqlite rolls
    // back automatically, so never-drop holds). Write failure events + rethrow.
    recordReprojectionFailure(err, "replaceProjection (Phase 3)");
    throw err;
  }
}

export function registerDistiller(
  hook: ConsolidationHook,
  store: MemoryStore,
  provider: MemoryProvider,
  scanner: MemoryScanner,
): void {
  // MAJOR-3: promise-queue — serialize concurrent re-projections.
  //
  // Enqueue order = disconnect-arrival order = latest-wins.
  // lastRun.catch(()=>{}) isolates a prior run's failure so the chain survives:
  //   the prior run already recorded its reprojection-failed rows + rethrew to
  //   its own caller. `return thisRun` so the caller (hook.dismiss → close(ws))
  //   still awaits THIS run's result + sees its rejection.
  // Three-phase flow + failure contract byte-preserved inside doOneRun.
  let lastRun: Promise<void> = Promise.resolve();

  hook.register((dismissedThreadIds: string[], triggerThreadId: string) => {
    const thisRun = lastRun
      .catch(() => {
        // prior run already recorded its reprojection-failed rows + rethrew to its own caller
      })
      .then(() => doOneRun(store, provider, scanner, dismissedThreadIds, triggerThreadId));
    lastRun = thisRun;
    return thisRun; // caller (hook.dismiss → close(ws)) still awaits THIS run + sees its rejection
  });
}
