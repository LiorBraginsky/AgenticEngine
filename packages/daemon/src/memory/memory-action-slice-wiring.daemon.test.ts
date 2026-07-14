/**
 * Integration tests for chunk 2c-02 review FIX 2.
 *
 * Bug: index.ts dropped the whole `priorState` (and with it `memoryActionSlice`,
 * carrying the REAL threadId) whenever `priorMessages.length === 0` — exactly
 * the first "remember X" turn on a brand-new thread with no injected facts.
 * `advance()`'s `turnCtx.threadId` then fell to the `""` defensive floor, so
 * `MemoryActionPort.remember` wrote provenance `"thread:"` and the audit row
 * landed under `thread_id=""` — invisible under the real thread id (ADR-0016
 * dec-4(e) audit-visibility guardrail + spec §3.9 thread-shaped provenance).
 *
 * Uses the REAL daemon (startDaemon on an ephemeral port) with a REAL
 * MemoryStore/WriteGate/RuleBasedScanner/MemoryActionPort. The ONLY stub is
 * the LLM network boundary (a scripted client emitting `tool_use` blocks) —
 * mirrors the pattern in anthropic-api-provider.test.ts / provenance-stamp.daemon.test.ts.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { MemoryActionPort } from "./memory-action-port.js";
import type { AgentProvider } from "../providers/provider.js";
import { TokenStore } from "./token-store.js";

const ORIGIN = "tauri://localhost";

interface FakeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface FakeTextBlock {
  type: "text";
  text: string;
}
type FakeBlock = FakeToolUseBlock | FakeTextBlock;
interface FakeScriptedResponse {
  content: FakeBlock[];
  stop_reason: string;
}

/** Scriptable fake client mirroring anthropic-api-provider.test.ts's makeScriptedClient,
 *  with a params-capture hook for the "with-facts" test below. */
function makeScriptedClient(
  responses: FakeScriptedResponse[],
  onCall?: (callIndex: number, params: { messages: Array<{ role: string; content: unknown }> }) => void,
) {
  let calls = 0;
  return {
    messages: {
      create: async (params: unknown) => {
        onCall?.(calls, params as { messages: Array<{ role: string; content: unknown }> });
        const idx = Math.min(calls, responses.length - 1);
        calls++;
        return responses[idx]!;
      },
    },
  };
}

/** Read the most-recently-created thread_id directly from the DB. */
function newestThreadId(dataDir: string): string {
  const db = new Database(join(dataDir, "memory.sqlite"));
  const row = db
    .query("SELECT thread_id FROM threads ORDER BY created_at DESC LIMIT 1")
    .get() as { thread_id: string } | null;
  db.close();
  if (!row) throw new Error("no threads in DB");
  return row.thread_id;
}

/** Drive one full turn over a real WS connection; resolves with all outbound envelopes. */
function runTurn(
  port: number,
  token: string,
  text: string,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  return new Promise((resolve, reject) => {
    const envelopes: Array<{ type: string; [key: string]: unknown }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: ORIGIN }, protocols: [token] });
    ws.addEventListener("open", () =>
      ws.send(
        JSON.stringify({ type: "session_start", trigger: "user", text, client_session_id: "c" }),
      ),
    );
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data as string) as { type: string; [key: string]: unknown };
      envelopes.push(m);
      if (m.type === "session_end") {
        ws.close();
        resolve(envelopes);
      }
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
}

test("FIX 2: fresh store, NO injected facts, first 'remember X' turn -> memoryActionSlice survives with the REAL threadId (not the '' floor)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "2c02-fix2-"));
  const prevDataDir = process.env.AGENTIC_DATA_DIR;
  process.env.AGENTIC_DATA_DIR = dataDir;
  // hybrid-retrieval chunk-03 (reviewer MINOR fix): pin lexical-only so this daemon boot
  // never constructs a real LocalWasmEmbeddingProvider (ENOENT noise; CI never has the model).
  process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "none";

  const portStore = new MemoryStore({ dataDir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(portStore, scanner);
  const port = new MemoryActionPort(portStore, gate, scanner);

  const scriptedClient = makeScriptedClient([
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu-1", name: "memory_remember", input: { fact: "loves oolong tea in the afternoon" } }],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Got it." }] },
  ]);

  const { createAnthropicApiProvider } = await import("../providers/anthropic-api-provider.js");
  const fakeProvider: AgentProvider = createAnthropicApiProvider({
    apiKey: "sk-ant-fake",
    client: scriptedClient as never,
    memoryActionPort: port,
  });

  const { startDaemon } = await import("../index.js");
  const server = startDaemon(0, fakeProvider);
  const p = server.port!;
  const token = new TokenStore(dataDir).token();

  try {
    const envelopes = await runTurn(p, token, "please remember I love oolong tea in the afternoon");
    expect(envelopes.some((e) => e.type === "session_end")).toBe(true);

    const realThreadId = newestThreadId(dataDir);

    // The fact must carry the REAL thread's provenance — NOT the "thread:" floor.
    const facts = portStore.readDistilledFacts(50);
    const inserted = facts.find((f) => f.fact === "loves oolong tea in the afternoon");
    expect(inserted).toBeDefined();
    expect(inserted!.provenance).toBe(`thread:${realThreadId}`);
    expect(inserted!.provenance).not.toBe("thread:");

    // The audit row is queryable under the REAL thread id — not invisible under "".
    const events = portStore.readMemoryActionEvents(realThreadId);
    expect(events.some((e) => e.action === "remember" && e.outcome === "applied")).toBe(true);
    expect(portStore.readMemoryActionEvents("").length).toBe(0);
  } finally {
    server.stop(true);
    portStore.close();
    process.env.AGENTIC_DATA_DIR = prevDataDir;
  }
});

test("FIX 2: with-facts case -- the '[remembered] 1.' index prefix reaches the provider and the ordinal round-trips (forget)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "2c02-fix2-facts-"));
  const prevDataDir = process.env.AGENTIC_DATA_DIR;
  process.env.AGENTIC_DATA_DIR = dataDir;
  // hybrid-retrieval chunk-03 (reviewer MINOR fix): pin lexical-only so this daemon boot
  // never constructs a real LocalWasmEmbeddingProvider (ENOENT noise; CI never has the model).
  process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "none";

  // Seed a cross-thread machine fact BEFORE the daemon boots so retrieve()
  // injects it on the very first (new-thread) turn.
  const seedStore = new MemoryStore({ dataDir });
  const seedThreadId = seedStore.createThread("seed");
  const factId = seedStore.insertFact(
    {
      fact: "favourite colour: blue",
      canonical: "favourite colour: blue",
      provenance: `thread:${seedThreadId}`,
      scope: "cross-thread",
      expiry: null,
      confidence: 1,
      authored_by: "machine",
      topics: [],
    },
    "seed",
  );
  seedStore.close();

  const portStore = new MemoryStore({ dataDir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(portStore, scanner);
  const port = new MemoryActionPort(portStore, gate, scanner);

  let firstCallMessages: Array<{ role: string; content: unknown }> | undefined;
  const scriptedClient = makeScriptedClient(
    [
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu-1", name: "memory_forget", input: { ordinal: 1, expected_text: "favourite colour: blue" } }],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Forgotten." }] },
    ],
    (callIndex, params) => {
      if (callIndex === 0) firstCallMessages = params.messages;
    },
  );

  const { createAnthropicApiProvider } = await import("../providers/anthropic-api-provider.js");
  const fakeProvider: AgentProvider = createAnthropicApiProvider({
    apiKey: "sk-ant-fake",
    client: scriptedClient as never,
    memoryActionPort: port,
  });

  const { startDaemon } = await import("../index.js");
  const server = startDaemon(0, fakeProvider);
  const p = server.port!;
  const token = new TokenStore(dataDir).token();

  try {
    const envelopes = await runTurn(p, token, "please forget my favourite colour");
    expect(envelopes.some((e) => e.type === "session_end")).toBe(true);

    // The [remembered] N. index prefix reached the REAL provider call.
    expect(firstCallMessages).toBeDefined();
    const contents = (firstCallMessages ?? []).map((m) => m.content);
    expect(contents).toContain("[remembered] 1. favourite colour: blue");

    // The ordinal round-tripped through the port: the fact is durably gone.
    expect(portStore.readFactById(factId)).toBeNull();
  } finally {
    server.stop(true);
    portStore.close();
    process.env.AGENTIC_DATA_DIR = prevDataDir;
  }
});
