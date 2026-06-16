# Memory v2-01 — Self-Concept "cannot self-forget" + Distiller Language Preservation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two pure system-prompt-string edits — add a frozen "cannot self-forget" clause to `MEMORY_SELF_CONCEPT`, and add a language-preservation instruction to the distiller prompt — each gated by prompt-composition unit tests. No distiller logic, store, or protocol change.

**Architecture:** Both prompt assets are pure exported string constants in leaf modules. `MEMORY_SELF_CONCEPT` lives in `packages/daemon/src/providers/system-prompt.ts` and flows into `COMPOSED_SYSTEM_PROMPT` by string concatenation. `SMART_SYSTEM_PROMPT` lives in `packages/daemon/src/memory/providers/smart-distiller-provider.ts` and is the `system` text the distiller sends to Haiku. Both edits are additive string content; existing tests already assert composition shape and byte-equality, so the change surface is the constants plus new content-assertion tests.

**Tech Stack:** TypeScript, Bun (`bun:test`), no new dependencies.

---

## Reality check

Every claim in the brief verified against source. File paths absolute.

**D-V6d target — `MEMORY_SELF_CONCEPT` (the self-concept clause):**
- `packages/daemon/src/providers/system-prompt.ts`
  - (a) `MEMORY_SELF_CONCEPT` **exists** — exported const, lines 26–36. Confirmed.
  - (b) **All five D1 requirements present** in the current text (lines 27–36):
    - D1-1 truthful/unconditional: `"You are one persistent agent with memory across conversations with this user — not a stateless model."` (line 27)
    - D1-2 `[remembered]` discriminator: lines 28–31.
    - D1-3 never-claim-stateless / nothing-relevant: lines 32–33.
    - D1-4 view/edit/delete via History page: line 34.
    - D1-5 no-fabricated-links: lines 35–36.
  - (c) **Where the new clause sits:** additive; recommended placement immediately after the D1-4 view/edit/delete sentence and before the D1-5 no-link sentence — topically adjacent to the user-ownership/History affordance. Placement non-load-bearing as long as all five D1 sentences remain; tests assert content presence, not order.
- Module header docstring already says it "Implements ADR-0012 decisions 1+4." Add a D1-6 comment line for the new clause (doc hygiene).

**D-V6e target — the distiller prompt constant (language preservation):**
- Constant confirmed: **`SMART_SYSTEM_PROMPT`**, exported, in `packages/daemon/src/memory/providers/smart-distiller-provider.ts` (lines 51–67).
- **No** existing language/locale/translate instruction. Genuinely new.
- **Placement:** append a bullet to the existing "Rules:" list. References the `fact` field the v1 prompt already emits; **must not** introduce a `canonical` field — that wiring is v2-03, out of scope.

**Interaction with an existing distiller test (load-bearing):**
- `smart-distiller-provider.test.ts:603-619` asserts captured `system` text **equals the imported `SMART_SYSTEM_PROMPT`** byte-for-byte. Because it compares against the *imported constant* (not a literal), editing the constant keeps this test green automatically — no edit required. The new test asserts the language instruction is *present in the constant*; the byte-equality test continues to prove the constant is what reaches the LLM.

**Existing prompt-composition test file to extend (Task 1):**
- `packages/daemon/src/providers/system-prompt.test.ts` — exists, organized as `describe` blocks per D1 requirement. The five existing D1 `describe` blocks are the regression guard that the five requirements REMAIN — must stay untouched and green.

**Frozen surfaces — confirmed NOT touched:**
- `@agentic/protocol` — not imported or edited. Byte-unchanged.
- `mock-agent.ts` — not referenced, not edited. Byte-unchanged.

**Behavioral DoD (meta "did you forget my name?" honesty):**
- **requires runtime demo to confirm — DEFERRED to v2-05 closing demo** (spec §5). This chunk lands prompt *text* only; the live-model honesty is a runtime fact not assertable from prompt-string edits or unit tests (PIPELINE §6.1). Unit tests prove only the clause text is present — necessary, not sufficient. Do NOT record this chunk as having "verified honest self-concept."

## File Structure

- Modify: `packages/daemon/src/providers/system-prompt.ts` — add the "cannot self-forget" clause to `MEMORY_SELF_CONCEPT` + a D1-6 header comment line.
- Modify: `packages/daemon/src/providers/system-prompt.test.ts` — add a `describe` block asserting the new clause is present and additive.
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts` — add a language-preservation bullet to `SMART_SYSTEM_PROMPT`.
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts` — add a test asserting the language instruction is present.

No new files. No new dependencies.

## ADR worthy: no

Implements **already-accepted** ADR-0012 decisions 1+4 (the 2026-06-13 re-derivability amendment). No new protocol choice, no new dependency, no new architectural boundary — both edits are additive string content inside two existing leaf prompt modules. An ADR for a prompt-string clause realizing an already-accepted decision would be ledger noise.

## Steps

### Task 1: Add the "cannot self-forget" clause to `MEMORY_SELF_CONCEPT` (D-V6d)

**Files:**
- Modify: `packages/daemon/src/providers/system-prompt.ts:16-36`
- Test: `packages/daemon/src/providers/system-prompt.test.ts`

- [ ] **Step 1: Write the failing test** — append a `describe("D-V6d — self-concept cannot self-forget")` block to the END of `system-prompt.test.ts`, asserting:
  - `MEMORY_SELF_CONCEPT` contains `"You cannot modify, delete, or forget your own memory."`
  - `MEMORY_SELF_CONCEPT` contains `"Never claim to have forgotten, changed, or deleted something you remember — only the user can, via the History page."`
  - ADDITIVE guard: D1-4 view/edit/delete text (`"view, edit, and delete"`) still present alongside the new clause.
  - `COMPOSED_SYSTEM_PROMPT` carries the clause through composition.

- [ ] **Step 2: Run test to verify it fails** — `bun test packages/daemon/src/providers/system-prompt.test.ts` → the four new D-V6d tests FAIL (substring-not-found); all pre-existing D1 tests PASS.

- [ ] **Step 3: Write minimal implementation** — insert the verbatim frozen clause (two sentences) into `MEMORY_SELF_CONCEPT` between the D1-4 sentence and the D1-5 sentence:
  ```
  'You cannot modify, delete, or forget your own memory. ' +
  'Never claim to have forgotten, changed, or deleted something you remember — only the user can, via the History page. ' +
  ```
  Also add a D1-6 line to the header comment block.

- [ ] **Step 4: Run test to verify it passes** — all D-V6d tests pass; all five existing D1 `describe` blocks still PASS (clause is additive, not a replacement); `COMPOSED_SYSTEM_PROMPT` composition test still PASS.

- [ ] **Step 5: Commit** (`feat(memory): self-concept cannot-self-forget clause (v2-01 D-V6d)`, with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer).

### Task 2: Add the language-preservation instruction to `SMART_SYSTEM_PROMPT` (D-V6e)

**Files:**
- Modify: `packages/daemon/src/memory/providers/smart-distiller-provider.ts:51-67`
- Test: `packages/daemon/src/memory/providers/smart-distiller-provider.test.ts`

- [ ] **Step 1: Write the failing test** — add a `describe("D-V6e — distiller language preservation")` block asserting:
  - `SMART_SYSTEM_PROMPT.toLowerCase()` contains `"user's language"` and `'"fact"'`.
  - SCOPE guard: `SMART_SYSTEM_PROMPT.toLowerCase()` does NOT contain `"canonical"` (that is v2-03).

- [ ] **Step 2: Run test to verify it fails** — the language test FAILS (`"user's language"` not found); the canonical-guard PASSES; existing byte-equality test PASSES.

- [ ] **Step 3: Write minimal implementation** — add one bullet to the "Rules:" list inside `SMART_SYSTEM_PROMPT` (after `If no facts are extractable, output [].`), instructing: write each `"fact"` in the SAME language the user used (e.g. Ukrainian conversation → Ukrainian `"fact"`); do not translate to English. Must NOT mention `canonical`.

- [ ] **Step 4: Run test to verify it passes** — both D-V6e tests pass; the byte-equality test at line 619 still PASSES (compares against the imported, now-updated constant).

- [ ] **Step 5: Commit** (`feat(memory): distiller emits fact in user's language (v2-01 D-V6e)`, with the trailer).

### Task 3: Full-suite + lint/typecheck gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test packages/daemon` → entire daemon suite green; no test-count drop.
- [ ] **Step 2:** `bun run lint:strict && bun run typecheck` → no new lint/type errors.
- [ ] **Step 3:** `git diff --name-only main` → exactly the four files (two prompt modules + two test files). **Neither `packages/protocol/**` nor `mock-agent.ts` appears.** If either appears → STOP, freeze gate.

## Notes for the worker / orchestrator

- **Behavioral DoD is NOT closed by this chunk.** The "did you forget my name?" honesty and the Ukrainian-fact live behavior are runtime facts requiring a live demo — **DEFERRED to the v2-05 closing demo**. Tests prove only the text is present.
- **No new dependency, no protocol change, no store/distiller-logic change.**
- **The distiller language instruction deliberately omits `canonical`** — that match-key column + prompt field are v2-03. Task 2 Step 1's second test enforces this scope boundary.

## Status: review-complete — ready-to-merge

- Task 1 (D-V6d self-concept clause): DONE — RED→GREEN, all five D1 requirements preserved.
- Task 2 (D-V6e distiller language line): DONE — RED→GREEN, `canonical` JSON-field scope-guard holds.
- Task 3 (full-suite + lint/typecheck gate): DONE — `bun test` 456/0 · typecheck exit 0 · lint:strict exit 0 · frozen (`@agentic/protocol`, `mock-agent.ts`) byte-unchanged.
- Review: `engine-reviewer` CLEAN — 0 blockers / 0 majors. 2 cosmetic nits folded (import consolidation + test-header docstring parity). Worker `'"canonical"'` test-reconciliation adjudicated SOUND; the 3 `'await' has no effect` LSP hints confirmed PRE-EXISTING (blame → `3d274ab` on `main`).
- Behavioral DoD (live "did you forget my name?" honesty + Ukrainian-fact runtime) DEFERRED to the v2-05 closing demo — NOT closed by this chunk.
- Crawl rung: ready-to-merge; conductor (Jimmy) re-verifies on a clean checkout and executes the merge (no self-merge). Plan archived at feature closeout.
