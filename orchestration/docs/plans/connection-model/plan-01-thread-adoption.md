# Connection Model Chunk 01 — Thread Continuation & Daemon Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All paths absolute. cwd resets between bash calls — always use absolute paths.
>
> **Branch:** all work happens on the already-created `chunk/cm-01-thread-adoption` branch (the orchestrator created it; do NOT create another).
>
> **Chunk (frozen yardstick):** `orchestration/chunks-todo/connection-model/01-thread-continuation-adoption.md`

**Goal:** Make within-thread multi-turn work through the real overlay — the overlay mints a `thread_id` on the first submit of a conversation and passes it on every subsequent `session_start`; the daemon adopts an unknown-but-UUID-shaped `session_start.thread_id` as the new thread's id, through the single existing `store.createThread` write path. Works on today's per-turn sockets; no WS-lifetime change.

**Architecture:** Two seams, no wire change. (1) Daemon: `ThreadLifecycle.beginTurn` gains an adoption branch for an unknown-but-UUID-shaped `thread_id`, passing the id into an optional `createThread(title?, adoptId?)` param so the single store write path is preserved. Non-UUID garbage falls through to the existing mint path (no crash). (2) Overlay: `main.ts` holds a `currentThreadId`, minted on first submit and passed via an additive `threadId` option through `runSession`/`buildSessionStart`. The option API is designed so chunk 02's persistent-socket refactor never has to touch it.

**Tech Stack:** TypeScript on Bun; `bun:sqlite`; Zod-frozen `@agentic/protocol`; `bun test` with real on-disk SQLite (`*.daemon.test.ts`) and DOM-free injected-factory seam tests.

## Status: in-progress (Phase 2 — implementation)

---

## Reality check

Every claim the chunk file makes was verified against source. Findings (file evidence cited; behavioral facts marked per PIPELINE §6.1):

| Chunk claim | Source verified | Verdict |
|---|---|---|
| `thread-lifecycle.ts:45-59` `beginTurn` "always mints via `store.createThread`" | `packages/daemon/src/memory/thread-lifecycle.ts:43-58` | **Mostly true, one nuance.** `beginTurn` mints via `store.createThread()` (line 53) **only on the no/unknown-`thread_id` branch**; on a known+existing `thread_id` (lines 45-48) it hydrates and does NOT mint. The chunk's shorthand "always mints" is imprecise but the load-bearing substance (the mint happens through `createThread`, and the unknown-id branch is where adoption slots in) is correct. The adoption change lives on the unknown-id branch, before `createThread`. |
| `session-client.ts:98` client-minted `client_session_id` | `apps/overlay/src/ws/session-client.ts:98` — `const clientSessionId = crypto.randomUUID();` inside `buildSessionStart` | **True, exact.** Establishes the client-mint posture precedent the chunk invokes. |
| `envelope.ts:44-48` `session_ack` has no `thread_id` | `packages/protocol/src/envelope.ts:44-48` — `SessionAck` = `{type, session_id, client_session_id?}` only | **True, exact.** The daemon cannot tell the overlay which id it minted ⇒ the client-mint + daemon-adopt reading is the only one consistent with the spec's "wire UNCHANGED" (§5) constraint. |
| `session_start.thread_id` is additive-optional + already shipped | `packages/protocol/src/envelope.ts:27-40` — `thread_id: z.string().optional()` present, MF-01 comment | **True.** No protocol change needed to carry `thread_id`. |
| `store.ts:72` `createThread` mints its own uuid, single write path | `packages/daemon/src/memory/store.ts:72-82` — `const id = crypto.randomUUID();` then the sole `INSERT INTO threads`. No adopt-id param today. | **True.** This is the single thread-write path; adoption extends it with an optional param, not a second path. |
| MF-02 cross-thread `retrieve()` injection fires on the new-thread branch | `packages/daemon/src/memory/thread-lifecycle.ts:53-57` — `createThread()` then `memoryProvider?.retrieve(this.store, newThreadId)` | **Code path exists** (requires the daemon test to confirm behavior). The injection runs on the same branch that will adopt, using the returned id — so it fires identically on an adopted id. The plan tests this (Task 2). |
| Adoption stays out of `index.ts` | `packages/daemon/src/index.ts:103` calls `lifecycle.beginTurn(inbound)` | **True.** The adoption change is entirely inside `beginTurn`; `index.ts` is untouched, minimizing the PR #30 rebase surface as the chunk notes. |
| PR #30 `isNewThread` proxy stays correct under adoption | `index.ts` has no such line on `main` today (it is in PR #30, OPEN, not on main) — confirmed by reading `index.ts` in full | **Cannot verify on main** (PR #30 not merged). This is a Jimmy-owned PR-#30-rebase re-verify per the chunk's Notes, NOT a task in this chunk. Flagged, not actioned. |
| A UUID-validation helper already exists to reuse | `packages/daemon/src/memory/store.ts:55-57` — exported `isMessageId(s)` is exactly a UUID regex | **True.** The plan introduces a clearly-named `isUuidShaped` export to avoid semantic confusion with "message id" (Task 1). |
| FK on `messages.thread_id` would reject an adopted id | `schema.ts:25` has `REFERENCES threads(thread_id)`, but FK enforcement is OFF by default (confirmed by `store.ts:218-224` comment) | **No FK risk.** Adoption inserts the id into `threads` first (via `createThread`), then later `messages` rows reference it. No crash. |
| Dismissed-thread edge: `session_start{thread_id}` of a `status=dismissed` thread hydrates and continues today | `beginTurn` keys ONLY on `store.threadExists(requested)` (`store.ts:84-87` — no status filter). Status is never read on the hydrate branch. | **Code path exists** confirming current behavior = hydrate-and-continue regardless of status. The plan asserts this deliberately in a test (Task 2), without growing status semantics. |

**Net:** No reality-check claim is materially wrong. The one imprecision ("always mints") does not affect the design. All DoD criteria here are mechanical (real-I/O tests + command evidence); per the chunk's 2026-06-10 Lior ruling there is no live-demo gate, so PIPELINE §6.1's "requires runtime demo" caveat is discharged by the real-I/O daemon tests below.

---

## Citation-test (PIPELINE §7.2) — clean, proceed

The client-mint + daemon-adopt mechanism was checked against every cited frozen artifact. **No frozen line is contradicted:**

- **Wire (`packages/protocol/**`):** UNCHANGED. `session_start.thread_id` is already present and additive (envelope.ts:39); the overlay only populates an existing field. No new variant, no `session_ack` field. Honors CM spec §5 and the conveyor freeze.
- **MF-01 spec §3.1 / §3.4:** "No/unknown `thread_id` ⇒ a NEW thread is minted." Adoption STILL mints a new thread; it only chooses the new thread's *id* to equal the client-supplied UUID. No frozen line fixes who mints the id value. `threads.thread_id` is "(uuid pk)" (§3.4) — a client-minted UUID satisfies the type.
- **ADR-0001 D3:** reserves **`session_id`** minting to the daemon. It says nothing about `thread_id`. `session_id` minting is untouched.
- **ADR-0012 decision 4:** thread = durable record reached only via threads. Adoption does not change that; it is plumbing for "the overlay tracks the current thread_id" (CM §3.3).
- **Single write path:** preserved — adoption extends `createThread` with an optional param; no second `INSERT INTO threads`.

The architect cannot cite a frozen line this contradicts, so per §7.2 the plan proceeds. (The decompose layer already ran this test clean; the architect re-check is also clean.)

---

## ADR worthy: yes — "ADR-0001 amendment — persistent-WS lifetime, dismiss=close(ws), and client-minted thread-id adoption"

Per CM spec §3.1 ADR note + §7 (and the chunk's ADR duty), this feature owes a **PROPOSED** ADR amending ADR-0001. It records the **full connection-model decision set** (the accepted CM spec is the source), not just this chunk's slice. Status `proposed`, **not merge-blocking** — the accepted CM spec is the build authority; Lior accepts asynchronously (§5.2).

## ADR: orchestration/docs/adr/0014-connection-model-persistent-ws-dismiss-thread-adoption.md (status: proposed — Lior accepts asynchronously)

Decision content for the curator:

> **Title:** ADR-0001 amendment — Connection model: persistent WS, dismiss=close(ws), client-minted thread-id adoption
> **Status:** proposed · **Amends (does not supersede):** ADR-0001 (sessions stay ephemeral; `session_id` minting stays daemon-only), ADR-0003 (transport unchanged: WS on `localhost:7777`).
> **Decisions (from `orchestration/docs/specs/2026-06-05-connection-model.md`):**
> 1. **WS lifetime → persistent per overlay session** (CM §3.1). Overlay opens ONE socket on activate, keeps it until hide/exit; many `session_start` flow over it; each still starts a new ephemeral session (ADR-0001 untouched). Reconnect with backoff; in-flight-at-disconnect treated as cancelled. *(Built in chunk 02.)*
> 2. **Dismiss = `close(ws)`** on the persistent connection (CM §3.2): `close(ws)` fires `ConsolidationHook.dismiss(threadId)` for the active thread — now meaningful because the socket is no longer per-turn. *(Built in chunk 03; supersedes the provisional thread-switch trigger at `index.ts:84-102`.)*
> 3. **Thread continuation + client-minted thread-id adoption** (CM §3.3, this chunk 01): the overlay mints `thread_id` (`crypto.randomUUID()`, same posture as `client_session_id`) and the daemon **adopts** an unknown-but-UUID-shaped `session_start.thread_id` as the new thread's id, through the single `store.createThread` write path. A new conversation = `session_start` with no `thread_id` (daemon mints, MF-01 §3.1). Wire UNCHANGED.
> 4. **Inbound push + multiplexing mechanism frozen** (CM §3.4/§3.5): overlay routes incoming envelopes by `session_id`; unsolicited `session_ack` → new session context; concurrency limit architect-time (start 3). *(Daemon scheduler not built here; CM-02.)*
> **Why ADR-worthy:** changes ADR-0001's implicit per-session-socket assumption (a behavioral boundary change) and records the `thread_id`-adoption authority (who mints the durable id) that no prior ADR covered.
> **Wire impact:** none — the 6-variant union is byte-unchanged across all four decisions.

---

## File Structure

- **Modify** `packages/daemon/src/memory/store.ts` — add exported `isUuidShaped(s)`; add optional `adoptId?` param to `createThread`.
- **Modify** `packages/daemon/src/memory/thread-lifecycle.ts` — adoption branch in `beginTurn` (single new-thread mint call gains the adopt-id; MF-02 retrieve unchanged).
- **Modify** `apps/overlay/src/ws/session-client.ts` — `buildSessionStart` + `runSession` accept an additive `threadId` option; populate `session_start.thread_id`.
- **Modify** `apps/overlay/src/main.ts` — `currentThreadId`: minted on first submit, passed on every `runSession`.
- **Test (create)** `packages/daemon/src/memory/thread-adoption.daemon.test.ts` — new real-I/O daemon test file for all adoption/validation/degenerate/MF-02/dismissed-edge cases.
- **Test (extend)** `apps/overlay/src/ws/session-client.test.ts` — DOM-free seam tests for the `threadId` option.

**Out of scope (frozen, do NOT touch):** any `packages/protocol/**` file, `mock-agent.ts`, `mock-provider.ts`; `index.ts` (no WS-lifetime change — chunk 02); the provisional dismiss block at `index.ts:84-102` and any `currentThreadId`-reset/dismiss logic (chunk 03); reply-affordance UI.

---

## Steps

Three sequential tasks. Each = one worker dispatch. TDD: test-first where the boundary is real-I/O-provable.

### Task 1 — Daemon: adopt a UUID-shaped unknown `thread_id` through the single store write path ✅ DONE (commit `c12edb5` — RED 3 fail → GREEN 6 pass; full memory suite 111 pass / 0 fail; frozen surfaces diff empty)

**Files:**
- Modify: `packages/daemon/src/memory/store.ts:55-82`
- Modify: `packages/daemon/src/memory/thread-lifecycle.ts:43-58`
- Test: `packages/daemon/src/memory/thread-adoption.daemon.test.ts` (new)

- [ ] **Step 1: Write the failing real-I/O daemon test (adoption + validation + degenerate paths).**

Create `packages/daemon/src/memory/thread-adoption.daemon.test.ts`. Mirror the live-daemon harness from `memory-integration.daemon.test.ts` (real `startDaemon(0)`, mock provider, real on-disk SQLite via a tmp `AGENTIC_DATA_DIR`). The `runTurn(text, threadId?)` helper is copied verbatim from that file (it already supports the optional `thread_id`).

```typescript
import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

let dataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm01-adopt-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("../index.js");
  server = startDaemon(0);
  PORT = server.port!;
});
afterAll(() => server.stop(true));

function openDb() {
  return new Database(join(dataDir, "memory.sqlite"));
}

/** Drive ONE full mock turn to `done`, with optional thread_id (copied from memory-integration.daemon.test.ts). */
function runTurn(text: string, threadId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({
        type: "session_start", trigger: "user", text, client_session_id: "c",
        ...(threadId ? { thread_id: threadId } : {}),
      })),
    );
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data as string);
      if (m.type === "tool_call" && m.payload.tool === "show_color_picker") {
        const pick = m.payload.args.picker.palette[0];
        ws.send(JSON.stringify({
          type: "tool_result", session_id: m.session_id, call_id: m.call_id,
          payload: { tool: "show_color_picker", result: { picked: pick } },
        }));
      }
      if (m.type === "session_end") { ws.close(); resolve(); }
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}

test("DoD#1 — session_start{thread_id: fresh client UUID} creates the thread row WITH exactly that id", async () => {
  const clientId = crypto.randomUUID();
  await runTurn("deploy is yeet.sh", clientId);
  const db = openDb();
  const row = db.query("SELECT thread_id FROM threads WHERE thread_id = ?").get(clientId) as { thread_id: string } | null;
  expect(row).not.toBeNull();
  expect(row!.thread_id).toBe(clientId);
  // The adopted thread holds turn-1's message.
  const msgs = db.query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index").all(clientId) as { content: string }[];
  expect(msgs.map((m) => m.content)).toContain("deploy is yeet.sh");
  db.close();
});

test("DoD#2 — second session_start with the SAME adopted id hydrates turn-1 (within-thread multi-turn over the real daemon)", async () => {
  const clientId = crypto.randomUUID();
  await runTurn("deploy is yeet.sh", clientId);
  await runTurn("what's the deploy?", clientId);
  const db = openDb();
  const contents = (db.query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index").all(clientId) as { content: string }[]).map((m) => m.content);
  // EXACTLY two rows in order — proves turn-2 flushed onto turn-1's hydrated tail (no double-persist).
  expect(contents).toEqual(["deploy is yeet.sh", "what's the deploy?"]);
  // Exactly ONE thread row for that id (adoption did not create a duplicate on turn 2).
  const count = (db.query("SELECT COUNT(*) AS n FROM threads WHERE thread_id = ?").get(clientId) as { n: number }).n;
  expect(count).toBe(1);
  db.close();
});

test("DoD#3a — no thread_id → daemon-minted thread (unchanged MF-01 degenerate path)", async () => {
  await runTurn("no-thread-id turn");
  const db = openDb();
  // A thread exists whose id we did NOT supply, and it carries the message.
  const row = db.query("SELECT thread_id FROM messages WHERE content = 'no-thread-id turn' LIMIT 1").get() as { thread_id: string } | null;
  expect(row).not.toBeNull();
  expect(typeof row!.thread_id).toBe("string");
  db.close();
});

test("DoD#3b — non-UUID garbage thread_id is NOT adopted → fresh daemon mint, no crash", async () => {
  const garbage = "not-a-uuid-😈-../../etc";
  await runTurn("garbage-id turn", garbage); // must not crash the daemon
  const db = openDb();
  // No thread row with the garbage id was created.
  const garbageRow = db.query("SELECT 1 FROM threads WHERE thread_id = ?").get(garbage);
  expect(garbageRow).toBeNull();
  // The message landed in a freshly-minted (UUID) thread instead.
  const msgRow = db.query("SELECT thread_id FROM messages WHERE content = 'garbage-id turn' LIMIT 1").get() as { thread_id: string } | null;
  expect(msgRow).not.toBeNull();
  expect(msgRow!.thread_id).not.toBe(garbage);
  db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && bun test packages/daemon/src/memory/thread-adoption.daemon.test.ts`
Expected: DoD#1 and DoD#2 FAIL (the adopted-id thread row does not exist / a daemon-minted id is used instead). DoD#3a/#3b may already pass (degenerate paths unchanged) — that is fine. The failures prove the adoption branch is not yet implemented.

- [ ] **Step 3: Add `isUuidShaped` and the optional `adoptId` param to the store.**

In `packages/daemon/src/memory/store.ts`:

First, add a clearly-named UUID-shape predicate next to `isMessageId` (reuse the same regex; do NOT delete `isMessageId` — it has other callers in `write-gate.ts`). After line 57:

```typescript
/**
 * Returns true if `s` is UUID-shaped — the validation gate for client-minted
 * thread-id adoption (CM-01, spec §3.3). A non-UUID-shaped thread_id is NOT
 * adopted (gotcha #9 discipline: no garbage durable keys). Same regex as
 * isMessageId; named distinctly so the thread-adoption intent is explicit and
 * not coupled to the messages.id seam invariant.
 */
export function isUuidShaped(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
```

Then change `createThread` (currently lines 72-82) to accept an optional `adoptId`, keeping the SINGLE `INSERT INTO threads` write path:

```typescript
/**
 * Mint a new durable thread. `adoptId` (CM-01, spec §3.3): when the overlay
 * supplied a client-minted, UUID-shaped, unknown thread_id, the caller passes
 * it here so the new thread is created WITH that id (the daemon "adopts" it).
 * Absent ⇒ the daemon mints a fresh UUID (MF-01 degenerate path, unchanged).
 * This is still the ONE thread-write path — no second INSERT.
 * The caller (ThreadLifecycle) is responsible for the UUID-shape + uniqueness
 * check (isUuidShaped + !threadExists) BEFORE adopting; this method trusts it.
 */
createThread(title?: string, adoptId?: string): string {
  const id = adoptId ?? crypto.randomUUID();
  const now = Date.now();
  this.db
    .query(
      "INSERT INTO threads (thread_id, created_at, last_active_at, status, title) VALUES (?, ?, ?, 'active', ?)",
    )
    .run(id, now, now, title ?? null);
  this.mirror(id, { event: "thread_created", thread_id: id, created_at: now });
  return id;
}
```

(Adapt to the file's actual current body if it differs — the invariant is: optional `adoptId` chooses the id, everything else byte-identical, single INSERT.)

- [ ] **Step 4: Add the adoption branch to `beginTurn`.**

In `packages/daemon/src/memory/thread-lifecycle.ts`, bring `isUuidShaped` into the imports (split type/value imports as `verbatimModuleSyntax`/`lint:strict` requires), and rewrite the new-thread branch so a UUID-shaped unknown id is adopted. The MF-02 `retrieve()` call is unchanged — it still runs on the same branch with the resolved `newThreadId` (now possibly the adopted id):

```typescript
async beginTurn(inbound: SessionStart): Promise<{ threadId: string; priorMessages: SessionMessage[] }> {
  const requested = inbound.thread_id;
  if (requested && this.store.threadExists(requested)) {
    const priorMessages = this.store.readThreadTail(requested, TAIL_LIMIT);
    return { threadId: requested, priorMessages };
  }
  // No / unknown thread_id ⇒ mint a NEW thread (MF-01 §3.1).
  // CM-01 adoption (spec §3.3): an unknown-but-UUID-shaped thread_id is adopted
  // as the new thread's id, so the overlay (which mints it client-side, since
  // session_ack carries no thread_id) and the daemon agree on the durable id
  // without any wire change. Non-UUID garbage is NOT adopted → fresh mint
  // (gotcha #9: no garbage durable keys). Single write path through createThread.
  const adoptId = requested && isUuidShaped(requested) ? requested : undefined;
  const newThreadId = this.store.createThread(undefined, adoptId);
  // Cross-thread distilled-slice injection (MF-02 injection-point) — fires on
  // the adopted id identically, because it keys off the returned newThreadId.
  const priorMessages = this.memoryProvider
    ? await this.memoryProvider.retrieve(this.store, newThreadId)
    : [];
  return { threadId: newThreadId, priorMessages };
}
```

(Adapt to the file's actual current body — the invariant is: hydrate branch untouched; adoption only on the new-thread branch; retrieve() keyed off the returned id.)

- [ ] **Step 5: Run the test to verify it passes.**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && bun test packages/daemon/src/memory/thread-adoption.daemon.test.ts`
Expected: all four tests (DoD#1, #2, #3a, #3b) PASS.

- [ ] **Step 6: Commit (on the existing `chunk/cm-01-thread-adoption` branch).**

```bash
cd /Users/lior/WebstormProjects/playground/AgenticEngine
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/thread-lifecycle.ts packages/daemon/src/memory/thread-adoption.daemon.test.ts
git commit -m "feat(connection-model): daemon adopts UUID-shaped client thread_id (CM-01)

Adopt an unknown-but-UUID-shaped session_start.thread_id as the new
thread's id, through the single store.createThread write path (optional
adoptId param). Non-UUID garbage falls through to a fresh daemon mint.
Real-I/O daemon tests cover adoption, multi-turn hydration, and both
degenerate paths.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2 — Daemon: prove MF-02 cross-thread injection fires on the adopted-id first turn, and assert the dismissed-thread edge ✅ DONE (absorbed into Task 1 commit `c12edb5` — the plan itself routes these tests into the same file; DoD#4 + EDGE green; zero production change, so no separate commit)

**Files:**
- Test: `packages/daemon/src/memory/thread-adoption.daemon.test.ts` (extend the file from Task 1)

These are assertion-only tasks (no production change) proving DoD#4 and the documented dismissed-status edge against the real store boundary. The MF-02 injection at thread-lifecycle level is best proven with the real `DumbTailProvider` + real store, matching the pattern in `thread-lifecycle.test.ts:88-98`.

- [ ] **Step 1: Write the MF-02 adopted-id injection test (DoD#4).**

Append to `thread-adoption.daemon.test.ts`. Add these imports at the top of the file:

```typescript
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { ThreadLifecycle } from "./thread-lifecycle.js";
import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
```

Then add:

```typescript
test("DoD#4 — adopted-id FIRST turn still runs the MF-02 cross-thread retrieve() injection", async () => {
  // Real store + real DumbTailProvider (matches thread-lifecycle.test.ts injection pattern).
  const dir = mkdtempSync(join(tmpdir(), "cm01-mf02-"));
  const store = new MemoryStore({ dataDir: dir });
  const provider = new DumbTailProvider();
  const lifecycle = new ThreadLifecycle(store, new WriteGate(store, new RuleBasedScanner()), provider);

  // Thread A: state a fact and distill it (simulating a prior dismiss).
  const tA = store.createThread();
  store.appendMessages(tA, [{ role: "user", content: "deploy is yeet.sh" }], "sa");
  const result = await provider.distill(store, tA);
  store.insertDistilledFacts(result.facts, "dumb-tail");

  // Thread B: a FIRST turn that ADOPTS a fresh client UUID (unknown to the store).
  const adoptId = crypto.randomUUID();
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi", thread_id: adoptId });

  // The adopted id is used verbatim AND the cross-thread slice was injected.
  expect(begin.threadId).toBe(adoptId);
  expect(store.threadExists(adoptId)).toBe(true);
  expect(begin.priorMessages).toContainEqual({ role: "user", content: "[remembered] deploy is yeet.sh" });
  store.close();
});
```

(Adapt constructor signatures / helper names to the real APIs in `thread-lifecycle.test.ts` — the invariant is: real store, real provider, adopted id used verbatim, injected slice present in `priorMessages`.)

- [ ] **Step 2: Write the dismissed-thread edge test (documented edge — assert current behavior deliberately, do NOT change status semantics).**

Append:

```typescript
test("EDGE — session_start{thread_id} of a status=dismissed thread hydrates and continues (current behavior, asserted deliberately; status semantics are chunk-03 territory)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cm01-dismissed-"));
  const store = new MemoryStore({ dataDir: dir });
  const lifecycle = new ThreadLifecycle(store, new WriteGate(store, new RuleBasedScanner()));

  // Create a thread, give it a message, then flip status to dismissed directly
  // (we are NOT testing the dismiss caller here — just the post-dismiss read).
  const tid = store.createThread();
  store.appendMessages(tid, [{ role: "user", content: "remembered turn" }], "s1");
  store.rawDb().query("UPDATE threads SET status = 'dismissed' WHERE thread_id = ?").run(tid);

  // A later session_start with that same id: beginTurn keys on threadExists (no
  // status filter), so it HYDRATES and CONTINUES — does NOT mint a fresh thread.
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "again", thread_id: tid });
  expect(begin.threadId).toBe(tid); // continued the dismissed thread, not minted anew
  expect(begin.priorMessages).toEqual([{ role: "user", content: "remembered turn" }]); // hydrated
  // Status is NOT flipped back by a read — deliberately unchanged (chunk-03 owns reset).
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(tid) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});
```

(Adapt to real APIs — if `rawDb()` does not exist, use whatever direct-DB access the existing tests use, e.g. opening the SQLite file directly. The invariant is: status=dismissed thread hydrates+continues, status not flipped back.)

- [ ] **Step 3: Run the full file to verify all pass.**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && bun test packages/daemon/src/memory/thread-adoption.daemon.test.ts`
Expected: all six tests PASS (4 from Task 1 + DoD#4 + EDGE).

- [ ] **Step 4: Commit.**

```bash
cd /Users/lior/WebstormProjects/playground/AgenticEngine
git add packages/daemon/src/memory/thread-adoption.daemon.test.ts
git commit -m "test(connection-model): MF-02 injection on adopted-id first turn + dismissed-thread edge (CM-01)

DoD#4: cross-thread retrieve() injection fires on an adopted-id first
turn. EDGE: session_start of a status=dismissed thread hydrates and
continues (current behavior asserted deliberately; status reset is
chunk-03 scope).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3 — Overlay: track `currentThreadId`, mint on first submit, pass on every turn

**Files:**
- Modify: `apps/overlay/src/ws/session-client.ts:68-106,129-136`
- Modify: `apps/overlay/src/main.ts:177,191-225`
- Test: `apps/overlay/src/ws/session-client.test.ts` (extend)

The seam API is designed so chunk 02's persistent-socket refactor never changes it: `runSession` gains an **optional `threadId` field on the existing `RunSessionOptions`** (not a new positional param), and `buildSessionStart` gains an **optional second param**. Chunk 02 will reuse the same socket but keeps calling `runSession(text, factory, { ..., threadId })` unchanged.

- [ ] **Step 1: Write the failing DOM-free seam tests for the `threadId` option.**

Append to `apps/overlay/src/ws/session-client.test.ts` (the `makeFake()` helper and imports already exist in that file):

```typescript
test("buildSessionStart includes thread_id when supplied (continuation turn)", () => {
  const tid = "11111111-2222-4333-8444-555555555555";
  const { msg } = buildSessionStart("hello", tid);
  expect(msg.thread_id).toBe(tid);
  expect(parseEnvelope(msg).kind).toBe("ok"); // still a valid frozen-contract session_start
});

test("buildSessionStart omits thread_id when not supplied (first turn / new conversation)", () => {
  const { msg } = buildSessionStart("hello");
  expect(msg.thread_id).toBeUndefined();
});

test("runSession sends session_start carrying options.threadId (continuation turn over the wire)", () => {
  const fake = makeFake();
  const tid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  void runSession("hi", () => fake.ws, { threadId: tid });
  fake.fire("open", {});
  const sent0 = JSON.parse(fake.sent[0]!) as { type: string; thread_id?: string };
  expect(sent0.type).toBe("session_start");
  expect(sent0.thread_id).toBe(tid);
});

test("runSession omits thread_id when options.threadId is absent (first turn mints client-side, daemon adopts)", () => {
  const fake = makeFake();
  void runSession("hi", () => fake.ws, {});
  fake.fire("open", {});
  const sent0 = JSON.parse(fake.sent[0]!) as { type: string; thread_id?: string };
  expect(sent0.thread_id).toBeUndefined();
});
```

(Adapt assertion helpers to the file's existing test idiom — the invariant is: with `threadId` → `session_start.thread_id` present and envelope still valid; without → absent.)

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && bun test apps/overlay/src/ws/session-client.test.ts`
Expected: the new tests FAIL — `buildSessionStart` takes one arg and `RunSessionOptions` has no `threadId`, so the emitted `session_start` never carries `thread_id`. The pre-existing tests still PASS (no-thread_id path byte-equivalent).

- [ ] **Step 3: Add the optional `threadId` to `buildSessionStart` and `runSession`.**

In `apps/overlay/src/ws/session-client.ts`:

(a) Add to `RunSessionOptions`:

```typescript
  /**
   * CM-01 (spec §3.3): the durable thread to continue. The overlay mints this
   * client-side (crypto.randomUUID, same posture as client_session_id) on the
   * first submit of a conversation and passes it on every continuation turn;
   * the daemon ADOPTS an unknown-but-UUID-shaped value as the new thread's id
   * (session_ack carries no thread_id, so the client owns the mint). Absent ⇒
   * a brand-new conversation (daemon mints, MF-01 §3.1).
   * Designed as an option field (not a positional param) so chunk 02's
   * persistent-socket refactor reuses runSession unchanged.
   */
  threadId?: string;
```

(b) Change `buildSessionStart` to accept an optional `threadId` and spread it onto the message:

```typescript
export function buildSessionStart(text: string, threadId?: string): {
  msg: SessionStart;
  clientSessionId: string;
} {
  const clientSessionId = crypto.randomUUID();
  const msg: SessionStart = {
    type: "session_start",
    trigger: "user",
    text,
    client_session_id: clientSessionId,
    // CM-01: additive optional continuation handle (already in the frozen contract,
    // envelope.ts:39). Only included when present so the no-thread_id frame stays
    // byte-equivalent to the MF-01 single-turn shape.
    ...(threadId ? { thread_id: threadId } : {}),
  };
  return { msg, clientSessionId };
}
```

(c) In `runSession`, thread the option through:

```typescript
    const { msg, clientSessionId } = buildSessionStart(text, options.threadId);
```

- [ ] **Step 4: Run the seam tests to verify they pass.**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && bun test apps/overlay/src/ws/session-client.test.ts`
Expected: all tests PASS (new + pre-existing).

- [ ] **Step 5: Wire `currentThreadId` into `main.ts` — mint on first submit, pass on every turn.**

In `apps/overlay/src/main.ts`:

(a) Declare the module-level state next to `inFlight`:

```typescript
// ---------------------------------------------------------------------------
// CM-01 (spec §3.3): the durable thread the overlay is continuing. Minted on
// the first submit of a conversation (crypto.randomUUID — same client-mint
// posture as client_session_id; session_ack carries no thread_id so the client
// owns the id and the daemon ADOPTS it). Passed on EVERY subsequent session_start.
//
// DELIBERATE INTERIM WART (chunk 01): there is no reset here — the overlay
// continues ONE ever-growing thread per app run (reset only by app restart).
// The "new conversation" / reset-on-dismiss escape hatch arrives in chunk 03.
// Do NOT add reset logic here (chunk-03 scope; PIPELINE §7.2).
// ---------------------------------------------------------------------------
let currentThreadId: string | undefined;
```

(b) Inside the Enter-key submit handler, AFTER the in-flight guard and the non-empty `text` check pass but BEFORE the `runSession(...)` call, mint on first use:

```typescript
    // CM-01: mint the thread id once, on the first submit of the app run; reuse
    // it on every continuation turn. (No reset until chunk 03's dismiss.)
    if (currentThreadId === undefined) {
      currentThreadId = crypto.randomUUID();
    }
```

(c) Pass it into the `runSession` options object (add the field alongside `onToolCall`, `onShowText`, `onSessionStart`):

```typescript
    runSession(text, factory, {
      threadId: currentThreadId,
      onToolCall,
      onShowText,
      onSessionStart: () => {
```

(Leave the rest of the `.then()/.catch()` body untouched.)

- [ ] **Step 6: Typecheck, lint:strict, and the full suites.**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && bun run typecheck && bun run lint:strict && bun test`
Expected: all green. (If the repo's script names differ, discover via `package.json` and run the equivalents.)

- [ ] **Step 7: Verify frozen surfaces are byte-unchanged (command evidence, PIPELINE §6.2).**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && git diff --stat origin/main -- packages/protocol/ && git diff --stat origin/main -- '**/mock-agent.ts' '**/mock-provider.ts'`
Expected: EMPTY output for all three (no lines). If anything appears, STOP — a frozen surface was touched; this is a freeze gate (§5.2), not an auto-merge.

- [ ] **Step 8: Commit.**

```bash
cd /Users/lior/WebstormProjects/playground/AgenticEngine
git add apps/overlay/src/ws/session-client.ts apps/overlay/src/ws/session-client.test.ts apps/overlay/src/main.ts
git commit -m "feat(connection-model): overlay mints + carries thread_id for continuation (CM-01)

main.ts mints currentThreadId on the first submit of an app run and
passes it on every session_start via an additive RunSessionOptions.threadId
(option field, so chunk 02's persistent-socket refactor reuses runSession
unchanged). buildSessionStart spreads thread_id only when present, keeping
the no-thread_id frame byte-equivalent. DOM-free seam tests cover both paths.
Interim: no reset until chunk 03 (deliberate wart).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification / Definition of Done (all mechanical — copy from chunk, mapped to evidence)

| DoD criterion (chunk) | Proven by | Where |
|---|---|---|
| real-I/O daemon test: `session_start{thread_id: fresh client UUID}` → thread row created WITH exactly that id (real SQLite, no mocks) | DoD#1 test | Task 1 Step 1/5 |
| real-I/O daemon test: second `session_start` same id → prior turn hydrated (provider sees the tail) | DoD#2 test (asserts exactly `["deploy is yeet.sh","what's the deploy?"]`) | Task 1 Step 1/5 |
| real-I/O daemon test: no `thread_id` → daemon-minted (MF-01 unchanged); non-UUID garbage → NOT adopted, fresh mint, no crash | DoD#3a + DoD#3b tests | Task 1 Step 1/5 |
| real-I/O daemon test: adopted-id FIRST turn still runs MF-02 cross-thread `retrieve()` injection | DoD#4 test | Task 2 Step 1/3 |
| overlay seam test (DOM-free, injected factory): continuation turns carry `thread_id`; first turn mints it | 4 seam tests | Task 3 Step 1/4 |
| frozen surfaces byte-unchanged (`packages/protocol/**`, `mock-agent.ts`, `mock-provider.ts`) | `git diff --stat` empty | Task 3 Step 7 |
| typecheck + `lint:strict` + `bun test` green (command evidence) | full-suite run | Task 3 Step 6 |
| documented dismissed-thread edge asserted deliberately (no scope growth into status semantics) | EDGE test | Task 2 Step 2/3 |

**Behavioral DoD note (PIPELINE §6.1):** All criteria above are mechanical (real-I/O tests + command evidence), so no live-demo gate applies per the chunk's 2026-06-10 Lior ruling. The real-I/O daemon tests (real `startDaemon` → real on-disk SQLite, mock provider, no mocked store) are the runtime proof that substitutes for a demo and defends against the Strike-4 mock-bypass blind spot.

---

## Self-review notes (architect)

- **Spec coverage:** CM §3.3 (overlay tracks + passes thread_id) → Task 3; MF-01 §3.1 (no/unknown → mint) preserved by the fall-through in Task 1 Step 4; the single-write-path rule honored by the optional `adoptId` param (no second `INSERT`). All eight chunk DoD lines map to a task.
- **Type consistency:** `isUuidShaped` (store) used by `beginTurn`; `RunSessionOptions.threadId` (session-client) used by `main.ts`'s `runSession` call and by `buildSessionStart`'s second param — names consistent across tasks.
- **No new dependencies.** No runtime dep added (the optional ADR is the only architectural artifact, and it is `proposed`, non-blocking).
- **Daemon/frontend separation (architecture.md):** preserved — no LLM logic added to the overlay; no UI rendering added to the daemon. The overlay only mints/carries an id; the daemon only adopts/validates it.
- **Open questions / blockers:** none. Citation test clean; the one reality-check imprecision ("always mints") is cosmetic and noted. PR #30 rebase re-verify is explicitly Jimmy-owned per the chunk Notes, not a task here.
