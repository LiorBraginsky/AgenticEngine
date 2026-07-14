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
 * chunk-05 FACT-EDIT: POST /memory/edit gained an additive `target_type:"fact"` branch
 *   (mirrors the forget route's uuid `fact_id` discriminator) — updates a distilled_facts
 *   row's TEXT and stamps authored_by:"human" (ADR-0012 5a).
 * hybrid-retrieval chunk-01 (spec §3.7 R1, ADR-0012 rider Ruling 1 removal-note): the
 *   message-edit branch (target_type absent or "message") is REMOVED — a message-shaped body
 *   now returns 400 bad_body (same posture as the forget route's removed message branch).
 *   `target_type:"fact"` is the ONLY accepted shape; the underlying `WriteGate.edit` /
 *   `mutations` kind `'correction'` / `readThreadArchive` COALESCE machinery is UNCHANGED
 *   (ADR-0015 B1) — only this HTTP entry point + the Hatch.edit façade (retired, dead code)
 *   are gone.
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
 * non-human HTTP actor is introduced (a later ADR); Hatch.editFact/forgetFactById signatures
 * will need to surface the boolean refusal at that point. Per plan §217-244 BINDING decision.
 *
 * CORS seam (chunk-01, memory-transparency-ui): the exported `handleMemoryHttp` now wraps
 * `route()` (the original dispatch body, unchanged) with a narrow CORS layer so the overlay
 * webview (a cross-origin caller — ADR-0005 engine-owned native surface) can read the
 * token-gated JSON. The allowed-origin reflection is keyed off the existing `origin.ts`
 * allowlist — never `*` — and is purely additive response headers; the bearer-token gate
 * (ADR-0013 rider) is completely unchanged.
 */

import type { Hatch } from "./hatch.js";
import type { MemoryStore } from "./store.js";
import type { TokenStore } from "./token-store.js";
import type { WriteContext } from "./write-gate.js";
import { HISTORY_HTML } from "./history-page.js";
import { isOriginAllowed } from "../origin.js";

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

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_ALLOW_HEADERS = "authorization, content-type";

/** Reflect the request Origin iff it is the overlay's (origin.ts allowlist); never `*`. */
function corsHeaders(origin: string | null): Record<string, string> {
  return isOriginAllowed(origin)
    ? { "access-control-allow-origin": origin as string, vary: "Origin" }
    : {};
}

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
  const origin = req.headers.get("origin");

  // CORS preflight. The token is NEVER checked here — a preflight carries no credentials
  // (browsers send OPTIONS before any Authorization-bearing cross-origin fetch); auth is
  // enforced on the actual GET/POST in route(). We reflect only the allowlisted overlay
  // origin (origin.ts). ADR-0013 rider: this widens read-*visibility* to the overlay
  // browser only; the bearer-token gate is unchanged, and non-browser clients ignore CORS.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "access-control-allow-methods": CORS_METHODS,
        "access-control-allow-headers": CORS_ALLOW_HEADERS,
        "access-control-max-age": "600",
      },
    });
  }

  const res = await route(req, url, deps);
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

async function route(
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

  const { target_type, reason, fact_id } = parsed.data;
  // reason is optional
  const reasonStr = typeof reason === "string" ? reason : undefined;

  // v2-04: fact-forget is the ONLY user forget path (D-V6a-bis).
  // target_type:"message" user route REMOVED — returns 400 bad_body.
  // also_forget_sources (option B) REMOVED — forgetFactById is always called.
  //
  // v2-07: target_type:fact REQUIRES a valid uuid-shaped fact_id (the precise
  // durable-delete intent). The text/provenance forgetFact path is NO LONGER
  // HTTP-reachable (it over-deletes all facts sharing a thread provenance —
  // store.ts deleteMachineFactsByForget). history.html always sends fact_id.
  // The WriteGate.forgetFact primitive survives for its unit tests but has no
  // caller route.
  try {
    if (target_type === "fact") {
      // FACT path — durable delete of the stable-id row, never scrubs (B1 structural invariant)
      // v2-07: fact_id REQUIRED and must be uuid-shaped; any other shape → 400 bad_body.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof fact_id === "string" && fact_id && UUID_RE.test(fact_id)) {
        // Precise durable-delete: exactly the targeted stable-id row (never over-deletes)
        deps.hatch.forgetFactById(fact_id, HTTP_CTX, reasonStr);
        return new Response(null, { status: 204 });
      }
      // fact_id absent or not uuid-shaped → 400 bad_body
      // (The text/provenance forgetFact fallback is removed — it was the over-delete root.)
      return Response.json({ error: "bad_body" }, { status: 400 });
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

  const { target_type, replacement, reason, fact_id } = parsed.data;
  const reasonStr = typeof reason === "string" ? reason : undefined;

  // chunk-05 FACT-EDIT: target_type:"fact" edits a distilled_facts row's TEXT + stamps
  // authored_by='human' (ADR-0012 5a). Mirrors the forget route's uuid fact_id discriminator.
  // Security-adjacent: sits INSIDE the token gate above, reuses HTTP_CTX (fixed human).
  //
  // hybrid-retrieval chunk-01 (spec §3.7 R1, ADR-0012 rider Ruling 1 removal-note): the
  // MESSAGE-edit branch (target_type absent or "message") is REMOVED. Archive is read-only
  // immutable history; facts are the ONLY editable surface. Same posture as the forget route's
  // removed message branch (:216-217 above) — target_type:"fact" is the ONLY accepted shape.
  if (target_type === "fact") {
    if (typeof replacement !== "string" || replacement === "") {
      return Response.json({ error: "bad_body" }, { status: 400 });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof fact_id !== "string" || !fact_id || !UUID_RE.test(fact_id)) {
      return Response.json({ error: "bad_body" }, { status: 400 });
    }
    try {
      const applied = deps.hatch.editFact(fact_id, replacement, HTTP_CTX, reasonStr);
      return applied
        ? new Response(null, { status: 204 })
        : Response.json({ error: "target_not_found" }, { status: 404 });
    } catch (err: unknown) {
      return mapWriteError(err);
    }
  }

  // target_type:"message", missing, or any unrecognised value → 400 bad_body
  return Response.json({ error: "bad_body" }, { status: 400 });
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
 * Error conditions:
 *   1. "not found" throw from WriteGate.threadOf → 404 target_not_found. hybrid-retrieval
 *      chunk-01 (spec §3.7 R1): the message-edit HTTP branch (the one production path that
 *      could reach this via threadOf) is REMOVED; `hatch.editFact`/`hatch.forgetFactById`
 *      (the surviving callers below) never throw it — kept as defense-in-depth, not
 *      currently reachable from either write route.
 *   2. UUID-shape seam invariant throw from store.tombstoneFact → 400 bad_target_shape
 *      (defensive — normally unreachable via intent-dispatch: the fact path never calls
 *      tombstoneFact; kept as defense-in-depth for the same reason as (1)).
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
