# Plan — MF-05 (5a): Transparency hatch — view/edit/forget + provenance affordance + route-closing demo

**Chunk:** `orchestration/chunks-todo/memory-foundation/05-hatch-view-edit-forget.md`
**Feature:** memory-foundation (route part 1) · final chunk
**Spec:** `orchestration/docs/specs/2026-06-04-memory-foundation.md` §3.3/§3.4/§3.5/§4.1/§4.2/§7
**ADRs in scope:** 0012 (5a, 5b-surface, decision 3), 0005 (closed-set), 0003 (daemon WS — Tranche-2 boundary)

## Status

**Phase 3 — Tranche 1 verified-done + review-complete; Tranche 2 BLOCKED (escalated).** Plan approved-by-default (conveyor §5.2: well-scoped, fits the decompose-blessed chunk).

**Tranche-1 verification (command-evidence, orchestrator-re-run — not worker assertion):**
- `bun run typecheck` → exit 0 · `bun run lint:strict` → exit 0
- `bun test packages/daemon` → **143 pass / 0 fail** (8 new hatch real-I/O tests + 4 fix-pass tests; no regression)
- frozen `packages/protocol` → byte-unchanged vs `main` (`git diff --stat` empty)
- **engine-reviewer: 0 Critical / 0 Major.** 2 Minor + 1 Nit all fixed in a follow-up pass (UUID-shape guard on `forgetFact`/`tombstoneFact` to enforce the seam invariant; a direct cross-thread `edit→distill→retrieve` test closing DoD #2's edit case; `HATCH_VIEW_FACT_CAP` named constant).
- Proves DoD **#1, #2, #6** with real-I/O evidence. DoD **#3, #4, #5** are Tranche 2 (gated — NOT built).

**Tranche 2 escalated, not built** — three gates (ADR-0013 acceptance · CM-01 missing prerequisite · route-closing live demo) → see Gates summary. The chunk is **NOT `done`** (behavioral DoD pending); chunk file stays `in-progress`, not archived.

**Tranche-2 carry-forward (reviewer Minor 2):** before the gated HTTP route wires `Hatch.view`, decide whether `view` stays full-live-slice (current, memory-management semantics) or becomes thread-scoped/paginated.

---

## Definition-of-Done tagging (orchestrator, Phase 0 — drives the verified-done gate §6)

| # | DoD criterion | Class | Tranche | Provable in this chat? |
|---|---|---|---|---|
| 1 | `view`/`edit`/`forget` over the **real store** (no mocks) | **mechanical** | 1 | ✅ command-evidence |
| 2 | forgotten/edited item reflected in **next thread's injection** | **mechanical** | 1 | ✅ command-evidence (projection-tombstone) |
| 3 | in-overlay provenance affordance is an **ADR-0005 closed-set primitive** | **mechanical** | 2 | ⚠️ primitive chosen (`show_text`, no escalation) but build is gated |
| 4 | **ROUTE-CLOSING LIVE DEMO** (6-step, macOS) | **behavioral** | 2 | ❌ Lior-gated §6.1 **+ blocked on CM-01** |
| 5 | provenance affordance visible & leads into History (demo step 6) | **behavioral** | 2 | ❌ Lior-gated §6.1 |
| 6 | `typecheck` + `lint:strict` + `bun test` green | **mechanical** | 1 | ✅ command-evidence |

Tranche 1 proves criteria **1, 2, 6** with real-I/O evidence. Criteria **3, 4, 5** are Tranche 2 (gated).

---

## Reality check (architect, authoritative — file-cited)

The foundation (MF-01..04, merged) is substantially built; MF-05 mostly **fills a read API + one real seam (projection-tombstone)** — it does **not** re-plumb the write/inject path.

- **Store + tables** — `packages/daemon/src/memory/store.ts` (`MemoryStore`) over `schema.ts` (`SCHEMA_DDL`): `threads`, `messages`, `mutations`, `distilled_facts`, `distillation_events`, `quarantine_markers`.
- **Write-gate** — `packages/daemon/src/memory/write-gate.ts` (`WriteGate`): **`edit()`** (appends `correction`) + **`forget()`** (appends `tombstone` + hard-scrubs `messages.content`→`REDACTION_MARKER` + redacts JSONL mirror) **already exist and route through the gate** (5e `isHumanAuthored` guard present). MF-05 adds a *read* API + wires the hatch caller — it does not rebuild edit/forget.
- **Injection-point** — `thread-lifecycle.ts` `ThreadLifecycle.beginTurn` → `memoryProvider.retrieve(store, threadId)`; port `memory-provider.ts` (`MemoryProvider.distill/.retrieve`).
- **Tombstone-honoring re-derive** — `providers/dumb-tail-provider.ts` `distill()` filters `REDACTION_MARKER`; `retrieve()` filters `!store.isMessageTombstoned(provenance)`.
- **Live-slice purge (grill-S2)** — `WriteGate.forget` already calls `dropDistilledFactsByProvenance` + `dropDistilledFactsForThread` (machine-only guarded).
- **`distillation_events`** — written every dismiss (even empty) by `distiller-registration.ts`; read via `store.readDistillationEvents`.
- **Daemon is pure-WS** — `index.ts` `Bun.serve`: `fetch` origin-gates→`upgrade()` (403/400) + `websocket` handler. No HTTP route-serving today.
- **`web-admin` does NOT exist** — only `apps/overlay`, `packages/daemon`, `packages/protocol`.
- **Overlay primitives = two** — `color-picker` (interactive) + `text` (`show_text`, display-only, `apps/overlay/src/widgets/text-reply.ts` ← `TextPrimitive` in `packages/protocol/src/primitives.ts`). Envelope union (`packages/protocol/src/envelope.ts`) is the byte-frozen surface.

### 🚩 FLAG — FOUNDATION GAP (the one real seam to fill; = the S1 carry-forward)
The **projection-tombstone**. Existing `forget-survives-re-derive` (`distiller-integration.daemon.test.ts:117`) only covers forget targeting a **`messages.id`** (re-derive then sees `REDACTION_MARKER`). It does **not** cover forgetting a **distilled fact whose source turns stay live** — esp. a **thread-level-provenance** fact (`provenance="thread:<id>"`), where `isMessageTombstoned("thread:<uuid>")` is structurally always false (`fixed-marker-provider.test.ts:103`) and the next `distill` rebuilds it. Per spec §3.3 this is **5a territory, additive (not re-plumb)** — design below. **Tranche 1.**

### 🚩 FLAG — PREREQUISITE NOT BUILT: CM-01 (blocks the route-closing demo)
`apps/overlay/src/ws/session-client.ts` still opens a WS per turn and `ws.close()`s on `session_end` (lines 165-167). connection-model spec §4.1 names **CM-01** (persistent WS + `close(ws)`→dismiss + overlay `thread_id` continuation) as the hard prerequisite for **demo steps 2-4** (within-thread multi-turn, dismiss→consolidate, cross-thread re-summon). MEMORY.md + memory-foundation spec §6 say *"CM-01 slots after MF-04 before MF-05,"* but **no CM chunk file exists** in `chunks-todo/`. → **The Tranche-2 demo cannot run on the real overlay until CM-01 ships.** Does not block Tranche 1. **Lior/Jimmy must resolve sequencing** (build CM-01 first, or approve a demo harness).

---

## Surface & security (Tranche 2 — orchestrator-decided surface, Lior-gated caller-auth)

**Surface (decided):** daemon-served minimal HTTP History surface — JSON `/memory/*` read/edit/forget API + a minimal static `history.html` on the existing `Bun.serve` `fetch` handler. Exercises §3.5's sanctioned "admin-tab HTTP" option. NOT a web-admin SPA (scope-forbidden), NOT overlay-as-management (against §3.5). Consumes the Tranche-1 transport-agnostic API.

**🚩 Open caller-auth question (Lior must rule — the ADR substance):** the only caller-gate today is the **Origin allowlist** on the WS upgrade (`origin.ts`, ADR-0003 Amendment) — **#31-spoofable by non-browser clients** and **only guards the WS upgrade**, nothing for a new HTTP route. A `/memory/*` edit/forget route is a **new localhost memory-write surface any local process can hit** (the #31 CSWSH↔poisoning chain ADR-0012 dec.5 names). 5d/5e/5f protect write *content*, **not the caller**. Options:
- **(A)** Un-defer the per-install WS token (ADR-0003 p.5) as an HTTP bearer on all `/memory/*`.
- **(B, architect-recommended)** read-open-on-loopback / write-requires-token (`POST`/`DELETE` gated).
- **(C)** Origin-allowlist parity on the HTTP route — weakest (same #31 spoofability), interim only.

---

## Projection-tombstone design (Tranche 1 — the crux of DoD #2)

A **fact-level tombstone** on the existing `mutations` table, honored by `distill` + `retrieve`. Additive — no new table, no write/inject re-plumb.

**Three function-cited hooks:**
1. **`MemoryStore.tombstoneFact(provenance, ctx)`** (new, `store.ts`) — append `mutations` row `kind='tombstone'`, `target_message_id=provenance` (TEXT col accepts `"thread:<id>"`). 5e guard: refuse machine-tombstone of an `authored_by:'human'` fact.
2. **`MemoryStore.isFactTombstoned(provenance): boolean`** (new) — `SELECT 1 FROM mutations WHERE target_message_id=? AND kind='tombstone'`. Generalizes `isMessageTombstoned` (its message-id case is a subset).
3. **Honor at re-derive + inject** — both providers (`dumb-tail-provider.ts`, `fixed-marker-provider.ts`): `distill` drops facts where `isFactTombstoned(provenance)`; `retrieve` replaces `isMessageTombstoned` with `isFactTombstoned` (strict superset, no regression).

**Hatch forget routing:** message-id target → existing `WriteGate.forget`; distilled-fact-provenance target → new `WriteGate.forgetFact(provenance, ctx)` = `tombstoneFact` + existing live-slice purge. Result: gone from live slice immediately **and** suppressed on every future re-derive.

**Load-bearing failing test (TDD anchor, T1.2):** forget a `thread:<id>` FixedMarker fact; drop+re-derive with source turns still live; assert it does NOT re-appear in `distill` NOR `retrieve`. Fails today (proves the gap), passes after the three hooks.

---

## Provenance affordance (Tranche 2 — primitive decided now, NO escalation)

Composes from the existing **`show_text`** closed-set primitive — **no new overlay primitive, no Q2/ADR escalation**. The daemon stamps a provenance line into the `show_text` content when a reply drew on injected memory (it already prefixes injected slice `[remembered] ...`, `dumb-tail-provider.ts:58`); the "leads into History" link is the URL `http://127.0.0.1:7777/history` opened via the overlay's existing browser-open path — not a new interactive primitive. **🚩 If at build the text-line is judged insufficient for §7 discoverability → separate Q2/ADR escalation; do NOT invent a primitive.**

---

## ADR worthy: yes

**Title:** "Daemon memory-write HTTP surface + caller-auth model." Records (a) the new `/memory/*` HTTP route family on `localhost:7777` (first mutating non-WS route — ADR-0003 p.4 anticipated HTTP for *large-asset transfer*, NOT memory writes), (b) the caller-auth ruling (A/B/C above) + relation to the deferred per-install token + security-hardening pass, (c) a note that 5a closed the S1 projection-rebuild gap. Route to `adr-curator`; **Lior accepts before T2.1 builds.**

---

## Steps

### TRANCHE 1 — BUILD NOW (gate-free; real-I/O proven; branch `chunk/mf-05-hatch-tranche1`)

- **T1.1 — Read API over archive + distilled facts + distillation_events.** New `packages/daemon/src/memory/hatch.ts` (`Hatch(store, gate)` façade) + `MemoryStore.readThreadArchive`. TDD: failing real-I/O test → `hatch.view(threadId)` returns `{messages, distilledFacts, distillationEvents}` through the real store; tombstoned rows surface as `REDACTION_MARKER`. Additive SELECTs only.
- **T1.2 — Projection-tombstone (S1 fill) + edit/forget façade.** The three hooks above + `WriteGate.forgetFact` + `Hatch.edit/forget` dispatch. TDD: (a) forget-machine-projection survives re-derive (thread-level provenance — the load-bearing test); (b) edit→`authored_by:human` correction reflected in next injection; (c) forget→tombstone+hard-scrub absent from next injection; (d) **no regression** in existing MF-02/03 forget tests.
- **T1.3 — Surface distillation_events (incl. empty consolidation) + façade smoke.** `view` returns `readDistillationEvents` verbatim incl. `facts_produced===0` rows (5b: "deliberately retained nothing" ≠ "silently lost").

**Tranche-1 verified-done:** all real-I/O tests pass + `typecheck` + `lint:strict` + `bun test packages/daemon` green (command-evidence) + reviewer-clean.

### TRANCHE 2 — GATED, DO NOT BUILD (escalate first)

Blocked on: **(1)** caller-auth ADR ruling, **(2)** CM-01 prerequisite (demo steps 2-4), **(3)** provenance-affordance sufficiency (only if text-line judged insufficient).

- **T2.1 — GATED:** daemon HTTP `/memory/*` route (`index.ts` `fetch`), behind the ruled caller-auth. **ADR accepted first.**
- **T2.2 — GATED:** minimal static `history.html` (History slice only — no settings/plugins/devtools).
- **T2.3 — GATED:** in-overlay provenance affordance (`show_text` line → History URL).
- **T2.4 — GATED:** route-closing live demo (Lior §6.1, requires CM-01) — 6-step `yeet.sh` through real overlay→daemon→disk. **Behavioral — requires runtime demo; NEVER self-certified.**

---

## Gates summary (what this chat escalates)

1. **ADR acceptance** — caller-auth model for the daemon memory-write HTTP surface (Tranche 2). Proposed ADR drafted for Lior.
2. **CM-01 missing prerequisite** — the route-closing demo cannot run until CM-01 (persistent-WS overlay) ships or a harness is approved. Sequencing decision for Lior/Jimmy.
3. **Route-closing live demo** — Lior-gated §6.1 (the route's single behavioral gate; gates DoD #4, #5).
