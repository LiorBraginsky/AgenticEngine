import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore, type InsertFactInput } from "../store.js";
import { WriteGate } from "../write-gate.js";
import { RuleBasedScanner } from "../scanner/memory-scanner.js";
import { EmbeddingDrain } from "./embedding-drain.js";
import { FixtureEmbeddingProvider } from "./fixture-embedding-provider.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "hybrid-03-drain-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, gate: new WriteGate(store, new RuleBasedScanner()), dir };
}

const CTX = { actor: "user", authored_by: "human" as const };

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

/** A provider stub that never resolves — used to prove a null provider (or a
 *  null-returning embed()) never throws and leaves rows pending. */
function nullEmbedProvider(): EmbeddingProvider {
  return {
    id: "test-null",
    modelId: "test-null-model",
    dims: 4,
    embed: async () => null,
  };
}

// ── Lexical-only degrade ──────────────────────────────────────────────────────────────

test("a null provider: kick() and drain() are no-ops (no throw, 0 embedded); a fact stays pending", async () => {
  const { store } = fresh();
  store.insertFact(baseFact(), "dumb-tail");

  const drain = new EmbeddingDrain(store, null);
  expect(() => drain.kick()).not.toThrow();
  const result = await drain.drain();
  expect(result).toEqual({ factsEmbedded: 0, messagesEmbedded: 0 });

  expect(store.pendingFactEmbeddings("anything", 10).length).toBe(1);
  store.close();
});

test("a provider whose embed() returns null: drain() leaves rows pending, no throw", async () => {
  const { store } = fresh();
  const id = store.insertFact(baseFact(), "dumb-tail");
  const provider = nullEmbedProvider();

  const drain = new EmbeddingDrain(store, provider);
  const result = await expect(drain.drain()).resolves.toEqual({ factsEmbedded: 0, messagesEmbedded: 0 });
  void result;
  expect(store.pendingFactEmbeddings(provider.modelId, 10).map((r) => r.id)).toContain(id);
  store.close();
});

// ── Happy path ─────────────────────────────────────────────────────────────────────────

test("drain() embeds every pending fact and message in one pass", async () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [
    { role: "user", content: "one" },
    { role: "user", content: "two" },
  ], "s1", CTX);
  store.insertFact(baseFact({ fact: "a", canonical: "a" }), "dumb-tail");
  store.insertFact(baseFact({ fact: "b", canonical: "b" }), "dumb-tail");
  store.insertFact(baseFact({ fact: "c", canonical: "c" }), "dumb-tail");

  const provider = new FixtureEmbeddingProvider();
  const drain = new EmbeddingDrain(store, provider);
  const result = await drain.drain();

  expect(result).toEqual({ factsEmbedded: 3, messagesEmbedded: 2 });
  expect(store.pendingFactEmbeddings(provider.modelId, 10)).toEqual([]);
  expect(store.pendingMessageEmbeddings(provider.modelId, 10)).toEqual([]);
  store.close();
});

// ── Scrub-mid-drain interleave (the headline test, spec [grill #1]) ───────────────────

test(
  "scrub-mid-drain interleave: a message scrubbed via WriteGate.forget between the drain's " +
    "scan and its upsert gets NO message_embeddings/message_fts row (RED without the store's " +
    "in-tx re-check)",
  async () => {
    const { store, gate } = fresh();
    const t = store.createThread();
    const [keepId, scrubId] = gate.appendTurn(
      t,
      [
        { role: "user", content: "keep me safe" },
        { role: "user", content: "scrub me please" },
      ],
      "s1",
      CTX,
    );

    let scrubbed = false;
    const provider = new FixtureEmbeddingProvider({
      onEmbed: () => {
        // Fires at the top of embed() — i.e. exactly between the drain's pending-scan
        // (which already read scrubId's content) and its upsert. Simulates the scrub
        // landing in that window. Only the FIRST call scrubs (facts run first in the
        // drain but this store has no facts, so the first embed() call is for messages).
        if (!scrubbed) {
          scrubbed = true;
          gate.forget(scrubId!, CTX, "race test");
        }
      },
    });

    const drain = new EmbeddingDrain(store, provider);
    await drain.drain();

    const db = store.rawDb();
    const scrubEmb = db.query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id = ?").get(scrubId!) as { n: number };
    const scrubFts = db.query("SELECT COUNT(*) AS n FROM message_fts WHERE message_id = ?").get(scrubId!) as { n: number };
    expect(scrubEmb.n).toBe(0);
    expect(scrubFts.n).toBe(0);

    const keepEmb = db.query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id = ?").get(keepId!) as { n: number };
    expect(keepEmb.n).toBe(1);
    store.close();
  },
);

// ── Restart-safety ("pending is a query") ───────────────────────────────────────────────

test("restart-safety: a fresh drain over the same store finishes what a killed-mid-batch drain left pending", async () => {
  const { store } = fresh();
  const t = store.createThread();
  const messages = Array.from({ length: 6 }, (_, i) => ({ role: "user" as const, content: `msg-${i}` }));
  const gate = new WriteGate(store, new RuleBasedScanner());
  gate.appendTurn(t, messages, "s1", CTX);

  const MODEL_ID = "restart-fixture";
  let embedCalls = 0;
  // Dies after its first batch: real fixture vectors once, then null forever after —
  // simulating a crash/kill mid-drain (the second+ batch never gets written).
  const dyingProvider: EmbeddingProvider = {
    id: "dying",
    modelId: MODEL_ID,
    dims: 8,
    embed: async (texts: string[]) => {
      embedCalls++;
      if (embedCalls > 1) return null;
      const real = new FixtureEmbeddingProvider({ modelId: MODEL_ID });
      return real.embed(texts);
    },
  };

  const killedDrain = new EmbeddingDrain(store, dyingProvider, { batchSize: 2 });
  await killedDrain.drain();
  const stillPendingAfterKill = store.pendingMessageEmbeddings(MODEL_ID, 100);
  expect(stillPendingAfterKill.length).toBeGreaterThan(0); // proves the kill actually left work behind

  // A FRESH EmbeddingDrain instance (simulating a daemon restart), same store, a normal
  // (non-dying) fixture provider under the SAME modelId — "pending" is re-derived purely
  // from the store's scan, with no persisted queue to have lost.
  const freshDrain = new EmbeddingDrain(store, new FixtureEmbeddingProvider({ modelId: MODEL_ID }));
  await freshDrain.drain();
  expect(store.pendingMessageEmbeddings(MODEL_ID, 100)).toEqual([]);
  store.close();
});

// ── kick() debounce ─────────────────────────────────────────────────────────────────────

test("kick() coalesces rapid calls into one debounced drain that eventually embeds pending work", async () => {
  const { store } = fresh();
  store.insertFact(baseFact(), "dumb-tail");
  const provider = new FixtureEmbeddingProvider();
  const drain = new EmbeddingDrain(store, provider, { debounceMs: 5 });

  drain.kick();
  drain.kick();
  drain.kick();

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(store.pendingFactEmbeddings(provider.modelId, 10)).toEqual([]);
  store.close();
});
