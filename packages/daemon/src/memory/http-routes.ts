/**
 * Memory HTTP route handler — MF-05 T2.1a + T2.1c.
 *
 * Pure function over (req, url, deps): no side effects beyond reading from deps.
 * Wired into index.ts BEFORE the origin gate so loopback browsers can reach it
 * without an allowlisted Origin header (ADR-0013 Option B).
 *
 * T2.1a: read routes — GET /memory/threads + GET /memory/thread/:id, bearer-token gated
 *   (ADR-0013 read-token rider / spec §3.5 Option A end-state; 401 on missing/bad token).
 * T2.1c: write routes — POST /memory/edit + POST /memory/forget, bearer-token gated.
 * GET /history.html is T2.2a: static shell open on loopback (Host-guard only); all data
 *   rendering is gated in-page (token in a JS var, paste-UX).
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

  // GET /memory/threads — token-gated read (ADR-0013 Option A end-state; spec §3.5)
  if (pathname === "/memory/threads" && req.method === "GET") {
    return handleThreads(req, url, deps);
  }

  // GET /memory/thread/:id — token-gated read
  const threadMatch = pathname.match(/^\/memory\/thread\/(.+)$/);
  if (threadMatch && req.method === "GET") {
    return handleThread(req, url, threadMatch[1]!, deps);
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

// ─── Read route helpers (token-gated; ADR-0013 Option A end-state) ───────────

function rejectRead(url: URL): Response {
  // spec §3.8: log path + reason, NEVER the credential value (DoD: no token in logs).
  console.error("[memory-http] read rejected:", { path: url.pathname, reason: "bad-or-missing-token" });
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function handleThreads(req: Request, url: URL, deps: MemoryHttpDeps): Response {
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) return rejectRead(url);
  const threads = deps.store.listThreads();
  return Response.json({ threads });
}

async function handleThread(
  req: Request,
  url: URL,
  rawId: string,
  deps: MemoryHttpDeps,
): Promise<Response> {
  // Decode guard FIRST so a malformed target → 400 regardless of auth (preserves the
  // tokenless %ZZ guard test; the target shape is not a secret).
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // Malformed percent-sequence in thread-id (e.g. "%ZZ") → reject before touching store.
    return Response.json({ error: "bad_target_shape" }, { status: 400 });
  }
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) return rejectRead(url);
  const result = await deps.hatch.view(id);
  return Response.json(result);
}

// ─── Write route helpers ──────────────────────────────────────────────────────

async function handleForget(req: Request, deps: MemoryHttpDeps): Promise<Response> {
  // Token gate (ADR-0013 Option A end-state — writes require bearer token; harmonized to 401)
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse + validate body
  const parsed = await parseBody(req);
  if (!parsed.ok) return Response.json({ error: "bad_body" }, { status: 400 });

  const { target_type, fact_text, provenance, reason } = parsed.data;
  // reason is optional
  const reasonStr = typeof reason === "string" ? reason : undefined;

  // v2-04: fact-forget is the ONLY user forget path (D-V6a-bis).
  // target_type:"message" user route REMOVED — returns 400 bad_body.
  // also_forget_sources (option B) REMOVED — plain forgetFact always called.
  try {
    if (target_type === "fact") {
      // FACT path — durable delete of the stable-id row, never scrubs (B1 structural invariant)
      if (typeof fact_text !== "string" || !fact_text) {
        return Response.json({ error: "bad_body" }, { status: 400 });
      }
      if (typeof provenance !== "string" || !provenance) {
        return Response.json({ error: "bad_body" }, { status: 400 });
      }
      deps.hatch.forgetFact(fact_text, provenance, HTTP_CTX, reasonStr);
      return new Response(null, { status: 204 });
    } else {
      // target_type:"message", missing, or any unrecognised value → 400 bad_body
      return Response.json({ error: "bad_body" }, { status: 400 });
    }
  } catch (err: unknown) {
    return mapWriteError(err);
  }
}

async function handleEdit(req: Request, deps: MemoryHttpDeps): Promise<Response> {
  // Token gate (ADR-0013 Option A end-state — writes require bearer token; harmonized to 401)
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
 * Map thrown errors from Hatch write operations to HTTP responses.
 *
 * Real error conditions:
 *   1. "not found" throw from WriteGate.threadOf → 404 target_not_found
 *      (forgetMessage path, when target message UUID is not in messages table)
 *   2. UUID-shape seam invariant throw from store.tombstoneFact → 400 bad_target_shape
 *      (defensive — normally unreachable via intent-dispatch: the fact path never calls
 *      tombstoneFact; the message path routes through WriteGate.forget which calls threadOf)
 *   3. Everything else → log + 500 internal
 *
 * NOTE: these regexes are coupled to the exact throw messages in write-gate.ts / store.ts:
 *   "not found"                           — thrown by WriteGate.threadOf
 *   "use forget() to tombstone+scrub..."  — thrown by store.tombstoneFact UUID-guard
 * If more throw sites are added, typed error codes (a discriminated Error subclass or
 * an error-code enum) are the upgrade path — avoid multiplying regex fragments.
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
