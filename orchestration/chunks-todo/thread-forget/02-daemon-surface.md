# Chunk 2: the daemon surface — HTTP intent-dispatch, live-guard, adoption exclusion, history.html

**Status:** todo
**Created:** 2026-07-22
**Phase:** memory 2e (thread-forget)
**Estimated size:** ~1 day
**Depends on:** 01 (the `WriteGate.forgetThread` primitive + its store helpers)

## Scope

**In:**
- **HTTP (spec §3.3):** additive `target_type:"thread"` branch on `POST /memory/forget`
  (`http-routes.ts` — mirrors the fact branch's UUID discipline): body
  `{target_type:"thread", thread_id, reason?}`; dispatch `hatch.forgetThread(thread_id,
  HTTP_CTX, reason)`. Taxonomy: 401 (token) · 400 (shape/non-UUID) · 404 `target_not_found` ·
  **409 `{error:"thread_live"}`** · 204 (applied AND idempotent repeat). Update the
  `http-routes.ts:29-32` header comment: `thread_live` is a DISTINCT 409 condition from the
  reserved future 5e-actor refusal, differentiated by `error` body [critic m7].
- **`Hatch.forgetThread` façade** (thin, house pattern).
- **The live-registry (spec §0.5, q#019 + critic MAJOR-1 — spec-frozen structure):**
  `index.ts` maintains a module-level `Map<threadId, refcount>` — increment where a socket
  binds/touches a thread (the `session_start` handling), decrement for that socket's threads in
  `close` (`index.ts:304-342`); refcount because two sockets can adopt one thread. Additive
  `isThreadLive: (id) => boolean` dep on `MemoryHttpDeps`. Point-in-time check (TOCTOU accepted,
  stated). Test the DECREMENT (a leak = threads permanently unerasable).
- **`hatch.view` widening (spec §3.3):** additive `thread: {thread_id, status, last_active_at}`
  on the view payload (the §0.3 husk render needs the status); overlay `types.ts` widens in
  chunk-03.
- **Erased-id adoption exclusion (spec §3.3a):** `beginTurn` treats a `status='forgotten'`
  requested id as UNKNOWN and mints a FRESH random id (never passes the erased id as `adoptId` —
  PK collision with the husk). Test: `session_start` with an erased id → new distinct thread,
  husk byte-untouched.
- **history.html (spec §0.1/§3.5):** thread-forget button in the detail view with the arm→confirm
  pattern (5s auto-reset, the fact-forget precedent) using the FROZEN §0.2 copy with the real
  message count; the erased-state banner; a 409-specific honest line in `doForget`-style handling
  ("conversation is open — close it first") [critic m8].
- **Tests (spec §5):** full HTTP taxonomy incl. 409 (fake registry entry) + idempotent 204;
  live-guard both sides (409 while live; close→dismiss→clean erase, no post-erase plaintext
  re-flush); adoption exclusion; frozen byte-diff empty.
- **EXECUTED probe (Strike-5, output in the PR):** end-to-end `history.html/HTTP → Hatch →
  WriteGate` on a fresh store — seed a real conversation + distill → erase → stdout proves:
  messages scrubbed, facts intact, archive-search miss + fact-leg hit, mirror clean.

**Out:** (spec §7.2 rationale)
- Overlay Memory window UI — chunk-03 (separate surface; this chunk keeps the daemon+fallback
  layer independently demoable via history.html).
- Any change to the WS wire / mock reducer — FROZEN (the guard rides HTTP deps, not the wire).
- A `status='dismissed'` gate instead of the registry — REJECTED at q#019 (status is not a
  liveness signal — spec §0.5).
- Locking against the dismiss-race distill window — deliberately a NOTE, not a lock
  (spec §3.7 [critic m9]).

## Done criteria

- [ ] **[mechanical]** HTTP taxonomy tests green: 401/400/404/409/204 + idempotent repeat 204;
      `target_type:"message"`/garbage still 400 (unchanged).
- [ ] **[mechanical]** Live-guard tests green both sides + registry decrement-on-close proven.
- [ ] **[mechanical]** Adoption-exclusion test green (fresh id minted; husk untouched).
- [ ] **[mechanical]** `hatch.view` carries the additive `thread` meta; existing consumers
      unaffected (history.html ignores unknown fields).
- [ ] **[behavioral]** history.html: arm→confirm→erase works against the running daemon; banner
      renders; 409 line renders for a live thread. (Runtime proof — the EXECUTED probe output in
      the PR; the full user-facing sign-off is the chunk-03 §6.1 demo.)
- [ ] **[mechanical]** EXECUTED probe stdout in the PR (facts intact + archive miss + fact hit).
- [ ] **[mechanical]** `bun test` + `lint:strict` + typecheck green; frozen surfaces
      byte-unchanged.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 02 of thread-forget (2e) per orchestration/docs/specs/2026-07-22-thread-forget.md
§3.3 + §3.3a + §0.5 + §0.1/§3.5 (history.html half) + §5.

Files to touch:
- packages/daemon/src/memory/http-routes.ts (target_type:"thread" branch + 409 + header-comment
  update; MemoryHttpDeps.isThreadLive)
- packages/daemon/src/memory/hatch.ts (forgetThread façade; view() thread-meta widening)
- packages/daemon/src/index.ts (the Map<threadId,refcount> live-registry, inc/dec sites; pass
  isThreadLive into memory HTTP deps)
- packages/daemon/src/memory/thread-lifecycle.ts (beginTurn 'forgotten' exclusion per §3.3a)
- packages/daemon/src/memory/history-page.ts (thread-forget button + frozen confirm copy +
  banner + 409 line)
- tests: http-routes.daemon.test.ts, thread-lifecycle/adoption tests, an executed probe script
  (memory-demo-harness family)

Done when: the seven checkboxes above are green with command evidence + probe stdout in the PR.

ADRs in scope: ADR-0013 (Bearer/401, additive body); ADR-0015 (intent-dispatch reuse);
ADR-0014 (adoption semantics — only the 'forgotten' exclusion changes); ADR-0012 rider Ruling 2
(no fact-side touches anywhere).
Runtime-coupling notes: spec §4 items 3/4/6/7.
```

## Notes / Open questions

- Increment-site precision for the registry (which exact lines in the `session_start` handling)
  is architect-time (spec §7); the structure + decrement-on-close are spec-frozen.
- **[carried from chunk-01 review 2026-07-22 — hard-reviewer MINOR-2, DORMANT]** `WriteGate.edit`
  is message-id-keyed and has NO status check, so calling it on a tombstoned message of a
  `status='forgotten'` thread re-introduces plaintext into `mutations.replacement_content` AND
  appends a plaintext `edit` line to the just-scrubbed mirror (probe-proven; every DB *read* still
  returns `[forgotten]`, so nothing resurfaces to a reader/`memory_search` until a re-erase
  recovers it). Reachability today = NONE (`WriteGate.edit` lost its last production caller at the
  2d message-edit removal). The chunk-02 live-guard (§0.5) and §3.3a adoption exclusion are
  thread-adoption-keyed and do NOT close this message-id-keyed write path. **Cheap structural close
  (mirror of §3.3a), consider folding into this chunk's guard family:** `edit()` no-ops (or refuses)
  on a message whose thread is `status='forgotten'`. At minimum leave a one-line residual so a
  future `edit` caller can't silently reopen the breach class §3.3a closes for `appendTurn`.
- **[carried from chunk-01 review 2026-07-22 — hard-reviewer NIT-5]** `mutations.reason` is OUTSIDE
  the erase matrix (tombstone/correction `reason` survives un-scrubbed). Today all callers pass
  constants, so it's moot — but THIS chunk adds the HTTP body's optional free-text `reason`
  (`{target_type:"thread", thread_id, reason?}`). If a user ever types content-quoting text there,
  it lands unerasable in the tombstone `reason` column. Decide in this chunk: scrub `reason` in the
  thread-forget path, or sanitize/document that `reason` is metadata-not-content.
