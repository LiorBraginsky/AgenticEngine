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

test("dismissing a thread flips status to 'dismissed' AND invokes the registered handler (batch signature)", async () => {
  const { store, hook } = fresh();
  const t = store.createThread();
  const calls: Array<{ ids: string[]; trigger: string }> = [];
  hook.register((threadIds, triggerThreadId) => { calls.push({ ids: threadIds, trigger: triggerThreadId }); });
  await hook.dismiss([t]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.ids).toEqual([t]);
  expect(calls[0]!.trigger).toBe(t); // triggerThreadId defaults to threadIds[0]
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});

test("default (no registration) dismiss is a no-op pass-through that still flips status", async () => {
  const { store, hook } = fresh();
  const t = store.createThread();
  await expect(hook.dismiss([t])).resolves.toBeUndefined();
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});

test("batch dismiss: multiple threads all get status=dismissed and handler fires ONCE with the full array", async () => {
  const { store, hook } = fresh();
  const t1 = store.createThread();
  const t2 = store.createThread();
  const calls: Array<{ ids: string[]; trigger: string }> = [];
  hook.register((threadIds, triggerThreadId) => { calls.push({ ids: threadIds, trigger: triggerThreadId }); });
  await hook.dismiss([t1, t2], t1);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.ids).toEqual([t1, t2]);
  expect(calls[0]!.trigger).toBe(t1);
  const s1 = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t1) as { status: string }).status;
  const s2 = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t2) as { status: string }).status;
  expect(s1).toBe("dismissed");
  expect(s2).toBe("dismissed");
  store.close();
});

test("distillation_events table exists (schema present; MF-01 writes no rows)", () => {
  const { store } = fresh();
  const count = (store.rawDb().query("SELECT COUNT(*) AS n FROM distillation_events").get() as { n: number }).n;
  expect(count).toBe(0);
  store.close();
});
