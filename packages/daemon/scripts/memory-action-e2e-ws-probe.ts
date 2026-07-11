/**
 * memory-action-e2e-ws-probe — EXECUTED deterministic full-path WS→tool→
 * Memory-window-API probe (Strike-5, chunk 2c-04).
 *
 * ─── STRIKE-5 BANNER ─────────────────────────────────────────────────────────
 * Type-check alone is NOT evidence (PIPELINE.md §6.1, Strike-5).
 * The ORCHESTRATOR runs this probe and pastes the FULL stdout into the PR body.
 * That pasted stdout IS the Strike-5 EXECUTED evidence.
 *
 * ─── What this proves ────────────────────────────────────────────────────────
 * A real daemon (`startDaemon`), driven over the REAL WebSocket path (same
 * Origin + per-install-token subprotocol handshake the overlay uses), runs the
 * real ADR-0016 memory-action tool loop (`AnthropicApiProvider.advance()` →
 * `tool_use(memory_forget)` → the real `MemoryActionPort` → a real
 * `MemoryStore` (WAL SQLite) durable delete), and the exact Memory-window read
 * endpoint (`GET /memory/thread/:id` → `Hatch.view` → the same JSON shape
 * `apps/overlay/src/memory/memory-api.ts` consumes) shows the forgotten fact
 * GONE plus a `{action:"forget", outcome:"applied"}` audit row.
 *
 * ─── What is stubbed (spec §5: only the LLM network boundary) ───────────────
 * ONLY the Anthropic `client` handed to `createAnthropicApiProvider` is
 * scripted (a deterministic, hard-coded two-call script — no network, no key).
 * Everything else is the real production path:
 *   - real `MemoryStore` (WAL) / `WriteGate` / `RuleBasedScanner` / `MemoryActionPort`
 *   - real `startDaemon` (WS upgrade, token gate, origin gate, session lifecycle)
 *   - real `GET /memory/thread/:id` route (`Hatch.view`, bearer-token gated)
 * The daemon's auxiliary background MemoryProvider (dismiss→distill, unrelated
 * to the tool loop) is pinned to the keyless `DumbTailProvider` — this machine
 * DOES have a real ANTHROPIC_API_KEY resolvable in Keychain (verified: the
 * default `smart` provider would silently make a REAL network call in the
 * background on `ws.close()`), and this probe must stay 100% key-free and
 * deterministic. Pinning the auxiliary distiller does not touch what is under
 * test (the tool loop + the read path); `memoryProvider` is an existing
 * `startDaemon` DI seam (mirrors the `provider?` seam), not a new one.
 *
 * ─── Exact invocation command ────────────────────────────────────────────────
 *   bun run packages/daemon/scripts/memory-action-e2e-ws-probe.ts
 *
 * ─── What success looks like ──────────────────────────────────────────────────
 *   [memory-action-e2e-ws-probe] seed: threadSeed=<id> msgId=<id> factId=<id>
 *   [memory-action-e2e-ws-probe] daemon on port <port>
 *   [memory-action-e2e-ws-probe] driving WS turn on FRESH thread <id>: "please forget my favourite colour"
 *   [memory-action-e2e-ws-probe] tool_use observed: name=memory_forget input={"ordinal":1,"expected_text":"favourite colour: blue"}
 *   [memory-action-e2e-ws-probe] tool_result -> {"ok":true,"action":"forget","factId":"...","message":"Forgotten."}
 *   [memory-action-e2e-ws-probe] final text: "Done — forgotten."
 *   [memory-action-e2e-ws-probe] GET /memory/thread/:id -> fact GONE: true
 *   [memory-action-e2e-ws-probe] GET /memory/thread/:id -> audit row {forget,applied} present: true
 *   PROBE PASSED
 *
 * ─── What a failure looks like (STOP + escalate, do NOT mask) ────────────────
 *   [memory-action-e2e-ws-probe] PROBE FAILED: <label> — <detail>
 *   Exit 1 — a real WS/HTTP/store/port wiring problem is a finding for the
 *   orchestrator, not a bug to paper over here.
 */

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
console.log("║  memory-action-e2e-ws-probe — Strike-5 EXECUTED evidence (chunk 2c-04)     ║");
console.log("║  Real WS turn -> real tool loop -> real MemoryActionPort -> real durable   ║");
console.log("║  delete -> real GET /memory/thread/:id (the Memory-window read endpoint). ║");
console.log("║  ONLY the LLM `client` is scripted (no key, no network, deterministic).    ║");
console.log("║  Type-check alone is NOT evidence. ORCHESTRATOR runs this for DoD.         ║");
console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
console.log("");

import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import { WriteGate } from "../src/memory/write-gate.js";
import { RuleBasedScanner } from "../src/memory/scanner/memory-scanner.js";
import { MemoryActionPort } from "../src/memory/memory-action-port.js";
import { DumbTailProvider } from "../src/memory/providers/dumb-tail-provider.js";
import { createAnthropicApiProvider } from "../src/providers/anthropic-api-provider.js";
import { startDaemon } from "../src/index.js";

function assert(condition: boolean, label: string, detail?: string): void {
  if (!condition) {
    console.error(`[memory-action-e2e-ws-probe] PROBE FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
}

const FACT_TEXT = "favourite colour: blue";
const SOURCE_CONTENT = "my favourite colour is blue";

const tmpDir = mkdtempSync(join(tmpdir(), "memory-action-e2e-ws-probe-"));
// The daemon's own MemoryStore (constructed inside startDaemon) reads this env
// var at call time — set it BEFORE starting the daemon (matches memory-demo-harness.ts).
process.env.AGENTIC_DATA_DIR = tmpDir;

let server: ReturnType<typeof startDaemon> | null = null;

function cleanup(): void {
  if (server) {
    try { server.stop(true); } catch { /* ignore */ }
    server = null;
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.on("exit", cleanup);

try {
  // ── Step 1: seed a fresh real MemoryStore + real gate/scanner/port ────────
  // (exact seed/port constructor pattern reused from memory-action-tool-probe.ts,
  // chunk 2c-02.) This store handle is the ONE the injected provider's port
  // writes through; the daemon opens its OWN separate handle over the SAME WAL
  // dataDir to serve reads (§7.1 dual-store-handle — test-only, chunk-02-acknowledged).
  const store = new MemoryStore({ dataDir: tmpDir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(store, scanner);
  const port = new MemoryActionPort(store, gate, scanner);

  const threadSeed = store.createThread();
  const [msgId] = store.appendMessages(
    threadSeed,
    [{ role: "user", content: SOURCE_CONTENT }],
    "e2e-ws-probe-session",
  );
  if (!msgId) throw new Error("appendMessages returned no id");

  // ONE cross-thread machine fact — cross-thread scope is what index.ts's
  // retrieve() path injects into a FRESH thread's ordinal slice (reality check #5).
  const factId = store.insertFact(
    {
      fact: FACT_TEXT,
      canonical: FACT_TEXT.toLowerCase(),
      provenance: `thread:${threadSeed}`,
      scope: "cross-thread",
      expiry: null,
      confidence: 1,
      authored_by: "machine",
      topics: [],
    },
    "e2e-ws-probe-seed",
  );

  console.log(`[memory-action-e2e-ws-probe] seed: threadSeed=${threadSeed} msgId=${msgId} factId=${factId}`);
  console.log("");

  // ── Step 2: scripted, key-free client ──────────────────────────────────────
  // Call 1 (no tool_result in the last inbound message) -> tool_use(memory_forget).
  // Call 2+ (a tool_result round already in history) -> end_turn text. Never
  // prints, needs, or touches a key.
  let callCount = 0;
  let observedToolUseInput: unknown;
  let observedToolResultJSON: string | undefined;

  const scriptedClient = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        callCount++;
        const last = params.messages[params.messages.length - 1];
        const lastHasToolResult =
          !!last &&
          Array.isArray(last.content) &&
          last.content.some(
            (block) => typeof block === "object" && block !== null && "type" in block && block.type === "tool_result",
          );

        if (lastHasToolResult && Array.isArray(last!.content)) {
          for (const block of last!.content) {
            if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_result") {
              const trBlock = block as Anthropic.ToolResultBlockParam;
              observedToolResultJSON = typeof trBlock.content === "string" ? trBlock.content : JSON.stringify(trBlock.content);
              console.log(`[memory-action-e2e-ws-probe] tool_result -> ${observedToolResultJSON}`);
            }
          }
        }

        if (!lastHasToolResult) {
          const toolUseInput = { ordinal: 1, expected_text: FACT_TEXT };
          observedToolUseInput = toolUseInput;
          console.log(`[memory-action-e2e-ws-probe] tool_use observed: name=memory_forget input=${JSON.stringify(toolUseInput)}`);
          return {
            id: "e2e-ws-probe-msg-1",
            type: "message",
            role: "assistant",
            model: "e2e-ws-probe-scripted",
            content: [
              { type: "tool_use", id: "tu1", name: "memory_forget", input: toolUseInput },
            ],
            stop_reason: "tool_use",
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          } as unknown as Anthropic.Message;
        }

        const finalText = "Done — forgotten.";
        console.log(`[memory-action-e2e-ws-probe] final text: ${JSON.stringify(finalText)}`);
        return {
          id: "e2e-ws-probe-msg-2",
          type: "message",
          role: "assistant",
          model: "e2e-ws-probe-scripted",
          content: [{ type: "text", text: finalText }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as Anthropic.Message;
      },
    },
  } as unknown as Anthropic;

  // ── Step 3: real provider over the scripted client + real port ────────────
  // apiKey is a dummy truthy string ONLY to satisfy the resolved-key guard
  // (anthropic-api-provider.ts:329) — `client` is already injected so the
  // factory (and any real key resolution) is never invoked. Fully key-free.
  const provider = createAnthropicApiProvider({
    apiKey: "e2e-ws-probe-not-a-real-key",
    client: scriptedClient,
    memoryActionPort: port,
  });

  // ── Step 4: start the REAL daemon over the SAME dataDir ────────────────────
  // memoryProvider pinned to the keyless DumbTailProvider (see banner) so the
  // unrelated background dismiss->distill path never makes a real network call
  // on this machine (a real ANTHROPIC_API_KEY IS resolvable in Keychain here).
  server = startDaemon(0, provider, new DumbTailProvider());
  const PORT = server.port!;
  const token = readFileSync(join(tmpDir, "auth-token"), "utf8").trim();
  console.log(`[memory-action-e2e-ws-probe] daemon on port ${PORT}, auth token: ${token.slice(0, 8)}…`);
  console.log("");

  // ── Step 5: drive a real WS turn on a FRESH thread ─────────────────────────
  // Shape mirrors memory-demo-harness.ts's wsTurn helper: Origin allowlisted,
  // per-install token as the WS subprotocol, session_start -> session_end.
  const turnThreadId = crypto.randomUUID();
  const userText = "please forget my favourite colour";
  console.log(`[memory-action-e2e-ws-probe] driving WS turn on FRESH thread ${turnThreadId}: ${JSON.stringify(userText)}`);

  const { reply } = await new Promise<{ reply: string; sessionId: string }>((resolve, reject) => {
    const ORIGIN = "tauri://localhost";
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, {
      headers: { Origin: ORIGIN },
      protocols: [token],
    });

    let replyText = "";
    let sessionId = "";
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WS turn timeout (text="${userText}")`));
    }, 5_000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "session_start",
        trigger: "user",
        text: userText,
        client_session_id: crypto.randomUUID(),
        thread_id: turnThreadId,
      }));
    });

    ws.addEventListener("message", (e: MessageEvent) => {
      const m = JSON.parse(e.data as string) as {
        type: string;
        session_id?: string;
        payload?: { tool?: string; args?: { text?: { content?: string } } };
      };
      if (m.type === "session_ack") sessionId = m.session_id ?? "";
      if (m.type === "tool_call" && m.payload?.tool === "show_text") {
        replyText = m.payload?.args?.text?.content ?? "";
      }
      if (m.type === "session_end") {
        clearTimeout(timeout);
        ws.close();
        resolve({ reply: replyText, sessionId });
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error"));
    });
  });

  console.log(`[memory-action-e2e-ws-probe] WS reply (show_text): ${JSON.stringify(reply)}`);
  console.log("");

  // ── Step 6: bounded settle ──────────────────────────────────────────────
  // The forget() call already committed synchronously inside advance() BEFORE
  // session_end was sent — this settle is a courtesy for the WS close/dismiss
  // machinery, not load-bearing for the assertions below.
  await new Promise((r) => setTimeout(r, 300));

  // ── Step 7: the exact Memory-window read endpoint ──────────────────────────
  assert(callCount >= 2, "the scripted client was called at least twice (tool round + final round)", `callCount=${callCount}`);
  assert(observedToolUseInput !== undefined, "a memory_forget tool_use was observed", JSON.stringify(observedToolUseInput));
  assert(observedToolResultJSON !== undefined, "a tool_result round was observed", observedToolResultJSON);

  const res = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(turnThreadId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(res.status === 200, "GET /memory/thread/:id returned 200", `status=${res.status}`);
  const view = await res.json() as {
    distilledFacts: { id: string; fact: string }[];
    memoryActionEvents: { action: string; outcome: string; fact_text: string; actor: string; created_at: number }[];
  };

  const factGone = !view.distilledFacts.some((f) => f.id === factId);
  console.log(`[memory-action-e2e-ws-probe] GET /memory/thread/:id -> fact GONE: ${factGone}`);
  assert(factGone, "the forgotten fact is GONE from distilledFacts via the Memory-window read path");

  const appliedForget = view.memoryActionEvents.some((e) => e.action === "forget" && e.outcome === "applied");
  console.log(`[memory-action-e2e-ws-probe] GET /memory/thread/:id -> audit row {forget,applied} present: ${appliedForget}`);
  console.log(`[memory-action-e2e-ws-probe] memoryActionEvents: ${JSON.stringify(view.memoryActionEvents)}`);
  assert(appliedForget, "a memoryActionEvents row {action:'forget', outcome:'applied'} is present via GET /memory/thread/:id");

  console.log("");
  store.close();

  // ── Step 8: PROBE PASSED banner ────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  PROBE PASSED                                                               ║");
  console.log("║  • the real WS turn drove the real tool loop -> tool_use(memory_forget)   ║");
  console.log("║  • the real MemoryActionPort durably deleted the fact via a real WriteGate ║");
  console.log("║  • GET /memory/thread/:id (the Memory-window read endpoint) confirms:      ║");
  console.log("║      - the fact is GONE from distilledFacts                                ║");
  console.log("║      - a {action:'forget', outcome:'applied'} memoryActionEvents row exists║");
  console.log("║  Paste this stdout into the PR body = Strike-5 EXECUTED evidence (2c-04). ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  cleanup();
  process.exit(0);
} catch (err) {
  console.error(
    `[memory-action-e2e-ws-probe] PROBE FAILED — unexpected error:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  cleanup();
  process.exit(1);
}
