# Thread-forget (2e) — Chunk 02: the daemon surface (HTTP intent-dispatch, live-guard, adoption exclusion, history.html) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Per repo `CLAUDE.md`: branch `chunk/02-daemon-surface`, commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer, PR to `main`, auto-merge only on the all-green gate set.

**Goal:** Wire the daemon surface of thread-forget onto the chunk-01 primitive: an additive `target_type:"thread"` branch on `POST /memory/forget` (404/400/409/204 taxonomy), the `Hatch.forgetThread` façade + `hatch.view` thread-meta widening, an `isThreadLive` refcount registry in `index.ts` (the §0.5 live-guard), the §3.3a erased-id adoption exclusion, and the history.html fallback (button + arm→confirm + banner + honest 409 line) — plus close the two chunk-01 review residuals (edit-guard MINOR-2, reason NIT-5) structurally.

**Architecture:** Daemon-only. The guard rides HTTP `MemoryHttpDeps` (daemon-internal), **not** the WS wire — `@agentic/protocol` and the mock reducer stay byte-unchanged. `WriteGate.forgetThread` / `redactMirrorThread` already exist on `main` (chunk-01, PR #110); this chunk adds callers + guards on top. Ruling 2 (no fact-side touches) is inherited structurally from chunk-01 and re-verified by the executed probe.

**Tech Stack:** TypeScript on Bun, `bun:sqlite` (synchronous single-writer, no nested transactions), `Bun.serve` WS + HTTP on `127.0.0.1:7777`, `bun test`, per-thread JSONL mirror files, a served `history.html` string (no framework/build step).

## Global Constraints (verbatim from spec + chunk — apply to every task)

- **ADR-0012 rider Ruling 2 (BINDING):** thread-forget MUST NOT touch any fact artifact. This chunk adds no fact-table reference anywhere; the probe re-proves facts survive byte-identical.
- **Frozen surfaces byte-unchanged:** `@agentic/protocol` + the mock reducer. `git diff --stat` must show **no** changes under `packages/protocol/` or the mock provider/reducer. The guard is HTTP-deps only (spec chunk `## Scope` Out).
- **ADR-0013:** thread-forget is a Bearer-gated write on `POST /memory/forget`; `HTTP_CTX = {actor:"user", authored_by:"human"}` is fixed server-side (`http-routes.ts:61`). The body widening is additive (no frozen wire).
- **ADR-0015 intent-dispatch:** reuse the existing `target_type` discriminator; mirror the fact branch's UUID discipline (`http-routes.ts:212`).
- **ADR-0014 adoption semantics:** untouched except the §3.3a `'forgotten'` exclusion.
- **`REDACTION_MARKER`** = `"[forgotten]"` (`schema.ts:36`, re-exported `write-gate.ts:8`).
- **`status='forgotten'`** is a THIRD `listThreads` value (today `active|dismissed`) — additive; every render must tolerate it (§4 item 3).
- **`isThreadLive` fail-closed:** a refcount leak = a permanently-unerasable thread (annoying, not unsafe). Test the DECREMENT.
- **Point-in-time liveness (TOCTOU accepted, stated):** no lock (§0.5).
- **Verification model (§5):** real SQLite + real daemon path. Permitted stubs ONLY = LLM `clientFactory` + `EmbeddingProvider` fixtures (and a minimal injected `AgentProvider` chat stub for the WS live-guard test — the same seam the demo harness uses). No mocked store internals.
- **Behavioral DoD** (history.html arm→confirm→erase; banner; 409 line) is **"requires runtime proof (the EXECUTED probe stdout)"** — never "verified" from code-reading (PIPELINE §6.1). The full user-facing §6.1 sign-off is chunk-03, not this chunk.

---

## Reality check

**Verification method:** every anchor was resolved against `main @ 5149995` (HEAD; chunk-01 PR #110 merged) via Read/Grep. The spec's anchors were verified `@ 6785b35` and are hypotheses; this table is authoritative.

**Code-reading disclaimer (PIPELINE §6.1):** everything below is a static-source fact ("this code path exists"). None is a runtime confirmation. The behavioral DoD (history.html erase works end-to-end; erased content truly unsearchable) **requires the EXECUTED probe stdout** (Task 3) and the chunk-03 live demo — `bun test` green is necessary evidence, not the behavioral sign-off.

| Anchor (task/spec) | Verified location @ 5149995 | Status |
|---|---|---|
| `WriteGate.forgetThread` (chunk-01 shipped) | `write-gate.ts:126-164` | ✓ exists |
| `WriteGate.forget` per-message tombstone INSERT shape | `write-gate.ts:90-92` | ✓ |
| `WriteGate.edit` (MINOR-2 target — message-id-keyed, NO status check) | `write-gate.ts:286-309`; `threadOf` at `:291`; 5e guard `:295` | ✓ exact |
| `forgetThread` tombstone INSERT threads `reason` (NIT-5 target) | `write-gate.ts:139-143` (`reason` bound at `:143`) | ✓ exact |
| `editFact` machine-refusal stance | `write-gate.ts:269` (`if (ctx.authored_by === "machine") return false;`) | ⚠ **drift** — spec/chunk-01 cited `:222`; the stance moved to `:269` (behavior intact) |
| `Hatch` class + `HatchViewResult` + `view()` | `hatch.ts:42-46`, iface `:31-40`, `view` `:56-68` | ✓ (no `forgetThread` façade yet — to add) |
| `MemoryHttpDeps` interface | `http-routes.ts:49-54` (`hatch, store, tokenStore`) | ✓ (no `isThreadLive` — to add) |
| `handleForget` (fact branch + UUID discipline) | `http-routes.ts:184-228`; `UUID_RE` `:212`; also `:255` (handleEdit) | ✓ (dup regex — hoist) |
| Header comment reserving 409 | `http-routes.ts:29-32` | ✓ exact (to update per critic m7) |
| `HTTP_CTX` fixed human ctx | `http-routes.ts:61` | ✓ exact |
| Token gate returns 401 (not 403) | `http-routes.ts:186-188` | ✓ (test header comment saying "403" is stale; code is 401) |
| `index.ts` session_start increment site | `index.ts:204-210` (`touchedThreadIds.add` at `:210`) | ✓ exact |
| `index.ts` `close(ws)` handler | `index.ts:304-342`; flush loop `:307-319`; dismiss block `:321-341` | ✓ exact |
| `index.ts` `endTurn` + `sessions.delete` | `index.ts:294` / `:295` | ✓ exact |
| `index.ts` `memoryDeps` construction | `index.ts:123` (`{ hatch, store, tokenStore }`) | ✓ exact |
| `index.ts` module-level mutable state precedent | `const sessions` `index.ts:31` | ✓ (the `liveThreads` map sits alongside) |
| `SocketData.touchedThreadIds` | `index.ts:39` | ✓ |
| `ThreadLifecycle.beginTurn` known-thread + mint branches | `thread-lifecycle.ts:70-122`; known `:72-84`; `adoptId`/`createThread` `:91-92` | ✓ exact |
| `beginTurn` never flips status on re-adoption | `thread-lifecycle.ts:72-84` | ✓ |
| `store.createThread(title?, adoptId?)` (PK collision if adoptId reused) | `store.ts:245-255` | ✓ exact |
| `store.threadExists` / `listThreads` / `readThreadArchive` | `store.ts:257` / `:1002-1006` (returns `status`) / `:893-918` | ✓ (`listThreads` already selects `status`) |
| `store.readThreadMeta` (to add — single-thread status reader) | **absent** (grep clean) | ✓ no collision |
| `store.redactMirrorThread` (chunk-01 shipped) | `store.ts:1054-1071` | ✓ exists |
| `threads` columns / `status` default + comment | `schema.ts:39-45` (`status` `:43`, comment already lists `'forgotten'`) | ✓ (chunk-01 updated comment) |
| `memory_action_events` columns | `schema.ts:166-175` | ✓ |
| history.html fact-forget arm→confirm (`doForget`) | `history-page.ts:447-514` | ✓ exact |
| history.html 5s auto-reset | `history-page.ts:485` (`setTimeout(resetForget, 5000)`); arm block `:455-485` | ⚠ **drift** — spec cited `:457-466`; the 5s timer is at `:485` |
| history.html title→id fallback | `history-page.ts:288` (`t.title || t.thread_id`) | ✓ exact |
| history.html `doForget` generic error branch (raw "Error: N") | `history-page.ts:508-511` (`setStatus("Error: " + r.status …)` `:509`) | ✓ exact (critic m8 target) |
| history.html detail-view panels (Messages/Facts/Events) | `history-page.ts:177-194`; `loadThread` `:307-322` | ✓ |
| `forget-roundtrip-probe.ts` (probe template) | `packages/daemon/scripts/forget-roundtrip-probe.ts` | ✓ exact template |
| Direct-deps `MemoryHttpDeps` construction sites (break on required new field) | `http-routes-cors.daemon.test.ts:24` (`buildDeps`); `http-routes.daemon.test.ts:249` | ✓ both must add `isThreadLive` |
| `thread-lifecycle.test.ts` `fresh()` seam | `thread-lifecycle.test.ts:15-19` (constructs store+lifecycle, plain-object session_start) | ✓ |
| `SessionStart` envelope shape (`thread_id?` optional) | `packages/protocol/src/envelope.ts:27-39` | ✓ (additive optional — no wire change) |

**Behavioral DoD status:** `requires runtime proof (the EXECUTED probe)` — NOT verified. (PIPELINE §6.1.)

**No genuine spec-vs-code contradiction found.** One spec-internal tension (banner "on `<date>`" has no source in the spec-frozen 3-field `thread` meta) is resolved in `## Approaches` under §7 architect-latitude, not escalated.

---

## Approaches (genuine forks only)

**Fork A — the `isThreadLive` registry placement.**
- **Option A1 — module-level `Map<threadId,number>` (RECOMMENDED).** Matches spec §0.5 verbatim ("index.ts maintains a module-level Map") and the shipped `const sessions` precedent (`index.ts:31`). Keys are UUIDs → no cross-`startDaemon` collision in tests; a daemon restart clears the map (fail-open on restart, which is the safe direction). Cons: shared mutable module state (mitigated by UUID keys, exactly as `sessions`).
- **Option A2 — per-`startDaemon` closure `const`.** Perfect test isolation. Cons: deviates from the spec's "module-level" wording. Since §0.5 froze the STRUCTURE (a `Map<threadId,refcount>`, inc on bind, dec on close) and explicitly says "module-level", A1 honors the freeze. **Chosen: A1**; if the worker hits test-isolation flakiness, A2 is a byte-equivalent fallback (same map, same inc/dec sites — placement only). Do not otherwise redesign.

**Fork B — the source of `hatch.view`'s additive `thread` meta.**
- **Option B1 — a dedicated `store.readThreadMeta(threadId)` single-row read (RECOMMENDED).** One indexed `SELECT` on the PK. It triples as the reader for `beginTurn` (§3.3a) and the `edit` guard (MINOR-2) — DRY, one method, three consumers.
- **Option B2 — reuse `listThreads().find()`.** Scans every thread per view. Rejected — wasteful and doesn't serve the two hot-path consumers cleanly. **Chosen: B1.**

**Fork C — MINOR-2 (dormant `edit` guard): implement vs annotate.**
- **Option C1 — implement the cheap structural close + RED-first test (RECOMMENDED).** `edit()` no-ops when its message's thread is `status='forgotten'` (mirror of §3.3a for the message-id-keyed path). A few lines, closes the class structurally so a future `edit` caller cannot re-introduce plaintext into `mutations.replacement_content` + a plaintext `edit` mirror line onto a scrubbed thread. Reachability today = NONE, so it is safe and cheap.
- **Option C2 — annotate-only (a one-line residual).** Cheaper now, but leaves the breach class open. **Chosen: C1** (the residual note explicitly recommends the structural close; it's a few lines).

**Fork D — NIT-5 (`mutations.reason` free-text): scrub vs document.**
- **Option D1 — scrub-by-constant, structural (RECOMMENDED).** (1) The HTTP route does NOT forward the body's free-text `reason` into `forgetThread`. (2) `forgetThread` persists a FIXED `THREAD_FORGET_REASON = "thread_forget"` into its tombstone `reason` column, ignoring the caller-supplied `reason`. This structurally guarantees no user content can reach the un-erasable `mutations.reason` column via any current-or-future caller. The body still ACCEPTS `reason?` (fact-path parity, no 400) — it is simply metadata-not-content and unpersisted on this path.
- **Option D2 — document-only.** Relies on caller/user discipline (the exact thing that fails). In an *erase* feature, an unenforced content leak is a bad look. **Chosen: D1.**

**Fork E — the erased-husk banner date (history.html).**
- **Option E1 — no fabricated date (RECOMMENDED).** Banner: `"You erased this conversation's content. Distilled facts remain."` Uses only `status`. §7 lists "Exact UI copy (both surfaces) + banner styling" as architect-time, so wording is my call. The spec §0.3 phrase "on `<date>`" has NO source in the spec-frozen 3-field meta (`{thread_id, status, last_active_at}`), and `last_active_at` ≠ erase time (a thread erased long after its last activity would show a wrong date) — rendering a date would be dishonest.
- **Option E2 — bump `last_active_at` to erase-time.** Makes the meta carry the date, but reorders the thread list (`listThreads ORDER BY last_active_at DESC`) — a side effect the §3.1 matrix does not authorize (`threads` row: only `status`+`title` change). Rejected.
- **Option E3 — widen the meta with a derived `forgotten_at` (max tombstone `created_at`).** Accurate, but deviates from the spec-stated 3-field meta and forces a chunk-03 overlay `types.ts` change. **Deferred to chunk-03/Lior** if the demo wants an erase-date. **Chosen: E1** for chunk-02.

## Chosen Approach (summary of new/changed signatures the tasks consume)

```ts
// store.ts (MemoryStore) — NEW
readThreadMeta(threadId: string): { thread_id: string; status: string; last_active_at: number } | null

// write-gate.ts — NEW module const + CHANGED forgetThread persist + NEW edit guard
const THREAD_FORGET_REASON = "thread_forget";       // NIT-5 (Fork D): tombstone reason is metadata-not-content
// forgetThread: tombstone INSERT binds THREAD_FORGET_REASON (not the caller's `reason`)
// edit(): early no-op when store.readThreadMeta(threadOf(id))?.status === "forgotten"  (MINOR-2, Fork C)

// hatch.ts — NEW façade + widened view
forgetThread(threadId: string, ctx: WriteContext, reason?: string): ForgetThreadResult   // thin delegate
interface HatchViewResult { …; thread: { thread_id: string; status: string; last_active_at: number } | null }

// http-routes.ts — additive dep + branch
interface MemoryHttpDeps { …; isThreadLive: (threadId: string) => boolean }
// POST /memory/forget gains: else if (target_type === "thread") → 400|409|404|204

// index.ts — module-level registry
const liveThreads = new Map<string, number>();
const isThreadLive = (id: string) => (liveThreads.get(id) ?? 0) > 0;   // passed into memoryDeps
// increment on first-add to ws.data.touchedThreadIds (session_start); decrement per touched id in close(ws)

// thread-lifecycle.ts — §3.3a
// beginTurn treats a status==='forgotten' requested id as UNKNOWN (mint fresh; never adoptId-reuse)
```

`ForgetThreadResult` (from chunk-01, `write-gate.ts:27-30`): `{ ok: true } | { ok: false; reason: "not_found" } | { ok: false; reason: "refused_machine" }`.

## ADR worthy: no

Per spec §0.6 (recorded for the §5.2 sign-off; Lior signed the §0.1–0.6 package). This chunk **executes** accepted decisions: ADR-0013 (additive body on a Bearer route), ADR-0015 (intent-dispatch reuse), ADR-0014 (adoption semantics — only the `'forgotten'` exclusion changes), ADR-0012 rider Ruling 2 (no fact-side touches). The `isThreadLive` refcount registry is the concrete *implementation* of the §0.5 guard the spec already ruled (spec §0.5: "a spec decision… recorded in the spec, not a bus fork") — new daemon-internal module state, but no new dependency, no new wire/protocol surface, and no daemon/frontend boundary change (the predicate rides HTTP deps, daemon-internal). Nothing to route to `adr-curator`.

## Flags for the orchestrator (escalate)

**None.** No spec-vs-frozen-artifact contradiction found (the §7.2 citation test). The one spec-internal tension (banner date, §0.3 "on `<date>`" vs the 3-field meta) is resolved in Approaches Fork E under §7 architect-latitude, keeping chunk-02 unblocked; chunk-03/Lior owns any erase-date widening.

---

## Steps

Three sequential tasks. Task 2 consumes Task 1's `Hatch.forgetThread` + `store.readThreadMeta`; Task 3 consumes Task 2's route. Each is independently reviewable. RED-first where a test pins new/changed behavior on existing code.

---

### Task 1: daemon-internal seam — `readThreadMeta`, the two residual guards (MINOR-2 + NIT-5), the §3.3a adoption exclusion, and the `Hatch.forgetThread` façade + view widening

**Files:**
- Modify: `packages/daemon/src/memory/store.ts` (add `readThreadMeta`)
- Modify: `packages/daemon/src/memory/write-gate.ts` (edit-guard `:286-309`; `THREAD_FORGET_REASON` const + tombstone bind `:143`)
- Modify: `packages/daemon/src/memory/thread-lifecycle.ts` (`beginTurn` `:70-92` — §3.3a)
- Modify: `packages/daemon/src/memory/hatch.ts` (`forgetThread` façade; `HatchViewResult.thread` + `view` `:56-68`)
- Test: `packages/daemon/src/memory/write-gate.test.ts` (edit-guard RED, reason-constant RED)
- Test: `packages/daemon/src/memory/thread-lifecycle.test.ts` (adoption-exclusion RED)
- Test: `packages/daemon/src/memory/hatch.daemon.test.ts` (façade + `view.thread` meta)

**Interfaces:**
- Consumes: `store.rawDb`, `store.createThread` (`:245`), `store.threadExists` (`:257`), `store.appendMessages`, `WriteGate.forgetThread` (`:126`), `WriteGate.edit` (`:286`), `WriteGate.threadOf` (`:333`), `ForgetThreadResult` (`write-gate.ts:27`), `WriteContext`.
- Produces: `store.readThreadMeta`, `Hatch.forgetThread`, `HatchViewResult.thread`. Task 2 consumes `Hatch.forgetThread`; `readThreadMeta` is consumed here by `beginTurn` + `edit`.

- [ ] **Step 1.1: Write the edit-guard RED test (MINOR-2).** Append to `write-gate.test.ts` (reuse its `fresh()` + `CTX` + `readFileSync`/`join` helpers as the existing suite does).

```ts
test("edit() no-ops on a message of a status='forgotten' thread (MINOR-2 — no plaintext re-flush)", () => {
  const { store, gate, dir } = fresh();
  const t = store.createThread();
  const [m1] = gate.appendTurn(t, [{ role: "user", content: "original secret" }], "s1", CTX);
  gate.forgetThread(t, CTX);                         // thread now terminal ('forgotten'); m1 scrubbed
  // Attempt to re-introduce plaintext via the message-id-keyed edit path:
  gate.edit(m1!, "sneaky reintroduced plaintext", CTX, "reopen attempt");
  const db = store.rawDb();
  // NO new correction row carrying the plaintext was written:
  const corr = db.query(
    "SELECT COUNT(*) AS n FROM mutations WHERE kind='correction' AND target_message_id=? AND replacement_content=?",
  ).get(m1!, "sneaky reintroduced plaintext") as { n: number };
  expect(corr.n).toBe(0);
  // The archive read still returns the redaction marker (nothing resurfaced):
  const arch = store.readThreadArchive(t);
  expect(arch.every((r) => r.content === REDACTION_MARKER)).toBe(true);
  // The mirror holds no reintroduced plaintext:
  const mirror = readFileSync(join(dir, "threads", `${t}.jsonl`), "utf8");
  expect(mirror).not.toContain("sneaky reintroduced plaintext");
  store.close();
});
```

- [ ] **Step 1.2: Write the reason-scrub RED test (NIT-5).** Append to `write-gate.test.ts`.

```ts
test("forgetThread persists a fixed tombstone reason — a content-quoting reason never lands in mutations.reason (NIT-5)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "x" }], "s1", CTX);
  gate.forgetThread(t, CTX, "erase the part where I said my SSN is 123-45-6789");
  const db = store.rawDb();
  const reasons = db.query(
    "SELECT DISTINCT reason FROM mutations WHERE kind='tombstone' AND target_message_id IN (SELECT id FROM messages WHERE thread_id=?)",
  ).all(t) as { reason: string | null }[];
  // The free-text (content-quoting) reason is NOT persisted; a fixed constant is used instead.
  expect(reasons.every((r) => r.reason === "thread_forget")).toBe(true);
  expect(reasons.some((r) => (r.reason ?? "").includes("SSN"))).toBe(false);
  store.close();
});
```

- [ ] **Step 1.3: Write the §3.3a adoption-exclusion RED test.** Append to `thread-lifecycle.test.ts`. `fresh()` there returns `{store, lifecycle}` without a gate — construct a gate inline for the forget.

```ts
test("§3.3a: session_start with a status='forgotten' id mints a FRESH thread; the husk is byte-untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mf01-tl-2e-"));
  const store = new MemoryStore({ dataDir: dir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const lifecycle = new ThreadLifecycle(store, gate);
  // Seed + erase a thread → a 'forgotten' husk with a real UUID id
  const t = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hello" });
  lifecycle.endTurn(t.threadId, "sess-a", [{ role: "user", content: "hello" }]);
  expect(gate.forgetThread(t.threadId, { actor: "user", authored_by: "human" })).toEqual({ ok: true });
  const db = store.rawDb();
  const huskBefore = JSON.stringify(
    db.query("SELECT status, title, last_active_at FROM threads WHERE thread_id=?").get(t.threadId),
  );
  // Re-summon with the erased id → must NOT adopt the husk; must mint a fresh distinct id
  const again = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "again", thread_id: t.threadId });
  expect(again.threadId).not.toBe(t.threadId);            // RED on current code: it adopts the husk (===)
  expect(store.threadExists(again.threadId)).toBe(true);  // a genuinely new thread exists
  // Husk unchanged (status still forgotten, no new messages appended to it)
  expect(JSON.stringify(db.query("SELECT status, title, last_active_at FROM threads WHERE thread_id=?").get(t.threadId))).toBe(huskBefore);
  expect((db.query("SELECT COUNT(*) AS n FROM messages WHERE thread_id=? AND content!=?").get(t.threadId, REDACTION_MARKER) as { n: number }).n).toBe(0);
  store.close();
});
```
*Worker note:* add the imports `MemoryStore`, `WriteGate`, `RuleBasedScanner`, `mkdtempSync`, `tmpdir`, `join`, `REDACTION_MARKER` to `thread-lifecycle.test.ts` if not already present (mirror `write-gate.test.ts` imports).

- [ ] **Step 1.4: Run the three RED tests — verify they FAIL on current code (RED evidence for the PR).**
  Run: `cd packages/daemon && bun test src/memory/write-gate.test.ts src/memory/thread-lifecycle.test.ts`
  Expected: edit-guard test FAILS (a correction row with the plaintext IS written today); reason-scrub test FAILS (chunk-01 binds the passed `reason` at `write-gate.ts:143`); adoption test FAILS (`again.threadId === t.threadId` — current `beginTurn` adopts the husk). Capture output for the PR.

- [ ] **Step 1.5: Add `store.readThreadMeta` (Fork B1).** In `store.ts`, add next to `listThreads` (after `:1006`):

```ts
/**
 * Single-thread meta read (thread-forget 2e §3.3): status + last_active_at for ONE thread,
 * or null if absent. PK lookup — cheap. Consumed by Hatch.view (erased-husk banner render),
 * ThreadLifecycle.beginTurn (§3.3a erased-id exclusion), and WriteGate.edit (the forgotten-
 * thread write guard, chunk-01 review MINOR-2).
 */
readThreadMeta(threadId: string): { thread_id: string; status: string; last_active_at: number } | null {
  return this.db
    .query("SELECT thread_id, status, last_active_at FROM threads WHERE thread_id = ?")
    .get(threadId) as { thread_id: string; status: string; last_active_at: number } | null;
}
```
*Worker note:* `bun:sqlite` `.get()` returns the row or `null` for no match — confirm against a neighboring `.get()` usage (e.g. `threadExists` at `:258`).

- [ ] **Step 1.6: Implement the MINOR-2 edit-guard.** In `write-gate.ts` `edit()`, immediately after `const threadId = this.threadOf(messageId);` (`:291`), insert:

```ts
// thread-forget 2e (chunk-01 review MINOR-2): 'forgotten' is terminal. edit() is message-id-keyed —
// the §3.3a adoption exclusion and the §0.5 live-guard are thread-adoption-keyed and do NOT cover
// this path. Without this, a future edit() caller could re-introduce plaintext into
// mutations.replacement_content AND append a plaintext `edit` mirror line onto a just-scrubbed thread.
// No-op on a forgotten thread — the same by-construction close §3.3a uses for appendTurn.
// (Reachability today = NONE: edit lost its production caller at the 2d message-edit removal.)
if (this.store.readThreadMeta(threadId)?.status === "forgotten") return;
```

- [ ] **Step 1.7: Implement the NIT-5 reason-constant.** In `write-gate.ts`, add a module const near the top (after `export { REDACTION_MARKER };` at `:8`):

```ts
/** thread-forget 2e (NIT-5): tombstone reason is metadata-not-content. mutations.reason is OUTSIDE
 *  the erase matrix (survives un-scrubbed), so forgetThread persists a FIXED constant regardless of
 *  the caller-supplied `reason` — no user free-text can ever reach that un-erasable column. */
const THREAD_FORGET_REASON = "thread_forget";
```
Then in `forgetThread`, change the tombstone INSERT bind at `:143` from `reason ?? null` to `THREAD_FORGET_REASON`, and mark the now-unpersisted param: add `// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `reason` kept for API symmetry with forget/forgetFact; intentionally NOT persisted (NIT-5)` directly above the `forgetThread(` signature line (`:126`), mirroring the pattern at `forgetFact` `:183` / `forgetFactById` `:211`.
  *Worker note:* first `grep -n "mutations.*reason\|\.reason" src/memory/write-gate.test.ts` in the shipped `forgetThread` suite — confirm no existing test asserts the tombstone `reason` equals a passed string (the chunk-01 completeness test asserts content/count/husk, not `reason`). If one exists, reconcile it to expect `"thread_forget"`.

- [ ] **Step 1.8: Implement the §3.3a exclusion.** In `thread-lifecycle.ts` `beginTurn`, replace the `requested`/known-thread guard + `adoptId` logic (`:71-92`) with:

```ts
const requested = inbound.thread_id;
// thread-forget 2e §3.3a: a status='forgotten' thread id is terminal — NOT adoptable and NOT
// reusable. Treat it as UNKNOWN (fall through to mint) AND never pass it as adoptId (that
// createThread INSERT would collide with the surviving husk PK). Both the known-thread and
// adoptId branches gain the exclusion (spec §4 item 7). One PK read serves both.
const requestedMeta = requested ? this.store.readThreadMeta(requested) : null;
const requestedForgotten = requestedMeta?.status === "forgotten";
if (requested && requestedMeta && !requestedForgotten) {
  // … existing known-thread adopt body UNCHANGED (:73-83) …
}
// … existing whenIdle / retrieve block UNCHANGED …
const adoptId = requested && isUuidShaped(requested) && !requestedForgotten ? requested : undefined;
const newThreadId = this.store.createThread(undefined, adoptId);
```
*Worker note:* `requestedMeta` truthy ⟺ the thread exists, so it replaces the `this.store.threadExists(requested)` check in the known-thread guard (one query instead of two). Leave the whenIdle/retrieve/return bodies byte-unchanged.

- [ ] **Step 1.9: Add the `Hatch.forgetThread` façade + `view` widening.** In `hatch.ts`: add `ForgetThreadResult` to the `write-gate.js` type import (`:29`); add the `thread` field to `HatchViewResult` (`:31-40`):

```ts
/** thread-forget 2e §3.3: additive thread meta — `status` drives the erased-husk banner render.
 *  null iff the id resolves to no thread. Optional-tolerant: history.html/overlay ignore it if
 *  absent (runtime-coupling §4 item 4). */
thread: { thread_id: string; status: string; last_active_at: number } | null;
```
In `view()` (`:56-68`), add `const thread = this.store.readThreadMeta(threadId);` and return it: `return { messages, distilledFacts, distillationEvents, memoryActionEvents, thread };`. Add the façade after `forgetFactById` (`:102`):

```ts
/**
 * Forget a whole conversation's CONTENT (thread-forget 2e, spec §3.3). Thin façade over
 * WriteGate.forgetThread — one atomic scrub tx, ZERO fact-table touches (ADR-0012 rider Ruling 2).
 * Returns the typed result the route maps: {ok:true}→204, not_found→404, refused_machine→
 * (unreachable on the human-only HTTP path). The free-text `reason` is accepted for API symmetry
 * but not persisted as content (WriteGate uses a fixed tombstone reason — NIT-5).
 */
forgetThread(threadId: string, ctx: WriteContext, reason?: string): ForgetThreadResult {
  return this.gate.forgetThread(threadId, ctx, reason);
}
```

- [ ] **Step 1.10: Write the façade + view-meta test.** Append to `hatch.daemon.test.ts` (mirror its real store/gate/hatch construction):

```ts
test("Hatch.view carries additive thread meta; Hatch.forgetThread flips status to 'forgotten'", async () => {
  // build a real store+gate+hatch on a fresh dataDir (mirror the file's existing setup)
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "hi" }], "s1", { actor: "user", authored_by: "human" });
  const before = await hatch.view(t);
  expect(before.thread).toEqual({ thread_id: t, status: "active", last_active_at: expect.any(Number) });
  expect(before.thread!.status).toBe("active");            // existing fields untouched (regression)
  expect(Array.isArray(before.distilledFacts)).toBe(true);
  expect(hatch.forgetThread(t, { actor: "user", authored_by: "human" })).toEqual({ ok: true });
  const after = await hatch.view(t);
  expect(after.thread!.status).toBe("forgotten");
  expect(after.messages.every((m) => m.content === REDACTION_MARKER)).toBe(true);
});
```

- [ ] **Step 1.11: Run Task-1 tests — verify GREEN.**
  Run: `cd packages/daemon && bun test src/memory/write-gate.test.ts src/memory/thread-lifecycle.test.ts src/memory/hatch.daemon.test.ts`
  Expected: PASS (the three RED tests now green; façade/view/edit-guard/adoption all pass). Then `cd packages/daemon && bun test src/memory/` to confirm no collateral regression (esp. existing `beginTurn` adoption tests at `thread-lifecycle.test.ts:35-49` still pass — a non-forgotten unknown/UUID id still adopts/mints as before).

- [ ] **Step 1.12: Commit** (branch `chunk/02-daemon-surface`).

---

### Task 2: the HTTP surface + the `isThreadLive` refcount registry (§0.5)

**Files:**
- Modify: `packages/daemon/src/memory/http-routes.ts` (`MemoryHttpDeps.isThreadLive`; hoist `UUID_RE`; `target_type:"thread"` branch; header comment `:29-32`)
- Modify: `packages/daemon/src/index.ts` (module-level `liveThreads`; `isThreadLive`; increment `:210`; decrement in `close` `:307-319`+; `memoryDeps` `:123`)
- Modify: `packages/daemon/src/memory/http-routes-cors.daemon.test.ts` (`buildDeps` add `isThreadLive`)
- Modify: `packages/daemon/src/memory/http-routes.daemon.test.ts` (direct-deps `:249` add `isThreadLive`)
- Test (new): `packages/daemon/src/memory/thread-forget.daemon.test.ts` (full taxonomy + 409 direct-deps + live-guard both sides + decrement-proven + view meta over HTTP)

**Interfaces:**
- Consumes: `Hatch.forgetThread` + `HatchViewResult.thread` (Task 1), `HTTP_CTX` (`:61`), `TokenStore.verify`, `store.createThread`/`appendMessages`, `startDaemon`.
- Produces: `MemoryHttpDeps.isThreadLive`; the `target_type:"thread"` route; `liveThreads` registry. Task 3's history.html + probe consume the route.

- [ ] **Step 2.1: Write the full HTTP taxonomy test file (RED — the thread branch does not exist).** Create `thread-forget.daemon.test.ts`. Mirror `http-routes.daemon.test.ts`'s boot idiom (pre-seed store, `startDaemon(0)`, `EMBEDDING_PROVIDER=none`, `LLM_PROVIDER=mock`). Cover:

```ts
// ── direct-deps taxonomy (real store/hatch/tokenStore; isThreadLive faked) ──
// 409: fake isThreadLive → true
test("POST /memory/forget target_type:thread on a LIVE thread → 409 {error:'thread_live'}", async () => {
  const { deps, token, threadId } = buildDepsWithSeededThread({ isThreadLive: () => true });
  const req = new Request("http://127.0.0.1:7777/memory/forget", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_type: "thread", thread_id: threadId }),
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(409);
  expect((await res.json() as { error: string }).error).toBe("thread_live");
});
// 400 non-UUID thread_id; 400 missing thread_id; 400 target_type:"message"/garbage (unchanged)
// 404 unknown UUID-shaped thread_id (isThreadLive:()=>false)
// 401 no token
// 204 applied + 204 idempotent repeat (second POST on the same erased thread)
```
Provide a `buildDepsWithSeededThread({ isThreadLive })` helper (mirror `http-routes-cors.daemon.test.ts:18-25`) returning `{ deps, token, threadId }` with a real `MemoryStore`/`WriteGate`/`Hatch`/`TokenStore` and a pre-seeded active thread + one message. For the 204/idempotent cases pass `isThreadLive: () => false`.
*Worker note:* the 400-non-UUID / message / garbage / missing-field assertions pin that the existing fact/message/garbage behavior is unchanged. Use `token = tokenStore.token()` (as the cors test does).

- [ ] **Step 2.2: Write the live-guard both-sides + decrement WS integration test (RED).** In the same file, boot a real daemon with an injected minimal chat stub (single-turn, no picker round-trip) so the WS turn is deterministic:

```ts
function liveGuardStub(): AgentProvider {
  return {
    id: "thread-forget-liveguard-stub",
    async advance(state, inbound) {
      if (inbound.type === "session_start") {
        const session_id = crypto.randomUUID(), call_id = crypto.randomUUID();
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

test("live-guard both sides: open socket → 409; close (decrement) → same thread erases 204", async () => {
  // pre-seed an ACTIVE thread in the shared dataDir, then startDaemon(0, liveGuardStub())
  const forget = () => fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_type: "thread", thread_id: seededThreadId }),
  });
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: "tauri://localhost" }, protocols: [token] });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => ws.send(JSON.stringify({
      type: "session_start", trigger: "user", text: "live", client_session_id: crypto.randomUUID(), thread_id: seededThreadId,
    })));
    ws.addEventListener("message", (e: MessageEvent) => {
      if (JSON.parse(e.data as string).type === "session_end") resolve();   // increment landed before advance ran
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
  });
  // socket still OPEN → thread live → 409
  expect((await forget()).status).toBe(409);
  // close → decrement (+dismiss); wait a tick for the async close handler
  await new Promise<void>((r) => { ws.addEventListener("close", () => r()); ws.close(); });
  await new Promise((r) => setTimeout(r, 150));
  // decrement proven: the SAME thread now erases cleanly → 204
  expect((await forget()).status).toBe(204);
  // idempotent repeat still 204
  expect((await forget()).status).toBe(204);
});
```
Also add a **view-meta over HTTP** assertion after erase: `GET /memory/thread/:id` → `body.thread.status === "forgotten"` and every `body.messages[].content === "[forgotten]"`.
*Worker note:* import `AgentProvider` from `../providers/provider.js`. Receiving `session_end` guarantees the `session_start` increment landed (increment is at `index.ts:210`, before `advance()` at `:274`). If Bun's `WebSocket` options differ, mirror the memory-demo-harness `wsTurn` call shape (`packages/daemon/scripts/memory-demo-harness.ts:581`).

- [ ] **Step 2.3: Run the taxonomy + live-guard tests — verify FAIL (branch/dep absent).**
  Run: `cd packages/daemon && bun test src/memory/thread-forget.daemon.test.ts`
  Expected: FAIL — the `target_type:"thread"` body currently hits the final `else` → 400 (so 409/404/204 assertions fail); and `MemoryHttpDeps` has no `isThreadLive` (typecheck error in `buildDepsWithSeededThread`). This is the RED gate.

- [ ] **Step 2.4: Add `isThreadLive` to `MemoryHttpDeps` + hoist `UUID_RE` + update the header comment.** In `http-routes.ts`:
  - Extend the interface (`:49-54`): add `` /** thread-forget 2e §0.5: point-in-time liveness (TOCTOU accepted). A refcount>0 means ≥1 socket has this thread adopted; erasing a live thread is refused 409. */ isThreadLive: (threadId: string) => boolean; ``
  - Hoist the UUID regex to module scope (it is duplicated at `:212` and `:255`): add near the top `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;` and delete both local `const UUID_RE = …` declarations, referencing the module const.
  - Update the header comment `:29-32` to: `` /** * 409 has TWO distinct conditions, differentiated by the `error` body [critic m7]: * (1) thread_live (thread-forget 2e §0.5) — the route refuses to content-erase a currently- * live conversation ({error:"thread_live"}). This is the FIRST real 409 case. * (2) a RESERVED future non-human-actor 5e refusal (never reached on today's human-only HTTP * path; HTTP_CTX is fixed human). If introduced, it carries a DIFFERENT `error` code. */ ``

- [ ] **Step 2.5: Add the `target_type:"thread"` branch.** In `handleForget`, add `thread_id` to the destructure (`:194`) and insert this branch before the final `else` (`:221`):

```ts
} else if (target_type === "thread") {
  // thread-forget 2e (spec §3.3): additive branch — mirrors the fact branch's UUID discipline.
  if (typeof thread_id !== "string" || !thread_id || !UUID_RE.test(thread_id)) {
    return Response.json({ error: "bad_body" }, { status: 400 });
  }
  // §0.5 live-guard: refuse to content-erase a currently-live conversation (its append/flush legs
  // would silently re-acquire plaintext after the erase). thread_live is a DISTINCT 409 from the
  // reserved future 5e-actor refusal — differentiated by the `error` body [critic m7].
  if (deps.isThreadLive(thread_id)) {
    return Response.json({ error: "thread_live" }, { status: 409 });
  }
  // NIT-5: the body's free-text `reason` is intentionally NOT forwarded — it would land un-erasable
  // in mutations.reason. forgetThread persists a fixed tombstone reason; `reason` stays metadata.
  const result = deps.hatch.forgetThread(thread_id, HTTP_CTX);
  if (result.ok) return new Response(null, { status: 204 });               // applied AND idempotent repeat
  if (result.reason === "not_found") return Response.json({ error: "target_not_found" }, { status: 404 });
  // refused_machine is unreachable on the human-only HTTP path (HTTP_CTX); map defensively.
  return Response.json({ error: "internal" }, { status: 500 });
}
```
*Worker note:* `reasonStr` (`:196`) is now unused only if the fact branch stops referencing it — it does not, so leave it. `deps.hatch.forgetThread` is never-throw for caller-input; internal faults still throw → caught by the surrounding `try/catch` → `mapWriteError` → 500.

- [ ] **Step 2.6: Wire the `liveThreads` registry in `index.ts` (Fork A1).**
  - Add module-level after `const sessions` (`:31`): `` /** thread-forget 2e §0.5 [critic MAJOR-1]: module-level refcount registry (matches `sessions`). * refcount because two sockets can adopt one thread. inc on first session_start-bind, dec per * touched id on close. isThreadLive rides MemoryHttpDeps (daemon-internal — NOT the wire). */ const liveThreads = new Map<string, number>(); ``
  - Inside `startDaemon`, before `const memoryDeps` (`:123`): `const isThreadLive = (id: string): boolean => (liveThreads.get(id) ?? 0) > 0;` and change `:123` to `const memoryDeps = { hatch, store, tokenStore, isThreadLive };`.
  - **Increment site** — replace `:210` (`if (turnThreadId) (ws.data.touchedThreadIds ??= new Set<string>()).add(turnThreadId);`) with:

```ts
if (turnThreadId) {
  const touched = (ws.data.touchedThreadIds ??= new Set<string>());
  // Increment ONLY on FIRST bind of this thread by this socket (Set dedupes; guard prevents a
  // same-socket double-count). Refcount because two sockets can adopt one thread (§0.5).
  if (!touched.has(turnThreadId)) {
    touched.add(turnThreadId);
    liveThreads.set(turnThreadId, (liveThreads.get(turnThreadId) ?? 0) + 1);
  }
}
```
  - **Decrement site** — in `close(ws)`, immediately AFTER the sessionIds flush loop (`:319`) and BEFORE the CM-03 dismiss block (`:321`):

```ts
// §0.5 live-registry decrement — release EVERY thread this socket incremented. Fail-closed: a
// missed decrement = a permanently-unerasable thread (annoying, not unsafe; §4 item 6), so this
// runs unconditionally, independent of the dismiss batch below. Symmetric with the inc guard
// (one inc per touched id ⇒ one dec per touched id). Module map is UUID-keyed → daemon-instance
// safe (like `sessions`); a daemon restart clears it (fail-open on restart).
for (const id of ws.data.touchedThreadIds ?? []) {
  const n = (liveThreads.get(id) ?? 0) - 1;
  if (n <= 0) liveThreads.delete(id);
  else liveThreads.set(id, n);
}
```

- [ ] **Step 2.7: Update the two direct-deps `MemoryHttpDeps` construction sites (typecheck fix).**
  - `http-routes-cors.daemon.test.ts:24`: change to `return { deps: { hatch, store, tokenStore, isThreadLive: () => false }, token: tokenStore.token() };`
  - `http-routes.daemon.test.ts:249`: change to `const deps = { hatch, store, tokenStore, isThreadLive: () => false };`

- [ ] **Step 2.8: Run Task-2 tests — verify GREEN.**
  Run: `cd packages/daemon && bun test src/memory/thread-forget.daemon.test.ts src/memory/http-routes.daemon.test.ts src/memory/http-routes-cors.daemon.test.ts`
  Expected: PASS (taxonomy 400/404/409/204/idempotent; live-guard both sides; decrement proven; view meta over HTTP; the two direct-deps files still green). Then `cd packages/daemon && bun test src/memory/` for no collateral regression.

- [ ] **Step 2.9: Commit** (branch `chunk/02-daemon-surface`).

---

### Task 3: history.html fallback + the EXECUTED probe (Strike-5) + full-gate verification

**Files:**
- Modify: `packages/daemon/src/memory/history-page.ts` (thread-forget button + arm→confirm frozen §0.2 copy + erased banner + 409 line + CSS)
- Create: `packages/daemon/scripts/thread-forget-probe.ts` (executed Strike-5 probe)
- Test: `packages/daemon/src/memory/history-page.test.ts` (frozen-copy + branch string guards — create if absent, else extend the existing `SANITIZE_TOKEN_FN` test file)

**Interfaces:**
- Consumes: the `target_type:"thread"` route (Task 2), `HatchViewResult.thread` (Task 1), `startDaemon`, `store.createThread`/`appendMessages`/`insertFact`, `HybridRanker`.
- Produces: history.html thread-forget UX; the probe stdout (behavioral runtime proof).

- [ ] **Step 3.1: Add the erased-banner CSS + detail-view containers.** In `history-page.ts` `<style>`, add:

```css
.erased-banner { padding: 10px 12px; margin-bottom: 10px; background: #fff8f0; border: 1px solid #f0c8a0; border-radius: 6px; color: #a05000; font-size: 13px; }
```
In the Messages panel section-head (`:181`), change to `<div class="section-head"><h2>Messages</h2><span id="thread-forget-control"></span></div>` and add `<div id="erased-banner"></div>` directly above `<div id="messages-container">…`.

- [ ] **Step 3.2: Parametrize `doForget` for the frozen thread-forget copy + add the 409 line.** In `history-page.ts`:
  - Extend the `doForget` signature to `doForget(bodyObj, threadId, forgetBtn, originalLabel, armedLabel, confirmHint)`; default `armedLabel = "Confirm forget?"` and `confirmHint = "Cannot be undone"`. Use `armedLabel` at the arm step (`:457`, replacing the literal `"Confirm forget?"`) and `confirmHint` for the hint text (`:466`, replacing the literal `"Cannot be undone"`). The existing fact-forget call site (`:389-392`) is UNCHANGED (relies on defaults).
  - In the `executeForget` fetch `.then` (`:502-512`), insert a 409 branch before the generic `else`:

```js
} else if (r.status === 409) {
  setStatus("This conversation is open — close it first.", false);   // [critic m8] honest, not raw "Error: 409"
  resetForget();
} else {
  setStatus("Error: " + r.status, false);
  resetForget();
}
```

- [ ] **Step 3.3: Render the thread-forget control + banner from the widened view.** In `history-page.ts` `loadThread`'s `.then` (`:310-314`), add `renderThreadControls(data.thread, threadId, (data.messages || []).length);` and define:

```js
function renderThreadControls(thread, threadId, messageCount) {
  var control = document.getElementById("thread-forget-control");
  var banner = document.getElementById("erased-banner");
  clearChildren(control); clearChildren(banner);
  if (thread && thread.status === "forgotten") {
    // Erased husk (terminal): banner, no forget button. §7 architect-latitude on copy (Fork E1 — no
    // fabricated date; the frozen 3-field meta carries no erase timestamp).
    var b = document.createElement("div");
    b.className = "erased-banner";
    b.textContent = "You erased this conversation's content. Distilled facts remain.";
    banner.appendChild(b);
    return;
  }
  // Live/active/dismissed thread → the destructive control (deliberate-destruction UX: it lives in
  // the detail view where the user sees what they will erase — §0.1).
  var btn = document.createElement("button");
  btn.className = "btn btn-forget";
  btn.textContent = "Forget conversation";
  // FROZEN §0.2 copy [q#019 rider 3] — verbatim, with the REAL message count at confirm time.
  var confirmHint = "Erase this conversation's content (" + messageCount + " messages)? Distilled facts remain. Cannot be undone.";
  btn.addEventListener("click", function () {
    doForget({ target_type: "thread", thread_id: threadId }, threadId, btn, "Forget conversation", "Confirm erase?", confirmHint);
  });
  control.appendChild(btn);
}
```
*Worker note:* the frozen copy is a user-facing contract — do NOT pluralize "messages" (verbatim). The 204 handler already calls `loadThread(threadId)`, so post-erase the banner + husk render via re-fetch (the house no-optimistic-mutation pattern).

- [ ] **Step 3.4: Add the frozen-copy + branch string-guard test.** In `history-page.test.ts` (create if only `SANITIZE_TOKEN_FN` is tested today; import `HISTORY_HTML`):

```ts
test("HISTORY_HTML pins the FROZEN §0.2 confirm copy template (q#019 rider 3)", () => {
  expect(HISTORY_HTML).toContain(`"Erase this conversation's content (" + messageCount + " messages)? Distilled facts remain. Cannot be undone."`);
});
test("HISTORY_HTML sends target_type:'thread' and renders an honest 409 line", () => {
  expect(HISTORY_HTML).toContain(`target_type: "thread"`);
  expect(HISTORY_HTML).toContain("This conversation is open — close it first.");
});
```

- [ ] **Step 3.5: Write the EXECUTED probe (Strike-5).** Create `packages/daemon/scripts/thread-forget-probe.ts`, modeled on `forget-roundtrip-probe.ts`. It proves the `history.html/HTTP → Hatch → WriteGate` erase on a FRESH store, deterministic (no LLM/embedding model; `EMBEDDING_PROVIDER=none`):

```
Banner: "thread-forget-probe — Strike-5 EXECUTED evidence (thread-forget 2e, chunk-02)".
1. process.env.AGENTIC_DATA_DIR = mkdtempSync; LLM_PROVIDER=mock; EMBEDDING_PROVIDER=none.
2. Pre-seed via a fresh MemoryStore BEFORE boot:
   - threadId = createThread("probe-thread")
   - appendMessages(threadId, [{user:"secret one"},{assistant:"secret two"}], "probe-session")   // writes message_fts too
   - factId = insertFact({ fact:"user's name is Lior", canonical:"name lior", provenance:`thread:${threadId}`,
       scope:"cross-thread", expiry:null, confidence:1, authored_by:"machine", topics:["identity"] }, "probe")
   - Snapshot: factsBefore = JSON of SELECT id,fact,authored_by,provenance FROM distilled_facts ORDER BY id.
   - Log: message_fts count for thread, distilled_facts count. close().
3. startDaemon(0); read auth-token from disk.
4. POST /memory/forget {target_type:"thread", thread_id: threadId} with Bearer → assert 204 (print status).
   POST again → assert 204 (idempotent).
5. Reopen a fresh MemoryStore + assert (print each line):
   - messages scrubbed:  every messages.content === "[forgotten]"                       → "messages scrubbed: true"
   - facts intact:       JSON of distilled_facts === factsBefore (byte-identical)        → "facts intact (byte-identical): true"
   - archive-search MISS: COUNT(message_fts WHERE message_id IN thread) === 0 AND
                          COUNT(message_embeddings … ) === 0                              → "archive leg empty (fts+vec): true"
   - fact-leg HIT:       new HybridRanker(store, null).searchFacts("Lior name") surfaces factId  → "fact leg still surfaces the fact: true"
   - husk:               threads.status === "forgotten" AND title IS NULL                 → "husk (forgotten, title NULL): true"
   - mirror clean:       read threads/<id>.jsonl → NOT contains "secret one"/"secret two"; contains "[forgotten]" and "thread_forget"  → "mirror holds no plaintext: true"
6. GET /memory/thread/:id (Bearer) → assert body.thread.status === "forgotten" AND every message === "[forgotten]"
   AND body.distilledFacts still contains the fact                                       → "HTTP surface honest (husk status + fact survives): true"
7. On any failure: console.error + process.exit(1). On success: "PROBE PASSED" banner + process.exit(0).
   Register process.on("exit") cleanup (rmSync tmpDir), exactly like forget-roundtrip-probe.ts.
```
*Worker note:* the row-count + `HybridRanker(store,null).searchFacts` assertions are the deterministic structural proof of the archive-miss/fact-hit asymmetry (§3.6). The FULL live search-leg behavioral proof (`memory_search` over WS with a real LLM) is the chunk-03 §6.1 demo item 4, NOT this probe. `insertFact`/`HybridRanker` signatures: see `forget-roundtrip-probe.ts:93-105` and `memory-demo-harness.ts:460`.

- [ ] **Step 3.6: RUN the probe — capture stdout for the PR (Strike-5; NOT type-check only).**
  Run: `bun run packages/daemon/scripts/thread-forget-probe.ts`
  Expected: `PROBE PASSED` + all six proof lines `true`, exit 0. **Paste the full stdout into the PR body** — this is the runtime proof for the behavioral DoD. (If it fails, apply `superpowers:systematic-debugging`; do not weaken assertions.)

- [ ] **Step 3.7: Full-gate verification.**
  Run (repo root): `bun test` · `bun run lint:strict` · the project typecheck command · `git diff --stat`
  Expected: all tests green; `lint:strict` 0 errors; typecheck clean. **`git diff --stat` shows NO changes under `packages/protocol/` or the mock provider/reducer** (frozen surfaces byte-unchanged). Confirm the probe stdout from Step 3.6 is in the PR body.

- [ ] **Step 3.8: Commit + open the PR** (branch `chunk/02-daemon-surface` → `main`). PR body: the seven chunk `## Done criteria` checkboxes with command evidence + the probe stdout + the three RED-first captures (Step 1.4, Step 2.3). Auto-merge only on the all-green gate set.

---

## Self-review (spec coverage)

| Spec decision | Task covering it |
|---|---|
| §3.3 HTTP `target_type:"thread"` branch + 400/404/409/204 + idempotent | Task 2 (Steps 2.4–2.5, tests 2.1) |
| §3.3 `Hatch.forgetThread` façade | Task 1 (Step 1.9) |
| §3.3 `hatch.view` additive `thread:{thread_id,status,last_active_at}` meta | Task 1 (Step 1.9–1.10); over HTTP in Task 2 (Step 2.2) |
| §3.3 header comment: `thread_live` distinct 409 [critic m7] | Task 2 (Step 2.4) |
| §0.5 live-registry `Map<threadId,refcount>` + inc/dec sites + `isThreadLive` dep + TOCTOU-accepted | Task 2 (Step 2.6); decrement proven test 2.2 |
| §3.3a erased-id NOT adoptable/reusable (both branches) | Task 1 (Step 1.8, RED test 1.3) |
| §0.1/§3.5 history.html button + arm→confirm + FROZEN §0.2 copy w/ real N | Task 3 (Steps 3.1–3.4) |
| §0.3/§3.5 erased-husk banner (history.html; no content leak — neutral label, no date per Fork E1) | Task 3 (Step 3.3) |
| §3.5 history.html honest 409 line [critic m8] | Task 3 (Step 3.2) |
| §4 item 3 `status='forgotten'` third value tolerated by renders | Task 3 (Step 3.3 husk branch); Task 1 view meta |
| §4 item 4 `HatchView` widening optional-tolerant | Task 1 (Step 1.9, nullable field) |
| §4 item 6 `isThreadLive` refcount discipline + fail-closed decrement | Task 2 (Step 2.6, test 2.2) |
| §4 item 7 `beginTurn` status check ↔ adoption | Task 1 (Step 1.8) |
| chunk-01 residual MINOR-2 (dormant `edit` guard) — Fork C1 structural close | Task 1 (Step 1.6, RED test 1.1) |
| chunk-01 residual NIT-5 (`mutations.reason` free-text) — Fork D1 scrub-by-constant | Task 1 (Step 1.7, RED test 1.2) + route drops free-text (Step 2.5) |
| §5 HTTP taxonomy incl. 409 (fake `isThreadLive`) + idempotent + message/garbage still 400 | Task 2 (test 2.1) |
| §5 live-guard both sides + decrement-on-close proven | Task 2 (test 2.2) |
| §5 adoption exclusion (fresh id; husk untouched) | Task 1 (test 1.3) |
| §5 EXECUTED probe (messages scrubbed · facts intact · archive miss + fact hit · mirror clean) | Task 3 (Steps 3.5–3.6) |
| §5 frozen byte-diff empty (protocol + mock reducer) | Task 3 (Step 3.7) |
| §7 architect-time: exact increment sites (pinned `index.ts:210` + close decrement) | Task 2 (Step 2.6) |
| **OUT** (chunk-03): overlay Memory window UI, overlay `types.ts` widening, the live §6.1 demo | Correctly absent — deferred to chunk-03 |
| **OUT** (rejected/frozen): `status='dismissed'` liveness gate, WS/mock-reducer change, dismiss-race lock | Correctly absent (q#019 / spec §3.7 note) |

**Placeholder scan:** none — every code step shows the exact code/SQL; test steps show assertions; commands show expected output.
**Type consistency:** `readThreadMeta` return shape, `HatchViewResult.thread`, `ForgetThreadResult`, `MemoryHttpDeps.isThreadLive`, and the route's result mapping are consistent across Tasks 1→2→3.

---

## Status: Done

**Plan is complete but NOT yet persisted** — this environment gave me no file-writing tool (only Read/Grep/Glob/Skill/WebFetch). The full plan above is ready to be saved verbatim to `/Users/lior/WebstormProjects/playground/AgenticEngine/orchestration/docs/plans/thread-forget/plan.md` (the slot is free; chunk-01's plan is archived at `orchestration/docs/plans/archive/thread-forget/plan-01-forget-thread-primitive.md`). Please write it there.

Key outcomes for the orchestrator:
- **Chunk-01 confirmed landed on `main @ 5149995`** — `WriteGate.forgetThread` (`write-gate.ts:126-164`), `MemoryStore.redactMirrorThread` (`store.ts:1054-1071`). This chunk builds callers + guards on top.
- **ADR worthy: no** — confirmed per spec §0.6 (executes accepted ADR-0013/0015/0014/0012-rider decisions; the `isThreadLive` registry implements the already-ruled §0.5 guard, daemon-internal, no wire/boundary change).
- **Two chunk-01 residuals closed structurally** (Approaches Forks C + D): MINOR-2 `edit()` guard (RED-first) and NIT-5 `reason` scrub-by-constant (RED-first) — both a few lines, both close the class by construction rather than annotation.
- **Two cosmetic anchor drifts** from the spec's `6785b35` baseline (no design impact): `editFact` machine-refusal moved `:222`→`:269`; history.html 5s auto-reset is at `:485` (spec cited `:457-466`).
- **One spec-internal tension resolved, not escalated:** the §0.3 banner "on `<date>`" has no source in the frozen 3-field meta → banner renders no fabricated date (Fork E1, §7 latitude); erase-date widening deferred to chunk-03/Lior.
- **Behavioral DoD is runtime-proof-gated:** the history.html erase flow is proven by the EXECUTED `thread-forget-probe.ts` stdout (Task 3) — marked "requires runtime proof," never "verified" from code-reading (PIPELINE §6.1). The full user-facing §6.1 sign-off is chunk-03.

Files most relevant to the work (all absolute):
- Plan target: `/Users/lior/WebstormProjects/playground/AgenticEngine/orchestration/docs/plans/thread-forget/plan.md`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/http-routes.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/hatch.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/write-gate.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/store.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/thread-lifecycle.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/history-page.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/index.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/scripts/forget-roundtrip-probe.ts` (probe template)

**_AI ENGINEERING_**
- **Human-in-the-loop as safety boundary** — the whole feature is a *sovereign-surface* action-gating pattern: a destructive content-erase is deliberately withheld from the agent's tool plane (ADR-0016 closed set) and confined to a human-only HTTP path with a fixed `authored_by:"human"` context, so a prompt-injection can never erase history. The `refused_machine` result is defense-in-depth on that boundary.
- **Least-privilege tool scoping / capability absence** — §3.6 makes "no agent-side `memory_forget_thread` tool" the deliberate design; the agent's honest answer to erased content is *absence* (the archive leg finds nothing), while the derived fact legitimately survives — a designed asymmetry, not a leak.
- **Provenance & tombstoning over deletion** — the "husk" (rows stay, content→`[forgotten]`, `status='forgotten'`) is an *append-only audit / immutable-event-log* posture: the erase is itself an observable event, and the JSONL mirror is redacted-in-place rather than deleted, preserving the audit trail while destroying content.
- **TOCTOU / concurrency control** — the `isThreadLive` refcount registry is a point-in-time liveness check (no lock) guarding a race where a live conversation's in-flight turn would re-flush plaintext after the erase; the accepted TOCTOU window + fail-closed decrement discipline is a classic single-writer concurrency trade-off documented rather than over-engineered.
agentId: aed6ffced60c42b60 (use SendMessage with to: 'aed6ffced60c42b60', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 236184
tool_uses: 29
duration_ms: 1010846</usage>
