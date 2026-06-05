> 🗄️ ARCHIVED 2026-06-05 — shipped. Historical record; do not edit.

# Plan: Chunk 02 — Distiller + Cross-Thread Injection (Memory Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the distillation/retrieval `MemoryProvider` port, a deliberately-dumb `DumbTailProvider`, the INJECTION-POINT that composes the distilled slice into agent context at new-thread start, and cross-thread continuity — all gated by the HARD INVARIANT (archive = source of truth; `distilled_facts` = disposable re-derivable projection), proven by real-I/O tests over the real daemon→SQLite path.

**Architecture:** A new `MemoryProvider` port (mirroring the `AgentProvider` posture of ADR-0010) sits behind the daemon. The port is **async** (returns Promises — matches `AgentProvider` precedent; dumb v0 returns resolved-promise at zero cost; smart distiller will need network). `DumbTailProvider` re-derives `distilled_facts` rows from the untouched `messages` archive on the chunk-01 consolidation-hook (dismiss); the daemon registers it as the hook's handler. The dismiss trigger is a **PROVISIONAL thread-switch** (session_start with a new thread_id consolidates the prior thread — one line in index.ts), explicitly marked for supersession by connection-model CM-01 (spec: `orchestration/docs/specs/2026-06-05-connection-model.md §3.2`, close(ws) = genuine dismiss on persistent WS). At `session_start` with no/unknown `thread_id` (a NEW thread), the daemon retrieves the cross-thread distilled slice and composes it into `ProviderSessionState.messages[]` via the same hydration seam chunk 01 already uses. forget immediately purges any live `distilled_facts` row whose provenance references the forgotten message (grill S2), through a new `WriteGate.forget` callout into the provider.

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (already in use by chunk 01 — no new dependency); `bun test`; existing `eslint` strict + `tsc --noEmit`.

**Status:** shipped

---

## Reality check

Everything below is VERIFIED by reading the cited shipped source (post-merge `chore/mf-01-archive` branch). Behavioral claims are marked "requires runtime test." Per PIPELINE §6.1 and the Strike-4 scar, nothing is claimed PASS from code-reading — the real-I/O tests in `## Steps` are the proof.

### What chunk 01 actually built (read from the real files, not the archived plan)

- **`packages/daemon/src/memory/schema.ts`** — `SCHEMA_DDL` creates all five tables. `distilled_facts` (columns: `id`, `fact`, `provenance`, `scope`, `expiry`, `confidence`, `authored_by`, `derived_at`, `distiller_version`) and `distillation_events` (`id`, `thread_id`, `trigger`, `facts_produced`, `distiller_version`, `created_at`) **exist with the exact columns chunk 02 needs, and are unpopulated.** `REDACTION_MARKER = "[forgotten]"`. **CONFIRMED — no schema migration needed for chunk 02.**
- **`packages/daemon/src/memory/store.ts`** — `MemoryStore`: `createThread`, `threadExists`, `appendMessages`, `readThreadTail` (tombstone-honoring REDACT read), `rawDb()` (escape hatch — all SQL is meant to live in the store, but `WriteGate` already reaches through `rawDb()` to write `mutations`), `mirrorEvent`, `redactMirrorMessage` (Finding-2 fix — scrubs the JSONL mirror on forget), `close`. SQLite is canonical; per-thread JSONL is a mirror.
- **`packages/daemon/src/memory/write-gate.ts`** — `WriteGate` with `WriteContext { actor; authored_by }`, `appendTurn` (pass-through, `void ctx`), `forget` (tombstone + hard-scrub `messages.content` + `redactMirrorMessage` + audit `mirrorEvent`), `edit` (correction, never in-place), private `threadOf(messageId)`.
- **`packages/daemon/src/memory/consolidation-hook.ts`** — `ConsolidationHook`: `register(handler)`, `dismiss(threadId)` (flips `threads.status→'dismissed'` then calls the handler with `(threadId, "dismiss")`). Default handler is a no-op. `ConsolidationTrigger = "dismiss"`, `ConsolidationHandler = (threadId, trigger) => void`.
- **`packages/daemon/src/memory/thread-lifecycle.ts`** — `ThreadLifecycle`: `beginTurn(session_start) → { threadId; priorMessages }` (resolves `inbound.thread_id` or **mints a new thread**, hydrates tail via `readThreadTail(threadId, 50)`); `bindSession(sessionId, threadId, hydratedCount)` **(signature drifted from the archived plan — now takes a 3rd `hydratedCount` arg, Finding-1 fix)**; `threadForSession`; `endTurn(threadId, sessionId, finalMessages)` which **flushes only the DELTA** (`finalMessages.slice(hydratedCount)`, Finding-1 fix); `forgetSession`. `TAIL_LIMIT = 50`.
- **`packages/daemon/src/index.ts`** — constructs `store`, `WriteGate`, `lifecycle` once in `startDaemon`. On `session_start`: `beginTurn`, hydrate into `priorState = { phase:"done", session_id:"", messages: priorMessages }`, track `hydratedCount`. After `advance`: `bindSession(sid, turnThreadId, hydratedCount)` **only on `session_start`**; on `phase==="done"`, `endTurn` then `sessions.delete`. `close` calls `forgetSession`.
- **`packages/protocol/src/envelope.ts`** — `SessionStart` carries the additive optional `thread_id: z.string().optional()`. The union is still exactly **6 variants** (`envelope.test.ts` pins `Envelope.options.length === 6`).

### Gaps between "what 01 promised" and "what is in the codebase" — and which block 02

1. **BLOCKER-CLASS GAP — `ConsolidationHook` is never wired into the daemon.** `grep` across `packages/daemon/src` shows `ConsolidationHook` is referenced only in its own module and in tests. `index.ts` constructs `store`, `WriteGate`, `ThreadLifecycle` — but **never constructs `ConsolidationHook`, never registers a handler, and never calls `hook.dismiss(threadId)`.** The chunk-01 integration test for dismiss builds its own `ConsolidationHook` out-of-band against the on-disk DB. **There is also no inbound "dismiss" signal on the wire:** `session_end` is daemon→frontend (outbound, `session.ts`/`mock-agent.ts`), and inbound `session_end` is a no-op (`REDUCER_INPUT_TYPES` in `index.ts:27` = `{session_start, tool_result, tool_cancel}` only). Chunk 02's done-criterion "distiller fires on the consolidation-hook (dismiss) and writes a `distillation_events` row" therefore **cannot be satisfied end-to-end without first wiring the hook into the daemon AND giving it a trigger.** This is not a chunk-01 regression in the strict sense (chunk 01's scope was "hook as pass-through" + a unit test that the handler is *callable*), but it means the hook was built and shelved, never connected. Chunk 02 owns connecting it — see Open question Q1 for the trigger choice (the wire is frozen; this needs Lior's call).

2. **`endTurn` flushes the delta, not the hydrated prefix (Finding-1 fix).** This is *good* for chunk 02: `messages` rows are the genuine per-turn content with no duplicated hydrated prefixes, so distillation provenance (`messages.id`/`thread_id`) is clean. No action needed; called out so the worker does not "fix" it.

3. **The mock provider records only `user` messages.** `mock-provider.ts` appends `{role:"user", content: inbound.text}` on `session_start` and carries `messages[]` through unchanged on `tool_result`; it never appends an `assistant` row. **CONFIRMED** by the chunk-01 integration test's edit-test querying `role='user'`. Consequence for chunk 02: on the mock path the distiller's input is user messages only. `DumbTailProvider` must not assume assistant rows exist. (The anthropic provider does append assistant rows — `anthropic-api-provider.ts` — but the deterministic real-I/O tests run on the mock path per ADR-0010 decision-6's "mock is a permanent test harness.")

4. **`WriteGate.forget` does not currently touch `distilled_facts` (correct for 01; 02 must add it).** chunk 01's `forget` writes a tombstone, hard-scrubs `messages.content`, and scrubs the JSONL mirror — but `distilled_facts` was empty in 01 so there was nothing to purge. The grill-S2 "forget purges the LIVE slice" invariant requires `forget` to *also* drop `distilled_facts` rows whose `provenance` references the forgotten message. The seam for this purge "lives where the slice does — chunk 02" (spec §3.4). This means chunk 02 **extends `WriteGate.forget`** (a frozen-seam fill, not a re-plumb — see ADR-worthy).

5. **`MemoryStore` owns all SQL; `WriteGate` already reaches through `rawDb()`.** The chunk-01 architect-call "all SQL lives in the store" is *already* softened — `WriteGate` writes `mutations` via `store.rawDb()`. Chunk 02 will add `distilled_facts` read/write SQL; the cleanest placement is **new methods on `MemoryStore`** (`insertDistilledFacts`, `readDistilledSlice`, `dropDistilledFactsForThread`, `dropDistilledFactsByProvenance`, `insertDistillationEvent`) so the provider does not reach through `rawDb()` itself. This keeps the ARCHIVE-AS-TRUTH boundary in one place. (Architect-time call; not a new decision.)

### Behavioral claims requiring runtime test (NOT verified by reading)

That the distiller actually fires on dismiss through the daemon; that a re-derived slice never resurfaces a tombstoned fact; that a forget immediately empties the live slice; that a new thread's `session_start` is injected with a prior thread's distilled slice over the real daemon→store path; that the archive is byte-stable across distill cycles. These are exactly the criteria the real-I/O tests below prove, with no mocked store and no mocked injection-point.

---

## Design

### MemoryProvider port

A new file `packages/daemon/src/memory/memory-provider.ts`. The port mirrors the ADR-0010 `AgentProvider` posture: thin, one identifying field, swappable, never-throw discipline carried by typed returns. Two methods (the chunk file names them `distill` and `retrieve`):

```typescript
import type { MemoryStore } from "./store.js";
import type { SessionMessage } from "../providers/provider.js";

/** A re-derivable projection of the archive. Disposable; never a source of truth. */
export interface DistilledFact {
  fact: string;
  provenance: string;            // a messages.id (or a JSON ref) the fact was derived FROM
  scope: "thread-local" | "cross-thread" | "global"; // stamped; ENFORCEMENT is chunk 04
  expiry: number | null;         // epoch ms or null
  confidence: number;            // 0..1
  authored_by: "machine";        // v0 distiller is always machine-authored
}

/** Distillation outcome — observable even when empty (5b). NEVER throws. */
export interface DistillResult {
  threadId: string;
  facts: DistilledFact[];        // may be [] — "deliberately retained nothing"
}

/**
 * The swappable distillation/retrieval seam (spec §3.2 invariant 2; ADR-0010 posture).
 * THIN, one id field, no `kind`. A new distiller later = a new impl of THIS port +
 * re-run the projection — no source-of-truth migration (invariant 3).
 *
 * ASYNC: matches AgentProvider precedent. DumbTailProvider returns Promise.resolve()
 * at zero cost. Smart distiller (future) will need network/LLM calls (Q3 — Lior approved).
 */
export interface MemoryProvider {
  readonly id: string;           // "dumb-tail", "fixed-marker" (the swap-proof second impl)

  /**
   * Re-derive distilled facts for one thread from the UNTOUCHED archive.
   * Read-only over messages/mutations (lossless, §4.2). MUST honor tombstones —
   * a forgotten message never yields a fact (F1).
   */
  distill(store: MemoryStore, threadId: string): Promise<DistillResult>;

  /**
   * Compose the bounded distilled slice to inject at a NEW thread's start.
   * Reads distilled_facts (the projection). MUST honor tombstones (F1).
   * Returns the slice as SessionMessage[] ready to prepend to messages[].
   */
  retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]>;
}
```

`distill` and `retrieve` are **async** (return Promises — matches `AgentProvider.advance` precedent per ADR-0010; approved by Lior at plan gate as Q3). DumbTailProvider returns `Promise.resolve(...)` at zero cost. A future smart distiller needing network/LLM calls slots in without call-site changes.

`MemoryProvider` is **separate from `AgentProvider`** — it is a memory seam, not an LLM seam. It does not go through `injector.ts` (that registry is keyed for LLM providers). It gets its own tiny selector (see Step 1).

### DumbTailProvider v0

`packages/daemon/src/memory/providers/dumb-tail-provider.ts`. `id = "dumb-tail"`.

- **"Tail" = the most recent N user-authored messages of a thread, after honoring tombstones/corrections.** Recency heuristic: order by `turn_index DESC`, take the latest `DISTILL_TAIL_N = 5`, reverse to chronological. This is deliberately dumb — no semantic selection, no scoring (the smart distiller is spec §1 Out). The architect-time heuristic choice (spec §7) is **recency-only**, not scope-match.
- **`distill(store, threadId)`**: reads the thread's tombstone-honored tail; for each surviving message, emits one `DistilledFact` where `fact = message.content`, `provenance = message.id`, `scope = "cross-thread"` (so it is retrievable by other threads — the v0 has no isolation rules; scope ENFORCEMENT is chunk 04), `expiry = null`, `confidence = 1.0`, `authored_by = "machine"`. **Tombstoned messages are skipped** (the read already redacts them to the marker; the distiller filters out `content === REDACTION_MARKER` so a forgotten message yields no fact — F1). Empty thread → `facts: []` (still a valid `DistillResult`; the 5b event records 0).
- **`retrieve(store, forThreadId)`**: reads all `distilled_facts` rows from `distilled_facts` (the projection table) **excluding any whose `provenance` points at a now-tombstoned message** (defense-in-depth on top of the live-purge; F1). Returns them as `SessionMessage[]` of the form `{ role: "user", content: "[remembered] " + fact }` — prepended ahead of the new thread's own turns. Bounded by `RETRIEVE_SLICE_N = 20`. (Cross-thread because v0 has no isolation; chunk 04 will filter by `scope` + thread.)

The distiller writes facts through `store.insertDistilledFacts(...)` and the 5b event through `store.insertDistillationEvent(...)` — see Step 2.

### Second trivial provider (swap-proof)

`packages/daemon/src/memory/providers/fixed-marker-provider.ts`. `id = "fixed-marker"`. Deliberately **different from DumbTail so the swap test is meaningful** (not a copy):

- **`distill(store, threadId)`**: emits **exactly ONE** fact per thread — a fixed-shape summary `fact = "thread:<threadId> has <N> live messages"` where N counts the non-tombstoned messages. `provenance = "thread:" + threadId` (a thread-level ref, not a message-level ref — deliberately a different provenance shape so the live-purge test must handle both). `scope = "cross-thread"`, `confidence = 0.5` (different from DumbTail's 1.0 — a witnessable difference). It does NOT copy message content verbatim.
- **`retrieve`**: same projection-read contract as DumbTail (reads `distilled_facts`, honors tombstones), so the injection-point is provider-agnostic — only `distill` differs in shape. This is what makes the swap-proof real: drop `distilled_facts`, re-derive with `fixed-marker` over the **same untouched `messages`**, and assert the new slice has fixed-marker's shape (count-summary, confidence 0.5), not DumbTail's (verbatim, confidence 1.0), while `messages` is byte-unchanged.

### Injection point

The single place the distilled slice enters agent context = **`session_start` for a NEW thread**, inside `ThreadLifecycle.beginTurn` (which already returns `priorMessages`). Today `beginTurn` returns `priorMessages: []` on the mint branch (`thread-lifecycle.ts:48`). Chunk 02 changes **only that branch**: when a new thread is minted (no/unknown `thread_id`), compose the cross-thread distilled slice via `memoryProvider.retrieve(store, newThreadId)` and return it as `priorMessages`. The existing-thread branch is unchanged (within-thread multi-turn already hydrates the thread's own tail; cross-thread injection is for the *new*-thread case, which is exactly the route-closing demo step 4).

- **Exact daemon message:** `session_start` (the same additive `thread_id` field from chunk 01 — no wire change). No new envelope variant.
- **Exact code location:** `ThreadLifecycle.beginTurn`, the mint branch (`thread-lifecycle.ts:47-48`). `index.ts` is **unchanged** for injection — it already takes `begin.priorMessages` and hydrates them into `priorState.messages[]` (`index.ts:74-81`). The seam chunk 01 reserved is reused exactly: the slice arrives as `messages[]`, the mock adapter prepends it ("append more, not a rewrite"). **This keeps daemon/frontend separation intact** — the slice is composed in the daemon; the frontend never sees memory logic.
- **One nuance:** because the injected slice is `priorMessages` and `endTurn` flushes only the delta (`slice(hydratedCount)`), the injected cross-thread facts are NOT re-persisted into the new thread's `messages` — they are read-only context, exactly as the projection should be (no fact exists only in the distilled layer; the facts live in `distilled_facts` derived from the *origin* thread). `hydratedCount` will equal the injected-slice length, so the delta excludes it. This is the reason the Finding-1 delta-flush is load-bearing for chunk 02 and must not regress.

### Distillation trigger

The distiller fires on chunk-01's `ConsolidationHook.dismiss(threadId)`. Chunk 02:

1. **Constructs `ConsolidationHook` in `index.ts`** (chunk 01 left it un-constructed — see Reality check gap 1).
2. **Registers the distiller as the handler:** `hook.register((threadId, trigger) => { const r = memoryProvider.distill(store, threadId); store.insertDistilledFacts(r.facts, memoryProvider.id); store.insertDistillationEvent(threadId, trigger, r.facts.length, memoryProvider.id); })`. The 5b event is written **on every dismiss, even when `r.facts.length === 0`** (the "deliberately retained nothing" vs "silently lost" distinction).
3. **Wires the PROVISIONAL thread-switch dismiss trigger** (Q1 — resolved by Lior at plan gate): when a `session_start` arrives with a `thread_id` **different from** the current active thread for that connection, call `hook.dismiss(prevThreadId)` on the outgoing thread BEFORE `beginTurn`. This is **ONE LINE** in `index.ts` (or in the `beginTurn` return path). Code MUST be marked with a comment:
   ```typescript
   // PROVISIONAL: thread-switch dismiss — superseded by connection-model CM-01 close(ws) path
   // (spec: orchestration/docs/specs/2026-06-05-connection-model.md §3.2)
   ```
   This trigger reuses the **same hook + event record** (spec §7 compliant). CM-01 (a single-line swap in `index.ts`) replaces it with `close(ws)` when the persistent-WS connection model lands (slots between MF-04 and MF-05).

A `distillation_events` record = `{ id: uuid, thread_id, trigger: "dismiss", facts_produced: <count>, distiller_version: <provider.id>, created_at: now }`.

### forget-purges-live-slice (grill S2)

The hard invariant: a forget IMMEDIATELY invalidates any cached `distilled_facts` row whose `provenance` references the forgotten content — no window where a still-cached slice injects a just-forgotten fact.

**Mechanism (chosen): `forget()` synchronously purges; `retrieve()` ALSO checks tombstones on-the-fly (defense-in-depth).** Both, not either:

- **Immediate purge (the primary, S2-mandated path):** `WriteGate.forget(messageId, ...)` is extended (after the tombstone + hard-scrub it already does) to call `store.dropDistilledFactsByProvenance(messageId)` — deleting every `distilled_facts` row whose `provenance` references that `messages.id`. This is **immediate and eager** (not lazy), satisfying S2's "no window" requirement. Because `fixed-marker`'s provenance is thread-level (`"thread:<id>"`) not message-level, the purge must also handle thread-level provenance: `forget` looks up `threadOf(messageId)` (it already does, `write-gate.ts:69`) and additionally calls `store.dropDistilledFactsForThread(threadId)` for facts with provenance `"thread:<threadId>"`. So a forget drops both per-message and per-thread facts that could have included the forgotten content. (This is correct and conservative: a thread-summary fact derived from the thread is invalidated when any of its source messages is forgotten — it can be re-derived later.)
- **On-the-fly tombstone check (defense-in-depth):** `retrieve()` excludes any fact whose `provenance` points at a tombstoned message, even if the eager purge somehow missed it. This guards the live-slice invariant against any future code path that forgets without going through `WriteGate.forget`.

This is a **frozen-seam fill, not a re-plumb:** `WriteGate.forget`'s signature is unchanged; chunk 02 adds two store-callouts inside it. `WriteGate` gains a reference to the `MemoryProvider`? No — the purge is pure SQL (drop rows by provenance), so it lives on `MemoryStore`, and `WriteGate` calls the store. No new dependency edge from `WriteGate` to the provider. (See Open question Q2 — there is a wiring subtlety: `WriteGate` is constructed before the provider in `index.ts`; the purge methods are on the store, which `WriteGate` already holds, so ordering is fine.)

### Cross-thread continuity

A new thread draws the distilled slice from prior threads through the real daemon→store path:

1. Thread A: user states a fact ("deploy is yeet.sh"). On dismiss, the distiller writes a `distilled_facts` row (provenance = A's message id, scope cross-thread).
2. Thread B (a NEW thread — fresh `session_start`, no `thread_id`): `beginTurn` mints B, calls `retrieve(store, B)`, which reads the `distilled_facts` rows (A's fact) and returns them as `priorMessages`. `index.ts` hydrates them into `priorState.messages[]`. The provider sees A's fact as prior context. **This is the route-closing demo step 4, proven here by a real-I/O test (no live demo this chunk).**
3. If A's fact was forgotten before B starts, the eager purge already removed it (and `retrieve`'s on-the-fly check is a backstop) — so B is never injected with a forgotten fact.

---

## Steps

> Conventions for every step: exact file paths; complete code in code steps; run-and-expected for test steps; per-task commit (project CLAUDE.md: branch `chunk/mf-02-distiller-cross-thread`, commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer, push branch, open PR at the end — never merge). Run the full gate (`bun test && bun run typecheck && bun run lint:strict`) before each commit. **TDD throughout: failing test first, then minimal impl.**

> **Q1 RESOLVED:** Provisional thread-switch trigger. Q3 RESOLVED: async port. All steps unblocked. See Open questions for details.

### Step 1: MemoryProvider port + store-layer distilled_facts SQL + stub providers

**Files:**
- Create: `packages/daemon/src/memory/memory-provider.ts` (the port + `DistilledFact`/`DistillResult` types — exactly as in Design)
- Modify: `packages/daemon/src/memory/store.ts` (add distilled_facts/event methods — see below)
- Create: `packages/daemon/src/memory/providers/dumb-tail-provider.ts`
- Create: `packages/daemon/src/memory/providers/fixed-marker-provider.ts`
- Create: `packages/daemon/src/memory/memory-provider-selector.ts` (tiny env-driven selector, mirroring `injector.ts` but for memory)
- Test: `packages/daemon/src/memory/store.test.ts` (append distilled_facts CRUD tests); `packages/daemon/src/memory/providers/dumb-tail-provider.test.ts`; `packages/daemon/src/memory/providers/fixed-marker-provider.test.ts`

**Store methods to add to `MemoryStore`** (keep all SQL in the store — Reality check gap 5):
- `insertDistilledFacts(facts: DistilledFact[], distillerVersion: string): void` — INSERT each into `distilled_facts` with `derived_at = Date.now()`, `distiller_version = distillerVersion`.
- `readDistilledFacts(limit: number): DistilledFactRow[]` — SELECT all, ORDER BY `derived_at DESC` LIMIT, returning `{ fact, provenance, scope, expiry, confidence, authored_by }`.
- `isMessageTombstoned(messageId: string): boolean` — `SELECT 1 FROM mutations WHERE target_message_id=? AND kind='tombstone'`.
- `dropDistilledFactsByProvenance(provenance: string): number` — `DELETE FROM distilled_facts WHERE provenance = ?`, return change count.
- `dropDistilledFactsForThread(threadId: string): number` — `DELETE FROM distilled_facts WHERE provenance = ?` with `"thread:"+threadId` (the fixed-marker shape).
- `dropAllDistilledFacts(): void` — `DELETE FROM distilled_facts` (used by the swap-proof test to drop the projection before re-deriving).
- `insertDistillationEvent(threadId, trigger, factsProduced, distillerVersion): void`.
- `readDistillationEvents(threadId): DistillationEventRow[]` — for the observability test.
- `readThreadMessagesForDistill(threadId): { id; role; content }[]` — like `readThreadTail` but returns message ids + honors tombstones (redacts content to marker), so the distiller can filter `content === REDACTION_MARKER` and keep `id` for provenance. (DumbTail needs the id; `readThreadTail` drops it.)

- [x] **Step 1.1: Write `memory-provider.ts`** (the port + types, verbatim from Design § MemoryProvider port). No test for a pure interface; it is exercised by the provider tests.

- [x] **Step 1.2: Write failing tests for the new store methods** — append to `store.test.ts`: insert two distilled facts then `readDistilledFacts(10)` returns both; `dropDistilledFactsByProvenance(mid)` removes only the matching-provenance fact; `dropDistilledFactsForThread(tid)` removes `"thread:"+tid` facts; `insertDistillationEvent` then `readDistillationEvents(tid)` returns the row with `facts_produced`; `readThreadMessagesForDistill` returns ids + redacts a tombstoned message to the marker.

```typescript
test("insertDistilledFacts + readDistilledFacts round-trips facts with tags", () => {
  const { store } = freshStore();
  store.insertDistilledFacts(
    [{ fact: "deploy is yeet.sh", provenance: "m-1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  const got = store.readDistilledFacts(10);
  expect(got.length).toBe(1);
  expect(got[0]!.fact).toBe("deploy is yeet.sh");
  expect(got[0]!.provenance).toBe("m-1");
  store.close();
});

test("dropDistilledFactsByProvenance removes only the matching-provenance rows", () => {
  const { store } = freshStore();
  store.insertDistilledFacts([
    { fact: "a", provenance: "m-1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "b", provenance: "m-2", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "dumb-tail");
  expect(store.dropDistilledFactsByProvenance("m-1")).toBe(1);
  expect(store.readDistilledFacts(10).map((f) => f.fact)).toEqual(["b"]);
  store.close();
});

test("insertDistillationEvent records a row even with 0 facts (5b)", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.insertDistillationEvent(t, "dismiss", 0, "dumb-tail");
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(evs[0]!.facts_produced).toBe(0);
  store.close();
});
```

- [x] **Step 1.3: Run → fail; implement the store methods; run → pass.** `bun test packages/daemon/src/memory/store.test.ts`.

- [x] **Step 1.4: Write failing `dumb-tail-provider.test.ts`** — real SQLite via `MemoryStore`, no mocks:

```typescript
test("DumbTailProvider.distill emits one fact per live tail message with message-id provenance", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "deploy is yeet.sh" }], "s1");
  const r = dumbTailProvider.distill(store, t);
  expect(r.facts.length).toBe(1);
  expect(r.facts[0]!.fact).toBe("deploy is yeet.sh");
  expect(r.facts[0]!.confidence).toBe(1);
  store.close();
});

test("DumbTailProvider.distill skips a tombstoned message (F1)", () => {
  const { store } = freshStore();
  const gate = new WriteGate(store);
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "secret" }], "s1");
  gate.forget(mid!, { actor: "user", authored_by: "human" });
  const r = dumbTailProvider.distill(store, t);
  expect(r.facts.length).toBe(0); // forgotten message yields no fact
  store.close();
});

test("DumbTailProvider.retrieve returns persisted facts as prepended slice messages", () => {
  const { store } = freshStore();
  store.insertDistilledFacts(
    [{ fact: "deploy is yeet.sh", provenance: "m-1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  const slice = dumbTailProvider.retrieve(store, store.createThread());
  expect(slice).toEqual([{ role: "user", content: "[remembered] deploy is yeet.sh" }]);
  store.close();
});
```

- [x] **Step 1.5: Run → fail; implement `dumb-tail-provider.ts` (`DISTILL_TAIL_N = 5`, `RETRIEVE_SLICE_N = 20`); run → pass.**

- [x] **Step 1.6: Write failing `fixed-marker-provider.test.ts`** — assert distill emits exactly ONE count-summary fact with `confidence: 0.5` and `provenance: "thread:"+threadId`; retrieve has the same projection-read contract as DumbTail.

- [x] **Step 1.7: Run → fail; implement `fixed-marker-provider.ts` + `memory-provider-selector.ts`** (`MEMORY_PROVIDER` env, default `"dumb-tail"`, `Map` registry keyed by id, unknown → `console.error` + fall back to dumb-tail, never throw — ADR-0010 gotcha-#9 posture); run → pass.

- [x] **Step 1.8: Full gate + commit** — `bun test && bun run typecheck && bun run lint:strict` green; `git commit` (`feat(daemon): MF-02 MemoryProvider port + DumbTail/FixedMarker stubs + distilled_facts store SQL`).

**Acceptance:** port defined; both providers implement it; store owns all `distilled_facts`/`distillation_events` SQL; selector picks by env, falls back gracefully. Real-I/O unit tests green.

### Step 2: Distillation trigger — register the distiller on the consolidation-hook + emit the 5b event

**Files:**
- Modify: `packages/daemon/src/memory/consolidation-hook.ts` (no signature change — it already supports `register`; add nothing structural, just confirm the handler shape matches)
- Create: `packages/daemon/src/memory/distiller-registration.ts` — a single function `registerDistiller(hook, store, provider)` that wires the handler (keeps `index.ts` thin and makes the registration unit-testable without the daemon)
- Test: `packages/daemon/src/memory/distiller-registration.test.ts`

- [x] **Step 2.1: Write failing test** — `distiller-registration.test.ts`, real store + real hook + real DumbTail:

```typescript
test("registered distiller writes distilled_facts AND a distillation_events row on dismiss", () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, dumbTailProvider);
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "deploy is yeet.sh" }], "s1");
  hook.dismiss(t);
  expect(store.readDistilledFacts(10).some((f) => f.fact === "deploy is yeet.sh")).toBe(true);
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(evs[0]!.facts_produced).toBe(1);
  store.close();
});

test("dismiss of an EMPTY thread still writes a distillation_events row with 0 facts (5b)", () => {
  const { store } = freshStore();
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, dumbTailProvider);
  const t = store.createThread();
  hook.dismiss(t);
  expect(store.readDistilledFacts(10).length).toBe(0);
  const evs = store.readDistillationEvents(t);
  expect(evs.length).toBe(1);
  expect(evs[0]!.facts_produced).toBe(0); // "deliberately retained nothing"
  store.close();
});
```

- [x] **Step 2.2: Run → fail; implement `registerDistiller`** (the handler from Design § Distillation trigger); run → pass.

- [x] **Step 2.3: Gate + commit** (`feat(daemon): MF-02 distiller fires on consolidation-hook, emits 5b event even when empty`).

**Acceptance:** distiller writes facts + a `distillation_events` row on dismiss; empty dismiss writes a 0-fact event. Real-I/O, no mocks.

### Step 3: Injection-point — cross-thread slice composed at new-thread start

**Files:**
- Modify: `packages/daemon/src/memory/thread-lifecycle.ts` (the mint branch of `beginTurn` only; add a `MemoryProvider` constructor dependency)
- Test: `packages/daemon/src/memory/thread-lifecycle.test.ts` (append)

The only change: `ThreadLifecycle`'s constructor gains a third param `memoryProvider: MemoryProvider`; `beginTurn`'s mint branch calls `this.memoryProvider.retrieve(this.store, newThreadId)` for `priorMessages` instead of `[]`. The existing-thread branch is unchanged. **Note:** `hydratedCount` (already tracked in `index.ts`) will now equal the injected-slice length on a new thread, so `endTurn`'s delta-flush correctly excludes the injected slice from persistence — confirm with a test.

- [x] **Step 3.1: Write failing test** — append to `thread-lifecycle.test.ts`:

```typescript
test("a NEW thread is injected with the cross-thread distilled slice (injection-point)", () => {
  const { store } = freshTL(); // helper constructs ThreadLifecycle with dumbTailProvider
  // Thread A: state a fact, then distill it (simulating a prior dismiss).
  const a = store.createThread();
  store.appendMessages(a, [{ role: "user", content: "deploy is yeet.sh" }], "sa");
  store.insertDistilledFacts(dumbTailProvider.distill(store, a).facts, "dumb-tail");
  // Thread B: a fresh session_start with NO thread_id mints B and injects A's fact.
  const begin = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
  expect(begin.priorMessages).toContainEqual({ role: "user", content: "[remembered] deploy is yeet.sh" });
});

test("injected cross-thread slice is NOT re-persisted into the new thread (delta-flush guard)", () => {
  const { store } = freshTL();
  const a = store.createThread();
  store.appendMessages(a, [{ role: "user", content: "fact A" }], "sa");
  store.insertDistilledFacts(dumbTailProvider.distill(store, a).facts, "dumb-tail");
  const b = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
  lifecycle.bindSession("sb", b.threadId, b.priorMessages.length);
  // provider re-attaches prefix + appends the user turn; endTurn flushes only the delta.
  lifecycle.endTurn(b.threadId, "sb", [...b.priorMessages, { role: "user", content: "hi" }]);
  const persisted = store.readThreadTail(b.threadId, 50).map((m) => m.content);
  expect(persisted).toEqual(["hi"]); // injected slice NOT persisted; only this turn's delta
});
```

- [x] **Step 3.2: Run → fail; implement the `beginTurn` mint-branch change + constructor param; run → pass.**

- [x] **Step 3.3: Wire the provider + hook into `index.ts`** — construct `memoryProvider = buildMemoryProvider()` (the selector), pass it to `new ThreadLifecycle(store, gate, memoryProvider)`, construct `const hook = new ConsolidationHook(store)`, call `registerDistiller(hook, store, memoryProvider)`. (The `hook.dismiss` trigger wiring is Step 4 — gated on Q1.) Verify `daemon.test.ts`, `mock-agent.daemon.test.ts`, `mock-provider.test.ts` still pass (no-regression).

- [x] **Step 3.4: Gate + commit** (`feat(daemon): MF-02 INJECTION-POINT — cross-thread distilled slice at new-thread start`).

**Acceptance:** a new thread's `beginTurn` returns a prior thread's distilled facts; the injected slice is not re-persisted (delta-flush intact); no LLM logic enters the frontend (daemon-only). Existing tests unchanged.

### Step 4: forget-purges-live-slice (grill S2) + dismiss-trigger wiring

**Files:**
- Modify: `packages/daemon/src/memory/write-gate.ts` (extend `forget` to purge `distilled_facts` — see Design § forget-purges-live-slice)
- Modify: `packages/daemon/src/memory/providers/dumb-tail-provider.ts` and `fixed-marker-provider.ts` (`retrieve` excludes tombstoned-provenance facts — defense-in-depth)
- Modify: `packages/daemon/src/index.ts` (the dismiss trigger — `close(ws)` per recommended Q1 default)
- Test: `packages/daemon/src/memory/write-gate.test.ts` (append)

- [x] **Step 4.1: Write failing test** — append to `write-gate.test.ts`:

```typescript
test("forget IMMEDIATELY purges the live distilled_facts row for the forgotten message (grill S2)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "secret token abc" }], "s1", CTX);
  // distill → the fact is live in distilled_facts (provenance = mid)
  store.insertDistilledFacts(
    [{ fact: "secret token abc", provenance: mid!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  expect(store.readDistilledFacts(10).length).toBe(1);
  gate.forget(mid!, CTX, "user requested");
  // The LIVE slice is empty IMMEDIATELY — not only after a re-derive.
  expect(store.readDistilledFacts(10).length).toBe(0);
  store.close();
});

test("forget also purges a thread-level (fixed-marker) fact derived from the thread", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "x" }], "s1", CTX);
  store.insertDistilledFacts(
    [{ fact: "thread:" + t + " has 1 live messages", provenance: "thread:" + t, scope: "cross-thread", expiry: null, confidence: 0.5, authored_by: "machine" }],
    "fixed-marker",
  );
  gate.forget(mid!, CTX);
  expect(store.readDistilledFacts(10).length).toBe(0); // thread-level fact purged too
  store.close();
});
```

- [x] **Step 4.2: Run → fail; extend `WriteGate.forget`** to call `store.dropDistilledFactsByProvenance(messageId)` and `store.dropDistilledFactsForThread(this.threadOf(messageId))` after the existing tombstone/scrub/mirror logic; run → pass. **`WriteGate`'s signature is unchanged** (frozen-seam fill).

- [x] **Step 4.3: Add the `retrieve` defense-in-depth** — in both providers, `retrieve` filters out facts whose `provenance` is a message-id that `store.isMessageTombstoned(...)` reports true. Add a test asserting `retrieve` skips a fact whose provenance message was tombstoned even if the row somehow survived purge.

- [x] **Step 4.4: Wire the PROVISIONAL thread-switch dismiss trigger in `index.ts`** (Q1 — resolved by Lior). When a `session_start` arrives, if `lifecycle.activeThreadForConnection(ws)` exists AND the incoming `thread_id` differs from it (or is absent = new thread), call `await hook.dismiss(prevThreadId)` BEFORE `beginTurn`. Add a `Set<string>` of already-dismissed threads to `ws.data` to guard against double-dismiss (idempotent, but avoids duplicate `distillation_events` rows). Mark with the required PROVISIONAL comment block. **This is CM-01's supersession point — do not make it clever; the replacement is one line.**

- [x] **Step 4.5: Gate + commit** (`feat(daemon): MF-02 forget purges live distilled slice (grill S2) + dismiss trigger on WS close`).

**Acceptance:** forget immediately empties the live slice (both message-level and thread-level provenance); `retrieve` is tombstone-safe as a backstop; dismiss fires on WS close. Real-I/O.

### Step 5: Real-I/O integration tests — all over the real daemon→SQLite path, no mocks

**Files:**
- Create: `packages/daemon/src/memory/distiller-integration.daemon.test.ts` (real `startDaemon(0)`, mock provider, real on-disk SQLite — mirrors chunk 01's `memory-integration.daemon.test.ts`)

Each test drives the real daemon over WS (the `runTurn` helper from chunk 01's integration test) and asserts on the on-disk DB. The five mechanical proofs from the chunk file's Done criteria + spec §4.2:

- [x] **Step 5.1: swap-proof** — drive a turn (thread A), `hook.dismiss(A)` via the daemon's trigger, assert DumbTail produced a verbatim fact (confidence 1.0). Then open the same on-disk DB, `store.dropAllDistilledFacts()`, re-derive with `fixedMarkerProvider.distill(store, A)` → assert the new slice has fixed-marker's shape (count-summary, confidence 0.5) and that `messages` is **byte-unchanged** (snapshot all `messages` rows before/after — equal). Proves invariant 3 (swap = new provider + re-run projection, no source-of-truth migration).

- [x] **Step 5.2: forget-survives-re-derive** — forget a message via `WriteGate` against the on-disk DB; re-derive with DumbTail; assert the forgotten fact is absent from both the rebuilt `distilled_facts` and from `retrieve()`'s slice.

- [x] **Step 5.3: forget-purges-the-LIVE-slice** — distill (fact is live), then forget, then assert `store.readDistilledFacts` is empty **before any re-derive** (the S2 "no window" proof at integration scale).

- [x] **Step 5.4: cross-thread continuity** — drive thread A to dismiss (distills a fact), then drive a NEW `session_start` with no `thread_id` (thread B), and assert — by reading what the daemon hydrated — that B's `priorMessages`/injected slice contained A's fact. Observation strategy (no mocked injection-point): the cross-thread fact is read-only context (not persisted into B per the delta-flush), so assert it two ways: (a) `distilled_facts` contains A's fact after A's dismiss; (b) a unit-level assertion on `lifecycle.beginTurn` over the same on-disk store returns A's fact as `priorMessages` for a freshly-minted B. (The fully-live WS injection is exercised by the route-closing demo in chunk 05; here it is proven by the real store + real lifecycle, no mock.)

- [x] **Step 5.5: distillation-observable (5b)** — dismiss a thread that distilled 0 facts; assert a `distillation_events` row exists with `facts_produced = 0`.

- [x] **Step 5.6: lossless integrity** — snapshot all `messages` + `mutations` rows; run a distill / re-derive cycle (drop + re-derive); assert `messages`/`mutations` are byte-identical (the distill cycle is read-only over the archive; NB per spec §4.2 this is byte-stability across DISTILLATION, NOT across a forget).

- [x] **Step 5.7: Gate + commit** (`test(daemon): MF-02 real-I/O swap/forget/cross-thread/observable/lossless proofs over the daemon→SQLite path`).

**Acceptance:** all six mechanical proofs green on real on-disk SQLite, real daemon path, no mocked store/injection-point/provider.

### Step 6: typecheck + lint:strict + bun test, then push + PR

- [x] **Step 6.1:** From repo root: `bun test && bun run typecheck && bun run lint:strict` → all green. Capture the pass count.
- [x] **Step 6.2:** Re-run chunk 01's tests to confirm no regression: `bun test packages/daemon/src/memory/ packages/daemon/src/daemon.test.ts packages/daemon/src/mock-agent.daemon.test.ts packages/daemon/src/mock-agent.test.ts packages/daemon/src/providers/` → all green; `git diff origin/main..HEAD -- packages/daemon/src/mock-agent.ts` empty (ADR-0010 decision-6 reducer freeze still held — chunk 02 does not touch the reducer).
- [x] **Step 6.3:** `git push -u origin chunk/mf-02-distiller-cross-thread` then `gh pr create --base main` with a body summarizing chunk 02 + the six real-I/O proofs + the Q1 trigger note + the Claude Code attribution line. Do NOT merge (Lior's gate).

---

## ADR worthy

**no — with one flag for Lior's awareness (not a new decision).**

Chunk 02 fills frozen seams; it does not add a load-bearing decision not already in ADR-0012 or ADR-0010:
- The `MemoryProvider` port **is** ADR-0012 decision 6 + the spec §3.2-invariant-2 "real swappable provider port" + the ADR-0010 swappable-provider posture, made concrete. No new posture.
- `distilled_facts` as a disposable projection, the injection-point, the 5b event, tombstone-honoring re-derive, forget-purges-live-slice are all spec §3.2/§3.3/§3.4 seams the spec explicitly hands to the architect.
- DumbTail's recency-only heuristic, the second provider's shape, `DISTILL_TAIL_N`/`RETRIEVE_SLICE_N`, sync-vs-async port — all spec §7 "architect picks the v0 DumbTail behavior; the port is what's frozen, not the heuristic."
- No new runtime dependency (`bun:sqlite` already in use since chunk 01).

**The one flag (NOT ADR-worthy, but Lior should sign off at the plan gate):** chunk 02 **constructs and wires `ConsolidationHook` into the daemon and adds a dismiss TRIGGER that does not exist today** (Reality check gap 1 + Open question Q1). The hook *mechanism* is frozen (chunk 01); the *trigger* is genuinely undecided — the spec §7 says "consolidation = an observable event on thread-end (dismiss)" is frozen but leaves the concrete trigger to the architect, and the wire is frozen (no inbound dismiss signal). The recommended interim trigger (fire on WS `close`) reuses the same hook + event record (spec §7 compliant) and needs no wire change. If Lior wants a different/explicit dismiss signal (e.g. a future additive optional field or a deliberate inbound `session_end` handling), that is a **separate decision** — surface it as Q1 rather than silently picking. This does not rise to an ADR because it is a behavioral wiring of an already-frozen seam with a reversible interim choice, but it is the one place chunk 02 does more than "fill a stub."

---

## Open questions / blockers

- **Q1 (RESOLVED — Lior, plan gate 2026-06-05) — the dismiss trigger.** Use **PROVISIONAL thread-switch trigger**: when `session_start` arrives with a different (or absent) `thread_id` vs the current active thread, call `hook.dismiss(prevThread)` before `beginTurn`. Mark in code: `// PROVISIONAL: thread-switch dismiss — superseded by connection-model CM-01 close(ws) path (spec: orchestration/docs/specs/2026-06-05-connection-model.md §3.2)`. CM-01 (between MF-04 and MF-05) replaces this with the clean `close(ws)` = dismiss from the persistent-WS model. See [connection-model spec §3.2] for the CM-01 supersession path.

- **Q2 (architect-resolved, noted for review) — purge-call placement.** `WriteGate.forget` purges `distilled_facts` by calling **store methods** (pure SQL), not by holding a `MemoryProvider` reference — so there is no new dependency edge `WriteGate → MemoryProvider`, and the `index.ts` construction order (`WriteGate` before `memoryProvider`) is unaffected. Resolved this way deliberately; surfaced so the reviewer agrees the purge is store-level SQL, not provider logic.

- **Q3 (RESOLVED — Lior, plan gate 2026-06-05) — async port.** `distill`/`retrieve` return **Promises** (matches `AgentProvider.advance` precedent; DumbTailProvider returns `Promise.resolve()` at zero cost; smart distiller will need network). All call sites in the daemon must `await` them.

- **Non-blocker — mock path has no `assistant` rows.** The deterministic real-I/O tests run on the mock provider, which records only `user` messages. `DumbTailProvider` distills whatever live messages exist (role-agnostic), so this is fine; just do not write a test asserting an `assistant`-role fact on the mock path.
