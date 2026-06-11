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
 *   C. PERSISTENT SOCKET — two sequential turns on ONE socket:
 *      turn 1: no thread_id → new-thread → injectedMemory=true → show_text contains /history.html
 *      turn 2: same socket + minted thread_id → same-thread hydration → injectedMemory=false (local
 *              variable reset) → show_text does NOT contain /history.html.
 *      This proves injectedMemory cannot leak across turns multiplexed on one persistent socket.
 *   D. CM-01 ADOPTED-ID FLOW (real overlay flow) — two sequential turns on separate sockets:
 *      turn 1: session_start WITH a client-minted unknown UUID thread_id → CM-01 adoption →
 *              retrieve() injects seeded fact → show_text MUST contain /history.html.
 *      turn 2: session_start WITH the SAME thread_id (now known) → same-thread hydration →
 *              show_text must NOT contain /history.html.
 *      This is the flow the real overlay ALWAYS uses (it always sends a client-minted UUID
 *      on the first turn). T2.3a-C missed it because turn 1 sent NO thread_id.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
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

// ─── C. PERSISTENT SOCKET — two sequential turns on ONE socket ─────────────
//
// Verifies the injectedMemory-per-message local invariant: the variable is
// declared INSIDE the message handler so it resets to false on EVERY invocation.
// Turn 1 (new-thread) sets injectedMemory=true → show_text stamped.
// Turn 2 (same-thread continuation on the SAME socket, injectedMemory resets to
// false → same-thread hydration path → NOT stamped).
//
// "drive one Anthropic turn on an already-open socket"
// The Anthropic fake provider emits: session_ack → tool_call{show_text} → session_end
// (no tool_result needed — show_text is display-only).
function turnOnSocket(
  ws: WebSocket,
  text: string,
  threadId?: string,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  return new Promise((resolve, reject) => {
    const cid = crypto.randomUUID();
    const envelopes: Array<{ type: string; [key: string]: unknown }> = [];
    let mySid: string | undefined;
    const onMsg = (e: MessageEvent) => {
      const m = JSON.parse(e.data as string) as { type: string; [key: string]: unknown };
      envelopes.push(m);
      if (m.type === "session_ack" && m.client_session_id === cid) {
        mySid = m.session_id as string;
        return;
      }
      if (m.type === "session_end" && m.session_id === mySid) {
        ws.removeEventListener("message", onMsg);
        resolve(envelopes);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(
      JSON.stringify({
        type: "session_start",
        trigger: "user",
        text,
        client_session_id: cid,
        ...(threadId ? { thread_id: threadId } : {}),
      }),
    );
    setTimeout(() => reject(new Error("turn timeout")), 5000);
  });
}

/** Read the most recently created thread_id from the DB (used to discover the id minted on turn 1). */
function newestThreadId(): string {
  const db = new Database(join(dataDir, "memory.sqlite"));
  const row = db
    .query("SELECT thread_id FROM threads ORDER BY created_at DESC LIMIT 1")
    .get() as { thread_id: string } | null;
  db.close();
  if (!row) throw new Error("no threads in DB");
  return row.thread_id;
}

test("T2.3a-C: persistent socket — turn 1 (new-thread) stamped; turn 2 (same-thread) NOT stamped — injectedMemory does not leak across turns", async () => {
  // Open ONE socket and keep it open for both turns.
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    sock.addEventListener("open", () => resolve(sock));
    sock.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });

  try {
    // Turn 1: no thread_id → new thread minted → retrieve() injects seeded fact → stamped.
    const turn1Envelopes = await turnOnSocket(ws, "What do you know?");
    const turn1Content = findShowTextContent(turn1Envelopes);
    expect(turn1Content).toBeDefined();
    expect(turn1Content).toContain("/history.html");

    // Discover the thread minted during turn 1 so we can pass it on turn 2.
    const mintedThreadId = newestThreadId();

    // Turn 2: same socket, passing the minted thread_id → same-thread hydration (readThreadTail).
    // injectedMemory is a local variable in the message handler — resets to false on this invocation.
    const turn2Envelopes = await turnOnSocket(ws, "Tell me more.", mintedThreadId);
    const turn2Content = findShowTextContent(turn2Envelopes);
    expect(turn2Content).toBeDefined();
    expect(turn2Content).not.toContain("/history.html");
  } finally {
    ws.close();
  }
});

// ─── D. CM-01 ADOPTED-ID FLOW (real overlay flow) ─────────────────────────
//
// The real overlay ALWAYS sends a client-minted UUID thread_id on the first turn.
// Before the fix, beginTurn's CM-01 adoption would CREATE the thread with that UUID,
// making store.threadExists(inbound.thread_id) return true AFTER beginTurn ran —
// so isNewThread was always false, and stampProvenance was always skipped.
// After the fix, wasKnownThread is captured BEFORE beginTurn, so adoption does not
// confuse the new-thread detection.
//
// Turn 1: session_start WITH a client-minted unknown UUID → CM-01 adoption →
//   retrieve() injects seeded fact → injectedMemory = true → show_text stamped.
// Turn 2: session_start WITH the SAME thread_id (now a known thread) →
//   same-thread hydration (readThreadTail) → injectedMemory = false → NOT stamped.

test("T2.3a-D: CM-01 adopted-id flow — turn 1 (client-minted UUID) stamped; turn 2 (same known thread_id) NOT stamped", async () => {
  // Client-minted UUID — unknown to the daemon at this point.
  const clientMintedThreadId = crypto.randomUUID();

  // Turn 1: send the client-minted UUID → CM-01 adoption → retrieve() path.
  const turn1Envelopes = await runTurn("What do you know?", clientMintedThreadId);
  const turn1Content = findShowTextContent(turn1Envelopes);
  expect(turn1Content).toBeDefined();
  expect(turn1Content).toContain("/history.html");

  // Turn 2: send the SAME UUID — the thread now exists in the store.
  // Same-thread hydration path: readThreadTail, NOT retrieve().
  const turn2Envelopes = await runTurn("Tell me more.", clientMintedThreadId);
  const turn2Content = findShowTextContent(turn2Envelopes);
  expect(turn2Content).toBeDefined();
  expect(turn2Content).not.toContain("/history.html");
});
