# Walking Skeleton v0 — Chunk 02b-i: Tauri Overlay Shell + Global Hotkey + WS Transport (ECHO round-trip, NO widget) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every code step also requires superpowers:test-driven-development (red→green: write the failing test, run it, *see it fail*, implement, *see it pass*) for the pure-TS seam, and superpowers:verification-before-completion (real `bun test` + `bun run lint:strict` + `bun run typecheck` output shown BEFORE any "done" claim). Native/window/hotkey/permission behaviour is verified by a MANUAL macOS checklist (see Verification), not automated.
>
> **Git note (project rule):** workers write + test + verify; they do NOT `git commit`. Commits are Lior's to make manually (the permission layer declines `git commit`). Local commits only — NO push/amend/force/--no-verify. The commit blocks below are the messages Lior will use.

**Goal:** Stand up the FRONTEND track's first artifact — a Tauri v2 frameless/transparent overlay app under `apps/overlay/` with a global tap-hotkey, a centered Spotlight-style input panel, and a WS client that proves the ECHO round-trip (`session_start` → `session_ack` + `session_end`) against the FROZEN `@agentic/protocol` contract — with NO widget rendering. The riskiest unknown (the production WKWebView `Origin` header) is measured empirically as Step 1 before the done-criteria are finalized.

**Architecture:** Greenfield Tauri v2 app wired into the existing Bun + TS ESM workspace as `apps/overlay`. `src-tauri/` is the Rust shell (frameless transparent always-on-top window per ADR-0006; global-shortcut plugin registration; show/hide/focus commands). `src/` is the web renderer (Vite, vanilla TS): a centered input panel plus a WS client. The WS-client *logic* (envelope build, `parseEnvelope` dispatch, round-trip state machine) is factored into a DOM-free, dependency-injected seam so it is unit-testable under `bun test` WITHOUT a live window. The daemon (chunk 01) already performs the full ECHO round-trip and needs NO code change here except a TEMPORARY, reverted diagnostic log used only by the Origin spike. Per architecture.md + ADR-0003, the frontend contains zero LLM logic; the daemon owns zero UI rendering.

**Tech Stack:** Tauri v2 (Rust shell + system WKWebView), `tauri-plugin-global-shortcut` / `@tauri-apps/plugin-global-shortcut`, Vite + vanilla TypeScript renderer, browser-context `WebSocket` (renderer) with a DOM-free logic seam, `@agentic/protocol` (workspace, FROZEN), Bun `bun test` for the seam. No new daemon runtime dependency. No new root runtime dependency.

---

## Status: REVIEW-COMPLETE (autonomous) — pending only Lior's native macOS re-run + commits

Implementation + both review rounds done; **review gate satisfied (round 2 CLEAN, both NITs folded)**. All automated gates green. The only remaining work is Lior's, and is non-automatable here: (1) the native macOS manual checklist re-run (status now ends in `cancelled` — full loop, no widget), and (2) the git commits (project rule: commits are Lior's). See the manual checklist in `## Verification` and the commit messages in Steps 2.6/3.6/4.5 (note: the diff also includes the Step-6 fixes + NITs + the `02a` baseline-coupling reality correction — Lior may squash/group as he prefers).

### Execution log
- **Step 1 (spike):** DONE → **Branch A** (`tauri://localhost` prod / `http://localhost:1420` dev — both allowlisted). Spike log inserted (1.1) and reverted (1.6); `git diff packages/daemon` empty.
- **Step 2 (workspace + DOM-free WS seam, TDD):** DONE. 4 seam tests green; root `include` extended; vite pinned to `1420/strictPort`. (Type note: `SessionStart` derived as `Extract<Envelope,{type:"session_start"}>` to dodge a dual-symlink `TS2749`; not a redefinition.)
- **Step 3 (Tauri shell + hotkey):** DONE (code). Transparent/frameless `app.windows[]` + `macOSPrivateApi`; global-shortcut hand-wired (`tauri add` needs a Rust toolchain absent in the worker env) — `tauri-plugin-global-shortcut="2"` + 3 perms; hotkey `CommandOrControl+Shift+Space` via `.parse::<Shortcut>()` (FromStr; Modifiers fallback flagged). **Rust compile is Lior's native gate.**
- **Step 4 (renderer + echo round-trip):** DONE (code). Centered panel; real-`WebSocket` factory → seam `runEcho`; `invoke("hide_panel")` on submit/Esc; input refocus via pure DOM `window.focus` (no `core:event:*` perm). No Origin/token manipulation. README documents the manual macOS Accessibility grant.
- **Step 5 (verification):** automated parts GREEN — `bun test` 43 pass, root + app `typecheck` exit 0, `lint:strict` exit 0 (added `**/dist` + `**/src-tauri/target` to eslint ignores), `git diff packages/daemon` empty.
- **Review gate (round 1) 2026-05-31:** automated gates green; frozen-contract, CSWSH/Origin, scope, tsconfig-split, Tauri static config all CLEAN. **1 CRITICAL** (baseline drift — see below) + **1 MAJOR** (socket leak) + minors → **Step 6 fix**. Lior reproduced the CRITICAL live (panel hid on timeout, no `completed`, double-Enter possible).
- **Step 6 (review-fix, cancel-to-complete):** DONE (code). Seam auto-sends `tool_cancel` on inbound `tool_call` → resolves on `session_end{any reason}`; `finish()` closes the socket; single correlation source; tests rewritten (`bun test` **45 pass**); renderer pending-indicator + in-flight guard + success-hide-after-1200ms + failure-stays-open + guarded DOM lookups; README → `cancelled`. daemon+protocol diffs empty.
- **Review gate (round 2) 2026-05-31: ✅ CLEAN.** All round-1 findings RESOLVED (CRITICAL drift, MAJOR leak, both MINORs, both NITs). No regressions; frozen contract + scope intact; gates green. The suspected `fail()` timeout-leak was investigated and is a NON-issue (the timeout timer calls `ws.close()` directly, not via `fail()`; the only `fail()`-first path is the `error` event, which the UA closes per spec). **Review gate satisfied.** Two NEW NIT-level observations remain, both non-blocking: NIT-1 `fail()` lacks an idempotent `ws.close()` (pure symmetry); NIT-2 `window`-focus handler unconditionally resets `inFlight` (unreachable in v0's auto-hide flow, but a latch-clear footgun under a slow/dead daemon). → Lior chose fold-in. **Both NITs FOLDED 2026-05-31:** NIT-1 `fail()` now calls idempotent `ws.close()` (symmetry with `finish()`); NIT-2 the `window`-focus handler no longer touches `inFlight` (early-returns while in-flight) — the latch is owned solely by submit→settle, removing the mid-flight latch-clear footgun. Gates re-run green (`bun test` 45 pass, typecheck×2, lint:strict, daemon+protocol diffs empty). **Review gate fully satisfied; no open findings.**

### ⚠️ Branch-coupling correction + lesson (mandatory decompose-fix, Lior 2026-05-31)
- **`handleSessionStart` (`session.ts`) is DEAD CODE.** Chunk 02a (`e371e4a`) merged into `main` and replaced the live `session_start` path with `advanceMockAgent`. The 02b-i Reality-check (and brief) assumed the chunk-01 `[ack, end]` behavior — that assumption silently expired when 02a landed.
- **02a ∥ 02b-i were NOT truly decoupled.** They touched disjoint *files* (different dirs, zero shared code) and so looked parallel, but they shared a **daemon runtime-contract** — the reducer's `session_start` response. 02a legally changed *what the daemon replies* (within the frozen envelope), which invalidated 02b-i's reality-check. The frozen wire-contract held; the *behavioral* contract drifted.
- **LESSON (for future `/decompose-feature`):** "no coupling" must be checked against **shared daemon/runtime behavioral contracts**, not only file-touch overlap. Two chunks that both depend on the same daemon reducer are coupled even with zero shared source. When chunks run in parallel against a shared mutable runtime, re-validate the reality-check at integration time, not just at plan time.

---

**Q1 RESOLVED (Lior, 2026-05-30):** the v0 default tap-hotkey is **`CommandOrControl+Shift+Space`** (collision-safe vs Spotlight ⌘Space / input-source ⌃Space; cross-platform-portable; user-rebindable later). To be recorded as a dated note in ADR-0006 via `adr-curator` (see `## ADR`).

## ADR

- **ADR-0006** (`orchestration/docs/adr/0006-dual-hotkey-2zone-ux.md`) — `## Amendment 2026-05-30` LANDED: pins the v0 default tap-hotkey `CommandOrControl+Shift+Space` (touchpoint #1 of `## ADR worthy`, now resolved).
- **ADR-0003 branch-B amendment** — NOT triggered (conditional on the Step-1 spike landing on branch B with a new stable Origin value; see `## ADR worthy` #2). Route via `adr-curator` only if/when the spike reveals it.

---

**Origin spike RESOLVED → BRANCH A (Lior, 2026-05-31).** Lior ran the native spike: the production `tauri build` bundle's WKWebView sends `Origin: tauri://localhost` (dev sends `http://localhost:1420`). Both are ALREADY in chunk 01's allowlist → no ADR-0003 amendment, no stop-the-line. **DoD #5 is finalized under Branch A: the FULL prod round-trip is in the manual checklist** (echo proven against the built `.app`, not just `tauri dev`). The spike-first sequencing was LOCKED by Lior; the daemon `[spike]` diagnostic is reverted in Step 1.6.

---

## Reality check

Authoritative. Every claim driving this plan mapped to file evidence read this session. Where the brief and the repo agree, marked Confirmed; contradictions flagged.

| Claim driving the plan | Evidence (read this session) | Verdict |
|---|---|---|
| ~~The daemon answers `session_start` with `[session_ack, session_end{completed}]` via `handleSessionStart`~~ | originally cited `session.ts:11-17 handleSessionStart` | **❌ CORRECTED 2026-05-31 (review gate, baseline drift).** This was true at chunk-01 baseline but is now **DEAD CODE**. Chunk **02a (mock agent loop, commit `e371e4a`) merged into `main`** and re-routed the live path: `index.ts:55` → `advanceMockAgent` (`mock-agent.ts:99-116`) answers `session_start` with `[session_ack, tool_call{show_color_picker}]` and parks the session in `awaiting_pick` — **NO `session_end`** until a `tool_result` (→`completed`) or `tool_cancel` (→`cancelled`, `mock-agent.ts:120-137`). `handleSessionStart` is no longer wired. → drives the cancel-to-complete fix (Step 6) + the implicit-coupling lesson below. |
| The daemon needs NO code change for this chunk | `mock-agent.ts` + `index.ts` (live path) | **Confirmed (still true).** 02b-i adds only a client; `tool_cancel → session_end{cancelled}` already exists in the daemon. No daemon/protocol edit — the fix is client-side and within the frozen 6-variant envelope. |
| `isOriginAllowed(null) === false`; missing Origin rejected like a wrong one | `packages/daemon/src/origin.ts:15-17` (`origin !== null && ALLOWED_ORIGINS.has(origin)`); `daemon.test.ts:51-60` asserts "missing origin cannot connect" | **Confirmed.** Branch C (`null`) is therefore a hard reject by current code — STOP-THE-LINE, not a frontend fix. |
| Allowlist = `tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420` | `packages/daemon/src/origin.ts:9-13` | **Confirmed.** Pinned by ADR-0003 Amendment 2026-05-30. |
| `tauri dev` over Vite at `:1420` yields `Origin: http://localhost:1420` from a browser-context WS → matches allowlist → dev round-trip works for free | allowlist line 12 comment "`tauri dev` (Vite default)"; ADR-0003 Amendment | **Confirmed — CONDITIONAL on pinning Vite to 1420.** The generic Vite default is `5173`; `create-tauri-app`'s template pins 1420. The worker MUST keep/pin port 1420 in `vite.config.ts` or the dev origin will be `http://localhost:5173` and the allowlist rejects it. Made explicit in Step 2. |
| `packages/protocol` exports the 6-variant envelope + `parseEnvelope` (non-throwing) + `session_start`/`session_ack`/`session_end` shapes | `packages/protocol/src/envelope.ts:27-115`; `index.ts:58-60` re-exports | **Confirmed.** `parseEnvelope` returns `{kind:"ok"|"unknown"|"invalid"}`, never throws. |
| `session_start = {type, trigger, text?, client_session_id?}`; `trigger` CLOSED enum `["user","cron","external"]`; skeleton sends only `"user"` | `envelope.ts:10,27-32` | **Confirmed.** Client must send `trigger:"user"`; sending anything else parses `invalid` server-side. |
| `session_ack = {type, session_id, client_session_id?}` — THIS is how the client learns its `session_id` | `envelope.ts:36-40`; `session.ts:14` echoes `msg.client_session_id` | **Confirmed.** Client correlates by sending a `client_session_id` and matching the echoed value on `session_ack`. |
| `session_end = {type, session_id, reason}`; `reason` open/degradable | `envelope.ts:18-21,63-67` | **Confirmed.** Round-trip completes on `session_end{reason:"completed"}`. |
| Protocol import/export path for an ESM Vite/Tauri frontend | `packages/protocol/package.json` → `"main"`/`"exports"` = `./src/index.ts` (raw `.ts`, no build step), `"type":"module"` | **Confirmed WITH a caveat.** The package ships raw `.ts` via `exports`. Bun resolves `.ts` directly; **Vite/esbuild also transpiles `.ts` from a workspace dep**, so importing `@agentic/protocol` in the renderer works. The renderer must import only the Zod *types/schemas* (pure, no Node/Bun APIs) — confirmed: `envelope.ts`/`tools.ts`/`primitives.ts` import only `zod`. |
| `zod` is available to the renderer | root `package.json:13` declares `zod ^3.23.0`; protocol depends on it | **Confirmed.** `zod` is a runtime dep transitively pulled by `@agentic/protocol`; no NEW dep introduced by importing it in the renderer. |
| Root tsconfig facts: `lib:["ESNext"]`, `types:["bun"]`, no DOM lib | `tsconfig.base.json:6-7` | **Confirmed — LOAD-BEARING CONTRADICTION with a browser renderer.** `lib:["ESNext"]` has NO `DOM`. Renderer code using `window`, `document`, browser `WebSocket`, `HTMLElement` will NOT typecheck under the base config. The app needs its OWN tsconfig with `lib:["ESNext","DOM","DOM.Iterable"]` + Vite client types. Resolved in Step 2 / Technical design (two-tsconfig split). |
| Root `tsconfig.json` include = `packages/*/src/**` + `packages/*/scripts/**` only | `tsconfig.json:3` | **Confirmed — CONTRADICTION for coverage.** A new `apps/overlay` is NOT in the root typecheck program. The DOM-free seam must be typechecked by the *root* program (so `bun run typecheck` covers it under bun libs), and the DOM renderer typechecked by the *app's own* program. Resolved in Technical design. |
| Workspaces = `packages/*` only | root `package.json:5` | **Confirmed.** Adding `apps/overlay` requires extending root `workspaces` to `["packages/*","apps/*"]`. |
| Runner is `bun test`; scripts `test`/`lint`/`lint:strict`/`typecheck` exist | root `package.json:6-11` | **Confirmed.** `lint:strict` = `eslint . --max-warnings=0`; `typecheck` = `tsc --noEmit -p tsconfig.json`. |
| eslint flat config = `typescript-eslint` recommended, ignores `node_modules`/`dist`/`*.d.ts` | `eslint.config.js` | **Confirmed.** Rust files are not linted; `src-tauri/target` must be ignored (it is, via `dist`-style + we add `target`). `apps/overlay/src/**` `.ts` WILL be linted by `eslint .`. |
| Spike mechanics: log `req.headers.get("origin")` in the daemon `fetch` handler, before the allowlist check, reverted after | `packages/daemon/src/index.ts:22-24` is the exact insertion point (one line above `isOriginAllowed`) | **Confirmed.** A single `console.log` at line 23 is the least-invasive form; it does NOT alter allowlist logic or the wire contract. |
| Tauri v2 global-shortcut: npm `@tauri-apps/plugin-global-shortcut`, crate `tauri-plugin-global-shortcut`; `Builder::new().build()`; perms `global-shortcut:allow-register`/`allow-unregister`/`allow-is-registered`; JS `register(accel, cb)` | WebFetch `v2.tauri.app/plugin/global-shortcut/` this session | Confirmed at the API-shape level. Exact capability-file path and any v2 point-release identifier drift → **worker re-confirms against live docs at implementation time** (context7 / `v2.tauri.app`). |
| Tauri v2 transparency on macOS requires `app.macOSPrivateApi: true`; window keys `transparent`/`decorations`/`alwaysOnTop`/`skipTaskbar`/`visible`/`center`/`width`/`height`/`resizable` live under `app.windows[]` | WebFetch `v2.tauri.app/reference/config/` this session | Confirmed at the key-name level. **`macOSPrivateApi` ships unsigned/private-API binaries** — acceptable for a dev skeleton; note for later release. Worker re-confirms exact nesting against live docs if the schema drifted. |
| Tauri ADR alignment: 02b-i ↔ ADR-0006 (shell/hotkey/UX); only the TAP hotkey is in scope; hold-to-talk is Phase 4 | chunk file lines 63-64; ADR-0006 Decision p.1; roadmap Phase 4 | **Confirmed.** Hold-to-talk OUT. |

**Net contradictions surfaced (not in the brief, must be honored by the worker):**
1. **No DOM lib in base tsconfig** → app needs its own DOM-enabled tsconfig; the testable seam must be DOM-free to stay under the root bun-libs program.
2. **Root typecheck does not cover `apps/`** → split typecheck responsibility (seam in root program; renderer in app program; both must run green in the final verification step).
3. **Vite default port is 5173, not 1420** → worker MUST pin `vite.config.ts` to `port: 1420, strictPort: true` or the dev origin won't match the allowlist (the entire dev baseline depends on this).
4. **Branch C is already a hard reject by shipped code** (`isOriginAllowed(null) === false`) — confirming this is genuinely a stop-the-line, not a tweak.

---

## Requirements / scope

### In scope
- Tauri v2 scaffold under `apps/overlay/` wired into the Bun + TS ESM workspace (`workspaces` extended to include `apps/*`).
- Frameless, transparent, always-on-top, centered overlay window (ADR-0006 overlay; `decorations:false`, `transparent:true`, `app.macOSPrivateApi:true`).
- Global TAP-hotkey registration via `tauri-plugin-global-shortcut`; pressing it shows + focuses the centered input panel.
- Centered Spotlight-style input panel: captures typed text, Enter submits, panel hides after submit. Esc hides without submitting.
- WS client to `127.0.0.1:7777` from the renderer (browser-context `WebSocket`, so WKWebView sets the Origin) passing chunk 01's allowlist.
- ECHO round-trip: submit text → client emits `session_start{trigger:"user", text, client_session_id}` → daemon → client receives + validates (via `parseEnvelope`) `session_ack{session_id, client_session_id}` and `session_end{reason}` matching the sent `client_session_id`. The client LEARNS its `session_id` from `session_ack`. NO widget / color-picker rendering.
- DOM-free, unit-tested logic seam for the WS client (envelope build, `parseEnvelope` dispatch, correlation/round-trip state machine).
- The Origin spike (Step 1) + manual macOS verification checklist + green `bun test` + `typecheck` + `lint:strict`.
- Documentation of the macOS accessibility / global-shortcut permission grant as a MANUAL step (no onboarding flow).

### Out of scope (state; do not design)
- `color-picker` / ANY widget or primitive rendering — chunk 02b-ii.
- Hold-to-talk voice, mic capture, Whisper — Phase 4.
- Web admin tab — separate later chunk.
- Any coupling to chunk 02a (the mock agent loop) — both depend only on chunk 01; this chunk builds against the daemon's existing trivial round-trip.
- The per-install secret token (ADR-0003 deferred item) — release-driven, not built here.
- Hotkey-rebinding UI, settings persistence, tray icon, top-right widget zone — later chunks/phases.
- Any change to `packages/protocol` (FROZEN) or to the allowlist logic in `origin.ts` (branch B routes through an ADR amendment, NOT a silent edit).

---

## Technical design

### A. Workspace wiring
- Extend root `package.json` `workspaces` to `["packages/*", "apps/*"]`.
- `apps/overlay/package.json` (`@agentic/overlay`, `"type":"module"`, private) depends on `@agentic/protocol: "workspace:*"`, devDepends on `vite`, `@tauri-apps/cli`, `@tauri-apps/api`, `@tauri-apps/plugin-global-shortcut`. **All Tauri/Vite packages are DEV dependencies of the app** (build tooling), so no root-runtime-dep ADR is triggered. `@agentic/protocol` is a workspace runtime dep but introduces no NEW external package (it only re-exposes `zod`, already sanctioned by ADR-0005). Run `bun install` to link.

### B. tsconfig split (resolves Reality-check contradictions 1 & 2)
- `apps/overlay/tsconfig.json` (the app's own, NOT extending the bun base for libs): `compilerOptions` with `target:"ESNext"`, `module:"ESNext"`, `moduleResolution:"bundler"`, `lib:["ESNext","DOM","DOM.Iterable"]`, `types:["vite/client"]`, `strict:true`, `verbatimModuleSyntax:true`, `noEmit:true`. `include:["src/**/*.ts"]`. This is what the app's own `typecheck` uses (renderer code, DOM globals).
- The **DOM-free seam** lives at `apps/overlay/src/ws/` and is written to compile under BOTH lib sets (it imports only `@agentic/protocol` + a hand-rolled minimal `WebSocketLike` interface — no `window`/`document`/global `WebSocket`). The root `tsconfig.json` `include` is extended to add `"apps/overlay/src/ws/**/*.ts"` and `"apps/overlay/src/ws/**/*.test.ts"` so `bun run typecheck` (root, bun libs) covers the seam, and `bun test` (root) runs its tests. Renderer/DOM files stay OUT of the root include.
- Final verification runs THREE programs: root `bun run typecheck` (covers packages + seam) AND `apps/overlay` typecheck (`tsc --noEmit -p apps/overlay/tsconfig.json`, covers DOM renderer) AND `bun run lint:strict` (lints all `.ts` including app). Add an `apps/overlay` script `"typecheck": "tsc --noEmit -p tsconfig.json"` and call it from the verification step.

### C. The testable seam (`apps/overlay/src/ws/`) — DOM-free, the heart of the unit tests
- `apps/overlay/src/ws/types.ts` — a minimal transport interface so the seam never touches the global `WebSocket`:
  ```ts
  export interface WebSocketLike {
    send(data: string): void;
    close(): void;
    addEventListener(type: "open" | "message" | "close" | "error", cb: (ev: { data?: unknown }) => void): void;
  }
  export type WebSocketFactory = (url: string) => WebSocketLike;
  ```
- `apps/overlay/src/ws/session-client.ts` — pure round-trip state machine. Responsibilities:
  - `buildSessionStart(text: string): { msg: SessionStart; clientSessionId: string }` — constructs `{ type:"session_start", trigger:"user", text, client_session_id }` with a freshly minted `client_session_id` (`crypto.randomUUID()` — web-standard, available in both Bun and WKWebView; ADR-0004 discipline).
  - `handleInbound(raw: unknown)` — runs `parseEnvelope`; on `kind:"ok"` dispatches by `message.type` (`session_ack` → record `session_id`, assert `client_session_id` matches the in-flight one; `session_end` → resolve the round-trip with `{ sessionId, reason }`); on `kind:"unknown"|"invalid"` records a non-fatal diagnostic and does NOT throw (mirrors the daemon's non-throwing discipline; gotcha #9).
  - `runEcho(text, factory: WebSocketFactory): Promise<{ sessionId: string; reason: string }>` — opens via the injected factory, sends on `open`, drives `handleInbound` on each `message`, resolves on `session_end`, rejects on transport `error`/`close`-before-end or a timeout. Correlation strictly via the echoed `client_session_id`.
  - It IMPORTS the type-only `SessionStart`/`Envelope` from `@agentic/protocol` and the runtime `parseEnvelope`. It does NOT redefine any shape (FROZEN-contract rule).
- This seam is what the unit tests exercise with a fake `WebSocketFactory` — no Tauri, no window, no real socket.

### D. The renderer (`apps/overlay/src/`) — DOM, thin, delegates to the seam
- `apps/overlay/src/main.ts` — wires the panel DOM + a real-`WebSocket`-backed `WebSocketFactory` into the seam. The factory wraps the browser `WebSocket` to the `WebSocketLike` shape: `new WebSocket("ws://127.0.0.1:7777")`. **Crucially, JS CANNOT and MUST NOT attempt to set `Origin`** — WKWebView (the user-agent) sets it. There is NO query-param/subprotocol token substitute (per Lior's threat-model clarification: equally spoofable, not a CSWSH defense). The renderer just opens the socket; the Origin is whatever the spike (Step 1) revealed.
- `apps/overlay/src/main.ts` also: on `submit`, calls `runEcho(text, factory)`, logs the validated `{sessionId, reason}` to the panel (a single status line — NOT a widget), then hides the window via a Tauri command. On Esc, hides without submitting.
- `apps/overlay/index.html` + `apps/overlay/src/panel.css` — centered input (Spotlight-style), transparent body background so the window transparency shows. Minimal, distinctive but unstyled-heavy is fine; this chunk proves transport, not polish.
- The renderer listens for the global-shortcut event to show/focus. Two valid wirings (worker picks per live-docs ergonomics): (a) register the shortcut in Rust and `emit` an event the renderer listens to via `@tauri-apps/api/event`; OR (b) register via the JS `register()` API and show the window in the JS callback. **Recommendation: register in Rust** (`src-tauri/src/lib.rs`) so the hotkey works even before the webview finishes booting, and have Rust show+focus the window directly. The JS path is the fallback if Rust-side window-show proves fiddly under live docs.

### E. The Rust shell (`apps/overlay/src-tauri/`)
- `tauri.conf.json`: `app.macOSPrivateApi: true`; one window in `app.windows[]` with `transparent:true`, `decorations:false`, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, `center:true`, `visible:false` (start hidden; the hotkey reveals it), a fixed `width`/`height` (e.g. 600×120). `build.devUrl:"http://localhost:1420"`, `build.frontendDist:"../dist"`, `build.beforeDevCommand`/`beforeBuildCommand` wired to the app's Vite scripts. **Worker re-confirms the exact key nesting against live `v2.tauri.app/reference/config/` at implementation time** — these key NAMES were WebFetch-verified this session but the schema can drift between point releases.
- `src-tauri/Cargo.toml`: add `tauri-plugin-global-shortcut` (per live docs, `cargo add tauri-plugin-global-shortcut --target 'cfg(...)'`).
- `src-tauri/src/lib.rs`: `tauri::Builder` registers `tauri_plugin_global_shortcut::Builder::new()...build()` with a handler that, on the configured accelerator (TAP, `ShortcutState::Pressed`), shows + sets-focus on the main window. Plus a `#[tauri::command] fn hide_panel(window)` the renderer calls after submit/Esc.
- `src-tauri/capabilities/default.json`: permissions include `global-shortcut:allow-register`, `global-shortcut:allow-unregister`, `global-shortcut:allow-is-registered`, plus core window `allow-show`/`allow-hide`/`allow-set-focus` as the live docs require. **Worker re-confirms exact permission identifiers against live docs.**

### F. Where the spike lives and how it is reverted
- The spike touches `packages/daemon/src/index.ts` ONLY, with a single TEMPORARY line inserted at line 23 (immediately before the `isOriginAllowed` check):
  ```ts
  console.log("[spike] inbound Origin:", req.headers.get("origin")); // TEMP — REVERT before chunk done (02b-i Step 1)
  ```
  It does NOT alter the allowlist logic, the upgrade flow, or the wire contract. It is reverted (line deleted) in Step 1's final sub-step, and the final verification (Step 5) asserts `git diff packages/daemon` is empty. No daemon test changes.

### File structure (repo-relative)
- Create: `apps/overlay/package.json`
- Create: `apps/overlay/tsconfig.json`
- Create: `apps/overlay/vite.config.ts` (pins `server.port:1420`, `server.strictPort:true`)
- Create: `apps/overlay/index.html`
- Create: `apps/overlay/src/panel.css`
- Create: `apps/overlay/src/main.ts` (DOM + factory + panel wiring)
- Create: `apps/overlay/src/ws/types.ts` (DOM-free transport interface)
- Create: `apps/overlay/src/ws/session-client.ts` (DOM-free round-trip seam)
- Test: `apps/overlay/src/ws/session-client.test.ts` (`bun test`, fake factory)
- Create: `apps/overlay/src-tauri/Cargo.toml`, `apps/overlay/src-tauri/tauri.conf.json`, `apps/overlay/src-tauri/build.rs`, `apps/overlay/src-tauri/src/main.rs`, `apps/overlay/src-tauri/src/lib.rs`, `apps/overlay/src-tauri/capabilities/default.json`
- Modify: root `package.json` (`workspaces` += `apps/*`)
- Modify: root `tsconfig.json` (`include` += `apps/overlay/src/ws/**/*.ts`)
- Modify: `.gitignore` (add `apps/overlay/src-tauri/target`, `apps/overlay/dist`)
- Temporarily modify then REVERT: `packages/daemon/src/index.ts` (spike log only)
- Create (docs, worker-authored): `apps/overlay/README.md` — the manual macOS permission-grant + run steps.

---

## Steps

> Step 1 is the LOCKED spike-first move. Steps 2–4 build the app. Step 5 is verification + revert + branch resolution. The native done-criteria (#5) finalize per the A/B/C branch the spike reveals in Step 1.

### Step 1: Origin spike — measure the real WKWebView Origin (dev + prod), then branch

**Files:** Temporarily modify `packages/daemon/src/index.ts` (one log line, line 23); produce a minimal scaffold sufficient to `tauri build` (this step intentionally overlaps the first ~30% of the chunk — the scaffold here is reused by Steps 2–4, not throwaway).

- [ ] **1.1 — Insert the temporary diagnostic.** Add at `packages/daemon/src/index.ts` line 23 (immediately before `if (!isOriginAllowed(...))`):
  ```ts
  console.log("[spike] inbound Origin:", req.headers.get("origin")); // TEMP — REVERT (02b-i Step 1)
  ```
  Do NOT change the allowlist check, the upgrade, or anything else. Confirm `bun test` still 30/30 green (the log is harmless).

- [ ] **1.2 — Minimal Tauri scaffold sufficient to build.** Scaffold `apps/overlay` (Vite vanilla-TS frontend + `src-tauri`) — confirm Tauri v2 scaffolding against live `v2.tauri.app/start/` docs. Pin `vite.config.ts` to `server.port:1420, strictPort:true`. The renderer for THIS step only needs to open a WS to `ws://127.0.0.1:7777` on load and send one `session_start{trigger:"user", text:"spike", client_session_id:<uuid>}`. (This scaffold becomes the real app in Steps 2–4 — keep it.)

- [ ] **1.3 — Observe the DEV origin.** Terminal A: `cd packages/daemon && bun run dev`. Terminal B: `cd apps/overlay && bun run tauri dev`. When the webview loads and opens its socket, read the daemon's `[spike] inbound Origin:` line. **Expected: `http://localhost:1420`** (matches allowlist → dev round-trip works). Record the exact observed string in the worker report.

- [ ] **1.4 — Observe the PROD origin.** Build a production bundle: `cd apps/overlay && bun run tauri build` (debug profile is fine; the goal is a real packaged WKWebview, not `tauri dev`). Launch the built `.app`, keep `packages/daemon` running, observe the `[spike] inbound Origin:` line emitted by the production webview's socket. **Record the EXACT observed string.** This is the load-bearing measurement.

- [x] **1.5 — Resolve the branch. → BRANCH A (Lior, 2026-05-31).** Observed: dev origin `http://localhost:1420`, prod (`tauri build` `.app`) origin `tauri://localhost` — both already in `ALLOWED_ORIGINS`. DoD #5 = FULL prod round-trip (Step 5 manual checklist includes the built `.app`). No ADR action; no stop-the-line. (Branches B/C did not occur; kept below for the record.)
  - **Branch A — prod Origin is `tauri://localhost`** (already in `ALLOWED_ORIGINS`): proceed; DoD #5 becomes a FULL prod round-trip (Step 5 manual checklist includes the built `.app`). No ADR action.
  - **Branch B — prod Origin is a DIFFERENT but STABLE value.** If it is `http://tauri.localhost`, it is ALREADY allowlisted → treat like Branch A. If it is some OTHER stable value (e.g. a versioned scheme), DO NOT edit `origin.ts` silently. This is an **ADR-0003 amendment** (the allowlist was pinned by Lior at the chunk-01 grilling gate, under ADR-0003's 2026-05-30 Amendment): set `## ADR worthy` to route via `adr-curator` with the observed value + rationale ("additive, still origin-based, CSWSH not weakened"), get Jimmy sign-off, THEN add the value. It is NOT a protocol/wire-contract stop-the-line (the allowlist is daemon implementation, not `packages/protocol`). DoD #5 prod gate becomes "achievable after the amendment lands."
  - **Branch C — prod Origin is `null` / omitted.** **STOP-THE-LINE to Jimmy.** Set `## Status: BLOCKED — stop-the-line` at the top with the observed result. Do NOT weaken the allowlist (`isOriginAllowed(null)` returning `false` is correct and intentional). Candidate fixes are OUT OF SCOPE for this chunk and Jimmy's to choose: (i) a Rust-side WS proxy/client that sets a header; (ii) accelerate the deferred per-install token (ADR-0003 p.5); (iii) document the skeleton as DEV-validated with prod as a tracked follow-up. In branch C the achievable DoD is the DEV round-trip only; the prod round-trip is explicitly deferred pending Jimmy's decision.

- [ ] **1.6 — Revert the diagnostic.** Delete the `[spike]` log line from `packages/daemon/src/index.ts`. Confirm `git diff packages/daemon` is EMPTY. Confirm `bun test` 30/30 green again. (The contract and allowlist logic were never touched.)

### Step 2: Workspace wiring, tsconfig split, and the DOM-free WS seam (TDD)

**Files:** Modify root `package.json`, root `tsconfig.json`, `.gitignore`; create `apps/overlay/tsconfig.json`, `apps/overlay/vite.config.ts`, `apps/overlay/src/ws/types.ts`, `apps/overlay/src/ws/session-client.ts`; Test: `apps/overlay/src/ws/session-client.test.ts`.

- [ ] **2.1 — Wire the workspace.** Root `package.json`: `"workspaces": ["packages/*", "apps/*"]`. Root `tsconfig.json` `include` += `"apps/overlay/src/ws/**/*.ts"`. `.gitignore` += `apps/overlay/src-tauri/target` and `apps/overlay/dist`. Add `apps/overlay/package.json` `"scripts": { "typecheck": "tsc --noEmit -p tsconfig.json", "dev": "vite", "build": "vite build", "tauri": "tauri" }`. Create `apps/overlay/tsconfig.json` with `lib:["ESNext","DOM","DOM.Iterable"]`, `types:["vite/client"]`, `strict`, `verbatimModuleSyntax`, `noEmit`, `include:["src/**/*.ts"]`. Create `apps/overlay/vite.config.ts` pinning `server:{ port:1420, strictPort:true }`. Run `bun install`.

- [ ] **2.2 — Write the failing seam test.** `apps/overlay/src/ws/session-client.test.ts`:
  ```ts
  import { test, expect } from "bun:test";
  import { parseEnvelope } from "@agentic/protocol";
  import { buildSessionStart, runEcho } from "./session-client.js";
  import type { WebSocketLike } from "./types.js";

  // A scriptable fake transport: captures sends, lets the test drive inbound frames.
  function makeFake() {
    const listeners: Record<string, ((ev: { data?: unknown }) => void)[]> = {};
    const sent: string[] = [];
    const ws: WebSocketLike = {
      send: (d) => { sent.push(d); },
      close: () => {},
      addEventListener: (t, cb) => { (listeners[t] ??= []).push(cb); },
    };
    const fire = (t: string, ev: { data?: unknown }) => (listeners[t] ?? []).forEach((cb) => cb(ev));
    return { ws, sent, fire };
  }

  test("buildSessionStart produces a valid frozen-contract session_start (trigger:user)", () => {
    const { msg } = buildSessionStart("hello");
    const parsed = parseEnvelope(msg);
    expect(parsed.kind).toBe("ok");
    expect(msg.type).toBe("session_start");
    expect(msg.trigger).toBe("user");
    expect(msg.text).toBe("hello");
    expect(typeof msg.client_session_id).toBe("string");
  });

  test("runEcho resolves with the daemon-minted sessionId + reason on a correlated round-trip", async () => {
    const fake = makeFake();
    const p = runEcho("hi", () => fake.ws);
    // open → client sends session_start
    fake.fire("open", {});
    const sent = JSON.parse(fake.sent[0]!);
    const cid = sent.client_session_id as string;
    // daemon replies ack (echoes cid, mints id) then end
    fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "srv-1", client_session_id: cid }) });
    fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "srv-1", reason: "completed" }) });
    await expect(p).resolves.toEqual({ sessionId: "srv-1", reason: "completed" });
  });

  test("runEcho ignores an ack whose client_session_id does NOT correlate (no false resolve)", async () => {
    const fake = makeFake();
    const p = runEcho("hi", () => fake.ws);
    fake.fire("open", {});
    fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "x", client_session_id: "WRONG" }) });
    // No session_end for our cid → must reject on timeout, never resolve on the wrong ack.
    await expect(p).rejects.toThrow();
  }, 3000);

  test("handleInbound never throws on unknown/invalid frames (gotcha #9 discipline)", async () => {
    const fake = makeFake();
    const p = runEcho("hi", () => fake.ws);
    fake.fire("open", {});
    expect(() => fake.fire("message", { data: "not-json" })).not.toThrow();
    expect(() => fake.fire("message", { data: JSON.stringify({ type: "telepathy" }) })).not.toThrow();
    const sent = JSON.parse(fake.sent[0]!);
    fake.fire("message", { data: JSON.stringify({ type: "session_ack", session_id: "s", client_session_id: sent.client_session_id }) });
    fake.fire("message", { data: JSON.stringify({ type: "session_end", session_id: "s", reason: "completed" }) });
    await expect(p).resolves.toEqual({ sessionId: "s", reason: "completed" });
  });
  ```
  Use a short internal timeout in `runEcho` (e.g. 2000ms) so the no-correlation test rejects deterministically.

- [ ] **2.3 — Run it, see it fail.** `bun test apps/overlay/src/ws/session-client.test.ts` → FAIL (cannot resolve `./session-client.js` / `./types.js`).

- [ ] **2.4 — Implement `types.ts` and `session-client.ts`.** Create `apps/overlay/src/ws/types.ts` (the `WebSocketLike`/`WebSocketFactory` interfaces from Technical design §C). Create `apps/overlay/src/ws/session-client.ts`:
  - `buildSessionStart(text)` returns `{ msg: { type:"session_start", trigger:"user", text, client_session_id }, clientSessionId }` using `crypto.randomUUID()`. Type the `msg` as the frozen `SessionStart` (type-only import from `@agentic/protocol`); do NOT redefine the shape.
  - `runEcho(text, factory)` opens via `factory("ws://127.0.0.1:7777")`, on `open` sends `JSON.stringify(msg)`, on each `message` calls an internal `handleInbound` that runs `parseEnvelope`, dispatches `session_ack` (record `session_id` only if `client_session_id` matches the in-flight one — else ignore) and `session_end` (resolve `{ sessionId, reason }` only if it carries the recorded matching `session_id`), and on `kind:"unknown"|"invalid"` does nothing but a `console.warn` (never throws). Reject on transport `error`, on `close` before `session_end`, or on the internal timeout.
  - Import `parseEnvelope` (runtime) + type-only `Envelope`/`SessionStart` from `@agentic/protocol`. NO local shape redefinition (FROZEN-contract rule). If you discover the protocol is genuinely missing a variant you need (it is not — `session_start`/`session_ack`/`session_end` all exist), STOP and set `## Status: BLOCKED — stop-the-line`.

- [ ] **2.5 — Run it, see it pass.** `bun test apps/overlay/src/ws/session-client.test.ts` → all green. Then `bun run typecheck` (root — now covers the seam under bun libs) → green.

- [ ] **2.6 — Commit (Lior).** `git add package.json tsconfig.json .gitignore apps/overlay` → `git commit -m "feat(overlay): workspace wiring + DOM-free WS round-trip seam (bun-tested)"`.

### Step 3: Tauri shell — frameless transparent window + global tap-hotkey

**Files:** Create `apps/overlay/src-tauri/{Cargo.toml, build.rs, tauri.conf.json, src/main.rs, src/lib.rs, capabilities/default.json}`. **Worker re-confirms all exact Tauri v2 identifiers (config key nesting, capability permission strings, plugin builder API, `ShortcutState`) against live `v2.tauri.app` docs at implementation time — the names below were WebFetch-verified this session but treat them as to-be-confirmed if the schema drifted.**

- [ ] **3.1 — `tauri.conf.json`.** `app.macOSPrivateApi:true`. One window in `app.windows[]`: `transparent:true`, `decorations:false`, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, `center:true`, `visible:false`, `width:600`, `height:120`, `label:"main"`. `build.devUrl:"http://localhost:1420"`, `build.frontendDist:"../dist"`, `build.beforeDevCommand:"bun run dev"`, `build.beforeBuildCommand:"bun run build"`.

- [ ] **3.2 — `Cargo.toml`.** Add `tauri` (v2) + `tauri-plugin-global-shortcut` per live docs.

- [ ] **3.3 — `capabilities/default.json`.** Permissions: `global-shortcut:allow-register`, `global-shortcut:allow-unregister`, `global-shortcut:allow-is-registered`, plus core-window show/hide/set-focus permissions the version requires. Window target `"main"`.

- [ ] **3.4 — `src/lib.rs` + `src/main.rs`.** `tauri::Builder::default()` registers `tauri_plugin_global_shortcut::Builder::new().with_shortcut(<accel>)?.with_handler(|app, _sc, event| { if event.state() == ShortcutState::Pressed { show + set_focus on the "main" window } }).build()`. Add `#[tauri::command] fn hide_panel(window: tauri::Window) { let _ = window.hide(); }` and register it in `invoke_handler`. `<accel>` = **`CommandOrControl+Shift+Space`** (Q1, resolved by Lior — the v0 default; user-rebindable later, rebinding UI out of scope).

- [ ] **3.5 — Manual smoke (no automated test for native).** `cd packages/daemon && bun run dev` (terminal A), `cd apps/overlay && bun run tauri dev` (terminal B). Grant the macOS Accessibility permission when prompted (System Settings → Privacy & Security → Accessibility → enable the app/terminal — document exact path in `apps/overlay/README.md`). Press the hotkey → the transparent frameless centered panel appears + focuses. Esc/`hide_panel` → it hides. Record observations.

- [ ] **3.6 — Commit (Lior).** `git add apps/overlay/src-tauri` → `git commit -m "feat(overlay): Tauri v2 frameless transparent shell + global tap-hotkey"`.

### Step 4: Renderer — input panel + real WS factory wired to the seam (ECHO round-trip)

**Files:** Create `apps/overlay/index.html`, `apps/overlay/src/panel.css`, `apps/overlay/src/main.ts`, `apps/overlay/README.md`.

- [ ] **4.1 — `index.html` + `panel.css`.** Transparent `body` background; a centered single-line text input (Spotlight-style) + a one-line status area for the validated round-trip result (NOT a widget). Autofocus the input.

- [ ] **4.2 — `src/main.ts`.** Build a real-`WebSocket` `WebSocketFactory`: `(url) => { const s = new WebSocket(url); return { send:(d)=>s.send(d), close:()=>s.close(), addEventListener:(t,cb)=>s.addEventListener(t, (e:any)=>cb({data:(e as MessageEvent).data})) }; }`. **Do NOT set or attempt to set `Origin`, and do NOT add any query-param/subprotocol token** — WKWebView sets the Origin; a token does not substitute for it (Lior threat-model). On input `Enter`: read text, call `runEcho(text, factory)`, render the resolved `{sessionId, reason}` to the status line, then call the Tauri `hide_panel` command (`import { invoke } from "@tauri-apps/api/core"`). On `Escape`: `invoke("hide_panel")` without submitting. Wire the show/focus on hotkey (Rust-side per Step 3; the renderer just needs to clear+focus the input on `window` focus/show — use `@tauri-apps/api/event` or window focus listener).

- [ ] **4.3 — `apps/overlay/README.md`.** Document: prerequisites (Rust toolchain, Bun), the macOS Accessibility/global-shortcut MANUAL grant (exact System Settings path), the configured hotkey, `bun run tauri dev` and `bun run tauri build` commands, and the dev-vs-prod Origin note (referencing the Step 1 spike outcome). No onboarding flow — manual steps only.

- [ ] **4.4 — Manual ECHO round-trip smoke.** Daemon running. `bun run tauri dev`. Hotkey → panel → type "hello" → Enter. Confirm the status line shows a `sessionId` (a UUID minted by the daemon, learned from `session_ack`) and `reason: "completed"`, and the panel hides. This proves transport end-to-end over `http://localhost:1420` (the always-achievable DEV baseline). Record observations.

- [ ] **4.5 — Commit (Lior).** `git add apps/overlay/index.html apps/overlay/src apps/overlay/README.md` → `git commit -m "feat(overlay): centered input panel + WS client ECHO round-trip (no widget)"`.

### Step 5: Verification, spike revert confirmation, and branch finalization

**Files:** none new; assertions + DoD finalization.

- [ ] **5.1 — Confirm the spike is fully reverted.** `git diff packages/daemon` is EMPTY; `grep -r "\[spike\]" packages/` returns nothing; `bun test` 30/30 (daemon/protocol) still green. The wire contract and allowlist logic were never altered.
- [ ] **5.2 — Pure-TS suite green.** `bun test` (whole repo) — the new seam tests pass alongside the existing 30. Paste the real summary into the report.
- [ ] **5.3 — Typecheck (both programs) green.** `bun run typecheck` (root — packages + seam, bun libs) AND `cd apps/overlay && bun run typecheck` (DOM renderer). Both exit 0.
- [ ] **5.4 — `lint:strict` green.** `bun run lint:strict` (`eslint . --max-warnings=0`) exits 0 across `.ts` (including `apps/overlay/src/**`). If a test fixture needs `any`, scope an inline `// eslint-disable-next-line @typescript-eslint/no-explicit-any` (test-only), matching the existing daemon-test precedent.
- [ ] **5.5 — Finalize DoD #5 per the Step-1 branch.** Record in the report which branch (A/B/C) the spike landed on and the resulting prod-gate status (A: prod round-trip in the manual checklist; B: prod gate after ADR-0003 amendment + sign-off; C: STOP-THE-LINE, dev-only baseline, prod deferred to Jimmy). The DEV round-trip (Step 4.4) is the always-met baseline.

### Step 6: Review-fix — cancel-to-complete round-trip + socket-close + UX (Lior decision 2026-05-31)

Resolves the round-1 CRITICAL (baseline drift: 02a's daemon answers `session_start` with `[ack, tool_call]`, no `session_end`) + MAJOR (socket leak) + the relevant MINOR/NIT. **Option 1 (cancel-to-complete) chosen by Lior.** Within the frozen contract — uses the existing `tool_cancel` variant; NO protocol edit, NO widget rendering.

- [ ] **6.1 — Seam: cancel-to-complete (`apps/overlay/src/ws/session-client.ts`).** On an inbound `tool_call`, the seam AUTO-sends `tool_cancel{session_id, call_id}` (echoing the `call_id` + `session_id` from the received `tool_call`) — it does NOT render the picker (that's 02b-ii). `runEcho` then resolves on `session_end` of **any** `reason` (the v0 happy path now ends in `reason:"cancelled"`). Read the exact `tool_call` / `tool_cancel` shapes from `packages/protocol` and import the types — do NOT redefine (FROZEN). Keep the non-throwing discipline on unknown/invalid frames and the timeout-reject.
- [ ] **6.2 — Seam: close the socket on settle (MAJOR fix).** `finish()` must call `ws.close()` before resolving (currently leaks one socket per `runEcho`). The post-settle `close`/`fail` is a no-op against the already-resolved promise (existing design).
- [ ] **6.3 — Seam: single correlation source of truth (MINOR).** Remove the redundant double-guard (snapshot param vs. closure var); read one live `confirmedSessionId`.
- [ ] **6.4 — Seam tests: update for the new flow.** A correlated `session_start → session_ack → tool_call` must drive an outbound `tool_cancel{matching call_id}` and resolve on `session_end{cancelled}`. Keep: non-correlated-ack→timeout, malformed/unknown→no-throw. Add: assert the `tool_cancel` is actually sent with the right `call_id`; assert resolve on `session_end` regardless of `reason`. Red→green (superpowers:test-driven-development).
- [ ] **6.5 — Renderer UX (`apps/overlay/src/main.ts`).** (a) On Enter: immediately show a pending indicator (`…`) and GUARD against re-submit while in-flight (the double-Enter Lior hit). (b) On SUCCESS (resolve, any reason): render `session <id> — <reason>` (e.g. `— cancelled`), keep it visible briefly so it's readable, THEN `invoke("hide_panel")`. (c) On FAILURE (timeout/error): render the error and DO NOT auto-hide — the panel stays so the user sees it; Esc dismisses. Replace unchecked `as HTMLInputElement` casts with guarded lookups (NIT).
- [ ] **6.6 — Docs: `apps/overlay/README.md` + plan manual-checklist.** Update the expected status from `completed` to `cancelled` (transport proven via the full loop start→ack→tool_call→cancel→end, without choosing a color). Note the v0 flow auto-cancels the tool_call because widget rendering is 02b-ii.
- [ ] **6.7 — Verify (paste real output):** `bun test` green, root + app `typecheck` exit 0, `lint:strict` exit 0, `git diff packages/daemon` empty. (Native run remains Lior's.)
- [ ] **6.8 — Manifest housekeeping (NIT-2):** `orchestration/docs/dev-runbook.md` was authored during execution but is not in the File-structure manifest — it is a useful dev runbook (Origin-spike technique, port-pin gotcha, cargo/PATH note). Acknowledged as a declared deliverable here; leave it in place.

---

## Verification

### Manual macOS checklist (Lior, on real macOS — native behaviour is NOT automatable)
1. `cd packages/daemon && bun run dev` — daemon logs `listening on ws://127.0.0.1:7777`.
2. `cd apps/overlay && bun run tauri dev` — app builds and launches; NO visible window yet (`visible:false`).
3. On first hotkey use, macOS prompts for Accessibility permission → grant via System Settings → Privacy & Security → Accessibility (exact path in `apps/overlay/README.md`). Re-press the hotkey.
4. Hotkey → a frameless, transparent, centered, always-on-top input panel appears and is focused. ✅ (DoD: frameless transparent window + hotkey + permission path)
5. Type "hello", press Enter → status briefly shows `…` (pending), then a daemon-minted `sessionId` (UUID) + `reason: "cancelled"`; panel hides after the result is readable. ✅ (DoD: input captures text, closes on submit; full ECHO loop proven over dev origin — `session_start → session_ack → tool_call → tool_cancel → session_end{cancelled}` — without rendering the widget, which is 02b-ii). A double Enter while in-flight must NOT open a second session (guarded). On a transport FAILURE the panel stays open showing the error (does not silently hide).
6. Press hotkey again, press Esc → panel hides without submitting. ✅
7. **Spike-observation step (Step 1) — DONE (Branch A):** dev Origin `http://localhost:1420`, prod (`tauri build` `.app`) Origin `tauri://localhost`. Both allowlisted. ✅
8. **Prod gate (Branch A, FINALIZED):** repeat steps 4–5 against the BUILT `.app` (`bun run tauri build` → launch from `apps/overlay/src-tauri/target/release/bundle/macos/`) with the daemon running → confirm the echo round-trip completes (status line shows daemon-minted `sessionId` + `reason:"completed"`) over the prod `tauri://localhost` origin. This is the DoD #5 acceptance for v0.
9. **Negative origin check (DoD #5, disallowed origin still blocked):** confirm chunk 01's `daemon.test.ts` reject tests (arbitrary + missing origin) are still green (`bun test packages/daemon`) — the legitimate Tauri origin is NOT blocked while a disallowed/missing one still is. (No new daemon test needed; the existing assertions cover "disallowed still blocked.")

### Automated (worker, before any "done" claim — superpowers:verification-before-completion)
- `bun test` — whole repo green (existing 30 + new seam tests); paste real summary.
- `bun run typecheck` (root) AND `apps/overlay` `typecheck` — both exit 0.
- `bun run lint:strict` — exit 0.
- `git diff packages/daemon` — empty (spike reverted).

---

## ADR worthy: yes

Two distinct ADR touchpoints; route via `adr-curator` (doc edits are not the worker's job).

1. **Concrete tap-hotkey binding (ADR-0006).** ADR-0006 lists `⌘+Space` only as an *example* and it collides with Spotlight. Pinning a real default binding is an ADR-0006-relevant UX decision. **Recommended:** amend ADR-0006 with a dated note recording the chosen v0 default accelerator (recommendation: `CommandOrControl+Shift+Space`, which avoids the Spotlight collision and is unlikely to clash with common app shortcuts), noting it is user-rebindable later (rebinding UI is out of scope here). This is an *added dated note*, not a supersede — ADR-0006's "user-configurable" framing already anticipates it. Gate: Lior signs off on the binding (Q1).

2. **Spike Branch B — a new STABLE prod Origin value (ADR-0003).** PRE-AUTHORIZED PATH ONLY (only if Step 1 lands on B with a value not already in the allowlist). The allowlist was pinned by Lior under ADR-0003's 2026-05-30 Amendment, so adding a value is an **ADR-0003 amendment** (dated note appended; original allowlist preserved), NOT a silent `origin.ts` edit. Rationale to record: the addition is additive and still origin-based, so the interim CSWSH mitigation is not weakened (gotcha #31 unchanged). It is NOT a protocol/wire-contract stop-the-line (allowlist is daemon implementation, not `packages/protocol`). Requires Jimmy sign-off before the value is added. If Step 1 lands on A or C, this touchpoint is inert (A: nothing to add; C: a separate stop-the-line, not an allowlist amendment).

> Transparency/permission approach: `app.macOSPrivateApi:true` + `decorations:false`/`transparent:true`/`alwaysOnTop:true` and the manual Accessibility grant are all already covered by ADR-0006 ("real OS-overlay UX", "accessibility permissions friction") — NO new ADR for the overlay/permission approach itself.

---

## Questions for orchestrator

- **Q1 — Concrete tap-hotkey binding. ✅ RESOLVED (Lior, 2026-05-30):** `CommandOrControl+Shift+Space` is the v0 default (collision-safe vs Spotlight ⌘Space / input-source ⌃Space, mnemonic, cross-platform-portable accelerator string), recorded via an ADR-0006 dated note (see `## ADR worthy` #1 and `## ADR`), user-rebindable in a later chunk. (The A/B/C spike branch resolves during Step 1 execution, not before.)
