# Plan: Chunk 02 — Per-install WS token via `Sec-WebSocket-Protocol` + thread-adoption caller-auth + timing-safe verify

## Status: Review-complete — BEHAVIORAL DEMO PENDING (not shipped, not merged)

- **Feature:** security-hardening
- **Chunk:** `orchestration/chunks-todo/security-hardening/02-ws-conn-token-subprotocol.md`
- **Spec:** `orchestration/docs/specs/2026-06-12-security-hardening.md` §3.2 / §3.3 / §3.6 / §3.8 / §4 (status: accepted)
- **ADR worthy:** no (executes accepted ADR-0003 p.5 + Amendment; discharges accepted ADR-0014 regret-(a) rider; authors no new contract)
- **Step tracker:** Step 1 ☑ · Step 2 ☑ · Step 3 ☑ · Review ☑

> **Review done (orchestrator-verified, two independent reviewers).** `engine-reviewer`: **reviewer-clean — 0 Critical / 0 Major**, 2 Minor (cosmetic `server.upgrade` line-format; optional explicit-403 WS assert). `security-review`: **0 Critical / 0 High**, 2 benign LOW (RFC-7230 OWS-trim on the subprotocol header — not exploitable; no re-chmod of a pre-existing token file — out of scope). Both reviewers independently re-ran gates + frozen diffs and **live-probed** adversarial cases (comma-list subprotocol `"token, junk"` → fail-closed; tokenless/empty/whitespace → 401; valid-token + evil-origin → 403 proving layer-2; tokenless client creates 0 thread rows → ADR-0014 T3 rider discharged). Minor items left as-is (cosmetic/optional, no behavioral impact). **Mechanical DoD #3-#8 GREEN; behavioral DoD #1/#2 gated on Lior §6.1 live demo → PR opened, NOT auto-merged.**

> **Step 3 done (orchestrator-verified, independent re-run):** 9 WS daemon test files + 2 scripts + overlay realio test present the token (object-form `{ headers: { Origin }, protocols: [token] }` — keeps layer-2 origin); adversarial thread-adoption tests (tokenless + bad-token both rejected pre-upgrade, no thread row created — ADR-0014 rider discharged at the connection gate); audit enumerates the ONLY 2 thread-write paths (WS `session_start`→`lifecycle.beginTurn`→`store.createThread`; HTTP Bearer-gated edit/forget). **Full suite 352 pass / 0 fail · typecheck 0 · lint:strict 0 · protocol diff EMPTY · mock reducer diff EMPTY · DoD #7 logs carry origin/reason not the token.** All mechanical DoD (#3-#8) GREEN. Behavioral DoD #1/#2 remain Lior §6.1 live demo.

> **Step 2 done (orchestrator-verified):** Rust `read_auth_token` command (`std::fs`, mirrors daemon dataDir resolution, NO new Cargo dep — Cargo.toml/lock byte-unchanged → no ADR); `WebSocketFactory` gains `protocols`; `ConnectionManager(factory, token)` passes `[token]` in `openSocket()` (re-presented on every reconnect + dismiss re-connect); `main.ts` boot-reads via `invoke`, array-form factory (DOM-lib correct), stale comment rewritten. typecheck 0 · lint:strict 0 · cargo check 0 · connection-manager.test.ts 20/20 · protocol diff EMPTY. (`realio.test.ts` got a placeholder `"STEP3-TOKEN"` to keep the branch compiling — Step 3 finalizes it.) Rust+WKWebView file-read at runtime = behavioral (DoD #1/#2), Lior §6.1.

> **Step 1 done (orchestrator-verified):** token-store timing-safe (`safeEqual` core + `verify`/`verifyToken`); daemon WS-upgrade gate (token layer-1 → origin layer-2, 401/403); `origin.ts` comment → layer-2. typecheck 0 · lint:strict 0 · protocol+mock diff EMPTY. **2 runtime findings (worker, verified):** (a) Bun 1.3.4 auto-echoes `Sec-WebSocket-Protocol` — manual header in `server.upgrade` causes close-1002, so the daemon relies on Bun's auto-echo (NOT a q#002 escalation — echo confirmed via raw-HTTP probe); (b) Bun `ws.protocol` buffer-aliasing → test reads `ws.protocol` in the `open` handler before any message. Expected: the 9 pre-existing WS test files (25 tests) now fail "no token" — repaired in Step 3.

**Goal:** Require the per-install token on the WS upgrade via the `Sec-WebSocket-Protocol` subprotocol (verify-before-`server.upgrade()` + echo on 101), make `TokenStore.verify` timing-safe, thread the token through the overlay's real WS factory + reconnect path (read Rust-side), and discharge the ADR-0014 thread-adoption rider at the connection gate — with the frozen 6-variant envelope byte-untouched.

**Goal-state:** Spec §3.2/§3.3/§3.6/§3.8; executes ADR-0003 p.5 + Amendment; discharges ADR-0014 regret-(a); closes gotcha #31.

---

## ⚠️ No blocker found — BLOCKER-RISK (q#002 subprotocol echo) resolved as fact-from-source

The bus q#002 hard rule: if Bun cannot echo the negotiated subprotocol on `server.upgrade()`, STOP and escalate (no silent query-param fallback). **Resolved: the echo IS supported by the installed bun-types 1.3.14** — `server.upgrade(req, { headers, data })` accepts a `headers?: HeadersInit` field on the upgrade options (`bun-types@1.3.14/.../serve.d.ts:923-967`, doc-comment line 957: "Send any additional headers while upgrading"). No escalation needed. Runtime confirmation (the WKWebView browser actually keeping the connection open when the daemon echoes the subprotocol) is a **behavioral DoD** (DoD #1/#2, Lior live macOS demo, §6.1).

No frozen-contract conflict (§7.2 citation test passes): the token rides the handshake header, never the wire envelope.

---

## Reality check

Each claim tagged **fact-from-source** (file:line) or **hypothesis-needing-runtime** (PIPELINE §6.1).

**1. The real overlay WS lives in the `WebSocketFactory`, not `session-client.ts`.** — **fact-from-source.**
- `apps/overlay/src/main.ts:27-35` — `const factory: WebSocketFactory = (url) => { const s = new WebSocket(url); ... }`. URL-only, no token today.
- `apps/overlay/src/ws/types.ts:17` — `export type WebSocketFactory = (url: string) => WebSocketLike;` — carries URL only.
- `apps/overlay/src/ws/connection-manager.ts:53-60` — `private openSocket() { const ws = this.factory(WS_URL); ... }` (line 54 is the factory call). Every reconnect funnels through `openSocket()`: `scheduleReconnect()` (77-80) → `openSocket()`, and `connect()` (48-51) → `openSocket()`. So **a token threaded into the factory is re-presented on EVERY reconnect**, not just first connect.
- `apps/overlay/src/ws/connection-manager.ts:134-141` — `runSession` rejects with `new Error("no connection")` when `this.ws === undefined`. **This forces the token-read-timing decision** (Approaches A): the token must be available synchronously at factory-call time, because `openSocket()` is synchronous and `connect()` is called at module load (`main.ts:41`, immediately after `new ConnectionManager(factory)` at `main.ts:40`).
- **Additional evidence (not in brief):** the overlay re-creates the manager + re-calls `connect()` in the `EV_TEXT_DISMISS` handler (`main.ts:189-190`). The token-provision mechanism must survive this second `connect()` too. A read-once-at-boot value (A1) satisfies this for free.

**2. The `main.ts:1-9` header comment FORBIDS a subprotocol token and is STALE.** — **fact-from-source.**
- `apps/overlay/src/main.ts:8` — `* No query-param / subprotocol token substitute (Lior threat-model, plan §D).` Contradicts spec §3.2 (subprotocol now chosen, Jimmy override Lior-confirmed). Must be rewritten to cite the spec.

**3. Rust side has NO fs capability; a new command must resolve dataDir exactly like the daemon and read `auth-token`.** — **fact-from-source** (code state) + **hypothesis-needing-runtime** (file actually read at runtime).
- `apps/overlay/src-tauri/src/lib.rs:10-13,40` — only `hide_panel` is a `#[tauri::command]`; `invoke_handler(tauri::generate_handler![hide_panel])`. Global-shortcut plugin is the only registered plugin. No fs plugin/read.
- `apps/overlay/src-tauri/Cargo.toml:20-24` — deps: `tauri`, `tauri-plugin-global-shortcut`, `serde`, `serde_json`. No `tauri-plugin-fs`.
- `apps/overlay/src-tauri/capabilities/default.json:5-15` — core + global-shortcut + window only. No `fs:*`.
- Daemon-side dataDir: `packages/daemon/src/index.ts:64` — `const dataDir = Bun.env.AGENTIC_DATA_DIR ?? join(homedir(), ".agentic-engine");`. The Rust command must mirror this.
- TokenStore file: `packages/daemon/src/memory/token-store.ts:17,22-23` — `TOKEN_FILENAME = "auth-token"`, path = `join(dataDir, "auth-token")`, minted lowercase-hex 32-byte (64 char), mode `0o600`.
- **hypothesis-needing-runtime:** that the Rust command, once built, reads the SAME file the daemon minted on a real macOS install (env-var parity, `$HOME` expansion, file existing because daemon booted first). Part of behavioral DoD #1.

**4. The daemon WS-upgrade ELSE branch is `index.ts:100-106`; `/memory/*` + `/history.html` dispatch above must NOT be touched.** — **fact-from-source.**
- `packages/daemon/src/index.ts:89-99` — the `if (url.pathname.startsWith("/memory/") || url.pathname === "/history.html")` block (DNS-rebinding Host-guard + `handleMemoryHttp`). Chunk 03's surface (Bearer). MUST NOT be edited by chunk 02.
- `packages/daemon/src/index.ts:100-106` — WS-upgrade path: origin gate (102), `server.upgrade(req, { data: { sessionIds: ... } })` (105), else `400` (106). Where token verification + subprotocol echo are added.

**5. `TokenStore.verify` is the SOLE comparison sink; making it timing-safe flows to the shipped `/memory/*` write-path tests.** — **fact-from-source.**
- `packages/daemon/src/memory/token-store.ts:47-52` — `verify(authHeader)` today: false if no header, requires `"Bearer "` prefix, then `authHeader.slice(7) === this.secret` (direct `===`, non-constant-time). Doc comment (8-9) parks timing-safety "for the hardening pass." Sole comparison.
- Shipped write path: `packages/daemon/src/memory/http-routes.ts:25,32-33` injects `TokenStore`; write routes (POST `/memory/edit`, `/memory/forget`) gate on `tokenStore.verify(...)`. Covered by `http-routes.daemon.test.ts:17-20` (tests 4-8). Timing-safe rewrite is transparent **as long as Bearer-prefix semantics are preserved** for HTTP, while the WS path compares the bare subprotocol value (no `"Bearer "`). See Approaches D.

**6. Scripts/tests that read the token file.** — **fact-from-source** (current state — all read NO token, rely on origin gate alone).
- `packages/daemon/scripts/test-client.ts:6` — `new WebSocket(..., { headers: { Origin: "tauri://localhost" } })`. No token. Add subprotocol (Bun client form `{ headers, protocols: [token] }`).
- `packages/daemon/scripts/memory-smoke.ts:24` — same, no token. Must read its mkdtemp `AGENTIC_DATA_DIR`'s `auth-token` after the daemon mints it.
- WS-connecting daemon tests (grep `new WebSocket(\`ws://`): **9 files** — `mock-agent.daemon.test.ts`, `multi-turn-per-socket.daemon.test.ts`, `dismiss-on-close.daemon.test.ts`, `daemon.test.ts` (incl. origin-reject tests), `memory/thread-adoption.daemon.test.ts`, `memory/memory-integration.daemon.test.ts`, `memory/write-gate-policy.daemon.test.ts`, `memory/provenance-stamp.daemon.test.ts`, `memory/distiller-integration.daemon.test.ts`. **DISCREPANCY FLAG (non-blocking):** `daemon.test.ts` does NOT match the `*.daemon.test.ts` glob; `http-routes.daemon.test.ts`/`hatch.daemon.test.ts` are `*.daemon.test.ts` but HTTP-only. The accurate set is 9 WS-connecting files, one (`daemon.test.ts`) not `*.daemon.test.ts`-named. Use the grep set, not the glob label.
- `apps/overlay/src/ws/connection-manager.realio.test.ts:34-42` — `realFactory` passes `{ headers: { Origin } }`. Add the token; update the lines 36-41 comment to mention it.

**7-A. Bun client both-gates mechanic (test/script clients) — `{ headers, protocols }`.** — **fact-from-source.**
- `bun-types@1.3.14/.../globals.d.ts:152` — `new (url, options?: Bun.WebSocketOptions): WebSocket;`; `:166` — `new (url, protocols?: string | string[]): WebSocket;`. Example (144-149) shows `{ protocols, headers }` together. A Bun client CAN pass both.
- **Type mechanic** (`globals.d.ts:11`): `WebSocket` resolves to lib.dom's (ONLY `(url, protocols?)`, NO `headers`) when DOM lib is loaded; to the Bun overload (with `headers`) when not.
  - Daemon package (`tsconfig.base.json:6` `lib: ["ESNext"]`, `types: ["bun"]`) — NO DOM → `{ headers, protocols }` typechecks.
  - Overlay app (`apps/overlay/tsconfig.json:6` `lib: ["ESNext","DOM","DOM.Iterable"]`) — DOM loaded → `headers` is a TYPE ERROR. The overlay factory can ONLY use `new WebSocket(url, [token])` (array form). The chunk's "naive browser-form rewrite drops Origin" warning is real.
  - **LOAD-BEARING typecheck subtlety (surfacing it):** `typecheck` = `tsc --noEmit -p tsconfig.json` (root). Root `tsconfig.json:3` includes `apps/overlay/src/ws/**/*.ts`, extends `tsconfig.base.json` (NO DOM, `types: ["bun"]`). So overlay `ws/` files (incl. `connection-manager.realio.test.ts`) are typechecked under the **Bun** lib, where `WebSocket` accepts `{ headers, protocols }`. BUT the real factory lives in `apps/overlay/src/main.ts` (NOT under `ws/`), excluded from root tsconfig (built only by Vite/Tauri). **Consequence:** the array-form constraint on the overlay factory is enforced by the Vite/Tauri build (DOM lib), not by `bun run typecheck`. The worker must NOT add `headers` to `main.ts`'s factory (would compile under the unchecked path but break the real WKWebView). The `realio.test.ts` factory IS under root typecheck (Bun lib) AND run by `bun test` — so it may use `{ headers, protocols }`. **These two factories diverge and that divergence is correct.**

**7-B. Daemon echo on `server.upgrade()` (the BLOCKER-risk).** — **fact-from-source (type support)** + **hypothesis-needing-runtime (browser keeps connection).**
- `bun-types@1.3.14/.../serve.d.ts:923-967` — `upgrade(request, options)` where (since `SocketData` is defined) `options: { headers?: HeadersInit; data: WebSocketData }`. Doc-comment 957: "Send any additional headers while upgrading, like cookies." So `server.upgrade(req, { headers: { "Sec-WebSocket-Protocol": token }, data: {...} })` typechecks. **Echo supported → no escalation.**
- **hypothesis-needing-runtime:** that the WKWebView accepts the 101 and keeps the socket open when the daemon echoes the negotiated subprotocol (RFC 6455). DoD #1/#2 (behavioral, live macOS demo). Per §6.1, "requires runtime demo to confirm," never "verified" from code.

**Token-read-timing decision (forced by item 1):** read once at boot, BEFORE `connect()` (Approaches A). **fact-from-source** that `connect()` is synchronous and called at `main.ts:41`; the chosen resolution keeps `connect()` synchronous.

---

## Approaches (decisions taken)

### A. Overlay token-read timing → read once at boot via async pre-fetch, THEN `connect()`
- **Chosen — A1: `await invoke("read_auth_token")` at top-level module init, store in a closure const, then construct the manager + `connect()`.** `main.ts` is an ES module; top-level await is available (ESNext). The factory closes over the resolved token const and uses `new WebSocket(WS_URL, [token])`. The factory stays synchronous (so `openSocket()`/`connect()` stay synchronous — `runSession`'s `this.ws === undefined` guard unaffected). Every reconnect re-uses the closed-over token automatically; the `EV_TEXT_DISMISS` re-`connect()` too.
  - *Why:* smallest change to the manager's contract; no async leakage into the synchronous lifecycle; reconnect re-presentation automatic. The token is install-stable (spec §2) so reading once is correct — no rotation in scope (spec §5, OUT).
- **Rejected — A2: make `connect()`/`openSocket()` async, fetch token per-open.** Ripples async through the synchronous lifecycle (`runSession` guard, `scheduleReconnect` timeout callback), enlarging surface + test churn, zero benefit on an install-stable secret.
  - ☆ Альтернатива: a token-PROVIDER callback `() => string` threaded into the factory — плюси: future-proofs rotation; мінуси: spec defers rotation (OUT); provider would still resolve to a boot-read value today → indirection with no current payoff.
- **Factory signature change:** `WebSocketFactory = (url) => WebSocketLike` → `(url, protocols?: string | string[]) => WebSocketLike` (`types.ts:17`). `ConnectionManager.openSocket()` calls `this.factory(WS_URL, [this.token])`; the manager takes the token as a ctor field. The DOM-free `WebSocketLike` interface is unchanged (no constructor — only `send`/`close`/`addEventListener`), so the seam stays unit-testable (the fake factory ignores the 2nd arg).

### B. Rust token read → minimal `#[tauri::command]` with `std::fs`, NOT the fs-plugin
- **Chosen — B1: a new `#[tauri::command] fn read_auth_token() -> Result<String, String>` in `lib.rs` resolving dataDir (`std::env::var("AGENTIC_DATA_DIR")` else `$HOME` + `.agentic-engine`) + `std::fs::read_to_string(dataDir.join("auth-token")).trim()`.** Registered in `generate_handler![hide_panel, read_auth_token]`. No new capability grant (a custom command is invokable by default once registered; capabilities gate plugin/core permissions, not your own commands).
  - *Why:* `tauri-plugin-fs` would add a Cargo dep + capability grant + JS `@tauri-apps/plugin-fs` dep — three new surfaces for one owner-only file read. The spec (§3.1) notes Tauri entitlement ceremony is to be avoided; same minimalism here. **`$HOME`:** Rust `std` has no `homedir()`; use `std::env::var("HOME")` (macOS always sets it) — do NOT add the `dirs` crate unless `HOME` proves unreliable (it won't on macOS). Keeps Cargo.toml unchanged → **no Rust-dep ADR.**
- **Rejected — B2: `tauri-plugin-fs` + capability grant.** New runtime dep (Cargo + JS), capability-scope ceremony, broader fs surface to the webview than a single hard-coded read.
  - ☆ Альтернатива: pass the token daemon→overlay over the socket — chicken-and-egg (the socket needs the token to open). File-read is the only bootstrap.
- **Watch-flag:** adding a Cargo runtime dependency WOULD be ADR-worthy. B1 avoids it. **If the worker reaches for `dirs` → STOP, flag to orchestrator (ADR check), do not add silently.**

### C. Bun client helpers present both gates without dropping Origin → `{ headers, protocols }`
- **Chosen — C1: daemon-side test/script clients use `new WebSocket(url, { headers: { Origin }, protocols: [token] })`.** Type-supported under the daemon's Bun lib (7-A). No shared cross-package helper introduced (each daemon test constructs inline today; keep that idiom — a cross-file helper risks frozen-surface-adjacent coupling). Each of the 9 WS test files + 2 scripts adds `protocols: [token]` to its existing `{ headers: { Origin } }`, reading `token` from its own `TokenStore`/file.
  - *Why:* a naive browser-form `[token]` rewrite drops `headers.Origin` and silently breaks the origin gate (daemon still runs the allowlist as layer 2, §3.3). The object form preserves both gates. The overlay `realio.test.ts` factory legitimately uses the object form (Bun runtime, root-typechecked under Bun lib — 7-A).
- **Token source in tests:** each daemon test boots `startDaemon(0)` with an mkdtemp `AGENTIC_DATA_DIR`; the daemon mints `auth-token` at boot (`index.ts:69`). Read via **`new TokenStore(dataDir).token()`** (canonical accessor — proves token/file parity through the same code the daemon uses).
- **Rejected — C2: a `wsConnect(url, {origin, token})` shared test-util.** Low value; a new shared module near the daemon test surface invites accidental coupling; the inline change is mechanical and local.

### D. Timing-safe verify → dual-path constant-time compare preserving HTTP Bearer semantics
- **Chosen — D1: rewrite `TokenStore.verify` to use a constant-time comparison (`crypto.timingSafeEqual` over equal-length buffers, with a length-guard that does not early-return on the secret value), KEEPING `"Bearer "` prefix handling for HTTP; add a SECOND method `verifyToken(raw: string | undefined | null): boolean` for the WS subprotocol path (bare token, no prefix), both routing through one private constant-time `safeEqual(candidate)` core.**
  - *Why:* the HTTP write path passes `Authorization: Bearer <token>` and is covered by shipped tests (`http-routes.daemon.test.ts` 4-8) — its prefix semantics must not change (DoD #5). The WS path compares the bare `Sec-WebSocket-Protocol` value (no `Bearer`). One private `safeEqual` keeps "one comparison sink" (spec §2) while exposing two thin transport-shaped wrappers. `Buffer.from(...)` + `crypto.timingSafeEqual` is Bun/Node-native (no new dep). Length-mismatch handled without a fast `===`-style early return (token length is fixed 64-hex and public-knowable; the value is what must be constant-time — standard accepted pattern).
  - *Why two methods, not "strip Bearer in the caller":* the WS upgrade branch has no `Authorization` header — the subprotocol arrives as `req.headers.get("sec-websocket-protocol")`. Forcing a synthetic `"Bearer "` prefix would be a lie at the call site. A dedicated `verifyToken` is honest and keeps the single core.
- **Rejected — D2: one `verify` that strips an optional `Bearer ` prefix.** Muddies the contract (callers wouldn't know whether to send a prefix) and risks accepting `verify(rawToken)` on the HTTP path where a missing prefix should fail.
  - ☆ Альтернатива: single `verify(authHeader)`, WS branch constructs `"Bearer " + protocolValue` — плюси: zero new method; мінуси: a synthetic prefix at the call site is a smell and couples the WS branch to the HTTP wire shape.

---

## ADR worthy: NO

This chunk **executes** accepted decisions and **discharges** accepted riders; it authors no new irreversible contract:
- The WS token is ADR-0003 p.5 + Amendment 2026-05-30 (`accepted`), un-deferred per spec §3.2 (`accepted`, Jimmy override Lior-confirmed). The Amendment already sanctioned "a query-param **or header** presented at the WebSocket handshake … outside the message envelope"; the subprotocol IS an HTTP handshake header (`Sec-WebSocket-Protocol`) → a **narrowing within** the accepted decision, not a new one.
- Timing-safe `verify` is spec §3.8 (`accepted`) — the code comment already parked it as "the hardening pass."
- Thread-adoption-at-the-connection-gate is the ADR-0014 regret-(a) rider (`accepted`), discharged with zero new wire fields (spec §3.6).
- Origin allowlist stays as layer 2 — ADR-0003 Amendment unchanged; only `origin.ts`'s comment updates.
- No new runtime dependency (B1 uses `std::fs`; D uses native `crypto`).

**Watch-flag:** IF Approach B1 forces a new Cargo runtime crate (e.g. `dirs`), STOP and route to `adr-curator` (new runtime dep = ADR). Expected: not needed.

---

## Steps

Three independently-testable, sequential steps. **Daemon-side (Step 1) is fully separable from overlay/Rust-side (Step 2);** Step 3 wires the remaining clients + adversarial/audit coverage. Per the Strike-4 discipline, every new daemon assertion uses a **real socket against the real `startDaemon`** — no mocked sockets where the socket is the point.

Branch: `chunk/02-ws-conn-token`. Commit per step with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Do not push to `main`; open a PR; the q#002 conductor-override + behavioral DoD #1/#2 mean **nothing merges before Lior's live macOS demo** (§5.2 / §6.1).

### Step 1 — Daemon: verify-before-upgrade + subprotocol echo + timing-safe verify + reject logging

**Files:**
- Modify: `packages/daemon/src/memory/token-store.ts` (timing-safe core + `verifyToken`)
- Modify: `packages/daemon/src/index.ts:100-106` (WS-upgrade ELSE branch ONLY — verify the subprotocol pre-`upgrade`, echo it on 101, log rejects without the credential). **Do NOT touch `index.ts:89-99` (the `/memory/*` + `/history.html` Host-guarded block — chunk 03's Bearer surface).**
- Modify: `packages/daemon/src/origin.ts` (header comment → "layer 2, not the only gate"; no logic change)
- Test: `packages/daemon/src/daemon.test.ts` (extend with token-gate cases — it already owns the origin reject/accept suite)

1. **Timing-safe `TokenStore` (TDD — test first).** Add: `verify("Bearer <correct>")` → true; `verify("Bearer <wrong-same-length>")` → false; `verify("Bearer <wrong-different-length>")` → false; `verify(undefined)` → false; `verifyToken("<correct>")` → true; `verifyToken("<wrong>")` → false; `verifyToken(undefined)` → false. Run, watch fail (`verifyToken` undefined).
2. **Implement** in `token-store.ts`: a private `safeEqual(candidate: string): boolean` using `crypto.timingSafeEqual`. Guard length WITHOUT a data-dependent fast path: `const a = Buffer.from(candidate); const b = Buffer.from(this.secret); if (a.length !== b.length) return false; return crypto.timingSafeEqual(a, b);`. Keep `verify(authHeader)`: false if falsy / no `"Bearer "` prefix, else `this.safeEqual(authHeader.slice(7))`. Add `verifyToken(raw)`: false if falsy, else `this.safeEqual(raw)`. Run unit tests → pass.
3. **Daemon WS-upgrade gate test (real socket).** Using `startDaemon(0)` with a known mkdtemp `AGENTIC_DATA_DIR` (mirror `thread-adoption.daemon.test.ts:17-24`), read the minted token via `new TokenStore(dataDir).token()`. Add:
   - **no token** → `new WebSocket(url, { headers: { Origin: TAURI_ORIGIN } })` → rejected (no `open`; `close`/`error`), like `daemon.test.ts:44-53`.
   - **wrong token** → `{ headers: { Origin }, protocols: ["deadbeef…wrong"] }` → rejected.
   - **valid token, browser-style client object** → `{ headers: { Origin }, protocols: [token] }` → `open` fires AND `ws.protocol === token` in the `open` handler (proves DoD #3 subprotocol-echo-on-101). Then a full session round-trip to prove the gated socket still works end-to-end.
   Run, watch fail (daemon does not yet require/echo the token).
4. **Implement the daemon gate** in `index.ts:100-106`. After the origin check (keep it), `const proto = req.headers.get("sec-websocket-protocol");`. If `!tokenStore.verifyToken(proto)` → `console.error("[daemon] WS upgrade rejected:", { origin: req.headers.get("origin"), reason: "bad-or-missing-token" })` (**never log `proto`/the token value** — DoD #7) and `return new Response("Unauthorized", { status: 401 })`. Else `server.upgrade(req, { data: { sessionIds: new Set<string>() }, headers: { "Sec-WebSocket-Protocol": proto } })` — echo the negotiated subprotocol (7-B). `tokenStore` is already constructed at `index.ts:69`, in scope in `startDaemon`. Run Step-1 tests → pass.
5. **Update `origin.ts` comment** (1-8): origin allowlist is now **layer 2** behind the per-install token (spec §3.3, ADR-0003 p.5 un-deferred); remove the "DEFERRED" / "close that gap" framing (the gap is now closed). No logic change.
6. **Run** `bun test packages/daemon` (the existing 9 WS tests will now FAIL — no token — expected, fixed in Step 3), `bun run typecheck`, `bun run lint:strict`. Confirm `git diff packages/protocol` empty (DoD #6). Commit: `feat(daemon): require per-install token on WS upgrade via Sec-WebSocket-Protocol + timing-safe verify`.

### Step 2 — Overlay + Rust: read the token, thread it through factory + reconnect, fix the stale comment

**Files:**
- Modify: `apps/overlay/src-tauri/src/lib.rs` (new `read_auth_token` command + register it)
- Modify: `apps/overlay/src/ws/types.ts:17` (`WebSocketFactory` gains optional `protocols`)
- Modify: `apps/overlay/src/ws/connection-manager.ts` (take `token`, pass `[token]` to the factory in `openSocket()`)
- Modify: `apps/overlay/src/main.ts` (boot-read token via `invoke`, pass to manager, array-form factory; rewrite stale 1-9 header comment)
- Modify: `apps/overlay/src/ws/connection-manager.test.ts` (fake-factory ctor passes a dummy token)

1. **Rust command.** In `lib.rs`, add `#[tauri::command] fn read_auth_token() -> Result<String, String>`: `let dir = std::env::var("AGENTIC_DATA_DIR").unwrap_or_else(|_| format!("{}/.agentic-engine", std::env::var("HOME")... ));` (handle the `HOME` error path), then `std::fs::read_to_string(Path::new(&dir).join("auth-token")).map(|s| s.trim().to_string()).map_err(|e| e.to_string())`. Register: `generate_handler![hide_panel, read_auth_token]`. No Cargo dep, no fs capability. **If `HOME` resolution proves insufficient → STOP, flag to orchestrator (no `dirs` crate without an ADR).**
2. **Factory signature.** `types.ts:17` → `export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;`. `WebSocketLike` unchanged.
3. **ConnectionManager.** Add `token` (ctor param `constructor(private readonly factory: WebSocketFactory, private readonly token: string, deps: ConnectionManagerDeps = {})`). In `openSocket()` (54): `const ws = this.factory(WS_URL, [this.token]);`. Re-presents on EVERY `openSocket()` → covers `connect()`, `scheduleReconnect()`, dismiss re-`connect()`. Update fake-socket unit tests (`connection-manager.test.ts`) ctor calls to pass a dummy token (`"test-token"`); the fake factory ignores the 2nd arg → behavior unchanged. Run `bun test apps/overlay/src/ws/connection-manager.test.ts` → pass.
4. **main.ts boot-read + factory.** Before constructing the manager: `const authToken = await invoke<string>("read_auth_token");` (top-level await, ESNext). Factory: `const factory: WebSocketFactory = (url, protocols) => { const s = new WebSocket(url, protocols); ... };` — **array/`protocols`-form only; do NOT add `headers`** (DOM lib forbids it at the WKWebView; 7-A). Construct `new ConnectionManager(factory, authToken)` at line 40 and in the `EV_TEXT_DISMISS` re-create (189) (pass `authToken` again — in module scope). Rewrite the stale header comment (1-9): replace line 8 with a note that the per-install token rides `Sec-WebSocket-Protocol` per spec §3.2 (ADR-0003 p.5 un-deferred); keep the WKWebView-sets-Origin notes (4-7, still true).
5. **Run** `bun run typecheck` (root — typechecks `apps/overlay/src/ws/**` under Bun lib; `main.ts` built by Vite/Tauri, not this gate), `bun run lint:strict`. Commit: `feat(overlay): present per-install token as WS subprotocol (read Rust-side, re-presented on reconnect)`. **Orchestrator note:** the Rust + WKWebView path is behavioral (DoD #1/#2) — typecheck/lint passing is necessary but NOT sufficient; requires Lior's live macOS demo.

### Step 3 — Wire all daemon clients to present the token; adversarial thread-adoption + audit; full green

**Files:**
- Modify: the **9 WS-connecting daemon test files** (grep set): `mock-agent.daemon.test.ts`, `multi-turn-per-socket.daemon.test.ts`, `dismiss-on-close.daemon.test.ts`, `daemon.test.ts`, `memory/thread-adoption.daemon.test.ts`, `memory/memory-integration.daemon.test.ts`, `memory/write-gate-policy.daemon.test.ts`, `memory/provenance-stamp.daemon.test.ts`, `memory/distiller-integration.daemon.test.ts`
- Modify: `packages/daemon/scripts/test-client.ts`, `packages/daemon/scripts/memory-smoke.ts`
- Modify: `apps/overlay/src/ws/connection-manager.realio.test.ts` (`realFactory` + the reconnect test's inline factory)
- Add: an adversarial + audit test (extend `memory/thread-adoption.daemon.test.ts` or `daemon.test.ts`)

1. **Token-present every WS client.** In each of the 9 daemon test files + 2 scripts: read the minted token via `new TokenStore(dataDir).token()` and change every `new WebSocket(url, { headers: { Origin } })` → `new WebSocket(url, { headers: { Origin }, protocols: [token] })` (C1 — keeps Origin AND adds token). For shared `beforeAll` boots, capture the token once into a module-level `let token` after `startDaemon`. For `memory-smoke.ts:24`, read `auth-token` from its mkdtemp dir after boot. For `connection-manager.realio.test.ts:34-42`, update `realFactory` to `{ headers: { Origin: "tauri://localhost" }, protocols: [token] }` and the inline factory in the reconnect test (~210) likewise; update the 36-41 comment. The realio token comes from the test's `AGENTIC_DATA_DIR` (`new TokenStore(dataDir).token()`).
2. **Run the full suite** `bun test` — all previously-failing WS tests now pass with the token. Fix stragglers.
3. **Adversarial thread-adoption test (DoD #4, real socket).** Add to `thread-adoption.daemon.test.ts`: a tokenless client (`{ headers: { Origin } }`, no `protocols`) AND a bad-token client each attempt `new WebSocket` → assert the upgrade is rejected (no `open`), so the client can NEVER send `session_start` / adopt a `thread_id`. Assert on disk (open the test's sqlite) that NO thread row was created by the rejected client. Proves the ADR-0014 rider is discharged at the connection gate.
4. **Audit assertion (DoD #4, PR body + a test/codepath check).** Enumerate that the ONLY thread-write entry points are: (a) `session_start` over the now-token-gated WS (`index.ts:137-169` via `lifecycle.beginTurn`), and (b) HTTP `POST /memory/edit|forget` (already Bearer-gated, `http-routes.ts`) — and HTTP reads (`GET /memory/*`) are chunk 03's surface. No other unauthenticated thread-write path. A grep-based assertion over `lifecycle.beginTurn` / `store.createThread` call sites is acceptable as the mechanical form.
5. **Verify DoD #5 transitively:** `bun test packages/daemon/src/memory/http-routes.daemon.test.ts` — the shipped `/memory/*` write-path tests (4-8) must stay green through the now-timing-safe `verify` (they pass `Bearer <token>`, exercising the preserved HTTP path).
6. **Final gates:** `bun test` (all green), `bun run typecheck` (exit 0), `bun run lint:strict` (exit 0), `git diff packages/protocol` empty + `git diff` shows `mock-agent.ts`/`mock-provider.ts` untouched (DoD #6). Confirm no rejected-auth log line contains a token value (DoD #7). Commit: `test(security): all WS clients present the token; adversarial thread-adoption + audit; suite green`. Open the PR (do NOT merge — q#002 override + behavioral DoD #1/#2 require Lior's live macOS demo at §6.1).

**Behavioral DoD reminder (NOT closeable by this plan — Lior live macOS demo, §6.1):**
- DoD #1: real overlay connects WITH the token (subprotocol); no/wrong-token client rejected pre-upgrade. **requires runtime demo to confirm.**
- DoD #2: kill+restart daemon → CM-02 backoff reconnect re-presents the token → next turn succeeds. **requires runtime demo to confirm.**

---

## Files

**Create:** (none — the Rust command is added inside the existing `apps/overlay/src-tauri/src/lib.rs`)

**Edit:**
- `packages/daemon/src/memory/token-store.ts` — timing-safe `safeEqual` core + `verifyToken` (Step 1)
- `packages/daemon/src/index.ts` — lines 100-106 ONLY (verify pre-upgrade + echo + reject log) (Step 1)
- `packages/daemon/src/origin.ts` — header comment → layer-2 (Step 1)
- `packages/daemon/src/daemon.test.ts` — token-gate reject/accept + subprotocol-echo tests (Step 1/3)
- `apps/overlay/src-tauri/src/lib.rs` — `read_auth_token` command + register (Step 2)
- `apps/overlay/src/ws/types.ts` — `WebSocketFactory` adds optional `protocols` (Step 2)
- `apps/overlay/src/ws/connection-manager.ts` — token field + `factory(WS_URL, [token])` in `openSocket()` (Step 2)
- `apps/overlay/src/main.ts` — boot-read token, array-form factory, manager ctor (×2 incl. dismiss re-create), rewrite stale 1-9 comment (Step 2)
- `apps/overlay/src/ws/connection-manager.test.ts` — fake-factory ctor passes dummy token (Step 2)
- `apps/overlay/src/ws/connection-manager.realio.test.ts` — `realFactory` + reconnect inline factory present token (Step 3)
- The 9 WS-connecting daemon test files + 2 scripts listed in Step 3 (Step 3)

**Must NOT touch (frozen / out-of-scope):**
- `packages/protocol/**` — the 6-variant envelope (DoD #6: `git diff packages/protocol` empty). Token rides the handshake, not the wire.
- `packages/daemon/src/**/mock-agent.ts`, `mock-provider.ts` — frozen mock reducer surfaces.
- `packages/daemon/src/index.ts:89-99` — the `/memory/*` + `/history.html` Host-guarded HTTP block (chunk 03's Bearer surface).
- `packages/daemon/src/memory/http-routes.ts` (write-path logic) — its `verify` call site is inherited unchanged; only `TokenStore`'s internals change. HTTP read-gating is chunk 03.
- ADR files — no edits; this chunk executes accepted ADR-0003 p.5 + discharges accepted ADR-0014 rider.

---

## Non-blocking flags (surfaced; none change scope)
1. **Test-glob vs grep-set discrepancy** (Reality check 6): the chunk says "all 9 WS-connecting `*.daemon.test.ts`" — accurate count (9) but `daemon.test.ts` is not `*.daemon.test.ts`-named, and `http-routes`/`hatch` `*.daemon.test.ts` are HTTP-only. Worker uses the grep set, not the glob.
2. **Two diverging factories are correct** (Reality check 7-A): the overlay `main.ts` factory MUST be array-form (DOM lib); the `realio.test.ts` factory may be object-form (Bun lib + runtime). Not a bug.
3. **Behavioral DoD #1/#2** are Lior's live §6.1 run — the chunk reaches mechanically-complete + reviewer-clean, then BLOCKS on the demo (same shape as chunk 01). The PR must NOT auto-merge until the demo signs off.
