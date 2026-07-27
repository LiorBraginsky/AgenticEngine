/**
 * memory-write — token-gated POST mapping. ADR-0013: Bearer header ONLY, never URL/body.
 * Daemon returns 204 (no JSON body) on success. Fake fetchFn records (url, init); no network.
 * NON-DOM by construction (Response/RequestInit/AbortController only) → root tsconfig coverage.
 */
import { test, expect } from "bun:test";
import { forgetFact, editFact, forgetThread } from "./memory-write.js";
import type { MemoryApiDeps } from "./memory-api.js";

function fakeFetch(status: number, calls: { url: string; init?: RequestInit }[]) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (status === 0) return Promise.reject(new Error("network"));
    // 204 carries NO body (matches the daemon); other statuses carry an error JSON.
    return Promise.resolve(
      status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ error: "x" }), { status }),
    );
  };
}
function deps(fetchFn: MemoryApiDeps["fetchFn"]): MemoryApiDeps {
  return { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK", timeoutMs: 1000 };
}

test("forgetFact 204 → ok", async () => {
  expect((await forgetFact(deps(fakeFetch(204, [])), "F1")).kind).toBe("ok");
});
test("forgetFact status mapping: 401→unauthorized, 400→bad_request", async () => {
  expect((await forgetFact(deps(fakeFetch(401, [])), "F1")).kind).toBe("unauthorized");
  expect((await forgetFact(deps(fakeFetch(400, [])), "F1")).kind).toBe("bad_request");
});
test("network error → unreachable", async () => {
  expect((await forgetFact(deps(fakeFetch(0, [])), "F1")).kind).toBe("unreachable");
});
test("forget POSTs target_type:fact + fact_id; token in Authorization header, never in URL/body", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await forgetFact(deps(fakeFetch(204, calls)), "FACT-UUID");
  const { url, init } = calls[0]!;
  expect(url).toBe("http://127.0.0.1:7777/memory/forget");
  expect(url).not.toContain("TOK");
  expect(init!.method).toBe("POST");
  expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
  expect(init!.body as string).not.toContain("TOK");
  const body = JSON.parse(init!.body as string) as { target_type: string; fact_id: string };
  expect(body.target_type).toBe("fact");
  expect(body.fact_id).toBe("FACT-UUID");
});
test("editFact 204 → ok; sends target_type:fact + fact_id + replacement (Bearer only)", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const r = await editFact(deps(fakeFetch(204, calls)), "F1", "new text");
  expect(r.kind).toBe("ok");
  const body = JSON.parse(calls[0]!.init!.body as string);
  expect(body).toEqual({ target_type: "fact", fact_id: "F1", replacement: "new text", reason: "hatch-fact-edit" });
  expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
});
test("editFact status mapping: 401→unauthorized, 404→stale, 400→bad_request, 500→unreachable, net→unreachable", async () => {
  expect((await editFact(deps(fakeFetch(401, [])), "F1", "x")).kind).toBe("unauthorized");
  expect((await editFact(deps(fakeFetch(404, [])), "F1", "x")).kind).toBe("stale");
  expect((await editFact(deps(fakeFetch(400, [])), "F1", "x")).kind).toBe("bad_request");
  expect((await editFact(deps(fakeFetch(500, [])), "F1", "x")).kind).toBe("unreachable");
  expect((await editFact(deps(fakeFetch(0, [])), "F1", "x")).kind).toBe("unreachable");
});

// thread-forget 2e (§3.3): erase a whole conversation's content.
test("forgetThread 204 → ok; POSTs target_type:thread + thread_id (no reason free-text; Bearer only)", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const r = await forgetThread(deps(fakeFetch(204, calls)), "THREAD-UUID");
  expect(r.kind).toBe("ok");
  const { url, init } = calls[0]!;
  expect(url).toBe("http://127.0.0.1:7777/memory/forget");
  expect(url).not.toContain("TOK");
  expect(init!.method).toBe("POST");
  expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
  expect(init!.body as string).not.toContain("TOK");
  const body = JSON.parse(init!.body as string) as Record<string, unknown>;
  expect(body).toEqual({ target_type: "thread", thread_id: "THREAD-UUID" }); // NIT-5: no `reason` key
});

test("forgetThread status mapping: 409→thread_live, 404→stale, 401→unauthorized, 400→bad_request, net→unreachable", async () => {
  expect((await forgetThread(deps(fakeFetch(409, [])), "T1")).kind).toBe("thread_live"); // §0.5 open convo
  expect((await forgetThread(deps(fakeFetch(404, [])), "T1")).kind).toBe("stale");
  expect((await forgetThread(deps(fakeFetch(401, [])), "T1")).kind).toBe("unauthorized");
  expect((await forgetThread(deps(fakeFetch(400, [])), "T1")).kind).toBe("bad_request");
  expect((await forgetThread(deps(fakeFetch(0, [])), "T1")).kind).toBe("unreachable");
});
