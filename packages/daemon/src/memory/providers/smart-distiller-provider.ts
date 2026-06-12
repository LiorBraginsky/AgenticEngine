/**
 * smart-distiller-provider.ts — LLM-backed memory distiller (Haiku).
 *
 * id = "smart". Non-default; selected via MEMORY_PROVIDER=smart + resolvable key.
 *
 * Architecture: implements the chunk-02 MemoryProvider port. `distill` runs in
 * Phase-1 compute seam (outside any tx — the LLM await lives here). Builds a
 * tombstone/quarantine-honored digest, calls Haiku via an injectable clientFactory,
 * parses defensively, and applies three best-effort fact-forget post-filters.
 *
 * NEVER-THROW CONTRACT: any failure surfaces as a rejected promise to chunk-02's
 * Phase-1 catch (→ recordReprojectionFailure). distill() does NOT swallow errors.
 *
 * Best-effort post-filter layers are MITIGATIONS, not guarantees. A generative
 * distiller can rephrase forgotten content in ways the filters cannot detect.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MemoryProvider, DistillResult, DistilledFact } from "../memory-provider.js";
import type { MemoryStore } from "../store.js";
import type { SessionMessage } from "../../providers/provider.js";
import { REDACTION_MARKER } from "../schema.js";
import { REMEMBERED_LABEL } from "../../providers/system-prompt.js";
import { resolveAnthropicKey, type ResolveOpts } from "../../secrets/cloud-secrets.js";

// ── Tunable constants (exported for unit tests) ────────────────────────────

export const SMART_MODEL = "claude-haiku-4-5";
export const SMART_MAX_TOKENS = 1024;
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
- If no facts are extractable, output [].`;

// ── Error type ─────────────────────────────────────────────────────────────

export class SmartDistillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartDistillError";
  }
}

// ── Text normalization (best-effort layer 2 — MITIGATION, not a guarantee) ─
//
// Algorithm: NFKC → lowercase → strip REMEMBERED_LABEL prefix →
//   collapse whitespace runs to one space + trim →
//   strip trailing sentence punctuation (. ! ? ; ,) → strip surrounding quotes.
//
// Conservative exact-after-normalize match. A generative distiller can defeat
// this by rephrasing the fact. Never call this a hard guarantee.

export function normalizeFactText(s: string): string {
  // NFKC normalization (e.g. fi ligature → fi, full-width chars → ASCII)
  let n = s.normalize("NFKC");
  // Lowercase
  n = n.toLowerCase();
  // Strip REMEMBERED_LABEL prefix if present (lower-cased)
  const label = REMEMBERED_LABEL.toLowerCase();
  if (n.startsWith(label)) {
    n = n.slice(label.length);
  }
  // Collapse whitespace runs to a single space and trim
  n = n.replace(/\s+/g, " ").trim();
  // Strip trailing sentence punctuation (. ! ? ; ,) repeatedly
  n = n.replace(/[.!?;,]+$/, "");
  // Strip surrounding quotes (single or double)
  n = n.replace(/^["']+|["']+$/g, "");
  // Final trim
  n = n.trim();
  return n;
}

// ── Digest builder (D8) ────────────────────────────────────────────────────

export interface DigestResult {
  text: string;
  validProvenanceIds: Set<string>;
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
 *
 * Tracks validProvenanceIds: all message ids that made it into the digest.
 */
export function buildDigest(store: MemoryStore): DigestResult {
  const threads = store.listThreads();
  const parts: string[] = [];
  const validProvenanceIds = new Set<string>();
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
      validProvenanceIds.add(m.id);
    }
    parts.push(lines.join("\n"));
  }

  if (parts.length === 0) {
    return { text: "", validProvenanceIds, empty: true };
  }

  return { text: parts.join("\n\n"), validProvenanceIds, empty: false };
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
export function parseFacts(raw: string, validProvenanceIds: Set<string>): DistilledFact[] {
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
  // Note: validProvenanceIds is available here for future layer-0 provenance validation;
  // unresolvable provenances are intentionally kept (layer-2 backstops).
  void validProvenanceIds;
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
 * SmartDistillerProvider — LLM-backed distiller (Haiku).
 *
 * id = "smart". Non-default; register via MEMORY_PROVIDER=smart.
 *
 * distill(store, triggerThreadId):
 *   1. buildDigest → if empty → short-circuit {threadId, facts:[]} (no LLM call)
 *   2. LLM call (Haiku, outside any tx — Phase-1 compute seam)
 *   3. parseFacts → defensive parse
 *   4. Layer-1 post-filter: drop facts whose provenance is isFactTombstoned
 *   5. Layer-2 post-filter: drop facts whose normalized text matches a tombstoned
 *      fact's normalized text (MITIGATION only — exact-after-normalize, not fuzzy)
 *   6. Return {threadId: triggerThreadId, facts}
 *
 * Any failure (LLM/parse) rejects — routes to recordReprojectionFailure in chunk-02.
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
   * Distill the full tombstone-honored archive into a deduplicated fact set.
   *
   * NEVER-THROW: LLM/parse failures surface as rejected promises to chunk-02's
   * Phase-1 catch (recordReprojectionFailure). This method does NOT swallow errors.
   */
  async distill(store: MemoryStore, triggerThreadId: string): Promise<DistillResult> {
    // Phase 1a: build digest (tombstone/quarantine-honored)
    const { text: digest, validProvenanceIds, empty } = buildDigest(store);

    // 5b: empty archive → short-circuit without LLM call
    if (empty) {
      return { threadId: triggerThreadId, facts: [] };
    }

    // Phase 1b: LLM call (outside any SQLite tx — grill #6 seam)
    const client = this.getClient();
    const response = await client.messages.create({
      model: SMART_MODEL,
      max_tokens: SMART_MAX_TOKENS,
      thinking: { type: "disabled" },
      system: [{ type: "text", text: SMART_SYSTEM_PROMPT }],
      messages: [{ role: "user", content: digest }],
    });

    // Extract text from first text block
    let rawText = "";
    for (const block of response.content) {
      if (block.type === "text") {
        rawText = block.text;
        break;
      }
    }

    // Phase 1c: defensive parse (throws SmartDistillError on bad JSON/non-array)
    const parsed = parseFacts(rawText, validProvenanceIds);

    // Phase 1d: best-effort post-filters (MITIGATION — not a guarantee)

    // Layer 1 — provenance match: drop facts whose provenance is tombstoned.
    // Comma-joined provenances: drop if ANY component is tombstoned.
    // (MITIGATION: the LLM can assign a new provenance to re-express the same fact.)
    const afterLayer1 = parsed.filter((f) => {
      const components = f.provenance.split(",").map((p) => p.trim());
      return !components.some((p) => store.isFactTombstoned(p));
    });

    // Layer 2 — normalized-text match: drop facts whose normalized text byte-equals
    // a tombstoned fact's normalized text. We derive tombstoned fact texts from the
    // distilled_facts table filtered by isFactTombstoned provenance.
    // (MITIGATION: exact-after-normalize, not fuzzy/semantic — a rephrased fact defeats this.)
    const tombstonedNorms = this._getTombstonedNormalizedTexts(store);
    const afterLayer2 = afterLayer1.filter((f) => {
      const norm = normalizeFactText(f.fact);
      return !tombstonedNorms.has(norm);
    });

    return { threadId: triggerThreadId, facts: afterLayer2 };
  }

  /**
   * Collect normalized texts of all currently-tombstoned distilled facts.
   * Used by layer-2 post-filter. Returns a Set of normalized strings.
   *
   * This is a best-effort MITIGATION — the set is derived from distilled_facts rows
   * that still exist; if a row was deleted, we have no text to compare against.
   * The load-bearing exclusion mechanism is digest exclusion (D8) — tombstoned-provenance
   * messages never enter the digest in the first place.
   */
  private _getTombstonedNormalizedTexts(store: MemoryStore): Set<string> {
    // Read all distilled facts and filter to those with tombstoned provenances.
    // We use readDistilledFacts with a large limit as a full scan.
    // This is O(projection_size) which is acceptable for the fact count expected.
    const allFacts = store.readDistilledFacts(10_000);
    const result = new Set<string>();
    for (const f of allFacts) {
      // Check each provenance component
      const components = f.provenance.split(",").map((p) => p.trim());
      if (components.some((p) => store.isFactTombstoned(p))) {
        result.add(normalizeFactText(f.fact));
      }
    }
    return result;
  }

  /**
   * Compose the bounded distilled slice for injection at a new thread's start.
   * Identical contract to DumbTailProvider.retrieve and FixedMarkerProvider.retrieve.
   *
   * Defense-in-depth: excludes any fact whose provenance is tombstoned (F1 backstop).
   */
  async retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]> {
    // MF-04 (5f): scope-filtered read — thread-local facts of OTHER threads excluded.
    const rows = store.readDistilledFactsForThread(forThreadId, RETRIEVE_SLICE_N);
    // MF-05 T1.2: isFactTombstoned is a strict superset of isMessageTombstoned.
    const live = rows.filter((f) => !store.isFactTombstoned(f.provenance));
    return Promise.resolve(
      live.map((f) => ({ role: "user" as const, content: `${REMEMBERED_LABEL}${f.fact}` })),
    );
  }
}
