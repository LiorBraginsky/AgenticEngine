import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { ThreadLifecycle } from "./thread-lifecycle.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-tl-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, lifecycle: new ThreadLifecycle(store, new WriteGate(store)) };
}

test("no thread_id mints a NEW thread; prior tail is empty (single-turn = degenerate one-turn thread)", () => {
  const { lifecycle } = fresh();
  const begin = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
  expect(typeof begin.threadId).toBe("string");
  expect(begin.priorMessages).toEqual([]);
});

test("unknown thread_id ALSO mints a new thread (graceful, never throws)", () => {
  const { lifecycle } = fresh();
  const begin = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi", thread_id: "does-not-exist" });
  expect(begin.threadId).not.toBe("does-not-exist");
  expect(begin.priorMessages).toEqual([]);
});

test("turn 1 flush → turn 2 with that thread_id hydrates turn-1's messages (within-thread multi-turn)", () => {
  const { lifecycle } = fresh();
  const t1 = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "deploy is yeet.sh" });
  lifecycle.endTurn(t1.threadId, "sess-1", [{ role: "user", content: "deploy is yeet.sh" }]);
  const t2 = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "what's the deploy?", thread_id: t1.threadId });
  expect(t2.threadId).toBe(t1.threadId);
  expect(t2.priorMessages).toEqual([{ role: "user", content: "deploy is yeet.sh" }]);
});

test("session_id→thread_id mapping resolves later turns, then is cleaned up", () => {
  const { lifecycle } = fresh();
  const t = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "x" });
  lifecycle.bindSession("sess-9", t.threadId, 0);
  expect(lifecycle.threadForSession("sess-9")).toBe(t.threadId);
  lifecycle.endTurn(t.threadId, "sess-9", [{ role: "user", content: "x" }]);
  expect(lifecycle.threadForSession("sess-9")).toBeUndefined();
});

test("endTurn flushes only the DELTA (new messages this turn), not the hydrated prefix (Finding 1 — double-persist guard)", () => {
  // This test reproduces the reviewer's proof: two turns on the same thread must
  // produce EXACTLY 2 rows, not 3 (where turn-1's message appears at turn_index 0 AND 1).
  const { store, lifecycle } = fresh();

  // Turn 1: single-turn (no prior tail) — flush 1 message.
  const t1 = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "deploy is yeet.sh" });
  // bindSession stores hydratedCount=0 (no prior on turn 1).
  lifecycle.bindSession("s1", t1.threadId, t1.priorMessages.length);
  // finalMessages as the provider would return: just the 1 new message.
  lifecycle.endTurn(t1.threadId, "s1", [{ role: "user", content: "deploy is yeet.sh" }]);

  // Turn 2: reuse thread — provider returns hydrated tail PLUS new turn.
  const t2 = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "what's the deploy?", thread_id: t1.threadId });
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
