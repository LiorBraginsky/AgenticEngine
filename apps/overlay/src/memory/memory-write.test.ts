/**
 * memory-write — token-gated POST mapping. ADR-0013: Bearer header ONLY, never URL/body.
 * Daemon returns 204 (no JSON body) on success. Fake fetchFn records (url, init); no network.
 * NON-DOM by construction (Response/RequestInit/AbortController only) → root tsconfig coverage.
 */
import { test, expect } from "bun:test";
import { forgetFact, editMessage } from "./memory-write.js";
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
test("status mapping: 401→unauthorized, 404→stale, 400→bad_request, 500→unreachable", async () => {
  expect((await forgetFact(deps(fakeFetch(401, [])), "F1")).kind).toBe("unauthorized");
  expect((await editMessage(deps(fakeFetch(404, [])), "M1", "x")).kind).toBe("stale");
  expect((await forgetFact(deps(fakeFetch(400, [])), "F1")).kind).toBe("bad_request");
  expect((await editMessage(deps(fakeFetch(500, [])), "M1", "x")).kind).toBe("unreachable");
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
test("edit POSTs target(messageId) + replacement", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await editMessage(deps(fakeFetch(204, calls)), "MSG-ID", "new text");
  const body = JSON.parse(calls[0]!.init!.body as string) as { target: string; replacement: string };
  expect(calls[0]!.url).toBe("http://127.0.0.1:7777/memory/edit");
  expect(body.target).toBe("MSG-ID");
  expect(body.replacement).toBe("new text");
});
