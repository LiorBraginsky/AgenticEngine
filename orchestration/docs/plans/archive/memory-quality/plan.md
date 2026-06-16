# Plan — memory-quality chunk 01: Memory self-concept (2a)

## Status: Review-complete — ready-to-merge (Phase 3; awaiting Jimmy clean-checkout re-verify + merge, crawl rung §11.4)

> Reviewer (engine-reviewer) verdict 2026-06-12: **CLEAN — 0 blockers**. One non-blocking
> NIT (requirement-(3) absence-coverage test uses an OR — test-robustness only, reviewer
> said "no change required"; left as-is to avoid churn, noted in PR). All 5 frozen D1
> requirements present + unambiguous; `REMEMBERED_LABEL` byte-identical; `cache_control`
> shape preserved; single-source confirmed; no frozen-surface/scope violations.
>
> Orchestrator independent re-verification (§6.2 command evidence, not worker assertion):
> `bun test` 250 pass/0 fail · `typecheck` exit 0 (the stale LSP `system-prompt.js`
> diagnostic was a false alarm — tsc resolves it) · `lint:strict` exit 0 · frozen
> `packages/protocol/` + `mock-agent.ts` diff = 0 lines · prod-scoped grep → only
> `system-prompt.ts`. Behavioral DoD #4 DEFERRED to chunk-04 demo (spec §5) — not a chunk-01 gate.

**Chunk:** `orchestration/chunks-todo/memory-quality/01-memory-self-concept.md`
**Spec:** `orchestration/docs/specs/2026-06-12-memory-quality.md` §3.1 (D1, D2)
**Branch:** `chunk/01-memory-self-concept`
**Baseline for review:** `main`

---

## Orchestrator notes (read alongside the architect content)

### DoD tagging (Phase 0, drives the §6 verified-done gate)
- DoD #1 (grep single-source) — **mechanical**
- DoD #2 (tests + lint:strict + typecheck) — **mechanical**
- DoD #3 (frozen surfaces byte-unchanged) — **mechanical**
- DoD #4 (meta-question truthful ownership) — **behavioral, DEFERRED** to the
  feature-closing Lior demo (chunk 04, spec §5). **NOT a merge gate for chunk 01.**
  → chunk 01 merges on the 3 mechanical criteria + reviewer-clean + frozen byte-unchanged.

### DoD #1 grep — reading + assumption (§7.2: flagged transparently, not bus-blocked)
The frozen DoD #1 command is `grep -rn "\[remembered\]" packages/` → literal ONLY in
`system-prompt.ts`. Five existing **test** files legitimately assert the on-the-wire
`[remembered] ` string as a wire-contract guard (a wire-contract test SHOULD pin the
literal, not silently follow a renamed constant). Reading the DoD's parenthetical
"(single-sourced)" as **production-code single-source** (its evident intent), the
verification command is run **production-scoped**:
`grep -rn "\[remembered\]" packages/ -- ':!*.test.ts'` → expect hits ONLY in
`system-prompt.ts`. Rationale: the literal-command reading would force out-of-scope edits
to 3 integration test files NOT in the chunk's file list (scope expansion); the
production-scoped reading keeps the chunk within its named files and serves the DoD intent
exactly. Cheap to reverse. **Flagged in the PR + the conveyor report so Lior/reviewer can
veto.** If Lior prefers the literal unscoped grep, the fix is to make all test assertions
import `REMEMBERED_LABEL` — a small follow-up, at the cost of weakening those wire-contract
guards.

### Grilling gate — skipped (judgment, recorded)
The plan *implements* ADR-0012 decisions 1+4; it does not contradict the ADR,
concept.md, or architecture.md. The design decisions are FROZEN in the Lior-signed spec
§3.1 (D1/D2) and were already adversarially grilled at decompose (engine-reviewer
grill #1–12, cited in the spec). The plan introduces no new decision touching ADR-0012's
substance (`## ADR worthy: no`, confirmed against the frozen q#002 Sub-2 rejection). A
re-grill would re-litigate frozen-and-accepted decisions → skipped.

### Plan-escalation (§7.2 citation test) — not triggered
The plan fits the decompose-blessed chunk, cites no frozen conflict it intends to break,
and introduces no new scope. Proceeds autonomously to Phase 2 (PIPELINE §5.2, narrowed
2026-06-06). The one DoD-reading above is noted, not a blocker.

---

## Requirements

**R1.** New module `packages/daemon/src/providers/system-prompt.ts` is the single source
for three string assets, exported as one module:
- `BASE_SYSTEM_PROMPT` — today's "concise assistant" text, moved verbatim from
  `anthropic-api-provider.ts:29-30`.
- `MEMORY_SELF_CONCEPT` — the self-concept paragraph satisfying all five frozen D1 requirements.
- `COMPOSED_SYSTEM_PROMPT` — `BASE_SYSTEM_PROMPT + "\n\n" + MEMORY_SELF_CONCEPT`.
- `REMEMBERED_LABEL` — the `[remembered] ` prefix literal (trailing space), single-sourced.

**R2.** `anthropic-api-provider.ts` sends `COMPOSED_SYSTEM_PROMPT` as the `system` block,
preserving the exact existing `cache_control` block shape
(`system: [{ type: "text", text, cache_control: { type: "ephemeral" } }]`). Caching unchanged.

**R3.** `dumb-tail-provider.ts:65` and `fixed-marker-provider.ts:62` build injected content
from `REMEMBERED_LABEL + f.fact`. **Byte-identical behavior** — `REMEMBERED_LABEL` MUST
equal `"[remembered] "` so existing `retrieve()` output is unchanged.

**R4.** The five frozen D1 text requirements all survive in `MEMORY_SELF_CONCEPT`:
(1) truthful+unconditional "one persistent agent with memory across conversations with this
user"; (2) the `[remembered]`=past vs unlabelled=THIS-conversation discriminator;
(3) never-claim-stateless / "if no `[remembered]` messages appear, nothing relevant is
remembered"; (4) view/edit/delete via the History page; (5) no-fabricated-links rule.

**R5.** Two named tests: (a) prompt-composition; (b) label-consistency.

**R6.** Frozen surfaces byte-unchanged: `@agentic/protocol`, `mock-agent.ts` reducer. No
`history-page.ts`/UI change. No new/amended ADR. No new dependency. No `ProviderSessionState`
change (static-always placement).

**R7.** Single-source the `[remembered]` literal in production code (DoD #1; see
Orchestrator notes for the grep scope reading).

---

## Reality check (architect — code paths verified)

- `anthropic-api-provider.ts` — `SYSTEM_PROMPT` const at **lines 29-30**; sent in the
  `system: [...]` array at **lines 284-290** with `cache_control: { type: "ephemeral" }`
  (line 288). Adding the self-concept does NOT change the cache-block *shape* (R2).
- `dumb-tail-provider.ts` — `` `[remembered] ${f.fact}` `` at **line 65**.
- `fixed-marker-provider.ts` — `` `[remembered] ${f.fact}` `` at **line 62**, doc-comment at 49.
- Import seam: both memory providers already `import type { SessionMessage } from
  "../../providers/provider.js"` (the `memory/providers → providers/` edge exists, type-only
  today); importing the value `REMEMBERED_LABEL` rides the SAME direction. No cycle
  (`system-prompt.ts` is a leaf — imports nothing from `memory/`).
- `mock-provider.ts` has no LLM system prompt — untouched.
- **The literal also appears in 5 test files + a duplicated base prompt in
  `anthropic-api-provider.test.ts:54-55,101`** → see DoD #1 grep reading above. Behavioral
  D1 claims remain DEFERRED to Lior's live demo (spec §5) — nothing here "verified" behaviorally.

---

## Design (architect)

### Module shape — `providers/system-prompt.ts`
Pure data module: no imports, no I/O, only exported string constants. Lives in `providers/`
(not `memory/`) because the import edge already runs `memory/providers → providers/`.
- `BASE_SYSTEM_PROMPT` = verbatim current text.
- `MEMORY_SELF_CONCEPT` = the D1 paragraph (Step 1).
- `COMPOSED_SYSTEM_PROMPT` = `${BASE_SYSTEM_PROMPT}\n\n${MEMORY_SELF_CONCEPT}` — derived
  in-module so composition is testable without constructing a provider.
- `REMEMBERED_LABEL = "[remembered] " as const` — `as const` pins the literal type so a
  drift (e.g. dropping the space) is a compile-time signal.

### Adapter composition
Delete local `SYSTEM_PROMPT` (29-30); `import { COMPOSED_SYSTEM_PROMPT } from
"./system-prompt.js"`; change only `text: SYSTEM_PROMPT` (line 287) → `text:
COMPOSED_SYSTEM_PROMPT`. `cache_control` + array-of-one-block shape untouched.

### Memory providers consume the label
Both: `import { REMEMBERED_LABEL } from "../../providers/system-prompt.js"`; replace the
hardcoded literal at the cited lines; reword the `fixed-marker-provider.ts:49` doc comment
to keep the production grep crisp.

### Import-seam decision
**Keep the constant in `providers/system-prompt.ts`** (no re-home). Rides the existing edge,
no new boundary, no cycle (leaf module). Re-homing one 13-char string to a new shared module
would be ADR-adjacent churn — rejected.

### cache_control preservation (explicit)
Before & after: `system: [{ type: "text", text: <prompt>, cache_control: { type:
"ephemeral" } }]`. Only `<prompt>` changes base → composed. The adapter test guard
(Step 4) adds an explicit cache_control-shape assertion.

---

## Steps

### Step 1 — Create `system-prompt.ts` with the four constants
**Files:** create `packages/daemon/src/providers/system-prompt.ts`
`BASE_SYSTEM_PROMPT` verbatim. `MEMORY_SELF_CONCEPT` paragraph carrying all five D1
requirements (architect reference wording — refine for clarity, all five must survive):

> You are one persistent agent with memory across conversations with this user — not a
> stateless model. Messages prefixed with "[remembered] " are your own recollections
> distilled from PAST conversations with this user; any earlier messages WITHOUT that
> prefix are part of THIS current conversation. Attribute a fact to past conversations
> only when it arrived as a "[remembered] " message — never describe same-conversation
> context as something you "remembered." If no "[remembered] " messages are present,
> then nothing relevant has been remembered for this turn — do NOT claim you are
> stateless or that you cannot remember anything. The user can view, edit, and delete
> everything you remember from the History page. Never invent, fabricate, or write out
> a History link yourself: whenever you actually use a remembered fact, the link to its
> source is attached for you automatically after your reply.

`COMPOSED_SYSTEM_PROMPT` = base + `"\n\n"` + self-concept. `REMEMBERED_LABEL = "[remembered] " as const`.

### Step 2 — Prompt-composition test (RED→GREEN)
**Files:** create `packages/daemon/src/providers/system-prompt.test.ts`
Assert: composed = base + "\n\n" + self-concept; contains base; all five D1 requirements
present (truthful phrase, discriminator, never-stateless, History view/edit/delete,
no-fabricate). See Test plan.

### Step 3 — Wire the adapter + the two memory providers to the module
**Files:** modify `anthropic-api-provider.ts` (remove 29-30; import + use
`COMPOSED_SYSTEM_PROMPT` at 287); modify `dumb-tail-provider.ts` (import + line 65); modify
`fixed-marker-provider.ts` (import + line 62 + reword comment 49).
Run `bun test packages/daemon/src/memory/providers/` — existing `retrieve` tests stay GREEN
unchanged (proves R3 byte-identical). Run production-scoped single-source grep → one file.

### Step 4 — Label-consistency test + adapter-test prompt assertion (final gate)
**Files:** append label-consistency test to `dumb-tail-provider.test.ts`; modify
`anthropic-api-provider.test.ts` (replace duplicated `SYSTEM_PROMPT` 54-55 with import of
`COMPOSED_SYSTEM_PROMPT`; update line 101 to assert `sysBlocks[0].text ===
COMPOSED_SYSTEM_PROMPT`; add cache_control-shape assertion).
Run full `bun test`, `bun run lint:strict`, `bun run typecheck` — exit 0. Confirm `git diff`
empty on `packages/protocol/` and the mock reducer.

---

## Test plan (architect)

**Test (a) — prompt-composition** (`providers/system-prompt.test.ts`, NEW): assert
`COMPOSED_SYSTEM_PROMPT` equals `base + "\n\n" + self-concept`, contains base, and contains
each of the five D1 requirements (truthful phrase; discriminator `[remembered]` + THIS-
conversation; never-stateless + "nothing relevant has been remembered"; "view, edit, and
delete" + "History page"; "Never invent, fabricate, or write out a History link").

**Test (b) — label-consistency** (appended to `memory/providers/dumb-tail-provider.test.ts`):
insert a fact, `retrieve()`, assert `slice[0].content.startsWith(REMEMBERED_LABEL)` and
`REMEMBERED_LABEL === "[remembered] "` (the wire-byte pin).

**Carried regression guards (stay GREEN, R3):** `dumb-tail-provider.test.ts:81`,
`fixed-marker-provider.test.ts:78,124`; `anthropic-api-provider.test.ts` happy-path (only the
prompt-text assertion updated in Step 4).

---

## ADR worthy: no
Confirmed. Implements ADR-0012 decisions 1+4; prompt contract frozen in the signed spec
§3.1 D1/D2; q#002 Sub-2 explicitly REJECTED a new/amended ADR. No new protocol choice, no
new dependency, no new boundary.
