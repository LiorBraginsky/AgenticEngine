> 🗄️ ARCHIVED 2026-07-10 — done. Historical record; do not edit.

# Chunk 4: history.html fallback UX tails + feature closeout (joint demo)

**Status:** done
**Created:** 2026-07-02
**Phase:** memory-transparency-ui (backlog Theme A — spec `docs/specs/2026-07-02-memory-transparency-ui.md`)
**Estimated size:** ~0.5–1 day
**Depends on:** code: none (parallelizable) · closeout/demo: 01+02+03+**05** merged

> **UNBLOCKED (conductor, 2026-07-09):** chunk-05 merged (PR #79, `5919f99`) — flipped back
> to `todo` per the unblock ritual. Closeout duties carried in: the **ADR-0012 rider** via
> adr-curator (edit = two blessed semantics: message-correction w/ session-local tag (03) +
> fact-edit w/ durable human badge (05)); the token-revocation backlog note already landed
> (memory-backlog §A, PR #78). Chunk-05 file stays `in-progress` deliberately — its live
> behavioral half rides THIS chunk's joint demo; archive it (done + banner + move) together
> with the rest of the §4.4 closeout ritual here.

## Scope

**In:**
- **history.html UX tails** (the browser page stays the no-install fallback; scope-note
  2026-06-12 items A+B):
  - **A:** explicit **🔒 locked / "paste token to view"** initial state — kill the false
    "Loading…"-then-"no threads" sequence when no/bad token is set.
  - **B:** **trim non-token characters** on the paste path (the zsh trailing-`%` footgun) —
    tolerate whitespace/artifacts around the token; and make the displayed/served token value
    copy-clean at the source if cheap.
- **Feature closeout ritual** (after 01–03 merged AND the joint live demo passes):
  - Coordinate **Lior's joint live demo** across the spec's 5-item checklist (§6.1 — the
    behavioral gate for the whole feature).
  - Archive per §4.4: spec → `implemented` + banner + `specs/archive/`; chunks → `done` +
    banner + `chunks-todo/archive/memory-transparency-ui/`; plan file(s) → `shipped` +
    `plans/archive/`.
  - Update `docs/memory-backlog.md` (§A items shipped) + `docs/roadmap.md` ("Memory — next"
    reflects Theme A shipped; queue = 2c → provenance-affordance design task → 2d).

**Out:** (deliberate cuts — PIPELINE §7.2)
- Restyling or feature-extending history.html — it is the fallback, not the product surface
  anymore; only the two honest-state/token tails.
- Removing history.html — OUT; spec keeps it as the no-install fallback.
- Any overlay/memory-window change — chunks 01–03 own that surface.
- `@agentic/protocol` — **frozen**, byte-unchanged.

## Done criteria

- [ ] **[behavioral]** Opening history.html with no token shows the explicit 🔒 locked state
      (never "Loading…"/"no threads"); pasting a token with a trailing `%`/whitespace works.
- [ ] **[behavioral]** **Joint feature demo (Lior, live)** — the spec's 5-item checklist
      passes end-to-end on the real daemon + real store. This gates the WHOLE feature's
      behavioral DoD, not just this chunk (§6.1).
- [ ] **[mechanical]** `bun test` green, `lint:strict` green, typecheck green.
- [ ] **[mechanical]** Archive ritual complete: spec/chunks/plans moved + banners + statuses
      flipped; backlog + roadmap updated.
- [ ] **[mechanical]** `git diff` on `packages/protocol/` is empty.

## Orchestrator brief (read by the orchestrator from this file)

```
implement the history.html UX tails per
orchestration/docs/specs/2026-07-02-memory-transparency-ui.md (Scope-IN item 3), then run
the feature closeout (joint demo coordination + §4.4 archive ritual + backlog/roadmap update).

Files to touch:
- packages/daemon/src/memory/history-page.ts (locked state, token trim on the paste path)
- packages/daemon/src/memory/*.test.ts (state/trim coverage)
- closeout: orchestration/docs/specs/, orchestration/chunks-todo/, orchestration/docs/plans/,
  orchestration/docs/memory-backlog.md, orchestration/docs/roadmap.md

Done when: the five DoD boxes above hold. NOTE: the joint-demo box is a §5.2 Lior gate —
do NOT self-certify; sequence the demo BEFORE closeout docs/archival (§6.1).

ADRs in scope: 0013 (the locked state is the honest face of the read-gate; token handling —
never log the credential), 0012 (5a — the fallback hatch stays truthful).
```

## Notes / Open questions

- Runtime coupling (§7.1): this chunk touches `packages/daemon/src/memory/history-page.ts`
  while chunks 02/03 only CONSUME the HTTP API — no behavioral overlap. IF chunk-01/02's
  fetch-path decision added a CORS header in `http-routes.ts`, the files are still disjoint;
  just coordinate merge order to keep rebases trivial.
- The closeout half cannot start until 01–03 are merged; the code half can land any time.
  If run early, leave the chunk `in-progress` with the code-half committed and the closeout
  boxes unchecked — do NOT split-archive.
