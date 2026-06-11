> 🗄️ ARCHIVED 2026-06-11 — shipped. Historical record; do not edit.

# MF-04 — Thread-isolation logic (5f) via the `scope` tag — Implementation Plan

> 🗄️ ARCHIVED 2026-06-06 — shipped in PR #26 (merge `d61fdde`). Historical record; do not edit.

> **Feature:** memory-foundation · **Chunk:** `chunks-todo/memory-foundation/04-thread-isolation.md`
> **Spec:** `specs/2026-06-04-memory-foundation.md` §3.3 (checkpoints) · **ADR:** `adr/0012` decision 5f
> **Branch:** `chunk/mf-04-thread-isolation`

## Status

Review-complete → PR. Implemented (3 commits, TDD), reviewer-clean (engine-reviewer: **0 blockers**),
verified-done by orchestrator command-evidence (typecheck 0 / lint:strict 0 / `bun test` 237 pass 0 fail /
frozen surfaces byte-unchanged). Planning: architect returned `## Status: Done`; orchestrator caught +
resolved a v0-heuristic collision (see Design "MF-02 / route-demo non-regression" and Flags #3).
**Heuristic verdict: Position B** — v0 distiller stays all-`cross-thread`; 5f is the ENFORCEMENT half only.

> **For agentic workers:** use `superpowers:test-driven-development` (failing test first, then minimal
> impl) and per-task commits (project `CLAUDE.md`: branch first, `Co-Authored-By` trailer, push, PR).
> Steps use checkbox (`- [ ]`) tracking.

---

## Goal

Fill the frozen MF-02 PROVIDER-PORT + the `scope` tag with thread-isolation rules so a
`thread-local`-scoped fact never crosses into another thread's injected slice, while
`cross-thread`/`global` facts do — proven end-to-end through the real daemon → SQLite → injection
path with **no mocked store/injection**, and with **no new write/inject path** introduced
(spec §3.3 "only fill, never re-plumb").

---

## Reality check

VERIFIED by reading the merged source on `main` (post-PR-#23/#24). Behavioral/runtime claims are
marked "requires runtime test." Nothing is claimed PASS from code-reading (PIPELINE §6.1, Strike-4
scar) — the real-I/O tests in `## Steps` are the proof, run with no mocked store/injection.

### Where `scope` is set on write (and that it is currently uniform)

- **`scope` is stamped at distill, never at turn-append.** Both v0 providers hardcode
  `scope: "cross-thread" as const` — `dumb-tail-provider.ts:38`, `fixed-marker-provider.ts:31`.
  `WriteGate.appendTurn` deliberately carries no scope (`write-gate.ts`: "messages have no scope
  concept"). So **today every live `distilled_facts` row is `scope='cross-thread'` by construction.**
  The `scope` column exists (`schema.ts:50`, nullable `TEXT`) and is round-tripped by
  `insertDistilledFacts`/`readDistilledFacts` (`store.ts:143,156`).
- **Consequence:** the isolation rule is currently *vacuously satisfied* — there are no `thread-local`
  facts to leak. MF-04 builds the **enforcement** (retrieve honoring scope) and proves it against a
  **real** thread-local row written via the store; producing thread-local facts is the smart
  distiller's future job (spec §1-Out / §7), NOT MF-04 (see Design / Flags #3).

### The exact site the policy fills

- **`DumbTailProvider.retrieve` (`dumb-tail-provider.ts:52-59`)** does `void forThreadId; const rows =
  store.readDistilledFacts(RETRIEVE_SLICE_N); …` — reads **ALL** `distilled_facts` (cap 20, ordered
  `derived_at DESC`), filters only tombstoned-provenance, returns every remaining fact. **No thread/
  scope filter.** The `void forThreadId` is the literal marker of the un-filled seam.
- **`FixedMarkerProvider.retrieve`** is identical in shape (`void forThreadId`, reads all), minus the
  tombstone filter (its provenance is thread-level `"thread:<id>"`).
- **`store.readDistilledFacts(limit)` (`store.ts:154-158`)** = `SELECT … ORDER BY derived_at DESC
  LIMIT ?` — no thread/scope predicate. **This is where MF-04's new scoped read sits beside** (a new
  method; `readDistilledFacts` left intact for swap-proof/other callers).
- **The injection wiring above `retrieve` is frozen + correct:** `ThreadLifecycle.beginTurn`
  mint-branch calls `await this.memoryProvider.retrieve(this.store, newThreadId)`
  (`thread-lifecycle.ts:54-55`) and returns it as `priorMessages`; `index.ts` hydrates that into
  `priorState.messages[]`. **MF-04 touches NONE of this plumbing** — only the body of `retrieve` + a
  new store read. *(requires runtime test that isolation holds end-to-end — Task 3.)*

### Origin-thread derivability — the gap the SQL closes (no schema migration)

- `distilled_facts` has **no `thread_id`/`origin_thread` column** (`schema.ts:46-56`). A fact's only
  link to its origin thread is `provenance`: a `messages.id` (DumbTail) or the literal
  `"thread:<id>"` (FixedMarker). So "is this thread-local fact mine?" is computed by JOINing
  `provenance → messages.id → messages.thread_id` (DumbTail) or `substr(provenance, 8)` (FixedMarker).
  **No migration** — derivable from existing columns; adding a column would re-plumb a frozen write
  path (forbidden). The join is the in-scope, additive-read fill.

### The S4 carry-over — verified verdict

- `WriteGate.forget` calls `dropDistilledFactsByProvenance(messageId)` (drops the exact-provenance
  DumbTail fact) **and** `dropDistilledFactsForThread(threadId)` (drops only `provenance =
  "thread:<id>"` — the FixedMarker thread-summary). It does NOT drop every fact in the thread.
  **Verdict: this conservative purge stays acceptable under scope-isolation, UNCHANGED.** A
  `thread-local` fact is *more* private — purging it on forget is strictly correct. A more-granular
  purge would be surgery on the `forget` write path → out of MF-04 scope (Flags #1). **MF-04 adds
  NOTHING to `forget`.**

### Real-I/O harness to reuse (NOT mock)

- `distiller-integration.daemon.test.ts` is the pattern: `beforeAll` → `mkdtempSync` →
  `AGENTIC_DATA_DIR` → `LLM_PROVIDER="mock"` → `startDaemon(0)` → real on-disk SQLite; a `runTurn`
  helper drives a real WS turn; tests reopen the same DB via `new MemoryStore({ dataDir })`. **MF-04's
  real-I/O test extends this file.** Mock LLM only (ADR-0010 decision-6 deterministic harness); store,
  providers, `retrieve`, injection-point all REAL.

### Cross-thread continuity baseline that MUST NOT regress

- **`distiller-integration.daemon.test.ts:185-214`** (test 5.4 "cross-thread continuity"): thread A's
  **lone** message `"deploy is yeet.sh"` (line 196 — the FIRST and only message) MUST cross into
  thread B (asserted line 204). The same fact is the turn-1 fact of the **route demo §4.1** (step 1 →
  asserted at step 4). Under Position B (distiller keeps stamping `cross-thread`), the scope filter
  *admits* `cross-thread` → this fact still crosses → **5.4 + the route demo are preserved.** (The
  rejected "first-message = thread-local" heuristic would have stranded exactly this fact.)

### Contradiction check

No contradiction with the chunk/spec. The criteria presume `thread-local` facts can exist; the merged
v0 distiller emits none. **Resolved (Position B):** MF-04 proves the criteria by inserting a **real**
`thread-local` `distilled_facts` row via the real store (real SQLite, real `retrieve`, real
injection — nothing mocked), not by manufacturing one from a positional heuristic that would break
test 5.4 and the route demo. This is the faithful §3.3 fill: 5f's checkpoint-table job is the
ENFORCEMENT; the thread-local *producer* is the smart distiller (spec §1-Out).

---

## Design

### v0 scope rule — `cross-thread` for all distiller-emitted facts, UNCHANGED from MF-02

`DumbTailProvider.distill` and `FixedMarkerProvider.distill` keep stamping `scope: "cross-thread"` on
every fact (DumbTail line 38). MF-04 does **not** produce thread-local facts — per the §3.3 checkpoint
table the PROVIDER-PORT row's "Filled later by" is *"smart distiller · 5f isolation"*; producing
thread-local facts is the **smart-distiller's** job (spec §1-Out, §7). MF-04's job is the
**ENFORCEMENT half**: retrieval honors the `scope` tag.

> Why a "no-thread-local-fact" v0 distiller is NOT a §3.3 anti-stub violation: the anti-stub rule
> forbids spawning a seam where later filling would not be surgery. Here the seam (`scope` column +
> port) already exists from MF-01/02; MF-04 adds enforcement **logic**, not a stub. The thread-local
> *producer* is genuine future work (smart distiller), and inventing a heuristic to manufacture a
> thread-local fact now would be the *opposite* error — surgery on the distiller's selection logic the
> spec defers, at the cost of regressing the route demo. So we prove enforcement against a **real**
> thread-local row written via the real store.

### The admit rule (precise)

A `distilled_facts` row `F` is admitted into thread `B`'s injected slice iff:

```
COALESCE(F.scope, 'cross-thread') IN ('cross-thread', 'global')
  OR  (F.scope = 'thread-local'  AND  originThread(F) = B)
```

`originThread(F)` is derived from provenance with **no new column**:
- message-level provenance (a `messages.id`): `JOIN messages m ON m.id = F.provenance` → `m.thread_id`.
- thread-level provenance (`"thread:<id>"`): `substr(F.provenance, 8)`.

NULL/unknown scope ⇒ treated as `cross-thread` (the v0 reality; never throws).

### The ONE fill site (no re-plumb)

All admit logic lives in **one new store SQL method** so the rule has a single home (the store is
where all SQL lives — established boundary):

- **New** `MemoryStore.readDistilledFactsForThread(forThreadId, limit): DistilledFactRow[]` — runs the
  admit rule as a single `SELECT` with `LEFT JOIN messages` (message-level provenance) and a `substr`
  branch (thread-level provenance). `readDistilledFacts(limit)` (all-rows) is **left UNCHANGED**
  (swap-proof / non-injection callers depend on it).
- **Both providers' `retrieve`** change exactly one line:
  `store.readDistilledFacts(RETRIEVE_SLICE_N)` → `store.readDistilledFactsForThread(forThreadId,
  RETRIEVE_SLICE_N)`. The `void forThreadId` is removed — `forThreadId` becomes load-bearing. DumbTail
  keeps its tombstone backstop + `[remembered]` mapping; FixedMarker keeps its no-tombstone-filter
  shape. **No other line changes; `distill` is NOT touched in either provider.**

This is the literal fill of the PROVIDER-PORT + `scope` seam: the port signature
`retrieve(store, forThreadId)` is unchanged (MF-02 already passed `forThreadId`, just ignored it); the
body now honors it. No new path, no envelope/wire/reducer change.

### Isolation-boundary guarantee

The only channel by which thread A's content reaches thread B is `retrieve` → `priorMessages` →
`messages[]`. `retrieve` reads **exclusively** from `distilled_facts` (the scanned, tagged
projection), never from `messages`. Therefore: (1) a `thread-local` fact of A is filtered out for B;
(2) raw `messages` rows of A are never read by `retrieve`, so no un-distilled bleed is possible; (3)
the only A-content that can reach B is a `cross-thread`/`global` `distilled_facts` row — which by MF-03
already passed the write-scan (5d) and carries its tag (5c). This is the §3.3 "except through the
distilled, scanned, tagged super-chat path" boundary, made enforceable (DoD #3).

### MF-02 / route-demo non-regression (grounded)

Because distiller stamping is byte-unchanged (`cross-thread`), and the filter *admits* `cross-thread`:
- **`distiller-integration.daemon.test.ts:204`** (test 5.4) — thread A's lone `"deploy is yeet.sh"` is
  `cross-thread` → admitted → `priorMessages` still has `"[remembered] deploy is yeet.sh"`. Unchanged.
- **`dumb-tail-provider.test.ts:73-83`** — inserted fact is `cross-thread` (line 76) → admitted.
  Unchanged.
- **Route demo §4.1 step 4** — turn-1 fact crosses to the new thread. Preserved.

### S4 forget-purge verdict

UNCHANGED — verified conservative-but-correct. MF-04 adds nothing to `WriteGate.forget` (Flags #1).

### Files to create / modify

- **Modify** `packages/daemon/src/memory/store.ts` — add `readDistilledFactsForThread`. Leave
  `readDistilledFacts` intact.
- **Modify** `packages/daemon/src/memory/providers/dumb-tail-provider.ts` — `retrieve` one-line read
  swap (distill untouched).
- **Modify** `packages/daemon/src/memory/providers/fixed-marker-provider.ts` — `retrieve` one-line read
  swap (distill untouched).
- **Modify** `packages/daemon/src/memory/memory-provider.ts` — port doc comments only (no type change).
- **Test** (append): `store.test.ts`, `providers/dumb-tail-provider.test.ts`.
- **Test** (extend): `distiller-integration.daemon.test.ts` — real-I/O isolation proofs.

---

## Steps

> Every step: failing test first, then minimal impl; run the full gate
> (`bun test && bun run typecheck && bun run lint:strict`) before each commit; per-task commit with the
> `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

### Task 1 — Store-layer scope-filter read (`readDistilledFactsForThread`)

**Files:** modify `store.ts`; append `store.test.ts`. **Proves:** DoD #1 + #2 at the store layer.

- [ ] **Step 1 — failing store tests.** Append to `store.test.ts` (uses the file's `freshStore()`):
  - cross-thread + global rows are returned for ANY thread;
  - a `thread-local` row whose provenance is a `messages.id` in thread A is HIDDEN from thread B;
  - the same `thread-local` row IS returned for its OWN origin thread A;
  - a thread-level (`"thread:<id>"` provenance) `thread-local` row respects origin (hidden from B,
    shown to A);
  - a NULL-scope row is treated as cross-thread (defensive default).
- [ ] **Step 2 — run → FAIL** (`readDistilledFactsForThread` is not a function).
- [ ] **Step 3 — implement** in `MemoryStore`, beside `readDistilledFacts` (leave that one UNCHANGED):

```typescript
/**
 * MF-04 (5f, spec §3.3; ADR-0012 decision 5f). Scope-filtered projection read —
 * the thread-isolation enforcement point. A fact is injectable into `forThreadId` iff:
 *   scope IN ('cross-thread','global')                              -- shared facts cross
 *   OR (scope = 'thread-local' AND originThread(fact) = forThreadId) -- private stays home
 * originThread is derived from provenance with NO new column (frozen write-path):
 *   - message-level provenance (a messages.id): JOIN messages → thread_id
 *   - thread-level provenance ('thread:<id>'): substr after the prefix
 * NULL/unknown scope defaults to cross-thread (the v0 reality; never throws).
 * `readDistilledFacts` (all-rows) is intentionally kept for swap-proof / non-injection callers.
 */
readDistilledFactsForThread(forThreadId: string, limit: number): DistilledFactRow[] {
  return this.db
    .query(
      `SELECT df.fact AS fact, df.provenance AS provenance, df.scope AS scope,
              df.expiry AS expiry, df.confidence AS confidence, df.authored_by AS authored_by
       FROM distilled_facts df
       LEFT JOIN messages m ON m.id = df.provenance
       WHERE
         COALESCE(df.scope, 'cross-thread') IN ('cross-thread', 'global')
         OR (
           df.scope = 'thread-local'
           AND (
             m.thread_id = ?
             OR (df.provenance LIKE 'thread:%' AND substr(df.provenance, 8) = ?)
           )
         )
       ORDER BY df.derived_at DESC
       LIMIT ?`,
    )
    .all(forThreadId, forThreadId, limit) as DistilledFactRow[];
}
```

> Match the exact `SELECT` column aliases / `DistilledFactRow` shape to `readDistilledFacts`
> (`store.ts:154-158`) so the row type is identical. If `readDistilledFacts` returns extra columns
> (e.g. `authored_by`), mirror them.

- [ ] **Step 4 — run → PASS.**
- [ ] **Step 5 — gate + commit** `feat(daemon): MF-04 store scope-filter read (readDistilledFactsForThread) — 5f isolation SQL`.

### Task 2 — Both `retrieve` bodies honor scope (no distill change)

**Files:** modify `dumb-tail-provider.ts`, `fixed-marker-provider.ts`, `memory-provider.ts` (comment
only); append `dumb-tail-provider.test.ts`. **Proves:** DoD #1 + #2 at the provider/injection layer.

- [ ] **Step 1 — failing provider tests.** Append to `dumb-tail-provider.test.ts` (uses its
  `freshStore()` + `provider`): (a) a `thread-local` row whose provenance is in thread A is dropped
  when retrieving for thread B; (b) the same row is admitted when retrieving for thread A; (c) a
  `global` row crosses; (d) the existing `cross-thread` test (line 76) stays green. Insert rows
  directly via `store.insertDistilledFacts([{ …, scope }], "dumb-tail")`.
- [ ] **Step 2 — run → FAIL** (retrieve still reads all).
- [ ] **Step 3 — implement DumbTail `retrieve`** — swap ONLY the read; keep tombstone filter + mapping;
  remove `void forThreadId`:

```typescript
async retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]> {
  // MF-04 (5f): scope-filtered read — thread-local facts of OTHER threads are excluded;
  // cross-thread/global cross. forThreadId is now load-bearing (was void in MF-02).
  const rows = store.readDistilledFactsForThread(forThreadId, RETRIEVE_SLICE_N);
  const live = rows.filter((f) => !store.isMessageTombstoned(f.provenance));
  return Promise.resolve(
    live.map((f) => ({ role: "user" as const, content: `[remembered] ${f.fact}` })),
  );
}
```

- [ ] **Step 4 — implement FixedMarker `retrieve`** — same read swap; no tombstone filter; `distill`
  untouched (stays `cross-thread`, the swap-proof foil):

```typescript
async retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]> {
  // MF-04 (5f): scope-filtered read (same contract as DumbTail's retrieve).
  // FixedMarker provenance is "thread:<id>"; readDistilledFactsForThread resolves origin
  // via the substr branch. No isMessageTombstoned (thread-level provenance never matches a UUID).
  const rows = store.readDistilledFactsForThread(forThreadId, RETRIEVE_SLICE_N);
  return Promise.resolve(
    rows.map((f) => ({ role: "user" as const, content: `[remembered] ${f.fact}` })),
  );
}
```

- [ ] **Step 5 — port comment** in `memory-provider.ts`: `scope` comment (line 8) → "stamped at
  distill; ENFORCED by retrieve via readDistilledFactsForThread (MF-04 5f)"; `retrieve` doc (lines
  38-43) → note it now honors `scope` for thread-isolation (5f). No type/signature change.
- [ ] **Step 6 — run** `bun test packages/daemon/src/memory/providers/` → PASS; then
  `bun test packages/daemon/src/memory/` → confirm MF-02 cross-thread tests (incl. 5.4) still pass.
- [ ] **Step 7 — gate + commit** `feat(daemon): MF-04 both providers' retrieve enforces scope tag (5f); distill unchanged`.

### Task 3 — Real-I/O isolation proofs (DoD #1/#2/#3) over the real daemon path

**Files:** extend `distiller-integration.daemon.test.ts` (same real-SQLite, no-mock harness).
**Proves:** DoD #1/#2/#3 end-to-end; DoD #4 by the final gate.

- [ ] **Step 1 — add tests** alongside test 5.4 (insert REAL thread-local rows via the real store —
  the spec-sanctioned proof; nothing mocked but the LLM):
  - **`5f isolation: thread-local does NOT cross into B; cross-thread + global DO`** — create thread A,
    append a real message (capture `midA`); insert via `store.insertDistilledFacts` three real rows
    (`{fact:"local-only fact", provenance:midA, scope:"thread-local"}`, `{fact:"deploy is yeet.sh",
    provenance:midA, scope:"cross-thread"}`, `{fact:"global note", provenance:midA, scope:"global"}`).
    Create thread B; `slice = await new DumbTailProvider().retrieve(store, B)`:
    - DoD #1: `slice` does NOT contain `"[remembered] local-only fact"`;
    - DoD #2: `slice` DOES contain `"[remembered] deploy is yeet.sh"` AND `"[remembered] global note"`;
    - own-thread completeness: `retrieve(store, A)` DOES contain `"[remembered] local-only fact"`
      (proves the filter isolates, not blanket-suppresses).
  - **`5f boundary: no raw messages cross — only the distilled+tagged path carries`** (DoD #3) — fresh
    thread A with messages but **zero `distilled_facts`**; `retrieve(store, B)` → `[]` (the only
    cross-thread carrier is the projection, never raw `messages`).
  - keep test 5.4 (185-214) **unmodified + green**; add a one-line comment citing 5.4 as the
    cross-thread baseline this must not break.
- [ ] **Step 2 — run → PASS** on the real path.
- [ ] **Step 3 — commit** `test(daemon): MF-04 real-I/O 5f isolation proofs (thread-local stays home, cross-thread crosses, no raw bleed)`.
- [ ] **Step 4 — full no-regression gate + frozen-surface audit + push + PR.**
  - `bun test && bun run typecheck && bun run lint:strict` → all green; capture pass count (DoD #4).
  - **Frozen audit:** `git diff origin/main..HEAD -- packages/protocol/ packages/daemon/src/mock-agent.ts`
    is **empty** (no wire/reducer change). If non-empty → STOP, freeze gate.
  - `git push -u origin chunk/mf-04-thread-isolation`; `gh pr create --base main` (body: the 5f fill +
    three real-I/O proofs + "no wire/reducer change" + attribution line).

---

## ADR worthy: no

5f is a decision already made in ADR-0012 (decision 5f); MF-04 is a pure fill of the frozen
PROVIDER-PORT + `scope` seam (spec §3.3 "only fill, never re-plumb"). No new boundary, no new
dependency (`bun:sqlite` in use since MF-01), no wire/reducer change. The admit-rule SQL + the
keep-it-`cross-thread` v0 stance are the architect's §7 latitude, not a load-bearing new decision.

## Flags for orchestrator

1. **(Deferred, cite spec §3.3) S4 forget-purge granularity.** `WriteGate.forget`'s
   `dropDistilledFactsForThread` drops the FixedMarker thread-summary on any single-message forget —
   correct-but-conservative, UNCHANGED by MF-04. A granular "invalidate only facts sourced from the
   forgotten message" purge would be `forget`-write-path surgery, which spec §3.3 forbids growing a
   later sub-chunk to do. Candidate for a future chunk (likely with MF-05's edit/forget API). NOT
   MF-04 work.
2. **(Sharpening) Done criteria presume thread-local facts can exist; v0 distiller emits none.**
   Resolved via Position B: enforcement is proven against a **real** store-inserted thread-local row
   (real-I/O). No edit to the frozen chunk-file requested.
3. **(Resolved at plan time) v0-heuristic collision.** The architect's first heuristic ("first message
   = thread-local") would have stranded the turn-1 fact that `distiller-integration.daemon.test.ts`
   test 5.4 (line 204) and route demo §4.1 step 4 require to cross. Orchestrator flagged; architect
   verified against the real test and adopted **Position B** (distiller stays all-`cross-thread`; 5f =
   enforcement only). No frozen artifact edited; in-scope design choice (spec §7).

## Status: SHIPPED — Done (planning) → executing
