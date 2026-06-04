> ⚖️ **LIGHT-DIRECT DRAFT — DO NOT EXECUTE AS-IS.** Written without spec / brainstorm / grill. Revisit AFTER memory-foundation chunks, then brainstorm + grill + compare. See `README.md` in this folder. The `## Open / assumptions` section below is what a brainstorm would resolve — and for this chunk it is **load-bearing** (the token transport mechanism is genuinely unsettled).

# Chunk 02: Per-install WS token (connection-level, additive)

**Status:** postponed
**Created:** 2026-06-04
**Phase:** Security hardening pass (near-term, before any non-dev release)
**Estimated size:** ~1 day
**Depends on:** 01 (the token needs a secure home = Keychain)
**Closes:** known-gotcha #31 (CSWSH exposure window) · **executes ADR-0003 p.5** (the per-install token; only timing was deferred)
**Refs:** [[../../docs/adr/0003-local-daemon-ws-architecture]] (Decision p.5 + Amendment 2026-05-30) · [[../../docs/known-gotchas]] #31 · ADR-0012 decision 5 (the memory-poisoning surface that chains with #31)

## Scope

**In:**
- **Generate a per-install token** and store it via the chunk-01 secrets module (Keychain).
- **The daemon requires the token on WS connect** — a **connection-level** check (handshake), **additive**, that **does NOT touch the frozen 6-variant message envelope** (#31: "the token is additive and does NOT touch the frozen message envelope"). A connection without / with a wrong token is refused before/at upgrade.
- **All frontends (the overlay) + the test harness present the token** on connect.
- Decide the token's relationship to the **interim Origin-allowlist** (replace vs complement — see Open).

**Out:** (each states WHY)
- **Token rotation / revocation UI** — OUT, later (a settings concern; web-admin tab when it exists).
- **Per-plugin tokens** — OUT, Phase 5.
- **web-admin tab token wiring** — OUT until that frontend is built; this chunk covers overlay + harness.
- **#35 (subscription OAuth-reuse prohibition)** — not buildable code; a **DoD awareness check**, not a task.

## Done criteria

- [ ] **[behavioral]** on real macOS: the overlay connects **with** the token and the full hotkey→widget flow works; a client connecting **without** (or with a **wrong**) token is **rejected** (runtime proof, live).
- [ ] **[mechanical]** real-I/O test: the daemon **rejects** a tokenless / bad-token WS connect and **accepts** a valid one (against the real daemon, not a mock).
- [ ] **[mechanical]** the frozen **6-variant envelope is byte-untouched** (the token rides the connection layer, not the wire schema) — `packages/protocol` diff empty.
- [ ] **[mechanical]** the **test harness** (`scripts/test-client.ts` + WS tests) is updated to present the token; suite green.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

## Orchestrator brief (read by the orchestrator from this file)

```
implement a per-install WS token (connection-level, additive) — execute ADR-0003 p.5, close gotcha #31.

Files to touch (indicative):
- packages/daemon/src/index.ts   (require the token at the WS upgrade gate — alongside/replacing the Origin-allowlist)
- apps/overlay/src/ws/           (present the token on connect)
- packages/daemon/scripts/test-client.ts + WS tests (present the token)
- the secrets module from chunk 01 (store/read the token)

Done when:
- the daemon refuses tokenless/bad-token WS connects and accepts valid ones (live macOS + real-I/O test);
- the overlay flow works WITH the token;
- the 6-variant envelope is byte-untouched (packages/protocol diff empty);
- harness updated; typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0003 p.5 (the token) + Amendment 2026-05-30 (Origin-allowlist interim). Frozen — DO NOT touch the message envelope.
```

## Open / assumptions (un-brainstormed — LOAD-BEARING; the brainstorm/grill comparison will be most visible here)

- **OPEN (critical) — token transport mechanism.** Subprotocol vs `Sec-WebSocket-Protocol` vs a custom header vs query-param. **⚠️ The 02b-i origin-spike already found that "a query-param / subprotocol token is NOT a CSWSH substitute" by itself** (JS cannot set `Origin`; the browser sets it). So the token's *mechanism* interacts with the existing Origin defense — this needs real thought, exactly what a grill would force. The light-direct draft does **not** pick a mechanism; it just requires "a connection-level token."
- **OPEN — replace vs complement the Origin-allowlist.** #31 frames the token as the *real* fix (Origin-allowlist is interim). Does the token **replace** the allowlist or sit **alongside** it (defense-in-depth)? *(Likely complement; un-decided here.)*
- **OPEN — token generation timing & provisioning.** First daemon launch (self-provision into Keychain) vs an install script. How does a *new* frontend learn the token (same-machine read from Keychain? a pairing step)?
- **OPEN — token format / length / entropy** (e.g. a 256-bit random; encoding).
- **ASSUMED:** overlay + test-harness are the only token-presenting clients today (web-admin tab deferred until built).

## Notes

- This is the **"before"** snapshot for the process experiment (README). The `## Open` items above are deliberately left open — the experiment is precisely whether brainstorm + grill resolve them better than a direct build would. Preserve this file in git history before any post-ceremony rewrite.
- **Sequencing:** closing #31 here directly defuses the memory-poisoning↔CSWSH chain (ADR-0012 decision 5, line 52) that the just-decomposed memory-foundation introduces — a reason to do this **near** memory, not "someday."
