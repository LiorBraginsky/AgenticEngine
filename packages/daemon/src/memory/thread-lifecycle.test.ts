import { test, expect, spyOn } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { ThreadLifecycle } from "./thread-lifecycle.js";
import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { registerDistiller } from "./distiller-registration.js";

const dumbTailProvider = new DumbTailProvider();

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-tl-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, lifecycle: new ThreadLifecycle(store, new WriteGate(store, new RuleBasedScanner())) };
}

function freshTL() {
  const dir = mkdtempSync(join(tmpdir(), "mf02-tl-"));
  const store = new MemoryStore({ dataDir: dir });
  const lifecycle = new ThreadLifecycle(store, new WriteGate(store, new RuleBasedScanner()), dumbTailProvider);
  return { store, lifecycle };
}

test("no thread_id mints a NEW thread; prior tail is empty (single-turn = degenerate one-turn thread)", async () => {
  const { lifecycle } = fresh();
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
  expect(typeof begin.threadId).toBe("string");
  expect(begin.priorMessages).toEqual([]);
});

test("unknown thread_id ALSO mints a new thread (graceful, never throws)", async () => {
  const { lifecycle } = fresh();
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi", thread_id: "does-not-exist" });
  expect(begin.threadId).not.toBe("does-not-exist");
  expect(begin.priorMessages).toEqual([]);
});

test("turn 1 flush → turn 2 with that thread_id hydrates turn-1's messages (within-thread multi-turn)", async () => {
  const { lifecycle } = fresh();
  const t1 = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "deploy is yeet.sh" });
  lifecycle.endTurn(t1.threadId, "sess-1", [{ role: "user", content: "deploy is yeet.sh" }]);
  const t2 = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "what's the deploy?", thread_id: t1.threadId });
  expect(t2.threadId).toBe(t1.threadId);
  expect(t2.priorMessages).toEqual([{ role: "user", content: "deploy is yeet.sh" }]);
});

test("session_id→thread_id mapping resolves later turns, then is cleaned up", async () => {
  const { lifecycle } = fresh();
  const t = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "x" });
  lifecycle.bindSession("sess-9", t.threadId, 0);
  expect(lifecycle.threadForSession("sess-9")).toBe(t.threadId);
  lifecycle.endTurn(t.threadId, "sess-9", [{ role: "user", content: "x" }]);
  expect(lifecycle.threadForSession("sess-9")).toBeUndefined();
});

test("endTurn flushes only the DELTA (new messages this turn), not the hydrated prefix (Finding 1 — double-persist guard)", async () => {
  // This test reproduces the reviewer's proof: two turns on the same thread must
  // produce EXACTLY 2 rows, not 3 (where turn-1's message appears at turn_index 0 AND 1).
  const { store, lifecycle } = fresh();

  // Turn 1: single-turn (no prior tail) — flush 1 message.
  const t1 = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "deploy is yeet.sh" });
  // bindSession stores hydratedCount=0 (no prior on turn 1).
  lifecycle.bindSession("s1", t1.threadId, t1.priorMessages.length);
  // finalMessages as the provider would return: just the 1 new message.
  lifecycle.endTurn(t1.threadId, "s1", [{ role: "user", content: "deploy is yeet.sh" }]);

  // Turn 2: reuse thread — provider returns hydrated tail PLUS new turn.
  const t2 = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "what's the deploy?", thread_id: t1.threadId });
  expect(t2.priorMessages).toEqual([{ role: "user", content: "deploy is yeet.sh" }]); // hydrated
  lifecycle.bindSession("s2", t2.threadId, t2.priorMessages.length); // hydratedCount=1
  // Provider re-attaches the hydrated tail + appends the new turn → finalMessages has 2 entries.
  const finalMessages = [...t2.priorMessages, { role: "user" as const, content: "what's the deploy?" }];
  lifecycle.endTurn(t2.threadId, "s2", finalMessages);

  // After two turns the thread must have EXACTLY 2 rows (not 3).
  const tail = store.readThreadTail(t1.threadId, 10);
  expect(tail).toEqual([
    { role: "user", content: "deploy is yeet.sh" },
    { role: "user", content: "what's the deploy?" },
  ]);
});

// ---- MF-02 Step 3: injection-point tests ----

test("a NEW thread is injected with the cross-thread distilled slice (injection-point)", async () => {
  const { store, lifecycle } = freshTL();
  // Thread A: state a fact, then distill it via the registration path (simulating a prior dismiss).
  // v2-03: distill() now returns DistillDelta; use registerDistiller + hook.dismiss instead of
  //        the old dumbTailProvider.distill(store, tA) + store.insertDistilledFacts(result.facts, ...).
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, dumbTailProvider, new RuleBasedScanner());
  const tA = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "deploy is yeet.sh" }], "sa");
  await hook.dismiss([tA]);
  // Thread B: a fresh session_start with NO thread_id mints B and injects A's fact.
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
  expect(begin.priorMessages).toContainEqual({ role: "user", content: "[remembered] deploy is yeet.sh" });
});

test("injected cross-thread slice is NOT re-persisted into the new thread (delta-flush guard)", async () => {
  const { store, lifecycle } = freshTL();
  // Thread A: state a fact, distill it via registration path.
  // v2-03: distill() now returns DistillDelta; use registerDistiller + hook.dismiss instead of
  //        the old dumbTailProvider.distill(store, tA) + store.insertDistilledFacts(result.facts, ...).
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, dumbTailProvider, new RuleBasedScanner());
  const tA = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "fact A" }], "sa");
  await hook.dismiss([tA]);
  // Thread B: beginTurn injects A's distilled fact into priorMessages.
  const b = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
  lifecycle.bindSession("sb", b.threadId, b.priorMessages.length);
  // Provider re-attaches injected prefix + appends the user turn.
  lifecycle.endTurn(b.threadId, "sb", [...b.priorMessages, { role: "user", content: "hi" }]);
  // Only the delta ("hi") must be persisted — the injected slice is read-only context.
  const persisted = store.readThreadTail(b.threadId, 50).map((m) => m.content);
  expect(persisted).toEqual(["hi"]);
});

// ---- Task 3 Q1: role-derived authorship in endTurn ----

test("Q1: endTurn stamps role=user messages as human-authored and role=assistant as machine-authored", async () => {
  const { store, lifecycle } = fresh();
  const t = store.createThread();
  lifecycle.bindSession("sq1", t, 0);
  lifecycle.endTurn(t, "sq1", [
    { role: "user", content: "user turn" },
    { role: "assistant", content: "assistant turn" },
  ]);
  // Confirm user message is NOT quarantined (clean content, human-authored)
  const rows = store.rawDb().query("SELECT id, role FROM messages WHERE thread_id = ? ORDER BY turn_index ASC").all(t) as { id: string; role: string }[];
  expect(rows).toHaveLength(2);
  const userMsg = rows.find((r) => r.role === "user")!;
  const assistantMsg = rows.find((r) => r.role === "assistant")!;
  expect(store.isMessageQuarantined(userMsg.id)).toBe(false);
  expect(store.isMessageQuarantined(assistantMsg.id)).toBe(false);
  // Both messages must be stored (content correct)
  const tail = store.readThreadTail(t, 10);
  expect(tail).toEqual([
    { role: "user", content: "user turn" },
    { role: "assistant", content: "assistant turn" },
  ]);
  store.close();
});

// ---- v2-07 Step 3.5: whenIdle timeout-branch (proceed-not-hang) ----

test("v2-07: whenIdle that never resolves times out and beginTurn still resolves (proceed-not-hang)", async () => {
  // Construct ThreadLifecycle with a short timeout (20ms) and a whenIdle that NEVER resolves.
  // Assert: console.error is called with the timeout message, AND beginTurn resolves
  // (proceed-not-hang) with the retrieved priorMessages (empty, as there are no prior facts).
  const dir = mkdtempSync(join(tmpdir(), "mf01-tl-timeout-"));
  const store = new MemoryStore({ dataDir: dir });
  const gate = new WriteGate(store, new RuleBasedScanner());

  // whenIdle that NEVER resolves (simulates an in-flight distill that hangs)
  const neverIdle = () => new Promise<void>(() => { /* intentionally never resolves */ });

  // Pass whenIdleTimeoutMs=20 to the constructor (the optional 5th param)
  const lifecycle = new ThreadLifecycle(store, gate, undefined, neverIdle, 20);

  const errSpy = spyOn(console, "error").mockImplementation(() => {});

  let resolved = false;
  const beginPromise = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hello" })
    .then((result) => { resolved = true; return result; });

  const result = await beginPromise;

  // Must have resolved (proceed-not-hang)
  expect(resolved).toBe(true);

  // priorMessages is the retrieved slice (empty — no distilled facts in this fresh store)
  expect(Array.isArray(result.priorMessages)).toBe(true);

  // console.error must have been called with the timeout message
  const errorCalls = errSpy.mock.calls;
  const timeoutLogFound = errorCalls.some((call) =>
    typeof call[0] === "string" && call[0].includes("whenIdle timed out"),
  );
  expect(timeoutLogFound).toBe(true);

  errSpy.mockRestore();
  store.close();
});
