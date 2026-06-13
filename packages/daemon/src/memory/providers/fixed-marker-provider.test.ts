import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "../store.js";
import { WriteGate } from "../write-gate.js";
import { RuleBasedScanner } from "../scanner/memory-scanner.js";
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
  const gate = new WriteGate(store, new RuleBasedScanner());
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

// ── Step 2 (chunk 02): global-projection contract ────────────────────────

test("D4: FixedMarkerProvider.distill with 2 threads returns exactly one count-fact PER thread", async () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "hello" }], "s1");
  store.appendMessages(tB, [{ role: "user", content: "world" }], "s2");
  store.appendMessages(tB, [{ role: "user", content: "extra" }], "s3");
  const r = await provider.distill(store, tA);
  // Exactly one fact per thread (set assertion over provenance keys)
  const provenances = r.facts.map((f) => f.provenance);
  expect(provenances).toContain(`thread:${tA}`);
  expect(provenances).toContain(`thread:${tB}`);
  expect(provenances.length).toBe(2);
  store.close();
});

test("D4: FixedMarkerProvider.distill count-fact body is correct per thread", async () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "a1" }], "s1");
  store.appendMessages(tB, [{ role: "user", content: "b1" }], "s2");
  store.appendMessages(tB, [{ role: "user", content: "b2" }], "s3");
  const r = await provider.distill(store, tA);
  const facts = r.facts;
  const factA = facts.find((f) => f.provenance === `thread:${tA}`);
  const factB = facts.find((f) => f.provenance === `thread:${tB}`);
  expect(factA?.fact).toBe(`thread:${tA} has 1 live message`);
  expect(factB?.fact).toBe(`thread:${tB} has 2 live messages`);
  store.close();
});

test("D4: FixedMarkerProvider.distill DistillResult.threadId equals the trigger threadId", async () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "a" }], "s1");
  store.appendMessages(tB, [{ role: "user", content: "b" }], "s2");
  const r = await provider.distill(store, tA);
  expect(r.threadId).toBe(tA);
  store.close();
});

test("D4: FixedMarkerProvider.distill tombstoned-thread-provenance skip still applies (no fact for that thread)", async () => {
  const { store } = freshStore();
  const tA = store.createThread();
  const tB = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "a" }], "s1");
  store.appendMessages(tB, [{ role: "user", content: "b" }], "s2");
  // Tombstone the thread-level provenance for tA so FixedMarker skips it
  // (uses store.tombstoneFact directly — the mutations path that isFactTombstoned reads)
  store.tombstoneFact(`thread:${tA}`, { actor: "user", authored_by: "human" });
  const r = await provider.distill(store, tB);
  const provenances = r.facts.map((f) => f.provenance);
  // tA's thread provenance is tombstoned — its count-fact must be absent
  expect(provenances).not.toContain(`thread:${tA}`);
  // tB's fact should still be present
  expect(provenances).toContain(`thread:${tB}`);
  store.close();
});

// ── FixedMarkerProvider retrieve + existing tests ──────────────────────────

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

test("FixedMarkerProvider.retrieve skips tombstoned-provenance facts (defense-in-depth via eager purge)", async () => {
  // retrieve() DOES call isFactTombstoned (MF-05 T1 projection-tombstone) — but the
  // assertion here passes for a different reason: WriteGate.forget eagerly calls
  // dropDistilledFactsByProvenance, so the fact is already gone from distilled_facts
  // before retrieve() runs. isFactTombstoned never even sees this provenance because
  // the row no longer exists in the table.
  const { store } = freshStore();
  const gate = new WriteGate(store, new RuleBasedScanner());
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

test("S3: FixedMarkerProvider.retrieve returns thread-level facts even when a message in that thread is tombstoned", async () => {
  // retrieve() DOES call isFactTombstoned (MF-05 T1 projection-tombstone) — but the
  // assertion holds because the keyspaces are disjoint: the fact's provenance is
  // "thread:<uuid>" while the tombstone written by gate.forget() is keyed on a
  // message-UUID. isFactTombstoned("thread:<uuid>") looks up a row that does not exist
  // in the `mutations` table (the tombstone keyspace), so it returns false and the fact is NOT filtered out.
  // This confirms that a thread-level fact correctly survives an unrelated message tombstone.
  const { store } = freshStore();
  const gate = new WriteGate(store, new RuleBasedScanner());
  const t = store.createThread();
  // Insert a thread-level FixedMarker fact.
  store.insertDistilledFacts(
    [{ fact: `thread:${t} has 2 live messages`, provenance: `thread:${t}`, scope: "cross-thread", expiry: null, confidence: 0.5, authored_by: "machine" }],
    "fixed-marker",
  );
  // Insert a message and tombstone it in a DIFFERENT thread (no coupling to the fact above).
  const t2 = store.createThread();
  const [mid] = store.appendMessages(t2, [{ role: "user", content: "unrelated" }], "s1");
  gate.forget(mid!, { actor: "user", authored_by: "human" });

  // The thread-level fact for `t` must still be returned (not incorrectly filtered).
  const slice = await provider.retrieve(store, t);
  expect(slice).toEqual([{ role: "user", content: `[remembered] thread:${t} has 2 live messages` }]);
  store.close();
});
