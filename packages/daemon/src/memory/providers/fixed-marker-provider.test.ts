import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "../store.js";
import { WriteGate } from "../write-gate.js";
import { FixedMarkerProvider } from "./fixed-marker-provider.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "mf02-fm-"));
  return { store: new MemoryStore({ dataDir: dir }) };
}

const provider = new FixedMarkerProvider();

test("FixedMarkerProvider.id is 'fixed-marker'", () => {
  expect(provider.id).toBe("fixed-marker");
});

test("FixedMarkerProvider.distill emits exactly ONE fact with confidence=0.5 and provenance 'thread:<tid>'", async () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "hello" }], "s1");
  store.appendMessages(t, [{ role: "user", content: "world" }], "s2");
  const r = await provider.distill(store, t);
  expect(r.threadId).toBe(t);
  expect(r.facts.length).toBe(1);
  expect(r.facts[0]!.confidence).toBe(0.5);
  expect(r.facts[0]!.provenance).toBe(`thread:${t}`);
  expect(r.facts[0]!.scope).toBe("cross-thread");
  expect(r.facts[0]!.authored_by).toBe("machine");
  store.close();
});

test("FixedMarkerProvider.distill counts only non-tombstoned messages", async () => {
  const { store } = freshStore();
  const gate = new WriteGate(store);
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "alive" }], "s1");
  const [deadId] = store.appendMessages(t, [{ role: "user", content: "forgotten" }], "s2");
  gate.forget(deadId!, { actor: "user", authored_by: "human" });
  const r = await provider.distill(store, t);
  expect(r.facts.length).toBe(1);
  // Only 1 live message (the tombstoned one is not counted)
  expect(r.facts[0]!.fact).toContain("1 live message");
  store.close();
});

test("FixedMarkerProvider.distill fact includes the thread id and live count", async () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "a" }], "s1");
  store.appendMessages(t, [{ role: "user", content: "b" }], "s2");
  store.appendMessages(t, [{ role: "user", content: "c" }], "s3");
  const r = await provider.distill(store, t);
  expect(r.facts[0]!.fact).toBe(`thread:${t} has 3 live messages`);
  store.close();
});

test("FixedMarkerProvider.distill emits ONE fact even for an empty thread", async () => {
  const { store } = freshStore();
  const t = store.createThread();
  const r = await provider.distill(store, t);
  expect(r.facts.length).toBe(1);
  expect(r.facts[0]!.fact).toBe(`thread:${t} has 0 live messages`);
  store.close();
});

test("FixedMarkerProvider.retrieve has the same projection-read contract as DumbTail (provider-agnostic inject)", async () => {
  const { store } = freshStore();
  store.insertDistilledFacts(
    [{ fact: "some fact", provenance: "m-1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  const t = store.createThread();
  const slice = await provider.retrieve(store, t);
  expect(slice).toEqual([{ role: "user", content: "[remembered] some fact" }]);
  store.close();
});

test("FixedMarkerProvider.retrieve skips tombstoned-provenance facts (defense-in-depth)", async () => {
  const { store } = freshStore();
  const gate = new WriteGate(store);
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "secret" }], "s1");
  store.insertDistilledFacts(
    [{ fact: "secret", provenance: mid!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  gate.forget(mid!, { actor: "user", authored_by: "human" });
  const slice = await provider.retrieve(store, t);
  expect(slice.length).toBe(0);
  store.close();
});
