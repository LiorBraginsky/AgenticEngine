# Chunk v2-05: Migration + default cutover + feature-closing live demo

**Status:** todo
**Created:** 2026-06-13
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md` §3.8, §5, §6)
**Estimated size:** ~1 day
**Depends on:** v2-04 (+ implicitly v2-01..v2-03). **The LAST chunk** of memory-distiller-v2.

> **Gated by §5.2** (rides the spec + amendment acceptance). The behavioral demo is the WHOLE feature's
> gate — Lior signs it live.

## Why this chunk exists

Cut the incremental distiller in as the default, migrate off the known-bad global-reprojection facts,
and close the feature on Lior's LIVE demo proving the headline: **stability**.

## Scope

**In** (spec §3.8 D-V8, §5, §6):
- **One-time migration script/probe** (NOT auto-on-startup): wipe machine `distilled_facts`
  (known-bad: churned + wrong-language); **HUMAN facts preserved** (5e — never wiped); rebuild
  `fact_fts` + `fact_topics`. The **ordered-replay** (re-distill chronologically to reseed) is OPTIONAL;
  "wipe + re-distill forward" is an equally-fine default. **Report `forgotten_facts` rows with zero
  match during replay** (resurrection risk — [grill m2]). **Verified on a real sqlite** (q#011 rider).
- **Flip the default** to the incremental distiller in `memory-provider-selector.ts`. **No-key fallback
  keeps the suite green + deterministic** (keyless env exercises the DumbTail delta fallback BY DESIGN);
  add the explicit selector tests (default = incremental; no-key = dumb-tail fallback with the loud log).
- **Demo runbook note** in the PR body (env: ANTHROPIC key in Keychain, `LLM_PROVIDER=anthropic-api`,
  the incremental provider active).
- **The feature-closing LIVE demo (Lior, §6.1)** — the behavioral gate for the WHOLE feature:
  1. meta-question → truthful memory **ownership** AND **no false "I forgot that"** [finding 2];
  2. structured recall → **precise** answer + provenance link → `history.html`;
  3. **STABILITY live** [finding 1, the headline]: dismiss several times → "my name is Lior" and other
     facts **stay put** — no churn, reorder, or vanishing; a genuinely-changed preference DOES update;
  4. **forget a fact** → durable (gone, **source byte-intact**);
  5. **message-forget** (HARD) + **option-B** "also forget sources" with the **co-fed-count confirm**;
  6. a **Ukrainian** turn → a **Ukrainian** display fact [finding 3].

**Out** (PIPELINE §7.2):
- In-overlay UI; `history.html` 🔒/token-trim UX — move with the in-overlay follow-on.
- Removing DumbTail — stays as the keyless fallback + swap-proof leg.
- `@agentic/protocol`, `mock-agent.ts` — frozen.

## §7.1 runtime-coupling note

The migration rewrites the live `~/.agentic-engine/memory.sqlite` — its own real-sqlite verification
(q#011 rider). The default flip changes which provider the daemon constructs; the keyless fallback path
is the suite's deterministic guarantee.

## Done criteria

- [ ] **[mechanical]** migration script: machine facts wiped, human facts preserved, derived tables
      rebuilt, resurrection-risk reported; **verified on a real sqlite** (output in PR).
- [ ] **[mechanical]** default = incremental; both selector tests green; full `bun test` + `lint:strict`
      + typecheck exit 0 in a keyless env (fallback, no network); frozen surfaces byte-unchanged.
- [ ] **[behavioral — Lior's LIVE demo, §6.1, non-negotiable]** all six steps pass live on macOS through
      the real overlay → daemon → store → Anthropic path, nothing stubbed — **especially step 3
      (STABILITY): repeated dismisses do not churn/reorder/vanish facts.** Code-reading, green tests, and
      prior PASS records are NOT evidence (the route lied 5×). The feature is NOT `done`, and no PR
      auto-merges, until this demo is green.

## Orchestrator brief

```
implement memory-distiller-v2 chunk v2-05 per docs/specs/2026-06-13-memory-distiller-v2.md §3.8 + §5 + §6.
PRECONDITION: spec + ADR-0012 amendment accepted by Lior (§5.2).
Files: a migration script/probe (logged, run deliberately), memory-provider-selector.ts (default flip),
selector tests; PR body carries the demo runbook + the migration real-sqlite output.
Done when: mechanical DoD green AND Lior's live demo (esp. the STABILITY step) signed off. Sequence the
demo BEFORE closeout docs (§6.1). Escalate the demo to Lior via the conductor — never self-certify.
ADRs in scope: ADR-0012 + the 2026-06-13 amendment (stability is the demoed promise) + ADR-0015 (forget steps).
Frozen: @agentic/protocol, mock-agent.ts.
```

## Notes / Open questions

- Whether to run the ordered-replay or start clean is Lior's call at demo time (he has a backup).
- This is the irreversible-feel cutover; kept separate so the flip's blast radius is reviewable alone.
