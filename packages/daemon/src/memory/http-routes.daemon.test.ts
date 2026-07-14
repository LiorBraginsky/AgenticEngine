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
 *
 * hybrid-retrieval chunk-01 (spec §3.7 R1): tests 7/8 (POST /memory/edit MESSAGE-shaped body)
 * removed — the message-edit HTTP branch is retired; a message-shaped body now → 400 bad_body
 * (see "message-edit REMOVED" test below). target_type:"fact" (chunk-05 FACT-EDIT) is untouched.
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

// chunk-05: the seeded MACHINE distilled fact — used by the fact-edit route tests.
let seededFactId: string;

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
  // chunk-05: a MACHINE distilled fact for the fact-edit route tests
  seededFactId = seedStore.insertFact({
    fact: "favourite colour blue", canonical: "favourite colour blue",
    provenance: `thread:${seededThreadId}`, scope: "cross-thread", expiry: null,
    confidence: 1, authored_by: "machine", topics: ["#preferences"],
  }, "seed");
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
  // 2c chunk-01 (2B): additive field — existing fields above stay unchanged.
  expect(Array.isArray(body["memoryActionEvents"])).toBe(true);
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
// v2-07: updated to send a valid fact_id (the text/provenance fallback is removed).
test("T2.1c-6: POST /memory/forget target_type=fact with fact_id does NOT scrub the source message", async () => {
  const token = readToken();
  // Seed a fresh message + one fact for the fact-forget test (seeded message may be tombstoned)
  const setupStore = new MemoryStore({ dataDir: sharedDataDir });
  const factTestThread = setupStore.createThread("fact-forget-test-thread");
  const [factTestMsgId] = setupStore.appendMessages(factTestThread, [{ role: "user", content: "fact source content" }], "fact-test");
  // Insert a fact to get a valid fact_id (v2-07: fact_id required)
  setupStore.insertDistilledFacts([
    { fact: "fav colour blue", provenance: factTestMsgId!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "t21c6-test");
  const t21c6Facts = setupStore.readDistilledFacts(10);
  const t21c6Fact = t21c6Facts.find((f) => f.fact === "fav colour blue")!;
  setupStore.close();

  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target_type: "fact", fact_id: t21c6Fact.id, fact_text: "fav colour blue", provenance: factTestMsgId!, reason: "test" }),
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
// in v2-04 along with option B. The /memory/cofed route was removed in Task 2 (2.2); the → 404 test passes.

// hybrid-retrieval chunk-01 (spec §3.7 R1): T2.1c-4 (POST /memory/edit message-shaped body
// → 204 + correction row on disk) and T2.1c-5 (message-shaped bad body → 400) REMOVED — the
// message-edit HTTP branch is retired end-to-end. See "message-edit removed" test below
// (the new 400 assertion for a message-shaped body) and the fact-edit tests further down
// (untouched — target_type:"fact" is the ONLY accepted shape now).

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

// 2.1c: POST /memory/forget target_type=fact REQUIRES a valid fact_id (v2-07).
// also_forget_sources flag is ignored; the source message is byte-intact.
// Updated by v2-07 to send a valid fact_id (the text/provenance fallback is removed).
test("v2-07: POST /memory/forget target_type=fact with fact_id → 204, source message intact (also_forget_sources flag ignored)", async () => {
  const token = readToken();
  // Seed a fresh message + one fact whose id will be sent as fact_id.
  const setupStore = new MemoryStore({ dataDir: sharedDataDir });
  const atsThread = setupStore.createThread("also-forget-sources-test");
  const [atsMsgId] = setupStore.appendMessages(
    atsThread,
    [{ role: "user", content: "source content stays intact" }],
    "ats-session",
  );
  // Insert one fact to get a real fact_id
  setupStore.insertDistilledFacts([
    { fact: "some fact to forget", provenance: atsMsgId!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "ats-test");
  const atsFacts = setupStore.readDistilledFacts(10);
  const atsFact = atsFacts.find((f) => f.fact === "some fact to forget")!;
  setupStore.close();

  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      target_type: "fact",
      fact_id: atsFact.id,       // v2-07: required
      fact_text: "some fact to forget",
      provenance: atsMsgId!,
      also_forget_sources: true,  // still ignored
      reason: "v2-07-test",
    }),
  });
  // fact_id present + uuid-shaped → forgetFactById → 204
  expect(res.status).toBe(204);

  // Source message content must be byte-intact (not scrubbed — fact-forget never scrubs)
  const verifyStore = new MemoryStore({ dataDir: sharedDataDir });
  const archive = verifyStore.readThreadArchive(atsThread);
  verifyStore.close();
  const msg = archive.find((m) => m.id === atsMsgId);
  expect(msg).toBeDefined();
  expect(msg!.content).toBe("source content stays intact");
});

// ---- v2-07 Step 3.2: HTTP forget REQUIRES fact_id for target_type=fact (RED→GREEN) ----

test("v2-07: POST /memory/forget target_type=fact with NO fact_id → 400 bad_body (text/provenance fallback removed)", async () => {
  // RED (on pre-v2-07 code): the fallback returned 204 via forgetFact(text, provenance).
  // GREEN (post-v2-07): the fallback is removed; missing fact_id → 400 bad_body.
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      target_type: "fact",
      fact_text: "some fact text",
      provenance: "thread:00000000-0000-0000-0000-000000000001",
      // NO fact_id — the over-deleting fallback path that is now removed
    }),
  });
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe("bad_body");
});

test("v2-07: POST /memory/forget target_type=fact with malformed fact_id → 400 bad_body", async () => {
  // A non-uuid-shaped fact_id must be rejected (not routed to forgetFactById).
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      target_type: "fact",
      fact_id: "not-a-uuid",
      fact_text: "some fact text",
      provenance: "thread:00000000-0000-0000-0000-000000000001",
    }),
  });
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe("bad_body");
});

// ---- v2-06 Step 3 (RED): fact_id routing in handleForget ----

test("v2-06: POST /memory/forget with target_type=fact + fact_id deletes exactly that row (one of three sharing provenance)", async () => {
  // RED: handleForget currently ignores fact_id and falls through to forgetFact (provenance-based).
  // Pre-fix: provenance-based delete hits ALL 3 facts; post-fix: only the targeted one is deleted.
  const token = readToken();

  // Seed 3 machine facts sharing the same thread provenance via a fresh store
  const setupStore = new MemoryStore({ dataDir: sharedDataDir });
  const factIdThread = setupStore.createThread("fact-id-test-thread");
  const sharedProv = `thread:${factIdThread}`;
  setupStore.insertDistilledFacts([
    { fact: "alpha fact", provenance: sharedProv, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "beta fact",  provenance: sharedProv, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "gamma fact", provenance: sharedProv, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "dumb-tail");
  const allFacts = setupStore.readDistilledFacts(100);
  const betaFact = allFacts.find((f) => f.fact === "beta fact")!;
  const betaId = betaFact.id;
  setupStore.close();

  // POST forget targeting only beta by fact_id
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      target_type: "fact",
      fact_id: betaId,
      fact_text: "beta fact",
      provenance: sharedProv,
      reason: "v2-06-test",
    }),
  });
  expect(res.status).toBe(204);

  // Verify via GET /memory/thread/:id — exactly 1 deleted, alpha + gamma remain
  const getRes = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(factIdThread)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(getRes.status).toBe(200);
  const body = await getRes.json() as { distilledFacts: { fact: string; id: string }[] };
  const factsRemaining = body.distilledFacts.filter((f) => ["alpha fact", "beta fact", "gamma fact"].includes(f.fact));
  expect(factsRemaining.length).toBe(2);
  expect(factsRemaining.some((f) => f.fact === "alpha fact")).toBe(true);
  expect(factsRemaining.some((f) => f.fact === "gamma fact")).toBe(true);
  expect(factsRemaining.some((f) => f.fact === "beta fact")).toBe(false);
});

test("v2-06: POST /memory/forget with target_type=message → 400 (unchanged after v2-06)", async () => {
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_type: "message", target: seededMessageId }),
  });
  expect(res.status).toBe(400);
});

// ─── chunk-05 FACT-EDIT: POST /memory/edit target_type:"fact" ────────────────

function editPost(body: unknown, withToken = true): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/memory/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(withToken ? { Authorization: `Bearer ${readToken()}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("fact-edit: valid → 204 + text updated + authored_by=human on disk", async () => {
  const res = await editPost({ target_type: "fact", fact_id: seededFactId, replacement: "favourite colour green", reason: "t" });
  expect(res.status).toBe(204);
  const s = new MemoryStore({ dataDir: sharedDataDir });
  const row = s.rawDb().query("SELECT fact, authored_by FROM distilled_facts WHERE id = ?").get(seededFactId) as { fact: string; authored_by: string };
  s.close();
  expect(row.fact).toBe("favourite colour green");
  expect(row.authored_by).toBe("human");
});

test("fact-edit: missing fact_id → 400", async () => {
  expect((await editPost({ target_type: "fact", replacement: "x" })).status).toBe(400);
});

test("fact-edit: non-uuid fact_id → 400", async () => {
  expect((await editPost({ target_type: "fact", fact_id: "not-a-uuid", replacement: "x" })).status).toBe(400);
});

test("fact-edit: empty replacement → 400", async () => {
  expect((await editPost({ target_type: "fact", fact_id: seededFactId, replacement: "" })).status).toBe(400);
});

test("fact-edit: unknown uuid fact_id → 404 target_not_found", async () => {
  const res = await editPost({ target_type: "fact", fact_id: crypto.randomUUID(), replacement: "x" });
  expect(res.status).toBe(404);
  expect((await res.json() as { error: string }).error).toBe("target_not_found");
});

test("fact-edit: no token → 401", async () => {
  expect((await editPost({ target_type: "fact", fact_id: seededFactId, replacement: "x" }, false)).status).toBe(401);
});

test("hybrid-retrieval chunk-01: message-edit REMOVED — {target,replacement} (no target_type) → 400 bad_body", async () => {
  const res = await editPost({ target: seededMessageId, replacement: "corrected msg" });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("bad_body");
});
