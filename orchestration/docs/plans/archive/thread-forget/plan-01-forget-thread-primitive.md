> 🗄️ ARCHIVED 2026-07-22 — shipped. Historical record; do not edit.

# Thread-forget (2e) — Chunk 01: Ruling-2 reconciliation + `forgetThread` primitive — Implementation Plan

## Status: shipped (PR #110 merged)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per repo `CLAUDE.md`: work happens on the ALREADY-CREATED branch `chunk/01-forget-thread-primitive` (do NOT create a new branch), commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer, PR to `main`, auto-merge only on the all-green gate set.

**Goal:** Land the daemon store+gate layer of thread-forget: reconcile the per-message `WriteGate.forget` to ADR-0012 Ruling 2 (source erasure never sweeps facts) and add `WriteGate.forgetThread` — a single atomic transaction that content-erases a whole conversation while every derived fact lives on byte-identical.

**Architecture:** Pure daemon work under `packages/daemon/src/memory/`. No HTTP, no Hatch façade, no UI, no lifecycle surface (those are chunks 02/03). The primitive must land fully tested before any caller exists. Ruling-2 safety is *structural* (by-construction absence of fact-table references), not review vigilance — the same posture ADR-0015 B1 used.

**Tech Stack:** TypeScript on Bun, `bun:sqlite` (synchronous single-writer, no nested transactions), `bun test`, per-thread JSONL mirror files.

## Global Constraints (verbatim from spec + chunk, apply to every task)

- **ADR-0012 rider Ruling 2 (BINDING):** erasing source content (a message, or a whole thread) MUST NOT sweep facts derived from it. Facts change/die ONLY via manual edit / prompted edit / explicit fact-forget.
- **STRUCTURAL Ruling-2 rule:** `forgetThread` contains **zero references** to `distilled_facts`, `forgotten_facts`, `fact_fts`, `fact_topics`, `fact_embeddings`. Enforced by construction, pinned behaviorally.
- **ATOMIC-ERASE INVARIANT (q#019 rider 2):** all DB scrub writes commit as ONE `db.transaction` — no partial-erase state is ever observable DB-side. The mirror pass is the sole post-tx step.
- **DB-first ordering:** DB tx commits, THEN the mirror rewrite + audit line (mirror I/O cannot join the sqlite tx; the crash window is a documented accepted state — do NOT build a reconcile).
- **NO `bumpThreadMarker`** in `forgetThread` (deliberate asymmetry, §3.1 [critic m5]). The per-message `forget` KEEPS its `bumpThreadMarker` call.
- **`REDACTION_MARKER`** = `"[forgotten]"`, exported from `packages/daemon/src/memory/schema.ts:36`, re-exported from `write-gate.ts:8`.
- **Verification model (§5):** real SQLite + real daemon path. Permitted stubs ONLY = LLM `clientFactory` + `EmbeddingProvider` fixtures. No mocked store internals (fault-injection spies for atomicity are the one allowed seam — spec §5 "inject a throwing statement").
- **Frozen surfaces byte-unchanged:** `@agentic/protocol` + the mock reducer — this chunk touches neither (`git diff --stat` must show no changes outside `packages/daemon/src/memory/`).
- **DoD grep:** `grep -rn dropDistilledFacts packages/ apps/` → zero non-comment hits.

---

## Reality check

**Verification method:** every anchor below was resolved against `main @ 951ded9` via Read/Grep. The spec's anchors were "verified @ 6785b35" and are hypotheses; the table below is authoritative. **All spec line anchors are accurate — no numeric drift.** But the spec's *test enumeration* is materially incomplete (see the DRIFT block — this is the one finding a worker must be handed explicitly).

**Code-reading disclaimer (PIPELINE §6.1):** everything below is a static-source fact ("this code path exists"). None of it is a runtime/behavioral confirmation. The behavioral DoD (facts actually survive end-to-end; erased content truly unsearchable) requires the chunk-03 live demo to confirm — this chunk's `bun test` green is necessary evidence, not the behavioral sign-off.

| Spec anchor | Verified location @ 951ded9 | Status |
|---|---|---|
| `WriteGate.forget` per-message method | `write-gate.ts:71-116` | ✓ |
| The two fact-sweep calls (:111-112) | `write-gate.ts:111-112` (`dropDistilledFactsByProvenance` / `dropDistilledFactsForThread`) | ✓ exact |
| The trap comment (:104-110) | `write-gate.ts:104-110` | ✓ exact |
| Tombstone-insert shape (:81-82) | `write-gate.ts:80-82` (INSERT INTO mutations … 'tombstone' … replacement_content NULL) | ✓ |
| Tx-less `deleteMessageDerived` call (:84-90) | `write-gate.ts:90`, comment `84-89` | ✓ |
| DB-first-then-mirror ordering (:92-102) | `write-gate.ts:92-102` | ✓ |
| `editFact` machine-refusal stance (:222) | `write-gate.ts:222` (`if (ctx.authored_by === "machine") return false;`) | ✓ exact |
| 5e machine-only guard (:76) | `write-gate.ts:76` | ✓ exact |
| `edit` mirror line carrying `replacement` (:257) | `write-gate.ts:257` (`mirrorEvent(… {event:"edit", …, replacement, …})`) | ✓ exact |
| `dropDistilledFacts*` in store (:786-797) | `store.ts:786-789` + `791-797` | ✓ exact |
| `deleteMessageDerived` (:1644-1647) | `store.ts:1644-1647` (no own tx, by design) | ✓ exact |
| `redactMirrorMessage` read-parse-rewrite (:1041-1059) | `store.ts:1041-1059` | ✓ exact |
| missing-file no-op (:1043) | `store.ts:1043` | ✓ |
| unparseable-line preservation (:1050-1051) | `store.ts:1050-1051` | ✓ |
| `readNewTailSince` (:1518-1522) | `store.ts:1498` (method), map at `1518-1522` | ✓ |
| drain pending-scan exclusion (:1594-1603) | `store.ts:1594-1603` (`pendingMessageEmbeddings`: content ≠ marker AND no tombstone) | ✓ exact |
| in-tx re-check `upsertMessageEmbedding` (:1624-1639) | `store.ts:1624-1639` (skips absent/scrubbed/tombstoned) | ✓ exact |
| COALESCE correction read (:951-957) | `store.ts:951-957` (`readArchiveMessagesByIds`); same COALESCE also `1503-1510` (`readNewTailSince`) | ✓ exact |
| `mutations.replacement_content` column | `schema.ts:64` | ✓ exact |
| `memory_action_events` shape w/ `fact_text` (:166-175) | `schema.ts:166-175` (`thread_id`:168, `action`:169, `outcome`:170, `fact_text`:171) | ✓ exact |
| smart-distiller no-op filter (:524-542) | `providers/smart-distiller-provider.ts:524-542` (filter marker/quarantine → `tail.length===0` → early return, NO LLM call) | ✓ (path is `providers/`, not root — minor path drift) |
| dumb-tail filter (:44-54) | `providers/dumb-tail-provider.ts:44-54` | ✓ (path is `providers/`) |

**Supporting facts confirmed by reading:**
- `mirrorEvent(threadId, payload: Record<string, unknown>)` at `store.ts:1028`; private `mirror` appends `JSON.stringify(payload)+"\n"` at `store.ts:1721`. Message lines carry `content` (`store.ts:279`), `edit` lines carry `replacement` (`write-gate.ts:257`).
- Thread status write path: dismiss uses a raw `UPDATE threads SET status = 'dismissed'` at `consolidation-hook.ts:43`. **There is NO dedicated store method for status** — `forgetThread` does the same raw `UPDATE threads SET status='forgotten', title=NULL` inside its tx. `schema.ts:43` comment still reads `-- 'active' | 'dismissed'`; `'forgotten'` is an additive TEXT value (no schema change) — update that comment.
- `threadExists(threadId)` exists at `store.ts:257` — use it for the not-found guard.
- `bumpThreadMarker` exists at `store.ts:1449` (do NOT call it from `forgetThread`).
- `insertFact(...)` at `store.ts:1073` writes `distilled_facts` + `fact_fts` + `fact_topics` in one tx (via `writeFactDerived`, `store.ts:1566`); `upsertFactEmbedding` at `store.ts:1608`. Use these to seed the headline test so fts/topics/embeddings counts are meaningful.
- No existing `forgetThread` / `redactMirrorThread` symbol anywhere (grep clean) — no collision.
- Cross-thread injection is provable at store level via `ThreadLifecycle.beginTurn(...)` → `priorMessages` carrying `[remembered] …` (pattern at `distiller-integration.daemon.test.ts:219-222`) or `DumbTailProvider.retrieve(store, newThreadId)`.
- `assertDerivedInSync` + `deleteFactById` sync-gate test already exists (`store.test.ts:1030-1035`); `deleteFactById` orphan-embeddings test exists (`embedding-storage.test.ts:118-122`). So the fact-side delete→derived-sync invariant is already covered independently of the `drop*` methods — the `drop*` tests are safe to delete.

### ⚠️ DRIFT — spec/chunk test enumeration is INCOMPLETE (handed to the worker)

The chunk file (§3.2) enumerates only `write-gate.test.ts:64,80`, `store.test.ts:80,91,1037,1045`, `embedding-storage.test.ts:125,136`. Grep found **four additional behavioral tests that pin the forbidden fact-sweep** and will go RED the instant the sweep is removed — none are listed in the chunk:

1. `distiller-integration.daemon.test.ts:137` — `"forget-survives-re-derive: tombstoned fact absent from rebuilt slice and retrieve()"` — asserts fact purged (`:157`, `:162`) and retrieve-slice empty (`:166`).
2. `distiller-integration.daemon.test.ts:173` — `"forget-purges-live-slice … (S2 no-window)"` — asserts `readDistilledFacts.length === 0` (`:194`).
3. `distiller-integration.daemon.test.ts:490` — `"smart forget-survives-re-derive (D12) …"` — asserts fact absent (`:513`, `:522`); comment `:506-509` explicitly relies on `dropDistilledFactsForThread`.
4. `hatch.daemon.test.ts:187` — `"T1.2(d) regression: WriteGate.forget(messageId) still tombstones and purges …"` — asserts fact absent (`:201`); the tombstone/scrub assertions (`:203-204`) stay valid.

**This is NOT a design fork** — these tests pin behavior Ruling 2 now forbids, so they reconcile the exact same way the two enumerated `write-gate` tests do (flip to "facts survive"). It IS under-enumeration in the frozen chunk, so it is folded into Step 1 below and flagged in the chunk file `## Notes`. Per PIPELINE §7.2 this reconciles to an already-accepted decision (Ruling 2) and is therefore in-scope to execute, not an escalation.

**No genuine spec-vs-code contradiction found** that would change the design. One consequence worth naming (not a fork): test #3's title (`… does NOT re-appear on re-dismiss`) inverts meaning — post-reconciliation the fact simply persists throughout (it was never dropped), which is Ruling 2 working. Rename it to reflect survival.

---

## Approaches

The spec forecloses most choices; one genuine implementation fork is worth recording.

**Fork: how `forgetThread` erases N messages.**

- **Option A — loop `WriteGate.forget(id)` N times.** Pros: maximal reuse. Cons: **rejected by the spec (§3.1 "alongside, not wrapping N calls of, the per-message forget")** and *impossible* correctly — each `forget` opens its own `db.transaction`, so N calls = N transactions = the ATOMIC-ERASE INVARIANT is violated (a crash mid-loop leaves a half-erased thread). It would also fire N `redactMirrorMessage` full-file rewrites and N `bumpThreadMarker` bumps (both explicitly unwanted).
- **Option B — one bespoke `db.transaction` reusing the per-message *mechanics* (tombstone INSERT + content scrub + `deleteMessageDerived`) inline over all messages, plus the status/audit/correction scrubs, then ONE `redactMirrorThread` pass + ONE `thread_forget` mirror line.** Pros: satisfies the atomic invariant, single mirror rewrite, no marker bump. Cons: some SQL duplicated from `forget` (acceptable — the shapes are frozen and identical).

**Chosen: Option B** — the only option consistent with §3.1's ATOMIC-ERASE INVARIANT and the "alongside, not wrapping" directive.

**Test-seam choices (spec §7 open-at-build, decided here):**
- *Atomicity fault-injection:* `spyOn(store, "deleteMessageDerived").mockImplementationOnce(() => { throw … })` to throw on the 2nd message inside the tx; assert `forgetThread` throws and the thread is fully un-erased. This is fault-injection on a real method (allowed), not a behavior-substituting mock.
- *Distill-no-op:* construct `SmartDistillerProvider({ client: <spy> })`; after `forgetThread`, call `distill` and assert the client spy was never invoked (the all-`REDACTION_MARKER` tail short-circuits before the LLM call at `smart-distiller-provider.ts:530-542`).
- *Drain-interleave:* deterministic construction (no timing) — `pendingMessageEmbeddings` scan → `forgetThread` → `upsertMessageEmbedding(id,…)` returns `"skipped"` via the in-tx re-check → assert zero `message_embeddings` rows for the thread. `EmbeddingProvider` fixture vectors for determinism.

## Chosen Approach

`WriteGate.forgetThread(threadId, ctx, reason?)` returns a typed discriminated result (never-throw for caller-input cases, gotcha #9); `MemoryStore.redactMirrorThread(threadId)` is the bulk mirror pass. Signatures the chunk-02 route will consume:

```ts
// write-gate.ts
export type ForgetThreadResult =
  | { ok: true }                                  // applied — incl. idempotent repeat
  | { ok: false; reason: "not_found" }            // unknown thread → route maps 404
  | { ok: false; reason: "refused_machine" };     // machine ctx → human-only by construction

forgetThread(threadId: string, ctx: WriteContext, reason?: string): ForgetThreadResult

// store.ts (MemoryStore)
redactMirrorThread(threadId: string): void
```

Note: the live-thread 409 guard and `isThreadLive` are chunk-02 (route layer), NOT here. Internal faults (disk/DB errors) propagate as throws (fail-loud) — only `not_found`/`refused_machine` are typed results.

## ADR worthy: no

Per spec §0.6 (recorded for sign-off, agreed by conductor; Lior signed the §0.1–0.6 package at §5.2). This chunk *executes* two already-accepted decisions: ADR-0015's retained hard-scrub primitive and ADR-0012 rider Ruling 2 (which names 2e and binds it). The §3.2 fact-sweep removal is *reconciliation to an already-accepted decision* (PIPELINE §7.2 lane), not a new decision. No new dependency, no new wire/protocol surface, no new boundary. Nothing to route to `adr-curator`.

---

## Steps

Three sequential tasks. Step 1 is RED-first reconciliation (the flipped tests MUST fail on pre-change code). Steps share the store/gate contract, so they are strictly sequential (no parallel lanes).

---

### Task 1: Ruling-2 reconciliation — remove the fact-sweep, flip the pinning tests (RED-first)

**Files:**
- Modify: `packages/daemon/src/memory/write-gate.ts` (remove `:104-112`; clean stale doc at `:133`)
- Modify: `packages/daemon/src/memory/store.ts` (delete `:786-797`)
- Modify: `packages/daemon/src/memory/schema.ts:43` (comment: add `'forgotten'` to the status enum note)
- Test (flip, RED-first): `packages/daemon/src/memory/write-gate.test.ts:64,80`
- Test (flip, RED-first — DRIFT): `packages/daemon/src/memory/distiller-integration.daemon.test.ts:137,173,490`; `packages/daemon/src/memory/hatch.daemon.test.ts:187`
- Test (delete, method-caller removal): `packages/daemon/src/memory/store.test.ts:80,91,1037,1045`; `packages/daemon/src/memory/embedding/embedding-storage.test.ts:125,136`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WriteGate.forget` no longer references any fact table; `store.dropDistilledFactsByProvenance` / `dropDistilledFactsForThread` no longer exist.

- [ ] **Step 1.1: Flip the six behavioral tests to pin facts-survive (RED gate).** In each, change the post-`gate.forget(...)` assertion from "fact purged" to "fact survives byte-identical," and rename the test to reflect Ruling 2. Exact edits:
  - `write-gate.test.ts:64` — rename to `"forget does NOT sweep the derived distilled_facts row (Ruling 2 — fact source-independence)"`; after `gate.forget(mid!, CTX, "user requested")` replace `expect(store.readDistilledFacts(10).length).toBe(0)` with `expect(store.readDistilledFacts(10).length).toBe(1)` and add `expect(store.readDistilledFacts(10)[0]!.fact).toBe("secret token abc")`.
  - `write-gate.test.ts:80` — rename to `"forget does NOT sweep a thread-level fact (Ruling 2)"`; replace `expect(store.readDistilledFacts(10).length).toBe(0)` with `expect(store.readDistilledFacts(10).length).toBe(1)`.
  - `distiller-integration.daemon.test.ts:137` — rename to `"forget-survives (Ruling 2): source-message forget leaves the derived fact live + still injectable"`; flip `:157` and `:162` `.toBe(false)` → `.toBe(true)`; flip `:166` `expect(slice.messages.some(m => m.content.includes("secret fact"))).toBe(false)` → `.toBe(true)`.
  - `distiller-integration.daemon.test.ts:173` — rename to `"forget-survives-live-slice (Ruling 2): distilled_facts row remains after forget"`; flip `:194` `.toBe(0)` → `.toBe(1)` (use `.length` equality, not `.toBe(0)`).
  - `distiller-integration.daemon.test.ts:490` — rename to `"smart forget-survives (Ruling 2): source-forget keeps the fact across a re-dismiss"`; flip `:513` and `:522` `.toBe(false)` → `.toBe(true)`; rewrite the `:506-509` comment to state Ruling 2 (no `dropDistilledFactsForThread` reference).
  - `hatch.daemon.test.ts:187` — rename to `"WriteGate.forget(messageId) tombstones + scrubs but does NOT sweep facts (Ruling 2)"`; flip `:201` `.toBe(false)` → `.toBe(true)`; keep `:203-204` (content === REDACTION_MARKER) as-is.

- [ ] **Step 1.2: Run the flipped tests — verify they FAIL on current code (RED evidence for the PR).**
  Run: `cd packages/daemon && bun test src/memory/write-gate.test.ts src/memory/distiller-integration.daemon.test.ts src/memory/hatch.daemon.test.ts`
  Expected: the six renamed tests FAIL (current `forget` still sweeps → facts gone → `length 1`/`.toBe(true)` assertions fail). Capture this output for the PR (chunk DoD "RED-first evidence").

- [ ] **Step 1.3: Remove the fact-sweep from `WriteGate.forget`.** In `write-gate.ts`, delete lines `104-112` (the trap comment block AND the two `this.store.dropDistilledFacts…` calls). Keep everything else in `forget` unchanged — the tombstone INSERT (`:80-82`), content scrub (`:83`), `deleteMessageDerived` (`:90`), `bumpThreadMarker` (`:96`), `redactMirrorMessage` (`:100`), `mirrorEvent` forget line (`:102`), and the N1 quarantine comment (`:113-115`) all stay. Also update the now-stale doc line `write-gate.ts:133` (in `forgetFact`'s JSDoc) — remove the `"DOES NOT call dropDistilledFactsByProvenance/dropDistilledFactsForThread — those are message-path"` sentence (the methods no longer exist; m3 no-silent-contradictions).

- [ ] **Step 1.4: Delete the caller-less store methods.** In `store.ts`, delete `dropDistilledFactsByProvenance` (`:784-789`) and `dropDistilledFactsForThread` (`:791-797`) in full (including their JSDoc). Leave `dropAllDistilledFacts` (`:799-807`) untouched — it has a live migration caller.

- [ ] **Step 1.5: Delete the now-uncompilable `drop*` tests; confirm sync-gate intent is already covered.** Delete these tests outright (their methods are gone; the fact-delete→derived-sync invariant they asserted is already independently covered by the existing `deleteFactById` sync-gate test at `store.test.ts:1030-1035` and the `deleteFactById` orphan-embeddings test at `embedding-storage.test.ts:118-122`):
  - `store.test.ts:80-89` (`dropDistilledFactsByProvenance removes only…`)
  - `store.test.ts:91-103` (`dropDistilledFactsForThread removes…`)
  - `store.test.ts:1037-1043` (`v2-02 SYNC GATE: dropDistilledFactsByProvenance…`)
  - `store.test.ts:1045-1051` (`v2-02 SYNC GATE: dropDistilledFactsForThread…`)
  - `embedding-storage.test.ts:125-134` (`dropDistilledFactsByProvenance leaves zero orphan…`)
  - `embedding-storage.test.ts:136-146` (`dropDistilledFactsForThread leaves zero orphan…`)
  Do NOT delete the neighboring `dropAllDistilledFacts` / `deleteFactById` sync tests. (The positive "thread-forget never touches fact tables" assertion is added in Task 2's headline test — that is where the count-invariant *intent* migrates.)

- [ ] **Step 1.6: Update the schema status comment.** In `schema.ts:43`, change `status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'dismissed'` to `-- 'active' | 'dismissed' | 'forgotten' (2e thread-forget)`.

- [ ] **Step 1.7: Run tests + grep — verify GREEN and zero non-comment `dropDistilledFacts` hits.**
  Run: `cd packages/daemon && bun test src/memory/` then `grep -rn dropDistilledFacts packages/ apps/`
  Expected: full memory suite GREEN (the six flipped tests now pass; the six deleted tests are gone). Grep returns zero hits (comments cleaned too, so even non-comment filter is moot).

- [ ] **Step 1.8: Commit** (on the existing branch `chunk/01-forget-thread-primitive` — do NOT create a new branch).

---

### Task 2: `forgetThread` + `redactMirrorThread` — the one-tx scrub with zero fact touches

**Files:**
- Modify: `packages/daemon/src/memory/store.ts` (add `redactMirrorThread`)
- Modify: `packages/daemon/src/memory/write-gate.ts` (add `ForgetThreadResult` + `forgetThread`)
- Test: `packages/daemon/src/memory/write-gate.test.ts` (new `forgetThread` suite)

**Interfaces:**
- Consumes: `store.threadExists` (`store.ts:257`), `store.deleteMessageDerived` (`store.ts:1644`, tx-less), `store.mirrorEvent` (`store.ts:1028`), `store.rawDb()`, `REDACTION_MARKER`.
- Produces: `WriteGate.forgetThread(threadId, ctx, reason?) → ForgetThreadResult`; `MemoryStore.redactMirrorThread(threadId): void`. Chunk-02 consumes both.

- [ ] **Step 2.1: Write the failing headline + completeness tests first.** Add to `write-gate.test.ts` (reuse the `fresh()` helper at `:10-14`). Seed via the real store primitives so fts/topics/embeddings counts are real. Use raw-SQL snapshots for byte-identity.

```ts
// ── THE RULING-2 HEADLINE (facts survive a whole-thread forget) ──
test("forgetThread does NOT touch facts — every distilled_facts row byte-identical (Ruling 2)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "my name is Lior" }], "s1", CTX);
  // one machine fact + one human-edited fact, both provenance = this thread
  const fMachine = store.insertFact({ fact: "user's name is Lior", provenance: mid!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", canonical: "name lior", topics: ["identity"] }, "smart");
  const fHuman = store.insertFact({ fact: "prefers TypeScript", provenance: `thread:${t}`, scope: "global", expiry: null, confidence: 1, authored_by: "human", canonical: "prefers typescript", topics: ["prefs"] }, "smart");
  const db = store.rawDb();
  const snap = (sql: string) => JSON.stringify(db.query(sql).all());
  const factsBefore = snap("SELECT id, fact, authored_by, provenance FROM distilled_facts ORDER BY id");
  const ftsBefore = snap("SELECT fact_id, canonical, topic FROM fact_fts ORDER BY fact_id");
  const topicsBefore = snap("SELECT fact_id, topic FROM fact_topics ORDER BY fact_id, topic");
  const forgottenBefore = snap("SELECT * FROM forgotten_facts ORDER BY id");

  const res = gate.forgetThread(t, CTX, "user erased conversation");
  expect(res).toEqual({ ok: true });

  expect(snap("SELECT id, fact, authored_by, provenance FROM distilled_facts ORDER BY id")).toBe(factsBefore);
  expect(snap("SELECT fact_id, canonical, topic FROM fact_fts ORDER BY fact_id")).toBe(ftsBefore);
  expect(snap("SELECT fact_id, topic FROM fact_topics ORDER BY fact_id, topic")).toBe(topicsBefore);
  expect(snap("SELECT * FROM forgotten_facts ORDER BY id")).toBe(forgottenBefore);
  // the surviving fact still injects into a NEW thread's slice
  // (reuse the beginTurn/ retrieve pattern — worker: mirror distiller-integration.daemon.test.ts:219-222)
  store.close();
});

// ── ERASURE-COMPLETENESS MATRIX (§3.1 table) ──
test("forgetThread scrubs content, vectors, fts, corrections, audit, husk — all in one pass", () => {
  const { store, gate, dir } = fresh();
  const t = store.createThread();
  const [m1] = gate.appendTurn(t, [{ role: "user", content: "secret one" }], "s1", CTX);
  const [m2] = gate.appendTurn(t, [{ role: "assistant", content: "secret two" }], "s1", CTX);
  gate.edit(m1!, "corrected secret", CTX, "fix"); // legacy correction plaintext in mutations
  // audit-trail row for this thread (memory_action_events)
  store.rawDb().query("INSERT INTO memory_action_events (id, thread_id, action, outcome, fact_text, actor, created_at) VALUES (?, ?, 'forget', 'applied', 'quoted content', 'agent', ?)").run(crypto.randomUUID(), t, Date.now());

  const res = gate.forgetThread(t, CTX);
  expect(res).toEqual({ ok: true });
  const db = store.rawDb();
  // every message content == marker
  const contents = db.query("SELECT content FROM messages WHERE thread_id = ?").all(t) as {content:string}[];
  expect(contents.every(c => c.content === REDACTION_MARKER)).toBe(true);
  // one tombstone per message
  const tombs = db.query("SELECT COUNT(*) AS n FROM mutations WHERE kind='tombstone' AND target_message_id IN (SELECT id FROM messages WHERE thread_id=?)").get(t) as {n:number};
  expect(tombs.n).toBe(2);
  // zero message_embeddings / message_fts for the thread
  expect((db.query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id IN (SELECT id FROM messages WHERE thread_id=?)").get(t) as {n:number}).n).toBe(0);
  expect((db.query("SELECT COUNT(*) AS n FROM message_fts WHERE message_id IN (SELECT id FROM messages WHERE thread_id=?)").get(t) as {n:number}).n).toBe(0);
  // correction plaintext scrubbed, row kept
  const corr = db.query("SELECT replacement_content FROM mutations WHERE kind='correction' AND target_message_id=?").get(m1!) as {replacement_content:string};
  expect(corr.replacement_content).toBe(REDACTION_MARKER);
  // audit fact_text scrubbed, row kept
  const aud = db.query("SELECT fact_text, action, outcome FROM memory_action_events WHERE thread_id=?").get(t) as {fact_text:string;action:string;outcome:string};
  expect(aud.fact_text).toBe(REDACTION_MARKER);
  expect(aud.action).toBe("forget"); expect(aud.outcome).toBe("applied");
  // husk
  const th = db.query("SELECT status, title FROM threads WHERE thread_id=?").get(t) as {status:string;title:string|null};
  expect(th.status).toBe("forgotten"); expect(th.title).toBeNull();
  // mirror: no plaintext in message OR edit lines, plus a thread_forget event line
  const mirror = readFileSync(join(dir, "threads", `${t}.jsonl`), "utf8");
  expect(mirror).not.toContain("secret one");
  expect(mirror).not.toContain("secret two");
  expect(mirror).not.toContain("corrected secret");
  expect(mirror).toContain(REDACTION_MARKER);
  expect(mirror).toContain("thread_forget");
  store.close();
});

// ── typed results ──
test("forgetThread returns not_found for an unknown thread (never-throw)", () => {
  const { store, gate } = fresh();
  expect(gate.forgetThread("no-such-id", CTX)).toEqual({ ok: false, reason: "not_found" });
  store.close();
});
test("forgetThread refuses a machine ctx outright (content-erase is human-only)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "x" }], "s1", CTX);
  expect(gate.forgetThread(t, { actor: "agent", authored_by: "machine" })).toEqual({ ok: false, reason: "refused_machine" });
  // nothing erased
  expect((store.rawDb().query("SELECT content FROM messages WHERE thread_id=?").get(t) as {content:string}).content).toBe("x");
  store.close();
});

// ── idempotence ──
test("forgetThread is idempotent — second call adds no tombstones, still ok", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "a" }], "s1", CTX);
  gate.appendTurn(t, [{ role: "user", content: "b" }], "s1", CTX);
  expect(gate.forgetThread(t, CTX)).toEqual({ ok: true });
  const count = () => (store.rawDb().query("SELECT COUNT(*) AS n FROM mutations WHERE kind='tombstone'").get() as {n:number}).n;
  const after1 = count();
  expect(gate.forgetThread(t, CTX)).toEqual({ ok: true });
  expect(count()).toBe(after1); // no new tombstones
  store.close();
});

// ── atomicity (fault injection) ──
test("forgetThread is all-or-nothing — a mid-tx fault leaves the thread fully un-erased", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "keep one" }], "s1", CTX);
  gate.appendTurn(t, [{ role: "user", content: "keep two" }], "s1", CTX);
  const spy = spyOn(store, "deleteMessageDerived").mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error("injected mid-tx fault"); });
  expect(() => gate.forgetThread(t, CTX)).toThrow("injected mid-tx fault");
  spy.mockRestore();
  const db = store.rawDb();
  const contents = db.query("SELECT content FROM messages WHERE thread_id=?").all(t) as {content:string}[];
  expect(contents.map(c => c.content).sort()).toEqual(["keep one", "keep two"]); // un-erased
  expect((db.query("SELECT COUNT(*) AS n FROM mutations WHERE kind='tombstone'").get() as {n:number}).n).toBe(0);
  expect((db.query("SELECT status FROM threads WHERE thread_id=?").get(t) as {status:string}).status).toBe("active");
  store.close();
});
```
  *Worker note:* import `spyOn` from `bun:test` (already imported in `store.test.ts:1`; add to `write-gate.test.ts` imports). If `insertFact`'s `InsertFactInput` shape differs, match the real signature at `store.ts:1073` (fields: `fact, provenance, scope, expiry, confidence, authored_by, canonical, topics`). For message embeddings in the completeness test, seed a fixture vector via `store.upsertMessageEmbedding(id, MODEL, DIMS, vec)` before the forget (mirror `embedding-storage.test.ts` fixture helpers) so the "zero rows after" assertion is meaningful. All snapshot SQL / column names above are the architect's best-read of the schema — the worker verifies each against `schema.ts` and adapts if a column name differs.

- [ ] **Step 2.2: Run the new tests — verify they FAIL (methods don't exist yet).**
  Run: `cd packages/daemon && bun test src/memory/write-gate.test.ts`
  Expected: FAIL — `gate.forgetThread is not a function` / `store.redactMirrorThread is not a function`.

- [ ] **Step 2.3: Implement `redactMirrorThread` in `store.ts`.** Add next to `redactMirrorMessage` (after `store.ts:1059`). One pass, redact `message`→`content` and `edit`→`replacement`, preserve everything else (incl. unparseable), missing file = no-op, do NOT delete the file:

```ts
/**
 * Bulk mirror scrub for a whole-thread forget (spec §3.1a). ONE read-parse-rewrite pass
 * over the per-thread JSONL: every `event:"message"` line's `content` AND every
 * `event:"edit"` line's `replacement` become REDACTION_MARKER. All other lines are
 * preserved (append-only audit intent); unparseable lines are left intact (matches
 * redactMirrorMessage). Missing file → no-op. The file is NEVER deleted (rows-stay/
 * content-goes, same as the DB). DB-first ordering: call this AFTER the scrub tx commits.
 */
redactMirrorThread(threadId: string): void {
  const mirrorPath = join(this.threadsDir, `${threadId}.jsonl`);
  if (!existsSync(mirrorPath)) return;
  const lines = readFileSync(mirrorPath, "utf8").split("\n");
  const rewritten = lines.map((line) => {
    if (!line) return line; // preserve trailing newline's empty string
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return line; // unparseable — leave intact
    }
    if (parsed["event"] === "message") return JSON.stringify({ ...parsed, content: REDACTION_MARKER });
    if (parsed["event"] === "edit") return JSON.stringify({ ...parsed, replacement: REDACTION_MARKER });
    return line;
  });
  writeFileSync(mirrorPath, rewritten.join("\n"));
}
```
  *Worker note:* verify the real field name for the threads-dir (`this.threadsDir`) and the mirror filename pattern against `redactMirrorMessage` (`store.ts:1041-1059`) — reuse whatever it uses exactly. Confirm `existsSync`/`readFileSync`/`writeFileSync`/`join` are already imported in `store.ts`.

- [ ] **Step 2.4: Implement `ForgetThreadResult` + `forgetThread` in `write-gate.ts`.** Add the type near `WriteContext` (after `:20`) and the method after `forget` (after `:116`):

```ts
export type ForgetThreadResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "refused_machine" };

/**
 * forgetThread — content-erase a WHOLE conversation in ONE atomic tx (spec §3.1).
 * ZERO fact-table touches (ADR-0012 rider Ruling 2 — facts are source-independent;
 * structural, like ADR-0015 B1). NO bumpThreadMarker (§3.1 [critic m5] — 'forgotten'
 * is terminal). Human-only by construction (defense-in-depth mirror of editFact's
 * machine refusal, write-gate.ts:222). Idempotent: already-tombstoned messages are
 * skipped; a second call is a no-op that still returns { ok: true }.
 */
forgetThread(threadId: string, ctx: WriteContext, reason?: string): ForgetThreadResult {
  if (ctx.authored_by === "machine") return { ok: false, reason: "refused_machine" };
  if (!this.store.threadExists(threadId)) return { ok: false, reason: "not_found" };
  const db = this.store.rawDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    // not-yet-tombstoned messages only (idempotence)
    const rows = db.query(
      `SELECT m.id AS id FROM messages m
        WHERE m.thread_id = ?
          AND NOT EXISTS (SELECT 1 FROM mutations x WHERE x.target_message_id = m.id AND x.kind = 'tombstone')`,
    ).all(threadId) as { id: string }[];
    const insTomb = db.query(
      "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'tombstone', ?, ?, NULL, ?, ?)",
    );
    const scrub = db.query("UPDATE messages SET content = ? WHERE id = ?");
    for (const { id } of rows) {
      insTomb.run(crypto.randomUUID(), id, ctx.actor, reason ?? null, ctx.authored_by, now);
      scrub.run(REDACTION_MARKER, id);
      // tx-less by design (store.ts:1644) — commits with THIS tx (no nested tx; bun:sqlite forbids it)
      this.store.deleteMessageDerived(id);
    }
    // husk (q#019 rider 1): status flip + defensive title scrub (no future content-derived title survives)
    db.query("UPDATE threads SET status = 'forgotten', title = NULL WHERE thread_id = ?").run(threadId);
    // §0.4 audit-trail scrub (rows KEPT — action/outcome/actor/timestamps survive)
    db.query("UPDATE memory_action_events SET fact_text = ? WHERE thread_id = ?").run(REDACTION_MARKER, threadId);
    // [critic MAJOR-2] legacy correction-plaintext scrub (COALESCE read would resurface it)
    db.query(
      `UPDATE mutations SET replacement_content = ?
        WHERE kind = 'correction'
          AND target_message_id IN (SELECT id FROM messages WHERE thread_id = ?)`,
    ).run(REDACTION_MARKER, threadId);
  });
  tx(); // ATOMIC-ERASE INVARIANT: all writes above commit together or not at all
  // DB-first ordering (write-gate.ts:92-102): mirror is the sole post-tx step (§3.1a crash window accepted)
  this.store.redactMirrorThread(threadId);
  this.store.mirrorEvent(threadId, { event: "thread_forget", actor: ctx.actor, created_at: now });
  return { ok: true };
}
```
  *Worker note:* verify every column name in the INSERT/UPDATE statements against the real `schema.ts` (`mutations` columns, `memory_action_events` columns, `threads` PK column name — the reality check says PK is `thread_id`, confirm). Match the exact `mutations` INSERT column list the per-message `forget` uses (`write-gate.ts:80-82`) so the tombstone shape is identical. Confirm `crypto.randomUUID()` is how ids are minted elsewhere in this file.

  *Structural Ruling-2 check the worker must self-verify:* the method body contains NO token `distilled_facts`, `forgotten_facts`, `fact_fts`, `fact_topics`, `fact_embeddings`, `dropDistilledFacts`, `bumpThreadMarker`.

- [ ] **Step 2.5: Run the Task-2 tests — verify GREEN.**
  Run: `cd packages/daemon && bun test src/memory/write-gate.test.ts`
  Expected: PASS (headline, completeness, not_found, refused_machine, idempotence, atomicity all green).

- [ ] **Step 2.6: Commit** (existing branch).

---

### Task 3: Race/no-op coverage + full-gate verification

**Files:**
- Test: `packages/daemon/src/memory/write-gate.test.ts` (or a new `forget-thread.daemon.test.ts` for the distiller/drain integration cases — worker's choice; use `.daemon.test.ts` suffix if it needs `ConsolidationHook`/providers, matching the existing convention).

**Interfaces:**
- Consumes: `SmartDistillerProvider({ client })`, `store.pendingMessageEmbeddings`, `store.upsertMessageEmbedding`, `ConsolidationHook`, `DumbTailProvider`.
- Produces: no new production code (this task is proof-of-contract; if a test reveals a real defect, fix it and note it).

- [ ] **Step 3.1: Write the distill-no-op test (zero ops, NO LLM call).** Spy on the LLM client; prove the all-`REDACTION_MARKER` tail short-circuits before the client call:

```ts
test("distill over an erased thread is a no-op — zero ops, no LLM call", async () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "will be erased" }], "s1", CTX);
  const spyClient = { /* shape matches the SmartDistiller client iface */ };
  const complete = spyOn(spyClient, "complete" /* or the real method name */);
  const smart = new SmartDistillerProvider({ client: spyClient });
  gate.forgetThread(t, CTX);                       // tombstones + scrubs every message
  const delta = await smart.distill(store, t);     // all-[forgotten] tail → filtered empty → short-circuit
  expect(delta.ops).toEqual([]);
  expect(complete).not.toHaveBeenCalled();         // no LLM call (smart-distiller-provider.ts:530-542)
  store.close();
});
```
  *Worker note:* read `providers/smart-distiller-provider.ts` constructor + the client method name it calls; wire the spy to that exact method. If a real echo-stub helper (`makeEchoStub`) already exists in `distiller-integration.daemon.test.ts`, wrap it with `spyOn` on the invoked method rather than hand-rolling the client shape. Match `distill`'s real return shape (`delta.ops` vs whatever it returns).

- [ ] **Step 3.2: Write the drain-interleave test (thread-scale scrub-race, deterministic — 2d D3b pattern).**

```ts
test("scrub between drain scan and upsert → zero vector rows survive (drain-race, thread-scale)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [m1] = gate.appendTurn(t, [{ role: "user", content: "vec me one" }], "s1", CTX);
  const [m2] = gate.appendTurn(t, [{ role: "user", content: "vec me two" }], "s1", CTX);
  const MODEL = "test-model"; const DIMS = 2; const vec = new Uint8Array([1, 2, /* … DIMS*4 bytes for f32 */]);
  const pending = store.pendingMessageEmbeddings(MODEL, 100); // scan sees both, pre-scrub
  expect(pending.map(p => p.id).sort()).toEqual([m1!, m2!].sort());
  gate.forgetThread(t, CTX);                                   // scrub lands AFTER the scan
  for (const p of pending) {
    expect(store.upsertMessageEmbedding(p.id, MODEL, DIMS, vec)).toBe("skipped"); // in-tx re-check refuses
  }
  const n = (store.rawDb().query("SELECT COUNT(*) AS n FROM message_embeddings WHERE message_id IN (SELECT id FROM messages WHERE thread_id=?)").get(t) as {n:number}).n;
  expect(n).toBe(0);
  store.close();
});
```
  *Worker note:* match the real vector byte-width the store expects (read `embedding-storage.test.ts` for `DIMS`/`vec()` fixture helper; reuse it). Match the real return contract of `upsertMessageEmbedding` (the reality check says it returns a status string incl. `"skipped"` — verify at `store.ts:1624-1639`) and the real shape of `pendingMessageEmbeddings` rows (`p.id` field name).

- [ ] **Step 3.3: Run the new tests — verify GREEN.**
  Run: `cd packages/daemon && bun test src/memory/`
  Expected: PASS. (If either test reveals a real defect in a shared path, apply `superpowers:systematic-debugging`, fix, and note it in the PR — do not weaken the assertion.)

- [ ] **Step 3.4: Full-gate verification.**
  Run: `bun test` (repo root) · `bun run lint:strict` · typecheck (project's tsc command) · `git diff --stat`
  Expected: all tests green; lint:strict 0 errors; typecheck clean; `git diff --stat` shows changes ONLY under `packages/daemon/src/memory/` (frozen surfaces `@agentic/protocol` + mock reducer byte-unchanged). Confirm `grep -rn dropDistilledFacts packages/ apps/` still returns zero.

- [ ] **Step 3.5: Commit** (existing branch).

---

## Self-review (spec coverage)

- **§3.2 fact-sweep removal + flipped tests (RED-first) + `drop*` deletion** → Task 1 (incl. the 4 DRIFT tests the chunk under-enumerated).
- **§3.1 `forgetThread`** — one tx, tombstone+scrub+`deleteMessageDerived`, status/title husk, audit scrub, correction scrub, machine refusal, not_found, idempotence, NO marker bump, structural Ruling-2 → Task 2.
- **§3.1a `redactMirrorThread`** — bulk message+edit redaction, preserve/unparseable/missing-file, no delete, post-tx + `thread_forget` line, DB-first → Task 2.
- **§5 tests** — headline (Ruling 2), completeness matrix, atomicity, idempotence, typed results → Task 2; distill-no-op (spy, zero LLM), drain-interleave → Task 3.
- **Scope OUT** (HTTP/Hatch/`isThreadLive`/409, UI, `beginTurn` erased-id exclusion, startup mirror-reconcile, deleting facts) — correctly absent; deferred to chunks 02/03 per §6/§7.2.
