# Chunk 01: Durable memory store + thread/session model + within-thread multi-turn

**Status:** todo
**Created:** 2026-06-04
**Phase:** Conversation & Interaction Model · route part 1 (Memory foundation)
**Estimated size:** ~1 day
**Depends on:** none
**Spec:** `orchestration/docs/specs/2026-06-04-memory-foundation.md` (§3.1, §3.3, §3.4) · **ADR:** [[../../docs/adr/0012-conversation-and-memory-model]] (decisions 4, 6; transparency seams 5b/5e storage half)

## Scope

This chunk lays the **persistence substrate + the foundation seams as pass-throughs**. It establishes the store, the thread/session model, within-thread multi-turn, and the checkpoints that later sub-chunks *fill* — it does **not** add distillation, cross-thread, policy, or UI.

**In:**
- **SQLite + files store** with the schema in spec §3.4: `threads`, `messages` (append-only EVENT log = source of truth), `mutations` (tombstone | correction), `distillation_events` (table only), `distilled_facts` (table + the tag columns `provenance`/`scope`/`expiry`/`confidence`/`authored_by` present, unpopulated here).
- **`session_start` additive optional `thread_id`** in `packages/protocol/src/envelope.ts` — additive field on the existing variant, **no 7th envelope variant** (spec §5; preserves the frozen 6-variant union).
- **Daemon thread lifecycle:** on `session_start{thread_id}` load that thread's recent `messages` into `ProviderSessionState.messages[]`; on turn end append the turn's messages back to the durable thread **through the WRITE-GATE**. No/unknown `thread_id` ⇒ mint a new thread (single-turn = a one-turn thread).
- **WRITE-GATE** — the single pass-through function every memory write flows through (NO policy yet; spec §3.3).
- **ARCHIVE-AS-TRUTH** invariant in place (spec §3.2 invariant 1, as redefined: event-history is immutable; forget hard-scrubs content).
- **forget/edit STORAGE seam (MUTATION-AS-APPEND, spec §3.4):** forget = appended tombstone + hard-scrub of the referenced `messages.content`; edit = appended correction record (never in-place). **Tombstone-honoring WITHIN-THREAD read** — a forgotten/edited turn is excluded/redacted when loading the same thread's tail.
- **5b CONSOLIDATION-HOOK seam:** a pass-through hook invoked on `threads.status→dismissed` + the `distillation_events` table. The hook is a **no-op stub here** (the distiller that fills it is chunk 02).
- **Within-thread multi-turn working:** the agent sees prior turns of the same thread (the daemon hydrates `messages[]`; the existing provider consumes it unchanged).
- **Real-I/O smoke-probe** — a script driving the real daemon → store once, *before any UI exists* (spec §4.2).

**Out:** (each states WHY)
- **Distiller / cross-thread / injection-point / provider-port** — OUT, deferred to **chunk 02**: this chunk is the store + within-thread + the hook *stub* only.
- **Write-gate POLICY (scan, no-overwrite)** — OUT, deferred to **chunk 03**; the gate here is a no-op pass-through, **frozen as a seam** per spec §3.3 (filling it later must not re-plumb the write path).
- **Tombstone-honoring re-derive / injection** — OUT, deferred to **chunk 02**, because re-derive and the injection-point are *born* in 02 (spec §3.4 F1 split); 01 only honors tombstones on the **within-thread read**.
- **Any hatch UI / read API surface** — OUT, deferred to **chunk 05** (spec §3.5); the store stays daemon-internal.
- **Smart distiller, idle-timer consolidation trigger** — OUT / frozen per spec §1 + §7 (dumb-only; dismiss-trigger only).

## Done criteria

- [ ] **[mechanical]** `envelope.ts`: `session_start` has optional `thread_id`; envelope tests green; the other 5 variants byte-unchanged (frozen union intact).
- [ ] **[mechanical]** real-I/O test (real daemon → real SQLite, **no mocked store**): two turns in one thread; turn-2's provider input contains turn-1's messages (within-thread multi-turn).
- [ ] **[mechanical]** real-I/O test: forget a message → its `content` is **hard-scrubbed** in the store, a `mutations` tombstone row exists, the message + tombstone rows remain; the same-thread tail read excludes/redacts it.
- [ ] **[mechanical]** real-I/O test: edit a message → a `mutations` correction row appended; the original row is **not** mutated in place.
- [ ] **[mechanical]** `threads.status→dismissed` **invokes** the consolidation-hook (a registered pass-through handler is called — proves the seam exists); `distillation_events` table schema present. *(Writing an event row is chunk 02's distiller.)*
- [ ] **[mechanical]** the real-I/O **smoke-probe** runs: real daemon → store, exits 0, asserts a thread + its messages persisted on disk.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

> No per-chunk live demo (spec §4): intermediate proof is **real-I/O tests + the smoke-probe**, not mocks (the Strike-4 scar). The route-closing live demo is chunk 05.

## Orchestrator brief (read by the orchestrator from this file)

```
implement the durable memory store + thread/session model + within-thread multi-turn
per orchestration/docs/specs/2026-06-04-memory-foundation.md §3.1/§3.3/§3.4 and ADR-0012.

Files to touch (indicative):
- packages/protocol/src/envelope.ts  (additive optional thread_id on session_start)
- packages/daemon/src/             (new memory store module: SQLite+files; thread lifecycle;
                                    WRITE-GATE pass-through; MUTATION-AS-APPEND; consolidation-hook stub)
- packages/daemon/src/index.ts     (load thread tail on session_start{thread_id}; append on turn end via the gate;
                                    stop discarding state silently — flush to the durable thread)
- a real-I/O smoke-probe script under packages/daemon/scripts/

Done when:
- session_start carries optional thread_id (frozen union otherwise unchanged);
- within-thread multi-turn works over the REAL daemon→SQLite path (real-I/O test, no mocked store);
- forget = tombstone + hard-scrub; edit = correction record; within-thread read honors tombstones;
- the consolidation-hook fires on dismiss (stub) and distillation_events table exists;
- the smoke-probe drives real daemon→store and asserts on-disk persistence;
- typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0012 (decisions 4, 6; 5b/5e storage seams), ADR-0001 (ephemerality preserved — session stays per-turn), ADR-0003 (daemon/WS).
Frozen — DO NOT: add a 7th envelope variant; put policy in the write-gate (chunk 03); add a distiller (chunk 02); add UI (chunk 05).
```

## Notes / Open questions

- **§7.1 runtime-coupling (spec §3.1 note):** this chunk changes the *behavioral* contract — `index.ts:70` currently `sessions.delete(sid)` and the state is gone; now state also flushes to a durable thread. The wire stays frozen; the behavior changes deliberately. Localized to the write-gate, not scattered (the v0 02a-scar lesson).
- **Files-vs-SQLite canonical-byte split** (spec §3.4) is an architect-time call; ARCHIVE-AS-TRUTH (spec §3.2 invariant 1) governs regardless.
