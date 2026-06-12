# Plan — memory-quality chunk 02: Projection contract (2b, NO LLM)

## Status: Review-complete — ready-to-merge (Phase 3; awaiting Jimmy clean-checkout re-verify + merge, crawl rung §11.4)

> **Reviewer (engine-reviewer) verdict 2026-06-13: CLEAN — 0 blockers, 0 majors.** All 10
> scrutinized frozen invariants PASS (single flat synchronous tx; LLM-outside-tx seam;
> failure-never-drops; 5e `!= 'human'` guard preserved; 5d quarantine per-fact pre-insert;
> ONE re-projection per disconnect; `reprojection`/`reprojection-failed` event semantics;
> expiry+human-precedence on reads; global projection via `listThreads()`; frozen surfaces
> byte-unchanged). Real SQLite throughout; only stub = throwing/deterministic fake provider.
> Two MINORs + two NITs found → all four **folded** (commit 13c7e26): empty-batch `dismiss([])`
> early-return guard; failure-path `facts_produced` narrowed to `!= 'human'` (matches the
> success path's machine-only `clean.length` basis); misleading test title fixed; `DistillResult`
> annotation on the chunk-03 seam line. Minor/nit fixes implement the reviewer's own suggestions →
> no re-review round needed.
>
> **Orchestrator independent re-verification (§6.2 command evidence, not worker assertion), on
> the fix HEAD `13c7e26`:** `bun test` **389 pass / 0 fail** (49 files, real SQLite) · `bun run
> lint:strict` exit 0 (`--max-warnings=0`) · typecheck exit 0 · frozen diff (`@agentic/protocol`
> + `mock-agent.ts`) **empty**. (Note: a mid-build LSP `string` vs `string[]` diagnostic on the
> test files was STALE — the include glob `packages/*/src/**/*.ts` covers them and tsc exits 0.)
>
> **Verified-done (§6) — all 5 DoD are [mechanical], no behavioral demo gate this chunk** (the
> Lior live demo is chunk 04, spec §5):
> - DoD#1 contract + both providers project all threads + compute-first/scan-per-fact/single-tx
>   replace + throwing-provider failure test (projection intact + `reprojection-failed` rows) →
>   reviewer-confirmed structurally + test green. ✓
> - DoD#2 ONE re-projection per multi-thread disconnect (real daemon test asserts exactly one
>   `reprojection` row per dismissed thread, both dismissed, no double-reprojection). ✓
> - DoD#3 expired fact not injected (D7 store test). ✓
> - DoD#4 carried proofs green under new semantics (swap-proof, forget-survives-re-derive,
>   lossless integrity, distillation-observable) + full suite/lint/typecheck exit 0, real SQLite. ✓
> - DoD#5 frozen surfaces byte-unchanged. ✓

**Chunk:** `orchestration/chunks-todo/memory-quality/02-projection-contract.md`
**Spec:** `orchestration/docs/specs/2026-06-12-memory-quality.md` §3.2 (D4, D5, D6, D7), §5 (verification), §7 (architect-time)
**Branch:** `chunk/02-projection-contract`
**Baseline for review:** `main`

---

## Orchestrator notes (read alongside the architect content)

### DoD tagging (Phase 0, drives the §6 verified-done gate)
All 5 Done criteria are **[mechanical]** (the chunk file tags them so). This chunk has **no
behavioral demo gate** — the feature-closing Lior live demo is chunk 04 (spec §5). The
multi-thread-disconnect-one-reprojection criterion has a behavioral *flavor* (a live WS
close), but its DoD evidence is a **passing real-I/O daemon test** (mechanical, command
evidence — §6.2), not a Lior demo. So chunk 02 merges on: `bun test` + `lint:strict` +
typecheck exit 0 (real SQLite I/O, no mocked store, Strike-4) + reviewer-clean + frozen
surfaces byte-unchanged. Crawl rung (§11.4): worker posts `DONE — ready-to-merge`; Jimmy
re-verifies on a clean checkout + merges. No self-merge.

### Grilling gate — skipped (judgment, recorded)
The plan *implements* ADR-0012 (5b observability, 5d quarantine, 5e human guard, decision 6
swappable provider, HARD INVARIANT 1/3); it does not contradict the ADR, concept.md, or
architecture.md. The design is FROZEN in the Lior-signed spec §3.2 (D4–D7) and was already
adversarially grilled at decompose (engine-reviewer grill #1–12, cited inline in the spec).
The plan introduces no new decision touching ADR-0012's substance (`## ADR worthy: no`,
confirmed against the frozen q#001/q#003 rulings). A re-grill would re-litigate
frozen-and-accepted decisions → skipped. (Also: a detached fire-and-complete orchestrator
worker has no interactive user for `grill-with-docs`.)

### Plan-escalation (§7.2 citation test) — not triggered
The plan fits the decompose-blessed chunk, cites no frozen conflict it intends to break,
and introduces no new scope. The architect found no frozen-vs-frozen contradiction (no
`## FLAG`). Proceeds autonomously to Phase 2 (PIPELINE §5.2, narrowed 2026-06-06).

### Architect-time decisions accepted (spec §7 delegated these to the architect)
- **No additive `outcome` column** on `distillation_events` → outcome encoded via the frozen
  `trigger` values (`"reprojection"` / `"reprojection-failed"`). Avoids a real `ALTER TABLE`
  migration on the existing `~/.agentic-engine/memory.sqlite` (the OUT-list trap). ✓
- **Batch-only dismiss**: `dismiss(threadId)` removed in favor of `dismiss(threadIds[],
  triggerThreadId?)` — ONE code path runs the projection (D5). Sanctioned by the chunk
  ("migrated — architect's call, but ONE code path runs the projection"). ✓
- **`replaceProjection` helper**: ONE flat synchronous `db.transaction` (inlined DELETE
  `!= 'human'` + insert(clean) + insert(events)), NO nested tx (avoids `insertDistilledFacts`'
  inner tx). The single-flat-tx is the seam chunk 03's LLM-outside-tx plugs into (grill #6). ✓
- **Human-precedence (D6)** via read-side `ORDER BY (authored_by='human') DESC, derived_at
  DESC` — no new column, no write-path change. ✓

---

## Requirements

- **R1** — `MemoryProvider.distill()` doc-contract is redefined: it returns the COMPLETE
  projection over the whole tombstone-honored archive (iterating `listThreads()`), not one
  thread's facts. Signature stays `distill(store, threadId)`; `threadId` = trigger thread;
  `DistillResult.threadId` keeps the trigger meaning.
- **R2** — `DumbTailProvider` and `FixedMarkerProvider` both loop ALL threads (DumbTail: one
  tail-set of facts per thread; FixedMarker: one count-fact per thread). Both stay registered
  so swap-proof stays meaningful.
- **R3** — `registerDistiller` becomes a three-phase flow with clean seams: (1) compute
  projection FIRST, outside any transaction; (2) scan EACH fact, per-fact quarantine recording
  pre-insert (5d unchanged); (3) ONE synchronous `db.transaction { dropAllDistilledFacts +
  insertDistilledFacts(clean) + per-thread event rows }`.
- **R4** — Failure path: a rejecting provider ⇒ do NOT drop the existing projection; write one
  per-thread `trigger="reprojection-failed"` event row + `console.error`. Never an empty
  projection from a crash between drop and insert.
- **R5** — Batch dismiss: `close(ws)` flips ALL touched threads' statuses, then runs exactly
  ONE re-projection. The `ConsolidationHook` gains a batch entry point; ONE code path runs the
  projection.
- **R6** — Event semantics: one `distillation_events` row PER dismissed thread in the run;
  `trigger="reprojection"` on success / `"reprojection-failed"` on failure; `facts_produced` =
  clean-fact count of the RESULTING projection (same value across the run's rows on success).
  Old `trigger="dismiss"` rows remain historically valid.
- **R7** — Expiry filter (D7): `readDistilledFactsForThread` gains `(expiry IS NULL OR expiry >
  now)`; an expired fact is never injected.
- **R8** — Human precedence (D6): `dropAllDistilledFacts`'s `!= 'human'` guard is preserved
  (untouched); at injection, human-authored facts are ordered ahead of machine facts.
- **R9** — All carried tests re-asserted under the new semantics; full `bun test` +
  `lint:strict` + typecheck exit 0; real SQLite I/O (only a throwing/deterministic fake
  *provider* is permitted; the store is never mocked).
- **R10** — Frozen surfaces (`@agentic/protocol`, `mock-agent.ts` reducer) byte-unchanged.

## Reality check (architect — code paths verified; behavioral claims marked)

Evidence from source (file:line). Behavioral/end-to-end claims are marked **requires runtime
demo**; everything else is a static code-path observation, not a runtime assertion.

- **`MemoryProvider` port** — `memory-provider.ts:36` (`distill(store, threadId)`), `:28-46`.
  `DistilledFact` thin: `:5-12` (`{fact, provenance, scope, expiry, confidence, authored_by}`
  — no `kind`). `DistillResult.threadId` at `:16`.
- **`listThreads()`** — `store.ts:437-441`: `SELECT thread_id, title, last_active_at FROM
  threads ORDER BY last_active_at DESC`. Lists ALL threads regardless of `status` — correct for
  a complete projection (dismissed threads must still project).
- **`registerDistiller`** — `distiller-registration.ts:16-42`. Current flow single-thread:
  `distill(store, threadId)` → filter/scan per-fact (`:24-38`, quarantine recording `:33`) →
  `insertDistilledFacts(clean, provider.id)` (`:39`) → `insertDistillationEvent(...)` (`:40`).
  Does NOT call `dropAllDistilledFacts` today (purely additive insert). The transactional
  REPLACE is new.
- **`dropAllDistilledFacts`** — `store.ts:338-340`: `DELETE FROM distilled_facts WHERE
  authored_by != 'human'`. The 5e human guard is the `!= 'human'` clause (must stay).
- **`insertDistilledFacts`** — `store.ts:173-183`: already wraps its inserts in its OWN
  `this.db.transaction(...)`. ⇒ the new single-tx helper must NOT call it inside another
  `db.transaction` (avoid nested-tx SAVEPOINT reliance — see Design).
- **`insertDistillationEvent`** — `store.ts:343-349`: `INSERT INTO distillation_events (...)`;
  `trigger` is a free `TEXT` column (`schema.ts:61`). ⇒ `trigger="reprojection"` /
  `"reprojection-failed"` need NO schema migration (new string values only).
- **`readDistilledFactsForThread`** — `store.ts:203-223`: scope-filtered SELECT, `ORDER BY
  df.derived_at DESC LIMIT ?`. No expiry filter today, no author ordering. `DistilledFactRow`
  carries `expiry: number | null` (`:31`), `authored_by: string` (`:33`). Two callers, both
  providers (`dumb-tail-provider.ts:60`, `fixed-marker-provider.ts:60`).
- **`ConsolidationHook`** — `consolidation-hook.ts:13-27`: `dismiss(threadId)` does `UPDATE
  threads SET status='dismissed'` then `await this.handler(threadId, "dismiss")`. Single-thread
  only today.
- **`close(ws)` wiring** — `index.ts:242-251`: loops `ws.data.touchedThreadIds`, `continue`s if
  already in `dismissedThreadIds`, `await hook.dismiss(threadId)` per thread in try/catch/finally.
  `touchedThreadIds` a `Set<string>` (`:30`), populated `:167`. Hook constructed once `:71`. The
  S1 partial-turn flush is `:220-234` (runs before dismiss — must stay before).
- **Schema** — `schema.ts:46-65`: `distillation_events.trigger TEXT NOT NULL` (no enum
  constraint at the DB level). Confirms "no ALTER TABLE needed".
- **Frozen-surface check** — no file in scope touches `@agentic/protocol` or `mock-agent.ts`.
- **Behavioral DoD items** ("exactly ONE projection rebuild per disconnect" over a live WS;
  status flips; event rows land after async `close`; archive byte-identical across a real
  re-projection) — **proven by the daemon tests below (command evidence), not by this
  code-reading.** Marked **requires runtime proof** at the DoD level (here: a passing real-I/O
  daemon test, §6.2 — not a Lior demo, which is chunk 04).

No frozen-vs-frozen contradiction between the chunk file and the spec/ADR — no `## FLAG`.

## Design

### The registration flow (three phases — the seam chunk 03 plugs into)

`registerDistiller(hook, store, provider, scanner)` registers a batch handler receiving
`(dismissedThreadIds: string[], triggerThreadId: string)`:

- **Phase 1 — COMPUTE (outside any transaction).** `const result = await
  provider.distill(store, triggerThreadId)`. The ONLY `await` in the flow and the seam where
  chunk 03's LLM call lives — deliberately outside the tx so an open-tx-await can never stall
  the single-connection daemon (grill #6). `distill` now returns the COMPLETE projection over
  all threads (R1). If it rejects/throws → failure path.
- **Phase 2 — SCAN per-fact (outside the tx, pre-insert).** Unchanged from today
  (`distiller-registration.ts:24-38`): per fact, `scanner.scan({content, scope, authored_by})`;
  on `!v.ok`, record a quarantine marker iff the provenance is a message UUID (not `thread:`),
  drop the fact. Produce `clean` = survivors. 5d preserved.
- **Phase 3 — ONE synchronous tx (the replace).** Build event rows: one
  `{thread_id, trigger:"reprojection", facts_produced: clean.length, distiller_version:
  provider.id}` per id in `dismissedThreadIds`. Call `store.replaceProjection(clean, provider.id,
  eventRows)` — the single flat `db.transaction` doing drop(`!= human`) + insert(clean) +
  insert(events). Commit.

**Failure path (Phase 1 or 2 throws):** do NOT call `replaceProjection` (no drop). Write
per-thread failure events (independent inserts — no atomicity needed, nothing was dropped): one
`trigger="reprojection-failed"` row per id in `dismissedThreadIds`, `facts_produced` = current
persisted projection size (read back; document the exact source in a comment), then
`console.error`. Existing projection intact; next disconnect retries by construction (archive
lossless).

### The batch-dismiss flow (`index.ts` + `consolidation-hook.ts`)

- **`ConsolidationHook`** — replace `dismiss(threadId)` with `dismiss(threadIds: string[],
  triggerThreadId?: string)`:
  1. `UPDATE threads SET status='dismissed' WHERE thread_id = ?` for EACH id (flip ALL first — D5).
  2. `await this.handler(threadIds, triggerThreadId ?? threadIds[0])` ONCE.
  - `ConsolidationTrigger`/`ConsolidationHandler` signature → `(threadIds: string[],
    triggerThreadId: string) => void | Promise<void>`. Default no-op handler still flips statuses
    (MF-01 contract preserved).
- **`index.ts` `close(ws)`** — replace the per-thread loop (`:242-251`) with: `const toDismiss =
  [...(ws.data.touchedThreadIds ?? [])].filter(id => !ws.data.dismissedThreadIds?.has(id))`; if
  non-empty, `try { await hook.dismiss(toDismiss) } catch (err) { console.error(...) } finally {
  for (const id of toDismiss) (ws.data.dismissedThreadIds ??= new Set()).add(id) }`. Projection
  runs EXACTLY ONCE per disconnect (D5); preserves the non-fatal/finally discipline + the
  never-re-dismiss guard. The S1 partial-turn flush (`:220-234`) is UNCHANGED and still runs
  before dismiss so the distiller sees the final turn.

### Event-row semantics (R6)
- Success: one row PER dismissed thread, `trigger="reprojection"`, `facts_produced=clean.length`
  (SAME value across the run; documented in the helper). Empty-success (0 clean facts) → rows
  with `facts_produced=0`, `trigger="reprojection"` (observably DISTINCT from failure).
- Failure: one row PER dismissed thread, `trigger="reprojection-failed"`, `facts_produced` =
  current persisted projection size (unchanged). No drop happened.
- Old `trigger="dismiss"` rows remain historically valid; consumers discriminate by trigger
  value. MF-02 tests asserting `"dismiss"` are updated to `"reprojection"`.

### Expiry filter (R7) + author ordering (R8)
`readDistilledFactsForThread` SELECT gains, in WHERE: `AND (df.expiry IS NULL OR df.expiry > ?)`
with `Date.now()` bound, and `ORDER BY (df.authored_by = 'human') DESC, df.derived_at DESC`.
Purely additive read-filter + ordering; no write-path change, no new column.

### The two providers (R2)
- **`DumbTailProvider.distill`** — wrap the existing per-thread tail logic in a loop over
  `store.listThreads()`; per thread run today's tail-extraction (tombstone/quarantine/fact-
  tombstone filters unchanged) and concat the facts. Return `{ threadId: triggerThreadId, facts:
  allThreadsFacts }`. `DISTILL_TAIL_N=5` per thread unchanged.
- **`FixedMarkerProvider.distill`** — loop `store.listThreads()`; per thread emit its ONE
  count-fact (`thread:<id> has <N> live messages`, the tombstoned-thread-provenance skip
  unchanged). Return `{ threadId: triggerThreadId, facts: oneFactPerThread }`.
- Both `retrieve` methods UNCHANGED (they read via `readDistilledFactsForThread`, which now
  carries the expiry filter + author ordering transparently).
- `distill`'s `threadId` param is now the TRIGGER thread (only for `DistillResult.threadId`);
  the projection iterates all threads regardless.

### Store helpers
- **`replaceProjection(clean, distillerVersion, events)`** — single `this.db.transaction(() =>
  { DELETE ... WHERE authored_by != 'human'; for clean → INSERT distilled_facts; for events →
  INSERT distillation_events; })`, then call once. NO compute, NO await inside → pure synchronous
  SQLite, daemon never stalls mid-tx. The inlined DELETE keeps the exact `!= 'human'` 5e guard.
- `dropAllDistilledFacts` left UNTOUCHED (still used by direct callers / swap-proof).

### Architect-time decisions (with justification) — see Orchestrator notes for acceptance
- **A.** No `outcome` column (encode via `trigger`; avoids ALTER TABLE on the existing sqlite).
- **B.** Batch-only `dismiss` (one projection trigger; size-1 batch subsumes old behavior).
- **C.** `replaceProjection` = one flat synchronous tx, no nesting (the LLM-outside-tx seam).
- **D.** Human-wins via read-side `ORDER BY (authored_by='human') DESC, derived_at DESC`.

## Steps

### Step 1 — Store: tx helper + expiry/author read filter (TDD: RED first)
**Files:** `store.ts`, `store.test.ts`
- **RED:** (a) `replaceProjection` drops machine facts, keeps human facts, inserts the clean set,
  writes the supplied event rows — all in one tx; (b) a pre-existing human-authored row survives
  the replace (5e); (c) `readDistilledFactsForThread` excludes `expiry <= now`, includes
  `expiry > now`/`null`; (d) returns a human-authored fact ahead of a machine fact (ordering).
- **GREEN:** add `replaceProjection(clean, distillerVersion, events)` (single flat tx, inlined
  DELETE `!= 'human'`). Add `(expiry IS NULL OR expiry > ?)` + `ORDER BY (authored_by='human')
  DESC, derived_at DESC` to `readDistilledFactsForThread` (bind `Date.now()`). Do NOT touch
  `dropAllDistilledFacts`.
- **Run:** `bun test packages/daemon/src/memory/store.test.ts`.

### Step 2 — Providers loop all threads + global-projection contract (TDD: RED first)
**Files:** `memory-provider.ts` (doc-contract only), `providers/dumb-tail-provider.ts`,
`providers/fixed-marker-provider.ts`, + their test files.
- **RED:** with 2+ threads, `distill(store, triggerId)` returns facts covering ALL threads
  (set-membership), and `DistillResult.threadId === triggerId`. Reframe single-thread shape
  assertions to set-membership.
- **GREEN:** rewrite both `distill` to loop `store.listThreads()`. Update the
  `MemoryProvider.distill` JSDoc: "returns the COMPLETE projection over the whole
  tombstone-honored archive (iterates `listThreads()`); `threadId` is the TRIGGER thread,
  recorded in `DistillResult.threadId`." No interface signature change.
- **Run:** `bun test packages/daemon/src/memory/providers/`.

### Step 3 — Registration flow + batch dismiss + carried integration tests (TDD: RED first)
**Files:** `distiller-registration.ts`, `consolidation-hook.ts`, `index.ts`, +
`consolidation-hook.test.ts`, `distiller-registration.test.ts`,
`distiller-integration.daemon.test.ts`, `dismiss-on-close.daemon.test.ts`.
- **RED (new tests):**
  - **throwing-provider failure path** (`distiller-registration.test.ts`): fake provider throws
    in `distill`; seed an existing projection (machine + human fact); dismiss → existing
    projection INTACT (both present), per-thread `trigger="reprojection-failed"` rows present,
    `facts_produced` = unchanged projection size, `console.error` fired.
  - **multi-thread-disconnect → ONE reprojection** (`dismiss-on-close.daemon.test.ts`): one
    socket runs turns on 2 threads → `ws.close()` → poll DB → exactly ONE `reprojection` row per
    dismissed thread (2 total, both `trigger="reprojection"`), both `status='dismissed'`, no
    thread gets a second reprojection row. (**requires runtime proof — the test IS the
    mechanical proof; command evidence at §6.2.**)
  - **expired-fact-not-injected** covered by Step 1's store test; optionally add retrieve-path
    coverage.
- **GREEN:**
  - `distiller-registration.ts`: three-phase flow + failure path. Handler signature →
    `(dismissedThreadIds, triggerThreadId)`. Phase 3 calls `store.replaceProjection`. Failure
    path loops `insertDistillationEvent(id, "reprojection-failed", currentProjectionSize,
    provider.id)` + `console.error`.
  - `consolidation-hook.ts`: `dismiss(threadIds[], triggerThreadId?)` flips all statuses then
    fires the handler once; update `ConsolidationHandler` type.
  - `index.ts`: replace the per-thread loop with the single batch `hook.dismiss(toDismiss)` call,
    preserving filter/finally/non-fatal discipline + the S1 flush ordering.
- **Re-assert carried tests under new semantics:**
  - `consolidation-hook.test.ts` → batch signature (records array + trigger; size-1 still flips).
  - `distiller-registration.test.ts` → `facts_produced` = resulting-projection size;
    `trigger="dismiss"` → `"reprojection"`; B1 throwing-distiller test stays (now via batch path).
  - `fixed-marker-provider.test.ts` → per-thread count-summary becomes set assertions over all
    threads (one fact per thread).
  - `distiller-integration.daemon.test.ts` → swap-proof + cross-thread + lossless + observable
    converted to set-membership / fresh-store isolation (file header warns of the shared on-disk
    DB race; under all-threads projection isolation is now mandatory). `distillation-observable`
    `trigger` `"dismiss"` → `"reprojection"`; failure (`reprojection-failed`) observably distinct
    from empty-success (`reprojection`, `facts_produced=0`). Lossless: `messages`/`mutations`
    byte-identical across a full re-projection via the registration/replace path.
- **Run:** `bun test` (full), then `bun run lint:strict` and typecheck — all exit 0.

## Test plan
All tests use REAL SQLite (fresh `mkdtempSync` store per test or isolated shared-daemon dirs).
The ONLY permitted stub is a throwing/deterministic fake *provider*.

| Test | New assertion shape |
|---|---|
| `store.test.ts` — replaceProjection | machine facts dropped+reinserted as the clean set; pre-existing human fact present (5e); event rows landed — atomic. |
| `store.test.ts` — expiry (D7, new) | `expiry <= now` NOT returned; `null`/`> now` returned. |
| `store.test.ts` — author ordering (D6, new) | human fact precedes machine fact in the slice. |
| `dumb-tail-provider.test.ts` | `distill` over 2+ threads → facts from ALL threads (set); `threadId===triggerId`; per-thread `DISTILL_TAIL_N` bound; tombstone/quarantine skips unchanged. |
| `fixed-marker-provider.test.ts` | exactly one count-fact PER thread (set over `thread:<id> has <N> live messages`). |
| `distiller-registration.test.ts` — counts | `facts_produced`==resulting clean count; `trigger="reprojection"`; clean/quarantine/scope tests still pass. |
| `distiller-registration.test.ts` — throwing provider (new) | seed → throw → projection INTACT, `reprojection-failed` rows, `facts_produced`=unchanged size, `console.error`. "Never an empty projection." |
| `consolidation-hook.test.ts` | batch `dismiss([t])` flips status + fires handler once with array+trigger; default no-op still flips. |
| `dismiss-on-close.daemon.test.ts` (new/extended) | one socket, 2 threads → close → exactly ONE `reprojection` row per dismissed thread (2 total), both dismissed, no double-reprojection. **requires runtime proof; this test is the mechanical evidence.** |
| `distiller-integration.daemon.test.ts` — swap-proof | all providers project ALL threads from the same archive; fresh store / set-membership; messages byte-identical across swap. |
| `distiller-integration.daemon.test.ts` — forget-survives-re-derive | forget a message → re-project → scrubbed content absent from every fact. |
| `distiller-integration.daemon.test.ts` — lossless | `messages`/`mutations` byte-identical across a full re-projection. |
| `distiller-integration.daemon.test.ts` — observable | every re-projection writes per-thread rows; failure observably distinct from empty-success. |
| Full gate | `bun test` + `bun run lint:strict` + typecheck exit 0; frozen surfaces byte-unchanged. |

## ADR worthy: no
This chunk IMPLEMENTS ADR-0012 (5b/5d/5e, decision 6 swappable provider, HARD INVARIANT 1/3)
and the Lior-signed spec (D3–D7). No new product decision, dependency, protocol, or boundary.
Spec D2/q#002 explicitly states this feature implements ADR-0012 with NO new ADR; the wire
stays frozen. `trigger="reprojection"`/`"reprojection-failed"` are new string values in an
existing free-TEXT column (no schema migration). Batch-dismiss is internal daemon behavior on
an already-frozen wire. **Confirmed: no ADR.**
