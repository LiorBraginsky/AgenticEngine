# Plan — chunk v2-05: Migration + default cutover + feature-closing live demo

> Content authored by engine-architect, persisted by engine-orchestrator.
> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use
> checkbox (`- [ ]`) syntax. All paths repo-relative to
> `/Users/lior/WebstormProjects/playground/AgenticEngine`.

> Feature: memory-quality (memory-distiller-v2). The **LAST** chunk. Chunk file:
> `orchestration/chunks-todo/memory-quality/v2-05-migration-flip-and-demo.md`.
> Spec: `orchestration/docs/specs/2026-06-13-memory-distiller-v2.md` §3.8 (D-V8) / §5 / §6 /
> §3.4 (D-V4c/D-V4d) / §3.6 (D-V6b) / §9.
> ADRs (ACCEPTED — implement, do not edit): ADR-0012 + the 2026-06-13 amendment (stability =
> the demoed promise); ADR-0015 (forget steps).

**Goal:** Cut the incremental SmartDistiller in as the default memory provider, ship a one-time
deliberate migration script that wipes the known-bad machine `distilled_facts` (human facts
preserved) and rebuilds the derived FTS/topic tables, and hand the whole feature to Lior's live
closing demo.

**Architecture:** Two mechanical changes plus a runbook. (1) A one-time
`scripts/migrate-distiller-v2.ts` opens the live store **through the normal `new MemoryStore(...)`
init path** (running all `CREATE TABLE IF NOT EXISTS`), adds the `distilled_through_turn` column to
a pre-v2-03 live `thread_distill_state` via the **only sanctioned live-store ALTER** (§3.8), wipes
machine facts with the existing `dropAllDistilledFacts()` (the AFTER DELETE trigger structurally
cleans `fact_fts`/`fact_topics` for wiped rows), rebuilds derived rows for the surviving **human**
facts via a new public `rebuildDerivedForHumanFacts()`, and emits a resurrection-risk report over
the dormant `forgotten_facts` table. **Default = wipe-forward (no ordered-replay).** (2) Flip
`memory-provider-selector.ts` default from `dumb-tail` to `smart` — the existing `smart` branch
already does key-resolve + keyless DumbTail fallback with the loud log, so the change is the default
token plus selector tests. (3) A demo runbook drafted in the PR body.

**Tech Stack:** TypeScript on Bun, `bun:sqlite` (real, never mocked — the only permitted stub
anywhere is the LLM `clientFactory`, and this chunk needs none), `bun test`, `lint:strict`, typecheck.

---

## Reality check

Every claim is grounded in file evidence read by the architect. **Behavioral/runtime claims are
flagged — never asserted as verified.**

**Spec-fixed decisions confirmed against the spec text:**
- §3.8 D-V8 (one-time, explicit, logged migration; ordered-replay OPTIONAL; resurrection-risk
  report; real-sqlite verified) — `specs/2026-06-13-memory-distiller-v2.md:319-329`.
- §3.6 D-V6b (`forgotten_facts` necessity decided by v2-04) — v2-04 chose
  **(b)-with-dormant-substrate**: the table + low-level primitives retained inert as "v2-05 optional
  ordered-replay Layer-T" (`plans/memory-quality/plan-v2-04-forget-simplification.md:13-28`; confirmed
  in code: `store.ts` `readForgottenFacts`/`isForgottenNormalizedText` carry the "dormant — retained
  for v2-05 optional ordered-replay Layer-T; no live per-dismiss consumer" comments).
- §3.4 D-V4c (match on `canonical`, display in user language) + D-V4d (count-equality DoD after every
  delete path; AFTER DELETE trigger) — `schema.ts:114-127`, `store.ts:899-924`.

**Code evidence (code-path existence — NOT runtime behavior):**
- **Default provider is `dumb-tail`.** `packages/daemon/src/memory/memory-provider-selector.ts:49` —
  `const id = process.env["MEMORY_PROVIDER"] ?? "dumb-tail";`. The `smart` branch (`:51-57`) already
  resolves the key and, on no-key, returns DumbTail with a loud `console.error` that includes
  `resolved.fixHint`. The flip = change the `??` default to `"smart"`. *(behavioral "default is
  incremental at runtime" requires the selector test + demo to confirm.)*
- **`LLM_PROVIDER` and `MEMORY_PROVIDER` are independent.** `LLM_PROVIDER` selects the chat agent
  (`providers/injector.ts:25`, `anthropic-api` registered `:22`); `MEMORY_PROVIDER` selects the
  distiller (selector). `startDaemon` wires both: `buildInjector()` `index.ts:63`,
  `buildMemoryProvider()` `index.ts:70`. The demo needs **both** `LLM_PROVIDER=anthropic-api` AND the
  flipped memory default → `smart` (Keychain key resolving).
- **Human/machine distinction = the `authored_by` column** (`'human' | 'machine'`), `schema.ts:67`.
  `dropAllDistilledFacts()` already scopes the wipe to machine rows:
  `DELETE FROM distilled_facts WHERE authored_by != 'human'` (`store.ts:594-596`); its doc already
  reads "ONE-TIME MIGRATION ONLY (v2-05 §3.8)".
- **The AFTER DELETE trigger covers the wipe.** `trg_distilled_facts_ad` (`schema.ts:122-127`) deletes
  the matching `fact_fts` + `fact_topics` rows on every `distilled_facts` delete — including the
  migration wipe's per-row deletes. **Count-equality and no-orphan must still be asserted post-wipe**
  (the q#011 rider). *(structural; the migration test confirms.)*
- **Surviving human rows need derived rebuild.** `writeFactDerived(id, canonical, topics)` is
  **private** (`store.ts:1050`). `insertFact`/`updateFactById` are the only writers of
  `fact_fts`/`fact_topics`. Human facts predate v2-02 and may have **no** derived rows → invisible to
  `fetchCandidates` (`store.ts:908`). A **new public** `rebuildDerivedForHumanFacts()` is required
  (Step 1) — the migration cannot reach the private writer.
- **`distilled_through_turn` forward-flag (v2-03 R2).** The column lives in the fresh-store
  `CREATE TABLE IF NOT EXISTS thread_distill_state` (`schema.ts:135-140`, sentinel `-1`). On a
  pre-v2-03 live store the table exists WITHOUT the column; `CREATE TABLE IF NOT EXISTS` is a no-op (so
  opening via store-init is **not** enough), and reads are resilient via a cached `PRAGMA table_info`
  guard (`store.ts:966-973`, `:1037-1044`, `:1024-1030`). v2-03's PR forward-flagged that **v2-05's
  migration MUST add the column to the live store** (its sanctioned §3.8 touch). → the migration runs
  an explicit guarded `ALTER TABLE thread_distill_state ADD COLUMN distilled_through_turn INTEGER NOT
  NULL DEFAULT -1` (idempotent: only if PRAGMA finds it absent).
- **Column-presence is cached per `MemoryStore` instance** (`store.ts:_distilledThroughTurnColumnPresent`).
  → the migration must run the ALTER **before** any watermark read on that instance (or invalidate the
  cache). Plan: ALTER first via `rawDb()`, before any watermark read, and reset the cache.
- **v2-03 dup subsumption.** The machine-fact wipe deletes ALL `authored_by != 'human'` rows, which
  includes any interim duplicates from the v2-03→v2-05 default-(-1) whole-thread reads. The wipe
  **naturally subsumes** the forward-flag concern — no separate dedup step. *(migration test asserts 0
  machine rows post-wipe.)*
- **Resurrection-risk report substrate.** `readForgottenFacts(): {normalized_text, raw_text,
  provenance}[]` (`store.ts:323-327`) + `fetchCandidates(query)` (BM25 over the surviving corpus,
  `:908`). For wipe-forward (no replay), "zero match during replay" = for each
  `forgotten_facts.normalized_text`, `fetchCandidates(normalized_text)` returns no candidate whose
  normalized text equals it → report it (informational; under durable-delete it is already gone). On a
  typical post-v2-04 store `forgotten_facts` is empty → the report is "0 rows" — expected/correct.
- **Frozen surfaces.** `@agentic/protocol` and `mock-agent.ts` are not referenced by the selector,
  the store, or the migration. The flip + migration touch neither wire nor reducer.
  **Confirm byte-unchanged via `git diff`.**
- **Probe conventions.** Deliberate `.ts` probes live in `packages/daemon/scripts/`, run with
  `bun run packages/daemon/scripts/<probe>.ts` (+ a `package.json` alias). They `mkdtempSync` a temp
  dataDir, do real `new MemoryStore({dataDir})` I/O, print a banner + a PASS/FAIL line, `process.exit`
  on failure (`forget-roundtrip-probe.ts`, `incremental-distill-probe.ts`, `smart-distiller-probe.ts`).
  The migration **script** follows the same convention; its **test** uses a throwaway temp DB.
  **Never touch the real `~/.agentic-engine/memory.sqlite` in the test.**

**Behavioral claims (NOT verified by this plan):**
- The migration "preserves human / wipes machine / rebuilds derived / emits report" end-to-end on disk
  — proven this chunk only by (a) the `bun test` migration test over a real temp SQLite and (b) the
  EXECUTED migration run against a throwaway real sqlite (stdout in PR). *Requires that executed run —
  code-reading is not evidence (Strike-4/5).*
- **The feature-closing six-step demo (Done criterion 3) — `requires Lior's live demo — NOT verifiable
  by code-reading, tests, or a prior PASS record`.** This is the whole-feature behavioral gate (§6.1).
  Never asserted here as verified. The orchestrator escalates it to Lior via the conductor; the feature
  is NOT `done` and no PR auto-merges until the demo is green (especially step 3, STABILITY — the route
  lied 5×).

---

## Wipe-forward vs ordered-replay — the explicit call

**Recommendation: wipe-forward as the default. No ordered-replay.** Rationale, spec-grounded:
1. §3.8 makes ordered-replay **OPTIONAL** and states "wipe + let new conversations re-distill forward
   is an equally-fine default (Lior has a backup + already chose a clean reset)."
2. v2-04 already decided **(b)** — the `forgotten_facts` table is dormant replay-safety substrate with
   **no live consumer**. Replay is the only thing that would re-animate it; wipe-forward keeps it
   correctly inert.
3. Ordered-replay = re-distilling every conversation chronologically through a non-deterministic LLM =
   exactly the churn the v2 pivot exists to kill, on day one, for facts that would re-accumulate
   naturally as the user resumes threads. The cost buys nothing the forward path doesn't give within a
   few sessions.
4. **The resurrection-risk report is still emitted** even under wipe-forward (§3.8 mandates it). Under
   wipe-forward it is informational; on a post-v2-04 store it is almost always "0 rows."

No concrete reason for replay was found. The call is recorded in the PR body and the script's banner.
(Reversible: Lior can run the dormant Layer-T path manually at demo time — out of this chunk's scope.)

---

## File structure (what changes, and why)

| File | Change | Responsibility after |
|---|---|---|
| `packages/daemon/src/memory/store.ts` | **Modify** | Add public `rebuildDerivedForHumanFacts(distillerVersion: string): number` (rebuild `fact_fts`+`fact_topics` for surviving human rows lacking them; canonical = `normalizeFactText(fact)`, topics = `[]`; idempotent). Add public `ensureDistilledThroughTurnColumn(): boolean` (the §3.8 sanctioned guarded `ALTER`; resets the R2 cache; returns true if it added the column). No change to the wipe or the trigger. |
| `packages/daemon/src/memory/store.test.ts` | **Modify** | Tests for the two new methods (rebuild over a bare human row → 1 fts row + count-equality; idempotent; ALTER on a pre-v2-03-shaped table adds once, no-op the second time, existing row → -1). |
| `packages/daemon/src/memory/memory-provider-selector.ts` | **Modify** | Flip the default: `?? "smart"`. Update the function doc. Keep the `smart` key-resolve + fallback branch byte-equivalent. |
| `packages/daemon/src/memory/memory-provider-selector.test.ts` | **Modify** | Flip the unset-default tests (unset+key→`smart`; unset+no-key→`dumb-tail` + loud log carrying `fixHint`). Keep explicit-`smart` + unknown-id-fallback tests. |
| `packages/daemon/scripts/migrate-distiller-v2.ts` | **Create** | Exported `runMigration(store, opts): MigrationReport` + `import.meta.main` deliberate-run wrapper. ALTER-first, wipe, rebuild, count-equality+no-orphan invariant, resurrection-risk report. Defaults to `~/.agentic-engine`; `--data-dir` for the throwaway run. |
| `packages/daemon/scripts/migrate-distiller-v2.test.ts` | **Create** | Real-SQLite test (q#011 rider): seed human + machine facts + a no-match `forgotten_facts` row → `runMigration` → assert machine wiped, human preserved+reindexed, count-equality, resurrection report lists the orphan. |
| `packages/daemon/package.json` | **Modify** | Add `"migrate-distiller-v2": "bun run scripts/migrate-distiller-v2.ts"`. |

**Decomposition note:** the migration's verifiable logic lives in the exported `runMigration` so the
test drives it over a temp store without spawning a process; the `import.meta.main` wrapper opens the
live store, calls `runMigration`, prints the report, sets the exit code. Real store, no mocks.

---

## Steps (ordered; each independently executable; TDD RED→GREEN; real SQLite; commit-per-task on `chunk/v2-05-migration-flip-and-demo`)

### Step 1 — Store primitives: human-derived rebuild + sanctioned live-store column ALTER

**Files:** modify `packages/daemon/src/memory/store.ts`, `packages/daemon/src/memory/store.test.ts`.

- [ ] **1.1 (RED) Write the rebuild + ALTER tests in `store.test.ts`.** Use the existing `freshStore()`
  helper. Three tests:
  ```ts
  test("v2-05: rebuildDerivedForHumanFacts indexes a human fact that has no derived rows", () => {
    const { store } = freshStore();
    const db = store.rawDb();
    db.query(
      "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES ('h1','User pins: name is Lior','thread:t','cross-thread',NULL,1,'human',1,'pre-v2')",
    ).run();
    expect((db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n).toBe(0);
    const n = store.rebuildDerivedForHumanFacts("v2-05-migration");
    expect(n).toBe(1);
    const dfCount = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
    const ftsCount = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
    expect(ftsCount).toBe(dfCount);
    expect(store.fetchCandidates("lior").some((c) => c.id === "h1")).toBe(true);
    store.close();
  });

  test("v2-05: rebuildDerivedForHumanFacts is idempotent (no duplicate derived rows on re-run)", () => {
    const { store } = freshStore();
    const db = store.rawDb();
    db.query(
      "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES ('h1','name is Lior',NULL,'cross-thread',NULL,1,'human',1,'pre-v2')",
    ).run();
    store.rebuildDerivedForHumanFacts("v2-05-migration");
    store.rebuildDerivedForHumanFacts("v2-05-migration");
    expect((db.query("SELECT COUNT(*) AS n FROM fact_fts WHERE fact_id='h1'").get() as { n: number }).n).toBe(1);
    store.close();
  });

  test("v2-05: ensureDistilledThroughTurnColumn adds the column to a pre-v2-03 shaped table, then no-ops", () => {
    const dir = mkdtempSync(join(tmpdir(), "mf-prev203-"));
    const raw = new (require("bun:sqlite").Database)(join(dir, "memory.sqlite"));
    raw.exec("CREATE TABLE thread_distill_state (thread_id TEXT PRIMARY KEY, marker INTEGER NOT NULL DEFAULT 0, distilled_through INTEGER NOT NULL DEFAULT 0);");
    raw.query("INSERT INTO thread_distill_state (thread_id, marker, distilled_through) VALUES ('t', 3, 2)").run();
    raw.close();
    const store = new MemoryStore({ dataDir: dir });
    expect(store.ensureDistilledThroughTurnColumn()).toBe(true);
    expect(store.ensureDistilledThroughTurnColumn()).toBe(false);
    const row = store.rawDb().query("SELECT distilled_through_turn FROM thread_distill_state WHERE thread_id='t'").get() as { distilled_through_turn: number };
    expect(row.distilled_through_turn).toBe(-1);
    store.close();
  });
  ```
  Run: `bun test packages/daemon/src/memory/store.test.ts -t "v2-05"` → Expected: FAIL
  ("rebuildDerivedForHumanFacts is not a function"). (Ensure `mkdtempSync`/`tmpdir`/`join` are imported
  in the test file — they are used by existing tests there; reuse the same imports.)

- [ ] **1.2 (GREEN) Implement the two public methods in `store.ts`** (near the v2-02 primitives, after
  `appendToFactById`/before `deleteFactById`):
  ```ts
  /**
   * v2-05 migration (§3.8): rebuild fact_fts + fact_topics for every SURVIVING
   * human-authored fact. Human facts predate v2-02's derived tables, so they may
   * have NO fact_fts/fact_topics rows → invisible to fetchCandidates (BM25). The
   * AFTER DELETE trigger cannot ADD rows; only insertFact/updateFactById (private
   * writeFactDerived) do, neither reached by the wipe. This is the public,
   * migration-only path to (re)index human rows.
   * Idempotent: clears then re-writes derived rows per human id. canonical =
   * normalizeFactText(fact) (D-V4c: match on canonical; display stays the row's fact);
   * topics = [] (human facts carry no LLM tags). Returns the count of human rows reindexed.
   */
  rebuildDerivedForHumanFacts(distillerVersion: string): number {
    const tx = this.db.transaction((): number => {
      const humans = this.db
        .query("SELECT id, fact FROM distilled_facts WHERE authored_by = 'human'")
        .all() as { id: string; fact: string }[];
      for (const h of humans) {
        this.db.query("DELETE FROM fact_fts WHERE fact_id = ?").run(h.id);
        this.db.query("DELETE FROM fact_topics WHERE fact_id = ?").run(h.id);
        this.db.query("INSERT INTO fact_fts (fact_id, canonical, topic) VALUES (?, ?, ?)")
          .run(h.id, normalizeFactText(h.fact), "");
      }
      return humans.length;
    });
    return tx();
  }

  /**
   * v2-05 migration (§3.8) — the ONLY sanctioned live-store ALTER (spec §9 forbids
   * ALTER on the per-dismiss path; this is the deliberate one-time migration touch
   * v2-03's R2 forward-flag named). Adds `distilled_through_turn INTEGER NOT NULL
   * DEFAULT -1` to a pre-v2-03 live thread_distill_state. Idempotent: PRAGMA-guards
   * so a v2-03+ fresh store is a no-op. Returns true if the column was added. Resets
   * the column-presence cache so subsequent reads see it.
   */
  ensureDistilledThroughTurnColumn(): boolean {
    const cols = this.db.query("PRAGMA table_info(thread_distill_state)").all() as { name: string }[];
    if (cols.some((c) => c.name === "distilled_through_turn")) return false;
    this.db.exec("ALTER TABLE thread_distill_state ADD COLUMN distilled_through_turn INTEGER NOT NULL DEFAULT -1;");
    this._distilledThroughTurnColumnPresent = null;
    return true;
  }
  ```
  (`normalizeFactText` already imported `store.ts:7`. `_distilledThroughTurnColumnPresent` is the
  existing R2 cache field — confirm its exact name/type at `store.ts:1037` and match it; if it is
  typed `boolean | undefined`, reset to `undefined` instead of `null`. The `distillerVersion` param is
  reserved for parity with the other writers; if lint flags it unused, prefix `_distillerVersion` per
  the repo eslint convention — confirm against the existing `argsIgnorePattern` finding in v2-04.)

- [ ] **1.3 (GREEN) Run the new tests.** `bun test packages/daemon/src/memory/store.test.ts -t "v2-05"`
  → PASS (3). Then `bun test packages/daemon/src/memory/store.test.ts` → full file still green.

- [ ] **1.4 — Commit.**
  ```bash
  git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/store.test.ts
  git commit -m "feat(memory): v2-05 store primitives — rebuildDerivedForHumanFacts + ensureDistilledThroughTurnColumn (the sanctioned migration ALTER)
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Step 2 — Flip the default to the incremental distiller + selector tests

**Files:** modify `packages/daemon/src/memory/memory-provider-selector.ts`,
`packages/daemon/src/memory/memory-provider-selector.test.ts`.

- [ ] **2.1 (RED) Rewrite the unset-default tests** in `memory-provider-selector.test.ts`. Replace the
  existing "default UNCHANGED → dumb-tail" test with two FLIP tests; keep the explicit-`smart`,
  no-key-fallback-with-loud-log, and unknown-id tests intact:
  ```ts
  test("MEMORY_PROVIDER unset + resolvable key => provider.id === 'smart' (v2-05 default flip)", async () => {
    delete process.env["MEMORY_PROVIDER"];
    const { buildMemoryProvider } = await import("./memory-provider-selector.js");
    const provider = buildMemoryProvider({ resolveKey: () => fakeOk });
    expect(provider.id).toBe("smart");
  });

  test("MEMORY_PROVIDER unset + NO key => loud console.error AND falls back to dumb-tail", async () => {
    delete process.env["MEMORY_PROVIDER"];
    const { buildMemoryProvider } = await import("./memory-provider-selector.js");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const provider = buildMemoryProvider({ resolveKey: () => fakeMissing });
    expect(errSpy).toHaveBeenCalled();
    const allText = errSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(allText).toContain(fakeMissing.fixHint);
    errSpy.mockRestore();
    expect(provider.id).toBe("dumb-tail");
  });
  ```
  (Match `fakeOk`/`fakeMissing`/`spyOn`/`buildMemoryProvider` injection shape to the existing tests in
  that file — reuse the established fixtures, do not invent a new signature.)
  Run: `bun test packages/daemon/src/memory/memory-provider-selector.test.ts` → FAIL (unset → dumb-tail).

- [ ] **2.2 (GREEN) Flip the default** in `memory-provider-selector.ts` (line 49):
  ```ts
  // v2-05 cutover (§3.8 / §6): the incremental SmartDistiller is the default.
  // Keyless env (no resolvable ANTHROPIC key) falls back to the DumbTail delta with
  // the loud log below — daemon stays up; quality degrades, not availability. This
  // keyless leg keeps the full suite green + deterministic with no network, AND is the
  // swap-proof second leg (spec §6).
  const id = process.env["MEMORY_PROVIDER"] ?? "smart";
  ```
  Update the function header doc: "Defaults to `dumb-tail`" → "Defaults to `smart` (the incremental
  distiller; v2-05 cutover). Unknown ids and a no-key `smart` both fall back to `dumb-tail` with a
  `console.error` (never throws)." Leave the `smart` branch body + the no-key fallback byte-unchanged.

- [ ] **2.3 (GREEN) Run the selector suite.** `bun test
  packages/daemon/src/memory/memory-provider-selector.test.ts` → PASS (all).

- [ ] **2.4 — Commit.**
  ```bash
  git add packages/daemon/src/memory/memory-provider-selector.ts packages/daemon/src/memory/memory-provider-selector.test.ts
  git commit -m "feat(memory): v2-05 flip default MEMORY_PROVIDER to incremental smart (keyless => dumb-tail fallback + loud log)
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Step 3 — The one-time migration script + its real-sqlite test, EXECUTE it, full green gate, demo runbook

**Files:** create `packages/daemon/scripts/migrate-distiller-v2.ts`,
`packages/daemon/scripts/migrate-distiller-v2.test.ts`; modify `packages/daemon/package.json`.

- [ ] **3.1 (RED) Write the migration test** `migrate-distiller-v2.test.ts`. Real temp SQLite (q#011
  rider — NEVER the real `~/.agentic-engine`). Drive the exported `runMigration` over a seeded throwaway
  store:
  ```ts
  import { test, expect } from "bun:test";
  import { tmpdir } from "node:os";
  import { mkdtempSync } from "node:fs";
  import { join } from "node:path";
  import { MemoryStore } from "../src/memory/store.js";
  import { runMigration } from "./migrate-distiller-v2.js";

  test("v2-05 migration: machine wiped, human preserved+reindexed, count-equality, resurrection report", () => {
    const dir = mkdtempSync(join(tmpdir(), "v2-05-migrate-"));
    const store = new MemoryStore({ dataDir: dir });
    store.rawDb().query(
      "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES ('h1','my name is Lior',NULL,'cross-thread',NULL,1,'human',1,'pre-v2')",
    ).run();
    store.insertFact({ fact: "user likes tea", canonical: "user likes tea", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["#preferences"] }, "v2b");
    store.insertFact({ fact: "user likes coffee", canonical: "user likes coffee", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["#preferences"] }, "v2b");
    store.recordForgottenFact({ raw_text: "user lives in Berlin", provenance: null, actor: "user", authored_by: "human" });

    const report = runMigration(store, { quiet: true });

    const db = store.rawDb();
    expect((db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='machine'").get() as { n: number }).n).toBe(0);
    expect((db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='human'").get() as { n: number }).n).toBe(1);
    expect(db.query("SELECT 1 FROM distilled_facts WHERE id='h1'").get()).not.toBeNull();
    const dfCount = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
    const ftsCount = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
    expect(ftsCount).toBe(dfCount);
    expect((db.query("SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id NOT IN (SELECT id FROM distilled_facts)").get() as { n: number }).n).toBe(0);
    expect(store.fetchCandidates("lior").some((c) => c.id === "h1")).toBe(true);
    expect(report.machineWiped).toBe(2);
    expect(report.humanPreserved).toBe(1);
    expect(report.humanReindexed).toBe(1);
    expect(report.columnAdded).toBe(false);
    expect(report.resurrectionRisk).toContainEqual(expect.objectContaining({ normalized_text: "user lives in berlin" }));
    store.close();
  });
  ```
  (Confirm `insertFact`/`recordForgottenFact`/`readForgottenFacts` exact signatures + field names
  against `store.ts` before relying on them — adjust the seed to the real shapes; the test must compile
  against the actual API, not this sketch.)
  Run: `bun test packages/daemon/scripts/migrate-distiller-v2.test.ts` → FAIL ("Cannot find module").

- [ ] **3.2 (GREEN) Create `migrate-distiller-v2.ts`** — export `runMigration` + an `import.meta.main`
  wrapper, following the probe banner/exit convention:
  ```ts
  /**
   * migrate-distiller-v2 — ONE-TIME, EXPLICIT, LOGGED migration (spec §3.8 D-V8).
   * NOT auto-on-startup. Run deliberately ONCE after the v2-05 cutover.
   *
   * DEFAULT = WIPE-FORWARD (no ordered-replay): wipe machine distilled_facts (known-bad:
   * churned + wrong-language from the global-reprojection era); HUMAN facts PRESERVED (5e —
   * never wiped); rebuild fact_fts + fact_topics for surviving human rows; add the live-store
   * distilled_through_turn column (the sanctioned §3.8 ALTER, v2-03 R2 forward-flag). The
   * resurrection-risk report is emitted regardless (forgotten_facts rows with no surviving
   * live match) — informational under wipe-forward (durable-delete already removed them).
   *
   * Invocation (real live store):  bun run --cwd packages/daemon migrate-distiller-v2
   * Throwaway run (executed DoD):  bun run packages/daemon/scripts/migrate-distiller-v2.ts --data-dir <tmp>
   *
   * STRIKE-5: this script existing + typechecking is NOT evidence. The EXECUTED run against a
   * real (throwaway) sqlite — stdout pasted into the PR — is the DoD evidence (q#011 rider).
   */
  import { homedir } from "node:os";
  import { join } from "node:path";
  import { MemoryStore } from "../src/memory/store.js";
  import { normalizeFactText } from "../src/memory/normalize-fact-text.js";

  const MIGRATION_VERSION = "v2-05-migration";

  export interface ResurrectionRow { normalized_text: string; raw_text: string; provenance: string | null; }
  export interface MigrationReport {
    columnAdded: boolean;
    machineBefore: number;
    machineWiped: number;
    humanPreserved: number;
    humanReindexed: number;
    distilledFactsAfter: number;
    factFtsAfter: number;
    countEquality: boolean;
    orphanTopics: number;
    resurrectionRisk: ResurrectionRow[];
  }

  export function runMigration(store: MemoryStore, opts: { quiet?: boolean } = {}): MigrationReport {
    const log = (m: string) => { if (!opts.quiet) console.log(`[migrate-v2] ${m}`); };
    const db = store.rawDb();

    const columnAdded = store.ensureDistilledThroughTurnColumn();
    log(`distilled_through_turn column ${columnAdded ? "ADDED (pre-v2-03 live store)" : "already present"}`);

    const machineBefore = (db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='machine'").get() as { n: number }).n;
    const humanBefore = (db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='human'").get() as { n: number }).n;
    log(`before: ${machineBefore} machine fact(s), ${humanBefore} human fact(s)`);

    store.dropAllDistilledFacts();
    const machineAfter = (db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='machine'").get() as { n: number }).n;
    log(`wiped ${machineBefore - machineAfter} machine fact(s); ${machineAfter} remain (must be 0)`);

    const humanReindexed = store.rebuildDerivedForHumanFacts(MIGRATION_VERSION);
    log(`reindexed ${humanReindexed} human fact(s) into fact_fts`);

    const distilledFactsAfter = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
    const factFtsAfter = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
    const orphanTopics = (db.query("SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id NOT IN (SELECT id FROM distilled_facts)").get() as { n: number }).n;
    const countEquality = factFtsAfter === distilledFactsAfter;
    log(`COUNT(fact_fts)=${factFtsAfter} === COUNT(distilled_facts)=${distilledFactsAfter}: ${countEquality}; orphan fact_topics: ${orphanTopics}`);

    const forgotten = store.readForgottenFacts();
    const resurrectionRisk: ResurrectionRow[] = forgotten.filter((f) => {
      const hits = store.fetchCandidates(f.normalized_text);
      return !hits.some((c) => normalizeFactText(c.fact) === f.normalized_text);
    });
    log(`forgotten_facts checked: ${forgotten.length}; with no surviving live match: ${resurrectionRisk.length}`);
    for (const r of resurrectionRisk) log(`  resurrection-risk (none resurrected under wipe-forward): "${r.raw_text}"`);

    return { columnAdded, machineBefore, machineWiped: machineBefore - machineAfter, humanPreserved: humanBefore, humanReindexed, distilledFactsAfter, factFtsAfter, countEquality, orphanTopics, resurrectionRisk };
  }

  if (import.meta.main) {
    console.log("=== migrate-distiller-v2 (WIPE-FORWARD; ONE-TIME; §3.8) ===");
    const argv = process.argv.slice(2);
    const dirIdx = argv.indexOf("--data-dir");
    const dataDir = dirIdx >= 0 ? argv[dirIdx + 1]! : join(homedir(), ".agentic-engine");
    console.log(`[migrate-v2] data dir: ${dataDir}`);
    const store = new MemoryStore({ dataDir });
    try {
      const report = runMigration(store);
      const ok = report.machineWiped === report.machineBefore && report.countEquality && report.orphanTopics === 0;
      console.log(ok ? "MIGRATION OK" : "MIGRATION FAILED — invariant breach (see above)");
      store.close();
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error(`[migrate-v2] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      store.close();
      process.exit(1);
    }
  }
  ```
  (Confirm the exact return shape of `readForgottenFacts` + the `fetchCandidates` candidate shape
  against `store.ts`; align `ResurrectionRow`/the `.fact` field accordingly. `import.meta.main` guards
  the wrapper so the test's `import` does not trigger a live-dir run.)

- [ ] **3.3 (GREEN) Run the migration test.** `bun test packages/daemon/scripts/migrate-distiller-v2.test.ts` → PASS.

- [ ] **3.4 Add the package.json alias.** In `packages/daemon/package.json` `scripts`, add:
  `"migrate-distiller-v2": "bun run scripts/migrate-distiller-v2.ts"`.

- [ ] **3.5 (EXECUTE — Strike-5; the ORCHESTRATOR runs this, not the author) Run the migration against
  a throwaway real sqlite.** Seed a throwaway dir (human + machine facts) then run the script with
  `--data-dir` at it. Paste the full stdout into the PR body, marked "migrate-distiller-v2 real-sqlite
  run: EXECUTED, output below." Expected: `... already present`, `wiped 1 machine fact(s); 0 remain`,
  `reindexed 1 human fact(s)`, `COUNT(fact_fts)=1 === COUNT(distilled_facts)=1: true; orphan
  fact_topics: 0`, `forgotten_facts checked: 0`, `MIGRATION OK`. (q#011 rider satisfied.) The exact
  seeding command is the orchestrator's to construct from the real store API.

- [ ] **3.6 Full green gate (orchestrator-run; gates the PR).** From repo root:
  ```bash
  bun test && bun run lint:strict && bun run typecheck
  git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts
  ```
  Expected: `bun test` exit 0 (full suite, keyless env → DumbTail fallback, no network); `lint:strict`
  exit 0; `typecheck` exit 0; the frozen-surface `git diff --stat` is **empty**.

- [ ] **3.7 — Commit + push + open PR.**
  ```bash
  git add packages/daemon/scripts/migrate-distiller-v2.ts packages/daemon/scripts/migrate-distiller-v2.test.ts packages/daemon/package.json
  git commit -m "feat(memory): v2-05 one-time wipe-forward migration script + real-sqlite test + alias
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  git push -u origin chunk/v2-05-migration-flip-and-demo
  ```
  Open the PR with `gh pr create` targeting `main`. PR body carries: (a) executed migration stdout
  (3.5), (b) green-gate output (3.6), (c) the wipe-forward call + rationale, (d) the demo runbook below.
  **The PR does NOT auto-merge** — Done criterion 3 (the live demo) is the whole-feature gate; the
  orchestrator escalates it to Lior via the conductor.

**Demo runbook (paste verbatim into the PR body for Lior's §6.1 closing demo):**

> **memory-distiller-v2 — feature-closing live demo (Lior, §6.1).** Pre-req: spec + ADR-0012 amendment
> accepted (done, PR #61); this PR's mechanical gates green; the migration already run once on the real
> store (or a clean reset chosen).
> **Env:** `ANTHROPIC_API_KEY` in macOS Keychain; `LLM_PROVIDER=anthropic-api` (chat uses Claude);
> leave `MEMORY_PROVIDER` **unset** (v2-05 default → `smart` incremental distiller, key resolves from
> Keychain). Confirm the daemon log shows the smart provider active (no "falling back to dumb-tail"
> line).
> **Run once before the demo (optional clean reset):** `bun run --cwd packages/daemon
> migrate-distiller-v2` (wipes the old churned machine facts; preserves pinned human facts; rebuilds
> the index). Review the printed before/after counts + resurrection report.
> **Six steps — all live, through the real overlay → daemon → store → Anthropic path, nothing stubbed:**
> 1. **Meta-question** ("what do you know about me / do you remember X?") → truthful memory
>    **ownership**, AND **no false "I forgot that"** (v2-01 self-concept clause).
> 2. **Structured recall** → a precise answer + a provenance link openable in `history.html`.
> 3. **STABILITY (the headline)** → dismiss the overlay several times; "my name is Lior" and other facts
>    **stay put** — no churn, no reorder, nothing vanishes. Then state a genuinely-changed preference and
>    confirm it **does** update.
> 4. **Forget a fact** (via `history.html` "Forget fact") → durably gone (agent stops using it) AND the
>    **source conversation stays byte-intact**. Fact-forget is the whole forget story in v2.
> 5. **Ukrainian turn** → the distilled display fact comes back in **Ukrainian** (language preserved).
> **Sign-off:** Lior confirms all six live. NOT verifiable by code-reading, tests, or a prior PASS
> record — especially step 3.

---

## Self-review (spec coverage)

- §3.8 D-V8 migration → Step 1 (rebuild + ALTER) + Step 3 (`runMigration` + test + executed run). ✓
- §3.8 v2-03 forward-flag (add `distilled_through_turn` to live store) → `ensureDistilledThroughTurnColumn`, run FIRST. ✓
- §3.8 v2-03 dup-subsumption → the machine wipe deletes ALL machine rows; report asserts 0 after. ✓
- §3.4 D-V4c (match canonical, display user-language) → rebuild indexes `normalizeFactText(fact)`; test asserts retrievability. ✓
- §3.4 D-V4d (count-equality + no orphan after the wipe) → asserted in test + `runMigration` invariant + executed run. ✓
- §3.6 D-V6b (`forgotten_facts` fate) → v2-04 decided (b)-dormant; this chunk consumes it for the report only (no replay). ✓
- §6 (flip default; keyless fallback keeps suite green; DumbTail stays as fallback + swap-proof leg) → Step 2; no-key fallback preserved byte-equivalent. ✓
- §5 verification (real SQLite, only-LLM-stub; this chunk needs no LLM; executed real-sqlite run) → Step 3.5. ✓
- Behavioral DoD = Lior's live demo → marked NOT verifiable here; runbook drafted; escalated by orchestrator. ✓
- OUT honored: no in-overlay UI / `history.html` 🔒; DumbTail kept; frozen surfaces byte-unchanged; ADRs not edited. ✓

## ADR worthy: NO

Implements the already-accepted ADR-0012 2026-06-13 amendment (the store is now durable state to
migrate — exactly what the migration realizes) + ADR-0015 (forget steps, unchanged) + spec §3.8/§5/§6.
No new protocol, no new boundary, no new runtime dependency. The wipe-forward-vs-replay call is
**spec-delegated** to architect-time by §3.8 ("ordered-replay is OPTIONAL") and recorded in the PR
body, not an ADR. **Do NOT edit ADR-0012 / ADR-0015** (immutable; the `proposed`-header reconciliation
on ADR-0012 is a known doc-hygiene flag owned by adr-curator/Lior, out of scope here).

## Status: Done
