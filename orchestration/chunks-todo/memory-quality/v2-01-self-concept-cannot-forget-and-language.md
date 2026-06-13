# Chunk v2-01: Self-concept "cannot self-forget" + language-preservation prompt

**Status:** todo
**Created:** 2026-06-13
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md` §3.6 D-V6d/D-V6e)
**Estimated size:** ~0.5 day (prompt-only; ships value first, de-risks the series)
**Depends on:** none (independent of the incremental re-architecture — pure system-prompt edits)

## Why this chunk exists

Two of Lior's 2026-06-13 demo findings are prompt gaps, fixable now without touching the distiller:
- **Finding 2 — "cannot self-forget."** Chunk-01's `MEMORY_SELF_CONCEPT` tells the agent the *user*
  can delete via History but never forbids the agent from *claiming to have forgotten*. The agent lied
  "Done! I forgot your name" (it has no such tool — that is roadmap 2c).
- **Finding 3 — distiller language.** Surfaced here as the *prompt-side* preparation: the distiller
  system prompt must instruct user-language preservation (the store-side wiring is v2-03).

## Scope

**In** (spec §3.6 D-V6d/D-V6e):
- Add a frozen clause to `MEMORY_SELF_CONCEPT` (`packages/daemon/src/providers/system-prompt.ts`):
  **"You cannot modify, delete, or forget your own memory. Never claim to have forgotten, changed, or
  deleted something you remember — only the user can, via the History page."** The existing five D1
  requirements (truthful-unconditional, the `[remembered]` discriminator, never-claim-stateless,
  view/edit/delete mention, no-fabricated-links) all REMAIN.
- Add the **language-preservation instruction** to the distiller system prompt constant
  (`SMART_SYSTEM_PROMPT` in `smart-distiller-provider.ts`, or wherever v2-03 will home it): emit the
  display fact in the **user's language**. (Prompt text only here; the `canonical`-vs-display store
  wiring is v2-03 — this chunk just lands the instruction so it's reviewable in isolation.)
- Tests: prompt-composition unit test asserts the new self-concept clause is present; assert the
  language-preservation line is present in the distiller prompt constant.

**Out** (PIPELINE §7.2):
- The actual conversational-forget capability — 2c (out of scope, named).
- Any distiller logic / store change — v2-02+.
- `@agentic/protocol`, `mock-agent.ts` — frozen, untouched.

## §7.1 runtime-coupling note

None. Prompt-string edits only; no shared-state or contract change. (v2-03 consumes the
language-preservation instruction when it wires `canonical` vs display.)

## Done criteria

- [ ] **[mechanical]** the "cannot self-forget" clause present in `MEMORY_SELF_CONCEPT`; the five D1
      requirements still present; language-preservation line present in the distiller prompt constant.
- [ ] **[mechanical]** prompt-composition tests pass; full `bun test` + `lint:strict` + typecheck
      exit 0; frozen surfaces byte-unchanged.
- [ ] **[behavioral — DEFERRED to v2-05 closing demo]** meta "did you forget my name?" → the agent
      honestly says it cannot forget and points to History (no false "Done, I forgot"). NOT a gate
      here — live demo only (§5; the route lied 5×).

## Orchestrator brief

```
implement memory-distiller-v2 chunk v2-01 per docs/specs/2026-06-13-memory-distiller-v2.md §3.6 (D-V6d, D-V6e).
Files: packages/daemon/src/providers/system-prompt.ts (+ the distiller prompt constant) + tests alongside.
Done when: the new clauses present + DoD green. Prompt-only; no distiller/store change.
ADRs in scope: ADR-0012 (implements decisions 1+4; the self-concept honesty the disowning bug + the
demo's false-forget both violate). Frozen: @agentic/protocol, mock-agent.ts.
```

## Notes / Open questions

- Exact wording is architect-time; the "cannot modify/delete/forget own memory + never claim to have"
  semantics are the frozen requirement.
