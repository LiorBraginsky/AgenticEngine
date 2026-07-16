# Chunk 5: memory_search — the read tool on the ADR-0016 plane

**Status:** in-progress
**Created:** 2026-07-13
**Phase:** hybrid-retrieval (2d)
**Estimated size:** ~1 day
**Depends on:** 04

## Scope

**In (spec §3.6 — the four seams are SPECIFIED, do not freelance [grill #3]):**
- Registry row (spec D6a): `"memory_search"` in `MemoryActionToolName` + `kind:"read"` row in
  `MEMORY_ACTION_TOOLS` (`memory-action-tools.ts:20/34` — the `satisfies` guard forces it);
  `dispatchTool` branch (`anthropic-api-provider.ts:161-208`). Input
  `{query, scope?: facts|archive|all}`; typed never-throw results (top-N cap, honest "no matches").
- **Result union widens:** `MemoryActionResult` gains the search variant
  (`{ok:true, action:"search", results: SearchHit[]}`); `serializeToolResult` handles it; the
  contract comment at `memory-action-tools.ts:81` updated.
- **Port wiring:** `MemoryActionPort` constructor deps (`memory-action-port.ts:46-51`) gain the
  chunk-04 RANKER (constructed in index.ts before the port, existing DI chain).
- Reads are tombstone/correction-honoring + quarantine-excluding (the standing archive-read
  posture); scrubbed content unreachable (chunk-03 already removed its legs' rows);
  **snippets pass the RuleBasedScanner — flagged ⇒ withheld with a typed note; all result content
  framed as quoted UNTRUSTED data in the tool_result** (spec §0.3 third bullet [grill #6]).
- **Caps:** `MemoryActionTurnContext` gains `searchesUsed`; `MEMORY_SEARCH_MAX_PER_TURN` enforced
  INDEPENDENTLY of the write cap; the loop round backstop (`anthropic-api-provider.ts:474`) rises
  to write-cap + read-cap (spec D6b [grill #3d] — 3 searches must not starve a legitimate write).
- **NO ordinals on results; results never join the forget/replace map** (spec §0.2 — ADR-0016
  d2/d7 blast radius unchanged). NO durable audit event (read = no side effect); `MEMORY_DEBUG`
  gains a `search` channel.
- **The ADR-0016 d7 rider** (spec §0.3 — the widened READ surface named on the record) was
  authored in the DECOMPOSE PR and is Lior-gated with the spec; this chunk IMPLEMENTS its two
  mitigations (scanner-on-snippets + untrusted framing) — do not re-litigate them.
- Capability-conditional self-concept additions (spec D6c/D6d, the 2c D8 pattern): can search;
  found-but-not-in-view stays Memory-window territory for forget/edit; answer with attribution;
  never claim search when the port is absent.
- **EXECUTED real-API probe** (Strike-5): a real LLM invokes `memory_search` end-to-end (fact +
  archive scopes) on a fresh seeded store — stdout in the PR.

**Out:** (WHY — §7.2)
- **Search-result targetability for forget/replace** — §0.2 ruling: widening the targetable set is
  an ADR-0016 guardrail change (full §5.2 gate), trigger recorded in the spec. Do NOT freelance it.
- **Audit events for reads** — no side effect, no audit (ADR-0016 d(e) governs actions); debug
  channel only.
- **Auto-injecting search results into future turns** — search answers THIS turn; persistence of
  knowledge is the distiller's job (separation the memory model is built on).

## Done criteria

- [ ] **[mechanical]** Registry/type totality: build fails without the row (satisfies guard);
      no-port ⇒ no `tools[]` byte-identical (the 2c invariant re-asserted, spec §4.5).
- [ ] **[mechanical]** Scripted `tool_use(memory_search)` tests: fact scope, archive scope,
      tombstoned content absent, quarantined content absent, scanner-flagged snippet withheld,
      empty ⇒ honest no-matches, cap ⇒ typed refusal, 3 searches + 1 write in one turn all fit
      the raised loop bound (RED on the old bound).
- [ ] **[mechanical]** Self-concept variant tests (capability present/absent — both directions of
      the lying defect excluded).
- [ ] **[mechanical]** EXECUTED real-API probe output in the PR.
- [ ] **[mechanical]** typecheck 0 · `lint:strict` 0 · `bun test` green · frozen byte-diff empty.
- [ ] **[behavioral — rides chunk-06 demo]** «що я казав про X?» (X out of slice) → live search +
      attributed honest answer (spec §5 demo item 2).

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 05 of hybrid-retrieval per orchestration/docs/specs/2026-07-13-hybrid-retrieval.md
§3.6 (memory_search) honoring §0.2 (results are READ-ONLY — never targetable).

Files to touch:
- packages/daemon/src/providers/memory-action-tools.ts (registry row)
- packages/daemon/src/providers/anthropic-api-provider.ts (dispatch branch, read-cap)
- packages/daemon/src/memory/memory-action-port.ts (read method over the ranker)
- packages/daemon/src/memory/system-prompt.ts (capability-conditional additions + tests)
- packages/daemon/src/memory/debug-log.ts (search channel)
- packages/daemon/scripts/memory-search-probe.ts (new, EXECUTED)

Done when: the Done criteria above hold.

ADRs in scope: ADR-0016 (decision 2 read slot consumed; guardrails d1–d7 UNCHANGED — any targeting
widening is a hard stop + escalate); ADR-0013/0014 (no new HTTP/WS surface).
```

## Notes / Open questions

- Tool description wording steers usage ("search BEFORE saying you don't remember; defer
  forget/edit of out-of-view facts to the Memory window") — architect-time text, demo-validated.
