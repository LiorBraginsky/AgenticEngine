> 🗄️ ARCHIVED 2026-07-13 — shipped. Historical record; do not edit.

# Memory Action Tools (2c) — Chunk 01 "Action core" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the daemon-internal `MemoryActionPort` (forget + remember write actions, no LLM), its guardrail package, the d5 re-derivation suppression revival, the `editFact` machine-ctx hardening, and a durable audit trail with an additive read path — provable end-to-end on real SQLite alone.

**Architecture:** First extract the welded rule-gated apply logic out of the distiller into a shared `applyFactOp` primitive (pure refactor). Then revive the dormant `forgotten_facts` machinery + add durable audit storage + an additive read path. Then build `MemoryActionPort` over the real `MemoryStore`/`WriteGate`/`RuleBasedScanner` + the extracted apply, deriving typed results itself (never inferring from void returns), enforcing a shared per-turn cap, and writing an audit event on every path. No LLM, no `tools[]`, no wire/provider change (all chunk-02+).

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (real DB, no mocks); `bun test`; existing memory package under `packages/daemon/src/memory/`.

## Status: shipped — merged to `main` (PR #86); feature verified-done + Lior's live §6.1 demo signed 2026-07-13

> **Review outcome (2026-07-10).** engine-reviewer: 0 blockers / 0 majors. hard-reviewer (frontier
> second pass, layered — justified by the security-critical action-core): found **1 MAJOR** — d5
> suppression bypassable by a connector-word rephrase (the D6b consult keyed on STRICT
> `normalizeFactText` while the dedup one line later keyed on RELAXED `dedupConnectorKey`, making the
> suppression strictly weaker than the dedup). **FIXED** (commit `3bf20b6`: aligned the whole d5 chain
> to the relaxed key; connector-class bypass empirically confirmed CLOSED across all 3 op shapes, all
> sites, property-tested over 16 rephrase classes) + 6 reviewer minors/nits fixed. **1 MEDIUM residual
> FLAGGED, not fixed (§7.2):** the consult matches on display-text not the distiller `canonical` key →
> a same-canonical reword (cross-language) can still slip past → spec-compliant per §3.6 D6b ("text"),
> recorded in memory-backlog §B + §D (2d hybrid pass). Honest-liveness comment pass: `475c342`.
> Final gate at HEAD `475c342`: typecheck 0 · lint:strict 0 · `bun test` 647/0 · frozen byte-diff empty.
> All 6 mechanical DoD blocks proven on real sqlite (the scripted-tool_use prod-boundary + real-API
> probe are correctly chunk-02's). Steps 1–3 committed `1facf45` / `1d65746` / `975b16b`.

## Global Constraints

- **GATE:** Do not start until spec status is `accepted` and ADR-0016 is `accepted`. Both are `accepted` (2026-07-10) — confirmed in the file front-matter. Proceed.
- **No LLM / no `tools[]` / no provider change** — chunk-02. This chunk is provable on real SQLite alone.
- **DO NOT TOUCH (frozen):** `packages/protocol/**`, `packages/daemon/src/providers/mock-provider.ts` (mock-agent), `packages/daemon/src/providers/anthropic-api-provider.ts` (chunk-02), `packages/daemon/src/providers/system-prompt.ts` (chunk-03), `packages/daemon/src/index.ts` DI wiring (chunk-02).
- **Additive-only DDL:** `CREATE TABLE IF NOT EXISTS` only. **NEVER `ALTER`** any table; **never `ALTER distilled_facts`**.
- **Never throw across the port boundary** (known-gotcha #9): every port path returns a typed result.
- **B1 invariant (ADR-0015 dec.2):** the fact path NEVER touches `messages`/`mutations`, never calls `tombstoneFact`, never scrubs a message.
- **Fact source-independence (ADR-0012 rider Ruling 2):** nothing here touches source messages.
- **Build guards (spec §3.2/§3.5 d6):** the port NEVER calls `store.deleteMachineFactsByForget` (multi-row over-delete) — single-row `WriteGate.forgetFactById` only; any REPLACE goes through the extracted apply's `updateFactById` — **NEVER `editFactById`** (unconditionally stamps `authored_by:'human'` — the 5e jackpot).
- **Real SQLite throughout; no mocked store/Hatch/port internals.** `bun test` + typecheck + `lint:strict` green; frozen surfaces byte-diff empty at PR time.
- **ONE exported cap constant:** `MEMORY_ACTIONS_MAX_PER_TURN = 3` (spec §3.4 D4c). Chunk-02's loop imports the same constant.

---

## Reality check

All 10 verifications performed in-code (via Grep/Read). Each is **confirmed** unless marked. No spec claim is false in-code.

1. **`forgotten_facts` current dormancy — CONFIRMED (dormant, table + primitives present, no live caller).**
   - Table exists with full columns: `packages/daemon/src/memory/schema.ts:89-99` (+ index `idx_forgotten_norm`).
   - Primitives exist but are documented dormant: `recordForgottenFact` (`store.ts:310`), `readForgottenFacts` (`store.ts:333`), `isForgottenNormalizedText` (`store.ts:343`), `clearForgottenByNormalizedText` (`store.ts:355`); block header `store.ts:292-302` states "dormant substrate … no live per-dismiss consumer."
   - **No live writer:** `WriteGate.forgetFact` no longer writes it (`write-gate.ts:111-133`, comment "No `forgotten_facts` write on this path (Ruling 1-b)"); `WriteGate.edit`'s un-forget block was removed (`write-gate.ts:237-240`).
   - **No live reader:** read-side suppression removed (`store.ts:280-290`); smart-distiller `retrieve()` backstop removed (`providers/smart-distiller-provider.ts:19,449,623-625`). Chunk-01 revives writer (D6a) + reader (D6b) + clear (D6c/D6e). Matches spec §3.6 build-note exactly.

2. **`editFact` machine-ctx guard current state — CONFIRMED (guards only machine-over-HUMAN today; needs outright machine-ctx reject).**
   - `WriteGate.editFact` at `write-gate.ts:198-208`; the guard is `write-gate.ts:206` (`if (row.authored_by === "human" && ctx.authored_by === "machine") return false;`); the hazard is spelled out in the comment `write-gate.ts:202-205`.
   - The store corroborates the exact fix: `store.editFactById` comment `store.ts:915-919` — "If 2c … is ever wired through editFact, close this (reject machine ctx in WriteGate.editFact …)."
   - **Note (not a contradiction):** spec cites `203-206`; the operative statement is line `206`. The fix: reject ANY machine ctx outright, before delegating.

3. **The rule-gated apply logic welded inside `distillOneThread` — CONFIRMED; extraction boundary identified.**
   - `packages/daemon/src/memory/distiller-registration.ts`, function `distillOneThread` (`distiller-registration.ts:62-307`). The per-op apply logic is the **Phase-3 loop body** `distiller-registration.ts:180-292`: ordinal→`candidateIds` resolution (181-185), optimistic-concurrency re-read + never-replace-human demote (187-212), and the replace→`updateFactById` (222-230) / append→`appendToFactById`→dedup→`insertFact` (231-269) / new→dedup→`insertFact` (270-291) branches. The **side-effects to leave OUT** of the extracted unit: the two watermark advances `advanceDistilledThrough`/`advanceDistilledThroughTurn` (`distiller-registration.ts:295-296`) and the `insertDistillationEvent` (`distiller-registration.ts:306`). The extracted unit must be callable with a resolved `targetId` (not a `DistillDelta`) and perform NO watermark/distill-event writes. Ordinal→id resolution stays in each caller (distiller uses `delta.candidateIds`; the port uses its per-turn map).

4. **`Hatch.forgetFactById` signature — CONFIRMED (`void`, idempotent, cannot signal applied-vs-refused).**
   - `Hatch.forgetFactById(factId, ctx, reason?): void` (`hatch.ts:99-101`) → `WriteGate.forgetFactById(factId, ctx, reason?): void` (`write-gate.ts:150-183`). Idempotent: unknown id → no-op return (154-163); machine-over-human → no-op return (165-174); else `store.deleteFactById` (175). The typed result CANNOT be inferred from the void return — the port MUST pre-resolve the row and confirm-after (D2c). Confirmed.

5. **Retrieve/injected-fact id availability — CONFIRMED (`DistilledFactRow.id` present; chunk-01 accepts a pre-built ordinal map).**
   - `DistilledFactRow` carries `id` (`store.ts:96-98`, "Stable uuid … used by forgetFactById"). The retrieve id-exposure / ordinal-map SOURCE is chunk-02 (spec §3.3 D3b + Notes). Chunk-01's port **accepts** an ordinal map (`Map<number,string>`) as an input on the per-turn context and is unit-tested by constructing it directly. Seam kept as spec requires.

6. **Audit-event storage — CONFIRMED convention; new table proposed.**
   - DDL convention = `CREATE TABLE IF NOT EXISTS` inside `SCHEMA_DDL` (`schema.ts:28-152`), additive side tables, no `ALTER`. Nearest templates: `replaced_facts` (`schema.ts:143-151`) and `forgotten_facts` (`schema.ts:89-99`). New table `memory_action_events` (below) matches convention; queryable by thread via an index. Confirmed.

7. **Additive READ path — CONFIRMED (`hatch.view` returns a plain object; `GET /memory/thread/:id` is `Response.json(result)`).**
   - `Hatch.view` returns `HatchViewResult { messages, distilledFacts, distillationEvents }` (`hatch.ts:31-64`). `GET /memory/thread/:id` → `handleThread` → `Response.json(await deps.hatch.view(id))` (`http-routes.ts:116-119, 156-174`). Adding `memoryActionEvents` to `HatchViewResult` flows to the HTTP response automatically (additive-on-wire). The additive-on-type consumption at the overlay is chunk-04's; chunk-01 does storage + hatch/HTTP read + a test asserting the field appears. Confirmed.

8. **`RuleBasedScanner` — CONFIRMED (exists; `scan(input): ScanVerdict`).**
   - `packages/daemon/src/memory/scanner/memory-scanner.ts:39-61`: `class RuleBasedScanner implements MemoryScanner` with `scan({ content, scope?, authored_by }): { ok:true } | { ok:false, rule, detail }`. It is the mandatory 5d dependency of the port for the remember path (no existing gate method scans-and-inserts a distilled fact). Confirmed.

9. **Dedup/canonical machinery + `updateFactById` — CONFIRMED.**
   - `factExistsByDedupKey(text): boolean` (`store.ts:497-509`, suppress-only, normalize + connector-key over the corpus). `updateFactById(id, u, ctx, distillerVersion): boolean` records replaced text via `recordReplacedFact` and refreshes FTS (`store.ts:880-894`). `editFactById` unconditionally stamps `human` (`store.ts:910-928`) — the port/apply must NEVER use it. `appendToFactById` (`store.ts:939-951`), `insertFact` (`store.ts:852-863`). Confirmed.

10. **`forgetFactById` FTS/topics cleanup + `distilled_facts` never-`ALTER` — CONFIRMED.**
    - `deleteFactById` (`store.ts:1008`) fires the `AFTER DELETE` trigger `trg_distilled_facts_ad` (`schema.ts:122-127`) which deletes `fact_fts` + `fact_topics` rows for the id. `distilled_facts` is `CREATE TABLE IF NOT EXISTS` (`schema.ts:60-70`), never `ALTER`ed. Trigger-DoD (count-equality) is testable. Confirmed.

**Flagged (architect-time interpretation, not a contradiction):** a scanner-rejected remember has no inserted fact row and no message id, so "quarantine record" (spec §3.5 d6 / §5) has no natural `target_id`. Resolution adopted below: write a `quarantine_markers` row via the existing `recordQuarantine({ target_id: crypto.randomUUID(), rule: verdict.rule })` (INSERT OR IGNORE, `store.ts:583-587`) as the durable "flagged & refused" ledger entry, alongside the audit event (`outcome: 'refused-rejected_by_scan'`, with the raw fact text). This satisfies the DoD literally with an existing primitive; the synthetic id is inert (no downstream skip consumer). Worker: do not invent a new quarantine table.

> **Orchestrator note (helpers to verify at build, not spec-frozen):** the plan references a few store
> helpers the reality-check did not individually confirm exist — `readReplacedFacts(id)`,
> `hasHumanFactWithNormalizedText(norm)`, `readQuarantineMarkers()`. If any is absent, add it as a
> small ADDITIVE read helper (consistent with the additive posture; no `ALTER`, no behavior change to
> existing callers) — this is implementation shape within spec §5/§7 latitude, not new scope. If a gap
> turns out to need a design call, FLAG (§7.2) rather than invent.

---

## File Structure

- `packages/daemon/src/memory/apply-fact-op.ts` **(new)** — the extracted shared fact-mutation primitive (`applyFactOp`); growable per-op handler set (D7a-bis rider). Imported by both the distiller and the port. Placed in its own file to avoid the port importing the whole `distiller-registration` module (cycle-free).
- `packages/daemon/src/memory/apply-fact-op.test.ts` **(new)** — unit tests on real sqlite.
- `packages/daemon/src/memory/distiller-registration.ts` **(modify)** — Phase-3 loop calls `applyFactOp`; add the D6b `forgotten_facts` consult before apply.
- `packages/daemon/src/memory/schema.ts` **(modify)** — add `memory_action_events` table (+ index).
- `packages/daemon/src/memory/store.ts` **(modify)** — add `recordMemoryActionEvent`, `readMemoryActionEvents`, `readFactById`; add `MemoryActionEventInput`/`MemoryActionEventRow` types.
- `packages/daemon/src/memory/hatch.ts` **(modify)** — `HatchViewResult.memoryActionEvents` + `view()` reads it.
- `packages/daemon/src/memory/write-gate.ts` **(modify)** — `editFact` rejects machine ctx outright; `editFact` clears matching `forgotten_facts` on a successful human edit (D6c).
- `packages/daemon/src/memory/providers/smart-distiller-provider.ts` **(modify, guarded/minimal)** — the soft prompt nudge (D6c soft layer), gated on non-empty `forgotten_facts` so existing prompt tests stay green.
- `packages/daemon/src/memory/memory-action-port.ts` **(new)** — `MEMORY_ACTIONS_MAX_PER_TURN`, `MemoryActionTurnContext`, `MemoryActionResult`, `MemoryActionPort` (forget + remember).
- `packages/daemon/src/memory/memory-action-port.daemon.test.ts` **(new)** — behavioral proofs on real sqlite (`.daemon.test.ts` per repo convention for real-store integration).
- **Tests touched (modify):** `store.test.ts`, `hatch.daemon.test.ts`, `http-routes.daemon.test.ts`, `write-gate.test.ts`, `distiller-registration.test.ts`.

---

## Steps

### Step 1 — Extract the rule-gated apply primitive (`applyFactOp`) — PURE REFACTOR GATE

**Named DoD (must hold before any new capability):** all pre-existing v2 distiller tests stay green; the extracted unit advances NO watermark and writes NO distill event (spec §4 item 6 / §3.7a-bis).

**Files:**
- Create: `packages/daemon/src/memory/apply-fact-op.ts`
- Create: `packages/daemon/src/memory/apply-fact-op.test.ts`
- Modify: `packages/daemon/src/memory/distiller-registration.ts:180-292` (replace the inline per-op body with a call to `applyFactOp`)

**Interfaces — Produces:**
```ts
// apply-fact-op.ts
import type { MemoryStore } from "./store.js";
import { normalizeFactText } from "./normalize-fact-text.js";

/** ONE shared fact-mutation primitive with a GROWABLE per-op handler set (ADR-0016 D7a-bis rider).
 *  Today: new | append | replace. Future topic-consolidation ops land as NEW handlers (backlog §E) —
 *  DO NOT build them here. Callable WITHOUT a DistillDelta; performs NO watermark / distill-event writes.
 *  Optimistic-concurrency + never-replace-human demote + record-replaced live HERE. */
export interface ApplyFactOpInput {
  op: "new" | "append" | "replace";
  fact: string;                 // user-language display text
  canonical: string;            // match key; caller may pass "" ⇒ falls back to normalizeFactText(fact)
  topics: string[];
  provenance: string;           // e.g. `thread:<id>`
  targetId?: string;            // resolved id (caller resolves ordinal→id); undefined ⇒ treated as new
  expectedTargetText?: string;  // for non-new ops: optimistic-concurrency check text
}
export type ApplyFactOutcome =
  | "inserted" | "replaced" | "appended" | "deduped"
  | "demoted-inserted" | "demoted-deduped";
export interface ApplyFactOpResult { outcome: ApplyFactOutcome; factId?: string; }

/** actor = provider.id for the distiller, or "agent" for the port. Runs inside the caller's tx
 *  if any (bun:sqlite nested SAVEPOINT composes — the store primitives self-wrap). */
export function applyFactOp(store: MemoryStore, input: ApplyFactOpInput, actor: string): ApplyFactOpResult;
```

Behavior (port the existing logic verbatim, no semantic change):
1. `const canonical = input.canonical || normalizeFactText(input.fact);`
2. Resolve `effectiveOp`/`targetId` demotes exactly as `distiller-registration.ts:187-212`: if `op !== "new"` and `targetId` set, re-read `SELECT fact, authored_by FROM distilled_facts WHERE id = ?`; demote to `new` (clear `targetId`) if row null, `fact !== expectedTargetText`, or `authored_by === "human"`. If `op !== "new"` and no `targetId` → demote to `new`.
3. Apply:
   - `replace` + `targetId` → `store.updateFactById(targetId, { fact, canonical, confidence: 1, topics }, { actor, reason: "apply-replace" }, actor)` → `{ outcome: "replaced", factId: targetId }`.
   - `append` + `targetId` → read current `fact_fts.canonical`, space-join with `canonical` (merged, per `distiller-registration.ts:239-247`), `store.appendToFactById(targetId, fact, merged)`; if `true` → `{ outcome: "appended", factId: targetId }`; if `false` → fall through to the new-insert branch below (with `demoted-*` outcome).
   - `new` (original or demoted) → dedup: `if (store.factExistsByDedupKey(canonical)) return { outcome: <"deduped"|"demoted-deduped"> };` else `const id = store.insertFact({ fact, canonical, topics, provenance, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, actor); return { outcome: <"inserted"|"demoted-inserted">, factId: id };`
   - Use the `demoted-*` outcome variants when `effectiveOp` was demoted from a non-new op (so callers can observe the demotion; the distiller ignores the return).

- [ ] **Step 1.1 — Write failing unit tests** (`apply-fact-op.test.ts`, real sqlite via `new MemoryStore({...})` temp file). Cover: `new` inserts (machine, cross-thread, `thread:<id>` provenance, id stable & returned); `new` exact-dup → `deduped` no insert; `replace` with matching `expectedTargetText` → text replaced, id stable, `replaced_facts` row written; `replace` with mismatched `expectedTargetText` → demoted → competing insert (`demoted-inserted`), original untouched; `replace` targeting a `human` row → demoted (never overwrites human); `append` within cap → appended + merged canonical searchable; `append` over cap → demote-insert. Assert NO `distillation_events` row and NO `thread_distill_state` change are produced by `applyFactOp`.

```ts
test("replace with matching expected text keeps id stable and records replaced text", () => {
  const id = store.insertFact({ fact: "favorite color blue", canonical: "favorite color blue", topics: [], provenance: "thread:t1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "d");
  const r = applyFactOp(store, { op: "replace", fact: "favorite color red", canonical: "favorite color red", topics: [], provenance: "thread:t1", targetId: id, expectedTargetText: "favorite color blue" }, "agent");
  expect(r).toEqual({ outcome: "replaced", factId: id });
  expect(store.readFactById(id)!.fact).toBe("favorite color red");   // readFactById added in Step 3; if running Step 1 alone, assert via readDistilledFacts
  expect(store.readReplacedFacts(id).map(x => x.replaced_text)).toContain("favorite color blue");
});
```
- [ ] **Step 1.2 — Run, verify FAIL** — `bun test packages/daemon/src/memory/apply-fact-op.test.ts` → FAIL (module/function not found).
- [ ] **Step 1.3 — Implement `apply-fact-op.ts`** per the interface + behavior above.
- [ ] **Step 1.4 — Rewire the distiller loop.** In `distiller-registration.ts` Phase-3 tx, keep ordinal→id resolution (`targetOrdinal → delta.candidateIds[targetOrdinal-1]`) and the `provenance = "thread:${threadId}"` line; replace lines `187-292` with:
```ts
applyFactOp(store, {
  op: op.op, fact: op.fact, canonical: op.canonical || normalizeFactText(op.fact),
  topics: op.topics, provenance,
  targetId, expectedTargetText: op.expectedTargetText,
}, provider.id);
```
Leave the two watermark advances (`295-296`) and `insertDistillationEvent` (`306`) exactly where they are — OUTSIDE `applyFactOp`.
- [ ] **Step 1.5 — Run the full pre-existing distiller suite, verify GREEN** — `bun test packages/daemon/src/memory/distiller-registration.test.ts packages/daemon/src/memory/distiller-integration.daemon.test.ts packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` → all PASS (named DoD). Then `bun test packages/daemon/src/memory/apply-fact-op.test.ts` → PASS.
- [ ] **Step 1.6 — Typecheck + lint** — project typecheck + `lint:strict` green.
- [ ] **Step 1.7 — Commit** — `feat(2c-01): extract shared applyFactOp primitive (pure refactor; distiller tests green)`.

---

### Step 2 — Guardrail fix, audit storage + additive read path, d5 revival

Three cohesive sub-areas; each independently TDD'd. All additive/guardrail wiring into existing modules.

**Files:**
- Modify: `packages/daemon/src/memory/write-gate.ts:198-208` (2A) and `:218-241` (2C-clear helper reuse)
- Modify: `packages/daemon/src/memory/schema.ts` (2B — add table)
- Modify: `packages/daemon/src/memory/store.ts` (2B — add methods/types)
- Modify: `packages/daemon/src/memory/hatch.ts` (2B — additive field + read)
- Modify: `packages/daemon/src/memory/distiller-registration.ts` (2C — D6b consult)
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts` (2C — soft nudge, guarded)
- Test: `write-gate.test.ts`, `store.test.ts`, `hatch.daemon.test.ts`, `http-routes.daemon.test.ts`, `distiller-registration.test.ts`

**Interfaces — Produces:**
```ts
// store.ts
export interface MemoryActionEventInput {
  thread_id: string;
  action: "forget" | "remember" | "reassert";
  outcome: string;      // "applied" | `refused-${code}`
  fact_text: string;    // raw fact text (forgotten / remembered / attempted)
  actor: string;        // "agent"
}
export interface MemoryActionEventRow { action: string; outcome: string; fact_text: string; actor: string; created_at: number; }
recordMemoryActionEvent(e: MemoryActionEventInput): void;
readMemoryActionEvents(threadId: string): MemoryActionEventRow[];   // ORDER BY created_at ASC
readFactById(id: string): DistilledFactRow | null;                  // pre-resolve for the port (D2c)

// hatch.ts — HatchViewResult gains:
memoryActionEvents: MemoryActionEventRow[];
```

**2A — `editFact` machine-ctx hardening (write-gate.ts)**
- [ ] **2A.1 — Failing test** (`write-gate.test.ts`): machine-ctx `editFact` on a **machine** fact returns `false` AND leaves the row unchanged (`authored_by` stays `machine`, text unchanged) — proving no promote-to-human; machine-ctx on a human fact still `false`; human-ctx unchanged (still applies).
- [ ] **2A.2 — Run, verify FAIL** (machine-over-machine currently returns via `store.editFactById` → promotes to human).
- [ ] **2A.3 — Implement.** Replace the guard at `write-gate.ts:206` so ANY machine ctx is rejected before delegating:
```ts
// Defense-in-depth (spec §3.2 D2d): a machine ctx must NEVER reach editFactById (it stamps 'human' → 5e jackpot).
if (ctx.authored_by === "machine") return false;
```
(Keep the `!row` early return at `:201`.)
- [ ] **2A.4 — Run, verify PASS.**

**2B — Audit table + store methods + additive read path**
- [ ] **2B.1 — Failing tests.** `store.test.ts`: `recordMemoryActionEvent` then `readMemoryActionEvents(threadId)` returns the rows in insert order, scoped by thread. `hatch.daemon.test.ts`: `hatch.view(threadId)` returns `memoryActionEvents` populated. `http-routes.daemon.test.ts`: `GET /memory/thread/:id` (token-gated) JSON body contains `memoryActionEvents` (additive; existing fields unchanged).
- [ ] **2B.2 — Run, verify FAIL.**
- [ ] **2B.3 — Add DDL** to `SCHEMA_DDL` (`schema.ts`, append inside the template):
```sql
-- 2c chunk-01: durable audit of agent memory actions (spec §3.9 D9a). Additive, CREATE-only, no ALTER.
CREATE TABLE IF NOT EXISTS memory_action_events (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  action      TEXT NOT NULL,   -- 'forget' | 'remember' | 'reassert'
  outcome     TEXT NOT NULL,   -- 'applied' | 'refused-<code>'
  fact_text   TEXT NOT NULL,   -- raw fact text
  actor       TEXT NOT NULL,   -- 'agent'
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_action_events_thread ON memory_action_events(thread_id);
```
- [ ] **2B.4 — Add store methods** (`store.ts`): `recordMemoryActionEvent` (INSERT with `crypto.randomUUID()` + `Date.now()`), `readMemoryActionEvents` (`SELECT action, outcome, fact_text, actor, created_at FROM memory_action_events WHERE thread_id = ? ORDER BY created_at ASC`), `readFactById` (`SELECT id, fact, provenance, scope, expiry, confidence, authored_by FROM distilled_facts WHERE id = ?` → `DistilledFactRow | null`).
- [ ] **2B.5 — Additive read path** (`hatch.ts`): add `memoryActionEvents: MemoryActionEventRow[]` to `HatchViewResult` (import the type from `store.js`); in `view()` add `const memoryActionEvents = this.store.readMemoryActionEvents(threadId);` and include it in the returned object. `http-routes.ts` needs NO change (it already `Response.json`s the whole result) — the test in 2B.1 guards this.
- [ ] **2B.6 — Run, verify PASS.**

**2C — d5 revival: D6b consult + D6c un-forget clear + soft nudge**
- [ ] **2C.1 — Failing tests** (`distiller-registration.test.ts`, echo-stub distiller = a `MemoryProvider` whose `distill` returns scripted ops): (i) with a `forgotten_facts` row for text X present, a distill emitting X as `op:'new'` is suppressed (no insert); RED without the consult. (ii) same for `op:'append'` (resulting text X). (iii) same for `op:'replace'` whose replacement text is X → target left untouched (non-destructive), no resurrection of X. (iv) precedence: if a **human** fact with normalized X exists, the consult does NOT suppress (human ▷ forget-record). `write-gate.test.ts`: a human `editFact` to text X clears a matching `forgotten_facts` row (D6c).
- [ ] **2C.2 — Run, verify FAIL.**
- [ ] **2C.3 — Implement D6b consult.** In `distiller-registration.ts` Phase-3 loop, BEFORE resolving/calling `applyFactOp`, add:
```ts
const norm = normalizeFactText(op.fact);
// D6b: suppress re-derivation of a tool-forgotten fact — MACHINE candidates only, precedence:
// human fact ▷ human un-forget ▷ forget record ▷ machine re-derivation.
if (store.isForgottenNormalizedText(norm) && !store.hasHumanFactWithNormalizedText(norm)) {
  memDebug("distill", { threadId, forgottenSuppressed: previewStr(op.fact) });
  continue; // drops new/append; skips replace non-destructively (target left as-is)
}
```
- [ ] **2C.4 — Implement D6c clear.** In `WriteGate.editFact`, after `store.editFactById(...)` returns `true`, call `this.store.clearForgottenByNormalizedText(normalizeFactText(newText));` (import `normalizeFactText` — already imported in `write-gate.ts:5`). This is the "human un-forget" leg (a human authoring/editing a matching fact clears the record).
- [ ] **2C.5 — Soft prompt nudge (D6c soft layer, guarded).** In `smart-distiller-provider.ts`, when composing the distill prompt, if `store.readForgottenFacts()` is **non-empty**, append a short instruction listing their `raw_text`: "Do NOT re-emit facts the user asked to forget: …". Gate strictly on non-empty so the common-case prompt is byte-unchanged and existing tests stay green. Honestly ranked a nudge, not defense; NO DoD/test gate on it.
- [ ] **2C.6 — Run, verify PASS** — the 2C tests + the full pre-existing distiller suite (2C.3 must not regress it).
- [ ] **2C.7 — Typecheck + lint green. Commit** — `feat(2c-01): editFact machine-ctx guard + audit storage/read path + d5 forgotten_facts revival`.

---

### Step 3 — `MemoryActionPort` (forget + remember; cap; typed results; audit on every path)

**Files:**
- Create: `packages/daemon/src/memory/memory-action-port.ts`
- Create: `packages/daemon/src/memory/memory-action-port.daemon.test.ts`

**Interfaces — Consumes:** `applyFactOp` (Step 1); `store.recordMemoryActionEvent`/`readMemoryActionEvents`/`readFactById`/`recordForgottenFact`/`isForgottenNormalizedText`/`clearForgottenByNormalizedText`/`factExistsByDedupKey`/`recordQuarantine` (Steps 2 + existing); `WriteGate.forgetFactById` (existing); `RuleBasedScanner.scan` (existing); `normalizeFactText` (existing).

**Interfaces — Produces:**
```ts
// memory-action-port.ts
export const MEMORY_ACTIONS_MAX_PER_TURN = 3; // spec §3.4 D4c — ONE exported constant; chunk-02 imports it.

/** ONE object per turn (spec §7 CLOSED). chunk-01 constructs it directly in tests; chunk-02 builds it
 *  from the retrieve slice. The port MUTATES actionsUsed. ordinalMap keys are 1-based, derived from the
 *  exact injected `live` list (chunk-02), never raw DB rows. */
export interface MemoryActionTurnContext {
  threadId: string;
  ordinalMap: Map<number, string>; // ordinal → distilled_facts.id
  actionsUsed: number;             // shared cap counter (mutable)
}

export type MemoryActionResult =
  | { ok: true;  action: "forget" | "remember" | "reassert"; factId?: string; message: string }
  | { ok: false; code: "not_in_view" | "stale_target" | "refused_human_fact" | "rejected_by_scan" | "cap_exceeded" | "duplicate"; message: string };

export class MemoryActionPort {
  constructor(store: MemoryStore, gate: WriteGate, scanner: MemoryScanner) {}
  forget(ctx: MemoryActionTurnContext, input: { ordinal: number; expected_text: string; reason?: string }): MemoryActionResult;
  remember(ctx: MemoryActionTurnContext, input: { fact: string; replaces_ordinal?: number; expected_text?: string }): MemoryActionResult;
}
```

**Cap rule (both methods, FIRST):** `if (ctx.actionsUsed >= MEMORY_ACTIONS_MAX_PER_TURN) { audit(outcome:'refused-cap_exceeded'); return {ok:false, code:'cap_exceeded', ...}; }` else `ctx.actionsUsed++;` then proceed. So calls 1–3 proceed, the 4th returns `cap_exceeded`. Every terminal path (applied OR refused) writes exactly one `recordMemoryActionEvent`.

**Expected-text normalization (spec §3.3 D3c):** before matching, strip a leading ordinal prefix defensively — `expected_text.replace(/^\s*\d+\.\s*/, "")` — then `normalizeFactText(...)` both sides and compare to `normalizeFactText(row.fact)`.

**`forget` logic (derive result itself — D2c; never infer from the void return):**
1. Cap check.
2. `const factId = ctx.ordinalMap.get(input.ordinal);` if undefined → `not_in_view` (+audit).
3. `const row = store.readFactById(factId);` if null → `stale_target` (+audit) — resolved but gone.
4. Expected-text mismatch → `stale_target` (+audit), NO mutation.
5. `if (row.authored_by === "human") ` → `refused_human_fact` (+audit, honest message naming the Memory window). Do NOT call the gate.
6. `gate.forgetFactById(factId, { actor: "agent", authored_by: "machine" }, input.reason);` then confirm: `if (store.readFactById(factId) !== null)` → treat as refused (defensive) `stale_target`; else applied.
7. On applied: `store.recordForgottenFact({ raw_text: row.fact, provenance: row.provenance, actor: "agent", authored_by: "machine", reason: input.reason });` (D6a — the store computes `normalized_text` from `raw_text`). Audit `action:'forget', outcome:'applied', fact_text: row.fact`. Return `{ ok:true, action:'forget', factId, message: "Forgotten." }`.

**`remember` logic:**
1. Cap check.
2. `const scan = scanner.scan({ content: input.fact, scope: "cross-thread", authored_by: "machine" });` if `!scan.ok` → `store.recordQuarantine({ target_id: crypto.randomUUID(), rule: scan.rule });` (see Reality-check flag) + audit `outcome:'refused-rejected_by_scan'` + return `{ ok:false, code:'rejected_by_scan', ... }`. NOT inserted.
3. `const norm = normalizeFactText(input.fact); const wasForgotten = store.isForgottenNormalizedText(norm);`
4. **Explicit-target lane** (`replaces_ordinal !== undefined`):
   a. `const factId = ctx.ordinalMap.get(replaces_ordinal);` undefined → `not_in_view`.
   b. `const row = store.readFactById(factId);` null → `stale_target`.
   c. expected-text mismatch (require `expected_text`; compare normalized) → `stale_target`, NO side effect (q#015 R1 rider 1 — never fall through to insert).
   d. `if (row.authored_by === "human")`: exact-dup (`normalizeFactText(input.fact) === normalizeFactText(row.fact)`) → `duplicate` (no-op, +audit); else insert a competing MACHINE fact via `applyFactOp(store, { op:"new", fact: input.fact, canonical: norm, topics: [], provenance: `thread:${ctx.threadId}` }, "agent")` → `{ ok:true, action:'remember', factId, message: "Remembered. Your pinned fact still stands." }` (D7a — human wins at injection).
   e. else (machine target): exact-dup → `duplicate`; else `applyFactOp(store, { op:"replace", fact: input.fact, canonical: norm, topics: [], provenance: `thread:${ctx.threadId}`, targetId: factId, expectedTargetText: row.fact }, "agent")` → replaced (id stable, replaced text recorded).
5. **No-target lane:** `if (store.factExistsByDedupKey(norm))` → `duplicate` no-op (+audit); else `applyFactOp(store, { op:"new", fact: input.fact, canonical: norm, topics: [], provenance: `thread:${ctx.threadId}` }, "agent")` → inserted (machine, cross-thread, thread provenance — D7b/D7c).
6. **D6e re-assertion:** if the call resulted in an insert/replace AND `wasForgotten` → `store.clearForgottenByNormalizedText(norm);` and set the audit + result `action` to `'reassert'` (its OWN event type, distinct from `remember` — q#015 rider). Otherwise `action:'remember'`.
7. Audit + return.

- [ ] **Step 3.1 — Failing tests** (`memory-action-port.daemon.test.ts`, real `MemoryStore` temp db + real `WriteGate` + real `RuleBasedScanner`; construct `MemoryActionTurnContext` directly with a hand-built `ordinalMap`). Prove:
  - **Forget round-trip:** seed a machine fact, map ordinal 1→id, `forget({ordinal:1, expected_text: <fact>})` → row gone, `fact_fts`/`fact_topics` cleaned (count-equality via a `SELECT count(*)`), `forgotten_facts` row present, `memory_action_events` row `action:'forget' outcome:'applied'`; `messages`/`mutations` byte-intact (assert counts unchanged).
  - **remember→REPLACE:** explicit target changed-attribute → id stable, `replaced_facts` records old text; mismatched `expected_text` on explicit target → `stale_target` + NO insert + NO replace; no-target exact-dup → `duplicate` no-op; human-target changed-attribute → competing machine insert (human untouched) with the honest message.
  - **d5 D6e:** forget X (records `forgotten_facts`), then `remember(X)` → `action:'reassert'`, `forgotten_facts` row cleared, X present.
  - **Guardrails (all typed, none throw):** ordinal out of map → `not_in_view`; concurrent text change (mutate the row after building the map) → `stale_target`; human fact forget → `refused_human_fact`; scanner-flagged remember (e.g. `input.fact` containing "ignore previous instructions") → `rejected_by_scan` + `readQuarantineMarkers()` grew by one + fact NOT inserted; 4th action in one shared context → `cap_exceeded`. Wrap each call in `expect(() => port.forget(...)).not.toThrow()`.
  - **`MEMORY_ACTIONS_MAX_PER_TURN === 3`** asserted from the exported constant.
- [ ] **Step 3.2 — Run, verify FAIL.**
- [ ] **Step 3.3 — Implement `memory-action-port.ts`** per the interfaces + logic above.
- [ ] **Step 3.4 — Run, verify PASS.**
- [ ] **Step 3.5 — Full memory-package suite + typecheck + `lint:strict`** — `bun test packages/daemon/src/memory/` all green; frozen surfaces byte-diff empty (`git diff --stat` on `packages/protocol/`, `providers/mock-provider.ts`, `providers/anthropic-api-provider.ts`, `providers/system-prompt.ts` → empty).
- [ ] **Step 3.6 — Commit** — `feat(2c-01): MemoryActionPort — forget/remember paths, cap, typed results, audit`.

---

## ADR worthy: no

The chunk consumes accepted **ADR-0016** (the capability + guardrail package; decisions 4c/4d/5/6), **ADR-0015** (B1 separate-table invariant + decision-6 machine-ctx contract), and **ADR-0012** (5d/5e + rider Ruling 2 source-independence). No new binding decision is introduced: the audit table, `readFactById`, and the `applyFactOp` file placement are additive implementation shape governed by existing ADRs; the synthetic-`target_id` quarantine and the guarded soft nudge are within spec §5/§7 architect-time latitude. Nothing reopens a frozen decision or adds a runtime dependency. Ledger expectation (no) holds.

## §7.1 couplings

Touching spec §4 items **2, 3, 6, 7**; each kept additive/non-destructive:

- **Item 2 — `MemoryActionPort` ↔ distiller shared state (optimistic-concurrency posture).** The port writes `distilled_facts`/`forgotten_facts` mid-turn while a dismissed-elsewhere distill may run. Governed by the SAME answer as ADR-0015: `applyFactOp`'s optimistic-concurrency re-read + the port's D3c expected-text pre-check make interleaves non-destructive (a moved target demotes to a competing insert, never a clobber). A port write is a plain atomic tx like an HTTP forget — the MAJOR-3 promise queue is NOT on this path (kept in `distiller-registration.ts` untouched).
- **Item 3 — `forgotten_facts` live writer + reader revived.** Writer = the port's forget (D6a, `recordForgottenFact`). Reader = the distiller D6b consult (`isForgottenNormalizedText` + `hasHumanFactWithNormalizedText`). Clear = D6c (human `editFact`) + D6e (prompted re-assertion). No schema change — the dormant table/primitives are reused as-is; precedence chain (human ▷ un-forget ▷ forget-record ▷ machine re-derivation) enforced by the consult's human-fact guard. Finding noted for the PR: the table was fully dormant pre-chunk (no live writer/reader).
- **Item 6 — the rule-gated apply extraction.** `applyFactOp` pulled into its own file; the distiller keeps its OWN side-effect set (watermark advances + distill event stay in `distillOneThread`), and the port advances NO watermark and writes NO distill event. Named DoD in Step 1: existing v2 distiller tests stay green + the port path is watermark/event-free (asserted in Step 3.1 by absence of `distillation_events` rows from a port call).
- **Item 7 — audit surface ↔ Memory-window read path.** New `memory_action_events` storage couples to `hatch.view` → `GET /memory/thread/:id`. Additive at every hop: additive field on `HatchViewResult` (type-checked, not casted); `Response.json(result)` carries it additive-on-wire; the overlay's typed consumption + render is chunk-04 (the join re-validated there). Chunk-01 ships storage + hatch/HTTP read + a test asserting the field is present in the HTTP body.
