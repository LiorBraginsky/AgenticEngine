/**
 * memory-search-probe — EXECUTED real-API tool-use smoke probe (Strike-5, chunk hybrid-05).
 *
 * Proves the memory_search READ tool end-to-end through the REAL
 *   AnthropicApiProvider.advance() → tool_use(memory_search) → MemoryActionPort.search → HybridRanker → store
 * path, on a REAL sonnet-4-6 API call. TWO scenarios cover BOTH scopes (facts + archive).
 * The ANTHROPIC key resolves INTERNALLY (clientFactory → resolveAnthropicKey); NEVER logged.
 *
 * Invocation:
 *   LLM_PROVIDER=anthropic-api bun run packages/daemon/scripts/memory-search-probe.ts
 *
 * Q1 CONTINGENCY: if the model does NOT call memory_search, print the transcript + exit 1
 * (a sequencing finding for the orchestrator — do NOT mask).
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import { WriteGate } from "../src/memory/write-gate.js";
import { RuleBasedScanner } from "../src/memory/scanner/memory-scanner.js";
import { HybridRanker } from "../src/memory/embedding/hybrid-ranker.js";
import { buildEmbeddingProvider } from "../src/memory/embedding/embedding-provider-selector.js";
import { EmbeddingDrain } from "../src/memory/embedding/embedding-drain.js";
import { MemoryActionPort } from "../src/memory/memory-action-port.js";
import { createAnthropicApiProvider } from "../src/providers/anthropic-api-provider.js";
import type { ProviderSessionState } from "../src/providers/provider.js";

const tmpDir = mkdtempSync(join(tmpdir(), "memory-search-probe-"));
process.on("exit", () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

async function main() {
  console.log("== memory-search-probe (Strike-5, chunk hybrid-05) ==");
  const store = new MemoryStore({ dataDir: tmpDir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(store, scanner);
  const embedding = buildEmbeddingProvider({ dataDir: tmpDir }); // may be null → lexical-only; fine for the tool-loop proof
  const ranker = new HybridRanker(store, embedding);
  store.setFactRanker(ranker);
  const port = new MemoryActionPort(store, gate, scanner, ranker);

  // Seed a fact NOT injected this turn + an archive message, both lexically findable.
  const factId = store.insertFact({ fact: "favorite color blue", canonical: "favorite color blue", topics: [], provenance: "thread:seed", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "probe-seed");
  const t = store.createThread();
  const [msgId] = store.appendMessages(t, [{ role: "user", content: "my project deadline is next Friday" }], "probe-session");
  if (embedding) { await embedding.warmup?.(); await new EmbeddingDrain(store, embedding).drain(); }
  console.log(`[probe] seeded factId=${factId} archiveMsgId=${msgId}`);

  // review-gate FIX 7: track memory_search observation PER SCENARIO (not one OR-accumulated
  // flag) — "both scopes proven" is the PR evidence claim, so it must be genuinely checked per
  // scope, not satisfied by e.g. the archive scenario alone tripping a shared boolean twice.
  let currentScenario: "facts" | "archive" | undefined;
  const scenarioObserved: { facts: boolean; archive: boolean } = { facts: false, archive: false };
  const observed: { name: string; input: unknown }[] = [];
  const provider = createAnthropicApiProvider({
    memoryActionPort: port,
    clientFactory: (apiKey: string) => {
      const real = new Anthropic({ apiKey }); // apiKey NEVER logged
      return { messages: { create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        const last = params.messages[params.messages.length - 1];
        if (last && Array.isArray(last.content)) for (const b of last.content) {
          if (typeof b === "object" && b !== null && "type" in b && b.type === "tool_result") {
            const trb = b as Anthropic.ToolResultBlockParam;
            console.log(`[probe] tool_result → ${typeof trb.content === "string" ? trb.content : JSON.stringify(trb.content)}`);
          }
        }
        const resp = await real.messages.create(params);
        for (const blk of resp.content) {
          if (blk.type === "tool_use") {
            if (blk.name === "memory_search" && currentScenario !== undefined) scenarioObserved[currentScenario] = true;
            observed.push({ name: blk.name, input: blk.input });
            console.log(`[probe] tool_use: ${blk.name} ${JSON.stringify(blk.input)}`);
          }
          if (blk.type === "text" && blk.text) console.log(`[probe] text: ${JSON.stringify(blk.text)}`);
        }
        return resp;
      } } } as unknown as Anthropic;
    },
  });

  // Empty injected slice (the seeded fact is NOT in view) → the agent must SEARCH to answer.
  const emptySlice: ProviderSessionState = { phase: "done", session_id: "", messages: [], memoryActionSlice: { threadId: t, ordinalMap: new Map() } };
  for (const [label, text] of [["facts", "what is my favorite color?"], ["archive", "what did I say about my project deadline?"]] as const) {
    console.log(`\n[probe] scenario ${label}: advance() text=${JSON.stringify(text)}`);
    currentScenario = label;
    const res = await provider.advance(emptySlice, { type: "session_start", trigger: "user", text, client_session_id: "memory-search-probe" });
    if (res.ok) console.log(`[probe] final text: ${JSON.stringify(res.finalText)}`);
  }
  currentScenario = undefined;

  if (!scenarioObserved.facts || !scenarioObserved.archive) {
    console.error("╔═ Q1 CONTINGENCY: the model did NOT call memory_search in BOTH scenarios ═╗");
    console.error(`[probe] facts-scope memory_search observed: ${scenarioObserved.facts}`);
    console.error(`[probe] archive-scope memory_search observed: ${scenarioObserved.archive}`);
    console.error(`[probe] observed tool calls: ${JSON.stringify(observed)}`);
    console.error("[probe] sequencing finding for the orchestrator (self-concept may be under-steering) — NOT masked.");
    store.close(); process.exit(1);
  }
  console.log("\n╔═ PROBE PASSED — a REAL LLM invoked memory_search across fact + archive scopes; results returned framed as UNTRUSTED. ═╗");
  console.log("Paste this stdout into the PR body = Strike-5 EXECUTED evidence (chunk hybrid-05).");
  store.close(); process.exit(0);
}
if (import.meta.main) void main().catch((err) => { console.error(`[probe] PROBE FAILED: ${err instanceof Error ? err.stack : String(err)}`); process.exit(1); });
