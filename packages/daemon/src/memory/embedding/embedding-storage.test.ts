import { test, expect, spyOn } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore, type InsertFactInput } from "../store.js";
import { WriteGate } from "../write-gate.js";
import { RuleBasedScanner } from "../scanner/memory-scanner.js";
import { encodeVector } from "./vector-codec.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "hybrid-03-storage-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, gate: new WriteGate(store, new RuleBasedScanner()), dir };
}

const CTX = { actor: "user", authored_by: "human" as const };
const MODEL_A = "fixture-v1";
const MODEL_B = "other-model";
const DIMS = 4;

function vec(seed: number): Uint8Array {
  return encodeVector(new Float32Array([seed, seed + 1, seed + 2, seed + 3]));
}

function baseFact(overrides: Partial<InsertFactInput> = {}): InsertFactInput {
  return {
    fact: "deploy is yeet.sh",
    canonical: "deploy is yeet.sh",
    provenance: "m-1",
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
    topics: [],
    ...overrides,
  };
}

// ── Write-time lifecycle ──────────────────────────────────────────────────────────────

test("appendMessages writes message_fts rows synchronously (queryable immediately)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "deploy script is yeet.sh" }], "s1", CTX);
  const row = store.rawDb().query("SELECT message_id, content FROM message_fts WHERE message_id = ?").get(mid!) as { message_id: string; content: string } | null;
  expect(row).not.toBeNull();
  expect(row!.content).toBe("deploy script is yeet.sh");
  store.close();
});

test("insertFact makes the fact appear in pendingFactEmbeddings; upsertFactEmbedding clears it", () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact(), "dumb-tail");
  expect(store.pendingFactEmbeddings(MODEL_A, 10).map((r) => r.id)).toContain(id);

  const result = store.upsertFactEmbedding(id, MODEL_A, DIMS, vec(1));
  expect(result).toBe("written");
  expect(store.pendingFactEmbeddings(MODEL_A, 10).map((r) => r.id)).not.toContain(id);
  store.close();
});

test("an embedding under a DIFFERENT model_id leaves the fact still pending for the current model", () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact(), "dumb-tail");
  store.upsertFactEmbedding(id, MODEL_B, DIMS, vec(1));
  // still pending under MODEL_A — mixed-model rows never satisfy the current model's scan
  expect(store.pendingFactEmbeddings(MODEL_A, 10).map((r) => r.id)).toContain(id);
  store.close();
});

test("upsertFactEmbedding on an absent fact id returns 'skipped'", () => {
  const { store } = fresh();
  const result = store.upsertFactEmbedding("nonexistent-id", MODEL_A, DIMS, vec(1));
  expect(result).toBe("skipped");
  store.close();
});

// ── REPLACE -> pending again ──────────────────────────────────────────────────────────

test("updateFactById deletes the stale fact_embeddings row (REPLACE -> pending again)", () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact(), "dumb-tail");
  store.upsertFactEmbedding(id, MODEL_A, DIMS, vec(1));
  expect(store.pendingFactEmbeddings(MODEL_A, 10).map((r) => r.id)).not.toContain(id);

  store.updateFactById(id, { fact: "deploy is now ship.sh", canonical: "deploy is now ship.sh", confidence: 1, topics: [] }, CTX, "dumb-tail");
  expect(store.pendingFactEmbeddings(MODEL_A, 10).map((r) => r.id)).toContain(id);
  store.close();
});

test("editFactById deletes the stale fact_embeddings row (human REPLACE -> pending again)", () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact(), "dumb-tail");
  store.upsertFactEmbedding(id, MODEL_A, DIMS, vec(1));

  store.editFactById(id, "deploy is now ship.sh", CTX);
  expect(store.pendingFactEmbeddings(MODEL_A, 10).map((r) => r.id)).toContain(id);
  store.close();
});

test("appendToFactById deletes the stale fact_embeddings row (merged list -> pending again)", () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact(), "dumb-tail");
  store.upsertFactEmbedding(id, MODEL_A, DIMS, vec(1));

  const applied = store.appendToFactById(id, "also uses rollback.sh", "deploy is yeet.sh also uses rollback.sh");
  expect(applied).toBe(true);
  expect(store.pendingFactEmbeddings(MODEL_A, 10).map((r) => r.id)).toContain(id);
  store.close();
});

// ── Count-invariants (the M2 pattern) ─────────────────────────────────────────────────

test("deleteFactById leaves zero orphan fact_embeddings rows (the new AFTER DELETE trigger fires)", () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact(), "dumb-tail");
  store.upsertFactEmbedding(id, MODEL_A, DIMS, vec(1));

  store.deleteFactById(id);
  const orphan = store.rawDb().query("SELECT COUNT(*) AS n FROM fact_embeddings WHERE fact_id = ?").get(id) as { n: number };
  expect(orphan.n).toBe(0);
  store.close();
});

test("dropDistilledFactsByProvenance leaves zero orphan fact_embeddings rows", () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact({ provenance: "m-1" }), "dumb-tail");
  store.upsertFactEmbedding(id, MODEL_A, DIMS, vec(1));

  expect(store.dropDistilledFactsByProvenance("m-1")).toBe(1);
  const orphan = store.rawDb().query("SELECT COUNT(*) AS n FROM fact_embeddings").get() as { n: number };
  expect(orphan.n).toBe(0);
  store.close();
});

test("dropDistilledFactsForThread leaves zero orphan fact_embeddings rows", () => {
  const { store } = fresh();
  const t = store.createThread();
  const id = store.insertFact(baseFact({ provenance: `thread:${t}` }), "dumb-tail");
  store.upsertFactEmbedding(id, MODEL_A, DIMS, vec(1));

  expect(store.dropDistilledFactsForThread(t)).toBe(1);
  const orphan = store.rawDb().query("SELECT COUNT(*) AS n FROM fact_embeddings").get() as { n: number };
  expect(orphan.n).toBe(0);
  store.close();
});

test("dropAllDistilledFacts leaves zero orphan fact_embeddings rows", () => {
  const { store } = fresh();
  const id1 = store.insertFact(baseFact({ fact: "a", canonical: "a" }), "dumb-tail");
  const id2 = store.insertFact(baseFact({ fact: "b", canonical: "b" }), "dumb-tail");
  store.upsertFactEmbedding(id1, MODEL_A, DIMS, vec(1));
  store.upsertFactEmbedding(id2, MODEL_A, DIMS, vec(2));

  store.dropAllDistilledFacts();
  const orphan = store.rawDb().query("SELECT COUNT(*) AS n FROM fact_embeddings").get() as { n: number };
  expect(orphan.n).toBe(0);
  store.close();
});

test("deleteMessageDerived removes both message_embeddings and message_fts rows for the id", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "secret token abc" }], "s1", CTX);
  store.upsertMessageEmbedding(mid!, MODEL_A, DIMS, vec(1));

  const beforeEmb = store.rawDb().query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id = ?").get(mid!) as { n: number };
  const beforeFts = store.rawDb().query("SELECT COUNT(*) AS n FROM message_fts WHERE message_id = ?").get(mid!) as { n: number };
  expect(beforeEmb.n).toBe(1);
  expect(beforeFts.n).toBe(1);

  store.deleteMessageDerived(mid!);
  const afterEmb = store.rawDb().query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id = ?").get(mid!) as { n: number };
  const afterFts = store.rawDb().query("SELECT COUNT(*) AS n FROM message_fts WHERE message_id = ?").get(mid!) as { n: number };
  expect(afterEmb.n).toBe(0);
  expect(afterFts.n).toBe(0);
  // NOTE: WriteGate.forget's scrub tx does not yet CALL deleteMessageDerived — that wiring
  // is Task 5 (write-gate.ts). This test proves the primitive itself; the count-invariant
  // through an actual WriteGate.forget scrub belongs in Task 5's suite (plan Step 4.4
  // cross-reference: "the scrub-path assertion can be added here after Task 5, or lives in
  // Task 5's suite").
  store.close();
});

// ── In-tx re-check (the RED-without-recheck proof, spec [grill #1]) ──────────────────

test("upsertMessageEmbedding re-checks tombstone status INSIDE its own tx — a scrubbed message is skipped, not written", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "secret token abc" }], "s1", CTX);

  // First embed BEFORE the scrub — proves the primitive writes normally pre-scrub.
  expect(store.upsertMessageEmbedding(mid!, MODEL_A, DIMS, vec(1))).toBe("written");
  const before = store.rawDb().query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id = ?").get(mid!) as { n: number };
  expect(before.n).toBe(1);

  // Scrub lands (simulating the drain's scan having read the row BEFORE this scrub).
  gate.forget(mid!, CTX, "user requested");

  // A second upsert attempt (as if the drain's stale scan result reached the upsert AFTER
  // the scrub) must be refused — this is the guard that closes the scrub-mid-drain race.
  // Without the in-tx re-check (i.e. an implementation that only did a blind INSERT OR
  // REPLACE), this call would incorrectly re-write a vector of now-scrubbed content and
  // this assertion would fail.
  expect(store.upsertMessageEmbedding(mid!, MODEL_A, DIMS, vec(2))).toBe("skipped");
  const after = store.rawDb().query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id = ?").get(mid!) as { n: number };
  // The pre-scrub vector is untouched by the refused second call (still 1, not 0 — this
  // test only proves the RE-CHECK refuses new writes; the scrub's own cleanup of the
  // pre-existing row is deleteMessageDerived's job, wired in Task 5).
  expect(after.n).toBe(1);
  store.close();
});

test("upsertMessageEmbedding on an absent message id returns 'skipped'", () => {
  const { store } = fresh();
  const result = store.upsertMessageEmbedding("nonexistent-id", MODEL_A, DIMS, vec(1));
  expect(result).toBe("skipped");
  store.close();
});

// ── Raw reads + mixed-model exclusion ─────────────────────────────────────────────────

test("readFactVectors returns only rows for the given model_id and warns on mixed-model exclusion", () => {
  const { store } = fresh();
  const idA1 = store.insertFact(baseFact({ fact: "a", canonical: "a" }), "dumb-tail");
  const idA2 = store.insertFact(baseFact({ fact: "b", canonical: "b" }), "dumb-tail");
  const idB = store.insertFact(baseFact({ fact: "c", canonical: "c" }), "dumb-tail");
  store.upsertFactEmbedding(idA1, MODEL_A, DIMS, vec(1));
  store.upsertFactEmbedding(idA2, MODEL_A, DIMS, vec(2));
  store.upsertFactEmbedding(idB, MODEL_B, DIMS, vec(3));

  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  const rows = store.readFactVectors(MODEL_A);
  expect(rows.map((r) => r.id).sort()).toEqual([idA1, idA2].sort());
  expect(warnSpy).toHaveBeenCalled();
  warnSpy.mockRestore();
  store.close();
});

test("readMessageVectors returns only rows for the given model_id", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [m1] = gate.appendTurn(t, [{ role: "user", content: "one" }], "s1", CTX);
  const [m2] = gate.appendTurn(t, [{ role: "user", content: "two" }], "s2", CTX);
  store.upsertMessageEmbedding(m1!, MODEL_A, DIMS, vec(1));
  store.upsertMessageEmbedding(m2!, MODEL_B, DIMS, vec(2));

  const rows = store.readMessageVectors(MODEL_A);
  expect(rows.map((r) => r.id)).toEqual([m1!]);
  store.close();
});

// ── backfillMessageFts idempotency ────────────────────────────────────────────────────

test("backfillMessageFts inserts missing rows once, is idempotent on a second call, and skips scrubbed messages", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [m1, m2, m3] = gate.appendTurn(
    t,
    [
      { role: "user", content: "keep me one" },
      { role: "user", content: "keep me two" },
      { role: "user", content: "forget me" },
    ],
    "s1",
    CTX,
  );
  gate.forget(m3!, CTX, "user requested");
  // Simulate a pre-chunk-03 store (or a fresh wipe): clear message_fts entirely.
  store.rawDb().exec("DELETE FROM message_fts;");
  expect((store.rawDb().query("SELECT COUNT(*) AS n FROM message_fts").get() as { n: number }).n).toBe(0);

  const first = store.backfillMessageFts();
  expect(first).toBe(2); // m1 + m2 only — m3 is scrubbed
  const ids = (store.rawDb().query("SELECT message_id FROM message_fts").all() as { message_id: string }[]).map((r) => r.message_id).sort();
  expect(ids).toEqual([m1!, m2!].sort());

  const second = store.backfillMessageFts();
  expect(second).toBe(0); // idempotent — nothing left to index
  store.close();
});
