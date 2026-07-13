# Chunk 5: dedup case-fix — one statement must yield ONE fact (demo-found defect)

**Status:** in-progress
**Created:** 2026-07-13
**Phase:** memory-action-tools (2c)
**Estimated size:** small (~half day)
**Depends on:** 01–04 merged (defect found at the 2026-07-11 §6.1 live demo)

## Provenance (why this chunk exists — §7.2 defect-routing, NOT new scope)

Routed demo-found DEFECT (Lior live demo 2026-07-11, ledger `DEMO-GREEN … (D1)`): one user
statement about a favourite drink produced **TWO machine facts differing only in first-letter
case** — «мій улюблений напій - чай» AND «Мій улюблений напій - чай», same thread provenance,
both `machine`. This violates the **accepted** spec's d6 guardrail
(`2026-07-10-memory-action-tools.md` §3.5 d6: tool-written facts dedup "via the existing
canonical machinery — no dup spam") and/or the v2 normalized-dedup contract on the distiller
path. Demo evidence: the agent later needed TWO forget actions to clear one logical fact
(audit rows 18:39:55, 2026-07-11).

## Task

1. **Root-cause first (systematic-debugging):** reproduce with a real-sqlite test. Hypothesis
   space (verify, don't assume): (a) tool-`remember` at turn-time + distiller re-derivation at
   dismiss writing the same fact, with the insert-path dedup key being case-SENSITIVE where the
   d5/forgotten chain already uses the relaxed case-insensitive `dedupConnectorKey`; (b) the
   agent calling `memory_remember` while the distiller independently derives at dismiss with a
   differently-cased canonical; (c) a normalize step missing lowercase on exactly one of the two
   write paths. Identify the ACTUAL divergent key/path before touching code.
2. **Fix:** align the dedup key(s) so the tool-insert path and the distiller-derivation path
   agree case-insensitively (and consistently with the relaxed connector-key used across the d5
   chain since chunk-01's hard-reviewer fix). ONE shared normalize/key helper — do not fork a
   second normalization.
3. **Regression tests (real sqlite, no LLM):** (a) same statement written via tool-`remember`
   then re-derived by a scripted distiller delta with different letter case ⇒ ONE fact survives
   (suppress-as-dup or REPLACE, never a sibling); (b) case-variant exact-dup via tool twice ⇒
   `duplicate` no-op; (c) the existing 5e precedence + d5 suppression suites stay green
   (the relaxed-key alignment must not weaken them — chunk-01's 16-rephrase matrix is the guard).
4. **No scope creep:** this is a dedup-key alignment fix. The O2 (injection-blob reply quality)
   and O3 (replace-steering miss) demo observations are recorded in the backlog — NOT this chunk.

## DoD

- [ ] **[mechanical]** RED-first repro test demonstrating the case-dup on pre-fix code, GREEN
      after the fix (commit order shows it).
- [ ] **[mechanical]** One statement ⇒ ONE fact across both write paths (tool + distiller),
      case-insensitive, proven by the regression tests above on real sqlite.
- [ ] **[mechanical]** Full gates: `bun test` all green (703 baseline + new), typecheck 0,
      `lint:strict` 0, frozen surfaces (`@agentic/protocol` + mock reducer + mock provider)
      byte-diff empty.
- [ ] **[mechanical]** Existing d5/5e suites untouched-green (no weakening of the forget chain).
- [ ] No behavioral Lior-demo gate (backend dedup fix; the feature demo is already signed) —
      but the fix closes the feature: on merge, spec `2026-07-10-memory-action-tools.md` flips
      `accepted → implemented` and this folder drains (§4.4).

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 05 (dedup case-fix) of memory-action-tools per this file's Task/DoD.
Authority: accepted spec orchestration/docs/specs/2026-07-10-memory-action-tools.md (§3.5 d6,
§3.6 d5 relaxed-key precedent, §3.7 dedup/REPLACE routing) + the DEMO-GREEN ledger line (D1).
Root-cause with a RED repro BEFORE fixing (superpowers:systematic-debugging). Small chunk:
one key-alignment fix + tests. On DONE: ready-to-merge per crawl §11.4 (conductor re-verifies
+ merges); closeout duties (spec → implemented, folder drain §4.4) ride THIS chunk's merge.
```
