import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { registerDistiller } from "./distiller-registration.js";
import { DumbTailProvider } from "./providers/dumb-tail-provider.js";

const dumbTailProvider = new DumbTailProvider();

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "mf02-dreg-"));
  return { store: new MemoryStore({ dataDir: dir }) };
}

test("registered distiller writes distilled_facts AND a distillation_events row on dismiss", async () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, dumbTailProvider);
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "deploy is yeet.sh" }], "s1");
  await hook.dismiss(t);
  expect(store.readDistilledFacts(10).some((f) => f.fact === "deploy is yeet.sh")).toBe(true);
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(evs[0]!.facts_produced).toBe(1);
  store.close();
});

test("dismiss of an EMPTY thread still writes a distillation_events row with 0 facts (5b — observable even when nothing retained)", async () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, dumbTailProvider);
  const t = store.createThread();
  await hook.dismiss(t);
  expect(store.readDistilledFacts(10).length).toBe(0);
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(evs[0]!.facts_produced).toBe(0);
  store.close();
});
