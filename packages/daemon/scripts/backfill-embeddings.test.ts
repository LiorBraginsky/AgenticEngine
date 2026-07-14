import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore, type InsertFactInput } from "../src/memory/store.js";
import { WriteGate } from "../src/memory/write-gate.js";
import { RuleBasedScanner } from "../src/memory/scanner/memory-scanner.js";
import { FixtureEmbeddingProvider } from "../src/memory/embedding/fixture-embedding-provider.js";
import { runBackfill } from "./backfill-embeddings.js";

const CTX = { actor: "user", authored_by: "human" as const };

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "backfill-embed-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, gate: new WriteGate(store, new RuleBasedScanner()), dir };
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

/** Seeds 2 facts + 3 messages (1 scrubbed), and clears message_fts to simulate a
 *  pre-chunk-03 store (appendMessages already wrote it synchronously — Task 4). */
function seed(store: MemoryStore, gate: WriteGate) {
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
  store.insertFact(baseFact({ fact: "a", canonical: "a" }), "dumb-tail");
  store.insertFact(baseFact({ fact: "b", canonical: "b" }), "dumb-tail");
  store.rawDb().exec("DELETE FROM message_fts;");
  return { m1, m2, m3 };
}

test("runBackfill embeds every pending fact/message, builds fts, and skips the scrubbed message", async () => {
  const { store, gate } = fresh();
  const { m3 } = seed(store, gate);
  const provider = new FixtureEmbeddingProvider();

  const report = await runBackfill(store, provider, { quiet: true });

  expect(report.providerAvailable).toBe(true);
  expect(report.ftsInserted).toBe(2); // m1 + m2 only — m3 is scrubbed
  expect(report.factsEmbedded).toBe(2);
  expect(report.messagesEmbedded).toBe(2);
  expect(report.factsPendingAfter).toBe(0);
  expect(report.messagesPendingAfter).toBe(0);

  const scrubRow = store.rawDb().query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id = ?").get(m3!) as { n: number };
  expect(scrubRow.n).toBe(0);
  store.close();
});

test("runBackfill is idempotent: a second run against the same store reports 0 new rows everywhere", async () => {
  const { store, gate } = fresh();
  seed(store, gate);
  const provider = new FixtureEmbeddingProvider();

  await runBackfill(store, provider, { quiet: true });
  const second = await runBackfill(store, provider, { quiet: true });

  expect(second.ftsInserted).toBe(0);
  expect(second.factsEmbedded).toBe(0);
  expect(second.messagesEmbedded).toBe(0);
  expect(second.factsPendingAfter).toBe(0);
  expect(second.messagesPendingAfter).toBe(0);
  store.close();
});

test("runBackfill with a null provider still builds fts (degrade honesty): providerAvailable=false, 0 embedded", async () => {
  const { store, gate } = fresh();
  seed(store, gate);

  const report = await runBackfill(store, null, { quiet: true });

  expect(report.providerAvailable).toBe(false);
  expect(report.ftsInserted).toBe(2);
  expect(report.factsEmbedded).toBe(0);
  expect(report.messagesEmbedded).toBe(0);
  store.close();
});
