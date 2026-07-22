/**
 * thread-forget (2e) chunk-02 Task 2 — HTTP taxonomy + the §0.5 isThreadLive live-guard.
 *
 * Two groups:
 *   1. Direct-deps taxonomy (real store/hatch/tokenStore; `isThreadLive` faked per-case) —
 *      covers 400/404/409/204/idempotent + unchanged message/garbage 400s.
 *   2. Live-guard both-sides + decrement, driven through a REAL daemon (startDaemon) with an
 *      injected minimal single-turn AgentProvider stub (deterministic, no LLM/network).
 *
 * Follows the http-routes.daemon.test.ts real-I/O idiom — no mocked store internals.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { handleMemoryHttp, type MemoryHttpDeps } from "./http-routes.js";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { Hatch } from "./hatch.js";
import { TokenStore } from "./token-store.js";
import type { AgentProvider } from "../providers/provider.js";

// ─── Group 1: direct-deps taxonomy ────────────────────────────────────────────

function buildDepsWithSeededThread(opts: {
  isThreadLive: (threadId: string) => boolean;
}): { deps: MemoryHttpDeps; token: string; threadId: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "thread-forget-http-"));
  const store = new MemoryStore({ dataDir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hatch = new Hatch(store, gate);
  const tokenStore = new TokenStore(dataDir);
  const threadId = store.createThread("seeded thread");
  store.appendMessages(threadId, [{ role: "user", content: "seeded content" }], "seed-session");
  return {
    deps: { hatch, store, tokenStore, isThreadLive: opts.isThreadLive },
    token: tokenStore.token(),
    threadId,
  };
}

function forgetReq(token: string, body: unknown): Request {
  return new Request("http://127.0.0.1:7777/memory/forget", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("POST /memory/forget target_type:thread on a LIVE thread → 409 {error:'thread_live'}", async () => {
  const { deps, token, threadId } = buildDepsWithSeededThread({ isThreadLive: () => true });
  const req = forgetReq(token, { target_type: "thread", thread_id: threadId });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(409);
  expect((await res.json() as { error: string }).error).toBe("thread_live");
});

test("POST /memory/forget target_type:thread with a non-UUID thread_id → 400 bad_body", async () => {
  const { deps, token } = buildDepsWithSeededThread({ isThreadLive: () => false });
  const req = forgetReq(token, { target_type: "thread", thread_id: "not-a-uuid" });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("bad_body");
});

test("POST /memory/forget target_type:thread with missing thread_id → 400 bad_body", async () => {
  const { deps, token } = buildDepsWithSeededThread({ isThreadLive: () => false });
  const req = forgetReq(token, { target_type: "thread" });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("bad_body");
});

test("POST /memory/forget target_type:message → 400 bad_body (unchanged)", async () => {
  const { deps, token, threadId } = buildDepsWithSeededThread({ isThreadLive: () => false });
  const req = forgetReq(token, { target_type: "message", thread_id: threadId });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("bad_body");
});

test("POST /memory/forget target_type:garbage → 400 bad_body (unchanged)", async () => {
  const { deps, token } = buildDepsWithSeededThread({ isThreadLive: () => false });
  const req = forgetReq(token, { target_type: "garbage" });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("bad_body");
});

test("POST /memory/forget target_type:thread on an unknown UUID-shaped thread_id → 404 target_not_found", async () => {
  const { deps, token } = buildDepsWithSeededThread({ isThreadLive: () => false });
  const req = forgetReq(token, { target_type: "thread", thread_id: crypto.randomUUID() });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(404);
  expect((await res.json() as { error: string }).error).toBe("target_not_found");
});

test("POST /memory/forget target_type:thread with no token → 401", async () => {
  const { deps, threadId } = buildDepsWithSeededThread({ isThreadLive: () => false });
  const req = new Request("http://127.0.0.1:7777/memory/forget", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target_type: "thread", thread_id: threadId }),
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(401);
});

test("POST /memory/forget target_type:thread on a NOT-live thread → 204 applied; repeat → 204 idempotent", async () => {
  const { deps, token, threadId } = buildDepsWithSeededThread({ isThreadLive: () => false });
  const req1 = forgetReq(token, { target_type: "thread", thread_id: threadId });
  const res1 = await handleMemoryHttp(req1, new URL(req1.url), deps);
  expect(res1.status).toBe(204);
  const req2 = forgetReq(token, { target_type: "thread", thread_id: threadId });
  const res2 = await handleMemoryHttp(req2, new URL(req2.url), deps);
  expect(res2.status).toBe(204); // idempotent repeat
  // The husk is genuinely erased (view meta over the direct-deps Hatch).
  const view = await deps.hatch.view(threadId);
  expect(view.thread!.status).toBe("forgotten");
  expect(view.messages.every((m) => m.content === "[forgotten]")).toBe(true);
});

// ─── Group 2: live-guard both sides + decrement, over a REAL daemon ───────────

function liveGuardStub(): AgentProvider {
  return {
    id: "thread-forget-liveguard-stub",
    async advance(state, inbound) {
      if (inbound.type === "session_start") {
        const session_id = crypto.randomUUID();
        const call_id = crypto.randomUUID();
        return {
          ok: true,
          nextState: { phase: "done", session_id, messages: [{ role: "user", content: inbound.text ?? "" }] },
          outbound: [
            { type: "session_ack", session_id, client_session_id: inbound.client_session_id },
            { type: "tool_call", session_id, call_id, payload: { tool: "show_text", args: { text: { primitive: "text", content: "ok" } } } },
            { type: "session_end", session_id, reason: "completed" },
          ],
          finalText: "ok",
        };
      }
      return { ok: true, nextState: state ?? { phase: "done", session_id: "", messages: [] }, outbound: [] };
    },
  };
}

let liveGuardDataDir: string;
let liveGuardServer: ReturnType<typeof import("../index.js").startDaemon>;
let liveGuardPort: number;
let liveGuardToken: string;
let seededLiveThreadId: string;

beforeAll(async () => {
  liveGuardDataDir = mkdtempSync(join(tmpdir(), "thread-forget-liveguard-"));
  process.env.AGENTIC_DATA_DIR = liveGuardDataDir;
  process.env.LLM_PROVIDER = "mock";
  process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "none";

  // Pre-seed an ACTIVE thread into the shared dataDir before the daemon boots.
  const seedStore = new MemoryStore({ dataDir: liveGuardDataDir });
  seededLiveThreadId = seedStore.createThread("live-guard-thread");
  seedStore.close();

  const { startDaemon } = await import("../index.js");
  liveGuardServer = startDaemon(0, liveGuardStub());
  liveGuardPort = liveGuardServer.port!;

  const { readFileSync } = await import("node:fs");
  liveGuardToken = readFileSync(join(liveGuardDataDir, "auth-token"), "utf8").trim();
});

afterAll(() => liveGuardServer.stop(true));

test("live-guard both sides: open socket → 409; close (decrement) → same thread erases 204; view over HTTP is honest post-erase", async () => {
  const forget = () =>
    fetch(`http://127.0.0.1:${liveGuardPort}/memory/forget`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${liveGuardToken}` },
      body: JSON.stringify({ target_type: "thread", thread_id: seededLiveThreadId }),
    });

  const ws = new WebSocket(`ws://127.0.0.1:${liveGuardPort}`, {
    headers: { Origin: "tauri://localhost" },
    protocols: [liveGuardToken],
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "session_start",
        trigger: "user",
        text: "live",
        client_session_id: crypto.randomUUID(),
        thread_id: seededLiveThreadId,
      }));
    });
    ws.addEventListener("message", (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as { type: string };
      if (msg.type === "session_end") resolve(); // increment landed before advance ran
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
  });

  // socket still OPEN → thread live → 409
  const liveRes = await forget();
  expect(liveRes.status).toBe(409);
  expect((await liveRes.json() as { error: string }).error).toBe("thread_live");

  // close → decrement; wait a tick for the async close handler to run
  await new Promise<void>((resolve) => {
    ws.addEventListener("close", () => resolve());
    ws.close();
  });
  await new Promise((r) => setTimeout(r, 150));

  // decrement proven: the SAME thread now erases cleanly → 204
  const erasedRes = await forget();
  expect(erasedRes.status).toBe(204);

  // idempotent repeat still 204
  const repeatRes = await forget();
  expect(repeatRes.status).toBe(204);

  // view-meta over HTTP: honest post-erase husk
  const viewRes = await fetch(`http://127.0.0.1:${liveGuardPort}/memory/thread/${encodeURIComponent(seededLiveThreadId)}`, {
    headers: { Authorization: `Bearer ${liveGuardToken}` },
  });
  expect(viewRes.status).toBe(200);
  const viewBody = await viewRes.json() as { thread: { status: string } | null; messages: { content: string }[] };
  expect(viewBody.thread!.status).toBe("forgotten");
  expect(viewBody.messages.every((m) => m.content === "[forgotten]")).toBe(true);
});
