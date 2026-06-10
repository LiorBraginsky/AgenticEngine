/**
 * MF-02 real-I/O integration tests — distiller, swap-proof, forget, cross-thread,
 * observable, and lossless integrity. All tests use real SQLite, real daemon, no mocks
 * for store/injection-point/provider (ADR-0010 decision-6: mock provider = permanent
 * test harness for determinism; store and memory logic are real throughout).
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { ThreadLifecycle } from "./thread-lifecycle.js";
import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { FixedMarkerProvider } from "./providers/fixed-marker-provider.js";
import { registerDistiller } from "./distiller-registration.js";

// ─── Shared daemon (tests 5.1, 5.2, 5.3 drive WS turns) ───────────────────
let sharedDataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  sharedDataDir = mkdtempSync(join(tmpdir(), "mf02-int-"));
  process.env.AGENTIC_DATA_DIR = sharedDataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("../index.js");
  server = startDaemon(0);
  PORT = server.port!;
});

afterAll(() => server.stop(true));

/** Drive ONE full mock turn (session_start → tool_result → session_end). */
function runTurn(text: string, threadId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({
        type: "session_start", trigger: "user", text, client_session_id: "c",
        ...(threadId ? { thread_id: threadId } : {}),
      })),
    );
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data as string) as { type: string; session_id?: string; call_id?: string; payload?: { tool?: string; args?: { picker?: { palette?: string[] } } } };
      if (m.type === "tool_call" && m.payload?.tool === "show_color_picker") {
        const pick = m.payload.args?.picker?.palette?.[0] ?? "red";
        ws.send(JSON.stringify({
          type: "tool_result", session_id: m.session_id, call_id: m.call_id,
          payload: { tool: "show_color_picker", result: { picked: pick } },
        }));
      }
      if (m.type === "session_end") { ws.close(); resolve(); }
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
}

// ─── Test 5.1: swap-proof ──────────────────────────────────────────────────

test("swap-proof: re-derive slice with FixedMarker over untouched archive; messages byte-stable", async () => {
  // 1. Drive a WS turn — daemon writes thread + messages to the on-disk DB
  await runTurn("deploy is yeet.sh");

  // 2. Open the same on-disk DB directly; find the thread that was written
  const store = new MemoryStore({ dataDir: sharedDataDir });
  const threadRow = store.rawDb().query("SELECT thread_id FROM threads ORDER BY created_at ASC LIMIT 1").get() as { thread_id: string };
  const threadId = threadRow.thread_id;

  // 3. Directly distill thread A via DumbTail (simulating the consolidation-hook dismiss path).
  //    CM-03 retired the provisional thread-switch trigger; dismiss now fires on close(ws)
  //    (see dismiss-on-close.daemon.test.ts). This store-level distill is the real-I/O proof
  //    that the archive is intact and distillable.
  const dumbTail = new DumbTailProvider();
  const distillResult = await dumbTail.distill(store, threadId);
  store.insertDistilledFacts(distillResult.facts, "dumb-tail");

  // DumbTail emits facts with confidence=1.0 (verbatim content)
  const factsAfterDumbTail = store.readDistilledFacts(50);
  const dumbTailFact = factsAfterDumbTail.find((f) => f.confidence === 1.0);
  expect(dumbTailFact).toBeDefined();
  expect(dumbTailFact!.fact).toBe("deploy is yeet.sh");

  // 4. Snapshot messages before swap (proves archive is untouched)
  const messagesBefore = store.rawDb()
    .query("SELECT id, thread_id, turn_index, role, content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { id: string; thread_id: string; turn_index: number; role: string; content: string }[];

  // 5. Drop distilled_facts and re-derive with FixedMarker (the swap — new provider, new projection)
  store.dropAllDistilledFacts();
  const fixedMarker = new FixedMarkerProvider();
  const swapResult = await fixedMarker.distill(store, threadId);
  store.insertDistilledFacts(swapResult.facts, "fixed-marker");

  // 6. Assert new slice has FixedMarker shape (count-summary, confidence=0.5)
  const swappedFacts = store.readDistilledFacts(50);
  const fmFact = swappedFacts.find((f) => f.provenance === `thread:${threadId}`);
  expect(fmFact).toBeDefined();
  expect(fmFact!.confidence).toBe(0.5);
  expect(fmFact!.fact).toContain(`thread:${threadId}`);
  expect(fmFact!.fact).toContain("live message");

  // 7. Assert messages are byte-identical — swap is read-only over the archive (invariant 3)
  const messagesAfter = store.rawDb()
    .query("SELECT id, thread_id, turn_index, role, content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { id: string; thread_id: string; turn_index: number; role: string; content: string }[];
  expect(messagesAfter).toEqual(messagesBefore);

  store.close();
});

// ─── Test 5.2: forget-survives-re-derive ──────────────────────────────────

test("forget-survives-re-derive: tombstoned fact absent from rebuilt slice and retrieve()", async () => {
  // Use a fresh isolated store (not the shared one) to avoid cross-test contamination
  const dir = mkdtempSync(join(tmpdir(), "mf02-5b-"));
  const store = new MemoryStore({ dataDir: dir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  // 1. Create a thread, append a message, distill it
  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "secret fact" }], "s1");

  // 2. Dismiss → distill → fact is in distilled_facts
  await hook.dismiss(threadId);
  const beforeForget = store.readDistilledFacts(50);
  expect(beforeForget.some((f) => f.fact === "secret fact")).toBe(true);

  // 3. WriteGate.forget on the on-disk store — immediately purges distilled_facts
  gate.forget(mid!, { actor: "user", authored_by: "human" }, "test");
  expect(store.readDistilledFacts(50).some((f) => f.fact === "secret fact")).toBe(false);

  // 4. Re-derive with DumbTail after forget
  store.dropAllDistilledFacts(); // clear any remaining (already empty, but for explicitness)
  const rederive = await dumbTail.distill(store, threadId);
  store.insertDistilledFacts(rederive.facts, "dumb-tail");

  // 5. Assert: rebuilt distilled_facts has NO fact for the tombstoned message
  const rebuilt = store.readDistilledFacts(50);
  expect(rebuilt.some((f) => f.fact === "secret fact")).toBe(false);

  // 6. Assert: retrieve() also returns empty slice (defense-in-depth)
  const slice = await dumbTail.retrieve(store, store.createThread());
  expect(slice.some((m) => m.content.includes("secret fact"))).toBe(false);

  store.close();
});

// ─── Test 5.3: forget-purges-the-LIVE-slice (S2 no-window) ───────────────

test("forget-purges-live-slice: live distilled_facts row gone IMMEDIATELY after forget (S2 no-window)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mf02-5c-"));
  const store = new MemoryStore({ dataDir: dir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  // 1. Create thread, append message
  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "live secret" }], "s1");

  // 2. Dismiss → distill → fact is live in distilled_facts
  await hook.dismiss(threadId);
  expect(store.readDistilledFacts(10).length).toBeGreaterThan(0);
  expect(store.readDistilledFacts(10).some((f) => f.fact === "live secret")).toBe(true);

  // 3. forget — IMMEDIATELY purges distilled_facts before any re-derive
  gate.forget(mid!, { actor: "user", authored_by: "human" }, "S2 test");

  // 4. Assert store.readDistilledFacts is empty BEFORE any re-derive
  expect(store.readDistilledFacts(10).length).toBe(0);

  store.close();
});

// ─── Test 5.4: cross-thread continuity ────────────────────────────────────
// NOTE: test 5.4 is the cross-thread baseline. The MF-04 isolation tests below MUST NOT break it.

test("cross-thread: new thread beginTurn returns prior thread's distilled fact as priorMessages", async () => {
  // Store-level proof (per plan §Step5.4 note: "unit-level assertion on lifecycle.beginTurn
  // over the same on-disk store" — no WS needed for this assertion)
  const dir = mkdtempSync(join(tmpdir(), "mf02-5d-"));
  const store = new MemoryStore({ dataDir: dir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const dumbTail = new DumbTailProvider();
  const lifecycle = new ThreadLifecycle(store, gate, dumbTail);

  // 1. Thread A: append a message, manually distill it (simulating a prior dismiss)
  const threadA = store.createThread();
  store.appendMessages(threadA, [{ role: "user", content: "deploy is yeet.sh" }], "sa");
  const distillResult = await dumbTail.distill(store, threadA);
  store.insertDistilledFacts(distillResult.facts, "dumb-tail");

  // 2. Thread B: a fresh session_start with NO thread_id mints B and injects A's fact
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });

  // 3. Assert: priorMessages contains the injected fact from thread A
  expect(begin.priorMessages).toContainEqual({ role: "user", content: "[remembered] deploy is yeet.sh" });

  // 4. Bonus: assert the injected fact is NOT re-persisted into thread B
  lifecycle.bindSession("sb", begin.threadId, begin.priorMessages.length);
  // Provider sees prior + new message; endTurn flushes ONLY the delta (hydratedCount slice)
  lifecycle.endTurn(begin.threadId, "sb", [...begin.priorMessages, { role: "user", content: "hi" }]);
  const persistedInB = store.readThreadTail(begin.threadId, 50).map((m) => m.content);
  expect(persistedInB).toEqual(["hi"]); // injected slice NOT persisted — only delta

  store.close();
});

// ─── MF-04 Test 5f isolation: thread-local stays home, cross-thread/global cross ──────────────

test("5f isolation: thread-local does NOT cross into B; cross-thread + global DO (DoD #1 + #2)", async () => {
  // Real on-disk SQLite, real store, real providers — only LLM is mocked (ADR-0010 decision-6).
  const dir = mkdtempSync(join(tmpdir(), "mf04-5f-"));
  const store = new MemoryStore({ dataDir: dir });
  const dumbTail = new DumbTailProvider();

  // Create thread A and append a real message (capture midA for message-level provenance)
  const threadA = store.createThread();
  const [midA] = store.appendMessages(threadA, [{ role: "user", content: "private msg" }], "sa");

  // Insert three real rows via the real store — thread-local, cross-thread, global
  store.insertDistilledFacts(
    [
      { fact: "local-only fact", provenance: midA!, scope: "thread-local", expiry: null, confidence: 1, authored_by: "machine" },
      { fact: "deploy is yeet.sh", provenance: midA!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
      { fact: "global note", provenance: midA!, scope: "global", expiry: null, confidence: 1, authored_by: "machine" },
    ],
    "dumb-tail",
  );

  // Create thread B (fresh thread, no messages)
  const threadB = store.createThread();

  // DoD #1: thread-local fact does NOT cross into B
  const sliceB = await dumbTail.retrieve(store, threadB);
  expect(sliceB.some((m) => m.content.includes("local-only fact"))).toBe(false);

  // DoD #2: cross-thread + global DO cross into B
  expect(sliceB.some((m) => m.content.includes("deploy is yeet.sh"))).toBe(true);
  expect(sliceB.some((m) => m.content.includes("global note"))).toBe(true);

  // Own-thread completeness: retrieve for A DOES include the thread-local fact
  const sliceA = await dumbTail.retrieve(store, threadA);
  expect(sliceA.some((m) => m.content.includes("local-only fact"))).toBe(true);

  store.close();
});

test("5f boundary: no raw messages cross — only the distilled+tagged path carries (DoD #3)", async () => {
  // Fresh thread A with messages but ZERO distilled_facts — retrieve for B must return []
  const dir = mkdtempSync(join(tmpdir(), "mf04-raw-"));
  const store = new MemoryStore({ dataDir: dir });
  const dumbTail = new DumbTailProvider();

  const threadA = store.createThread();
  store.appendMessages(threadA, [{ role: "user", content: "undistilled secret" }], "sa");

  const threadB = store.createThread();
  const sliceB = await dumbTail.retrieve(store, threadB);
  // The only cross-thread carrier is the distilled_facts projection, never raw messages
  expect(sliceB).toEqual([]);

  store.close();
});

// ─── Test 5.5: distillation-observable (5b) ──────────────────────────────

test("distillation-observable (5b): dismiss of empty thread writes distillation_events row with 0 facts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mf02-5e-"));
  const store = new MemoryStore({ dataDir: dir });
  const hook = new ConsolidationHook(store);
  const dumbTail = new DumbTailProvider();
  registerDistiller(hook, store, dumbTail, new RuleBasedScanner());

  // 1. Create an empty thread (no messages appended)
  const threadId = store.createThread();

  // 2. Dismiss the empty thread
  await hook.dismiss(threadId);

  // 3. Assert: a distillation_events row exists with facts_produced = 0
  const events = store.readDistillationEvents(threadId);
  expect(events.length).toBe(1);
  expect(events[0]!.facts_produced).toBe(0);
  expect(events[0]!.trigger).toBe("dismiss");

  // Also assert distilled_facts is empty (no facts emitted for empty thread)
  expect(store.readDistilledFacts(10).length).toBe(0);

  store.close();
});

// ─── Test 5.6: lossless integrity ────────────────────────────────────────

test("lossless: distill/re-derive cycle does not alter messages or mutations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mf02-5f-"));
  const store = new MemoryStore({ dataDir: dir });
  const dumbTail = new DumbTailProvider();

  // 1. Create thread with messages
  const threadId = store.createThread();
  store.appendMessages(threadId, [{ role: "user", content: "msg-one" }], "s1");
  store.appendMessages(threadId, [{ role: "user", content: "msg-two" }], "s2");

  // 2. Snapshot messages + mutations before distill cycle
  const db = store.rawDb();
  const messagesBefore = db
    .query("SELECT id, thread_id, turn_index, role, content, session_id FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as object[];
  const mutationsBefore = db
    .query("SELECT id, target_message_id, kind, actor, reason, replacement_content, authored_by FROM mutations ORDER BY created_at")
    .all() as object[];

  // 3. Distill → insert → drop → re-distill cycle
  const r1 = await dumbTail.distill(store, threadId);
  store.insertDistilledFacts(r1.facts, "dumb-tail");
  store.dropAllDistilledFacts();
  const r2 = await dumbTail.distill(store, threadId);
  store.insertDistilledFacts(r2.facts, "dumb-tail");

  // 4. Assert messages snapshot is byte-identical (lossless over distill)
  const messagesAfter = db
    .query("SELECT id, thread_id, turn_index, role, content, session_id FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as object[];
  expect(messagesAfter).toEqual(messagesBefore);

  // 5. Assert mutations snapshot is byte-identical (distill does NOT write mutations)
  const mutationsAfter = db
    .query("SELECT id, target_message_id, kind, actor, reason, replacement_content, authored_by FROM mutations ORDER BY created_at")
    .all() as object[];
  expect(mutationsAfter).toEqual(mutationsBefore);

  // Sanity: second distill produced same facts as first
  expect(r2.facts.length).toBe(r1.facts.length);
  expect(r2.facts.map((f) => f.fact)).toEqual(r1.facts.map((f) => f.fact));

  store.close();
});
