/**
 * chunk-05 FACT-EDIT — real-I/O 5e + dedup + forget interplay.
 * A human-edited fact must NOT be overwritten, duplicated, or re-derived-over by the next
 * distillation, and forget must still work on it. Real store/WriteGate/registerDistiller;
 * the ONLY mock is a scripted MemoryProvider.distill (Strike-4: no real API call).
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { Hatch } from "./hatch.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { registerDistiller } from "./distiller-registration.js";
import type { MemoryProvider } from "./memory-provider.js";

test("human-edited fact survives re-distill: not overwritten, not duplicated; forget still works", async () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "fe-redistill-")) });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const scanner = new RuleBasedScanner();

  // 1. machine fact
  const factId = store.insertFact({
    fact: "favourite colour blue", canonical: "favourite colour blue",
    provenance: "thread:seed", scope: "cross-thread", expiry: null,
    confidence: 1, authored_by: "machine", topics: ["#preferences"],
  }, "seed");

  // 2. human edits it (via the production Hatch seam) → text + authored_by:human + canonical refreshed
  expect(hatch.editFact(factId, "favourite colour green", { actor: "user", authored_by: "human" }, "hatch-fact-edit")).toBe(true);

  // 3. re-distill: a new thread restates the colour; the scripted distiller emits a REPLACE
  //    targeting the (now human) fact, with a canonical IDENTICAL to the edited display text so
  //    the demote's dedup check deterministically suppresses the re-insert.
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "my favourite colour is green" }], "s1");
  const provider: MemoryProvider = {
    id: "fact-edit-redistill",
    distill: async (s, threadId) => ({
      threadId,
      ops: [{
        op: "replace",
        fact: "favourite colour green",
        canonical: "favourite colour green",        // == the edited fact's stored canonical
        topics: ["#preferences"],
        targetOrdinal: 1,
        expectedTargetText: "favourite colour green", // matches the human fact's current text
      }],
      candidateIds: [factId],
      distilledThroughMarker: s.readThreadMarker(threadId),
      distilledThroughTurn: s.maxTurnIndex(threadId),
    }),
    retrieve: async () => [],
  };
  registerDistiller(hook, store, provider, scanner);
  await hook.dismiss([t]);

  // 4a. never-overwritten / never-re-derived-over (5e demote): row byte-stable
  const row = store.rawDb().query("SELECT id, fact, authored_by FROM distilled_facts WHERE id = ?").get(factId) as { id: string; fact: string; authored_by: string };
  expect(row.fact).toBe("favourite colour green");
  expect(row.authored_by).toBe("human");
  // 4b. not duplicated (dedup-suppress on the demoted insert): exactly ONE colour fact
  const colour = store.rawDb().query("SELECT id FROM distilled_facts WHERE fact LIKE '%colour%'").all() as { id: string }[];
  expect(colour.length).toBe(1);
  // 4c. no distiller REPLACE was recorded (only the human edit's own prior-text audit)
  const replaced = store.readReplacedFacts(factId);
  expect(replaced.length).toBe(1);
  expect(replaced[0]!.replaced_text).toBe("favourite colour blue");

  // 5. forget still works on the edited fact
  hatch.forgetFactById(factId, { actor: "user", authored_by: "human" });
  expect(store.rawDb().query("SELECT id FROM distilled_facts WHERE id = ?").get(factId)).toBeNull();

  store.close();
});
