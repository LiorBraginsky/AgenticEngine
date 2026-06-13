# Plan — chunk v2-04: forget simplification (fact-forget ONLY, durable delete) + end-to-end probe

## Status: review-complete — ready-to-merge (crawl §11.4: Jimmy re-verifies clean checkout + merges; orchestrator no self-merge)

> Feature: memory-quality (memory-distiller-v2). Chunk file:
> `orchestration/chunks-todo/memory-quality/v2-04-forget-simplification-and-probe.md`.
> Spec: `orchestration/docs/specs/2026-06-13-memory-distiller-v2.md` §3.6/§3.7/§5/§6/§7.

---

## Orchestrator rulings (resolving the architect's two open items)

### Ruling 1 — `forgotten_facts` (a)/(b) call: ACCEPT (b)-with-dormant-substrate
The architect's call stands and is the call recorded in the PR:
**(b) — DROP the per-dismiss re-derivation-suppression machinery** (`forgetFact`'s
`forgotten_facts` write + `purgeLiveMachineFactsByForget`; the read-side
`buildForgottenNormSet`/`keepRow`/`suppressForgottenMachineRows`; the `retrieve()`
`isForgottenNormalizedText` filter); **RETAIN the `forgotten_facts` TABLE + its low-level
store primitives** (`recordForgottenFact`/`readForgottenFacts`/`isForgottenNormalizedText`/
`clearForgottenByNormalizedText`/`hasHumanFactWithNormalizedText`) as **inert, dormant
v2-05 replay-safety substrate** (§3.8 optional ordered-replay Layer-T), commented as such.
Rationale: under incremental + stable-id + watermark, a durably-deleted fact is **not
re-derived on a normal dismiss**, so the suppression defends a resurrection that can no
longer happen — keeping it live is the silent contradiction D-V6b forbids. Dropping the
*table* would be an out-of-scope schema change that forecloses v2-05's optional replay.
Spec basis: D-V6b ("v2-04 DECIDES and STATES … either (a) replay-safety or (b) drop") +
§3.8 (migration default leans "wipe + re-distill forward"). **Not a §5.2 gate / not new
scope** — the spec delegated this exact call to v2-04 architect-time.

### Ruling 2 — `Hatch.forgetMessage`: REMOVE it (override the architect's "keep the seam")
The architect flagged whether to keep `Hatch.forgetMessage` as an internal seam. **Orchestrator
decision: remove `Hatch.forgetMessage` too** (not just the HTTP `target_type:"message"` branch).
- §7.2 citation test: the DoD is silent on `Hatch.forgetMessage`, so both choices pass the DoD
  literally → the choice is **DoD-neutral and cheap to reverse**. The chunk's explicit keep-list
  names **only** `WriteGate.forget` (the MF-05 *primitive*) + **its unit tests**; the chunk says
  the user-facing forget "**collapses to one user path**" and to "remove the `target_type:"message"`
  user route **in `http-routes.ts`/`hatch.ts`**". `Hatch.forgetMessage` is the routing wrapper of
  that dropped path, not the primitive.
- Removing it avoids leaving an **unreferenced dead method** (the HTTP route was its only caller),
  which a reviewer would flag. `WriteGate.forget` + its `write-gate.test.ts` unit tests stay fully
  intact (the chunk's explicit requirement) — the mechanism survives for the future THREAD-forget,
  which will add its own thread-level wrapper (not per-message).
- **Worker directive:** in Step 2.3/2.4, DELETE `Hatch.forgetMessage` (and redirect/drop the
  `hatch.daemon.test.ts` `forgetMessage` test to the kept `WriteGate.forget` unit tests in
  `write-gate.test.ts`). Add a one-line comment at `WriteGate.forget` noting it is retained for the
  future THREAD-forget with no current caller. Keep `WriteGate.forget` + `write-gate.test.ts`
  message-primitive tests byte-intact otherwise.

> Both rulings are cheap-to-reverse, DoD-neutral or spec-delegated; no bus escalation, no §5.2 gate.

---

## (Architect plan follows — content authored by engine-architect, persisted by orchestrator)

**Goal:** Make fact-forget the user's ONLY forget handle (durable delete of the stable-id row),
remove option B and the per-message message-forget user path end-to-end, decide the
`forgotten_facts` fate (see Ruling 1), and ship an EXECUTED `history.html → HTTP → Hatch`
durable-delete probe.

**Architecture:** v2-03 already gave facts stable ids, a delta-apply path, `deleteFactById`, and
an `AFTER DELETE ON distilled_facts` trigger that keeps `fact_fts`/`fact_topics` in sync. v2-04 is
a *subtraction* chunk: it removes the source-coupling (option B), the per-message user path, and
the read-side re-derivation-suppression machinery that is now dead — while keeping the
`WriteGate.forget` hard-scrub primitive for the future THREAD-forget.

**Tech stack:** TypeScript on Bun, `bun:sqlite`, `bun test`, plain-string `history.html`.

### Reality check (post-v2-03 source; behavioral claims need runtime demo)
- `hatch.ts` — `forgetMessage`/`forgetFact`/`forgetFactAndSources` + `view`/`edit`.
- `write-gate.ts` — `forget` (HARD-scrub PRIMITIVE, KEEP), `forgetFact` (→ `recordForgottenFact` +
  `purgeLiveMachineFactsByForget`; rewrite to durable delete), `forgetFactAndSources` (option B, REMOVE).
- `store.ts` — `deleteFactById` (trigger-backed durable delete = the v2-04 primitive);
  `forgotten_facts` read/write surface; `countFactsFedByMessages` (cofed, REMOVE); read-side
  suppression `buildForgottenNormSet`/`keepRow`/`suppressForgottenMachineRows` (REMOVE per Ruling 1);
  `dropDistilledFactsByProvenance`/`dropDistilledFactsForThread` (KEEP — used by the kept primitive);
  `tombstoneFact` UUID-guard (KEEP — message-path defensive seam).
- `providers/smart-distiller-provider.ts` — `distill()` no longer references `forgotten_facts`
  (v2-03 removed the dead post-filters); `retrieve()` STILL filters `isForgottenNormalizedText`
  (REMOVE per Ruling 1) + `isFactTombstoned` (KEEP).
- `http-routes.ts` — `handleForget` dispatch on `target_type`; `handleCofed` + `GET /memory/cofed`
  route (REMOVE); `mapWriteError` UUID-guard regex (KEEP).
- `history-page.ts` — per-message "Forget" button (REMOVE); "Forget fact" button (KEEP/adapt);
  option-B "⚠ also delete N source message(s)" button + `doForgetFactAndSources` (REMOVE);
  provenance `metaEl` (KEEP — the READ affordance).
- `scripts/forget-roundtrip-probe.ts` — exists; current premise (re-derivation → suppression) +
  path (direct Hatch) are wrong for v2-04 → rewrite to HTTP durable-delete.
- `schema.ts` — `forgotten_facts`/`fact_topics`/`fact_fts`/`trg_distilled_facts_ad` all exist;
  **NOT in scope to change** (migration/table-drop is v2-05).
- Frozen-surface: `target_type`/`also_forget_sources`/`cofed` are HTTP-body/route additions, never
  on the `@agentic/protocol` wire or in `mock-agent.ts` → removal is an HTTP-surface reduction;
  frozen surfaces stay byte-unchanged (confirm with `git diff` at verification).

### Steps (TDD RED→GREEN; real SQLite; only LLM stub; commit-per-task on `chunk/v2-04-forget-simplification`)

**Task 1 — fact-forget = durable delete + retire the per-dismiss suppression machinery**
- 1.1 (RED) `write-gate.test.ts` durable-delete test: seed thread+message, `insertDistilledFacts`
  a machine fact, capture id, `gate.forgetFact(...)`; assert row GONE,
  `COUNT(fact_fts)===COUNT(distilled_facts)` + no orphan `fact_topics`, `readForgottenFacts().length===0`,
  `messages.content` byte-intact. FAIL today.
- 1.2 (GREEN) Rewrite `WriteGate.forgetFact` to resolve matching live machine rows
  (`authored_by != 'human'` AND provenance-match OR `normalizeFactText`-match) and
  `store.deleteFactById(id)` per match (trigger cleans derived rows); NO `recordForgottenFact`; NO
  `messages`/`mutations` touch. Add `store.deleteMachineFactsByForget(provenance, normalizedText): number`
  (resolve-and-`deleteFactById` loop in one `db.transaction`, 5e human guard preserved); delete
  `purgeLiveMachineFactsByForget`. Update doc comment.
- 1.3 (GREEN) Delete `WriteGate.forgetFactAndSources`; remove the dead `edit()` un-forget block
  (`clearForgottenByNormalizedText` call) — keep the store method dormant.
- 1.4 (GREEN) Delete `buildForgottenNormSet`/`keepRow`/`suppressForgottenMachineRows` + their call
  sites in `readDistilledFacts`/`readDistilledFactsForThread`; delete `countFactsFedByMessages`; drop
  `retrieve()`'s `isForgottenNormalizedText` clause (keep `isFactTombstoned`). Comment the retained
  `forgotten_facts` primitives "dormant — v2-05 optional ordered-replay Layer-T; no live consumer".
- 1.5 (GREEN) Update/remove stale `store.test.ts` + `write-gate.test.ts` tests (suppression,
  cofed, option-B, edit-un-forget) → replace with durable-delete assertions. Keep `WriteGate.forget`
  (message primitive) tests UNTOUCHED.
- 1.6 (RED→GREEN) Named carried-B1 gate test `"B1: fact-forget touches neither messages nor mutations"`.
- 1.7 Commit.

**Task 2 — remove option B + per-message user path from HTTP + Hatch (Ruling 2: remove `forgetMessage`)**
- 2.1 (RED) `http-routes.daemon.test.ts`: `target_type=message → 400`; `GET /memory/cofed → 404`;
  `fact` with `also_forget_sources:true` behaves as plain fact-forget (204, source intact). FAIL today.
- 2.2 (GREEN) `handleForget` fact-only (message branch → 400; drop `also_forget_sources`; always
  `forgetFact`); remove `GET /memory/cofed` route + `handleCofed`. Keep `mapWriteError` regex.
- 2.3 (GREEN) Delete `Hatch.forgetFactAndSources` **AND `Hatch.forgetMessage`** (Ruling 2); update
  the class doc to ONE user op (`forgetFact`); note `WriteGate.forget` is the retained primitive
  reached by the future THREAD-forget.
- 2.4 (GREEN) `hatch.daemon.test.ts`: remove `forgetFactAndSources` + `forgetMessage` tests (the
  latter's coverage lives in `write-gate.test.ts`'s kept `WriteGate.forget` unit tests); adjust the
  `forgetFact` test to durable-delete. Remove `http-routes.daemon.test.ts` message-success + cofed tests.
- 2.5 Commit.

**Task 3 — strip dead history.html controls + rewrite the EXECUTED durable-delete probe**
- 3.1 Strip `renderMessages` per-message Forget button; strip `renderFacts` option-B button +
  `doForgetFactAndSources`; keep "Forget fact" button + provenance `metaEl`. Grep clean:
  `cofed|also_forget_sources|doForgetFactAndSources|target_type: "message"` → nothing.
- 3.2 (GREEN) Confirm `GET /history.html` still serves (existing test).
- 3.3 Rewrite `forget-roundtrip-probe.ts`: `mkdtemp` dataDir; pre-seed thread+message+machine fact
  (provenance=msgId), capture id, close; `startDaemon(0)`; read disk token; POST the EXACT `doForget`
  request `{target_type:"fact", fact_text, provenance, reason}` with `Authorization: Bearer <token>`;
  assert 204; reopen store / `GET /memory/thread/:id` → row GONE, count-equality, no orphan,
  `messages.content` byte-intact, fact absent (durable, no resurrection). `PROBE PASSED` banner;
  `exit(1)` on failure. Strike-5: orchestrator RUNS it, stdout → PR.
- 3.4 Commit.

**Final verification (orchestrator-run; gates the PR):** V1 `bun test` exit 0 · V2 `lint:strict`+typecheck
exit 0 · V3 frozen `git diff` empty (`@agentic/protocol`, `mock-agent.ts`) · V4 probe RUN `PROBE PASSED`
(stdout in PR) · V5 the (b)-with-dormant-table call recorded in PR + no live `forgotten_facts` per-dismiss
consumer remains.

## ADR worthy: NO
Realizes already-accepted ADR-0015 (decision 5 SUPERSEDED banner already present) + ADR-0012 amendment
(ACCEPTED §5.2/PR #61) + the spec. Removals are spec-mandated subtraction; the (a)/(b) call is
spec-delegated to this chunk (recorded in PR, not a new ADR). No new boundary. **Do NOT edit
ADR-0012/ADR-0015** (immutable; banners present; the `proposed` header on ADR-0012 is a known
DOC-HYGIENE flag owned by adr-curator/Lior, out of scope here).
