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
 * The provenance stamp is identified by the stable marker "used remembered context"
 * (the phrase common to the line regardless of where it points). The history.html
 * port-URL was dropped in the provenance-affordance retarget — the line now teaches
 * the tray path (menu bar → "Open Memory…"), so these tests key on the marker, not
 * the (now-gone) URL.
 *
 * Scenarios:
 *   A. NEW-thread session (no thread_id) when retrieve returns ≥1 prior message:
 *      → show_text content MUST contain the provenance stamp
 *   B. SAME-thread turn (thread_id of an existing thread sent):
 *      → show_text content must NOT contain the provenance stamp
 *   C. PERSISTENT SOCKET — two sequential turns on ONE socket:
 *      turn 1: no thread_id → new-thread → injectedMemory=true → show_text is stamped
 *      turn 2: same socket + minted thread_id → same-thread hydration → injectedMemory=false (local
 *              variable reset) → show_text is NOT stamped.
 *      This proves injectedMemory cannot leak across turns multiplexed on one persistent socket.
 *   D. CM-01 ADOPTED-ID FLOW (real overlay flow) — two sequential turns on separate sockets:
 *      turn 1: session_start WITH a client-minted unknown UUID thread_id → CM-01 adoption →
 *              retrieve() injects seeded fact → show_text MUST be stamped.
 *      turn 2: session_start WITH the SAME thread_id (now known) → same-thread hydration →
 *              show_text is NOT stamped.
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
import { TokenStore } from "./token-store.js";

const ORIGIN = "tauri://localhost";

let dataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;
let token: string;

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
  // chunk-02 step-3: read the per-install token minted by the daemon at boot.
  token = new TokenStore(dataDir).token();
});

afterAll(() => server.stop(true));

/** Drive one full Anthropic turn and collect all outbound envelopes. */
function runTurn(
  text: string,
  threadId?: string,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  return new Promise((resolve, reject) => {
    const envelopes: Array<{ type: string; [key: string]: unknown }> = [];
    // chunk-02 step-3: present token as Sec-WebSocket-Protocol subprotocol (layer-1 gate).
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN }, protocols: [token] });
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

test("T2.3a-A: new-thread session with seeded prior fact → show_text is stamped (provenance marker present)", async () => {
  // No thread_id → new thread → retrieve() injects the seeded fact.
  const envelopes = await runTurn("What do you know?");
  const content = findShowTextContent(envelopes);
  expect(content).toBeDefined();
  expect(content).toContain("used remembered context");
});

// ─── B. SAME-thread turn (within-thread hydration, now ALSO retrieved memory) ───
//
// Sending the sourceThreadId (which exists in the store) → known-thread branch.
// v2-08 fix A: the known-thread branch now ALSO re-injects the cross-thread
// distilled slice (the [remembered] facts) BEFORE the thread's own tail.
// The seeded fact IS present in the store, so retrieve() returns it → injectedMemory=true
// → show_text is stamped.

test("T2.3a-B: same-thread turn with seeded fact → known-thread branch now retrieves it → show_text IS stamped (provenance marker present)", async () => {
  // Use the sourceThreadId (already in the store) → known-thread branch now also retrieves.
  const envelopes = await runTurn("Tell me more.", sourceThreadId);
  const content = findShowTextContent(envelopes);
  expect(content).toBeDefined();
  expect(content).toContain("used remembered context");
});

// ─── C. PERSISTENT SOCKET — two sequential turns on ONE socket ─────────────
//
// Verifies the injectedMemory-per-message local invariant: the variable is
// declared INSIDE the message handler so it resets to false on EVERY invocation.
// Turn 1 (new-thread) sets injectedMemory=true → show_text stamped.
// Turn 2 (same-thread continuation on the SAME socket): v2-08 fix A — the
// known-thread branch now re-injects the seeded cross-thread fact → injectedMemory=true
// → show_text IS stamped on turn 2 as well.
// The per-message reset invariant is proven by NEW Scenario E (a known-thread turn
// with NO retrievable facts is NOT stamped).
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

test("T2.3a-C: persistent socket — turn 1 (new-thread) stamped; turn 2 (same-thread, seeded fact present) also stamped (v2-08); injectedMemory resets per turn", async () => {
  // Open ONE socket and keep it open for both turns.
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    // chunk-02 step-3: present token as Sec-WebSocket-Protocol subprotocol (layer-1 gate).
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN }, protocols: [token] });
    sock.addEventListener("open", () => resolve(sock));
    sock.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });

  try {
    // Turn 1: no thread_id → new thread minted → retrieve() injects seeded fact → stamped.
    const turn1Envelopes = await turnOnSocket(ws, "What do you know?");
    const turn1Content = findShowTextContent(turn1Envelopes);
    expect(turn1Content).toBeDefined();
    expect(turn1Content).toContain("used remembered context");

    // Discover the thread minted during turn 1 so we can pass it on turn 2.
    const mintedThreadId = newestThreadId();

    // Turn 2: same socket, passing the minted thread_id → known-thread branch (v2-08 fix A).
    // The seeded fact is present → retrieve() injects it → injectedMemory=true → stamped.
    // injectedMemory is a local variable in the message handler — it resets to false at the
    // start of each invocation, then is set true here because retrieve() finds the seeded fact.
    const turn2Envelopes = await turnOnSocket(ws, "Tell me more.", mintedThreadId);
    const turn2Content = findShowTextContent(turn2Envelopes);
    expect(turn2Content).toBeDefined();
    expect(turn2Content).toContain("used remembered context");
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
//   v2-08 fix A: known-thread branch now also retrieves the cross-thread slice →
//   seeded fact present → injectedMemory = true → stamped.

test("T2.3a-D: CM-01 adopted-id flow — turn 1 (client-minted UUID) stamped; turn 2 (same known thread_id, seeded fact present) also stamped (v2-08)", async () => {
  // Client-minted UUID — unknown to the daemon at this point.
  const clientMintedThreadId = crypto.randomUUID();

  // Turn 1: send the client-minted UUID → CM-01 adoption → retrieve() path.
  const turn1Envelopes = await runTurn("What do you know?", clientMintedThreadId);
  const turn1Content = findShowTextContent(turn1Envelopes);
  expect(turn1Content).toBeDefined();
  expect(turn1Content).toContain("used remembered context");

  // Turn 2: send the SAME UUID — the thread now exists in the store.
  // v2-08 fix A: known-thread branch now retrieves the cross-thread slice too.
  // The seeded fact is present → injectedMemory=true → stamped.
  const turn2Envelopes = await runTurn("Tell me more.", clientMintedThreadId);
  const turn2Content = findShowTextContent(turn2Envelopes);
  expect(turn2Content).toBeDefined();
  expect(turn2Content).toContain("used remembered context");
});

// ─── E. KNOWN-THREAD TURN WITH EMPTY MEMORY → NOT stamped ─────────────────
//
// Proves the converse: tail-only hydration (no cross-thread [remembered] facts
// in the store) is NOT stamped. This is the case that B/C/D used to (incorrectly)
// cover — now they all have a seeded fact, so they ARE stamped. Scenario E needs
// its own isolated daemon on a fresh dataDir with NO distilled facts.
//
// Steps: boot a fresh daemon → send turn 1 (new thread, no facts → not stamped) →
// send turn 2 with the same thread_id (known-thread, still no facts → not stamped).

/** Drive one full Anthropic turn on a specific port/token, optionally with a thread_id. */
function runTurnOn(
  port: number,
  tok: string,
  text: string,
  threadId?: string,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  return new Promise((resolve, reject) => {
    const envelopes: Array<{ type: string; [key: string]: unknown }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: ORIGIN }, protocols: [tok] });
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

test("T2.3a-E: known-thread turn with EMPTY memory → NOT stamped (tail-only hydration is not [remembered] memory)", async () => {
  // Boot an isolated daemon on a fresh dataDir — NO distilled facts seeded.
  // A no-op memoryProvider is injected so:
  //   (a) retrieve() always returns [] — the invariant under test (no facts → not stamped);
  //   (b) distill() produces no ops — prevents the DumbTail distillation cycle from
  //       writing the turn-1 message as a fact between turn 1 and turn 2, which would
  //       cause a timing-dependent false-positive in the full bun test suite (the
  //       server-side ws close() handler runs the distillation asynchronously; under
  //       load the distillation can complete before turn-2's runTurnOn reaches the server,
  //       making retrieve() return the newly-inserted fact → stamped → assertion failure).
  // The store itself is still real bun:sqlite (real I/O). Only the memory-provider seam
  // is replaced — this is the explicit testability seam startDaemon exposes (3rd param).
  const noopMemoryProvider: import("./memory-provider.js").MemoryProvider = {
    id: "noop-for-E",
    retrieve: async () => ({ messages: [], injectedFactIds: [] }),
    distill: async (_store, threadId) => ({
      threadId,
      ops: [],
      candidateIds: [],
      distilledThroughMarker: 0,
      distilledThroughTurn: -1,
    }),
  };

  const dir2 = mkdtempSync(join(tmpdir(), "mf05-t23a-e-"));
  const prevDataDir = process.env.AGENTIC_DATA_DIR;
  process.env.AGENTIC_DATA_DIR = dir2;
  const { createAnthropicApiProvider } = await import("../providers/anthropic-api-provider.js");
  const fake = createAnthropicApiProvider({ apiKey: "sk-ant-fake", client: makeFakeClient("Reply E.") as never });
  const { startDaemon } = await import("../index.js");
  const srv = startDaemon(0, fake, noopMemoryProvider);
  const p = srv.port!;
  const tok2 = new TokenStore(dir2).token();
  try {
    // Turn 1 (new thread, no facts → retrieve returns [] → not stamped; makes tid KNOWN).
    const turn1Envs = await runTurnOn(p, tok2, "first");
    const turn1Content = findShowTextContent(turn1Envs);
    expect(turn1Content).toBeDefined();
    expect(turn1Content).not.toContain("used remembered context");

    // Discover the thread minted on turn 1.
    const db2 = new Database(join(dir2, "memory.sqlite"));
    const row2 = db2.query("SELECT thread_id FROM threads ORDER BY created_at DESC LIMIT 1").get() as { thread_id: string } | null;
    db2.close();
    if (!row2) throw new Error("no thread in dir2 DB");
    const knownTid = row2.thread_id;

    // Turn 2 (known thread, still no facts → tail-only → NOT stamped).
    // retrieve() returns [] because noopMemoryProvider never produces facts,
    // so injectedMemory stays false regardless of distillation timing.
    const turn2Envs = await runTurnOn(p, tok2, "second", knownTid);
    const turn2Content = findShowTextContent(turn2Envs);
    expect(turn2Content).toBeDefined();
    expect(turn2Content).not.toContain("used remembered context");
  } finally {
    srv.stop(true);
    process.env.AGENTIC_DATA_DIR = prevDataDir;
  }
});
