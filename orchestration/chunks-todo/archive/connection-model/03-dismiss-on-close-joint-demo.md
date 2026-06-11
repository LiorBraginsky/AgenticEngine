> 🗄️ ARCHIVED 2026-06-11 — done. Historical record; do not edit.

# Chunk 3: dismiss = close(ws) → consolidate; retire the provisional trigger; joint-demo gate

**Status:** done
**Created:** 2026-06-10
**Phase:** Conversation & Interaction Model · connection-model (demo-unblocking slice, 3 of 3)
**Estimated size:** ~0.5–1 day
**Depends on:** 02 *(STRICTLY SEQUENTIAL — `close(ws)` is only a meaningful dismiss signal once the socket is persistent; PIPELINE §7.1)*
**Spec:** `orchestration/docs/specs/2026-06-05-connection-model.md` (§3.2, §4.1, §4.2, §5) · `orchestration/docs/specs/2026-06-04-memory-foundation.md` (§4.1 — the joint demo) · **ADR:** [[../../docs/adr/0012-conversation-and-memory-model]] (decision 5b — consolidation as observable event)

## Scope

Wire the genuine dismiss signal: on the persistent connection, `close(ws)` = "overlay closed /
user dismissed" → the daemon fires `ConsolidationHook.dismiss(threadId)` for every active
thread on that connection. **dismiss ⇒ persist**: the thread is NOT deleted — it persists and
DISTILLS (ADR-0012; threads survive session death). Retire the PROVISIONAL thread-switch
trigger this supersedes. The overlay resets `currentThreadId` on dismiss, so re-summon = a new
conversation. This chunk closes the slice and carries the **joint 6-step demo** gate.

**In:**
- **Daemon `close(ws)` handler** (`packages/daemon/src/index.ts:149-168`): after the existing
  S1 partial-turn flush, call `hook.dismiss(...)` for **every active (not-yet-dismissed)
  thread on that connection** — track touched thread ids on `ws.data` (the existing
  `activeThreadId`/`dismissedThreadIds` fields are the starting material; under chunk 01's
  one-thread-per-run overlay this is usually one thread, but the contract is "any active
  thread on that connection", spec §3.2). **Order matters:** flush FIRST, then dismiss, so the
  distiller sees the final turn. Dismiss errors stay non-fatal (the existing B1 discipline —
  log, never crash, never block cleanup).
- **Retire the PROVISIONAL thread-switch dismiss block** (`index.ts:85-102`, marked
  "superseded by connection-model CM-01 close(ws) path") — spec §3.2 verbatim: *"The
  provisional thread-switch trigger used in MF-02 is superseded here: one caller change in
  index.ts."* Tests asserting the provisional trigger are **UPDATED to the close-trigger
  equivalents, not silently deleted** (the dismissal/distillation coverage itself must survive).
- **Overlay dismiss wiring** (`apps/overlay/src/main.ts`): the user-visible dismiss affordance
  (text-card × / Escape → `EV_TEXT_DISMISS` path, widget-zone teardown — exact mapping is
  architect-time) **deliberately closes the persistent socket** and **resets
  `currentThreadId`**. Voluntary dismiss must NOT trigger chunk 02's reconnect path (the
  voluntary-vs-involuntary asymmetry: drop ⇒ reconnect + keep thread; dismiss ⇒ close + reset).
- Re-summon after dismiss → fresh socket, fresh client-minted `thread_id` → new thread that
  draws on the distilled slice (MF-02) — demo step 4's mechanics.

**Out:** (each states WHY — PIPELINE §7.2)
- **Additional consolidation triggers** (idle-timeout; re-adding thread-switch as an EXTRA
  trigger) — OUT: allowed later per memory-foundation spec §7 (must reuse the same hook +
  event record), NOT needed for the demo. The frozen baseline is "dismiss ⇒ consolidation
  event"; the trigger is now `close(ws)`.
- **Inbound push / multiplexing** — OUT, deferred (folder README).
- **Hatch / provenance UI** — OUT, that is MF-05 (PR #30, merges after rebase + demo).
- **Any `packages/protocol/**` change** — frozen; dismiss needs no wire variant (spec §3.2
  "No wire change required").

## Done criteria

(merge gate = the automated set below; the joint demo gates `done`/archive, NOT the merge —
Lior's 2026-06-10 DoD ruling, see Notes)

- [ ] **[mechanical]** real-I/O test: open socket → run a turn on thread T → close the socket
      → `threads.status(T) = dismissed` AND a `distillation_events` row exists (even when
      nothing was retained — ADR-0012 5b observability) (spec §4.2 bullet 2; real store,
      real daemon, no mocks).
- [ ] **[mechanical]** real-I/O test: two conversations on one connection (thread switch via a
      new client-minted id) → close → BOTH threads dismissed.
- [ ] **[mechanical]** real-I/O test: continuation works end-to-end through the persistent
      socket — `session_start{thread_id}` hydrates the tail (spec §4.2 bullet 3 — re-asserted
      post-retirement so the provisional removal can't silently regress hydration).
- [ ] **[mechanical]** the provisional thread-switch block is gone; its tests are updated to
      close-trigger equivalents (coverage preserved, command evidence).
- [ ] **[mechanical]** overlay: dismiss closes the socket + resets `currentThreadId`; an
      involuntary drop does NOT reset it (seam/unit tests).
- [ ] **[mechanical]** frozen surfaces byte-unchanged: `packages/protocol/**`,
      `mock-agent.ts`, `mock-provider.ts`.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green (command evidence).
- [ ] **[behavioral — Lior-gated §6.1, SHARED with MF-05 chunk 05, gates chunk-done/archive
      NOT PR merge]** the **JOINT 6-step route-closing live demo** (memory-foundation spec
      §4.1) passes on macOS through the real overlay → daemon → disk path: steps **2–4**
      (same-thread continuation · dismiss ⇒ persist+distill · re-summon ⇒ new thread with
      cross-thread continuity) prove THIS slice; steps 5–6 prove MF-05. ONE demo closes both.

## Orchestrator brief (read by the orchestrator from this file)

```
implement dismiss = close(ws) → ConsolidationHook.dismiss per
orchestration/docs/specs/2026-06-05-connection-model.md §3.2/§4.2/§5; retire the provisional
thread-switch trigger; wire overlay dismiss (close socket + reset currentThreadId).

Files to touch:
- packages/daemon/src/index.ts        (close handler: flush → dismiss-all-active; remove the
                                       PROVISIONAL block at ~85-102; keep B1 non-fatal discipline)
- apps/overlay/src/main.ts            (dismiss affordance → deliberate socket close + thread reset;
                                       do NOT let dismiss trigger the reconnect path)
- tests: real-I/O daemon tests (dismiss-on-close, two-threads, even-empty distillation event);
         update provisional-trigger tests to close-trigger equivalents

Done when:
- the automated Done-criteria set above is green (this is the MERGE gate — auto-merge on
  all-green per project CLAUDE.md);
- the chunk file is then left `in-progress` until the JOINT demo passes (the MF-05 pattern);
  after Lior's demo sign-off → done + archive (PIPELINE §4.4).

ADRs in scope: ADR-0012 (5b), ADR-0001/0003 (via the connection-model ADR proposed in chunk 01
— if not yet proposed, propose it here; not merge-blocking).
Frozen — DO NOT: touch packages/protocol/**, mock-agent.ts, mock-provider.ts; add extra
consolidation triggers; merge with any gate red; mark the behavioral criterion done without
the live demo (PIPELINE §6.1 — the recurring scar).
```

## Notes / Open questions

- **DoD gate model (binding — Lior 2026-06-10):** this chunk's PR **merges on the automated
  set** (real-I/O tests are §6.1-valid runtime evidence). The `[behavioral]` joint-demo
  criterion gates the CHUNK's `done`/archive, not the merge — i.e. the default
  "behavioral DoD ⇒ demo before merge" auto-merge precondition is explicitly replaced for
  this slice by Lior's ruling. The chunk stays `in-progress` after merge until the demo.
- **Demo prerequisites (Jimmy routes, not a chunk task):** (1) this chunk merged; (2) **PR #30
  (MF-05 T2) rebased onto post-CM main + re-verified** — including reviewer MINOR #2 (the
  provenance stamp's one-show_text-per-turn assumption under persistent-WS multi-turn) and the
  T1-reviewer forward-flag (refused machine-forget response shape). Then the ONE joint demo.
- **§7.1 runtime-coupling (PR #30, OPEN):** the `index.ts` overlap is concentrated HERE by
  design (close handler + provisional block vs PR #30's `send()` signature + `injectedMemory`
  closure + `/memory/*` fetch routing). Expect a real rebase conflict in `index.ts`; the
  folder README carries the map.
- **Daemon-crash asymmetry (accepted):** if the daemon dies, `close(ws)` fires nowhere —
  threads stay `active`, nothing distills; the overlay reconnects and resumes (spec §3.1).
  Dismiss-consolidation is best-effort on daemon-side close only; do not build a
  catch-up/reconciliation pass (un-speced scope — if it ever matters, that's a new chunk).
- **Hide vs dismiss:** the precise mapping of overlay affordances (Escape on text card, ×,
  panel hide) to "dismiss the overlay" is architect-time; the demo's step 3 ("dismiss the
  overlay") is the behavior that must hold. Do not entangle gotchas #33/#34 (stale
  hide-timers) while wiring this.
