# v2-03: The Incremental Distiller — Delta Port + Asymmetric-Risk Apply — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All paths are repo-relative to `/Users/lior/WebstormProjects/playground/AgenticEngine`.

## Status: In progress (Phase 2 — implementation)

**Goal:** Replace the global-re-projection distiller strategy (`distill()` → full projection; `replaceProjection` = DELETE-all + INSERT) with an incremental, stable-id distiller that returns a `DistillDelta` of targeted `FactOp`s and applies them in one rule-gated transaction — delivering the STABILITY guarantee the 2026-06-13 demo proved missing.

**Architecture:** Redefine `MemoryProvider.distill` to return a `DistillDelta` (ops over stable fact ids) instead of a `DistillResult` full projection. `SmartDistillerProvider` reads only the just-ended thread's new tail (since its distill watermark), fetches FTS5/BM25 candidates over the **full** corpus (outside any tx), and asks the LLM to propose, per fact, `op` + `targetOrdinal` + `canonical` + `topics` + user-language `fact` + `expectedTargetText`. `distiller-registration.ts` applies the delta: resolve ordinal→id, rule-gate the destructive REPLACE path (out-of-range→`new`, optimistic-concurrency conflict→non-destructive, never-replace-human), advance the per-thread watermark only after all facts land. `FixedMarkerProvider` is retired; `DumbTailProvider` adapts to `op:'new'`-only as the keyless fallback + swap-proof second leg.

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (real, never mocked); `@anthropic-ai/sdk` (Haiku — only the `clientFactory` stubbed in tests); FTS5/BM25 + the stable-id store primitives (consumed from v2-02, not rebuilt).

---

## ⚠️ ORCHESTRATOR DIRECTIVES (read FIRST — these SUPERSEDE the architect steps where they conflict)

The architect's plan is sound and grounded. Two §7.2 spec-fidelity refinements the orchestrator
flagged against frozen artifacts; the worker MUST honor these:

### R1 — Honor spec D-V3c's "ONE tx" literally; deviate only with EVIDENCE (Step 1.5)
Spec §3.3 **D-V3c is a frozen, accepted line**: *"The apply tx is all-or-nothing AND advances the
guard INSIDE it … a partial apply can never mark a thread 'distilled' while its facts didn't land."*

The architect proposed deviating to per-op-atomic + watermark-after, on the assumption that the
v2-02 primitives' self-wrapping `db.transaction` calls FORBID nesting. **That assumption is
unverified and likely wrong** — `bun:sqlite` (like better-sqlite3 it mirrors) supports nested
transactions via SAVEPOINT, so calling `insertFact`/`updateFactById`/`appendToFactById` inside an
outer `db.transaction(...)()` is the EXPECTED-to-work path that yields the spec-literal atomic tx.

**Directive:** in Step 1.5, FIRST implement the spec-literal D-V3c: wrap the whole delta-apply loop
**and** the `advanceDistilledThrough` + `advanceDistilledThroughTurn` calls in ONE
`store.rawDb().transaction(() => { … })()`. Verify it works with a focused test (apply a multi-op
delta; force a throw on the 2nd op; assert NOTHING landed AND the watermark did NOT advance →
next dismiss retries cleanly). Only if nested composition GENUINELY fails (reproduce + capture the
exact error) may you fall back to per-op-atomic + watermark-strictly-after-all-ops. **Either way the
invariant is mandatory: the watermark advances ONLY after all facts have landed (M1 / D-V3c).** Any
forced deviation from "ONE tx" must be (a) documented in the code comment with the failing evidence
and (b) called out in the PR body. Do NOT silently ship the weaker mechanism.

### R2 — Watermark column: resilient read, NO ALTER on the live sqlite (Steps 1.2 / 1.3)
Spec §9 is a frozen constraint: **"no ALTER on the live sqlite."** The new `distilled_through_turn`
watermark column goes into the fresh-store `CREATE TABLE IF NOT EXISTS thread_distill_state` (as the
architect planned) — correct for every fresh store (all of this chunk's tests + the probe). BUT on a
**pre-v2-03 live store** (Lior already ran v2-02), the table exists WITHOUT the column, so
`CREATE TABLE IF NOT EXISTS` is a no-op and a naive `SELECT distilled_through_turn` would CRASH —
and `DumbTailProvider` (the current default) now reads it too, so a live dismiss would break.

**Directive (the ONLY §9-compliant fix — a guarded `ADD COLUMN` is an ALTER and is FORBIDDEN here):**
make the watermark read RESILIENT — at store/schema init, `PRAGMA table_info(thread_distill_state)`;
if `distilled_through_turn` is absent, read/return `0` for it (do NOT ALTER). Default-0 means a live
store reads the WHOLE thread as "new tail" until v2-05 — non-crashing, and any interim machine-fact
duplicates are **wiped by v2-05's migration** (spec §3.8 wipes machine `distilled_facts`). Add a test
that simulates the pre-v2-03 shape (create `thread_distill_state` WITHOUT the column, run init/read →
assert no crash, watermark defaults to 0).

**Forward-flag to v2-05 (record in the PR + ledger):** v2-05's migration MUST (a) add
`distilled_through_turn` to live `thread_distill_state` (its sanctioned live-store touch, §3.8), and
(b) the machine-fact wipe cleans any interim dups produced by the default-0 whole-thread reads in the
v2-03→v2-05 window. v2-05 owns the live-store reconciliation; v2-03 only stays non-crashing.

### Doc-hygiene flag (orchestrator → Jimmy, not a build task)
ADR-0012's header still reads the 2026-06-13 amendment as `proposed` ("Until accepted … framing
stands") although the conveyor ledger records Lior's §5.2 acceptance (PR #61) and v2-01/v2-02 already
shipped against it. v2-03 does NOT edit the ADR (out of scope); flagged so the ADR header gets
reconciled by adr-curator/Lior.

---

## Reality check

Every claim below is grounded in file evidence the architect read. Behavioral/runtime claims are flagged.

**v2-02 store primitives exist with the signatures called** (verified against `packages/daemon/src/memory/store.ts`):
- `insertFact(f: InsertFactInput, distillerVersion: string): string` — returns stable id; writes `distilled_facts` + `fact_fts` + `fact_topics` in one tx. `InsertFactInput` carries `fact, canonical, provenance, scope, expiry, confidence, authored_by, topics`. **Confirmed.**
- `updateFactById(id, u: UpdateFactInput, ctx:{actor,reason?}, distillerVersion): boolean` — REPLACE-in-place, SAME id, refreshes fts/topics, calls `recordReplacedFact` internally; `false` if id absent. **Does NOT do 5e/concurrency gating** (caller's job). `UpdateFactInput = {fact, canonical, confidence, topics}`. **Confirmed.**
- `appendToFactById(id, item, appendedCanonical): boolean` — capped at `APPEND_LIST_CAP=8`; `false` if at cap OR id absent; **caller must pass the FULL merged canonical**. **Confirmed.**
- `recordReplacedFact(factId, replacedText, ctx)` — standalone audit primitive. **Confirmed.**
- `readReplacedFacts(factId): ReplacedFactRow[]`. **Confirmed.**
- `deleteFactById(id): boolean` — AFTER-DELETE trigger cleans derived tables. **Confirmed.**
- `fetchCandidates(query: string): FactCandidate[]` — BM25 over FULL `distilled_facts` corpus via `fact_fts MATCH`, top `CANDIDATE_TOP_K=10`, returns `{id, fact, topics}`. B1 invariant holds (full-corpus, tags don't filter). **Confirmed.**
- `toFtsOrQuery(raw): string` — sanitizes punctuation to OR-of-quoted-terms; `""` when no token. **Confirmed.**
- `bumpThreadMarker / readThreadMarker / advanceDistilledThrough / readThreadDistillState` over `thread_distill_state(thread_id, marker, distilled_through)`. Marker bumps on `appendMessages` + edit + forget (asserted in store.test.ts). **Confirmed.**
- `fact_fts` is FTS5 over `canonical` with default (unicode61) tokenizer. `fact_topics`, AFTER-DELETE trigger `trg_distilled_facts_ad`. **Confirmed. No new fact_fts DDL in this chunk** (Q7).

**GAP resolved (not pre-built by v2-02):** there is **no store method to read "messages since the last
distill"**. The `marker` is a per-*mutation* counter, NOT a `turn_index`, so `distilled_through` cannot be
translated into "which messages are new." The new-tail read is net-new (Step 1.3 `readNewTailSince` +
the `distilled_through_turn` watermark — see R2).

**Current default provider:** `memory-provider-selector.ts` — `process.env["MEMORY_PROVIDER"] ?? "dumb-tail"`.
**Default is `dumb-tail`.** This plan **keeps it** — flipping to incremental-smart is v2-05, OUT of scope.

**Frozen surfaces untouched:** `@agentic/protocol` and `mock-agent.ts` / the mock reducer are not
referenced by any file in scope. **Confirmed byte-unchanged** (verified at Step 3.8 by `git diff --stat`).

**Behavioral claims:** the STABILITY guarantee, real-API incremental-distill, "stable facts on a fresh
store" are **behavioral** — proven this chunk only by (a) deterministic-stub STABILITY/idempotence/
asymmetric tests over real SQLite, and (b) the EXECUTED real-API probe. The **full feature behavioral
DoD (live demo) is DEFERRED to v2-05** — *requires runtime demo (v2-05) to confirm end-to-end*, **not**
"verified" here.

---

## §9 resolutions (architect-time, recorded so workers don't re-decide)

- **Q1 — K (candidate top-K):** **Reuse v2-02's `CANDIDATE_TOP_K=10`.** `fetchCandidates` hard-codes it; the LLM sees a 1..10 ordinal list. No new constant.
- **Q2 — canonical normalization:** **The LLM EMITS `canonical`** per `FactOp` (spec §3.1). Code does NOT re-derive it. **Defensive guard:** empty/missing `canonical` → fall back to `normalizeFactText(fact)` (the existing `memory/normalize-fact-text.ts` from chunk-04) so the FTS key is never empty. Reconciles D-V4c: `canonical` → `fact_fts`; user-language `fact` → `distilled_facts.fact` display.
- **Q3 — BM25 query + new-tail seed:** **Reuse `fetchCandidates`** (calls `toFtsOrQuery` internally). ONE LLM call: compute a candidate pool by running `fetchCandidates` over the **new-tail text** (joined + sanitized), pass that pool (≤K, `{ordinal:1..K, fact, topics}`) + the new-tail to the LLM; the LLM returns `ops[]` with `targetOrdinal` indexing into that single shown pool. One fetch, one LLM call (matches spec §3.1 exactly). New-tail read uses the `distilled_through_turn` watermark (R2).
- **Q4 — append-list cap N:** **Reuse `APPEND_LIST_CAP=8`.** A refused append (`false`) demotes to `new`.
- **Q5 — high-confidence REPLACE encoding + gate composition:** No numeric confidence field — confidence is encoded by the **choice of op** (prompt: only emit `replace` for a genuine contradiction; else `append`/`new`). Rule-gates compose server-side, in order (D-V2), at apply time:
  1. Resolve `targetOrdinal` (1..K) → real `distilled_facts.id` via `candidateIds[targetOrdinal-1]`. Out-of-range / missing / non-`new` op without an ordinal → **demote to `new`**.
  2. **Optimistic concurrency:** re-read the target row's CURRENT `fact` text; if `!==` `expectedTargetText` → **conflict → demote to non-destructive** (`replace`/`append`→`new`).
  3. **Never-replace-human:** target `authored_by:'human'` → **demote to `new`** (5e).
  4. Surviving `replace` → `updateFactById` (records replaced text). Surviving `append` → `appendToFactById`; `false` → `insertFact` (`new`).
  5. `new` (original or demoted) → `insertFact`. Default-non-destructive: every uncertain/failed path lands on `insertFact`.
- **Q6 — topics vocabulary:** coarse, prompt-nudged, lowercase-kebab, NOT a taxonomy: `#about-user`, `#preferences`, `#projects`, `#relationships` (prompt lists these as preferred, "add others sparingly"). Tags WIDEN recall only (B1) — `fetchCandidates` ignores them for filtering, no enforcement code.
- **Q7 — fact_fts DDL:** **Confirmed: v2-02's standalone FTS5 over `canonical` is what the distiller matches against. NO new fact_fts DDL.** The only schema change is the additive `distilled_through_turn` column on `thread_distill_state` (R2; fresh-store CREATE only).

---

## File structure (what changes, and why)

| File | Change | Responsibility after |
|---|---|---|
| `packages/daemon/src/memory/memory-provider.ts` | **Modify** | Define `FactOp` + `DistillDelta` (incl. `candidateIds`); redefine `MemoryProvider.distill` → `Promise<DistillDelta>`; keep `retrieve` unchanged; rewrite the false re-derivability doc comments. |
| `packages/daemon/src/memory/schema.ts` | **Modify** | Add `distilled_through_turn INTEGER NOT NULL DEFAULT 0` to `thread_distill_state` CREATE (additive; R2). |
| `packages/daemon/src/memory/store.ts` | **Modify** | Add `readNewTailSince(threadId, sinceTurn)` + `maxTurnIndex(threadId)` + `advanceDistilledThroughTurn` + resilient `distilled_through_turn` read (R2); extend `ThreadDistillState`. Rewrite `dropAllDistilledFacts` doc → "one-time migration only." Keep v1 methods (doc rewritten only). |
| `packages/daemon/src/memory/providers/smart-distiller-provider.ts` | **Rewrite `distill`** | Incremental: new-tail since watermark → `fetchCandidates` over new-tail text → ONE LLM call → `DistillDelta`. New `SMART_DELTA_SYSTEM_PROMPT`. LLM + FTS5 OUTSIDE any tx. Keep `stop_reason`→truncation guard. Drop dead projection post-filters from `distill` (forget rewiring is v2-04; store read-side suppression covers it). `retrieve` unchanged. |
| `packages/daemon/src/memory/distiller-registration.ts` | **Rewrite `doOneRun`** | Apply `DistillDelta` (R1: spec-literal ONE tx if feasible): per op resolve+gate (Q5); advance watermark only after all facts land. Never-drop re-purpose → `distill-failed` (reuse `trigger` param); keep `distill-truncated`. MAJOR-3 queue KEPT; comment "latest-wins"→"non-destructive-on-conflict". |
| `packages/daemon/src/memory/providers/dumb-tail-provider.ts` | **Rewrite `distill`** | Delta port `op:'new'`-only over the new-tail, idempotence via registration marker-skip. `retrieve` unchanged. |
| `packages/daemon/src/memory/providers/fixed-marker-provider.ts` (+`.test.ts`) | **DELETE** | Retired (spec §6). |
| `packages/daemon/src/memory/memory-provider-selector.ts` (+`.test.ts`) | **Modify** | Remove `fixed-marker` from REGISTRY + import; keep `dumb-tail` default + `smart` build-path. |
| `packages/daemon/src/memory/distiller-integration.daemon.test.ts` | **Rewrite** | Swap-proof → delta+stability contract (both `smart`-stub and `dumb-tail` honor delta port + stable ids + no DELETE-all + idempotence). Remove v1-strategy / FixedMarker references. |
| `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` | **Rewrite** | Delta `distill` unit tests: candidate fetch, op-proposal parse, language preservation, defensive parse, truncation guard. |
| `packages/daemon/src/memory/distiller-registration.test.ts` | **Rewrite** | The STABILITY test (headline), idempotence, asymmetric-risk, MAJOR-3 two-queued-same-target. |
| `packages/daemon/scripts/incremental-distill-probe.ts` | **Create** | EXECUTED real-API probe on a FRESH store: real conversation → incremental distill → stable facts across re-distill. |

---

## Task ordering (TDD-sequenced; the STABILITY test is FIRST)

Three PR-coherent steps on branch `chunk/v2-03-incremental-distiller` (already created). Each ends green + committed. The STABILITY test is written in Step 1 and is RED until Step 1's apply path lands — it is the named headline gate.

### Step 1 — Delta port + registration delta-apply + the STABILITY/idempotence/asymmetric tests (the heart)

**Files:** modify `memory-provider.ts`, `schema.ts`, `store.ts`; rewrite `distiller-registration.ts`, `distiller-registration.test.ts`.

- [ ] **1.1 — Define the delta port (memory-provider.ts).** Add `FactOp` + `DistillDelta`, redefine the port, rewrite false re-derivability docs:
```ts
/** ONE targeted change to the stable-id fact store, proposed by the distiller (spec §3.1). */
export interface FactOp {
  op: "new" | "append" | "replace";
  fact: string;            // user-language DISPLAY text (D-V6e language preserved)
  canonical: string;       // LLM-normalized match key → fact_fts (D-V4c). Empty ⇒ caller falls back to normalizeFactText(fact).
  topics: string[];        // coarse LLM tags (§3.5); WIDEN recall only (B1)
  targetOrdinal?: number;  // 1..K index into the candidate list shown to the LLM (NOT a uuid — [grill B2])
  expectedTargetText?: string; // candidate text the LLM reasoned about (optimistic-concurrency — [grill M5])
}
/** The incremental delta a dismiss produces (spec §3.1). NOT a full projection. */
export interface DistillDelta {
  threadId: string;
  ops: FactOp[];
  candidateIds: string[];           // the candidate ids in ordinal order; candidateIds[targetOrdinal-1] resolves the target (orchestrator-blessed port extension)
  distilledThroughMarker: number;   // the mutation marker this delta covers ([grill M4])
  distilledThroughTurn: number;     // the max turn_index this delta covered (new-tail watermark, R2)
}
export interface MemoryProvider {
  readonly id: string;
  /** Reads ONLY the just-ended thread's NEW TAIL (since its last distill watermark — §3.1 [grill M4])
   * and proposes a DELTA of targeted FactOps over the STABLE-id fact store. FTS5 + any LLM call run
   * OUTSIDE any tx. NOT a re-derivable projection — the fact store is STATEFUL (ADR-0012 Amendment
   * 2026-06-13). A failure rejects to registration's never-drop failure path. */
  distill(store: MemoryStore, threadId: string): Promise<DistillDelta>;
  retrieve(store: MemoryStore, forThreadId: string): Promise<SessionMessage[]>;
}
```
Rewrite `DistilledFact`'s doc from "re-derivable / disposable" to "a row in the STATEFUL, incrementally-accumulated derived fact store (ADR-0012 Amendment 2026-06-13); stable id; auditable + forgettable, NOT pure f(archive)." Keep `DistilledFact` fields. Grep for `DistillResult` importers; if none, leave it deprecated-unused or remove.

- [ ] **1.2 — Schema watermark column (schema.ts) — R2.** Add to the `thread_distill_state` CREATE: `distilled_through_turn INTEGER NOT NULL DEFAULT 0` with a comment "v2-03: max turn_index covered (new-tail read). Live-store column add owned by v2-05 migration; reads are resilient to its absence." **No ALTER.**

- [ ] **1.3 — Store reads (store.ts).** Add (signatures per architect draft):
  - `readNewTailSince(threadId, sinceTurn): MessageForDistillRow[]` — messages with `turn_index > sinceTurn`, tombstone/quarantine-honored + human-correction COALESCE (mirror `readThreadMessagesForDistill`), ASC. `sinceTurn=0` ⇒ whole thread.
  - `maxTurnIndex(threadId): number` — `COALESCE(MAX(turn_index),0)`.
  - `advanceDistilledThroughTurn(threadId, turn)` — upsert `distilled_through_turn`.
  - Extend `ThreadDistillState` with `distilled_through_turn: number`; **resilient read (R2):** PRAGMA-check the column; absent → default 0, never crash.
  - Rewrite `dropAllDistilledFacts` doc → "ONE-TIME MIGRATION ONLY (v2-05 §3.8). NOT a per-dismiss path."

- [ ] **1.4 — Write the STABILITY test FIRST (distiller-registration.test.ts), expect RED.** Deterministic stub LLM (echo). Seed "User's name is Lior"; run N=4 dismisses where the stub re-proposes an overlapping candidate each time (bump marker + append between dismisses so the skip-guard doesn't no-op); assert the fact's row **id unchanged**, text **byte-identical**, injected-slice **order stable**, **nothing vanished**. RED on the v1 global-reprojection strategy (DELETE-all mints new ids). This is the named headline gate. Run: `bun test packages/daemon/src/memory/distiller-registration.test.ts` → FAIL.

- [ ] **1.5 — Rewrite `doOneRun` (distiller-registration.ts) — apply the delta. R1 APPLIES HERE.**
  - Phase 1 (outside tx): `const delta = await provider.distill(store, triggerThreadId)`. On reject → record failure (rename `recordReprojectionFailure`→`recordDistillFailure`; trigger `"distill-truncated"` if `err.truncated` else `"distill-failed"`; attempted-op-count or null, NOT a projection size); `console.error`; rethrow.
  - Skip-guard (idempotence, D-V3b): BEFORE Phase 1, `if (readThreadDistillState(t).distilled_through >= readThreadMarker(t)) { record a no-op/"distill-skipped" event; return; }`.
  - Phase 2 (outside tx, per op): `scanner.scan(op.fact)`; drop on `!v.ok`. Provenance is `thread:<threadId>` (thread-level), so no per-op quarantine recording. Survivors = `cleanOps`.
  - Phase 3 (**R1: ONE `store.rawDb().transaction(()=>{…})()` wrapping the apply loop AND the two watermark advances** — verify nested composition works; fall back per R1 only with evidence): per op, resolve `targetId = (op.op!=="new" && op.targetOrdinal) ? delta.candidateIds[op.targetOrdinal-1] : undefined`, then the Q5 gate (out-of-range→new; re-read current text, `!==expectedTargetText`→new; `human`→new; `replace`→`updateFactById`; `append`→`appendToFactById`, `false`→new; else `insertFact`). `base = {fact, canonical: op.canonical || normalizeFactText(op.fact), topics, confidence:1}`; new inserts add `provenance, scope:"cross-thread", expiry:null, authored_by:"machine"`. After the loop: `advanceDistilledThrough(t, delta.distilledThroughMarker)` + `advanceDistilledThroughTurn(t, delta.distilledThroughTurn)` **inside the same tx**. Then write ONE distillation event per dismissed thread (`trigger:"distill"`, `factsProduced: cleanOps.length`).
  - MAJOR-3 queue: KEEP the promise-queue verbatim; update its comment: "latest-wins" → "non-destructive-on-conflict — the optimistic-concurrency re-read (current target text == expectedTargetText) is what makes serialized same-target deltas safe; a second queued run whose target text already moved demotes to non-destructive rather than clobbering."

- [ ] **1.6 — Add idempotence + asymmetric-risk tests (distiller-registration.test.ts), GREEN after 1.5:**
  - **Idempotence:** dismiss an unchanged thread twice → skip-guard → 0 new ops 2nd time; count unchanged. Add 2 new messages + re-dismiss → only new facts, no dup.
  - **Out-of-range ordinal → new:** stub `op:"replace", targetOrdinal:99, candidateIds:[]` → new fact, nothing touched.
  - **Concurrency conflict → non-destructive:** seed fact A; stub `op:"replace", targetOrdinal:1, expectedTargetText:"STALE"` while A's real text differs → A unchanged + new fact.
  - **Never-replace-human → new:** human fact; stub `op:"replace"` targeting it → human byte-unchanged + new machine fact.
  - **REPLACE records replaced text:** machine fact + matching `expectedTargetText` → `readReplacedFacts(id)` has the prior text; id unchanged.
  - **MAJOR-3 two-queued-same-target:** fire two `hook.dismiss` without awaiting; both target the same id; await both → no corruption (one replace applied, the second demoted via stale `expectedTargetText`).
  - **R1 atomicity test:** multi-op delta, force a throw on op 2 → assert NOTHING landed AND watermark NOT advanced → next dismiss retries cleanly.
  - **R2 missing-column test:** create `thread_distill_state` WITHOUT `distilled_through_turn`, run init/read → no crash, watermark defaults 0.

- [ ] **1.7 — Run the memory suite, expect STABILITY + new tests GREEN.** `bun test packages/daemon/src/memory/distiller-registration.test.ts packages/daemon/src/memory/store.test.ts` → PASS. Then strict-lint + typecheck for `packages/daemon`. (selector/smart/integration suites are RED here — fixed in Steps 2–3; do NOT run the whole-repo green-gate until Step 3.)

- [ ] **1.8 — Commit** `feat(memory): v2-03 delta port + registration delta-apply + STABILITY/idempotence/asymmetric tests` with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

### Step 2 — SmartDistiller incremental rewrite + smart unit tests + language preservation

**Files:** rewrite `providers/smart-distiller-provider.ts` (`distill` + system prompt), `providers/smart-distiller-provider.test.ts`.

- [ ] **2.1 — Write smart delta-distill unit tests FIRST, expect RED.** Only `clientFactory` stubbed (reuse the existing echo-client helper). Assert: returns `DistillDelta`; empty new-tail → `{ops:[]}` short-circuit, NO LLM call; LLM shown a `fetchCandidates` pool over the new-tail (seed a pre-existing fact, assert it appears in the prompt's ordinal list); a stub returning `[{op:"new", fact:"Користувач любить чай", canonical:"user likes tea", topics:["#preferences"]}]` → op's `fact` is the Ukrainian string (D-V6e), `canonical` the English key (D-V4c); non-JSON / non-array output → throws `SmartDistillError`, bad ops dropped good kept; `stop_reason:"max_tokens"` → `SmartDistillError({truncated:true})`. Run → FAIL.

- [ ] **2.2 — Rewrite `SmartDistillerProvider.distill`.** Flow: read `distilled_through_turn` (resilient, R2) → `readNewTailSince` filtered (drop REDACTION_MARKER + quarantined) → empty → return `{threadId, ops:[], candidateIds:[], distilledThroughMarker: readThreadMarker, distilledThroughTurn: distilled_through_turn}` (no LLM) → build tail text → `fetchCandidates(tailText)` (≤K), `candidateIds = candidates.map(c=>c.id)` → build numbered pool `1..K → {fact, topics}` → ONE LLM call (`SMART_DELTA_SYSTEM_PROMPT`, user = tail + pool) → `stop_reason` guard → `parseOps(rawText)` (validate op enum, non-empty fact, canonical string default "", topics array, optional small-int targetOrdinal, optional expectedTargetText; drop malformed) → return `{threadId, ops, candidateIds, distilledThroughMarker: readThreadMarker, distilledThroughTurn: maxTurnIndex}`. Drop the dead Layer-1/T/P projection post-filters from `distill` (keep `_getForgottenSuppression`/`retrieve` untouched — store read-side suppression covers forget). New `SMART_DELTA_SYSTEM_PROMPT`: JSON array of ops only; `replace` ONLY for a genuine contradiction of a shown candidate (copy its ordinal + exact text into `expectedTargetText`); `append` to add a same-kind item; else `new`; **uncertain → prefer `new`/`append`, NEVER `replace`**; `fact` in the user's language; `canonical` a lowercased English match key; `topics` from the Q6 set; no prose/fences; `[]` if nothing.

- [ ] **2.3 — Run smart unit tests + lint/typecheck** → PASS.

- [ ] **2.4 — Commit** `feat(memory): v2-03 SmartDistiller incremental delta rewrite (new-tail + FTS5 candidates + op proposal, language preserved)` + trailer.

### Step 3 — Retire FixedMarker, adapt DumbTail, rewrite swap-proof + selector, EXECUTED probe, full green gate

**Files:** rewrite `providers/dumb-tail-provider.ts` (+`.test.ts`); delete `providers/fixed-marker-provider.ts` (+`.test.ts`); modify `memory-provider-selector.ts` (+`.test.ts`); rewrite `distiller-integration.daemon.test.ts`; create `scripts/incremental-distill-probe.ts`.

- [ ] **3.1 — Adapt `DumbTailProvider.distill` to the delta port (`op:'new'`-only).** Read `readNewTailSince(threadId, state.distilled_through_turn)` (resilient, R2), filter tombstone/quarantine/fact-tombstone (as today), emit `{op:"new", fact:m.content, canonical:normalizeFactText(m.content), topics:[]}` per surviving new-tail message. Return `{threadId, ops, candidateIds:[], distilledThroughMarker: readThreadMarker, distilledThroughTurn: maxTurnIndex}`. Idempotence = registration marker-skip + (for smart) FTS5 convergence; DumbTail needs no extra dedup. `retrieve` unchanged. Rewrite class doc ("COMPLETE projection over the whole archive" → "incremental new-tail op:'new' delta; keyless fallback + swap-proof second leg").

- [ ] **3.2 — Rewrite `dumb-tail-provider.test.ts`** to assert the delta shape: `op:"new"` ops over the new-tail only; a second dismiss with no new messages → `ops:[]`.

- [ ] **3.3 — Delete FixedMarker.** `git rm` the provider + its test. Grep `packages/` for `FixedMarker|fixed-marker`; remove every residual import/reference. Confirm zero residual.

- [ ] **3.4 — Selector (memory-provider-selector.ts + test).** Remove the `FixedMarkerProvider` import + `["fixed-marker", …]` REGISTRY entry. Keep `dumb-tail` default + `smart` build-path. Test: drop fixed-marker assertions; KEEP default-is-dumb-tail, unknown-id→dumb-tail-fallback, `smart`-with-key, `smart`-no-key→dumb-tail-fallback.

- [ ] **3.5 — Rewrite the swap-proof integration test (`distiller-integration.daemon.test.ts`).** Replace the FixedMarker swap-leg + v1 `replaceProjection`/`dropAllDistilledFacts` strategy. New meaning (spec §6 / grill m3): **both `smart` (stub) and `dumb-tail` honor the delta-port + stability contract** — each, over a real daemon-driven turn, produces a `DistillDelta`; applying it yields stable ids across a 2nd dismiss (no DELETE-all, id unchanged); the contract is idempotent. Remove the FixedMarker forgot-fact re-projection tests (v1 re-derivation — durable-delete forget is v2-04; leave a `// v2-04` marker, do NOT assert old re-derivation). Keep non-FixedMarker daemon-path assertions that still hold.

- [ ] **3.6 — Create the EXECUTED real-API probe (`packages/daemon/scripts/incremental-distill-probe.ts`).** Mirror `forget-roundtrip-probe.ts`'s structure + Strike-5 banner. FRESH store (`mkdtempSync`): seed a real conversation, real `SmartDistillerProvider` distill (real `clientFactory`, key from Keychain/env — **never printed**), apply via `registerDistiller`+`hook.dismiss`, assert a stable fact appears; re-dismiss with an overlapping turn, assert id unchanged + nothing vanished. Print PASS/FAIL + fact ids (NOT the key). Document the invocation.

- [ ] **3.7 — EXECUTE the probe (Strike-5 — written+typechecked is NOT evidence).** The ORCHESTRATOR runs it with a real key in env and pastes full stdout into the PR body, marked "incremental-distill real-API probe: EXECUTED, output below." Full feature behavioral DoD remains DEFERRED to v2-05.

- [ ] **3.8 — Full green gate.** `bun test && bun run lint:strict && bun run typecheck` (incl. `apps/overlay`) → exit 0. `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` → empty (frozen byte-unchanged).

- [ ] **3.9 — Commit + push.** `feat(memory): v2-03 retire FixedMarker, DumbTail delta-adapt, swap-proof→delta+stability, selector, EXECUTED probe` + trailer; `git rm` the FixedMarker files in the same commit; `git push -u origin chunk/v2-03-incremental-distiller`. (PR + ledger are the orchestrator's Phase-3 job.)

---

## Self-review (spec coverage)

- §3.1 delta port → 1.1 (with orchestrator-blessed `candidateIds` for ordinal resolution). ✓
- §3.1 read-new-tail-since-marker → 1.3 (`readNewTailSince`) + R2 watermark. ✓
- §3.2 asymmetric-risk apply → 1.5 + 1.6. ✓
- §3.3 stable-id / no DELETE-all / idempotence / guard-in-tx (R1) / never-drop re-purpose → 1.5 + 1.6. ✓
- §3.4 FTS5 match-canonical/display-user-language (D-V4c), B1 full-corpus → 2.2 + `fetchCandidates`. ✓
- §3.5 topic tags → 2.2 prompt + Q6. ✓
- §3.6 D-V6e (language) tested 2.1; D-V6d (self-concept) was v2-01 (NOT redone). ✓
- §4 amendment — rewrite false re-derivability docs → 1.1 + 1.3. ✓
- §5 verification — STABILITY FIRST/RED→GREEN (1.4), idempotence + asymmetric (1.6), real SQLite/only-clientFactory-stubbed, EXECUTED probe fresh store (3.6/3.7). ✓
- §6 swap-proof — FixedMarker retired, DumbTail adapted, swap-proof rewritten → Step 3. ✓
- §7.1 MAJOR-3 non-destructive-on-conflict → 1.5 comment + 1.6 two-queued. ✓
- OUT honored: default stays `dumb-tail`; forget read-side suppression left as-is; no protocol/mock touch. ✓

## ADR worthy: no

This chunk **implements** the already-accepted ADR-0012 Amendment 2026-06-13 + spec §3.1–§3.6. The `MemoryProvider` port is **explicitly NOT frozen** (spec §2). The new build decisions (`candidateIds` on the delta; the `distilled_through_turn` watermark column with a resilient read) are internal store/port mechanics inside the already-amended boundary — no new protocol/dependency/boundary, no new runtime dep. No ADR needed. The watermark live-store reconciliation is flagged to v2-05's migration (which owns the live-store touch per §3.8).
