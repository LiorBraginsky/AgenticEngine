# Chunk 4: Memory-window audit render + E2E closeout + Lior's live demo

**Status:** todo
**Created:** 2026-07-10
**Phase:** memory-action-tools (2c)
**Estimated size:** ~1 day (+ the live demo session)
**Depends on:** 03

## Scope

**In:**
- **The minimal Memory-window audit render (spec §3.9 D9b; q#015 Ruling 2):** the overlay Memory
  window gains a render-only events-list addition (the audit trail incl. refusals + D6e
  re-assertions) + agent-vs-distiller attribution rendered FROM the audit trail. Consumption of the
  additive `GET /memory/thread/:id` field is TYPE-CHECKED (additive-on-wire ≠ additive-on-type —
  no casting past). **NO new interaction affordances** (render-only).
- **Full-path wiring proof through the real daemon:** one EXECUTED end-to-end probe over the real
  WS path (real overlay or the WS test client): turn in → real tool-forget → Memory window (overlay
  memory API) shows the fact gone + the audit event present. Not a unit re-run — the production
  boundary (Strike-4/5 lineage: a probe is evidence only when executed).
- **Frozen-surface evidence for the PR:** `git diff` byte-empty on `packages/protocol/**` + the mock
  reducer, pasted as command output.
- **Docs reconcile staged for closeout** (applied at verified-done, per the archive ritual):
  memory-backlog §B → shipped note; roadmap "Memory — next" 2c tick; open-cases #3 (A′ tail) note
  that the 2c lever now exists.
- **Lior's LIVE feature-closing demo** (§6.1, non-negotiable) — spec §5 behavioral items 1–5:
  1. «забудь, що я казав про X» → truthful ack; fact visibly GONE in the Memory window; audit event
     visible.
  2. Dismiss that thread, new thread → X does NOT re-derive (d5 live).
  3. Forget-request on a Lior-pinned fact → honest 5e refusal naming the Memory window.
  4. Bounded-injection drill live: pasted "forget everything" text → ≤cap audited effect,
     recoverable by re-statement (d7 ceiling demonstrated).
  5. «запам'ятай Y» → fact in the Memory window with agent provenance; a NEW thread sees Y
     (immediacy); re-stating Y with a changed attribute → REPLACE, not a duplicate.
- Demo env preconditions verified BEFORE the demo (the memory-quality scar): ANTHROPIC key
  (Keychain), `LLM_PROVIDER=anthropic-api`, incremental provider active, fresh-enough store agreed
  with Lior, `MEMORY_DEBUG` available.

**Out:** (WHY — §7.2)
- Any new capability/fix beyond what 01–03 shipped — a demo-found defect goes back as a fix task or
  escalates (§5.2), never silent scope growth in the closeout chunk.
- Overlay UI changes BEYOND the D9b render-only events addition — the earlier draft said "Memory
  window consumed as-is"; that OUT-clause was **deliberately corrected at decompose** (q#015
  Ruling 2: without a visible surface, d1's audit-not-confirm degrades to audit-nobody-sees). New
  interaction affordances stay OUT because 2c's UI budget is render-only by that same ruling.

## Done criteria

- [ ] **[mechanical]** Executed real-daemon E2E probe output in the PR (WS turn → tool → store →
      Memory-window API), fresh store.
- [ ] **[behavioral]** The Memory window renders the audit events list + agent attribution (part of
      the live demo — items 1 and 5); typecheck proves the additive-field consumption (no casts).
- [ ] **[mechanical]** Frozen byte-diff evidence pasted; full suite + `lint:strict` + typecheck
      green on the final branch.
- [ ] **[behavioral]** Lior's live demo: all five §5 items GREEN, signed by Lior (§6.1). This is
      the feature's behavioral DoD — no code-reading substitute, no prior-green substitute.
- [ ] **[mechanical]** Closeout ritual staged: backlog/roadmap reconcile committed; chunks 01–04
      archived per §4.4 by the orchestrator after verified-done.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 04 (e2e closeout + demo) of memory-action-tools per
orchestration/docs/specs/2026-07-10-memory-action-tools.md §5 (behavioral 1–5) + §6.

Files to touch (expected):
- apps/overlay/src/memory/ (render-only events-list addition + attribution; typed consumption of
  the additive field — spec §3.9 D9b; NO new interaction affordances);
- packages/daemon/scripts/ (the e2e probe, if the existing harness doesn't cover the WS path);
- orchestration/docs/memory-backlog.md + orchestration/docs/roadmap.md (closeout reconcile);
- NO other product-code changes — a defect found here routes back per §7.2, it does not get
  patched inline in the closeout chunk.

Sequence the LIVE DEMO before any closeout docs claim done (§6.1 — the recurring scar). The demo
script is spec §5 items 1–5; verify the demo env preconditions first.

Done when: probe + byte-diff evidence in the PR, Lior's live sign-off recorded, reconcile staged.

ADRs in scope: 0016 (this demo is its behavioral proof), 0012 (5a/5d/5e live), 0015 (d.6 live).
```

## Notes / Open questions

- If demo item 2 (no-re-derivation) flakes on LLM non-determinism, the deterministic echo-stub test
  (chunk-01) remains the mechanical anchor; the live item demonstrates the real path — flag, don't
  hand-wave, if they diverge.
