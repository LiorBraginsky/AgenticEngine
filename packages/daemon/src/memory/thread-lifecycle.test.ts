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
  lifecycle.bindSession("sess-9", t.threadId);
  expect(lifecycle.threadForSession("sess-9")).toBe(t.threadId);
  lifecycle.endTurn(t.threadId, "sess-9", [{ role: "user", content: "x" }]);
  expect(lifecycle.threadForSession("sess-9")).toBeUndefined();
});
