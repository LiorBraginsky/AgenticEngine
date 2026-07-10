import type { MemoryStore } from "./store.js";
import type { WriteGate } from "./write-gate.js";
import type { MemoryScanner } from "./scanner/memory-scanner.js";
import { normalizeFactText } from "./normalize-fact-text.js";
import { applyFactOp } from "./apply-fact-op.js";

/** spec §3.4 D4c — ONE exported constant; chunk-02's provider loop imports the same
 *  constant so the loop-iteration bound and the per-turn action cap are ONE number. */
export const MEMORY_ACTIONS_MAX_PER_TURN = 3;

/**
 * ONE object per turn (spec §7 CLOSED). chunk-01 constructs it directly in tests;
 * chunk-02 builds it from the retrieve slice. The port MUTATES `actionsUsed`.
 * `ordinalMap` keys are 1-based, derived from the exact injected `live` list
 * (chunk-02), never raw DB rows.
 */
export interface MemoryActionTurnContext {
  threadId: string;
  ordinalMap: Map<number, string>; // ordinal → distilled_facts.id
  actionsUsed: number;             // shared cap counter (mutable)
}

export type MemoryActionResult =
  | { ok: true; action: "forget" | "remember" | "reassert"; factId?: string; message: string }
  | { ok: false; code: "not_in_view" | "stale_target" | "refused_human_fact" | "rejected_by_scan" | "cap_exceeded" | "duplicate"; message: string };

export interface MemoryForgetInput {
  ordinal: number;
  expected_text: string;
  reason?: string;
}

export interface MemoryRememberInput {
  fact: string;
  replaces_ordinal?: number;
  expected_text?: string;
}

/**
 * MemoryActionPort — the daemon-internal 2c capability (spec §3.2/§3.3/§3.6/§3.7).
 * NEVER throws across the port boundary (known-gotcha #9): every path returns a
 * typed MemoryActionResult. Derives outcomes itself (D2c) — never infers
 * applied-vs-refused from a void return. Every terminal path (applied OR refused)
 * writes exactly ONE `recordMemoryActionEvent` — via the private `audit` helper.
 */
export class MemoryActionPort {
  constructor(
    private readonly store: MemoryStore,
    private readonly gate: WriteGate,
    private readonly scanner: MemoryScanner,
  ) {}

  forget(ctx: MemoryActionTurnContext, input: MemoryForgetInput): MemoryActionResult {
    if (ctx.actionsUsed >= MEMORY_ACTIONS_MAX_PER_TURN) {
      return this.audit(ctx, "forget", input.expected_text, {
        ok: false,
        code: "cap_exceeded",
        message: "Memory action limit reached for this turn.",
      });
    }
    ctx.actionsUsed++;

    const factId = ctx.ordinalMap.get(input.ordinal);
    if (factId === undefined) {
      return this.audit(ctx, "forget", input.expected_text, {
        ok: false,
        code: "not_in_view",
        message: "That fact isn't in this turn's view — I can't target it here. Use the Memory window.",
      });
    }

    const row = this.store.readFactById(factId);
    if (row === null) {
      return this.audit(ctx, "forget", input.expected_text, {
        ok: false,
        code: "stale_target",
        message: "That fact no longer exists — it may already have been changed or removed.",
      });
    }

    if (normalizeExpectedText(input.expected_text) !== normalizeFactText(row.fact)) {
      return this.audit(ctx, "forget", row.fact, {
        ok: false,
        code: "stale_target",
        message: "That fact has changed since I last saw it — I won't forget it based on stale text.",
      });
    }

    if (row.authored_by === "human") {
      return this.audit(ctx, "forget", row.fact, {
        ok: false,
        code: "refused_human_fact",
        message: "That's a fact you pinned — only you can remove it, via the Memory window.",
      });
    }

    this.gate.forgetFactById(factId, { actor: "agent", authored_by: "machine" }, input.reason);

    if (this.store.readFactById(factId) !== null) {
      // Defensive: the gate refused for a reason the pre-checks above missed.
      return this.audit(ctx, "forget", row.fact, {
        ok: false,
        code: "stale_target",
        message: "That fact couldn't be forgotten — it may have changed.",
      });
    }

    this.store.recordForgottenFact({
      raw_text: row.fact,
      provenance: row.provenance,
      actor: "agent",
      authored_by: "machine",
      reason: input.reason,
    });

    return this.audit(ctx, "forget", row.fact, {
      ok: true,
      action: "forget",
      factId,
      message: "Forgotten.",
    });
  }

  remember(ctx: MemoryActionTurnContext, input: MemoryRememberInput): MemoryActionResult {
    if (ctx.actionsUsed >= MEMORY_ACTIONS_MAX_PER_TURN) {
      return this.audit(ctx, "remember", input.fact, {
        ok: false,
        code: "cap_exceeded",
        message: "Memory action limit reached for this turn.",
      });
    }
    ctx.actionsUsed++;

    const scan = this.scanner.scan({ content: input.fact, scope: "cross-thread", authored_by: "machine" });
    if (!scan.ok) {
      this.store.recordQuarantine({ target_id: crypto.randomUUID(), rule: scan.rule });
      return this.audit(ctx, "remember", input.fact, {
        ok: false,
        code: "rejected_by_scan",
        message: "I can't remember that — it was flagged by a safety check.",
      });
    }

    const norm = normalizeFactText(input.fact);
    const wasForgotten = this.store.isForgottenNormalizedText(norm);
    const provenance = `thread:${ctx.threadId}`;

    const outcome = input.replaces_ordinal !== undefined
      ? this.rememberExplicitTarget(ctx, input, input.replaces_ordinal, norm, provenance)
      : this.rememberNoTarget(input, norm, provenance);

    // D6e: an insert/replace whose normalized text matches a forgotten_facts row is a
    // prompted re-assertion — clears the record and reports its OWN event type ('reassert').
    if (outcome.ok && wasForgotten) {
      this.store.clearForgottenByNormalizedText(norm);
      return this.audit(ctx, "reassert", input.fact, { ...outcome, action: "reassert" });
    }
    return this.audit(ctx, "remember", input.fact, outcome);
  }

  private rememberExplicitTarget(
    ctx: MemoryActionTurnContext,
    input: MemoryRememberInput,
    ordinal: number,
    norm: string,
    provenance: string,
  ): MemoryActionResult {
    const factId = ctx.ordinalMap.get(ordinal);
    if (factId === undefined) {
      return { ok: false, code: "not_in_view", message: "That fact isn't in this turn's view — I can't target it here. Use the Memory window." };
    }

    const row = this.store.readFactById(factId);
    if (row === null) {
      return { ok: false, code: "stale_target", message: "That fact no longer exists — it may already have been changed or removed." };
    }

    const expectedNorm = normalizeExpectedText(input.expected_text ?? "");
    if (expectedNorm !== normalizeFactText(row.fact)) {
      // q#015 R1 rider 1 — never fall through to insert on a mismatched explicit target.
      return { ok: false, code: "stale_target", message: "That fact has changed since I last saw it — I won't replace it based on stale text." };
    }

    if (row.authored_by === "human") {
      if (norm === normalizeFactText(row.fact)) {
        return { ok: false, code: "duplicate", message: "I already have that noted." };
      }
      // D7a: human wins at injection — insert a competing machine fact, never replace.
      const applied = applyFactOp(this.store, { op: "new", fact: input.fact, canonical: norm, topics: [], provenance }, "agent");
      return { ok: true, action: "remember", factId: applied.factId, message: "Remembered. Your pinned fact still stands." };
    }

    // machine target
    if (norm === normalizeFactText(row.fact)) {
      return { ok: false, code: "duplicate", message: "I already have that noted." };
    }
    const applied = applyFactOp(this.store, { op: "replace", fact: input.fact, canonical: norm, topics: [], provenance, targetId: factId, expectedTargetText: row.fact }, "agent");
    return { ok: true, action: "remember", factId: applied.factId, message: "Remembered." };
  }

  private rememberNoTarget(input: MemoryRememberInput, norm: string, provenance: string): MemoryActionResult {
    if (this.store.factExistsByDedupKey(norm)) {
      return { ok: false, code: "duplicate", message: "I already have that noted." };
    }
    const applied = applyFactOp(this.store, { op: "new", fact: input.fact, canonical: norm, topics: [], provenance }, "agent");
    return { ok: true, action: "remember", factId: applied.factId, message: "Remembered." };
  }

  private audit(
    ctx: MemoryActionTurnContext,
    action: "forget" | "remember" | "reassert",
    factText: string,
    result: MemoryActionResult,
  ): MemoryActionResult {
    this.store.recordMemoryActionEvent({
      thread_id: ctx.threadId,
      action,
      outcome: result.ok ? "applied" : `refused-${result.code}`,
      fact_text: factText,
      actor: "agent",
    });
    return result;
  }
}

/** D3c: strip a leading ordinal prefix defensively ("3. ") before normalizing, so the
 *  match tolerates the LLM echoing the injected index alongside the fact text. */
function normalizeExpectedText(text: string): string {
  return normalizeFactText(text.replace(/^\s*\d+\.\s*/, ""));
}
