---
status: accepted
date: 2026-06-12
deciders: [lior]
tags: [spec, security, auth, token, keychain, websocket, http]
---

# Spec: Security hardening pass — the per-install-token auth spine + cloud-secret home

> **Sign-off:** `accepted` (Lior, 2026-06-12 — §5.2 gate). Authored by the decompose session
> (fable) from bus-resolved seams (conveyor q#001–q#003, conductor: Jimmy). **§3.2 — the Jimmy
> OVERRIDE to the subprotocol transport (T2) was CONFIRMED by Lior** at sign-off. The decompose PR
> (#43) is unblocked to merge; the three chunks are ready to build.

## 1. Problem & threat model

The daemon is an **always-on loopback service** (`127.0.0.1:7777`, ADR-0003 p.3) holding the
user's super-chat memory and an Anthropic API key. Four open exposures, all pre-public-release
gates:

| # | Exposure | Threat | Source |
|---|----------|--------|--------|
| T1 | **CSWSH window** ([[../known-gotchas]] #31, `blocking-MVP`) | any browser tab (or crafted local client) connects to the WS and drives sessions; `Origin` allowlist is spoofable by non-browser clients | ADR-0003 Amendment 2026-05-30 |
| T2 | **Memory read-disclosure** | `GET /memory/*` open on loopback — any local process reads the super-chat | ADR-0013 trade-off, **binding rider: close in THIS pass** |
| T3 | **Thread-adoption steering** (ADR-0014 regret (a), **binding rider**) | a crafted client pre-seeds a client-minted `thread_id` → writes into / grafts onto a thread the user never meant; UUID-shape validation cleans the *keyspace*, not the *caller* | ADR-0014 acceptance rider 2026-06-12 |
| T4 | **Prod key delivery** ([[../known-gotchas]] #38, `blocking-MVP`) | `.env` reaches `bun run dev` but NOT an env-isolated prod daemon (launchd) → silent missing-key failures; plaintext `.env` is also the weakest at-rest home for a cloud credential | gotcha #38, [[../architecture]] (Keychain) |

Awareness only (not buildable here): **#35** — subscription OAuth-reuse is prohibited and
server-enforced; nothing in this pass may create a path that reuses Claude-CLI OAuth tokens.

## 2. The design in one paragraph

**One per-install secret, one comparison sink, N gated surfaces.** The already-shipped
`TokenStore` (MF-05 T2.1b: `<dataDir>/auth-token`, mode 0600) **is** the per-install token of
ADR-0003 p.5 — no second secret is minted. Its `verify()` becomes **timing-safe** and remains the
**sole** comparison point; every gated surface routes through it, differing only in *transport*
(dictated by client capability). The OS **Keychain** is introduced for exactly one secret — the
**cloud** credential `ANTHROPIC_API_KEY` — because off-machine-valuable secrets justify Keychain
ACL ceremony; the local-only token does not (q#001).

## 3. Decisions (bus-resolved; cite these, do not re-derive)

### 3.1 Token home — 0600 file, NOT Keychain (q#001 → O1)

The token stays in `<dataDir>/auth-token` (0600). ADR-0003 p.5's letter
("file-system-permission-protected") sanctions this — **no ADR edit**. Rationale: the #31
threat (browser tab) can read neither files nor Keychain — the file fully closes CSWSH; vs
same-user local processes the Keychain adds nothing while `memory.db` itself is plaintext
(guarding the token harder than the data is incoherent); clients must *read* the token to present
it (file = trivial; Keychain-from-Tauri = entitlements ceremony that would also break the
history.html paste-UX). **Posture rule:** Keychain = cloud/off-machine secrets; 0600 file =
local-only secrets. The roadmap's "all secrets in the OS Keychain" reads as "all **cloud**
secrets" — doc-reconciliation recorded in the pass README, not a roadmap change.

### 3.2 WS transport — `Sec-WebSocket-Protocol` subprotocol (q#002 → T2; **Jimmy OVERRIDE — CONFIRMED by Lior 2026-06-12**)

Browser WS API cannot set headers (the overlay's real socket is the browser `new WebSocket` inside
the `WebSocketFactory` at `apps/overlay/src/main.ts:28`, driven by `connection-manager.ts` —
`session-client.ts` is the DOM-free seam above it), so the viable transports were query-param vs
subprotocol. The decompose session recommended query-param
(simplest in all 3 clients); **the conductor overrode to subprotocol**: in a *security* pass a
credential must not live in a URL (logs, history, Referer) when a standard W3C channel exists —
the K8s-apiserver pattern. Mechanics: client `new WebSocket(url, [token])`; the daemon verifies
**before** `server.upgrade()` and MUST echo the negotiated subprotocol in the 101 response or the
browser rejects the connection; the 64-char-hex token (32 random bytes) is a valid RFC 6455
subprotocol token. **If the
echo proves unworkable in Bun (it shouldn't), that is a build blocker → ask up; do NOT silently
fall back to query-param.**

### 3.3 Origin allowlist — AUGMENT, not replace (q#002 → 2b)

Token becomes the **primary** gate; the shipped `origin.ts` allowlist stays as the second layer
(zero cost, cuts casual browser clients pre-token). Its header comment is updated (no longer "the
only gate").

### 3.4 Provisioning — same-machine file-read, NO pairing (q#002 → 2c)

The token's home IS the distribution mechanism: overlay reads `<dataDir>/auth-token` Rust-side
(Tauri fs) and hands it to the webview; `test-client.ts` / daemon tests read the same file via
`AGENTIC_DATA_DIR`. Per-device tokens + explicit pairing = the mobile/remote future (prior-art
places pairing THERE) — **deferred, recorded**.

### 3.5 Read path — static shell open, ALL data token-gated (q#003 → R1)

`GET /history.html` (static template, zero user data) stays open on loopback + the
DNS-rebinding Host-guard. **Every** `GET /memory/*` requires `Authorization: Bearer` → the same
`verify()`. The page extends the shipped paste-UX (token held in a JS variable ONLY — never web
storage): nothing renders until paste. The provenance link (`provenance-stamp.ts:5`) keeps
working: open → paste → see. **This discharges the ADR-0013 read-token rider (Option A
end-state).** Status codes: **401** for missing/bad credential on reads; harmonize the shipped
write path 403→401 only if trivial (tests + page UX), else record the inconsistency.

### 3.6 Thread-write caller-auth — the connection gate IS the thread gate (ADR-0014 rider)

All thread writes/adoption ride `session_start` over WS; once the upgrade requires the token,
every adoption is caller-authenticated **at the connection** — same token, zero new wire fields,
frozen 6-variant envelope byte-untouched. The pass adds an **adversarial DoD test** (tokenless /
bad-token client cannot reach `session_start`/adoption) plus an audit assertion that no other
unauthenticated thread-write path exists (HTTP writes: already gated per ADR-0013; HTTP reads:
gated by §3.5).

### 3.7 Keychain scope — mechanism + env-isolated real-I/O proof (q#003 → L2)

Build the secrets-resolution mechanism: **Keychain (via `security` CLI) → `.env` fallback in dev
only.** Prove #38's essence — the key reaches a daemon that cannot see `.env` — with a **real
daemon launched env-isolated** (`env -i` / cleaned env = launchd's no-inherited-env condition),
real Keychain, real Anthropic call. **launchd packaging (plist/install/autostart) is OUT** — it
does not exist in the repo today and is a future packaging/distribution feature, not a secrets
concern. **L3 option for Lior's §6.1 demo:** a one-off non-repo plist + live launchd demo, his
call at sign-off — the chunk is scoped to L2.

### 3.8 Defaults adopted (q#002/q#003)

- **Timing-safe compare** in `TokenStore.verify` (the code comment parks it "for hardening" —
  this is the hardening), written ONCE, used by all surfaces.
- **Log rejected auth attempts** (WS upgrade + HTTP 401) — **never log the credential value**.
- **Rate-limiting: deferred** (YAGNI on a loopback single-user daemon — recorded).

## 4. Surface × transport map (the spine)

| Surface | Transport | Gate | Status |
|---|---|---|---|
| WS upgrade (sessions, thread adoption) | `Sec-WebSocket-Protocol: <token>` + Origin allowlist | `verify()` pre-upgrade | **this pass (chunk 02)** |
| HTTP `POST/DELETE /memory/*` (edit/forget) | `Authorization: Bearer` | `verify()` | shipped (ADR-0013 B) |
| HTTP `GET /memory/*` (reads) | `Authorization: Bearer` | `verify()` | **this pass (chunk 03)** |
| `GET /history.html` (static shell) | — (open on loopback) | Host-guard only | unchanged |
| Anthropic API key at rest | macOS Keychain (prod) / `.env` (dev) | n/a (storage, not caller-auth) | **this pass (chunk 01)** |

## 5. Explicitly deferred (recorded so they don't rot)

- **launchd packaging / install / autostart** — future distribution feature (§3.7).
- **Pairing / per-device tokens** — mobile/remote future (§3.4).
- **Rate-limiting failed auth** — YAGNI on loopback (§3.8).
- **Token rotation / revocation UI** — settings concern, when a settings surface exists.
- **Plugin/MCP supply-chain hardening** — Phase 5, with the plugin system.
- **web-admin tab token wiring** — until that frontend exists.
- **Non-macOS keychain backends** — post-v1; the secrets seam must not preclude them.

## 6. Chunk map

| # | Chunk | Closes | Depends on |
|---|-------|--------|------------|
| 01 | API key → Keychain + env-isolated prod proof | #38 (T4) | none (**parallel** to 02/03) |
| 02 | WS conn-token via subprotocol + thread-adoption auth + timing-safe verify | #31 (T1) + ADR-0014 rider (T3) | none |
| 03 | Token-gate `/memory/*` reads + history paste-extend | ADR-0013 rider (T2) | 02 (shares `verify()` hardening + `index.ts` fetch handler — §7.1 runtime coupling) |

## Related

- [[../adr/0003-local-daemon-ws-architecture]] p.5 + Amendment 2026-05-30 — the token this pass un-defers.
- [[../adr/0013-daemon-memory-write-http-surface-caller-auth]] — Option B + the binding read-token rider (§3.5 discharges it).
- [[../adr/0014-connection-model-persistent-ws-dismiss-thread-adoption]] — regret (a) rider (§3.6 discharges it).
- [[../known-gotchas]] #31 / #35 / #38 — the gotchas this pass closes / honors.
- [[../roadmap]] §"Security hardening pass" — the roadmap entry (Keychain wording reconciled in §3.1).
- `orchestration/.conveyor/bus/a/001..003` — the bus-resolved seam decisions this spec synthesizes.
- `orchestration/chunks-todo/security-hardening/README.md` — the process-experiment record (light-direct draft vs this ceremony).
