# Plan — chunk v2-07: prompt-quality (recall-usage + over-correction) + distiller dedup + hard-review cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. All paths are repo-relative to `/Users/lior/WebstormProjects/playground/AgenticEngine`.

**Goal:** Land the LAST v2 fix chunk — strengthen the reply prompt so the agent reliably USES injected `[remembered]` facts (A′), make duplicate-fact-from-a-question impossible via two deterministic layers (E: distiller-statement-only prompt + a code-level dedup guard), de-over-generalize the cannot-self-forget prompt (over-correction), and close the 4 owed v2-06 hard-review items.

**Architecture:** Mostly prompt edits + one deterministic code-level dedup guard in the distiller apply loop + tests + an HTTP route-validation tighten. Build ON the stacked `chunk/v2-06-debug-env-and-demo-fixes` branch (keeps v2-05 flip + v2-06 fixes + MEMORY_DEBUG + the harness + `forgetFactById`). The dedup guard lives in `distiller-registration.ts`'s Phase-3 apply loop (the single choke point where new/append ops are materialized), so it is provider-agnostic and deterministically assertable. Prompts (A′, E-a, over-correction) are LLM-fuzzy and verified by the harness in real mode + Lior's live demo, NOT a hard 1/1 gate.

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (real, never mocked); `@anthropic-ai/sdk` (Haiku — only `clientFactory` stubbed); WS + HTTP over the real `startDaemon`. No new dependency.

**Branch:** continue on `chunk/v2-07-prompt-quality-dedup-cleanup` (stacked off `chunk/v2-06-debug-env-and-demo-fixes`). On demo-green the conductor merges this to `main` (brings v2-05 + v2-06 + v2-07), closes PR #67/#68 subsumed.

---

## Status: Done (plan ready for worker execution; behavioral DoD pending Lior §6.1 live re-demo)

---

## Reality check

Every claim below is grounded in file evidence read by the architect. **Behavioral/runtime claims are flagged "requires runtime demo to confirm" (PIPELINE §6.1) — never asserted "verified" from code-reading. Prior PASS records and the harness are NECESSARY-not-SUFFICIENT (the route lied 5× / falsified 3× in v0).**

### Which findings are DETERMINISTIC vs LLM-FUZZY (drives the DoD split)
- **DETERMINISTIC (hard gates):** E-b dedup guard (code-level; asserted in `bun test` + harness stub), cleanup items (1) human-delete 5a/5e, (3) HTTP forget requires `fact_id`, (4) whenIdle timeout branch + overlapping-dismiss integration test.
- **LLM-FUZZY (reliability-reported, NOT 1/1):** A′ recall-usage prompt, E-a distiller-statement-only prompt, over-correction prompt nuance. These are prompt-string presence asserts (mechanical) + harness real-mode reliability report + Lior's live demo. **Never assert "the agent reliably uses facts" from code-reading.**

### A′ — reply system prompt (LLM-fuzzy, prompt fix)
- The reply system prompt is `MEMORY_SELF_CONCEPT` composed into `COMPOSED_SYSTEM_PROMPT` (`packages/daemon/src/providers/system-prompt.ts:28-44`). The `[remembered] ` label discriminator is `REMEMBERED_LABEL` (`system-prompt.ts:50`). The prompt already tells the agent to attribute `[remembered]` facts and never claim statelessness, but it does **not** instruct "FIRST check `[remembered]`, USE the answer if present, NEVER say you lack info that appears in a `[remembered]` message." *(That this strengthening reliably improves recall-usage requires runtime demo to confirm.)*
- Injected facts arrive as `{role:"user", content: REMEMBERED_LABEL + fact}` (`smart-distiller-provider.ts:645`). Confirmed the agent receives them as labeled user messages.

### E — duplicate-fact-from-a-question + dedup (E-a fuzzy, E-b deterministic)
- **E-a (distiller prompt):** `SMART_DELTA_SYSTEM_PROMPT` (`smart-distiller-provider.ts:94-118`) ALREADY has (from v2-06 B-fix) "Derive facts ONLY from the USER's statements in the NEW TAIL. ASSISTANT lines are … NEVER create or replace a fact based on an ASSISTANT line" (line 112). It does NOT yet say a **user QUESTION** is not a fact source. The demo-2 failure: user only ASKED "як мене звати?" (a user line, not an assistant line) → distiller emitted a duplicate. The prompt edit must extend "USER statements" to explicitly exclude **user questions** (interrogatives) as fact sources. *(Reliability requires runtime demo.)*
- **E-b (dedup guard) — the deterministic layer.** The apply loop is `distillOneThread` Phase-3 (`distiller-registration.ts:177-264`). For each op it computes `newItemCanonical = op.canonical || normalizeFactText(op.fact)` (line 214) then `insertFact` (new/demoted, lines 251-262) or `appendToFactById` (line 247). **There is NO check that `newItemCanonical` already equals an existing fact's canonical** → a `new` op whose canonical duplicates an existing fact creates a duplicate row. This is the code path the dedup guard plugs: before `insertFact` for a `new`/demoted op (and before an `append` materializes a same-canonical item), look up whether any existing `distilled_facts` row already has that canonical; if so, **no-op** (skip the insert). Canonical lives in `fact_fts.canonical` (`store.ts:956-972` `fetchCandidates` JOINs `fact_fts`); a direct `SELECT 1 FROM fact_fts WHERE canonical = ?` is the exact-match lookup. *(The guard's no-op behavior IS deterministically assertable — RED→GREEN in `bun test` + harness stub; this is NOT a runtime-only claim.)*
- `normalizeFactText` (`normalize-fact-text.ts:22-40`): NFKC → lowercase → strip `[remembered] ` → collapse whitespace → strip trailing `.!?;,` → strip surrounding quotes. This is the normalization the dedup guard's canonical comparison must use for the `op.canonical || normalizeFactText(op.fact)` fallback path to match consistently.

### Over-correction — cannot-self-forget prompt (LLM-fuzzy, prompt nuance)
- The over-generalizing clause is in `MEMORY_SELF_CONCEPT` (`system-prompt.ts:37-38`): "You cannot modify, delete, or forget your own memory. Never claim to have forgotten, changed, or deleted something you remember — only the user can, via the History page." Shipped by v2-01 (`chunks-todo/memory-quality/v2-01-…md:21-25`). Demo-2 step 6: user said "колір тепер зелений" (distiller DID `op:replace`), agent replied "Можеш змінити це в History…" — it told the user to update History for info they JUST gave. The fix adds a nuance clause distinguishing "you cannot manually delete/forget (user does via History)" from "new things the user tells you, incl. corrections, ARE captured automatically — do NOT tell the user to update History for info they just gave you; only mention History for viewing/editing/forgetting EXISTING memories." *(Reliability requires runtime demo.)*

### Owed cleanup (deterministic)
- **(1) human-delete 5a/5e test.** `WriteGate.forgetFactById` guard (`write-gate.ts:163`): `if (row.authored_by === "human" && ctx.authored_by === "machine") return;` — so a HUMAN-ctx delete of a HUMAN row FALLS THROUGH to `deleteFactById` (the 5a-allowed case). The existing test (`write-gate.test.ts:364`) covers only the 5e machine-refused case. The owed test asserts the **complement**: HTTP_CTX (`authored_by:"human"`) CAN delete a human-authored fact (5a), alongside the existing 5e refusal. *(Code path confirmed; the test makes it a regression gate.)*
- **(2) DoD-wording reconciliation.** The v2-06 plan/DoD must read "5a = user/HTTP_CTX CAN delete own (incl. human-authored) facts; 5e = machine-ctx CANNOT clobber human facts." This is a doc-wording reconciliation to an ALREADY-DECIDED ADR-0012 rule (5a in ADR-0012:49-50; 5e at ADR-0012:53) — **NOT new scope** (§7.2 citation-test: reconciliation-to-existing-decision, annotation-only).
- **(3) `POST /memory/forget` `target_type:"fact"` REQUIRES `fact_id`.** Today `handleForget` (`http-routes.ts:148-163`) routes to `forgetFactById` IF `fact_id` is present + uuid-shaped (line 150), ELSE **falls back to the over-deleting `forgetFact(fact_text, provenance, …)`** (line 162). `forgetFact` → `deleteMachineFactsByForget(provenance, norm)` (`write-gate.ts:125`) which deletes EVERY row where `c.provenance === provenance` (`store.ts:372`) — the over-delete root, since all thread facts share `thread:<id>` provenance. `history.html` ALWAYS sends `fact_id` now (`history-page.ts:380`), so the fallback is UI-unreachable. **Fix:** in the `target_type:"fact"` branch, REQUIRE a valid uuid-shaped `fact_id` → else 400 `bad_body` (reject malformed); remove the `forgetFact` back-compat fallback so NO HTTP caller can reach the over-deleting path. The `WriteGate.forgetFact` primitive + its direct unit tests stay (they exercise the primitive, not a caller route); only the HTTP entrypoint stops routing to it. **One non-UI caller breaks: the v2-04 `forget-roundtrip-probe.ts` (`scripts/`) posts `target_type:"fact"` + `fact_text` + NO `fact_id` (`forget-roundtrip-probe.ts:141-142`)** — it must be updated to send `fact_id` (it's a script, not a frozen surface). The `http-routes.daemon.test.ts:405-418` "also_forget_sources ignored" test ALSO posts without `fact_id` (provenance only) and expects 204 — it must be updated to send `fact_id` or re-targeted to assert the new 400.
- **(4) whenIdle timeout branch + overlapping-dismiss integration.** The bounded-wait is `ThreadLifecycle.beginTurn` (`thread-lifecycle.ts:76-93`): `Promise.race([whenIdle().then→"idle", timeoutPromise→"timeout"])`, `WHEN_IDLE_TIMEOUT_MS = 5000` (line 18); on `"timeout"` it `console.error` + `memDebug("retrieve",{whenIdleTimedOut:true})` (lines 87-92) then proceeds. The owed coverage: a unit/integration test that drives a `whenIdle` that never resolves within the timeout → asserts the timeout branch fires (proceed-not-hang) + an overlapping-dismiss-then-new-thread integration test (dismiss A in-flight, open B, assert B's retrieve sees A's committed facts via the whenIdle wait). *(Timeout firing is deterministically testable with an injected slow/never-resolving whenIdle; the overlapping-dismiss "sees committed facts" assertion is a real-store integration test.)*

### Frozen-surface check (FLAG-cleared)
- `@agentic/protocol` and `packages/daemon/src/mock-agent.ts` are the ONLY byte-frozen surfaces (CLAUDE.md). NONE are touched by this chunk: all edits are prompt strings (`system-prompt.ts`, `smart-distiller-provider.ts`), the distiller apply loop (`distiller-registration.ts`), the HTTP route (`http-routes.ts`), a script (`forget-roundtrip-probe.ts`), the harness, and tests. The `POST /memory/forget` `fact_id` field is an ADDITIVE HTTP body field already added by v2-06 (confirmed `http-routes.ts:137,150`) — v2-07 only tightens validation (requires it), NOT a wire change. Plan asserts `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty at every step DoD.

### Behavioral DoD
- The 9-step live re-demo (A′ reliably uses injected facts, NO duplicate facts E, NO redundant "use History" for a just-stated fact, C/B/D/stability stay GREEN) is **behavioral — requires Lior's live demo to confirm; NOT verifiable by code-reading, tests, prior PASS records, or even the harness.** The conductor re-verifies (runs the harness) + routes the §6.1 re-demo.

---

## §7.1 runtime-coupling notes (flagged at decompose)

1. **A′ / over-correction prompt edits (`system-prompt.ts`).** Pure string edits to `MEMORY_SELF_CONCEPT`; recomposes `COMPOSED_SYSTEM_PROMPT`. No shared state. The six D1 requirements + the `[remembered]` discriminator + REMEMBERED_LABEL all REMAIN — the prompt test must assert they survive (don't silently drop a clause while adding one).
2. **E-a distiller prompt (`SMART_DELTA_SYSTEM_PROMPT`).** String edit; no port/store change. Narrows the fact-source contract from "USER statements" to "USER statements that are NOT questions." DumbTail provider is op:new-only and unaffected (no contradiction logic).
3. **E-b dedup guard (`distiller-registration.ts` Phase-3).** A new READ (`SELECT 1 FROM fact_fts WHERE canonical = ?`) inside the existing apply tx, gating `insertFact`/`appendToFactById`. Provider-agnostic (runs for any provider's delta). Couples the apply loop to `fact_fts`'s canonical column — already the dedup substrate (`fetchCandidates`). DoD: re-distilling an unchanged conversation OR a question-only thread produces zero new rows; count-equality `fact_fts == distilled_facts` holds.
4. **(3) HTTP forget tighten (`http-routes.ts`).** Narrows `target_type:"fact"` to require `fact_id`. Removes the `forgetFact` fallback CALL SITE (the method survives). Breaks 2 non-UI callers (the v2-04 probe script + one daemon test) → both updated in-chunk. UI path unchanged (already sends `fact_id`).
5. **(4) whenIdle timeout coverage.** Test-only; exercises the existing `thread-lifecycle.ts:76-93` branch. The overlapping-dismiss integration test couples dismiss-distill ordering to a new thread's retrieve (the v2-06 FIX-A contract) — asserts, does not change, that contract.

---

## ADR worthy: no

This chunk fixes defects WITHIN the already-accepted model: ADR-0012 + the 2026-06-13 STABILITY amendment + 5a/5e + ADR-0015. Specifically: A′/over-correction operationalize the self-concept honesty (ADR-0012 decisions 1+4 + 5a transparency); E-a operationalizes the amendment's "genuinely-contradicting NEW fact" (a question is not a new fact); E-b dedup operationalizes the amendment's stability (Failure-mode-B "missed contradiction → duplicate" mitigation, spec §3.2 — "the candidate fetch + canonical-form prompting make it rare; the residual is a redundant fact" — the guard hardens the canonical layer); the HTTP tighten realizes 5a forget as a precise durable delete (the over-deleting fallback violated "delete exactly what the user pointed at"). No new protocol, no new dependency, no new boundary, no new wire field (`fact_id` exists). **No new ADR.**

## §7.2 citation-test flags (route to the orchestrator/conductor)

- **No frozen-surface conflict.** No `@agentic/protocol` / `mock-agent.ts` change.
- **No new scope.** Cleanup item (2) is a doc-wording **reconciliation to an already-decided ADR-0012 5a/5e rule** — annotation-only, NOT new scope (passes the citation-test discriminator: it cites ADR-0012 decisions 5a/5e verbatim; it does not introduce a NEW rule). The worker MAY edit the v2-06 plan's DoD wording for this reconciliation; everything else is plan-as-written.
- **No blocker.** The forget-fallback-removal tension (scope item 3 "remove" vs. v2-06 "back-compat retained") RESOLVES cleanly from the scope text "**UI-unreachable**": history.html already sends `fact_id`, so removing the HTTP fallback breaks NO UI path — only a probe script + one test, both updated in-chunk. The architect's read is REMOVE-the-fallback (it is the over-delete root and is otherwise unreachable); the orchestrator concurred (scope-as-written, cheap-to-reverse — §7.2 citation test passed: not a frozen surface, scope explicitly orders it).

---

## File Structure (what each touched file is responsible for)

- `packages/daemon/src/providers/system-prompt.ts` — A′ recall-usage clause + over-correction nuance clause in `MEMORY_SELF_CONCEPT` (keep all six D1 requirements).
- `packages/daemon/src/providers/system-prompt.test.ts` — assert the new clauses present AND the D1 requirements survive.
- `packages/daemon/src/memory/providers/smart-distiller-provider.ts` — E-a: extend `SMART_DELTA_SYSTEM_PROMPT` so a USER QUESTION is not a fact source.
- `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` — assert the E-a prompt clause present.
- `packages/daemon/src/memory/distiller-registration.ts` — E-b: dedup guard in Phase-3 apply loop (canonical-already-exists → no-op).
- `packages/daemon/src/memory/distiller-integration.daemon.test.ts` — E-b dedup RED→GREEN (real store) + (4) overlapping-dismiss integration test.
- `packages/daemon/src/memory/http-routes.ts` — (3) require uuid-shaped `fact_id` for `target_type:"fact"`; remove `forgetFact` fallback call.
- `packages/daemon/src/memory/http-routes.daemon.test.ts` — (3) assert 400 on missing/malformed `fact_id`; update the `also_forget_sources` test to send `fact_id`.
- `packages/daemon/src/memory/write-gate.test.ts` — (1) human-ctx CAN delete a human fact (5a) + the existing 5e refusal stays.
- `packages/daemon/src/memory/thread-lifecycle.test.ts` (create if absent) — (4) whenIdle timeout branch fires (proceed-not-hang).
- `packages/daemon/scripts/forget-roundtrip-probe.ts` — (3) update to send `fact_id`.
- `packages/daemon/scripts/memory-demo-harness.ts` — E deterministic assertion (seed name → ask a question → NO new/duplicate fact); A′ recall-usage report in real mode; banner re-labeled v2-07.

---

## Steps (ordered; each independently executable; RED→GREEN where deterministic)

### Step 1 — Prompt edits (A′ recall-usage + over-correction nuance + E-a distiller-statement-only)

> Three LLM-fuzzy prompt edits grouped (all string-only, mechanically asserted by presence; reliability is harness-real + Lior demo). Group first because they are independent and de-risk the series.

**Files:**
- Modify: `packages/daemon/src/providers/system-prompt.ts`
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts` (`SMART_DELTA_SYSTEM_PROMPT`)
- Test: `packages/daemon/src/providers/system-prompt.test.ts`, `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts`

- [ ] **1.1 (RED) Extend `system-prompt.test.ts`** — add assertions that `MEMORY_SELF_CONCEPT` contains:
  - an A′ recall-usage instruction (assert a substring like `"FIRST check"` AND `"never"` + `"don't have"`/`"don't know"` phrasing — pick a stable assertable phrase, e.g. assert the prompt contains both the words `remembered` and a "use it" directive and a "never say you don't have/know" directive);
  - an over-correction nuance instruction (assert a substring like `"do NOT tell the user to update History for information they just gave"` and `"viewing, editing, or forgetting"` / `"EXISTING"`);
  - AND that the six D1 requirements still survive (re-assert the existing D1 substrings already covered, plus `REMEMBERED_LABEL` unchanged `"[remembered] "`). Run `bun test packages/daemon/src/providers/system-prompt.test.ts` → FAIL.
- [ ] **1.2 (GREEN) Edit `MEMORY_SELF_CONCEPT` (`system-prompt.ts:28-40`).** Insert two clauses, keeping all existing sentences:
  - **A′ (after the `[remembered]` discriminator sentences, before "Never invent…links"):** "When the user asks about themselves, FIRST check the \"[remembered] \" messages; if the answer is there, USE it and answer confidently. NEVER say you do not have, do not know, or cannot find information that appears in a \"[remembered] \" message."
  - **Over-correction (replace/augment the line at 37-38).** Keep "You cannot modify, delete, or forget your own memory. Never claim to have forgotten, changed, or deleted something you remember." then ADD: "New things the user tells you — including corrections — ARE captured automatically; do NOT tell the user to update the History page for information they just gave you. Only mention the History page for viewing, editing, or forgetting EXISTING remembered facts."
  - Recompose `COMPOSED_SYSTEM_PROMPT` automatically (it concatenates). Verify the six D1 requirement comments (lines 16-26) still describe the prompt; update the comment block to note the A′ recall-usage + over-correction-nuance clauses (D1-7 / D1-8) so the doc-comment is not a silent contradiction.
- [ ] **1.3 (RED) Extend `smart-distiller-provider.test.ts`** — assert `SMART_DELTA_SYSTEM_PROMPT` contains an explicit "a user QUESTION is not a fact source" instruction (assert a substring like `"question"` + `"not a fact source"` / `"do not create a fact from a question"`). Run → FAIL.
- [ ] **1.4 (GREEN) Edit `SMART_DELTA_SYSTEM_PROMPT` (`smart-distiller-provider.ts:112`).** Extend the existing USER-statements rule: after "Derive facts ONLY from the USER's statements in the NEW TAIL. ASSISTANT lines are … NEVER create or replace a fact based on an ASSISTANT line." ADD: "A user QUESTION (e.g. \"what is my name?\", \"як мене звати?\") is a REQUEST, NOT a statement — NEVER create, append, or replace a fact from a user question. Only a user STATEMENT (a declaration of new information) is a fact source."
- [ ] **1.5 (GREEN) Run + commit.** `bun test packages/daemon/src/providers/system-prompt.test.ts packages/daemon/src/memory/providers/smart-distiller-provider.test.ts && bun run typecheck && bun run lint:strict` → exit 0. Commit: `fix(memory): v2-07 prompts — A' recall-usage + over-correction nuance + distiller question-is-not-a-fact-source` + the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

**DoD (command-evidence):** `bun test …/system-prompt.test.ts …/smart-distiller-provider.test.ts` PASS; new clauses present AND D1 requirements survive; frozen `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty.

### Step 2 — E-b: the deterministic dedup guard (the hard E gate) + harness assertion

> The deterministic layer. RED→GREEN in `bun test` against a real store, then the harness deterministic assertion. This is the gate that makes "question → no duplicate fact" assertable without an LLM.

**Files:**
- Modify: `packages/daemon/src/memory/distiller-registration.ts` (Phase-3 apply loop)
- Test: `packages/daemon/src/memory/distiller-integration.daemon.test.ts`
- Modify: `packages/daemon/scripts/memory-demo-harness.ts` (E deterministic assertion)

- [ ] **2.1 (RED) Add a dedup integration test in `distiller-integration.daemon.test.ts`.** With a scripted echo-stub `clientFactory` (reuse the existing `makeEchoStub` pattern in this file): seed one fact (canonical `"user name is lior"`) via a first dismiss; then drive a second thread + dismiss whose scripted delta emits a `new` op with the SAME canonical (`"user name is lior"`, different display wording). Assert AFTER the second dismiss: `SELECT COUNT(*) FROM distilled_facts WHERE …` shows the name fact count is still **1** (the duplicate new op was a no-op), and `COUNT(fact_fts) == COUNT(distilled_facts)` (no orphan). Run `bun test packages/daemon/src/memory/distiller-integration.daemon.test.ts` → FAIL (today a 2nd row is inserted).
- [ ] **2.2 (GREEN) Add the dedup guard in `distillOneThread` Phase-3 (`distiller-registration.ts`).** Inside the apply-loop tx, BEFORE materializing a `new` (or demoted-to-new) op via `insertFact`, and BEFORE an `append` materializes (the append-then-fallback-to-new branch), check existence:
  - compute `newItemCanonical = op.canonical || normalizeFactText(op.fact)` (already computed at line 214 — reuse it);
  - `const dup = store.rawDb().query("SELECT 1 FROM fact_fts WHERE canonical = ? LIMIT 1").get(newItemCanonical);`
  - for `effectiveOp === "new"` (original or demoted): if `dup` → **skip the `insertFact` (no-op)**; log via `memDebug("distill", {threadId, dedupSkipped: previewStr(op.fact), canonical: previewStr(newItemCanonical)})`. Otherwise insert as today.
  - **Scope the guard to `new`/demoted ops only.** `replace` (targeted, in-place, id-stable) and `append` (to an existing target) are NOT duplicate-creating by definition — leave them. The append→`new` FALLBACK (cap hit, line 251) DOES create a new row, so the dedup check must also gate THAT fallback `insertFact`. *(Exact-canonical match only — this honors spec §3.4 D-V4c "match/dedup on canonical"; it is a conservative exact guard, NOT fuzzy dedup. Do not claim it catches reworded duplicates — that is the LLM's job, named Failure-mode-B.)*
  - Add a doc-comment: "v2-07 E-b dedup guard: never insert a new/demoted fact whose canonical already exists (no-op instead). Exact-canonical, conservative — the LLM's candidate-fetch handles reworded near-duplicates (spec §3.2 Failure-mode-B). Operationalizes the STABILITY amendment's redundant-fact mitigation."
- [ ] **2.3 (GREEN) Run the dedup test → PASS.** `bun test packages/daemon/src/memory/distiller-integration.daemon.test.ts` → PASS. Confirm the existing idempotence test (re-distill unchanged thread → zero new facts) still passes (the guard reinforces it).
- [ ] **2.4 (GREEN) Add the E deterministic assertion in the harness (`memory-demo-harness.ts`).** In stub mode: seed a name fact (existing STEP 1), then drive a NEW thread that asks a QUESTION ("Як мене звати?") and dismiss. The scripted client (already derives ops only from `[user|` lines, lines 209-260) must NOT emit a `new`/`append` for a question-only tail — extend the stub's op table so a user line that is a QUESTION (e.g. matches `звати?`/`?`) produces NO op. Assert: name-fact `COUNT` unchanged (no new/duplicate row) via the rawDb snapshot pattern already used (`SELECT id, fact FROM distilled_facts`). `process.exit(1)` on a duplicate. Re-label the banner/summary v2-07 (currently says v2-06).
- [ ] **2.5 (GREEN) Run harness stub → E GREEN; commit.** `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub` → E assertion GREEN (question → no duplicate). `bun test packages/daemon/src/memory && bun run typecheck && bun run lint:strict` → exit 0. Commit: `fix(memory): v2-07 E — dedup guard (canonical-already-exists → no-op) + question-only no new fact; harness deterministic E assertion` + trailer.

**DoD (command-evidence):** `bun test …/distiller-integration.daemon.test.ts` PASS (dedup RED→GREEN); harness `--mode=stub` shows E GREEN (question → no duplicate fact); count-equality `fact_fts == distilled_facts` holds; frozen `git diff` empty.

### Step 3 — Owed hard-review cleanup (4 items) + final verification + EXECUTED harness + §6.1 escalation

> The 4 cleanup items are independent of each other and small; grouped. Then the full-green gate + EXECUTED real-mode harness + the §6.1 re-demo escalation.

**Files:**
- Modify: `packages/daemon/src/memory/write-gate.test.ts` — (1)
- Modify: `packages/daemon/src/memory/http-routes.ts` — (3)
- Modify: `packages/daemon/src/memory/http-routes.daemon.test.ts` — (3)
- Modify: `packages/daemon/scripts/forget-roundtrip-probe.ts` — (3)
- Create/Modify: `packages/daemon/src/memory/thread-lifecycle.test.ts` — (4)
- Modify: `packages/daemon/src/memory/distiller-integration.daemon.test.ts` — (4) overlapping-dismiss
- Modify: `orchestration/docs/plans/memory-quality/plan-v2-06-debug-env-and-demo-fixes.md` — (2) DoD-wording reconciliation
- Modify: `packages/daemon/scripts/memory-demo-harness.ts` — A′ real-mode report

- [ ] **3.1 — (1) human-delete 5a test (`write-gate.test.ts`).** Add a test mirroring the existing 5e test (line 364) but the COMPLEMENT: seed a HUMAN-authored fact; call `gate.forgetFactById(humanFactId, { actor: "user", authored_by: "human" })`; assert the human fact IS deleted (count → 0) — proving 5a (user/HTTP_CTX CAN delete own/human-authored facts). Keep the existing 5e refusal test. Run `bun test packages/daemon/src/memory/write-gate.test.ts` → PASS (the guard already falls through for human-ctx; this is a regression gate, may be GREEN immediately — that is fine, it locks the 5a behavior).
- [ ] **3.2 — (3) RED: HTTP forget requires `fact_id`.** In `http-routes.daemon.test.ts`: (a) add a test — `POST /memory/forget {target_type:"fact", fact_text, provenance}` with NO `fact_id` → **400 `bad_body`** (was 204 via fallback); (b) add — `target_type:"fact"` + malformed `fact_id:"not-a-uuid"` → **400**; (c) UPDATE the existing `also_forget_sources` test (lines 405-428) to send a valid `fact_id` and assert 204 + source-intact (or re-target it to assert the new 400 — pick: send `fact_id` so it still proves source-intact). Run → the new 400 tests FAIL on current code (fallback returns 204).
- [ ] **3.3 — (3) GREEN: tighten `handleForget` (`http-routes.ts:148-163`).** In the `target_type === "fact"` branch: require `typeof fact_id === "string" && uuid-shaped` → `forgetFactById` + 204; ELSE return 400 `bad_body`. DELETE the `forgetFact(fact_text, provenance, …)` fallback call (lines 155-163) and the now-dead `fact_text`/`provenance` validation in that branch. Update the file's header/inline comment: "v2-07: target_type:fact REQUIRES a valid uuid-shaped fact_id (the precise durable-delete intent). The text/provenance forgetFact path is NO LONGER HTTP-reachable (it over-deletes all facts sharing a thread provenance — store.ts deleteMachineFactsByForget). history.html always sends fact_id. The WriteGate.forgetFact primitive survives for its unit tests but has no caller route." Run `bun test packages/daemon/src/memory/http-routes.daemon.test.ts` → PASS.
- [ ] **3.4 — (3) Update `forget-roundtrip-probe.ts` to send `fact_id`.** The probe (`scripts/forget-roundtrip-probe.ts:141-142`) posts `{target_type:"fact", fact_text, provenance}` with no `fact_id`. Before the POST, read the fact's `id` (the probe already knows `factId` — it queries `fact_topics WHERE fact_id = ?` at line 115, so `factId` is in scope) and add `fact_id: factId` to `forgetBody`. Run `bun run packages/daemon/scripts/forget-roundtrip-probe.ts` → still 204, durable-delete proven (probe is real-I/O; EXECUTE it, paste stdout in PR).
- [ ] **3.5 — (4) whenIdle timeout-branch test (`thread-lifecycle.test.ts`).** **Worker decision (architect-recommended):** make `WHEN_IDLE_TIMEOUT_MS` an optional constructor param defaulting to 5000 (additive, frozen-safe, mirrors the existing optional params) so the test injects e.g. 20ms; drive `beginTurn` with a never-resolving `whenIdle` → assert `console.error` was called with the timeout message AND `beginTurn` still RESOLVES (proceed-not-hang) with the retrieved priorMessages. Run → PASS.
- [ ] **3.6 — (4) overlapping-dismiss integration test (`distiller-integration.daemon.test.ts`).** With a scripted clientFactory that adds a small `await` delay (mirror the harness `A_RACE_DELAY_MS` pattern): dismiss thread A (fires in-flight delayed distill), immediately `beginTurn` a new thread B → assert B's `priorMessages` (retrieve) INCLUDE A's just-committed fact (the whenIdle wait blocked retrieve until the in-flight distill settled). This is the deterministic integration counterpart to the harness A test. Run → PASS.
- [ ] **3.7 — (2) DoD-wording reconciliation (v2-06 plan).** In `orchestration/docs/plans/memory-quality/plan-v2-06-debug-env-and-demo-fixes.md`, correct any 5a/5e wording to: "5e = machine-ctx CANNOT clobber/delete human-authored facts; 5a = the user (HTTP_CTX, authored_by:human) CAN delete their own facts, including human-authored ones." (Search the file for "5e"/"5a"/"human".) This is a doc-comment reconciliation to ADR-0012 5a/5e — NO code change. *(§7.2: reconciliation-to-existing-decision, annotation-only — within orchestrator/worker authority.)*
- [ ] **3.8 — A′ real-mode report in the harness (`memory-demo-harness.ts`).** In real mode, after the recall steps, REPORT (not hard-assert) whether the agent's reply USED the injected fact (e.g. log "A′ recall-usage: name recalled = true/false" by checking the reply contains the seeded name). LLM-fuzzy — print the outcome for the PR; do NOT `process.exit(1)` on a single miss (bar is "reliably uses," confirmed by Lior's demo). Re-confirm the banner/summary is v2-07-labeled.
- [ ] **3.9 — Full-green gate + EXECUTE both harness modes + commit.** From repo root: `bun test && bun run lint:strict && bun run typecheck` → exit 0. `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` → empty. EXECUTE `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub` (E GREEN, all v2-06 defects stay GREEN) AND `--mode=real` (real Haiku; skips-with-message if no Keychain key — note it). Paste BOTH full stdouts + the forget-roundtrip-probe stdout into the PR, marked "EXECUTED, output below." Commit: `test(memory): v2-07 cleanup — human-delete 5a/5e · forget requires fact_id (over-delete path unreachable) · whenIdle timeout + overlapping-dismiss · v2-06 DoD wording` + trailer.
- [ ] **3.10 — Push + PR; escalate the §6.1 re-demo.** Push `chunk/v2-07-prompt-quality-dedup-cleanup`; the PR body carries: (a) the dedup RED→GREEN + cleanup test outputs, (b) the EXECUTED stub+real harness stdouts + the probe stdout, (c) the A′ real-mode recall-usage report, (d) the §7.2 flag (forget-fallback REMOVED resolution + the (2) reconciliation), (e) the demo runbook. **Does NOT auto-merge** — Done criterion 3 (Lior's LIVE 9-step re-demo: A′ reliably uses facts, NO duplicate E, NO redundant "use History," C/B/D/stability GREEN) is the whole-feature gate. Report DONE-ready / BLOCKED-on-Lior-demo to the ledger; the conductor re-verifies (runs the harness) + routes the §6.1 re-demo, then merges (bringing v2-05 + v2-06), closing PR #67/#68 subsumed.

**DoD (command-evidence):** repo-root `bun test && bun run lint:strict && bun run typecheck` exit 0; frozen `git diff` empty; all 4 cleanup tests GREEN; harness EXECUTED both modes (stdout in PR, E GREEN); A′ recall-usage reported (real mode); behavioral §6.1 re-demo escalated to Lior — **NOT done until the live demo is green (requires runtime demo to confirm; code-reading/tests/harness are necessary, not sufficient).**

---

## Self-review (chunk coverage)

- **A′ recall-usage (reply prompt; LLM-fuzzy; bar = reliably uses, not 1/1)** → Step 1.1-1.2 (presence) + 3.8 (real-mode report) + behavioral demo. ✓
- **E-a distiller (question/statement-only fact source; LLM-fuzzy)** → Step 1.3-1.4. ✓
- **E-b dedup guard (deterministic; canonical-already-exists → no-op; harness question→no-dup assert)** → Step 2. ✓
- **Over-correction (don't tell user to use History for just-given info; LLM-fuzzy)** → Step 1.1-1.2. ✓
- **Cleanup (1) human-delete 5a + 5e** → Step 3.1. ✓
- **Cleanup (2) v2-06 DoD wording (reconciliation, not new scope)** → Step 3.7. ✓
- **Cleanup (3) forget requires fact_id + over-delete path unreachable** → Steps 3.2-3.4. ✓
- **Cleanup (4) whenIdle timeout branch + overlapping-dismiss integration** → Steps 3.5-3.6. ✓
- **Frozen surfaces byte-unchanged; fact_id is additive (v2-06) only validation-tightened** → Reality check + every step DoD. ✓
- **ADR worthy: no; §7.2 flags surfaced (no conflict/no new scope; forget-fallback removal resolved from "UI-unreachable")** → headers. ✓
- **Deterministic vs LLM-fuzzy split honored in the DoD** → Reality check + Step grouping. ✓

---

## Key file references (absolute paths)

- Reply prompt: `packages/daemon/src/providers/system-prompt.ts` (`MEMORY_SELF_CONCEPT` lines 28-40; over-correction at 37-38)
- Distiller delta prompt: `packages/daemon/src/memory/providers/smart-distiller-provider.ts` (`SMART_DELTA_SYSTEM_PROMPT` lines 94-118)
- Dedup apply path: `packages/daemon/src/memory/distiller-registration.ts` (Phase-3 loop lines 177-264; `newItemCanonical` line 214; `insertFact` 251/259; append-fallback 247-255)
- Canonical lookup substrate: `packages/daemon/src/memory/store.ts` (`fetchCandidates`/`fact_fts` 956-972; `deleteMachineFactsByForget` over-delete 365-384; `deleteFactById` 942-945)
- Forget path: `packages/daemon/src/memory/write-gate.ts` (`forgetFact` 122-133; `forgetFactById` + 5e guard 148-181); `packages/daemon/src/memory/http-routes.ts` (`handleForget` 127-171; fallback 155-163)
- whenIdle bounded-wait: `packages/daemon/src/memory/thread-lifecycle.ts` (timeout branch 76-93; `WHEN_IDLE_TIMEOUT_MS` 18)
- Harness: `packages/daemon/scripts/memory-demo-harness.ts`; probe: `packages/daemon/scripts/forget-roundtrip-probe.ts`
- history.html forget (always sends fact_id): `packages/daemon/src/memory/history-page.ts` (line 380)
