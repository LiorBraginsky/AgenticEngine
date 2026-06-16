# Plan — chunk v2-06: Memory dev-env (MEMORY_DEBUG + demo-flow harness) + the 3 demo defects

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All paths are repo-relative to `/Users/lior/WebstormProjects/playground/AgenticEngine`.

**Goal:** Build the memory dev-env (env-gated `MEMORY_DEBUG` logging + a headless full-flow demo harness) that would have caught the 2026-06-13 demo defects, then fix the 3 defects: C (forget over-deletes → forget-by-id), B (fact reworded without a genuine change), A (recall race — diagnose + bus-gated fix).

**Architecture:** Build Part 1 (D1 debug-log + D2 harness) FIRST as the diagnosis enabler. The harness drives the REAL daemon through the SAME interfaces the overlay uses (WS add-turn + close-to-dismiss; HTTP `POST /memory/forget` + `GET /memory/thread/:id`), with the ONLY stub being the LLM `clientFactory` (the permitted network boundary, spec §5). Then fix C (a new intent-named `forgetFactById` path, history.html sends the fact's stable id), B (prompt-tighten so the distiller does not rework a fact absent a genuine new USER statement, and does not distill the agent's own recall reply into competing facts), and A (diagnose the dismiss→distill→retrieve race via the harness/log; implement the bus-chosen consistency model — the architect recommends, the conductor decides via the dev-bus).

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (real, never mocked); `@anthropic-ai/sdk` (Haiku — only the `clientFactory` stubbed); WS + HTTP over the real `startDaemon`. Build on the CURRENT shipped state (incremental stable-id distiller, default provider = `smart` per v2-05, durable-delete forget, `thread_distill_state` watermark, `fact_fts`/`fact_topics` + AFTER DELETE trigger).

---

## Status: review-complete — DONE-ready, BLOCKED on Lior's §6.1 live re-demo (behavioral DoD item 3). All steps 1–6 done + a harness-caught 4th defect (D) fixed. Bus q#012 ruled (i)+bounded-wait. engine-reviewer CLEAN (0 blockers/0 majors; 1 minor + 2 nits advisory, documented in PR). Gates (orchestrator-re-verified on HEAD 60c2a7e): `bun test` 495/0 · typecheck 0 · lint:strict 0 · frozen @agentic/protocol + mock-agent.ts byte-unchanged (0 bytes). EXECUTED Strike-5: stub all-GREEN (C/B/A hard assertion); real-mode exit 0 (real Haiku, 0 SmartDistillError, C/B GREEN). Branch: `chunk/v2-06-debug-env-and-demo-fixes` (stacked on `chunk/v2-05-migration-flip-and-demo`). NOT merged — behavioral §6.1 re-demo is Lior's gate; conductor re-verifies + routes the demo, then merges (bringing v2-05 along, closing PR #67 subsumed).

> **Defect D (added mid-flight, FLAGGED to conductor):** the v2-06 real-mode harness caught a 4th, demo-blocking defect — real Haiku non-deterministically wraps its JSON delta in a fence / inline backtick / prose, and the distiller's anchored fence-strip missed it → `parseOps`/`parseFacts` threw `SmartDistillError` → distill failed → no facts → the live STABILITY/recall demo would fail. PRE-EXISTING from v2-03, but it makes DoD item 3 (behavioral demo) unreachable, so the orchestrator folded the fix (a shared `extractJsonArray` first-`[`..last-`]` helper used by both parsers) under the §7.2 citation test (fix required to satisfy a frozen DoD line, mechanical, on a surface v2-06 already owns). Conductor may overrule (split into a v2-07) — flagged in the ledger + PR.

---

## Reality check

Every claim below is grounded in file evidence read by the architect. **Behavioral/runtime claims are flagged "requires runtime demo to confirm" (PIPELINE §6.1) — never asserted "verified" from code-reading.**

### The C blocker — root cause CONFIRMED (code-path):
- `history.html` "Forget fact" → `doForget({target_type:"fact", fact_text, provenance, reason})` (`history-page.ts:377-384`).
- → `POST /memory/forget` → `handleForget` → `deps.hatch.forgetFact(fact_text, provenance, …)` (`http-routes.ts:153`).
- → `WriteGate.forgetFact` → `store.deleteMachineFactsByForget(provenance, norm)` (`write-gate.ts:121-125`).
- `deleteMachineFactsByForget` deletes every machine row where `c.provenance === provenance || normalizeFactText(c.fact) === normalizedText` (`store.ts:363-382`). The demo's facts all share one `thread:<id>` provenance (machine facts get `provenance: "thread:${threadId}"`, set in `distiller-registration.ts:162,236,243`), so the `provenance ===` clause matches **every** fact of the thread → all deleted. **This is the over-delete root.** *(The over-delete itself is behavioral — RED-reproduced by the harness in Step 2, not asserted here from reading alone.)*
- `deleteFactById(id)` already exists, trigger-backed, deletes exactly one row (`store.ts:940-943`). This is the correct primitive for the fix.

### Frozen-surface check for the C fix (FLAG-cleared):
- `@agentic/protocol` and `mock-agent.ts` are the only byte-frozen surfaces (CLAUDE.md). The `POST /memory/forget` body is an **HTTP-route JSON body, NOT a `@agentic/protocol` wire envelope** — ADR-0015's relationship-to-ADR-0013 note states `target_type`/`also_forget_sources` were "additive to that HTTP body (not a frozen wire envelope — `@agentic/protocol` and `mock-agent.ts` are untouched)." **Adding an optional `fact_id` to the HTTP body is the same additive class — it does NOT touch the frozen wire.** `DistilledFactRow` is an internal store type, not frozen. **No frozen surface is touched by the C fix; the plan still asserts `git diff` empty on both frozen surfaces at verification.**
- `DistilledFactRow` currently lacks `id` (`store.ts:88-95`); `readDistilledFacts` SELECT (`store.ts:277`) and `readDistilledFactsForThread` SELECT (`store.ts:446-447`) do NOT select `id`. So history.html's `data.distilledFacts` rows carry no stable id today — the C fix must plumb `id` through these reads. *(Confirmed by reading the SQL.)*

### The A race — mechanism CONFIRMED (code-path), timing requires the harness:
- On `close(ws)` the daemon flushes the in-flight turn then `await hook.dismiss(toDismiss)` which runs the distiller (Phase-1 LLM call is awaited *inside* `close`) (`index.ts:219-256`).
- A NEW thread's `retrieve()` runs in `lifecycle.beginTurn` on the next `session_start` (`thread-lifecycle.ts:60-62`), reading `readDistilledFactsForThread`.
- The daemon does NOT block a new connection's `session_start` on a prior connection's `close` handler completing. So a fast reopen+ask can read the PRE-commit fact set — **exactly Lior's hypothesis.** *(The race window EXISTS in code; whether it fires for the demo's timing "requires runtime demo / harness to confirm.")*
- §7.1 note 3 of the spec already names the `WriteGate(forget) ↔ distiller candidate-fetch` edge as eventually-consistent; **no document currently states a read-after-write guarantee for retrieve vs in-flight distill** — so option (i) below would be a NEW contract clause (→ Spec-note candidate).

### The B rewording — mechanism CONFIRMED (code-path):
- Injected memory messages (`{role:"user", content: REMEMBERED_LABEL + fact}`, `smart-distiller-provider.ts:591` / `dumb-tail-provider.ts`) are NOT persisted — `endTurn` slices them off via `finalMessages.slice(hydratedCount)` (`thread-lifecycle.ts:86-99`). Good: injected facts are not directly re-archived.
- BUT the agent's recall **reply** (an `assistant` message restating the remembered fact) IS persisted as a machine turn, and the user's recall **question** is persisted. On the next dismiss, `readNewTailSince` returns BOTH roles (`store.ts:1028-1053`, each row carries `role`); the tail text is `[role|id] content` (`smart-distiller-provider.ts:511-513`). The distiller's `fetchCandidates(tailText)` then surfaces the existing fact, and the LLM may emit a `replace` with reworded `fact`/`canonical` — re-distilling its own recall reply. **This is the B mechanism.** *(RED-reproduced by the harness's scripted REPLACE-with-rewording in Step 2.)*
- The accepted model already forbids speculative REPLACE: spec §3.2 D-V2 point 5 ("uncertain ⇒ append/new, never replace") + `SMART_DELTA_SYSTEM_PROMPT` ("NEVER use 'replace' speculatively"). The B-fix **operationalizes the amendment's "genuinely-contradicting NEW fact"** as "the USER said something new" — a refinement WITHIN the accepted model, not a new boundary.

### Harness faithfulness constraint (drives Step 1.5):
- `startDaemon(port, provider?)` only injects the **chat** `AgentProvider`; `buildMemoryProvider()` is called internally (`index.ts:62-72`) with no seam to inject the **memory** provider. To drive the REAL daemon's full flow with a DETERMINISTIC distiller (needed to RED-reproduce B and to assert structural stability without a live key), the harness must inject a `SmartDistillerProvider({clientFactory: scriptedStub})`. **The plan adds an additive `memoryProvider?: MemoryProvider` param to `startDaemon`** (mirrors the existing `provider?` seam; `index.ts` is NOT a frozen surface; all existing `startDaemon(0)` / `startDaemon(0, fake)` callers stay byte-compatible). The scripted stub reuses the `makeEchoStub` clientFactory pattern (`distiller-integration.daemon.test.ts:372-402`).

### Behavioral DoD:
- The 9-step live re-demo (forget-one-only, consistent recall, STABILITY no-rewording) is **behavioral — requires Lior's live demo to confirm; NOT verifiable by code-reading, tests, prior PASS records, or even the harness** (the route lied 5×; the harness is necessary evidence, not sufficient for the §6.1 sign-off).

---

## §7.1 runtime-coupling notes (flagged at decompose)

1. **`startDaemon` gains a `memoryProvider?` injection seam.** New test/harness entry point on the daemon. Additive, frozen-safe, mirrors `provider?`. Production callers pass nothing → `buildMemoryProvider()` unchanged. The harness is the only injector. DoD: all existing `startDaemon` callers compile + pass unchanged.
2. **C fix: forget-by-id plumbs `id` through the read path.** `DistilledFactRow` + two SELECTs (`readDistilledFacts`, `readDistilledFactsForThread`) gain `id`; `Hatch.view` → JSON → `history.html` now carries it. Unchanged method *names* hide an expanded row contract — verify the `forget-roundtrip-probe` (v2-04) and `hatch.daemon.test.ts` still pass (they read `f.fact`, not `f.id`, so additive). The new `forgetFactById` path is parallel to the existing `forgetFact` (text/provenance), which stays byte-intact so all v2-04 forget tests pass unchanged.
3. **A: the dismiss→distill→retrieve consistency edge.** This chunk's A-fix changes the read-after-write timing between `close(ws)`'s async distill and a new thread's `beginTurn` retrieve. The bus-chosen model (block-until-committed vs eventual-consistency vs faster/sync) determines whether the dismiss/retrieve contract gains a new guarantee → see `## Spec-note candidate`.
4. **B: the distiller's new-tail input contract narrows.** The distiller still reads the full new tail, but the prompt now distinguishes USER statements (fact sources) from ASSISTANT replies (context only), and REPLACE requires a genuine USER contradiction. No store/port signature change; the change is prompt + (optional) a structural guard on which tail lines seed candidates.
5. **`MEMORY_DEBUG` log points** sit at three existing seams (distill, retrieve, forget-delete). They READ already-available data; no new shared mutable state. Must be greppable + secret-free (no key, no raw token).

---

## ADR worthy: no

This chunk **fixes defects within the already-accepted model**: ADR-0012 + the 2026-06-13 STABILITY amendment (the B-fix realizes "genuinely-contradicting"; the C-fix realizes 5a forget as a precise durable delete) and ADR-0015 (decision 5 already superseded; the new `forgetFactById` extends decision-1's intent-named dispatch philosophy — "dispatch by explicit caller INTENT"). No new protocol, no new dependency, no new boundary. `MEMORY_DEBUG` + the harness are dev-tooling. The `startDaemon` memoryProvider seam and the HTTP `fact_id` field are additive within existing boundaries. **No new ADR.**

## Spec-note candidate (route to adr-curator/Lior, NOT orchestrator-edited)

The A consistency-model choice is bus-gated. **IF the bus picks option (i) "block retrieve until in-flight distillation commits,"** that introduces a NEW read-after-write ordering guarantee into the dismiss/retrieve contract — `specs/2026-06-13-memory-distiller-v2.md` §5/§7.1 should gain a sentence stating it (currently §7.1 note 3 says only "eventually-consistent"). Options (ii) eventual-consistency and (iii) faster/sync-distill do NOT change the documented contract shape (ii is already the documented posture; iii changes timing, not contract). **Flag to Lior/curator at the bus answer; do not edit the spec from the orchestrator.** This satisfies the chunk's "may warrant a spec note — flag it."

---

## Steps (ordered; bus-blocking on A is LAST among implementation work; each step's DoD is a concrete command)

### Step 1 — Part 1: D1 `MEMORY_DEBUG` debug-log + the `startDaemon` memory-provider seam (the diagnosis enabler, half 1)

**Files:**
- Create: `packages/daemon/src/memory/debug-log.ts`
- Modify: `packages/daemon/src/memory/distiller-registration.ts` (call the distill + forget log points)
- Modify: `packages/daemon/src/memory/thread-lifecycle.ts` (retrieve/injection log point) — OR `smart-distiller-provider.ts`/`dumb-tail-provider.ts` `retrieve` (see 1.2)
- Modify: `packages/daemon/src/memory/write-gate.ts` (forget log point)
- Modify: `packages/daemon/src/index.ts` (the `memoryProvider?` injection seam)
- Test: `packages/daemon/src/memory/debug-log.test.ts`

- [ ] **1.1 — Create `debug-log.ts` (env-gated, OFF by default, secret-free).**
  - Export `const MEMORY_DEBUG = () => process.env["MEMORY_DEBUG"] === "1";` (a function, re-read per call so tests can toggle).
  - Export `memDebug(stage: "distill" | "retrieve" | "forget", payload: Record<string, unknown>): void` that, when enabled, emits ONE structured greppable line: `console.error("[memory-debug] " + stage + " " + JSON.stringify(payload))` (stderr so it never pollutes the agent reply stream). Prefix `[memory-debug]` for grep.
  - **Secret discipline:** the helper NEVER logs the API key or the auth token. Distill payload logs message **ids + roles + content-length + a content preview capped at e.g. 80 chars** (preview is the user's own memory content — acceptable under `MEMORY_DEBUG`, but cap to keep lines greppable). Forget/retrieve log fact **ids + provenance + normalized-text + fact preview**. Add a top-of-file comment: "MEMORY_DEBUG is a dev diagnostic — OFF by default, committed but NOT a prod default. Never log the API key or auth token."
  - Decide the exact shapes (frozen here so the worker doesn't re-decide):
    - **distill (input):** `{stage:"distill", threadId, sinceTurn, tail:[{id, role, len, preview}], candidates:[{ordinal, id, factPreview}]}` — logged in the provider just before the LLM call (or short-circuit).
    - **distill (output delta):** `{stage:"distill", threadId, ops:[{op, targetOrdinal, why?:expectedTargetText?, factPreview, canonicalPreview}], candidateIds}` — logged in `distillOneThread` after `provider.distill` returns. (`why` = the LLM's reasoning proxy: for replace, the `expectedTargetText`; the prompt already drives intent. There is no free-text "why" field on `FactOp` — do NOT add one; log `expectedTargetText` as the replace rationale.)
    - **retrieve/injection:** `{stage:"retrieve", forThreadId, injected:[{id?, factPreview, order:i}]}` — logged where `retrieve` composes the slice. NOTE: `retrieve` currently maps rows that lack `id`; after Step 3 adds `id` to `DistilledFactRow`, include it; until then log `factPreview + order`.
    - **forget:** `{stage:"forget", route:"forgetFactById"|"forgetFact", target:{factId?, provenance?, normalizedText?}, deletedIds:[…], deletedCount}` — logged in `WriteGate` after the delete.
- [ ] **1.2 — Wire the three log points (env-gated; no behavior change when OFF).**
  - `distiller-registration.ts distillOneThread`: after `provider.distill` returns `delta`, call `memDebug("distill", {threadId, ops:…, candidateIds:…})`. (Input-side tail/candidates are logged inside the provider — see next bullet.)
  - The distill INPUT (tail + candidates) is best logged inside `SmartDistillerProvider.distill` (it builds `tail` + `candidates`); add a `memDebug("distill", {threadId, sinceTurn, tail, candidates})` just before the LLM call, and the same in `DumbTailProvider.distill` (tail only, no candidates). Keep it ONE import.
  - `retrieve`: log inside `SmartDistillerProvider.retrieve` and `DumbTailProvider.retrieve` (they both compose the slice). Log the `live`/mapped rows.
  - `WriteGate.forgetFactById` (new in Step 3) + `WriteGate.forgetFact`: log the resolved delete set + count.
  - **Rule:** when `MEMORY_DEBUG()` is false, `memDebug` returns immediately — zero overhead, zero output. Verified by 1.4.
- [ ] **1.3 — Add the additive `memoryProvider?` seam to `startDaemon` (`index.ts:62`).**
  ```ts
  export function startDaemon(port: number = DAEMON_PORT, provider?: AgentProvider, memoryProvider?: MemoryProvider) {
    const activeProvider = provider ?? buildInjector();
    // …
    const memProvider = memoryProvider ?? buildMemoryProvider();
    // …
    registerDistiller(hook, store, memProvider, scanner);
    const lifecycle = new ThreadLifecycle(store, gate, memProvider);
  ```
  Import `MemoryProvider` type. The harness injects a scripted `SmartDistillerProvider`; production passes nothing. Add a one-line comment: "memoryProvider? — additive test/harness injection seam (mirrors provider?); production uses buildMemoryProvider()."
- [ ] **1.4 — Test `debug-log.test.ts` (RED→GREEN).**
  - `MEMORY_DEBUG` unset → `memDebug` produces NO `console.error` (spyOn(console,"error"); assert not called).
  - `MEMORY_DEBUG=1` → exactly one `[memory-debug] distill …` line with the expected JSON keys; assert the payload string contains NEITHER a key-shaped secret nor "Bearer".
  - Run: `bun test packages/daemon/src/memory/debug-log.test.ts` → PASS.
- [ ] **1.5 — Gate + commit.**
  - Run: `bun test packages/daemon/src/memory && bun run typecheck && bun run lint:strict` → exit 0.
  - Commit: `feat(memory): v2-06 MEMORY_DEBUG env-gated pipeline log (distill/retrieve/forget) + startDaemon memoryProvider seam` with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

**DoD (command-evidence):** `bun test packages/daemon/src/memory/debug-log.test.ts` PASS; `MEMORY_DEBUG` unset → `grep` of stderr shows zero `[memory-debug]` lines; `MEMORY_DEBUG=1` → greppable structured lines with no secret. Frozen `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty.

### Step 2 — Part 1: D2 headless demo-flow harness (`scripts/memory-demo-harness.ts`) — RED-reproduce all 3 defects on CURRENT code

**Files:**
- Create: `packages/daemon/scripts/memory-demo-harness.ts`
- Modify: `packages/daemon/package.json` (add `"memory-demo-harness": "bun run scripts/memory-demo-harness.ts"` alias)

- [ ] **2.1 — Build the harness scaffold (reuse `forget-roundtrip-probe.ts` + `incremental-distill-probe.ts` + `smart-distiller-probe.ts` patterns).**
  - `mkdtempSync` dataDir; set `process.env.AGENTIC_DATA_DIR`, `process.env.LLM_PROVIDER` per mode; Strike-5 banner; `process.exit(1)` on any failed assertion; cleanup on exit.
  - **Two modes** selected by argv `--mode=stub|real` (default `stub`):
    - **stub mode:** a deterministic chat `AgentProvider` (a harness-local stub that, on a recall question, replies with the recalled fact text as an assistant turn) injected as `startDaemon(0, chatStub, memStub)`; `memStub = new SmartDistillerProvider({clientFactory: scriptedClient})`. The `scriptedClient` (reusing `makeEchoStub`'s shape) returns canned op arrays keyed on the tail content — see 2.3 for the B-reproduction script.
    - **real mode:** `startDaemon(0)` (no injection) with `MEMORY_PROVIDER` unset (→ smart default, key from Keychain) and `LLM_PROVIDER=anthropic-api`; the agent + distiller are real. Skip-with-clear-message if no key resolves (mirror `smart-distiller-probe`'s key-resolve guard).
  - Read the disk auth token (`forget-roundtrip-probe.ts:131` pattern) for the HTTP forget + query calls.
  - Helper `wsTurn(port, token, {threadId, text})` that opens a WS (subprotocol = token, `Origin: tauri://localhost`), sends `session_start` with the client-minted `thread_id` + `text`, drives any tool_result for the chat stub, waits for `session_end`/reply, then `ws.close()` (which triggers the daemon's dismiss→distill). Mirror `test-client.ts` for the envelope shapes.
- [ ] **2.2 — Implement the FULL demo SEQUENCE with assertions (the chunk's bullet list).**
  1. **Seed 3 facts (name/colour/work), Ukrainian:** drive 3 turns (or one multi-statement turn) in thread A — e.g. "Мене звати Ліор", "Люблю синій колір", "Я працюю в IT" — then `close` (dismiss). Assert via `GET /memory/thread/A` (or rawDb in stub) that 3 machine facts exist, each Ukrainian display text (in stub mode the script controls this; in real mode assert non-empty Ukrainian). Assert all share `provenance: "thread:A"`.
  2. **New thread recall (esp. work):** open thread B, ask "Як мене звати?", "Який мій улюблений колір?", "Де я працюю?". Assert each reply recalls the fact AND that `MEMORY_DEBUG`-style retrieve shows the fact injected (the harness can read the store directly to assert the fact is retrievable for B). The **work** fact is the demo's failing case — assert it specifically.
  3. **Stability (headline):** dismiss several more times (open/close B, then C with no new memory-bearing statements). Assert the 3 seeded facts' **row ids are unchanged**, text **byte-identical**, none vanished (rawDb `SELECT id, fact` snapshot before/after).
  4. **Genuine change → only that fact replaced:** in a new thread, state a genuinely-changed preference ("Тепер мій улюблений колір — зелений"). Dismiss. Assert ONLY the colour fact changed (its id may stay if replace-in-place, or a new fact replaces it per the model — assert the OTHER two facts byte-stable + the colour now reflects green).
  5. **Forget ONE fact (HTTP):** `POST /memory/forget` the work fact via the overlay's path. Assert exactly ONE fact gone, the other two remain, source messages byte-intact. **(THIS is the C RED on current code: assert in Step 2 that current code over-deletes — i.e., the harness EXPECTS over-delete pre-fix and flips to expect one-only post-fix. Encode as a clearly-labeled assertion the worker inverts in Step 4.)**
  6. **Recall after forget:** open a new thread, ask "Де я працюю?". Assert the forgotten fact is NOT recalled.
- [ ] **2.3 — Script the stub clientFactory to REPRODUCE B (rewording) and exercise the A race.**
  - **B reproduction:** the scripted client, when the tail contains an ASSISTANT recall reply that restates the colour (e.g. detects the recall pattern), returns an `op:"replace"` with a REWORDED `fact` ("Мій улюблений колір — синій") targeting the existing colour candidate — reproducing the demo's churn on CURRENT code. (Current code applies it → B RED.)
  - **A race:** drive a fast reopen+ask — `close` thread A (fires async distill) then immediately open thread B and ask the recall question WITHOUT awaiting the dismiss-distill settle. The stub makes the distill deterministically slow enough (an `await` micro-delay in the scripted client) to widen the window. Assert that the recall MISSES (reads stale) on current code → A RED. *(Race reproduction is timing-sensitive; if it cannot be made deterministic in stub mode, fall back to asserting the race via the debug-log injection trace + a real-mode reproduction note — see A diagnosis in Step 5.)*
- [ ] **2.4 — RUN the harness (stub mode) on CURRENT code; capture RED.** Run: `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub`. Expected on current code: C over-deletes (all 3 gone on forget-one), B rewords the colour, A misses the recall under the race. **Paste the RED stdout into the PR body** (this is the diagnosis evidence the chunk requires). **Capture the `MEMORY_DEBUG=1` retrieve trace from the A RED run — it is the runtime evidence the orchestrator attaches to the A bus question.** Commit: `feat(memory): v2-06 headless demo-flow harness (stub+real); reproduces C/B/A RED on current code` + trailer + the package.json alias.

**DoD (command-evidence):** `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub` RUNS and reproduces all 3 defects RED (stdout in PR). The harness is NOT in the `bun test` suite (a `scripts/` probe).

### Step 3 — Fix C (forget over-deletes → forget-by-id): plumb `id`, add the `forgetFactById` intent path

**Files:**
- Modify: `packages/daemon/src/memory/store.ts` (add `id` to `DistilledFactRow` + the two SELECTs)
- Modify: `packages/daemon/src/memory/write-gate.ts` (add `forgetFactById`)
- Modify: `packages/daemon/src/memory/hatch.ts` (add `forgetFactById`)
- Modify: `packages/daemon/src/memory/http-routes.ts` (`handleForget`: route `fact_id` present → `forgetFactById`)
- Modify: `packages/daemon/src/memory/history-page.ts` (`renderFacts`: send `fact_id`)
- Tests: `packages/daemon/src/memory/store.test.ts`, `write-gate.test.ts`, `http-routes.daemon.test.ts`

- [ ] **3.1 (RED) Write the store + write-gate forget-by-id tests.**
  - `store.test.ts`: `readDistilledFacts`/`readDistilledFactsForThread` now return rows with a non-empty `id`. (Assert `rows[0].id` is a uuid.)
  - `write-gate.test.ts`: seed **3 machine facts sharing one `thread:t` provenance**; `gate.forgetFactById(idOfFact2, {actor:"user", authored_by:"human"})` → assert **exactly fact2 gone**, facts 1+3 remain, count-equality (`fact_fts`==`distilled_facts`), no orphan `fact_topics`, source messages byte-intact. (RED today: `forgetFactById` does not exist.)
  - `write-gate.test.ts` 5e seam: `gate.forgetFactById(humanFactId, {actor:"agent", authored_by:"machine"})` → refused (human row survives). (For HTTP the ctx is always human, so a human forgetting a human pin is allowed; the machine-refusal guard is the 2c seam.) **v2-07 wording reconciliation (ADR-0012 5a/5e): 5e = machine-ctx CANNOT clobber/delete human-authored facts; 5a = the user (HTTP_CTX, authored_by:human) CAN delete their own facts, including human-authored ones. Both seams are tested: 5e in this test (machine refused), 5a in v2-07 write-gate.test.ts (human allowed).**
  - Run: `bun test packages/daemon/src/memory/write-gate.test.ts packages/daemon/src/memory/store.test.ts` → FAIL.
- [ ] **3.2 (GREEN) Add `id` to `DistilledFactRow` + both SELECTs (`store.ts`).**
  - `DistilledFactRow`: add `id: string;` as the first field (`store.ts:88`).
  - `readDistilledFacts` SELECT (`store.ts:277`): `SELECT id, fact, provenance, …`.
  - `readDistilledFactsForThread` SELECT (`store.ts:446`): `SELECT df.id AS id, df.fact AS fact, …`.
  - (The two `retrieve` mappers in the providers spread/map these rows; they ignore extra fields, so no change needed there — but the debug-log retrieve point can now include `id`.)
- [ ] **3.3 (GREEN) Add `WriteGate.forgetFactById(factId, ctx, reason?)` (`write-gate.ts`).**
  - Resolve the row: `SELECT authored_by FROM distilled_facts WHERE id = ?`. If absent → no-op (idempotent). If `authored_by === 'human'` AND `ctx.authored_by === 'machine'` → refused (5e seam; return without deleting). Else `store.deleteFactById(factId)` (trigger cleans `fact_fts`/`fact_topics`). Call `memDebug("forget", {route:"forgetFactById", target:{factId}, deletedIds:[factId], deletedCount:…})`.
  - Doc: "v2-06 forget-by-id — the precise forget intent (ADR-0015 decision-1 intent dispatch). Deletes exactly the stable-id row; NEVER scrubs messages (B1). The HTTP path is human-ctx, so a human deleting a human pin is allowed; the machine-ctx refusal is the 2c seam. The text/provenance `forgetFact` path is RETAINED for back-compat (no over-delete on the demo path because history.html now sends fact_id). REFINE (Lior): forget-by-id NOW; finer message-level provenance is DEFERRED to the future THREAD-forget."
  - Leave `forgetFact` (text/provenance) byte-intact so all v2-04 tests pass.
- [ ] **3.4 (GREEN) Add `Hatch.forgetFactById(factId, ctx, reason?)` → `gate.forgetFactById` (`hatch.ts`).** One-line delegate, mirroring `forgetFact`.
- [ ] **3.5 (RED) `http-routes.daemon.test.ts`: `target_type:"fact"` + `fact_id` present → deletes exactly that row.** Seed 3 thread-shared-provenance facts via the daemon path; `POST /memory/forget {target_type:"fact", fact_id:<id2>, fact_text, provenance, reason}` → 204; `GET /memory/thread/:id` → 2 facts remain, fact2 gone. Also keep a test that `target_type:"message"` → 400 (unchanged). Run → FAIL.
- [ ] **3.6 (GREEN) `handleForget` routes `fact_id` (`http-routes.ts:144-158`).** In the `target_type === "fact"` branch: if `typeof fact_id === "string" && fact_id` → `deps.hatch.forgetFactById(fact_id, HTTP_CTX, reasonStr)` (then 204); else fall back to the existing `forgetFact(fact_text, provenance, …)` (back-compat for the v2-04 probe). Validate `fact_id` shape defensively (uuid-shaped) before use.
- [ ] **3.7 (GREEN) `history-page.ts renderFacts`: send `fact_id`.** The fact rows now carry `f.id`. In the `forgetBtn` closure (`history-page.ts:377-384`), add `fact_id: factId` to the `doForget` body object, closing over `f.id`. Keep `fact_text`+`provenance` in the body (audit + the READ-affordance provenance display is unchanged).
- [ ] **3.8 (GREEN) Run the C suites + invert the harness C-assertion.** `bun test packages/daemon/src/memory` → PASS. In `memory-demo-harness.ts`, flip the Step-2 "expect over-delete" assertion to "expect exactly one gone, two remain, source intact." Re-run `--mode=stub` → C now GREEN.
- [ ] **3.9 — Commit.** `fix(memory): v2-06 C — forget-by-id (forgetFactById intent path); history.html sends fact id; only the targeted fact deleted` + trailer.

**DoD (command-evidence):** `bun test packages/daemon/src/memory` PASS; harness `--mode=stub` shows C GREEN (forget-one-only); `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty.

### Step 4 — Fix B (fact reworded without a genuine change): tighten the distill input + REPLACE decision

**Files:**
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts` (`SMART_DELTA_SYSTEM_PROMPT` + the tail-text builder role-labelling)
- Tests: `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` + a harness assertion

- [ ] **4.1 (RED) Add a smart-distiller unit test for B.** With a scripted clientFactory and a real store: seed a colour fact; build a new tail = [user: a recall question, assistant: a reply restating the colour]; assert that the distiller, given the candidate, does NOT emit a `replace` that rewords the colour absent a NEW user statement. (Drive via the prompt-contract: assert the tail text passed to the LLM labels the assistant line as non-source — see 4.2 — and add a deterministic stub asserting the registration does not apply a reword. The structural assertion: a tail with NO new USER statement about the colour → the harness's reworded-REPLACE is the defect; the fix makes the distiller's INPUT not invite it.) Run → FAIL on the pre-fix prompt/build.
- [ ] **4.2 (GREEN) Role-label the tail text + tighten the prompt (`smart-distiller-provider.ts`).**
  - The tail text builder (`smart-distiller-provider.ts:511-513`) already emits `[role|id] content`. Strengthen the SYSTEM prompt so the model treats `assistant` lines as **context, not fact sources**: add to `SMART_DELTA_SYSTEM_PROMPT`:
    - "Derive facts ONLY from the USER's statements in the NEW TAIL. ASSISTANT lines are the agent's own replies (often restating remembered facts) — NEVER create or REPLACE a fact based on an assistant line."
    - "Emit op:\"replace\" ONLY when the USER has stated something in THIS new tail that genuinely contradicts a candidate. If the user did not restate or change a fact, do NOT touch its candidate — emit nothing for it. Re-wording an unchanged fact is forbidden."
  - This operationalizes the ADR-0012 amendment's "genuinely-contradicting NEW fact" + spec §3.2 D-V2.5. No store/port change.
- [ ] **4.3 (GREEN) Update the harness B script + assertion.** In `memory-demo-harness.ts`, after the fix, the scripted client (stub mode) must reflect the tightened contract: given a tail with only an assistant recall reply (no new USER colour statement), the distiller emits NO reword. Assert across N dismisses that "Люблю синій колір" stays byte-identical. (In real mode, the real Haiku under the tightened prompt is asserted to keep the colour byte-stable.)
- [ ] **4.4 (GREEN) Run B suites + harness.** `bun test packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` → PASS; harness `--mode=stub` shows B GREEN (no rewording). Commit: `fix(memory): v2-06 B — distill only USER statements; forbid reword/replace of an unchanged fact (no re-distilling agent recall replies)` + trailer.

**DoD (command-evidence):** `bun test packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` PASS; harness `--mode=stub` shows the seeded colour fact byte-stable across N dismisses (B GREEN).

### Step 5 — Fix A (recall inconsistent — the race): diagnose, then implement the BUS-CHOSEN consistency model (bus-gated — LAST)

> **This step is bus-gated. The architect RECOMMENDS option (i) and provides the impl sketch so the worker moves fast once the conductor answers via the dev-bus. Do NOT pick the final answer as a frozen step.**

**Files (recommendation = option (i)):**
- Modify: `packages/daemon/src/index.ts` (gate a new thread's `beginTurn` retrieve on in-flight distillation for threads on the same install) and/or `packages/daemon/src/memory/distiller-registration.ts` (expose the in-flight run promise)
- Tests: `packages/daemon/src/memory/memory-integration.daemon.test.ts` (a race regression test) + a harness assertion

- [ ] **5.1 — Diagnose via the harness + `MEMORY_DEBUG`.** Run `memory-demo-harness.ts --mode=stub` with the fast-reopen race (2.3) and `MEMORY_DEBUG=1`. Confirm from the retrieve log whether, when the recall FAILS, the fact was NOT yet injected (→ race/injection, the hypothesis) vs injected-but-ignored (→ LLM). **Paste the trace into the bus question + PR.** This confirms the mechanism with runtime evidence (not code-reading).
- [ ] **5.2 — Lay out the 3 consistency-model options (route UP via the dev-bus, conductor decides):**
  - **(i) Block retrieve until in-flight distillation commits (ARCHITECT'S RECOMMENDATION).** Mechanism: the distiller-registration's promise-queue already serializes runs (`registerDistiller`'s `lastRun`/`thisRun`, `distiller-registration.ts:308-318`). Expose a way to await any in-flight distillation for a thread (or globally on the install) before `beginTurn` runs `retrieve`. Concretely: have `registerDistiller` return/expose a `whenIdle(): Promise<void>` (resolves when the queue chain settles); in `index.ts`, before the new-thread `retrieve` (the `isNewThread` branch in `beginTurn`), `await hook.whenIdle()` (or a per-thread variant). Cost: a new thread's first turn waits for any pending dismiss-distill — a small latency on the demo's exact reopen pattern; correctness-first. Risk in THIS codebase: low — the queue already exists; this adds an await on an existing promise. **This makes "a new thread's retrieve sees the latest COMMITTED facts" true by construction** — directly answers the chunk's requirement. It is the option that CHANGES the documented contract (→ Spec-note candidate).
  - **(ii) Accept eventual-consistency.** Mechanism: no code change; document that a sub-second reopen may miss the just-distilled fact, recovered on the next thread. Cost: the demo's failing case (fast reopen+ask) can still miss → likely fails Lior's live §6.1 recall step. Risk: re-ships the demo defect. The architect rejects (ii) as the primary because the demo explicitly exercises the fast-reopen path.
  - **(iii) Faster/sync distill.** Mechanism: make the dismiss-distill synchronous/fast enough that the window effectively closes (e.g. for the keyless/dumb-tail path it is already sync; for smart the LLM call is inherently async). Cost: cannot make a real Haiku call synchronous without blocking `close(ws)` longer; only narrows, doesn't close, the window for the smart path. Risk: partial fix; the race still exists under load.
- [ ] **5.3 — Implement the bus-chosen model.** If (i): add `whenIdle()` to the consolidation/registration seam and `await` it before the new-thread retrieve; if (ii): add the documented note + (optional) a retrieve-side staleness log; if (iii): tighten the dismiss-distill path. **Whichever lands, add a regression test** in `memory-integration.daemon.test.ts`: drive dismiss(A)→immediately session_start(B)+recall → assert B's retrieve sees A's just-committed fact (for (i)/(iii)) OR document the accepted staleness (for (ii)). Update the harness A-assertion to GREEN.
- [ ] **5.4 — Gate + commit.** `bun test packages/daemon/src/memory` → PASS; harness `--mode=stub` shows A GREEN. Commit: `fix(memory): v2-06 A — <bus-chosen consistency model>: new-thread retrieve sees latest committed facts` + trailer. If (i) landed, flag the Spec-note candidate to the conductor/Lior in the PR.

**DoD (command-evidence):** `bun test packages/daemon/src/memory` PASS; harness `--mode=stub` A GREEN (recall consistent under fast reopen); bus answer recorded in the PR.

### Step 6 — Final verification + EXECUTED real-LLM harness + escalate the §6.1 re-demo

- [ ] **6.1 — Full green gate (orchestrator-run).** From repo root: `bun test && bun run lint:strict && bun run typecheck` → exit 0. `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` → empty.
- [ ] **6.2 — EXECUTE the harness in BOTH modes (Strike-5; written+typechecked is NOT evidence).** `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub` (deterministic, all defects GREEN) AND `--mode=real` (real Haiku, requires Keychain key + network). **Paste BOTH full stdouts into the PR**, marked "memory-demo-harness: EXECUTED, output below." Real-mode skips-with-clear-message if no key (note it; the conductor re-runs with a key).
- [ ] **6.3 — Push + PR; escalate the §6.1 live re-demo.** Push `chunk/v2-06-debug-env-and-demo-fixes`; open the PR targeting `main`. PR body carries: (a) the Step-2 RED diagnosis stdout, (b) the post-fix GREEN stub+real harness stdouts, (c) the A bus answer + the Spec-note flag if option (i), (d) the demo runbook (reuse v2-05's). **The PR does NOT auto-merge** — Done criterion 3 (Lior's LIVE 9-step re-demo: forget-one-only, consistent recall, STABILITY/no-rewording) is the whole-feature gate; the orchestrator reports DONE-ready / BLOCKED-on-Lior-demo to the ledger and the conductor re-verifies (incl. running the harness) + routes the §6.1 re-demo to Lior. On demo-green, the conductor merges v2-06 (which brings v2-05's flip+migration) and closes PR #67 as subsumed.

**DoD (command-evidence):** repo-root `bun test && bun run lint:strict && bun run typecheck` exit 0; frozen `git diff` empty; harness EXECUTED both modes (stdout in PR); behavioral §6.1 re-demo escalated to Lior — **NOT done until the live demo is green (requires runtime demo to confirm; code-reading/tests/harness are necessary, not sufficient).**

---

## Self-review (chunk coverage)

- **D1 MEMORY_DEBUG (env-gated, off-by-default, 3 stages, no secrets)** → Step 1. ✓
- **D2 harness (real-I/O, WS add-turn + dismiss + HTTP forget/query, full sequence, stub+real, RED→GREEN, not in bun test)** → Steps 2/3/4/5/6. ✓
- **C forget-by-id (history.html sends id; delete one row; thread-shared-provenance test; forget-by-id NOW, message-level provenance DEFERRED)** → Step 3. ✓
- **A diagnose + 3 options + recommendation (i) + bus-gated impl + impl sketch** → Step 5. ✓
- **B (don't rework absent a genuine new user statement; don't distill agent recall replies; harness assertion)** → Step 4. ✓
- **Frozen surfaces (`@agentic/protocol` + `mock-agent.ts`) byte-unchanged; HTTP `fact_id` is additive (not the wire)** → Reality check + every step DoD. ✓
- **Real-I/O, only LLM clientFactory stubbed; no ALTER on live sqlite (none needed); build on current incremental/stable-id/default-smart state** → throughout. ✓
- **ADR worthy: no; Spec-note candidate flagged for option (i)** → headers. ✓
- **Sequencing: D1→D2(RED)→C→B→A(bus, last)** → Steps 1-5. ✓
