/**
 * memory-write (chunk-03, memory-transparency-ui) — token-gated POST mutations.
 * ADR-0013: token rides Authorization: Bearer ONLY — never logged, never in a URL/query/body-key.
 * The daemon returns 204 No Content on success (NOT JSON), so this deliberately does NOT reuse
 * memory-api's getJson (which parses JSON and would throw on the empty body). Every HTTP status
 * maps to a discriminated WriteResult so the UI renders an honest state — never a fake success.
 *
 * ctx { actor:"user", authored_by:"human" } is FIXED server-side (http-routes.ts HTTP_CTX) — the
 * client sends NO ctx. forget targets a FACT by its stable uuid (target_type:"fact" + fact_id);
 * edit targets a MESSAGE by its id (MUTATION-AS-APPEND human correction — WriteGate.edit). See the
 * plan's "## Reality check" §2 for why message-edit is message-scoped.
 *
 * chunk-05 (FACT-EDIT): `/memory/edit` also accepts a `target_type:"fact"` discriminator (mirrors
 * the forget route's `fact_id` shape) — `editFact` below is that variant (ADR-0012 5a "correct
 * what the agent remembers"). `editMessage` is unchanged.
 */
import type { MemoryApiDeps } from "./memory-api.js";

export type WriteResult =
  | { kind: "ok" }            // 204 No Content — the mutation landed
  | { kind: "unauthorized" }  // 401 — token rejected (locked)
  | { kind: "stale" }         // 404 target_not_found — target gone; a refresh reconciles the view
  | { kind: "bad_request" }   // 400 bad_body / bad_target_shape — client contract bug; never fake success
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

/** Edit a MESSAGE — MUTATION-AS-APPEND human correction (WriteGate.edit; ADR-0012 5e). The daemon
 *  fixes authored_by:"human" server-side; the correction wins in the archive view and cannot be
 *  machine-clobbered. `messageId` is a messages.id (a 404 means the message is gone → stale). */
export function editMessage(deps: MemoryApiDeps, messageId: string, replacement: string): Promise<WriteResult> {
  return post(deps, "/memory/edit", { target: messageId, replacement, reason: "hatch-edit" });
}

/** Edit a FACT's text — "correct what the agent remembers" (ADR-0012 5a). Keys on the fact's
 *  stable uuid (target_type:"fact" + fact_id); the daemon updates the distilled_facts row's text
 *  and stamps authored_by:"human" server-side (5e-protected). A 404 → the fact is gone (stale). */
export function editFact(deps: MemoryApiDeps, factId: string, replacement: string): Promise<WriteResult> {
  return post(deps, "/memory/edit", { target_type: "fact", fact_id: factId, replacement, reason: "hatch-fact-edit" });
}
