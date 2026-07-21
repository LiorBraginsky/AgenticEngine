> 🗄️ ARCHIVED 2026-07-21 — shipped. Historical record; do not edit.

# Plan — hybrid-retrieval chunk 01: message-edit removal + D6c flake fix

## Status: shipped — hybrid-retrieval 2d chunk-01 (PR #97, merged; feature demo-signed + closed 2026-07-21)

**Chunk:** `orchestration/chunks-todo/hybrid-retrieval/01-message-edit-removal-and-flake-fix.md`
**Spec:** `orchestration/docs/specs/2026-07-13-hybrid-retrieval.md` §3.7 R1 (message-edit removal) + §3.7 R3 (D6c flake + rowid hardening).
**Branch:** `chunk/hybrid-01-msg-edit-removal-flake-fix`
**Tier:** §6.2 mechanical (behavioral item 6 explicitly RIDES chunk-06 live demo — no demo here).

## Design provenance (why no separate architect pass)

The spec §3.7 R1/R3 is itself the frozen design output of the fable design+decompose pass — it carries
full file:line recon, explicit in/out with §7.2 rationale, RED-first posture, and the direction-matched
tie-break ruling [grill #10]. Nothing here is exploratory. The one architect-time judgment
(`Hatch.edit` dead-code survival, spec §7 open-at-build) is a mechanical importer check delegated to the
worker inline. So the plan restates the spec as executable steps; it does not re-decide anything.

## ADRs in scope (cite in PR body, do NOT touch machinery)

- **ADR-0012 rider Ruling 1** — message-edit removal-note EXECUTED here ("shipped-but-doomed, do not build on it").
- **ADR-0015 B1** — append-only mutation machinery KEPT: `WriteGate.edit`, `mutations` kind `'correction'`,
  `readThreadArchive` COALESCE. The UI affordance + HTTP message branch go; the primitive stays.

## Frozen / out-of-scope guardrails (§7.2 — do NOT cross)

- **Fact-edit UNTOUCHED** — `target_type:"fact"` branch (`http-routes.ts:240-256`), overlay `onEditFact`/`editFact`.
  This is the 5a lever + durable-badge demo-blessed surface. Any change here = freeze-adjacent → STOP + escalate.
- **`buildEditControl` STAYS** (`apps/overlay/src/memory/actions.ts:39`) — SHARED with fact-edit (`render.ts:162`).
  Remove only the MESSAGE call site (`render.ts:83`) + `MessageActions.onEdit`.
- **Machinery KEPT** (ADR-0015 B1) — `WriteGate.edit`, `mutations` 'correction', COALESCE. `Hatch.edit`
  retires ONLY if dead after the HTTP branch removal (importer check first).
- **No embedding/ranker/store-vector work** — chunks 03–05.
- **Frozen surfaces byte-unchanged:** `@agentic/protocol`, the mock provider/reducer.

## Steps

### Step 1 — R3: D6c flake fix, RED-first (spec §3.7 R3)

RED-first is mandatory (chunk Notes + §6.2): reproduce the tie BEFORE fixing, or the fix is an assertion, not evidence.

1. **Reproduce (RED):** seed 15 `forgotten_facts` rows inside one millisecond (loop-insert; `recordForgottenFact`
   stamps `Date.now()`), assert the D6c test (`smart-distiller-provider.test.ts:441-464`, expects exactly the
   most-recent 10) flakes / can return an arbitrary 10 under the old `ORDER BY created_at DESC` (no tie-break).
   Show the RED.
2. **Fix:** `readForgottenFacts` (`store.ts:363-372`) → `ORDER BY created_at DESC, rowid DESC`.
3. **De-collide** the D6c test's substring assert (`smart-distiller-provider.test.ts:441-464`) so it verifies
   deterministically against the seeded rows.
4. **Harden the two other tie-break-less reads** — direction-MATCHED per [grill #10]:
   - `readDistillationEvents` (`store.ts:783`, ASC read) → append **`, rowid ASC`**.
   - `readReplacedFacts` (`store.ts:1027`, ASC read) → append **`, rowid ASC`**.
   - Precedent = `readMemoryActionEvents` (`store.ts:1048`, FIX-7). NOT `rowid DESC` on an ASC read.
5. Green: the seeded 15-in-one-ms test passes deterministically.

### Step 2 — R1: message-edit removal, end-to-end (spec §3.7 R1)

End state: **archive = read-only immutable history; memory (facts) = the editable surface.**

1. **Overlay:**
   - `apps/overlay/src/memory/render.ts` — remove the per-MESSAGE edit control call site (`:83`) and
     `MessageActions.onEdit` (`:15-17`). **Keep `buildEditControl` in actions.ts** (fact-edit shares it, `render.ts:162`).
   - `apps/overlay/src/memory/controller.ts` — remove the `editAction` + `editedIds` session-tag lane (`:102-104/177-179`).
   - `apps/overlay/src/memory/memory-write.ts` — remove the `editMessage` client (`:60-62`). Keep `editFact`.
2. **history.html:** `packages/daemon/src/memory/history-page.ts` — remove the message "Edit" button + `doEdit`
   (`:369-376/550-616`).
3. **Daemon HTTP:** `packages/daemon/src/memory/http-routes.ts` — retire the `/memory/edit` MESSAGE branch (`:258-270`);
   a message-shaped body now returns **400 `bad_body`** (same posture as the forget route `:216-217`).
   `target_type:"fact"` KEEPS working (`:240-256`).
4. **Hatch.edit dead-code check** (spec §7 open-at-build): grep importers of `Hatch.edit`. If the removed HTTP
   branch was the sole caller → retire `Hatch.edit` too (dead code is the thing being removed). If any non-HTTP
   consumer exists → keep it. Record which, in the PR body.
5. **Tests:** REMOVE the message-edit tests (not skip). RE-ASSERT the fact-edit tests untouched. ADD/confirm a test:
   `POST /memory/edit` without `target_type:"fact"` → 400. Confirm the COALESCE render test (already-recorded
   corrections still render — machinery kept) stays green.

### Step 3 — Verification (§6.2 command evidence)

- `bun test` green (message-edit tests removed; fact-edit + COALESCE + D6c seeded test all green).
- typecheck 0 · `lint:strict` 0.
- Frozen surfaces byte-diff empty: `@agentic/protocol`, mock provider/reducer (`git diff main -- <paths>`).

## Done criteria (from chunk file — all mechanical for THIS chunk's gate)

- [ ] [mechanical] No message-edit affordance reachable: overlay renders NO edit control on message rows;
      `history.html` output has no message Edit button; `POST /memory/edit` without `target_type:"fact"` → 400 (test).
- [ ] [mechanical] Fact-edit round-trip test still green (204, `authored_by='human'`, durable badge data intact).
- [ ] [mechanical] Existing recorded corrections still render (COALESCE path test — machinery kept).
- [ ] [mechanical] D6c test seeded 15-rows-in-one-ms passes deterministically (RED on old ORDER BY first);
      `rowid` hardening applied to the two other reads.
- [ ] [mechanical] typecheck 0 · `lint:strict` 0 · `bun test` green · frozen surfaces byte-diff empty.
- [ ] [behavioral — RIDES chunk-06 demo, NOT this chunk's gate] Lior sees message-edit GONE in overlay +
      history.html, fact-edit alive (spec §5 demo item 4).

## Progress log

- **Step 1 (R3 flake fix), commit `ce4410b`:** RED-first confirmed — added a store-level
  regression test seeding 3 same-`created_at` rows and asserting `readForgottenFacts`
  tie-break order; watched it FAIL against the old `ORDER BY created_at DESC` (returned
  the OLDEST of the tied rows, not the newest). Fixed to `ORDER BY created_at DESC, rowid
  DESC`; test went GREEN. Also caught (and fixed) that the D6c distiller test's
  `.includes()` substring assert double-counted "forgotten-fact-1" as a false-positive
  match inside "forgotten-fact-10".."-14" once the tie-break surfaced the correct (last-10)
  set — de-collided with a non-digit-boundary regex + an exact-set assertion. Hardened the
  two ASC reads (`readDistillationEvents`, `readReplacedFacts`) with `, rowid ASC`,
  direction-matched to the FIX-7 precedent.
- **Step 2 (R1 message-edit removal), commit `662c919`:** removed the message-edit
  affordance end-to-end (overlay render.ts/controller.ts/memory-write.ts, history.html,
  the HTTP `/memory/edit` message branch → 400 `bad_body`). `Hatch.edit` dead-code check:
  grepped all non-test `.edit(` callers across `packages/`+`apps/` — `http-routes.ts` was
  the sole production caller; retired the method. `WriteGate.edit` / `mutations`
  `'correction'` / `readThreadArchive` COALESCE (ADR-0015 B1) are unchanged. Removed the
  message-edit tests; kept the Fix-2 cross-thread edit→distill→retrieve coverage by
  converting it to call `gate.edit` directly instead of the retired `Hatch.edit`. Added a
  400 test for a message-shaped `/memory/edit` body. Fact-edit + COALESCE tests
  re-asserted green, untouched.
- **Verification:** `bun test` 702 pass / 0 fail (70 files); `bun run typecheck` 0 errors;
  `bun run lint:strict` 0 warnings/errors; `git diff main -- packages/protocol` and the
  mock-provider/test files both empty.
- **Review (engine-reviewer vs main), commit `9a56796`:** VERDICT 0 blockers / 0 majors /
  0 minors / 1 nit. All four frozen guardrails PASS (fact-edit untouched; `buildEditControl`
  intact — only the 4-line doc comment changed; ADR-0015 B1 machinery unchanged; removal
  complete + consistent, message body → 400). R3 direction-matching confirmed on all three
  reads; RED-first re-proven by the reviewer (revert tie-break → D6c returns oldest rows).
  The nit (stale `history-page.ts` write-actions comment implying a fact-edit affordance
  history.html never had) fixed in `9a56796`.
- **Orchestrator independent gate (final branch state):** re-ran typecheck 0 / lint:strict 0 /
  `bun test` 702 pass·0 fail / frozen byte-diff 0 — not trusting the worker paste (§6.2).
  Tree clean. **Verified-done (mechanical tier) satisfied.**
- **Merge posture (crawl §11.4):** DONE ready-to-merge — do NOT self-merge; the conductor
  re-verifies on a clean checkout + independent reviewer, then merges. Behavioral DoD (item 6)
  is NOT closed here — it rides chunk-06's live demo (spec §5 item 4).
