> 🗄️ ARCHIVED 2026-07-09 — done. Historical record; do not edit.

# Chunk 3: Memory window — ACT (edit + forget)

**Status:** done
**Created:** 2026-07-02
**Phase:** memory-transparency-ui (backlog Theme A — spec `docs/specs/2026-07-02-memory-transparency-ui.md`)
**Estimated size:** ~1 day
**Depends on:** 02 (the view UI these actions live in)

## Scope

**In:**
- **Forget a fact** from the memory window (`POST /memory/forget`, `target_type:"fact"`), with
  a confirm step whose copy frames it as **"release the reference"** — the fact leaves the
  agent's long-term memory; the source thread/messages are untouched (ADR-0015 semantics,
  Lior's 2026-07-02 wording). After forget, the view refreshes and the fact is gone.
- **Edit a fact** (`POST /memory/edit`): inline edit → correction lands with
  `authored_by:"human"` (the HTTP ctx is fixed server-side); the edited fact is visibly
  marked as human-authored in the view (5e — the distiller will never silently clobber it).
- **Error mapping** to honest UI states: 401 (locked), 404 `target_not_found` (stale view →
  refresh), 400 `bad_body`/`bad_target_shape`, 500 — no silent failures, no fake success.
- Optional-but-cheap: an "undo window" is explicitly NOT built — forget is durable by design
  (ADR-0015); the confirm step is the safety.

**Out:** (deliberate cuts — PIPELINE §7.2)
- Forgetting/erasing **threads or messages** — that is thread-forget (backlog §C, roadmap 2e),
  a separate future feature; the per-message user route was REMOVED from the HTTP surface
  deliberately (returns 400).
- Conversational forget via the agent (2c) — separate next feature (backlog §B, Lior
  re-confirmed 2026-07-02).
- Editing threads/messages — the hatch's write surface is facts-only today; widening the
  daemon write API is NOT in this feature.
- Bulk operations, search/filter across facts — YAGNI at single-user scale.
- `@agentic/protocol` — **frozen**, byte-unchanged.

## Done criteria

- [ ] **[behavioral]** Forget: from the memory window, forgetting a fact (a) shows the
      release-the-reference confirm copy, (b) durably removes it — it does not re-appear in
      the view NOR in a NEW thread's injected context (live check against the running daemon),
      (c) leaves the source thread's messages intact and viewable.
- [ ] **[behavioral]** Edit: editing a fact lands the correction, the view shows the new text
      marked human-authored, and a subsequent distillation does not overwrite it (5e honored —
      verifiable via MEMORY_DEBUG or the demo harness).
- [ ] **[behavioral]** Killing the daemon mid-session degrades to the honest unreachable
      state; no action reports fake success.
- [ ] **[mechanical]** `bun test` green, `lint:strict` green, typecheck green.
- [ ] **[mechanical]** `git diff` on `packages/protocol/` is empty.

## Orchestrator brief (read by the orchestrator from this file)

```
implement edit + forget actions in the memory window per
orchestration/docs/specs/2026-07-02-memory-transparency-ui.md (Scope-IN item 2 act-half;
"Anchors" — forget = release-the-reference, backend write routes exist and are the contract).

Files to touch:
- apps/overlay/src/memory.ts / apps/overlay/src/memory/* (action calls, confirm UI, error
  mapping, human-authored marker) + memory.html/CSS
- NO daemon changes expected: POST /memory/forget + /memory/edit already enforce ctx
  { actor:"user", authored_by:"human" } server-side (http-routes.ts)

Done when: the five DoD boxes above hold. Spec demo-checklist items 3+4 are owned by this
chunk; final joint sign-off rides chunk 04. The forget-durability check MUST be exercised
against the real daemon (real-I/O posture — a probe is evidence only when executed).

ADRs in scope: 0015 (forget contract — durable fact-delete, sources untouched),
0012 (5a edit/forget + 5e never-overwrite-human), 0013 (token-gated writes — consume as-is).
```

## Notes / Open questions

- The daemon's error contract is regex-mapped from throw messages (see http-routes.ts
  `mapWriteError` note). Consume the HTTP status codes + error strings as the contract; do
  not introduce new throw sites.
- `packages/daemon/scripts/memory-demo-harness.ts` and `MEMORY_DEBUG` exist from
  distiller-v2 — use them for the 5e/durability verification instead of building new tooling.
