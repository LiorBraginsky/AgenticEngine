/**
 * thread-forget (2e) chunk-02 review fix pass — MAJOR-1: the stranded-refcount race.
 *
 * The frontier reviewer proved (Bun.serve replica) that `close(ws)` can fire — and run its
 * decrement loop to completion — WHILE the message handler is still suspended inside
 * `await lifecycle.beginTurn(inbound)` (parked on `memoryProvider.retrieve()` or `whenIdle`).
 * The increment then lands AFTER the decrement already ran, permanently stranding the thread
 * at `liveThreads.get(id) > 0` → every future `POST /memory/forget` for it 409s forever
 * (until daemon restart).
 *
 * This test reproduces the interleave deterministically: a MemoryProvider whose `retrieve()`
 * signals entry then pauses on an externally-controlled gate, so the test can (1) confirm the
 * server is suspended inside beginTurn, (2) close the socket and let close(ws) run to
 * completion, THEN (3) release the gate so beginTurn resumes and the (buggy) increment would
 * land on an already-closed socket. Real daemon, real store, no mocked internals.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import type { AgentProvider } from "../providers/provider.js";
import type { MemoryProvider } from "./memory-provider.js";

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Single-turn stub — deterministic, no LLM/network (mirrors thread-forget.daemon.test.ts). */
function raceStubProvider(): AgentProvider {
  return {
    id: "thread-forget-race-stub",
    async advance(state, inbound) {
      if (inbound.type === "session_start") {
        const session_id = crypto.randomUUID();
        const call_id = crypto.randomUUID();
        return {
          ok: true,
          nextState: { phase: "done", session_id, messages: [{ role: "user", content: inbound.text ?? "" }] },
          outbound: [
            { type: "session_ack", session_id, client_session_id: inbound.client_session_id },
            { type: "tool_call", session_id, call_id, payload: { tool: "show_text", args: { text: { primitive: "text", content: "ok" } } } },
            { type: "session_end", session_id, reason: "completed" },
          ],
          finalText: "ok",
        };
      }
      return { ok: true, nextState: state ?? { phase: "done", session_id: "", messages: [] }, outbound: [] };
    },
  };
}

/** A MemoryProvider whose retrieve() signals `entered` then pauses on `gate` — lets the test
 *  hold beginTurn suspended at the exact await point the reviewer cited (thread-lifecycle.ts,
 *  the known-thread branch's `await this.memoryProvider.retrieve(...)`). */
function pausableRetrieveMemoryProvider(entered: { resolve: () => void }, gate: { promise: Promise<void> }): MemoryProvider {
  return {
    id: "pausable-retrieve-stub",
    async distill() {
      return { threadId: "", ops: [], candidateIds: [], distilledThroughMarker: 0, distilledThroughTurn: 0 };
    },
    async retrieve() {
      entered.resolve(); // server-side beginTurn has reached the await point
      await gate.promise; // suspended here until the test releases it
      return { messages: [], injectedFactIds: [] };
    },
  };
}

test("MAJOR-1: close() while beginTurn is suspended must not strand the liveThreads refcount", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "thread-forget-race-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "none";

  // Pre-seed an ACTIVE (known, non-forgotten) thread so beginTurn takes the known-thread branch
  // that awaits memoryProvider.retrieve() BEFORE the increment site (index.ts).
  const seedStore = new MemoryStore({ dataDir });
  const threadId = seedStore.createThread("race-thread");
  seedStore.close();

  const entered = deferred<void>();
  const gate = deferred<void>();

  const { startDaemon } = await import("../index.js");
  const server = startDaemon(0, raceStubProvider(), pausableRetrieveMemoryProvider(entered, gate));
  const port = server.port!;
  const token = readFileSync(join(dataDir, "auth-token"), "utf8").trim();

  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { Origin: "tauri://localhost" },
    protocols: [token],
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "session_start",
        trigger: "user",
        text: "race",
        client_session_id: crypto.randomUUID(),
        thread_id: threadId,
      }));
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    entered.promise.then(() => resolve()); // server confirmed: beginTurn is now suspended in retrieve()
  });

  // Close the socket WHILE the server is still suspended inside beginTurn (before the increment
  // site runs at all — it has not executed yet, since it comes AFTER `await ... retrieve()`).
  await new Promise<void>((resolve) => {
    ws.addEventListener("close", () => resolve());
    ws.close();
  });
  // Safety margin: let the server-side close(ws) handler (synchronous — no awaits reached, since
  // sessionIds/touchedThreadIds are both still empty at this point) fully run to completion
  // BEFORE we release the gate. This reproduces the reviewer's proven interleave:
  // ["message-start", "close", "message-resume", "increment"].
  await new Promise((r) => setTimeout(r, 50));

  // NOW let beginTurn resume — the (buggy) increment would land on an already-closed socket.
  gate.resolve();
  await new Promise((r) => setTimeout(r, 200));

  // The refcount must NOT be stranded: a fresh forget of this thread must succeed (204), not
  // be wrongly refused as "live" (409) forever.
  const forgetRes = await fetch(`http://127.0.0.1:${port}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_type: "thread", thread_id: threadId }),
  });
  expect(forgetRes.status).toBe(204);

  server.stop(true);
});
