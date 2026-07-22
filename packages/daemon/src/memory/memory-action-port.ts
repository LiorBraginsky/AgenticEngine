import type { MemoryStore } from "./store.js";
import type { WriteGate } from "./write-gate.js";
import type { MemoryScanner } from "./scanner/memory-scanner.js";
import { normalizeFactText } from "./normalize-fact-text.js";
import { applyFactOp } from "./apply-fact-op.js";

/** spec §3.4 D4c — ONE exported constant; chunk-02's provider loop imports the same
 *  constant so the loop-iteration bound and the per-turn action cap are ONE number. */
export const MEMORY_ACTIONS_MAX_PER_TURN = 3;

/** spec §3.6 D6b — the READ cap, enforced INDEPENDENTLY of MEMORY_ACTIONS_MAX_PER_TURN.
 *  The provider's loop-round backstop rises to the SUM so searches never starve a write. */
export const MEMORY_SEARCH_MAX_PER_TURN = 3;
const SEARCH_RESULT_CAP = 8; // spec §3.6 D6a top-N (architect-time)

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
  searchesUsed?: number;           // spec §3.6 D6b — read counter; optional so forget/remember-only contexts need not set it (defaults 0).
}

export interface SearchHit {
  kind: "fact" | "archive";
  source: string;
  text: string;
  withheld?: boolean;
}

export type MemoryActionResult =
  | { ok: true; action: "forget" | "remember" | "reassert"; factId?: string; message: string }
  | { ok: true; action: "search"; results: SearchHit[] } // spec §3.6 D6a — READ-ONLY, no ids (never targetable, §0.2)
  | { ok: false; code: "not_in_view" | "stale_target" | "refused_human_fact" | "rejected_by_scan" | "cap_exceeded" | "duplicate"; message: string };

/** The write-action arms of MemoryActionResult — every arm EXCEPT the read-only `search` variant.
 *  The write helpers (rememberExplicitTarget / rememberNoTarget) and the reassert spread only ever
 *  produce these; typing them to this (not the now-wider public union) keeps
 *  `{ ...outcome, action: "reassert" }` and audit() total after `search` widened the union
 *  (hybrid-retrieval chunk-05). Internal — NOT exported. */
type WriteActionResult = Exclude<MemoryActionResult, { action: "search" }>;

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

export interface MemorySearchInput { query: string; scope?: "facts" | "archive" | "all"; }

/** Structural ranker dep (spec §3.6 D6a port wiring). Defined HERE — NOT imported from the
 *  embedding module — so the port never imports hybrid-ranker.ts (no cycle). The concrete
 *  HybridRanker satisfies this structurally (its RankHit ⊇ {id,score}, and it has both methods;
 *  the store's narrower FactCandidateRanker has only searchFacts, so it is NOT reused here). */
export interface MemorySearchRankedHit { id: string; score: number; }
export interface MemorySearchRanker {
  searchFacts(query: string, k: number): Promise<MemorySearchRankedHit[]>;
  searchArchive(query: string, k: number): Promise<MemorySearchRankedHit[]>;
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
    private readonly ranker?: MemorySearchRanker, // hybrid-retrieval chunk-05 (spec §3.6 D6a)
  ) {}

  /** spec §3.6 D6d: search is available iff a ranker is wired. The provider gates memory_search
   *  out of tools[] when false, so the capability-conditional self-concept never claims search. */
  get canSearch(): boolean { return this.ranker !== undefined; }

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

    // hybrid-retrieval R2: capture the fact's canonical BEFORE the forget delete — the
    // trg_distilled_facts_ad AFTER DELETE trigger removes the fact_fts row, so it is
    // unreadable after gate.forgetFactById below.
    const canonical = this.store.readCanonicalForFact(factId);

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
      canonical,
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

    // 2c-01 review FIX 2: an empty/whitespace-only fact is invalid content — refuse it
    // BEFORE any insert (and before the scanner call, which would otherwise pass it: the
    // RuleBasedScanner has no emptiness rule). Reuses `rejected_by_scan` (no new typed-result
    // code) rather than widening the frozen result-code set.
    if (normalizeFactText(input.fact) === "") {
      return this.audit(ctx, "remember", input.fact, {
        ok: false,
        code: "rejected_by_scan",
        message: "I can't remember an empty note.",
      });
    }

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
    const wasForgotten = this.store.isForgottenNormalizedText(norm, norm); // R2: tool canonical == norm
    const provenance = `thread:${ctx.threadId}`;

    const outcome = input.replaces_ordinal !== undefined
      ? this.rememberExplicitTarget(ctx, input, input.replaces_ordinal, norm, provenance)
      : this.rememberNoTarget(input, norm, provenance);

    // D6e: an insert/replace whose normalized text matches a forgotten_facts row is a
    // prompted re-assertion — clears the record and reports its OWN event type ('reassert').
    if (outcome.ok && wasForgotten) {
      this.store.clearForgottenByNormalizedText(norm, norm); // R2: clear on either axis
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
  ): WriteActionResult {
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

  private rememberNoTarget(input: MemoryRememberInput, norm: string, provenance: string): WriteActionResult {
    if (this.store.factExistsByDedupKey(norm)) {
      return { ok: false, code: "duplicate", message: "I already have that noted." };
    }
    const applied = applyFactOp(this.store, { op: "new", fact: input.fact, canonical: norm, topics: [], provenance }, "agent");
    return { ok: true, action: "remember", factId: applied.factId, message: "Remembered." };
  }

  /**
   * spec §3.6 D6a — the READ tool. Runs the hybrid ranker over facts and/or the archive,
   * hydrates snippets honoring the standing archive-read posture (correction COALESCE,
   * tombstone + quarantine exclusion), screens every snippet through the RuleBasedScanner
   * (flagged ⇒ WITHHELD, §0.3), caps at SEARCH_RESULT_CAP. Results carry NO ids and never
   * join the ordinal map (§0.2 — READ-ONLY). NEVER throws (gotcha #9); NO audit event (D6b).
   */
  async search(ctx: MemoryActionTurnContext, input: MemorySearchInput): Promise<MemoryActionResult> {
    if (this.ranker === undefined) return { ok: true, action: "search", results: [] }; // gated off in tools[] anyway
    if ((ctx.searchesUsed ?? 0) >= MEMORY_SEARCH_MAX_PER_TURN) {
      return { ok: false, code: "cap_exceeded", message: "I've reached my search limit for this turn." };
    }
    ctx.searchesUsed = (ctx.searchesUsed ?? 0) + 1;

    // review-gate FIX 4: wrap the body in try/catch so the "NEVER throws" docstring claim is
    // structurally true (self-contained, like forget/remember) rather than relying on the
    // ranker/store never throwing. A rejecting ranker (or an unexpected store error) resolves
    // to an honest empty result set — never a forget-flavored refusal (this is a READ; D6b).
    try {
      const scope = input.scope ?? "all";
      const query = input.query ?? "";
      const factRanked = (scope === "facts" || scope === "all") ? await this.ranker.searchFacts(query, SEARCH_RESULT_CAP) : [];
      const archiveRanked = (scope === "archive" || scope === "all") ? await this.ranker.searchArchive(query, SEARCH_RESULT_CAP) : [];

      // Merge across corpora by RRF score DESC (same k ⇒ comparable); stable, facts-first on tie.
      type Cand = { kind: "fact" | "archive"; id: string; score: number };
      const cands: Cand[] = [
        ...factRanked.map((h) => ({ kind: "fact" as const, id: h.id, score: h.score })),
        ...archiveRanked.map((h) => ({ kind: "archive" as const, id: h.id, score: h.score })),
      ].sort((a, b) => (b.score - a.score) || (a.kind === b.kind ? 0 : a.kind === "fact" ? -1 : 1));

      // Hydrate archive rows in ONE correction-honored read (spec §3.6 archive-read posture).
      const archiveById = new Map(
        this.store.readArchiveMessagesByIds(cands.filter((c) => c.kind === "archive").map((c) => c.id)).map((r) => [r.id, r]),
      );

      const results: SearchHit[] = [];
      for (const c of cands) {
        if (results.length >= SEARCH_RESULT_CAP) break;
        if (c.kind === "fact") {
          const row = this.store.readFactById(c.id);
          if (row === null) continue; // deleted mid-turn (e.g. forgotten) — skip
          // ADR-0012 decision 5f + expiry — MIRROR the injection enforcement point
          // (store.readDistilledFactsForThread): memory_search must NOT surface a fact the per-thread
          // injection projection would exclude. A thread-local fact surfaces ONLY in its origin thread;
          // an expired fact never surfaces. Latent today (applyFactOp hardcodes scope 'cross-thread';
          // expiry dormant) — honoring the invariant keeps a future writer / legacy row from leaking a
          // private or stale fact cross-thread via search. Shared predicate (memory-fix-pass).
          if (!this.store.isFactVisibleToThread(row, ctx.threadId, Date.now())) continue;
          results.push(this.toHit("fact", "remembered fact", row.fact));
        } else {
          if (this.store.isMessageQuarantined(c.id)) continue; // §0.3 quarantine-excluded
          const row = archiveById.get(c.id);
          if (row === undefined || row.tombstoned) continue; // scrubbed/tombstoned — unreachable
          const sameThread = row.thread_id === ctx.threadId;
          const source =
            row.role === "user"
              ? (sameThread ? "you said earlier in this conversation" : "you said in a past conversation")
              : (sameThread ? "I said earlier in this conversation" : "I replied in a past conversation");
          results.push(this.toHit("archive", source, row.content));
        }
      }
      return { ok: true, action: "search", results };
    } catch (err) {
      console.error("[memory-action-port] search threw (should not happen):", err instanceof Error ? err.message : err);
      return { ok: true, action: "search", results: [] };
    }
  }

  /** Build a SearchHit, screening the snippet through the RuleBasedScanner (§0.3 defense-in-depth):
   *  a flagged snippet is WITHHELD — text becomes a safe marker and `withheld:true` is set. */
  private toHit(kind: "fact" | "archive", source: string, text: string): SearchHit {
    const scan = this.scanner.scan({ content: text, scope: "cross-thread", authored_by: "machine" });
    if (!scan.ok) return { kind, source, text: "[withheld — flagged by a safety check]", withheld: true };
    return { kind, source, text };
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
 *  match tolerates the LLM echoing the injected index alongside the fact text.
 *  The trailing `\s+` (not `\s*`) is load-bearing: it requires at least one space
 *  after the digits+dot, so a digit-LEADING fact text itself (e.g. "3.14 is pi",
 *  with no space after "3.") is never mistaken for an ordinal prefix and stripped. */
function normalizeExpectedText(text: string): string {
  return normalizeFactText(text.replace(/^\s*\d+\.\s+/, ""));
}
