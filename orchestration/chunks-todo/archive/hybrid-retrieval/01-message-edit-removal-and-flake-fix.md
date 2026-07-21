> 🗄️ ARCHIVED 2026-07-21 — done. Historical record; do not edit.

# Chunk 1: message-edit removal + D6c flake fix

**Status:** done — hybrid-retrieval 2d SHIPPED + CLOSED 2026-07-21 (PR #97; feature demo-signed §6.1; see specs/archive/2026-07-13-hybrid-retrieval.md)
**Created:** 2026-07-13
**Phase:** hybrid-retrieval (2d) — riders-first
**Estimated size:** ~1 day
**Depends on:** none — GATED on spec acceptance (`specs/2026-07-13-hybrid-retrieval.md`, §5.2 Lior)

## Scope

**In:**
- **R1 — message-edit removal, end-to-end** (spec §3.7 R1; Lior 2026-07-10 final ruling,
  ADR-0012 rider Ruling 1 removal-note; backlog §D scope):
  - overlay Memory window: remove the per-MESSAGE edit affordance — `buildEditControl` on message
    rows (`apps/overlay/src/memory/render.ts:83`), `MessageActions.onEdit` (`render.ts:15-17`),
    controller `editAction` + `editedIds` session-tag lane (`controller.ts:102-104/177-179`),
    `editMessage` client (`memory-write.ts:60-62`).
  - `history.html`: remove the message "Edit" button + `doEdit`
    (`packages/daemon/src/memory/history-page.ts:369-376/550-616`).
  - daemon: retire the `/memory/edit` MESSAGE branch (`http-routes.ts:258-270`) — a message-shaped
    body now returns 400 `bad_body` (same posture as the forget route, `:216-217`).
  - remove the message-edit tests; re-assert fact-edit tests untouched.
- **R3 flake fix** (spec §3.7 R3; 3× observed, ledger PR #90): `readForgottenFacts`
  (`store.ts:363-372`) → `ORDER BY created_at DESC, rowid DESC`; de-collide the D6c test's
  substring assert (`smart-distiller-provider.test.ts:441-464`); harden the two ASC reads —
  `readDistillationEvents` (`store.ts:783`) and `readReplacedFacts` (`store.ts:1027`) — with
  **`, rowid ASC`** (direction matches the FIX-7 precedent `readMemoryActionEvents`
  `store.ts:1048`; NOT rowid DESC on an ASC read — spec [grill #10]).

**Out:** (each with WHY — PIPELINE §7.2)
- **Fact-edit — UNTOUCHED** (`target_type:"fact"` branch `http-routes.ts:240-256`, overlay
  `onEditFact`/`editFact`): it is the 5a lever, the durable-badge demo-blessed surface. Any change
  here = freeze-adjacent, escalate.
- **The append-only mutation machinery KEPT** (`WriteGate.edit`, `mutations` kind `'correction'`,
  `readThreadArchive` COALESCE) — ADR-0015 B1; already-recorded corrections keep rendering; the
  primitive predates the UI. `Hatch.edit` retirement only IF dead after the HTTP branch removal
  (spec §7 open-at-build — verify importers first).
- **No embedding/ranker work** — chunks 03–05; this chunk is deliberately runtime-independent
  (spec §6: disjoint tables/paths).

## Done criteria

- [ ] **[mechanical]** No message-edit affordance is reachable: overlay renders NO edit control on
      message rows; `history.html` output contains no message Edit button; `POST /memory/edit`
      without `target_type:"fact"` → 400 (test).
- [ ] **[mechanical]** Fact-edit round-trip test still green (204, `authored_by='human'`, durable
      badge data intact).
- [ ] **[mechanical]** Existing recorded corrections still render (COALESCE path test — machinery kept).
- [ ] **[mechanical]** D6c test seeded 15-rows-in-one-ms passes deterministically (RED on the old
      `ORDER BY` — prove it, then fix); `rowid` hardening applied to the two other reads.
- [ ] **[mechanical]** typecheck 0 · `lint:strict` 0 · `bun test` green · frozen surfaces byte-diff empty.
- [ ] **[behavioral — rides chunk-06 demo]** Lior sees message-edit GONE in overlay + history.html,
      fact-edit alive (spec §5 demo item 4).

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 01 of hybrid-retrieval per orchestration/docs/specs/2026-07-13-hybrid-retrieval.md
§3.7 R1 (message-edit removal) + §3.7 R3 (D6c flake fix + rowid hardening sweep).

Files to touch:
- apps/overlay/src/memory/{render.ts,controller.ts,memory-write.ts} (+ their tests)
  ⚠️ actions.ts: do NOT remove buildEditControl (actions.ts:39) — it is SHARED with fact-edit
  (render.ts:162, the 5a lever). Remove only the MESSAGE call site (render.ts:83 + MessageActions.onEdit).
- packages/daemon/src/memory/history-page.ts
- packages/daemon/src/memory/http-routes.ts (+ tests)
- packages/daemon/src/memory/store.ts (readForgottenFacts/readDistillationEvents/readReplacedFacts ORDER BY)
- packages/daemon/src/memory/providers/smart-distiller-provider.test.ts (D6c assert de-collide)

Done when: the Done criteria above hold; behavioral item rides the chunk-06 live demo.

ADRs in scope: ADR-0012 rider Ruling 1 (removal-note executed — cite it in the PR body);
ADR-0015 B1 (machinery kept — do NOT remove WriteGate.edit / mutations 'correction' / COALESCE).
```

## Notes / Open questions

- The RED-first posture on the flake fix matters: reproduce the tie (15 inserts, one ms) before
  fixing, or the fix is an assertion, not evidence (§6.2).
