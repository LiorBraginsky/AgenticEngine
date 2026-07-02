# Chunk 2: Memory window — VIEW (threads, facts, provenance)

**Status:** in-progress
**Created:** 2026-07-02
**Phase:** memory-transparency-ui (backlog Theme A — spec `docs/specs/2026-07-02-memory-transparency-ui.md`)
**Estimated size:** ~1 day
**Depends on:** 01 (the memory window shell + auth wiring + fetch-path decision)

## Scope

**In:**
- The **read side** of the in-overlay memory UI, inside the chunk-01 `memory` window:
  - **Threads list** (`GET /memory/threads`) with status/dates.
  - **Thread detail** (`GET /memory/thread/:id` → `hatch.view`): the thread's messages,
    ALL current distilled facts (the live projection), and **distillation events** —
    including the "0 facts (deliberately retained nothing)" rendering (ADR-0012 5b's
    observable-event guarantee, same as history.html).
  - **Distilled-facts view with per-fact provenance** (thread-level, `thread:<id>`) —
    provenance rendered as a link/jump to the source thread's detail view.
- **Expiry/confidence display rule (spec ruling 2026-07-02):** show these fields **only when
  non-default** (`expiry != null`, `confidence != 1`). Today that means they are effectively
  hidden — do NOT build scoring, decay, or editing for them.
- Honest empty/error states throughout (locked / daemon-down / empty-store), reusing the
  chunk-01 tri-state pattern.
- Feature parity target is **history.html's read side** — same data, native-window UX, zero
  token paste.

**Out:** (deliberate cuts — PIPELINE §7.2)
- Edit + forget actions — chunk-03 (kept separate so the read surface merges without the
  mutation semantics discussion).
- Any change to `history.html` itself — chunk-04 owns the browser-fallback UX tails.
- In-answer provenance affordance on live agent replies — CARVED OUT of the feature entirely
  (spec Scope-OUT; its own future design task).
- Message-level provenance — CLOSED per spec Scope-OUT (backlog "Ruled out" 2026-07-02).
- New daemon read routes — the existing two read routes are the contract; if a real gap
  appears, it must be small + additive and flagged in the PR (spec anchor "Backend is ready").
- `@agentic/protocol` — **frozen**, byte-unchanged.

## Done criteria

- [ ] **[behavioral]** From the tray, the memory window lists real threads from
      `~/.agentic-engine/memory.sqlite`; clicking a thread shows its messages, the distilled
      facts, and distillation events (including a 0-fact event if present) — with no token
      entry.
- [ ] **[behavioral]** Each distilled fact shows its provenance; the provenance link navigates
      to the source thread's detail.
- [ ] **[behavioral]** A fact with default `expiry`/`confidence` shows NO expiry/confidence
      chrome; (test-seeded) non-default values ARE shown.
- [ ] **[behavioral]** (Demo-1, Lior 2026-07-02) **Down-with-content-rendered:** with the
      threads list (or a thread detail) rendered, killing the daemon flips BOTH the header
      banner AND the content sections to the same honest "Daemon unreachable" state within a
      few seconds — the header and content never contradict, no stale content lingers.
- [ ] **[behavioral]** (Demo-1, Lior 2026-07-02) **Recover-refetch-without-restart:** starting
      the daemon again re-populates the content sections (the same poll/transition that flips
      the header to "Connected (N)" also re-fetches the current view) — full recovery with NO
      `tauri` restart; if a thread detail is open, that same thread re-loads in place.
- [ ] **[mechanical]** `bun test` green (incl. any new UI/data-shaping tests + the new
      `controller.test.ts` covering both state-sync transitions), `lint:strict` green,
      typecheck green.
- [ ] **[mechanical]** `git diff` on `packages/protocol/` is empty.

## Honest-state contract (Lior, Demo-1 2026-07-02) — the state-sync rule

The connection **banner** and the **content sections** are driven by the same liveness poll and
MUST never contradict each other:
1. The header and the sections never show contradictory states.
2. The same poll/transition that flips the header to **Connected** must also **re-fetch section
   content**, so the window fully recovers **without a restart**.
3. On daemon-down, already-rendered content adopts ONE honest behavior, applied consistently to
   both the list and the open-detail views. **Chosen: clear-to-unreachable** (content clears to
   the same honest "unreachable"/"locked" message the banner shows) — NOT a stale marker
   (plan `## Demo-1 fix — state-sync (item 4)` → `## The decision`).

## Orchestrator brief (read by the orchestrator from this file)

```
implement the memory window's read side per
orchestration/docs/specs/2026-07-02-memory-transparency-ui.md (Scope-IN item 2 view-half +
item 4 display rule; "Anchors" section binding).

Files to touch:
- apps/overlay/src/memory.ts (+ split into modules as it grows) + memory.html + CSS
- possibly apps/overlay/src/memory/ for data-fetch + render helpers with unit tests
- (only if chunk-01's fetch-path decision was daemon-CORS and a header tweak is still
  pending) packages/daemon/src/memory/http-routes.ts — additive, security-adjacent, flag it

Done when: the five DoD boxes above hold. Spec demo-checklist item 2 is owned by this chunk;
final joint sign-off rides chunk 04.

ADRs in scope: 0012 (d.5a view + 5b observable events + 5c provenance display),
0013 (token-gated reads — consume, don't change), 0005 (this surface is engine-owned,
NOT closed-set primitives — adding a protocol primitive here would be a freeze-gate STOP).
```

## Notes / Open questions

- Reference implementation for data shapes + rendering decisions: the served
  `packages/daemon/src/memory/history-page.ts` (threads/facts/events sections, zero-count
  rendering). Don't import it — it's a self-contained served page; parity of information, not
  of code.
- `HATCH_VIEW_FACT_CAP = 1000` — the view returns all facts below the cap; no pagination work
  in this feature (single-user scale, same posture as the distiller's all-facts pool).
