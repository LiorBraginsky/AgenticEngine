/**
 * MF-05 T2.1a + T2.1c real-I/O tests — Memory HTTP read + write routes.
 *
 * All tests run through the REAL daemon (startDaemon on an ephemeral port)
 * with a real MemoryStore backed by a mkdtempSync AGENTIC_DATA_DIR.
 * No mocked store, no mocked handler.
 *
 * Follows the existing daemon.test.ts boot idiom (beforeAll → startDaemon(0) → PORT).
 *
 * T2.1a tests:
 *   1. GET /memory/threads with NO Origin and NO token → 200 + seeded thread_id
 *   2. GET /memory/thread/:id → 200 + body has {messages, distilledFacts, distillationEvents}
 *   3. WS path — no token → 401 (token gate is now layer 1; origin gate is layer 2)
 *   3b. WS path — valid token + evil origin → 403 (origin gate fires after token passes)
 *
 * T2.1c tests (token-gated write routes):
 *   4. POST /memory/forget without token → 403
 *   5. POST /memory/forget WITH token on seeded human message → 204 + disk shows REDACTION_MARKER
 *   6. POST /memory/forget WITH token, unknown UUID-shaped target → 404 (not 500)
 *   7. POST /memory/edit WITH token → 204 + correction row on disk (authored_by:human)
 *   8. POST /memory/edit with bad body (missing replacement) → 400
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

let sharedDataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;

// The seeded thread id — written into the store BEFORE the daemon starts
// so it shares the exact same AGENTIC_DATA_DIR / memory.sqlite file.
let seededThreadId: string;

// The seeded message id — used by T2.1c write-route tests.
let seededMessageId: string;

beforeAll(async () => {
  sharedDataDir = mkdtempSync(join(tmpdir(), "mf05-t21a-"));
  process.env.AGENTIC_DATA_DIR = sharedDataDir;
  process.env.LLM_PROVIDER = "mock";

  // Seed a thread into the store BEFORE the daemon boots — same dataDir means
  // the daemon's MemoryStore will see this row without any race.
  const seedStore = new MemoryStore({ dataDir: sharedDataDir });
  seededThreadId = seedStore.createThread("test thread title");
  const seededIds = seedStore.appendMessages(seededThreadId, [{ role: "user", content: "seeded message" }], "seed-session");
  seededMessageId = seededIds[0]!;
  seedStore.close();

  const { startDaemon } = await import("../index.js");
  server = startDaemon(0);
  PORT = server.port!;
});

afterAll(() => server.stop(true));

// ─── Read-route auth matrix (chunk 03) ───────────────────────────────────────

test("read-gate: GET /memory/threads WITHOUT token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`);
  expect(res.status).toBe(401);
});

test("read-gate: GET /memory/threads with BAD token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`, {
    headers: { Authorization: "Bearer deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
  });
  expect(res.status).toBe(401);
});

test("read-gate: GET /memory/threads with VALID Bearer → 200 + seeded thread", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`, {
    headers: { Authorization: `Bearer ${readToken()}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { threads: { thread_id: string }[] };
  expect(body.threads.some((t) => t.thread_id === seededThreadId)).toBe(true);
});

test("read-gate: GET /memory/thread/:id WITHOUT token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(seededThreadId)}`);
  expect(res.status).toBe(401);
});

test("read-gate: GET /memory/thread/:id with VALID Bearer → 200 + HatchViewResult shape", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(seededThreadId)}`, {
    headers: { Authorization: `Bearer ${readToken()}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, unknown>;
  expect(Array.isArray(body["messages"])).toBe(true);
  expect(Array.isArray(body["distilledFacts"])).toBe(true);
  expect(Array.isArray(body["distillationEvents"])).toBe(true);
});

// ─── Test 3: WS path — disallowed Origin without a token → 401 (token gate is now layer 1) ──────
//
// Step-1 update: the per-install token gate (spec §3.2, ADR-0003 p.5 un-deferred) fires
// BEFORE the origin check. A request with no token (evil browser with no protocols header)
// is rejected with 401, not 403. The origin gate (layer 2) is intact for clients that pass
// the token gate but present a bad origin — tested separately below.

test("T2.1a-3: WS upgrade on / with disallowed Origin and no token → 401 (token gate fires first)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/`, {
    headers: { Origin: "https://evil.example" },
  });
  // Token gate is layer 1; no token → 401. The origin check (layer 2) is never reached.
  expect(res.status).toBe(401);
});

test("T2.1a-3b: WS upgrade on / with valid token but disallowed Origin → 403 (origin gate is layer 2)", async () => {
  const validToken = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/`, {
    headers: {
      Origin: "https://evil.example",
      "Sec-WebSocket-Protocol": validToken,
    },
  });
  // Token gate passes (valid token), but origin gate (layer 2) rejects with 403.
  expect(res.status).toBe(403);
});

// ─── T2.1c: Token-gated write routes ─────────────────────────────────────────
//
// Helper: read the minted token from disk (written by TokenStore when daemon started).
function readToken(): string {
  return readFileSync(join(sharedDataDir, "auth-token"), "utf8").trim();
}

// Test 4: POST /memory/forget without token → 401
test("T2.1c-1: POST /memory/forget without Authorization header → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_type: "message", target: seededMessageId }),
  });
  expect(res.status).toBe(401);
});

// v2-04: T2.1c-2 (POST /memory/forget target_type=message → 204) removed.
// v2-04: T2.1c-3 (POST /memory/forget target_type=message unknown UUID → 404) removed.
// The per-message message-forget user path was removed in v2-04 (D-V6a-bis).
// The message-success path is now a 400. See v2-04 RED→GREEN tests below.

// Test: POST /memory/forget target_type=fact → 204, message content intact.
// B1 at the HTTP boundary: fact-forget must not scrub the source message.
test("T2.1c-6: POST /memory/forget target_type=fact does NOT scrub the source message", async () => {
  const token = readToken();
  // Seed a fresh message for the fact-forget test (seeded message may be tombstoned)
  const setupStore = new MemoryStore({ dataDir: sharedDataDir });
  const factTestThread = setupStore.createThread("fact-forget-test-thread");
  const [factTestMsgId] = setupStore.appendMessages(factTestThread, [{ role: "user", content: "fact source content" }], "fact-test");
  setupStore.close();

  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target_type: "fact", fact_text: "fav colour blue", provenance: factTestMsgId!, reason: "test" }),
  });
  expect(res.status).toBe(204);

  // Assert source message content is byte-intact (B1 — fact-forget never scrubs)
  const verifyStore = new MemoryStore({ dataDir: sharedDataDir });
  const archive = verifyStore.readThreadArchive(factTestThread);
  verifyStore.close();
  const msg = archive.find((m) => m.id === factTestMsgId);
  expect(msg).toBeDefined();
  expect(msg!.content).toBe("fact source content"); // NOT scrubbed
});

// Test: POST /memory/forget with missing/invalid target_type → 400 bad_body.
test("T2.1c-7: POST /memory/forget with missing target_type → 400 bad_body", async () => {
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target: seededMessageId }), // old shape — missing target_type
  });
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe("bad_body");
});

// v2-04: T2.1c-8 GET /memory/cofed test removed. countFactsFedByMessages was removed
// in v2-04 along with option B. The /memory/cofed route will be removed in Task 2 (2.2).

// Test 7: POST /memory/edit with token → 204 and correction row on disk (authored_by:human).
// The T1 hatch tests already prove edit→distill→retrieve injection (Fix-2 cross-thread test
// in hatch.daemon.test.ts). The HTTP leg verifies the mutation row lands on disk with the
// correct authored_by so the write-gate's 5e semantics are honoured end-to-end.
// Option taken: verify mutation row on disk (authored_by:human + replacement_content) +
// cite Fix-2 in hatch.daemon.test.ts for the injection leg.
test("T2.1c-4: POST /memory/edit with Bearer token → 204 and correction row on disk authored_by:human", async () => {
  // Seed a fresh message for editing (the seeded message may be tombstoned after test 5).
  const setupStore = new MemoryStore({ dataDir: sharedDataDir });
  const editThreadId = setupStore.createThread("edit-test-thread");
  const [editMsgId] = setupStore.appendMessages(editThreadId, [{ role: "user", content: "original content" }], "edit-session");
  setupStore.close();

  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/edit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target: editMsgId!, replacement: "corrected content", reason: "test-edit" }),
  });
  expect(res.status).toBe(204);

  // Verify on disk: the mutations table has a correction row authored_by:human.
  const verifyStore = new MemoryStore({ dataDir: sharedDataDir });
  const db = verifyStore.rawDb();
  const row = db.query(
    "SELECT kind, replacement_content, authored_by FROM mutations WHERE target_message_id = ? AND kind = 'correction'",
  ).get(editMsgId!) as { kind: string; replacement_content: string; authored_by: string } | null;
  verifyStore.close();

  expect(row).not.toBeNull();
  expect(row!.kind).toBe("correction");
  expect(row!.replacement_content).toBe("corrected content");
  expect(row!.authored_by).toBe("human");
  // The edit→distill→retrieve injection leg is covered by Fix-2 in hatch.daemon.test.ts
  // (real store + real DumbTailProvider; no re-proof needed at the HTTP layer).
});

// Test 8: POST /memory/edit with bad body (missing replacement) → 400.
test("T2.1c-5: POST /memory/edit with bad body (missing replacement) → 400 bad_body", async () => {
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/edit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    // target present but replacement missing → bad shape
    body: JSON.stringify({ target: seededMessageId }),
  });
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe("bad_body");
});

// ─── Guard: malformed percent-sequence in thread-id path → 400, not 500 ──────
//
// Route taken: direct call to handleMemoryHttp with a hand-built Request + URL
// whose pathname contains "%ZZ" (a malformed percent-sequence).
// Rationale: Bun/fetch passes "%ZZ" to the server unmodified (verified), so a
// real-fetch variant through the daemon would also trigger the bug — but the
// direct-call form avoids any chance the HTTP layer sanitises the path before
// reaching our handler, making the test a pure unit-level proof of the guard.
test("guard: GET /memory/thread/<malformed-%> → 400 bad_target_shape (not 500 URIError)", async () => {
  const { handleMemoryHttp } = await import("./http-routes.js");
  const { MemoryStore } = await import("./store.js");
  const { TokenStore } = await import("./token-store.js");
  const { Hatch } = await import("./hatch.js");
  const { WriteGate } = await import("./write-gate.js");
  const { RuleBasedScanner } = await import("./scanner/memory-scanner.js");
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = mkdtempSync(join(tmpdir(), "mf05-malform-"));
  const store = new MemoryStore({ dataDir: dir });
  const tokenStore = new TokenStore(dir);
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hatch = new Hatch(store, gate);
  const deps = { hatch, store, tokenStore };

  // Hand-build a URL whose pathname contains a malformed percent-sequence.
  // The URL constructor preserves "%ZZ" as-is (it does not throw for it).
  const malformedPath = "http://localhost/memory/thread/%ZZ";
  const url = new URL(malformedPath);
  const req = new Request(malformedPath, { method: "GET" });

  const res = await handleMemoryHttp(req, url, deps);
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe("bad_target_shape");

  store.close();
});

// ─── DNS-rebinding guard tests ───────────────────────────────────────────────
//
// The Host-header allowlist in index.ts rejects requests whose Host does not
// match 127.0.0.1:<port> or localhost:<port> (security review finding).

test("dns-rebind-1: GET /memory/threads with Host: evil.com:<port> → 403 forbidden host", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`, {
    headers: { Host: `evil.com:${PORT}` },
  });
  expect(res.status).toBe(403);
  expect(await res.text()).toBe("forbidden host");
});

test("dns-rebind-2: GET /history.html with Host: evil.com → 403 forbidden host", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/history.html`, {
    headers: { Host: "evil.com" },
  });
  expect(res.status).toBe(403);
  expect(await res.text()).toBe("forbidden host");
});

test("dns-rebind-3: GET /memory/threads with Host: localhost:<port> + token → 200 (allowed)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`, {
    headers: { Host: `localhost:${PORT}`, Authorization: `Bearer ${readToken()}` },
  });
  expect(res.status).toBe(200);
});

test("dns-rebind-4: POST /memory/forget with valid token but bad Host → 403 (Host check runs first)", async () => {
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Host: `evil.com:${PORT}`,
    },
    body: JSON.stringify({ target_type: "message", target: seededMessageId }),
  });
  expect(res.status).toBe(403);
  expect(await res.text()).toBe("forbidden host");
});

// ─── T2.2a: GET /history.html — static History page ─────────────────────────

// Test 9: GET /history.html → 200, content-type contains text/html, body contains
// "History" and "/memory/threads", body does NOT contain "localStorage".
test("T2.2a-1: GET /history.html → 200 text/html, contains History + /memory/threads, no localStorage", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/history.html`);
  expect(res.status).toBe(200);

  const contentType = res.headers.get("content-type") ?? "";
  expect(contentType).toContain("text/html");

  const body = await res.text();
  expect(body).toContain("History");
  expect(body).toContain("/memory/threads");
  // XSS/threat-model discipline: token must NEVER be persisted via web storage
  expect(body).not.toContain("localStorage");
});

// Test 10: GET /history.html — page must not use native browser dialogs.
// Regression: browser dialog-suppression ("don't show again") causes confirm()/prompt()
// to return false/null immediately, silently no-op'ing forget/edit actions.
test("T2.2a-2: GET /history.html — no native browser dialogs (confirm/prompt/alert)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/history.html`);
  const body = await res.text();
  // None of the three native dialog calls may appear in the page script
  expect(body).not.toContain("confirm(");
  expect(body).not.toContain("prompt(");
  expect(body).not.toContain("alert(");
});

// ─── v2-04 Task 2 (RED → GREEN): option B + per-message user path removal ─────

// 2.1a: POST /memory/forget target_type=message → 400 (user route removed in v2-04)
test("v2-04: POST /memory/forget target_type=message → 400 (user route removed)", async () => {
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target_type: "message", target: seededMessageId }),
  });
  expect(res.status).toBe(400);
});

// 2.1b: GET /memory/cofed → 404 (route removed in v2-04)
test("v2-04: GET /memory/cofed → 404 (route removed)", async () => {
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/cofed?provenance=abc`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});

// 2.1c: POST /memory/forget target_type=fact with also_forget_sources:true behaves as
// plain fact-forget (flag is ignored) → 204, source message content stays byte-intact.
test("v2-04: POST /memory/forget target_type=fact with also_forget_sources:true → 204, source message intact", async () => {
  const token = readToken();
  // Seed a fresh message whose id is used as provenance for the fact.
  const setupStore = new MemoryStore({ dataDir: sharedDataDir });
  const atsThread = setupStore.createThread("also-forget-sources-test");
  const [atsMsgId] = setupStore.appendMessages(
    atsThread,
    [{ role: "user", content: "source content stays intact" }],
    "ats-session",
  );
  setupStore.close();

  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      target_type: "fact",
      fact_text: "some fact to forget",
      provenance: atsMsgId!,
      also_forget_sources: true,
      reason: "v2-04-test",
    }),
  });
  // The flag is ignored → plain fact-forget → 204
  expect(res.status).toBe(204);

  // Source message content must be byte-intact (not scrubbed — fact-forget never scrubs)
  const verifyStore = new MemoryStore({ dataDir: sharedDataDir });
  const archive = verifyStore.readThreadArchive(atsThread);
  verifyStore.close();
  const msg = archive.find((m) => m.id === atsMsgId);
  expect(msg).toBeDefined();
  expect(msg!.content).toBe("source content stays intact");
});
