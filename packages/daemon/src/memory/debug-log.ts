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
 * forget:
 *   { stage:"forget", route:"forgetFactById"|"forgetFact", target:{factId?,provenance?,normalizedText?}, deletedIds, deletedCount }
 *
 * Secret discipline:
 *   - Content previews are capped at 80 chars — the user's own memory content
 *     (acceptable under MEMORY_DEBUG, but kept short for greppability).
 *   - The API key and auth token MUST NEVER appear in any payload. callers must
 *     not pass them — and this module provides no pathway to do so.
 */

/**
 * Returns true if MEMORY_DEBUG=1 in the current process environment.
 * A function (not a constant) so tests can toggle the env var between calls.
 */
export const MEMORY_DEBUG = (): boolean => process.env["MEMORY_DEBUG"] === "1";

/**
 * Log one structured greppable line to stderr for the given memory pipeline stage.
 * No-op (zero overhead) when MEMORY_DEBUG() is false.
 *
 * The `payload` is spread into `{stage}` and JSON-serialised.
 * `stage` is prepended explicitly so it always appears at the top of the JSON.
 *
 * Callers pass structured data — content previews, fact previews, ids, counts.
 * NEVER pass the API key, auth token, or any credential.
 */
export function memDebug(
  stage: "distill" | "retrieve" | "forget",
  payload: Record<string, unknown>,
): void {
  if (!MEMORY_DEBUG()) return;
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
