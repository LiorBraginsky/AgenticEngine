/**
 * memory-provider-retrieve.daemon.test.ts — chunk 2c-02 retrieve id-exposure (A1).
 *
 * `MemoryProvider.retrieve` widens its return from `SessionMessage[]` to
 * `{ messages, injectedFactIds }` (spec §4 item 1; architect option A1, ORCHESTRATOR
 * RESOLVED Q2). `injectedFactIds` must come from the SAME read of the exact
 * post-filter `live` list that builds `messages` — the "exact injected slice"
 * invariant (spec §3.3 D3b) is structurally guaranteed by construction, never a
 * second read. Re-asserted here on BOTH providers (the swap-proof contract).
 *
 * Real SQLite throughout (mkdtempSync fresh store); the ONLY stub is the LLM
 * clientFactory for SmartDistillerProvider (never invoked by retrieve()).
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { SmartDistillerProvider } from "./providers/smart-distiller-provider.js";
import { REMEMBERED_LABEL } from "../providers/system-prompt.js";
import type Anthropic from "@anthropic-ai/sdk";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "2c02-retrieve-"));
  return new MemoryStore({ dataDir: dir });
}

function echoClient(raw: string): Anthropic {
  return {
    messages: {
      create: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: raw }],
      }),
    },
  } as unknown as Anthropic;
}

function seedTwoCrossThreadFacts(store: MemoryStore, threadId: string): { id1: string; id2: string } {
  const id1 = store.insertFact({
    fact: "deploy is yeet.sh",
    canonical: "deploy is yeet.sh",
    topics: [],
    provenance: `thread:${threadId}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");
  const id2 = store.insertFact({
    fact: "favourite colour is blue",
    canonical: "favourite colour is blue",
    topics: [],
    provenance: `thread:${threadId}`,
    scope: "cross-thread",
    expiry: null,
    confidence: 1,
    authored_by: "machine",
  }, "seed");
  return { id1, id2 };
}

test("DumbTailProvider.retrieve returns {messages, injectedFactIds} — ids match the live list, in the SAME order as messages", async () => {
  const store = freshStore();
  const t = store.createThread();
  const { id1, id2 } = seedTwoCrossThreadFacts(store, t);

  const slice = await new DumbTailProvider().retrieve(store, t);

  // The live list's order is a store-internal detail (most-recently-derived
  // first); this test asserts the invariant that matters here — injectedFactIds
  // is the SAME order as the live list, parallel to messages — not a specific order.
  const liveIds = store.readDistilledFactsForThread(t, 20).map((f) => f.id);
  expect(new Set(liveIds)).toEqual(new Set([id1, id2]));

  expect(slice.injectedFactIds).toEqual(liveIds);
  expect(slice.messages.length).toBe(slice.injectedFactIds.length);
  for (const m of slice.messages) {
    expect(m.content.startsWith(REMEMBERED_LABEL)).toBe(true);
  }

  store.close();
});

test("SmartDistillerProvider.retrieve returns {messages, injectedFactIds} — ids match the live list, in the SAME order as messages", async () => {
  const store = freshStore();
  const t = store.createThread();
  const { id1, id2 } = seedTwoCrossThreadFacts(store, t);

  const provider = new SmartDistillerProvider({ client: echoClient("[]") });
  const slice = await provider.retrieve(store, t);

  // The live list's order is a store-internal detail (most-recently-derived
  // first); this test asserts the invariant that matters here — injectedFactIds
  // is the SAME order as the live list, parallel to messages — not a specific order.
  const liveIds = store.readDistilledFactsForThread(t, 20).map((f) => f.id);
  expect(new Set(liveIds)).toEqual(new Set([id1, id2]));

  expect(slice.injectedFactIds).toEqual(liveIds);
  expect(slice.messages.length).toBe(slice.injectedFactIds.length);
  for (const m of slice.messages) {
    expect(m.content.startsWith(REMEMBERED_LABEL)).toBe(true);
  }

  store.close();
});
