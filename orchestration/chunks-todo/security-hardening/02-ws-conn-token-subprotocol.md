# Chunk 02: Per-install WS token via subprotocol + thread-adoption caller-auth + timing-safe verify

**Status:** in-progress
**Created:** 2026-06-12
**Phase:** Security hardening pass (pre-public-release gate)
**Estimated size:** ~1 day
**Depends on:** none (the token + its 0600-file home already exist — `TokenStore`, MF-05 T2.1b; **parallelizable with 01**, sequenced before 03)
**Closes:** known-gotcha #31 (T1 — executes ADR-0003 p.5) · **ADR-0014 regret-(a) rider** (T3 — thread-write caller-auth)
**Refs:** [[../../docs/specs/2026-06-12-security-hardening]] §3.2/§3.3/§3.4/§3.6/§3.8 · [[../../docs/adr/0003-local-daemon-ws-architecture]] p.5 + Amendment · [[../../docs/adr/0014-connection-model-persistent-ws-dismiss-thread-adoption]] regret (a) · bus q#002

## Scope

**In:**
- **Daemon requires the per-install token on WS upgrade**, presented as the **`Sec-WebSocket-Protocol`
  subprotocol** (`new WebSocket(url, [token])` — browser WS cannot set headers; spec §3.2, **Jimmy
  override q#002, Lior confirms at PR**). Verified via `TokenStore.verify` **before**
  `server.upgrade()`; the daemon **MUST echo the negotiated subprotocol** in the 101 response (Bun:
  `server.upgrade(req, { headers: { "Sec-WebSocket-Protocol": <token> } })`) or the browser drops
  the connection. **If the echo is unworkable in Bun → BLOCKER, ask up via the bus; do NOT silently
  fall back to query-param** (q#002 explicit).
- **Origin allowlist AUGMENTED, not replaced** (spec §3.3): token = primary gate, `origin.ts` stays
  as layer 2; update its header comment (no longer "the only gate").
- **`TokenStore.verify` → timing-safe compare** (spec §3.8) — written ONCE here; chunk 03 and the
  shipped write path inherit it (the verify seam is the sole comparison point by design).
- **Clients present the token** (spec §3.4). Grill-corrected reality (the hard part of this chunk):
  - **Overlay (the real WS lives in `apps/overlay/src/main.ts:28`, NOT session-client.ts):** the
    `WebSocketFactory` signature (`apps/overlay/src/ws/types.ts:17`) carries URL only — extend it
    (token or token-provider) and thread through `ConnectionManager.openSocket()`
    (`connection-manager.ts:54,79`) so **every reconnect re-presents the token**, not just the
    first connect. Decide token-read timing explicitly: read once at boot BEFORE
    `connection.connect()` (`main.ts:41`) or make connect async — `runSession` errors on
    `this.ws === undefined` (`connection-manager.ts:139`).
  - **The `main.ts:1-9` header comment currently FORBIDS a subprotocol token** ("No query-param /
    subprotocol token substitute") — it is **stale** as of this pass (the token is being
    un-deferred per ADR-0003 p.5); update it to cite the spec, or it reads as a hard "don't".
  - **Rust side has NO fs capability today** (`src-tauri/src/lib.rs` registers only the shortcut +
    `hide_panel`): add a `#[tauri::command]` (or fs-plugin + capability grant) that resolves
    dataDir **exactly like `index.ts:64`** (`AGENTIC_DATA_DIR` ?? `homedir()/.agentic-engine`) and
    reads `auth-token`; expose via `invoke`. Mismatched dataDir resolution = overlay presents a
    token the daemon never minted.
  - **Scripts/tests:** `packages/daemon/scripts/test-client.ts`, **`memory-smoke.ts`**
    (`scripts/memory-smoke.ts:24` — breaks silently otherwise), all 9 WS-connecting
    `*.daemon.test.ts`, and `apps/overlay/src/ws/connection-manager.realio.test.ts` read the same
    file via `AGENTIC_DATA_DIR`.
- **Thread-adoption caller-auth = the connection gate** (spec §3.6, ADR-0014 rider): adoption rides
  `session_start` over the now-authenticated socket — same token, no new wire fields. Includes an
  **adversarial test**: a tokenless/bad-token client cannot reach `session_start` (and therefore
  cannot adopt/steer a `thread_id`); plus an audit assertion in the PR that **no other
  unauthenticated thread-write path exists**.
- **Log rejected upgrades** (origin + reason) — **never the credential value** (spec §3.8).

**Out:** (each states WHY — PIPELINE §7.2)
- **HTTP read-path gating** — chunk 03 (separate surface, same `verify`).
- **Token rotation/revocation UI** — settings concern, when a settings surface exists (spec §5).
- **Pairing / per-device tokens** — mobile/remote future (spec §3.4); the file IS the provisioning.
- **Rate-limiting failed auth** — YAGNI on loopback single-user (spec §3.8, recorded defer).
- **web-admin tab wiring** — until that frontend exists.
- **#35** — awareness only (no OAuth-reuse path may be created); not buildable code.

## Done criteria

- [ ] **[behavioral]** on real macOS: overlay connects WITH the token (subprotocol) and the full
      hotkey→reply flow works; a client with **no / wrong** token is **rejected before upgrade**
      (runtime proof, live).
- [ ] **[behavioral]** kill + restart the daemon mid-session → the overlay's CM-02 backoff
      **reconnect re-presents the token** and the next turn succeeds (the reconnect path, not just
      first connect).
- [ ] **[mechanical]** real-I/O daemon tests: tokenless/bad-token WS connect rejected (no 101);
      valid token accepted with the subprotocol **echoed in the 101**; browser-style client object
      (subprotocol arg) used in at least one test.
- [ ] **[mechanical]** adversarial thread-adoption test: tokenless client cannot reach
      `session_start`/adoption (ADR-0014 rider discharged at the connection gate).
- [ ] **[mechanical]** `TokenStore.verify` is timing-safe (constant-time compare); shipped
      `/memory/*` write-path tests still green through the same verify.
- [ ] **[mechanical]** frozen 6-variant envelope **byte-untouched** (`packages/protocol` diff
      empty) — the token rides the handshake, not the wire schema.
- [ ] **[mechanical]** rejected-auth log lines contain origin/reason but **never the token value**.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green (incl. updated
      `test-client.ts` + WS tests presenting the token).

## Orchestrator brief (read by the orchestrator from this file)

```
implement the per-install WS token at the upgrade gate via Sec-WebSocket-Protocol, per spec
orchestration/docs/specs/2026-06-12-security-hardening.md §3.2-§3.4/§3.6/§3.8 (execute ADR-0003 p.5,
close #31, discharge ADR-0014 regret-(a)).

Files to touch (indicative):
- packages/daemon/src/index.ts        (verify-before-upgrade + subprotocol echo + reject logging —
                                       in the WS-upgrade ELSE branch ONLY, index.ts:100-106; do NOT
                                       touch the /memory/* + /history.html dispatch above it, that
                                       is chunk 03's surface and uses Bearer, not subprotocol)
- packages/daemon/src/memory/token-store.ts  (timing-safe verify — the ONE comparison sink)
- packages/daemon/src/origin.ts       (header comment: now layer-2)
- apps/overlay/src/main.ts (factory + STALE lines 1-9 comment) + src/ws/types.ts (factory sig) +
  src/ws/connection-manager.ts (openSocket/reconnect) + src-tauri/ (new command: read auth-token)
- packages/daemon/scripts/test-client.ts + scripts/memory-smoke.ts + *.daemon.test.ts +
  apps/overlay/src/ws/connection-manager.realio.test.ts (present the token)

Done when: see Done criteria above (live reject/accept demo; subprotocol echo test; adoption
adversarial test; protocol byte-untouched; suite green).

ADRs in scope: ADR-0003 p.5 + Amendment (origin stays as layer 2), ADR-0014 rider. FROZEN: the
6-variant envelope — token lives entirely OUTSIDE it.
HARD RULE from the bus (q#002): if Bun cannot echo the subprotocol on upgrade → STOP, ask up; no
silent query-param fallback.
```

## Notes / Open questions

- q#002-2a (subprotocol over query-param) is a **conductor override** of the decompose
  recommendation, flagged for Lior at PR review — nothing merges before he sees it.
- **Bun both-gates mechanic (grill-verified against bun-types 1.3.14):** Bun test/script clients
  present BOTH gates in one options object — `new WebSocket(url, { headers: { Origin },
  protocols: [token] })`. The browser/overlay can only use the array form `new WebSocket(url,
  [token])` (cannot set headers — the whole reason subprotocol won). The naive browser-form
  rewrite of a Bun client would silently DROP its Origin header — don't.
- Daemon echo: `server.upgrade(req, { headers: { "Sec-WebSocket-Protocol": token } })`.
