---
title: Connection Model — persistent WS + inbound push + dismiss lifecycle
status: draft
date: 2026-06-05
deciders: [lior]
feeds: connection-model
implements: adr/0001-interaction-pattern, adr/0003-local-daemon-ws-architecture
route-part: companion to Conversation & Interaction Model route
tags: [spec, connection, websocket, persistent, inbound-push, dismiss, threading]
---

# Connection Model — persistent WS + inbound push + dismiss lifecycle

> **Pipeline placement.** CONDITIONAL spec stage (PIPELINE §3): the connection model has
> load-bearing seams shared by the memory-route chunks (MF-02…MF-05), the overlay-side
> thread lifecycle, and future inbound-push (cron, background tasks). Multiple chunks depend
> on a contract stated once here. **No chunk may re-litigate a decision frozen here without
> an ADR escalation.**
>
> **Surfaced during MF-02 planning (2026-06-05):** the ConsolidationHook's dismiss trigger
> has no clean caller because the current WS lifecycle (open per turn, close on session_end)
> makes `close(ws)` indistinguishable from "turn over" vs "overlay dismissed." The root is
> that the v0 request-response WS model conflicts with the inbound-push future the product
> needs (cron rituals, background tasks, multi-turn continuation). This spec freezes the
> clean model so MF-02+ can be built toward it from day one.

---

## 1. Problem statement

**v0 WS lifecycle (current):** `runSession()` in `session-client.ts` opens a new WebSocket
for every turn and closes it on `session_end` (line 165). This is correct for single-turn.
It breaks for everything the product needs next:

- `close(ws)` fires **after every turn** → ConsolidationHook cannot use it as a dismiss
  signal (it would consolidate after each reply, not when the user actually dismisses).
- **Cron rituals and background tasks** require the daemon to PUSH a session the user
  did not request — impossible if there is no persistent connection to push on.
- **Multi-turn through the real overlay** requires the overlay to send `thread_id` on
  session_start and later signal dismiss — the current per-turn WS cannot carry both.

**This spec defines the replacement model.** It is an extension of ADR-0001 (ephemeral
in-memory sessions remain the turn substrate) and ADR-0003 (WS on localhost:7777,
multiple frontends). Neither ADR is superseded; the connection lifetime changes.

---

## 2. Frame carried from existing ADRs (locked, not re-decided here)

- **ADR-0001:** each turn is still a **session** — ephemeral, in-memory phase machine.
  Sessions remain the short-term, in-turn substrate. `session_id` routing is unchanged.
- **ADR-0003:** WS on `localhost:7777`, origin-allowlist (+ per-install token from the
  security-hardening pass). Multiple frontends connect to one daemon.
- **ADR-0012 MF-01:** `session_start` carries an **additive optional `thread_id`** (already
  shipped). Thread = durable record; session = ephemeral per-turn runtime over it.
- **Wire contract:** the frozen 6-variant discriminated union (`session_start` /
  `session_ack` / `tool_call` / `tool_result` / `tool_cancel` / `session_end`) is
  **untouched by this spec**. The connection lifetime change is behavioral, not wire.

---

## 3. Spec decisions (resolved 2026-06-05)

### 3.1 — WS connection lifetime: persistent per overlay session

**Decision: the overlay maintains ONE persistent WS connection, opened when the overlay
activates and kept until the overlay hides/exits.**

- `session-client.ts` is refactored from "open a socket per turn" to "use the shared
  persistent socket." Multiple `session_start` messages flow over the same connection.
- **Each session_start still starts a new ephemeral session** (ADR-0001 untouched);
  what changes is the socket is reused, not the session model.
- **Reconnect:** if the connection drops (daemon restart, sleep/wake), the overlay
  reconnects with backoff and resumes with the same `thread_id` on the next turn.
  In-flight sessions at disconnect are treated as cancelled (session_end{reason:cancelled}
  emitted locally by the overlay; daemon cleans up via `close(ws)`).

> **ADR note (architect flag):** this changes ADR-0001's implicit per-session-socket
> assumption. The architect should propose an ADR-0001 amendment during the build chunk.
> Not a stop-the-line (the wire is unchanged); flag for Lior at plan-approval gate.

### 3.2 — Dismiss = WS close (now meaningful)

**Decision: `close(ws)` on the persistent connection = "overlay closed / user dismissed."
The daemon calls `ConsolidationHook.dismiss(threadId)` for any active thread on that
connection when `close(ws)` fires.**

- With v0 (per-turn socket), `close(ws)` fires after every turn — meaningless as dismiss.
- With persistent WS, `close(ws)` fires only when the overlay actually exits or disconnects
  → it IS the genuine dismiss signal.
- **No wire change required.** No new envelope variant.
- **This is the clean answer to MF-02 Q1.** The ConsolidationHook seam (built in MF-01)
  is designed for exactly this caller. The provisional thread-switch trigger used in MF-02
  is superseded here: one caller change in `index.ts` (one line).

### 3.3 — Thread continuation from the overlay

**Decision: the overlay tracks the current `thread_id` and passes it on every
`session_start` for a continuation turn. A new conversation = `session_start` without
`thread_id` (daemon mints a new thread, per MF-01 spec §3.1).**

- The overlay holds `currentThreadId: string | undefined` (reset on dismiss / new
  conversation).
- On "continue this thread" action (the reply affordance — route part 2): overlay sends
  `session_start{ thread_id: currentThreadId }`.
- On "new conversation" (summon with no context): overlay sends `session_start{}` (no
  thread_id) → daemon mints a new thread.
- **Relates to ADR-0012 §"Deliberately left open":** the exact *affordance* (inline
  "Live Card" vs re-summoned "Continuation Pill") is still a route-part-2 build-time
  decision. This spec freezes only the *mechanism* (thread_id in session_start).

### 3.4 — Inbound push: daemon-initiated sessions (cron, background)

**Decision: the daemon pushes sessions onto the persistent WS by sending `session_ack`
+ `tool_call` without waiting for a `session_start`. The overlay handles unsolicited
`session_ack` messages by routing them to a new session context.**

- **Wire unchanged:** `session_ack` and `tool_call` already carry `session_id`. The
  frontier is behavioral: the overlay must handle `session_ack` it did not trigger.
- **Frontend routing:** `session-client.ts` is refactored to route incoming envelopes by
  `session_id`; a `session_ack` without a matching pending `session_start` creates a
  NEW session context (the inbound/cron path). This is the response→widget routing
  (known-gotcha #45 early slice).
- **Session_id authority:** daemon always mints `session_id` (ADR-0001 D3, unchanged).
  For cron sessions the daemon mints it and pushes `session_ack` directly.
- **Trigger source:** `session_start{trigger:"cron"|"external"}` is sent by the daemon
  INTERNALLY to the agent loop (not over the wire). The wire starts at `session_ack`.
  This is consistent with ADR-0001's `trigger` enum (`user|cron|external`).
- **Scope:** cron + background push are route parts 5+ (concurrent threads, gotcha #45).
  This spec freezes the **mechanism** (how the overlay handles unsolicited session_ack)
  so the overlay-side refactor doesn't have to be revisited. The daemon's cron scheduler
  is not built here.

### 3.5 — Session multiplexing and concurrency

**Decision: multiple sessions may be in-flight simultaneously on one persistent WS,
identified by `session_id`. The overlay routes all incoming messages by `session_id`.**

- `session-client.ts` moves from a single `confirmedSessionId` closure to a `Map<sessionId, SessionContext>`.
- A `tool_call` for an unrecognized `session_id` is **silently dropped** (gotcha #9 discipline;
  this protects against out-of-order/late inbound frames).
- **Concurrency limit (build-time):** the maximum simultaneous live sessions is an
  architect-time constant (start with 3 — matches the "rule of three" widget stack from
  ADR-0006 Amendment 2026-06-03). Not frozen here; architect decides at build.

---

## 4. Verification model

### 4.1 Behavioral criteria (need live demo — PIPELINE §6.1)

The connection model's behavioral done criteria are part of the **route-closing live demo**
defined in the memory-foundation spec §4.1. Specifically, demo steps 2-4 require this
spec to be built:

- **Step 2** (same thread, next turn → agent answers from context): requires overlay to
  send `session_start{thread_id}` on continuation.
- **Step 3** (dismiss the overlay → thread persists + distills): requires `close(ws)` to
  fire `ConsolidationHook.dismiss`.
- **Step 4** (re-summon → new thread → cross-thread continuity): requires the overlay to
  mint a new thread_id-less session_start.

These steps **cannot be demonstrated** without the persistent WS + dismiss fix.

### 4.2 Mechanical criteria (real-I/O)

- **[mechanical]** persistent WS survives multiple session_start/session_end round-trips
  on the same socket (no reconnect between turns).
- **[mechanical]** `close(ws)` triggers `ConsolidationHook.dismiss` for the active thread
  on that connection (real-I/O, daemon side, no mock).
- **[mechanical]** overlay sends `thread_id` on session_start for continuation; daemon
  hydrates tail (closes the "within-thread multi-turn through the real overlay" gap).
- **[mechanical]** an unsolicited `session_ack` (inbound/cron path) creates a new session
  context without crashing/discarding (graceful).
- **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

---

## 5. Wire / contract touch-points (frozen-surface audit)

- **Wire: UNCHANGED.** The 6-variant discriminated union is untouched. No new envelope
  variant. All existing variants used as-is.
- **`session_start.thread_id`:** already additive (MF-01, shipped). This spec adds the
  overlay-side logic that populates it.
- **Behavioral change:** `close(ws)` now fires `ConsolidationHook.dismiss` (where it
  previously only cleaned up the session Map). This is the §7.1 behavioral-drift call-out.
  Localized to `index.ts` close handler.

---

## 6. Proposed decomposition

> Both chunks are **overlay + daemon together** — they are too tightly coupled to split
> cleanly (overlay change calls daemon behavior). Estimated ~1.5–2 days total.

| # | Chunk | Establishes | Depends on | Size |
|---|---|---|---|---|
| **CM-01** | Persistent WS + dismiss + thread continuation (overlay + daemon) | Persistent socket in session-client.ts; overlay tracks currentThreadId; close(ws) → dismiss; session_start carries thread_id; daemon routing for multiple sessions per WS | MF-02 (ConsolidationHook must be wired) | ~1–1.5 d |
| **CM-02** | Inbound push routing (overlay side) | Overlay handles unsolicited session_ack; routes tool_call by session_id; session multiplexing Map | CM-01 | ~0.5–1 d |

- **CM-02 is OPTIONAL for the route-closing demo** (inbound push = cron, which is Phase 6).
  CM-01 alone unblocks all 6 demo steps (§4.1). CM-02 is included here to freeze the
  mechanism before the overlay is refactored, so the routing is not done twice.
- **Slot in route:** build CM-01 **after MF-04** (isolation) and **before MF-05** (hatch).
  MF-05's route-closing demo needs CM-01; MF-02/03/04 are daemon-only and do not need it.

---

## 7. Open at build / deferred

- **Reconnect backoff strategy** (§3.1) — architect-time.
- **Concurrency limit** (§3.5) — start at 3; architect-time.
- **In-flight session fate on disconnect** (§3.1) — spec says "treated as cancelled"; architect may refine.
- **CM-02 build timing** — can be deferred past the memory-route if cron is not being built. Flag when Phase 5/6 starts.
- **ADR-0001 amendment** — the architect should propose it during CM-01 planning (behavioral change to session/socket lifetime is ADR-worthy). Not blocking this spec.

---

## Related

- [[../adr/0001-interaction-pattern]] — ephemeral sessions + inbound triggers; this spec extends the connection lifetime without changing the session model.
- [[../adr/0003-local-daemon-ws-architecture]] — WS on localhost:7777; this spec changes the connection lifetime, not the transport.
- [[../adr/0012-conversation-and-memory-model]] — thread = durable record; this spec provides the dismiss signal and thread_id plumbing the memory model needs.
- [[2026-06-04-memory-foundation]] — the spec whose Q1 triggered this one; CM-01 supersedes MF-02's provisional dismiss trigger.
- [[../known-gotchas]] #45 — concurrent threads / background tasks; CM-02 is the early slice of that.
- [[../roadmap]] — "Conversation & Interaction Model" route; this is a companion infrastructure spec (not a numbered part, but a prerequisite for parts 2–5).
- `apps/overlay/src/ws/session-client.ts` — the file CM-01 refactors.
- `packages/daemon/src/index.ts` — close(ws) handler gains the dismiss call; session routing gains the multiplexing Map.
