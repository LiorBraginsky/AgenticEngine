# Chunk 05: Transparency hatch (5a) — view/edit/forget + provenance affordance + route-closing demo

**Status:** in-progress
**Created:** 2026-06-04
**Phase:** Conversation & Interaction Model · route part 1 (Memory foundation)
**Estimated size:** ~1 day
**Depends on:** 04 *(hard prerequisite is the 02 injection-point + archive; the **sequential** edge is 04 per spec §6 F2 — 5a reads the injection that scan (03) + isolation (04) shape; §7.1 — disjoint files are not parallel-safe)*
**Spec:** `orchestration/docs/specs/2026-06-04-memory-foundation.md` (§3.5, §4.1, §4.2, §7) · **ADR:** [[../../docs/adr/0012-conversation-and-memory-model]] (decisions 5a, 5b-surface; decision 3 launcher-feel) · [[../../docs/adr/0005-ui-contract-closed-set]] (closed-set primitives for any overlay affordance)

## Scope

The **final chunk** of the route. It **fills** the injection-point + archive with the read/edit/forget **API + UI + policy** (the storage mechanism is already in chunk 01), surfaces distillation, ships the discoverability affordance, and carries the **route-closing live demo**.

**In:**
- **read/edit/forget API** over the archive + injection-point (daemon-internal seam from 01/02): view what's remembered + injected; edit (appends a `authored_by:human` correction); forget (tombstone + hard-scrub via the 01 mechanism).
- **Surfaces `distillation_events` (5b)** so the user can see *what was distilled, when, and that "nothing retained" was deliberate*.
- **UI surface** per spec §3.5 lean — the **web-admin "History" tab** ([[../../docs/architecture]] §3) as the management surface.
- **MANDATORY in-overlay provenance affordance** (spec §3.5, §7): the agent used a remembered fact → a lightweight "from where?" → leads into History. **Memory must be discoverable in daily use**, not buried (invisible memory = the #1 churn driver). The in-overlay affordance **must use an ADR-0005 closed-set primitive** (grill F5).
- **Route-closing live demo** (spec §4.1) as the route's behavioral gate.

**Out:** (each states WHY)
- **Re-plumbing the injection/write path** — OUT / **forbidden** (spec §3.3): fill the API over the existing seams.
- **A new overlay primitive for the affordance** without Q2 / ADR escalation — OUT / **frozen** per ADR-0005 (grill F5).
- **Full admin-tab build-out** (settings, plugin mgmt, devtools) — OUT; only the **History/memory** slice this hatch needs. The rest of the admin tab is its own later work.
- **Smart-distiller surfacing / richer memory analytics** — OUT; view/edit/forget + provenance + distillation events is the transparency floor (5a/5b), not an analytics product.

## Done criteria

- [ ] **[mechanical]** real-I/O: `view` returns the archive + distilled facts + `distillation_events`; `edit` appends a human-authored correction; `forget` tombstones + hard-scrubs — all through the real store (no mocks).
- [ ] **[mechanical]** real-I/O: a forgotten/edited item is reflected in the next thread's injection (closes the loop with 01/02's tombstone-honoring re-derive/injection).
- [ ] **[mechanical]** the in-overlay provenance affordance is an ADR-0005 closed-set primitive (no new primitive without escalation).
- [ ] **[behavioral]** **ROUTE-CLOSING LIVE DEMO** (spec §4.1, **Lior-gated**, PIPELINE §6.1) on macOS through the **real overlay → daemon → disk** path, nothing stubbed:
  1. summon → new thread → "the deploy script is `yeet.sh`";
  2. same thread → "what's the deploy script called?" → `yeet.sh` (within-thread multi-turn);
  3. dismiss (session dies; thread persists + distills);
  4. re-summon → NEW thread → "remind me the deploy script?" → `yeet.sh` (cross-thread continuity);
  5. **(resolves the §4.2 flag → option i)** open the hatch, **edit/forget** the fact → a new thread reflects the change;
  6. the agent **uses** a remembered fact → the **in-overlay provenance affordance** appears → click → lands in History (the step that proves the discoverability criterion below).
- [ ] **[behavioral]** the in-overlay provenance affordance is visible and leads into History (proven by demo **step 6** above — not assumed).
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

## Orchestrator brief (read by the orchestrator from this file)

```
implement the transparency hatch (view/edit/forget + provenance affordance) and run the route-closing demo
per orchestration/docs/specs/2026-06-04-memory-foundation.md §3.5/§4.1/§4.2/§7, ADR-0012 (5a, 5b-surface), ADR-0005.

Files to touch (indicative):
- packages/daemon/src/memory/  (read/edit/forget API over the seam from 01/02 — fill, do not re-plumb)
- web-admin "History" surface  (the memory management UI — first real job of the admin tab)
- apps/overlay/src/            (in-overlay provenance affordance — ADR-0005 closed-set primitive only)

Done when:
- view/edit/forget work over the REAL store (real-I/O); edit→human correction; forget→tombstone+scrub;
- forgotten/edited items are reflected in the next thread's injection;
- the in-overlay provenance affordance (closed-set) leads into History;
- the route-closing LIVE DEMO passes on macOS (Lior-gated, §6.1): yeet.sh 4-step + an edit/forget step;
- typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0012 (5a, 5b-surface, decision 3 launcher-feel), ADR-0005 (closed-set), ADR-0006 (overlay surface).
Frozen — DO NOT: re-plumb the inject/write path; add a new overlay primitive without Q2/ADR; build the rest of the admin tab.
```

## Notes / Open questions

- **§6.1 demo sequencing:** schedule the live demo **before** any closeout docs (the Strike-4 lesson). The demo is the route's single behavioral gate; chunks 01–04 closed out on real-I/O.
- **§7.1 runtime-coupling (grill F2):** last in the 03 → 04 → 05 data-flow chain — 5a reads the injection that scan (03) + isolation (04) shape. Re-validate at integration.
- **Discoverability (spec §7):** "web-admin History as the sole surface" is the letter of 5a without the spirit. The in-overlay provenance affordance is **not optional**.
- **Carry-forward from MF-03 review (S1, 2026-06-06, orchestrator annotation):** a machine-authored `distilled_fact` that is a *projection of human content* cannot be durably suppressed by MF-03's `forget` — a refused machine-forget leaves the human source un-tombstoned, so the next re-derive rebuilds the projection (5e protects the archive, not the projection). Real forget of an injected machine-projection needs a **projection-tombstone** (suppress on re-derive), which is **5a/hatch territory, not MF-03**. So: **5a's forget must suppress the machine projection of a forgotten human/machine fact at the injection-point, not only scrub the archive turn.** Surfaced on PR #23 (S1) and left for 5a per Lior's merge.
