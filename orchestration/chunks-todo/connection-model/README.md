# connection-model — demo-unblocking slice (chunks 01–03)

> Decomposed 2026-06-10 by the conveyor decompose-chat from the ACCEPTED spec
> `orchestration/docs/specs/2026-06-05-connection-model.md` (merged PR #21), under
> **Lior's binding scope ruling (2026-06-10)**: decompose ONLY the demo-unblocking
> slice — **persistent WS + thread-continuation + dismiss⇒persist**. Chunk-cuts were
> NOT pre-reviewed by Lior; each chunk file is the self-sufficient frozen yardstick.

## The slice and its gate model

- **Chunks 01 → 02 → 03 are STRICTLY SEQUENTIAL** (PIPELINE §7.1): they share the same
  runtime surfaces (`apps/overlay/src/ws/session-client.ts`, `apps/overlay/src/main.ts`,
  `packages/daemon/src/index.ts`, `ThreadLifecycle`, `ws.data` shape) even where files are
  disjoint. No parallel execution.
- **DoD design constraint (Lior, 2026-06-10, binding):** every chunk's MERGE gate is fully
  automated (real-I/O / automated behavioral tests — PIPELINE §6.1 accepts these as runtime
  evidence). There are **NO per-chunk Lior demos**. The ONE Lior touch for the whole slice is
  the **joint 6-step route-closing live demo** (memory-foundation spec §4.1) that closes BOTH
  this slice and MF-05 — carried as chunk 03's `[behavioral]` criterion, which gates the
  chunk's `done`/archive, **not** its PR merge (the MF-05 pattern: merged PR, chunk stays
  `in-progress` until the demo).

## Crosswalk to the spec's §6 proposal

| Spec §6 label | This folder |
|---|---|
| CM-01 "Persistent WS + dismiss + thread continuation" (~1–1.5 d, one chunk) | split into **01 + 02 + 03** (atomic PR-sized cuts; ~0.5–1 d each) |
| CM-02 "Inbound push routing (overlay side)" | **DEFERRED — no chunk cut.** See below. |

## Deferred: inbound push (spec §3.4 + §3.5 overlay multiplexing) — WHY

**OUT of this slice per Lior's 2026-06-10 ruling.** Rationale, recorded so the cut reads as
deliberate (PIPELINE §7.2), not stale drift:

- **Not needed for the joint demo.** Spec §6 itself: "CM-02 is OPTIONAL for the route-closing
  demo (inbound push = cron, which is Phase 6). CM-01 alone unblocks all 6 demo steps."
- **The mechanism stays frozen in the spec** (§3.4: unsolicited `session_ack` → new session
  context; §3.5: `Map<sessionId, SessionContext>` + concurrency limit). Nothing here
  re-litigates it; chunk 02 keeps its inbound dispatcher **Map-ready** (seam-not-logic, the
  memory-foundation §3.3 discipline) so the deferred work fills it without re-plumbing.
- **Overlay-side concurrency is gotcha #45 territory** ("DO NOT patch the symptom") — the
  single-flight `inFlight` guard stays until the concurrent-session model is built deliberately.
- Re-open when Phase 5/6 (cron/rituals) starts — spec §7 "CM-02 build timing".

## §7.1 runtime-coupling map — PR #30 (MF-05 T2, OPEN, not on main)

PR #30 stays **open-green until the joint demo** and overlaps this slice in
`packages/daemon/src/index.ts` (+64/−9: `/memory/*` HTTP wiring + a provenance stamp in the
outbound `send()` loop) and `packages/daemon/src/memory/store.ts`:

1. **index.ts overlap** — concentrated deliberately in **chunk 03** (close-handler + the
   PROVISIONAL thread-switch block); chunk 01 stays in `thread-lifecycle.ts`/`store.ts`,
   chunk 02 is overlay-side + daemon tests only. One rebase pressure point instead of three.
2. **Provenance-stamp assumption** — PR #30's per-inbound-message `injectedMemory` flag stamps
   every `show_text` of a turn (one-show_text-per-turn assumption; reviewer MINOR #2 on PR #30).
   Under this slice turns stay **single-flight sequential** over the persistent socket, so the
   flag remains per-turn-correct — but it MUST be re-checked under persistent-WS multi-turn at
   rebase time (chunks 02/03 notes).
3. **PR #30 gets updated onto post-CM main + re-verified BEFORE the demo — Jimmy's job, not a
   chunk task.**

## Frozen surfaces

`packages/protocol/**`, `mock-agent.ts`, `mock-provider.ts` stay **byte-unchanged** across all
three chunks. The slice is built with **zero wire change** (see chunk 01's adoption decision);
if any chunk discovers it cannot proceed without a protocol change, that is a **freeze gate**:
post `BLOCKED`, do not design around it silently.
