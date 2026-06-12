# Chunk 03: Token-gate `/memory/*` reads + history.html paste-extend (ADR-0013 rider)

**Status:** in-progress
**Created:** 2026-06-12
**Phase:** Security hardening pass (pre-public-release gate)
**Estimated size:** ~0.5–1 day
**Depends on:** 02 — **runtime coupling, not file-disjointness** (PIPELINE §7.1): both touch the
`index.ts` `fetch` handler and both flow through the ONE `TokenStore.verify`, which 02 hardens
(timing-safe). Sequencing 03 after 02 keeps the verify written once and avoids a mid-flight merge
conflict in the same handler.
**Closes:** **ADR-0013 acceptance rider** (T2 — read-disclosure; Option A end-state)
**Refs:** [[../../docs/specs/2026-06-12-security-hardening]] §3.5 · [[../../docs/adr/0013-daemon-memory-write-http-surface-caller-auth]] (rider) · bus q#003

## Scope

**In:**
- **Every `GET /memory/*` requires `Authorization: Bearer <token>`** → the same `TokenStore.verify`
  (spec §4 spine). Missing/bad credential → **401**. The shipped write path's 403→401
  harmonization is **bigger than it looks** (grill-measured): 6 sites — `http-routes.ts:103,129` +
  `history-page.ts:487,557` (incl. the user-facing "403 —" strings) + the write-path tests.
  **Default: reads=401, writes stay 403, record the inconsistency here** — harmonize only if the
  worker confirms all 6 sites are trivial (q#003).
- **`GET /history.html` stays OPEN on loopback** (static shell, zero user data) behind the existing
  DNS-rebinding **Host-guard, which STAYS** — it already exists at **`index.ts:93-97`**, NOT in
  `http-routes.ts`: assert it in tests, do **not** re-implement it (defense-in-depth; spec §3.5).
  The provenance link (`provenance-stamp.ts:5`) keeps working: open → paste → see.
- **history.html extends the shipped paste-UX to reads**: nothing renders until the token is pasted
  (today paste unlocks only edit/forget); token remains in a **JS variable ONLY — never web
  storage** (ADR-0013 threat model, unchanged discipline).
- **401 responses logged** (path + reason) — never the credential (spec §3.8).
- **README of the pass records: this chunk DISCHARGES the ADR-0013 read-token rider** (ADR body
  immutable — the rider foresaw exactly this).

**Out:** (each states WHY — PIPELINE §7.2)
- **WS-surface gating** — chunk 02 (different transport, same verify).
- **web-admin SPA / any history-page feature growth** — the page stays the minimal static shell
  (ADR-0013 scope; "rule of three" on daemon HTTP routes still armed).
- **Cookie/session auth for the page** — rejected at q#003 (R2): would force a credential into a
  URL or new auth machinery; paste-UX is the decided pattern.
- **Rate-limiting** — deferred (spec §3.8).

## Done criteria

- [ ] **[behavioral]** live on macOS: open `history.html` via the provenance link → page loads
      (shell open) → data does NOT render pre-paste → paste token → threads/facts render; edit +
      forget still work.
- [ ] **[mechanical]** real-I/O tests: every `GET /memory/*` route → **401** without / with a bad
      token; **200** with the valid bearer; Host-guard still rejects foreign Host headers (403).
- [ ] **[mechanical]** the static shell `GET /history.html` serves **without** a token (loopback +
      Host-guard only).
- [ ] **[mechanical]** write-path (`POST/DELETE`) tests still green through the same verify; status
      harmonization applied or inconsistency recorded here.
- [ ] **[mechanical]** no credential value in any log line.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green; `packages/protocol`
      byte-untouched.

## Orchestrator brief (read by the orchestrator from this file)

```
token-gate the /memory/* READ path per spec orchestration/docs/specs/2026-06-12-security-hardening.md
§3.5 (discharge the ADR-0013 read-token rider; Option A end-state).

Files to touch (indicative):
- packages/daemon/src/memory/http-routes.ts   (verify on GET handlers; 401 semantics)
- packages/daemon/src/memory/history-page.ts  (paste-UX gates ALL rendering, not just writes)
- packages/daemon/src/memory/http-routes.daemon.test.ts + hatch.daemon.test.ts (401/200 matrix)
- packages/daemon/src/index.ts                (only if the route dispatch needs it — 02 owns the
                                               upgrade path; coordinate, don't collide)

Done when: see Done criteria above (paste-gated live demo; 401/200 matrix; shell open; suite green).

ADRs in scope: ADR-0013 (the rider this discharges). FROZEN: protocol + mock untouched.
NOTE: chunk 02 already made verify timing-safe and owns index.ts's upgrade branch — rebase on its
merge; do NOT re-implement verify.
```

## Notes / Open questions

- (none — seams resolved on the bus: q#003 R1 + defaults)
