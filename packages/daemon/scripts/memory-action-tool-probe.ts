/**
 * memory-action-tool-probe — EXECUTED real-API tool-use smoke probe (Strike-5, chunk 2c-02).
 *
 * ─── STRIKE-5 BANNER ─────────────────────────────────────────────────────────
 * Type-check alone is NOT evidence (PIPELINE.md §6.1, Strike-5).
 * The ORCHESTRATOR runs this probe and pastes the FULL stdout into the PR body.
 * That pasted stdout IS the Strike-5 EXECUTED evidence.
 *
 * TWO scenarios, both executed against the REAL Anthropic API:
 *
 *   SCENARIO 1 (happy path) proves the memory-action tool loop end-to-end
 *   through the REAL
 *     AnthropicApiProvider.advance() → tool_use(memory_forget) → MemoryActionPort → durable delete
 *   path, with a REAL sonnet-4-6 API call (no scripted client).
 *
 *   SCENARIO 2 (review FIX 1 boundary evidence) proves the FORCED-FINAL call
 *   shape is accepted by the real API: a request whose `messages` ALREADY
 *   contain a completed tool_use/tool_result round, with `tools` still
 *   DECLARED and `tool_choice:{type:"none"}` added. Scenario 1 alone cannot
 *   reach this path (it only exercises ONE tool round) — the Anthropic API
 *   400s ANY request with tool blocks in history but no `tools` declared, so
 *   this is the deterministic proof the FIX-1 shape is API-valid (not just
 *   type-checked against the FakeClient in anthropic-api-provider.test.ts).
 *
 * The ANTHROPIC key is resolved INTERNALLY (via the `clientFactory` DI seam →
 * `resolveAnthropicKey`, the same path `createAnthropicApiProvider` uses in
 * production, and directly for scenario 2) — this script NEVER prints,
 * echoes, or logs the key value (not even its length).
 *
 * ─── Exact invocation command ────────────────────────────────────────────────
 *   LLM_PROVIDER=anthropic-api bun run packages/daemon/scripts/memory-action-tool-probe.ts
 *
 * ─── What success looks like ──────────────────────────────────────────────────
 *   [memory-action-tool-probe] key resolved (source=keychain)
 *   [memory-action-tool-probe] pre-seed: threadId=<id> msgId=<id> factId=<id>
 *   [memory-action-tool-probe] calling advance() with text: "please forget my favourite colour"
 *   [memory-action-tool-probe] tool_use observed: name=memory_forget input={"ordinal":1,"expected_text":"favourite colour: blue"}
 *   [memory-action-tool-probe] tool_result → {"ok":true,"action":"forget","factId":"...","message":"Forgotten."}
 *   [memory-action-tool-probe] final text: "..."
 *   [memory-action-tool-probe] fact row GONE: true
 *   [memory-action-tool-probe] memory_action_events audit row (forget/applied): true
 *   [memory-action-tool-probe] source message content byte-intact: true  <-- B1 structural invariant
 *   [memory-action-tool-probe] scenario 2: HTTP 200 — stop_reason=end_turn
 *   [memory-action-tool-probe] scenario 2: text block present: true
 *   PROBE PASSED
 *
 * ─── What the Q1 contingency looks like (STOP + escalate, do NOT mask) ────────
 *   [memory-action-tool-probe] Q1 CONTINGENCY: model did NOT call memory_forget.
 *   (transcript of what the model said instead follows)
 *   Exit 1 — this is a sequencing finding for the orchestrator, not a bug to fix here.
 *
 * ─── What a scenario-2 (FIX 1) failure looks like (STOP — the fix would be wrong) ──
 *   SCENARIO 2 FAILED — the forced-final shape was REJECTED by the real API
 *   [memory-action-tool-probe] error: ... 400 invalid_request_error ...
 *   Exit 1.
 */

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
console.log("║  memory-action-tool-probe — Strike-5 EXECUTED evidence (chunk 2c-02)       ║");
console.log("║  Scenario 1: advance() -> tool_use(memory_forget) -> MemoryActionPort ->   ║");
console.log("║              durable delete, on a REAL sonnet-4-6 API call.               ║");
console.log("║  Scenario 2: review FIX 1 — forced-final shape (tools declared +          ║");
console.log("║              tool_choice:none w/ tool blocks in history) is API-valid.    ║");
console.log("║  Type-check alone is NOT evidence. ORCHESTRATOR runs this for DoD.         ║");
console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
console.log("");

import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import { WriteGate } from "../src/memory/write-gate.js";
import { RuleBasedScanner } from "../src/memory/scanner/memory-scanner.js";
import { MemoryActionPort } from "../src/memory/memory-action-port.js";
import { createAnthropicApiProvider } from "../src/providers/anthropic-api-provider.js";
import type { ProviderSessionState } from "../src/providers/provider.js";
import { resolveAnthropicKey } from "../src/secrets/cloud-secrets.js";
import { MEMORY_ACTION_TOOLS_PARAM, serializeToolResult } from "../src/providers/memory-action-tools.js";
import { composeSystemPrompt } from "../src/providers/system-prompt.js";

function assert(condition: boolean, label: string, detail?: string): void {
  if (!condition) {
    console.error(`[memory-action-tool-probe] PROBE FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
}

const FACT_TEXT = "favourite colour: blue";
const SOURCE_CONTENT = "my favourite colour is blue";

const tmpDir = mkdtempSync(join(tmpdir(), "memory-action-tool-probe-"));

function cleanup(): void {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.on("exit", cleanup);

try {
  // ── Step 1: seed a fresh real MemoryStore + real gate/scanner/port ────────
  const store = new MemoryStore({ dataDir: tmpDir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(store, scanner);
  const port = new MemoryActionPort(store, gate, scanner);

  const threadId = store.createThread();
  const [msgId] = store.appendMessages(
    threadId,
    [{ role: "user", content: SOURCE_CONTENT }],
    "probe-session",
  );
  if (!msgId) throw new Error("appendMessages returned no id");

  const factId = store.insertFact(
    {
      fact: FACT_TEXT,
      canonical: FACT_TEXT.toLowerCase(),
      provenance: `thread:${threadId}`,
      scope: "cross-thread",
      expiry: null,
      confidence: 1,
      authored_by: "machine",
      topics: [],
    },
    "probe-seed",
  );

  console.log(`[memory-action-tool-probe] pre-seed: threadId=${threadId}`);
  console.log(`[memory-action-tool-probe] pre-seed: msgId=${msgId}`);
  console.log(`[memory-action-tool-probe] pre-seed: factId=${factId}`);
  console.log("");

  // ── Step 2: build the provider with a REAL client, transcript-logging wrapper ──
  //
  // The `clientFactory` receives the ALREADY-RESOLVED key from createAnthropicApiProvider's
  // internal resolveAnthropicKey() call (production path — Keychain in prod, .env in dev).
  // This script NEVER logs `apiKey` — it is used ONLY to construct the real client.
  let toolUseObserved = false;
  let observedToolUseName: string | undefined;
  let observedToolUseInput: unknown;
  let observedToolResultJSON: string | undefined;

  const provider = createAnthropicApiProvider({
    memoryActionPort: port,
    clientFactory: (apiKey: string) => {
      const real = new Anthropic({ apiKey }); // apiKey never logged
      const wrapped = {
        messages: {
          create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
            // Log any OUTBOUND tool_result blocks (the loop's 2nd+ call).
            const last = params.messages[params.messages.length - 1];
            if (last && Array.isArray(last.content)) {
              for (const block of last.content) {
                if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_result") {
                  const toolResultBlock = block as Anthropic.ToolResultBlockParam;
                  observedToolResultJSON = typeof toolResultBlock.content === "string" ? toolResultBlock.content : JSON.stringify(toolResultBlock.content);
                  console.log(`[memory-action-tool-probe] tool_result → ${observedToolResultJSON}`);
                }
              }
            }
            const response = await real.messages.create(params);
            for (const block of response.content) {
              if (block.type === "tool_use") {
                toolUseObserved = toolUseObserved || block.name === "memory_forget";
                observedToolUseName = block.name;
                observedToolUseInput = block.input;
                console.log(`[memory-action-tool-probe] tool_use observed: name=${block.name} input=${JSON.stringify(block.input)}`);
              }
              if (block.type === "text" && block.text) {
                console.log(`[memory-action-tool-probe] text block: ${JSON.stringify(block.text)}`);
              }
            }
            return response;
          },
        },
      };
      return wrapped as unknown as Anthropic;
    },
  });

  // ── Step 3: build the hydrated state + memoryActionSlice ──────────────────
  const priorState: ProviderSessionState = {
    phase: "done",
    session_id: "",
    messages: [{ role: "user", content: `[remembered] 1. ${FACT_TEXT}` }],
    memoryActionSlice: { threadId, ordinalMap: new Map([[1, factId]]) },
  };

  const userText = "please forget my favourite colour";
  console.log(`[memory-action-tool-probe] calling advance() with text: ${JSON.stringify(userText)}`);
  console.log("  (This is a live API call — requires internet + valid key + billing)");
  console.log("");

  const result = await provider.advance(priorState, {
    type: "session_start",
    trigger: "user",
    text: userText,
    client_session_id: "memory-action-tool-probe",
  });

  console.log("");

  // ── Step 4: Q1 CONTINGENCY — the model must have called memory_forget ─────
  if (!toolUseObserved) {
    console.error("╔══════════════════════════════════════════════════════════════════════════════╗");
    console.error("║  Q1 CONTINGENCY: the model did NOT call memory_forget                      ║");
    console.error("╚══════════════════════════════════════════════════════════════════════════════╝");
    console.error(`[memory-action-tool-probe] observed tool_use name (if any): ${observedToolUseName ?? "(none)"}`);
    console.error(`[memory-action-tool-probe] observed tool_use input (if any): ${observedToolUseInput ? JSON.stringify(observedToolUseInput) : "(none)"}`);
    console.error(`[memory-action-tool-probe] final text: ${result.ok ? JSON.stringify(result.finalText) : "(error path)"}`);
    console.error("[memory-action-tool-probe] This is a sequencing finding for the orchestrator/decompose");
    console.error("  (the stale chunk-03 self-concept may be suppressing the tool call) — NOT a bug to mask here.");
    process.exit(1);
  }

  // ── Step 5: assert the durable-delete + audit trail through the REAL loop + REAL port ──
  assert(result.ok, "advance() returned ok:true");

  const factGone = store.readFactById(factId) === null;
  console.log(`[memory-action-tool-probe] fact row GONE: ${factGone}`);
  assert(factGone, "distilled_facts row is GONE after the tool-loop forget");

  const events = store.readMemoryActionEvents(threadId);
  const appliedForget = events.some((e) => e.action === "forget" && e.outcome === "applied");
  console.log(`[memory-action-tool-probe] memory_action_events audit row (forget/applied): ${appliedForget}`);
  assert(appliedForget, "a memory_action_events row {action:'forget', outcome:'applied'} exists");

  // B1: the source message is byte-intact — fact-forget never scrubs messages.
  const rawRow = store.rawDb().query<{ content: string }, string>("SELECT content FROM messages WHERE id = ?").get(msgId);
  const sourceIntact = rawRow?.content === SOURCE_CONTENT;
  console.log(`[memory-action-tool-probe] source message content byte-intact: ${sourceIntact}  <-- B1 structural invariant`);
  console.log(`[memory-action-tool-probe] source message content: ${JSON.stringify(rawRow?.content)}`);
  assert(sourceIntact, "B1: source message content byte-intact (fact-forget never scrubs messages)");

  if (result.ok) {
    console.log(`[memory-action-tool-probe] final text: ${JSON.stringify(result.finalText)}`);
  }
  console.log("");

  store.close();

  // ── Step 6: SCENARIO 2 (review FIX 6) — forced-final shape is API-valid ────
  //
  // Scenario 1 only exercises ONE tool round (happy path) — it structurally
  // cannot reach the forced-final path FIX 1 addresses. Build a conversation
  // that ALREADY contains a completed assistant tool_use + user tool_result
  // round, then issue ONE real `messages.create()` with `tools` STILL
  // DECLARED and `tool_choice:{type:"none"}` (the fixed forced-final shape).
  // Assert HTTP 200 + a text block — NOT the 400 invalid_request_error the
  // real API returns for tool blocks in history with no `tools` declared.
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  SCENARIO 2 — forced-final call shape (review FIX 1)                       ║");
  console.log("║  tools DECLARED + tool_choice:{type:\"none\"} on a convo that ALREADY has    ║");
  console.log("║  a completed tool_use/tool_result round. Proves the real API accepts it.  ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  const resolved = resolveAnthropicKey();
  if (!resolved.ok) {
    console.error(`[memory-action-tool-probe] PROBE FAILED: could not resolve ANTHROPIC key for scenario 2 — ${resolved.fixHint}`);
    process.exit(1);
  }
  const realClient = new Anthropic({ apiKey: resolved.key }); // key never logged, used only to construct the client

  const simulatedToolUseId = "tu-sim-1";
  const convoWithCompletedToolRound: Anthropic.MessageParam[] = [
    { role: "user", content: `[remembered] 1. ${FACT_TEXT}\n\n${userText}` },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: simulatedToolUseId, name: "memory_forget", input: { ordinal: 1, expected_text: FACT_TEXT } },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: simulatedToolUseId,
          content: serializeToolResult({ ok: true, action: "forget", factId, message: "Forgotten." }),
        },
      ],
    },
  ];

  try {
    const forcedFinalResponse = await realClient.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      thinking: { type: "disabled" },
      system: [{ type: "text", text: composeSystemPrompt(true), cache_control: { type: "ephemeral" } }],
      messages: convoWithCompletedToolRound,
      tools: MEMORY_ACTION_TOOLS_PARAM,
      tool_choice: { type: "none" },
    });

    const textBlock = forcedFinalResponse.content.find((b) => b.type === "text");
    console.log(`[memory-action-tool-probe] scenario 2: HTTP 200 — stop_reason=${forcedFinalResponse.stop_reason}`);
    console.log(`[memory-action-tool-probe] scenario 2: text block present: ${textBlock !== undefined}`);
    if (textBlock && textBlock.type === "text") {
      console.log(`[memory-action-tool-probe] scenario 2: text: ${JSON.stringify(textBlock.text)}`);
    }
    assert(textBlock !== undefined, "scenario 2: forced-final response contains a text block");
  } catch (err) {
    console.error("╔══════════════════════════════════════════════════════════════════════════════╗");
    console.error("║  SCENARIO 2 FAILED — the forced-final shape was REJECTED by the real API   ║");
    console.error("╚══════════════════════════════════════════════════════════════════════════════╝");
    console.error(`[memory-action-tool-probe] error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log("");

  // ── Step 7: PROBE PASSED banner ────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  PROBE PASSED                                                               ║");
  console.log("║  • SCENARIO 1: the model called memory_forget via a REAL tool_use block   ║");
  console.log("║    - the REAL loop + REAL MemoryActionPort durably deleted the fact row   ║");
  console.log("║    - a memory_action_events {forget, applied} audit row exists            ║");
  console.log("║    - source message content byte-intact (B1 invariant)                   ║");
  console.log("║  • SCENARIO 2: the forced-final shape (tools declared + tool_choice:none) ║");
  console.log("║    with tool blocks already in history was ACCEPTED (200) by the real API ║");
  console.log("║  Paste this stdout into the PR body = Strike-5 EXECUTED evidence (2c-02). ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  process.exit(0);
} catch (err) {
  console.error(
    `[memory-action-tool-probe] PROBE FAILED — unexpected error:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
