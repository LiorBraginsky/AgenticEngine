# Chunk 05 (dedup case-fix) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:test-driven-development` and `superpowers:executing-plans`. Steps use `- [ ]` checkboxes. RED-first is mandatory (chunk §Task item 1 + DoD).

## Status

- Phase 1 (planning): **Done** — architect root-caused the defect; plan persisted 2026-07-13.
- Phase 2 (implementation + review): pending.
- Phase 3 (verified-done + closeout): pending.

**Goal:** One user statement must yield ONE machine fact across both write paths (tool-`memory_remember` at turn-time + distiller re-derivation at dismiss) — closing demo defect D1 (spec §3.5 d6 "no dup spam").

**Architecture:** Add the **user-language display-text norm** as a shared dedup axis (the one representation both write paths produce identically via the existing `normalizeFactText`) on both the stored side (`store.factExistsByDedupKey`) and the query side (`applyFactOp`), while keeping the existing English-canonical axis (load-bearing for cross-language distiller dedup). One shared helper; no forked normalization.

**Tech stack:** TypeScript on Bun, real `bun:sqlite` in tests, no LLM.

---

## Root cause

**The decomposer's "case-sensitive dedup key" framing (hypotheses a/b/c) is FALSIFIED against the code. The real divergence is canonical *derivation* — the two write paths key dedup on different-language strings.**

Both write paths funnel through the shared `applyFactOp` (`packages/daemon/src/memory/apply-fact-op.ts:44`), and its dedup gate is `store.factExistsByDedupKey(canonical)` at **apply-fact-op.ts:126**. The dedup key resolves like this:

- **The dedup key itself is already case-INSENSITIVE.** `factExistsByDedupKey` (**store.ts:547-559**) normalizes *both* the query and the stored key: `normalizeFactText(r.key) === norm || dedupConnectorKey(r.key) === conn` (line 558), and `normalizeFactText` lowercases at **normalize-fact-text.ts:25**. So a pure first-letter-case variant on the *same* key already collapses. Hypothesis (a) ("insert-path dedup key case-SENSITIVE") and (c) ("missing lowercase on one path") do **not** hold.

- **What actually diverges is the stored `canonical` string, by LANGUAGE:**
  - **Tool-insert path** (`MemoryActionPort.remember`): `norm = normalizeFactText(input.fact)` (**memory-action-port.ts:156**) and it stores `canonical: norm` (**:217**, and the pre-check at **:214**). The port has **no LLM**, so its canonical is the **user-language display text**, normalized — e.g. `"мій улюблений напій - чай"`.
  - **Distiller-derivation path**: `applyFactOp(..., canonical: op.canonical || normalizeFactText(op.fact), ...)` (**distiller-registration.ts:214**), where `op.canonical` is, by the distiller's own system prompt, a **"lowercased ENGLISH match key"** (**smart-distiller-provider.ts:98, :109, :117** — e.g. `"user likes tea"`), deliberately English for FTS5/BM25.

- **`factExistsByDedupKey` matches only on the stored canonical** (`COALESCE(f.canonical, d.fact)`, **store.ts:553**). For the same logical fact, the tool's user-language canonical (`"мій улюблений напій - чай"`) and the distiller's English canonical (`"user likes tea"`) never normalize-match, and their connector keys don't match either → the **second writer's dedup misses → two rows**. The demo's "differ only in first-letter case" is a surface artifact of the two *display* texts; the load-bearing divergence is the *canonical language*.

**Which hypothesis held:** the write-path pairing is (a)/(b) as the chunk expected — tool-`remember` at turn-time + distiller re-derivation at dismiss — but the divergent *key* is **not** case; it is canonical-derivation (user-language-normalize vs LLM-English-keyword). The codebase already documents this exact hazard class for the sibling D6b consult: **distiller-registration.ts:193-198** ("a re-derivation that shares the same canonical but reworded display text (esp. cross-language) can still slip past here"). This fix closes the analogous gap on the *live-fact* dedup.

**Note:** the fix is robust to the less-likely alternate reading (two distiller dismisses emitting inconsistent English canonicals for the same fact) — the same display-axis dedup collapses that too.

## The routing decision (spec §3.7)

A case/display variant re-derivation of an **unchanged** fact is a **duplicate ⇒ suppress-as-dup**, never REPLACE, never a sibling. §3.7a reserves REPLACE for a *changed attribute*, decided by an explicit `targetOrdinal`/`replaces_ordinal` + a genuine contradiction — none of which is present for a same-fact re-derivation. `applyFactOp`'s existing `op:"new"` dedup gate returns `"deduped"`/`"demoted-deduped"` (no new row, existing row untouched). The fix routes cross-path duplicates through that same gate. This satisfies DoD (a) "ONE fact survives (suppress-as-dup … never a sibling)."

## Reality check

- **Code paths that exist** (traced by reading; runtime behavior is proven by the RED test, not code-reading):
  - Both write paths call the shared `applyFactOp`; its only new-insert dedup gate is `factExistsByDedupKey` (apply-fact-op.ts:126).
  - `factExistsByDedupKey` is case-insensitive and keys on the stored canonical only (store.ts:547-559).
  - The distiller emits an English canonical (smart-distiller-provider.ts:117); the tool stores a user-language canonical (memory-action-port.ts:156, :217).
- **Frozen-surface impact = NONE (§7.2 citation test).** The fix touches exactly `packages/daemon/src/memory/store.ts` and `packages/daemon/src/memory/apply-fact-op.ts` (+ test files). It does **not** touch `@agentic/protocol`, the mock reducer, or the mock provider (`mock-agent.ts`). No wire/type/envelope change. No freeze gate. If any edit would touch a frozen surface → STOP and flag; it must not.
- **`memory-action-port.ts` need not be edited.** Step 2 upgrades its existing `:214` pre-check (which already passes the display-norm) automatically; chunk-01's port file stays byte-untouched.
- **Risk to d5/5e / the 16-rephrase matrix (LOW, must be proven by the full suite):** the fix only *adds* match candidates (the display axis) and *preserves* the canonical axis and the negation guard (`dedupConnectorKey`'s closed set excludes negations — normalize-fact-text.ts:46-51). Rephrasings dedup via the *canonical* axis (unchanged) and have *differing* displays, so the display axis adds no false collapse there. 5e human-precedence (never-replace-human demote, apply-fact-op.ts:70-75) is untouched; the human-target demote test (apply-fact-op.test.ts:166, July≠June) still inserts. The d5 D6b forgotten-suppression consult runs *before* `applyFactOp` (distiller-registration.ts:200) and is independent of this key. **The worker must run the full `bun test` suite and confirm green — this is a DoD gate, not a code-reading claim.**

## Global constraints (copy verbatim into every step's mind)

- **ONE shared normalize/key helper** — use the existing `normalizeFactText` / `dedupConnectorKey` from `normalize-fact-text.ts`. Do **not** fork a second normalization.
- **No scope creep** — dedup-KEY alignment only. O2 (injection-blob reply quality) and O3 (replace-steering miss) are backlog, NOT this chunk.
- **Do NOT weaken the d5/5e forget chain** — the 16-rephrase matrix + 5e precedence suites must stay green.
- **Frozen surfaces byte-identical** — `@agentic/protocol`, mock reducer, mock provider.
- **RED-first** — commit order must show the repro failing pre-fix, passing post-fix.
- Git: branch `chunk/05-dedup-case-fix`, per-task commits with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

---

## Steps

### Step 1 — RED: reproduce the cross-path dedup miss (real sqlite, no LLM)

**Files:**
- Modify (add test): `packages/daemon/src/memory/apply-fact-op.test.ts`

This is the root-cause lock. **The distiller op MUST carry a divergent (English) canonical** — a case-only *Ukrainian*-canonical test is already GREEN on pre-fix code (because `factExistsByDedupKey` normalizes case) and proves nothing.

- [ ] **1.1 Write the failing test** — append to `apply-fact-op.test.ts` (it already imports `applyFactOp`, `MemoryStore`; `normalizeFactText` is available from `./normalize-fact-text.js` — add the import if absent):

```ts
import { normalizeFactText } from "./normalize-fact-text.js";

// ─── chunk-05 (D1): cross-path dedup — tool canonical (user-language) vs
//     distiller canonical (English keyword) must still collapse to ONE fact ──
test("chunk-05 D1: tool-remembered fact + distiller re-derivation (ENGLISH canonical, case-variant display) ⇒ ONE fact, not a sibling", () => {
  const store = freshStore();
  const t = store.createThread();

  // 1. Tool-remember shape: the port has NO LLM, so canonical = normalizeFactText(display) — USER-LANGUAGE.
  const toolFact = "Мій улюблений напій - чай";
  applyFactOp(store, {
    op: "new",
    fact: toolFact,
    canonical: normalizeFactText(toolFact), // "мій улюблений напій - чай"
    topics: [],
    provenance: `thread:${t}`,
  }, "agent");
  expect(store.readDistilledFacts(50).length).toBe(1);

  // 2. Distiller re-derivation at dismiss: the smart distiller emits a LOWERCASED ENGLISH
  //    canonical (smart-distiller-provider.ts:117) with a case-variant user-language display.
  const r = applyFactOp(store, {
    op: "new",
    fact: "мій улюблений напій - чай",           // case-variant display (lowercase м)
    canonical: "user's favorite drink is tea",   // ENGLISH keyword — the real distiller shape
    topics: [],
    provenance: `thread:${t}`,
  }, "distiller-v2");

  expect(r.outcome).toBe("deduped");                    // PRE-FIX: "inserted" (the D1 bug)
  expect(store.readDistilledFacts(50).length).toBe(1);  // PRE-FIX: 2 (the case-dup)

  store.close();
});
```

- [ ] **1.2 Run it and confirm it FAILS.** Run: `bun test packages/daemon/src/memory/apply-fact-op.test.ts`. Expected: this test FAILS — `r.outcome === "inserted"` and length `2`. (If it passes, STOP: the repro does not exercise the divergent canonical — re-check that the distiller op's `canonical` is English, not the Ukrainian display-norm.)

- [ ] **1.3 Commit the RED test.**
```bash
git add packages/daemon/src/memory/apply-fact-op.test.ts
git commit -m "test(2c-05): RED repro — cross-path dedup miss (user-lang tool canonical vs English distiller canonical) yields a case-dup sibling"
```

### Step 2 — Fix: add the user-language display-text axis to the dedup key

**Files:**
- Modify: `packages/daemon/src/memory/store.ts:547-559` (`factExistsByDedupKey`)
- Modify: `packages/daemon/src/memory/apply-fact-op.ts:126` (the new-insert dedup gate)

**Interfaces:** `factExistsByDedupKey(text: string): boolean` — signature UNCHANGED; only its stored-side match widens. `applyFactOp(...)` — signature and outcomes UNCHANGED.

- [ ] **2.1 Widen the stored side of `factExistsByDedupKey`** (store.ts). Replace the body's query + `.some()` (lines ~551-558) with a two-axis match. Full replacement of the method body from line 548:

```ts
  factExistsByDedupKey(text: string): boolean {
    const norm = normalizeFactText(text);
    if (norm === "") return false;
    const conn = dedupConnectorKey(text);
    // TWO match axes per stored fact (chunk-05, spec §3.5 d6):
    //   - canonical (f.canonical): the distiller's LOWERCASED-ENGLISH match key
    //     (smart-distiller-provider.ts) — load-bearing for cross-LANGUAGE
    //     distiller-vs-distiller dedup ("чай"/"tea" both → "user likes tea").
    //   - display  (d.fact): the USER-LANGUAGE fact text — the ONE representation
    //     BOTH write paths produce identically via normalizeFactText. The tool path
    //     (MemoryActionPort.remember) has no LLM and stores a user-language canonical;
    //     without the display axis, a tool fact and a distiller fact for the SAME
    //     statement (English canonical) never match → dup spam (demo defect D1).
    // A fact is a dup if EITHER axis matches. Bounded corpus (dogfood scale).
    const rows = this.db
      .query(
        `SELECT f.canonical AS canonical, d.fact AS display
           FROM distilled_facts d
           LEFT JOIN fact_fts f ON f.fact_id = d.id`,
      )
      .all() as { canonical: string | null; display: string }[];
    return rows.some((r) => {
      for (const key of [r.canonical, r.display]) {
        if (key === null || key === "") continue;
        if (normalizeFactText(key) === norm || dedupConnectorKey(key) === conn) return true;
      }
      return false;
    });
  }
```
(Note: this preserves the old `COALESCE` fallback behaviour — a fact with no `fact_fts` row has `canonical: null` (skipped) and is still matched by `display = d.fact`.)

- [ ] **2.2 Widen the query side in `applyFactOp`** (apply-fact-op.ts). Replace the dedup gate at line 126:

```ts
  // Dedup across BOTH write paths (chunk-05, spec §3.5 d6 / §3.7 suppress-as-dup):
  // check the English canonical (distiller-vs-distiller cross-language) AND the
  // user-language display-text norm (tool-vs-distiller — the tool path stores a
  // user-language canonical, so a distiller re-derivation carrying the LLM's ENGLISH
  // canonical would otherwise miss the tool's fact → dup spam / D1). normalizeFactText
  // is the ONE shared key helper — no second normalization.
  const displayNorm = normalizeFactText(input.fact);
  if (store.factExistsByDedupKey(canonical) || store.factExistsByDedupKey(displayNorm)) {
    return { outcome: demoted ? "demoted-deduped" : "deduped" };
  }
```

- [ ] **2.3 Run the RED test — confirm it now PASSES.** Run: `bun test packages/daemon/src/memory/apply-fact-op.test.ts`. Expected: all green, including the Step-1 test (`deduped`, length `1`).

- [ ] **2.4 Commit the fix.**
```bash
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/apply-fact-op.ts
git commit -m "fix(2c-05): dedup on user-language display-text axis so tool + distiller canonicals collapse (closes D1 case-dup)"
```

> ☆ Альтернатива: fold both query keys into one new store method `factExistsByAnyKey(display, canonical)` doing a single table scan — плюси: one scan not two; мінуси: new store surface + more callers to migrate. Rejected as scope creep; the two-call form reuses the existing method and the corpus is bounded (store.ts:544).

### Step 3 — Regression tests (both DoD items) + full-gate verification

**Files:**
- Modify (add tests): `packages/daemon/src/memory/memory-action-port.daemon.test.ts` (harness: `freshHarness()`, `freshCtx()` already exist; add `import { applyFactOp } from "./apply-fact-op.js";`)

- [ ] **3.1 Regression (a) — end-to-end via the real port + the distiller's per-op apply** (chunk §Task 3a; DoD "ONE fact across both write paths"):

```ts
import { applyFactOp } from "./apply-fact-op.js";

// ─── chunk-05 (a): tool-remember then distiller re-derivation ⇒ ONE fact ─────
test("chunk-05 (a): port.remember then distiller re-derivation (English canonical, case-variant display) ⇒ ONE fact", () => {
  const { store, port } = freshHarness();
  const t = store.createThread();

  // Real tool path.
  const r1 = port.remember(freshCtx(t), { fact: "Мій улюблений напій - чай" });
  expect(r1.ok).toBe(true);
  expect(store.readDistilledFacts(50).length).toBe(1);

  // The exact per-op apply distiller-registration.ts:211 performs, with the smart
  // distiller's ENGLISH canonical (smart-distiller-provider.ts:117).
  const r2 = applyFactOp(store, {
    op: "new",
    fact: "мій улюблений напій - чай",
    canonical: "user's favorite drink is tea",
    topics: [],
    provenance: `thread:${t}`,
  }, "distiller-v2");

  expect(r2.outcome).toBe("deduped");
  expect(store.readDistilledFacts(50).length).toBe(1);
  store.close();
});
```

- [ ] **3.2 Regression (b) — tool-twice case-variant ⇒ `duplicate` no-op** (chunk §Task 3b; guards the tool axis — this stays green before AND after the fix, model on the existing test at line 200):

```ts
// ─── chunk-05 (b): case-variant exact-dup via tool twice ⇒ duplicate no-op ───
test("chunk-05 (b): remember twice differing only in first-letter case ⇒ second is duplicate no-op", () => {
  const { store, port } = freshHarness();
  const t = store.createThread();

  const r1 = port.remember(freshCtx(t), { fact: "Мій улюблений напій - чай" });
  expect(r1.ok).toBe(true);
  expect(store.readDistilledFacts(50).length).toBe(1);

  const r2 = port.remember(freshCtx(t), { fact: "мій улюблений напій - чай" }); // lowercase м
  expect(r2).toMatchObject({ ok: false, code: "duplicate" });
  expect(store.readDistilledFacts(50).length).toBe(1);
  store.close();
});
```

- [ ] **3.3 Run the memory suites — confirm green.** Run:
  `bun test packages/daemon/src/memory/apply-fact-op.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/distiller-integration.daemon.test.ts packages/daemon/src/memory/smart-distiller-provider.test.ts packages/daemon/src/memory/write-gate.test.ts`
  Expected: all green. In particular `store.test.ts` (factExistsByDedupKey base/connector/negation), the distiller rephrase/dedup suites, and the write-gate 5e suite must be untouched-green (no weakening of the d5/5e chain).

- [ ] **3.4 Full gates (DoD).** Run each and confirm:
  - `bun test` (whole repo) — all green (703 baseline + the 3 new tests). If any previously-green distiller test now flips to `deduped` where it expected two facts, STOP and report — that would signal the display axis is over-collapsing (unexpected; investigate before proceeding).
  - `bun run typecheck` — 0 errors.
  - `bun run lint:strict` — 0.
  - Frozen byte-diff empty: `git diff --stat main -- packages/protocol packages/daemon/src/providers/mock-agent.ts` (and any mock-reducer path) shows **no** changes. Confirm the only source files changed are `store.ts` + `apply-fact-op.ts`.

- [ ] **3.5 Commit the regression tests.**
```bash
git add packages/daemon/src/memory/memory-action-port.daemon.test.ts
git commit -m "test(2c-05): regression — cross-path one-fact (a) + tool-twice case-variant duplicate no-op (b); full gates green"
```

### Closeout (rides this chunk's merge, per chunk DoD + §4.4)
On merge: flip spec `2026-07-10-memory-action-tools.md` `accepted → implemented`; drain the `chunks-todo/memory-action-tools/` folder (archive 05 per §4.4); tick roadmap 2c. **Record the root-cause correction in the PR/closeout notes:** D1 was *not* a case-sensitivity bug (the dedup key was already case-insensitive) — it was canonical-language divergence (user-language tool canonical vs English distiller canonical); the fix adds the display-text dedup axis. This partially closes the "cross-language canonical slip" the distiller-registration.ts:193-198 comment tracks for the 2d pass — the doc-curator may soften that note, but the hybrid-retrieval residual for *reworded* (non-exact) cross-language re-derivations remains 2d's (backlog §D), OUT of this chunk.

## ADR worthy: no

This is a bugfix implementing an **already-accepted** guardrail — spec §3.5 d6 ("dedup via the existing canonical machinery — no dup spam") and §3.7 (suppress-as-dup routing), and ADR-0016 decision 4(d) (tool-written facts pass "the same … dedup … machinery"). It introduces no new boundary, dependency, protocol, or wire change; the exact dedup key is architect-time per spec §7 ("dedup via existing canonical machinery" — the key composition is not spec-frozen). The one notable outcome — the decomposer's "case" hypothesis was wrong and the real cause is canonical-language divergence — is a closeout/PR finding, not a decision reversal.
