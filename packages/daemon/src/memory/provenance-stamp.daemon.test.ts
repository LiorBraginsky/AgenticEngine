/**
 * Integration tests for T2.3a provenance line stamping.
 *
 * Uses the REAL daemon (startDaemon on an ephemeral port) with a real MemoryStore.
 * The mock provider never emits show_text, so this test injects
 * createAnthropicApiProvider with a FAKE in-process client — the same pattern
 * used in anthropic-api-provider.test.ts (no network call, no real API key).
 * This is NOT env-gated.
 *
 * The daemon's startDaemon accepts an optional provider parameter (added for
 * testability in T2.3a's index.ts modification).
 *
 * Setup: distilled facts are seeded directly into the store BEFORE the daemon
 * starts so retrieve() deterministically returns ≥1 prior message on new-thread
 * sessions — no dependency on distillation timing.
 *
 * Scenarios:
 *   A. NEW-thread session (no thread_id) when retrieve returns ≥1 prior message:
 *      → show_text content MUST contain "/history.html"
 *   B. SAME-thread turn (thread_id of an existing thread sent):
 *      → show_text content must NOT contain "/history.html"
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import type { AgentProvider } from "../providers/provider.js";

const ORIGIN = "tauri://localhost";

let dataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;

/** A fake Anthropic client returning a fixed text reply synchronously. */
interface FakeClient {
  messages: { create: () => Promise<{ content: [{ type: "text"; text: string }] }> };
}
function makeFakeClient(replyText: string): FakeClient {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text" as const, text: replyText }] }),
    },
  };
}

/** Thread seeded BEFORE the daemon so retrieve() can inject its fact. */
let sourceThreadId: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mf05-t23a-"));
  process.env.AGENTIC_DATA_DIR = dataDir;

  // Seed: create a source thread and insert a cross-thread distilled fact into it
  // so the DumbTailProvider's retrieve() returns ≥1 prior message on every new-thread
  // session started against this daemon. No distillation cycle required.
  const seedStore = new MemoryStore({ dataDir });
  sourceThreadId = seedStore.createThread("source thread");
  const [msgId] = seedStore.appendMessages(
    sourceThreadId,
    [{ role: "user", content: "Paris is the capital of France." }],
    "seed-session",
  );
  // Insert the distilled fact directly — mirrors what distill() would produce.
  seedStore.insertDistilledFacts(
    [
      {
        fact: "Paris is the capital of France.",
        provenance: msgId!,
        scope: "cross-thread",
        expiry: null,
        confidence: 1.0,
        authored_by: "machine",
      },
    ],
    "dumb-tail@test",
  );
  seedStore.close();

  // Build a fake Anthropic provider (no network, no real key).
  const { createAnthropicApiProvider } = await import("../providers/anthropic-api-provider.js");
  const fakeProvider: AgentProvider = createAnthropicApiProvider({
    apiKey: "sk-ant-fake",
    client: makeFakeClient("The LLM reply.") as never,
  });

  const { startDaemon } = await import("../index.js");
  // Inject the fake Anthropic provider so the daemon emits show_text envelopes.
  server = startDaemon(0, fakeProvider);
  PORT = server.port!;
});

afterAll(() => server.stop(true));

/** Drive one full Anthropic turn and collect all outbound envelopes. */
function runTurn(
  text: string,
  threadId?: string,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  return new Promise((resolve, reject) => {
    const envelopes: Array<{ type: string; [key: string]: unknown }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () =>
      ws.send(
        JSON.stringify({
          type: "session_start",
          trigger: "user",
          text,
          client_session_id: "c",
          ...(threadId ? { thread_id: threadId } : {}),
        }),
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

/** Extract the show_text content from a collection of envelopes, or undefined. */
function findShowTextContent(
  envelopes: Array<{ type: string; [key: string]: unknown }>,
): string | undefined {
  const env = envelopes.find(
    (e) =>
      e.type === "tool_call" &&
      (e as { type: string; payload?: { tool?: string } }).payload?.tool === "show_text",
  ) as
    | { type: string; payload: { tool: string; args: { text: { content: string } } } }
    | undefined;
  return env?.payload.args.text.content;
}

// ─── A. NEW-thread session (no thread_id) + seeded distilled fact ─────────
//
// The DumbTailProvider.retrieve() reads distilled_facts — the seeded fact is
// present, so begin.priorMessages.length > 0 → injectedMemory = true → stamp.

test("T2.3a-A: new-thread session with seeded prior fact → show_text contains /history.html", async () => {
  // No thread_id → new thread → retrieve() injects the seeded fact.
  const envelopes = await runTurn("What do you know?");
  const content = findShowTextContent(envelopes);
  expect(content).toBeDefined();
  expect(content).toContain("/history.html");
});

// ─── B. SAME-thread turn (within-thread hydration, NOT retrieved memory) ───
//
// Sending the sourceThreadId (which exists in the store) → same-thread branch
// (lifecycle.ts:45-47: readThreadTail, NOT retrieve). injectedMemory stays false.

test("T2.3a-B: same-thread turn (thread_id sent) → show_text does NOT contain /history.html", async () => {
  // Use the sourceThreadId (already in the store) → same-thread hydration path.
  const envelopes = await runTurn("Tell me more.", sourceThreadId);
  const content = findShowTextContent(envelopes);
  expect(content).toBeDefined();
  expect(content).not.toContain("/history.html");
});
