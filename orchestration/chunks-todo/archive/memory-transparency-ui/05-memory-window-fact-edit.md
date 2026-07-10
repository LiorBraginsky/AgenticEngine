> 🗄️ ARCHIVED 2026-07-10 — done. Historical record; do not edit.

# Chunk 5: Memory window — FACT-edit (edit what the agent remembers)

**Status:** done
**Created:** 2026-07-09
**Phase:** memory-transparency-ui (backlog Theme A — spec `docs/specs/2026-07-02-memory-transparency-ui.md`)
**Estimated size:** ~1 day
**Depends on:** 03 (merged — actions/write plumbing + the demo ruling that spawned this chunk)

> **Origin (Lior ruling, 2026-07-09, chunk-03 demo):** the shipped EDIT operates on MESSAGES
> (the only semantics the backend had — `WriteGate.edit(messageId)`, mirror of history.html).
> Lior's demo expectation was editing **what the agent remembers** — the distilled-fact text.
> That is the actual ADR-0012 5a promise ("see, correct, and delete what the agent remembers").
> This chunk adds it. Message-edit stays as shipped (blessed at the same demo).

## Scope

**In:**
- **Daemon (additive, security-adjacent):** extend `POST /memory/edit` with a
  `target_type:"fact"` discriminator — mirroring the body shape `POST /memory/forget`
  already has — routing to a fact-correction path in Hatch/store: update the fact's text,
  stamp `authored_by:"human"` (ctx is already fixed server-side `{actor:"user",
  authored_by:"human"}`). 5e never-overwrite-human must hold for the edited fact (the
  store's human-precedence machinery exists from v2 — wire it, don't rebuild it).
- **Dedup/replace interplay:** an edited fact must NOT be re-duplicated or clobbered by the
  next distillation (normalized-dedup suppress + REPLACE guard vs human facts) — cover with
  a real-I/O test (the distiller-integration/demo-harness pattern from v2).
- **Overlay:** Edit affordance on FACT rows (reuse chunk-03 `buildEditControl` inline
  textarea), wired to the new `target_type:"fact"` call; **persistent** "yours"/human badge
  on facts rendered from the fact's own `authored_by` data (unlike the message tag, this one
  IS durable — the field is persisted).
- Error mapping identical to chunk-03 (`204/401/404/400/5xx` → honest states).

**Out:** (deliberate cuts — PIPELINE §7.2)
- Changing message-edit semantics or its session-local tag — blessed as-is at the 2026-07-09
  demo; the ADR-0012 rider documenting both semantics rides chunk-04.
- Editing thread titles/metadata, bulk edits — YAGNI.
- Token revocation/rotation (the demo-3 item-4 note) — backlog, ADR-0013 polish, NOT here.
- `@agentic/protocol` — **frozen**, byte-unchanged (this chunk touches the daemon's HTTP
  body contract only — additive discriminator, same route, same auth; ADR-0015 relationship
  note holds: edit/forget fields are HTTP-body only, never the WS envelope).

## Done criteria

- [ ] **[behavioral]** In the memory window, editing a FACT's text saves, re-renders with a
      persistent human badge, and survives a full app restart (durable, not session-local).
- [ ] **[behavioral]** After a subsequent real distillation cycle (MEMORY_DEBUG / demo
      harness, real-I/O), the human-edited fact is NOT overwritten, duplicated, or
      re-derived-over (5e + dedup suppress) — and forget still works on the edited fact.
- [ ] **[behavioral]** Error paths honest: daemon down mid-edit → unreachable, no fake
      success (chunk-03 contract holds for the new path).
- [ ] **[mechanical]** `bun test` green (incl. new daemon route + store + DOM tests),
      `lint:strict` green, root+overlay typecheck green.
- [ ] **[mechanical]** `git diff` on `packages/protocol/` is empty; daemon diff limited to
      the additive edit path (http-routes/hatch/store + tests) — flag the security-adjacent
      files for reviewer attention.

## Orchestrator brief (read by the orchestrator from this file)

```
implement fact-edit per the Origin note above + spec 2026-07-02 (Scope-IN item 2 EDIT half,
as re-ruled 2026-07-09).

Files to touch:
- packages/daemon/src/memory/http-routes.ts (target_type:"fact" dispatch on /memory/edit —
  mirror the forget route's shape; security-adjacent, reviewer attention)
- packages/daemon/src/memory/hatch.ts / store.ts (fact-correction primitive: text update +
  authored_by:"human"; reuse v2 human-precedence, do not re-plumb)
- packages/daemon/src/memory/*.test.ts (route + store + 5e/dedup interplay real-I/O)
- apps/overlay/src/memory/ (Edit on fact rows via existing buildEditControl; persistent
  human badge from fact data; memory-write.ts gains the fact variant)

Done when: the five DoD boxes hold. The 5e/dedup box MUST be proven by an executed real-I/O
run (harness/MEMORY_DEBUG), not code-reading (§6.1/Strike-5). Behavioral demo rides the
chunk-04 JOINT demo unless the orchestrator finds a defect worth an early Lior pass —
default: mechanical gates here, live sign-off consolidated in chunk-04.

ADRs in scope: 0012 (5a edit-what-it-remembers + 5e), 0015 (body-only fields, durable
semantics), 0013 (token-gated writes — consume), 0005/0006 (unchanged surfaces).
```

## Notes / Open questions

- The daemon-touching diff makes this the ONE chunk of the feature that is not pure-overlay —
  coordinate merge order with chunk-04's history-page.ts edits (disjoint files, same package).
- Check `HatchViewResult` facts already expose `authored_by` for the badge; if absent, adding
  the field to the view payload is additive (read side, token-gated) — not a freeze concern.
