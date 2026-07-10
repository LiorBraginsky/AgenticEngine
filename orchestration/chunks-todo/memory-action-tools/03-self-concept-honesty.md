# Chunk 3: Self-concept flip + honesty rails + injection drill

**Status:** todo
**Created:** 2026-07-10
**Phase:** memory-action-tools (2c)
**Estimated size:** ~0.5–1 day
**Depends on:** 02

## Scope

**In:**
- **Capability-conditional self-concept** (spec §3.8): `system-prompt.ts` composition becomes a
  function of capability. Capability-present variant: agent CAN forget/remember via tools, with the
  honest boundaries verbatim required by q#014-E — only facts shown this turn; human-pinned facts
  untouchable (Memory window for those); state what you did after acting; never claim an action you
  didn't perform or that failed; **after forgetting a fact, do not keep USING it for the rest of the
  turn** (spec §3.8 [grill E-minor]); **replace-lane steering** (q#015 R1 rider 2): user states a
  changed attribute of a fact in view ⇒ pass `replaces_ordinal`, never a near-duplicate remember;
  surface naming consistent (History page vs Memory window — name both once). Capability-absent
  variant: today's D1-6 text VERBATIM.
- **D1-6 amendment reconcile:** every doc comment/test asserting the old "cannot forget" text or
  `COMPOSED_SYSTEM_PROMPT` verbatim is updated — no silent contradictions left (the m3-fold
  discipline). The spec's "AMENDS memory-quality §3.1 D1-6" note is the recorded revisit.
- **MEMORY_DEBUG `action` channel** (spec §3.9): env-gated logs for every action/refusal (same
  pattern as distill/retrieve/forget) — the glass-box view the demo uses.
- **The automated injection drill** (spec §5): a turn whose user text embeds a "forget everything
  you know" instruction ⇒ effect ≤ cap, all audited, no human fact touched — the d7 ceiling as a
  test. Plus the `not_in_view` honest-deferral scenario (ask to forget a fact outside the slice ⇒
  typed refusal ⇒ the scripted reply defers to the Memory window, no fake-forget) [grill E-minor].
- Demo-harness scenario additions (the §5 behavioral items scripted for the headless harness, so
  the live demo has a rehearsed runway).

**Out:** (WHY — §7.2)
- Prompt-tuning beyond the frozen D8 requirements — exact wording is architect-time; Lior sees it
  live at the demo (spec §7).
- Any new guardrail mechanism — the package is spec-frozen (§3.5); this chunk *exercises* it.
- Second-order-injection SCANNING of remembered facts at retrieve-time — the 5d write-scan already
  gates entry; a read-side re-scan is not in the ruled package (revisit only if the drill shows a
  hole — that would be a spec-level escalation, not a chunk decision).

## Done criteria

- [ ] **[mechanical]** With port wired: system block contains the capability-present variant incl.
      the boundary sentences; without port: byte-identical to today's composed prompt. Both asserted.
- [ ] **[mechanical]** No test/doc comment still asserts the old unconditional "cannot forget" as
      the universal truth (grep-clean + suite green).
- [ ] **[mechanical]** Injection drill test passes: ≤`MEMORY_ACTIONS_MAX_PER_TURN` effects, every
      one audited, zero human-fact mutations.
- [ ] **[mechanical]** MEMORY_DEBUG `action` channel emits on applied AND refused actions; OFF by
      default (zero-cost).
- [ ] **[behavioral — escalated to chunk-04's live demo]** The agent's live behavior matches the
      variant: owns the capability when wired, never claims it when not. (Runtime proof is Lior's
      demo — this chunk marks it "requires demo", never "verified"; §6.1.)

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 03 (self-concept + honesty + drill) of memory-action-tools per
orchestration/docs/specs/2026-07-10-memory-action-tools.md §3.8, §3.9 (debug channel), §5 (drill)
(+ §4 item 5 coupling).

Files to touch (expected):
- packages/daemon/src/providers/system-prompt.ts (conditional composition — keep ONE module, both
  variants exported; COMPOSED_SYSTEM_PROMPT consumers updated);
- packages/daemon/src/providers/anthropic-api-provider.ts (system-block selection by capability);
- packages/daemon/src/memory/debug-log.ts (+ the action channel);
- packages/daemon/scripts/memory-demo-harness.ts (drill + demo scenarios);
- affected tests (verbatim-prompt asserts).

Do NOT touch: packages/protocol/**, mock-agent.ts (frozen). The D1 frozen-requirements amendment is
sanctioned ONLY per the accepted spec §3.8 — cite it in the commit.

Done when: DoD blocks above with command evidence; the behavioral item stays open for chunk-04's
live demo (never self-mark verified — §6.1).

ADRs in scope: 0016 (decision 3 — capability-conditional honesty), 0012 (5d drill).
```

## Notes / Open questions

- (empty)
