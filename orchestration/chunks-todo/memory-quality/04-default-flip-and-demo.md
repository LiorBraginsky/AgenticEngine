# Chunk 4: Default flip + feature-closing live demo (2b cutover)

**Status:** todo
**Created:** 2026-06-12
**Phase:** memory-quality (spec `docs/specs/2026-06-12-memory-quality.md` §3.4 + §5)
**Estimated size:** ~0.5 day
**Depends on:** 01 + 03 (the prompt must be live and the smart provider proven before
the cutover; 03's smoke probe must have been EXECUTED green)

## Scope

**In:**
- **Flip the `MEMORY_PROVIDER` default** `dumb-tail → smart` in
  `memory-provider-selector.ts` (q#001 Sub-4: the flip lives in the LAST 2b chunk).
- **Prove the suite survives the flip** (grill #10): the existing daemon tests run
  keyless → after the flip they exercise the no-key fallback BY DESIGN — assert the full
  suite is still green AND deterministic (no network attempted); add the explicit
  selector tests: default (env unset) = smart; smart-without-key = dumb-tail fallback
  with the loud log.
- **Demo runbook note** (in the PR body / plan closeout — NOT a new doc): env
  preconditions per spec §5 — ANTHROPIC key in Keychain, `LLM_PROVIDER=anthropic-api`,
  `MEMORY_PROVIDER` unset; warn that a missing key silently demos dumb-tail (q#001
  rider c).
- **The feature-closing LIVE demo (Lior, §6.1)** — the behavioral gate for the WHOLE
  feature (steps frozen in spec §5): (1) meta-question → truthful memory ownership;
  (2) "how many times did I say hi?" → precise answer + provenance link → `history.html`;
  (3) forget a message via the hatch → fresh thread proves the fact gone (the §4 hard
  guarantee, live).

**Out:** (PIPELINE §7.2)
- Any UI change incl. `history.html` 🔒 locked-state (UX-A) and token-trim (UX-B) — OUT,
  they move with the in-overlay-UI follow-on feature (spec §1; scope doc SPLIT decision).
- Removing/deprecating dumb-tail — OUT: it stays registered as the swap-proof second
  leg and the no-key fallback.
- Per-chunk live demos for 01–03 — deliberately deferred to THIS chunk's closing demo
  (MF-spec §4 posture: one route-closing demo; intermediates are real-I/O proofs).

## Done criteria

- [ ] **[mechanical]** default = smart; both selector tests green; full `bun test` +
      `lint:strict` + typecheck exit 0 in a keyless environment (fallback path, no
      network).
- [ ] **[mechanical]** frozen surfaces byte-unchanged.
- [ ] **[behavioral — Lior's LIVE demo, §6.1, non-negotiable]** all three spec-§5 demo
      steps pass live on macOS through the real overlay → daemon → store → Anthropic
      path, nothing stubbed. Code-reading, green tests, and prior PASS records are NOT
      evidence (the route lied 5×). The chunk (and the feature) is NOT `done`, and no PR
      auto-merges, until this demo is green.

## Orchestrator brief (read by the orchestrator from this file)

```
implement memory-quality chunk 04 per orchestration/docs/specs/2026-06-12-memory-quality.md §3.4 + §5.

Files to touch:
- packages/daemon/src/memory/memory-provider-selector.ts (default flip)
- selector tests
- PR body carries the demo runbook (env preconditions)

Done when: mechanical DoD green AND Lior's live demo (3 steps, spec §5) signed off.
Sequence the demo BEFORE closeout docs (PIPELINE §6.1). Escalate the demo to Lior via
the conductor — never self-certify.

ADRs in scope: ADR-0012 (the feature's behavioral promise: "one agent that remembers" —
owned, precise, transparent).
```

## Notes / Open questions

- This is the irreversible-feel cutover chunk; it is deliberately tiny so the blast
  radius of the flip is reviewable on its own (grill #10).
