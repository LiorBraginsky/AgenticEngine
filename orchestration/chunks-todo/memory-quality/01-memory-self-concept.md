# Chunk 1: Memory self-concept — the agent owns its memory (2a)

**Status:** todo
**Created:** 2026-06-12
**Phase:** memory-quality (spec `docs/specs/2026-06-12-memory-quality.md` §3.1)
**Estimated size:** ~0.5–1 day
**Depends on:** none

## Scope

**In:**
- New `packages/daemon/src/providers/system-prompt.ts` exporting, as ONE module:
  the base prompt (today's hardcoded `SYSTEM_PROMPT` text from
  `anthropic-api-provider.ts:29`), the **memory self-concept paragraph** (spec D1 —
  frozen requirements: truthful-unconditional phrasing; the explicit
  `[remembered]`=past-conversations vs unlabelled=THIS-conversation **discriminator**;
  never-claim-stateless; the user-can-view/edit/delete-via-History mention; the
  **no-fabricated-links** rule), and the **`REMEMBERED_LABEL`** constant.
- `anthropic-api-provider.ts` composes `system = base + self-concept` (same
  cache_control block shape as today).
- `dumb-tail-provider.ts:65` and `fixed-marker-provider.ts:62` replace the hardcoded
  `[remembered] ` literal with the imported `REMEMBERED_LABEL` (no behavior change —
  constant extraction only).
- Tests: prompt-composition unit test (self-concept + discriminator + no-fabricate
  instruction present); label-consistency test (`retrieve()` output prefix === the
  exported label the prompt references).

**Out:** (PIPELINE §7.2 — deliberate cuts, not drift)
- Dynamic `injectedMemory` signal through `ProviderSessionState` — REJECTED per q#002
  Sub-1 (option B): YAGNI; static-always also fixes fact-less threads, which dynamic
  does not buy.
- Memory-side preamble message in `retrieve()` output — REJECTED per q#002 (option C):
  self-concept only when facts injected ⇒ fact-less threads still disown.
- A new/amended ADR — REJECTED per q#002 Sub-2: this *implements* ADR-0012 decisions 1+4;
  the prompt contract is frozen in the spec Lior signs.
- Any change to `mock-provider.ts` / the mock reducer — the mock has no LLM prompt;
  **`mock-agent.ts` reducer + `@agentic/protocol` are FROZEN** surfaces.
- Any `history-page.ts` / UI change — OUT, spec §1 (follow-on feature).

## Done criteria

- [ ] **[mechanical]** `system-prompt.ts` exists; adapter composes it; both memory
      providers import `REMEMBERED_LABEL`; `grep -rn "\[remembered\]" packages/` finds
      the literal ONLY in `system-prompt.ts` (single-sourced).
- [ ] **[mechanical]** prompt-composition + label-consistency tests pass; full
      `bun test` green; `lint:strict` + typecheck exit 0.
- [ ] **[mechanical]** frozen surfaces byte-unchanged (`git diff` empty on
      `packages/protocol/` and the mock reducer).
- [ ] **[behavioral — DEFERRED to the feature-closing Lior demo, spec §5]** meta-question
      ("how does your memory work?") answered with truthful ownership; remembered facts
      attributed to past conversations, same-thread context NOT so attributed; no
      fabricated History links. A probe/test is NOT accepted as proof here — live demo
      only (§6.1; the route lied 5×).

## Orchestrator brief (read by the orchestrator from this file)

```
implement memory-quality chunk 01 per orchestration/docs/specs/2026-06-12-memory-quality.md §3.1 (D1, D2).

Files to touch:
- packages/daemon/src/providers/system-prompt.ts (new)
- packages/daemon/src/providers/anthropic-api-provider.ts (compose system prompt)
- packages/daemon/src/memory/providers/dumb-tail-provider.ts (import REMEMBERED_LABEL)
- packages/daemon/src/memory/providers/fixed-marker-provider.ts (import REMEMBERED_LABEL)
- tests alongside

Done when: DoD above green; spec D1 frozen text-requirements all present in the prompt.

ADRs in scope: ADR-0012 (implements decisions 1+4 — no amendment; see q#002).
Import-direction note: memory/providers already import from ../../providers/ (an existing
edge; no cycle — grill #9). Keep ONE label definition; architect may re-home it if a
cleaner seam appears.
```

## Notes / Open questions

- Exact final prompt wording is architect-time; the five frozen requirements (spec D1)
  are not negotiable without re-opening q#002 on the bus.
- Chunks 02–04 depend on this chunk's shared module + label constant (q#002 Sub-3 —
  strictly sequential; do NOT parallelize).
