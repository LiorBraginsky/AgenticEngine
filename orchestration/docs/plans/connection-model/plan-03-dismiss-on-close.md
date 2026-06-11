# Connection Model CM-03: dismiss = close(ws) → consolidate; retire the provisional trigger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Project discipline is TDD (superpowers:test-driven-development) — every implementation step is preceded by a failing test that you run and watch fail first.

**Goal:** On the persistent CM-02 connection, wire the genuine dismiss signal — daemon `close(ws)` fires `ConsolidationHook.dismiss(threadId)` for every active thread on the connection (flush-then-dismiss); retire the provisional thread-switch trigger; the overlay's dismiss affordance deliberately closes the socket and resets `currentThreadId` without triggering reconnect.

**Architecture:** The daemon's `close(ws)` handler (already does the S1 partial-turn flush) gains a dismiss-all-active-threads loop after the flush, tracking touched thread ids on `ws.data`. The provisional `session_start` thread-switch dismiss block is deleted (one caller change, per spec §3.2). On the overlay, `ConnectionManager` gains a public `dismiss()` that sets `active = false` before calling `ws.close()`, so the existing `onSocketClose` skips reconnect for a voluntary close while still reconnecting on an involuntary drop. `main.ts`'s `EV_TEXT_DISMISS` handler is wired to call `connection.dismiss()` and reset `currentThreadId`. Two carry-forwards: the dead standalone `runSession` (tests-only) is retired with its tests migrated to manager equivalents; a one-line cross-file invariant comment documents the `inFlight` single-flight dependency.

**Tech Stack:** TypeScript on Bun, `bun:test`, real SQLite (`bun:sqlite`) + real `Bun.serve` daemon for real-I/O tests, the frozen `@agentic/protocol` Zod union (untouched), injected `WebSocketFactory` as the DOM-free seam.

---

## Status: tasks complete — review-complete (PR #36, ready-to-merge). Task 1 (8e2703e, 7deaad1) · Task 2 (9ddf991) · Task 3 (23eb248) · Task 4 (0fbabb3) · review fixups (08cdea7). Gates: typecheck 0 / lint:strict 0 / bun test 275 pass 0 fail (main 278: +11/−14 — deleted runSession tests were manager-suite duplicates or per-turn-socket-contract assertions) / frozen surfaces diff empty / engine-reviewer round 1: 0 blockers, 2 MINOR doc comments applied, 2 NIT no-action. Task 4 audit drift vs plan expectation: 5 unique assertion sets found (NOT zero) → migrated into connection-manager.test.ts. Merge withheld per crawl-rung conductor override (§11.4 — Jimmy re-verifies on clean checkout). Chunk stays in-progress pending the JOINT 6-step demo (Lior-gated).

---

## Reality check

Verified against current `main` (CM-02 / PR #35 merged at `5aadc9d`). Behavioral claims below are **code-path observations**, not runtime-verified — each DoD behavior becomes a green test (this chunk's merge gate is the mechanical/real-I/O set; the behavioral 6-step demo is Lior-gated and is NOT a plan task per the chunk's 2026-06-10 DoD ruling). Where a claim is about runtime behavior I mark it "requires the test to confirm," never "verified by reading."

**(a) Close-handler location + S1 flush shape — CONFIRMED, exact match.** `packages/daemon/src/index.ts:149-168`. The `close(ws)` handler iterates `ws.data.sessionIds`, and for each session with a known thread and non-empty `messages` calls `lifecycle.endTurn(threadId, sid, session.messages)` inside a try/catch (B1 non-fatal: logs `"partial-turn flush error on disconnect"`, never throws), then `sessions.delete(sid)` + `lifecycle.forgetSession(sid)`. No dismiss call exists here today. The chunk's "149-168" is exact.

**(b) Provisional block location + which tests assert it — CONFIRMED location; KEY DRIFT on tests.** `index.ts:85-102` is the `PROVISIONAL: thread-switch dismiss` block inside the `inbound.type === "session_start"` branch: when `prevThreadId = ws.data.activeThreadId` exists and differs from `inbound.thread_id`, and is not already in `ws.data.dismissedThreadIds`, it calls `await hook.dismiss(prevThreadId)` in a try/catch/finally (finally always adds to `dismissedThreadIds`). The chunk's "85-102" is exact.
> **DRIFT (load-bearing):** **No test drives this provisional block via a WS thread-switch.** `distiller-integration.daemon.test.ts:74-76` carries an explicit comment: *"PROVISIONAL trigger fires only on same-WS thread-switch; each runTurn uses a fresh WS. The store-level distill is the real-I/O proof…"*. Every dismiss test (`memory-integration.daemon.test.ts:142` "dismiss invokes the registered consolidation-hook…", and all of `distiller-integration.daemon.test.ts`) calls `hook.dismiss(tid)` **directly at the store level**, never through the provisional WS path. So the chunk's framing "tests asserting the provisional trigger are UPDATED to close-trigger equivalents" must be read precisely: there are **zero** provisional-WS-path assertions to update. What must survive is the **dismiss → status=dismissed → distillation_events row** coverage, which is provider-/trigger-agnostic and already store-level — it is preserved as-is, and this chunk ADDS the missing **close(ws)-driven** real-I/O coverage that never existed (the provisional block was always tested only via direct `hook.dismiss`). I treat "coverage preserved" as: the store-level dismiss tests stay green AND new close-trigger real-I/O tests are added. Deleting the provisional block touches no existing test's assertions.

**(c) What `ws.data` carries today — CONFIRMED.** `index.ts:19-23`: `SocketData = { sessionIds: Set<string>; activeThreadId?: string; dismissedThreadIds?: Set<string> }`. `sessionIds` initialized at upgrade (`:56`), `.add(sid)` on non-done advance (`:143`). `activeThreadId` is set on every `session_start` advance (`:105`). `dismissedThreadIds` is lazily created only inside the provisional block (`:99`). These three fields are the starting material for tracking "active threads on this connection."
> **Note:** `activeThreadId` is a single value (last `session_start`'s thread), overwritten each `session_start` — so on a real overlay run (one stable `currentThreadId`) it holds the one active thread. For the contract "any active thread on that connection," see Design decision D3: I introduce a `touchedThreadIds: Set<string>` so a same-socket thread switch (two distinct client-minted ids) still dismisses BOTH on close (DoD bullet 2).

**(d) Overlay dismiss affordances flow today — CONFIRMED.** Three user-facing dismiss-ish paths in `main.ts`:
  - `EV_TEXT_DISMISS` listener (`main.ts:172-177`): fired by `widget.ts` on the text card's × click (`widget.ts:139`) or Escape when `currentMode==="text"` (`widget.ts:168-170`). Today it only `hideWidgetWindow()` + clears `lastRenderKind` + `input.value`. **This is the user-visible "dismiss the answer" affordance** and the natural place to wire dismiss-the-conversation.
  - Main-input Escape (`main.ts:375-377`): `hidePanel()` only — hides the input window. This is "put the launcher away," not "dismiss the conversation."
  - Main-input blur (`main.ts:410-413`, guarded by `inFlight`): `hidePanel()` only.
  `currentThreadId` (`main.ts:195`) is minted once per app run on first submit (`:233-235`) and never reset (the deliberate CM-01 interim wart, documented `:189-193`). No path resets it today.

**(e) ConnectionManager close/reconnect seam — CONFIRMED, no voluntary-close hook exists yet.** `connection-manager.ts`: `connect()` sets `active = true` then `openSocket()`. `onSocketClose()` (`:62-75`) settles the active turn locally as `cancelled`, clears the dispatcher, nulls `this.ws`, and `if (this.active) this.scheduleReconnect()`. **There is no public `close()`/`dismiss()` method and no way to set `active=false`.** `active` is the single reconnect gate — this is exactly the seam for "deliberate close, no reconnect" (D2): a `dismiss()` that sets `active=false` BEFORE `ws.close()` makes the same `onSocketClose` skip reconnect.

**(f) Dead standalone `runSession` span + callers — CONFIRMED, tests-only.** `session-client.ts:149-292` is the free `runSession(text, factory, options)` that opens its own socket (`factory(WS_URL)` at `:156`) and closes it on finish/fail (`:185`,`:193`). Grep for `runSession(` across `apps/overlay`: production caller is `main.ts:237` = `connection.runSession(...)` (the **manager** method, not the free function). The free function is imported and called **only** by `session-client.test.ts` (15 call sites: `:45,:93,:143,:190,:215,:241,:250,:275,:326,:389,:415,:471,:480,:507`). It is a dead-in-production parallel socket-lifetime contract — carry-forward 1 retires it. The additive exports it shares the file with — `buildSessionStart`, `routeInbound`, `SessionContext`, `WS_URL`, `DEFAULT_HANDSHAKE_TIMEOUT_MS`, `RunSessionOptions`, `ToolCallContext`, `SessionResult` — are imported by `connection-manager.ts` and MUST be kept.

**(g) How `ConsolidationHook.dismiss` is invoked + the empty-distillation row shape — CONFIRMED.** `consolidation-hook.ts:23-26`: `dismiss(threadId)` runs `UPDATE threads SET status='dismissed' WHERE thread_id=?` then `await this.handler(threadId, "dismiss")`. The registered handler (`distiller-registration.ts:22-41`) distills, scans, inserts clean facts, and **always** writes a row via `store.insertDistillationEvent(threadId, "dismiss", clean.length, provider.id)` — even when `clean.length === 0` (5b observability). The empty-thread row shape is proven by `distiller-integration.daemon.test.ts:276-299`: `readDistillationEvents(threadId)` returns one row with `facts_produced === 0` and `trigger === "dismiss"`. `insertDistillationEvent` (`store.ts:342-348`) writes `(id, thread_id, trigger, facts_produced, distiller_version, created_at)`. The daemon wires `registerDistiller(hook, store, memoryProvider, scanner)` at `index.ts:45`, so the production `close(ws)→hook.dismiss` path will produce the same row.

**Frozen surfaces — current state:** `packages/protocol/**`, `mock-agent.ts`, `mock-provider.ts` are untouched on `main`. No wire change is needed (spec §3.2, ADR-0014 decision 2). The mock provider still emits only `show_color_picker` (never `show_text`) — irrelevant here, since this chunk's real-I/O tests drive the picker flow + dismiss, not `show_text`.

---

## Design decisions

**D1 — The user-visible dismiss affordance wired to socket-close is `EV_TEXT_DISMISS` (text card × / Escape-when-text).**
*Decision:* The `main.ts:172` `EV_TEXT_DISMISS` listener is the affordance that calls `connection.dismiss()` and resets `currentThreadId`. Main-input Escape (`:375`) and blur (`:410`) stay `hidePanel()`-only — they "put the launcher away" (the panel can be re-summoned to the SAME conversation), they do not end the conversation.
*Why:* `EV_TEXT_DISMISS` is the single existing affordance whose semantics already mean "I'm done with this answer" — it is the demo's "dismiss the overlay" step 3 behavior. The text card is the only persistent CONTENT surface (dismiss-policy: text = persist-until-human-dismiss); dismissing it is the natural "conversation over" gesture. Escape/blur are transient hide gestures that today already coexist with a live `currentThreadId` (you can hide the input and re-summon mid-conversation); promoting them to conversation-enders would silently change launcher feel and break "re-summon continues the thread" for the hide-and-come-back case. Keeping dismiss on the explicit × / text-Escape keeps the asymmetry crisp.
*Alternatives rejected:* (a) Wire Escape/blur to dismiss too — rejected: conflates "hide the launcher" with "end the conversation," and entangles the blur path (gotcha-prone, `inFlight`-guarded) with thread lifecycle; the chunk explicitly warns against entangling #33/#34 hide-timers. (b) Add a brand-new explicit "new conversation" affordance — rejected: out of scope (no new UI primitive this chunk), and `EV_TEXT_DISMISS` already exists and carries the right meaning.

**D2 — The overlay distinguishes voluntary close from involuntary drop via a manager state flag (`active`), flipped by a new public `dismiss()` BEFORE `ws.close()`.**
*Decision:* Add `ConnectionManager.dismiss(): void` that (1) sets `this.active = false`, (2) calls `this.ws?.close()`. The existing `onSocketClose()` already does `if (this.active) this.scheduleReconnect()` — so with `active=false` the close settles any in-flight turn locally and **does not** reconnect. An involuntary drop (daemon restart / sleep-wake) fires `close` while `active` is still `true`, so reconnect proceeds unchanged. `dismiss()` does NOT itself reset `currentThreadId` — that is `main.ts`'s state (D4); the manager exposes the close, `main.ts` owns the thread handle.
*Why:* `active` is already the sole reconnect gate (Reality check (e)); flipping it before `ws.close()` is the minimal correct asymmetry with zero new state machine. Setting `active=false` first guarantees the synchronously-or-asynchronously-fired `close` event sees the new value (the flag is read inside the same `onSocketClose`, after `ws.close()` returns). It reuses the proven local-cancel-on-close path (D6 from CM-02) so an in-flight turn at dismiss-time settles cleanly with no unhandled rejection.
*Alternatives rejected:* (a) Discriminate by WebSocket close-code — rejected: the `WebSocketLike` seam (`types.ts:8-15`) exposes no close-code, and the daemon close handler can't tell voluntary from involuntary either (both are just `close(ws)`); a code would be overlay-internal anyway, so a flag is simpler and DOM-free. (b) A separate boolean `voluntaryClose` distinct from `active` — rejected: redundant; `active=false` already means "do not reconnect," which is exactly the voluntary-dismiss semantics, and after dismiss the manager is intentionally torn down (re-summon constructs a fresh manager — see D4).

**D3 — The daemon dismisses EVERY active (not-yet-dismissed) thread touched on the connection, tracked via a new `ws.data.touchedThreadIds: Set<string>`, flush-FIRST then dismiss.**
*Decision:* Extend `SocketData` with `touchedThreadIds?: Set<string>`. On every `session_start` advance, after resolving `turnThreadId`, add it to `touchedThreadIds` (alongside the existing `activeThreadId = turnThreadId`). In `close(ws)`: keep the existing S1 partial-turn flush loop **first** (unchanged), then iterate `touchedThreadIds`, and for each thread NOT already in `dismissedThreadIds`, call `await hook.dismiss(threadId)` inside a try/catch (B1: log, never throw, never block cleanup), adding to `dismissedThreadIds` in a `finally`.
*Why:* The contract (spec §3.2) is "any active thread on that connection." `activeThreadId` alone holds only the last thread — a same-socket thread switch (two distinct client-minted ids in one connection) would leave the first thread undismissed (DoD bullet 2 fails). A `touchedThreadIds` Set is the literal "threads touched on this connection." Flush-first is mandatory: `lifecycle.endTurn` must persist the final turn's delta before the distiller reads the thread, or the distiller misses the last turn. The `dismissedThreadIds` guard + `finally` mirrors the provisional block's exact B1 discipline (we're moving that discipline to the close handler, not inventing it), so a partial/failed dismiss never retries-loops.
*Alternatives rejected:* (a) Reuse `activeThreadId` only — rejected: fails the two-threads-one-connection DoD. (b) Derive touched threads from `sessionIds` via `lifecycle.threadForSession` at close-time — rejected: `forgetSession` is called in the flush loop and `threadForSession` bindings may be gone; tracking at `session_start` time is unambiguous and survives session cleanup. (c) Dismiss inside the flush loop (per-session) — rejected: a thread can have multiple sessions; dismissing per-session would double-dismiss; per-thread-once (Set) is correct.

**D4 — `main.ts` resets `currentThreadId = undefined` in the dismiss handler, and re-summon constructs/connects a fresh manager + mints a fresh thread on next submit.**
*Decision:* In the `EV_TEXT_DISMISS` handler, after the existing hide/clear, call `connection.dismiss()` and set `currentThreadId = undefined`. Because `dismiss()` tears the socket down with no reconnect, the next submit needs a live socket — so the dismiss handler also reconstructs the manager (assign a fresh `ConnectionManager` to the `connection` binding and call `connect()`). The next submit then mints a fresh `currentThreadId` (the existing `if (currentThreadId === undefined)` mint at `:233-235` fires) over the fresh socket → a new thread that draws on the distilled slice (MF-02 cross-thread continuity).
*Why:* This is the voluntary side of the asymmetry: dismiss = close + reset. A fresh `currentThreadId` on the next submit is what makes re-summon a NEW conversation (spec §3.3, demo step 4). The manager must be re-created because `dismiss()` deliberately set `active=false`; reusing it would never reconnect. Re-creating is cheap (a constructor + one `factory(WS_URL)`), DOM-free, and matches "the overlay opens one socket when it activates" — a re-summon is a fresh activation of the conversation.
*Implementation note:* change the `connection` binding from `const` to `let` so the dismiss handler can reassign it. The `inFlight` guard (`:182`) prevents dismiss racing a live turn at the UI level (dismiss only happens when a text card is shown, i.e. the turn already resolved). The handler stays defensive (each manager call wrapped to not throw out of the listener).
*Alternatives rejected:* (a) Keep one manager and add a `reconnect()`/re-arm method that flips `active` back true — rejected: more surface than re-constructing, and muddies the "active for the conversation's life" model; a dismissed conversation's manager is done. (b) Lazily reconnect on next submit inside `runSession` when `this.ws===undefined` — rejected: the manager already fails such a turn (`no connection`, `connection-manager.ts:116-122`); auto-reconnect-on-submit is unspecced behavior change. Fresh-manager-on-dismiss is the explicit, testable choice.

**D5 — Real-I/O test strategy follows the CM-02 / MF-02 daemon-test precedent exactly: real `startDaemon(0)` + real on-disk SQLite temp dir + `LLM_PROVIDER=mock`, driving full picker turns over a real `WebSocket`, then asserting the on-disk DB.**
*Decision:* New file `packages/daemon/src/dismiss-on-close.daemon.test.ts` mirroring `memory-integration.daemon.test.ts` / `multi-turn-per-socket.daemon.test.ts`: `beforeAll` makes a `mkdtempSync` dir, sets `AGENTIC_DATA_DIR` + `LLM_PROVIDER=mock`, `startDaemon(0)`. A `turnOver(ws, text, threadId?)` helper drives `session_start → session_ack → tool_call{show_color_picker} → tool_result → session_end` over an already-open socket (mock always emits the picker). Dismiss is triggered by `ws.close()`. Assertions read the on-disk DB via a fresh `MemoryStore`/`Database`: `threads.status === 'dismissed'` and `readDistillationEvents(threadId).length === 1` with `facts_produced` matching. A short poll/await after `ws.close()` accommodates the async `hook.dismiss` (the close handler is `async` only for the dismiss loop; the test awaits a small delay then asserts, with a bounded retry).
*Why:* This is the highest-fidelity real-I/O proof — real daemon close handler, real distiller, real store, no mocks at the proven boundary (PIPELINE §6.1-valid runtime evidence). The mock provider's picker-only emission is sufficient: dismiss/distill is provider-agnostic, and the picker turn persists a real message so the empty-vs-nonempty distinction is testable. Using `ws.close()` exercises the actual production `close(ws)` handler — the genuine signal.
*Detail on the async-close race:* `Bun.serve`'s `close` handler runs after the socket closes; the test must not assert synchronously. Pattern: after `ws.close()`, `await` a helper that polls `readDistillationEvents` up to N times with a small sleep (e.g. 10×50ms) until the row appears, failing if it never does. This is deterministic in practice (mock distill is synchronous-fast) and avoids a fixed brittle sleep.
*Alternatives rejected:* injecting a mock hook into `startDaemon` — rejected: would touch daemon wiring and bypass the real boundary (the §6.1 scar: mocks at the proven boundary are insufficient). Driving via the overlay `ConnectionManager` — rejected for the daemon-side DoD: the daemon test should prove the daemon, independent of overlay code; overlay dismiss is covered separately (D2 seam tests).

**D6 — The provisional-trigger "test migration" is: keep the store-level dismiss coverage as-is (it never used the provisional WS path), delete the provisional block with no test edits, and ADD the close-trigger real-I/O tests.**
*Decision:* Per Reality check (b), no existing test asserts the provisional WS path. So "tests updated to close-trigger equivalents" is realized as: (1) the store-level `dismiss → status=dismissed → distillation_events` tests (`memory-integration.daemon.test.ts:142`, `distiller-integration.daemon.test.ts:276`) stay byte-unchanged and green — they ARE the preserved dismissal/distillation coverage; (2) the new `dismiss-on-close.daemon.test.ts` (D5) is the close-trigger equivalent that exercises the path the provisional block used to (and that was never WS-tested); (3) deleting `index.ts:85-102` requires no test assertion changes. The comment at `distiller-integration.daemon.test.ts:74-76` referencing the provisional trigger is updated to drop the now-false "PROVISIONAL trigger fires only on same-WS thread-switch" sentence (factual maintenance, not an assertion change).
*Why:* Honest mapping to what actually exists. The chunk's frozen wording assumes provisional-path tests exist; the evidence says they don't (they were always store-level). "Coverage preserved" is satisfied by keeping the store-level coverage AND adding the genuine close-trigger coverage that strengthens the suite.

**D7 — Carry-forward 1 (retire dead `runSession`): delete `session-client.ts:149-292`, migrate its still-relevant tests to the manager.** The free `runSession` is dead in production (D-Reality (f)). Delete the function. Its `session-client.test.ts` tests split into: (i) tests of `buildSessionStart`/`routeInbound` (pure exports that remain) — keep, adjusted to call the remaining exports directly; (ii) tests of socket-lifetime behavior (open→ack→tool_call→end, close-rejection, handshake-timeout, unknown-frame-drop, threadId-on-start) — these are **already covered by `connection-manager.test.ts`** (Reality check confirmed the manager has timeout, drop, mid-flight-close, 3-turns-one-socket, threadId-via-buildSessionStart tests). Migrate any unique assertion not already in the manager suite into `connection-manager.test.ts`; delete the rest from `session-client.test.ts`. The file must not ship two divergent socket-lifetime contracts.

**D8 — Carry-forward 2 (single-flight invariant comment):** add a one-line comment at `ConnectionManager.runSession` (`connection-manager.ts:82`) documenting that single-flight is enforced by `main.ts`'s `inFlight` guard, not by the manager (the dispatcher Map holds ≤1 entry by that external invariant). No behavior change.

---

## ADR worthy: no

Covered by **ADR-0014 decision 2** ("Dismiss = `close(ws)` … the daemon calls `ConsolidationHook.dismiss(threadId)` for the active thread on that connection … supersedes the provisional thread-switch trigger at `index.ts:84-102` … Built in **chunk 03**") and **ADR-0012 decision 5b** (consolidation as an explicit, observable event). The affordance→dismiss mapping (D1) and voluntary/involuntary asymmetry (D2/D4) are build-time decisions delegated by spec §3.2/§3.3 and ADR-0012's "deliberately left open" reply-affordance note. No wire change, no new dependency, no new boundary beyond what ADR-0014 records. ADR-0014 is `proposed` on `main`; it is the build authority regardless of accept-status (its own §Status note). No amendment needed.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/daemon/src/index.ts` | `SocketData` gains `touchedThreadIds`; `session_start` advance records the turn's thread into it; `close(ws)` gains a dismiss-all-active loop AFTER the S1 flush; the provisional block (`:85-102`) is deleted. | **Modify** |
| `packages/daemon/src/dismiss-on-close.daemon.test.ts` | Real-I/O: open socket → turn on T → close → `status(T)=dismissed` + `distillation_events` row (even empty); two threads on one connection → close → both dismissed; continuation hydration re-asserted post-retirement. | **Create** |
| `apps/overlay/src/ws/connection-manager.ts` | New public `dismiss()` (sets `active=false` then `ws.close()`, no reconnect); single-flight invariant comment on `runSession`. | **Modify** |
| `apps/overlay/src/ws/connection-manager.test.ts` | Seam tests: `dismiss()` closes socket + does NOT reconnect; involuntary `close` (active) DOES reconnect; migrated unique assertions from the retired `runSession` tests. | **Modify** |
| `apps/overlay/src/main.ts` | `connection` binding `const`→`let`; `EV_TEXT_DISMISS` handler calls `connection.dismiss()`, resets `currentThreadId`, re-creates+connects a fresh manager. | **Modify** |
| `apps/overlay/src/ws/session-client.ts` | Delete the dead free `runSession` (`:149-292`); KEEP `buildSessionStart`, `routeInbound`, `SessionContext`, `WS_URL`, `DEFAULT_HANDSHAKE_TIMEOUT_MS`, `RunSessionOptions`, `ToolCallContext`, `SessionResult`. | **Modify** |
| `apps/overlay/src/ws/session-client.test.ts` | Drop `runSession`-lifetime tests now covered by the manager; keep/adjust `buildSessionStart`/`routeInbound` tests. | **Modify** |
| `packages/daemon/src/memory/distiller-integration.daemon.test.ts` | Update the stale provisional-trigger comment at `:74-76` (factual maintenance, no assertion change). | **Modify (comment only)** |

**Frozen — DO NOT touch:** `packages/protocol/**`, `packages/daemon/src/mock-agent.ts`, `packages/daemon/src/providers/mock-provider.ts`. No new consolidation trigger (idle/thread-switch). Do not touch gotcha #33/#34 hide-timer logic.

---

## Task 1: Daemon — track touched threads + dismiss-all-active on close; retire the provisional block

**Files:**
- Modify: `packages/daemon/src/index.ts` (`SocketData` type ~19-23; `session_start` advance ~84-106; `close(ws)` ~149-168; delete provisional ~85-102)
- Create: `packages/daemon/src/dismiss-on-close.daemon.test.ts`
- Modify: `packages/daemon/src/memory/distiller-integration.daemon.test.ts` (comment at ~74-76)

### 1a — Failing real-I/O test: single thread dismissed + distillation_events row on close

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/src/dismiss-on-close.daemon.test.ts
import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

let dataDir: string;
let server: ReturnType<typeof import("./index.js").startDaemon>;
let PORT: number;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm03-dismiss-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("./index.js");
  server = startDaemon(0);
  PORT = server.port!;
});
afterAll(() => server.stop(true));

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

/**
 * Drive ONE full mock turn (session_start → ack → tool_call → tool_result → session_end)
 * over an ALREADY-OPEN socket. Resolves with the daemon-minted session_id when session_end
 * arrives. The mock provider emits show_color_picker (mock-agent.ts:106-109).
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

/** Poll the on-disk DB until a distillation_events row exists for threadId (close handler is async). */
async function waitForDistillationEvent(threadId: string, tries = 20, gapMs = 50): Promise<{ facts_produced: number; trigger: string }[]> {
  for (let i = 0; i < tries; i++) {
    const db = new Database(join(dataDir, "memory.sqlite"));
    const rows = db.query("SELECT facts_produced, trigger FROM distillation_events WHERE thread_id = ? ORDER BY created_at ASC").all(threadId) as { facts_produced: number; trigger: string }[];
    db.close();
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return [];
}

function statusOf(threadId: string): string | undefined {
  const db = new Database(join(dataDir, "memory.sqlite"));
  const row = db.query("SELECT status FROM threads WHERE thread_id = ?").get(threadId) as { status: string } | null;
  db.close();
  return row?.status;
}

test("DoD — open socket → run a turn on thread T → close → status(T)=dismissed AND a distillation_events row exists", async () => {
  const threadId = crypto.randomUUID(); // client-minted (adoption posture)
  const ws = await openSocket();
  await turnOver(ws, "deploy is yeet.sh", threadId);
  ws.close(); // THE dismiss signal — fires the real close(ws) handler

  const events = await waitForDistillationEvent(threadId);
  expect(events.length).toBe(1);
  expect(events[0]!.trigger).toBe("dismiss");
  expect(statusOf(threadId)).toBe("dismissed");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/daemon/src/dismiss-on-close.daemon.test.ts`
Expected: FAIL — `status(T)` stays `active` and no `distillation_events` row appears, because the current `close(ws)` handler only flushes + cleans up; it never calls `hook.dismiss`. (`events.length` is 0; `statusOf` is `"active"`.)

- [ ] **Step 3: Implement — extend `SocketData` and record touched threads**

In `packages/daemon/src/index.ts`, change the `SocketData` type (currently `:19-23`) to add `touchedThreadIds`:

```ts
type SocketData = {
  sessionIds: Set<string>;
  activeThreadId?: string;
  dismissedThreadIds?: Set<string>;
  // CM-03: every durable thread this connection touched (one per session_start).
  // close(ws) dismisses each not-yet-dismissed one. A single value (activeThreadId)
  // is insufficient — a same-socket thread switch must dismiss BOTH on close (spec §3.2).
  touchedThreadIds?: Set<string>;
};
```

In the `session_start` branch, after `ws.data.activeThreadId = turnThreadId;` (currently `:105`), record the touched thread:

```ts
          ws.data.activeThreadId = turnThreadId;
          // CM-03: remember this thread so close(ws) can dismiss every active thread
          // on the connection (not just the last one).
          if (turnThreadId) (ws.data.touchedThreadIds ??= new Set<string>()).add(turnThreadId);
```

- [ ] **Step 4: Implement — delete the provisional block, add dismiss-all-active to `close(ws)`**

Delete the provisional thread-switch dismiss block (currently `:85-102`, the comment-marked `try/catch/finally` calling `hook.dismiss(prevThreadId)`). The `session_start` branch keeps only: record nothing about `prevThreadId`, go straight to `const begin = await lifecycle.beginTurn(inbound);`. After deletion the branch reads:

```ts
        if (inbound.type === "session_start") {
          const begin = await lifecycle.beginTurn(inbound);
          turnThreadId = begin.threadId;
          ws.data.activeThreadId = turnThreadId;
          if (turnThreadId) (ws.data.touchedThreadIds ??= new Set<string>()).add(turnThreadId);
          hydratedCount = begin.priorMessages.length;
          priorState = begin.priorMessages.length
            ? { phase: "done", session_id: "", messages: begin.priorMessages }
            : undefined;
        } else {
```

Replace the `close(ws)` handler (currently `:149-168`) with the flush-FIRST-then-dismiss version (the existing flush loop is byte-unchanged; the dismiss loop is appended). The handler signature stays `async` is NOT required for the flush, but the dismiss loop awaits — make `close` `async`:

```ts
      async close(ws) {
        // ── S1 partial-turn flush (UNCHANGED): persist any in-flight turn's delta
        //    before dropping RAM, so the distiller (below) sees the final turn.
        for (const sid of ws.data.sessionIds) {
          const session = sessions.get(sid);
          const threadId = lifecycle.threadForSession(sid);
          if (session && threadId && session.messages.length > 0) {
            try {
              lifecycle.endTurn(threadId, sid, session.messages);
            } catch (err) {
              console.error("[daemon] partial-turn flush error on disconnect (sid:", sid, "):", err);
            }
          }
          sessions.delete(sid);
          lifecycle.forgetSession(sid);
        }

        // ── CM-03: dismiss = close(ws). After the flush, consolidate EVERY active
        //    (not-yet-dismissed) thread on this connection (spec §3.2; ADR-0014 d.2).
        //    dismiss ⇒ persist + distill (ADR-0012): the thread is NOT deleted.
        //    B1 discipline: each dismiss is non-fatal — log, never crash, never block
        //    cleanup. finally always records the id so a partial/failed dismiss never
        //    retry-loops (same discipline the retired provisional block used).
        for (const threadId of ws.data.touchedThreadIds ?? []) {
          if (ws.data.dismissedThreadIds?.has(threadId)) continue;
          try {
            await hook.dismiss(threadId);
          } catch (err) {
            console.error("[daemon] dismiss error on close (non-fatal, thread:", threadId, "):", err);
          } finally {
            (ws.data.dismissedThreadIds ??= new Set<string>()).add(threadId);
          }
        }
      },
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test packages/daemon/src/dismiss-on-close.daemon.test.ts`
Expected: PASS (1 test) — the row appears with `facts_produced` ≥ 0 (the picker turn persists a user message; DumbTail produces ≥1 fact, but the test only asserts the row exists with `trigger==="dismiss"` and status flipped).

- [ ] **Step 6: Update the stale provisional comment + run the existing dismiss-coverage suites green (regression)**

In `packages/daemon/src/memory/distiller-integration.daemon.test.ts`, change the comment block at `:74-76` from:

```ts
  // 3. Directly distill thread A via DumbTail (simulating the consolidation-hook dismiss path)
  //    PROVISIONAL trigger fires only on same-WS thread-switch; each runTurn uses a fresh WS.
  //    The store-level distill is the real-I/O proof that the archive is intact and distillable.
```
to:
```ts
  // 3. Directly distill thread A via DumbTail (simulating the consolidation-hook dismiss path).
  //    CM-03 retired the provisional thread-switch trigger; dismiss now fires on close(ws)
  //    (see dismiss-on-close.daemon.test.ts). This store-level distill is the real-I/O proof
  //    that the archive is intact and distillable.
```

Run: `bun test packages/daemon/src/memory/`
Expected: PASS — `memory-integration.daemon.test.ts` (incl. `"dismiss invokes the registered consolidation-hook…"`) and `distiller-integration.daemon.test.ts` (incl. the empty-thread 5b row test) stay green. These are the preserved dismissal/distillation coverage (D6).

- [ ] **Step 7: Commit**

```bash
git checkout -b chunk/cm-03-dismiss-on-close
git add packages/daemon/src/index.ts packages/daemon/src/dismiss-on-close.daemon.test.ts packages/daemon/src/memory/distiller-integration.daemon.test.ts
git commit -m "feat(connection-model): CM-03 dismiss = close(ws) → consolidate; retire provisional thread-switch trigger

Daemon close(ws) now flushes the partial turn FIRST, then dismisses every active
thread touched on the connection (touchedThreadIds Set). Provisional session_start
thread-switch dismiss block deleted (one caller change, spec 3.2 / ADR-0014 d.2).
B1 non-fatal discipline preserved. Real-I/O: open->turn->close => dismissed + event row.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### 1b — Failing real-I/O test: two threads on one connection → close → BOTH dismissed; continuation re-asserted

- [ ] **Step 1: Write the failing test** (append to `dismiss-on-close.daemon.test.ts`)

```ts
test("DoD — two conversations on ONE connection (thread switch via new client-minted id) → close → BOTH dismissed", async () => {
  const threadA = crypto.randomUUID();
  const threadB = crypto.randomUUID();
  const ws = await openSocket();
  await turnOver(ws, "first conversation", threadA);
  await turnOver(ws, "second conversation", threadB); // thread switch on the SAME socket
  ws.close();

  const eventsA = await waitForDistillationEvent(threadA);
  const eventsB = await waitForDistillationEvent(threadB);
  expect(eventsA.length).toBe(1);
  expect(eventsB.length).toBe(1);
  expect(statusOf(threadA)).toBe("dismissed");
  expect(statusOf(threadB)).toBe("dismissed");
});

test("DoD — continuation still works through the persistent socket: session_start{thread_id} hydrates the tail (re-asserted post-retirement)", async () => {
  const threadId = crypto.randomUUID();
  const ws = await openSocket();
  await turnOver(ws, "deploy is yeet.sh", threadId);
  await turnOver(ws, "what is the deploy?", threadId); // continuation on the SAME thread, SAME socket
  ws.close();

  // Both turns coalesced into ONE thread, in order — hydration survived the provisional removal.
  const db = new Database(join(dataDir, "memory.sqlite"));
  const rows = db.query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index").all(threadId) as { content: string }[];
  db.close();
  expect(rows.map((r) => r.content)).toEqual(["deploy is yeet.sh", "what is the deploy?"]);
});
```

- [ ] **Step 2: Run to verify it passes (Task 1a implementation already covers it)**

Run: `bun test packages/daemon/src/dismiss-on-close.daemon.test.ts`
Expected: PASS (3 tests total). The two-threads test proves `touchedThreadIds` dismisses both (would FAIL if `activeThreadId`-only were used — only `threadB` would dismiss). The continuation test proves the provisional-block removal did not regress hydration (`beginTurn`/`endTurn` are untouched).

- [ ] **Step 3: Commit**

```bash
git add packages/daemon/src/dismiss-on-close.daemon.test.ts
git commit -m "test(connection-model): CM-03 two-threads-one-connection both dismissed + continuation hydration re-asserted

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Overlay ConnectionManager — voluntary `dismiss()` (close, no reconnect) + single-flight comment

**Files:**
- Modify: `apps/overlay/src/ws/connection-manager.ts`
- Modify: `apps/overlay/src/ws/connection-manager.test.ts`

### 2a — Failing seam test: `dismiss()` closes the socket and does NOT reconnect; involuntary close DOES

- [ ] **Step 1: Write the failing test** (append to `connection-manager.test.ts`; reuse the existing `makeFake`/`oneTurn` helpers already in that file)

```ts
test("ConnectionManager.dismiss(): closes the socket and does NOT reconnect (voluntary)", () => {
  const fake1 = makeFake();
  const fake2 = makeFake();
  const fakes = [fake1, fake2];
  let i = 0;
  const factory = jest.fn(() => fakes[i++]!.ws);
  let scheduled: (() => void) | undefined;
  const mgr = new ConnectionManager(factory, {
    setTimeoutFn: (cb) => { scheduled = cb; return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeoutFn: () => {},
    random: () => 0,
  });
  mgr.connect();
  expect(factory).toHaveBeenCalledTimes(1);

  fake1.fire("open");
  mgr.dismiss();                 // VOLUNTARY close
  expect(fake1.closed).toBe(true);
  // No reconnect was scheduled (active=false before the close event fired).
  expect(scheduled).toBeUndefined();
  // Even if a stray timer were invoked, it must not reopen.
  scheduled?.();
  expect(factory).toHaveBeenCalledTimes(1);
});

test("ConnectionManager: an INVOLUNTARY drop still reconnects (asymmetry holds)", () => {
  const fake1 = makeFake();
  const fake2 = makeFake();
  const fakes = [fake1, fake2];
  let i = 0;
  const factory = jest.fn(() => fakes[i++]!.ws);
  let scheduled: (() => void) | undefined;
  const mgr = new ConnectionManager(factory, {
    setTimeoutFn: (cb) => { scheduled = cb; return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeoutFn: () => {},
    random: () => 0,
  });
  mgr.connect();
  fake1.fire("open");
  fake1.fire("close");           // INVOLUNTARY drop (active still true)
  expect(scheduled).toBeDefined();
  scheduled!();
  expect(factory).toHaveBeenCalledTimes(2); // reconnected
});

test("ConnectionManager.dismiss(): an in-flight turn settles cancelled-equivalent (no unhandled rejection)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws, {
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  mgr.connect();
  const p = mgr.runSession("hi", { handshakeTimeoutMs: 10_000 });
  fake.fire("open");
  mgr.dismiss(); // dismiss mid-flight — turn must settle, not hang or reject
  await expect(p).resolves.toEqual({ sessionId: "", reason: "cancelled" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: FAIL — `mgr.dismiss is not a function` (no such method yet).

- [ ] **Step 3: Implement `dismiss()` + the single-flight comment**

In `apps/overlay/src/ws/connection-manager.ts`, add the single-flight invariant comment on `runSession` (carry-forward 2) and a public `dismiss()` method. Add right above `runSession(text: string, ...)` (currently `:82`):

```ts
  /**
   * Voluntary dismiss (CM-03): close the socket and do NOT reconnect. Sets active=false
   * BEFORE ws.close() so the shared onSocketClose() handler — which reconnects only while
   * active — settles any in-flight turn locally (cancelled-equivalent) and stays down.
   * The caller (main.ts) owns currentThreadId reset and any fresh-manager re-creation;
   * this method only severs the connection. Contrast: an involuntary drop fires close while
   * active is still true → reconnect (the load-bearing asymmetry, spec §3.1/§3.2).
   */
  dismiss(): void {
    this.active = false;
    this.ws?.close();
  }

  /**
   * Single-flight INVARIANT (cross-file): callers must not start a new turn while one is
   * in flight. main.ts enforces this via its `inFlight` guard (main.ts:182/206/224); the
   * dispatcher Map therefore holds at most ONE SessionContext (gotcha #45 unchanged).
   */
  runSession(text: string, options: RunSessionOptions = {}): Promise<SessionResult> {
```

(No change to `onSocketClose` — it already guards reconnect with `if (this.active)`.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`
Expected: PASS — all prior manager tests plus the 3 new dismiss/asymmetry tests.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/ws/connection-manager.ts apps/overlay/src/ws/connection-manager.test.ts
git commit -m "feat(connection-model): CM-03 ConnectionManager.dismiss() — voluntary close, no reconnect (asymmetry)

dismiss() sets active=false before ws.close() so onSocketClose skips reconnect for a
voluntary dismiss while an involuntary drop (active still true) still reconnects. Adds
the single-flight cross-file invariant comment (carry-forward 2: inFlight in main.ts).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Overlay main.ts — dismiss closes socket + resets thread + re-creates the manager

**Files:**
- Modify: `apps/overlay/src/main.ts` (`connection` binding `:39`; `EV_TEXT_DISMISS` handler `:172-177`)

There is no DOM-free unit harness for `main.ts` (it imports `@tauri-apps/api/*`). Coverage for this wiring is the typecheck + the manager seam tests in Task 2 (which prove `dismiss()` behavior the handler calls) + the daemon real-I/O dismiss tests in Task 1 (which prove the close→dismiss path the socket close triggers). The change is mechanical and small.

- [ ] **Step 1: Make the `connection` binding reassignable**

Change `main.ts:39` from `const connection = ...` to `let`, keeping the factory + connect:

```ts
// CM-02: one persistent connection for the overlay's lifetime. Opened on activation.
// CM-03: a voluntary dismiss (EV_TEXT_DISMISS) closes this socket and re-creates a fresh
// manager for the next conversation — hence `let`, reassigned in the dismiss handler.
let connection = new ConnectionManager(factory);
connection.connect();
```

- [ ] **Step 2: Wire the dismiss handler** — replace the `EV_TEXT_DISMISS` listener (`:172-177`)

```ts
// Text card dismiss — fired by widget.ts on × click or Escape (when mode=text).
// CM-03: this is the user-visible "dismiss the conversation" affordance. It hides the
// widget AND deliberately closes the persistent socket (=> daemon close(ws) consolidates
// the thread) AND resets currentThreadId so the NEXT summon is a NEW conversation drawing
// on the distilled slice (spec §3.2/§3.3). Voluntary: dismiss() does NOT reconnect.
// A fresh manager is created+connected so the next submit has a live socket.
void listen(EV_TEXT_DISMISS, () => {
  if (lastRenderKind !== "text") return;
  hideWidgetWindow().catch(() => {/* ignore */});
  lastRenderKind = undefined;
  input.value = "";
  // CM-03 dismiss = close + reset (the voluntary side of the drop/dismiss asymmetry).
  try { connection.dismiss(); } catch { /* never throw out of the listener */ }
  currentThreadId = undefined;
  // Re-arm for the next conversation: dismiss() left the manager inactive (no reconnect),
  // so construct a fresh one and open its socket on activation-equivalent.
  connection = new ConnectionManager(factory);
  connection.connect();
});
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS — 0 errors. (`connection` is now `let`; all existing `connection.runSession(...)` and the new `connection.dismiss()` typecheck against `ConnectionManager`.)

- [ ] **Step 4: Lint strict**

Run: `bun run lint:strict`
Expected: PASS — 0 warnings. (No unused imports introduced; `ConnectionManager` already imported at `:18`.)

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/main.ts
git commit -m "feat(connection-model): CM-03 overlay dismiss closes socket + resets currentThreadId + re-arms manager

EV_TEXT_DISMISS now calls connection.dismiss() (voluntary close, no reconnect) and resets
currentThreadId so re-summon is a NEW conversation drawing on the distilled slice. A fresh
manager is constructed+connected for the next turn. Escape/blur stay hidePanel-only (hide,
not dismiss). #33/#34 hide-timer logic untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Carry-forward 1 — retire the dead standalone `runSession`; migrate its tests

**Files:**
- Modify: `apps/overlay/src/ws/session-client.ts` (delete `:149-292`)
- Modify: `apps/overlay/src/ws/session-client.test.ts` (drop `runSession`-lifetime tests; keep export tests)

### 4a — Migrate any unique `runSession` assertion into the manager suite, then delete

- [ ] **Step 1: Audit the `runSession` tests against the manager suite (no code yet — this is a read/diff step)**

Read `apps/overlay/src/ws/session-client.test.ts` and classify each `runSession(...)` test (call sites `:45,:93,:143,:190,:215,:241,:250,:275,:326,:389,:415,:471,:480,:507`):
- **Already covered by `connection-manager.test.ts`** (delete from session-client.test): happy-path tool_call→sendResult→session_end (manager `oneTurn` test), unknown/invalid frame never throws (manager 2b), wrong-cid ack ignored (manager 2b "unknown client_session_id"), handshake-timeout + `HandshakeTimeoutError` (manager 2c), timer-disarm-on-tool_call (manager 2c), unknown-tool no-op (manager 2b drop), threadId-on-session_start (covered by `buildSessionStart` test + manager runs).
- **About the to-be-deleted free function's own socket-lifetime** (close-rejection "WebSocket closed before session_end received" `:289`, error-event "WebSocket transport error", finish()-closes-socket-no-leak): the **connection-level** equivalents already exist in the manager (`onSocketClose` → mid-flight cancel, Task 2d in CM-02; `dismiss()` close, Task 2a here). The per-turn-socket-rejection semantics are intentionally gone (that was the divergent contract). Delete these.
- **Tests of remaining exports** (`buildSessionStart` validity `:27-35`; any `routeInbound` direct test): KEEP, unchanged.

If any assertion in the `runSession` tests is NOT yet represented in `connection-manager.test.ts` (e.g., a specific reason value passthrough), add an equivalent `mgr.runSession(...)` test to `connection-manager.test.ts` first (TDD: write it, run, watch it pass against the existing manager — the behavior already exists), commit it, THEN delete the `runSession` version. Per the CM-02 plan self-review, the manager suite already mirrors all lifetime behaviors; expect zero net-new assertions, but verify rather than assume.

- [ ] **Step 2: Write/confirm the migration test (if any gap found)** 

Only if Step 1 found an uncovered assertion. Example shape (adapt to the actual gap):

```ts
// connection-manager.test.ts — only if a unique assertion was uncovered in Step 1
test("ConnectionManager: session_end reason passes through verbatim (migrated from runSession)", async () => {
  const fake = makeFake();
  const mgr = new ConnectionManager(() => fake.ws);
  mgr.connect();
  const p = mgr.runSession("hi", { onToolCall: () => {} });
  fake.fire("open");
  const cid = (JSON.parse(fake.sent.at(-1)!) as { client_session_id: string }).client_session_id;
  fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: cid }) });
  fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s", reason: "cancelled" }) });
  await expect(p).resolves.toEqual({ sessionId: "s", reason: "cancelled" });
});
```

Run: `bun test apps/overlay/src/ws/connection-manager.test.ts` → Expected: PASS (behavior already exists in the manager).

- [ ] **Step 3: Delete the free `runSession` and update the test file**

In `apps/overlay/src/ws/session-client.ts`, delete the entire `export function runSession(...) { ... }` block (`:149-292`). Keep everything else: the file-top doc comment (adjust its `02b-ii onToolCall flow` paragraph to note `runSession` moved into `ConnectionManager`), `WS_URL`, `DEFAULT_HANDSHAKE_TIMEOUT_MS`, `SessionStart` type, `SessionResult`, `ToolCallContext`, `RunSessionOptions`, `buildSessionStart`, `SessionContext`, `routeInbound`, `tryParse`.

In `apps/overlay/src/ws/session-client.test.ts`:
- Remove `runSession` from the import (`:3` → `import { buildSessionStart } from "./session-client.js";`, plus `routeInbound` if a kept test uses it).
- Delete every `runSession(...)`-based test identified as "already covered" / "divergent contract" in Step 1.
- Keep `buildSessionStart` (and any `routeInbound`) tests.

- [ ] **Step 4: Run to verify the overlay ws suite is green and contains ONE socket-lifetime contract**

Run: `bun test apps/overlay/src/ws/`
Expected: PASS — `session-client.test.ts` (now only export-level tests), `connection-manager.test.ts` (the single socket-lifetime contract), `connection-manager.realio.test.ts`, `backoff.test.ts`, `tool-call-handler.test.ts`. No `runSession`-free-function reference remains.

- [ ] **Step 5: Typecheck + lint (catch any dangling import/reference)**

Run: `bun run typecheck && bun run lint:strict`
Expected: PASS — 0 errors, 0 warnings. (If `tryParse` becomes unused after deleting `runSession`, remove it; if `routeInbound`/`buildSessionStart` lose an importer in the test, the lint will not flag library exports — they are imported by `connection-manager.ts`.)

- [ ] **Step 6: Commit**

```bash
git add apps/overlay/src/ws/session-client.ts apps/overlay/src/ws/session-client.test.ts apps/overlay/src/ws/connection-manager.test.ts
git commit -m "refactor(connection-model): CM-03 carry-forward 1 — retire dead standalone runSession; migrate tests to ConnectionManager

The free runSession opened its own per-turn socket (a divergent socket-lifetime contract
called only by tests after CM-02). Deleted; its lifetime tests are covered by the manager
suite. buildSessionStart/routeInbound exports + their tests retained.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification suite + frozen-surface audit + PR

**Files:** none modified — verification only.

- [ ] **Step 1: Prove frozen surfaces are byte-unchanged**

Run:
```bash
git diff --name-only origin/main -- packages/protocol packages/daemon/src/mock-agent.ts packages/daemon/src/providers/mock-provider.ts
```
Expected: **empty output**. If any line prints, STOP — a frozen surface was touched; revert it.

- [ ] **Step 2: Full test suite**

Run: `bun test`
Expected: PASS — all suites green, including the new `dismiss-on-close.daemon.test.ts`, the daemon dismiss-coverage regressions (`memory-integration.daemon.test.ts`, `distiller-integration.daemon.test.ts`), the CM-02 manager/realio suites, and `multi-turn-per-socket.daemon.test.ts`. Note the count delta (expect new tests added in Tasks 1, 2, 4; some `session-client.test.ts` tests removed in Task 4 — net change should be a small increase). Record the pass/fail numbers as command evidence.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS — 0 errors.

- [ ] **Step 4: Lint strict**

Run: `bun run lint:strict`
Expected: PASS — 0 warnings.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin chunk/cm-03-dismiss-on-close
gh pr create --base main --title "CM-03: dismiss = close(ws) → consolidate; retire provisional trigger" --body "$(cat <<'EOF'
## What
On the persistent CM-02 connection, wires the genuine dismiss signal:
- Daemon close(ws) flushes the partial turn FIRST, then calls ConsolidationHook.dismiss
  for EVERY active thread on the connection (touchedThreadIds Set). B1 non-fatal.
- Retires the provisional session_start thread-switch dismiss block (index.ts:85-102) —
  one caller change, spec §3.2 / ADR-0014 decision 2. dismiss ⇒ persist + distill (ADR-0012).
- ConnectionManager.dismiss(): voluntary close, no reconnect (active=false before ws.close()).
  Involuntary drop still reconnects — the load-bearing asymmetry.
- main.ts EV_TEXT_DISMISS closes the socket + resets currentThreadId + re-arms a fresh manager
  → re-summon is a NEW conversation drawing on the distilled slice.
- Carry-forward 1: retired the dead standalone runSession (tests-only divergent socket-lifetime
  contract); migrated coverage to the ConnectionManager suite.
- Carry-forward 2: documented the inFlight single-flight cross-file invariant on the manager.

No wire change (frozen 6-variant union untouched).

## How verified (mechanical / real-I/O — this chunk's merge gate per Lior's 2026-06-10 DoD ruling)
- real-I/O: open socket → turn on T → close → threads.status(T)=dismissed AND a distillation_events row exists
- real-I/O: two conversations on ONE connection → close → BOTH threads dismissed
- real-I/O: continuation through the persistent socket — session_start{thread_id} hydrates the tail (re-asserted post-retirement)
- provisional block gone; store-level dismiss/distillation coverage preserved + new close-trigger coverage added
- seam: ConnectionManager.dismiss() closes + does NOT reconnect; involuntary drop DOES reconnect; in-flight turn settles cancelled
- frozen surfaces byte-unchanged (packages/protocol/**, mock-agent.ts, mock-provider.ts)
- typecheck + lint:strict + bun test green

## NOT in this PR (gates chunk-done/archive, NOT this merge)
The JOINT 6-step live demo (memory-foundation spec §4.1, steps 2–4) is Lior-gated and shared
with MF-05; it gates the chunk's done/archive, not this PR's merge. Demo prerequisites
(PR #30 rebase + re-verify) are Jimmy-routed, not part of this chunk.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Leave the chunk file `in-progress`**

Do NOT mark `orchestration/chunks-todo/connection-model/03-dismiss-on-close-joint-demo.md` done or archive it on merge. Per the chunk's Notes (Lior 2026-06-10 ruling): the PR auto-merges on the all-green automated set; the chunk stays `in-progress` until the joint demo passes, after which Jimmy marks done + archives (PIPELINE §4.4). Record this in the conveyor ledger as merged-but-demo-pending.

---

## Self-review

**Spec coverage:**
- §3.2 dismiss = close(ws) → `ConsolidationHook.dismiss` for any active thread → Task 1 (close handler + `touchedThreadIds`), real-I/O Task 1a/1b. ✓
- §3.2 "one caller change in index.ts" — provisional block retired → Task 1 Step 4. ✓
- §3.2 "No wire change required" → Task 5 frozen-surface audit (empty diff). ✓
- §3.3 overlay tracks `currentThreadId`, reset on dismiss/new conversation → Task 3 (`currentThreadId = undefined` + fresh manager). ✓
- §3.1 voluntary dismiss vs involuntary drop asymmetry → Task 2 (`dismiss()` no-reconnect; involuntary reconnect test). ✓
- ADR-0012 5b observable event (row even when empty) → Task 1a asserts the row; regression keeps the empty-thread 5b test. ✓
- ADR-0014 decision 2 (close→dismiss, supersedes provisional, chunk 03) → Tasks 1–3. ✓
- flush-FIRST then dismiss (distiller sees final turn) → Task 1 Step 4 (flush loop precedes dismiss loop). ✓
- B1 non-fatal dismiss (log, never crash, never block cleanup) → Task 1 Step 4 try/catch/finally. ✓
- Carry-forward 1 (retire dead `runSession`) → Task 4. ✓
- Carry-forward 2 (single-flight invariant comment) → Task 2 Step 3. ✓
- Daemon-crash asymmetry accepted (no close→no dismiss) → no catch-up pass built (out of scope, untouched). ✓
- #33/#34 hide-timers not entangled → dismiss wired on `EV_TEXT_DISMISS` only; Escape/blur unchanged. ✓
- Behavioral 6-step demo is NOT a plan task → noted in Task 5 Step 6, not scripted as steps. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases." Every code step shows full code; every command has expected output. The one conditional step (Task 4 Step 2 "only if a gap found") gives the discriminator and a concrete example shape rather than a placeholder.

**Type consistency:** `SocketData.touchedThreadIds` (`Set<string>`), `hook.dismiss(threadId)`, `ConsolidationHook.dismiss`, `ConnectionManager.dismiss()`/`connect()`/`runSession(text, options)`, `currentThreadId: string | undefined`, `readDistillationEvents` row `{ facts_produced, trigger }`, `WebSocketLike.close()` are used consistently with the verified source. `connection` binding changed `const`→`let` consistently (Task 3 Step 1 + reassignment Step 2).

**One honesty caveat (Reality check b/D6):** the chunk's "update provisional-trigger tests" assumes WS-path provisional tests exist; they do not (they were always store-level direct `hook.dismiss`). The plan preserves the real coverage and ADDS the genuine close-trigger real-I/O coverage rather than editing nonexistent assertions. The executing worker should confirm this against the suite (Task 1 Step 6) and not hunt for a provisional-WS test to rewrite.

---

## Relevant file paths (absolute)

- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/index.ts` (modify — `SocketData` + `session_start` touched-thread record + `close(ws)` dismiss loop; delete provisional `:85-102`)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/dismiss-on-close.daemon.test.ts` (create — the three real-I/O DoD tests)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/distiller-integration.daemon.test.ts` (modify — stale provisional comment only)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/connection-manager.ts` (modify — `dismiss()` + single-flight comment)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/connection-manager.test.ts` (modify — dismiss/asymmetry seam tests + migrated assertions)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/main.ts` (modify — `connection` `let`, `EV_TEXT_DISMISS` handler)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/session-client.ts` (modify — delete free `runSession`; keep all other exports)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/apps/overlay/src/ws/session-client.test.ts` (modify — drop `runSession`-lifetime tests, keep export tests)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/orchestration/docs/adr/0014-connection-model-persistent-ws-dismiss-thread-adoption.md` (the decision umbrella — ADR worthy = no)
- `/Users/lior/WebstormProjects/playground/AgenticEngine/orchestration/docs/specs/2026-06-05-connection-model.md` (§3.2/§3.3 build authority)

**Key source the worker must not break:** daemon `close(ws)` S1 flush (must stay FIRST, byte-unchanged before the dismiss loop), `lifecycle.beginTurn/endTurn/threadForSession/forgetSession` (untouched — hydration regression test guards this), `ConnectionManager.onSocketClose` reconnect gate (`if (this.active)` — `dismiss()` leans on it), `main.ts` `inFlight` guard + `currentThreadId` mint (`:233-235`), gotcha #33/#34 hide-timer logic.
