/**
 * memory-write (chunk-03, memory-transparency-ui) — token-gated POST mutations.
 * ADR-0013: token rides Authorization: Bearer ONLY — never logged, never in a URL/query/body-key.
 * The daemon returns 204 No Content on success (NOT JSON), so this deliberately does NOT reuse
 * memory-api's getJson (which parses JSON and would throw on the empty body). Every HTTP status
 * maps to a discriminated WriteResult so the UI renders an honest state — never a fake success.
 *
 * ctx { actor:"user", authored_by:"human" } is FIXED server-side (http-routes.ts HTTP_CTX) — the
 * client sends NO ctx. forget targets a FACT by its stable uuid (target_type:"fact" + fact_id).
 *
 * chunk-05 (FACT-EDIT): `/memory/edit` accepts a `target_type:"fact"` discriminator (mirrors
 * the forget route's `fact_id` shape) — `editFact` below is that variant (ADR-0012 5a "correct
 * what the agent remembers"). `editMessage` (the MESSAGE-scoped variant) is REMOVED
 * (hybrid-retrieval chunk-01, spec §3.7 R1, ADR-0012 rider Ruling 1): archive = read-only
 * immutable history, memory (facts) = the ONLY editable surface. The daemon route now returns
 * 400 `bad_body` for a message-shaped body (no `target_type:"fact"`).
 */
import type { MemoryApiDeps } from "./memory-api.js";

export type WriteResult =
  | { kind: "ok" }            // 204 No Content — the mutation landed
  | { kind: "unauthorized" }  // 401 — token rejected (locked)
  | { kind: "stale" }         // 404 target_not_found — target gone; a refresh reconciles the view
  | { kind: "bad_request" }   // 400 bad_body / bad_target_shape — client contract bug; never fake success
  | { kind: "thread_live" }   // 409 thread_live — thread-forget 2e §0.5: the conversation is open
  | { kind: "unreachable" };  // 5xx / network error / timeout — daemon down

async function post(deps: MemoryApiDeps, path: string, body: unknown): Promise<WriteResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 4000);
  try {
    const res = await deps.fetchFn(`${deps.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.token}`, // ADR-0013 — header only
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 204) return { kind: "ok" };
    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 404) return { kind: "stale" };
    if (res.status === 400) return { kind: "bad_request" };
    if (res.status === 409) return { kind: "thread_live" }; // thread-forget 2e §0.5 (fact ops never 409)
    return { kind: "unreachable" }; // 5xx or any other unexpected status
  } catch {
    return { kind: "unreachable" }; // network failure / abort
  } finally {
    clearTimeout(timer);
  }
}

/** Forget a distilled fact — durable "release the reference" (ADR-0015). Keys on the fact's
 *  stable uuid; the daemon deletes exactly that row and never scrubs the source messages. */
export function forgetFact(deps: MemoryApiDeps, factId: string): Promise<WriteResult> {
  return post(deps, "/memory/forget", { target_type: "fact", fact_id: factId, reason: "hatch-forget" });
}

/** Edit a FACT's text — "correct what the agent remembers" (ADR-0012 5a). Keys on the fact's
 *  stable uuid (target_type:"fact" + fact_id); the daemon updates the distilled_facts row's text
 *  and stamps authored_by:"human" server-side (5e-protected). A 404 → the fact is gone (stale). */
export function editFact(deps: MemoryApiDeps, factId: string, replacement: string): Promise<WriteResult> {
  return post(deps, "/memory/edit", { target_type: "fact", fact_id: factId, replacement, reason: "hatch-fact-edit" });
}

/** Forget a whole conversation's CONTENT (thread-forget 2e, spec §3.3). Scrubs every message
 *  (content + vectors + FTS + mirror) but — per ADR-0012 rider Ruling 2 — leaves every distilled
 *  fact untouched. Keys on the thread's uuid (target_type:"thread" + thread_id). The daemon returns
 *  204 (applied AND idempotent re-erase), 409 thread_live (§0.5 — the conversation is open), or
 *  404 (unknown thread). NO `reason` sent: the route intentionally drops body free-text (NIT-5). */
export function forgetThread(deps: MemoryApiDeps, threadId: string): Promise<WriteResult> {
  return post(deps, "/memory/forget", { target_type: "thread", thread_id: threadId });
}
