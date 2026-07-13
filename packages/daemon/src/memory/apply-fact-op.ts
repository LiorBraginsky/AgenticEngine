import type { MemoryStore } from "./store.js";
import { normalizeFactText } from "./normalize-fact-text.js";

/**
 * applyFactOp — the ONE shared fact-mutation primitive with a GROWABLE per-op
 * handler set (ADR-0016 D7a-bis rider). Today: new | append | replace. Future
 * topic-consolidation ops land as NEW handlers (backlog §E) — DO NOT build them
 * here. Extracted verbatim (no semantic change) from distillOneThread's Phase-3
 * apply loop (distiller-registration.ts) so BOTH the distiller and the chunk-01
 * `MemoryActionPort` can share the optimistic-concurrency + never-replace-human
 * demote + record-replaced logic without duplicating the destructive path.
 *
 * Callable WITHOUT a `DistillDelta`. Performs NO watermark / distill-event writes
 * — those side-effects stay with the caller (the distiller keeps its own
 * watermark advances + insertDistillationEvent OUTSIDE this unit; the port never
 * writes them at all). Runs inside the caller's tx if any (bun:sqlite nested
 * SAVEPOINT composes — the store primitives self-wrap).
 */
export interface ApplyFactOpInput {
  op: "new" | "append" | "replace";
  fact: string;                 // user-language display text
  canonical: string;            // match key; caller may pass "" ⇒ falls back to normalizeFactText(fact)
  topics: string[];
  provenance: string;           // e.g. `thread:<id>`
  targetId?: string;            // resolved id (caller resolves ordinal→id); undefined ⇒ treated as new
  expectedTargetText?: string;  // for non-new ops: optimistic-concurrency check text
  reason?: string;               // recordReplacedFact reason on a surviving replace (2c-01 review
                                  // FIX 6 — restores the caller-specific trail the pre-extraction
                                  // welded code recorded: the distiller passes "distill-replace",
                                  // the port passes "apply-replace"). Defaults to "apply-replace".
}

export type ApplyFactOutcome =
  | "inserted" | "replaced" | "appended" | "deduped"
  | "demoted-inserted" | "demoted-deduped";

export interface ApplyFactOpResult { outcome: ApplyFactOutcome; factId?: string; }

/**
 * actor = provider.id for the distiller, or "agent" for the port. Runs inside the
 * caller's tx if any (bun:sqlite nested SAVEPOINT composes — the store primitives
 * self-wrap).
 */
export function applyFactOp(store: MemoryStore, input: ApplyFactOpInput, actor: string): ApplyFactOpResult {
  const canonical = input.canonical || normalizeFactText(input.fact);

  // ── Resolve effectiveOp/targetId demotes (ported verbatim from
  // distiller-registration.ts's Q5 steps 1-3; ordinal→id resolution stays with the
  // caller — this primitive only ever sees an already-resolved targetId). ──────
  let effectiveOp: "new" | "append" | "replace" = input.op;
  let targetId = input.targetId;
  let demoted = false;

  if (effectiveOp !== "new" && targetId !== undefined) {
    // Optimistic-concurrency re-read
    const currentRow = store.rawDb()
      .query("SELECT fact, authored_by FROM distilled_facts WHERE id = ?")
      .get(targetId) as { fact: string; authored_by: string } | null;

    if (currentRow === null) {
      // Target no longer exists — demote to new
      effectiveOp = "new";
      targetId = undefined;
      demoted = true;
    } else if (currentRow.fact !== input.expectedTargetText) {
      // Concurrency conflict: target text moved — non-destructive demote
      effectiveOp = "new";
      targetId = undefined;
      demoted = true;
    } else if (currentRow.authored_by === "human") {
      // Never-replace-human (5e) — demote to new
      effectiveOp = "new";
      targetId = undefined;
      demoted = true;
    }
  } else if (effectiveOp !== "new") {
    // No targetId (unresolved ordinal / out-of-range) — demote to new
    effectiveOp = "new";
    targetId = undefined;
    demoted = true;
  }

  const base = {
    fact: input.fact,
    canonical,
    topics: input.topics,
    confidence: 1 as number,
  };

  if (effectiveOp === "replace" && targetId !== undefined) {
    // Surviving replace → updateFactById (records replaced text)
    store.updateFactById(
      targetId,
      { ...base },
      { actor, reason: input.reason ?? "apply-replace" },
      actor,
    );
    return { outcome: "replaced", factId: targetId };
  }

  if (effectiveOp === "append" && targetId !== undefined) {
    // Surviving append → appendToFactById; false → fall through to the
    // new-insert branch below (with a demoted-* outcome).
    //
    // appendToFactById requires the FULL MERGED canonical (all items) so BM25
    // can still find the fact by its EARLIER items — read the target's CURRENT
    // canonical and space-join with the new item's canonical.
    const currentCanonicalRow = store.rawDb()
      .query("SELECT canonical FROM fact_fts WHERE fact_id = ?")
      .get(targetId) as { canonical: string } | null;
    const currentCanonical = currentCanonicalRow?.canonical ?? "";
    const mergedCanonical = currentCanonical ? `${currentCanonical} ${canonical}` : canonical;

    const appended = store.appendToFactById(targetId, input.fact, mergedCanonical);
    if (appended) {
      return { outcome: "appended", factId: targetId };
    }
    // Cap hit or id absent — demote to new (dedup-check-then-insert below).
    demoted = true;
  }

  // new (original or demoted).
  // SUPPRESS-ONLY existence check over ALL facts — only no-ops a NEW/demoted
  // insert here; never reaches replace/normal-append, so it never mutates an
  // existing row.
  // Dedup across BOTH write paths (chunk-05, spec §3.5 d6 / §3.7 suppress-as-dup):
  // check the English canonical (distiller-vs-distiller cross-language) AND the
  // user-language display-text norm (tool-vs-distiller — the tool path stores a
  // user-language canonical, so a distiller re-derivation carrying the LLM's ENGLISH
  // canonical would otherwise miss the tool's fact → dup spam / D1). normalizeFactText
  // is the ONE shared key helper — no second normalization.
  const displayNorm = normalizeFactText(input.fact);
  if (store.factExistsByDedupKey(canonical) || store.factExistsByDedupKey(displayNorm)) {
    return { outcome: demoted ? "demoted-deduped" : "deduped" };
  }

  // machine facts are ALWAYS cross-thread (relay-006 MINOR-4); thread-local is
  // human-only, 5f preserved in readDistilledFactsForThread.
  const id = store.insertFact(
    { ...base, provenance: input.provenance, scope: "cross-thread", expiry: null, authored_by: "machine" },
    actor,
  );
  return { outcome: demoted ? "demoted-inserted" : "inserted", factId: id };
}
