# Chunk 2: forgotten_facts canonical axis (d5 two-axis consult)

**Status:** in-progress
**Created:** 2026-07-13
**Phase:** hybrid-retrieval (2d) — riders-first
**Estimated size:** ~0.5–1 day
**Depends on:** none (01 recommended first — shared test files) — GATED on spec acceptance

## Scope

**In (spec §3.7 R2; the 2c chunk-01 flagged residual — ledger PR #86; in-code note
`distiller-registration.ts:193-198`):**
- Additive nullable `canonical` column on `forgotten_facts`, wired for BOTH store generations
  (spec R2 [grill #5]): **(a)** `canonical TEXT` added to the `forgotten_facts` CREATE TABLE in
  `SCHEMA_DDL` (`schema.ts:92-101` — fresh stores); **(b)** a PRAGMA-guarded idempotent
  ensure-column called from the `MemoryStore` CONSTRUCTOR after the DDL exec (`store.ts:182` —
  existing stores; the `ensureDistilledThroughTurnColumn` mechanics, `store.ts:1098-1104`, but
  with an always-run call site — that precedent itself is migration-script-only, do not copy its
  wiring).
- `MemoryActionPort.forget` writes `canonical` from the target's `fact_fts.canonical` at
  record time (`memory-action-port.ts:108-114` → `store.recordForgottenFact`, `store.ts:338-354`).
- The D6b consult (`distiller-registration.ts:189-203`) + its helpers
  (`isForgottenNormalizedText` `store.ts:379-387`, `hasHumanFactWithNormalizedText`,
  `clearForgottenByNormalizedText`) match on **canonical OR display** (both axes — the 2c chunk-05
  two-axis lesson applied to the forgotten-facts surface).
- Legacy NULL-canonical rows: display-only matching (honest, logged) — no backfill fabrication.
- Tests: same-canonical REWORDED display re-derivation is suppressed (RED without this chunk);
  the 16-rephrase classes + cross-language (UK display / EN canonical) cases; the precedence chain
  (human ▷ un-forget ▷ record ▷ re-derivation) byte-carried; D6c/D6e clears work on both axes.

**Out:** (WHY — §7.2)
- **Semantic (embedding) suppression** — REJECTED for v1 (spec §1 Out): threshold auto-suppression
  can silently drop legitimate facts; deterministic axes only. The fully-reworded
  different-canonical slip stays a NAMED residual (spec §3.5c).
- **`factExistsByDedupKey`** — untouched (already two-axis since 2c chunk-05); this chunk is the
  forgotten_facts surface ONLY.
- **In-code limitation note** at `distiller-registration.ts:193-198` — REWRITE it (the residual it
  tracks is being closed), do not leave a stale contradiction (the m3 lesson).

## Done criteria

- [ ] **[mechanical]** RED-first: a same-canonical / reworded-display re-derivation slips the
      consult on baseline, is suppressed after — across all three op shapes (new / append /
      replace-replacement-text, the 2c A-MAJOR pattern).
- [ ] **[mechanical]** Column added guarded; fresh-install AND existing-store paths both pass
      (PRAGMA check test).
- [ ] **[mechanical]** Precedence chain tests byte-carried green; human un-forget + D6e re-assert
      clear rows matched via EITHER axis.
- [ ] **[mechanical]** typecheck 0 · `lint:strict` 0 · `bun test` green · frozen byte-diff empty.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 02 of hybrid-retrieval per orchestration/docs/specs/2026-07-13-hybrid-retrieval.md
§3.7 R2 (forgotten_facts canonical axis, two-axis D6b consult).

Files to touch:
- packages/daemon/src/memory/schema.ts (canonical TEXT in the forgotten_facts CREATE TABLE)
- packages/daemon/src/memory/store.ts (constructor-run PRAGMA-guarded ensure-column for existing
  stores — spec R2 wiring [grill #5])
- packages/daemon/src/memory/store.ts (recordForgottenFact, isForgottenNormalizedText,
  clearForgottenByNormalizedText, hasHumanFactWithNormalizedText)
- packages/daemon/src/memory/memory-action-port.ts (forget → canonical write)
- packages/daemon/src/memory/distiller-registration.ts (D6b consult + REWRITE the :193-198 note)
- tests: store.test.ts, distiller-registration.test.ts, memory-action-port tests

Done when: the Done criteria above hold.

ADRs in scope: ADR-0015 (B1 + precedence chain — carried, match-key widens only);
ADR-0012 5e (human precedence untouched). No new ADR.
```

## Notes / Open questions

- The 16-rephrase matrix is reconstructed from the PR #86 hard-reviewer verification record — the
  worker re-derives the classes into a fixture (they also feed the chunk-04 golden set, spec §3.8a-2).
