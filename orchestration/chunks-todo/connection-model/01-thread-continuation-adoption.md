# Chunk 1: Thread continuation through the real overlay (client-minted thread_id + daemon adoption)

**Status:** in-progress
**Created:** 2026-06-10
**Phase:** Conversation & Interaction Model · connection-model (demo-unblocking slice, 1 of 3)
**Estimated size:** ~0.5–1 day
**Depends on:** none *(first of a STRICTLY SEQUENTIAL chain 01→02→03 — all three share the daemon runtime + `session-client.ts`/`main.ts`; PIPELINE §7.1: disjoint files ≠ parallel-safe)*
**Spec:** `orchestration/docs/specs/2026-06-05-connection-model.md` (§3.3, §4.2, §5) · `orchestration/docs/specs/2026-06-04-memory-foundation.md` (§3.1) · **ADR:** [[../../docs/adr/0012-conversation-and-memory-model]] (decision 4) · [[../../docs/adr/0001-interaction-pattern]] (D3 — session_id authority, NOT thread_id)

## Scope

Make **within-thread multi-turn work through the real overlay**: the overlay tracks
`currentThreadId` and passes it on every `session_start`; the daemon **adopts** a
client-minted, UUID-shaped, unknown `thread_id` as the new thread's id. Works on today's
per-turn sockets — no WS-lifetime change in this chunk.

### The load-bearing decompose-time decision (architect MUST re-check, not re-litigate silently)

**How does the overlay learn the thread_id?** The spec freezes BOTH "the overlay tracks the
current `thread_id` and passes it on every session_start" (§3.3) AND "Wire: UNCHANGED — all
existing variants used as-is" (§5) — but `session_ack` does not carry `thread_id`
(`packages/protocol/src/envelope.ts:44-48`), so the daemon cannot tell the overlay which
thread it minted. The only reading consistent with the spec's own constraint set:

> **The overlay MINTS the thread id** (`crypto.randomUUID()`, same posture as the existing
> client-minted `client_session_id`, `session-client.ts:98`) and the daemon **ADOPTS** an
> unknown-but-UUID-shaped `session_start.thread_id` as the new thread's id (today
> `ThreadLifecycle.beginTurn` always mints its own via `store.createThread()` —
> `thread-lifecycle.ts:45-59`, `store.ts:72`).

Why this is decompose-authorized and not a frozen-line violation (§7.2 citation test ran clean):
- MF-01 spec §3.1 freezes "no/unknown `thread_id` ⇒ a NEW thread is minted" — adoption still
  mints a new thread; no frozen line fixes *who mints the id itself*.
- ADR-0001 D3 reserves **`session_id`** minting to the daemon — it does not cover `thread_id`.
- CM spec §5 explicitly audits the wire as UNCHANGED, so an additive `session_ack.thread_id`
  field would contradict the spec's own frozen-surface audit AND the conveyor freeze on
  `packages/protocol/**`.
- Security: a client that can connect can ALREADY read any thread via
  `session_start{thread_id:<existing>}` (MF-01); adopting unknown UUIDs adds no new
  capability class (gotcha #31 posture unchanged; per-install token = security-hardening).

**Escalation path:** if the architect can cite a specific frozen line this contradicts, that
is a citation-test flag → STOP, post `BLOCKED` (freeze gate) — do NOT design around it
(e.g. do NOT add a wire field, do NOT bypass `createThread`).

**In:**
- `ThreadLifecycle.beginTurn`: a `thread_id` that is unknown but **UUID-shaped** is adopted —
  the new thread is created WITH that id (extend `store.createThread` with an optional adopt-id,
  or an equivalent the architect prefers; single write path through the store stays).
- Validation: non-UUID-shaped `thread_id` is NOT adopted → fresh daemon mint, no crash
  (gotcha #9 discipline; prevents garbage durable keys).
- The no-`thread_id` path stays byte-equivalent in behavior: daemon mints (MF-01 §3.1
  degenerate case — other frontends/probe scripts keep working).
- Overlay: `currentThreadId` in `main.ts` — minted on the first submit of a conversation,
  passed on every subsequent `session_start` (additive optional param through
  `buildSessionStart`/`runSession` options; design the API so chunk 02's socket refactor
  doesn't have to change it).
- New-thread cross-thread injection (MF-02 `retrieve()`) must still fire on the adopted-id
  first turn (it does today via the unknown-id branch — keep it that way, test it).

**Out:** (each states WHY — PIPELINE §7.2)
- **Persistent socket / reconnect** — OUT, that is chunk 02; this chunk works on per-turn
  sockets (verified: daemon-side hydration is already live on main since MF-01).
- **`currentThreadId` reset on dismiss / "new conversation" affordance** — OUT, deferred to
  chunk 03 where dismiss gets defined. **Deliberate interim wart:** until 03 lands, the
  overlay continues ONE ever-growing thread per app run (reset only by app restart). This is
  the desired direction (multi-turn), the escape hatch arrives with dismiss in 03.
- **Reply-affordance UI (Live Card vs Continuation Pill)** — OUT, route part 2 (roadmap);
  the existing input panel re-used mid-conversation IS the interim continuation affordance.
- **Inbound push / multiplexing** — OUT, deferred (see folder README).
- **Any `packages/protocol/**` change** — frozen; the whole point of the adoption decision.

## Done criteria

(all merge-gating criteria are automated — Lior's 2026-06-10 DoD ruling; no live demo here)

- [ ] **[mechanical]** real-I/O daemon test: `session_start{thread_id: <fresh client UUID>}`
      → thread row created WITH exactly that id (real SQLite store, no mocks).
- [ ] **[mechanical]** real-I/O daemon test: second `session_start` with the same id →
      prior turn hydrated (provider sees the tail; assert via stored messages / reply path) —
      within-thread multi-turn over the real daemon→store boundary.
- [ ] **[mechanical]** real-I/O daemon test: no `thread_id` → daemon-minted thread (unchanged
      MF-01 degenerate path); non-UUID garbage `thread_id` → NOT adopted, fresh mint, no crash.
- [ ] **[mechanical]** real-I/O daemon test: adopted-id FIRST turn still runs the MF-02
      cross-thread `retrieve()` injection (new-thread branch preserved).
- [ ] **[mechanical]** overlay seam test (DOM-free, injected factory): continuation turns carry
      `thread_id`; first turn of a conversation mints it.
- [ ] **[mechanical]** frozen surfaces byte-unchanged: `git diff` empty for
      `packages/protocol/**`, `mock-agent.ts`, `mock-provider.ts`.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green (command evidence).

## Orchestrator brief (read by the orchestrator from this file)

```
implement thread continuation through the real overlay per
orchestration/docs/specs/2026-06-05-connection-model.md §3.3/§4.2/§5, using the
decompose-authorized client-mint + daemon-adopt mechanism described in this chunk's Scope
(architect re-checks it; if a frozen line contradicts it → BLOCKED, do not design around).

Files to touch:
- packages/daemon/src/memory/thread-lifecycle.ts  (beginTurn: adopt unknown UUID-shaped thread_id)
- packages/daemon/src/memory/store.ts             (createThread: optional adopt-id; single write path)
- apps/overlay/src/ws/session-client.ts           (buildSessionStart/runSession: additive thread_id option)
- apps/overlay/src/main.ts                        (currentThreadId: mint on first submit, pass on every turn)
- tests: real-I/O daemon tests (*.daemon.test.ts pattern) + DOM-free overlay seam tests

Done when:
- adoption + validation + degenerate paths proven real-I/O (see Done criteria);
- overlay passes thread_id on continuation turns (seam test);
- frozen surfaces byte-unchanged; typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0012 (decision 4), ADR-0001 (D3 — note it covers session_id only).
ADR duty: per CM spec §3.1 note + §7, the architect PROPOSES the connection-model ADR
(ADR-0001 amendment: persistent-WS lifetime + dismiss=close(ws) + thread-id adoption) via
adr-curator, status `proposed`. NOT merge-blocking — the accepted spec is the build authority;
Lior accepts the ADR asynchronously (§5.2).

Frozen — DO NOT: touch packages/protocol/**, mock-agent.ts, mock-provider.ts; add a second
thread-write path; change the WS lifetime (chunk 02); add dismiss/reset logic (chunk 03).
```

## Notes / Open questions

- **§7.1 runtime-coupling (PR #30, OPEN, not on main):** PR #30 touches `store.ts` (history
  page queries) and `index.ts`. This chunk stays OUT of `index.ts` (adoption lives in
  `thread-lifecycle.ts`/`store.ts`) to keep the rebase surface small. PR #30's
  `isNewThread = !inbound.thread_id || !store.threadExists(inbound.thread_id)` proxy stays
  CORRECT under adoption (first adopted turn: unknown id → true; continuation: exists → false)
  — re-verified at PR-#30 rebase (Jimmy, pre-demo; not a chunk task).
- **Edge (define in tests, don't grow scope):** `session_start{thread_id}` for a thread whose
  `status=dismissed` — today it hydrates and continues (status not flipped back). The overlay
  won't produce this after chunk 03 (reset on dismiss); keep current behavior, assert it in a
  test so it is deliberate, leave status semantics architect-time.
- **Interim behavior change on main (deliberate, no regression):** after this merges, the real
  overlay gains within-thread memory for the app-run lifetime. "New conversation" arrives with
  chunk 03's dismiss-reset.
