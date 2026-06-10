/**
 * Memory HTTP route handler — MF-05 T2.1a + T2.1c.
 *
 * Pure function over (req, url, deps): no side effects beyond reading from deps.
 * Wired into index.ts BEFORE the origin gate so loopback browsers can reach it
 * without an allowlisted Origin header (ADR-0013 Option B).
 *
 * T2.1a: read routes (open on loopback, no auth).
 * T2.1c: write routes — POST /memory/edit + POST /memory/forget, bearer-token gated.
 * GET /history.html is T2.2a (not built yet).
 *
 * ctx is FIXED server-side for all write routes: { actor: "user", authored_by: "human" }.
 * Every HTTP-originated mutation is treated as a human operator action (the point of the
 * token gate). This means the 5e machine-clobber guard in WriteGate will NEVER fire on
 * the HTTP path.
 *
 * 409 (refused) is reserved-but-unreachable on this human-only path. The 5e guard only
 * refuses machine ctx, which we never send from HTTP. A 409 path goes live the moment a
 * non-human HTTP actor is introduced (a later ADR); Hatch.edit/forget signatures will need
 * to surface the boolean refusal at that point. Per plan §217-244 BINDING decision.
 */

import type { Hatch } from "./hatch.js";
import type { MemoryStore } from "./store.js";
import type { TokenStore } from "./token-store.js";
import type { WriteContext } from "./write-gate.js";
import { HISTORY_HTML } from "./history-page.js";

export interface MemoryHttpDeps {
  hatch: Hatch;
  store: MemoryStore;
  /** Added by T2.1b. Used by T2.1c write routes for bearer-token gating. */
  tokenStore: TokenStore;
}

/**
 * The fixed server-side WriteContext for all HTTP-originated mutations.
 * The HTTP caller IS the human operator at the hatch (enforced by the bearer token
 * whose file is 0o600 owner-only on disk). Machine ctx is NEVER used on this path.
 */
const HTTP_CTX: WriteContext = { actor: "user", authored_by: "human" };

/**
 * Handle a request whose pathname starts with `/memory/` or equals `/history.html`.
 *
 * Returns a Response for every matched route.
 * Returns a 404 for any unrecognised path within this family so the caller
 * never falls through to the WS upgrade path.
 */
export async function handleMemoryHttp(
  req: Request,
  url: URL,
  deps: MemoryHttpDeps,
): Promise<Response> {
  const { pathname } = url;

  // GET /memory/threads
  if (pathname === "/memory/threads" && req.method === "GET") {
    const threads = deps.store.listThreads();
    return Response.json({ threads });
  }

  // GET /memory/thread/:id
  const threadMatch = pathname.match(/^\/memory\/thread\/(.+)$/);
  if (threadMatch && req.method === "GET") {
    const id = decodeURIComponent(threadMatch[1]!);
    const result = await deps.hatch.view(id);
    return Response.json(result);
  }

  // POST /memory/forget — token-gated (ADR-0013 Option B)
  if (pathname === "/memory/forget" && req.method === "POST") {
    return handleForget(req, deps);
  }

  // POST /memory/edit — token-gated (ADR-0013 Option B)
  if (pathname === "/memory/edit" && req.method === "POST") {
    return handleEdit(req, deps);
  }

  // GET /history.html — T2.2a (minimal static History page)
  if (pathname === "/history.html" && req.method === "GET") {
    return new Response(HISTORY_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // All other /memory/* paths fall through to 404.
  return new Response("Not Found", { status: 404 });
}

// ─── Write route helpers ──────────────────────────────────────────────────────

async function handleForget(req: Request, deps: MemoryHttpDeps): Promise<Response> {
  // Token gate (ADR-0013 Option B — writes require bearer token)
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Parse + validate body
  const parsed = await parseBody(req);
  if (!parsed.ok) return Response.json({ error: "bad_body" }, { status: 400 });

  const { target, reason } = parsed.data;
  if (typeof target !== "string" || !target) {
    return Response.json({ error: "bad_body" }, { status: 400 });
  }
  // reason is optional
  const reasonStr = typeof reason === "string" ? reason : undefined;

  // Execute forget — ctx fixed as human (5e refusal cannot fire; 409 unreachable here)
  try {
    deps.hatch.forget(target, HTTP_CTX, reasonStr);
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    return mapWriteError(err);
  }
}

async function handleEdit(req: Request, deps: MemoryHttpDeps): Promise<Response> {
  // Token gate (ADR-0013 Option B — writes require bearer token)
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Parse + validate body
  const parsed = await parseBody(req);
  if (!parsed.ok) return Response.json({ error: "bad_body" }, { status: 400 });

  const { target, replacement, reason } = parsed.data;
  if (typeof target !== "string" || !target) {
    return Response.json({ error: "bad_body" }, { status: 400 });
  }
  if (typeof replacement !== "string") {
    return Response.json({ error: "bad_body" }, { status: 400 });
  }
  const reasonStr = typeof reason === "string" ? reason : undefined;

  // Execute edit — ctx fixed as human (5e refusal cannot fire; 409 unreachable here)
  try {
    deps.hatch.edit(target, replacement, HTTP_CTX, reasonStr);
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    return mapWriteError(err);
  }
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

type ParseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false };

async function parseBody(req: Request): Promise<ParseResult> {
  try {
    const json = await req.json();
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return { ok: false };
    }
    return { ok: true, data: json as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

/**
 * Map thrown errors from Hatch.edit / Hatch.forget to HTTP responses.
 *
 * Two real error conditions (plan §Refused-forget HTTP semantics, BINDING):
 *   1. "not found" throw from WriteGate.threadOf → 404 target_not_found
 *   2. UUID-shape seam invariant throw from WriteGate.forgetFact → 400 bad_target_shape
 *      (normally unreachable via Hatch.forget routing — defensive mapping)
 *   3. Everything else → log + 500 internal
 */
function mapWriteError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) {
    return Response.json({ error: "target_not_found" }, { status: 404 });
  }
  if (/use forget\(\) to tombstone\+scrub a message/i.test(msg)) {
    return Response.json({ error: "bad_target_shape" }, { status: 400 });
  }
  console.error("[memory-http] internal error:", err);
  return Response.json({ error: "internal" }, { status: 500 });
}
