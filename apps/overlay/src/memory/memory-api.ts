/**
 * memory-api (chunk-02, memory-transparency-ui) — pure token-gated fetch mapping.
 * ADR-0013: token in the Authorization: Bearer header ONLY — never logged, never in a
 * URL/query. Every path maps to a discriminated FetchResult so the UI renders an honest
 * state (never a stuck "Loading…"). fetchFn is injected → unit-testable without network.
 */
import type { HatchView, ThreadSummary } from "./types.js";

export type FetchResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthorized" }
  | { kind: "unreachable" };

export interface MemoryApiDeps {
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

async function getJson<T>(deps: MemoryApiDeps, path: string): Promise<FetchResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 4000);
  try {
    const res = await deps.fetchFn(`${deps.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${deps.token}` }, // ADR-0013 — header only
      signal: ctrl.signal,
    });
    if (res.status === 401) return { kind: "unauthorized" };
    if (!res.ok) return { kind: "unreachable" };
    return { kind: "ok", data: (await res.json()) as T };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export function fetchThreads(deps: MemoryApiDeps): Promise<FetchResult<{ threads: ThreadSummary[] }>> {
  return getJson(deps, "/memory/threads");
}
export function fetchThread(deps: MemoryApiDeps, threadId: string): Promise<FetchResult<HatchView>> {
  return getJson(deps, `/memory/thread/${encodeURIComponent(threadId)}`);
}
