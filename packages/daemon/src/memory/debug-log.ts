/**
 * debug-log.ts — MEMORY_DEBUG env-gated pipeline diagnostic log.
 *
 * MEMORY_DEBUG is a dev diagnostic — OFF by default, committed but NOT a prod default.
 * Never log the API key or auth token.
 *
 * When MEMORY_DEBUG=1:
 *   - memDebug writes ONE structured greppable line to stderr per call.
 *   - Format: `[memory-debug] <stage> <JSON-payload>`
 *   - Stderr so it never pollutes the agent reply stream.
 *
 * Payload shapes (frozen here — the three pipeline stages):
 *
 * distill (input):
 *   { stage:"distill", threadId, sinceTurn, tail:[{id,role,len,preview}], candidates:[{ordinal,id,factPreview}] }
 *
 * distill (output delta — logged by distillOneThread after provider.distill returns):
 *   { stage:"distill", threadId, ops:[{op,targetOrdinal?,why?,factPreview,canonicalPreview}], candidateIds }
 *
 * retrieve/injection:
 *   { stage:"retrieve", forThreadId, injected:[{id?,factPreview,order}] }
 *
 * inject (per-turn context handed to the agent — the ACTUAL prior messages the
 * LLM sees, AFTER beginTurn picked the new-thread retrieve() vs known-thread
 * readThreadTail() branch). Distinguishes "fact retrieved" from "fact present in
 * THIS turn's context": a known-thread turn shows the conversation tail with NO
 * [remembered] entries — the structural reason a turn-2+ recall can miss.
 *   { stage:"inject", threadId, turnType, userText, priorContext:[{role,preview}] }
 *
 * forget:
 *   { stage:"forget", route:"forgetFactById"|"forgetFact", target:{factId?,provenance?,normalizedText?}, deletedIds, deletedCount }
 *
 * action (chunk 2c-03, spec §3.9 — the memory-action tool glass-box, emitted once
 * per dispatchTool result inside the bounded loop, applied AND refused alike):
 *   { stage:"action", threadId, tool:"memory_forget"|"memory_remember", outcome:"applied"|`refused-<code>`, factId?, factPreview }
 *
 * search (chunk hybrid-05, spec §3.6 D6b — the read-tool glass-box; read has NO audit event,
 * so this debug line is its only observability, emitted once per memory_search dispatch):
 *   { stage:"search", threadId, scope:"facts"|"archive"|"all", query, resultCount, withheldCount }
 *
 * Secret discipline:
 *   - Content previews are capped at 80 chars — the user's own memory content
 *     (acceptable under MEMORY_DEBUG, but kept short for greppability).
 *   - The API key and auth token MUST NEVER appear in any payload. callers must
 *     not pass them — and this module provides no pathway to do so.
 *
 * Channel gate (chunk 2c-03, backward-compatible comma-channel selector —
 * Orchestrator decision, FLAG 4 resolved): `MEMORY_DEBUG` is read as follows:
 *   - unset / empty        -> ALL channels OFF (zero-cost default).
 *   - "1"                  -> ALL channels ON (backward-compat; every prior
 *                             debug-log test stays green).
 *   - "action,distill,…"   -> ONLY the listed stages (comma-separated,
 *                             trimmed) are ON; everything else is OFF.
 * This makes spec §5's demo-env line (`MEMORY_DEBUG=action,distill,retrieve,forget`)
 * literally correct without breaking the pre-existing boolean "=1" convention.
 */

/**
 * Returns true if MEMORY_DEBUG=1 in the current process environment.
 * A function (not a constant) so tests can toggle the env var between calls.
 * NOTE: this checks the legacy all-on literal only — per-stage gating (incl.
 * the comma-channel selector) lives in `stageEnabled` below, consulted by
 * `memDebug` directly.
 */
export const MEMORY_DEBUG = (): boolean => process.env["MEMORY_DEBUG"] === "1";

/**
 * Backward-compatible comma-channel gate: is `stage` enabled by the current
 * `MEMORY_DEBUG` env value? unset/empty -> false; "1" -> true for every stage;
 * otherwise -> true iff the comma-split, trimmed list includes `stage`.
 */
function stageEnabled(stage: string): boolean {
  const raw = process.env["MEMORY_DEBUG"];
  if (raw === undefined || raw === "") return false;
  if (raw === "1") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .includes(stage);
}

/**
 * Log one structured greppable line to stderr for the given memory pipeline stage.
 * No-op (zero overhead) when the stage's channel is off (see `stageEnabled`).
 *
 * The `payload` is spread into `{stage}` and JSON-serialised.
 * `stage` is prepended explicitly so it always appears at the top of the JSON.
 *
 * Callers pass structured data — content previews, fact previews, ids, counts.
 * NEVER pass the API key, auth token, or any credential.
 */
export function memDebug(
  stage: "distill" | "retrieve" | "forget" | "inject" | "action" | "search",
  payload: Record<string, unknown>,
): void {
  if (!stageEnabled(stage)) return;
  // Merge stage into the payload so the JSON line is self-describing.
  const line = JSON.stringify({ stage, ...payload });
  console.error(`[memory-debug] ${stage} ${line}`);
}

/**
 * Truncate a string to at most `maxLen` characters for safe preview logging.
 * Exported so callers can use the same cap consistently.
 */
export function previewStr(s: string, maxLen = 80): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}
