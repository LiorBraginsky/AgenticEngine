/**
 * Memory HTTP route handler — MF-05 T2.1a.
 *
 * Pure function over (req, url, deps): no side effects beyond reading from deps.
 * Wired into index.ts BEFORE the origin gate so loopback browsers can reach it
 * without an allowlisted Origin header (ADR-0013 Option B).
 *
 * T2.1a: read routes only (open on loopback, no auth).
 * POST /memory/edit and POST /memory/forget are T2.1c.
 * GET /history.html is T2.2a.
 */

import type { Hatch } from "./hatch.js";
import type { MemoryStore } from "./store.js";

export interface MemoryHttpDeps {
  hatch: Hatch;
  store: MemoryStore;
  // tokenStore field added by T2.1b — not present yet
}

/**
 * Handle a request whose pathname starts with `/memory/` or equals `/history.html`.
 *
 * Returns a Response for every matched route.
 * Returns a 404 for any unrecognised path within this family so the caller
 * never falls through to the WS upgrade path.
 */
export async function handleMemoryHttp(
  _req: Request,
  url: URL,
  deps: MemoryHttpDeps,
): Promise<Response> {
  const { pathname } = url;

  // GET /memory/threads
  if (pathname === "/memory/threads" && _req.method === "GET") {
    const threads = deps.store.listThreads();
    return Response.json({ threads });
  }

  // GET /memory/thread/:id
  const threadMatch = pathname.match(/^\/memory\/thread\/(.+)$/);
  if (threadMatch && _req.method === "GET") {
    const id = decodeURIComponent(threadMatch[1]!);
    const result = await deps.hatch.view(id);
    return Response.json(result);
  }

  // /history.html — T2.2a (not built yet)
  // All other /memory/* paths or /history.html fall through to 404.
  return new Response("Not Found", { status: 404 });
}
