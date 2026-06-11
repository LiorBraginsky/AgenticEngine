> 🗄️ ARCHIVED 2026-06-11 — done. Historical record; do not edit.

# Chunk 2: Persistent WS connection (overlay) + reconnect

**Status:** done
**Created:** 2026-06-10
**Phase:** Conversation & Interaction Model · connection-model (demo-unblocking slice, 2 of 3)
**Estimated size:** ~1 day
**Depends on:** 01 *(STRICTLY SEQUENTIAL — same `session-client.ts`/`main.ts` surface; chunk 01's continuation tests must stay green over the shared socket; PIPELINE §7.1)*
**Spec:** `orchestration/docs/specs/2026-06-05-connection-model.md` (§3.1, §3.5 drop-rule, §4.2, §7) · **ADR:** [[../../docs/adr/0001-interaction-pattern]] (sessions stay ephemeral — only the SOCKET lifetime changes) · [[../../docs/adr/0003-local-daemon-ws-architecture]] (origin gate at upgrade — re-passed on every reconnect)

## Scope

Refactor the overlay from "open a WebSocket per turn, close on `session_end`"
(`session-client.ts` — `finish()`/`fail()` close the socket, lines ~161-175) to **ONE
persistent connection**: opened when the overlay activates, reused across turns, reconnected
with backoff on drop. Spec §3.1 verbatim: *"Each session_start still starts a new ephemeral
session (ADR-0001 untouched); what changes is the socket is reused, not the session model."*

**In:**
- A connection manager owning the shared socket (open on overlay activation; the precise
  activation/teardown trigger points in `main.ts` are architect-time — but deliberate
  socket-close on DISMISS is chunk 03's wiring, not here).
- `runSession` rides the shared socket: an inbound **dispatcher routes envelopes by
  `session_id`** (correlate via the existing `client_session_id` echo). Degenerate
  **single-flight** form: ONE active turn context (the `main.ts` `inFlight` guard stays);
  frames for an unknown/non-active `session_id` are **silently dropped** (gotcha #9 + spec
  §3.5 drop rule). Keep the dispatcher shape **Map-ready** so the deferred inbound-push work
  (folder README) fills it without re-plumbing — seam, not logic.
- **Per-turn handshake timeout semantics preserved**: the 30s timer arms at `session_start`
  send and disarms at the first matching envelope — per TURN, not per connection. The
  `HandshakeTimeoutError` name survives (gotcha #42 — `main.ts` timeout-card discriminator).
- **In-flight turn at disconnect = treated as cancelled LOCALLY** (spec §3.1): the active
  `runSession` settles as `{reason:"cancelled"}`-equivalent, **nothing is sent on the wire**
  (the socket is gone; the daemon cleans up via its `close(ws)` S1 partial-turn flush —
  `index.ts:149-168`, already on main).
- **Reconnect with backoff** (strategy/architect-time per spec §7): after a daemon
  restart/sleep-wake drop, the next turn succeeds on a fresh socket **carrying the same
  `currentThreadId`** (spec §3.1 "resumes with the same thread_id"). Involuntary drop does
  NOT reset `currentThreadId` — that asymmetry (voluntary dismiss resets, chunk 03) is
  load-bearing; do not conflate.
- Existing flows green over the shared socket: the color-picker round-trip
  (`tool_call` → `tool_result`/`tool_cancel`) AND the `show_text` path, multiple turns, no
  reconnect between turns.
- Daemon side: **no behavior change expected** (it already keeps per-connection
  `ws.data.sessionIds` as a Set) — add the real-I/O multi-turn-per-socket daemon test that
  pins this down.

**Out:** (each states WHY — PIPELINE §7.2)
- **dismiss = close(ws) wiring + the provisional-block retirement** — OUT, chunk 03. The
  daemon's PROVISIONAL thread-switch dismiss (`index.ts:85-102`) STAYS in this chunk's
  interim; with the overlay holding one `currentThreadId` per run it simply never fires for
  the overlay (threads stay undismissed in overlay use = today's status quo, no regression).
- **>1 in-flight session / unsolicited `session_ack` / concurrency limit** — OUT: gotcha #45
  ("DO NOT patch the symptom") + deferred inbound push (folder README). `inFlight` stays.
- **Fixing gotchas #33/#34** (stale hide-timer + retained input text) — OUT: a coupled pair
  with its own follow-up; this chunk touches `main.ts` lifecycle code — do NOT entangle or
  half-fix them in passing.
- **Streaming / early `session_ack`** (gotcha #42 proper fix, #43 loader rework) — OUT,
  Phase-3 deferral unchanged.
- **Any `packages/protocol/**` change** — frozen; the connection lifetime change is
  behavioral, not wire (spec §2).

## Done criteria

(all merge-gating criteria are automated — Lior's 2026-06-10 DoD ruling; no live demo here)

- [ ] **[mechanical]** real-I/O test: **≥3 full `session_start`…`session_end` round-trips on
      ONE socket** with no reconnect between turns (spec §4.2 bullet 1) — assert single
      connection (e.g. factory call-count / server-side connection count), real daemon.
- [ ] **[mechanical]** real-I/O test: both flow shapes over the shared socket — a picker
      round-trip and a `show_text` turn — green.
- [ ] **[mechanical]** test: mid-flight socket drop → the active turn settles locally as
      cancelled-equivalent (no wire write, no unhandled rejection); daemon S1 flush covered
      by existing tests stays green.
- [ ] **[mechanical]** real-I/O test: daemon killed + restarted → overlay reconnects with
      backoff; the next turn succeeds and carries the SAME `thread_id` (chunk 01's
      continuation preserved across reconnect).
- [ ] **[mechanical]** seam test: frames with an unknown `session_id` are silently dropped
      (gotcha #9 / spec §3.5 drop rule).
- [ ] **[mechanical]** frozen surfaces byte-unchanged: `packages/protocol/**`,
      `mock-agent.ts`, `mock-provider.ts`.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green (command evidence).

## Orchestrator brief (read by the orchestrator from this file)

```
implement the persistent WS connection (overlay side) + reconnect per
orchestration/docs/specs/2026-06-05-connection-model.md §3.1 (+§3.5 drop rule), keeping
chunk 01's thread-continuation behavior intact over the shared socket.

Files to touch:
- apps/overlay/src/ws/session-client.ts   (connection manager + per-session dispatcher;
                                           runSession API stays compatible with main.ts/chunk 01)
- apps/overlay/src/ws/types.ts            (factory/types as needed — keep DOM-free testability,
                                           injected WebSocketFactory stays the seam)
- apps/overlay/src/main.ts                (open-on-activation wiring; inFlight guard UNCHANGED)
- packages/daemon: tests only (multi-turn-per-socket real-I/O pin-down; no behavior change)

Done when:
- ≥3 round-trips on one socket; picker + show_text flows green over it;
- drop mid-flight → local cancelled, no leak; reconnect+backoff resumes same thread_id;
- unknown-session frames dropped silently; per-turn 30s handshake timeout +
  HandshakeTimeoutError preserved;
- frozen surfaces byte-unchanged; typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0001 (ephemeral sessions untouched; socket-lifetime change covered by the
ADR proposed in chunk 01), ADR-0003 (origin gate re-passed on reconnect — do not weaken).
Frozen — DO NOT: touch packages/protocol/**, mock-agent.ts, mock-provider.ts; build
multi-session concurrency (gotcha #45); remove the daemon's provisional dismiss (chunk 03);
entangle gotchas #33/#34.
```

## Notes / Open questions

- **§7.1 runtime-coupling (PR #30, OPEN):** PR #30's provenance stamp computes a per-inbound-
  message `injectedMemory` flag and stamps EVERY outbound `show_text` of that turn
  (one-show_text-per-turn assumption — reviewer MINOR #2 on PR #30). Under this chunk turns
  stay single-flight sequential on the shared socket, so the per-turn flag remains correct —
  but the assumption MUST be re-checked when PR #30 is rebased onto post-CM main (Jimmy,
  pre-demo; not a chunk task). If this chunk's dispatcher work surfaces an ordering hazard,
  FLAG it (§7.2) — do not fix PR #30's branch from here.
- **Architect-time per spec §7:** reconnect backoff strategy; the exact "overlay activates /
  hides" trigger points for socket open (close-on-dismiss lands in 03).
- **Close-event semantics change:** today every `runSession` rejects on socket close
  ("WebSocket closed before session_end"). With a shared socket, close becomes a
  connection-level event (→ local-cancel for the active turn + reconnect schedule), not a
  per-turn rejection. Update the seam tests accordingly — do not delete the coverage.
