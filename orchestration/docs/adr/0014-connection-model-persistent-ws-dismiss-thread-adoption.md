---
status: accepted
date: 2026-06-10
deciders: [lior]
tags: [adr, connection, websocket, persistent, dismiss, threading, thread-id, inbound-push, amendment]
---

# ADR-0014: Connection model — persistent WS lifetime, dismiss = close(ws), client-minted thread-id adoption (ADR-0001 amendment)

## Status

`accepted` (Lior, 2026-06-12)

> Accepted per [[../PIPELINE]] §5.2 (Lior-only gate), **asynchronously after the build** — the four
> decisions below already shipped on `main` via CM-01 (PR #33), CM-02 (PR #35), CM-03 (PR #36), built
> against the accepted connection-model spec ([[../specs/2026-06-05-connection-model]]) per the
> 2026-06-10 ruling that made this ADR non-merge-blocking. Acceptance here records the decision set
> for the register and fills the regret prediction; the frozen 6-variant wire union is byte-unchanged
> throughout (no freeze gate). This is the canonical doc-style-ADR async path now codified in
> PIPELINE §5.2 (Finding #5).
>
> **Acceptance rider (Lior, 2026-06-12):** the regret prediction (decision (a) below) is **binding
> direction** — the client-minted `thread_id` adoption is an under-guarded caller-auth surface, and
> **gating thread writes the way ADR-0013 gated memory writes is folded into the security-hardening
> pass** (the now-picked next feature). The thread-adoption validation (UUID-shape + unknown-only +
> single write path) is the *interim* guard; the token/caller-auth gate is the end-state.

## Context

Everything shipped through MF-04 still opens **one WebSocket per turn**: `runSession()` in
`apps/overlay/src/ws/session-client.ts` opens a fresh socket on each submit and closes it on
`session_end`. That lifetime is correct for the single-turn world ([[0001-interaction-pattern]],
[[0009-text-display-only-ui-primitive]]) but it blocks the multi-turn, dismiss-aware,
push-capable model that [[0012-conversation-and-memory-model]] commits to:

- **Dismiss is unrepresentable.** [[0012-conversation-and-memory-model]] decision 5b makes
  consolidation an explicit, observable event; the `ConsolidationHook.dismiss(threadId)` seam
  (built in MF-02) needs a caller that means "the user dismissed," not "a turn ended." On a
  per-turn socket, `close(ws)` fires after **every** turn — so it cannot be the dismiss signal
  (it would consolidate after each reply). This is the concrete gap surfaced during MF-02
  planning (the spec's §1 origin story).
- **Inbound push is impossible.** Cron rituals and background tasks ([[0001-interaction-pattern]]
  decision 5; [[../known-gotchas]] #45) require the daemon to PUSH a session the user did not
  request. There is no connection to push on if the socket only exists during a user turn.
- **Multi-turn through the real overlay is unwired.** A continuation turn must carry its
  `thread_id` on `session_start`; the field is additive-optional and already shipped (MF-01), but
  the overlay never populates it, and `session_ack` carries **no** `thread_id` — so the overlay
  cannot learn the daemon-minted id to send it back.

[[0001-interaction-pattern]] deliberately left the connection *lifetime* implicit while committing
the *session* model. Its decision 4/6 made sessions ephemeral in-memory phase machines, and its
decision 3 (`session_id` minting) is daemon-authoritative. Building the connection model surfaces
a behavioral boundary that ADR-0001 never stated outright — **one socket per session** — and adds
a new authority question ADR-0001 never touched: **who mints the durable `thread_id`?** Those two
gaps are why the connection-model spec ([[../specs/2026-06-05-connection-model]]) flagged this
work as ADR-worthy (spec §3.1 ADR note, §7). This ADR records the full decision set the accepted
spec resolved; the build is decomposed across CM-01/02/03.

## Decision

**Adopt the connection model from [[../specs/2026-06-05-connection-model]]: one persistent WS per
overlay session; `close(ws)` on that persistent socket *is* the dismiss signal; and the overlay
mints the durable `thread_id` client-side, which the daemon adopts.** This **amends** ADR-0001's
implicit per-session-socket lifetime — it does not supersede it (see *Relationship to existing
ADRs*). The four spec decisions, each tagged with the chunk that builds it:

1. **WS lifetime → persistent per overlay session** (spec §3.1). The overlay opens **one** socket
   when it activates and keeps it until hide/exit; many `session_start` frames flow over it. **Each
   `session_start` still starts a new ephemeral session** — ADR-0001's session model is untouched;
   only the socket is reused. Reconnect with backoff on drop (daemon restart, sleep/wake); sessions
   in-flight at disconnect are treated as cancelled (overlay emits `session_end{reason:cancelled}`
   locally; daemon cleans up via `close(ws)`). *Built in **chunk 02**.*

2. **Dismiss = `close(ws)`** on the persistent connection (spec §3.2). When `close(ws)` fires, the
   daemon calls `ConsolidationHook.dismiss(threadId)` for the active thread on that connection —
   now meaningful precisely because the socket is no longer per-turn. **No wire change; no new
   envelope variant.** This is the clean answer to the MF-02 dismiss-caller gap, and it
   **supersedes the provisional thread-switch trigger** at `index.ts:84-102`. *Built in **chunk 03**.*

3. **Thread continuation + client-minted thread-id adoption** (spec §3.3). The overlay tracks the
   current `thread_id`, mints it client-side with `crypto.randomUUID()` (the **same posture** as
   the already-shipped `client_session_id`, `session-client.ts:98`), and passes it on every
   continuation `session_start`. Because `session_ack` carries **no** `thread_id`, the client owns
   the mint and the daemon **adopts** an unknown-but-UUID-shaped `session_start.thread_id` as the
   new thread's id — through the **single** `store.createThread` write path (extended with an
   optional `adoptId`, not a second `INSERT`). A new conversation = `session_start` with **no**
   `thread_id` → the daemon mints (MF-01 §3.1, unchanged). Non-UUID garbage is **not** adopted →
   fresh daemon mint, no crash ([[../known-gotchas]] #9: no garbage durable keys). *Built in
   **chunk 01** — building now.*

4. **Inbound push + multiplexing mechanism frozen** (spec §3.4 / §3.5). The overlay routes incoming
   envelopes by `session_id` (a `Map<sessionId, SessionContext>`); an unsolicited `session_ack`
   (no matching pending `session_start`) creates a **new** session context (the cron/background
   inbound path, early slice of [[../known-gotchas]] #45). A `tool_call` for an unrecognized
   `session_id` is silently dropped. Concurrency limit is an architect-time constant (start 3,
   matching the [[0006-dual-hotkey-2zone-ux]] 2026-06-03 "rule of three"). `session_id` minting
   stays daemon-only (ADR-0001 decision 3). The **mechanism** is frozen here so the overlay refactor
   is not done twice; the daemon's cron scheduler is **not** built in this route (CM-02 / later).

### Wire / contract — UNCHANGED across all four decisions (frozen-surface audit)

The frozen **6-variant** discriminated union (`session_start` / `session_ack` / `tool_call` /
`tool_result` / `tool_cancel` / `session_end`, `packages/protocol/**`) is **byte-unchanged** by
every decision above:

- **Decision 1** changes only socket *lifetime* — a behavioral property of the connection, not a
  frame.
- **Decision 2** reuses the existing `close(ws)` lifecycle event; the dismiss call is a daemon-side
  handler change (`index.ts`), no new variant.
- **Decision 3** only *populates* `session_start.thread_id`, which is already additive-optional and
  shipped (MF-01, `envelope.ts:39`). No `session_ack.thread_id` is added — that absence is exactly
  why the client-mint + daemon-adopt reading is the only one consistent with the spec's
  "wire UNCHANGED" constraint (§5). The no-`thread_id` frame stays byte-equivalent to the MF-01
  single-turn shape.
- **Decision 4** uses `session_ack` and `tool_call` as-is (both already carry `session_id`); the
  change is behavioral (the overlay handles a `session_ack` it did not trigger).

No `packages/protocol/**` file, `mock-agent.ts`, or `mock-provider.ts` is touched. The connection
model is a **behavioral** change, not a wire change — so it is **not** a freeze gate (PIPELINE
§5.2 / §6.2); the all-green auto-merge path applies.

### Relationship to existing ADRs — AMENDS, does not supersede

- **Amends [[0001-interaction-pattern]]** (does **not** supersede it). ADR-0001's session model is
  fully preserved: sessions stay **ephemeral** in-memory phase machines (decision 4); each
  `session_start` still starts a new session; **`session_id` minting stays daemon-only**
  (decision 3); and inbound triggers remain symmetrical to user-initiated ones (decision 5 — this
  ADR's decision 4 is the wire-side realization of that). What this ADR changes is the **implicit
  per-session-socket lifetime**: the socket is now persistent and reused across sessions. ADR-0001
  is immutable and is **not** edited; the amend relationship is stated only from this side.
- **`session_id` vs `thread_id` authority.** ADR-0001 decision 3 reserves **`session_id`** minting
  to the daemon and says nothing about `thread_id`. This ADR's decision 3 records the previously
  uncovered authority: the **client** mints the durable `thread_id` and the daemon **adopts** it.
  These are different ids on different layers — `session_id` (ephemeral, daemon-minted) is untouched.
- **Leaves [[0003-local-daemon-ws-architecture]] unchanged.** The transport is the same: WS on
  `127.0.0.1:7777`, origin-allowlist (+ deferred per-install token, p.5). Only the connection
  *lifetime* changes, not the transport, port, or upgrade gate. (Contrast [[0013-daemon-memory-write-http-surface-caller-auth]],
  which *extended* ADR-0003 with an HTTP route — this ADR does not.)
- **Serves [[0012-conversation-and-memory-model]].** Decision 2 provides the explicit dismiss event
  ADR-0012 decision 5b requires; decision 3 is the `thread_id` plumbing for "the user interacts with
  THREADS" (ADR-0012 decision 4). Adoption does not change the thread = durable-record model — it
  only chooses the new thread's *id value*.

## Consequences

### Positive

- **Dismiss becomes a real, single, observable event** — `close(ws)` on the persistent socket is an
  unambiguous dismiss caller, exactly the seam MF-02's `ConsolidationHook.dismiss` was built for,
  with no wire change and a one-line caller swap in `index.ts`.
- **Multi-turn works through the real overlay** without a protocol change — the overlay populates an
  already-shipped optional field, and the daemon agrees on the durable id by adoption.
- **Inbound push is unblocked structurally** — a persistent socket the daemon can push `session_ack`
  onto is the prerequisite for cron/background sessions; the overlay-side routing mechanism is frozen
  now so it is not rebuilt when the scheduler lands.
- **Client-mint + daemon-adopt needs zero round-trips and zero new wire fields** — the overlay knows
  the id the instant it mints it (no waiting for `session_ack` to learn it), and the single
  `createThread` write path is preserved.
- **The frozen 6-variant union holds** — a behavioral-only change keeps the conveyor freeze intact
  and stays on the auto-merge path.

### Negative

- **Two caller-gated authorities for ids now exist** — daemon mints `session_id`, client mints
  `thread_id`. A future reader must not conflate them; the daemon must validate the adopted id
  (UUID-shape + uniqueness) before trusting it, or it becomes a write of an attacker-chosen durable
  key (mitigated: non-UUID rejected, unknown-only adopted, single write path).
- **Persistent-socket lifecycle bugs move from "per turn" to "per app run"** — reconnect/backoff,
  in-flight-on-disconnect fate, and the multiplexing `Map` are new state to get right; a leaked or
  mis-routed session now lives for the whole overlay session, not one turn.
- **CM-01 ships a deliberate interim wart** — until chunk 03, the overlay continues **one
  ever-growing thread per app run** (reset only by restart), because the "new conversation" /
  reset-on-dismiss hatch arrives with the dismiss work. This is intentional, scoped, and flagged in
  the plan, not an oversight.
- **A dismissed-thread `session_start` currently hydrates and continues** (no status filter on the
  hydrate branch). CM-01 asserts this as the current behavior deliberately without growing status
  semantics; the dismiss/reset semantics are chunk-03 territory.

### Trade-offs accepted

- We accept **a persistent socket and its lifecycle complexity** (reconnect, in-flight cancellation,
  per-`session_id` multiplexing) in exchange for **a meaningful dismiss signal, multi-turn over the
  real overlay, and a push-capable connection** — none of which the per-turn socket can express.
- We accept **the client minting the durable `thread_id`** (a new authority outside ADR-0001's
  daemon-only `session_id` rule) in exchange for **no new wire field and no round-trip** — the only
  reading consistent with `session_ack` carrying no `thread_id` and the spec's wire-unchanged
  constraint. Guarded by UUID-shape validation + unknown-only adoption + single write path.
- We accept **shipping the connection model in three chunks with an interim no-reset wart** (CM-01),
  in exchange for **unblocking within-thread multi-turn now** without waiting on the dismiss and
  push work.

### What we'll regret in 6 months (predict it now)

> **Prediction (Lior, 2026-06-12):** the likeliest regret is **(a) — client-minted `thread_id` was a
> caller-auth hole we under-guarded.** Once the daemon trusts a client-chosen durable key, a crafted
> local client (the #31 CSWSH surface — any browser tab against the always-on loopback daemon) can
> pre-seed a `thread_id` and **steer adoption**: write into, or graft onto, a thread the user never
> meant it to touch. UUID-shape + unknown-only + single-write-path keeps the *keyspace* clean but does
> **not** authenticate the *caller* — exactly the gap ADR-0013 closed for memory writes with a token.
> We'll wish we'd gated thread writes the same way from the start instead of bolting it on later.
>
> **Mitigation accepted now (binding):** thread-write caller-auth is **folded into the
> security-hardening pass** (the picked next feature) — the per-install WS token (#31) that gates the
> connection also gates thread adoption, closing this surface as part of the same pre-public-release
> gate as ADR-0013's read-token rider. Until then the shape/unknown-only validation is the documented
> *interim* guard, and no new daemon trust is extended to client ids beyond what CM-01..03 already ship.
>
> *(Regrets (b) reconnect-as-cancel and (c) rule-of-three cap are noted as live but lower-probability:
> (b) revisits to "resume" if sleep/wake drops surface as a real complaint; (c) the cap is a one-line
> architect-time constant, cheap to retune when concurrent/background sessions actually land — #45.)*

## Alternatives Considered

### Option A: Keep the per-turn socket; add a separate dismiss/push channel

**What it was:** leave `runSession`'s open-per-turn / close-on-`session_end` lifetime as-is, and
add a second mechanism — a dedicated dismiss message and/or a separate long-lived control channel —
for dismiss and inbound push.

**Why not:** it splits the connection model into two parallel lifecycles (the per-turn data socket
+ a control channel) that must be kept consistent, and it almost certainly needs a **new envelope
variant** for dismiss — breaking the frozen 6-variant union and tripping a freeze gate. The
persistent-socket model gets dismiss "for free" from the existing `close(ws)` event and reuses the
same socket for push, with zero wire change.

### Option B: Daemon mints `thread_id` and returns it on `session_ack` (symmetry with `session_id`)

**What it was:** keep id-minting authority entirely daemon-side for *both* ids — the overlay sends
`session_start{}` with no `thread_id`, the daemon mints the thread id, and returns it by **adding a
`thread_id` field to `session_ack`** so the overlay can echo it on continuation turns.

**Why not:** it **changes the wire** — adding `session_ack.thread_id` mutates the frozen envelope
union and trips the freeze gate (PIPELINE §5.2), for a behavioral feature that does not otherwise
need a protocol change. It also adds a mandatory round-trip before the overlay can name its own
thread. Client-mint + daemon-adopt achieves the same continuity with **no new field** and **no
round-trip**, and is the only reading consistent with `session_ack`'s current shape. The cost —
the daemon must validate an externally-chosen durable key — is contained by UUID-shape validation,
unknown-only adoption, and the single `createThread` write path.

### Option C: Adopt any non-empty `thread_id` (no UUID-shape validation)

**What it was:** the daemon adopts whatever `session_start.thread_id` string the client sends as the
new thread's id, with no shape check — simplest possible adoption.

**Why not:** it lets arbitrary client-supplied garbage become a **durable primary key** in
`threads` ([[../known-gotchas]] #9), conflating "unknown id" with "valid id" and inviting collisions,
non-UUID keys that later code assumes are UUIDs, and a wider injection surface for the #31 local
client. Restricting adoption to **unknown-but-UUID-shaped** ids (with non-UUID falling through to a
fresh daemon mint, no crash) keeps the durable keyspace clean at negligible cost.

## Related

- [[0001-interaction-pattern]] — the ADR this **amends** (not supersedes): ephemeral sessions
  (decision 4) and **daemon-only `session_id` minting** (decision 3) are preserved; the **implicit
  per-session-socket lifetime** is what changes. Inbound triggers (decision 5) are realized on the
  wire by decision 4 here.
- [[0003-local-daemon-ws-architecture]] — **unchanged**: WS on `127.0.0.1:7777`, origin-allowlist,
  deferred per-install token (p.5). Only connection *lifetime* changes, not the transport.
- [[0012-conversation-and-memory-model]] — decision 4 (the user interacts with **threads**;
  thread = durable record) and decision 5b (consolidation as an **explicit, observable** event) are
  what decisions 3 and 2 here serve.
- [[0006-dual-hotkey-2zone-ux]] — the 2026-06-03 "rule of three" the decision-4 concurrency default
  (start 3) borrows.
- [[0013-daemon-memory-write-http-surface-caller-auth]] — the adjacent caller-auth ADR: it *extended*
  ADR-0003 with an HTTP route and named the #31 poisoning surface that the thread-adoption
  validation (decision 3) also touches; this ADR, by contrast, leaves the transport unchanged.
- [[../specs/2026-06-05-connection-model]] — the **accepted spec** that is this ADR's source and the
  build authority; §3.1–§3.5 are the four decisions, §5 the wire-unchanged audit, §6 the CM-01/02
  decomposition.
- [[../specs/2026-06-04-memory-foundation]] — the spec whose MF-02 dismiss-caller gap triggered the
  connection-model spec; MF-01 §3.1 is the "no/unknown `thread_id` → mint" path adoption preserves.
- [[../known-gotchas]] #9 — no garbage durable keys (the UUID-shape gate on adoption); #45 —
  concurrent threads / background tasks (decision 4 is the early slice); #31 — CSWSH local-client
  surface (the threat model behind validating an adopted, client-chosen id).
- [[../PIPELINE]] §5.2 — the Lior-only `proposed → accepted` gate (satisfied 2026-06-12; doc-style
  async path now codified there as Finding #5).
- `orchestration/docs/plans/connection-model/plan-01-thread-adoption.md` — the architect's CM-01
  plan that prepared this decision set (its `## ADR worthy: yes` section is the curator's brief).
- `apps/overlay/src/ws/session-client.ts`, `apps/overlay/src/main.ts`,
  `packages/daemon/src/memory/thread-lifecycle.ts`, `packages/daemon/src/memory/store.ts` — the
  seams CM-01 touches for decision 3.

## Follow-up for Lior (NOT done by this ADR)

- ✅ **Accepted** (Lior, 2026-06-12) — `proposed → accepted`, no amendment; regret (a) recorded with
  a binding mitigation (thread-write caller-auth folded into the security-hardening pass). Options
  A–C were not taken.
- **Update [[../architecture]]** to reference this ADR for the connection lifetime + thread-id
  authority — still a follow-up, intentionally **not** edited here (backlog; natural companion to the
  security-hardening pass that touches the same #31 surface).
