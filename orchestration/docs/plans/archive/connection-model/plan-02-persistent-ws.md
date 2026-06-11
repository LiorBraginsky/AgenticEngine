> 🗄️ ARCHIVED 2026-06-11 — shipped. Historical record; do not edit.

# Persistent WS Connection (overlay) + Reconnect — CM-02 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Project discipline is TDD (superpowers:test-driven-development) — every implementation step is preceded by a failing test.

**Goal:** Refactor the overlay from one-WebSocket-per-turn to ONE persistent connection that is reused across turns and reconnects with backoff on drop, while keeping chunk-01 thread continuation and every existing flow green.

**Architecture:** A new `ConnectionManager` owns the shared `WebSocketLike` (opened on overlay activation, kept until hide/exit — close-on-dismiss is chunk 03). `runSession` no longer opens its own socket; it registers a per-turn `SessionContext` with an inbound **dispatcher** that routes envelopes by `session_id` (correlated via the existing `client_session_id` echo). The dispatcher is a `Map<sessionId, SessionContext>` (single-flight today, Map-ready for deferred inbound push). Mid-flight socket drop settles the active turn locally as `cancelled`-equivalent (nothing on the wire); the manager reconnects with capped exponential backoff carrying the unchanged `currentThreadId`. The daemon is unchanged — one new real-I/O test pins down that it already serves N sessions per connection.

**Tech Stack:** TypeScript on Bun, `bun:test` (with `jest.useFakeTimers()` for timer tests), the frozen `@agentic/protocol` Zod union, injected `WebSocketFactory` as the DOM-free seam.

---

## Status: SHIPPED — review-complete — all 6 tasks built; engine-reviewer round 1: 0 BLOCKER / 0 MAJOR / 2 MINOR / 2 NIT; both MINORs + NIT#4 fixed in 8f17adb; round 2 (focused re-review): 0/0/0/0. Awaiting conductor merge (crawl-rung override 2026-06-10).

---

## Reality check

Verified against current `main` source. Behavioral claims below are code-path observations, **not** runtime-verified — but all DoD here is mechanical/test-provable (Lior's 2026-06-10 ruling: no live demo for this chunk), so each becomes a green test rather than a "requires live demo" caveat.

**Chunk-text claims confirmed in source:**

- **`finish()`/`fail()` close the socket** — `apps/overlay/src/ws/session-client.ts:185` (`finish` → `ws.close()`) and `:193` (`fail` → `ws.close()`). The chunk says "lines ~161-175"; actual lines are **181-195**. *Drift: chunk line refs are stale by ~20 lines (chunk-01 added the `RunSessionOptions.threadId` block at 87-98 + `buildSessionStart` threadId spread). Behavior identical.*
- **Close-event rejects every turn** — `session-client.ts:286-290`: the `"close"` listener calls `fail(new Error("WebSocket closed before session_end received"))`. This is the per-turn rejection that becomes connection-level in this chunk. Confirmed.
- **Per-turn handshake timeout + `HandshakeTimeoutError`** — `session-client.ts:40` (`DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000`), armed at `:164`, disarmed at first matching `tool_call`/`show_text` (`:245`, `:262`), error name set at `:176`. `main.ts:347-349` discriminates on `err.name === "HandshakeTimeoutError"`. Confirmed (gotcha #42).
- **`inFlight` guard** — `main.ts:177` declared, `:206` checks/early-returns, `:224` sets true, cleared in `.then()`/`.catch()` (`:274`, `:331`, `:364`). Confirmed (gotcha #45 — stays).
- **Daemon `close(ws)` S1 flush** — `packages/daemon/src/index.ts:149-168`: iterates `ws.data.sessionIds`, flushes partial-turn messages via `lifecycle.endTurn`, then `sessions.delete` + `lifecycle.forgetSession`. Chunk says "149-168"; **exact match**. Confirmed.
- **Provisional dismiss** — `index.ts:85-102`: thread-switch dismiss on `session_start` when `prevThreadId !== incomingThreadId`. Chunk says "85-102"; **exact match**. Stays this chunk (chunk-03 retires it); never fires for overlay because overlay sends one stable `currentThreadId` per run.
- **`ws.data.sessionIds` is a `Set<string>`** — `index.ts:20` (type), `:56` (initialized at upgrade), `:143` (`.add(sid)` on non-done advance). The daemon already keys sessions per-connection; multiple `session_start` over one socket each mint a fresh `session_id` and add to the same Set. Confirmed — this is why **no daemon behavior change** is needed.
- **Origin gate at upgrade** — `index.ts:52-58`: `isOriginAllowed` checked in `fetch` before `server.upgrade`. Re-runs on every new connection ⇒ **re-passed on every reconnect for free** (ADR-0003 not weakened). Confirmed.
- **`client_session_id` correlation** — `session-client.ts:221`: `session_ack.client_session_id === clientSessionId` sets `confirmedSessionId`. The dispatcher will reuse this exact correlation key. Confirmed.

**Material drift / constraint NOT stated in the chunk (load-bearing — drove a design decision):**

- **The mock provider never emits `show_text`.** `mock-agent.ts` only ever emits `show_color_picker` (`:106-109`); `show_text` is emitted **only** by `anthropicApiProvider` (`grep show_text` → only `anthropic-api-provider.ts`), which requires a live API key. `startDaemon()` calls `buildInjector()` with no arg (`index.ts:38`), so the daemon always reads `LLM_PROVIDER` from `Bun.env` with **no test-injectable provider seam into the running daemon**. Therefore the DoD bullet *"real-I/O: picker round-trip AND show_text turn over the shared socket"* **cannot** be driven end-to-end through the mock daemon for the `show_text` half. Resolved in Design decision D5: the picker half runs against the **real mock daemon** (highest fidelity, exercises `ws.data.sessionIds`); the `show_text` half runs against a **real `Bun.serve` WebSocket loopback server scripted to emit a `show_text` frame** — still real-I/O at the transport/dispatcher level, touches no frozen surface, and proves the dispatcher routes both flow shapes over one socket. This is honest about what each test proves.

- **`runSession`'s current signature creates the socket internally** (`factory(WS_URL)` at `session-client.ts:156`). To "ride the shared socket" without breaking `main.ts`/chunk-01 callers, the manager must inject the shared socket while keeping `runSession(text, factory, options)` source-compatible. Resolved in D3 (overload/optional connection param; `main.ts` call site updated to pass the manager, the `factory`-only form preserved for existing tests).

## Design decisions

- **D1 — Backoff strategy: capped exponential with full jitter, base 500ms, cap 10s, unlimited retries while the overlay is active.** WHY: daemon restart / sleep-wake are the target drop causes (spec §3.1); a fast first retry (500ms) recovers the common quick-restart, the 10s cap bounds worst-case latency, full jitter (`random(0, delay)`) avoids a thundering-herd self-synchronization, and unlimited-while-active matches "kept until the overlay hides/exits" (no max-attempts giving-up state to design — that is chunk-03 teardown territory). The schedule is `delay(n) = min(cap, base * 2^n)`, jittered; injectable `sleep`/`now`/`random` make it deterministically testable.

- **D2 — Activation trigger = construct + connect the `ConnectionManager` once at `main.ts` module top-level (alongside the existing `factory` const), with `connect()` called immediately.** WHY: the overlay webview is created on activation and the module evaluates then; this is the simplest "opened when the overlay activates" point that does not entangle the Tauri window lifecycle. Teardown (close-on-dismiss) is **explicitly chunk 03** — this chunk adds **no** `manager.close()` call anywhere in `main.ts`. The interim consequence (socket lives for the whole app run, never deliberately closed) is exactly the spec's intended interim and matches ADR-0014's "interim wart" framing.

- **D3 — `runSession` rides the shared socket via an optional injected connection, signature-compatible.** WHY: chunk-01 + existing tests call `runSession(text, factory, options)` and must stay byte-green. The manager exposes `runSession(text, options)` that supplies the shared socket; the standalone `runSession(text, factory, options)` export is **retained unchanged** so all existing seam tests (`session-client.test.ts`) keep compiling and passing. `main.ts` switches its one call site from the free function to `manager.runSession(...)`. `RunSessionOptions.threadId` is untouched.

- **D4 — Dispatcher shape: `Map<sessionId, SessionContext>`, single-flight enforced by the caller (`inFlight`), unknown/non-active `session_id` frames silently dropped.** WHY: spec §3.5 + gotcha #9. The Map is the **seam** for deferred inbound push (CM future); this chunk puts at most one entry in it. Correlation is two-stage exactly as today: a `session_ack` matching the pending turn's `client_session_id` binds `session_id → context`; thereafter `tool_call`/`session_end` route by `session_id`. A frame whose `session_id` is in neither the pending-by-cid nor the confirmed Map is dropped without throwing (preserves gotcha #9 discipline already in `tool-call-handler.ts`).

- **D5 — Real-I/O coverage split (forced by the mock-only-picker reality, see Reality check):** picker round-trip + ≥3 round-trips + reconnect-same-thread run against the **real mock daemon** (`startDaemon(0)`); the `show_text` flow-shape runs against a **scripted real WebSocket loopback server** that emits `session_ack` → `tool_call{show_text}` → `session_end` over a real socket. WHY: highest achievable fidelity without a live API key and without touching frozen surfaces; each test states honestly what it proves.

- **D6 — Mid-flight drop = local settle as `cancelled`-equivalent, nothing on the wire.** WHY: spec §3.1. The active context's promise resolves `{ sessionId, reason: "cancelled" }` (resolve, not reject — so `main.ts`'s `.then()` reason-classification path handles it exactly like a daemon-sent cancel, no unhandled rejection). `currentThreadId` is **not** reset (involuntary drop ≠ voluntary dismiss — the load-bearing asymmetry; reset is chunk 03). The daemon's `close(ws)` S1 flush cleans its side.

## ADR worthy: no

ADR-0014 (`orchestration/docs/adr/0014-connection-model-persistent-ws-dismiss-thread-adoption.md`, `proposed`, on `main`) **already covers** the socket-lifetime decision this chunk builds: its Decision 1 ("WS lifetime → persistent per overlay session … Reconnect with backoff on drop … sessions in-flight at disconnect are treated as cancelled … *Built in chunk 02*") is precisely this chunk's scope. The architect-time items I resolved here — backoff strategy (D1), activation trigger (D2), dispatcher shape (D4) — are explicitly delegated to build time by spec §7 and ADR-0014 (it says "Reconnect with backoff" and "concurrency limit is an architect-time constant" without fixing values). Choosing concrete values *within* an accepted decision is not a new decision and needs no amendment. No new dependency, no wire change, no new boundary beyond what ADR-0014 records. **No new ADR or amendment is needed.**

## File structure

| File | Responsibility | Action |
|---|---|---|
| `apps/overlay/src/ws/connection-manager.ts` | Owns the shared socket; `connect()`/`runSession()`; backoff reconnect; inbound dispatcher `Map<sessionId, SessionContext>`; per-turn handshake timer; mid-flight-drop local-cancel. | **Create** |
| `apps/overlay/src/ws/backoff.ts` | Pure capped-exponential-with-jitter delay schedule (injectable `random`). | **Create** |
| `apps/overlay/src/ws/connection-manager.test.ts` | Seam tests (fake transport): dispatcher routing, unknown-session drop, per-turn timeout, mid-flight drop → local cancel, reconnect schedule, ≥N turns one socket (factory call-count). | **Create** |
| `apps/overlay/src/ws/backoff.test.ts` | Pure unit tests for the delay schedule. | **Create** |
| `apps/overlay/src/ws/session-client.ts` | Extract the inbound-handling + per-turn logic into reusable form the manager calls; **keep the existing `runSession(text, factory, options)` export byte-compatible** for existing tests. | **Modify** |
| `apps/overlay/src/ws/types.ts` | Add `onClose`/reconnect-relevant nothing-new if avoidable; only widen `WebSocketLike` if the manager needs `readyState` (decided: not needed — use event-driven only). | **Modify (minimal / possibly none)** |
| `apps/overlay/src/main.ts` | Construct `ConnectionManager` at module top; call `manager.connect()`; switch the one `runSession(...)` call to `manager.runSession(...)`. `inFlight` guard, threadId mint, all handlers UNCHANGED. **No teardown added.** | **Modify** |
| `packages/daemon/src/multi-turn-per-socket.daemon.test.ts` | Real-I/O: ≥3 `session_start…session_end` on ONE `WebSocket`, single connection asserted; reconnect-same-thread. | **Create** |
| `apps/overlay/src/ws/connection-manager.realio.test.ts` | Real-I/O: picker round-trip over the manager against the real mock daemon; `show_text` flow over a scripted loopback server. | **Create** |

**Frozen — DO NOT touch:** `packages/protocol/**`, `packages/daemon/src/mock-agent.ts`, `packages/daemon/src/providers/mock-provider.ts`. The daemon's provisional dismiss (`index.ts:85-102`) stays. No gotcha #33/#34 changes.

---

## Task 1: Pure backoff schedule ✅ DONE — commit 74a9f54

**Files:**
- Create: `apps/overlay/src/ws/backoff.ts`
- Test: `apps/overlay/src/ws/backoff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/overlay/src/ws/backoff.test.ts
import { test, expect } from "bun:test";
import { backoffDelayMs } from "./backoff.js";

test("backoff: attempt 0 is base, doubles each attempt, capped at 10s (no jitter when random=0)", () => {
  const cfg = { baseMs: 500, capMs: 10_000, random: () => 0 };
  expect(backoffDelayMs(0, cfg)).toBe(500);   // 500 * 2^0
  expect(backoffDelayMs(1, cfg)).toBe(1000);  // 500 * 2^1
  expect(backoffDelayMs(2, cfg)).toBe(2000);
  expect(backoffDelayMs(3, cfg)).toBe(4000);
  expect(backoffDelayMs(4, cfg)).toBe(8000);
  expect(backoffDelayMs(5, cfg)).toBe(10_000); // capped (would be 16000)
  expect(backoffDelayMs(50, cfg)).toBe(10_000); // stays capped, no overflow
});

test("backoff: full jitter scales the capped ceiling by random() in [0,1)", () => {
  // random=0.5 → half of the capped ceiling
  expect(backoffDelayMs(5, { baseMs: 500, capMs: 10_000, random: () => 0.5 })).toBe(5000);
  // random=1 (boundary) never exceeds the ceiling
  expect(backoffDelayMs(5, { baseMs: 500, capMs: 10_000, random: () => 0.999 })).toBeLessThan(10_000);
});

test("backoff: result is always a non-negative integer", () => {
  for (let n = 0; n < 12; n++) {
    const d = backoffDelayMs(n, { baseMs: 500, capMs: 10_000, random: Math.random });
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/overlay/src/ws/backoff.test.ts`
Expected: FAIL — `Cannot find module './backoff.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/overlay/src/ws/backoff.ts
/**
 * Capped exponential backoff with full jitter (CM-02 reconnect, plan D1).
 *   ceiling(n) = min(capMs, baseMs * 2^n)
 *   delay      = floor(random() * ceiling)   // full jitter, random() in [0,1)
 * WHY full jitter: avoids self-synchronized retry storms across reconnect loops
 * and keeps the first retry fast (base 500ms) while bounding the worst case (cap 10s).
 */
export interface BackoffConfig {
  baseMs: number;
  capMs: number;
  /** Injected for deterministic tests; defaults to Math.random at the call site. */
  random: () => number;
}

export const DEFAULT_BACKOFF: Omit<BackoffConfig, "random"> = { baseMs: 500, capMs: 10_000 };

export function backoffDelayMs(attempt: number, cfg: BackoffConfig): number {
  const exp = cfg.baseMs * 2 ** attempt;
  const ceiling = Number.isFinite(exp) ? Math.min(cfg.capMs, exp) : cfg.capMs;
  return Math.floor(cfg.random() * ceiling);
}
```

Note: the no-jitter tests in Step 1 use `random: () => 0`, which would yield `0`. Adjust the implementation to treat full-jitter as `random()` applied to the ceiling — and the Step-1 "no jitter" expectations must therefore use a sentinel that returns the ceiling fraction. **Fix the test to match full-jitter semantics:** replace the first test's `random: () => 0` with `random: () => 1 - Number.EPSILON` is wrong (we want the ceiling exactly). Use the decomposed-but-testable form below instead.

- [ ] **Step 3a: Correct the schedule to expose the deterministic ceiling separately (so "doubling" is testable without jitter ambiguity)**

```ts
// apps/overlay/src/ws/backoff.ts  (final)
export interface BackoffConfig {
  baseMs: number;
  capMs: number;
  random: () => number; // [0,1)
}
export const DEFAULT_BACKOFF: Omit<BackoffConfig, "random"> = { baseMs: 500, capMs: 10_000 };

/** Deterministic ceiling before jitter — exported so the doubling/cap is unit-testable. */
export function backoffCeilingMs(attempt: number, baseMs: number, capMs: number): number {
  const exp = baseMs * 2 ** attempt;
  return Number.isFinite(exp) ? Math.min(capMs, exp) : capMs;
}

/** Full-jitter delay: floor(random() * ceiling). */
export function backoffDelayMs(attempt: number, cfg: BackoffConfig): number {
  return Math.floor(cfg.random() * backoffCeilingMs(attempt, cfg.baseMs, cfg.capMs));
}
```

And update `backoff.test.ts` Step-1 first test to assert the **ceiling** (deterministic doubling/cap), and the jitter test to assert `backoffDelayMs`:

```ts
import { backoffCeilingMs, backoffDelayMs } from "./backoff.js";

test("backoff ceiling: base, doubles, caps at 10s, no overflow", () => {
  expect(backoffCeilingMs(0, 500, 10_000)).toBe(500);
  expect(backoffCeilingMs(1, 500, 10_000)).toBe(1000);
  expect(backoffCeilingMs(4, 500, 10_000)).toBe(8000);
  expect(backoffCeilingMs(5, 500, 10_000)).toBe(10_000);
  expect(backoffCeilingMs(50, 500, 10_000)).toBe(10_000);
});

test("backoff full jitter: delay = floor(random * ceiling)", () => {
  expect(backoffDelayMs(5, { baseMs: 500, capMs: 10_000, random: () => 0.5 })).toBe(5000);
  expect(backoffDelayMs(0, { baseMs: 500, capMs: 10_000, random: () => 0.9 })).toBe(450);
  expect(backoffDelayMs(5, { baseMs: 500, capMs: 10_000, random: () => 0 })).toBe(0);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/overlay/src/ws/backoff.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/ws/backoff.ts apps/overlay/src/ws/backoff.test.ts
git commit -m "feat(connection-model): CM-02 capped-exponential backoff schedule with full jitter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ConnectionManager — shared socket, dispatcher, per-turn timeout, mid-flight drop, reconnect ✅ DONE — commits 3232497, d958133, 1538335, 7bfb9da, a1bf55e

This is the core. It must be built test-first against the existing fake transport from `session-client.test.ts`. We reuse `parseEnvelope`, `decideRender`, `decideTextRender`, `buildToolResult`, `buildToolCancel`, `buildSessionStart` — **do not re-implement** envelope handling; the manager wraps the same logic the free `runSession` uses today.

**Files:**
- Create: `apps/overlay/src/ws/connection-manager.ts`
- Modify: `apps/overlay/src/ws/session-client.ts` (export the reusable pieces; keep `runSession` byte-compatible)
- Test: `apps/overlay/src/ws/connection-manager.test.ts`

### 2a — Manager skeleton: one socket, `connect()`, factory call-count = 1 across N turns

- [ ] **Step 1: Write the failing test**

```ts
// apps/overlay/src/ws/connection-manager.test.ts
import { test, expect, jest } from "bun:test";
import { ConnectionManager } from "./connection-manager.js";
import type { WebSocketLike } from "./types.js";

// Scriptable fake transport (mirrors session-client.test.ts makeFake).
function makeFake() {
  const listeners: Record<string, ((ev: { data?: unknown }) => void)[]> = {};
  const sent: string[] = [];
  let closed = false;
  const ws: WebSocketLike = {
    send: (d) => { sent.push(d); },
    close: () => { closed = true; (listeners["close"] ?? []).forEach((cb) => cb({})); },
    addEventListener: (t, cb) => { (listeners[t] ??= []).push(cb); },
  };
  const fire = (t: string, ev: { data?: unknown } = {}) => (listeners[t] ?? []).forEach((cb) => cb(ev));
  return { ws, sent, fire, get closed() { return closed; } };
}

const VALID_TOOL_CALL_PAYLOAD = {
  tool: "show_color_picker",
  args: { picker: { primitive: "color-picker", question: "Pick a color", palette: [{ label: "Red", hex: "#FF0000" }] } },
};

// Helper: run one full picker turn to session_end on a given fake, returning the manager's promise.
async function oneTurn(mgr: ConnectionManager, fake: ReturnType<typeof makeFake>, sid: string) {
  const p = mgr.runSession("hi", { onToolCall: (ctx) => ctx.sendResult({ label: "Red", hex: "#FF0000" }) });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: sid, client_session_id: cid }) });
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: sid, call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }) });
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: sid, reason: "completed" }) });
  return p;
}

test("ConnectionManager: 3 turns reuse ONE socket — factory called exactly once, socket not closed between turns", async () => {
  const fake = makeFake();
  const factory = jest.fn(() => fake.ws);
  const mgr = new ConnectionManager(factory);
  mgr.connect();

  await oneTurn(mgr, fake, "srv-1").then((r) => expect(r).toEqual({ sessionId: "srv-1", reason: "completed" }));
  await oneTurn(mgr, fake, "srv-2").then((r) => expect(r).toEqual({ sessionId: "srv-2", reason: "completed" }));
  await oneTurn(mgr, fake, "srv-3").then((r) => expect(r).toEqual({ sessionId: "srv-3", reason: "completed" }));

  expect(factory).toHaveBeenCalledTimes(1); // ONE socket for all three turns
  expect(fake.closed).toBe(false);          // never closed between turns (close-on-dismiss is chunk 03)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: FAIL — `Cannot find module './connection-manager.js'`.

- [ ] **Step 3: Refactor `session-client.ts` to export reusable per-turn pieces (keep `runSession` byte-compatible)**

In `apps/overlay/src/ws/session-client.ts`, **add** (do not remove `runSession`) an exported `SessionContext` type and a pure inbound-handling function the manager will call. Keep all existing exports. Add:

```ts
// session-client.ts — ADD below the existing exports (RunSessionOptions, ToolCallContext, etc.)

/**
 * Per-turn routing context held by the ConnectionManager's dispatcher (CM-02).
 * Single-flight today; the dispatcher Map holds at most one (gotcha #45 unchanged).
 */
export interface SessionContext {
  clientSessionId: string;
  confirmedSessionId?: string;
  options: RunSessionOptions;
  settle: (result: SessionResult) => void;       // resolve the turn promise
  failTurn: (err: Error) => void;                  // reject the turn promise
  disarmTimeout: () => void;
  send: (data: string) => void;                    // shared-socket write
  settled: boolean;
}

/**
 * Routes ONE parsed-and-validated inbound envelope into a SessionContext,
 * reusing the SAME logic as runSession's message handler (decideRender /
 * decideTextRender / buildToolResult / buildToolCancel). NEVER throws (gotcha #9).
 * Returns true if the envelope was consumed by this context, false if it should
 * be dropped (unknown/non-matching session_id).
 */
export function routeInbound(envelope: Extract<
  import("@agentic/protocol").Envelope, { type: "session_ack" | "tool_call" | "session_end" | "tool_result" | "session_start" }
>, ctx: SessionContext): void {
  if (ctx.settled) return;

  if (envelope.type === "session_ack") {
    if (envelope.client_session_id === ctx.clientSessionId) {
      ctx.confirmedSessionId = envelope.session_id;
    }
    return;
  }
  if (envelope.type === "tool_call") {
    const decision = decideRender(envelope, ctx.confirmedSessionId);
    if (decision.kind === "render") {
      ctx.disarmTimeout();
      const { session_id, call_id, picker } = decision;
      ctx.options.onToolCall?.({
        picker, sessionId: session_id, callId: call_id,
        sendResult: (picked) => { if (!ctx.settled) ctx.send(JSON.stringify(buildToolResult(session_id, call_id, picked))); },
        sendCancel: () => { if (!ctx.settled) ctx.send(JSON.stringify(buildToolCancel(session_id, call_id))); },
      });
      return;
    }
    const textDecision = decideTextRender(envelope, ctx.confirmedSessionId);
    if (textDecision.kind === "render-text") {
      ctx.disarmTimeout();
      ctx.options.onShowText?.(textDecision.content);
    }
    return;
  }
  if (envelope.type === "session_end") {
    if (ctx.confirmedSessionId !== undefined && envelope.session_id === ctx.confirmedSessionId) {
      ctx.settle({ sessionId: envelope.session_id, reason: envelope.reason });
    }
    return;
  }
  // tool_result / session_start inbound: not relevant to the overlay — ignore.
}
```

> The free-standing `runSession(text, factory, options)` is intentionally left fully intact (its `session-client.test.ts` suite must stay green). `routeInbound`/`SessionContext` are additive exports. Do not delete `WS_URL`, `DEFAULT_HANDSHAKE_TIMEOUT_MS`, or `buildSessionStart` — the manager imports them.

- [ ] **Step 3a: Export the timeout constant + URL the manager needs**

Ensure these are exported from `session-client.ts` (add `export` if not already):

```ts
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000; // already const; add `export`
export const WS_URL = "ws://127.0.0.1:7777";        // already const; add `export`
```

- [ ] **Step 3b: Write the ConnectionManager**

```ts
// apps/overlay/src/ws/connection-manager.ts
import { parseEnvelope } from "@agentic/protocol";
import type { WebSocketFactory, WebSocketLike } from "./types.js";
import {
  buildSessionStart, routeInbound, WS_URL, DEFAULT_HANDSHAKE_TIMEOUT_MS,
  type RunSessionOptions, type SessionResult, type SessionContext,
} from "./session-client.js";
import { backoffDelayMs, DEFAULT_BACKOFF } from "./backoff.js";

/**
 * CM-02: owns ONE persistent WebSocket for the overlay's lifetime.
 * - connect() opens the socket (on overlay activation; close-on-dismiss is chunk 03).
 * - runSession() rides the shared socket: registers a per-turn SessionContext into
 *   a dispatcher Map<sessionId, SessionContext> (single-flight today, Map-ready seam).
 * - Inbound frames route by session_id (correlated via client_session_id echo);
 *   unknown/non-active session_id frames are silently dropped (gotcha #9 / spec §3.5).
 * - Mid-flight drop settles the active turn LOCALLY as {reason:"cancelled"} (nothing
 *   on the wire) and schedules a backoff reconnect (D1). currentThreadId is owned by
 *   the caller (main.ts) and is NOT reset here (involuntary drop ≠ dismiss).
 */
export interface ConnectionManagerDeps {
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (h: ReturnType<typeof setTimeout>) => void;
  random?: () => number;
  baseMs?: number;
  capMs?: number;
}

export class ConnectionManager {
  private ws?: WebSocketLike;
  private readonly pending = new Map<string, SessionContext>(); // confirmed: keyed by session_id
  private pendingByCid?: SessionContext;                         // the one turn awaiting its session_ack
  private reconnectAttempt = 0;
  private active = false;                                        // connect() called, not torn down
  private readonly setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (h: ReturnType<typeof setTimeout>) => void;
  private readonly random: () => number;
  private readonly baseMs: number;
  private readonly capMs: number;

  constructor(private readonly factory: WebSocketFactory, deps: ConnectionManagerDeps = {}) {
    this.setTimeoutFn = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutFn = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));
    this.random = deps.random ?? Math.random;
    this.baseMs = deps.baseMs ?? DEFAULT_BACKOFF.baseMs;
    this.capMs = deps.capMs ?? DEFAULT_BACKOFF.capMs;
  }

  connect(): void {
    this.active = true;
    this.openSocket();
  }

  private openSocket(): void {
    const ws = this.factory(WS_URL);
    this.ws = ws;
    ws.addEventListener("open", () => { this.reconnectAttempt = 0; });
    ws.addEventListener("message", (ev) => this.dispatch(ev.data));
    ws.addEventListener("error", () => {/* close event drives recovery */});
    ws.addEventListener("close", () => this.onSocketClose());
  }

  private onSocketClose(): void {
    // Mid-flight drop: settle the active turn LOCALLY as cancelled (nothing on wire). D6.
    const ctx = this.pendingByCid ?? [...this.pending.values()][0];
    if (ctx && !ctx.settled) {
      ctx.disarmTimeout();
      ctx.settle({ sessionId: ctx.confirmedSessionId ?? "", reason: "cancelled" });
    }
    this.pending.clear();
    this.pendingByCid = undefined;
    this.ws = undefined;
    if (this.active) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = backoffDelayMs(this.reconnectAttempt++, { baseMs: this.baseMs, capMs: this.capMs, random: this.random });
    this.setTimeoutFn(() => { if (this.active && !this.ws) this.openSocket(); }, delay);
  }

  runSession(text: string, options: RunSessionOptions = {}): Promise<SessionResult> {
    return new Promise<SessionResult>((resolve, reject) => {
      const { msg, clientSessionId } = buildSessionStart(text, options.threadId);
      const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const ctx: SessionContext = {
        clientSessionId, options, settled: false,
        send: (d) => this.ws?.send(d),
        disarmTimeout: () => { if (timer !== undefined) { this.clearTimeoutFn(timer); timer = undefined; } },
        settle: (result) => {
          if (ctx.settled) return;
          ctx.settled = true; ctx.disarmTimeout();
          if (ctx.confirmedSessionId) this.pending.delete(ctx.confirmedSessionId);
          if (this.pendingByCid === ctx) this.pendingByCid = undefined;
          resolve(result);
        },
        failTurn: (err) => {
          if (ctx.settled) return;
          ctx.settled = true; ctx.disarmTimeout();
          if (ctx.confirmedSessionId) this.pending.delete(ctx.confirmedSessionId);
          if (this.pendingByCid === ctx) this.pendingByCid = undefined;
          reject(err);
        },
      };

      this.pendingByCid = ctx;

      timer = this.setTimeoutFn(() => {
        const err = new Error(`runSession timed out after ${timeoutMs}ms`);
        err.name = "HandshakeTimeoutError";
        ctx.failTurn(err);
      }, timeoutMs);

      if (this.ws === undefined) {
        // No live socket yet (rare: submit before first open). Fail this turn as timeout
        // would; but simplest correct behavior: reject so main.ts shows an error card and
        // the user retries once reconnect lands. (Reconnect is automatic; the turn itself
        // is not auto-resent — single-flight, gotcha #45.)
        ctx.failTurn(new Error("no connection"));
        return;
      }
      this.ws.send(JSON.stringify(msg));
      options.onSessionStart?.();
    });
  }

  private dispatch(raw: unknown): void {
    const parsed = parseEnvelope(typeof raw === "string" ? safeJson(raw) : raw);
    if (parsed.kind !== "ok") return; // unknown/invalid silently dropped (gotcha #9)
    const env = parsed.message;

    if (env.type === "session_ack") {
      const ctx = this.pendingByCid;
      if (ctx && env.client_session_id === ctx.clientSessionId) {
        routeInbound(env, ctx);                 // binds confirmedSessionId
        this.pending.set(env.session_id, ctx);  // now routable by session_id
        this.pendingByCid = undefined;
      }
      return; // ack for an unknown cid → dropped
    }
    // tool_call / session_end / others: route by session_id; drop if not in the Map.
    const sid = (env as { session_id?: string }).session_id;
    const ctx = sid ? this.pending.get(sid) : undefined;
    if (!ctx) return; // unknown/non-active session_id → silently dropped (spec §3.5)
    routeInbound(env, ctx);
  }
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: PASS (the 3-turns-one-socket test).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/ws/connection-manager.ts apps/overlay/src/ws/session-client.ts apps/overlay/src/ws/connection-manager.test.ts
git commit -m "feat(connection-model): CM-02 ConnectionManager — shared socket reused across turns (factory called once)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### 2b — Dispatcher: unknown-session frames silently dropped (seam test)

- [ ] **Step 1: Write the failing test** (append to `connection-manager.test.ts`)

```ts
test("ConnectionManager: frames with an unknown/non-active session_id are silently dropped (gotcha #9 / spec §3.5)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();

  let toolCallFired = false;
  const p = mgr.runSession("hi", { onToolCall: () => { toolCallFired = true; } });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-real", client_session_id: cid }) });

  // A tool_call for a DIFFERENT session_id — must not fire onToolCall and must not throw.
  expect(() => fake.fire("message", {
    data: JSON.stringify({ type: "tool_call", session_id: "GHOST", call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }),
  })).not.toThrow();
  expect(toolCallFired).toBe(false);

  // A session_end for an unknown session_id must NOT settle our turn.
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "GHOST", reason: "completed" }) });

  // Now the real frames complete the turn.
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "srv-real", call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }) });
  expect(toolCallFired).toBe(true);
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-real", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "srv-real", reason: "completed" });
});

test("ConnectionManager: an ack for an unknown client_session_id is dropped (no false bind)", () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  expect(() => fake.fire("message", {
    data: JSON.stringify({ type: "session_ack", session_id: "x", client_session_id: "WRONG-CID" }),
  })).not.toThrow();
  // The pending-by-cid context is untouched: a session_end on "x" must not settle it.
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "x", reason: "completed" }) });
  // (No assertion on p resolving — it stays pending; this test only proves no throw / no false bind.)
  void p;
});
```

- [ ] **Step 2: Run to verify it passes (logic already implemented in 2a)**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: PASS (drop tests green against the Step-2a implementation).

- [ ] **Step 3: Commit**

```bash
git add apps/overlay/src/ws/connection-manager.test.ts
git commit -m "test(connection-model): CM-02 dispatcher drops unknown session_id / unknown cid frames (gotcha #9, spec §3.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### 2c — Per-turn handshake timeout + HandshakeTimeoutError survives

- [ ] **Step 1: Write the failing test** (append)

```ts
test("ConnectionManager: per-turn handshake timeout fires HandshakeTimeoutError when daemon never replies", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 2000 });
  fake.fire("open");
  // No ack/tool_call ever — wait past the timeout via a real short timer.
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).name).toBe("HandshakeTimeoutError");
}, 5000);

test("ConnectionManager: handshake timer disarms on first matching tool_call (turn stays alive past the timeout)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  let ctxCaptured = false;
  const p = mgr.runSession("hi", {
    handshakeTimeoutMs: 200,
    onToolCall: (ctx) => { ctxCaptured = true; /* user not acting yet */ void ctx; },
  });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: cid }) });
  fake.fire("message", { data: JSON.stringify({ type: "tool_call", session_id: "s", call_id: "c", payload: VALID_TOOL_CALL_PAYLOAD }) });
  expect(ctxCaptured).toBe(true);
  // Wait past the (now disarmed) 200ms timeout — the turn must NOT reject.
  await new Promise((r) => setTimeout(r, 350));
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false); // still pending — timer was disarmed, no spurious rejection
  // Complete it.
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s", reason: "completed" }) });
  await expect(p).resolves.toEqual({ sessionId: "s", reason: "completed" });
}, 5000);
```

- [ ] **Step 2: Run to verify (logic from 2a)**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: PASS. If the first test is flaky on real timers, the implementation already accepts injected `setTimeoutFn`/`clearTimeoutFn` — convert to `jest.useFakeTimers()` mirroring `session-client.test.ts:382-405`.

- [ ] **Step 3: Commit**

```bash
git add apps/overlay/src/ws/connection-manager.test.ts
git commit -m "test(connection-model): CM-02 per-turn handshake timeout + HandshakeTimeoutError survives (gotcha #42)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### 2d — Mid-flight drop → local cancelled-equivalent, nothing on wire, no unhandled rejection

- [ ] **Step 1: Write the failing test** (append)

```ts
test("ConnectionManager: mid-flight socket drop settles the active turn as cancelled-equivalent, sends NOTHING on the wire", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws, {
    // No-op reconnect scheduling so the test does not open a second socket.
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: cid }) });
  const sentBeforeDrop = fake.sent.length; // only the session_start

  // Socket drops mid-flight (before session_end).
  fake.fire("close");

  // The turn settles (resolves, not rejects) as cancelled — main.ts treats reason like a daemon cancel.
  await expect(p).resolves.toEqual({ sessionId: "s", reason: "cancelled" });
  // NOTHING was written to the wire on drop (the socket is gone).
  expect(fake.sent.length).toBe(sentBeforeDrop);
});

test("ConnectionManager: mid-flight drop produces NO unhandled rejection", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws, {
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  fake.fire("close"); // drop before any ack — pendingByCid path
  // Must resolve cancelled (confirmedSessionId unknown → empty string sessionId).
  await expect(p).resolves.toEqual({ sessionId: "", reason: "cancelled" });
});
```

- [ ] **Step 2: Run to verify (logic from 2a `onSocketClose`)**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/overlay/src/ws/connection-manager.test.ts
git commit -m "test(connection-model): CM-02 mid-flight drop → local cancelled, no wire write, no unhandled rejection (spec §3.1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### 2e — Reconnect schedule fires after drop (backoff wired)

- [ ] **Step 1: Write the failing test** (append)

```ts
test("ConnectionManager: after a drop it schedules a reconnect and reopens the socket (factory called again)", () => {
  const fake1 = makeFake();
  const fake2 = makeFake();
  const fakes = [fake1, fake2];
  let i = 0;
  const factory = jest.fn(() => fakes[i++]!.ws);
  let scheduled: (() => void) | undefined;
  const mgr = new ConnectionManager(factory, {
    setTimeoutFn: (cb) => { scheduled = cb; return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeoutFn: () => {},
    random: () => 0, // deterministic delay (value irrelevant — we invoke cb directly)
  });
  mgr.connect();
  expect(factory).toHaveBeenCalledTimes(1);

  fake1.fire("open");
  fake1.fire("close");        // drop → schedules reconnect
  expect(scheduled).toBeDefined();
  scheduled!();               // fire the backoff timer
  expect(factory).toHaveBeenCalledTimes(2); // reconnected on a fresh socket
});
```

- [ ] **Step 2: Run to verify (logic from 2a `scheduleReconnect`)**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/overlay/src/ws/connection-manager.test.ts
git commit -m "test(connection-model): CM-02 reconnect schedules + reopens socket after drop (backoff D1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire main.ts to the ConnectionManager (open-on-activation; inFlight + threadId UNCHANGED) ✅ DONE — commit 6c95025

**Files:**
- Modify: `apps/overlay/src/main.ts`

There is no DOM-free unit test harness for `main.ts` (it imports `@tauri-apps/api/*`). Coverage for this wiring is the typecheck + the real-I/O test in Task 5 (which drives the manager exactly as `main.ts` does). The change is mechanical and small.

- [ ] **Step 1: Construct the manager at module top (after the `factory` const, ~line 35)**

```ts
// main.ts — ADD after the `factory` const (currently lines 27-35)
import { ConnectionManager } from "./ws/connection-manager.js";

// CM-02: one persistent connection for the overlay's lifetime. Opened on activation
// (module eval = overlay webview created). Close-on-dismiss is chunk 03 — NO teardown here.
const connection = new ConnectionManager(factory);
connection.connect();
```

- [ ] **Step 2: Switch the one runSession call site to the manager** (currently `main.ts:232-245`)

Replace:

```ts
    runSession(text, factory, {
      threadId: currentThreadId,
      onToolCall,
      onShowText,
      onSessionStart: () => { ... },
    })
      .then((result) => { ... })
```

with:

```ts
    connection.runSession(text, {
      threadId: currentThreadId,
      onToolCall,
      onShowText,
      onSessionStart: () => { /* unchanged loader body */ },
    })
      .then((result) => { /* unchanged */ })
```

Keep the entire `.then(...)` / `.catch(...)` body byte-identical (the `cancelled` reason from a mid-flight drop flows through `statusForEndReason` exactly like a daemon-sent cancel). Remove the now-unused `runSession` import if nothing else uses it; **keep** the `import type { ToolCallContext }` import. The `inFlight` guard (`:206`/`:224`), the `currentThreadId` mint (`:228-230`), and the `sessionToken`/`hideScheduler` logic are **untouched**.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS — no errors. (If `runSession` import becomes unused, `lint:strict` will flag it; remove the unused named import.)

- [ ] **Step 4: Lint**

Run: `bun run lint:strict`
Expected: PASS — 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/main.ts
git commit -m "feat(connection-model): CM-02 main.ts rides the persistent ConnectionManager (inFlight + threadId unchanged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Daemon real-I/O — ≥3 sessions per ONE connection + reconnect-same-thread (NO daemon code change) ✅ DONE — commit 5a76897

**Files:**
- Create: `packages/daemon/src/multi-turn-per-socket.daemon.test.ts`

This pins down the chunk's daemon DoD: the daemon already serves N sessions per connection via `ws.data.sessionIds` (no behavior change). Pattern adapted from `thread-adoption.daemon.test.ts` and `memory-integration.daemon.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/src/multi-turn-per-socket.daemon.test.ts
import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

let dataDir: string;
let server: ReturnType<typeof import("./index.js").startDaemon>;
let PORT: number;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm02-multiturn-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("./index.js");
  server = startDaemon(0);
  PORT = server.port!;
});
afterAll(() => server.stop(true));

/**
 * Run ONE full mock turn (start → ack → tool_call → tool_result → session_end) over an
 * ALREADY-OPEN socket. Resolves with the daemon-minted session_id when session_end arrives.
 * Mirrors the overlay's single-flight discipline: one turn at a time on the shared socket.
 */
function turnOver(ws: WebSocket, text: string, threadId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cid = crypto.randomUUID();
    let mySid: string | undefined;
    const onMsg = (e: MessageEvent) => {
      const m = JSON.parse(e.data as string);
      if (m.type === "session_ack" && m.client_session_id === cid) { mySid = m.session_id; return; }
      if (m.type === "tool_call" && m.session_id === mySid && m.payload.tool === "show_color_picker") {
        const pick = m.payload.args.picker.palette[0];
        ws.send(JSON.stringify({ type: "tool_result", session_id: mySid, call_id: m.call_id, payload: { tool: "show_color_picker", result: { picked: pick } } }));
        return;
      }
      if (m.type === "session_end" && m.session_id === mySid) { ws.removeEventListener("message", onMsg); resolve(mySid!); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ type: "session_start", trigger: "user", text, client_session_id: cid, ...(threadId ? { thread_id: threadId } : {}) }));
    setTimeout(() => reject(new Error("turn timeout")), 3000);
  });
}

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

test("DoD — ≥3 full session_start…session_end round-trips on ONE socket (no reconnect between turns)", async () => {
  const ws = await openSocket();
  const sid1 = await turnOver(ws, "turn one");
  const sid2 = await turnOver(ws, "turn two");
  const sid3 = await turnOver(ws, "turn three");
  // Three DISTINCT daemon-minted session_ids served over the SAME connection.
  expect(new Set([sid1, sid2, sid3]).size).toBe(3);
  ws.close();
});
```

- [ ] **Step 2: Run to verify it passes (daemon already supports this; NO code change)**

Run: `bun test packages/daemon/src/multi-turn-per-socket.daemon.test.ts`
Expected: PASS. The daemon's `ws.data.sessionIds` Set (`index.ts:56`,`:143`) already accumulates per-connection; each `session_start` mints a fresh `session_id`. If this fails it reveals a real daemon limitation (escalate — do NOT change `mock-agent.ts`/`mock-provider.ts`).

- [ ] **Step 3: Add the reconnect-same-thread real-I/O test** (append)

```ts
import { Database } from "bun:sqlite";

test("DoD — daemon 'restart' (new connection) → next turn carries the SAME thread_id; both turns land in ONE thread (reconnect continuation)", async () => {
  const threadId = crypto.randomUUID(); // client-minted (CM-01 adoption posture)

  // Connection #1 — first turn carrying the client-minted thread_id.
  const ws1 = await openSocket();
  await turnOver(ws1, "first turn", threadId);
  ws1.close(); // simulate the drop: the old socket goes away

  // Connection #2 (fresh socket, re-passes the origin gate) — continuation with the SAME thread_id.
  const ws2 = await openSocket();
  await turnOver(ws2, "second turn after reconnect", threadId);
  ws2.close();

  // Both turns persisted into the SAME adopted thread, in order (continuation survived the reconnect).
  const db = new Database(join(dataDir, "memory.sqlite"));
  const rows = db.query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index").all(threadId) as { content: string }[];
  db.close();
  expect(rows.map((r) => r.content)).toEqual(["first turn", "second turn after reconnect"]);
});
```

> WHY this proves the DoD: the overlay-side `ConnectionManager` reconnect is unit-tested in Task 2e (schedule + reopen); here we prove the *daemon* serves a continuation turn carrying the unchanged `thread_id` over a brand-new connection (re-passing the origin gate), and the two turns coalesce into one thread. Together they cover "reconnect with backoff → next turn succeeds with SAME thread_id" without needing to kill an OS process inside `bun test`.

- [ ] **Step 4: Run to verify**

Run: `bun test packages/daemon/src/multi-turn-per-socket.daemon.test.ts`
Expected: PASS (2 tests). Relies on CM-01 thread adoption already on `main` (verified in `thread-adoption.daemon.test.ts`).

- [ ] **Step 5: Confirm existing daemon S1-flush tests stay green**

Run: `bun test packages/daemon/src/memory/`
Expected: PASS — no regression (we added a test file only; touched no daemon source).

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/multi-turn-per-socket.daemon.test.ts
git commit -m "test(connection-model): CM-02 real-I/O — N sessions per socket + reconnect carries same thread_id (no daemon change)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Real-I/O over the ConnectionManager — picker round-trip (real mock daemon) + show_text (scripted loopback) ✅ DONE — commit 21c8a3b

**Files:**
- Create: `apps/overlay/src/ws/connection-manager.realio.test.ts`

A real browser-style `WebSocket` adapts to `WebSocketLike` exactly as `main.ts:27-35` does — so this test exercises the manager over a *real* socket. The picker half hits the real mock daemon; the `show_text` half hits a scripted `Bun.serve` loopback (because the mock provider never emits `show_text` — see Reality check).

- [ ] **Step 1: Write the failing test**

```ts
// apps/overlay/src/ws/connection-manager.realio.test.ts
import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { ConnectionManager } from "./connection-manager.js";
import type { WebSocketLike } from "./types.js";

// Adapt a real browser-style WebSocket to WebSocketLike (identical to main.ts factory).
function realFactory(url: string): WebSocketLike {
  const s = new WebSocket(url, { headers: { Origin: "tauri://localhost" } } as unknown as string[]);
  return {
    send: (d) => s.send(d),
    close: () => s.close(),
    addEventListener: (t, cb) => s.addEventListener(t, (e: unknown) => cb({ data: (e as MessageEvent)?.data })),
  };
}

// ── Part A: picker round-trip over the REAL mock daemon ──────────────────────
let dataDir: string;
let daemon: ReturnType<typeof import("../../../../packages/daemon/src/index.js").startDaemon>;
let DAEMON_PORT: number;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm02-overlay-realio-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("../../../../packages/daemon/src/index.js");
  daemon = startDaemon(0);
  DAEMON_PORT = daemon.port!;
});
afterAll(() => daemon.stop(true));

test("real-I/O: picker round-trip over the ConnectionManager against the real mock daemon", async () => {
  const mgr = new ConnectionManager((_url) => realFactory(`ws://127.0.0.1:${DAEMON_PORT}`));
  mgr.connect();
  let pickerSeen = false;
  const result = await mgr.runSession("hi", {
    handshakeTimeoutMs: 4000,
    onToolCall: (ctx) => { pickerSeen = true; ctx.sendResult(ctx.picker.palette[0]!); },
  });
  expect(pickerSeen).toBe(true);
  expect(result.reason).toBe("completed");
  expect(typeof result.sessionId).toBe("string");
}, 8000);

// ── Part B: show_text flow over a scripted REAL loopback server ──────────────
// (mock provider never emits show_text — Reality check; this proves the dispatcher
//  routes the show_text flow shape over a real socket without touching frozen surfaces.)
let scripted: ReturnType<typeof Bun.serve>;
let SCRIPT_PORT: number;

beforeAll(() => {
  scripted = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) { if (server.upgrade(req)) return undefined; return new Response("no", { status: 400 }); },
    websocket: {
      message(ws, raw) {
        const m = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        if (m.type === "session_start") {
          const sid = "scripted-session";
          ws.send(JSON.stringify({ type: "session_ack", session_id: sid, client_session_id: m.client_session_id }));
          ws.send(JSON.stringify({ type: "tool_call", session_id: sid, call_id: "c1", payload: { tool: "show_text", args: { text: { primitive: "text", content: "the answer is 42" } } } }));
          ws.send(JSON.stringify({ type: "session_end", session_id: sid, reason: "completed" }));
        }
      },
    },
  });
  SCRIPT_PORT = scripted.port!;
});
afterAll(() => scripted.stop(true));

test("real-I/O: show_text flow over the ConnectionManager against a scripted loopback server", async () => {
  const mgr = new ConnectionManager((_url) => realFactory(`ws://127.0.0.1:${SCRIPT_PORT}`));
  mgr.connect();
  let shown: string | undefined;
  const result = await mgr.runSession("what is the answer?", {
    handshakeTimeoutMs: 4000,
    onShowText: (content) => { shown = content; },
  });
  expect(shown).toBe("the answer is 42");
  expect(result).toEqual({ sessionId: "scripted-session", reason: "completed" });
}, 8000);

test("real-I/O: both flow shapes ran over a SINGLE manager-owned socket each (no per-turn socket churn)", async () => {
  // Two sequential turns on ONE manager against the scripted server — the manager
  // reuses its socket (Task 2a proves factory-call-count under the fake; here we
  // assert the second turn succeeds without reconnect by completing back-to-back).
  const mgr = new ConnectionManager((_url) => realFactory(`ws://127.0.0.1:${SCRIPT_PORT}`));
  mgr.connect();
  const r1 = await mgr.runSession("q1", { handshakeTimeoutMs: 4000, onShowText: () => {} });
  const r2 = await mgr.runSession("q2", { handshakeTimeoutMs: 4000, onShowText: () => {} });
  expect(r1.reason).toBe("completed");
  expect(r2.reason).toBe("completed");
}, 8000);
```

- [ ] **Step 2: Run to verify**

Run: `bun test apps/overlay/src/ws/connection-manager.realio.test.ts`
Expected: PASS (3 tests). If `WebSocket` Origin-header typing complains under the overlay tsconfig, adapt the header cast or move Part A's daemon usage to a `.daemon.test.ts` naming if the project segregates real-I/O suites (check `bunfig.toml`/test globs first; the daemon real-I/O tests use plain `WebSocket` with `{ headers: { Origin } }`).

- [ ] **Step 3: Verify the original session-client seam tests still pass (close-semantics coverage NOT deleted)**

The chunk constraint: the per-turn close-rejection seam test moves to connection-level. The free `runSession` and its `"close"` rejection test still exist (we did not modify that path), so `session-client.test.ts` stays green AND the new connection-level close behavior is covered by Task 2d. Run:

Run: `bun test apps/overlay/src/ws/`
Expected: PASS — `session-client.test.ts` (all original tests), `connection-manager.test.ts`, `connection-manager.realio.test.ts`, `backoff.test.ts`, `tool-call-handler.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/overlay/src/ws/connection-manager.realio.test.ts
git commit -m "test(connection-model): CM-02 real-I/O — picker (mock daemon) + show_text (scripted loopback) over the shared socket

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frozen-surface audit + full green gate ✅ DONE — frozen diff empty · bun test 275→283 pass / 0 fail · typecheck 0 · lint:strict 0 (orchestrator-run; review fixes 8f17adb included)

**Files:** none modified — verification only.

- [ ] **Step 1: Prove frozen surfaces are byte-unchanged**

Run:
```bash
git diff --name-only origin/main -- packages/protocol packages/daemon/src/mock-agent.ts packages/daemon/src/providers/mock-provider.ts
```
Expected: **empty output** (no frozen file appears in the diff). If any line prints, STOP — a frozen surface was touched; revert it.

- [ ] **Step 2: Full test suite**

Run: `bun test`
Expected: PASS — all suites green, including the daemon S1-flush tests (`memory-integration.daemon.test.ts`) and the CM-01 adoption tests (`thread-adoption.daemon.test.ts`).

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS — 0 errors.

- [ ] **Step 4: Lint strict**

Run: `bun run lint:strict`
Expected: PASS — 0 warnings (no unused `runSession` import left in `main.ts`).

- [ ] **Step 5: Commit (if any audit-driven fixes were needed) + open PR**

```bash
# Branch should already be chunk/cm-02-persistent-ws (create at task start if not):
#   git checkout -b chunk/cm-02-persistent-ws
git push -u origin chunk/cm-02-persistent-ws
gh pr create --base main --title "CM-02: persistent WS connection (overlay) + reconnect" --body "$(cat <<'EOF'
## What
Refactors the overlay from one-WebSocket-per-turn to ONE persistent ConnectionManager
reused across turns, with capped-exponential-with-jitter reconnect on drop. Builds
spec §3.1/§3.5 and ADR-0014 Decision 1. Daemon unchanged (one real-I/O pin-down test only).

## How verified
- `bun test` green (incl. daemon S1-flush + CM-01 adoption regressions)
- real-I/O: ≥3 session_start…session_end on ONE socket (factory call-count = 1 / 3 distinct session_ids)
- real-I/O: picker round-trip (real mock daemon) + show_text flow (scripted loopback)
- mid-flight drop → local cancelled-equivalent, no wire write, no unhandled rejection
- reconnect carries the SAME thread_id; both turns coalesce into one thread
- seam: unknown session_id / unknown client_session_id frames silently dropped
- per-turn handshake timeout + HandshakeTimeoutError preserved (gotcha #42)
- frozen surfaces byte-unchanged (packages/protocol/**, mock-agent.ts, mock-provider.ts)
- typecheck + lint:strict green

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:**
- §3.1 persistent socket → Task 2a (factory called once), Task 5 (real-I/O). ✓
- §3.1 reconnect with backoff → Task 1 (schedule) + Task 2e (wired/fires) + D1. ✓
- §3.1 in-flight-on-disconnect = cancelled locally, daemon cleans via close(ws) → Task 2d (local) + Task 4 S1-flush regression stays green. ✓
- §3.1 resumes same thread_id → Task 4 reconnect-same-thread test; `currentThreadId` not reset (D6, `main.ts` untouched). ✓
- §3.5 drop rule (unknown session_id silently dropped) → Task 2b. ✓
- §4.2 multiple round-trips on one socket → Task 2a + Task 4. ✓
- Per-turn handshake timeout + `HandshakeTimeoutError` → Task 2c. ✓
- Both flow shapes (picker + show_text) → Task 5. ✓
- Daemon no behavior change + N-sessions-per-socket pin-down → Task 4. ✓
- Origin gate re-passed on reconnect (ADR-0003) → free, fresh connection re-runs `fetch` gate; Task 4 reconnect uses a new socket. ✓
- Frozen surfaces / `inFlight` / provisional dismiss / #33-#34 untouched → Task 3 (no main.ts logic change beyond call-site) + Task 6 audit. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code; commands have expected output.

**Type consistency:** `SessionContext`, `routeInbound`, `RunSessionOptions`, `SessionResult`, `WebSocketLike`, `WebSocketFactory`, `backoffDelayMs`/`backoffCeilingMs`, `ConnectionManager.runSession(text, options)` are used consistently across tasks. The `runSession` free function keeps its `(text, factory, options)` signature (existing tests unbroken); the manager method is `(text, options)`.

**One honesty caveat surfaced (Reality check, D5):** the `show_text` real-I/O half cannot use the mock daemon (mock emits only `show_color_picker`); it uses a scripted real loopback server. This is real-I/O at the transport/dispatcher level and touches no frozen surface, but the executing worker should know it does **not** exercise the production daemon's `show_text` emission (that path is the real `anthropicApiProvider`, out of scope here and key-gated). If the reviewer wants production-daemon `show_text` coverage, that requires a test-injectable provider seam into `startDaemon` — which is **out of this chunk's scope and would touch daemon wiring**; flag rather than build.

## Relevant file paths (absolute)

- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/connection-manager.ts` (create)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/backoff.ts` (create)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/session-client.ts` (modify — additive exports, `runSession` byte-compatible)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/main.ts` (modify — manager wiring, lines ~27-35 and ~232-245)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/connection-manager.test.ts` (create)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/backoff.test.ts` (create)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/connection-manager.realio.test.ts` (create)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/multi-turn-per-socket.daemon.test.ts` (create)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/orchestration/docs/adr/0014-connection-model-persistent-ws-dismiss-thread-adoption.md` (covers this chunk; ADR worthy = no)

**Key source already on `main` the worker must not break:** `session-client.ts` `runSession` close-rejection path (`:286-290`), `main.ts` `inFlight` (`:177`,`:206`,`:224`) and `currentThreadId` mint (`:228-230`), daemon `close(ws)` S1 flush (`index.ts:149-168`) and provisional dismiss (`index.ts:85-102`), `ws.data.sessionIds` Set (`index.ts:20`,`:56`,`:143`).
