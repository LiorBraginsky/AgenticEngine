/**
 * MF-05 T2.1a real-I/O tests — Memory HTTP read routes.
 *
 * All tests run through the REAL daemon (startDaemon on an ephemeral port)
 * with a real MemoryStore backed by a mkdtempSync AGENTIC_DATA_DIR.
 * No mocked store, no mocked handler.
 *
 * Follows the existing daemon.test.ts boot idiom (beforeAll → startDaemon(0) → PORT).
 *
 * Tests:
 *   1. GET /memory/threads with NO Origin and NO token → 200 + seeded thread_id
 *   2. GET /memory/thread/:id → 200 + body has {messages, distilledFacts, distillationEvents}
 *   3. WS path byte-unchanged — disallowed Origin on / still → 403
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

let sharedDataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;

// The seeded thread id — written into the store BEFORE the daemon starts
// so it shares the exact same AGENTIC_DATA_DIR / memory.sqlite file.
let seededThreadId: string;

beforeAll(async () => {
  sharedDataDir = mkdtempSync(join(tmpdir(), "mf05-t21a-"));
  process.env.AGENTIC_DATA_DIR = sharedDataDir;
  process.env.LLM_PROVIDER = "mock";

  // Seed a thread into the store BEFORE the daemon boots — same dataDir means
  // the daemon's MemoryStore will see this row without any race.
  const seedStore = new MemoryStore({ dataDir: sharedDataDir });
  seededThreadId = seedStore.createThread("test thread title");
  seedStore.appendMessages(seededThreadId, [{ role: "user", content: "seeded message" }], "seed-session");
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
