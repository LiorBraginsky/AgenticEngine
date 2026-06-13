/**
 * smart-distiller-provider.ts — LLM-backed incremental memory distiller (Haiku).
 *
 * id = "smart". Non-default; selected via MEMORY_PROVIDER=smart + resolvable key.
 *
 * Architecture: implements the v2-03 MemoryProvider port. `distill` runs in the
 * Phase-1 compute seam (outside any tx — the LLM await lives here). Reads ONLY
 * the just-ended thread's NEW TAIL (since its last distill_through_turn watermark),
 * fetches FTS5/BM25 candidates over the FULL corpus (outside any tx), asks Haiku
 * to propose a DistillDelta of targeted FactOps, and returns the delta.
 *
 * NEVER-THROW CONTRACT: any failure surfaces as a rejected promise to registration's
 * Phase-1 catch (→ recordDistillFailure). distill() does NOT swallow errors.
 *
 * The dead Layer-1/Layer-T/Layer-P projection post-filters are DROPPED from distill
 * (they filtered a full projection that no longer exists; forget is now durable delete
 * — a forgotten machine fact's row is removed from distilled_facts, with the AFTER DELETE
 * trigger keeping fact_fts/fact_topics in sync; no read-time suppression remains).
 * _getForgottenSuppression removed (3.0b — orphaned). retrieve kept exactly as-is.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MemoryProvider, DistilledFact, DistillDelta, FactOp } from "../memory-provider.js";
import type { MemoryStore } from "../store.js";
import type { SessionMessage } from "../../providers/provider.js";
import { REDACTION_MARKER } from "../schema.js";
import { REMEMBERED_LABEL } from "../../providers/system-prompt.js";
import { resolveAnthropicKey, type ResolveOpts } from "../../secrets/cloud-secrets.js";
// Imported from the shared module to avoid a store→provider import cycle.
// Also re-exported so external callers can still use "from ./smart-distiller-provider.js".
import { normalizeFactText } from "../normalize-fact-text.js";
export { normalizeFactText };

// ── Tunable constants (exported for unit tests) ────────────────────────────

export const SMART_MODEL = "claude-haiku-4-5";
/**
 * Cap on the LLM OUTPUT (the JSON delta op array). RUNWAY, NOT A CURE.
 * The v2-03 incremental path outputs ONE conversation's delta (new-tail ops), so the
 * output is bounded by the new-tail size, not the total archive. Any fixed cap can still
 * be hit if a single new-tail is unusually large; the stop_reason guard in distill()
 * makes the wall OBSERVABLE and NON-CORRUPTING (trigger="distill-truncated"), which is
 * the NAMED trigger for the future summarization tier (spec §1, out of scope) — the
 * actual fix. Do not treat a higher cap as the solution.
 */
export const SMART_MAX_TOKENS = 4096;
/** Per-thread message count limit before loud truncation. */
export const SMART_DIGEST_MAX_MSGS_PER_THREAD = 50;

/** Bounded slice retrieved from distilled_facts to inject at new-thread start. */
const RETRIEVE_SLICE_N = 20;

// ── System prompt (D10 — frozen shape) ────────────────────────────────────

export const SMART_SYSTEM_PROMPT = `You are a memory distiller. Your job is to extract and deduplicate the key facts from the user's conversation archive.

Output ONLY a JSON array (no prose, no fences). Each element must be an object with exactly these fields:
- "fact": a concise, self-contained statement of the fact (non-empty string)
- "provenance": the messages.id or comma-joined ids the fact was derived FROM (must appear in the digest as [role|<id>] lines)
- "scope": MUST be "thread-local" (relevant only to one thread) or "cross-thread" (relevant across sessions). NEVER use "global".
- "expiry": null, or a Unix epoch ms when the fact becomes stale
- "confidence": a number in [0, 1] indicating certainty

Rules:
- Deduplicate: one canonical fact per piece of information; cite all source threads in provenance.
- Compute counts and aggregates at distill time (e.g., "User has had 3 conversations").
- Set expiry:null unless the fact is clearly time-bound.
- Never scope a fact "global".
- Never output prose, markdown, or code fences — only the bare JSON array.
- If no facts are extractable, output [].
- Emit facts in order from most recent / most relevant to least recent, so that the most useful facts appear first.
- Write each "fact" in the SAME language the user used in the conversation (e.g. a Ukrainian conversation yields a Ukrainian "fact"); do not translate the user's language into English.`;

// ── v2-03 delta system prompt ──────────────────────────────────────────────

/**
 * System prompt for the incremental delta distiller (v2-03).
 *
 * The LLM receives:
 *   - The new-tail text (messages the user sent since the last distill watermark).
 *   - A numbered candidate pool (1..K) of existing facts from the store.
 *
 * It must return ONLY a JSON array of FactOps; no prose, no fences.
 *
 * Asymmetric-risk bias: "replace" is destructive (loses a fact).
 * Prompt instructs: emit "replace" ONLY for a genuine contradiction;
 * when uncertain, prefer "new" or "append", NEVER "replace".
 *
 * D-V6e (language preservation): "fact" is in the user's language.
 * D-V4c (canonical): "canonical" is a lowercased English match key.
 * Q6 (topics vocabulary): coarse, prompt-nudged, lowercase-kebab.
 */
export const SMART_DELTA_SYSTEM_PROMPT = `You are an incremental memory distiller. You will receive:
1. A NEW TAIL: the recent messages from a conversation thread.
2. A CANDIDATE POOL: numbered existing facts from the memory store (ordinals 1..K).

Output ONLY a JSON array of ops (no prose, no markdown fences). Each element:
{
  "op": "new" | "append" | "replace",
  "fact": "<fact text in the USER's language>",
  "canonical": "<lowercased English match key for dedup/search>",
  "topics": ["#about-user" | "#preferences" | "#projects" | "#relationships" | ...],
  "targetOrdinal": <integer 1..K, ONLY for "append" or "replace">,
  "expectedTargetText": "<the exact fact text at that ordinal, ONLY for "replace">"
}

Rules:
- "fact": write in the SAME language the user used (e.g. Ukrainian conversation → Ukrainian fact). Do NOT translate.
- "canonical": always a lowercased English phrase for FTS5 matching (e.g. "user likes tea").
- "topics": use #about-user, #preferences, #projects, #relationships; add others sparingly.
- op:"replace" ONLY for a genuine, clear contradiction of a shown candidate — copy its ordinal into "targetOrdinal" AND its exact text into "expectedTargetText".
- op:"append" to add a same-kind item to an existing candidate — copy its ordinal into "targetOrdinal".
- op:"new" for all other facts not contradicting any shown candidate.
- When uncertain, prefer "new" or "append". NEVER use "replace" speculatively — it is destructive.
- Never emit a "global" scope. Never produce prose.
- Return [] if nothing new is worth recording.`;

// ── Error type ─────────────────────────────────────────────────────────────

export class SmartDistillError extends Error {
  /** True only for the output-truncation case (stop_reason:"max_tokens").
   *  Lets the Phase-1 catch route truncation to a DISTINCT trigger
   *  ("reprojection-truncated") vs a generic parse/LLM failure
   *  ("reprojection-failed"). Defaults false so existing throw sites
   *  (parseFacts) keep the generic-failure routing. */
  readonly truncated: boolean;
  constructor(message: string, opts?: { truncated?: boolean }) {
    super(message);
    this.name = "SmartDistillError";
    this.truncated = opts?.truncated ?? false;
  }
}

// ── Text normalization (re-exported from normalize-fact-text.ts) ─────────────
//
// The single canonical definition lives in memory/normalize-fact-text.ts to avoid
// a store→provider import cycle (store.ts needs normalizeFactText for the
// forgotten_facts primitives). All callers import from this file (the re-export
// above keeps the public API address unchanged: "from ./smart-distiller-provider.js").
//
// Algorithm: NFKC → lowercase → strip REMEMBERED_LABEL prefix →
//   collapse whitespace runs to one space + trim →
//   strip trailing sentence punctuation (. ! ? ; ,) → strip surrounding quotes.
//
// Conservative exact-after-normalize match. A generative distiller can defeat
// this by rephrasing the fact. Never call this a hard guarantee.

// ── Digest builder (D8) ────────────────────────────────────────────────────

export interface DigestResult {
  text: string;
  empty: boolean;
}

/**
 * Builds the per-thread digest for the LLM.
 *
 * Format per thread:
 *   === thread <threadId> ===
 *   [role|<messageId>] <content>
 *   ...
 *
 * Rules (D8 triple — same as dumb-tail):
 *   - Skip messages whose content === REDACTION_MARKER (tombstoned)
 *   - Skip messages that are quarantined (isMessageQuarantined)
 *   - Skip messages whose id is fact-tombstoned (isFactTombstoned)
 *
 * Per-thread: if the surviving message count > M, take the LAST M and
 * emit a loud console.warn. NEVER silently drop the whole thread.
 */
export function buildDigest(store: MemoryStore): DigestResult {
  const threads = store.listThreads();
  const parts: string[] = [];
  const M = SMART_DIGEST_MAX_MSGS_PER_THREAD;

  for (const { thread_id } of threads) {
    const allMessages = store.readThreadMessagesForDistill(thread_id);

    // Apply the D8 triple filter
    const filtered = allMessages.filter(
      (m) =>
        m.content !== REDACTION_MARKER &&
        !store.isMessageQuarantined(m.id) &&
        !store.isFactTombstoned(m.id),
    );

    if (filtered.length === 0) continue;

    // Truncation: take the last M; emit loud warn
    let slice = filtered;
    if (filtered.length > M) {
      console.warn(
        `[smart-distiller] thread ${thread_id}: ${filtered.length} messages exceeds limit ${M}; ` +
          `truncating to the last ${M} messages. Some older messages will not be distilled this run.`,
      );
      slice = filtered.slice(-M);
    }

    // Emit the thread block
    const lines: string[] = [`=== thread ${thread_id} ===`];
    for (const m of slice) {
      lines.push(`[${m.role}|${m.id}] ${m.content}`);
    }
    parts.push(lines.join("\n"));
  }

  if (parts.length === 0) {
    return { text: "", empty: true };
  }

  return { text: parts.join("\n\n"), empty: false };
}

// ── Parse contract (D10 — defensive) ──────────────────────────────────────

/**
 * Parse the raw LLM response into DistilledFact[].
 *
 * Defensive steps:
 *   1. Strip optional ```json ... ``` fence.
 *   2. JSON.parse in try/catch → throw SmartDistillError on failure.
 *   3. Assert top-level is an array → throw SmartDistillError if not.
 *   4. Per-element: validate shape; drop bad elements (one bad ≠ whole failure).
 *      Valid scope = "thread-local" | "cross-thread" only ("global" → dropped).
 *      Confidence clamped to [0, 1]. Provenance unresolvable → kept (layer 2 backstops).
 *   5. Stamp authored_by: "machine" on every surviving element.
 *
 * Throws SmartDistillError on non-JSON or non-array response.
 * Returns [] (empty array) if all elements are malformed — acceptable (5b).
 */
export function parseFacts(raw: string): DistilledFact[] {
  // Step 1: strip optional ```json ... ``` fence (and bare ``` ... ``` fence)
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  cleaned = cleaned.trim();

  // Step 2: JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new SmartDistillError(
      `[smart-distiller] LLM response is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Step 3: assert array
  if (!Array.isArray(parsed)) {
    throw new SmartDistillError(
      `[smart-distiller] LLM response is not a JSON array; got: ${typeof parsed}`,
    );
  }

  // Step 4+5: per-element validate, drop bad, stamp authored_by
  const validScopes = new Set(["thread-local", "cross-thread"]);
  const facts: DistilledFact[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;

    const obj = item as Record<string, unknown>;

    // Validate 'fact': non-empty string
    if (typeof obj["fact"] !== "string" || obj["fact"].trim() === "") continue;

    // Validate 'provenance': string (may be unresolvable — kept, layer 2 backstops)
    if (typeof obj["provenance"] !== "string" || obj["provenance"].trim() === "") continue;

    // Validate 'scope': must be "thread-local" or "cross-thread"; "global" → drop
    if (typeof obj["scope"] !== "string" || !validScopes.has(obj["scope"])) continue;

    // Validate 'expiry': null or number
    const expiry = obj["expiry"];
    if (expiry !== null && typeof expiry !== "number") continue;

    // Validate 'confidence': number, clamped to [0, 1]
    if (typeof obj["confidence"] !== "number") continue;
    const confidence = Math.min(1, Math.max(0, obj["confidence"]));

    facts.push({
      fact: obj["fact"],
      provenance: obj["provenance"],
      scope: obj["scope"] as "thread-local" | "cross-thread",
      expiry: expiry as number | null,
      confidence,
      authored_by: "machine",
    });
  }

  return facts;
}

// ── v2-03 delta op parser ──────────────────────────────────────────────────

/**
 * Parse the raw LLM response into FactOp[].
 *
 * Defensive steps:
 *   1. Strip optional ```json ... ``` fence.
 *   2. JSON.parse in try/catch → throw SmartDistillError on failure.
 *   3. Assert top-level is an array → throw SmartDistillError if not.
 *   4. Per-element: validate shape; drop malformed ops (one bad ≠ whole failure).
 *      Valid op ∈ {"new","append","replace"}. Non-empty fact string. canonical string
 *      (default "" → caller falls back to normalizeFactText). topics array.
 *      targetOrdinal: small positive integer (optional). expectedTargetText: string (optional).
 *      Never emit a global-scoped anything (no scope field on FactOp — enforced by port).
 *
 * Throws SmartDistillError on non-JSON or non-array response.
 * Returns [] if all elements are malformed.
 */
export function parseOps(raw: string): FactOp[] {
  // Step 1: strip optional ```json ... ``` fence (and bare ``` ... ``` fence)
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  cleaned = cleaned.trim();

  // Step 2: JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new SmartDistillError(
      `[smart-distiller] LLM delta response is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Step 3: assert array
  if (!Array.isArray(parsed)) {
    throw new SmartDistillError(
      `[smart-distiller] LLM delta response is not a JSON array; got: ${typeof parsed}`,
    );
  }

  // Step 4: per-element validate and collect good ops
  const validOps = new Set(["new", "append", "replace"]);
  const ops: FactOp[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;

    const obj = item as Record<string, unknown>;

    // Validate 'op': must be "new" | "append" | "replace"
    if (typeof obj["op"] !== "string" || !validOps.has(obj["op"])) continue;

    // Validate 'fact': non-empty string
    if (typeof obj["fact"] !== "string" || obj["fact"].trim() === "") continue;

    // Validate 'canonical': string (may be empty — caller falls back to normalizeFactText)
    const canonical = typeof obj["canonical"] === "string" ? obj["canonical"] : "";

    // Validate 'topics': array of strings
    const topicsRaw = obj["topics"];
    const topics: string[] = Array.isArray(topicsRaw)
      ? (topicsRaw as unknown[]).filter((t): t is string => typeof t === "string")
      : [];

    // Optional 'targetOrdinal': small positive integer
    let targetOrdinal: number | undefined;
    if (obj["targetOrdinal"] !== undefined) {
      const ord = obj["targetOrdinal"];
      if (typeof ord === "number" && Number.isInteger(ord) && ord >= 1) {
        targetOrdinal = ord;
      }
      // malformed targetOrdinal → drop the field but keep the op (demote to new on apply)
    }

    // Optional 'expectedTargetText': string
    let expectedTargetText: string | undefined;
    if (typeof obj["expectedTargetText"] === "string") {
      expectedTargetText = obj["expectedTargetText"];
    }

    ops.push({
      op: obj["op"] as FactOp["op"],
      fact: obj["fact"],
      canonical,
      topics,
      ...(targetOrdinal !== undefined ? { targetOrdinal } : {}),
      ...(expectedTargetText !== undefined ? { expectedTargetText } : {}),
    });
  }

  return ops;
}

// ── DI options (mirrors anthropic-api-provider.ts pattern) ────────────────

export interface SmartDistillerOptions {
  /** Pre-built Anthropic client (injectable for tests). Takes highest precedence. */
  client?: Anthropic;
  /** Factory used to construct the lazy client (injectable for tests). */
  clientFactory?: (apiKey: string) => Anthropic;
  /** Injected resolver options for unit tests (fakes the Keychain without shelling out). */
  resolverOpts?: ResolveOpts;
  /** Direct key injection (tests / callers with an explicit key). */
  apiKey?: string;
}

// ── Provider class ─────────────────────────────────────────────────────────

/**
 * SmartDistillerProvider — LLM-backed incremental distiller (Haiku).
 *
 * id = "smart". Non-default; register via MEMORY_PROVIDER=smart.
 *
 * distill(store, triggerThreadId) — v2-03 incremental flow:
 *   1. Read distilled_through_turn (resilient, R2).
 *   2. readNewTailSince(threadId, distilled_through_turn) — filter tombstones/quarantine.
 *   3. Empty tail → short-circuit {ops:[], candidateIds:[]} (no LLM call).
 *   4. Build tail text; fetchCandidates(tailText) (≤K=10, FTS5/BM25 full corpus).
 *   5. Build numbered candidate pool (1..K → {fact, topics}).
 *   6. ONE LLM call (SMART_DELTA_SYSTEM_PROMPT; outside any tx — Phase-1 compute seam).
 *   7. stop_reason guard → throw SmartDistillError({truncated:true}).
 *   8. parseOps(rawText) → FactOp[] (defensive; drops malformed ops).
 *   9. Return DistillDelta {threadId, ops, candidateIds, distilledThroughMarker, distilledThroughTurn}.
 *
 * Dead Layer-1/Layer-T/Layer-P projection post-filters DROPPED (they filtered a full
 * projection that no longer exists; forget is now durable delete — forgotten machine facts
 * are removed from distilled_facts, AFTER DELETE trigger keeps fact_fts/fact_topics in sync).
 *
 * _getForgottenSuppression removed (3.0b — orphaned). retrieve KEPT exactly as-is.
 *
 * Any failure (LLM/parse) rejects — routes to registration's never-drop failure path.
 */
export class SmartDistillerProvider implements MemoryProvider {
  readonly id = "smart";

  private _client: Anthropic | null;
  private readonly _opts: SmartDistillerOptions;

  constructor(opts: SmartDistillerOptions = {}) {
    this._opts = opts;
    this._client = opts.client ?? null;
  }

  /**
   * Lazy-cached Anthropic client. Mirrors anthropic-api-provider.ts:179-186.
   * If no client or key is reachable, throws (routes to failure path).
   * NEVER logs the key value.
   */
  private getClient(): Anthropic {
    if (this._client) return this._client;

    let resolvedKey: string;

    if (this._opts.apiKey !== undefined && this._opts.apiKey !== "") {
      resolvedKey = this._opts.apiKey;
    } else {
      const resolved = resolveAnthropicKey(this._opts.resolverOpts);
      if (!resolved.ok) {
        throw new Error(
          `[smart-distiller] Cannot resolve ANTHROPIC_API_KEY: ${resolved.fixHint}`,
        );
      }
      resolvedKey = resolved.key;
    }

    const factory =
      this._opts.clientFactory ?? ((apiKey: string) => new Anthropic({ apiKey }));
    this._client = factory(resolvedKey);
    return this._client;
  }

  /**
   * Incremental distill — reads the new tail since the last distill watermark.
   *
   * NEVER-THROW: LLM/parse failures surface as rejected promises to registration's
   * Phase-1 catch (recordDistillFailure). This method does NOT swallow errors.
   *
   * The dead Layer-1/Layer-T/Layer-P projection post-filters are NOT applied here —
   * they filtered a full projection that no longer exists. The store read-side
   * suppression (MAJOR-1, relay-004) covers the live slice. _getForgottenSuppression
   * removed (3.0b — orphaned). retrieve is kept for the retrieve() path.
   */
  async distill(store: MemoryStore, triggerThreadId: string): Promise<DistillDelta> {
    // Phase 1: read watermark (resilient R2 — column may be absent on pre-v2-03 stores)
    const state = store.readThreadDistillState(triggerThreadId);
    const sinceTurn = state.distilled_through_turn;

    // Phase 2: read new tail since the watermark (tombstone/quarantine-honored).
    // `readNewTailSince` uses `turn_index > sinceTurn` (strict greater-than).
    // `sinceTurn = -1` is the sentinel for "never distilled yet" (schema default).
    // A thread's first message is at turn_index = 0, so turn_index > -1 = all messages.
    // After a real distill the watermark is advanced to maxTurnIndex (≥ 0), so
    // -1 correctly captures only the first-distill case without a special branch.
    const allTail = store.readNewTailSince(triggerThreadId, sinceTurn);

    // Filter: drop REDACTION_MARKER (tombstoned) and quarantined messages
    const tail = allTail.filter(
      (m) =>
        m.content !== REDACTION_MARKER &&
        !store.isMessageQuarantined(m.id),
    );

    // Phase 3: empty tail → short-circuit (no LLM call)
    const distilledThroughMarker = store.readThreadMarker(triggerThreadId);
    const distilledThroughTurn = store.maxTurnIndex(triggerThreadId);

    if (tail.length === 0) {
      return {
        threadId: triggerThreadId,
        ops: [],
        candidateIds: [],
        distilledThroughMarker,
        distilledThroughTurn,
      };
    }

    // Phase 4: build tail text — "[role|id] content" line format, one line per message
    const tailText = tail
      .map((m) => `[${m.role}|${m.id}] ${m.content}`)
      .join("\n");

    // Phase 4b: FTS5/BM25 candidate fetch over FULL corpus (outside any tx)
    const candidates = store.fetchCandidates(tailText);
    const candidateIds = candidates.map((c) => c.id);

    // Phase 5: build numbered candidate pool for the prompt (1..K → {fact, topics})
    const poolLines = candidates.map((c, i) => {
      const topicsStr = c.topics.length > 0 ? ` [${c.topics.join(", ")}]` : "";
      return `${i + 1}. ${c.fact}${topicsStr}`;
    });
    const poolSection =
      poolLines.length > 0
        ? `\nEXISTING FACTS (candidates 1..${candidates.length}):\n${poolLines.join("\n")}`
        : "\nEXISTING FACTS: (none yet)";

    // Phase 6: ONE LLM call (outside any tx — grill #6 seam)
    const client = this.getClient();

    const userContent = `NEW TAIL:\n${tailText}${poolSection}`;

    const response = await client.messages.create({
      model: SMART_MODEL,
      max_tokens: SMART_MAX_TOKENS,
      thinking: { type: "disabled" },
      system: [{ type: "text", text: SMART_DELTA_SYSTEM_PROMPT }],
      messages: [{ role: "user", content: userContent }],
    });

    // Phase 7: output-truncation guard — throw a DISTINCT truncation error
    // so registration can route to trigger="distill-truncated" (not "distill-failed").
    if (response.stop_reason === "max_tokens") {
      throw new SmartDistillError(
        "[smart-distiller] LLM delta output hit the SMART_MAX_TOKENS cap (stop_reason=max_tokens); " +
          "the op array is truncated. Not parsing the partial body.",
        { truncated: true },
      );
    }

    // Extract text from first text block
    let rawText = "";
    for (const block of response.content) {
      if (block.type === "text") {
        rawText = block.text;
        break;
      }
    }

    // Phase 8: defensive parse (throws SmartDistillError on bad JSON/non-array; drops malformed ops)
    const ops = parseOps(rawText);

    // Phase 9: return the delta
    return {
      threadId: triggerThreadId,
      ops,
      candidateIds,
      distilledThroughMarker,
      distilledThroughTurn,
    };
  }

  /**
   * Compose the bounded distilled slice for injection at a new thread's start.
   * Identical contract to DumbTailProvider.retrieve.
   *
   * v2-04: the isForgottenNormalizedText backstop is REMOVED (Ruling 1-b).
   * Under durable-delete, forgotten facts are gone from distilled_facts — the
   * per-dismiss forgotten_facts suppression window no longer exists.
   * Retains: isFactTombstoned (MF-05 T1.2 — mutations tombstone backstop).
   */
  async retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]> {
    // MF-04 (5f): scope-filtered read — thread-local facts of OTHER threads excluded.
    const rows = store.readDistilledFactsForThread(forThreadId, RETRIEVE_SLICE_N);
    // Backstop: isFactTombstoned (MF-05 T1.2 — mutations tombstone)
    const live = rows.filter(
      (f) => !store.isFactTombstoned(f.provenance),
    );
    return Promise.resolve(
      live.map((f) => ({ role: "user" as const, content: `${REMEMBERED_LABEL}${f.fact}` })),
    );
  }
}

// Note: sortedSet / setsEqual / Layer-P (provenance-SET equality filter) were dropped in
// v2-03 — the distill path no longer runs a full projection post-filter.
// _getForgottenSuppression (which built provSets) was removed in 3.0b: the private helper
// was orphaned when the Layer-1/T/P post-filters were dropped from distill(). forget is now
// durable delete (v2-04): forgotten machine facts are deleted from distilled_facts; the AFTER
// DELETE trigger keeps fact_fts/fact_topics in sync. No read-time suppression remains.
