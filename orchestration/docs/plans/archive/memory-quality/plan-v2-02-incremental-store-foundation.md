# Memory Distiller v2 — Chunk v2-02: Incremental Store Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Status: in-progress (orchestrator-persisted; architect-authored)

**Goal:** Land the additive SQLite schema (FTS5 `fact_fts`, `fact_topics` join, `AFTER DELETE` sync trigger, `thread_distill_state` mutation-marker table) and the stable-id delta-apply store primitives that the v2-03 incremental distiller will call — fully TDD'd on real SQLite, NO distiller strategy, NO `ALTER TABLE`.

**Architecture:** All new state is additive (`CREATE TABLE IF NOT EXISTS` + `CREATE TRIGGER IF NOT EXISTS`), slotted into the existing `SCHEMA_DDL` string in `schema.ts` so a fresh store and an existing `~/.agentic-engine`-shaped store both open clean. Derived tables (`fact_fts`, `fact_topics`) stay consistent with `distilled_facts` **structurally**: deletes are mopped up by one `AFTER DELETE ON distilled_facts` trigger, so no call site is trusted to remember. Store primitives accept `canonical`/`topics` as parameters — the store **stores and matches** them; it never **computes** them (that lives in v2-03). The mutation marker lives in a side table, never an `ALTER` on `threads`.

**Tech Stack:** TypeScript on Bun, `bun:sqlite` (FTS5 is compiled in), `bun test`. No new dependencies.

---

## Orchestrator addendum (resolves the architect's two flagged decisions — read FIRST)

The architect flagged two non-blocking decisions. The orchestrator rules them as follows (binding on the worker):

1. **`recordReplacedFact` is exposed as a STANDALONE public method** — NOT folded silently into `updateFactById`.
   The chunk `## Scope` names `recordReplacedFact` as a primitive, listed *separately* from `updateFactById`.
   Per PIPELINE §7.2 (the orchestrator holds less context than the decomposer, who named it deliberately —
   v2-03's delta-apply may need to record-without-updating), honor the scope list literally:
   - Implement `recordReplacedFact(factId: string, replacedText: string, ctx: { actor: string; reason?: string }): void`
     as a public method that performs the `replaced_facts` insert.
   - `updateFactById` CALLS `recordReplacedFact` internally (so its "records the replaced text" DoD is met via the
     same primitive). This satisfies BOTH the named-primitive scope AND the DoD with ~3 extra lines. Keep
     `readReplacedFacts` as the reader.

2. **`appendToFactById` keeps the `"; "`-joined string representation** (the architect's choice — ACCEPTED).
   The structured `fact_list_items` side table is rejected for this chunk: it would add another derived-table
   sync surface across the same ~5 delete paths, exactly the fragility this chunk minimizes. The approximate
   separator-count cap is fine per spec §3.2 m1 ("architect-tuned"). **One clarification for the worker:** the
   `appendedCanonical` parameter is the CALLER's responsibility to populate as the FULL merged canonical (so
   BM25 can still find the fact by its earlier items) — document this in the method doc-comment. v2-02 stores
   what it is told; v2-03 decides the canonical content.

Everything below is the architect's plan, authoritative as written except where this addendum overrides.

---

## Reality check

Confirmed by reading source (file evidence cited). Behavioral/runtime facts are marked **"requires runtime confirmation"** per PIPELINE §6.1 — code-reading is not runtime proof.

- **`distilled_facts.id` is already TEXT and already stable-shaped at the schema level.** `schema.ts:54-64` declares `id TEXT PRIMARY KEY`. The id is minted via `crypto.randomUUID()` at insert (`store.ts:196`, `store.ts:577`). What is NOT stable today is the *lifecycle*: `replaceProjection` (`store.ts:562-610`) does DELETE-all-machine + re-INSERT every dismiss, so a row's id changes across dismisses even when the fact's text is identical. This chunk does **not** alter `replaceProjection` (that retirement is v2-03); it **adds** targeted primitives (`insertFact`/`updateFactById`/`appendToFactById`) that keep the id stable. The columns present: `id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version`. **There is no `canonical` column today** — see the §9 decision below for where canonical lives.

- **DDL application path** (`store.ts:96-98`): the constructor opens the DB, sets `PRAGMA journal_mode = WAL`, then runs `this.db.exec(SCHEMA_DDL)`. `SCHEMA_DDL` (`schema.ts:22-94`) is one big idempotent string of `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. New tables/index/trigger slot into this string additively; existing stores pick them up on next open with zero migration. **Foreign keys are OFF** (no `PRAGMA foreign_keys = ON` anywhere; confirmed by the `tombstoneFact` doc-comment at `store.ts:444-448` which relies on FK enforcement being off). So `fact_topics`/`fact_fts` cleanup cannot lean on `ON DELETE CASCADE` — it must be a trigger or explicit code.

- **Delete paths that touch `distilled_facts` TODAY (verified which exist now vs which are future):**
  - `purgeLiveMachineFactsByForget` — EXISTS (`store.ts:287-306`); deletes machine rows by id inside a tx.
  - `dropDistilledFactsByProvenance` — EXISTS (`store.ts:525-528`); `DELETE … WHERE provenance = ? AND authored_by != 'human' RETURNING id`.
  - `dropDistilledFactsForThread` — EXISTS (`store.ts:532-536`); same shape, `provenance = 'thread:<id>'`.
  - `dropAllDistilledFacts` — EXISTS (`store.ts:541-543`); `DELETE … WHERE authored_by != 'human'`. (Spec §3.3 D-V3a keeps this ONLY for the v2-05 migration wipe; this chunk does not remove it.)
  - `replaceProjection`'s inline DELETE — EXISTS (`store.ts:584`); the "REPLACE record-and-remove" path the spec names. This chunk does NOT modify `replaceProjection` (v2-03 retires it), but the trigger covers its delete too, for free.
  - The **migration wipe** the spec §3.4/§3.8 names is v2-05 future; it will reuse `dropAllDistilledFacts`. Covered by the trigger when it lands.
  - The new `updateFactById` REPLACE-record-and-remove and the new fact-delete helper this chunk adds are the additional delete paths created here.
  - **Net:** the "~5 delete paths" the spec cites = 4 existing today (`purgeLiveMachineFactsByForget`, `dropDistilledFactsByProvenance`, `dropDistilledFactsForThread`, `replaceProjection` inline) + `dropAllDistilledFacts` + the new helper this chunk adds. The trigger covers **all** of them structurally, including the future v2-05 wipe.

- **Existing real-SQLite test harness pattern** (`store.test.ts:11-14`): `freshStore()` = `mkdtempSync(join(tmpdir(), "mf01-"))` → `new MemoryStore({ dataDir: dir })`. Real `bun:sqlite`, no mocks. Every test closes with `store.close()`. This chunk's tests follow this pattern exactly (helper `freshStore` reused as-is).

- **`normalizeFactText` canonical home:** `packages/daemon/src/memory/normalize-fact-text.ts` (imported by `store.ts:7`). This chunk's store code imports from `./normalize-fact-text.js` if it needs it (it does not — canonical is a *param*, not computed).

- **`ALTER TABLE` grep baseline is clean** — zero matches in `packages/daemon/src` today. The DoD grep-gate starts green; the worker must keep it green.

- **`distilled_facts.id` "stable across dismisses" is a BEHAVIORAL claim — requires runtime confirmation.** This chunk provides the *primitives* that preserve id stability; the end-to-end "id unchanged across N dismisses" assertion is v2-03's STABILITY test (it needs the distiller to drive the dismisses). This chunk's tests prove only the unit-level invariants (e.g. `updateFactById` keeps the same id; `insertFact` returns a usable id).

- **FTS5 / trigram availability in `bun:sqlite` — UNVERIFIED, no Bash in the architect role to confirm.** Per the chunk's instruction: marked **"FTS5/trigram availability = confirmed by the first RED test at build"** — the worker's first `CREATE VIRTUAL TABLE … USING fts5` test fails loudly if FTS5 is absent. See the §9 decision: we choose the **default `unicode61` tokenizer (no trigram)**, which sidesteps the trigram-availability risk entirely.

---

## §9 "Open at build" decisions (made here, with rationale)

1. **`fact_fts` DDL: standalone table, default tokenizer (NO trigram).**
   - **Standalone** (not external-content / `content=`): `fact_fts(fact_id UNINDEXED, canonical, topic)`. Rationale: external-content tables require the FTS index to mirror a real `distilled_facts` rowid and need `INSERT/UPDATE/DELETE` shadow triggers kept in perfect lockstep — but we match on `canonical`, which does **not** live in `distilled_facts`. A standalone table lets us write `canonical` from code at insert/update and delete via the one `AFTER DELETE` trigger. Simpler, and the spec §3.4 D-V4d names exactly this shape.
   - **Tokenizer = default `unicode61`, NOT trigram.** Facts are LLM-canonicalized (spec §3.4 D-V4a/c), so lexical overlap on whole tokens holds; the default unicode61 tokenizer + BM25 is sufficient and **avoids the trigram-availability risk in `bun:sqlite` entirely**. If a future need for substring/fuzzy match emerges, swapping to `tokenize = 'trigram'` is a one-line DDL change behind the same primitive — not this chunk's problem.

2. **`fact_topics` cleanup: the SAME `AFTER DELETE` trigger handles both `fact_fts` AND `fact_topics`.** FK stays OFF per the store's design. One trigger body does `DELETE FROM fact_fts WHERE fact_id = old.id; DELETE FROM fact_topics WHERE fact_id = old.id;`. Rationale: a single structural cleanup point across all ~5 delete paths is exactly the spec §3.4 D-V4d / §7.1 M2 ask.

3. **Mutation-counter: additive `thread_distill_state(thread_id TEXT PRIMARY KEY, marker INTEGER NOT NULL DEFAULT 0, distilled_through INTEGER NOT NULL DEFAULT 0)` table. NO `ALTER` on `threads`.** A side table keyed on `thread_id` holds both the monotonic `marker` (bumped on append/edit/forget) and `distilled_through` (the marker the distiller last covered). The row is lazily upserted so threads created before this chunk get a row on first bump.

4. **Named constants (dogfood scale):**
   - `CANDIDATE_TOP_K = 10` — BM25 candidate-fetch returns the top 10 facts.
   - `APPEND_LIST_CAP = 8` — `appendToFactById` refuses to grow a fact's appended-list past 8 items (spec §3.2 m1).
   - **BM25 query string** = the caller passes a free-text query string (in v2-03 this will be the new fact's `canonical`). The store sanitizes it for FTS5 MATCH (OR-of-quoted-terms).

5. **`canonical` is ACCEPTED as a parameter, never computed by the store.** The canonical-normalization algorithm lives in v2-03's distiller (spec §3.4 D-V4c).

6. **Where does `canonical` get stored?** It is **NOT** added as a column on `distilled_facts`. `canonical` lives **only** in `fact_fts.canonical` (the match index). `distilled_facts` is unchanged in shape. The candidate-fetch JOINs `fact_fts` (BM25 ranked on `canonical`) back to `distilled_facts` (display `fact`) by `fact_id`.

---

## File structure

- **Modify** `packages/daemon/src/memory/schema.ts` — append `fact_topics`, `fact_fts` (FTS5 virtual table), the `AFTER DELETE ON distilled_facts` trigger, `thread_distill_state`, and `replaced_facts` to `SCHEMA_DDL`. No existing DDL changes.
- **Modify** `packages/daemon/src/memory/store.ts` — add named constants + the delta-apply primitives, candidate-fetch, fact-delete helper, `recordReplacedFact`/`readReplacedFacts`, and mutation-marker methods. Bump the marker inside the existing `appendMessages` tx. No existing method's behavior changes except the additive marker bump in `appendMessages`.
- **Modify** `packages/daemon/src/memory/write-gate.ts` — bump the mutation marker on `edit` and `forget` (the human paths). **Scope note:** this is the ONLY non-store file touched, and only to call the new `store.bumpThreadMarker(threadId)` — it carries NO forget rewiring (that's v2-04). If the marker bump cannot be cleanly added without touching forget *semantics*, STOP and flag — do not expand scope.
- **Modify** `packages/daemon/src/memory/store.test.ts` — add all new RED→GREEN unit tests + the count-equality sync-gate tests (one per delete path) following the `freshStore()` pattern.

No new files needed; the constants are small enough to live at the top of `store.ts`.

---

## ADR worthy: no

This realizes the **already-accepted** ADR-0012 Amendment 2026-06-13 (stable-id, stateful store) with purely additive store primitives. It introduces no new frozen boundary, no new runtime dependency (FTS5 ships in `bun:sqlite`), and does not redefine any wire contract. The contract-significant change — the `MemoryProvider` port redefinition (full-projection → delta) — is **v2-03**, not this chunk. `@agentic/protocol` and `mock-agent.ts` stay byte-unchanged.

---

## §7.1 coupling called out

1. **`fact_fts` + `fact_topics` ↔ `distilled_facts` must stay consistent across insert / update / REPLACE-record-and-remove / forget-delete / migration-wipe.** Solved **structurally** by the `AFTER DELETE ON distilled_facts` trigger (covers *every* delete path, present and future) + the **count-equality DoD** (a dedicated test per delete path), NOT by trusting each call site. Inserts/updates write `fact_fts`/`fact_topics` from code because `canonical` can't be computed in SQL — those two write paths are the only places code must remember, and they are exactly the two new primitives this chunk tests.
2. **The mutation marker couples the human `edit`/`forget` paths to v2-03's future skip decision.** The marker must bump on `appendMessages` AND `edit` AND `forget` (NOT `last_active_at`, which only `appendMessages` bumps today — `store.ts:141`). This chunk wires all three bump sites; v2-03 reads `marker` vs `distilled_through` to decide whether to skip a thread. This chunk does NOT implement the skip decision.

---

## Done criteria mapping

| Chunk DoD item | How this plan meets it | Proven by |
|---|---|---|
| **[mechanical]** all new tables/index/trigger created additively; **no `ALTER TABLE`**; a fresh store AND an existing-shaped store both open clean | Task 1 appends only `CREATE … IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS` to `SCHEMA_DDL` | Task 1 tests: fresh-open + re-open-existing both succeed; `grep -rE 'ALTER TABLE' packages/daemon/src` returns nothing |
| **[mechanical — FROZEN SYNC GATE]** after each fact-delete primitive, `COUNT(fact_fts) == COUNT(distilled_facts)` AND no orphan `fact_topics` rows (dedicated test per delete path) | Task 5: one count-equality test per delete path (`purgeLiveMachineFactsByForget`, `dropDistilledFactsByProvenance`, `dropDistilledFactsForThread`, `dropAllDistilledFacts`, new `deleteFactById`, `updateFactById` REPLACE) | Task 5 tests assert `countFactFts() === countDistilledFacts()` + zero `fact_topics` orphans after each delete |
| **[mechanical]** BM25 candidate-fetch surfaces a contradicting fact with a DIFFERENT topic tag (tags don't filter); append cap enforced; `updateFactById` records replaced text | Task 4 (cross-tag BM25), Task 3 (`appendToFactById` cap), Task 3 (`updateFactById`/`recordReplacedFact` records replaced) | Task 3 + Task 4 tests |
| **[mechanical]** full `bun test` + `lint:strict` + typecheck exit 0; real SQLite, no mocks; frozen surfaces byte-unchanged | All tests use `freshStore()` (real `bun:sqlite`); final verification step | Task 6: `bun test`, `lint:strict`, `typecheck` all exit 0; `git diff` shows `@agentic/protocol` + `mock-agent.ts` untouched |

---

## Steps

Three committable units: **(A) schema first** (Task 1) → **(B) primitives** (Tasks 2-4) → **(C) the sync-gate + wiring** (Task 5). Task 6 is the final verification commit.

> **Commit boundaries:** Task 1 = commit 1 (schema). Tasks 2-4 = commit 2 (primitives). Task 5 = commit 3 (sync gate + marker wiring). Branch `chunk/v2-02-incremental-store-foundation`. Per-task `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Additive schema — `fact_topics`, `fact_fts`, `AFTER DELETE` trigger, `thread_distill_state`, `replaced_facts`

**Files:**
- Modify: `packages/daemon/src/memory/schema.ts` (append to `SCHEMA_DDL`)
- Test: `packages/daemon/src/memory/store.test.ts`

- [ ] **Step 1: Write the failing test (schema opens clean, FTS5 present, trigger exists)**

```ts
import { Database } from "bun:sqlite";

test("v2-02 schema: new tables/index/trigger created additively on a fresh store", () => {
  const { store, dir } = freshStore();
  const db = store.rawDb();
  // FTS5 virtual table must exist (this line throws loudly if FTS5 is absent in bun:sqlite)
  const fts = db.query("SELECT name FROM sqlite_master WHERE name = 'fact_fts'").get();
  expect(fts).not.toBeNull();
  const topics = db.query("SELECT name FROM sqlite_master WHERE name = 'fact_topics'").get();
  expect(topics).not.toBeNull();
  const trig = db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_distilled_facts_ad'").get();
  expect(trig).not.toBeNull();
  const dstate = db.query("SELECT name FROM sqlite_master WHERE name = 'thread_distill_state'").get();
  expect(dstate).not.toBeNull();
  store.close();

  // Re-open the SAME dir (existing-store path): must not throw (idempotent IF NOT EXISTS)
  const reopened = new MemoryStore({ dataDir: dir });
  expect(reopened.rawDb().query("SELECT name FROM sqlite_master WHERE name='fact_fts'").get()).not.toBeNull();
  reopened.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/daemon/src/memory/store.test.ts -t "v2-02 schema"`
Expected: FAIL — `fact_fts` not found. If it fails instead with an FTS5-not-available error on the `CREATE VIRTUAL TABLE`, the §9 risk fired: STOP and report (FTS5 missing from this `bun:sqlite` build — a precondition failure, escalate; do not work around).

- [ ] **Step 3: Append the additive DDL to `SCHEMA_DDL`**

In `schema.ts`, append before the closing backtick of `SCHEMA_DDL`:

```sql

-- ── v2-02: incremental store foundation (spec §3.4/§3.5/§3.3/§3.2) ──────────
-- Topic-tags join (one fact → many tags), keyed on the now-stable distilled_facts.id.
CREATE TABLE IF NOT EXISTS fact_topics (
  fact_id TEXT NOT NULL,
  topic   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fact_topics_fact ON fact_topics(fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_topics_topic ON fact_topics(topic);

-- FTS5 similarity layer. Match on `canonical` (LLM-normalized key, supplied in code at
-- insert/update — a SQL trigger cannot compute it). Display text stays in distilled_facts.fact.
-- Default unicode61 tokenizer (NOT trigram): facts are LLM-canonicalized so whole-token
-- overlap holds, and this avoids the unverified trigram-availability risk in bun:sqlite.
CREATE VIRTUAL TABLE IF NOT EXISTS fact_fts USING fts5(
  fact_id UNINDEXED,
  canonical,
  topic
);

-- The ONE structural sync point: every delete path on distilled_facts mops up BOTH
-- derived tables here, so no call site is trusted to remember (spec §3.4 D-V4d / §7.1 M2).
CREATE TRIGGER IF NOT EXISTS trg_distilled_facts_ad
AFTER DELETE ON distilled_facts
BEGIN
  DELETE FROM fact_fts WHERE fact_id = old.id;
  DELETE FROM fact_topics WHERE fact_id = old.id;
END;

-- Per-thread mutation marker (bumped on append/edit/forget — NOT last_active_at) +
-- distilled_through (the marker the distiller last covered). Additive side table, NO ALTER on threads.
CREATE TABLE IF NOT EXISTS thread_distill_state (
  thread_id        TEXT PRIMARY KEY,
  marker           INTEGER NOT NULL DEFAULT 0,
  distilled_through INTEGER NOT NULL DEFAULT 0
);

-- Durable audit of REPLACE-overwritten fact text (spec §3.2 m4 auditability).
CREATE TABLE IF NOT EXISTS replaced_facts (
  id            TEXT PRIMARY KEY,
  fact_id       TEXT NOT NULL,   -- the surviving fact id that overwrote this text
  replaced_text TEXT NOT NULL,   -- the prior display text, recoverable in History
  actor         TEXT,
  reason        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replaced_facts_fact ON replaced_facts(fact_id);
```

Update the `schema.ts` top doc-comment block to add (the only doc-comment touched in the store layer; the broader m3-fold of `memory-provider.ts` re-derivability comments is v2-03's, not this chunk's):

```
 * v2-02 (spec §3.4/§3.5): adds fact_topics + fact_fts (FTS5, matched on a
 * canonical key supplied in code) + an AFTER DELETE sync trigger + the additive
 * thread_distill_state mutation-marker table + replaced_facts audit. All
 * CREATE IF NOT EXISTS — additive, no ALTER. The fact store is now a STATEFUL
 * derived store (ADR-0012 Amendment 2026-06-13).
```

- [ ] **Step 4: Run test to verify it passes** — `bun test … -t "v2-02 schema"` → PASS

- [ ] **Step 5: Verify the no-ALTER grep-gate** — `grep -rE 'ALTER TABLE' packages/daemon/src ; echo "exit:$?"` → no output, `exit:1`

- [ ] **Step 6: Commit**
```bash
git add packages/daemon/src/memory/schema.ts packages/daemon/src/memory/store.test.ts
git commit -m "feat(memory): v2-02 additive schema — fact_fts + fact_topics + sync trigger + thread_distill_state + replaced_facts"
```

---

### Task 2: `insertFact` (returns stable id) + topics/FTS write helpers

**Files:** Modify `store.ts`; Test `store.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
test("insertFact returns a stable id and writes fact_fts + fact_topics", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "User's name is Lior", canonical: "user name lior", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine",
    topics: ["about-user", "relationships"],
  }, "smart-v2");
  expect(typeof id).toBe("string");
  const db = store.rawDb();
  const df = db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string };
  expect(df.fact).toBe("User's name is Lior");
  const fts = db.query("SELECT canonical FROM fact_fts WHERE fact_id = ?").get(id) as { canonical: string };
  expect(fts.canonical).toBe("user name lior");
  const tags = db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(id) as { topic: string }[];
  expect(tags.map((t) => t.topic)).toEqual(["about-user", "relationships"]);
  store.close();
});
```

- [ ] **Step 2: Run test → FAIL** (`store.insertFact is not a function`)

- [ ] **Step 3: Add the input type + `insertFact` + `writeFactDerived` helper to `store.ts`**

Add near the other interfaces:
```ts
/** Named build-time constants (spec §9 — dogfood scale). */
export const CANDIDATE_TOP_K = 10;
export const APPEND_LIST_CAP = 8;

/** Input to insert one fact + its derived FTS/topic rows (v2-02). `canonical` and
 * `topics` are SUPPLIED by the caller (v2-03 distiller) — the store stores+matches,
 * never computes them. */
export interface InsertFactInput {
  fact: string;            // user-language display text
  canonical: string;       // LLM-normalized match key (→ fact_fts)
  provenance: string;
  scope: "thread-local" | "cross-thread" | "global";
  expiry: number | null;
  confidence: number;
  authored_by: "human" | "machine";
  topics: string[];
}
```

Method inside `MemoryStore`:
```ts
/**
 * Insert ONE fact with a stable id, writing its derived rows in the SAME tx:
 *   distilled_facts (display text) + fact_fts (canonical match key) + fact_topics (tags).
 * Returns the stable id. v2-02 delta-apply primitive (spec §3.3) — the id stays put
 * across dismisses (no DELETE-all). `canonical`/`topics` come from the caller.
 */
insertFact(f: InsertFactInput, distillerVersion: string): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  const tx = this.db.transaction(() => {
    this.db.query(
      "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, f.fact, f.provenance, f.scope, f.expiry ?? null, f.confidence, f.authored_by, now, distillerVersion);
    this.writeFactDerived(id, f.canonical, f.topics);
  });
  tx();
  return id;
}

/** Write the derived fact_fts + fact_topics rows for a fact id: one fact_fts row
 * carrying the space-joined topics string; one fact_topics row PER topic.
 * Private; called inside insertFact/updateFactById txns. */
private writeFactDerived(id: string, canonical: string, topics: string[]): void {
  this.db.query("INSERT INTO fact_fts (fact_id, canonical, topic) VALUES (?, ?, ?)")
    .run(id, canonical, topics.join(" "));
  const insTopic = this.db.query("INSERT INTO fact_topics (fact_id, topic) VALUES (?, ?)");
  for (const t of topics) insTopic.run(id, t);
}
```

- [ ] **Step 4: Run test → PASS**
- [ ] **Step 5:** (no commit yet — Tasks 2-4 share commit 2)

---

### Task 3: `updateFactById` (records replaced text via `recordReplacedFact`), `appendToFactById` (capped), `recordReplacedFact`/`readReplacedFacts`, `deleteFactById`

> **Orchestrator addendum override:** `recordReplacedFact` is a STANDALONE public method (see addendum §1). `updateFactById` calls it internally.

**Files:** Modify `store.ts`; Test `store.test.ts`

- [ ] **Step 1: Write the failing tests**
```ts
test("updateFactById REPLACEs the row in place (same id), refreshes fact_fts, and records the replaced text", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "User has 3 siblings", canonical: "user 3 siblings", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["about-user"],
  }, "smart-v2");
  store.updateFactById(id, {
    fact: "User has 2 siblings", canonical: "user 2 siblings", confidence: 1, topics: ["about-user", "family"],
  }, { actor: "machine", reason: "contradiction" }, "smart-v2");
  const db = store.rawDb();
  const df = db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string };
  expect(df.fact).toBe("User has 2 siblings");
  const fts = db.query("SELECT canonical FROM fact_fts WHERE fact_id = ?").all(id) as { canonical: string }[];
  expect(fts.length).toBe(1);
  expect(fts[0]!.canonical).toBe("user 2 siblings");
  const tags = (db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(id) as { topic: string }[]).map((t) => t.topic);
  expect(tags).toEqual(["about-user", "family"]);
  const replaced = store.readReplacedFacts(id);
  expect(replaced.some((r) => r.replaced_text === "User has 3 siblings")).toBe(true);
  store.close();
});

test("recordReplacedFact standalone records text without an update", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "keep", canonical: "keep", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["x"],
  }, "smart-v2");
  store.recordReplacedFact(id, "older text", { actor: "machine", reason: "audit" });
  expect(store.readReplacedFacts(id).some((r) => r.replaced_text === "older text")).toBe(true);
  store.close();
});

test("appendToFactById appends until the cap, then refuses (returns false past APPEND_LIST_CAP)", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "User likes: tea", canonical: "user likes tea", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["preferences"],
  }, "smart-v2");
  for (let i = 1; i < APPEND_LIST_CAP; i++) {
    expect(store.appendToFactById(id, `item${i}`, `user likes item${i}`)).toBe(true);
  }
  expect(store.appendToFactById(id, "overflow", "user likes overflow")).toBe(false);
  store.close();
});

test("deleteFactById removes the row and (via trigger) its fact_fts + fact_topics rows", () => {
  const { store } = freshStore();
  const id = store.insertFact({
    fact: "ephemeral", canonical: "ephemeral", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["x", "y"],
  }, "smart-v2");
  expect(store.deleteFactById(id)).toBe(true);
  const db = store.rawDb();
  expect(db.query("SELECT 1 FROM distilled_facts WHERE id = ?").get(id)).toBeNull();
  expect(db.query("SELECT 1 FROM fact_fts WHERE fact_id = ?").get(id)).toBeNull();
  expect(db.query("SELECT 1 FROM fact_topics WHERE fact_id = ?").get(id)).toBeNull();
  store.close();
});
```

- [ ] **Step 2: Run tests → FAIL** (methods not defined)

- [ ] **Step 3: Implement the primitives** (the `replaced_facts` table was already added in Task 1)

Add types:
```ts
export interface UpdateFactInput {
  fact: string;
  canonical: string;
  confidence: number;
  topics: string[];
}
export interface ReplacedFactRow {
  replaced_text: string;
  actor: string | null;
  reason: string | null;
  created_at: number;
}
```

Methods inside `MemoryStore`:
```ts
/** Durably record a fact's prior text for audit (spec §3.2 m4). STANDALONE primitive
 * (chunk scope) — callable independently of updateFactById; updateFactById calls it. */
recordReplacedFact(factId: string, replacedText: string, ctx: { actor: string; reason?: string }): void {
  this.db.query(
    "INSERT INTO replaced_facts (id, fact_id, replaced_text, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), factId, replacedText, ctx.actor, ctx.reason ?? null, Date.now());
}

/**
 * REPLACE a fact's content in place (id UNCHANGED — stability), refreshing its
 * fact_fts + fact_topics rows and DURABLY recording the prior text (recordReplacedFact)
 * for audit (spec §3.2 m4). All in one tx. Returns false if `id` does not exist.
 * Does NOT do the 5e human-precedence / concurrency gating — that is the v2-03
 * delta-apply caller's job; this primitive is the unconditional in-place REPLACE.
 */
updateFactById(id: string, u: UpdateFactInput, ctx: { actor: string; reason?: string }, distillerVersion: string): boolean {
  const tx = this.db.transaction((): boolean => {
    const prior = this.db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string } | null;
    if (prior === null) return false;
    this.recordReplacedFact(id, prior.fact, ctx);
    this.db.query(
      "UPDATE distilled_facts SET fact = ?, confidence = ?, distiller_version = ?, derived_at = ? WHERE id = ?",
    ).run(u.fact, u.confidence, distillerVersion, Date.now(), id);
    this.db.query("DELETE FROM fact_fts WHERE fact_id = ?").run(id);
    this.db.query("DELETE FROM fact_topics WHERE fact_id = ?").run(id);
    this.writeFactDerived(id, u.canonical, u.topics);
    return true;
  });
  return tx();
}

/**
 * APPEND a same-kind item to a fact's display list (spec §3.2 m1, capped at
 * APPEND_LIST_CAP). The fact's `fact` text becomes prior + "; " + item; its fact_fts
 * canonical is REPLACED with `appendedCanonical` — the CALLER (v2-03) must pass the
 * FULL merged canonical (all items) so BM25 can still find the fact by its earlier
 * items. Returns false (refuse) if the fact already holds >= APPEND_LIST_CAP items
 * (the v2-03 distiller then emits a `new` fact instead) or if id absent.
 * List length counted by "; " separators + 1.
 */
appendToFactById(id: string, item: string, appendedCanonical: string): boolean {
  const tx = this.db.transaction((): boolean => {
    const row = this.db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string } | null;
    if (row === null) return false;
    const itemCount = row.fact.split("; ").length;
    if (itemCount >= APPEND_LIST_CAP) return false;
    const merged = `${row.fact}; ${item}`;
    this.db.query("UPDATE distilled_facts SET fact = ?, derived_at = ? WHERE id = ?").run(merged, Date.now(), id);
    this.db.query("UPDATE fact_fts SET canonical = ? WHERE fact_id = ?").run(appendedCanonical, id);
    return true;
  });
  return tx();
}

/** Read the durable replaced-text audit trail for a fact id (spec §3.2 m4). */
readReplacedFacts(factId: string): ReplacedFactRow[] {
  return this.db.query(
    "SELECT replaced_text, actor, reason, created_at FROM replaced_facts WHERE fact_id = ? ORDER BY created_at ASC",
  ).all(factId) as ReplacedFactRow[];
}

/** Delete one fact by id. The AFTER DELETE trigger cleans fact_fts + fact_topics.
 * Returns true if a row was deleted. v2-04's fact-forget reuses this. */
deleteFactById(id: string): boolean {
  const result = this.db.query("DELETE FROM distilled_facts WHERE id = ? RETURNING id").all(id);
  return result.length > 0;
}
```

- [ ] **Step 4: Run tests → PASS**
- [ ] **Step 5:** (no commit yet — shares commit 2)

---

### Task 4: BM25 full-corpus candidate-fetch (tags WIDEN, never filter)

**Files:** Modify `store.ts`; Test `store.test.ts`

- [ ] **Step 1: Write the failing tests (the B1 cross-tag invariant)**
```ts
test("fetchCandidates surfaces a contradicting fact carrying a DIFFERENT topic tag (tags WIDEN, never filter)", () => {
  const { store } = freshStore();
  store.insertFact({
    fact: "User has 3 siblings", canonical: "user has 3 siblings family", provenance: "thread:t1",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["about-user"],
  }, "smart-v2");
  store.insertFact({
    fact: "User has 2 siblings", canonical: "user has 2 siblings family", provenance: "thread:t2",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["relationships"],
  }, "smart-v2");
  const candidates = store.fetchCandidates("user has siblings family");
  const facts = candidates.map((c) => c.fact);
  expect(facts).toContain("User has 3 siblings");
  expect(facts).toContain("User has 2 siblings");
  const a = candidates.find((c) => c.fact === "User has 3 siblings")!;
  expect(typeof a.id).toBe("string");
  expect(a.topics).toEqual(["about-user"]);
  store.close();
});

test("fetchCandidates returns at most CANDIDATE_TOP_K rows and tolerates punctuation in the query", () => {
  const { store } = freshStore();
  for (let i = 0; i < CANDIDATE_TOP_K + 5; i++) {
    store.insertFact({
      fact: `fact ${i} about deployment`, canonical: `fact ${i} about deployment`, provenance: "thread:t1",
      scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["projects"],
    }, "smart-v2");
  }
  const candidates = store.fetchCandidates("deployment: the (script)?");
  expect(candidates.length).toBeLessThanOrEqual(CANDIDATE_TOP_K);
  expect(candidates.length).toBeGreaterThan(0);
  store.close();
});
```

- [ ] **Step 2: Run tests → FAIL** (`fetchCandidates is not a function`)

- [ ] **Step 3: Implement `fetchCandidates` + `toFtsOrQuery`**

Add the return type:
```ts
export interface FactCandidate {
  id: string;        // the stable distilled_facts.id
  fact: string;      // user-language display text (from distilled_facts)
  topics: string[];  // the fact's tags (from fact_topics)
}
```

Module-level helper (top of `store.ts`):
```ts
/**
 * Turn arbitrary caller text into a safe FTS5 MATCH expression: lowercase, strip
 * everything but word chars + spaces, drop empties, quote each token, OR-join.
 * "deployment: the (script)?" → '"deployment" OR "the" OR "script"'. Returns ""
 * when no usable token survives (caller treats "" as "no candidates").
 */
export function toFtsOrQuery(raw: string): string {
  const tokens = raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}
```

Method inside `MemoryStore`:
```ts
/**
 * BM25 candidate-fetch over the FULL distilled_facts corpus (spec §3.4 D-V4b — the
 * FROZEN B1 invariant: tags WIDEN recall, they NEVER reduce the candidate set).
 * Matches on fact_fts.canonical; returns the top CANDIDATE_TOP_K by BM25 rank, with
 * the user-language display `fact` (joined from distilled_facts) + topics (from
 * fact_topics). The caller (v2-03) passes a free-text `query` (the new fact's canonical).
 * `query` is sanitized into a safe OR-of-quoted-terms (toFtsOrQuery) so punctuation
 * can never produce a MATCH syntax error.
 */
fetchCandidates(query: string): FactCandidate[] {
  const ftsQuery = toFtsOrQuery(query);
  if (ftsQuery === "") return [];
  const rows = this.db.query(
    `SELECT f.fact_id AS id, d.fact AS fact
       FROM fact_fts f
       JOIN distilled_facts d ON d.id = f.fact_id
       WHERE fact_fts MATCH ?
       ORDER BY bm25(fact_fts)
       LIMIT ?`,
  ).all(ftsQuery, CANDIDATE_TOP_K) as { id: string; fact: string }[];
  return rows.map((r) => ({
    id: r.id,
    fact: r.fact,
    topics: (this.db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(r.id) as { topic: string }[]).map((t) => t.topic),
  }));
}
```

- [ ] **Step 4: Run tests → PASS**

- [ ] **Step 5: Commit (commit 2 — the primitives)**
```bash
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/store.test.ts
git commit -m "feat(memory): v2-02 stable-id delta primitives — insertFact/updateFactById/appendToFactById/deleteFactById/recordReplacedFact + BM25 candidate-fetch"
```

---

### Task 5: The count-equality SYNC GATE (one test per delete path) + mutation-marker wiring

**Files:** Modify `store.ts` (marker methods + `appendMessages` bump); Modify `write-gate.ts` (bump on `edit` + `forget`); Test `store.test.ts`

- [ ] **Step 1: Write the failing sync-gate tests (one per delete path) + marker tests**
```ts
function assertDerivedInSync(store: MemoryStore): void {
  const db = store.rawDb();
  const dfCount = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
  const ftsCount = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
  expect(ftsCount).toBe(dfCount);
  const orphans = (db.query(
    "SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id NOT IN (SELECT id FROM distilled_facts)",
  ).get() as { n: number }).n;
  expect(orphans).toBe(0);
}

function seedTwoFacts(store: MemoryStore): { a: string; b: string } {
  const a = store.insertFact({ fact: "fact A", canonical: "fact a", provenance: "thread:tA",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["x"] }, "smart-v2");
  const b = store.insertFact({ fact: "fact B", canonical: "fact b", provenance: "thread:tB",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["y", "z"] }, "smart-v2");
  return { a, b };
}

test("SYNC GATE: deleteFactById keeps fact_fts == distilled_facts, no orphan topics", () => {
  const { store } = freshStore();
  const { a } = seedTwoFacts(store);
  store.deleteFactById(a);
  assertDerivedInSync(store);
  store.close();
});

test("SYNC GATE: dropDistilledFactsByProvenance keeps derived tables in sync", () => {
  const { store } = freshStore();
  seedTwoFacts(store);
  store.dropDistilledFactsByProvenance("thread:tA");
  assertDerivedInSync(store);
  store.close();
});

test("SYNC GATE: dropDistilledFactsForThread keeps derived tables in sync", () => {
  const { store } = freshStore();
  seedTwoFacts(store);
  store.dropDistilledFactsForThread("tB");
  assertDerivedInSync(store);
  store.close();
});

test("SYNC GATE: dropAllDistilledFacts (migration wipe) keeps derived tables in sync", () => {
  const { store } = freshStore();
  seedTwoFacts(store);
  store.dropAllDistilledFacts();
  assertDerivedInSync(store);
  store.close();
});

test("SYNC GATE: purgeLiveMachineFactsByForget keeps derived tables in sync", () => {
  const { store } = freshStore();
  const { a } = seedTwoFacts(store);
  store.purgeLiveMachineFactsByForget("thread:tA", "no-text-match");
  assertDerivedInSync(store);
  expect(store.rawDb().query("SELECT 1 FROM distilled_facts WHERE id = ?").get(a)).toBeNull();
  store.close();
});

test("SYNC GATE: updateFactById REPLACE leaves exactly one fact_fts row (no desync)", () => {
  const { store } = freshStore();
  const { a } = seedTwoFacts(store);
  store.updateFactById(a, { fact: "fact A2", canonical: "fact a2", confidence: 1, topics: ["x", "w"] },
    { actor: "machine", reason: "test" }, "smart-v2");
  assertDerivedInSync(store);
  store.close();
});

test("mutation marker: appendMessages bumps marker (not via last_active_at); bumpThreadMarker also bumps", () => {
  const { store } = freshStore();
  const t = store.createThread();
  expect(store.readThreadMarker(t)).toBe(0);
  store.appendMessages(t, [{ role: "user", content: "hi" }], "s1");
  expect(store.readThreadMarker(t)).toBe(1);
  store.appendMessages(t, [{ role: "user", content: "again" }], "s2");
  expect(store.readThreadMarker(t)).toBe(2);
  store.bumpThreadMarker(t); // simulates the edit/forget bump site
  expect(store.readThreadMarker(t)).toBe(3);
  store.close();
});

test("distilled_through: advanceDistilledThrough records the marker the distiller covered", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "hi" }], "s1");
  store.advanceDistilledThrough(t, store.readThreadMarker(t));
  const state = store.readThreadDistillState(t);
  expect(state.marker).toBe(1);
  expect(state.distilled_through).toBe(1);
  store.close();
});
```

> **Worker note on the test helpers above:** confirm the real method names from `store.ts` while writing
> (`createThread`, `appendMessages`'s exact signature, `purgeLiveMachineFactsByForget`'s args). Adjust the
> test calls to the ACTUAL signatures — do NOT invent. If a named delete path's signature differs from the
> sketch, fix the test call, keep the assertion.

- [ ] **Step 2: Run tests → marker/distilled_through FAIL** (`readThreadMarker is not a function`). The SYNC GATE delete-path tests should mostly already PASS (the trigger from Task 1 covers them) — that is expected; they exist to **lock** the invariant. If any SYNC GATE test FAILS, the trigger is wrong — fix the trigger, not the test.

- [ ] **Step 3: Add the marker methods to `store.ts`**
```ts
export interface ThreadDistillState {
  marker: number;
  distilled_through: number;
}
```
```ts
/** Bump the per-thread mutation marker (spec §3.3 D-V3b). Upserts the side-table
 * row so threads created before v2-02 get one lazily. Called on append/edit/forget —
 * NOT tied to last_active_at (which only append touches). Returns the new marker. */
bumpThreadMarker(threadId: string): number {
  this.db.query(
    `INSERT INTO thread_distill_state (thread_id, marker, distilled_through) VALUES (?, 1, 0)
     ON CONFLICT(thread_id) DO UPDATE SET marker = marker + 1`,
  ).run(threadId);
  return this.readThreadMarker(threadId);
}

/** Current mutation marker for a thread (0 if no state row yet). */
readThreadMarker(threadId: string): number {
  const row = this.db.query("SELECT marker FROM thread_distill_state WHERE thread_id = ?").get(threadId) as { marker: number } | null;
  return row?.marker ?? 0;
}

/** Record the marker value the distiller has covered (v2-03 reads marker vs this to skip). */
advanceDistilledThrough(threadId: string, marker: number): void {
  this.db.query(
    `INSERT INTO thread_distill_state (thread_id, marker, distilled_through) VALUES (?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET distilled_through = excluded.distilled_through`,
  ).run(threadId, marker, marker);
}

/** Read both markers (0/0 if no row yet). */
readThreadDistillState(threadId: string): ThreadDistillState {
  const row = this.db.query("SELECT marker, distilled_through FROM thread_distill_state WHERE thread_id = ?").get(threadId) as ThreadDistillState | null;
  return row ?? { marker: 0, distilled_through: 0 };
}
```

Wire the bump into `appendMessages` — add `this.bumpThreadMarker(threadId);` INSIDE the existing `tx` (after the `last_active_at` UPDATE at `store.ts:141`), so the bump is atomic with the message insert.

- [ ] **Step 4: Wire the bump into the human `edit` + `forget` paths in `write-gate.ts`**

Read `write-gate.ts` first. After each path commits its mutation, call `this.store.bumpThreadMarker(threadId)` for the affected thread. Resolve the thread id from the existing path (message→thread or provenance→thread). **Bump once per affected thread.** If getting the thread id needs a new query, add a minimal `store.threadIdForMessage(messageId)` helper (`SELECT thread_id FROM messages WHERE id = ?`) — in-scope (store SQL). Do NOT touch any forget *semantics* — only add the marker bump. If a clean bump site doesn't exist, STOP and flag (v2-04 owns forget rewiring). Consider adding one integration test asserting a real `edit`/`forget` through `write-gate.ts` bumps the marker, IF the bump site is clean.

- [ ] **Step 5: Run all tests → PASS**
Run: `bun test packages/daemon/src/memory/store.test.ts` → PASS (all SYNC GATE + marker + distilled_through green).
Run: `bun test packages/daemon/src/memory/write-gate.test.ts` → PASS (existing tests still green; the marker bump is additive).

- [ ] **Step 6: Commit (commit 3)**
```bash
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/write-gate.ts packages/daemon/src/memory/store.test.ts
git commit -m "feat(memory): v2-02 count-equality sync gate (per delete path) + thread mutation marker on append/edit/forget"
```

---

### Task 6: Full verification + frozen-surface check

**Files:** none (verification only)

- [ ] **Step 1: Full test suite** — `bun test` → exit 0, all suites green (including daemon integration suites — the additive schema + marker bump must not regress any existing test).
- [ ] **Step 2: Lint + typecheck** — `bun run lint:strict && bun run typecheck` → both exit 0. (If the script name differs, check `package.json`.)
- [ ] **Step 3: No-ALTER grep-gate** — `grep -rE 'ALTER TABLE' packages/daemon/src ; echo "exit:$?"` → no output, `exit:1`.
- [ ] **Step 4: Frozen-surface byte-check** — `git diff --stat origin/main -- packages/protocol mock-agent` (and the explicit `mock-agent.ts` + `@agentic/protocol` paths) → NO changes. If either shows, you violated a freeze gate — revert.
- [ ] **Step 5: Open the PR**
```bash
git push -u origin chunk/v2-02-incremental-store-foundation
gh pr create --base main --title "chunk v2-02: incremental store foundation (FTS5 + fact_topics + stable-id delta primitives)" --body "<summary + verification checklist + Claude Code attribution>"
```
PR body summarizes: additive schema (no ALTER), the stable-id primitives + BM25 candidate-fetch + `recordReplacedFact` audit, the count-equality sync gate (one test per delete path), the mutation marker; verification = full `bun test` + `lint:strict` + typecheck green on real SQLite, frozen surfaces byte-unchanged. NO distiller strategy (v2-03), NO forget rewiring (v2-04).

---

## §7.1 / scope guardrails for the worker

- **NO `ALTER TABLE`** — grep-gated.
- **NO distiller strategy** (the `MemoryProvider` port change, op-resolution, concurrency gating) — that is v2-03.
- **NO forget rewiring** — only the additive marker bump in `write-gate.ts`; STOP-and-flag if it can't be added without touching forget semantics.
- **Frozen byte-unchanged:** `@agentic/protocol`, `mock-agent.ts`.
- The store **stores+matches** `canonical`/`topics`, never **computes** them.

## Status: Done
