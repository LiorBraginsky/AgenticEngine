/**
 * Memory HTTP CORS seam — chunk-01 (memory-transparency-ui).
 * Real store/hatch/tokenStore (no mocks); handleMemoryHttp called directly with a
 * constructed Request so the Origin header is deterministic. ADR-0013 rider: CORS
 * reflects ONLY the overlay origin (origin.ts allowlist), never `*`; token gate unchanged.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { handleMemoryHttp, type MemoryHttpDeps } from "./http-routes.js";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { Hatch } from "./hatch.js";
import { TokenStore } from "./token-store.js";

function buildDeps(): { deps: MemoryHttpDeps; token: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "cors-"));
  const store = new MemoryStore({ dataDir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hatch = new Hatch(store, gate);
  const tokenStore = new TokenStore(dataDir);
  return { deps: { hatch, store, tokenStore }, token: tokenStore.token() };
}

const OVERLAY_ORIGIN = "tauri://localhost";

test("CORS preflight: OPTIONS from overlay origin → 204 + reflected ACAO + methods/headers", async () => {
  const { deps } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    method: "OPTIONS",
    headers: { origin: OVERLAY_ORIGIN, "access-control-request-headers": "authorization" },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe(OVERLAY_ORIGIN);
  expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
});

test("CORS preflight: disallowed origin → NO ACAO (browser blocks)", async () => {
  const { deps } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    method: "OPTIONS",
    headers: { origin: "http://evil.example" },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

test("CORS: GET with valid Bearer + overlay origin → 200 + reflected ACAO + Vary", async () => {
  const { deps, token } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    headers: { origin: OVERLAY_ORIGIN, authorization: `Bearer ${token}` },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe(OVERLAY_ORIGIN);
  expect(res.headers.get("vary")).toBe("Origin");
});

test("CORS never weakens the token gate: overlay origin, NO token → 401 (still ACAO so browser reads the error)", async () => {
  const { deps } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    headers: { origin: OVERLAY_ORIGIN },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(401);
  expect(res.headers.get("access-control-allow-origin")).toBe(OVERLAY_ORIGIN);
});
