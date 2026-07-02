/**
 * memory-api — token-gated fetch mapping. ADR-0013: Bearer header ONLY, never in URL.
 * Fake fetchFn records the (url, init) it was called with; no real network.
 */
import { test, expect } from "bun:test";
import { fetchThreads, fetchThread, type MemoryApiDeps } from "./memory-api.js";

function fakeFetch(status: number, body: unknown, calls: { url: string; init?: RequestInit }[]) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (status === 0) return Promise.reject(new Error("network"));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}
function deps(fetchFn: MemoryApiDeps["fetchFn"]): MemoryApiDeps {
  return { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK", timeoutMs: 1000 };
}

test("fetchThreads 200 → ok with parsed data", async () => {
  const r = await fetchThreads(deps(fakeFetch(200, { threads: [{ thread_id: "a", title: null, last_active_at: 1 }] }, [])));
  expect(r.kind).toBe("ok");
  if (r.kind === "ok") expect(r.data.threads[0]!.thread_id).toBe("a");
});
test("fetchThreads 401 → unauthorized", async () => {
  expect((await fetchThreads(deps(fakeFetch(401, { error: "Unauthorized" }, [])))).kind).toBe("unauthorized");
});
test("fetchThreads 500 → unreachable", async () => {
  expect((await fetchThreads(deps(fakeFetch(500, {}, [])))).kind).toBe("unreachable");
});
test("fetchThreads network error → unreachable", async () => {
  expect((await fetchThreads(deps(fakeFetch(0, {}, [])))).kind).toBe("unreachable");
});
test("token rides Authorization header and is NEVER in the URL (ADR-0013)", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await fetchThreads(deps(fakeFetch(200, { threads: [] }, calls)));
  expect(calls[0]!.url).not.toContain("TOK");
  expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
});
test("fetchThread encodes the id into the path, not a query", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await fetchThread(deps(fakeFetch(200, { messages: [], distilledFacts: [], distillationEvents: [] }, calls)), "a b/c");
  expect(calls[0]!.url).toBe("http://127.0.0.1:7777/memory/thread/a%20b%2Fc");
  expect(calls[0]!.url).not.toContain("TOK");
});
