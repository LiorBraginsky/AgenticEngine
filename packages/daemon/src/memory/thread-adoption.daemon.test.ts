import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { ThreadLifecycle } from "./thread-lifecycle.js";
import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { registerDistiller } from "./distiller-registration.js";
import { TokenStore } from "./token-store.js";

let dataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;
let token: string;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm01-adopt-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  // hybrid-retrieval chunk-03 (reviewer MINOR fix): pin lexical-only so this daemon boot
  // never constructs a real LocalWasmEmbeddingProvider (ENOENT noise; CI never has the model).
  process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "none";
  const { startDaemon } = await import("../index.js");
  server = startDaemon(0);
  PORT = server.port!;
  // chunk-02 step-3: read the per-install token minted by the daemon at boot.
  token = new TokenStore(dataDir).token();
});
afterAll(() => server.stop(true));

function openDb() {
  return new Database(join(dataDir, "memory.sqlite"));
}

/** Drive ONE full mock turn to `done`, with optional thread_id (copied from memory-integration.daemon.test.ts). */
function runTurn(text: string, threadId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // chunk-02 step-3: present token as Sec-WebSocket-Protocol subprotocol (layer-1 gate).
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN }, protocols: [token] });
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({
        type: "session_start", trigger: "user", text, client_session_id: "c",
        ...(threadId ? { thread_id: threadId } : {}),
      })),
    );
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data as string);
      if (m.type === "tool_call" && m.payload.tool === "show_color_picker") {
        const pick = m.payload.args.picker.palette[0];
        ws.send(JSON.stringify({
          type: "tool_result", session_id: m.session_id, call_id: m.call_id,
          payload: { tool: "show_color_picker", result: { picked: pick } },
        }));
      }
      if (m.type === "session_end") { ws.close(); resolve(); }
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}

test("DoD#1 — session_start{thread_id: fresh client UUID} creates the thread row WITH exactly that id", async () => {
  const clientId = crypto.randomUUID();
  await runTurn("deploy is yeet.sh", clientId);
  const db = openDb();
  const row = db.query("SELECT thread_id FROM threads WHERE thread_id = ?").get(clientId) as { thread_id: string } | null;
  expect(row).not.toBeNull();
  expect(row!.thread_id).toBe(clientId);
  // The adopted thread holds turn-1's message.
  const msgs = db.query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index").all(clientId) as { content: string }[];
  expect(msgs.map((m) => m.content)).toContain("deploy is yeet.sh");
  db.close();
});

test("DoD#2 — second session_start with the SAME adopted id hydrates turn-1 (within-thread multi-turn over the real daemon)", async () => {
  const clientId = crypto.randomUUID();
  await runTurn("deploy is yeet.sh", clientId);
  await runTurn("what's the deploy?", clientId);
  const db = openDb();
  const contents = (db.query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index").all(clientId) as { content: string }[]).map((m) => m.content);
  // EXACTLY two rows in order — proves turn-2 flushed onto turn-1's hydrated tail (no double-persist).
  expect(contents).toEqual(["deploy is yeet.sh", "what's the deploy?"]);
  // Exactly ONE thread row for that id (adoption did not create a duplicate on turn 2).
  const count = (db.query("SELECT COUNT(*) AS n FROM threads WHERE thread_id = ?").get(clientId) as { n: number }).n;
  expect(count).toBe(1);
  db.close();
});

test("DoD#3a — no thread_id → daemon-minted thread (unchanged MF-01 degenerate path)", async () => {
  await runTurn("no-thread-id turn");
  const db = openDb();
  // A thread exists whose id we did NOT supply, and it carries the message.
  const row = db.query("SELECT thread_id FROM messages WHERE content = 'no-thread-id turn' LIMIT 1").get() as { thread_id: string } | null;
  expect(row).not.toBeNull();
  expect(typeof row!.thread_id).toBe("string");
  db.close();
});

test("DoD#3b — non-UUID garbage thread_id is NOT adopted → fresh daemon mint, no crash", async () => {
  const garbage = "not-a-uuid-😈-../../etc";
  await runTurn("garbage-id turn", garbage); // must not crash the daemon
  const db = openDb();
  // No thread row with the garbage id was created.
  const garbageRow = db.query("SELECT 1 FROM threads WHERE thread_id = ?").get(garbage);
  expect(garbageRow).toBeNull();
  // The message landed in a freshly-minted (UUID) thread instead.
  const msgRow = db.query("SELECT thread_id FROM messages WHERE content = 'garbage-id turn' LIMIT 1").get() as { thread_id: string } | null;
  expect(msgRow).not.toBeNull();
  expect(msgRow!.thread_id).not.toBe(garbage);
  db.close();
});

test("DoD#4 — adopted-id FIRST turn still runs the MF-02 cross-thread retrieve() injection", async () => {
  // Real store + real DumbTailProvider (matches thread-lifecycle.test.ts injection pattern).
  const dir = mkdtempSync(join(tmpdir(), "cm01-mf02-"));
  const store = new MemoryStore({ dataDir: dir });
  const provider = new DumbTailProvider();
  const lifecycle = new ThreadLifecycle(store, new WriteGate(store, new RuleBasedScanner()), provider);

  // Thread A: state a fact and distill it via the registration path (simulating a prior dismiss).
  // v2-03: distill() now returns DistillDelta; use registerDistiller + hook.dismiss instead of
  //        the old provider.distill(store, tA) + store.insertDistilledFacts(result.facts, ...).
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, provider, new RuleBasedScanner());
  const tA = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "deploy is yeet.sh" }], "sa");
  await hook.dismiss([tA]);

  // Thread B: a FIRST turn that ADOPTS a fresh client UUID (unknown to the store).
  const adoptId = crypto.randomUUID();
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi", thread_id: adoptId });

  // The adopted id is used verbatim AND the cross-thread slice was injected.
  expect(begin.threadId).toBe(adoptId);
  expect(store.threadExists(adoptId)).toBe(true);
  expect(begin.priorMessages).toContainEqual({ role: "user", content: "[remembered] deploy is yeet.sh" });
  store.close();
});

test("EDGE — session_start{thread_id} of a status=dismissed thread hydrates and continues (current behavior, asserted deliberately; status semantics are chunk-03 territory)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cm01-dismissed-"));
  const store = new MemoryStore({ dataDir: dir });
  const lifecycle = new ThreadLifecycle(store, new WriteGate(store, new RuleBasedScanner()));

  // Create a thread, give it a message, then flip status to dismissed directly
  // (we are NOT testing the dismiss caller here — just the post-dismiss read).
  const tid = store.createThread();
  store.appendMessages(tid, [{ role: "user", content: "remembered turn" }], "s1");
  store.rawDb().query("UPDATE threads SET status = 'dismissed' WHERE thread_id = ?").run(tid);

  // A later session_start with that same id: beginTurn keys on threadExists (no
  // status filter), so it HYDRATES and CONTINUES — does NOT mint a fresh thread.
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "again", thread_id: tid });
  expect(begin.threadId).toBe(tid); // continued the dismissed thread, not minted anew
  expect(begin.priorMessages).toEqual([{ role: "user", content: "remembered turn" }]); // hydrated
  // Status is NOT flipped back by a read — deliberately unchanged (chunk-03 owns reset).
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(tid) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});

// ─── Adversarial thread-adoption tests (Step 3, DoD #4) ──────────────────────
//
// ADR-0014 regret-(a) rider: the connection gate IS the caller-auth gate.
// A tokenless or bad-token client cannot reach session_start / adopt a thread_id.
// These tests prove the rider is discharged at the WS upgrade level — the rejected
// client never gets to send a single frame, so no thread row can be created.
//
// Real sockets against the real startDaemon (Strike-4 discipline).

test("adversarial (DoD#4-a): tokenless client is rejected before upgrade — no thread row created", async () => {
  // Count existing thread rows BEFORE the attack attempt.
  const db1 = openDb();
  const before = (db1.query("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n;
  db1.close();

  // Tokenless client: valid Origin, no protocols. The daemon must reject at the WS gate.
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } }); // no protocols
  const rejected = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(false)); // must NOT open
    ws.addEventListener("error", () => resolve(true));
    ws.addEventListener("close", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });

  // Layer-1 gate must have rejected the upgrade.
  expect(rejected).toBe(true);

  // No thread row was created (the client never reached session_start / adoption).
  const db2 = openDb();
  const after = (db2.query("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n;
  db2.close();
  expect(after).toBe(before);
});

test("adversarial (DoD#4-b): bad-token client is rejected before upgrade — no thread row created", async () => {
  // Count existing thread rows BEFORE the attack attempt.
  const db1 = openDb();
  const before = (db1.query("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n;
  db1.close();

  // Bad-token client: valid Origin, wrong 64-char hex token.
  const badToken = "b".repeat(64); // same length as a real token, wrong value
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN }, protocols: [badToken] });
  const rejected = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(false)); // must NOT open
    ws.addEventListener("error", () => resolve(true));
    ws.addEventListener("close", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });

  // Layer-1 gate must have rejected the upgrade.
  expect(rejected).toBe(true);

  // No thread row was created by the rejected client.
  const db2 = openDb();
  const after = (db2.query("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n;
  db2.close();
  expect(after).toBe(before);
});
