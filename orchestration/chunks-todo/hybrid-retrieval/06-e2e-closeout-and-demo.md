# Chunk 6: e2e closeout + LIVE demo

**Status:** in-progress
**Created:** 2026-07-13
**Phase:** hybrid-retrieval (2d)
**Estimated size:** ~0.5–1 day
**Depends on:** 05 (01/02 must also be merged — the demo exercises their surfaces)

## Scope

**In (spec §5):**
- Full-path wiring proof through the real daemon (WS turn → search tool → answer; dismiss →
  distill → hybrid candidate-fetch) — the chunk-04/05 probes re-run against the assembled main.
- Demo-harness scenarios for the §5 behavioral items (the `memory-demo-harness.ts` family) so the
  live demo has a scripted glass-box fallback.
- Docs reconcile, staged for closeout (NOT before the demo — §6.1 sequencing): memory-backlog §D →
  shipped; roadmap 2d tick; known-gotchas #46/#47 status notes updated with the chunk-03 re-verify
  findings; the distiller-v2 spec's superseded-lane cross-note.
- **Lior's LIVE feature-closing demo (§6.1, non-negotiable) — spec §5 items 1–5:**
  1. UK↔EN no-dup + change→REPLACE, TWO scenes (spec §5 item 1 [grill #4]): (a) natural scale;
     (b) the SEEDED >`ALL_FACTS_CAP` scene where BM25-alone provably misses and the hybrid lane
     surfaces the candidate — scene (b) is the feature thesis, scene (a) can pass on 2c steering;
  2. out-of-slice «що я казав про X?» → live search, attributed answer;
  3. forget → reworded same-canonical re-derivation suppressed (chunk-02 live);
  4. message-edit GONE (overlay + history.html), fact-edit alive with durable badge (chunk-01 live);
  5. provider unset → lexical-only degrade, everything still answers.

**Out:** (WHY — §7.2)
- Any new capability — this chunk assembles and proves; scope additions go back to decompose.
- Archive/backfill of the docs beyond the named set — the uniform archive ritual belongs to the
  orchestrator's closeout duties (§4.4), not extra scope.

## Done criteria

- [ ] **[mechanical]** Assembled-main probe re-runs green (outputs in PR); frozen byte-diff empty
      across the whole feature branch set.
- [ ] **[behavioral]** **Lior's live demo — items 1–5 ALL PASS** (the §5.2 gate; do not flip any
      chunk to done/archive before it).
- [ ] **[mechanical]** Docs reconcile merged (backlog/roadmap/gotchas/spec cross-notes), staged
      AFTER the demo sign-off.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 06 of hybrid-retrieval per orchestration/docs/specs/2026-07-13-hybrid-retrieval.md
§5 (verification model — the behavioral DoD is Lior's live demo, items 1–5).

Files to touch:
- packages/daemon/scripts/memory-demo-harness.ts (2d scenarios)
- orchestration/docs/{memory-backlog.md,roadmap.md,known-gotchas.md} (+ distiller-v2 spec cross-note)
  — staged for post-demo closeout

Done when: live demo signed + docs reconciled + feature folder archived per §4.4.

ADRs in scope: none new. Demo env: ANTHROPIC key (Keychain), LLM_PROVIDER=anthropic-api,
EMBEDDING_PROVIDER per spec §0.1 resolution, MEMORY_DEBUG=action,distill,retrieve,forget,search.
```

## Notes / Open questions

- Demo item 1 scene (b) is THE feature thesis — if it fails live, that is a stop-the-line finding,
  not a polish item (three prior features each caught a real defect only at the live demo). A green
  scene (a) with a red scene (b) means 2c steering is masking a retrieval miss — attribute honestly
  (spec D8b: eval measures surfacing, the demo measures the REPLACE).
