# Plan — memory-quality chunk 04: Forget-flow contract (intent dispatch + durable fact-forget + option B)

**Chunk:** `orchestration/chunks-todo/memory-quality/04-forget-contract.md`
**Spec:** `orchestration/docs/specs/2026-06-13-forget-flow.md` (§2 D-A/D-B/D-C/D-D/D-F, §3, §6 — **NOT** D-E/MINOR-3, which is chunk 05)
**ADRs:** `orchestration/docs/adr/0015-intent-based-memory-forget.md` (decisions 1–5; decision 6 = reserve-only) · `orchestration/docs/adr/0012-conversation-and-memory-model.md` (extends 5a/5e, D6)
**Branch:** `chunk/04-forget-contract`
**Baseline for review:** `main`

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development`) to implement this plan task-by-task. **TDD RED-first throughout** — the ONLY permitted mock is the LLM `clientFactory` (Strike-4 boundary); real SQLite everywhere else. **Step 1's B1 no-downgrade test is a NAMED DoD gate and must be written FIRST.**

**Goal:** Replace shape-based forget dispatch with explicit intent (`forgetMessage`/`forgetFact`/`forgetFactAndSources`), give fact-forget a durable `forgotten_facts` record so the smart distiller's best-effort suppression actually fires, make that suppression honest (one real text-match layer + two nudges), make human precedence bidirectional (un-forget), add the opt-in option-B source escape, fix thread-local injection (MINOR-1), and backstop `retrieve()` — all so the chunk-06 default flip is safe.

**Architecture:** Fact-forget and message-forget use **separate durable artifacts that never cross** (ADR-0015 decision 2): a message-forget writes a `mutations` redaction tombstone + scrubs `messages.content` (unchanged); a fact-forget writes ONLY the new `forgotten_facts` table and touches neither `messages` nor `mutations` nor `tombstoneFact`. Safety is structural — no `target_type` value can make the fact path scrub. The smart distiller re-sources its suppression from `forgotten_facts` (not a deleted `distilled_facts` row), keyed on normalized fact text.

**Tech Stack:** Bun + TypeScript, `bun:sqlite`, `@anthropic-ai/sdk` (already ADR-0011-gated; NOT a new dep), `bun:test`. No new runtime dependency.

---

## Status: Done (plan ready for execution)

---

## Reality check (architect — verified at file:line on `main`; behavioral claims marked "requires runtime demo")

This chunk has **NO behavioral Lior-demo DoD** — the forget steps are folded into chunk 06's feature-closing live demo (spec §6, chunk DoD line 105). Every DoD here is `[mechanical]` plus the `[EXECUTED probe — Strike-5]`. Code-path facts below are static observations; the EXECUTED round-trip probe is the only runtime evidence and **requires a live run to confirm** (Strike-5: written+typechecked is not RUN).

**Spec line-citation audit (the spec warns its line numbers may have moved — confirmed/corrected here):**

- **`hatch.ts:82` — the `isMessageId` shape-router. CONFIRMED.** `Hatch.forget` is `hatch.ts:81-87`; line 82 is exactly `if (isMessageId(target)) {`. The `else` branch calls `this.gate.forgetFact(target, ctx, reason)` — note it passes the provenance as `forgetFact`'s FIRST positional arg (today `forgetFact(provenance, ctx, reason)`). This signature changes in Step 4.
- **`store.ts:209` — `LEFT JOIN messages m ON m.id = df.provenance`. CONFIRMED** (the MINOR-1 root). The join sits inside `readDistilledFactsForThread` (`store.ts:203-226`). For a comma-joined provenance (`"id1,id2"`) `m.id = df.provenance` matches nothing, so the `thread-local` branch (lines 215-220) cannot fire — the fact injects into no thread. The existing `thread:%` substr branch (line 218) handles only the FixedMarker shape, which smart never emits.
- **`smart-distiller-provider.ts:74` — `normalizeFactText`. CONFIRMED** (exported, single definition). Reuse it everywhere; do NOT duplicate.
- **`smart-distiller-provider.ts:367` — Layer-1 provenance filter. CONFIRMED** (`afterLayer1`, lines 367-370). Today both layers read tombstone state from `mutations` via `store.isFactTombstoned` and recover text from `distilled_facts` via `_getTombstonedTexts` (lines 393-412). **This is the MAJOR-1 dead-code path: `_getTombstonedTexts` reads `readDistilledFacts(10_000)` and keeps only rows whose provenance is `isFactTombstoned` — but a fact-forget purges that row (`dropDistilledFactsByProvenance`), so the text set is empty and Layer-2 never matches.** Both layers must be re-sourced from `forgotten_facts` in Step 6.
- **`smart-distiller-provider.ts:424` — `retrieve()`'s `isFactTombstoned` filter. CONFIRMED** (line 424: `const live = rows.filter((f) => !store.isFactTombstoned(f.provenance));`). Under separate tables a fact-forget writes `forgotten_facts`, not `mutations`, so this filter alone will miss a forgotten fact. Step 6 adds the `forgotten_facts` normalized-text check ALONGSIDE (not replacing) the existing tombstone filter.
- **`history-page.ts:381` — fact-forget sends `f.provenance`. CONFIRMED** (the `doForget(provenance, …)` closure is lines 379-381; the message-forget closure sending `m.id` is lines 329-331). **DIVERGENCE FROM SPEC, FLAGGED:** the spec/ADR say the fact button sends `{target_type:"fact", fact_text, provenance}`. The current renderer (`renderFacts`, lines 350-388) has `f.fact` in scope (line 364 `factEl.textContent = f.fact`) but the forget closure (line 379) captures only `f.provenance`. The view payload (`HatchViewResult.distilledFacts`, `hatch.ts:33` / `store.ts:DistilledFactRow:27-34`) already carries `fact`, so `fact_text` is available — the closure just needs to also capture `f.fact`. No new API field needed. Step 7 handles this.

**The frozen / load-bearing seam invariants (must survive byte-intact):**

- **`WriteGate.forget` (message path) — `write-gate.ts:70-98` — UNCHANGED.** Writes the `mutations` tombstone (line 80), scrubs `messages.content` to `REDACTION_MARKER` (line 82), redacts the JSONL mirror (line 88), purges live facts (lines 93-94). The 5e machine-clobber guard (lines 75-77) stays. This is the message redaction artifact; do not touch it except where Step 5's `forgetFactAndSources` REUSES it (calls it, does not modify it).
- **`store.tombstoneFact` — `store.ts:250-278` — the `isMessageId`-throw STAYS** (lines 257-262). The fact path must STOP CALLING it (today `WriteGate.forgetFact` line 128 calls it). The B1 invariant is: the new `forgetFact` writes `forgotten_facts` and never calls `tombstoneFact`. `tombstoneFact` itself is left in place (the throw is the defensive assertion ADR-0015 decision 1 says survives).
- **`mapWriteError` — `http-routes.ts:208-223`** is coupled to the exact throw message in `forgetFact`'s UUID-guard (line 218 regex). Once `forgetFact` no longer receives provenance-as-target (intent dispatch routes a UUID only to the message path), that regex branch becomes defensive-only. Keep it; it still maps `tombstoneFact`'s throw if some future caller misroutes. Do NOT delete it.
- **`replaceProjection` — `store.ts:362-410`** is the atomic machine-projection replace (one flat synchronous tx, `now` captured once, `rowid ASC` tie-break). The `forgotten_facts` INSERT is NOT on this path and NOT on MAJOR-3's promise-queue (`distiller-registration.ts:139-149`) — it is a standalone atomic INSERT (§7.1: needs no ordering; the next `distill` reads a consistent snapshot).
- **5e enforcement points:** `WriteGate.isHumanAuthored` (`write-gate.ts:178-184`) and the `authored_by != 'human'` guards in `dropDistilledFactsByProvenance` (`store.ts:325-328`) / `dropDistilledFactsForThread` (`store.ts:332-336`) / `replaceProjection` (line 384). The new purge in Step 3 MUST carry the same `AND authored_by != 'human'` guard — a fact-forget must never delete a human-pinned row.

**Test-harness shape (verified — only the LLM `clientFactory` is stubbed):**

- `hatch.daemon.test.ts` — real `MemoryStore` via `mkdtempSync`, real `WriteGate`, real `RuleBasedScanner`, real `Hatch`, real `ConsolidationHook` + `registerDistiller` with `DumbTailProvider`/`FixedMarkerProvider`. This is where the B1 no-downgrade test and the intent-dispatch tests land.
- `smart-distiller-provider.test.ts` — `echoClient(raw)` / `echoDigestClient()` / `neverCallClient()` / `rejectClient(msg)` stubs (lines 34-85). Layer tests use real `store.tombstoneFact(...)` today; Step 6's new layer tests use real `forgetFact`/`forgotten_facts`.
- `distiller-integration.daemon.test.ts` — `makeEchoStub({throwError?})` (lines 379-409) parses the digest's `[role|id] content` lines and echoes each as a fact with `provenance=id`. This is the **echo-stub re-projection** the Layer-T DoD (chunk line 88) and the EXECUTED probe need: forget a smart fact, re-project with this stub re-emitting the same text, assert suppression.
- `http-routes.daemon.test.ts` — real daemon via `startDaemon(0)`, real token (`readToken()`), `LLM_PROVIDER=mock`. This is the real Hatch→HTTP-body→WriteGate path for the option-B and dispatch round-trip tests.

**No frozen-vs-frozen contradiction.** The chunk file ↔ spec ↔ ADR-0015 ↔ ADR-0012 are consistent; the `history-page.ts` guard is consciously lifted (ADR-0015 "Scope guard lifted"). No `## FLAG`.

---

## Requirements

- **R1 — Intent dispatch (D-A).** `Hatch` exposes `forgetMessage(messageId, ctx, reason?)` → `WriteGate.forget`; `forgetFact(factText, provenance, ctx, reason?)` → fact-forget record + purge, no scrub; `forgetFactAndSources(factText, provenance, ctx, reason?)` → fact-forget record + option-B source scrub. The `Hatch.forget` `isMessageId` shape-router is DELETED.
- **R2 — B1 separate-table invariant (NAMED GATE).** The fact path writes ONLY `forgotten_facts`, touches neither `messages` nor `mutations`, never calls `tombstoneFact`. The `isMessageId`-throw stays on the message path (`WriteGate.forget` via `threadOf`/`tombstoneFact`). No `target_type` value can downgrade a message scrub to a fact-forget.
- **R3 — `forgotten_facts` table (D-B).** Additive `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` on `normalized_text` in `schema.ts`. Columns: `{id, normalized_text, raw_text, provenance, actor, reason, authored_by, created_at}`. NO `ALTER`.
- **R4 — Durable record + immediate purge (D-B).** `forgetFact` captures the row AND immediately purges live machine rows by `(provenance = ? OR normalizeFactText(fact) = ?) AND authored_by != 'human'`.
- **R5 — Honest layers re-sourced from `forgotten_facts` (D-B).** Layer-T (normalized-text) is THE one real best-effort layer, sourced from `forgotten_facts.normalized_text` (NOT a deleted `distilled_facts` row). Layer-P (provenance-SET equality, NOT intersection) + Layer-X (LLM exclusion) are opportunistic nudges. **No code/comment/doc/test may say "3 layers of defense."**
- **R6 — 5e-aware filter + un-forget (D-B).** Layer-T must NOT suppress a candidate when a human-authored `distilled_fact` with the same normalized text exists. A human authoring/editing a fact whose normalized text matches a `forgotten_facts` row CLEARS that row. Precedence: human fact (D6) ▷ human un-forget ▷ machine fact-forget record ▷ machine re-derivation.
- **R7 — Option B (D-C).** `forgetFactAndSources` enumerates `provenance.split(",")` → `isMessageId` components → hard-scrub each via `WriteGate.forget`. `thread:<id>` provenance → NO-OP with a clear message. `history.html`'s fact confirm offers a distinct "⚠ also delete the N source message(s)" control surfacing source-message count AND count of OTHER facts those messages feed.
- **R8 — MINOR-1 (D-D).** `readDistilledFactsForThread` resolves the origin-thread set IN CODE (split provenance → message-id components → their `thread_id`s), not the `m.id = provenance` join; handles `thread:<id>` uniformly.
- **R9 — retrieve() backstop (D-F).** `SmartDistillerProvider.retrieve` filters live rows through BOTH the existing tombstone check AND a `forgotten_facts` normalized-text check.
- **R10 — HTTP dispatch (D-A).** `POST /memory/forget` parses `target_type:"message"|"fact"` + optional `also_forget_sources:bool` + (for facts) `fact_text`; dispatches to the right `Hatch` method. `HTTP_CTX` stays `{actor:"user", authored_by:"human"}`. Body fields are additive (ADR-0015 relationship §: NOT a frozen-wire change).
- **R11 — Frozen surfaces byte-unchanged:** `@agentic/protocol`, `mock-agent.ts`. Full `bun test` + `lint:strict` + typecheck exit 0; real SQLite, only the LLM `clientFactory` stubbed.
- **R12 — EXECUTED round-trip probe (Strike-5):** RUN, not just written.

---

## §7.1 runtime-coupling note (decompose flag — re-validate at integration)

**NEW shared-mutable-state edge:** `WriteGate` becomes a WRITER of `forgotten_facts`; `SmartDistillerProvider.distill` becomes a READER (Layer-T). Two handlers that share no state today (the 02a→02b-i scar pattern). The forget→distill interleave is **eventually-consistent**: a forget landing after a `distill` read the table but before its commit is excluded NEXT run; the immediate purge (R4) covers the live slice in the gap. **MAJOR-3's promise-queue (`distiller-registration.ts:139-149`) serializes re-projections; the `forgotten_facts` INSERT is atomic and NOT on the queue — it needs no ordering, so the next `distill` sees a consistent snapshot.** Step 6's integration test must assert: a forget interleaved around an in-flight `distill` does not corrupt the projection (prior projection intact; the fact stays gone after the next run). ALSO couples the human-edit path (`WriteGate.edit`) to the un-forget clear (Step 5).

---

## Approaches

### A. Where the un-forget clear lives (Step 5 decision)

- **A1 (chosen): clear in `WriteGate` (both the human-fact author path and `edit`).** The un-forget is "a human authored/edited a fact whose normalized text matches a `forgotten_facts` row." Human facts enter via the human-fact author path; human message edits flow through `WriteGate.edit` (`write-gate.ts:146-162`). Wiring the clear into `WriteGate` keeps all mutation-side `forgotten_facts` writes in one module (the §7.1 localization point the WriteGate doc already claims) and reuses `isHumanAuthored`. **Pro:** single writer, testable at the gate boundary, no new seam. **Con:** `WriteGate.edit` edits a MESSAGE, whose normalized content rarely equals a forgotten FACT's text — so the message-edit un-forget will fire rarely (acceptable: the spec ties un-forget to "authoring/editing a fact"; the load-bearing path is the human-fact author path, which in v0 is the human-pin route). Document this honestly.
- **A2 (rejected): clear in `store.replaceProjection`.** Replace runs on machine re-derivation, not on human action — clearing there would lift suppression on a machine cycle, violating the precedence chain (machine re-derivation must NOT clear a machine forget). Wrong layer.

**Recommendation: A1.** It matches the spec's "wire into the human-fact author/edit path" and keeps the precedence chain intact.

### B. Layer-P semantics (Step 6)

- **B1 (chosen): provenance-SET equality** — normalize both sides to a sorted set of trimmed ids and compare for equality. Fires only when the LLM re-emits the identical source set (rare; provenance is unstable across re-projections per ADR-0015 root #2).
- **B2 (rejected): set-INTERSECTION** (drop if ANY component overlaps). One source message feeds many facts → intersection over-suppresses unrelated facts. The spec explicitly rejects this ("NOT set-intersection … would over-suppress").

**Recommendation: B1.** Spec-mandated. Layer-P is an opportunistic nudge, down-ranked in comments, never marketed as defense.

---

## ADR worthy: no

This chunk IMPLEMENTS the already-accepted ADR-0015 (decisions 1–5, status `accepted`, Lior §5.2 2026-06-13) and EXTENDS ADR-0012 5a/5e exactly as ADR-0015's "Relationship to other ADRs" section authorizes. No new product decision, dependency, protocol, or boundary is introduced:
- The `forgotten_facts` table is the durable mechanism ADR-0015 decision 3 specifies.
- The §7.1 `WriteGate`→`SmartDistiller` coupling is explicitly named in ADR-0015 Consequences ("New runtime coupling, flagged at decompose") — already accepted, not a fresh decision.
- The additive `target_type`/`also_forget_sources`/`fact_text` HTTP body fields are explicitly NOT a frozen-wire change (ADR-0015: "additive to that HTTP body … `@agentic/protocol` and `mock-agent.ts` are untouched").
- `@anthropic-ai/sdk` is already ADR-0011-gated; no new runtime dep.

**Confirmed: no ADR. No FLAG.** (If during execution a worker discovers the un-forget clear needs a NEW store-side mechanism beyond a DELETE, that is mechanical, not a product decision — proceed.)

---

## Steps

Strictly sequential (shared store + write-gate + forget contract). TDD RED-first each step. **Step 1 is the named B1 gate and is written FIRST.**

### Step 1 — B1 no-downgrade gate (RED first, NO production code yet) + `forgotten_facts` schema

**Files:**
- Test: `packages/daemon/src/memory/hatch.daemon.test.ts` (add the named B1 test)
- Modify: `packages/daemon/src/memory/schema.ts` (add `forgotten_facts` table + index)

**Step 1.1 — Write the B1 no-downgrade test FIRST.** It will not compile until Step 4 adds `forgetFact(factText, provenance, …)`, which is the point: it is RED today AND it pins the invariant before any code moves. Write against the FINAL intent-dispatch API so it stays green forever after.

```ts
// ── B1 NAMED GATE: a fact-forget can NEVER scrub a message or write a tombstone ──
test("B1 no-downgrade: forgetFact on a bare message-UUID provenance leaves messages.content byte-INTACT and writes NO mutations row", async () => {
  const hatch = new Hatch(store, gate);
  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "real conversation content" }], "s1");

  // Intent = forget a FACT whose (single-source smart) provenance is a bare UUID.
  // The fact path must NOT scrub the message and must NOT write a mutations row.
  hatch.forgetFact("favourite colour: blue", mid!, { actor: "user", authored_by: "human" });

  const db = store.rawDb();
  const msg = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(msg.content).toBe("real conversation content"); // byte-INTACT — never scrubbed
  const mut = db.query("SELECT id FROM mutations WHERE target_message_id = ?").get(mid!);
  expect(mut).toBeNull(); // NO redaction tombstone written by the fact path
});

test("B1 no-downgrade: forgetMessage still scrubs (the message path is unchanged)", async () => {
  const hatch = new Hatch(store, gate);
  const threadId = store.createThread();
  const [mid] = store.appendMessages(threadId, [{ role: "user", content: "scrub me" }], "s1");

  hatch.forgetMessage(mid!, { actor: "user", authored_by: "human" });

  const db = store.rawDb();
  const msg = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(msg.content).toBe(REDACTION_MARKER); // scrubbed
  const mut = db.query("SELECT id FROM mutations WHERE target_message_id = ? AND kind='tombstone'").get(mid!);
  expect(mut).not.toBeNull(); // redaction tombstone written
});
```

**Step 1.2 — Run, verify RED.** `bun test packages/daemon/src/memory/hatch.daemon.test.ts` → expected: a TypeScript/compile error (`forgetFact`/`forgetMessage` not on `Hatch`, wrong arity). This is the correct RED — the invariant cannot be satisfied until the methods exist (Step 4).

**Step 1.3 — Add the `forgotten_facts` table to `SCHEMA_DDL`** in `schema.ts` (append to the template literal, after `quarantine_markers`):

```sql
CREATE TABLE IF NOT EXISTS forgotten_facts (
  id               TEXT PRIMARY KEY,
  normalized_text  TEXT NOT NULL,   -- normalizeFactText(raw) — the load-bearing match key
  raw_text         TEXT NOT NULL,   -- what the user saw + forgot (Layer-X exclusion + display)
  provenance       TEXT,            -- as-forgotten (opportunistic Layer-P + audit)
  actor            TEXT,
  reason           TEXT,
  authored_by      TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forgotten_norm ON forgotten_facts(normalized_text);
```

Add one line to the file's top doc comment noting `forgotten_facts` is the FACT-suppression artifact (keyed on normalized text), separate from `mutations` (the MESSAGE-redaction artifact) — ADR-0015 decision 2 / spec §0.

**Step 1.4 — Run.** `bun test packages/daemon/src/memory/store.test.ts` (schema smoke — table creation is exercised by every `new MemoryStore`). Expected: green (additive DDL never breaks existing tables). The B1 test stays RED until Step 4.

**Commit:** `feat(memory-quality): forgotten_facts schema + B1 no-downgrade gate (RED) — chunk 04`

---

### Step 2 — Store primitives: record / clear / match / purge (the durable mechanism, MINOR-1 origin-thread)

**Files:**
- Modify: `packages/daemon/src/memory/store.ts`
- Test: `packages/daemon/src/memory/store.test.ts`

**Step 2.1 — RED: write store-primitive tests.** Use a real `mkdtempSync` store.

```ts
import { normalizeFactText } from "./providers/smart-distiller-provider.js"; // reuse the SINGLE definition

test("recordForgottenFact inserts a row keyed on normalized text", () => {
  store.recordForgottenFact({ raw_text: "Favourite Colour: Blue.", provenance: "m1,m2",
    actor: "user", reason: "hatch-forget", authored_by: "human" });
  expect(store.isForgottenNormalizedText(normalizeFactText("favourite colour: blue"))).toBe(true);
});

test("readForgottenFacts returns normalized + raw + provenance for the layers", () => {
  store.recordForgottenFact({ raw_text: "X", provenance: "p", actor: "u", authored_by: "human" });
  const rows = store.readForgottenFacts();
  expect(rows[0]!.normalized_text).toBe(normalizeFactText("X"));
  expect(rows[0]!.raw_text).toBe("X");
  expect(rows[0]!.provenance).toBe("p");
});

test("clearForgottenByNormalizedText removes the un-forget row(s)", () => {
  store.recordForgottenFact({ raw_text: "likes tea", provenance: "p", actor: "u", authored_by: "human" });
  const removed = store.clearForgottenByNormalizedText(normalizeFactText("likes tea"));
  expect(removed).toBeGreaterThan(0);
  expect(store.isForgottenNormalizedText(normalizeFactText("likes tea"))).toBe(false);
});

test("purgeLiveMachineFactsByForget deletes by provenance OR normalized text, never a human row", () => {
  store.insertDistilledFacts([
    { fact: "fav colour: blue", provenance: "m1,m2", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "fav colour: blue", provenance: "different", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "human" } as any,
  ], "smart");
  const n = store.purgeLiveMachineFactsByForget("m1,m2", normalizeFactText("fav colour: blue"));
  expect(n).toBe(1); // machine row gone (matched provenance AND text)
  const rows = store.readDistilledFacts(50);
  expect(rows.some((r) => r.authored_by === "human")).toBe(true); // human row survives
});

test("purgeLiveMachineFactsByForget catches a comma-joined row by TEXT when provenance differs (no purge-miss)", () => {
  store.insertDistilledFacts([
    { fact: "User favourite colour is blue", provenance: "x,y,z", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  // forgotten with a DIFFERENT provenance shape but the same normalized text
  const n = store.purgeLiveMachineFactsByForget("m1", normalizeFactText("User favourite colour is blue"));
  expect(n).toBe(1);
});
```

MINOR-1 (origin-thread resolution) — add a focused store test that drives the `thread-local` injection through a comma-joined provenance:

```ts
test("MINOR-1: a thread-local fact with comma-joined provenance injects into its origin thread (resolved in code)", () => {
  const tOrigin = store.createThread();
  const [a] = store.appendMessages(tOrigin, [{ role: "user", content: "alpha" }], "s");
  const [b] = store.appendMessages(tOrigin, [{ role: "assistant", content: "beta" }], "s");
  store.insertDistilledFacts([
    { fact: "thread-local agg", provenance: `${a},${b}`, scope: "thread-local", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");

  const here = store.readDistilledFactsForThread(tOrigin, 20);
  expect(here.some((f) => f.fact === "thread-local agg")).toBe(true);

  const other = store.createThread();
  const there = store.readDistilledFactsForThread(other, 20);
  expect(there.some((f) => f.fact === "thread-local agg")).toBe(false); // private stays home
});
```

**Step 2.2 — Run, verify RED.** `bun test packages/daemon/src/memory/store.test.ts` → methods undefined / MINOR-1 assertion fails (the `m.id = df.provenance` join can't match `"a,b"`).

**Step 2.3 — GREEN: implement the store methods.** Add to `MemoryStore`:

- `recordForgottenFact(e: { raw_text: string; provenance: string | null; actor: string; reason?: string; authored_by: "human" | "machine" }): void` — `INSERT INTO forgotten_facts(id, normalized_text, raw_text, provenance, actor, reason, authored_by, created_at) VALUES (...)`, computing `normalized_text = normalizeFactText(e.raw_text)`. Import `normalizeFactText` from `./providers/smart-distiller-provider.js` (the single definition — Reality check confirms it is exported at `smart-distiller-provider.ts:74`).
- `readForgottenFacts(): { normalized_text: string; raw_text: string; provenance: string | null }[]` — `SELECT normalized_text, raw_text, provenance FROM forgotten_facts`.
- `isForgottenNormalizedText(norm: string): boolean` — `SELECT 1 FROM forgotten_facts WHERE normalized_text = ? LIMIT 1` (uses the index).
- `clearForgottenByNormalizedText(norm: string): number` — `DELETE FROM forgotten_facts WHERE normalized_text = ? RETURNING id` → return `.length`.
- `purgeLiveMachineFactsByForget(provenance: string, normalizedText: string): number` — `DELETE FROM distilled_facts WHERE (provenance = ? OR ? IN (...)) AND authored_by != 'human'`. SQLite cannot call `normalizeFactText` in SQL, so match text in code: read candidate machine rows (`SELECT id, fact, provenance FROM distilled_facts WHERE authored_by != 'human'`), delete those whose `provenance === provenance` OR `normalizeFactText(fact) === normalizedText`, by `id`. Wrap in one `db.transaction`. Return count. (Keeps the `authored_by != 'human'` 5e guard — Reality check requirement.)
- `hasHumanFactWithNormalizedText(norm: string): boolean` — `SELECT id, fact FROM distilled_facts WHERE authored_by = 'human'`, return true if any normalizes equal. (Layer-T 5e guard in Step 6.)
- `originThreadsForProvenance(provenance: string): string[]` (MINOR-1 helper) — if `provenance.startsWith("thread:")` → `[provenance.slice(7)]`; else split on `,`, trim, keep `isMessageId` components, `SELECT thread_id FROM messages WHERE id = ?` for each, dedupe.

**Step 2.4 — GREEN: rewrite `readDistilledFactsForThread` (MINOR-1, D-D).** Replace the `LEFT JOIN messages m ON m.id = df.provenance` approach (lines 209, 215-220) with in-code origin-thread resolution. Two-phase: SELECT the non-expiry-filtered candidate rows (keep the existing `expiry`, scope, ordering, LIMIT logic), then for `thread-local` rows compute `originThreadsForProvenance(provenance)` in code and keep the row iff `forThreadId ∈ originThreads`. `cross-thread`/`global`/NULL still cross unconditionally. Preserve the `ORDER BY (authored_by='human') DESC, derived_at DESC, rowid ASC` and `LIMIT` (apply LIMIT AFTER the in-code filter so the slice is full). Keep `thread:<id>` handled uniformly via the same helper.

**Step 2.5 — Run.** `bun test packages/daemon/src/memory/store.test.ts` → green. Confirm no regression in existing `readDistilledFactsForThread` tests (cross-thread sharing, human-precedence ordering).

**Commit:** `feat(memory-quality): forgotten_facts store primitives + MINOR-1 in-code origin-thread resolution — chunk 04`

---

### Step 3 — WriteGate: `forgetFact` (no-scrub + record + purge), un-forget, message path UNCHANGED

**Files:**
- Modify: `packages/daemon/src/memory/write-gate.ts`
- Test: `packages/daemon/src/memory/write-gate.test.ts`

**Step 3.1 — RED: write WriteGate tests.**

```ts
test("forgetFact writes a forgotten_facts row and purges the live machine row — NO scrub, NO mutations", () => {
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "source msg" }], "s");
  store.insertDistilledFacts([
    { fact: "favourite colour: blue", provenance: mid!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");

  gate.forgetFact("favourite colour: blue", mid!, { actor: "user", authored_by: "human" }, "hatch-forget");

  // durable record present
  expect(store.isForgottenNormalizedText(normalizeFactText("favourite colour: blue"))).toBe(true);
  // live machine row purged
  expect(store.readDistilledFacts(50).some((f) => f.fact === "favourite colour: blue")).toBe(false);
  // message byte-intact, no mutations row (B1 at the gate)
  const db = store.rawDb();
  expect((db.query("SELECT content FROM messages WHERE id=?").get(mid!) as any).content).toBe("source msg");
  expect(db.query("SELECT id FROM mutations WHERE target_message_id=?").get(mid!)).toBeNull();
});

test("forgetFact never calls tombstoneFact even for a comma-joined provenance", () => {
  const spy = spyOn(store, "tombstoneFact");
  gate.forgetFact("agg fact", "id1,id2", { actor: "user", authored_by: "human" });
  expect(spy).not.toHaveBeenCalled();
});

test("un-forget: a human edit whose normalized content matches a forgotten row clears it", () => {
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "likes tea" }], "s");
  store.recordForgottenFact({ raw_text: "likes tea", provenance: "p", actor: "u", authored_by: "human" });
  expect(store.isForgottenNormalizedText(normalizeFactText("likes tea"))).toBe(true);

  gate.edit(mid!, "likes tea", { actor: "user", authored_by: "human" }); // human re-authorship

  expect(store.isForgottenNormalizedText(normalizeFactText("likes tea"))).toBe(false); // un-forgotten
});
```

**Step 3.2 — Run, verify RED.** `forgetFact` has the old `(provenance, ctx, reason)` signature and calls `tombstoneFact`; un-forget clear does not exist.

**Step 3.3 — GREEN: rewrite `WriteGate.forgetFact`.** New signature `forgetFact(factText: string, provenance: string, ctx: WriteContext, reason?: string): void`. Body (NO `isMessageId` throw on `factText`; NO `tombstoneFact`; NO scrub):
1. `const norm = normalizeFactText(factText);`
2. `this.store.recordForgottenFact({ raw_text: factText, provenance, actor: ctx.actor, reason, authored_by: ctx.authored_by });`
3. `this.store.purgeLiveMachineFactsByForget(provenance, norm);`

Delete the old `forgetFact` body (lines 115-136). Remove the now-unused `isMessageId` import from `write-gate.ts` ONLY if no other method uses it (it does not — verify; `forget` uses `threadOf`, not `isMessageId`). **`WriteGate.forget` (message path, lines 70-98) is untouched.**

**Step 3.4 — GREEN: wire un-forget into `WriteGate.edit`.** At the END of `edit` (after the existing correction INSERT + mirror, lines 158-161), when `ctx.authored_by === "human"`, clear any matching forgotten row: `this.store.clearForgottenByNormalizedText(normalizeFactText(replacement));`. Add a comment: this is the deliberate inverse of D6 — human precedence cuts both ways (ADR-0015 decision 4). Note in the comment that the load-bearing un-forget path is human-fact authoring (the human-pin route); a message-edit clear fires only when the edited content normalizes to a forgotten fact's text (rare, but correct).

> If a distinct human-fact AUTHOR path exists separate from `edit` (a human-pin write), wire the same `clearForgottenByNormalizedText` there too. Reality check found no separate human-fact author method in `write-gate.ts` in v0 (human facts survive `replaceProjection` via `authored_by != 'human'`; they are not authored through a dedicated gate method here). The `edit` hook satisfies the spec's "authoring/editing" for v0. If execution surfaces a human-pin write path, extend it identically — mechanical, no new decision.

**Step 3.5 — Run.** `bun test packages/daemon/src/memory/write-gate.test.ts` → green. Confirm existing `WriteGate.forget`/`edit`/5e tests still pass (message path unchanged).

**Commit:** `feat(memory-quality): WriteGate.forgetFact = no-scrub durable record + un-forget on human edit — chunk 04`

---

### Step 4 — Hatch named methods (delete the shape-router) + option B + HTTP dispatch

**Files:**
- Modify: `packages/daemon/src/memory/hatch.ts`
- Modify: `packages/daemon/src/memory/write-gate.ts` (add `forgetFactAndSources`)
- Modify: `packages/daemon/src/memory/http-routes.ts`
- Test: `packages/daemon/src/memory/hatch.daemon.test.ts` (Step 1's B1 test goes GREEN here) + `packages/daemon/src/memory/http-routes.daemon.test.ts`

**Step 4.1 — RED: write option-B + dispatch tests** (in addition to Step 1's B1 test which goes green here).

```ts
test("forgetFactAndSources scrubs each isMessageId source; plain forgetFact leaves them intact", async () => {
  const hatch = new Hatch(store, gate);
  const t = store.createThread();
  const [m1] = store.appendMessages(t, [{ role: "user", content: "src one" }], "s");
  const [m2] = store.appendMessages(t, [{ role: "assistant", content: "src two" }], "s");

  hatch.forgetFactAndSources("derived fact", `${m1},${m2}`, { actor: "user", authored_by: "human" });

  const db = store.rawDb();
  expect((db.query("SELECT content FROM messages WHERE id=?").get(m1!) as any).content).toBe(REDACTION_MARKER);
  expect((db.query("SELECT content FROM messages WHERE id=?").get(m2!) as any).content).toBe(REDACTION_MARKER);
  // and the durable fact-forget record exists too
  expect(store.isForgottenNormalizedText(normalizeFactText("derived fact"))).toBe(true);
});

test("forgetFactAndSources on a thread:<id> provenance is a no-op scrub (record only), never a whole-thread scrub", async () => {
  const hatch = new Hatch(store, gate);
  const t = store.createThread();
  const [m] = store.appendMessages(t, [{ role: "user", content: "stays" }], "s");
  hatch.forgetFactAndSources("thread fact", `thread:${t}`, { actor: "user", authored_by: "human" });
  const db = store.rawDb();
  expect((db.query("SELECT content FROM messages WHERE id=?").get(m!) as any).content).toBe("stays"); // not scrubbed
  expect(store.isForgottenNormalizedText(normalizeFactText("thread fact"))).toBe(true); // record still made
});
```

HTTP dispatch (in `http-routes.daemon.test.ts`, real daemon + token):

```ts
test("POST /memory/forget target_type=fact does NOT scrub the source message", async () => {
  // seed a message; send a fact-forget whose provenance is that bare UUID
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${readToken()}` },
    body: JSON.stringify({ target_type: "fact", fact_text: "fav colour blue", provenance: seededMessageId, reason: "t" }),
  });
  expect(res.status).toBe(204);
  // assert seededMessage content unchanged on disk (read the store)
});

test("POST /memory/forget target_type=message still scrubs (regression)", async () => { /* 204 + REDACTION_MARKER on disk */ });
```

**Step 4.2 — Run, verify RED.** Methods/fields don't exist yet.

**Step 4.3 — GREEN: rewrite `Hatch`.** Delete `forget` (lines 81-87) and the `isMessageId` import (line 26). Add:

```ts
forgetMessage(messageId: string, ctx: WriteContext, reason?: string): void {
  this.gate.forget(messageId, ctx, reason); // HARD scrub — isMessageId asserts INSIDE the message path
}
forgetFact(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
  this.gate.forgetFact(factText, provenance, ctx, reason); // BEST-EFFORT; no scrub
}
forgetFactAndSources(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
  this.gate.forgetFactAndSources(factText, provenance, ctx, reason); // opt-in HARD escape (option B)
}
```

Update the class doc comment to describe the three intent-named operations and the separate-artifact invariant (no shape heuristic).

**Step 4.4 — GREEN: add `WriteGate.forgetFactAndSources`.**

```ts
forgetFactAndSources(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
  // 1. the same durable fact-forget record + purge (no scrub of its own)
  this.forgetFact(factText, provenance, ctx, reason);
  // 2. option B: hard-scrub each message-id source via the EXISTING message path.
  //    thread:<id> provenance has no specific source messages → no-op (never a whole-thread scrub).
  if (provenance.startsWith("thread:")) return;
  for (const comp of provenance.split(",").map((p) => p.trim())) {
    if (isMessageId(comp)) this.forget(comp, ctx, reason); // reuse WriteGate.forget (HARD)
  }
}
```

(Re-add the `isMessageId` import to `write-gate.ts` — it is used here.)

**Step 4.5 — GREEN: HTTP dispatch in `http-routes.ts`.** In `handleForget` (lines 127-151), after the token gate + `parseBody`, read `target_type`, `fact_text`, `provenance`, `also_forget_sources` from the body. Dispatch:
- `target_type === "message"`: require `target` string → `deps.hatch.forgetMessage(target, HTTP_CTX, reasonStr)`.
- `target_type === "fact"`: require `fact_text` string + `provenance` string → if `also_forget_sources === true` → `forgetFactAndSources(fact_text, provenance, HTTP_CTX, reasonStr)`; else `forgetFact(fact_text, provenance, HTTP_CTX, reasonStr)`.
- missing/invalid `target_type` → 400 `bad_body`.

Keep `mapWriteError` (lines 208-223) — the `forgetMessage` path can still throw `target_not_found`; the `tombstoneFact` UUID-guard regex stays as defensive mapping. Update the route doc comment (the body shape is a de-facto contract; ADR-0015 / spec §2 D-A — these fields are additive, NOT a frozen-wire change).

**Step 4.6 — Run.** `bun test packages/daemon/src/memory/hatch.daemon.test.ts packages/daemon/src/memory/http-routes.daemon.test.ts` → Step 1's B1 test now GREEN; option-B + dispatch green. Update any existing `hatch.daemon.test.ts` tests that called `hatch.forget(...)` (the deleted method) to the new named methods (e.g. T1.2(a) `hatch.forget("thread:…")` → `hatch.forgetFact(threadFact.fact, "thread:…")`; T1.2(c)/(d) `hatch.forget(mid)` → `hatch.forgetMessage(mid)`). This is mechanical call-site migration; preserve each test's intent.

**Commit:** `feat(memory-quality): intent-named Hatch forget methods + option B + HTTP target_type dispatch — chunk 04`

---

### Step 5 — Smart distiller: re-source layers from `forgotten_facts` (honest), 5e-aware, retrieve backstop

**Files:**
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts`
- Test: `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` + `packages/daemon/src/memory/distiller-integration.daemon.test.ts`

**Step 5.1 — RED: write the honest-layer tests** (drive the PROD path — forget through real `WriteGate`/`forgotten_facts`, NOT a fabricated `tombstoneFact("thread:<id>")`).

```ts
// Layer-T — the ONE real layer (chunk DoD line 88: "Layer-P must NOT carry the RED")
test("Layer-T: a forgotten smart fact is suppressed on re-projection via forgotten_facts.normalized_text", async () => {
  const store = freshStore();
  const gate = new WriteGate(store, new RuleBasedScanner());
  const t = store.createThread();
  const [mid] = store.appendMessages(t, [{ role: "user", content: "favourite colour: blue" }], "s");
  // forget the FACT (durable record; provenance differs from any re-derived provenance)
  gate.forgetFact("favourite colour: blue", "some-old-prov", { actor: "user", authored_by: "human" });

  // echo-stub re-emits the same normalized text under a FRESH provenance → Layer-T must drop it
  const smart = new SmartDistillerProvider({ client: echoFactClient("favourite colour: blue", "fresh-prov") });
  const result = await smart.distill(store, t);
  expect(result.facts.some((f) => normalizeFactText(f.fact) === normalizeFactText("favourite colour: blue"))).toBe(false);
});

test("5e-aware: Layer-T does NOT suppress when a human-authored fact with the same normalized text exists", async () => {
  const store = freshStore();
  const gate = new WriteGate(store, new RuleBasedScanner());
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "likes tea" }], "s");
  gate.forgetFact("likes tea", "p", { actor: "user", authored_by: "human" });
  // a human pinned the same fact
  store.insertDistilledFacts([
    { fact: "likes tea", provenance: "human-pin", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "human" } as any,
  ], "human");

  const smart = new SmartDistillerProvider({ client: echoFactClient("likes tea", "fresh") });
  const result = await smart.distill(store, t);
  // candidate NOT suppressed because a human fact with the same normalized text exists
  expect(result.facts.some((f) => normalizeFactText(f.fact) === normalizeFactText("likes tea"))).toBe(true);
});

test("retrieve() backstop: a forgotten fact still in distilled_facts is filtered by the forgotten_facts text check", async () => {
  const store = freshStore();
  // a live machine row whose text was forgotten but (hypothetically) survived the purge window
  store.insertDistilledFacts([
    { fact: "fav colour blue", provenance: "thread:zzz", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  store.recordForgottenFact({ raw_text: "fav colour blue", provenance: "thread:zzz", actor: "u", authored_by: "human" });

  const smart = new SmartDistillerProvider();
  const slice = await smart.retrieve(store, store.createThread());
  expect(slice.some((m) => m.content.includes("fav colour blue"))).toBe(false);
});
```

(`echoFactClient(fact, provenance)` is a one-liner stub variant of the existing `echoClient` — returns `JSON.stringify([{fact, provenance, scope:"cross-thread", expiry:null, confidence:1}])`.)

Integration (`distiller-integration.daemon.test.ts`, §7.1 re-validation, fresh isolated store):

```ts
test("§7.1: forget interleaved with re-projection does not corrupt the projection (fact stays gone, prior projection intact)", async () => {
  // seed, dismiss→distill with makeEchoStub (fact present), forgetFact through gate,
  // dismiss again → distill → assert the forgotten fact absent; a safe fact still present.
});
```

**Step 5.2 — Run, verify RED.** Today Layer-2 reads `_getTombstonedTexts` (dead — purged rows have no text), so Layer-T DoD fails; 5e-aware filter absent; retrieve backstop absent.

**Step 5.3 — GREEN: re-source the layers.** In `distill` (replace the Phase-1d block, lines 362-381) and `_getTombstonedTexts` (lines 393-412):
- Read the suppression set from `store.readForgottenFacts()` (NOT `readDistilledFacts` + `isFactTombstoned`). Build `forgottenNorms = new Set(rows.map(r => r.normalized_text))`, `forgottenProvSets = rows.map(r => sortedSet(r.provenance))`, `forgottenRaw = rows.map(r => r.raw_text)`.
- **Layer-T (the one real layer):** drop candidate iff `forgottenNorms.has(normalizeFactText(f.fact))` AND NOT `store.hasHumanFactWithNormalizedText(normalizeFactText(f.fact))` (5e-aware — R6).
- **Layer-P (opportunistic nudge):** drop iff the candidate's normalized provenance SET equals a `forgottenProvSets` entry (B1: set EQUALITY, not intersection). Comment: opportunistic/audit, fires rarely because provenance is unstable; never marketed as defense.
- **Layer-X (soft nudge):** keep the existing system-prompt exclusion block, but source `tombstonedRawTexts` from `forgottenRaw` (lines 332-340). Comment: a generative model can ignore it.
- **Rename `_getTombstonedTexts` → `_getForgottenSuppression`** returning `{ norms: Set<string>; provSets: Set<string>[]; rawTexts: string[] }`. Delete the old `distilled_facts`+`isFactTombstoned` text-recovery (the dead MAJOR-1 path).
- **Comment discipline:** the layer block comment says "one real text-match layer plus two opportunistic nudges (provenance-set match, LLM exclusion)." **The string "3 layers of defense" must not appear anywhere** (R5).

**Step 5.4 — GREEN: retrieve backstop (D-F).** In `retrieve` (line 422-424) keep the existing `!store.isFactTombstoned(f.provenance)` filter AND add `&& !store.isForgottenNormalizedText(normalizeFactText(f.fact))`. Comment: defense-in-depth covering the window between a forget and the next re-projection (the immediate purge is best-effort-immediate; this + the re-projection layers are the durable guarantee).

**Step 5.5 — Run.** `bun test packages/daemon/src/memory/providers/smart-distiller-provider.test.ts packages/daemon/src/memory/distiller-integration.daemon.test.ts` → green. Update the existing Layer-2 test (lines 368-410) and the `_getTombstonedTexts`-named test (around line 601) to the new `forgotten_facts`-sourced API — preserve their assertion intent (normalized-text suppression).

**Commit:** `feat(memory-quality): smart distiller suppression re-sourced from forgotten_facts (Layer-T real, 5e-aware) + retrieve backstop — chunk 04`

---

### Step 6 — UI (history.html): per-button `target_type` + option-B confirmed control with co-fed count; EXECUTED round-trip probe; full gate

**Files:**
- Modify: `packages/daemon/src/memory/history-page.ts` (guard lift per ADR-0015)
- Modify: `packages/daemon/src/memory/store.ts` (add the co-fed COUNT read used by option B)
- Create: `packages/daemon/scripts/forget-roundtrip-probe.ts`
- Test: existing daemon tests + the probe RUN

**Step 6.1 — RED (co-fed count store read).** `store.test.ts`:

```ts
test("countFactsFedByMessages returns how many OTHER distilled facts a set of source messages feed", () => {
  store.insertDistilledFacts([
    { fact: "f1", provenance: "m1,m2", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "f2", provenance: "m2,m3", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
    { fact: "self", provenance: "m1", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], "smart");
  // facts fed by {m1} excluding the fact being forgotten ("self")
  expect(store.countFactsFedByMessages(["m1"], "self")).toBe(1); // f1 also feeds on m1
});
```

**Step 6.2 — GREEN: `store.countFactsFedByMessages(messageIds: string[], excludeFactText: string): number`** — read machine `distilled_facts`, count rows (excluding the one whose fact === excludeFactText) whose provenance comma-set intersects `messageIds`. Used by the option-B confirm to surface "informed intent" (ADR-0015 decision 5).

**Step 6.3 — GREEN: `history-page.ts` edits.**
- Message "Forget" button (`renderMessages`, lines 326-331): send `{ target_type: "message", target: msgId, reason: "hatch-forget" }`. Capture `m.id`.
- Fact "Forget fact" button (`renderFacts`, lines 375-381): capture BOTH `f.fact` AND `f.provenance` in the closure; send `{ target_type: "fact", fact_text: f.fact, provenance: f.provenance, reason: "hatch-forget" }`. (Reality check: `f.fact` is already in `renderFacts` scope at line 364 — just add it to the closure args.)
- **Option-B control:** in the fact row, add a distinct, separately-styled secondary control "⚠ also delete the N source message(s)" shown on the fact's confirm step. Its copy surfaces the source-message count (`provenance.split(",").filter(isMessageId-shaped).length`, computed client-side from the provenance string) AND the co-fed count (fetched/derived — for v0 keep it simple: the daemon already has `countFactsFedByMessages`; expose it via the existing thread view is overkill, so render the source count client-side and the co-fed warning generically, OR have option-B POST with `also_forget_sources:true`). The control POSTs `{ target_type:"fact", fact_text, provenance, also_forget_sources:true }`. A `thread:<id>` provenance → disable/hide the control with the copy "this fact has no specific source messages to delete." Keep all DOM building via `textContent`/`createElement` (XSS discipline, lines 264/316/368).
- `doForget` (lines 432-498): generalize to accept the full body object instead of a single `target`. The two-step arm/confirm UX stays.

> **Co-fed count surfacing — execution note.** The cheapest honest v0: render the source-message count client-side from the provenance string, and label the option-B button "⚠ also delete N source message(s) (may affect other remembered facts)." If the orchestrator wants the exact co-fed integer in the UI, add a tiny `GET /memory/cofed?provenance=…` route backed by `countFactsFedByMessages`; that is additive and within scope. Either satisfies ADR-0015 decision 5 ("source-message count AND count of OTHER facts those messages feed"). Pick the route-backed exact count if time allows; the client-side count + generic warning is the floor. **This is the one genuine product-UX latitude in the chunk — neither violates the spec.**

**Step 6.4 — EXECUTED round-trip probe (Strike-5).** Create `packages/daemon/scripts/forget-roundtrip-probe.ts` (model on `scripts/smart-distiller-probe.ts`): seed a real on-disk store, distill a smart fact (use the `makeEchoStub`-equivalent OR a real Keychain Haiku call — the existing smart-distiller-probe proves Keychain reachability), forget it through the REAL path (`Hatch.forgetFact` → as the HTTP body would dispatch → `WriteGate` → `forgotten_facts`), re-project with an echo stub re-emitting the same text, assert (a) the fact stays gone and (b) the source message content is byte-intact. Print PASS/FAIL + the surviving source content (NEVER any key value). Banner Strike-5 disclaimer.

**Step 6.5 — RUN the probe (orchestrator runs live, captures stdout).** `bun run packages/daemon/scripts/forget-roundtrip-probe.ts` → expected: banner → fact created → forget → re-project → "fact stays gone: true" + "source intact: true" → `PROBE PASSED` → exit 0. **This RAN stdout is the DoD evidence; paste into the PR body. Requires runtime confirmation — not satisfied by written+typechecked.**

**Step 6.6 — Full gate (mechanical).** Run and confirm exit 0:
- `bun test` (whole suite; real SQLite, only the LLM `clientFactory` stubbed)
- `bun run lint:strict`
- `bun run typecheck`
- `apps/overlay` typecheck (if the repo convention runs it — plan-03 did)
- **Frozen-surface diff byte-empty:** `git diff main -- packages/protocol` and the mock reducer (`mock-agent.ts`) → empty.
- **grep gate:** `rg -n "3 layers" packages/daemon orchestration/docs/plans/memory-quality/plan-04-forget-contract.md` → no hits (R5).

**Commit:** `feat(memory-quality): history.html intent-per-button + option-B confirmed control + EXECUTED forget round-trip probe (Strike-5) — chunk 04`

---

## DoD → Step/Test map

| Chunk DoD line | Step | Proving test |
|---|---|---|
| B1 NAMED GATE — fact path never scrubs / no mutations row; message still scrubs | 1 (RED) → 4 (GREEN) | `hatch.daemon.test.ts` B1 no-downgrade pair |
| Layer-T fires on PROD shape via `forgotten_facts.normalized_text` (Layer-P does NOT carry the RED) | 5 | `smart-distiller-provider.test.ts` Layer-T test (fresh provenance) |
| 5e-aware: human-authored matching text NOT suppressed; human re-authorship clears | 3 (un-forget) + 5 (5e filter) | `write-gate.test.ts` un-forget; `smart-distiller-provider.test.ts` 5e-aware |
| Option B scrubs sources; plain fact-forget leaves intact; `thread:<id>` → no-op | 4 | `hatch.daemon.test.ts` option-B pair; `http-routes.daemon.test.ts` dispatch |
| MINOR-1: thread-local multi-source fact injects into origin thread(s) only | 2 | `store.test.ts` MINOR-1 |
| Full `bun test` + `lint:strict` + typecheck exit 0; real SQLite; only clientFactory stubbed; frozen surfaces byte-unchanged | 6 | full gate + frozen diff + grep gate |
| EXECUTED probe RUN (Strike-5) | 6 | `forget-roundtrip-probe.ts` RAN, stdout in PR |
| Behavioral DoD | — | DEFERRED to chunk 06 (no behavioral gate this chunk) |

---

## Test plan

All tests REAL SQLite (`mkdtempSync` fresh store / isolated daemon dirs). ONLY permitted mock = the LLM `clientFactory` (echo/reject stubs) or a deterministic fake `MemoryProvider`. No mocked store, no mocked WriteGate, no mocked Hatch. Each new test verified RED-without-fix → GREEN-with-fix. Existing call-sites of the deleted `Hatch.forget` migrated to the named methods, intent preserved (Step 4.6).

---

## Frozen surfaces (gate)

`@agentic/protocol` and the mock reducer (`mock-agent.ts`) must be byte-unchanged — verified by an empty `git diff main` on those paths. The `target_type`/`also_forget_sources`/`fact_text` fields are additive to the `POST /memory/forget` HTTP body, which is NOT a frozen wire envelope (ADR-0015 relationship §; ADR-0013 token-gated write surface). No protocol change.

---

## Notes for the executing worker

- Reuse the SINGLE `normalizeFactText` (`smart-distiller-provider.ts:74`) everywhere (store purge/match, Layer-T, un-forget). Do NOT duplicate it. Importing a provider helper into `store.ts` is acceptable (the store already imports `DistilledFact` from `memory-provider.ts`); if a worker prefers to avoid a store→provider import cycle, extract `normalizeFactText` to a tiny `memory/normalize-fact-text.ts` and re-export from the provider — mechanical, no behavior change, no decision.
- The §7.1 coupling is REAL: re-validate the interleave test (Step 5.1 integration) actually exercises a forget around an in-flight `distill`, not just sequentially.
- Keep the `tombstoneFact` `isMessageId`-throw and `mapWriteError`'s regex branch — they are the surviving defensive assertions (ADR-0015 decision 1), not dead code to remove.

Files relevant to this plan (absolute):
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/schema.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/store.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/write-gate.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/hatch.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/http-routes.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/providers/smart-distiller-provider.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/history-page.ts`
- `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/distiller-registration.ts`

---

## Orchestrator decisions on architect's two execution flags (resolved, not forks)

The architect flagged two items as latitude; both are spec-determined, pinned here so the
worker has no ambiguity:

1. **Co-fed count (Step 6.3) — PINNED to the route-backed EXACT count.** Spec §2 D-C and
   ADR-0015 decision 5 require the option-B confirm to surface "the source-message count AND
   the count of OTHER facts those messages feed." A client-side generic warning does NOT
   satisfy "the count of OTHER facts" — surface the exact integer via the small additive
   `GET /memory/cofed` route backed by `countFactsFedByMessages`. (Additive HTTP surface, not
   a frozen wire envelope; same posture as the `target_type` body fields.)
2. **Un-forget path (Step 3.4) — ACCEPTED as planned (`WriteGate.edit`).** v0 has no dedicated
   human-fact *author* gate method (human facts survive `replaceProjection` via
   `authored_by != 'human'`, not a WriteGate write). Wiring the un-forget clear into
   `WriteGate.edit` is faithful to the spec's "author/edit path" given the real code. §7.2
   citation test: contradicts no frozen artifact; cheap to extend if a human-pin author path
   later surfaces (it gets the identical clear). Proceed.
