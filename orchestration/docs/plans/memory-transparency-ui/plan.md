# Tray Icon + Memory-Window Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is **chunk-01** of feature `memory-transparency-ui` (backlog Theme A). Scope is FROZEN by `orchestration/chunks-todo/memory-transparency-ui/01-tray-icon-and-memory-window-shell.md` — do not exceed it.

**Goal:** Ship a macOS menu-bar tray icon (status indicator + "Open Memory…" / "Quit" menu) and a new, normal `memory` window whose shell page proves end-to-end auth wiring by reading the per-install token Rust-side and rendering an honest tri-state from a real token-gated `GET /memory/threads`.

**Architecture:** Three disjoint surfaces. (1) The daemon gains a **CORS seam** on its existing `/memory/*` HTTP family so the overlay webview (a cross-origin caller) can read the token-gated JSON. (2) The Tauri Rust shell gains a tray icon, a declared-but-hidden `memory` window, and a `set_tray_status` command. (3) The overlay frontend gains the `memory.html`/`memory.ts` shell plus a **read-only** connection-state tap that pushes state to the tray. `@agentic/protocol` is untouched.

**Tech Stack:** Bun + TypeScript daemon (`Bun.serve` fetch handler); Tauri 2 (Rust: `tray-icon` + `image-png` cargo features on the existing `tauri` dep); Vite multi-page frontend (system WebView); standard browser `fetch`.

## Global Constraints

Copied verbatim from the chunk + spec + ADRs; every task's requirements implicitly include these:

- **`@agentic/protocol` is FROZEN — `git diff packages/protocol/` MUST be empty.** If any task discovers a protocol change is necessary → that is a **freeze gate** (human review, no auto-merge) → STOP and escalate; do not proceed.
- **Token discipline (ADR-0013):** the per-install bearer token NEVER appears in logs, NEVER in a URL / query string. It travels ONLY in the `Authorization: Bearer <token>` HTTP header (read paths) — same as `history.html` / `main.ts` already do.
- **No new runtime dependencies.** The tray uses cargo *feature flags* on the already-present `tauri` crate (`tray-icon`, `image-png`) — this is NOT a new dependency and needs no ADR. Do NOT add `tauri-plugin-http` or any npm/cargo package (that path is the escalation fallback only — see `## Fetch-path decision`).
- **Read-only connection tap.** The JS side only *reads* existing connection state. Do NOT change the `inFlight` guard, the hotkey/submit flow, or any `main`/`widget` window behavior (chunk OUT-scope; gotcha #45).
- **No auto-hide / linger timers on the `memory` window** (gotchas #33/#34) — it is a normal window, closed by the user.
- **Center on primary monitor is acceptable v1** (gotcha #32) — do NOT build monitor-resolution logic.
- **Two-zone UX intact (ADR-0006):** the memory surface is opened from the tray, NOT from the launcher summon-flow. Engine-owned native surface (ADR-0005) — no `@agentic/protocol` primitives.
- **CI gate:** `bun test`, `bun run lint:strict` (`--max-warnings=0`), and `bun run typecheck` all green. Rust changes must `cargo build` clean.

---

## Status

`Phase 3 — Implementation Plan: Done.` Ready for execution. No open questions blocking (scope is decompose-frozen; the one architect decision — fetch-path — is settled below).

---

## Reality check

All statements below are **code-path existence facts** verified by reading source. Per PIPELINE §6.1, no behavioral/runtime claim is asserted as verified — the behavioral DoD items are marked **"requires live macOS demo to confirm"** in `## Verification`.

- **`read_auth_token` exists and its shape is confirmed.** `apps/overlay/src-tauri/src/lib.rs:19-31`: `#[tauri::command] fn read_auth_token() -> Result<String, String>`. Reads `<AGENTIC_DATA_DIR ?? $HOME/.agentic-engine>/auth-token`, returns the trimmed token string on success, or the `std::io::Error` string on failure (→ a JS `invoke` *rejection*). Registered via `invoke_handler(tauri::generate_handler![hide_panel, read_auth_token])` (lib.rs:58). Custom commands work from any window with the `default` capability (proven: `main.ts` already invokes `read_auth_token` + `hide_panel` and `default.json` lists no per-command permission).
- **Tauri 2 confirmed.** `Cargo.toml`: `tauri = { version = "2", features = ["macos-private-api"] }`, plus `tauri-plugin-global-shortcut = "2"`. The tray was deliberately deferred (ADR-0006 Amendment 2026-06-03 last bullet: "the tray remains deferred").
- **`main.ts` owns the ConnectionManager + `inFlight`.** `apps/overlay/src/main.ts:50` constructs `connection = new ConnectionManager(factory, authToken); connection.connect();`, and re-creates a fresh manager on dismiss (`main.ts:199`). `inFlight` is a local `let` (main.ts:206). **`ConnectionManager` has NO existing connection-state callback** (`connection-manager.ts`): the socket lifecycle (`open`/`close`) is handled privately inside `openSocket()`/`onSocketClose()`. So a read-only tap must be added as an **additive optional callback** on `ConnectionManagerDeps` — this does not touch `inFlight` or the submit flow.
- **`GET /memory/threads` is token-gated (not open).** `packages/daemon/src/memory/http-routes.ts:60,99-103`: `handleThreads` calls `deps.tokenStore.verify(req.headers.get("authorization"))` and returns `401` on failure, else `Response.json({ threads })`. Auth format = `Authorization: Bearer <token>` (`token-store.ts:66-71` — requires the `"Bearer "` prefix, constant-time compare). **Doc-vs-code nuance the worker must not trip on:** ADR-0013's *Decision body* says "Option B: reads-open." But its **binding acceptance rider** required token-gating the read path in the security-hardening pass — which **shipped**: `http-routes.ts` header + tests `http-routes.daemon.test.ts:62-80` prove `GET` now returns 401 without a token. So targeting a Bearer-token GET is correct and current. Docs still win — and the operative doc clause (the rider) agrees with the code.
- **The daemon routes `/memory/*` (and `/history.html`) to `handleMemoryHttp` BEFORE the WS origin gate**, guarded only by a Host-header DNS-rebinding check (`index.ts:93-107`). Dispatch is **by pathname prefix, not method** — so an `OPTIONS /memory/threads` preflight reaches `handleMemoryHttp` today and currently falls through to `404`. The Host guard passes for a preflight (browser sends `Host: 127.0.0.1:<port>`, the fetch target).
- **The overlay webview origin is runtime-confirmed** (`main.ts:4-9` "Branch A, confirmed 2026-05-31" + `origin.ts:12-16`): dev = `http://localhost:1420`, prod (macOS) = `tauri://localhost`. `origin.ts` exports `isOriginAllowed(origin)` over `ALLOWED_ORIGINS = { "tauri://localhost", "http://tauri.localhost", "http://localhost:1420" }` — the single source of truth for "who is the overlay."
- **Vite is already multi-page.** `vite.config.ts:12-18`: `rollupOptions.input = { main: index.html, widget: widget.html }`. Adding `memory.html` = one more `input` entry. HTML entries use `<script type="module" src="/src/<entry>.ts">` (`index.html:20`).
- **Capabilities scope windows explicitly.** `src-tauri/capabilities/default.json`: `"windows": ["main", "widget"]`. A new window not listed here gets no permissions — so `"memory"` MUST be added to the array (that alone enables `core:default` + `invoke` for the memory window; no per-command permission entry is needed).
- **No scope problem found in the chunk file.** Flag-not-edit: none required.

---

## Fetch-path decision

**Pick: (a) — a narrow CORS header on the daemon's `/memory/*` routes reflecting ONLY the overlay's allowlisted origin (never `*`), keyed off the existing `origin.ts` allowlist. Standard browser `fetch` from `memory.ts`, `Authorization: Bearer` header, token read Rust-side via `read_auth_token`.**

Why (a) over the alternatives:

- **(c) — point the `memory` window at the daemon-served page — REJECTED.** A Tauri window loading a remote `http://127.0.0.1:7777` origin cannot `invoke("read_auth_token")` (Tauri IPC is not granted to remote origins, and granting it is a security regression). That **re-introduces manual token paste** — the exact `history.html` friction this whole feature exists to kill (spec §2). It also contradicts the frozen chunk scope, which names `memory.html` + `src/memory.ts` (overlay bundle) as deliverables. `history.html` already IS the daemon-served, paste-based fallback.
- **(b) — `tauri-plugin-http` (Rust-side fetch, no webview CORS) — REJECTED as primary; retained as escalation fallback.** It works and avoids CORS entirely, but it is a **new runtime dependency** (cargo `tauri-plugin-http` + npm `@tauri-apps/plugin-http` + a capability URL-scope) → triggers the "no new runtime deps without ADR" hard rule, and permanently couples all memory-UI fetches to Tauri (untestable outside a Tauri webview). Heavier machinery than "overlay/shell + wiring" (spec §Anchors) warrants.
- **(a) — CHOSEN.** Keeps standard `fetch` (portable, unit-testable, zero new deps), reuses `origin.ts` as the single allowlist source, and **scales to chunk-02's full CRUD for free**: the preflight responder is built generically for the whole `/memory/*` family (`GET, POST, OPTIONS` + `authorization, content-type`), so chunk-02's `POST /memory/edit` and `POST /memory/forget` (which also preflight, because of the `Authorization` + JSON `content-type` headers) need **zero further touches to the security-adjacent daemon file**. Building the CORS seam once, now, is strictly better for reviewability than re-touching an auth surface twice.

**Security posture (for the reviewer):** CORS does **not** weaken the token gate. Reads stay `401` without a valid Bearer; CORS only lets the *already-authorized overlay browser* read a response it was entitled to. Non-browser local clients ignore CORS entirely and remain stopped by the token + Host guards. Reflecting only allowlisted origins (never `*`, and adding `Vary: Origin`) means no arbitrary web page can read memory even if it somehow held the token. This is additive to, and consistent with, ADR-0013 (the token is the real gate); the code comment must cite ADR-0013.

**Runtime risk to confirm in the live demo (NOT verifiable by code-reading):** whether WKWebView's cross-origin preflight + reflected-`tauri://localhost` handshake actually succeeds for a custom-scheme origin. The origin *values* are runtime-confirmed (Branch A, 2026-05-31); the *CORS preflight round-trip against a custom scheme* is a new path. If it fails in the demo, the documented fallback is (b) `tauri-plugin-http` — which requires an ADR (new dep) → **escalate, do not silently switch.**

---

## ADR worthy: no

Rationale:

- **Tray icon** *executes* the already-decided ADR-0006 Decision p.4 (status indicator + menu). Executing a decided item is not a new decision. Code comment should cite ADR-0006 p.4.
- **CORS seam** is additive response-headers on an *existing* route family, keyed off an existing allowlist, with the auth model unchanged. ADR-0013's "camel's nose" mitigation requires new daemon HTTP *routes* to cite it — this adds no route. Code comment must cite ADR-0013 (rider).
- **Surface class** (engine-owned native surface, not protocol primitives) is settled by the spec Anchors + ADR-0005; no new boundary.

**Reviewer escalation clause:** if the reviewer judges the cross-origin read *allowance* to constitute a new security posture beyond ADR-0013's envelope, escalate to `adr-curator` for a **rider/note on ADR-0013** (not a new ADR) before merge.

---

## Files to create / modify

**Daemon (Step 1) — security-adjacent, coordinate merge order with chunk-04 (same package, disjoint files):**
- Modify: `packages/daemon/src/memory/http-routes.ts` — extract the current dispatch body into a `route()` inner fn; add an `OPTIONS` preflight branch + a CORS-header wrapper reflecting the allowlisted origin. Import `isOriginAllowed` from `../origin.js`.
- Create: `packages/daemon/src/memory/http-routes-cors.daemon.test.ts` — real-I/O CORS tests (no mocks).

**Overlay Rust shell (Step 2):**
- Modify: `apps/overlay/src-tauri/Cargo.toml` — add `"tray-icon"` + `"image-png"` to the `tauri` features.
- Modify: `apps/overlay/src-tauri/src/lib.rs` — build the tray (icon + menu + status wiring) in `setup()`; add `set_tray_status` command; register it in `generate_handler!`.
- Modify: `apps/overlay/src-tauri/tauri.conf.json` — add the `memory` window (normal, resizable, `visible:false`, `center:true`).
- Modify: `apps/overlay/src-tauri/capabilities/default.json` — add `"memory"` to `windows`.
- Create: `apps/overlay/src-tauri/icons/tray-connected.png`, `tray-error.png` (and optional `tray-busy.png`) — monochrome menu-bar template icons.

**Overlay frontend (Step 3):**
- Create: `apps/overlay/memory.html` — shell page.
- Create: `apps/overlay/src/memory.ts` — tri-state shell logic.
- Modify: `apps/overlay/vite.config.ts` — add `memory` to `rollupOptions.input`.
- Modify: `apps/overlay/src/ws/connection-manager.ts` — add optional `onConnectionState` to `ConnectionManagerDeps`; fire on `open`/close (additive, read-only).
- Modify: `apps/overlay/src/main.ts` — pass an `onConnectionState` handler to BOTH `ConnectionManager` construction sites; the handler `invoke("set_tray_status", { status })`.
- Modify: `apps/overlay/src/ws/connection-manager.test.ts` — add observer-fires tests.

---

## Steps

### Step 1: Daemon CORS seam on `/memory/*` (the fetch-path decision, realized)

**Files:**
- Modify: `packages/daemon/src/memory/http-routes.ts`
- Create/Test: `packages/daemon/src/memory/http-routes-cors.daemon.test.ts`

**Interfaces:**
- Consumes: `isOriginAllowed(origin: string | null): boolean` from `../origin.js`; the existing `handleMemoryHttp(req, url, deps)` body; `MemoryHttpDeps` (exported).
- Produces: `handleMemoryHttp` now answers `OPTIONS` preflights with `204` + `Access-Control-Allow-Methods: GET, POST, OPTIONS` + `Access-Control-Allow-Headers: authorization, content-type` (+ reflected `Access-Control-Allow-Origin` iff origin allowlisted), and stamps `Access-Control-Allow-Origin: <reflected>` + `Vary: Origin` on *every* `/memory/*` response when the origin is allowlisted. **Consumed by Step 3's `fetch`.** No new route, no auth change.

- [ ] **Step 1.1 — Write the failing CORS tests.** Create `http-routes-cors.daemon.test.ts`. Real store/hatch/tokenStore, no mocks; call `handleMemoryHttp` directly with a constructed `Request` so the `Origin` header is deterministic (avoids any Bun `fetch` forbidden-header handling):

```ts
/**
 * Memory HTTP CORS seam — chunk-01 (memory-transparency-ui).
 * Real store/hatch/tokenStore (no mocks); handleMemoryHttp called directly with a
 * constructed Request so the Origin header is deterministic. ADR-0013 rider: CORS
 * reflects ONLY the overlay origin (origin.ts allowlist), never `*`; token gate unchanged.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { handleMemoryHttp, type MemoryHttpDeps } from "./http-routes.js";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { Hatch } from "./hatch.js";
import { TokenStore } from "./token-store.js";

function buildDeps(): { deps: MemoryHttpDeps; token: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "cors-"));
  const store = new MemoryStore({ dataDir });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hatch = new Hatch(store, gate);
  const tokenStore = new TokenStore(dataDir);
  return { deps: { hatch, store, tokenStore }, token: tokenStore.token() };
}

const OVERLAY_ORIGIN = "tauri://localhost";

test("CORS preflight: OPTIONS from overlay origin → 204 + reflected ACAO + methods/headers", async () => {
  const { deps } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    method: "OPTIONS",
    headers: { origin: OVERLAY_ORIGIN, "access-control-request-headers": "authorization" },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe(OVERLAY_ORIGIN);
  expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
});

test("CORS preflight: disallowed origin → NO ACAO (browser blocks)", async () => {
  const { deps } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    method: "OPTIONS",
    headers: { origin: "http://evil.example" },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

test("CORS: GET with valid Bearer + overlay origin → 200 + reflected ACAO + Vary", async () => {
  const { deps, token } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    headers: { origin: OVERLAY_ORIGIN, authorization: `Bearer ${token}` },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe(OVERLAY_ORIGIN);
  expect(res.headers.get("vary")).toBe("Origin");
});

test("CORS never weakens the token gate: overlay origin, NO token → 401 (still ACAO so browser reads the error)", async () => {
  const { deps } = buildDeps();
  const req = new Request("http://127.0.0.1:7777/memory/threads", {
    headers: { origin: OVERLAY_ORIGIN },
  });
  const res = await handleMemoryHttp(req, new URL(req.url), deps);
  expect(res.status).toBe(401);
  expect(res.headers.get("access-control-allow-origin")).toBe(OVERLAY_ORIGIN);
});
```

- [ ] **Step 1.2 — Run; verify they fail.** Run: `bun test packages/daemon/src/memory/http-routes-cors.daemon.test.ts`. Expected: FAIL (preflight currently 404; no ACAO headers).

- [ ] **Step 1.3 — Implement the CORS seam in `http-routes.ts`.** Add the import and rename the existing exported `handleMemoryHttp` body to an inner `route()`; wrap it. Exact edits:

At the top with the other imports:
```ts
import { isOriginAllowed } from "../origin.js";
```

Add these constants + helper above `handleMemoryHttp`:
```ts
const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_ALLOW_HEADERS = "authorization, content-type";

/** Reflect the request Origin iff it is the overlay's (origin.ts allowlist); never `*`. */
function corsHeaders(origin: string | null): Record<string, string> {
  return isOriginAllowed(origin)
    ? { "access-control-allow-origin": origin as string, vary: "Origin" }
    : {};
}
```

Replace the current `export async function handleMemoryHttp(...)` signature line with a **non-exported** `async function route(...)` — keep its entire body byte-for-byte — and add this new exported wrapper:
```ts
export async function handleMemoryHttp(
  req: Request,
  url: URL,
  deps: MemoryHttpDeps,
): Promise<Response> {
  const origin = req.headers.get("origin");

  // CORS preflight. The token is NEVER checked here — a preflight carries no credentials
  // (browsers send OPTIONS before any Authorization-bearing cross-origin fetch); auth is
  // enforced on the actual GET/POST in route(). We reflect only the allowlisted overlay
  // origin (origin.ts). ADR-0013 rider: this widens read-*visibility* to the overlay
  // browser only; the bearer-token gate is unchanged, and non-browser clients ignore CORS.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "access-control-allow-methods": CORS_METHODS,
        "access-control-allow-headers": CORS_ALLOW_HEADERS,
        "access-control-max-age": "600",
      },
    });
  }

  const res = await route(req, url, deps);
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}
```
Also update the doc-comment block at the top of the file to note the CORS seam (chunk-01, cite ADR-0013 rider + ADR-0005 surface class).

- [ ] **Step 1.4 — Run; verify green.** Run: `bun test packages/daemon/src/memory/http-routes-cors.daemon.test.ts` (Expected: PASS) then `bun test packages/daemon/src/memory/http-routes.daemon.test.ts` (Expected: still PASS — the existing 401/200/write matrix is unaffected). Then `bun run lint:strict` + `bun run typecheck`.

- [ ] **Step 1.5 — Commit.**
```bash
git add packages/daemon/src/memory/http-routes.ts packages/daemon/src/memory/http-routes-cors.daemon.test.ts
git commit -m "feat(memory-http): narrow CORS seam on /memory/* for the overlay origin (ADR-0013 rider)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Step 2: Overlay native shell — tray icon, `memory` window, `set_tray_status`

**Files:**
- Modify: `apps/overlay/src-tauri/Cargo.toml`, `src/lib.rs`, `tauri.conf.json`, `capabilities/default.json`
- Create: `apps/overlay/src-tauri/icons/tray-connected.png`, `tray-error.png`, (optional) `tray-busy.png`

**Interfaces:**
- Produces (consumed by Step 3): a Tauri command `set_tray_status(status: String)` where `status ∈ {"connected","disconnected","busy"}`; a declared hidden window with **label `"memory"`** loading `memory.html`; a tray menu whose "Open Memory…" shows+focuses that window and whose "Quit" exits the app.

> **FLAG-IF-UNSURE (mirror the existing lib.rs:1-5 convention):** the exact Tauri v2 tray/menu/image API names below (`TrayIconBuilder`, `tray_by_id`, `set_icon_as_template`, `include_image!`, `MenuItem::with_id`) are written from the Tauri 2 API. Verify against the pinned Tauri 2 version via context7 / v2.tauri.app at implementation time; if a name/signature differs, adjust and report to Lior. Do NOT add a new crate to work around it.

- [ ] **Step 2.1 — Enable the cargo features.** In `Cargo.toml`, change the `tauri` line to:
```toml
tauri = { version = "2", features = ["macos-private-api", "tray-icon", "image-png"] }
```

- [ ] **Step 2.2 — Add the template tray icons.** Create small monochrome PNGs in `src-tauri/icons/`: `tray-connected.png` and `tray-error.png` (optional `tray-busy.png`). Menu-bar template icons: ~18–22px logical (provide an `@2x` variant if convenient), single-color on transparent — macOS recolors template images to match the menu bar. They must be *visually distinguishable* from each other (the DoD requires the state change to be **visible**, not tooltip-only), e.g. a filled vs. hollow glyph.
  - *Asset-free fallback (acceptable):* ship one template icon and drive the visible state via `tray.set_title(Some("●"))` / `Some("○")` in `set_tray_status`. Tooltip-only is NOT sufficient for the DoD.

- [ ] **Step 2.3 — Declare the `memory` window** in `tauri.conf.json` `app.windows` (append after `widget`):
```json
{
  "label": "memory",
  "url": "memory.html",
  "title": "AgenticEngine — Memory",
  "width": 760,
  "height": 560,
  "minWidth": 480,
  "minHeight": 360,
  "resizable": true,
  "center": true,
  "visible": false,
  "decorations": true,
  "transparent": false,
  "alwaysOnTop": false,
  "skipTaskbar": false
}
```
`center:true` satisfies gotcha #32 (primary-monitor centering, no monitor logic). It is a *declared* window (always exists, just hidden) — so "Open Memory…" can never create a duplicate.

- [ ] **Step 2.4 — Grant the window its capability.** In `capabilities/default.json`, change `"windows"` to `["main", "widget", "memory"]`. No per-command permission entry is needed (custom commands work under `core:default`, as `main.ts` already proves).

- [ ] **Step 2.5 — Build the tray + add `set_tray_status` in `lib.rs`.** Extend the imports:
```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{include_image, Manager};
```
Add the command:
```rust
/// Read-only status sink for the tray. Called by main.ts from a connection-state tap
/// (ADR-0006 p.4 — the deferred menu-bar status indicator). No app logic here: purely
/// reflects daemon connectivity as icon + tooltip. Unknown/"disconnected" → error state.
#[tauri::command]
fn set_tray_status(app: tauri::AppHandle, status: String) {
    let Some(tray) = app.tray_by_id("main-tray") else { return; };
    let (icon, tip) = match status.as_str() {
        "connected" => (include_image!("icons/tray-connected.png"), "AgenticEngine — connected"),
        "busy" => (include_image!("icons/tray-busy.png"), "AgenticEngine — working…"),
        _ => (include_image!("icons/tray-error.png"), "AgenticEngine — daemon unreachable"),
    };
    let _ = tray.set_icon(Some(icon));
    let _ = tray.set_icon_as_template(true);
    let _ = tray.set_tooltip(Some(tip));
}
```
*(If `tray-busy.png` is not shipped, map `"busy"` to the connected icon with the "working…" tooltip.)*

Inside the existing `.setup(|app| { ... })` closure, **after** the global-shortcut block and **before** `Ok(())`, build the tray:
```rust
let open_i = MenuItem::with_id(app, "open_memory", "Open Memory…", true, None::<&str>)?;
let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

let _tray = TrayIconBuilder::with_id("main-tray")
    .icon(include_image!("icons/tray-error.png")) // initial: "connecting…" until first "connected"
    .icon_as_template(true)
    .tooltip("AgenticEngine — connecting…")
    .menu(&menu)
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| match event.id.as_ref() {
        "open_memory" => {
            if let Some(win) = app.get_webview_window("memory") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
```
Register the new command — change the handler line to:
```rust
.invoke_handler(tauri::generate_handler![hide_panel, read_auth_token, set_tray_status])
```

- [ ] **Step 2.6 — Compile.** Run: `cd apps/overlay/src-tauri && cargo build`. Expected: builds clean. (If a Tauri API name differs, apply the FLAG-IF-UNSURE note.)

- [ ] **Step 2.7 — Commit.**
```bash
git add apps/overlay/src-tauri/Cargo.toml apps/overlay/src-tauri/src/lib.rs apps/overlay/src-tauri/tauri.conf.json apps/overlay/src-tauri/capabilities/default.json apps/overlay/src-tauri/icons/tray-*.png
git commit -m "feat(overlay): menu-bar tray (status + Open Memory/Quit) + hidden memory window (ADR-0006 p.4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Step 3: Overlay frontend — `memory.html` shell + tri-state + read-only tray tap

**Files:**
- Create: `apps/overlay/memory.html`, `apps/overlay/src/memory.ts`
- Modify: `apps/overlay/vite.config.ts`, `apps/overlay/src/ws/connection-manager.ts`, `apps/overlay/src/main.ts`
- Test: `apps/overlay/src/ws/connection-manager.test.ts`

**Interfaces:**
- Consumes: Step 1's CORS on `GET /memory/threads`; Step 2's `set_tray_status` command + `memory` window; the existing `read_auth_token` command; `ConnectionManagerDeps` (extended below).
- Produces: `type ConnectionState = "connected" | "disconnected"` and an optional `onConnectionState?: (s: ConnectionState) => void` on `ConnectionManagerDeps`, fired on socket `open`/close (additive, read-only — cannot mutate manager state).

- [ ] **Step 3.1 — Write the failing observer tests.** Add to `apps/overlay/src/ws/connection-manager.test.ts` (self-contained fake so it does not depend on the file's existing helpers):
```ts
test("onConnectionState fires 'connected' on socket open", () => {
  const states: string[] = [];
  const listeners: Record<string, ((e: { data: unknown }) => void)[]> = {};
  const factory = () => ({
    send: () => {},
    close: () => (listeners["close"] ?? []).forEach((cb) => cb({ data: undefined })),
    addEventListener: (t: string, cb: (e: { data: unknown }) => void) => { (listeners[t] ??= []).push(cb); },
  });
  const cm = new ConnectionManager(factory, "tok", { onConnectionState: (s) => states.push(s) });
  cm.connect();
  (listeners["open"] ?? []).forEach((cb) => cb({ data: undefined }));
  expect(states).toContain("connected");
});

test("onConnectionState fires 'disconnected' on socket close (reconnect suppressed)", () => {
  const states: string[] = [];
  const listeners: Record<string, ((e: { data: unknown }) => void)[]> = {};
  const factory = () => ({
    send: () => {},
    close: () => (listeners["close"] ?? []).forEach((cb) => cb({ data: undefined })),
    addEventListener: (t: string, cb: (e: { data: unknown }) => void) => { (listeners[t] ??= []).push(cb); },
  });
  const cm = new ConnectionManager(factory, "tok", {
    onConnectionState: (s) => states.push(s),
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
  });
  cm.connect();
  (listeners["open"] ?? []).forEach((cb) => cb({ data: undefined }));
  (listeners["close"] ?? []).forEach((cb) => cb({ data: undefined }));
  expect(states).toEqual(["connected", "disconnected"]);
});
```
Ensure `ConnectionManager` is imported at the top of the test file (it already is if other tests use it; otherwise add `import { ConnectionManager } from "./connection-manager.js";`).

- [ ] **Step 3.2 — Run; verify they fail.** Run: `bun test apps/overlay/src/ws/connection-manager.test.ts`. Expected: FAIL (`onConnectionState` not a known dep; no calls recorded).

- [ ] **Step 3.3 — Add the additive observer to `ConnectionManager`.** In `connection-manager.ts`, extend the deps interface + wire it (read-only; do not alter reconnect/inFlight semantics):
```ts
export type ConnectionState = "connected" | "disconnected";

export interface ConnectionManagerDeps {
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (h: ReturnType<typeof setTimeout>) => void;
  random?: () => number;
  baseMs?: number;
  capMs?: number;
  /** chunk-01: read-only connection-state tap for the tray. Additive; never mutates manager state. */
  onConnectionState?: (state: ConnectionState) => void;
}
```
Store it in the constructor: `this.onConnectionState = deps.onConnectionState;` (add the matching `private readonly onConnectionState?: (s: ConnectionState) => void;` field). Fire it at the two points where state already changes:
- In `openSocket()`, in the `"open"` listener: `ws.addEventListener("open", () => { this.reconnectAttempt = 0; this.onConnectionState?.("connected"); });`
- In `onSocketClose()`, before `if (this.active) this.scheduleReconnect();`: `this.onConnectionState?.("disconnected");`

- [ ] **Step 3.4 — Run; verify green.** Run: `bun test apps/overlay/src/ws/connection-manager.test.ts` (Expected: PASS) and `bun test apps/overlay/src/ws/connection-manager.realio.test.ts` (Expected: still PASS — existing behavior unchanged).

- [ ] **Step 3.5 — Wire the tray tap in `main.ts` (read-only, no submit-flow change).** Near the top (after the `invoke`/`ConnectionManager` imports), add:
```ts
type TrayStatus = "connected" | "disconnected" | "busy";
async function pushTrayStatus(status: TrayStatus): Promise<void> {
  try { await invoke("set_tray_status", { status }); } catch { /* tray optional; never throw into flow */ }
}
```
Change the initial construction (`main.ts:50`) and the dismiss-handler re-construction (`main.ts:199`) to pass the observer — **both** sites:
```ts
connection = new ConnectionManager(factory, authToken, {
  onConnectionState: (s) => { void pushTrayStatus(s); },
});
```
(For `main.ts:50` it is `let connection = new ConnectionManager(factory, authToken, { onConnectionState: (s) => { void pushTrayStatus(s); } });`.)
This is the *entire* required tray wiring — connected/disconnected are driven purely by the ConnectionManager observer, so the `inFlight` guard, submit handler, and hotkey flow are **untouched**.
- *Optional `busy` (nice-to-have, do only if trivial):* the tray can show "working…" during a turn by calling `void pushTrayStatus("busy")` at the existing `inFlight = true` set-point and `void pushTrayStatus("connected")` where `inFlight = false` is set on settle. This is an additive call, not a guard change. If it feels at all risky, **skip it** — connected/disconnected is the required minimum.

- [ ] **Step 3.6 — Register the vite entry.** In `vite.config.ts`, add `memory` to `rollupOptions.input`:
```ts
input: {
  main: resolve(__dirname, "index.html"),
  widget: resolve(__dirname, "widget.html"),
  memory: resolve(__dirname, "memory.html"),
},
```

- [ ] **Step 3.7 — Create `memory.html`** (mirror `index.html`'s module-script pattern):
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgenticEngine — Memory</title>
  </head>
  <body>
    <main id="memory-shell">
      <h1>Memory</h1>
      <p id="conn-state" data-state="checking">Checking connection…</p>
    </main>
    <script type="module" src="/src/memory.ts"></script>
  </body>
</html>
```

- [ ] **Step 3.8 — Create `src/memory.ts`** (honest tri-state; token via `read_auth_token`; Bearer header only; NEVER log the token, NEVER put it in the URL). The initial `"Checking connection…"` is guaranteed to transition to a terminal state on both the resolve and reject paths (this is the `history.html` lesson — no stuck false "Loading…"):
```ts
/**
 * Memory window shell (chunk-01, feature memory-transparency-ui).
 * Proves the auth wiring for chunk-02's real UI: reads the per-install token Rust-side
 * (read_auth_token — no manual paste) and renders an HONEST tri-state from a real
 * token-gated GET /memory/threads. NO threads/facts UI here (that is chunk-02).
 * Token discipline (ADR-0013): Bearer header ONLY — never logged, never in a URL/query.
 * No auto-hide/linger timers (gotchas #33/#34) — this is a normal, user-closed window.
 */
import { invoke } from "@tauri-apps/api/core";

const MEMORY_URL = "http://127.0.0.1:7777/memory/threads";

type ShellState = "no-token" | "unreachable" | "unauthorized" | "connected";

function render(state: ShellState, detail?: string): void {
  const el = document.getElementById("conn-state");
  if (el === null) return;
  el.dataset.state = state;
  el.textContent =
    state === "no-token"     ? "🔒 No auth token found — is the engine installed?" :
    state === "unreachable"  ? "Daemon unreachable — is the engine running?" :
    state === "unauthorized" ? "🔒 Token rejected — the engine did not accept this token." :
    /* connected */            `Connected${detail ? ` (${detail})` : ""}`;
}

async function main(): Promise<void> {
  let token: string;
  try {
    token = (await invoke<string>("read_auth_token")).trim();
  } catch {
    render("no-token");
    return;
  }
  if (!token) { render("no-token"); return; }

  // Defensive abort: a stalled TCP (accepts but never answers) flips to "unreachable"
  // rather than hanging on "Checking…". This is a fetch timeout, NOT a window timer.
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), 4000);

  try {
    const res = await fetch(MEMORY_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) { render("unauthorized"); return; }
    if (!res.ok) { render("unreachable", `HTTP ${res.status}`); return; }
    const body = (await res.json()) as { threads?: unknown[] };
    const n = Array.isArray(body.threads) ? body.threads.length : 0;
    render("connected", `${n} thread${n === 1 ? "" : "s"}`);
  } catch {
    // Network error / connection refused / abort → daemon down. Honest state, NOT "Loading…".
    render("unreachable");
  } finally {
    clearTimeout(abortTimer);
  }
}

void main();
```

- [ ] **Step 3.9 — Verify mechanical gates.** Run: `bun run typecheck`, `bun run lint:strict`, `bun test` (whole suite). Expected: all green. Confirm `git diff packages/protocol/` is empty (`git diff --stat packages/protocol/` → no output).

- [ ] **Step 3.10 — Commit.**
```bash
git add apps/overlay/memory.html apps/overlay/src/memory.ts apps/overlay/vite.config.ts apps/overlay/src/ws/connection-manager.ts apps/overlay/src/ws/connection-manager.test.ts apps/overlay/src/main.ts
git commit -m "feat(overlay): memory-window shell (honest tri-state via token-gated GET) + read-only tray status tap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification (DoD mapping)

**Mechanical (provable by the worker now):**
- `git diff packages/protocol/` empty — assert in Step 3.9.
- `bun test` + `bun run lint:strict` + `bun run typecheck` green — Steps 1.4, 3.4, 3.9. `cargo build` clean — Step 2.6.

**Behavioral — ALL marked "requires live macOS demo to confirm" (PIPELINE §6.1; a probe is evidence only when executed; do NOT assert from code-reading). These are demo checklist items 1 and 5 of the spec, owned by this chunk; final joint sign-off rides chunk-04:**
- **[requires live macOS demo to confirm]** Tray icon appears in the menu bar; state visibly changes connected ↔ error when the daemon is stopped/started. (Depends on WKWebView firing WebSocket `close`/reconnect promptly on daemon kill/restart → observer → `set_tray_status`.)
- **[requires live macOS demo to confirm]** Tray → "Open Memory…" opens the window; shell shows "Connected (N threads)" via a real token-gated `GET /memory/threads`, **no manual token entry**; re-open focuses the same window, no duplicate. (This is where the WKWebView CORS-preflight-against-`tauri://localhost` risk from `## Fetch-path decision` is actually exercised — if it fails, escalate for the (b) fallback, do not silently switch.)
- **[requires live macOS demo to confirm]** With the daemon down, the shell shows the honest "Daemon unreachable" state (not a false "Loading…").

Intermediate gates use real I/O (Step 1 tests use a real store/hatch/tokenStore — no mocks across the daemon boundary), per the standing Strike-4/5 rule.

---

## Risks & flags

- **Security-adjacent daemon file (reviewer attention required):** Step 1 touches `packages/daemon/src/memory/http-routes.ts` (the memory HTTP auth surface). Reviewer must confirm: (1) no `*` — origin is reflected only when `isOriginAllowed`; (2) the bearer-token gate on `GET`/`POST`/`DELETE` is unchanged; (3) `Vary: Origin` present. See `## Fetch-path decision` security posture.
- **Merge-order coordination with chunk-04:** chunk-04 touches the same package (`packages/daemon`) on disjoint files. If both are in flight, whichever merges first, the other rebases. If chunk-04 turns out to touch `http-routes.ts` too → conflict; coordinate.
- **NOT a freeze gate:** the CORS change touches daemon HTTP transport, not `@agentic/protocol` (the wire envelope) — `git diff packages/protocol/` stays empty. Confirmed not a protocol change.
- **WKWebView custom-scheme CORS is the one live-demo risk** (see `## Fetch-path decision`). Escalation fallback (b) needs an ADR (new dep) — escalate, don't switch silently.
- **Tauri v2 tray API names** — FLAG-IF-UNSURE note in Step 2; verify against pinned Tauri 2 docs, adjust + report, never add a crate to route around a name mismatch.
- **macOS activation policy** (Dock-icon hiding via `ActivationPolicy::Accessory`) is deliberately OUT — do not change it (could disturb the existing windows/hotkey). Note only.
