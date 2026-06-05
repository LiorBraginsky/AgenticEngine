import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { ConsolidationHook } from "./consolidation-hook.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-hook-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, hook: new ConsolidationHook(store) };
}

test("dismissing a thread flips status to 'dismissed' AND invokes the registered handler", () => {
  const { store, hook } = fresh();
  const t = store.createThread();
  const calls: string[] = [];
  hook.register((threadId, trigger) => { calls.push(`${threadId}:${trigger}`); });
  hook.dismiss(t);
  expect(calls).toEqual([`${t}:dismiss`]);
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});

test("default (no registration) dismiss is a no-op pass-through that still flips status", () => {
  const { store, hook } = fresh();
  const t = store.createThread();
  expect(() => hook.dismiss(t)).not.toThrow();
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});

test("distillation_events table exists (schema present; MF-01 writes no rows)", () => {
  const { store } = fresh();
  const count = (store.rawDb().query("SELECT COUNT(*) AS n FROM distillation_events").get() as { n: number }).n;
  expect(count).toBe(0);
  store.close();
});
