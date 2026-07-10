> 🗄️ ARCHIVED 2026-07-10 — implemented. Historical record; do not edit.

---
title: Memory transparency UI — the in-overlay hatch (backlog Theme A)
status: implemented — all chunks (01–05) shipped + Lior's joint §6.1 live demo signed 2026-07-10; archived chunks in chunks-todo/archive/memory-transparency-ui/ (was: accepted — in-chat scope sign-off 2026-07-02, decomposed same day → chunks 01–04, +chunk-05 fact-edit added at the 2026-07-09 demo)
date: 2026-07-02
tags: [memory, transparency, overlay, tray, settings, north-star]
related:
  - ../adr/0012-conversation-and-memory-model.md (decision 5, the day-one transparency mandate)
  - ../adr/0006-dual-hotkey-2zone-ux.md (p.4 — the deferred tray icon this feature un-defers)
  - ../adr/0005-ui-contract-closed-set.md (why the surface class matters)
  - ../adr/0015-intent-based-memory-forget.md (forget semantics anchor)
  - ../memory-backlog.md (§A — this feature executes it)
  - ../2026-06-12-memory-quality-scope.md (the in-overlay UI section + UX backlog A/B)
---

# Theme A — in-overlay memory transparency & control

> **For the decompose session.** Brainstorm ran 2026-07-02 (this doc records its rulings —
> do not re-open them without Lior). North-star authority: ADR-0012 decision 5.

## Why

ADR-0012's day-one mandate: memory is invisible by default, but **view / edit / forget +
provenance are built from the start**. Lior's anchor: *"the user never directly contacting
the memory is the single most expensive mistake."* Today ALL of that transparency lives in
a browser page (`history.html`, loopback, manual token paste). Theme A moves it to where
the user actually lives — the overlay. This is the largest gap between the shipped system
and the stated vision (memory-backlog §A, "Lior's #1 vision item").

## Scope — IN

1. **Tray-icon + settings-overlay shell** (natural chunk-01; un-defers ADR-0006 p.4).
   Menu-bar status indicator (running / idle / error) + a menu entry that OPENS the
   memory/settings surface. This is the missing entry point that blocks everything else;
   it has no standalone value, so it ships inside this feature (Lior ruling 2026-07-02).
2. **In-overlay memory UI** — **full view / EDIT / forget** for threads + distilled facts,
   with per-fact provenance (thread-level) displayed. The overlay already reads the auth
   token Rust-side (`read_auth_token`, chunk CM/02) → **no manual token entry by
   construction** (kills the browser page's re-paste friction). Edit = the correction flow
   riding MUTATION-AS-APPEND (`authored_by:human` + 5e never-overwrite-human are already
   enforced by the write-gate). `history.html` stays as the no-install fallback.
   > **EDIT ruling (Lior, 2026-07-09, chunk-03 demo):** "edit" split into TWO blessed
   > semantics — (a) **message-correction** in the thread archive (shipped in chunk-03;
   > MUTATION-AS-APPEND, session-local "edited by you" tag) and (b) **fact-edit** — editing
   > the distilled-fact text itself, the actual 5a "correct what the agent remembers"
   > promise — which the backend lacked (no fact-edit route existed; the spec's original
   > wording over-promised against the seam). Fact-edit added as **chunk-05** (additive
   > `target_type:"fact"` on `/memory/edit`, durable human badge). ADR-0012 rider documenting
   > both rides the chunk-04 closeout.
3. **UX tails inherited from history.html** (scope-note backlog A/B): an explicit
   **🔒 locked** state instead of the false "Loading…", and token-trimming /
   copy-clean-token on the browser-fallback paste path.
4. **Expiry / confidence display rule** — show these fields **only when non-default**
   (today they are always `null`/`1` → effectively hidden). No scoring is built (see OUT).

## Scope — OUT (with why — Lior rulings 2026-07-02)

- **In-answer provenance affordance** ("where did this come from?" link on a live agent
  answer) — **CARVED OUT into its own design task** (see memory-backlog §A). Lior's
  concern: dragging fact→thread linkage through live answers risks overcomplicating the
  memory UX; weigh pros/cons deliberately. ⚠️ ADR-0012 5a names this affordance mandatory —
  this carve-out is a **recorded deliberate revisit**, not a silent drop; the design task
  owns reconciling with (or amending) ADR-0012.
- **Message-level provenance** — **CLOSED** (moved to backlog "Ruled out"): no concrete
  benefit identified; thread-level provenance suffices for "where from"; per-message forget
  was already ruled out earlier.
- **Expiry / confidence scoring & decay** — **not building.** Single-user dogfood has shown
  no stale-fact pain; building aging without data on what it should catch is guessing.
  Columns stay (they cost nothing). Revisit when the fact base starts to smell stale.
- **2c conversational forget** (agent memory-action tools) — untouched; stays the separate
  next feature after this one (backlog §B).

## Anchors (settled — do not re-decide at design time)

- **Forget semantics = "release the reference."** Forgetting a fact durably deletes the
  fact row only — it never deletes or scrubs the source messages/thread (shipped v2
  semantics; ADR-0015, dual-delete Option B ruled out). The UI must present forget in
  these terms.
- **Surface class:** the memory UI is an **engine-owned native surface** (like
  history.html), NOT plugin-emitted closed-set primitives. `@agentic/protocol` is expected
  **untouched**. The architect must verify this holds; if any chunk finds a protocol change
  necessary → that is a **freeze gate** (human review, no auto-merge) → escalate first.
- **Two-zone UX stays intact** (ADR-0006): the memory surface is opened from the tray, it
  does not live inside the launcher summon-flow. Exact window/panel shape = architect-time.
- **Backend is ready:** the transport-agnostic read/edit/forget API + HTTP routes + token
  auth already exist and are consumed by history.html
  (`packages/daemon/src/memory/http-routes.ts`, `history-page.ts`). This feature is
  overlay/shell + wiring work, not new daemon mechanics; API gaps found should be small
  and additive.

## Verification posture

Behavioral DoD = **Lior's live demo** (Strike-4/5 standing rule — a probe is evidence only
when executed). Demo checklist:
1. tray icon shows status and opens the memory surface — with **no token paste**;
2. the surface lists threads + distilled facts with per-fact provenance;
3. **edit** a fact → correction lands, human-authored flag honored (never machine-clobbered);
4. **forget** a fact → durably gone from injection in a NEW thread (source thread intact);
5. locked / daemon-down states are honest (no false "Loading…").
Intermediate gates = real-I/O (no mocks across the daemon boundary), per the standing rule.

## Pointers

- memory-backlog §A · ADR-0012 d.5 · ADR-0006 p.4 · ADR-0005 · ADR-0015
- `docs/2026-06-12-memory-quality-scope.md` (in-overlay section + UX A/B)
- `specs/2026-06-04-memory-foundation.md` §7 (the 5a sub-chunk framing)
- `packages/daemon/src/memory/` (http-routes, history-page, store, write-gate)
- `apps/overlay/` (Tauri; `src-tauri` — `read_auth_token` lives here)
