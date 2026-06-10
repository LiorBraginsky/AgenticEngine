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
 *   3. WS path byte-unchanged — disallowed Origin on / still → 403
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
import { REDACTION_MARKER } from "./schema.js";

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

// ─── Test 1: GET /memory/threads → 200 + seeded thread present ────────────────

test("T2.1a-1: GET /memory/threads without Origin or token → 200 and contains seeded thread_id", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`);
  expect(res.status).toBe(200);
  const body = await res.json() as { threads: { thread_id: string; title: string | null; last_active_at: number }[] };
  expect(Array.isArray(body.threads)).toBe(true);
  const found = body.threads.find((t) => t.thread_id === seededThreadId);
  expect(found).toBeDefined();
  expect(found!.thread_id).toBe(seededThreadId);
});

// ─── Test 2: GET /memory/thread/:id → 200 + HatchViewResult shape ─────────────

test("T2.1a-2: GET /memory/thread/:id → 200 and body has messages, distilledFacts, distillationEvents", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(seededThreadId)}`);
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, unknown>;
  expect(Array.isArray(body["messages"])).toBe(true);
  expect(Array.isArray(body["distilledFacts"])).toBe(true);
  expect(Array.isArray(body["distillationEvents"])).toBe(true);
  // The seeded message must appear in the archive
  const messages = body["messages"] as { role: string; content: string }[];
  expect(messages.some((m) => m.content === "seeded message")).toBe(true);
});

// ─── Test 3: WS path byte-unchanged — disallowed Origin on / still → 403 ──────

test("T2.1a-3: WS upgrade on / with disallowed Origin still returns 403 (origin gate unchanged)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/`, {
    headers: { Origin: "https://evil.example" },
  });
  expect(res.status).toBe(403);
});

// ─── T2.1c: Token-gated write routes ─────────────────────────────────────────
//
// Helper: read the minted token from disk (written by TokenStore when daemon started).
function readToken(): string {
  return readFileSync(join(sharedDataDir, "auth-token"), "utf8").trim();
}

// Test 4: POST /memory/forget without token → 403
test("T2.1c-1: POST /memory/forget without Authorization header → 403", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: seededMessageId }),
  });
  expect(res.status).toBe(403);
});

// Test 5: POST /memory/forget WITH token on seeded human message → 204; disk shows REDACTION_MARKER.
// This is the "refusal-does-not-fire-on-HTTP" proof: human-authored content + human ctx →
// always applied (5e only refuses machine ctx, which the route never sends).
test("T2.1c-2: POST /memory/forget with Bearer token on seeded message → 204 and disk content is REDACTION_MARKER", async () => {
  const token = readToken();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target: seededMessageId, reason: "test-forget" }),
  });
  expect(res.status).toBe(204);

  // Verify on disk: open a fresh MemoryStore on the same dataDir and assert REDACTION_MARKER.
  const verifyStore = new MemoryStore({ dataDir: sharedDataDir });
  const archive = verifyStore.readThreadArchive(seededThreadId);
  verifyStore.close();
  const msg = archive.find((m) => m.id === seededMessageId);
  expect(msg).toBeDefined();
  expect(msg!.content).toBe(REDACTION_MARKER);
});

// Test 6: POST /memory/forget with token, unknown UUID-shaped target → 404 (not 500).
// Unknown UUID goes to WriteGate.forget → threadOf throws "not found" → route maps to 404.
test("T2.1c-3: POST /memory/forget with token, unknown UUID target → 404 not_found (not 500)", async () => {
  const token = readToken();
  const unknownId = crypto.randomUUID();
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target: unknownId }),
  });
  expect(res.status).toBe(404);
  const body = await res.json() as { error: string };
  expect(body.error).toBe("target_not_found");
});

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
