# forgotten_facts canonical axis (R2) — Implementation Plan

**Status:** review-complete — ready-to-merge (crawl §11.4: conductor re-verifies clean checkout + merges; do NOT self-merge)
**Chunk:** `orchestration/chunks-todo/hybrid-retrieval/02-forgotten-facts-canonical-axis.md`
**Spec:** `orchestration/docs/specs/2026-07-13-hybrid-retrieval.md` §3.7 R2
**Branch:** `chunk/hybrid-02-forgotten-facts-canonical-axis`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a spec-FROZEN mechanical chunk (hybrid-retrieval 02 / spec §3.7 R2) — do NOT make design decisions; every seam below is already resolved.

**Goal:** Give `forgotten_facts` a nullable `canonical` column and widen the D6b re-derivation-suppression consult (and its D6c/D6e clears) to match on **canonical OR display**, closing the cross-language slip (UK display / EN canonical) that display-only matching leaves open.

**Architecture:** Additive nullable column, wired for BOTH store generations (fresh via `SCHEMA_DDL`; existing via an always-run PRAGMA-guarded ensure-column in the `MemoryStore` constructor). `MemoryActionPort.forget` captures the fact's `fact_fts.canonical` at forget time and stores it. The three match-key helpers gain a second, optional canonical axis that mirrors the 2c chunk-05 two-axis pattern (`factExistsByDedupKey`), preserving the display axis byte-for-byte so the human ▷ un-forget ▷ record ▷ re-derivation precedence chain is unchanged.

**Tech Stack:** TypeScript on Bun, `bun:sqlite`, `bun test`. No new dependencies.

## Global Constraints

Copied verbatim from the chunk file and spec §3.7 R2 / §4 item 4 / §5 — every task implicitly includes these:

- **No new ADR.** ADR-0015 B1 precedence chain is carried; ADR-0012 5e human precedence is untouched — the **match key widens only**.
- **Precedence chain byte-carried:** human fact ▷ human un-forget ▷ forget record ▷ machine re-derivation. The display-axis clause in every helper stays byte-identical to today; the canonical axis is purely additive.
- **No embedding / semantic auto-suppression** (§7.2 Out — over-suppression risk). Deterministic axes only. The BOTH-fully-reworded-AND-different-canonical slip stays a NAMED residual (spec §3.5c).
- **`factExistsByDedupKey` is UNTOUCHED** (store.ts:556-584 — already two-axis since 2c chunk-05).
- **No backfill** of legacy NULL-canonical rows — they read back NULL and match display-only (honest, no fabrication).
- **Frozen surfaces byte-unchanged:** `@agentic/protocol` + the mock reducer. This chunk touches only `packages/daemon/src/memory/*` — byte-diff is trivially empty; verify at the end.
- **Verification:** real SQLite + real daemon path; no mocked store internals. This chunk is fully deterministic (no LLM), so all Done criteria are CI-testable. **TDD RED-first is a hard Done criterion.**
- **Git:** branch `chunk/hybrid-02-forgotten-facts-canonical-axis` (ALREADY created off `main` by the orchestrator — do NOT re-create it); one focused commit per task with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; PR at the end.

---

## Reality check

Verified against the current tree (post-PR #97 / chunk-01 merge). **This section is authoritative where it contradicts the brief.**

**Confirmed as briefed:**
- `schema.ts` — `forgotten_facts` CREATE TABLE at **92-101**, index at 102. No `canonical` column today.
- `store.ts` constructor at **176-183**; `this.db.exec(SCHEMA_DDL)` at **182** (the ensure-column call site).
- `store.ts` `recordForgottenFact` at **338-354** — computes `normalizeFactText(e.raw_text)`, inserts `(id, normalized_text, raw_text, provenance, actor, reason, authored_by, created_at)`. No canonical.
- `memory-action-port.ts` `forget` — `recordForgottenFact` call at **108-114**.
- `distiller-registration.ts` — D6b consult at **199-203**, limitation note at **193-198**.
- Chunk-01 (PR #97) landed: `readForgottenFacts` (367-376) now has `ORDER BY created_at DESC, rowid DESC` (line 374).

**Line-number drift the brief did NOT account for** (chunk-01 added a doc comment on `readForgottenFacts`, shifting everything below it):
- `isForgottenNormalizedText` is at **383-391**, not the brief's `379-387`.
- `clearForgottenByNormalizedText` **398-409**; `hasHumanFactWithNormalizedText` **450-457**.
- `ensureDistilledThroughTurnColumn` is at **1112-1118**, not the brief's `1098-1104`. Its mechanics are exactly as the spec describes (PRAGMA `table_info` guard → `ALTER TABLE … ADD COLUMN`), and its wiring is migration-script-only (called from the v2-05 migrate script, not the constructor) — confirming grill #5's correction that the new ensure-column must use these *mechanics* with a NEW always-run call site.

**Two load-bearing facts the brief did NOT surface (found by reading the code path):**
1. **`readFactById` (1068-1072) does NOT return canonical.** It selects `id, fact, provenance, scope, expiry, confidence, authored_by` only. `canonical` lives in `fact_fts` (a separate table). So `forget` cannot write canonical from `row` — it needs a new read against `fact_fts`.
2. **Ordering constraint in `forget`:** `gate.forgetFactById(factId)` (line 97) deletes the fact, and the `trg_distilled_facts_ad` AFTER DELETE trigger (schema.ts:125-130) deletes the `fact_fts` row. `recordForgottenFact` runs *after* that (line 108). Therefore the canonical **must be captured BEFORE** `gate.forgetFactById`, or `fact_fts.canonical` is already gone. (This is a code-path/ordering fact from reading, not a behavioral runtime claim.)

**Two-axis precedent confirmed:** `factExistsByDedupKey` (556-584) matches one incoming `text` against BOTH stored axes per row (`f.canonical` via `LEFT JOIN fact_fts` and `d.fact`), using `normalizeFactText(key) === norm || dedupConnectorKey(key) === conn`. This chunk mirrors that pattern for the forgotten-facts surface.

**Test-harness facts confirmed:** `store.test.ts` already imports `Database` (bun:sqlite), `mkdtempSync`, `tmpdir`, `join`, `normalizeFactText` — no new imports needed for the PRAGMA test. `distiller-registration.test.ts` has a `freshStore()` helper + the `d6b` fake-`MemoryProvider` pattern (1520-1810) to mirror. `memory-action-port.daemon.test.ts` has `freshHarness()`/`freshCtx()` (15-26). `recordForgottenFact` is called with a 1-arg object literal in ~10 existing tests — adding an OPTIONAL `canonical?` keeps them all green.

**Behavioral-DoD caveat (PIPELINE §6.1):** this chunk's Done criteria are ALL deterministic and CI-testable (no LLM). The end-to-end "forget a fact → a reworded same-canonical re-derivation stays suppressed, live" is spec §5 demo item 3 — that is **chunk-06's live demo, requires runtime demo to confirm**, and is explicitly NOT claimed done by this chunk. This chunk proves only the deterministic consult logic.

---

## Approaches

Three architect-time seams the spec left open; each resolved here so the worker decides nothing.

**A. How the helpers receive the incoming canonical.**
- *Option A1 (chosen): add an optional 2nd param `canonical?: string`* to `isForgottenNormalizedText` / `clearForgottenByNormalizedText` / `hasHumanFactWithNormalizedText`. Pros: backward-compatible (every existing 1-arg call still compiles and behaves display-only, byte-carrying the precedence chain); the canonical axis activates only when a caller has a canonical to pass; smallest diff. Cons: a two-arg boolean-ish signature is slightly less self-documenting.
- *Option A2: change to an object arg `{ display, canonical? }`.* Pros: self-documenting. Cons: churns ~15 existing call sites + tests for no behavioral gain; larger diff; higher regression surface on a precedence-critical path.
- **Recommendation: A1** — minimal surface, byte-carries the display axis by construction.

**B. How `forget` obtains the canonical.**
- *Option B1 (chosen): new focused store method `readCanonicalForFact(id): string | null`* (one `SELECT canonical FROM fact_fts WHERE fact_id = ?`). Pros: tiny, additive, matches "store stores+matches"; no shared-type churn. Cons: one more method.
- *Option B2: extend `readFactById` to `LEFT JOIN fact_fts` and add `canonical` to `DistilledFactRow`.* Pros: one call. Cons: `DistilledFactRow` is consumed across many readers — widening it is a broad, unnecessary type-surface change for one caller's need.
- **Recommendation: B1.**

**C. Axis-pairing shape of the two-axis match.**
- *Option C1 (chosen): paired axes.* Match a row iff **display-vs-display** matches (today's clause, byte-identical) **OR** **canonical-vs-canonical** matches. Legacy NULL-canonical rows skip the canonical clause (display-only). Pros: mirrors `factExistsByDedupKey`'s "match against the stored canonical axis" intent; closes the demo-3 case (both sides carry canonical `"favorite color blue"`); predictable, no cross-axis surprises. Cons: a display-vs-canonical cross-hit is not caught — but that is not a real class (canonical is an English key, display is user-language).
- *Option C2: full cross-product* (any incoming rep vs any stored rep). Cons: broader, less predictable matching not required by the frozen decision; risks over-suppression the spec explicitly guards against.
- **Recommendation: C1.** The canonical passed by callers falls back to the display norm exactly as `applyFactOp` does (`op.canonical || normalizeFactText(op.fact)`), so the consult and the apply use the identical key.

**D. `ensureForgottenFactsCanonicalColumn` visibility:** PRIVATE, called only from the constructor (tightest surface; tested through the real wired path — a legacy DB reconstructed then re-opened — which is more Strike-4-honest than a convenience seam). The v2-05 precedent is public only because a migration *script* calls it; there is no script here.

## Chosen Approach

A1 + B1 + C1 + private ensure-column, as above. Split into 3 sequential, independently-reviewable tasks: **(1)** the column + write path; **(2)** the two-axis helpers + D6c/D6e clears + the reusable rephrase fixture + matrix unit tests; **(3)** the distiller D6b consult + note rewrite + the three-op-shape RED-first integration tests.

## ADR worthy: no

Match key widens only; no new protocol, dependency, or boundary. ADR-0015 B1 precedence chain and ADR-0012 5e human precedence are carried unchanged — the spec (accepted 2026-07-14) already frames R2 as a rider, not a new decision.

---

### Task 1: `forgotten_facts.canonical` column + the write path

**Files:**
- Modify: `packages/daemon/src/memory/schema.ts` (forgotten_facts CREATE TABLE, 92-101)
- Modify: `packages/daemon/src/memory/store.ts` (constructor 182; `ForgottenFactInput` 73-79; `recordForgottenFact` 338-354; new `readCanonicalForFact`; new private `ensureForgottenFactsCanonicalColumn`)
- Modify: `packages/daemon/src/memory/memory-action-port.ts` (`forget` 72-114)
- Test: `packages/daemon/src/memory/store.test.ts`, `packages/daemon/src/memory/memory-action-port.daemon.test.ts`

**Interfaces:**
- Produces: `ForgottenFactInput.canonical?: string | null`; `MemoryStore.readCanonicalForFact(id: string): string | null`; `forgotten_facts.canonical TEXT` (nullable).

- [ ] **Step 1: Write the failing tests.**

In `store.test.ts` (append near the existing forgotten-fact tests, ~line 466):

```ts
test("R2: fresh store has forgotten_facts.canonical; recordForgottenFact round-trips it", () => {
  const { store } = freshStore();
  const cols = store.rawDb().query("PRAGMA table_info(forgotten_facts)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "canonical")).toBe(true);
  store.recordForgottenFact({
    raw_text: "мій улюблений колір синій", canonical: "favorite color blue",
    provenance: "thread:x", actor: "agent", authored_by: "machine",
  });
  const row = store.rawDb().query("SELECT canonical FROM forgotten_facts").get() as { canonical: string | null };
  expect(row.canonical).toBe("favorite color blue");
  store.close();
});

test("R2: an existing pre-R2 store gains canonical on construction (PRAGMA-guarded, idempotent, no backfill)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hr02-legacy-"));
  const legacy = new Database(join(dir, "memory.sqlite"));
  legacy.exec(`CREATE TABLE forgotten_facts (
    id TEXT PRIMARY KEY, normalized_text TEXT NOT NULL, raw_text TEXT NOT NULL,
    provenance TEXT, actor TEXT, reason TEXT, authored_by TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  legacy.query("INSERT INTO forgotten_facts (id, normalized_text, raw_text, provenance, actor, reason, authored_by, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), normalizeFactText("legacy fact"), "legacy fact", "thread:x", "agent", null, "machine", Date.now());
  legacy.close();

  const store = new MemoryStore({ dataDir: dir });
  const cols = store.rawDb().query("PRAGMA table_info(forgotten_facts)").all() as { name: string }[];
  expect(cols.filter((c) => c.name === "canonical").length).toBe(1);
  const row = store.rawDb().query("SELECT canonical FROM forgotten_facts WHERE raw_text = 'legacy fact'").get() as { canonical: string | null };
  expect(row.canonical).toBeNull(); // no fabricated backfill
  store.close();

  const store2 = new MemoryStore({ dataDir: dir }); // idempotent: second construct must not throw / must not double-add
  const cols2 = store2.rawDb().query("PRAGMA table_info(forgotten_facts)").all() as { name: string }[];
  expect(cols2.filter((c) => c.name === "canonical").length).toBe(1);
  store2.close();
});
```

In `memory-action-port.daemon.test.ts` (append near the forget round-trip, ~line 80):

```ts
test("R2: forget writes the fact's fact_fts.canonical into forgotten_facts.canonical (captured before the delete)", () => {
  const { store, port } = freshHarness();
  const t = store.createThread();
  const id = store.insertFact({
    fact: "мій улюблений колір синій", canonical: "favorite color blue", topics: ["#about-user"],
    provenance: `thread:${t}`, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine",
  }, "seed");
  const ctx = freshCtx(t, new Map([[1, id]]));
  const result = port.forget(ctx, { ordinal: 1, expected_text: "мій улюблений колір синій" });
  expect(result.ok).toBe(true);
  const row = store.rawDb().query("SELECT canonical FROM forgotten_facts").get() as { canonical: string | null };
  expect(row.canonical).toBe("favorite color blue");
  store.close();
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `cd /Users/lior/WebstormProjects/playground/AgenticEngine && bun test packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts`
Expected: FAIL — `SELECT canonical …` throws "no such column: canonical" (fresh + port tests) and the legacy PRAGMA test sees 0 canonical columns.

- [ ] **Step 3: Implement.**

`schema.ts` — add the column to the forgotten_facts CREATE TABLE (between `raw_text` and `provenance`):

```sql
CREATE TABLE IF NOT EXISTS forgotten_facts (
  id               TEXT PRIMARY KEY,
  normalized_text  TEXT NOT NULL,   -- normalizeFactText(raw) — the DISPLAY match key (Layer-T)
  raw_text         TEXT NOT NULL,   -- what the user saw + forgot (Layer-X exclusion + display)
  canonical        TEXT,            -- hybrid-retrieval R2: the fact's fact_fts.canonical at forget time
                                    --   (nullable; legacy rows = NULL → display-only match, no backfill)
  provenance       TEXT,            -- as-forgotten (opportunistic Layer-P + audit)
  actor            TEXT,
  reason           TEXT,
  authored_by      TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
```

`store.ts` — constructor (after line 182):

```ts
    this.db.exec(SCHEMA_DDL);
    this.ensureForgottenFactsCanonicalColumn(); // hybrid-retrieval R2 [grill #5]: always-run guarded add for existing stores
```

`store.ts` — `ForgottenFactInput` (73-79), add:

```ts
  /** hybrid-retrieval R2: the fact's fact_fts.canonical (English match-key) at forget time.
   *  Omitted/undefined → stored NULL (legacy / no canonical known → display-only match). */
  canonical?: string | null;
```

`store.ts` — `recordForgottenFact` (widen the INSERT):

```ts
  recordForgottenFact(e: ForgottenFactInput): void {
    const normalized = normalizeFactText(e.raw_text);
    this.db
      .query(
        "INSERT INTO forgotten_facts (id, normalized_text, raw_text, canonical, provenance, actor, reason, authored_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        crypto.randomUUID(),
        normalized,
        e.raw_text,
        e.canonical ?? null,
        e.provenance ?? null,
        e.actor,
        e.reason ?? null,
        e.authored_by,
        Date.now(),
      );
  }
```

`store.ts` — new methods (place `readCanonicalForFact` next to `readFactById` ~1072; the private ensure-column next to `ensureDistilledThroughTurnColumn` ~1118):

```ts
  /** hybrid-retrieval R2: read the fact_fts.canonical match key for a fact id (null if no
   *  fact_fts row — a legacy fact predating v2-02). MUST be read BEFORE any delete: the
   *  trg_distilled_facts_ad AFTER DELETE trigger removes the fact_fts row. */
  readCanonicalForFact(id: string): string | null {
    const row = this.db
      .query("SELECT canonical FROM fact_fts WHERE fact_id = ?")
      .get(id) as { canonical: string } | null;
    return row?.canonical ?? null;
  }
```

```ts
  /**
   * hybrid-retrieval R2 wiring [grill #5]: add the nullable `canonical` column to a pre-R2
   * live `forgotten_facts`. Mirrors ensureDistilledThroughTurnColumn's PRAGMA mechanics BUT is
   * wired to run ALWAYS from the constructor (that precedent is migration-script-only) — one
   * nullable column needs no separate script. Idempotent: a fresh store already has the column
   * via SCHEMA_DDL (PRAGMA finds it → no-op); an existing store lacks it → one cheap ALTER.
   * NOT NULL/DEFAULT deliberately omitted so legacy rows read back NULL (honest "no canonical
   * known" marker — no backfill fabrication).
   */
  private ensureForgottenFactsCanonicalColumn(): void {
    const cols = this.db.query("PRAGMA table_info(forgotten_facts)").all() as { name: string }[];
    if (cols.some((c) => c.name === "canonical")) return;
    this.db.exec("ALTER TABLE forgotten_facts ADD COLUMN canonical TEXT;");
  }
```

`memory-action-port.ts` — `forget`: capture canonical BEFORE the gate delete (insert right after the `row === null` guard, ~line 79), then pass it into `recordForgottenFact`:

```ts
    // hybrid-retrieval R2: capture the fact's canonical BEFORE the forget delete — the
    // trg_distilled_facts_ad AFTER DELETE trigger removes the fact_fts row, so it is
    // unreadable after gate.forgetFactById below.
    const canonical = this.store.readCanonicalForFact(factId);
```

```ts
    this.store.recordForgottenFact({
      raw_text: row.fact,
      canonical,
      provenance: row.provenance,
      actor: "agent",
      authored_by: "machine",
      reason: input.reason,
    });
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `bun test packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts`
Expected: PASS (including all pre-existing forgotten-fact + forget tests — the optional `canonical?` keeps 1-arg `recordForgottenFact` callers green).

- [ ] **Step 5: Typecheck + lint the touched package.**

Run: `bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict`
Expected: 0 errors.

- [ ] **Step 6: Commit.** (branch already exists — do NOT `git checkout -b`)

```bash
git add packages/daemon/src/memory/schema.ts packages/daemon/src/memory/store.ts packages/daemon/src/memory/memory-action-port.ts packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts
git commit -m "feat(memory): forgotten_facts.canonical column + forget writes it (hybrid-retrieval R2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Two-axis match in the three helpers + D6c/D6e clears + the reusable rephrase fixture

**Files:**
- Create: `packages/daemon/src/memory/rephrase-matrix.fixture.ts`
- Modify: `packages/daemon/src/memory/store.ts` (`isForgottenNormalizedText` 383-391; `clearForgottenByNormalizedText` 398-409; `hasHumanFactWithNormalizedText` 450-457)
- Modify: `packages/daemon/src/memory/memory-action-port.ts` (`remember` D6e — lines 157, 167)
- Modify: `packages/daemon/src/memory/write-gate.ts` (`editFact` D6c — line 214)
- Test: `packages/daemon/src/memory/store.test.ts`, `packages/daemon/src/memory/memory-action-port.daemon.test.ts`, `packages/daemon/src/memory/write-gate.test.ts`

**Interfaces:**
- Consumes: `readCanonicalForFact`, `forgotten_facts.canonical` (Task 1).
- Produces: `isForgottenNormalizedText(text, canonical?)`, `clearForgottenByNormalizedText(text, canonical?)`, `hasHumanFactWithNormalizedText(text, canonical?)` — display-only when `canonical` omitted. Fixture exports `ANCHOR`, `SAME_CANONICAL`, `DIFFERENT_CANONICAL_RESIDUAL`, `NEGATIVE_CONTROLS`, type `RephraseCase`.

- [ ] **Step 1: Create the reusable fixture.**

Create `packages/daemon/src/memory/rephrase-matrix.fixture.ts`:

```ts
/**
 * Reusable rephrase / cross-language fixture — hybrid-retrieval chunk-02 (R2), REUSED by
 * chunk-04's golden set (spec §3.8a-2). Reconstructed from the 2c chunk-01 (PR #86)
 * hard-reviewer verification record: the classes by which a same-fact re-derivation varies.
 *
 * ANCHOR — one fact identity, two representations:
 *   canonical (English match-key, what fact_fts stores): "favorite color blue"
 *   display   (user-language, what distilled_facts.fact stores): "мій улюблений колір синій"
 *
 * SAME_CANONICAL — variants that MUST be treated as the SAME fact. `axis` names the match
 *   axis that is LOAD-BEARING for the variant:
 *     - "display"   : EN case / trailing-punct / connector-word / whitespace variants — caught
 *                     by the relaxed display key (2c chunk-01); a regression guard.
 *     - "canonical" : UK / cross-language rewordings sharing NO display tokens with the anchor
 *                     display — caught ONLY by the R2 canonical axis (the chunk-02 thesis).
 * DIFFERENT_CANONICAL_RESIDUAL — the NAMED residual (spec §3.5c): fully reworded AND a
 *   genuinely different canonical. MUST NOT be suppressed by any deterministic axis.
 * NEGATIVE_CONTROLS — unrelated facts that MUST NOT match on any axis.
 */
export interface RephraseCase {
  klass: string;
  text: string;
  canonical: string;
  axis: "display" | "canonical";
}

export const ANCHOR = {
  canonical: "favorite color blue",
  display: "мій улюблений колір синій",
} as const;

export const SAME_CANONICAL: RephraseCase[] = [
  // ── display-axis classes (caught byte-for-byte by the relaxed display key) ──
  { klass: "exact",            text: "favorite color is blue",         canonical: "favorite color blue", axis: "display" },
  { klass: "connector-drop",   text: "favorite color blue",            canonical: "favorite color blue", axis: "display" },
  { klass: "uppercase",        text: "FAVORITE COLOR IS BLUE",         canonical: "favorite color blue", axis: "display" },
  { klass: "title-case",       text: "Favorite Color Is Blue",         canonical: "favorite color blue", axis: "display" },
  { klass: "trailing-punct",   text: "favorite color is blue.",        canonical: "favorite color blue", axis: "display" },
  { klass: "extra-whitespace", text: "favorite   color   blue",        canonical: "favorite color blue", axis: "display" },
  // ── canonical-axis classes: same fact, but a display-key gap means ONLY canonical catches them ──
  { klass: "internal-punct",   text: "favorite color: blue",           canonical: "favorite color blue", axis: "canonical" }, // internal colon never stripped → "color:" ≠ "color"
  { klass: "british-spelling", text: "favourite colour is blue",       canonical: "favorite color blue", axis: "canonical" }, // no US/UK spelling fold
  { klass: "ordinal-echo",     text: "3. favorite color is blue",      canonical: "favorite color blue", axis: "canonical" }, // only trailing punct stripped → leading "3." survives
  { klass: "possessive",       text: "user's favorite color is blue",  canonical: "favorite color blue", axis: "canonical" }, // "user's" not a connector word → extra leading token
  // ── cross-language / heavy-reword classes ──
  { klass: "uk-exact",         text: "мій улюблений колір синій",       canonical: "favorite color blue", axis: "canonical" },
  { klass: "uk-connector",     text: "улюблений колір — синій",         canonical: "favorite color blue", axis: "canonical" },
  { klass: "uk-reworded",      text: "найбільше люблю синій колір",      canonical: "favorite color blue", axis: "canonical" },
  { klass: "uk-word-order",    text: "синій — мій улюблений колір",     canonical: "favorite color blue", axis: "canonical" },
  { klass: "en-paraphrase",    text: "I love the color blue the most",  canonical: "favorite color blue", axis: "canonical" },
  { klass: "mixed-script",     text: "favorite колір is blue",          canonical: "favorite color blue", axis: "canonical" },
];

export const DIFFERENT_CANONICAL_RESIDUAL: RephraseCase = {
  klass: "residual-different-canonical",
  text: "надає перевагу холодним відтінкам", // "prefers cool shades" — related idea, different canonical
  canonical: "prefers cool shades",
  axis: "canonical",
};

export const NEGATIVE_CONTROLS: RephraseCase[] = [
  { klass: "neg-food-en", text: "favorite food is pizza", canonical: "favorite food pizza", axis: "display" },
  { klass: "neg-food-uk", text: "улюблена їжа — піца",    canonical: "favorite food pizza", axis: "canonical" },
];
```

- [ ] **Step 2: Write the failing tests.**

In `store.test.ts` (append after the FIX1 helper tests, ~line 566), add the matrix + axis unit tests. Add the fixture import at the top: `import { ANCHOR, SAME_CANONICAL, DIFFERENT_CANONICAL_RESIDUAL, NEGATIVE_CONTROLS } from "./rephrase-matrix.fixture.js";`

```ts
test("R2: canonical axis — every SAME_CANONICAL rephrase is forgotten-matched against a UK-display/EN-canonical row", () => {
  const { store } = freshStore();
  store.recordForgottenFact({ raw_text: ANCHOR.display, canonical: ANCHOR.canonical, provenance: "thread:x", actor: "agent", authored_by: "machine" });
  for (const c of SAME_CANONICAL) {
    expect(store.isForgottenNormalizedText(normalizeFactText(c.text), c.canonical)).toBe(true); // caught via canonical (or display)
  }
  expect(store.isForgottenNormalizedText(normalizeFactText(DIFFERENT_CANONICAL_RESIDUAL.text), DIFFERENT_CANONICAL_RESIDUAL.canonical)).toBe(false); // named residual
  for (const n of NEGATIVE_CONTROLS) {
    expect(store.isForgottenNormalizedText(normalizeFactText(n.text), n.canonical)).toBe(false);
  }
  store.close();
});

test("R2: display axis byte-carried — EN display variants match with canonical OMITTED (display-only unchanged)", () => {
  const { store } = freshStore();
  // Recorded in EN display, EN canonical.
  store.recordForgottenFact({ raw_text: "favorite color is blue", canonical: "favorite color blue", provenance: "thread:x", actor: "agent", authored_by: "machine" });
  for (const c of SAME_CANONICAL.filter((x) => x.axis === "display")) {
    expect(store.isForgottenNormalizedText(normalizeFactText(c.text))).toBe(true); // one-arg → display-only, still works
  }
  store.close();
});

test("R2: legacy NULL-canonical row matches display-only (honest, no over-reach) even when a canonical is passed", () => {
  const { store } = freshStore();
  // A legacy row: canonical omitted → stored NULL. Display is EN.
  store.recordForgottenFact({ raw_text: "favorite color is blue", provenance: "thread:x", actor: "agent", authored_by: "machine" });
  // A cross-language re-derivation carries a matching canonical but a non-matching display →
  // must NOT be suppressed (the canonical clause is skipped for a NULL-canonical row).
  expect(store.isForgottenNormalizedText(normalizeFactText("мій улюблений колір синій"), "favorite color blue")).toBe(false);
  // Same-display EN still matches (display axis).
  expect(store.isForgottenNormalizedText(normalizeFactText("favorite color blue"), "favorite color blue")).toBe(true);
  store.close();
});

test("R2: hasHumanFactWithNormalizedText matches a human fact via the CANONICAL axis (displays differ)", () => {
  const { store } = freshStore();
  const hid = crypto.randomUUID();
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(hid, "мій улюблений колір синій", "human-pin", "cross-thread", null, 1, "human", Date.now(), "manual");
  store.rawDb().query("INSERT INTO fact_fts (fact_id, canonical, topic) VALUES (?, ?, ?)").run(hid, "favorite color blue", "");
  // EN display differs from the UK human display, but canonicals match.
  expect(store.hasHumanFactWithNormalizedText(normalizeFactText("favorite color is blue"), "favorite color blue")).toBe(true);
  store.close();
});

test("R2: clearForgottenByNormalizedText clears a cross-language row via the CANONICAL axis", () => {
  const { store } = freshStore();
  store.recordForgottenFact({ raw_text: ANCHOR.display, canonical: ANCHOR.canonical, provenance: "thread:x", actor: "agent", authored_by: "machine" });
  const removed = store.clearForgottenByNormalizedText(normalizeFactText("favorite color is blue"), "favorite color blue"); // EN display ≠ UK row display
  expect(removed).toBe(1);
  expect(store.isForgottenNormalizedText(normalizeFactText(ANCHOR.display), ANCHOR.canonical)).toBe(false);
  store.close();
});
```

In `memory-action-port.daemon.test.ts` (append, ~after existing remember/reassert tests):

```ts
test("R2 D6e: a cross-language remember re-asserting a forgotten fact fires 'reassert' + clears via the canonical axis", () => {
  const { store, port } = freshHarness();
  const t = store.createThread();
  // A prior forget recorded UK display + EN canonical.
  store.recordForgottenFact({ raw_text: "мій улюблений колір синій", canonical: "favorite color blue", provenance: `thread:${t}`, actor: "agent", authored_by: "machine" });
  const ctx = freshCtx(t);
  const result = port.remember(ctx, { fact: "favorite color blue" }); // EN — norm ≠ UK row display; tool canonical == norm
  expect(result.ok).toBe(true);
  expect((result as { action?: string }).action).toBe("reassert"); // was-forgotten detected via canonical axis
  expect(store.isForgottenNormalizedText(normalizeFactText("мій улюблений колір синій"), "favorite color blue")).toBe(false); // cleared
  store.close();
});
```

In `write-gate.test.ts` (append near the existing editFact / D6c tests, ~line 510):

```ts
test("R2 D6c: a human editFact re-assertion clears a forgotten row on the display axis (human canonical == display)", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "hr02-wg-")) });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const id = store.insertFact({
    fact: "placeholder", canonical: "placeholder", topics: [],
    provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine",
  }, "seed");
  store.recordForgottenFact({ raw_text: "favorite color is blue", canonical: "favorite color blue", provenance: "thread:t", actor: "agent", authored_by: "machine" });
  const applied = gate.editFact(id, "favorite color blue", { actor: "user", authored_by: "human" });
  expect(applied).toBe(true);
  expect(store.isForgottenNormalizedText(normalizeFactText("favorite color is blue"))).toBe(false); // cleared via relaxed display key
  store.close();
});
```

- [ ] **Step 3: Run tests to verify they fail.**

Run: `bun test packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts packages/daemon/src/memory/write-gate.test.ts`
Expected: FAIL — the canonical-axis assertions return `false`/wrong `action` because the helpers ignore the 2nd arg and callers don't pass it yet.

- [ ] **Step 4: Implement the two-axis helpers + widen the clears.**

`store.ts` — replace the three helpers (keeping the display clause byte-identical, adding the canonical clause):

```ts
  isForgottenNormalizedText(text: string, canonical?: string): boolean {
    const norm = normalizeFactText(text);
    if (norm === "") return false;
    const conn = dedupConnectorKey(text);
    const canonNorm = canonical ? normalizeFactText(canonical) : "";
    const canonConn = canonical ? dedupConnectorKey(canonical) : "";
    const rows = this.db
      .query("SELECT normalized_text, canonical FROM forgotten_facts")
      .all() as { normalized_text: string; canonical: string | null }[];
    return rows.some((r) => {
      // display axis (byte-carried from 2c chunk-01 FIX 1)
      if (r.normalized_text === norm || dedupConnectorKey(r.normalized_text) === conn) return true;
      // canonical axis (hybrid-retrieval R2): only when BOTH sides carry a canonical.
      // Legacy NULL-canonical rows fall through to display-only (honest — no backfill).
      if (r.canonical !== null && r.canonical !== "" && canonNorm !== "") {
        if (normalizeFactText(r.canonical) === canonNorm || dedupConnectorKey(r.canonical) === canonConn) return true;
      }
      return false;
    });
  }
```

```ts
  clearForgottenByNormalizedText(text: string, canonical?: string): number {
    const norm = normalizeFactText(text);
    const conn = dedupConnectorKey(text);
    const canonNorm = canonical ? normalizeFactText(canonical) : "";
    const canonConn = canonical ? dedupConnectorKey(canonical) : "";
    const rows = this.db
      .query("SELECT id, normalized_text, canonical FROM forgotten_facts")
      .all() as { id: string; normalized_text: string; canonical: string | null }[];
    const toDelete = rows.filter((r) => {
      if (r.normalized_text === norm || dedupConnectorKey(r.normalized_text) === conn) return true;
      if (r.canonical !== null && r.canonical !== "" && canonNorm !== "") {
        if (normalizeFactText(r.canonical) === canonNorm || dedupConnectorKey(r.canonical) === canonConn) return true;
      }
      return false;
    });
    if (toDelete.length === 0) return 0;
    const del = this.db.query("DELETE FROM forgotten_facts WHERE id = ?");
    for (const r of toDelete) del.run(r.id);
    return toDelete.length;
  }
```

```ts
  hasHumanFactWithNormalizedText(text: string, canonical?: string): boolean {
    const norm = normalizeFactText(text);
    const conn = dedupConnectorKey(text);
    const canonNorm = canonical ? normalizeFactText(canonical) : "";
    const canonConn = canonical ? dedupConnectorKey(canonical) : "";
    const rows = this.db
      .query(
        `SELECT d.fact AS fact, f.canonical AS canonical
           FROM distilled_facts d
           LEFT JOIN fact_fts f ON f.fact_id = d.id
          WHERE d.authored_by = 'human'`,
      )
      .all() as { fact: string; canonical: string | null }[];
    return rows.some((r) => {
      if (normalizeFactText(r.fact) === norm || dedupConnectorKey(r.fact) === conn) return true;
      if (r.canonical !== null && r.canonical !== "" && canonNorm !== "") {
        if (normalizeFactText(r.canonical) === canonNorm || dedupConnectorKey(r.canonical) === canonConn) return true;
      }
      return false;
    });
  }
```

Update the FIX-1 block comment above `recordForgottenFact` (store.ts ~324-330) to note the added canonical axis (append one sentence — do not remove the existing display-axis rationale).

`memory-action-port.ts` — `remember`, pass the tool canonical (== `norm`, the tool has no LLM) on both calls:

```ts
    const wasForgotten = this.store.isForgottenNormalizedText(norm, norm); // R2: tool canonical == norm
```
```ts
      this.store.clearForgottenByNormalizedText(norm, norm); // R2: clear on either axis
```

`write-gate.ts` — `editFact` D6c (line 214), pass the human canonical (== display norm; human facts store canonical = normalizeFactText(fact)):

```ts
    if (applied) this.store.clearForgottenByNormalizedText(normalizeFactText(newText), normalizeFactText(newText));
```

- [ ] **Step 5: Run tests to verify they pass.**

Run: `bun test packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts packages/daemon/src/memory/write-gate.test.ts`
Expected: PASS — including all pre-existing FIX1 / precedence / clear tests (display clause unchanged → byte-carried).

- [ ] **Step 6: Typecheck + lint.**

Run: `bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict`
Expected: 0 errors.

- [ ] **Step 7: Commit.**

```bash
git add packages/daemon/src/memory/rephrase-matrix.fixture.ts packages/daemon/src/memory/store.ts packages/daemon/src/memory/memory-action-port.ts packages/daemon/src/memory/write-gate.ts packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/memory-action-port.daemon.test.ts packages/daemon/src/memory/write-gate.test.ts
git commit -m "feat(memory): two-axis forgotten-fact match (canonical OR display) + D6c/D6e clears + rephrase fixture (hybrid-retrieval R2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Distiller D6b consult — two-axis + note rewrite + three-op-shape RED-first tests

**Files:**
- Modify: `packages/daemon/src/memory/distiller-registration.ts` (consult 199-203; limitation note 193-198)
- Test: `packages/daemon/src/memory/distiller-registration.test.ts`

**Interfaces:**
- Consumes: the two-axis helpers (Task 2), `forgotten_facts.canonical` (Task 1), the fixture (Task 2).

- [ ] **Step 1: Write the failing tests.**

In `distiller-registration.test.ts` (append a new `describe` after the 2c chunk-01 D6b block, ~line 1810). These mirror the existing `d6b` fake-provider harness exactly.

```ts
describe("hybrid-retrieval chunk-02 R2: two-axis D6b consult (canonical closes the cross-language slip)", () => {
  test("R2(i) op:'new' — a same-canonical CROSS-LANGUAGE re-derivation (EN display; forgotten UK) is suppressed", async () => {
    const { store } = freshStore();
    const hook = new ConsolidationHook(store);
    const scanner = new RuleBasedScanner();
    store.recordForgottenFact({ raw_text: "мій улюблений колір синій", canonical: "favorite color blue", provenance: "thread:x", actor: "agent", authored_by: "machine" });
    const t = store.createThread();
    store.appendMessages(t, [{ role: "user", content: "my favorite color is blue" }], "s1");
    const provider: MemoryProvider = {
      id: "r2-new",
      distill: async (s, threadId) => ({
        threadId,
        ops: [{ op: "new", fact: "favorite color is blue", canonical: "favorite color blue", topics: [] }],
        candidateIds: [],
        distilledThroughMarker: s.readThreadMarker(threadId),
        distilledThroughTurn: s.maxTurnIndex(threadId),
      }),
      retrieve: async () => ({ messages: [], injectedFactIds: [] }),
    };
    registerDistiller(hook, store, provider, scanner);
    await hook.dismiss([t]);
    expect(store.readDistilledFacts(50).some((f) => f.fact === "favorite color is blue")).toBe(false);
    store.close();
  });

  test("R2(ii) op:'append' — a cross-language item re-derivation is suppressed; target unchanged", async () => {
    const { store } = freshStore();
    const hook = new ConsolidationHook(store);
    const scanner = new RuleBasedScanner();
    const targetId = store.insertFact({
      fact: "enjoys hiking", canonical: "enjoys hiking", provenance: "thread:seed",
      scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: [],
    }, "seed");
    store.recordForgottenFact({ raw_text: "мій улюблений колір синій", canonical: "favorite color blue", provenance: "thread:x", actor: "agent", authored_by: "machine" });
    const t = store.createThread();
    store.appendMessages(t, [{ role: "user", content: "my favorite color is blue" }], "s1");
    const provider: MemoryProvider = {
      id: "r2-append",
      distill: async (s, threadId) => ({
        threadId,
        ops: [{ op: "append", fact: "favorite color is blue", canonical: "favorite color blue", topics: [], targetOrdinal: 1, expectedTargetText: "enjoys hiking" }],
        candidateIds: [targetId],
        distilledThroughMarker: s.readThreadMarker(threadId),
        distilledThroughTurn: s.maxTurnIndex(threadId),
      }),
      retrieve: async () => ({ messages: [], injectedFactIds: [] }),
    };
    registerDistiller(hook, store, provider, scanner);
    await hook.dismiss([t]);
    const row = store.rawDb().query("SELECT fact FROM distilled_facts WHERE id = ?").get(targetId) as { fact: string };
    expect(row.fact).toBe("enjoys hiking");
    store.close();
  });

  test("R2(iii) op:'replace' — a cross-language REPLACEMENT re-derivation is suppressed; target left as-is, no audit row", async () => {
    const { store } = freshStore();
    const hook = new ConsolidationHook(store);
    const scanner = new RuleBasedScanner();
    const targetId = store.insertFact({
      fact: "works at Acme Corp", canonical: "works at acme corp", provenance: "thread:seed",
      scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: [],
    }, "seed");
    store.recordForgottenFact({ raw_text: "мій улюблений колір синій", canonical: "favorite color blue", provenance: "thread:x", actor: "agent", authored_by: "machine" });
    const t = store.createThread();
    store.appendMessages(t, [{ role: "user", content: "my favorite color is blue" }], "s1");
    const provider: MemoryProvider = {
      id: "r2-replace",
      distill: async (s, threadId) => ({
        threadId,
        ops: [{ op: "replace", fact: "favorite color is blue", canonical: "favorite color blue", topics: [], targetOrdinal: 1, expectedTargetText: "works at Acme Corp" }],
        candidateIds: [targetId],
        distilledThroughMarker: s.readThreadMarker(threadId),
        distilledThroughTurn: s.maxTurnIndex(threadId),
      }),
      retrieve: async () => ({ messages: [], injectedFactIds: [] }),
    };
    registerDistiller(hook, store, provider, scanner);
    await hook.dismiss([t]);
    const row = store.rawDb().query("SELECT fact FROM distilled_facts WHERE id = ?").get(targetId) as { fact: string };
    expect(row.fact).toBe("works at Acme Corp");
    expect(store.readReplacedFacts(targetId).length).toBe(0);
    store.close();
  });

  test("R2(iv) precedence byte-carry: a HUMAN fact matching on the CANONICAL axis blocks suppression (op lands)", async () => {
    const { store } = freshStore();
    const hook = new ConsolidationHook(store);
    const scanner = new RuleBasedScanner();
    const targetId = store.insertFact({
      fact: "enjoys hiking", canonical: "enjoys hiking", provenance: "thread:seed",
      scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: [],
    }, "seed");
    // Human fact: UK display, EN canonical (via fact_fts). Its canonical matches the op's.
    const hid = crypto.randomUUID();
    store.rawDb().query(
      "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(hid, "мій улюблений колір синій", "human-pin", "cross-thread", null, 1, "human", Date.now(), "manual");
    store.rawDb().query("INSERT INTO fact_fts (fact_id, canonical, topic) VALUES (?, ?, ?)").run(hid, "favorite color blue", "");
    store.recordForgottenFact({ raw_text: "мій улюблений колір синій", canonical: "favorite color blue", provenance: "thread:x", actor: "agent", authored_by: "machine" });
    const t = store.createThread();
    store.appendMessages(t, [{ role: "user", content: "my favorite color is blue" }], "s1");
    const provider: MemoryProvider = {
      id: "r2-precedence",
      distill: async (s, threadId) => ({
        threadId,
        ops: [{ op: "append", fact: "favorite color is blue", canonical: "favorite color blue", topics: [], targetOrdinal: 1, expectedTargetText: "enjoys hiking" }],
        candidateIds: [targetId],
        distilledThroughMarker: s.readThreadMarker(threadId),
        distilledThroughTurn: s.maxTurnIndex(threadId),
      }),
      retrieve: async () => ({ messages: [], injectedFactIds: [] }),
    };
    registerDistiller(hook, store, provider, scanner);
    await hook.dismiss([t]);
    const row = store.rawDb().query("SELECT fact FROM distilled_facts WHERE id = ?").get(targetId) as { fact: string };
    expect(row.fact).toBe("enjoys hiking; favorite color is blue"); // human present ⇒ suppression does NOT fire ⇒ append lands
    store.close();
  });

  test("R2(v) named residual: a DIFFERENT-canonical fully-reworded re-derivation is NOT suppressed (op:'new' lands)", async () => {
    const { store } = freshStore();
    const hook = new ConsolidationHook(store);
    const scanner = new RuleBasedScanner();
    store.recordForgottenFact({ raw_text: "мій улюблений колір синій", canonical: "favorite color blue", provenance: "thread:x", actor: "agent", authored_by: "machine" });
    const t = store.createThread();
    store.appendMessages(t, [{ role: "user", content: "I prefer cool shades" }], "s1");
    const provider: MemoryProvider = {
      id: "r2-residual",
      distill: async (s, threadId) => ({
        threadId,
        ops: [{ op: "new", fact: "prefers cool shades", canonical: "prefers cool shades", topics: [] }],
        candidateIds: [],
        distilledThroughMarker: s.readThreadMarker(threadId),
        distilledThroughTurn: s.maxTurnIndex(threadId),
      }),
      retrieve: async () => ({ messages: [], injectedFactIds: [] }),
    };
    registerDistiller(hook, store, provider, scanner);
    await hook.dismiss([t]);
    expect(store.readDistilledFacts(50).some((f) => f.fact === "prefers cool shades")).toBe(true); // residual — deterministic gate does not block
    store.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `bun test packages/daemon/src/memory/distiller-registration.test.ts`
Expected: FAIL — (i)/(ii)/(iii) slip (fact inserts / target changes) because the consult still calls `isForgottenNormalizedText(norm)` display-only; (iv) FAILS in the opposite direction (suppression wrongly fires, append does NOT land) because `hasHumanFactWithNormalizedText(norm)` misses the human's canonical-axis match. (v) already passes (control).

- [ ] **Step 3: Implement the two-axis consult + rewrite the note.**

`distiller-registration.ts` — replace the consult (199-203) and its preceding note (193-198):

```ts
        // TWO-AXIS D6b consult (hybrid-retrieval R2 — the 2c chunk-05 lesson applied here):
        // suppress re-derivation of a tool-forgotten fact, MACHINE candidates only, honoring
        // precedence: human fact ▷ human un-forget ▷ forget record ▷ machine re-derivation.
        // `continue` drops new/append candidates and skips a replace non-destructively (target
        // left as-is — no applyFactOp call). The match now runs on EITHER the DISPLAY key
        // (relaxed connector key, as 2c chunk-01) OR the CANONICAL key (op.canonical vs the
        // forgotten row's stored fact_fts.canonical, captured by MemoryActionPort.forget) —
        // closing the cross-language slip (UK display / EN canonical) the v2 dedup ceiling left
        // open. Legacy NULL-canonical forgotten rows fall back to display-only (honest, no
        // backfill fabrication). NAMED RESIDUAL (accepted, spec §3.5c): a re-derivation that is
        // BOTH fully-reworded in display AND lands a genuinely-different canonical still slips
        // this deterministic gate; semantic auto-suppression is rejected (over-suppression
        // risk, spec §1 Out). The hybrid candidate-fetch (spec §3.5, consumer b) makes the LLM
        // SEE the near-duplicate so it proposes replace/no-op, and the D6c soft nudge
        // (smart-distiller-provider.ts) is the honestly-ranked soft layer — but no deterministic
        // gate hard-blocks that final slip.
        const norm = normalizeFactText(op.fact);
        const canonical = op.canonical || normalizeFactText(op.fact); // mirror applyFactOp's fallback → identical key
        if (store.isForgottenNormalizedText(norm, canonical) && !store.hasHumanFactWithNormalizedText(norm, canonical)) {
          memDebug("distill", { threadId, forgottenSuppressed: previewStr(op.fact), canonical: previewStr(canonical) });
          continue;
        }
```

- [ ] **Step 4: Run the new tests + the full distiller suite.**

Run: `bun test packages/daemon/src/memory/distiller-registration.test.ts`
Expected: PASS — the new R2 block green AND every pre-existing 2c chunk-01 D6b test (i)-(viii) still green (display clause byte-carried).

- [ ] **Step 5: Full memory suite + typecheck + lint + frozen byte-diff.**

Run:
```bash
bun test packages/daemon/src/memory
bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict
git diff --stat origin/main -- packages/protocol
```
Expected: all tests green; 0 typecheck/lint errors; the protocol diff empty (this chunk touches only `packages/daemon/src/memory`; if a mock-reducer path exists elsewhere, confirm it is untouched too).

- [ ] **Step 6: Commit + open PR.**

```bash
git add packages/daemon/src/memory/distiller-registration.ts packages/daemon/src/memory/distiller-registration.test.ts
git commit -m "feat(memory): D6b consult matches canonical OR display; rewrite stale limitation note (hybrid-retrieval R2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin chunk/hybrid-02-forgotten-facts-canonical-axis
```
(PR creation is handled by the orchestrator after the verified-done gate.)

---

## Self-review (spec-coverage check)

- **R2 fresh-store column** → Task 1 (schema.ts).
- **R2 existing-store PRAGMA-guarded constructor ensure-column** [grill #5] → Task 1 (`ensureForgottenFactsCanonicalColumn`, always-run call site; migration-script-only precedent NOT copied).
- **`forget` writes canonical from `fact_fts.canonical` at record time** → Task 1 (`readCanonicalForFact` captured before the delete).
- **D6b consult + helpers match canonical OR display** → Tasks 2 (helpers) + 3 (consult).
- **Legacy NULL-canonical → display-only, honest** → Task 2 (skip canonical clause on NULL) + Task 2 legacy test + note rewrite.
- **Precedence chain byte-carried, only match key widens** → display clause byte-identical in all three helpers; existing D6b/FIX1 tests re-run green.
- **D6c/D6e clears on both axes** → Task 2 (port.remember, write-gate.editFact + tests).
- **RED-first across new/append/replace-replacement-text** → Task 3 (i)/(ii)/(iii).
- **16-rephrase + cross-language fixture, reusable/named** → Task 2 (`rephrase-matrix.fixture.ts`, exported for chunk-04).
- **Rewrite the stale `:193-198` note (m3 lesson)** → Task 3.
- **Out-of-scope respected:** no embeddings, `factExistsByDedupKey` untouched, no backfill, no new ADR.

## Status: Done

---

## Progress log (build 2026-07-14)

- **Task 1** `4d7282e` — `forgotten_facts.canonical` column (SCHEMA_DDL + constructor-run PRAGMA-guarded `ensureForgottenFactsCanonicalColumn`) + `forget` captures canonical via `readCanonicalForFact` BEFORE the gate delete. RED confirmed (`no such column: canonical`).
- **Task 2** `bac13fc` — two-axis (`canonical OR display`) match in the three helpers + D6c (`write-gate.editFact`) / D6e (`port.remember`) clears widened + `rephrase-matrix.fixture.ts` (16-class + cross-language + residual + negatives). **Mid-task flag→resolve:** worker correctly STOPPED on a fixture-taxonomy defect (4 classes labelled `axis:"display"` that the deterministic normalizer structurally can't fold — `internal-punct`/`british-spelling`/`ordinal-echo`/`possessive`); architect ground-truthed against `normalize-fact-text.ts` → relabelled those 4 to `axis:"canonical"` (option 1, no drop — coverage preserved for chunk-04 reuse). No test-body change.
- **Task 3** `6e8d386` — two-axis D6b consult (`op.canonical || normalizeFactText(op.fact)`, mirroring `applyFactOp`) + rewritten `:193-198` limitation note (residual now named/accepted, no stale contradiction). RED-first across new/append/replace.
- **Reviewer nits** `b5a8352` — R2(iv) clarifying comment + `readCanonicalForFact` null-honest cast.

**Verification (independent, orchestrator, on tip `b5a8352`):** `bun test packages/daemon/src/memory` = 391 pass / 0 fail · `typecheck` exit 0 · `lint:strict` exit 0 · `git diff origin/main -- packages/protocol` empty (frozen byte-unchanged). **engine-reviewer VERDICT CLEAN 0 blockers** — RED **re-proven by revert** (three op-shape suppression tests fail on baseline, green after); precedence chain byte-carried; `factExistsByDedupKey` untouched; no-backfill (NULL-canonical never matches canonical-axis); capture-before-delete ordering correct; R2(iv) empirically non-vacuous; ensure-column idempotent. Behavioral R2-live suppression = chunk-06 §6.1 demo (NOT claimed here).

## Orchestrator flag (architect note, for the reviewer)

The `_distilledThroughTurnColumnPresent` cache-reset line in the v2-05 precedent (`ensureDistilledThroughTurnColumn`) has **no analogue** for the new column — the new ensure-column adds no cache field, so there is nothing to reset. That is correct: the precedent caches its column presence for a hot read path; `forgotten_facts.canonical` is read via a plain per-call `SELECT` with no cache, so no reset is needed.
