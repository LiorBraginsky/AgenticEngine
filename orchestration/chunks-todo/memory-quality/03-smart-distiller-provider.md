# Chunk 3: Smart distiller provider — LLM-backed, non-default (2b)

**Status:** in-progress
**Created:** 2026-06-12
**Phase:** memory-quality (spec `docs/specs/2026-06-12-memory-quality.md` §3.3 + §4)
**Estimated size:** ~1–1.5 days
**Depends on:** 02 (the projection contract + registration flow this provider plugs into)

## Scope

**In:**
- **`SmartDistillerProvider`** (id `"smart"`) implementing the redefined port:
  - **Digest builder** (spec D8): iterate ALL threads; M=50 most recent messages per
    thread (tunable); built ONLY from `readThreadMessagesForDistill` (tombstone-honored)
    AND excluding `isMessageQuarantined` sources (grill #1 — quarantine must survive
    summarization); loud log on per-thread truncation, never drop whole threads silently.
  - **LLM call** (spec D9): `claude-haiku-4-5`, `thinking: {type:"disabled"}`, bounded
    `max_tokens`, **NO `output_config.effort`** (errors on Haiku — grill #11); key via
    `resolveAnthropicKey(opts.resolverOpts)`; **injectable `clientFactory`** (the
    `createAnthropicApiProvider` DI pattern); never-throw — any failure/malformed output
    → chunk-02's failure path (projection intact, `reprojection-failed` events).
  - **Canonicalization** (spec D10): deduplicated canonical NL sentences
    (entities/preferences/counts; cross-thread aggregates name source threads); tags
    stamped per D10; defensive parse.
  - **Best-effort fact-forget layers** (spec §4 — phrase code/comments as MITIGATION,
    not guarantee): provenance-match post-filter + normalized-text post-filter +
    tombstoned-fact-texts as LLM exclusions.
- **Selector registers `"smart"`** — **default STAYS `dumb-tail`** (flip is chunk 04);
  **no key ⇒ fall back to dumb-tail with a LOUD log** (selector-level).
- **Deterministic stub-LLM tests** (the stub clientFactory is the ONLY permitted mock —
  Strike-4 boundary note in spec §5):
  - **hard-guarantee forget test** (spec D12/§4): forget a message → smart re-projection
    with a stub that ECHOES its input → assert the scrubbed content never entered the
    digest AND no resulting fact contains it;
  - **quarantine-survives-summarization**: a quarantined source never resurfaces as a
    smart fact;
  - swap-proof + lossless-integrity extended to smart-with-stub;
  - failure-keeps-projection (stub that errors);
  - best-effort layers unit tests (post-filters drop matching candidates).
- **Real-API smoke probe — EXECUTED** (q#001 rider b, Strike-5: a probe is evidence only
  when actually RUN): a small script driving a real haiku call through the provider
  against a real on-disk store; its actual output captured in the PR body.

**Out:** (PIPELINE §7.2)
- The `MEMORY_PROVIDER` default flip — deferred to chunk 04 (grill #10): the flip is the
  single most behavior-changing line (every keyless daemon/test changes path); it ships
  isolated, behind this chunk's executed probe.
- Archive summarization / hierarchical tier — OUT, spec §1 (future feature; the
  O(total archive)/disconnect cost is consciously accepted at dogfood scale).
- A hard fact-level forget — NOT claimable under a generative distiller (spec §4; q#003
  Sub-3). Do not represent the layers as a guarantee anywhere (docs, comments, tests).
- `history-page.ts` — frozen OUT (spec §1).

## Done criteria

- [ ] **[mechanical]** all stub-LLM tests above green; full `bun test` + `lint:strict`
      + typecheck exit 0; real SQLite I/O everywhere except the LLM clientFactory.
- [ ] **[mechanical]** `MEMORY_PROVIDER=smart` + key ⇒ smart runs; no key ⇒ loud-log
      fallback to dumb-tail (test both); default UNCHANGED (`buildMemoryProvider()`
      without env still returns dumb-tail — explicit test).
- [ ] **[mechanical — EXECUTED evidence]** the real-API smoke probe RAN; its output
      (facts produced from a seeded archive) pasted in the PR. Not "written+typechecked"
      — RUN (Strike-5).
- [ ] **[mechanical]** frozen surfaces byte-unchanged.
- [ ] **[behavioral — DEFERRED to chunk 04's feature-closing Lior demo]** precise
      structured recall with provenance link (spec §5 step 2).

## Orchestrator brief (read by the orchestrator from this file)

```
implement memory-quality chunk 03 per orchestration/docs/specs/2026-06-12-memory-quality.md §3.3 (D8, D9, D10) + §4.

Files to touch:
- packages/daemon/src/memory/providers/smart-distiller-provider.ts (new) + test
- packages/daemon/src/memory/memory-provider-selector.ts (register "smart"; no-key fallback; default untouched)
- digest/canonicalization helpers as the architect lays them out (keep distill read-only over the archive)
- a probe script (e.g. packages/daemon/scripts/) — EXECUTED in this chunk, output in PR

Done when: DoD above green, INCLUDING the executed-probe evidence.

ADRs in scope: ADR-0012 (HARD INVARIANT; 5d quarantine; §4 guarantees-boundaries).
LLM-in-distill authority: port comment Q3 (Lior-approved) + q#001 Sub-3 — do not
re-litigate. The LLM call runs OUTSIDE any transaction (spec D4 — daemon stall risk).
```

## Notes / Open questions

- Normalized-text matching algorithm + digest serialization format are architect-time
  (spec §7).
- The spec's §4 "Guarantees & their boundaries" is escalated to Lior at spec sign-off —
  if he demands a hard fact-forget, this chunk's scope changes (fact-forget coupled to
  source-deletion); do not start chunk 03 before the spec is `accepted`.
