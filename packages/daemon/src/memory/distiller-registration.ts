import type { ConsolidationHook } from "./consolidation-hook.js";
import type { MemoryStore } from "./store.js";
import type { MemoryProvider, DistillDelta, FactOp } from "./memory-provider.js";
import type { MemoryScanner } from "./scanner/memory-scanner.js";
import { SmartDistillError } from "./providers/smart-distiller-provider.js";
import { normalizeFactText } from "./normalize-fact-text.js";

/**
 * Wire the distiller as the consolidation-hook's batch handler.
 *
 * THREE-PHASE FLOW per dismiss (spec §3.1–§3.3; ADR-0012 Amendment 2026-06-13):
 *
 * Idempotence skip-guard (D-V3b): BEFORE Phase 1, if distilled_through >= marker,
 *   record a "distill-skipped" no-op event and return (nothing to do).
 *
 * Phase 1 — COMPUTE (outside any tx): `provider.distill(store, triggerThreadId)`.
 *   The ONLY await in the flow — the LLM call lives here.
 *   If it rejects/throws → failure path (distill-failed / distill-truncated).
 *
 * Phase 2 — SCAN per-op (outside the tx, pre-insert): per op, scanner.scan();
 *   drop on !v.ok. Provenance is thread-level ("thread:<threadId>") so no per-op
 *   quarantine recording is needed. Survivors = cleanOps.
 *
 * Phase 3 — ONE synchronous tx (R1: spec D-V3c): wrap the ENTIRE apply loop AND
 *   the two watermark advances (advanceDistilledThrough + advanceDistilledThroughTurn)
 *   in ONE store.rawDb().transaction(()=>{…})() so a partial apply can never mark a
 *   thread "distilled" while its facts didn't land. bun:sqlite supports nested
 *   SAVEPOINT, so calling the v2-02 primitives (which self-wrap db.transaction) inside
 *   an outer rawDb().transaction() composes correctly.
 *   Per-op Q5 gate (in order):
 *     1. Resolve targetOrdinal → candidateIds[targetOrdinal-1]. Out-of-range / non-new without ordinal → new.
 *     2. Optimistic-concurrency: re-read current text !== expectedTargetText → non-destructive (new).
 *     3. Never-replace-human: target authored_by='human' → new (5e).
 *     4. Surviving replace → updateFactById; append → appendToFactById (false → new); else insertFact.
 *   After the loop: advance both watermarks inside the SAME tx.
 *   Then write ONE distillation event per dismissed thread (trigger:"distill").
 *
 * FAILURE PATH (Phase 1 or tx throws): do NOT advance watermarks. Write one
 *   "distill-failed" (or "distill-truncated" for truncation) event per dismissed thread,
 *   console.error, rethrow. The existing store is unchanged; next dismiss retries.
 *
 * MAJOR-3 — SERIALIZE CONCURRENT SAME-TARGET DELTAS (promise-queue):
 *   Smart's Phase-1 distill() is async. Two overlapping dismisses can interleave.
 *   Fix: serialize via a promise-queue. The optimistic-concurrency re-read (current
 *   target text == expectedTargetText) is what makes serialized same-target deltas
 *   non-destructive-on-conflict — a second queued run whose target text already moved
 *   demotes to non-destructive rather than clobbering.
 */

/**
 * doOneRun — the idempotence-skip + three-phase distill+scan+apply body.
 * Extracted so the promise-queue in registerDistiller can call it sequentially.
 */
async function doOneRun(
  store: MemoryStore,
  provider: MemoryProvider,
  scanner: MemoryScanner,
  dismissedThreadIds: string[],
  triggerThreadId: string,
): Promise<void> {
  // ── Idempotence skip-guard (D-V3b) ──────────────────────────────────────
  // Check BEFORE Phase 1. If distilled_through >= marker, nothing new has happened
  // in this thread since the last distill run.
  const state = store.readThreadDistillState(triggerThreadId);
  const currentMarker = store.readThreadMarker(triggerThreadId);
  if (state.distilled_through >= currentMarker) {
    // No-op: record a "distill-skipped" event so History shows it was considered
    for (const id of dismissedThreadIds) {
      store.insertDistillationEvent(id, "distill-skipped", 0, provider.id);
    }
    return;
  }

  // ── Local failure helper ─────────────────────────────────────────────────
  // On phase failure: write one event per dismissed thread (trigger=distill-failed or
  // distill-truncated), console.error, rethrow. The store is unchanged; watermarks stay put.
  const recordDistillFailure = (
    err: unknown,
    phase: string,
    trigger: string = "distill-failed",
  ): void => {
    for (const id of dismissedThreadIds) {
      store.insertDistillationEvent(id, trigger, 0, provider.id);
    }
    console.error(`[distiller] ${phase} failed:`, err);
  };

  // ── Phase 1: COMPUTE (outside any transaction) ───────────────────────────
  let delta: DistillDelta;
  try {
    delta = await provider.distill(store, triggerThreadId);
  } catch (err) {
    const trigger =
      err instanceof SmartDistillError && err.truncated
        ? "distill-truncated"
        : "distill-failed";
    recordDistillFailure(err, "provider.distill", trigger);
    throw err;
  }

  // ── Phase 2: SCAN per-op (outside the tx, pre-insert) ────────────────────
  // Provenance is thread-level ("thread:<threadId>") so no per-op quarantine recording.
  let cleanOps: FactOp[];
  try {
    cleanOps = delta.ops.filter((op) => {
      const v = scanner.scan({ content: op.fact ?? "", scope: "cross-thread", authored_by: "machine" });
      return v.ok;
    });
  } catch (err) {
    recordDistillFailure(err, "scan phase");
    throw err;
  }

  // ── Phase 3: ONE synchronous tx (R1 — spec D-V3c) ───────────────────────
  // Wrap the apply loop + BOTH watermark advances in ONE outer rawDb() transaction.
  // bun:sqlite supports nested SAVEPOINT, so the v2-02 primitives (self-wrapping
  // db.transaction) compose correctly inside this outer tx.
  // Invariant (M1 / D-V3c): the watermark advances ONLY after all facts have landed.
  try {
    store.rawDb().transaction((): void => {
      const provenance = `thread:${triggerThreadId}`;

      for (const op of cleanOps) {
        // Q5 step 1: resolve targetOrdinal → id
        let targetId: string | undefined;
        if (op.op !== "new" && op.targetOrdinal !== undefined) {
          targetId = delta.candidateIds[op.targetOrdinal - 1];
        }

        let effectiveOp = op.op;

        if (op.op !== "new" && targetId !== undefined) {
          // Q5 step 2: optimistic-concurrency check
          const currentRow = store.rawDb()
            .query("SELECT fact, authored_by FROM distilled_facts WHERE id = ?")
            .get(targetId) as { fact: string; authored_by: string } | null;

          if (currentRow === null) {
            // Target no longer exists — demote to new
            effectiveOp = "new";
            targetId = undefined;
          } else if (currentRow.fact !== op.expectedTargetText) {
            // Concurrency conflict: target text moved — non-destructive demote
            effectiveOp = "new";
            targetId = undefined;
          } else if (currentRow.authored_by === "human") {
            // Q5 step 3: never-replace-human (5e) — demote to new
            effectiveOp = "new";
            targetId = undefined;
          }
        } else if (op.op !== "new") {
          // No targetOrdinal or out-of-range candidateIds — demote to new
          effectiveOp = "new";
          targetId = undefined;
        }

        const canonical = op.canonical || normalizeFactText(op.fact);
        const base = {
          fact: op.fact,
          canonical,
          topics: op.topics,
          confidence: 1 as number,
        };

        if (effectiveOp === "replace" && targetId !== undefined) {
          // Q5 step 4: surviving replace → updateFactById (records replaced text)
          store.updateFactById(
            targetId,
            { ...base },
            { actor: provider.id, reason: "distill-replace" },
            provider.id,
          );
        } else if (effectiveOp === "append" && targetId !== undefined) {
          // Q5 step 4: surviving append → appendToFactById; false → new
          const appended = store.appendToFactById(targetId, op.fact, canonical);
          if (!appended) {
            // Cap hit or id absent — demote to new
            store.insertFact(
              { ...base, provenance, scope: "cross-thread", expiry: null, authored_by: "machine" },
              provider.id,
            );
          }
        } else {
          // new (original or demoted)
          store.insertFact(
            { ...base, provenance, scope: "cross-thread", expiry: null, authored_by: "machine" },
            provider.id,
          );
        }
      }

      // Both watermark advances are INSIDE the same tx (R1 / D-V3c)
      store.advanceDistilledThrough(triggerThreadId, delta.distilledThroughMarker);
      store.advanceDistilledThroughTurn(triggerThreadId, delta.distilledThroughTurn);
    })();
  } catch (err) {
    // Phase 3 threw — bun:sqlite rolled back automatically (never-drop holds).
    // Write failure events + rethrow.
    recordDistillFailure(err, "apply phase (Phase 3)");
    throw err;
  }

  // Write ONE distillation event per dismissed thread (trigger:"distill")
  for (const id of dismissedThreadIds) {
    store.insertDistillationEvent(id, "distill", cleanOps.length, provider.id);
  }
}

export function registerDistiller(
  hook: ConsolidationHook,
  store: MemoryStore,
  provider: MemoryProvider,
  scanner: MemoryScanner,
): void {
  // MAJOR-3: promise-queue — serialize concurrent same-target deltas.
  //
  // Non-destructive-on-conflict — the optimistic-concurrency re-read
  // (current target text == expectedTargetText) is what makes serialized
  // same-target deltas safe; a second queued run whose target text already moved
  // demotes to non-destructive rather than clobbering.
  // lastRun.catch(()=>{}) isolates a prior run's failure so the chain survives:
  //   the prior run already recorded its distill-failed rows + rethrew to its own caller.
  // `return thisRun` so the caller (hook.dismiss → close(ws)) still awaits THIS run + sees its rejection.
  let lastRun: Promise<void> = Promise.resolve();

  hook.register((dismissedThreadIds: string[], triggerThreadId: string) => {
    const thisRun = lastRun
      .catch(() => {
        // prior run already recorded its distill-failed rows + rethrew to its own caller
      })
      .then(() => doOneRun(store, provider, scanner, dismissedThreadIds, triggerThreadId));
    lastRun = thisRun;
    return thisRun; // caller (hook.dismiss → close(ws)) still awaits THIS run + sees its rejection
  });
}
