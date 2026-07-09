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

---

## Demo-1 fix — diagnosis + decision

> Appended after Demo-1 (Lior, live macOS). Steps 1–3 shipped (6ebf695/9f2ba71/53e29a6/c35a230);
> tray shows, "Open Memory…" opens the window, real token-gated GET works ("Connected (8 threads)"),
> no token paste. These steps fix the two defect clusters Lior found. Every behavioral claim below
> is marked as a **code-path fact** (verified by reading source) or a **runtime inference** (NOT
> assertable from code-reading — §6.1); the DoD items ride Demo-2.
>
> **Orchestrator flag for Lior (Demo-2):** the tray-liveness mechanism (Step 6) DIVERGED from
> Lior's literal "ws reconnect loop … driving set_tray_status" to a **Rust-side TCP health probe** —
> because tuning the shared reconnect would change the AGENT connection (the exact coupling the chunk
> OUT-scope forbids), and a JS poll would run in the same hidden-window webview that already failed in
> Demo-1. This honors "or equivalent" + "your call on implementation." Tradeoff: TCP-accept is a
> coarser signal than a full WS/token handshake, and it's demo-only (no JS unit test). A testable
> JS-fetch variant is a one-paragraph swap if Lior prefers it.

### Diagnosis point 1 — window destroyed on close (defect cluster 1)

**Confirmed (code fact).** `lib.rs` has **no** `on_window_event` / `WindowEvent::CloseRequested`
hook — the open handler (`lib.rs:95-101`) *only* `get_webview_window("memory")` → show/unminimize/focus.
Tauri 2's native × **destroys** the window by default, so after a close `get_webview_window("memory")`
returns `None` and the handler silently no-ops — dead until app restart. Exactly Lior's repro.

**Tauri 2.11.2 API verified against the vendored crate** (`~/.cargo/registry/.../tauri-2.11.2`):
`WindowEvent::CloseRequested { api: CloseRequestApi }` (`app.rs:118`, `#[non_exhaustive]` → match must
use `{ api, .. }`); `CloseRequestApi::prevent_close(&self)` (`app.rs:103`); `Builder::on_window_event`
(`app.rs:2052`, fires for all windows → filter on `window.label()`); `WebviewWindowBuilder::from_config(&app,&cfg).build()`
(`webview_window.rs:150`).

### Diagnosis point 2 — connection-manager reconnect (defect cluster 2B, tray direction)

**Code facts:** `onConnectionState("connected")` fires in the `"open"` listener called by `openSocket()`
on initial connect AND every reconnect; a failed initial connect schedules a reconnect (`active` is
true, `close` fires). Backoff (`backoff.ts`): `baseMs=500, capMs=10_000`, full jitter → after ~5 fails
each retry waits up to **10 s** → **alone violates "within a few seconds."** **Runtime inference (NOT
code-assertable, §6.1):** the leading hypothesis for a *stalled* (not just slow) loop is WKWebView
occlusion / App-Nap throttling of `setTimeout` in the `visible:false` main window — which is why a
restart (re-running first connect before occlusion) was the only recovery. **Any JS-in-hidden-main
mechanism shares this failure surface** → the fix must leave that context.

### Diagnosis point 3 — memory.ts is one-shot (defect cluster 2A + window-half of 2B)

**Confirmed (code fact).** `memory.ts` runs a single `fetch` at load and never re-checks → stale
"Connected" after a kill (2A) and stale "unreachable" after a later start (window-half of 2B). The
memory window is **visible** when its state matters → its own JS loop is alive → a periodic + on-focus
re-check fixes both halves (a status-poll, not an auto-hide timer → unrelated to #33/#34; Lior allowed it).

### Diagnosis point 4 — one source of truth for the tray

**Confirmed (code fact).** Today the tray is driven solely by `main.ts`'s `onConnectionState` tap
(+ `connGeneration` guard). A second driver added without removing the first would race → the fix
makes the tray single-source.

### THE decision (runtime coupling — flagged)

- **Option A — tune the shared `ConnectionManager` reconnect (lower `capMs`).** *Rejected.* Changes the
  AGENT connection's timing (the coupling the OUT-scope forbids); stays hostage to backoff + the
  dismiss/re-create lifecycle; doesn't address the hidden-window-throttle hypothesis (same failed context).
- **Option B — dedicated health-poll as the single tray source.** *Chosen*, realized as a **Rust-side
  TCP probe** (`std::net::TcpStream::connect_timeout("127.0.0.1:7777", 1.5s)` every 3 s in a
  `std::thread`, driving the tray via `apply_tray_status`). A JS poll was considered but runs in the same
  hidden-main webview → rejected. **std::net only — no new crate.**

**Why lowest-risk:** zero agent-connection coupling (`connection-manager.ts` left **byte-unchanged** —
agent semantics provably unchanged; only the tray *wiring* is removed from `main.ts`); immune to
WKWebView throttling (not in a webview); bounded 3 s latency both directions; single source of truth.
**Reviewer, confirm:** (a) `packages/protocol/` diff empty; (b) `connection-manager.ts` byte-unchanged;
(c) `main.ts` `inFlight`/submit/hotkey/dismiss identical after tray-wiring removal; (d) the poll thread
mutates the tray only via `set_title`/`set_tooltip` (self-proxy to main thread — `tray/mod.rs`
`run_item_main_thread!`), no GUI-safety violation.

### Step 4: Memory-window lifecycle — hide-on-close + recreate-on-destroy (Rust)

**Files:** Modify `apps/overlay/src-tauri/src/lib.rs`.

**Interfaces:** native × on `memory` **hides** it (webview persists) instead of destroying; any destroy
path recovered by rebuild-from-config. "Open Memory…" then works every time.

> **FLAG-IF-UNSURE:** `app.config().app.windows` (`Vec<WindowConfig>`, `.label: String`, `Clone`) +
> `WebviewWindowBuilder::from_config` verified against tauri-2.11.2 vendored source; if a field/path
> differs at build, adjust + report. No new crate. **Demo-only (no unit test), gated by `cargo build`.**

- [ ] **Step 4.1 — Add the close-intercept + recreate fallback in `lib.rs`.**
  Imports: `use tauri::{Manager, WebviewWindowBuilder, WindowEvent};`
  Insert a Builder-level hook after `tauri::Builder::default()` and before `.setup(...)`:
  ```rust
  // Demo-1 fix (cluster 1): the memory window's native × must HIDE, not DESTROY, so
  // "Open Memory…" can re-show the SAME webview every time (a destroyed window makes
  // get_webview_window("memory") return None → dead until restart). Keeping the webview
  // alive also lets memory.ts's liveness poll (Step 5) survive close/reopen. Filtered by
  // label so main/widget are unaffected.
  .on_window_event(|window, event| {
      if window.label() == "memory" {
          if let WindowEvent::CloseRequested { api, .. } = event {
              api.prevent_close();
              let _ = window.hide();
          }
      }
  })
  ```
  In the `"open_memory"` arm, add the recreate-from-config belt-and-braces path:
  ```rust
  "open_memory" => {
      if let Some(win) = app.get_webview_window("memory") {
          let _ = win.show();
          let _ = win.unminimize();
          let _ = win.set_focus();
      } else if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "memory").cloned() {
          if let Ok(win) = WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build()) {
              let _ = win.show();
              let _ = win.set_focus();
          }
      }
  }
  ```
  (`"quit" => app.exit(0)` unchanged — `exit` bypasses per-window close, so Quit still exits.)
- [ ] **Step 4.2 — Compile.** `cd apps/overlay/src-tauri && cargo build` (clean; apply FLAG-IF-UNSURE if a name differs, never add a crate).
- [ ] **Step 4.3 — Commit.** `fix(overlay): memory window hides on close (prevent_close) + recreates if destroyed` + the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

### Step 5: Memory-window liveness — periodic + on-focus re-check (memory.ts)

**Files:** Create `apps/overlay/src/memory-liveness.ts` (pure logic, NO tauri/DOM imports → unit-testable)
+ `apps/overlay/src/memory-liveness.test.ts`; modify `apps/overlay/src/memory.ts`.

**Interfaces:** `runMemoryCheck(fetchFn,url,token,timeoutMs?) → Promise<MemoryCheckResult>` and
`createMemoryLiveness(deps) → { start; checkNow; stop }`. `memory.ts` renders every state + forces a
re-check on `focus`/`visibilitychange`. Interacts with Step 4 (hide-on-close keeps the webview alive →
memory.ts does NOT re-run on re-open → forced `checkNow()` prevents stale state).

- [ ] **Step 5.1 — Write failing tests** `memory-liveness.test.ts`: `runMemoryCheck` maps 200→connected(N threads),
  401→unauthorized, 500→unreachable(HTTP 500), network-error→unreachable; token rides `Authorization: Bearer`
  and is NEVER in the URL (ADR-0013); `createMemoryLiveness` flips connected→unreachable→connected across
  simulated ticks (Demo-1 2A + 2B window-half). (Full test bodies as authored by the architect — inject
  `setIntervalFn`/`clearIntervalFn`, use a mode-switched fake fetch.)
- [ ] **Step 5.2 — Run; verify FAIL** (module missing).
- [ ] **Step 5.3 — Create `memory-liveness.ts`** — `runMemoryCheck` (never throws; maps every path to a
  state; `AbortController` timeout `2500ms`; Bearer header only) + `createMemoryLiveness` (default
  `intervalMs=3000`; injectable `setIntervalFn`/`clearIntervalFn`; `isHidden` gate to skip while hidden;
  `inFlight` guard so fetches never stack; `start()` does an immediate check + interval; `checkNow()`
  forces one; `stop()` clears). NO tauri/DOM imports.
- [ ] **Step 5.4 — Run; verify GREEN.**
- [ ] **Step 5.5 — Refactor `memory.ts`** to read the token (unchanged), build `createMemoryLiveness`
  with `fetchFn:(u,i)=>fetch(u,i)`, `isHidden:()=>document.hidden`, `onState: render`; `liveness.start()`;
  add `window.addEventListener("focus", () => liveness.checkNow())` +
  `document.addEventListener("visibilitychange", () => { if (!document.hidden) liveness.checkNow(); })`.
  Keep the honest-state `render` (no-token/unreachable/unauthorized/connected). Status-poll only — never
  changes visibility (unrelated to #33/#34).
- [ ] **Step 5.6 — Verify gates:** `bun run typecheck`, `bun run lint:strict`, `bun test`; `git diff --stat packages/protocol/` empty.
- [ ] **Step 5.7 — Commit.** `fix(overlay): memory window re-checks daemon liveness (poll + focus/visibility)` + trailer.

### Step 6: Tray liveness — Rust TCP health poll (single source) + remove JS tray driver

**Files:** Modify `apps/overlay/src-tauri/src/lib.rs` + `apps/overlay/src/main.ts`.

**Interfaces:** a Rust `std::thread` probes `127.0.0.1:7777` every 3 s and drives the tray glyph via a
shared `apply_tray_status(&AppHandle, &str)` in BOTH directions; `main.ts` no longer pushes tray status
(Rust poll = single source). Apply **after** Step 4 (both touch `lib.rs`, disjoint regions).

> **FLAG-IF-UNSURE:** `app.handle().clone() → AppHandle` (Send+Sync); `set_title`/`set_tooltip`
> self-proxy to the main thread (`tray/mod.rs` `run_item_main_thread!`) → safe from the poll thread.
> If a thread-safety error appears, wrap the mutation in `app.handle().run_on_main_thread(...)`
> (`app.rs:495`). `std::net` is std — no new crate. Demo-only (no unit test).

- [ ] **Step 6.1 — Refactor tray sink + add the Rust poll in `lib.rs`.** Extract
  `fn apply_tray_status(app:&AppHandle, status:&str)` (glyph ●/◐/○ + tooltip, via `tray_by_id("main-tray")`
  → `set_title`/`set_tooltip`); make `#[tauri::command] set_tray_status` a thin wrapper calling it
  (retained for a future JS-driven "busy"). Inside `setup(...)`, after `let _tray = ….build(app)?;` and
  before `Ok(())`, spawn:
  ```rust
  {
      let handle = app.handle().clone();
      std::thread::spawn(move || {
          use std::net::{SocketAddr, TcpStream};
          use std::time::Duration;
          let addr: SocketAddr = "127.0.0.1:7777".parse().expect("valid daemon socket addr");
          let mut last: Option<&str> = None;
          loop {
              let status = if TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok() { "connected" } else { "disconnected" };
              if last != Some(status) { last = Some(status); apply_tray_status(&handle, status); }
              std::thread::sleep(Duration::from_secs(3));
          }
      });
  }
  ```
  (Leave `generate_handler![hide_panel, read_auth_token, set_tray_status]` unchanged.)
- [ ] **Step 6.2 — Compile.** `cd apps/overlay/src-tauri && cargo build` (clean; FLAG-IF-UNSURE → `run_on_main_thread` fallback).
- [ ] **Step 6.3 — Remove the JS tray driver in `main.ts`** (reverts Step 3.5 + the gen-guard; Rust poll
  is now sole source): delete `pushTrayStatus` + `type TrayStatus` (replace with a one-line note that tray
  is Rust-driven); both `ConnectionManager` construction sites revert to
  `new ConnectionManager(factory, authToken); connection.connect();` (delete `connGeneration`/`gen0`/`gen`
  + the `onConnectionState` option + the stale review-fix comment). **Do NOT touch `connection-manager.ts`**
  — the additive `onConnectionState` tap + its 2 tests stay (now unused by tray, retained for a future
  in-window indicator) → `connection-manager.ts` byte-unchanged → agent semantics provably unchanged.
- [ ] **Step 6.4 — Verify gates:** `bun run typecheck`, `bun run lint:strict`, `bun test` (the
  `onConnectionState` tests still pass — `ConnectionManager` unchanged); `git diff --stat packages/protocol/` empty.
- [ ] **Step 6.5 — Commit.** `fix(overlay): drive tray liveness from a Rust TCP health poll (single source)` + trailer.

### Verification (Demo-1 fix — DoD mapping)

**Mechanical (worker now):** `git diff packages/protocol/` empty (5.6, 6.4); `connection-manager.ts`
byte-unchanged (assert in 6); `bun test`/`lint:strict`/`typecheck` green (5.4, 5.6, 6.4); `cargo build`
clean (4.2, 6.2); `memory-liveness` state-machine + `runMemoryCheck` tri-state/token-discipline covered.

**Behavioral — ALL "requires live macOS demo to confirm" (Demo-2; §6.1):** close-×-then-reopen works
every time (Step 4); window open+Connected → kill daemon → unreachable within seconds, no restart (Step 5, 2A);
window open+unreachable → start daemon → Connected, no restart + re-focus re-checks (Step 5, 2B window-half);
tray reflects up↔down both directions within seconds incl. launch-down→start recovery (Step 6, 2B tray).
Runtime risk: confirm the Rust poll's tray mutation renders from the spawned thread; else apply the
`run_on_main_thread` fallback.

## ADR worthy: no

Window hide-on-close + recreate-from-config = standard Tauri lifecycle. The memory-window poll +
focus/visibility re-check and the tray Rust TCP poll are read-only **status polls** Lior explicitly
authorized; no protocol change, no new route, no new dep (std::net only; window reuses the shipped CORS'd
`GET /memory/threads`), no new boundary; the tray poll executes ADR-0006 p.4. **Reviewer escalation
clause:** if the reviewer judges (a) the Rust process probing the daemon TCP port, or (b) reusing
`GET /memory/threads` as a health signal, a NEW posture beyond ADR-0006 p.4 / ADR-0013, escalate to
`adr-curator` for a note/rider (not a new ADR) before merge.

## Risks & flags (Demo-1 fixes)

- **Runtime-coupling flag (reviewer):** tray liveness deliberately moved OUT of the shared agent
  `ConnectionManager` into a Rust probe → NO agent-connection semantics change; `connection-manager.ts`
  byte-unchanged; confirm `main.ts` `inFlight`/submit/hotkey/dismiss unchanged after tray-wiring removal.
- **Steps 4 and 6 both touch `lib.rs`** (disjoint regions) — sequential, Step 4 before Step 6.
- **`onConnectionState` tap now unused by the tray** but retained (additive, tested) — deliberate low-churn
  choice to keep `ConnectionManager` byte-unchanged; do NOT delete here.
- **Two localhost pollers** while both surfaces alive (Rust tray probe 3 s + memory-window JS poll 3 s
  when visible) — negligible on localhost; JS poll skips while `document.hidden`.
- **Hidden-window-throttling is a hypothesis, not a code fact** (§6.1) — the Rust probe is robust
  regardless of the true 2B root; Demo-2 confirms.
- **Tray signal is coarser** (TCP-accept vs full WS/token handshake) and demo-only (no JS unit test) —
  acceptable for a coarse ADR-0006 p.4 glyph; JS-fetch variant is a one-paragraph swap if Lior prefers.


---
---

# ══════════════ CHUNK 2 (appended by orchestrator, 2026-07-02) ══════════════

> Chunk-01 plan is above (shipped, PR #75). Below is chunk-02 (read-side VIEW).
> Same per-feature plan file; chunk-04 archives the whole file at feature closeout.

# Memory Window — VIEW (threads, facts, provenance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is **chunk-02** of feature `memory-transparency-ui` (backlog Theme A). Scope is FROZEN by `orchestration/chunks-todo/memory-transparency-ui/02-memory-window-view.md` — you may FLAG problems, do not exceed or edit it.

**Goal:** Grow the shipped chunk-01 `memory` window into the real read UI — a threads list, a thread-detail view (messages + all current distilled facts + distillation events including the "0 facts / deliberately-retained-nothing" event), per-fact thread-level provenance rendered as a jump-link to the source thread's detail, and the expiry/confidence "show only when non-default" display rule — at feature-parity with `history.html`'s read side, native-window, zero token paste.

**Architecture:** Pure, unit-testable data + display modules under `apps/overlay/src/memory/` (fetch mapping, provenance parse, expiry/confidence rule, event labelling) split out of `memory.ts`; thin DOM render + controller glue on top; the daemon is consumed unchanged except one small **additive, flagged** field (`status`) on the existing `GET /memory/threads` payload (the chunk's sanctioned "small additive read gap"). The CORS seam and token-gated read routes already shipped in chunk-01 — no re-touch of the security-adjacent `http-routes.ts`.

**Tech Stack:** Vite multi-page frontend (system WebView, already multi-page — `memory.html` is a registered entry); standard browser `fetch` with `Authorization: Bearer` header; Bun test runner + happy-dom (`test-setup/dom-preload.ts`, root `bunfig.toml`) for DOM render tests; Bun + TypeScript daemon (`bun:sqlite`).

## Global Constraints

Copied verbatim from the chunk + spec + ADRs; every step's requirements implicitly include these:

- **`@agentic/protocol` is FROZEN — `git diff packages/protocol/` MUST be empty.** Any protocol change → **freeze gate** (human review, no auto-merge) → STOP and escalate. This is an engine-owned native surface (ADR-0005), NOT closed-set protocol primitives; adding a `@agentic/protocol` primitive here is a freeze-gate stop.
- **Token discipline (ADR-0013):** the per-install bearer token travels ONLY in the `Authorization: Bearer <token>` HTTP header on reads. NEVER logged, NEVER in a URL / query string. Read Rust-side via the existing `read_auth_token` command — no manual paste by construction.
- **Expiry/confidence display rule (spec ruling 2026-07-02):** render these fields **only when non-default** (`expiry !== null`, `confidence !== 1`). Today that means effectively hidden. Build NO scoring / decay / editing — display-only, gated on non-default.
- **0-fact distillation event** must render as an observable event ("deliberately retained nothing"), matching `history.html` (ADR-0012 decision 5b guarantee).
- **`HATCH_VIEW_FACT_CAP = 1000`** — the view returns all facts below the cap; **no pagination** (single-user scale). Do not build paging.
- **OUT of scope (do not build):** edit/forget actions (chunk-03), any change to `history.html` (chunk-04), in-answer provenance affordance (carved out), message-level provenance (closed), new daemon read *routes*.
- **Two-zone UX intact (ADR-0006):** the memory surface is opened from the tray (chunk-01), not from the launcher summon-flow. Do not touch the launcher/agent-connection path.
- **No new runtime dependencies** (no ADR budget in this chunk). Dev-only helpers are fine.
- **CI gate:** `bun test`, `bun run lint:strict` (`--max-warnings=0`), `bun run typecheck` all green.

---

## Status

`Phase 3 — Implementation Plan: Done.` Execution-ready. No blocking open questions — the two design forks (the `status` field, and the disposition of the dead `onConnectionState` tap / retained `set_tray_status`) are resolved below with the lowest-churn call and flagged for the reviewer.

---

## Reality check

All statements below are **code-path existence facts** verified by reading source (paths + lines cited). Per PIPELINE §6.1, no behavioral/runtime claim is asserted as verified; behavioral DoD items are marked **"requires live macOS demo to confirm"** in `## Verification`.

- **The two read routes exist and are token-gated (Bearer).** `packages/daemon/src/memory/http-routes.ts`: `GET /memory/threads` → `handleThreads` (`:107`, `:146-150`) returns `Response.json({ threads: store.listThreads() })` after `tokenStore.verify(authorization)` → `401` on missing/bad (`:147`). `GET /memory/thread/:id` → `handleThread` (`:113`, `:152-170`) decodes the id (malformed `%`-seq → `400 bad_target_shape`, `:161-166`), then token-verifies, then returns `Response.json(await hatch.view(id))` (`:168-169`).
- **The CORS seam already covers BOTH GET reads.** `handleMemoryHttp` (`:70-97`) wraps `route()` and stamps `Access-Control-Allow-Origin: <reflected>` + `Vary: Origin` on every `/memory/*` response when the origin is allowlisted (`origin.ts` allowlist, never `*`), and answers `OPTIONS` preflight `204`. So chunk-02's GET reads need **ZERO re-touch of `http-routes.ts`**. (Cross-chunk inheritance #1, confirmed in source.)
- **`hatch.view(id)` returns the full-slice shape.** `packages/daemon/src/memory/hatch.ts:31-64`: `{ messages, distilledFacts, distillationEvents }`. `messages` = `store.readThreadArchive(threadId)` (turn order ASC; tombstoned rows surface as `REDACTION_MARKER` = `"[forgotten]"` — `schema.ts:26`, `store.ts:745-749`). `distilledFacts` = `store.readDistilledFacts(HATCH_VIEW_FACT_CAP=1000)` — **ALL facts in the store (the live projection), newest-first (`derived_at DESC`), NOT scoped to the viewed thread** (`hatch.ts:57-58`, `store.ts:285-290`). `distillationEvents` = `store.readDistillationEvents(threadId)` — for THIS thread, `created_at ASC`, **verbatim incl. `facts_produced===0`** (`hatch.ts:59-62`, `store.ts:710-714`).
- **Distilled facts carry `thread:<id>` provenance today.** The v2 SmartDistiller stamps `provenance = \`thread:${threadId}\`` for all machine facts (`distiller-registration.ts:178,265,287`). So the per-fact provenance jump-link (parse `thread:<id>` → open that thread's detail) resolves for **real** facts. Legacy/other provenance shapes (bare `messages.id`, comma-joined ids) exist in older/test data and are not client-resolvable to a thread → render as plain text (graceful, `history.html` parity).
- **`listThreads()` returns `{ thread_id, title, last_active_at }` — NO `status`.** `store.ts:795-799` selects only those three columns. The `threads` table HAS a meaningful `status` column (`schema.ts:33`, `'active' | 'dismissed'`) that **does** transition to `'dismissed'` at dismiss (`consolidation-hook.ts:43` `UPDATE threads SET status = 'dismissed'`). The chunk Scope-IN names "Threads list … with status" → this is the "small + additive read gap the spec anticipates" (Anchors "Backend is ready"). Resolved in Step 1 (additive `status` on the SELECT + return type; NOT a new route, NOT the auth file).
- **`history.html` (the parity target) is the information reference.** `packages/daemon/src/memory/history-page.ts` renders: thread list (`title || thread_id` + `thread_id · formatDate(last_active_at)`, `:262-275`); messages (`role · turn N` + content via `textContent`, `:303-344`); facts (`f.fact`, then `provenance / scope / authored_by` meta, `:346-391`); events (`"0 facts (deliberately retained nothing)"` when `facts_produced===0` else `"N facts produced"` + trigger + date, `:393-428`). All API strings inserted via `textContent`/`createElement`, NEVER `innerHTML` (XSS discipline, `:12`). `history.html` does NOT render `status` or the expiry/confidence fields — chunk-02 adds status (via Step 1) and the non-default-only expiry/confidence rule.
- **The chunk-01 shell is on main and reusable.** `apps/overlay/src/memory.ts` reads the token via `invoke("read_auth_token")` and runs `createMemoryLiveness` (`apps/overlay/src/memory-liveness.ts`) → an honest banner (`no-token` / `unreachable` / `unauthorized` / `connected`) on `#conn-state` in `apps/overlay/memory.html`. Reuse this banner as the top-of-window connection state; add per-fetch honest states in the new data views.
- **`memory.html` is already a registered Vite entry** (chunk-01 plan Step 3.6 added `memory` to `rollupOptions.input`) — confirm `vite.config.ts` still lists it; **no vite change expected**.
- **DOM tests run under happy-dom.** Root `bunfig.toml` `preload = ["./test-setup/dom-preload.ts"]` sets up `document`/`HTMLElement` globals; `apps/overlay/src/widgets/text-reply.test.ts` is the render-test template (`document.createElement` host + `querySelector`/`textContent` assertions).
- **Dead-tap disposition (cross-chunk inheritance #3) — DECIDED: LEAVE AS-IS.** Chunk-01 left `ConnectionManager.onConnectionState` (additive, tested, unused by the tray since the Rust TCP poll became the single source) and a retained `set_tray_status` command. The memory window does NOT hold the agent `ConnectionManager` (that's the main window); it uses its own `memory-liveness` poll — so there is nothing here to *consume*. *Removing* the tap would re-touch `connection-manager.ts` (the byte-unchanged agent-connection surface chunk-01 deliberately froze to prove agent semantics unchanged) and `main.ts` for zero functional gain in a read-only view chunk. Lowest-churn + agent-connection-safe call: leave both untouched; noted as out-of-scope hygiene. Do NOT expand the chunk for this.
- **No scope problem requiring a chunk-file edit.** One flag: the Scope-IN phrase "with status" is delivered via a small additive daemon change (Step 1) rather than pure `history.html` parity (which omits status). See `## Risks & flags`.

---

## Fetched JSON shapes (the contract the overlay depends on)

Frontend declares these locally in `apps/overlay/src/memory/types.ts` — it does **not** import daemon types (the overlay is a separate bundle; `history.html` likewise re-declares). Shapes mirror `hatch.ts` / `store.ts` exactly.

**`GET /memory/threads`** → `200`:
```jsonc
{
  "threads": [
    {
      "thread_id": "…uuid…",
      "title": "…string or null…",
      "last_active_at": 1730000000000,   // epoch ms
      "status": "active"                  // "active" | "dismissed" — present ONLY after Step 1 lands (additive; optional in the UI)
    }
  ]
}
```
Ordered `last_active_at DESC`. `401` (bad/missing token) → `{ "error": "Unauthorized" }`.

**`GET /memory/thread/:id`** → `200` (the `HatchViewResult`):
```jsonc
{
  "messages": [
    { "id": "…uuid…", "role": "user", "content": "…text… (or \"[forgotten]\" if tombstoned)" }
  ],                                       // turn order ASC
  "distilledFacts": [                      // ALL facts in the store (full slice), newest-first, cap 1000 — NOT thread-scoped
    {
      "id": "…uuid…",                      // stable id (chunk-03's forget target; not used for actions here)
      "fact": "…display text…",
      "provenance": "thread:…uuid…",       // "thread:<id>" (v2 machine facts) | "<msgId>,<msgId>" | legacy
      "scope": "cross-thread",             // "thread-local" | "cross-thread" | "global"
      "expiry": null,                       // epoch ms or null (default null → hidden)
      "confidence": 1,                      // 0..1, default 1 (→ hidden)
      "authored_by": "machine"              // "human" | "machine"
    }
  ],
  "distillationEvents": [                   // for THIS thread, created_at ASC, verbatim incl. facts_produced===0
    { "facts_produced": 0, "trigger": "dismiss", "distiller_version": "…", "created_at": 1730000000000 }
  ]
}
```
`401` → `{ "error": "Unauthorized" }`. Malformed id → `400 { "error": "bad_target_shape" }`.

---

## File structure

**Daemon (Step 1) — additive, flagged, droppable; touches the store, NOT the auth file:**
- Modify: `packages/daemon/src/memory/store.ts` — `listThreads()` SELECT + return type gain `status`.
- Create: `packages/daemon/src/memory/list-threads-status.daemon.test.ts` — real-store test (no mocks).

**Overlay — pure data + display (Step 2):**
- Create: `apps/overlay/src/memory/types.ts` — wire shapes (above).
- Create: `apps/overlay/src/memory/memory-api.ts` + `memory-api.test.ts` — token-gated fetch mapping.
- Create: `apps/overlay/src/memory/fact-view.ts` + `fact-view.test.ts` — provenance parse + expiry/confidence rule + event label + date format.

**Overlay — render + controller + wiring (Step 3):**
- Create: `apps/overlay/src/memory/render.ts` + `render.test.ts` — DOM builders (happy-dom tests for the load-bearing bits).
- Create: `apps/overlay/src/memory/controller.ts` — list↔detail nav + honest states glue.
- Modify: `apps/overlay/src/memory.ts` — bootstrap the controller; keep the liveness banner.
- Modify: `apps/overlay/memory.html` — add the list/detail DOM + inline `<style>`.

**NOT touched:** `packages/protocol/**` (frozen); `apps/overlay/src/ws/connection-manager.ts`, `apps/overlay/src/main.ts`, `apps/overlay/src-tauri/**` (dead-tap left as-is; no Rust change); `packages/daemon/src/memory/http-routes.ts` (CORS + routes already cover reads); `apps/overlay/vite.config.ts` (entry already registered — verify only); `history.html` (chunk-04).

---

## Steps

### Step 1: Daemon — additive `status` on `GET /memory/threads` (small, flagged, droppable)

**Files:**
- Modify: `packages/daemon/src/memory/store.ts` (`listThreads`, `:795-799`)
- Create/Test: `packages/daemon/src/memory/list-threads-status.daemon.test.ts`

**Interfaces:**
- Produces (consumed by Step 2/3): `listThreads(): { thread_id: string; title: string | null; last_active_at: number; status: string }[]`. Additive field only — `handleThreads` passes it straight through, so the `GET /memory/threads` JSON gains a `status` key. **No route change, no auth change, no `http-routes.ts` touch.**

> **FLAG:** This is the chunk's sanctioned "small + additive read gap" (spec Anchor "Backend is ready"; chunk OUT-scope: "if a real gap appears, it must be small + additive and flagged"). It delivers the Scope-IN phrase "Threads list … with status." `status` is meaningful (`active`/`dismissed`, set at `consolidation-hook.ts:43`). If the reviewer/orchestrator prefers strict `history.html` parity (no status), **drop this entire step** — the Step-3 render helper reads `status` optionally, so the UI simply shows dates only. Nothing else depends on it.

- [ ] **Step 1.1 — Write the failing real-store test.** Create `packages/daemon/src/memory/list-threads-status.daemon.test.ts` (real `MemoryStore`, no mocks; tmpdir):
```ts
/**
 * listThreads status field — chunk-02 (memory-transparency-ui), additive read gap.
 * Real store, no mocks. Asserts each row carries `status`, and a dismissed thread
 * reports 'dismissed'. Additive-only: existing keys (thread_id/title/last_active_at)
 * unchanged. history.html (parity target) ignores the extra key.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

test("listThreads returns status for each thread; dismissed reflected", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "lt-")) });
  const active = store.createThread("Active one");
  const dismissed = store.createThread("Dismissed one");
  store.rawDb().query("UPDATE threads SET status = 'dismissed' WHERE thread_id = ?").run(dismissed);

  const rows = store.listThreads();
  const byId = new Map(rows.map((r) => [r.thread_id, r]));
  expect(byId.get(active)?.status).toBe("active");
  expect(byId.get(dismissed)?.status).toBe("dismissed");
  // additive: original fields intact
  expect(typeof byId.get(active)?.last_active_at).toBe("number");
  store.close();
});
```

- [ ] **Step 1.2 — Run; verify it fails.** Run: `bun test packages/daemon/src/memory/list-threads-status.daemon.test.ts`. Expected: FAIL (`status` is `undefined` — not selected).

- [ ] **Step 1.3 — Implement the additive SELECT.** In `store.ts`, change `listThreads` (`:795-799`) to select and type `status`:
```ts
  /**
   * List all threads ordered by last_active_at DESC (T2.1a — additive SELECT only).
   * chunk-02: `status` added (additive; 'active' | 'dismissed', schema.ts:33). No new route.
   */
  listThreads(): { thread_id: string; title: string | null; last_active_at: number; status: string }[] {
    return this.db
      .query("SELECT thread_id, title, last_active_at, status FROM threads ORDER BY last_active_at DESC")
      .all() as { thread_id: string; title: string | null; last_active_at: number; status: string }[];
  }
```

- [ ] **Step 1.4 — Run; verify green + no regression.** Run: `bun test packages/daemon/src/memory/list-threads-status.daemon.test.ts` (Expected: PASS), then `bun test packages/daemon/src/memory/` (Expected: all PASS). If any existing test does a strict deep-equal on a `listThreads` row shape (e.g. `toEqual([{ thread_id, title, last_active_at }])`), update it **additively** to include `status`. Then `bun run lint:strict` + `bun run typecheck`.

- [ ] **Step 1.5 — Commit.**
```bash
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/list-threads-status.daemon.test.ts
git commit -m "feat(memory-http): additive status field on listThreads (/memory/threads) — chunk-02

Small additive read gap (spec Anchor 'Backend is ready'); no new route, auth unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Step 2: Overlay — pure data + display modules (TDD; the mechanical DoD lives here)

**Files:**
- Create: `apps/overlay/src/memory/types.ts`
- Create: `apps/overlay/src/memory/memory-api.ts` + `apps/overlay/src/memory/memory-api.test.ts`
- Create: `apps/overlay/src/memory/fact-view.ts` + `apps/overlay/src/memory/fact-view.test.ts`

**Interfaces:**
- Consumes: Step 1's `status` field (optional in the type); the chunk-01 CORS'd read routes.
- Produces (consumed by Step 3): `ThreadSummary`, `HatchView`, `DistilledFactView`, `DistillationEventView`, `ThreadMessage` (types); `type FetchResult<T>`, `MemoryApiDeps`, `fetchThreads(deps)`, `fetchThread(deps, id)`; `type ProvenanceRef`, `parseProvenance(raw)`, `shouldShowExpiry(f)`, `shouldShowConfidence(f)`, `eventLabel(e)`, `formatTs(ts)`.

- [ ] **Step 2.1 — Create the types module.** `apps/overlay/src/memory/types.ts`:
```ts
/** Wire shapes the memory window fetches (frontend-local; mirrors daemon hatch.ts/store.ts).
 *  Do NOT import daemon types — the overlay is a separate bundle. */
export interface ThreadSummary {
  thread_id: string;
  title: string | null;
  last_active_at: number;
  status?: string; // "active" | "dismissed" — present iff Step 1 landed; optional by design
}
export interface ThreadMessage { id: string; role: string; content: string } // content may be "[forgotten]"
export interface DistilledFactView {
  id: string;
  fact: string;
  provenance: string; // "thread:<uuid>" | "<msgId>,<msgId>" | legacy
  scope: string;      // "thread-local" | "cross-thread" | "global"
  expiry: number | null;
  confidence: number;
  authored_by: string;
}
export interface DistillationEventView {
  facts_produced: number;
  trigger: string;
  distiller_version: string;
  created_at: number;
}
export interface HatchView {
  messages: ThreadMessage[];
  distilledFacts: DistilledFactView[];
  distillationEvents: DistillationEventView[];
}
```

- [ ] **Step 2.2 — Write failing tests for the fetch layer.** `apps/overlay/src/memory/memory-api.test.ts`:
```ts
/**
 * memory-api — token-gated fetch mapping. ADR-0013: Bearer header ONLY, never in URL.
 * Fake fetchFn records the (url, init) it was called with; no real network.
 */
import { test, expect } from "bun:test";
import { fetchThreads, fetchThread, type MemoryApiDeps } from "./memory-api.js";

function fakeFetch(status: number, body: unknown, calls: { url: string; init?: RequestInit }[]) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (status === 0) return Promise.reject(new Error("network"));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}
function deps(fetchFn: MemoryApiDeps["fetchFn"]): MemoryApiDeps {
  return { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK", timeoutMs: 1000 };
}

test("fetchThreads 200 → ok with parsed data", async () => {
  const r = await fetchThreads(deps(fakeFetch(200, { threads: [{ thread_id: "a", title: null, last_active_at: 1 }] }, [])));
  expect(r.kind).toBe("ok");
  if (r.kind === "ok") expect(r.data.threads[0]!.thread_id).toBe("a");
});
test("fetchThreads 401 → unauthorized", async () => {
  expect((await fetchThreads(deps(fakeFetch(401, { error: "Unauthorized" }, [])))).kind).toBe("unauthorized");
});
test("fetchThreads 500 → unreachable", async () => {
  expect((await fetchThreads(deps(fakeFetch(500, {}, [])))).kind).toBe("unreachable");
});
test("fetchThreads network error → unreachable", async () => {
  expect((await fetchThreads(deps(fakeFetch(0, {}, [])))).kind).toBe("unreachable");
});
test("token rides Authorization header and is NEVER in the URL (ADR-0013)", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await fetchThreads(deps(fakeFetch(200, { threads: [] }, calls)));
  expect(calls[0]!.url).not.toContain("TOK");
  expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
});
test("fetchThread encodes the id into the path, not a query", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await fetchThread(deps(fakeFetch(200, { messages: [], distilledFacts: [], distillationEvents: [] }, calls)), "a b/c");
  expect(calls[0]!.url).toBe("http://127.0.0.1:7777/memory/thread/a%20b%2Fc");
  expect(calls[0]!.url).not.toContain("TOK");
});
```

- [ ] **Step 2.3 — Run; verify they fail.** Run: `bun test apps/overlay/src/memory/memory-api.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2.4 — Implement the fetch layer.** `apps/overlay/src/memory/memory-api.ts`:
```ts
/**
 * memory-api (chunk-02, memory-transparency-ui) — pure token-gated fetch mapping.
 * ADR-0013: token in the Authorization: Bearer header ONLY — never logged, never in a
 * URL/query. Every path maps to a discriminated FetchResult so the UI renders an honest
 * state (never a stuck "Loading…"). fetchFn is injected → unit-testable without network.
 */
import type { HatchView, ThreadSummary } from "./types.js";

export type FetchResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthorized" }
  | { kind: "unreachable" };

export interface MemoryApiDeps {
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

async function getJson<T>(deps: MemoryApiDeps, path: string): Promise<FetchResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 4000);
  try {
    const res = await deps.fetchFn(`${deps.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${deps.token}` }, // ADR-0013 — header only
      signal: ctrl.signal,
    });
    if (res.status === 401) return { kind: "unauthorized" };
    if (!res.ok) return { kind: "unreachable" };
    return { kind: "ok", data: (await res.json()) as T };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export function fetchThreads(deps: MemoryApiDeps): Promise<FetchResult<{ threads: ThreadSummary[] }>> {
  return getJson(deps, "/memory/threads");
}
export function fetchThread(deps: MemoryApiDeps, threadId: string): Promise<FetchResult<HatchView>> {
  return getJson(deps, `/memory/thread/${encodeURIComponent(threadId)}`);
}
```

- [ ] **Step 2.5 — Run; verify green.** Run: `bun test apps/overlay/src/memory/memory-api.test.ts`. Expected: PASS.

- [ ] **Step 2.6 — Write failing tests for the display helpers.** `apps/overlay/src/memory/fact-view.test.ts`:
```ts
import { test, expect } from "bun:test";
import {
  parseProvenance, shouldShowExpiry, shouldShowConfidence, eventLabel, formatTs,
} from "./fact-view.js";

test("parseProvenance: thread:<id> → thread ref", () => {
  expect(parseProvenance("thread:abc")).toEqual({ kind: "thread", threadId: "abc" });
});
test("parseProvenance: bare msg-id / comma-list / empty-after-prefix → text", () => {
  expect(parseProvenance("11111111-1111-1111-1111-111111111111").kind).toBe("text");
  expect(parseProvenance("id1,id2").kind).toBe("text");
  expect(parseProvenance("thread:").kind).toBe("text");
});
test("expiry rule: shown only when non-default (non-null)", () => {
  expect(shouldShowExpiry({ expiry: null })).toBe(false);
  expect(shouldShowExpiry({ expiry: 1730000000000 })).toBe(true);
});
test("confidence rule: shown only when non-default (!== 1)", () => {
  expect(shouldShowConfidence({ confidence: 1 })).toBe(false);
  expect(shouldShowConfidence({ confidence: 0.5 })).toBe(true);
});
test("eventLabel: 0 facts is an observable event, not a gap (ADR-0012 5b)", () => {
  expect(eventLabel({ facts_produced: 0 })).toBe("0 facts (deliberately retained nothing)");
  expect(eventLabel({ facts_produced: 1 })).toBe("1 fact produced");
  expect(eventLabel({ facts_produced: 3 })).toBe("3 facts produced");
});
test("formatTs: null → em-dash; number → non-empty", () => {
  expect(formatTs(null)).toBe("—");
  expect(formatTs(1730000000000).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2.7 — Run; verify they fail.** Run: `bun test apps/overlay/src/memory/fact-view.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2.8 — Implement the display helpers.** `apps/overlay/src/memory/fact-view.ts`:
```ts
/**
 * fact-view (chunk-02, memory-transparency-ui) — pure display helpers.
 * ADR-0012 5c: thread-level provenance display. Spec ruling 2026-07-02: expiry/confidence
 * shown ONLY when non-default (display-only; no scoring/decay/editing). ADR-0012 5b: a
 * 0-fact distillation event is an OBSERVABLE "deliberately retained nothing", never a gap.
 */
import type { DistilledFactView, DistillationEventView } from "./types.js";

export type ProvenanceRef =
  | { kind: "thread"; threadId: string }
  | { kind: "text"; raw: string };

/** Parse a provenance string. Only the "thread:<id>" shape is a client-resolvable jump
 *  target; message-id lists / legacy shapes render as plain text (history.html parity). */
export function parseProvenance(raw: string): ProvenanceRef {
  if (raw.startsWith("thread:")) {
    const threadId = raw.slice("thread:".length);
    if (threadId) return { kind: "thread", threadId };
  }
  return { kind: "text", raw };
}

export function shouldShowExpiry(f: Pick<DistilledFactView, "expiry">): boolean {
  return f.expiry !== null && f.expiry !== undefined;
}
export function shouldShowConfidence(f: Pick<DistilledFactView, "confidence">): boolean {
  return f.confidence !== 1;
}

export function eventLabel(e: Pick<DistillationEventView, "facts_produced">): string {
  return e.facts_produced === 0
    ? "0 facts (deliberately retained nothing)"
    : `${e.facts_produced} fact${e.facts_produced === 1 ? "" : "s"} produced`;
}

export function formatTs(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "—";
  const n = typeof ts === "number" ? ts : Number(ts);
  return Number.isNaN(n) ? String(ts) : new Date(n).toLocaleString();
}
```

- [ ] **Step 2.9 — Run; verify green + gates.** Run: `bun test apps/overlay/src/memory/` (Expected: PASS), then `bun run lint:strict` + `bun run typecheck`.

- [ ] **Step 2.10 — Commit.**
```bash
git add apps/overlay/src/memory/types.ts apps/overlay/src/memory/memory-api.ts apps/overlay/src/memory/memory-api.test.ts apps/overlay/src/memory/fact-view.ts apps/overlay/src/memory/fact-view.test.ts
git commit -m "feat(overlay): memory read-UI data+display helpers (fetch mapping, provenance, expiry/confidence rule, 0-fact label)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Step 3: Overlay — render + controller + HTML/CSS wiring

**Files:**
- Create: `apps/overlay/src/memory/render.ts` + `apps/overlay/src/memory/render.test.ts`
- Create: `apps/overlay/src/memory/controller.ts`
- Modify: `apps/overlay/src/memory.ts`, `apps/overlay/memory.html`

**Interfaces:**
- Consumes: Step 2's api + fact-view; the existing `read_auth_token` + `createMemoryLiveness`.
- Produces: `renderThreadList(listEl, threads, onOpen)`, `renderMessages(el, msgs)`, `renderFacts(el, facts, onOpenThread)`, `renderEvents(el, events)`, `renderState(el, kind, elementTag?)`; `createMemoryController(deps): { start(): void }`.
- **XSS discipline (mirror `history.html` / `text-reply.ts`): all API-derived strings via `textContent`/`createElement` — NEVER `innerHTML`.**

- [ ] **Step 3.1 — Write failing render tests (happy-dom).** `apps/overlay/src/memory/render.test.ts`:
```ts
/**
 * DOM-harness tests for the memory read-UI renderers (happy-dom via test-setup/dom-preload).
 * Covers the load-bearing DoD bits: 0-fact event label, per-fact provenance jump-link +
 * callback, and the expiry/confidence "shown only when non-default" rule.
 */
import { test, expect } from "bun:test";
import { renderFacts, renderEvents, renderThreadList } from "./render.js";
import type { DistilledFactView, DistillationEventView, ThreadSummary } from "./types.js";

function host(): HTMLElement { const d = document.createElement("div"); document.body.appendChild(d); return d; }
const baseFact: DistilledFactView = {
  id: "f1", fact: "likes blue", provenance: "thread:T1", scope: "cross-thread",
  expiry: null, confidence: 1, authored_by: "machine",
};

test("renderEvents: a 0-fact event renders the 'deliberately retained nothing' label", () => {
  const el = host();
  const ev: DistillationEventView = { facts_produced: 0, trigger: "dismiss", distiller_version: "v", created_at: 1 };
  renderEvents(el, [ev]);
  expect(el.textContent).toContain("deliberately retained nothing");
});

test("renderFacts: thread:<id> provenance is a jump-link firing onOpenThread(id)", () => {
  const el = host();
  let opened: string | null = null;
  renderFacts(el, [baseFact], (id) => { opened = id; });
  const link = el.querySelector<HTMLElement>(".prov-link");
  expect(link).not.toBeNull();
  link!.click();
  expect(opened).toBe("T1");
});

test("renderFacts: non-thread provenance renders as text, no jump-link", () => {
  const el = host();
  renderFacts(el, [{ ...baseFact, provenance: "id1,id2" }], () => {});
  expect(el.querySelector(".prov-link")).toBeNull();
  expect(el.textContent).toContain("id1,id2");
});

test("renderFacts: default expiry/confidence → NO expiry/confidence chrome", () => {
  const el = host();
  renderFacts(el, [baseFact], () => {});
  expect(el.querySelector(".fact-expiry")).toBeNull();
  expect(el.querySelector(".fact-confidence")).toBeNull();
});

test("renderFacts: non-default expiry/confidence ARE shown", () => {
  const el = host();
  renderFacts(el, [{ ...baseFact, expiry: 1730000000000, confidence: 0.5 }], () => {});
  expect(el.querySelector(".fact-expiry")).not.toBeNull();
  expect(el.querySelector(".fact-confidence")).not.toBeNull();
});

test("renderThreadList: click fires onOpen(thread_id); status shown when present", () => {
  const el = host();
  let opened: string | null = null;
  const t: ThreadSummary = { thread_id: "T9", title: "Hi", last_active_at: 1, status: "dismissed" };
  renderThreadList(el, [t], (id) => { opened = id; });
  expect(el.textContent).toContain("dismissed");
  el.querySelector<HTMLElement>(".thread-list-item")!.click();
  expect(opened).toBe("T9");
});
```

- [ ] **Step 3.2 — Run; verify they fail.** Run: `bun test apps/overlay/src/memory/render.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3.3 — Implement the renderers.** `apps/overlay/src/memory/render.ts`:
```ts
/**
 * render (chunk-02, memory-transparency-ui) — DOM builders for the memory read UI.
 * XSS discipline (history.html / text-reply.ts): all API-derived strings via textContent/
 * createElement — NEVER innerHTML. Uses the pure fact-view helpers for the display rules.
 */
import type { ThreadSummary, ThreadMessage, DistilledFactView, DistillationEventView } from "./types.js";
import {
  parseProvenance, shouldShowExpiry, shouldShowConfidence, eventLabel, formatTs,
} from "./fact-view.js";

function clear(el: HTMLElement): void { el.replaceChildren(); }

/** Honest per-view state (empty / locked / daemon-down), reusing the chunk-01 tone. */
export function renderState(el: HTMLElement, message: string, tag: keyof HTMLElementTagNameMap = "p"): void {
  clear(el);
  const p = document.createElement(tag);
  p.className = "empty";
  p.textContent = message;
  el.appendChild(p);
}

export function renderThreadList(listEl: HTMLElement, threads: ThreadSummary[], onOpen: (id: string) => void): void {
  clear(listEl);
  if (threads.length === 0) { renderState(listEl, "No threads yet.", "li"); return; }
  for (const t of threads) {
    const li = document.createElement("li");
    li.className = "thread-list-item";
    const title = document.createElement("div");
    title.className = "thread-title";
    title.textContent = t.title || t.thread_id;
    const meta = document.createElement("div");
    meta.className = "thread-meta";
    const status = t.status ? ` · ${t.status}` : "";
    meta.textContent = `${t.thread_id} · ${formatTs(t.last_active_at)}${status}`;
    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener("click", () => onOpen(t.thread_id));
    listEl.appendChild(li);
  }
}

export function renderMessages(el: HTMLElement, messages: ThreadMessage[]): void {
  clear(el);
  if (messages.length === 0) { renderState(el, "No messages."); return; }
  messages.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = `message-row role-${m.role || "unknown"}`;
    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = `${m.role || "?"} · turn ${i + 1}`;
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = m.content || ""; // may be "[forgotten]" for a tombstoned message
    row.appendChild(role);
    row.appendChild(content);
    el.appendChild(row);
  });
}

export function renderFacts(el: HTMLElement, facts: DistilledFactView[], onOpenThread: (id: string) => void): void {
  clear(el);
  if (facts.length === 0) { renderState(el, "No distilled facts."); return; }
  for (const f of facts) {
    const row = document.createElement("div");
    row.className = "fact-row";

    const factEl = document.createElement("div");
    factEl.textContent = f.fact || "";
    row.appendChild(factEl);

    // Provenance (ADR-0012 5c) — thread:<id> is a jump-link; else plain text.
    const prov = document.createElement("div");
    prov.className = "fact-meta";
    const label = document.createElement("span");
    label.textContent = "from: ";
    prov.appendChild(label);
    const ref = parseProvenance(f.provenance || "");
    if (ref.kind === "thread") {
      const link = document.createElement("a");
      link.className = "prov-link";
      link.href = "#";
      link.textContent = f.provenance;
      link.addEventListener("click", (e) => { e.preventDefault(); onOpenThread(ref.threadId); });
      prov.appendChild(link);
    } else {
      const txt = document.createElement("span");
      txt.textContent = ref.raw || "(unknown)";
      prov.appendChild(txt);
    }
    const extra = document.createElement("span");
    extra.textContent = ` · scope: ${f.scope} · ${f.authored_by}`;
    prov.appendChild(extra);
    row.appendChild(prov);

    // Expiry / confidence — SHOWN ONLY WHEN NON-DEFAULT (spec ruling 2026-07-02).
    if (shouldShowExpiry(f)) {
      const exp = document.createElement("div");
      exp.className = "fact-meta fact-expiry";
      exp.textContent = `expires: ${formatTs(f.expiry)}`;
      row.appendChild(exp);
    }
    if (shouldShowConfidence(f)) {
      const conf = document.createElement("div");
      conf.className = "fact-meta fact-confidence";
      conf.textContent = `confidence: ${f.confidence}`;
      row.appendChild(conf);
    }
    el.appendChild(row);
  }
}

export function renderEvents(el: HTMLElement, events: DistillationEventView[]): void {
  clear(el);
  if (events.length === 0) { renderState(el, "No distillation events."); return; }
  for (const e of events) {
    const row = document.createElement("div");
    row.className = "event-row";
    const line = document.createElement("div");
    const trig = document.createElement("span");
    trig.textContent = `trigger: ${e.trigger || "?"} · `;
    const count = document.createElement("span");
    count.className = "facts-count" + (e.facts_produced === 0 ? " zero-count" : "");
    count.textContent = eventLabel(e);
    line.appendChild(trig);
    line.appendChild(count);
    const date = document.createElement("div");
    date.className = "event-date";
    date.textContent = formatTs(e.created_at);
    row.appendChild(line);
    row.appendChild(date);
    el.appendChild(row);
  }
}
```

- [ ] **Step 3.4 — Run; verify green.** Run: `bun test apps/overlay/src/memory/render.test.ts`. Expected: PASS.

- [ ] **Step 3.5 — Implement the controller.** `apps/overlay/src/memory/controller.ts`:
```ts
/**
 * controller (chunk-02, memory-transparency-ui) — list↔detail navigation glue.
 * Thin: no DOM building of its own (render.ts) and no fetch mechanics (memory-api.ts).
 * Honest states throughout (locked / daemon-down / empty) — never a stuck "Loading…".
 * Provenance jump reuses openThread → the same detail-load path (DoD box 2).
 */
import type { MemoryApiDeps } from "./memory-api.js";
import { fetchThreads, fetchThread } from "./memory-api.js";
import { renderThreadList, renderMessages, renderFacts, renderEvents, renderState } from "./render.js";

export interface MemoryControllerEls {
  listView: HTMLElement;
  detailView: HTMLElement;
  threadListEl: HTMLElement;
  messagesEl: HTMLElement;
  factsEl: HTMLElement;
  eventsEl: HTMLElement;
  backBtn: HTMLElement;
}
export interface MemoryControllerDeps {
  api: MemoryApiDeps;
  els: MemoryControllerEls;
}

const LOCKED = "🔒 Token rejected — the engine did not accept this token.";
const DOWN = "Daemon unreachable — is the engine running?";

export function createMemoryController(deps: MemoryControllerDeps): { start(): void } {
  const { els } = deps;

  function showList(): void { els.detailView.style.display = "none"; els.listView.style.display = "block"; }
  function showDetail(): void { els.listView.style.display = "none"; els.detailView.style.display = "block"; }

  async function loadList(): Promise<void> {
    renderState(els.threadListEl, "Loading…", "li");
    const r = await fetchThreads(deps.api);
    if (r.kind === "unauthorized") { renderState(els.threadListEl, LOCKED, "li"); return; }
    if (r.kind === "unreachable") { renderState(els.threadListEl, DOWN, "li"); return; }
    renderThreadList(els.threadListEl, r.data.threads ?? [], openThread);
  }

  async function loadThread(threadId: string): Promise<void> {
    renderState(els.messagesEl, "Loading…");
    renderState(els.factsEl, "Loading…");
    renderState(els.eventsEl, "Loading…");
    const r = await fetchThread(deps.api, threadId);
    if (r.kind === "unauthorized") { renderState(els.messagesEl, LOCKED); renderState(els.factsEl, LOCKED); renderState(els.eventsEl, LOCKED); return; }
    if (r.kind === "unreachable") { renderState(els.messagesEl, DOWN); renderState(els.factsEl, DOWN); renderState(els.eventsEl, DOWN); return; }
    renderMessages(els.messagesEl, r.data.messages ?? []);
    renderFacts(els.factsEl, r.data.distilledFacts ?? [], openThread);
    renderEvents(els.eventsEl, r.data.distillationEvents ?? []);
  }

  function openThread(threadId: string): void { showDetail(); void loadThread(threadId); }

  function start(): void {
    els.backBtn.addEventListener("click", () => { showList(); void loadList(); });
    showList();
    void loadList();
  }
  return { start };
}
```

- [ ] **Step 3.6 — Grow `memory.html`** (add the list/detail DOM + a compact inline `<style>`; keep the existing `#conn-state` banner). Replace the `<main>` body and add a `<style>` in `<head>`:
```html
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a; background: #f5f5f5; padding: 16px; }
      h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
      h2 { font-size: 15px; font-weight: 600; margin: 16px 0 8px; }
      #conn-state { font-size: 12px; color: #888; margin-bottom: 12px; }
      .panel { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 14px; margin-bottom: 12px; }
      .thread-list { list-style: none; }
      .thread-list-item { padding: 8px 10px; cursor: pointer; border-radius: 4px; border: 1px solid #e8e8e8; margin-bottom: 6px; background: #fafafa; }
      .thread-list-item:hover { background: #eef4ff; border-color: #c0d4f5; }
      .thread-title { font-weight: 500; }
      .thread-meta { color: #888; font-size: 12px; margin-top: 2px; }
      .message-row { padding: 6px 8px; margin-bottom: 6px; border-left: 3px solid #ddd; background: #fafafa; border-radius: 0 4px 4px 0; }
      .message-row.role-user { border-color: #6b9ef4; }
      .message-row.role-assistant { border-color: #84c47a; }
      .message-role { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #888; }
      .message-content { white-space: pre-wrap; word-break: break-word; }
      .fact-row, .event-row { padding: 6px 8px; margin-bottom: 4px; background: #fafafa; border: 1px solid #eee; border-radius: 4px; }
      .fact-meta { font-size: 11px; color: #999; margin-top: 2px; }
      .prov-link { color: #2060b0; cursor: pointer; }
      .facts-count { font-weight: 600; }
      .zero-count { color: #e07b00; }
      .event-date { font-size: 11px; color: #aaa; }
      .empty { color: #aaa; font-style: italic; font-size: 13px; }
      #thread-view { display: none; }
      .back-btn { margin-bottom: 12px; font-size: 13px; cursor: pointer; color: #2060b0; background: none; border: none; padding: 0; }
      .back-btn:hover { text-decoration: underline; }
    </style>
```
```html
  <body>
    <main id="memory-shell">
      <h1>Memory</h1>
      <p id="conn-state" data-state="checking">Checking connection…</p>

      <div id="thread-list-view">
        <div class="panel">
          <h2>Threads</h2>
          <ul class="thread-list" id="thread-list"></ul>
        </div>
      </div>

      <div id="thread-view">
        <button class="back-btn" id="back-btn">&#8592; Back to threads</button>
        <div class="panel"><h2>Messages</h2><div id="messages-container"></div></div>
        <div class="panel"><h2>Distilled facts</h2><div id="facts-container"></div></div>
        <div class="panel"><h2>Distillation events</h2><div id="events-container"></div></div>
      </div>
    </main>
    <script type="module" src="/src/memory.ts"></script>
  </body>
```

- [ ] **Step 3.7 — Wire `memory.ts`** to keep the liveness banner AND start the controller (read the token once, share it). Replace `main()` in `apps/overlay/src/memory.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { createMemoryLiveness, type ShellState } from "./memory-liveness.js";
import { createMemoryController } from "./memory/controller.js";

const BASE_URL = "http://127.0.0.1:7777";
const THREADS_URL = `${BASE_URL}/memory/threads`;

function renderBanner(state: ShellState, detail?: string): void {
  const el = document.getElementById("conn-state");
  if (el === null) return;
  el.dataset.state = state;
  el.textContent =
    state === "no-token"     ? "🔒 No auth token found — is the engine installed?" :
    state === "unreachable"  ? "Daemon unreachable — is the engine running?" :
    state === "unauthorized" ? "🔒 Token rejected — the engine did not accept this token." :
    /* connected */            `Connected${detail ? ` (${detail})` : ""}`;
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id}`);
  return node;
}

async function main(): Promise<void> {
  let token: string;
  try { token = (await invoke<string>("read_auth_token")).trim(); }
  catch { renderBanner("no-token"); return; }
  if (!token) { renderBanner("no-token"); return; }

  // Top-of-window connection banner (chunk-01 liveness poll — unchanged behavior).
  const liveness = createMemoryLiveness({
    fetchFn: (u, i) => fetch(u, i), url: THREADS_URL, token,
    onState: renderBanner, intervalMs: 3000, isHidden: () => document.hidden,
  });
  liveness.start();
  window.addEventListener("focus", () => liveness.checkNow());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveness.checkNow(); });

  // Read UI (chunk-02): threads list + thread detail.
  const controller = createMemoryController({
    api: { fetchFn: (u, i) => fetch(u, i), baseUrl: BASE_URL, token },
    els: {
      listView: el("thread-list-view"), detailView: el("thread-view"),
      threadListEl: el("thread-list"), messagesEl: el("messages-container"),
      factsEl: el("facts-container"), eventsEl: el("events-container"), backBtn: el("back-btn"),
    },
  });
  controller.start();
}

void main();
```

- [ ] **Step 3.8 — Verify all mechanical gates.** Run: `bun test` (whole suite — Expected: all green), `bun run lint:strict`, `bun run typecheck`. Confirm the frozen surface: `git diff --stat packages/protocol/` → **no output**. Verify `apps/overlay/vite.config.ts` still lists `memory` in `rollupOptions.input` (no change expected).

- [ ] **Step 3.9 — Commit.**
```bash
git add apps/overlay/src/memory/render.ts apps/overlay/src/memory/render.test.ts apps/overlay/src/memory/controller.ts apps/overlay/src/memory.ts apps/overlay/memory.html
git commit -m "feat(overlay): memory window read UI — threads list, thread detail (messages/facts/events), provenance jump-links, expiry/confidence-when-non-default

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification (DoD mapping)

The chunk's five DoD boxes (`02-memory-window-view.md` §Done criteria):

**Mechanical (provable by the worker now):**
- **DoD box 4 — `bun test` / `lint:strict` / typecheck green (incl. new UI/data-shaping tests):** Steps 1.4, 2.5, 2.9, 3.4, 3.8. New coverage: fetch mapping + token discipline (`memory-api.test.ts`), provenance/expiry/confidence/0-fact rules (`fact-view.test.ts`), render behavior incl. 0-fact label, provenance jump-link + callback, expiry/confidence shown-only-when-non-default (`render.test.ts`), and the additive `status` field (`list-threads-status.daemon.test.ts`).
- **DoD box 5 — `git diff packages/protocol/` empty:** asserted in Step 3.8 (`git diff --stat packages/protocol/` → no output). No protocol touch anywhere in the plan.
- **DoD box 3 (mechanical half) — non-default expiry/confidence ARE shown, defaults are NOT:** the two `render.test.ts` cases (`baseFact` → no `.fact-expiry`/`.fact-confidence`; `{ expiry, confidence: 0.5 }` → both present) are the mechanical proof of the rule. This is the "data-shaping unit test is the natural home" the constraint calls for.

**Behavioral — ALL marked "requires live macOS demo to confirm" (PIPELINE §6.1; a probe is evidence only when executed; NOT assertable from code-reading). This chunk owns spec demo-checklist item 2; final joint sign-off rides chunk-04:**
- **[requires live macOS demo to confirm] DoD box 1:** From the tray → "Open Memory…", the window lists real threads from `~/.agentic-engine/memory.sqlite` (via the token-gated `GET /memory/threads`, no token entry); clicking a thread shows its messages, the distilled facts, and distillation events — including a 0-fact "deliberately retained nothing" event if present.
- **[requires live macOS demo to confirm] DoD box 2:** Each distilled fact shows its provenance; a `thread:<id>` provenance link navigates to that source thread's detail view.
- **[requires live macOS demo to confirm] DoD box 3 (behavioral half):** a fact with default expiry/confidence shows no expiry/confidence chrome; a **test-seeded** non-default fact shows both. **Seed recipe (dev-only, run once before the demo; NOT committed, NOT bundled — uses the existing `MemoryStore.insertDistilledFacts`; shared SQLite means no daemon restart needed):**
  ```bash
  bun -e '
  import { MemoryStore } from "./packages/daemon/src/memory/store.ts";
  const store = new MemoryStore({ dataDir: `${process.env.HOME}/.agentic-engine` });
  const [t] = store.listThreads();
  store.insertDistilledFacts([{
    fact: "DEMO non-default fact (expiry+confidence)",
    provenance: t ? `thread:${t.thread_id}` : "thread:demo",
    scope: "cross-thread",
    expiry: Date.now() + 7*24*60*60*1000,
    confidence: 0.5,
    authored_by: "machine",
  }], "seed-demo");
  store.close();
  console.log("seeded");
  '
  ```
  (The seeded fact also carries a `thread:<id>` provenance, so it doubles as a jump-link target for DoD box 2.)
- **[requires live macOS demo to confirm] honest empty/error states:** locked (token rejected), daemon-down (unreachable), and empty-store all render honest text — never a stuck "Loading…" — in both the top banner (chunk-01 liveness) and the in-view containers (controller states).

Intermediate gates use real I/O where a boundary exists (Step 1 uses a real `MemoryStore`, no mocks), per the standing Strike-4/5 rule.

---

## ADR worthy: no

Rationale:
- **Surface class settled:** this is an **engine-owned native surface** (spec Anchors + ADR-0005), NOT closed-set `@agentic/protocol` primitives. No new boundary. Code comments cite ADR-0005 / ADR-0012 5a-c where relevant.
- **Consumes decided contracts:** token-gated reads (ADR-0013 rider), observable distillation events + provenance display (ADR-0012 5b/5c), the CORS seam (already shipped chunk-01). No new route, no new dependency, no auth change.
- **The `status` field** is an additive JSON key on an *existing* route (a SELECT column widening in `store.ts`, not `http-routes.ts`) — the chunk pre-authorizes small additive read gaps. Not a new decision.

**Reviewer escalation clause (mirrors chunk-01):** if the reviewer judges the additive `status` read field to constitute a new posture beyond the "small additive gap" the spec Anchor sanctions, escalate to `adr-curator` for a note/rider — not a new ADR — before merge. (Not expected.)

---

## Risks & flags

- **FLAG — "with status" delivered via a small additive daemon change, not `history.html` parity.** The chunk Scope-IN says "Threads list … with status," but the parity target `history.html` omits status and `listThreads()` didn't carry it. Step 1 adds `status` (meaningful: `active`/`dismissed`) as the sanctioned "small + additive read gap." It touches `store.ts` (NOT the security-adjacent `http-routes.ts`) and is backward-compatible (extra key; `history.html` ignores it). **Droppable:** the Step-3 render helper treats `status` as optional, so if strict parity is preferred, drop Step 1 and the UI shows dates only. Reviewer's call.
- **FLAG — dead `onConnectionState` tap + retained `set_tray_status` LEFT AS-IS (deliberate, lowest-churn).** The memory window doesn't hold the agent `ConnectionManager`, so there is nothing to *consume*; *removing* the tap would re-touch the byte-frozen agent-connection surface (`connection-manager.ts` + `main.ts`) for zero gain in a read-only chunk. Noted as out-of-scope hygiene per the brief's guidance. If the orchestrator wants it removed, that is a separate hygiene chunk touching agent-connection files (runtime-coupling review), not this one.
- **Provenance jump only resolves `thread:<id>` shapes.** v2 machine facts use `thread:<id>` (`distiller-registration.ts:178`) → jump works for real facts. Legacy/message-id-list provenance is not client-resolvable to a thread (no message→thread map in the payload; resolving it would need a route change = out of scope) → rendered as plain text, `history.html` parity. In-answer + message-level provenance are explicitly OUT (spec).
- **Facts panel shows the FULL slice, not thread-scoped facts.** `hatch.view` returns all distilled facts regardless of the opened thread (`hatch.ts:57-58`) — this is intended ("ALL current distilled facts (the live projection)"), matches `history.html`, and is why each fact needs its own provenance link. Do not "fix" this to thread-scope it.
- **Existing daemon test shape:** Step 1 widens `listThreads`'s row shape; if any daemon test asserts the exact row via deep-equal, update it additively (Step 1.4). Low risk (the grep found no strict threads-shape assertion, but run the daemon suite).
- **XSS discipline is load-bearing:** all API strings via `textContent`/`createElement`, never `innerHTML` (mirrors `history.html` + `text-reply.ts`). A regression here is a security defect, not a style nit — reviewer should confirm no `innerHTML` with API data in `render.ts`.
- **NOT a freeze gate:** nothing touches `packages/protocol/**`; `git diff --stat packages/protocol/` stays empty (Step 3.8). Confirmed engine-owned native surface, not a protocol change.

---

## Status: Done


---

## Demo-1 fix — state-sync (item 4)

> Appended after Demo-1 (Lior, live macOS) of chunk-02. Steps 1–3 shipped (PR #76 chunk-02
> commits); the read UI works — items 1, 2 PASSED; item 3's default-half passed and its
> non-default half is already unit-tested (see Diagnosis); item 4 FAILED. This fix couples the
> two uncoordinated in-window state machines so the header and content can never contradict and
> the window recovers without a `tauri` restart. Every claim below is a **code-path fact**
> (verified by reading source, lines cited) or a **runtime inference** (NOT assertable from
> code-reading — PIPELINE §6.1); the behavioral DoD rides Lior's re-demo.

### Diagnosis

**The window has TWO uncoordinated state machines (confirmed, code facts):**

1. **Connection banner** — `apps/overlay/src/memory.ts` builds `createMemoryLiveness`
   (`apps/overlay/src/memory-liveness.ts`) with `onState: renderBanner`, driving only `#conn-state`.
   It polls `GET /memory/threads` on an interval (`memory-liveness.ts` — immediate `check()`
   + `setInterval` at `intervalMs=3000`) plus a forced `checkNow()` on `focus`/`visibilitychange`.
2. **Content sections** — `apps/overlay/src/memory/controller.ts` fetches threads only in `loadList`
   (called from `start()` and the back-button handler) and thread detail only in `loadThread`
   (called from `openThread`, which is also the provenance-jump target). **The controller never
   subscribes to the liveness poll.**

**The transition-vs-every-poll finding (load-bearing for the fix):** `createMemoryLiveness`
`check()` calls `deps.onState(...)` **unconditionally on every check** — the interface doc-comment
states it verbatim: "Fired with every terminal result." So `onState` fires **~every 3s, NOT only on
transitions.** Consequence: the controller must **de-dupe** — re-fetch content ONLY on a genuine
transition **into `connected` from a non-connected state**; a naïve subscribe-and-refetch would
re-fetch every 3s (flicker/waste). This is why the de-dupe lives in the controller and
`memory-liveness.ts` is left **unchanged** (its per-poll `onState` is wired from `memory.ts`).

**Root causes, mapped to Lior's repro:**
- **(4a)** daemon killed with the list rendered → the poll flips the banner to "Daemon unreachable"
  within ≤3s, but the controller never re-fetches → the **stale threads list stays rendered** →
  header/content contradict. Root: no coupling from the poll to the content.
- **(4b)** while down: enter a thread → empty detail; back → "Threads — Daemon unreachable". **Already
  honest** because `openThread`/back re-fetch on nav and get `unreachable`. No change needed for this
  half; the fix keeps it honest.
- **(4c)** daemon restarted → the poll recovers the banner to "Connected (N threads)", but the content
  is **stuck on "Daemon unreachable" forever** — only a full `tauri` restart recovers it (a restart
  re-runs `controller.start()` → `loadList()`). Root: the controller re-fetches only on explicit nav,
  never on the poll's connected-transition.

**Test gap that let this ship green (meta-cause):** there is **no `controller.test.ts`** —
`apps/overlay/src/memory/` contains only `memory-api.test.ts`, `fact-view.test.ts`, `render.test.ts`.
The controller's coordination — the exact locus of the defect — was never unit-tested, so green tests
+ a clean review could not catch it. Step 4's test closes this gap and is the point of the fix.

**Item 3 — ALREADY covered, no action (reality-check note for Lior):** `render.test.ts:47-52`
("renderFacts: non-default expiry/confidence ARE shown") asserts `.fact-expiry` **and**
`.fact-confidence` are present for `{ expiry: 1730000000000, confidence: 0.5 }`, and `:40-45` asserts
both absent for the default `baseFact` (`expiry:null, confidence:1`). The seeded-non-default half of
item 3 is proven mechanically. No new test needed for item 3.

### The decision

**On daemon-down, CLEAR the already-rendered content to the honest "unreachable"/"locked" state
(clear-to-unreachable), applied consistently to BOTH the list view and the open-detail view — NOT an
explicit stale-marker.**

Justification (Lior asked for one, so this is the operative honest-state rule for this window):

1. **It reuses the path already shipped.** The controller already does clear-to-unreachable on explicit
   nav (`loadList`/`loadThread` render the `DOWN`/`LOCKED` constants on `unreachable`/`unauthorized`).
   Choosing clear-to-unreachable makes the poll-driven path **identical** to the nav-driven path — one
   honest-state mechanism, using the same two constants. A stale-marker would introduce a **second**
   rendering path the nav path lacks → more surface, more divergence risk.
2. **It satisfies contract rule 1 (never contradict) literally.** The banner says "Daemon unreachable";
   clearing content to the same message means header and content say the **same** thing. A stale-marker
   leaves the header saying "unreachable" while the content still shows 8 threads — a softer
   contradiction the user must reconcile.
3. **Zero retained state / smallest diff.** A stale-marker requires the controller to cache the last-good
   payload and add distinct "stale" chrome. Clear-to-unreachable retains nothing and re-renders the
   existing honest state — fewer moving parts, fewer bugs (pragmatic over perfect).
4. **Honesty over cached-but-possibly-wrong.** Memory mutates asynchronously (a dismiss flips
   `status`; a distillation adds/replaces facts). Cached facts/threads shown during a down window can be
   silently wrong by the time the daemon returns — which cuts against this feature's whole
   transparency/honest-state ethos (ADR-0012 "no opaque memory"; chunk-01's honest tri-state, no false
   "Loading…"). Clear-to-unreachable never shows possibly-stale memory as current.
5. **Nothing to preserve.** This is read-only (mutations are chunk-03). There is no in-progress user work
   the stale-marker would protect; the only cost of clearing is a ≤3s wait for the next poll to recover —
   cheap.

> ☆ Альтернатива: explicit stale-marker — плюси: keeps context visible during a brief blip, less jarring;
> мінуси: a second rendering path the nav path doesn't have, a softer header/content contradiction, needs
> a last-good cache, and risks presenting since-mutated memory as current. Rejected for a read-only
> honest-state window.

**Coordination sub-choice (implementation detail, decided here):** on the **down** transition, render
the honest state **directly** (`applyDownState`, synchronous — no doomed re-fetch), and on the **up**
transition **re-fetch** the current view. The alternative (re-fetch on *any* transition and let the
down-fetch fail into `unreachable`) is one method fewer but flashes "Loading…" before the failure and
makes the down-render async. Direct-render-on-down matches the brief's framing ("re-fetch only on a
transition into connected"), keeps the down-render deterministic, and still uses the same `DOWN`/`LOCKED`
constants → fully consistent with the nav path.

### Step 4: Failing controller coordination test (RED)

**Files:**
- Create: `apps/overlay/src/memory/controller.test.ts`

**Interfaces:**
- Consumes (from Step 5): `createMemoryController(deps): MemoryController` where
  `MemoryController = { start(): void; onLivenessState(state: ShellState): void }`, and the existing
  `MemoryControllerEls`. `ShellState` is the chunk-01 type from `../memory-liveness.js`.

- [ ] **Step 4.1 — Write the failing test.** Create `apps/overlay/src/memory/controller.test.ts`
  (happy-dom via the root `bunfig.toml` preload; a switchable up/down fake `fetchFn` + a call counter):
```ts
/**
 * controller — list<->detail nav + the Demo-1 (item 4) state-sync coupling.
 * happy-dom via test-setup/dom-preload. Fake fetchFn with a switchable up/down mode + a call
 * counter. Reproduces the demo defect: a daemon kill must CLEAR content to the banner's honest
 * state (never contradict), a later start must RECOVER content without a restart, and repeated
 * same-state polls must NOT re-fetch (no every-3s flicker/waste). This is the test that would
 * have caught item 4 — the controller shipped with no unit test.
 */
import { test, expect } from "bun:test";
import {
  createMemoryController,
  type MemoryController,
  type MemoryControllerEls,
} from "./controller.js";

function host(): HTMLElement { const d = document.createElement("div"); document.body.appendChild(d); return d; }
function makeEls(): MemoryControllerEls {
  return {
    listView: host(), detailView: host(),
    threadListEl: host(), messagesEl: host(), factsEl: host(), eventsEl: host(),
    backBtn: host(),
  };
}

interface FakeFetch {
  fn: (url: string, init?: RequestInit) => Promise<Response>;
  setMode: (m: "up" | "down") => void;
  calls: () => number;
}
function makeFetch(): FakeFetch {
  let mode: "up" | "down" = "up";
  let calls = 0;
  const fn = (url: string): Promise<Response> => {
    calls += 1;
    if (mode === "down") return Promise.reject(new Error("connection refused"));
    const body = url.includes("/memory/thread/")
      ? { messages: [{ id: "m1", role: "user", content: "hi" }], distilledFacts: [], distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { fn, setMode: (m) => { mode = m; }, calls: () => calls };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
function make(f: FakeFetch): { c: MemoryController; els: MemoryControllerEls } {
  const els = makeEls();
  const c = createMemoryController({
    api: { fetchFn: f.fn, baseUrl: "http://127.0.0.1:7777", token: "TOK" },
    els,
  });
  return { c, els };
}

test("item 4a: daemon-down transition CLEARS the list to the banner's honest 'unreachable' (never contradict)", async () => {
  const f = makeFetch();
  const { c, els } = make(f);
  c.start();
  await flush();
  expect(els.threadListEl.querySelector(".thread-list-item")).not.toBeNull(); // rendered while up

  c.onLivenessState("connected");   // initial connect baseline (prev undefined -> no re-fetch)
  f.setMode("down");
  c.onLivenessState("unreachable"); // the daemon-kill transition (synchronous down-render)
  expect(els.threadListEl.textContent).toContain("Daemon unreachable");
  expect(els.threadListEl.querySelector(".thread-list-item")).toBeNull(); // stale list cleared
});

test("item 4c: connected transition RE-FETCHES and recovers the list WITHOUT a restart", async () => {
  const f = makeFetch();
  const { c, els } = make(f);
  c.start();
  await flush();
  c.onLivenessState("connected");   // baseline
  f.setMode("down");
  c.onLivenessState("unreachable"); // down
  expect(els.threadListEl.textContent).toContain("Daemon unreachable");

  f.setMode("up");
  c.onLivenessState("connected");   // recovery transition (unreachable -> connected)
  await flush();
  expect(els.threadListEl.querySelector(".thread-list-item")).not.toBeNull(); // recovered, no restart
});

test("item 4: repeated same-state 'connected' polls do NOT re-fetch (no every-3s flicker/waste)", async () => {
  const f = makeFetch();
  const { c } = make(f);
  c.start();
  await flush();
  const afterStart = f.calls();     // start()'s single loadList
  c.onLivenessState("connected");   // initial connect -> no re-fetch (prev undefined)
  c.onLivenessState("connected");   // repeat -> de-duped
  c.onLivenessState("connected");   // repeat -> de-duped
  await flush();
  expect(f.calls()).toBe(afterStart); // zero extra fetches from the poll
});

test("item 4: down->up while viewing a thread clears AND recovers the detail view consistently", async () => {
  const f = makeFetch();
  const { c, els } = make(f);
  c.start();
  await flush();
  c.onLivenessState("connected");   // baseline
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); // open thread
  await flush();
  expect(els.messagesEl.textContent).toContain("hi"); // detail rendered while up

  f.setMode("down");
  c.onLivenessState("unreachable"); // kill while in detail
  expect(els.messagesEl.textContent).toContain("Daemon unreachable");
  expect(els.factsEl.textContent).toContain("Daemon unreachable");
  expect(els.eventsEl.textContent).toContain("Daemon unreachable");

  f.setMode("up");
  c.onLivenessState("connected");   // recover -> re-fetch the SAME open thread
  await flush();
  expect(els.messagesEl.textContent).toContain("hi"); // detail recovered, still on the same thread
});
```

- [ ] **Step 4.2 — Run; verify it fails.** Run: `bun test apps/overlay/src/memory/controller.test.ts`.
  Expected: FAIL — `onLivenessState` / `MemoryController` are not yet exported, and (before the fix) the
  down assertions would fail because content never clears.

### Step 5: The coordination fix (GREEN)

**Files:**
- Modify: `apps/overlay/src/memory/controller.ts`
- Modify: `apps/overlay/src/memory.ts`

**Interfaces:**
- Produces: `MemoryController = { start(): void; onLivenessState(state: ShellState): void }`. `start()`
  keeps its current contract; `onLivenessState` is the coupling hook, called per-poll and de-duped
  internally (re-fetch only on a genuine down->up transition).
- Consumes: `ShellState` (type-only) from `../memory-liveness.js` — a pure type, no runtime coupling,
  `memory-liveness.ts` is unchanged.

- [ ] **Step 5.1 — Rewrite `apps/overlay/src/memory/controller.ts`** to track the current view + last
  liveness state and add `onLivenessState`. Full file:
```ts
/**
 * controller (chunk-02, memory-transparency-ui) — list<->detail navigation glue.
 * Thin: no DOM building of its own (render.ts) and no fetch mechanics (memory-api.ts).
 * Honest states throughout (locked / daemon-down / empty) — never a stuck "Loading…".
 * Provenance jump reuses openThread -> the same detail-load path (DoD box 2).
 *
 * Demo-1 fix (item 4, state-sync): the top-of-window liveness banner (memory.ts ->
 * createMemoryLiveness) and these content sections were two uncoordinated state machines —
 * the banner polls every 3s while the content only re-fetched on explicit nav, so a daemon
 * kill left a stale list under an "unreachable" banner (they contradicted) and a later start
 * left the content stuck on "unreachable" until a full restart (no restart-free recovery).
 * `onLivenessState` couples them: memory.ts forwards the banner's EXISTING per-poll onState
 * result here (memory-liveness.ts is unchanged). Repeated same-state polls are a no-op, so
 * content is NOT re-fetched every 3s (no flicker/waste); on a transition INTO `connected`
 * from a non-connected state it re-fetches the current view (restart-free recovery); on a
 * transition into a non-connected state it clears the current view to the SAME honest
 * down/locked state the banner shows (clear-to-unreachable — plan "## The decision").
 */
import type { ShellState } from "../memory-liveness.js";
import type { MemoryApiDeps } from "./memory-api.js";
import { fetchThreads, fetchThread } from "./memory-api.js";
import { renderThreadList, renderMessages, renderFacts, renderEvents, renderState } from "./render.js";

export interface MemoryControllerEls {
  listView: HTMLElement;
  detailView: HTMLElement;
  threadListEl: HTMLElement;
  messagesEl: HTMLElement;
  factsEl: HTMLElement;
  eventsEl: HTMLElement;
  backBtn: HTMLElement;
}
export interface MemoryControllerDeps {
  api: MemoryApiDeps;
  els: MemoryControllerEls;
}
export interface MemoryController {
  start(): void;
  /** Coupling hook — called by memory.ts on EVERY liveness poll result (per-poll, not
   *  per-transition). De-dupes internally -> content re-fetches only on a down->up transition. */
  onLivenessState(state: ShellState): void;
}

type ViewState = { kind: "list" } | { kind: "detail"; threadId: string };

const LOCKED = "🔒 Token rejected — the engine did not accept this token.";
const DOWN = "Daemon unreachable — is the engine running?";

export function createMemoryController(deps: MemoryControllerDeps): MemoryController {
  const { els } = deps;

  // The two facts onLivenessState needs: WHICH view to refresh on recovery, and the last
  // observed state so repeated same-state polls are a no-op (never re-fetch every 3s).
  let currentView: ViewState = { kind: "list" };
  let lastLiveness: ShellState | undefined;

  function showList(): void { els.detailView.style.display = "none"; els.listView.style.display = "block"; }
  function showDetail(): void { els.listView.style.display = "none"; els.detailView.style.display = "block"; }

  async function loadList(): Promise<void> {
    renderState(els.threadListEl, "Loading…", "li");
    const r = await fetchThreads(deps.api);
    if (r.kind === "unauthorized") { renderState(els.threadListEl, LOCKED, "li"); return; }
    if (r.kind === "unreachable") { renderState(els.threadListEl, DOWN, "li"); return; }
    renderThreadList(els.threadListEl, r.data.threads ?? [], openThread);
  }

  async function loadThread(threadId: string): Promise<void> {
    renderState(els.messagesEl, "Loading…");
    renderState(els.factsEl, "Loading…");
    renderState(els.eventsEl, "Loading…");
    const r = await fetchThread(deps.api, threadId);
    if (r.kind === "unauthorized") { renderState(els.messagesEl, LOCKED); renderState(els.factsEl, LOCKED); renderState(els.eventsEl, LOCKED); return; }
    if (r.kind === "unreachable") { renderState(els.messagesEl, DOWN); renderState(els.factsEl, DOWN); renderState(els.eventsEl, DOWN); return; }
    renderMessages(els.messagesEl, r.data.messages ?? []);
    renderFacts(els.factsEl, r.data.distilledFacts ?? [], openThread);
    renderEvents(els.eventsEl, r.data.distillationEvents ?? []);
  }

  function openThread(threadId: string): void { currentView = { kind: "detail", threadId }; showDetail(); void loadThread(threadId); }
  function backToList(): void { currentView = { kind: "list" }; showList(); void loadList(); }

  /** Re-fetch whatever the user is currently looking at (list or the open thread). */
  function refreshCurrentView(): void {
    if (currentView.kind === "detail") void loadThread(currentView.threadId);
    else void loadList();
  }

  /** Clear the current view to the banner's honest state (clear-to-unreachable). Same
   *  DOWN/LOCKED constants + tags the nav path uses, applied to whichever view is up. */
  function applyDownState(state: ShellState): void {
    const msg = state === "unauthorized" ? LOCKED : DOWN;
    if (currentView.kind === "detail") {
      renderState(els.messagesEl, msg);
      renderState(els.factsEl, msg);
      renderState(els.eventsEl, msg);
    } else {
      renderState(els.threadListEl, msg, "li");
    }
  }

  function onLivenessState(state: ShellState): void {
    const prev = lastLiveness;
    lastLiveness = state;
    if (prev === state) return; // repeated same-state poll -> no-op (never re-fetch every 3s)

    if (state === "connected") {
      // Down->up transition -> recover content without a restart. The initial connect
      // (prev === undefined) is already covered by start()'s loadList -> skip the double-fetch.
      if (prev !== undefined) refreshCurrentView();
      return;
    }
    // Transition into a non-connected state -> clear to the banner's honest state (never contradict).
    applyDownState(state);
  }

  function start(): void {
    els.backBtn.addEventListener("click", backToList);
    currentView = { kind: "list" };
    showList();
    void loadList();
  }
  return { start, onLivenessState };
}
```

- [ ] **Step 5.2 — Wire the coupling in `apps/overlay/src/memory.ts`.** Construct the controller BEFORE
  the liveness poll and forward each `onState` result into it. Replace the body of `main()` (imports,
  `renderBanner`, and the `el(id)` helper are unchanged):
```ts
async function main(): Promise<void> {
  let token: string;
  try { token = (await invoke<string>("read_auth_token")).trim(); }
  catch { renderBanner("no-token"); return; }
  if (!token) { renderBanner("no-token"); return; }

  // Read UI (chunk-02): threads list + thread detail. Constructed BEFORE the liveness poll so
  // the banner's per-poll onState result can be forwarded into the controller (Demo-1 fix item 4).
  const controller = createMemoryController({
    api: { fetchFn: (u, i) => fetch(u, i), baseUrl: BASE_URL, token },
    els: {
      listView: el("thread-list-view"), detailView: el("thread-view"),
      threadListEl: el("thread-list"), messagesEl: el("messages-container"),
      factsEl: el("facts-container"), eventsEl: el("events-container"), backBtn: el("back-btn"),
    },
  });
  controller.start();

  // Top-of-window connection banner (chunk-01 liveness poll — renderBanner behavior unchanged).
  // Demo-1 fix (item 4): the SAME per-poll result that drives the banner is forwarded to the
  // controller so the content sections can never contradict the banner and recover on reconnect
  // without a restart. memory-liveness.ts is untouched — the controller de-dupes.
  const liveness = createMemoryLiveness({
    fetchFn: (u, i) => fetch(u, i), url: THREADS_URL, token,
    onState: (state, detail) => { renderBanner(state, detail); controller.onLivenessState(state); },
    intervalMs: 3000, isHidden: () => document.hidden,
  });
  liveness.start();
  window.addEventListener("focus", () => liveness.checkNow());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveness.checkNow(); });
}
```

- [ ] **Step 5.3 — Run the controller test; verify green.** Run:
  `bun test apps/overlay/src/memory/controller.test.ts`. Expected: PASS (all four tests).

### Step 6: Gate re-runs + frozen-surface checks + commit

- [ ] **Step 6.1 — Full mechanical gates + frozen/agent-path proof.** Run:
  `bun test` (whole suite — Expected: all green, incl. the existing `render.test.ts` /
  `memory-api.test.ts` / `fact-view.test.ts` unchanged), `bun run lint:strict` (`--max-warnings=0`),
  `bun run typecheck` (root) AND `cd apps/overlay && bun run typecheck` (overlay). Then confirm the
  untouched surfaces:
  `git diff --stat packages/protocol/` → no output;
  `git diff --stat apps/overlay/src/memory-liveness.ts apps/overlay/src/ws/connection-manager.ts apps/overlay/src/main.ts apps/overlay/src-tauri/ packages/daemon/src/memory/http-routes.ts`
  → **no output** (proves the liveness poll behavior, the agent connection, and the security-adjacent
  daemon file are all byte-unchanged).

- [ ] **Step 6.2 — Commit.**
```bash
git add apps/overlay/src/memory/controller.ts apps/overlay/src/memory/controller.test.ts apps/overlay/src/memory.ts
git commit -m "fix(overlay): couple memory-window content to the liveness poll (item 4 state-sync)

The banner (liveness poll) and the content sections were two uncoordinated state
machines: content only re-fetched on explicit nav, so a daemon kill left a stale
list under an 'unreachable' banner (contradiction) and a later start left content
stuck on 'unreachable' until a full restart. controller.onLivenessState (de-duped;
acts only on a genuine transition) now clears content to the banner's honest state
on down and re-fetches the current view on the connected transition — restart-free.
memory-liveness.ts + connection-manager.ts + main.ts byte-unchanged (agent path
and banner behavior untouched); no protocol/daemon change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Verification (Demo-1 fix item 4 — DoD mapping)

**Mechanical (provable by the worker now):**
- **The two new behavioral transitions are covered by `controller.test.ts` (the test that would have
  caught the demo defect):**
  - *down-with-content-rendered* → content clears to the banner's honest state, consistent for both
    views: test "item 4a … CLEARS the list" (list) + test "down->up while viewing a thread clears …"
    (detail: messages/facts/events all show "Daemon unreachable").
  - *recover-refetch-without-restart* → content re-fetches on the connected transition: test "item 4c …
    RE-FETCHES and recovers the list WITHOUT a restart" (list) + the recovery half of the detail test.
  - *no-flicker guard* → test "repeated same-state 'connected' polls do NOT re-fetch" proves the
    controller does not re-fetch every 3s.
- `bun test` / `lint:strict` / `typecheck` (root + overlay) green (Steps 5.3, 6.1).
- Frozen/agent-path byte-unchanged: `packages/protocol/`, `memory-liveness.ts`, `connection-manager.ts`,
  `main.ts`, `src-tauri/`, `http-routes.ts` all show empty diffs (Step 6.1).

**Behavioral — ALL "requires live macOS demo to confirm" (PIPELINE §6.1; a probe is evidence only when
executed; NOT assertable from code-reading). This is Lior's item-4 re-demo:**
- **[requires live macOS demo to confirm] (4a)** With the threads list rendered, kill the daemon → within
  ~3s (one poll) the banner shows "Daemon unreachable" **and** the threads section clears to the same
  honest state — header and content agree, no stale list.
- **[requires live macOS demo to confirm] (4b, regression-guard)** While down, enter a thread → detail
  shows "Daemon unreachable"; back → the list shows "Daemon unreachable" (still honest).
- **[requires live macOS demo to confirm] (4c)** Start the daemon again → within ~3s the banner shows
  "Connected (N threads)" **and** the threads section re-populates — **no `tauri` restart**. If a thread
  detail is open when the daemon returns, that same thread re-loads in place.

### ADR worthy: no

Rationale:
- **No new boundary.** The fix couples two **existing** in-window state machines (the chunk-01 liveness
  poll and the chunk-02 controller) by forwarding an **already-existing** callback (`onState`). It adds no
  route, no dependency, no protocol change, and does not touch the agent-connection path.
- **Executes decided ADRs, adds no decision.** It realizes the honest-state / no-opaque-memory posture of
  **ADR-0012** and the token-gated-read contract of **ADR-0013** (consumed unchanged) inside an
  engine-owned native surface (**ADR-0006** tray-opened window / **ADR-0005** — not closed-set
  primitives). The "header and content never contradict" invariant is a UX rule realized in existing
  files, not an architectural decision.

**Reviewer escalation clause (mirrors chunk-01/-02):** if the reviewer judges the honest-state
coupling invariant to warrant recording, that is a **note/rider** on ADR-0012, not a new ADR — escalate
to `adr-curator` before merge. (Not expected.)

## Status: Done


---

## Chunk 03 — ACT (edit + forget)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. This is **chunk-03** of feature `memory-transparency-ui` (backlog Theme A). Scope is FROZEN by `orchestration/chunks-todo/memory-transparency-ui/03-memory-window-edit-forget.md` — you may FLAG problems, do not exceed or edit it. Builds on chunk-01 (tray+shell, shipped) and chunk-02 (READ view, shipped PR #76).

**Goal:** Grow the shipped chunk-02 thread-detail view into the ACT surface — a "release the reference" forget on each distilled fact and an inline human-correction edit on each message — wired to the already-shipped token-gated `POST /memory/forget` + `POST /memory/edit`, with every outcome mapped to an honest UI state (no fake success), zero protocol/daemon change.

**Architecture:** Pure overlay work. A new pure `memory-write.ts` (token-gated POST → discriminated `WriteResult`; treats the daemon's `204 No Content` success as success, so it does NOT reuse chunk-02's `getJson`, which parses JSON and would throw on an empty body). New DOM builders in `actions.ts` (forget-confirm + inline-edit; `textContent`/`createElement` only, zero `innerHTML`). Chunk-02's `render.ts` gains optional per-row action callbacks; the controller wires them to `memory-write` and re-fetches the current view on success / renders the chunk-02 honest states (`LOCKED`/`DOWN`) on failure.

**Tech Stack:** TypeScript on Bun, Tauri webview, `fetch` + `AbortController`, `bun:test` + happy-dom (root `bunfig.toml` preload).

### Global Constraints (chunk-03)

- **`@agentic/protocol` frozen — byte-unchanged.** `git diff --stat packages/protocol/` MUST be empty. The forget/edit HTTP-body fields are NOT wire-envelope variants (ADR-0015: "additive to the HTTP body … `@agentic/protocol` and `mock-agent.ts` are untouched").
- **`packages/daemon/**` byte-unchanged.** The routes, CORS seam, and error contract already exist (see `## Reality check`). No daemon edit. If the worker believes an unavoidable daemon change is needed → STOP and escalate (freeze gate); do not silently widen.
- **ADR-0013 token discipline:** the per-install token rides `Authorization: Bearer <token>` ONLY — never a URL/query/body key, never logged. Reuse chunk-02's already-read token (`read_auth_token`, shared through `MemoryApiDeps`).
- **XSS discipline (load-bearing, security not style):** all API-derived and user-entered strings via `textContent`/`createElement`. ZERO `innerHTML`. Mirrors `history.html` / `text-reply.ts` / chunk-02 `render.ts`.
- **ADR-0015 forget semantics = "release the reference":** forgetting a fact durably deletes only that fact row; it NEVER scrubs the source messages/thread. No "also forget sources" checkbox, no source-message-count confirm (ADR-0015 decision 5 SUPERSEDED). No undo window — the confirm IS the safety.
- **Escaped-test discipline (bit chunks 01/02):** every new test file must be type-checked exactly once. Non-DOM tests are auto-covered by root `tsconfig.json` (`apps/overlay/src/memory/**/*.test.ts`); DOM tests must be added to `apps/overlay/tsconfig.memory-dom-tests.json` `include` AND to root `tsconfig.json` `exclude`.

---

## Reality check

Per PIPELINE §6.1: statements below are **code-path facts** (verified by reading source, lines cited) or **runtime inferences** marked *"requires runtime demo to confirm"* — never asserted as behavioral truth from reading.

**1. Both write routes EXIST and are the contract (code facts):**
- `POST /memory/forget` — `http-routes.ts:118-119` → `handleForget` (`:174-218`). Token-gated (`tokenStore.verify` first; 401 on miss). **Body shape it actually reads: `{ target_type, reason?, fact_id }`** (`:184`). The ONLY accepted path is `target_type === "fact"` with a **uuid-shaped `fact_id`** (`:199-207`, `UUID_RE`) → `deps.hatch.forgetFactById(fact_id, HTTP_CTX, reason)` (`hatch.ts:89-91` → `write-gate.ts:150-183`) → durable delete of exactly that stable-id row; **never scrubs messages** (B1 invariant; `write-gate.ts` comment `:117-119`). **Success = `204 No Content`, no JSON body** (`:206`).
  - **Reconciliation of "keys on text vs id":** ADR-0015 decision 3 keys the *durable record* on normalized text, but the HTTP body v2-07 REQUIRES a uuid `fact_id` (`:200-210`); the text/provenance `forgetFact` fallback was REMOVED as the over-delete root (`:207-210`, `write-gate.ts:145-147`). **The UI must send `fact_id`** — the fact `id` is already on chunk-02's wire (`DistilledFactView.id`, plan `:1034`; from `store.readDistilledFacts` SELECT, `store.ts:287`). `fact_text`/`provenance` are IGNORED by the route (only `target_type`/`reason`/`fact_id` are destructured) — the UI need not send them.
  - **`target_type:"message"` (Scope-OUT) returns 400** (`:211-213`, the `else` branch → `bad_body`) — the per-message user path is structurally rejected. Confirmed.
- `POST /memory/edit` — `http-routes.ts:123-124` → `handleEdit` (`:220-246`). Token-gated. **Body shape it reads: `{ target, replacement, reason? }`** (`:230`); `target` and `replacement` must be strings (`:231-236`, else 400 `bad_body`). Calls `deps.hatch.edit(target, replacement, HTTP_CTX, reason)` (`hatch.ts:70-72` → `write-gate.ts:193-216`). **Success = `204 No Content`.**

**2. ⚠️ THE CRUX — `/memory/edit` edits a MESSAGE, not a distilled fact (code fact + reconciliation):**
- `hatch.edit(target, …)` → `WriteGate.edit(messageId, …)` (`write-gate.ts:193`). It calls `threadOf(messageId)` (`SELECT thread_id FROM messages WHERE id = ?`, `:240-244`; throws `not found` for a non-message id) and appends a `mutations` row of `kind='correction'` referencing that **`messages.id`** (`:205-207`). There is **NO HTTP route that edits a `distilled_facts` row, and NO route that sets a fact's `authored_by='human'`.** (Human facts are a designed-for concept — `store.ts` 5e guards everywhere, `reindexHumanFacts` `:942-951` — but nothing on the HTTP surface authors one.)
- **The reference implementation confirms this:** `history-page.ts` puts the **Edit** button on MESSAGE rows (`:330-337`, `doEdit(m.id, m.content …)` → POST `{ target: msgId, replacement, reason }`, `:558-564`) and the **Forget fact** button on FACT rows (`:371-384`, POST `{ target_type:"fact", fact_id, … }`). Per-message forget was removed (`:328-329`).
- **Reconciliation (proceeding, not blocking):** the chunk brief's phrasing "edit a fact" is loose shorthand. The SPEC itself defines edit as "the correction flow riding **MUTATION-AS-APPEND** (`authored_by:human` + 5e … enforced by the write-gate)" — that IS `WriteGate.edit` on a message. So the authoritative sources (spec + reference impl + frozen backend) all define edit as a **message correction**. This plan builds **Edit on message rows** (Option A). This is a reconciliation-to-an-existing-decision, flagged loudly — NOT new scope. **If Lior genuinely meant fact-level editing** (author/replace a `distilled_facts` row as human), that requires a NEW daemon path → **freeze gate + separate feature**, NOT this chunk (see `## Risks & flags`).
- **The "human-authored marker" (DoD box 2), reconciled:**
  - The edited message's **new text is persistent and visible on reload**: `hatch.view` reads `store.readThreadArchive` (`hatch.ts:55`, `store.ts:725-750`), whose `COALESCE` surfaces the latest **human** correction as the message `content` (`store.ts:730-737, 748`). *(requires runtime demo to confirm the end-to-end view refresh.)*
  - The wire (`ThreadMessage {id,role,content}`, plan `:1032`; `hatch.ts:33`) carries **no persistent per-message "corrected" flag**. So a durable human-authored *badge* on a message would need an additive daemon field (out of scope). This plan shows the marker as a **session-local "edited by you" tag** (honest optimistic UI — marks what the user changed this session). On facts, `authored_by` is already on the wire and already displayed by chunk-02 (`render.ts:1419`) — but no route makes a fact human-authored, so it renders `machine` in practice.
  - The 5e "never silently clobbered" guarantee is real at the message level: a human correction wins and cannot be machine-overwritten (`write-gate.ts:202-203` refuses machine-over-human; `store.ts:730-737` human-wins COALESCE); the distiller reads the corrected text (`readThreadMessagesForDistill`, same COALESCE, `store.ts:764-771`). *(5e survival across a re-distill requires runtime demo to confirm — via MEMORY_DEBUG / a real-daemon probe; see Step 3.)*

**3. Error contract (code fact — `mapWriteError` `:283-293` + inline throws). The UI consumes these; do NOT add throw sites:**
| Status | Body | Trigger | UI state |
|---|---|---|---|
| `401` | `{error:"Unauthorized"}` | missing/bad token (both routes check first, `:176`,`:222`) | `unauthorized` → 🔒 LOCKED |
| `404` | `{error:"target_not_found"}` | `/not found/i` from `WriteGate.threadOf` — edit target message id not in `messages` (`:285-287`) | `stale` → refresh reconciles |
| `400` | `{error:"bad_body"}` | non-object body; forget: `target_type!=="fact"` / missing / non-uuid `fact_id`; edit: `target`/`replacement` not a non-empty string (`:182,210,213,232,235`) | `bad_request` → honest inline error |
| `400` | `{error:"bad_target_shape"}` | `/use forget\(\) to tombstone\+scrub a message/i` from `store.tombstoneFact` guard (`:288-289`) — defensive, unreachable on these paths | `bad_request` → honest inline error |
| `500` | `{error:"internal"}` | anything else (`:291-292`) | `unreachable` → DOWN |
| `204` | *(empty)* | success (`:206`,`:242`) | `ok` → re-fetch current view |

**4. Verification tooling EXISTS (code fact):**
- `packages/daemon/scripts/memory-demo-harness.ts` boots the **REAL daemon** (`startDaemon`, `:434/446`) and drives it over real HTTP+WS. **STEP 5** (`:712-780`) already POSTs `/memory/forget` with `{target_type:"fact", fact_id}` and asserts exactly-1-delete + target-gone + others-intact (C-fix). **STEP 6** (`:783-788`) does recall-after-forget in a NEW thread. Together these are the real-I/O proof for DoD box 1 (fact gone from view AND from a new thread's injected context; source intact). Run: `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub` (deterministic, hard asserts) and `--mode=real` (real Haiku; needs `ANTHROPIC_API_KEY` in Keychain). *(A probe is evidence only when executed — the worker MUST run it, per Strike-4/5.)*
- **The harness does NOT exercise EDIT.** DoD box 2 (edit → view shows new text / 5e survives re-distill) is verified by a **manual real-daemon probe + `MEMORY_DEBUG=1`** (Step 3.7), not the harness. `memDebug` (`write-gate.ts:127,176`) is env-gated and logs forget/retrieve traces.

**5. `@agentic/protocol` untouched — confirmed.** Nothing in this chunk touches the WS wire envelope; the forget/edit fields are HTTP-body only (ADR-0015 relationship note). CORS already allows `POST`/`OPTIONS` + `authorization`/`content-type`, reflecting the overlay origin (`http-routes.ts:53-97`, chunk-01 seam) → no `http-routes.ts` touch. **Not a freeze gate.**

---

## File Structure (chunk-03)

- **Create** `apps/overlay/src/memory/memory-write.ts` — pure token-gated POST → `WriteResult` (204/401/404/400/5xx/network mapping). Reuses chunk-02's `MemoryApiDeps`.
- **Create** `apps/overlay/src/memory/memory-write.test.ts` — non-DOM; auto-covered by root `tsconfig.json` glob (no tsconfig edit).
- **Create** `apps/overlay/src/memory/actions.ts` — DOM builders `buildForgetControl` (arm→confirm "release the reference") + `buildEditControl` (inline textarea).
- **Create** `apps/overlay/src/memory/actions.test.ts` — DOM; add to `tsconfig.memory-dom-tests.json` include + root `tsconfig.json` exclude.
- **Modify** `apps/overlay/src/memory/render.ts` — additive optional action params on `renderMessages`/`renderFacts` (existing 2-/3-arg callers unaffected).
- **Modify** `apps/overlay/src/memory/render.test.ts` — append action-wiring cases (already in DOM config).
- **Modify** `apps/overlay/src/memory/controller.ts` — wire `onEdit`/`onForget` → `memory-write` → `handleWriteResult` (re-fetch on ok/stale; honest states on failure; session `editedIds`).
- **Modify** `apps/overlay/src/memory/controller.test.ts` — append action-outcome cases (already in DOM config).
- **Modify** `apps/overlay/memory.html` — CSS for `.act-btn`/`.act-forget`/`.act-edit`/`.inline-editor`/`.edited-tag`.
- **Modify** `apps/overlay/tsconfig.memory-dom-tests.json` + root `tsconfig.json` — register `actions.test.ts` (coverage discipline).

---

## Steps

### Step 1 — Pure write module (`memory-write.ts`) + tests

**Files:** Create `apps/overlay/src/memory/memory-write.ts`, `apps/overlay/src/memory/memory-write.test.ts`.

**Interfaces:**
- Consumes: `MemoryApiDeps` (`{ fetchFn, baseUrl, token, timeoutMs? }`) from `./memory-api.js` (chunk-02).
- Produces: `type WriteResult = {kind:"ok"}|{kind:"unauthorized"}|{kind:"stale"}|{kind:"bad_request"}|{kind:"unreachable"}`; `forgetFact(deps, factId): Promise<WriteResult>`; `editMessage(deps, messageId, replacement): Promise<WriteResult>`.

- [ ] **Step 1.1 — Write the failing tests.** `apps/overlay/src/memory/memory-write.test.ts`:
```ts
/**
 * memory-write — token-gated POST mapping. ADR-0013: Bearer header ONLY, never URL/body.
 * Daemon returns 204 (no JSON body) on success. Fake fetchFn records (url, init); no network.
 * NON-DOM by construction (Response/RequestInit/AbortController only) → root tsconfig coverage.
 */
import { test, expect } from "bun:test";
import { forgetFact, editMessage } from "./memory-write.js";
import type { MemoryApiDeps } from "./memory-api.js";

function fakeFetch(status: number, calls: { url: string; init?: RequestInit }[]) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (status === 0) return Promise.reject(new Error("network"));
    // 204 carries NO body (matches the daemon); other statuses carry an error JSON.
    return Promise.resolve(
      status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ error: "x" }), { status }),
    );
  };
}
function deps(fetchFn: MemoryApiDeps["fetchFn"]): MemoryApiDeps {
  return { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK", timeoutMs: 1000 };
}

test("forgetFact 204 → ok", async () => {
  expect((await forgetFact(deps(fakeFetch(204, [])), "F1")).kind).toBe("ok");
});
test("status mapping: 401→unauthorized, 404→stale, 400→bad_request, 500→unreachable", async () => {
  expect((await forgetFact(deps(fakeFetch(401, [])), "F1")).kind).toBe("unauthorized");
  expect((await editMessage(deps(fakeFetch(404, [])), "M1", "x")).kind).toBe("stale");
  expect((await forgetFact(deps(fakeFetch(400, [])), "F1")).kind).toBe("bad_request");
  expect((await editMessage(deps(fakeFetch(500, [])), "M1", "x")).kind).toBe("unreachable");
});
test("network error → unreachable", async () => {
  expect((await forgetFact(deps(fakeFetch(0, [])), "F1")).kind).toBe("unreachable");
});
test("forget POSTs target_type:fact + fact_id; token in Authorization header, never in URL/body", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await forgetFact(deps(fakeFetch(204, calls)), "FACT-UUID");
  const { url, init } = calls[0]!;
  expect(url).toBe("http://127.0.0.1:7777/memory/forget");
  expect(url).not.toContain("TOK");
  expect(init!.method).toBe("POST");
  expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
  expect(init!.body as string).not.toContain("TOK");
  const body = JSON.parse(init!.body as string) as { target_type: string; fact_id: string };
  expect(body.target_type).toBe("fact");
  expect(body.fact_id).toBe("FACT-UUID");
});
test("edit POSTs target(messageId) + replacement", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await editMessage(deps(fakeFetch(204, calls)), "MSG-ID", "new text");
  const body = JSON.parse(calls[0]!.init!.body as string) as { target: string; replacement: string };
  expect(calls[0]!.url).toBe("http://127.0.0.1:7777/memory/edit");
  expect(body.target).toBe("MSG-ID");
  expect(body.replacement).toBe("new text");
});
```

- [ ] **Step 1.2 — Run; verify they fail.** Run: `bun test apps/overlay/src/memory/memory-write.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 1.3 — Implement `apps/overlay/src/memory/memory-write.ts`:**
```ts
/**
 * memory-write (chunk-03, memory-transparency-ui) — token-gated POST mutations.
 * ADR-0013: token rides Authorization: Bearer ONLY — never logged, never in a URL/query/body-key.
 * The daemon returns 204 No Content on success (NOT JSON), so this deliberately does NOT reuse
 * memory-api's getJson (which parses JSON and would throw on the empty body). Every HTTP status
 * maps to a discriminated WriteResult so the UI renders an honest state — never a fake success.
 *
 * ctx { actor:"user", authored_by:"human" } is FIXED server-side (http-routes.ts HTTP_CTX) — the
 * client sends NO ctx. forget targets a FACT by its stable uuid (target_type:"fact" + fact_id);
 * edit targets a MESSAGE by its id (MUTATION-AS-APPEND human correction — WriteGate.edit). See the
 * plan's "## Reality check" §2 for why edit is message-scoped, not fact-scoped.
 */
import type { MemoryApiDeps } from "./memory-api.js";

export type WriteResult =
  | { kind: "ok" }            // 204 No Content — the mutation landed
  | { kind: "unauthorized" }  // 401 — token rejected (locked)
  | { kind: "stale" }         // 404 target_not_found — target gone; a refresh reconciles the view
  | { kind: "bad_request" }   // 400 bad_body / bad_target_shape — client contract bug; never fake success
  | { kind: "unreachable" };  // 5xx / network error / timeout — daemon down

async function post(deps: MemoryApiDeps, path: string, body: unknown): Promise<WriteResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 4000);
  try {
    const res = await deps.fetchFn(`${deps.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.token}`, // ADR-0013 — header only
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 204) return { kind: "ok" };
    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 404) return { kind: "stale" };
    if (res.status === 400) return { kind: "bad_request" };
    return { kind: "unreachable" }; // 5xx or any other unexpected status
  } catch {
    return { kind: "unreachable" }; // network failure / abort
  } finally {
    clearTimeout(timer);
  }
}

/** Forget a distilled fact — durable "release the reference" (ADR-0015). Keys on the fact's
 *  stable uuid; the daemon deletes exactly that row and never scrubs the source messages. */
export function forgetFact(deps: MemoryApiDeps, factId: string): Promise<WriteResult> {
  return post(deps, "/memory/forget", { target_type: "fact", fact_id: factId, reason: "hatch-forget" });
}

/** Edit a MESSAGE — MUTATION-AS-APPEND human correction (WriteGate.edit; ADR-0012 5e). The daemon
 *  fixes authored_by:"human" server-side; the correction wins in the archive view and cannot be
 *  machine-clobbered. `messageId` is a messages.id (a 404 means the message is gone → stale). */
export function editMessage(deps: MemoryApiDeps, messageId: string, replacement: string): Promise<WriteResult> {
  return post(deps, "/memory/edit", { target: messageId, replacement, reason: "hatch-edit" });
}
```

- [ ] **Step 1.4 — Run; verify green.** Run: `bun test apps/overlay/src/memory/memory-write.test.ts`. Expected: PASS.

- [ ] **Step 1.5 — Commit.**
```bash
git add apps/overlay/src/memory/memory-write.ts apps/overlay/src/memory/memory-write.test.ts
git commit -m "feat(overlay): token-gated memory-write POST helper (forget-fact + edit-message → honest WriteResult)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Step 2 — Action DOM builders (`actions.ts`) + render.ts wiring + tests

**Files:** Create `apps/overlay/src/memory/actions.ts`, `apps/overlay/src/memory/actions.test.ts`; Modify `apps/overlay/src/memory/render.ts`, `apps/overlay/src/memory/render.test.ts`, `apps/overlay/tsconfig.memory-dom-tests.json`, `tsconfig.json`.

**Interfaces:**
- Produces: `buildForgetControl(onConfirm: () => void): HTMLButtonElement`; `buildEditControl(current: string, onSave: (newText: string) => void): HTMLButtonElement`; `interface MessageActions { onEdit?: (messageId: string, newText: string) => void; editedIds?: ReadonlySet<string> }`; `interface FactActions { onForget?: (factId: string) => void }`; widened `renderMessages(el, messages, actions?: MessageActions)` and `renderFacts(el, facts, onOpenThread, actions?: FactActions)`.
- Consumes: nothing new at runtime (pure DOM + callbacks).

- [ ] **Step 2.1 — Write the failing `actions.test.ts`.** `apps/overlay/src/memory/actions.test.ts`:
```ts
/**
 * actions — DOM builders for forget-confirm + inline-edit. happy-dom via the root bunfig.toml
 * preload (same as render/controller tests). XSS: textContent/createElement only.
 */
import { test, expect } from "bun:test";
import { buildForgetControl, buildEditControl } from "./actions.js";

function host(child: HTMLElement): HTMLElement {
  const d = document.createElement("div");
  d.appendChild(child);
  document.body.appendChild(d);
  return d;
}

test("forget: first click ARMS (does not confirm), second click confirms exactly once", () => {
  let confirmed = 0;
  const btn = buildForgetControl(() => { confirmed += 1; });
  host(btn);
  btn.click();
  expect(confirmed).toBe(0); // armed, not fired
  expect(btn.textContent).toContain("Release the reference");
  btn.click();
  expect(confirmed).toBe(1); // fired on confirm
  expect(btn.disabled).toBe(true); // locked after confirm — no double-fire
});

test("edit: opens a textarea seeded with current text; Save emits the edited text", () => {
  let saved: string | null = null;
  const btn = buildEditControl("old", (t) => { saved = t; });
  const parent = host(btn);
  btn.click();
  const ta = parent.querySelector("textarea")!;
  expect(ta.value).toBe("old");
  ta.value = "corrected";
  parent.querySelector<HTMLButtonElement>(".act-save")!.click();
  expect(saved).toBe("corrected");
});

test("edit: Cancel closes the editor and re-enables the Edit button", () => {
  const btn = buildEditControl("old", () => { /* noop */ });
  const parent = host(btn);
  btn.click();
  expect(btn.disabled).toBe(true);
  const cancel = Array.from(parent.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
  cancel.click();
  expect(parent.querySelector(".inline-editor")).toBeNull();
  expect(btn.disabled).toBe(false);
});

test("edit: does not open a second editor on repeated Edit clicks", () => {
  const btn = buildEditControl("old", () => { /* noop */ });
  const parent = host(btn);
  btn.click();
  btn.click(); // ignored — editor already open (and btn is disabled)
  expect(parent.querySelectorAll(".inline-editor").length).toBe(1);
});
```

- [ ] **Step 2.2 — Register `actions.test.ts` for type-checking (escaped-test discipline).**
  In `apps/overlay/tsconfig.memory-dom-tests.json`, add to `include`:
```json
  "include": ["src/memory/render.test.ts", "src/memory/controller.test.ts", "src/memory/actions.test.ts"]
```
  In root `tsconfig.json`, add to `exclude`:
```json
  "exclude": ["apps/overlay/src/memory/render.test.ts", "apps/overlay/src/memory/controller.test.ts", "apps/overlay/src/memory/actions.test.ts"]
```
  (`memory-write.test.ts` is NON-DOM → intentionally left in the root glob, NOT added anywhere here.)

- [ ] **Step 2.3 — Run; verify it fails.** Run: `bun test apps/overlay/src/memory/actions.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2.4 — Implement `apps/overlay/src/memory/actions.ts`:**
```ts
/**
 * actions (chunk-03, memory-transparency-ui) — DOM builders for the ACT affordances.
 * XSS discipline (chunk-02 / history.html / text-reply.ts): textContent + createElement ONLY,
 * NEVER innerHTML. No fetch here (memory-write.ts) — these builders only emit DOM + callbacks.
 *
 * Forget = "release the reference": a two-step confirm (arm → confirm). The copy frames it as the
 * agent releasing its reference to the fact — the source conversation is UNTOUCHED (ADR-0015
 * durable fact-delete; decision 5 "also forget sources" is SUPERSEDED — no such option here).
 * Durable by design; no undo window — the confirm IS the safety.
 * Edit = an inline textarea over a MESSAGE → Save/Cancel (MUTATION-AS-APPEND human correction).
 */

const RELEASE_LABEL = "Release the reference? (the agent forgets this — your conversation stays)";

/** Two-step forget button. First click arms (danger style + release-the-reference copy); the
 *  second click disables the button and calls onConfirm(). Returns the button element. */
export function buildForgetControl(onConfirm: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "act-btn act-forget";
  btn.textContent = "Forget fact";
  btn.addEventListener("click", () => {
    if (btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.classList.add("armed");
      btn.textContent = RELEASE_LABEL;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Releasing…";
    onConfirm();
  });
  return btn;
}

/** Inline edit control for a message. The "Edit" button swaps in a textarea + Save/Cancel. Save
 *  calls onSave(newText) (the caller re-fetches → the fresh render replaces the editor). Cancel
 *  closes the editor. Returns the "Edit" button element. */
export function buildEditControl(current: string, onSave: (newText: string) => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "act-btn act-edit";
  btn.textContent = "Edit";
  btn.addEventListener("click", () => {
    const host = btn.parentElement;
    if (host === null || host.querySelector(".inline-editor") !== null) return; // already open
    btn.disabled = true;

    const editor = document.createElement("div");
    editor.className = "inline-editor";
    const ta = document.createElement("textarea");
    ta.value = current;
    ta.rows = 3;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "act-btn act-save";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "act-btn act-cancel";
    cancel.textContent = "Cancel";

    const close = (): void => { editor.remove(); btn.disabled = false; };
    cancel.addEventListener("click", close);
    save.addEventListener("click", () => {
      save.disabled = true;
      cancel.disabled = true;
      save.textContent = "Saving…";
      onSave(ta.value);
    });

    editor.appendChild(ta);
    editor.appendChild(save);
    editor.appendChild(cancel);
    host.appendChild(editor);
  });
  return btn;
}
```

- [ ] **Step 2.5 — Run; verify green.** Run: `bun test apps/overlay/src/memory/actions.test.ts`. Expected: PASS.

- [ ] **Step 2.6 — Wire the controls into `render.ts` (additive optional params).** Add the imports + interfaces at the top of `apps/overlay/src/memory/render.ts` (after the existing imports):
```ts
import { buildForgetControl, buildEditControl } from "./actions.js";

/** chunk-03 (ACT): optional per-row actions. Absent → chunk-02 read-only behavior (existing callers). */
export interface MessageActions {
  /** Attach an inline Edit control per message → POST /memory/edit (WriteGate.edit human correction). */
  onEdit?: (messageId: string, newText: string) => void;
  /** Message ids edited THIS session → shown with an "edited by you" tag. The wire carries no
   *  persistent per-message correction flag (see plan "## Reality check" §2), so this is an honest
   *  optimistic marker; the corrected TEXT itself is persistent via readThreadArchive COALESCE. */
  editedIds?: ReadonlySet<string>;
}
export interface FactActions {
  /** Attach a "release the reference" Forget control per fact → POST /memory/forget (durable delete). */
  onForget?: (factId: string) => void;
}
```
  Then REPLACE `renderMessages` and `renderFacts` with these (identical to chunk-02 except the appended action blocks):
```ts
export function renderMessages(el: HTMLElement, messages: ThreadMessage[], actions?: MessageActions): void {
  clear(el);
  if (messages.length === 0) { renderState(el, "No messages."); return; }
  messages.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = `message-row role-${m.role || "unknown"}`;
    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = `${m.role || "?"} · turn ${i + 1}`;
    if (actions?.editedIds?.has(m.id)) {
      const tag = document.createElement("span");
      tag.className = "edited-tag";
      tag.textContent = " · edited by you";
      role.appendChild(tag);
    }
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = m.content || ""; // may be "[forgotten]" for a tombstoned message
    row.appendChild(role);
    row.appendChild(content);
    if (actions?.onEdit) {
      const onEdit = actions.onEdit;
      row.appendChild(buildEditControl(m.content || "", (newText) => onEdit(m.id, newText)));
    }
    el.appendChild(row);
  });
}

export function renderFacts(
  el: HTMLElement,
  facts: DistilledFactView[],
  onOpenThread: (id: string) => void,
  actions?: FactActions,
): void {
  clear(el);
  if (facts.length === 0) { renderState(el, "No distilled facts."); return; }
  for (const f of facts) {
    const row = document.createElement("div");
    row.className = "fact-row";

    const factEl = document.createElement("div");
    factEl.textContent = f.fact || "";
    row.appendChild(factEl);

    // Provenance (ADR-0012 5c) — thread:<id> is a jump-link; else plain text.
    const prov = document.createElement("div");
    prov.className = "fact-meta";
    const label = document.createElement("span");
    label.textContent = "from: ";
    prov.appendChild(label);
    const ref = parseProvenance(f.provenance || "");
    if (ref.kind === "thread") {
      const link = document.createElement("a");
      link.className = "prov-link";
      link.href = "#";
      link.textContent = f.provenance;
      link.addEventListener("click", (e) => { e.preventDefault(); onOpenThread(ref.threadId); });
      prov.appendChild(link);
    } else {
      const txt = document.createElement("span");
      txt.textContent = ref.raw || "(unknown)";
      prov.appendChild(txt);
    }
    const extra = document.createElement("span");
    extra.textContent = ` · scope: ${f.scope} · ${f.authored_by}`;
    prov.appendChild(extra);
    row.appendChild(prov);

    // Expiry / confidence — SHOWN ONLY WHEN NON-DEFAULT (spec ruling 2026-07-02).
    if (shouldShowExpiry(f)) {
      const exp = document.createElement("div");
      exp.className = "fact-meta fact-expiry";
      exp.textContent = `expires: ${formatTs(f.expiry)}`;
      row.appendChild(exp);
    }
    if (shouldShowConfidence(f)) {
      const conf = document.createElement("div");
      conf.className = "fact-meta fact-confidence";
      conf.textContent = `confidence: ${f.confidence}`;
      row.appendChild(conf);
    }

    // chunk-03 (ACT): "release the reference" forget control (ADR-0015 durable fact-delete).
    if (actions?.onForget) {
      const onForget = actions.onForget;
      row.appendChild(buildForgetControl(() => onForget(f.id)));
    }
    el.appendChild(row);
  }
}
```

- [ ] **Step 2.7 — Append action-wiring cases to `render.test.ts`** (already in the DOM tsconfig):
```ts
import { renderMessages, renderFacts } from "./render.js"; // if not already imported at top

test("chunk-03: renderFacts with onForget appends a forget control; arm→confirm passes the fact id", () => {
  const el = document.createElement("div");
  let forgot: string | null = null;
  renderFacts(
    el,
    [{ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    () => { /* onOpenThread */ },
    { onForget: (id) => { forgot = id; } },
  );
  const btn = el.querySelector<HTMLButtonElement>(".act-forget")!;
  btn.click(); // arm
  expect(forgot).toBeNull();
  btn.click(); // confirm
  expect(forgot).toBe("F1");
});

test("chunk-03: renderMessages with onEdit appends an edit control; editedIds shows the tag", () => {
  const el = document.createElement("div");
  renderMessages(el, [{ id: "M1", role: "user", content: "hi" }], { onEdit: () => { /* noop */ }, editedIds: new Set(["M1"]) });
  expect(el.querySelector(".act-edit")).not.toBeNull();
  expect(el.textContent).toContain("edited by you");
});

test("chunk-03: no actions param → read-only rows (chunk-02 behavior preserved)", () => {
  const el = document.createElement("div");
  renderMessages(el, [{ id: "M1", role: "user", content: "hi" }]);
  expect(el.querySelector(".act-edit")).toBeNull();
});
```

- [ ] **Step 2.8 — Run; verify green.** Run: `bun test apps/overlay/src/memory/render.test.ts apps/overlay/src/memory/actions.test.ts`. Expected: PASS.

- [ ] **Step 2.9 — Commit.**
```bash
git add apps/overlay/src/memory/actions.ts apps/overlay/src/memory/actions.test.ts apps/overlay/src/memory/render.ts apps/overlay/src/memory/render.test.ts apps/overlay/tsconfig.memory-dom-tests.json tsconfig.json
git commit -m "feat(overlay): memory-window ACT DOM — release-the-reference forget + inline message edit controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Step 3 — Controller wiring + honest states + CSS + verification

**Files:** Modify `apps/overlay/src/memory/controller.ts`, `apps/overlay/src/memory/controller.test.ts`, `apps/overlay/memory.html`.

**Interfaces:**
- Consumes: `forgetFact`, `editMessage`, `type WriteResult` from `./memory-write.js`; the widened `renderMessages`/`renderFacts`.
- Produces: no signature change to `MemoryController` (`{ start, onLivenessState }`); internal `handleWriteResult`, `forgetAction`, `editAction`, session `editedIds`.

- [ ] **Step 3.1 — Wire actions into `controller.ts`.** Update `apps/overlay/src/memory/controller.ts`: extend the import, add the `editedIds` set + the action handlers, and pass the callbacks in `loadThread`. Change the import line and add to `createMemoryController`:
```ts
import { forgetFact, editMessage, type WriteResult } from "./memory-write.js";
```
  Inside `createMemoryController`, after `let lastLiveness: ShellState | undefined;`, add:
```ts
  // chunk-03 (ACT): messages the user edited THIS session → an "edited by you" tag on re-render.
  // The wire has no persistent per-message correction flag (plan "## Reality check" §2); the
  // corrected TEXT is persistent via the daemon's readThreadArchive COALESCE.
  const editedIds = new Set<string>();
```
  REPLACE `loadThread` with the version that passes the action callbacks:
```ts
  async function loadThread(threadId: string): Promise<void> {
    renderState(els.messagesEl, "Loading…");
    renderState(els.factsEl, "Loading…");
    renderState(els.eventsEl, "Loading…");
    const r = await fetchThread(deps.api, threadId);
    if (r.kind === "unauthorized") { renderState(els.messagesEl, LOCKED); renderState(els.factsEl, LOCKED); renderState(els.eventsEl, LOCKED); return; }
    if (r.kind === "unreachable") { renderState(els.messagesEl, DOWN); renderState(els.factsEl, DOWN); renderState(els.eventsEl, DOWN); return; }
    renderMessages(els.messagesEl, r.data.messages ?? [], {
      onEdit: (messageId, newText) => void editAction(messageId, newText),
      editedIds,
    });
    renderFacts(els.factsEl, r.data.distilledFacts ?? [], openThread, {
      onForget: (factId) => void forgetAction(factId),
    });
    renderEvents(els.eventsEl, r.data.distillationEvents ?? []);
  }
```
  Add these functions (after `applyDownState`, before `onLivenessState`):
```ts
  /** Map a write result to an honest state — NEVER a fake success (DoD box 3). */
  function handleWriteResult(r: WriteResult): void {
    switch (r.kind) {
      case "ok":            // the mutation landed → re-fetch so the change is visible
      case "stale":         // target already gone → a refresh reconciles the view honestly
        refreshCurrentView(); return;
      case "unauthorized":  applyDownState("unauthorized"); return; // 🔒 LOCKED
      case "unreachable":   applyDownState("unreachable"); return;  // DOWN — no fake success
      case "bad_request":   renderActionError(); return;            // client contract bug (unexpected)
    }
  }

  /** Honest inline error for a 400 (should not happen with correct bodies) — never fake success. */
  function renderActionError(): void {
    const msg = "Action rejected by the engine — please refresh and retry.";
    if (currentView.kind === "detail") {
      renderState(els.messagesEl, msg);
      renderState(els.factsEl, msg);
      renderState(els.eventsEl, msg);
    } else {
      renderState(els.threadListEl, msg, "li");
    }
  }

  async function forgetAction(factId: string): Promise<void> {
    handleWriteResult(await forgetFact(deps.api, factId));
  }

  async function editAction(messageId: string, newText: string): Promise<void> {
    const r = await editMessage(deps.api, messageId, newText);
    if (r.kind === "ok") editedIds.add(messageId); // mark THIS session's edit for the tag
    handleWriteResult(r);
  }
```
  (`refreshCurrentView`, `applyDownState`, `currentView`, `LOCKED`, `DOWN` all already exist from the Demo-1 fix.)

- [ ] **Step 3.2 — Append action-outcome cases to `controller.test.ts`** (already in the DOM tsconfig). Uses a POST-aware fake:
```ts
test("chunk-03 forget: 204 → re-fetch, fact gone; unreachable → DOWN (no fake success)", async () => {
  let mode: "up" | "down" = "up";
  const facts = [{ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (mode === "down") return Promise.reject(new Error("refused"));
    if (init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    const body = url.includes("/memory/thread/")
      ? { messages: [], distilledFacts: facts.slice(), distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  expect(els.factsEl.querySelector(".fact-row")).not.toBeNull();

  const forgetBtn = els.factsEl.querySelector<HTMLButtonElement>(".act-forget")!;
  forgetBtn.click();          // arm
  facts.length = 0;           // server now returns 0 facts on the re-fetch
  forgetBtn.click(); await flush(); // confirm → POST 204 → re-fetch
  expect(els.factsEl.textContent).toContain("No distilled facts"); // gone on reload — real, not faked

  // now daemon-down while acting
  mode = "up"; facts.push({ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" });
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")?.click(); // no-op (in detail) — reopen path below
});

test("chunk-03 forget: POST rejected (daemon down) → DOWN, never a fake success", async () => {
  let postMode: "ok" | "down" = "down";
  const facts = [{ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") {
      if (postMode === "down") return Promise.reject(new Error("refused"));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const body = url.includes("/memory/thread/")
      ? { messages: [], distilledFacts: facts.slice(), distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  const btn = els.factsEl.querySelector<HTMLButtonElement>(".act-forget")!;
  btn.click(); btn.click(); await flush(); // arm + confirm → POST rejected
  expect(els.factsEl.textContent).toContain("Daemon unreachable"); // honest, no "gone"/success
});

test("chunk-03 edit: 204 → re-fetch, corrected text shown + 'edited by you' tag", async () => {
  let content = "hi";
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") { content = "corrected"; return Promise.resolve(new Response(null, { status: 204 })); }
    const body = url.includes("/memory/thread/")
      ? { messages: [{ id: "M1", role: "user", content }], distilledFacts: [], distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  els.messagesEl.querySelector<HTMLButtonElement>(".act-edit")!.click(); // open editor
  const ta = els.messagesEl.querySelector("textarea")!;
  ta.value = "corrected";
  els.messagesEl.querySelector<HTMLButtonElement>(".act-save")!.click(); await flush(); // POST → re-fetch
  expect(els.messagesEl.textContent).toContain("corrected"); // new text visible on reload
  expect(els.messagesEl.textContent).toContain("edited by you"); // session marker
});
```

- [ ] **Step 3.3 — Run; verify green.** Run: `bun test apps/overlay/src/memory/controller.test.ts`. Expected: PASS (chunk-02/Demo-1 cases + the new chunk-03 cases).

- [ ] **Step 3.4 — Add CSS to `apps/overlay/memory.html`** (inside the existing `<style>`, after the `.event-date` rule):
```css
      .act-btn { font-size: 12px; margin-top: 6px; margin-right: 6px; padding: 2px 8px; border: 1px solid #c8c8c8; border-radius: 4px; background: #fff; cursor: pointer; color: #333; }
      .act-btn:hover { background: #f0f0f0; }
      .act-btn[disabled] { color: #aaa; border-color: #e0e0e0; cursor: default; background: #fff; }
      .act-forget { border-color: #e0a0a0; color: #b04040; }
      .act-forget.armed { background: #b02020; border-color: #b02020; color: #fff; }
      .act-edit { border-color: #a0b8e0; color: #2060b0; }
      .inline-editor { margin-top: 6px; }
      .inline-editor textarea { width: 100%; font: inherit; padding: 6px; border: 1px solid #c8c8c8; border-radius: 4px; resize: vertical; }
      .edited-tag { color: #2060b0; font-weight: 600; }
```

- [ ] **Step 3.5 — Verify all mechanical gates + coverage discipline + frozen surfaces.** Run:
  - `bun test` (whole suite — Expected: all green).
  - `bun run lint:strict` (`--max-warnings=0`).
  - `bun run typecheck` (root) AND `cd apps/overlay && bun run typecheck` (runs `tsconfig.json` + `tsconfig.memory-dom-tests.json`).
  - **Escaped-test probe (each new test type-checked EXACTLY once):**
    `tsc --noEmit -p tsconfig.json --listFiles | grep -c 'memory-write.test.ts'` → `1`;
    `tsc --noEmit -p tsconfig.json --listFiles | grep -c 'actions.test.ts'` → `0` (excluded from root);
    `cd apps/overlay && tsc --noEmit -p tsconfig.memory-dom-tests.json --listFiles | grep -c 'actions.test.ts'` → `1`.
  - **Frozen surfaces:** `git diff --stat packages/protocol/` → no output; `git diff --stat packages/daemon/ apps/overlay/src/memory-liveness.ts apps/overlay/src/ws/ apps/overlay/src-tauri/` → **no output** (daemon, liveness poll, agent connection, and Rust shell all byte-unchanged).

- [ ] **Step 3.6 — Behavioral: forget durability (real-I/O, MUST be executed).** Run the demo harness against the REAL daemon:
  `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub` → expect STEP 5 `C: GREEN — exactly 1 fact deleted (targeted only), others intact` and STEP 6 recall-after-forget. Then, if a key is available: `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=real`. Paste the STEP 5/6 stdout into the PR body (Strike-5: evidence only when executed). This proves the `/memory/forget` route + durability that the UI's forget button calls; *the UI end-to-end forget still `requires runtime demo to confirm`.*

- [ ] **Step 3.7 — Behavioral: edit 5e probe (real-daemon, MUST be executed).** The harness does NOT cover edit. Run this against a running daemon (`MEMORY_DEBUG=1`):
```bash
# 1) token + a thread with a user message id (from the running daemon)
TOKEN=$(cat "$HOME/.agentic-engine/auth-token")
TID=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7777/memory/threads | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.threads[0].thread_id)')
MID=$(curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7777/memory/thread/$TID" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.messages.find(m=>m.role==="user").id)')
# 2) edit the message (human correction)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:7777/memory/edit \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"target\":\"$MID\",\"replacement\":\"CORRECTED BY HUMAN\",\"reason\":\"edit-5e-probe\"}"   # expect 204
# 3) view → the corrected text surfaces (readThreadArchive COALESCE — human wins)
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7777/memory/thread/$TID" | grep -q "CORRECTED BY HUMAN" && echo "5e: corrected text in view ✓"
# 4) drive a re-distill on that thread (a WS turn + close) with MEMORY_DEBUG=1 and confirm the
#    distiller READS the corrected text and does NOT clobber the human correction.
```
  Mark the outcome *"requires runtime demo to confirm"* — it is Lior's live §6.1 sign-off, not a code-reading claim.

- [ ] **Step 3.8 — Commit.**
```bash
git add apps/overlay/src/memory/controller.ts apps/overlay/src/memory/controller.test.ts apps/overlay/memory.html
git commit -m "feat(overlay): wire memory-window ACT — forget/edit actions → honest WriteResult states, session edited-tag

Forget = release-the-reference (durable fact-delete, sources untouched, ADR-0015); edit =
MUTATION-AS-APPEND human correction on a message (ADR-0012 5e). ok/stale → re-fetch the current
view; unauthorized → LOCKED; unreachable → DOWN (no fake success); protocol + daemon byte-unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification (chunk-03 DoD mapping)

The chunk's five DoD boxes (`03-memory-window-edit-forget.md` §Done criteria):

**Mechanical (provable by the worker now):**
- **DoD box 4 — `bun test` / `lint:strict` / typecheck green:** Steps 1.4, 2.5, 2.8, 3.3, 3.5. New coverage: status→WriteResult mapping + token/body discipline (`memory-write.test.ts`), forget-confirm + inline-edit DOM (`actions.test.ts`), render action wiring + edited-tag + read-only-default (`render.test.ts`), controller write-outcome handling incl. no-fake-success on down (`controller.test.ts`). Escaped-test probe in Step 3.5.
- **DoD box 5 — `git diff packages/protocol/` empty:** Step 3.5 (`git diff --stat packages/protocol/` → no output). No protocol touch anywhere.

**Behavioral — ALL "requires runtime demo to confirm" (PIPELINE §6.1; a probe is evidence only when executed). This chunk owns spec demo-checklist items 3+4; final joint sign-off rides chunk-04:**
- **[requires runtime demo to confirm] DoD box 1 (forget):** From the memory window, forget a fact → the "release the reference" confirm copy shows → on confirm the fact is durably removed (gone from the view AND from a NEW thread's injected context) → the source thread's messages remain intact and viewable. *Real-I/O route+durability proof = the demo harness STEP 5/6 (Step 3.6, executed); UI end-to-end = Lior's live macOS demo.*
- **[requires runtime demo to confirm] DoD box 2 (edit):** Edit a message → the correction lands (`authored_by:"human"`, fixed server-side) → the view shows the new text (readThreadArchive COALESCE) with the session "edited by you" tag → a subsequent distillation does not overwrite it (5e). *Verified via the Step 3.7 real-daemon probe + MEMORY_DEBUG; UI end-to-end = Lior's live demo.*
- **[requires runtime demo to confirm] DoD box 3 (honest degrade):** Kill the daemon mid-session → a forget/edit degrades to the honest unreachable state (DOWN), no action reports fake success. *Mapping unit-tested in `controller.test.ts` (Step 3.2); end-to-end = Lior's live demo.*

Intermediate gates use real I/O across the daemon boundary (the harness, Step 3.6; the real-daemon edit probe, Step 3.7), per the standing Strike-4/5 rule — no mocks across the daemon boundary for the behavioral proof.

---

## ADR worthy: no

Rationale:
- **No new boundary, no new decision.** This consumes already-decided, already-shipped contracts: token-gated writes (ADR-0013 Option B + read-token rider), intent-based fact-forget as durable delete (ADR-0015 — the v2 model, decision 5 SUPERSEDED, sources untouched), view/edit/forget hatch + 5e never-clobber-human (ADR-0012 5a/5e), engine-owned native surface (ADR-0005), tray-opened window (ADR-0006). No new route, no new dependency, no auth change.
- **`@agentic/protocol` + `packages/daemon/**` byte-unchanged** — the forget/edit fields are HTTP-body only (ADR-0015 relationship note), not wire-envelope variants. Not a freeze gate.

**Reviewer escalation clause (mirrors chunk-01/-02):** if the reviewer judges the message-scoped-edit reconciliation (Reality check §2) or the session-local edited-tag to warrant recording, that is a **note/rider on ADR-0012**, not a new ADR — escalate to `adr-curator` before merge. (Not expected.)

---

## Risks & flags (chunk-03)

- **FLAG (loud) — `/memory/edit` edits a MESSAGE, not a distilled fact.** The chunk brief and spec say "edit a fact"; the frozen backend (`hatch.edit → WriteGate.edit(messageId)`) and the reference impl (`history.html` Edit-on-messages) both edit a MESSAGE via a MUTATION-AS-APPEND human correction — there is NO route to edit a `distilled_facts` row or author a human fact. This plan builds Edit on message rows (the spec's own MUTATION-AS-APPEND wording). **If Lior actually meant fact-level editing, that is a NEW daemon path → freeze gate → separate feature, NOT this chunk** — stop and escalate before building it.
- **FLAG — "human-authored marker" on an edited message is session-local, not persistent.** The `ThreadMessage` wire (`{id,role,content}`) carries no per-message correction flag. The corrected *text* is persistent (COALESCE), but the "edited by you" badge is a this-session optimistic marker. A persistent badge would need an additive daemon read field (like chunk-02's `status`) — deliberately NOT added (keeps "NO daemon changes"). If Lior wants a durable "human-edited" badge, that is a small additive daemon read-gap to weigh separately.
- **Facts render `authored_by` (chunk-02 already shows it), but no route makes a fact human-authored** — so facts show `machine` in practice; editing a message does not flip any fact to `human`. This is expected given the frozen surface.
- **Success is `204 No Content` (no body) — do NOT reuse chunk-02's `getJson`** (it calls `res.json()` and would throw on an empty body). `memory-write.ts` handles 204 explicitly.
- **Edit control attaches to every message row (history.html parity), including tombstoned `[forgotten]` rows.** Editing a redacted message would append a human correction re-introducing content — an intentional human action, but note it; if undesired, gate `onEdit` off rows whose content equals the redaction marker (a follow-up, not required for parity).
- **XSS discipline is load-bearing** — all user-entered edit text + API strings via `textContent`/`createElement`; ZERO `innerHTML`. A regression here is a security defect. Reviewer must confirm no `innerHTML` in `actions.ts`/`render.ts`.
- **NOT a freeze gate:** nothing touches `packages/protocol/**` or `packages/daemon/**`; verified in Step 3.5.

## Status: Done

# ══════════════ CHUNK 5 — FACT-EDIT (appended by orchestrator, 2026-07-09) ══════════════

> Chunks 01/02/03 are above (shipped). Below is chunk-05 (FACT-edit — edit what the agent *remembers*). Same per-feature plan file; chunk-04 archives the whole file at feature closeout.

# Memory Window — FACT-EDIT (edit the distilled-fact text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is **chunk-05** of feature `memory-transparency-ui` (backlog Theme A). Scope is FROZEN by `orchestration/chunks-todo/memory-transparency-ui/05-memory-window-fact-edit.md` — you may FLAG problems, do not exceed or edit it. Builds on chunk-03 (edit+forget plumbing, shipped PR #77) and chunk-02 (READ view, shipped PR #76).

**Goal:** Add the ability to edit **what the agent remembers** — the distilled-fact *text* — closing the chunk-03 FLAG (its Edit operated only on messages; ADR-0012 5a promises "see, **correct**, and delete what the agent remembers"). Message-edit stays exactly as shipped.

**Architecture:** One additive fact-correction primitive threaded through the existing seam `store → WriteGate → Hatch → HTTP route`, mirroring the already-shipped `forgetFactById` chain. The HTTP `POST /memory/edit` gains a `target_type:"fact"` discriminator (mirror of the forget route's `fact_id` shape) that updates a `distilled_facts` row's text and stamps `authored_by:"human"`. The existing v2 human-precedence machinery (never-replace-human demote + dedup-suppress) then protects the edited fact against the next distillation — this chunk **WIRES** that machinery (stamps the fact human + refreshes its FTS canonical), it does **not** rebuild it. Overlay adds an inline Edit affordance on fact rows (reusing chunk-03's `buildEditControl`) and a **data-driven, persistent** "yours" badge derived from the fact's own `authored_by`.

**Tech Stack:** TypeScript on Bun, `bun:sqlite`, `Bun.serve` HTTP, Tauri webview, `fetch` + `AbortController`, `bun:test` + happy-dom (root `bunfig.toml` preload).

## Global Constraints (chunk-05)

- **`@agentic/protocol` frozen — byte-unchanged.** `git diff --stat packages/protocol/` MUST be empty. Fact-edit is an HTTP **body** field only (ADR-0015 relationship note: edit/forget fields are HTTP-body, never the WS envelope).
- **Daemon diff limited to the additive edit path** — `store.ts` / `write-gate.ts` / `hatch.ts` / `http-routes.ts` + their tests + the harness. **Do NOT touch** message-edit behavior, `WriteGate.edit`/`forget`/`forgetFact`/`forgetFactById`, the WS envelope, `connection-manager.ts`, `memory-liveness.ts`, `src-tauri/**`, or the distiller (`distiller-registration.ts` / `smart-distiller-provider.ts` — the human-precedence logic there is CONSUMED unchanged).
- **Security-adjacent (reviewer attention, flag in PR):** `http-routes.ts`, `write-gate.ts`, `hatch.ts`, `store.ts` are the ADR-0013 poisoning-write surface. The token gate and fixed server-side `HTTP_CTX = {actor:"user", authored_by:"human"}` are REUSED unchanged — the new fact branch sits **inside** the existing token gate and uses `HTTP_CTX`; no new auth surface.
- **ADR-0013 token discipline:** the per-install token rides `Authorization: Bearer <token>` ONLY — never a URL/query/body key, never logged. Overlay reuses the token already in `MemoryApiDeps`.
- **XSS discipline (security, not style):** all API-derived and user-entered strings via `textContent`/`createElement`. ZERO `innerHTML`. Mirrors chunk-02/03 `render.ts`/`actions.ts`.
- **5e is honored by WIRING, not by new logic:** stamping the edited fact `authored_by:"human"` + refreshing its `fact_fts` canonical makes the existing `distiller-registration.ts` never-replace-human demote (`:203-207`) and dedup-suppress (`:277`, `store.factExistsByDedupKey`) protect it. Do NOT add a new guard in the distiller.
- **Escaped-test discipline (bit chunks 01/02/03):** every new/changed test must be type-checked exactly once. Daemon tests (`packages/daemon/src/**/*.test.ts`, `scripts/**`) are auto-covered by `packages/daemon/tsconfig.json` + root `tsconfig.json`. Overlay **non-DOM** tests (`memory-write.test.ts`) are auto-covered by root `tsconfig.json`'s `apps/overlay/src/memory/**/*.test.ts` glob. Overlay **DOM** tests (`render.test.ts`, `controller.test.ts`) are covered by `apps/overlay/tsconfig.memory-dom-tests.json`. **APPEND cases to those EXISTING files** → no tsconfig edit. If you create any NEW DOM test file, you MUST add it to `tsconfig.memory-dom-tests.json` `include` AND root `tsconfig.json` `exclude` (the chunk-02/03 gap class).

---

## Reality check (chunk-05)

Per PIPELINE §6.1: statements below are **code-path facts** (verified by reading source, lines cited) or **runtime inferences** marked *"requires runtime demo to confirm"* — never asserted as behavioral truth from reading. Every hypothesis in the chunk brief was checked against source; corrections noted.

**1. `POST /memory/edit` and `POST /memory/forget` handler shapes (code facts, `packages/daemon/src/memory/http-routes.ts`):**
- `handleEdit` (`:220-246`): token-gated first (`tokenStore.verify`, 401 on miss, `:222`). Reads body `{ target, replacement, reason? }` (`:230`); `target` must be a non-empty string and `replacement` a string (`:231-236`, else `400 bad_body`). Calls `deps.hatch.edit(target, replacement, HTTP_CTX, reasonStr)` (`:241`) → **message correction** → `204`. **There is NO `target_type` discriminator on the edit route today** (the brief's "extend edit with target_type" is correct: it does not exist yet).
- `handleForget` (`:174-218`): the shape to **mirror**. Reads `{ target_type, reason?, fact_id }` (`:184`). Only accepted path is `target_type === "fact"` with a **uuid-shaped `fact_id`** (`:199-207`, `UUID_RE`) → `deps.hatch.forgetFactById(fact_id, HTTP_CTX, reasonStr)` → `204`; anything else → `400 bad_body` (`:210-213`).
- `HTTP_CTX = { actor:"user", authored_by:"human" }` is fixed server-side (`:51`) and reused for all write routes — the 5e machine-clobber guard therefore never fires on the HTTP path (`:16-22`). `mapWriteError` (`:283-293`): `/not found/i` → `404 target_not_found`; the tombstone-guard message → `400 bad_target_shape`; else `500 internal`.

**2. `WriteGate` API (code facts, `write-gate.ts`) — CONFIRMED: there is NO fact-edit / fact-correction primitive; one must be added.**
- `edit(messageId, replacement, ctx, reason?)` (`:193-216`) is **message-scoped** (`threadOf(messageId)` throws `not found` for a non-message id; appends a `mutations` `kind='correction'`). Not usable for a `distilled_facts` row.
- `forgetFactById(factId, ctx, reason?)` (`:150-183`) is the exact template for the new `editFact`: resolves the row's `authored_by`, applies the 5e seam (`row.authored_by==='human' && ctx.authored_by==='machine'` → refuse), delegates to a `store.*ById` primitive. **No route sets a fact's `authored_by='human'`** anywhere today (grep confirmed: `insertFact({authored_by:"human"})` appears ONLY in tests and never on the HTTP path; `distiller-registration.ts` always inserts `authored_by:"machine"`).

**3. Store fact model + the v2 human-precedence machinery (code facts, `store.ts` / `schema.ts` / `distiller-registration.ts`):**
- `distilled_facts` (`schema.ts:60-70`) has `id` (stable uuid), `fact` (display text), `provenance`, `scope`, `expiry`, `confidence`, `authored_by ('human'|'machine')`, `derived_at`, `distiller_version`. Derived tables `fact_fts` (canonical match key) + `fact_topics`; an AFTER-DELETE trigger cleans both (`schema.ts:122-127`).
- `store.updateFactById(id, u, ctx, distillerVersion)` (`:880-894`) is the in-place REPLACE primitive (records prior text via `recordReplacedFact`, refreshes `fact_fts`/`fact_topics` via private `writeFactDerived`). **It does NOT touch `authored_by`** and its `UpdateFactInput` has no such field — so it cannot be used directly to stamp a fact human. → **The new `editFactById` mirrors it but ALSO sets `authored_by='human'` and follows the human-fact derived-row convention** (`writeFactDerived(id, normalizeFactText(newText), [])`, exactly as `rebuildDerivedForHumanFacts` `:940-954` treats human facts: canonical = `normalizeFactText`, topics = `[]`).
- **The human-precedence machinery to WIRE (do NOT rebuild), named exactly:**
  - **Never-overwrite-human (5e):** `distiller-registration.ts:203-207` — a REPLACE op whose target row `authored_by==='human'` is demoted to `new` (`effectiveOp="new"`); also demoted by the optimistic-concurrency check (`:199-202`). The demoted insert falls to the `new` branch (`:270-291`).
  - **Dedup-suppress:** `store.factExistsByDedupKey(newItemCanonical)` (`:497-509`, matches on `normalizeFactText` OR `dedupConnectorKey` over `COALESCE(fact_fts.canonical, distilled_facts.fact)`) is called on that demoted insert (`distiller-registration.ts:277`) → hit ⇒ skip. **This is why the edited fact's `fact_fts.canonical` MUST be refreshed** (Step 1) — so the demoted machine re-derivation of the same content is suppressed rather than duplicated.
  - `store.forgetFactById → deleteFactById` (`:974-977`) remains the forget path (idempotent). Forget on a `authored_by='human'` row by a **human** ctx is allowed (proven by `write-gate.test.ts:394-421`, "user CAN delete their own facts").

**4. `HatchViewResult` already exposes `authored_by` per fact — NO additive read field needed (code fact).** `Hatch.view` (`hatch.ts:54-64`) returns `distilledFacts: DistilledFactRow[]`; `readDistilledFacts` (`store.ts:285-290`) SELECTs `authored_by`; `DistilledFactRow` includes `authored_by: string` (`:96-105`). The overlay wire type `DistilledFactView.authored_by` (`apps/overlay/src/memory/types.ts:17`) already carries it, and chunk-02 `render.ts` already prints it in the meta line (`:121`). So the read side is **already sufficient**; the badge is a pure overlay change (chunk brief Note item is moot — nothing to add on the read payload).

**5. Overlay module split + additive slot-in points (code facts, `apps/overlay/src/memory/`):**
- `types.ts` — `DistilledFactView` already has `authored_by` (`:17`). **No change.**
- `memory-api.ts` — read fetch (`fetchThreads`/`fetchThread`) + `MemoryApiDeps {fetchFn, baseUrl, token, timeoutMs?}`. **No change** (reused).
- `fact-view.ts` — pure display helpers (`parseProvenance`, `shouldShowExpiry`, …). **No change.**
- `memory-write.ts` — token-gated POST → discriminated `WriteResult` (`204→ok / 401→unauthorized / 404→stale / 400→bad_request / 5xx+network→unreachable`), 4s `AbortController`, handles 204 no-body explicitly. Has `forgetFact(deps, factId)` and `editMessage(deps, messageId, replacement)`. → **ADD `editFact(deps, factId, replacement)`** (fact variant; `editMessage` untouched).
- `actions.ts` — `buildEditControl(current, onSave)` is already message-agnostic (inline textarea, `textContent`/`createElement`, zero `innerHTML`). **Reuse as-is; no change.** `buildForgetControl` unchanged.
- `render.ts` — `renderFacts(el, facts, onOpenThread, actions?)` with `FactActions { onForget? }` (`:21-24, 85-146`). → **ADD `onEditFact?` to `FactActions`**, an Edit control per fact row (`buildEditControl(f.fact, (t)=>onEditFact(f.id,t))`), and a **persistent human badge** rendered when `f.authored_by === "human"`. Only caller is `controller.ts`; `history.html` does NOT use `render.ts`.
- `controller.ts` — wires `renderFacts(..., { onForget })` (`:96-98`) and `handleWriteResult` (re-fetch on ok/stale, honest `LOCKED`/`DOWN`/inline-error otherwise). → **ADD `editFactAction`** + wire `onEditFact`. Note: unlike the message `editedIds` session set (session-local optimistic tag), the fact badge is **data-driven** — after `ok`, `refreshCurrentView()` re-fetches and the fact returns `authored_by:"human"`, so the badge is durable with no session state.

**6. Real-I/O proof tooling EXISTS (code facts):**
- `packages/daemon/scripts/memory-demo-harness.ts` boots the **REAL daemon** (`startDaemon`, `:434/446`) over real HTTP+WS with a scripted `SmartDistillerProvider` client (stub) or real Haiku (`--mode=real`). STEP 5 already POSTs `/memory/forget {target_type:"fact", fact_id}`; CHANGE→ONE-FACT + DEDUP-AFTER-RECALL already assert the dedup/REPLACE interplay. **It does NOT exercise EDIT** — Step 2 adds a FACT-EDIT step.
- `distiller-integration.daemon.test.ts` + `distiller-registration.test.ts` are the real-I/O `bun test` pattern (real SQLite + `WriteGate` + `registerDistiller`; the ONLY mock is a scripted `MemoryProvider.distill`). `distiller-registration.test.ts:339-390` is a working never-replace-human proof to model. **The 5e/dedup box MUST be proven by an EXECUTED run — the harness stub-mode hard-assert AND a new `bun test` integration case — not code-reading (§6.1 / Strike-5).**
- **Behavioral facts requiring runtime demo to confirm** (never asserted from reading): (a) edited fact visible + human badge after a full app restart; (b) 5e survival + no-duplicate after a *real* distillation cycle; (c) daemon-down mid-edit → honest `unreachable`, no fake success. These are the DoD behavioral boxes — proven by the executed harness (`--mode=stub` hard-assert + `--mode=real` informational) and the integration test, and consolidated in the chunk-04 JOINT live demo.

---

## File Structure (chunk-05)

- **Modify** `packages/daemon/src/memory/store.ts` — add `editFactById(id, newText, ctx)` (fact-correction primitive; stamps `authored_by='human'`, refreshes derived rows, records prior text).
- **Modify** `packages/daemon/src/memory/store.test.ts` — append `editFactById` unit cases.
- **Modify** `packages/daemon/src/memory/write-gate.ts` — add `editFact(factId, newText, ctx, reason?)` (delegates to `editFactById`; 5e machine-over-human seam mirroring `forgetFactById`).
- **Modify** `packages/daemon/src/memory/write-gate.test.ts` — append `editFact` unit cases (human applies; machine-over-human refused).
- **Modify** `packages/daemon/src/memory/hatch.ts` — add `editFact(factId, newText, ctx, reason?)` passthrough.
- **Modify** `packages/daemon/src/memory/hatch.daemon.test.ts` — append a Hatch `editFact` case.
- **Modify** `packages/daemon/src/memory/http-routes.ts` — `handleEdit` gains the `target_type:"fact"` branch (mirror forget's `fact_id`/uuid shape); message-edit path byte-preserved.
- **Modify** `packages/daemon/src/memory/http-routes.daemon.test.ts` — append fact-edit route cases + a message-edit regression case.
- **Create** `packages/daemon/src/memory/fact-edit-redistill.daemon.test.ts` — the deterministic 5e + dedup + forget integration proof (auto-covered by daemon tsconfig).
- **Modify** `packages/daemon/scripts/memory-demo-harness.ts` — add the FACT-EDIT executed real-I/O step (+ one scripted-client branch).
- **Modify** `apps/overlay/src/memory/memory-write.ts` — add `editFact(deps, factId, replacement)`.
- **Modify** `apps/overlay/src/memory/memory-write.test.ts` — append fact-edit mapping cases (non-DOM; root tsconfig glob).
- **Modify** `apps/overlay/src/memory/render.ts` — `FactActions.onEditFact?` + fact-row Edit control + persistent human badge.
- **Modify** `apps/overlay/src/memory/render.test.ts` — append fact-edit affordance + badge DOM cases (DOM config).
- **Modify** `apps/overlay/src/memory/controller.ts` — add `editFactAction` + wire `onEditFact`.
- **Modify** `apps/overlay/src/memory/controller.test.ts` — append fact-edit outcome cases (DOM config).
- **Modify** `apps/overlay/memory.html` — add `.human-badge` CSS (mirror `.edited-tag`).

---

## Steps

### Step 1 — Daemon fact-correction primitive (store → WriteGate → Hatch) + unit tests

**Files:** Modify `store.ts`, `store.test.ts`, `write-gate.ts`, `write-gate.test.ts`, `hatch.ts`, `hatch.daemon.test.ts`.

**Interfaces:**
- Consumes: `store.recordReplacedFact`, private `store.writeFactDerived`, `normalizeFactText` (already imported in `store.ts:7`); `WriteGate` ctor `(store, scanner)`; `Hatch` ctor `(store, gate)`; `WriteContext {actor, authored_by:"human"|"machine"}`.
- Produces:
  - `MemoryStore.editFactById(id: string, newText: string, ctx: { actor: string; reason?: string }): boolean`
  - `WriteGate.editFact(factId: string, newText: string, ctx: WriteContext, reason?: string): boolean`
  - `Hatch.editFact(factId: string, newText: string, ctx: WriteContext, reason?: string): boolean`

- [ ] **Step 1.1 — Write the failing store test.** Append to `packages/daemon/src/memory/store.test.ts`:
```ts
test("editFactById: updates text + stamps authored_by='human' + records prior text + refreshes canonical", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "fe-store-")) });
  const id = store.insertFact({
    fact: "favourite colour blue", canonical: "favourite colour blue",
    provenance: "thread:seed", scope: "cross-thread", expiry: null,
    confidence: 1, authored_by: "machine", topics: ["#preferences"],
  }, "seed");

  const ok = store.editFactById(id, "favourite colour green", { actor: "user", reason: "hatch-fact-edit" });
  expect(ok).toBe(true);

  const row = store.rawDb().query("SELECT fact, authored_by FROM distilled_facts WHERE id = ?").get(id) as { fact: string; authored_by: string };
  expect(row.fact).toBe("favourite colour green");
  expect(row.authored_by).toBe("human");
  // prior text durably recorded (5c / m4 audit)
  const replaced = store.readReplacedFacts(id);
  expect(replaced.length).toBe(1);
  expect(replaced[0]!.replaced_text).toBe("favourite colour blue");
  // fact_fts canonical refreshed to the new text → dedup + candidate visible
  const fts = store.rawDb().query("SELECT canonical FROM fact_fts WHERE fact_id = ?").get(id) as { canonical: string };
  expect(fts.canonical).toBe(normalizeFactText("favourite colour green"));
  store.close();
});
test("editFactById: unknown id → false, no throw", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "fe-store2-")) });
  expect(store.editFactById(crypto.randomUUID(), "x", { actor: "user" })).toBe(false);
  store.close();
});
```
(`normalizeFactText` is already imported in `store.test.ts` if not, add `import { normalizeFactText } from "./normalize-fact-text.js";`.)

- [ ] **Step 1.2 — Run it, verify it fails.** `bun test packages/daemon/src/memory/store.test.ts` → FAIL (`editFactById` not a function).

- [ ] **Step 1.3 — Implement `editFactById` in `store.ts`** (place near `updateFactById`, `:880`):
```ts
/**
 * Human fact-correction (chunk-05 FACT-EDIT; ADR-0012 5a "correct what the agent remembers").
 * REPLACE a fact's display text in place (id UNCHANGED — stability) AND stamp
 * authored_by='human', refreshing fact_fts + fact_topics and DURABLY recording the prior text
 * (recordReplacedFact) for audit (spec §3.2 m4 / ADR-0012 5c). All in one tx. Returns false if id absent.
 *
 * Distinct from updateFactById (the distiller's MACHINE replace): this stamps authored_by='human'
 * so the fact becomes 5e-protected — the never-replace-human demote (distiller-registration Q5 step 3)
 * makes every future machine REPLACE targeting it non-destructive, and factExistsByDedupKey suppresses
 * a demoted re-insert. Derived rows follow the human-fact convention (rebuildDerivedForHumanFacts):
 * canonical = normalizeFactText(newText), topics = [] (human facts carry no LLM tags).
 * provenance/scope/expiry/confidence/distiller_version are LEFT UNCHANGED — a human edit is not a
 * distiller output; provenance stays the read-affordance to the fact's origin.
 */
editFactById(id: string, newText: string, ctx: { actor: string; reason?: string }): boolean {
  const tx = this.db.transaction((): boolean => {
    const prior = this.db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string } | null;
    if (prior === null) return false;
    this.recordReplacedFact(id, prior.fact, ctx);
    this.db.query("UPDATE distilled_facts SET fact = ?, authored_by = 'human', derived_at = ? WHERE id = ?")
      .run(newText, Date.now(), id);
    this.db.query("DELETE FROM fact_fts WHERE fact_id = ?").run(id);
    this.db.query("DELETE FROM fact_topics WHERE fact_id = ?").run(id);
    this.writeFactDerived(id, normalizeFactText(newText), []);
    return true;
  });
  return tx();
}
```

- [ ] **Step 1.4 — Run store tests, verify pass.** `bun test packages/daemon/src/memory/store.test.ts` → PASS.

- [ ] **Step 1.5 — Write the failing WriteGate + Hatch tests.** Append to `write-gate.test.ts`:
```ts
test("editFact (human): applies text + stamps human", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "fe-wg-")) });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const id = store.insertFact({ fact: "colour blue", canonical: "colour blue", provenance: "thread:t",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: [] }, "seed");
  expect(gate.editFact(id, "colour green", { actor: "user", authored_by: "human" }, "hatch-fact-edit")).toBe(true);
  const row = store.rawDb().query("SELECT fact, authored_by FROM distilled_facts WHERE id = ?").get(id) as { fact: string; authored_by: string };
  expect(row.fact).toBe("colour green");
  expect(row.authored_by).toBe("human");
  store.close();
});
test("editFact (5e seam): machine ctx over a human fact → refused no-op", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "fe-wg2-")) });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const id = store.insertFact({ fact: "human pin", canonical: "human pin", provenance: "thread:t",
    scope: "cross-thread", expiry: null, confidence: 1, authored_by: "human", topics: [] }, "seed");
  expect(gate.editFact(id, "machine overwrite", { actor: "agent", authored_by: "machine" })).toBe(false);
  const row = store.rawDb().query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string };
  expect(row.fact).toBe("human pin"); // untouched
  store.close();
});
test("editFact: unknown id → false", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "fe-wg3-")) });
  const gate = new WriteGate(store, new RuleBasedScanner());
  expect(gate.editFact(crypto.randomUUID(), "x", { actor: "user", authored_by: "human" })).toBe(false);
  store.close();
});
```
Append to `hatch.daemon.test.ts` a case constructing `new Hatch(store, gate)` and asserting `hatch.editFact(id, "new", {actor:"user",authored_by:"human"})` returns `true` and the row text/`authored_by` updated (mirror the existing `hatch.edit`/`hatch.forgetFactById` cases in that file).

- [ ] **Step 1.6 — Run, verify fail.** `bun test packages/daemon/src/memory/write-gate.test.ts packages/daemon/src/memory/hatch.daemon.test.ts` → FAIL.

- [ ] **Step 1.7 — Implement `WriteGate.editFact`** (place near `forgetFactById`, `write-gate.ts:150`):
```ts
/**
 * editFact — human correction of a distilled fact's TEXT (chunk-05 FACT-EDIT; ADR-0012 5a).
 *
 * Delegates to store.editFactById: updates the text in place (id stable) + stamps
 * authored_by='human' so the fact is 5e-protected against future machine re-derivation
 * (distiller-registration Q5 step 3 never-replace-human demote + factExistsByDedupKey suppress).
 * NEVER scrubs messages, NEVER writes a tombstone (B1 — the fact path never touches messages/mutations).
 *
 * 5e seam (mirrors forgetFactById): a MACHINE ctx must not overwrite a human-authored fact → no-op.
 * The HTTP path is human-ctx (HTTP_CTX), so this refusal never fires there; it reserves the 2c
 * (agent memory-action) seam. A human editing any fact (human OR machine) is always applied.
 * Returns true iff applied (false = id absent OR a machine-over-human refusal → the route maps to 404).
 */
editFact(factId: string, newText: string, ctx: WriteContext, reason?: string): boolean {
  const db = this.store.rawDb();
  const row = db.query("SELECT authored_by FROM distilled_facts WHERE id = ?").get(factId) as { authored_by: string } | null;
  if (!row) return false;
  if (row.authored_by === "human" && ctx.authored_by === "machine") return false; // 5e seam (never fires on HTTP)
  return this.store.editFactById(factId, newText, { actor: ctx.actor, reason });
}
```

- [ ] **Step 1.8 — Implement `Hatch.editFact`** (place after `edit`, `hatch.ts:72`):
```ts
/**
 * Edit a FACT's text (chunk-05 FACT-EDIT; ADR-0012 5a "edit what the agent remembers").
 * Delegates to WriteGate.editFact — updates the text + stamps authored_by='human' (5e-protected),
 * never scrubs messages (B1). Returns true iff applied (false → 404 at the route).
 * Distinct from edit(messageId) above, which is the MESSAGE correction (blessed as-is, chunk-03).
 */
editFact(factId: string, newText: string, ctx: WriteContext, reason?: string): boolean {
  return this.gate.editFact(factId, newText, ctx, reason);
}
```

- [ ] **Step 1.9 — Run, verify pass.** `bun test packages/daemon/src/memory/write-gate.test.ts packages/daemon/src/memory/hatch.daemon.test.ts packages/daemon/src/memory/store.test.ts` → PASS.

- [ ] **Step 1.10 — Commit.**
```bash
git add packages/daemon/src/memory/store.ts packages/daemon/src/memory/store.test.ts packages/daemon/src/memory/write-gate.ts packages/daemon/src/memory/write-gate.test.ts packages/daemon/src/memory/hatch.ts packages/daemon/src/memory/hatch.daemon.test.ts
git commit -m "feat(memory-transparency-ui): fact-correction primitive — editFactById + WriteGate/Hatch.editFact (5e-protected human stamp)"
```

### Step 2 — Daemon route discriminator + route tests + executed 5e/dedup real-I/O proof

**Files:** Modify `http-routes.ts`, `http-routes.daemon.test.ts`; Create `fact-edit-redistill.daemon.test.ts`; Modify `scripts/memory-demo-harness.ts`.

**Interfaces:**
- Consumes: `Hatch.editFact` (Step 1), `HTTP_CTX`, `parseBody`, `mapWriteError`, `deps.tokenStore.verify` (all in `http-routes.ts`); `MemoryProvider`, `registerDistiller`, `ConsolidationHook`, `RuleBasedScanner` (integration test).
- Produces: `POST /memory/edit {target_type:"fact", fact_id:<uuid>, replacement:<string>, reason?:<string>}` → `204` on apply, `404 {error:"target_not_found"}` on unknown fact, `400 {error:"bad_body"}` on non-uuid/missing/empty, `401` on bad token. Message-edit body `{target, replacement, reason?}` (no `target_type`) unchanged.

- [ ] **Step 2.1 — Write the failing route tests.** Append to `http-routes.daemon.test.ts`. In `beforeAll`, after seeding the message, seed a machine fact and capture its id (same `seedStore`, before daemon boot):
```ts
// chunk-05: seed a MACHINE distilled fact for the fact-edit route tests
seededFactId = seedStore.insertFact({
  fact: "favourite colour blue", canonical: "favourite colour blue",
  provenance: `thread:${seededThreadId}`, scope: "cross-thread", expiry: null,
  confidence: 1, authored_by: "machine", topics: ["#preferences"],
}, "seed");
```
(declare `let seededFactId: string;` near `seededMessageId`). Then the cases:
```ts
const UUID = () => crypto.randomUUID();
function editPost(body: unknown, withToken = true) {
  return fetch(`http://127.0.0.1:${PORT}/memory/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(withToken ? { Authorization: `Bearer ${readToken()}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("fact-edit: valid → 204 + text updated + authored_by=human on disk", async () => {
  const res = await editPost({ target_type: "fact", fact_id: seededFactId, replacement: "favourite colour green", reason: "t" });
  expect(res.status).toBe(204);
  const s = new MemoryStore({ dataDir: sharedDataDir });
  const row = s.rawDb().query("SELECT fact, authored_by FROM distilled_facts WHERE id = ?").get(seededFactId) as { fact: string; authored_by: string };
  s.close();
  expect(row.fact).toBe("favourite colour green");
  expect(row.authored_by).toBe("human");
});
test("fact-edit: missing fact_id → 400", async () => {
  expect((await editPost({ target_type: "fact", replacement: "x" })).status).toBe(400);
});
test("fact-edit: non-uuid fact_id → 400", async () => {
  expect((await editPost({ target_type: "fact", fact_id: "not-a-uuid", replacement: "x" })).status).toBe(400);
});
test("fact-edit: empty replacement → 400", async () => {
  expect((await editPost({ target_type: "fact", fact_id: seededFactId, replacement: "" })).status).toBe(400);
});
test("fact-edit: unknown uuid fact_id → 404 target_not_found", async () => {
  const res = await editPost({ target_type: "fact", fact_id: UUID(), replacement: "x" });
  expect(res.status).toBe(404);
  expect((await res.json() as { error: string }).error).toBe("target_not_found");
});
test("fact-edit: no token → 401", async () => {
  expect((await editPost({ target_type: "fact", fact_id: seededFactId, replacement: "x" }, false)).status).toBe(401);
});
test("message-edit regression: {target,replacement} (no target_type) still → 204", async () => {
  expect((await editPost({ target: seededMessageId, replacement: "corrected msg" })).status).toBe(204);
});
```

- [ ] **Step 2.2 — Run, verify fail.** `bun test packages/daemon/src/memory/http-routes.daemon.test.ts` → the fact-edit cases FAIL (400/404 not returned as specced; today all bodies hit the message path).

- [ ] **Step 2.3 — Implement the `handleEdit` fact branch** in `http-routes.ts` (replace the body of `handleEdit`, `:220-246`; token gate + `parseBody` lines unchanged):
```ts
const { target_type, target, replacement, reason, fact_id } = parsed.data;
const reasonStr = typeof reason === "string" ? reason : undefined;

// chunk-05 FACT-EDIT: target_type:"fact" edits a distilled_facts row's TEXT + stamps
// authored_by='human' (ADR-0012 5a). Mirrors the forget route's uuid fact_id discriminator.
// Security-adjacent: sits INSIDE the token gate above, reuses HTTP_CTX (fixed human).
if (target_type === "fact") {
  if (typeof replacement !== "string" || replacement === "") {
    return Response.json({ error: "bad_body" }, { status: 400 });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof fact_id !== "string" || !fact_id || !UUID_RE.test(fact_id)) {
    return Response.json({ error: "bad_body" }, { status: 400 });
  }
  try {
    const applied = deps.hatch.editFact(fact_id, replacement, HTTP_CTX, reasonStr);
    return applied
      ? new Response(null, { status: 204 })
      : Response.json({ error: "target_not_found" }, { status: 404 });
  } catch (err: unknown) {
    return mapWriteError(err);
  }
}

// MESSAGE-edit (blessed as-is, chunk-03): target_type absent or "message". UNCHANGED.
if (typeof target !== "string" || !target) {
  return Response.json({ error: "bad_body" }, { status: 400 });
}
if (typeof replacement !== "string") {
  return Response.json({ error: "bad_body" }, { status: 400 });
}
try {
  deps.hatch.edit(target, replacement, HTTP_CTX, reasonStr);
  return new Response(null, { status: 204 });
} catch (err: unknown) {
  return mapWriteError(err);
}
```
Also update the `handleEdit`/module header comment (`:220`, `:10`) to note the additive `target_type:"fact"` path (docs, not behavior).

- [ ] **Step 2.4 — Run, verify pass.** `bun test packages/daemon/src/memory/http-routes.daemon.test.ts` → PASS.

- [ ] **Step 2.5 — Write the 5e + dedup + forget integration proof.** Create `packages/daemon/src/memory/fact-edit-redistill.daemon.test.ts` (real SQLite + WriteGate + Hatch + registerDistiller; models `distiller-registration.test.ts:339-390`):
```ts
/**
 * chunk-05 FACT-EDIT — real-I/O 5e + dedup + forget interplay.
 * A human-edited fact must NOT be overwritten, duplicated, or re-derived-over by the next
 * distillation, and forget must still work on it. Real store/WriteGate/registerDistiller;
 * the ONLY mock is a scripted MemoryProvider.distill (Strike-4: no real API call).
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { Hatch } from "./hatch.js";
import { RuleBasedScanner } from "./scanner/memory-scanner.js";
import { ConsolidationHook } from "./consolidation-hook.js";
import { registerDistiller } from "./distiller-registration.js";
import type { MemoryProvider } from "./memory-provider.js";

test("human-edited fact survives re-distill: not overwritten, not duplicated; forget still works", async () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "fe-redistill-")) });
  const gate = new WriteGate(store, new RuleBasedScanner());
  const hatch = new Hatch(store, gate);
  const hook = new ConsolidationHook(store);
  const scanner = new RuleBasedScanner();

  // 1. machine fact
  const factId = store.insertFact({
    fact: "favourite colour blue", canonical: "favourite colour blue",
    provenance: "thread:seed", scope: "cross-thread", expiry: null,
    confidence: 1, authored_by: "machine", topics: ["#preferences"],
  }, "seed");

  // 2. human edits it (via the production Hatch seam) → text + authored_by:human + canonical refreshed
  expect(hatch.editFact(factId, "favourite colour green", { actor: "user", authored_by: "human" }, "hatch-fact-edit")).toBe(true);

  // 3. re-distill: a new thread restates the colour; the scripted distiller emits a REPLACE
  //    targeting the (now human) fact, with a canonical IDENTICAL to the edited display text so
  //    the demote's dedup check deterministically suppresses the re-insert.
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "my favourite colour is green" }], "s1");
  const provider: MemoryProvider = {
    id: "fact-edit-redistill",
    distill: async (s, threadId) => ({
      threadId,
      ops: [{
        op: "replace",
        fact: "favourite colour green",
        canonical: "favourite colour green",        // == the edited fact's stored canonical
        topics: ["#preferences"],
        targetOrdinal: 1,
        expectedTargetText: "favourite colour green", // matches the human fact's current text
      }],
      candidateIds: [factId],
      distilledThroughMarker: s.readThreadMarker(threadId),
      distilledThroughTurn: s.maxTurnIndex(threadId),
    }),
    retrieve: async () => [],
  };
  registerDistiller(hook, store, provider, scanner);
  await hook.dismiss([t]);

  // 4a. never-overwritten / never-re-derived-over (5e demote): row byte-stable
  const row = store.rawDb().query("SELECT id, fact, authored_by FROM distilled_facts WHERE id = ?").get(factId) as { id: string; fact: string; authored_by: string };
  expect(row.fact).toBe("favourite colour green");
  expect(row.authored_by).toBe("human");
  // 4b. not duplicated (dedup-suppress on the demoted insert): exactly ONE colour fact
  const colour = store.rawDb().query("SELECT id FROM distilled_facts WHERE fact LIKE '%colour%'").all() as { id: string }[];
  expect(colour.length).toBe(1);
  // 4c. no distiller REPLACE was recorded (only the human edit's own prior-text audit)
  const replaced = store.readReplacedFacts(factId);
  expect(replaced.length).toBe(1);
  expect(replaced[0]!.replaced_text).toBe("favourite colour blue");

  // 5. forget still works on the edited fact
  hatch.forgetFactById(factId, { actor: "user", authored_by: "human" });
  expect(store.rawDb().query("SELECT id FROM distilled_facts WHERE id = ?").get(factId)).toBeNull();

  store.close();
});
```

- [ ] **Step 2.6 — Run the integration proof, verify pass.** `bun test packages/daemon/src/memory/fact-edit-redistill.daemon.test.ts` → PASS (proves demote@`distiller-registration.ts:203-207` + dedup-suppress@`:277` protect the edited fact).

- [ ] **Step 2.7 — Add the harness FACT-EDIT step (executed real-I/O over the REAL daemon HTTP+WS).** In `packages/daemon/scripts/memory-demo-harness.ts`:
  1. In `buildScriptedClient`, add a branch inside the USER-line loop (after the `зелений` branch), keyed to a sentinel the step controls, emitting a REPLACE whose canonical equals the driven line content (so it matches the human-edited fact's canonical):
```ts
} else if (content.includes("бірюзовий")) {
  // chunk-05 FACT-EDIT harness: re-distill of a human-edited colour fact. canonical = the
  // line content itself so it equals normalizeFactText(edit text) → dedup deterministically
  // suppresses the never-replace-human demote (proves 5e + no-duplicate over the real daemon).
  if (colourCandidateIdx !== -1) {
    const existing = candidateLines[colourCandidateIdx]?.match(/^\d+\.\s+(.+?)(?:\s+\[|$)/);
    ops.push({ op: "replace", fact: content, canonical: content, topics: ["#preferences"],
      targetOrdinal: colourCandidateIdx + 1, ...(existing?.[1] ? { expectedTargetText: existing[1].trim() } : {}) });
  } else {
    ops.push({ op: "new", fact: content, canonical: content, topics: ["#preferences"] });
  }
}
```
  2. Add the step AFTER the `CHANGE→ONE-FACT` block (~`:710`) and BEFORE STEP 5 (forget), so the colour fact is a known single row:
```ts
// ── FACT-EDIT: edit what the agent remembers (chunk-05) ──────────────────
console.log("[demo-harness] FACT-EDIT: edit a distilled fact's TEXT via POST /memory/edit {target_type:fact}");
const EDIT_COLOUR_TEXT = "мій улюблений колір бірюзовий"; // lowercase, no punctuation → canonical-stable
const feRes = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(threadA)}`, { headers: { Authorization: `Bearer ${token}` } });
const feFacts = (await feRes.json() as { distilledFacts: { fact: string; id: string; authored_by: string }[] }).distilledFacts;
const colourFact = feFacts.find((f) => f.fact.includes("синій") || f.fact.includes("зелений") || f.fact.includes("колір") || f.fact.includes("Люблю"));
if (!colourFact) { console.error("[demo-harness] FACT-EDIT: no colour fact to edit"); await cleanup(); process.exit(1); }
const editRes = await fetch(`http://127.0.0.1:${PORT}/memory/edit`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ target_type: "fact", fact_id: colourFact.id, replacement: EDIT_COLOUR_TEXT, reason: "demo-harness-fact-edit" }),
});
console.log(`[demo-harness] FACT-EDIT: POST /memory/edit → ${editRes.status}`);
// read back: text changed + authored_by human (durable)
const afterEdit = (await (await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(threadA)}`, { headers: { Authorization: `Bearer ${token}` } })).json() as { distilledFacts: { fact: string; id: string; authored_by: string }[] }).distilledFacts;
const edited = afterEdit.find((f) => f.id === colourFact.id);
const editApplied = editRes.status === 204 && edited?.fact === EDIT_COLOUR_TEXT && edited?.authored_by === "human";
// re-distill: restate the same edited value in a new thread
const feColourBefore = countColourFacts(tmpDir);
const threadFE = crypto.randomUUID();
await wsTurnAndSettle(PORT, token, { threadId: threadFE, text: EDIT_COLOUR_TEXT }, 200);
const feColourAfter = countColourFacts(tmpDir);
const afterRedistill = (await (await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(threadA)}`, { headers: { Authorization: `Bearer ${token}` } })).json() as { distilledFacts: { fact: string; id: string; authored_by: string }[] }).distilledFacts;
const stillOne = afterRedistill.filter((f) => f.id === colourFact.id && f.fact === EDIT_COLOUR_TEXT && f.authored_by === "human").length === 1;
const noDup = feColourAfter === feColourBefore;
console.log(`[demo-harness] FACT-EDIT: applied=${editApplied} colourCount before=${feColourBefore} after=${feColourAfter} human-stable=${stillOne}`);
if (MODE === "stub") {
  if (!editApplied) { console.error("[demo-harness] FACT-EDIT: RED — edit did not persist as human text (route/primitive not applied)."); await cleanup(); process.exit(1); }
  if (!stillOne || !noDup) { console.error("[demo-harness] FACT-EDIT: RED — human fact overwritten or duplicated by re-distill (5e demote + dedup-suppress not holding)."); await cleanup(); process.exit(1); }
  console.log("[demo-harness] FACT-EDIT: GREEN — edit persists as human text; re-distill neither overwrote nor duplicated it.");
} else {
  console.log(`[demo-harness] FACT-EDIT: informational (real mode, LLM-fuzzy) — applied=${editApplied} stillOne=${stillOne} noDup=${noDup}.`);
}
console.log("");
```
  (Update the harness banner/summary boxes to list FACT-EDIT.)

- [ ] **Step 2.8 — RUN the harness (both modes) and capture stdout.** Execute — do NOT infer from reading (§6.1 / Strike-5):
```bash
bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub
ANTHROPIC_API_KEY-in-Keychain: bun run packages/daemon/scripts/memory-demo-harness.ts --mode=real   # informational if key absent → SKIP is acceptable
```
Expected stub: `FACT-EDIT: GREEN — edit persists as human text; re-distill neither overwrote nor duplicated it.` Paste the full stub stdout (and real stdout if a key resolves) into the PR body = the executed 5e/dedup evidence.

- [ ] **Step 2.9 — Full daemon suite + protocol freeze check.**
```bash
bun test packages/daemon
git diff --stat packages/protocol/    # MUST be empty
```

- [ ] **Step 2.10 — Commit.**
```bash
git add packages/daemon/src/memory/http-routes.ts packages/daemon/src/memory/http-routes.daemon.test.ts packages/daemon/src/memory/fact-edit-redistill.daemon.test.ts packages/daemon/scripts/memory-demo-harness.ts
git commit -m "feat(memory-transparency-ui): POST /memory/edit target_type:fact + executed 5e/dedup real-I/O proof"
```

### Step 3 — Overlay: fact-edit affordance + persistent human badge + honest states

**Files:** Modify `memory-write.ts`, `memory-write.test.ts`, `render.ts`, `render.test.ts`, `controller.ts`, `controller.test.ts`, `memory.html`.

**Interfaces:**
- Consumes: `MemoryApiDeps {fetchFn, baseUrl, token, timeoutMs?}` + `post`/`WriteResult` (`memory-write.ts`); `buildEditControl(current, onSave)` (`actions.ts`, unchanged); `DistilledFactView {id, fact, authored_by, …}` (`types.ts`).
- Produces: `editFact(deps: MemoryApiDeps, factId: string, replacement: string): Promise<WriteResult>`; `FactActions.onEditFact?: (factId: string, newText: string) => void`; controller `editFactAction(factId, newText)`.

- [ ] **Step 3.1 — Write the failing `memory-write` test.** Append to `memory-write.test.ts`:
```ts
import { editFact } from "./memory-write.js";
test("editFact 204 → ok; sends target_type:fact + fact_id + replacement (Bearer only)", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const r = await editFact(deps(fakeFetch(204, calls)), "F1", "new text");
  expect(r.kind).toBe("ok");
  const body = JSON.parse(calls[0]!.init!.body as string);
  expect(body).toEqual({ target_type: "fact", fact_id: "F1", replacement: "new text", reason: "hatch-fact-edit" });
  expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
});
test("editFact status mapping: 401→unauthorized, 404→stale, 400→bad_request, 500→unreachable, net→unreachable", async () => {
  expect((await editFact(deps(fakeFetch(401, [])), "F1", "x")).kind).toBe("unauthorized");
  expect((await editFact(deps(fakeFetch(404, [])), "F1", "x")).kind).toBe("stale");
  expect((await editFact(deps(fakeFetch(400, [])), "F1", "x")).kind).toBe("bad_request");
  expect((await editFact(deps(fakeFetch(500, [])), "F1", "x")).kind).toBe("unreachable");
  expect((await editFact(deps(fakeFetch(0, [])), "F1", "x")).kind).toBe("unreachable");
});
```

- [ ] **Step 3.2 — Run, verify fail.** `bun test apps/overlay/src/memory/memory-write.test.ts` → FAIL (`editFact` not exported).

- [ ] **Step 3.3 — Implement `editFact` in `memory-write.ts`** (append after `editMessage`; update the file header to note the fact variant):
```ts
/** Edit a FACT's text — "correct what the agent remembers" (ADR-0012 5a). Keys on the fact's
 *  stable uuid (target_type:"fact" + fact_id); the daemon updates the distilled_facts row's text
 *  and stamps authored_by:"human" server-side (5e-protected). A 404 → the fact is gone (stale). */
export function editFact(deps: MemoryApiDeps, factId: string, replacement: string): Promise<WriteResult> {
  return post(deps, "/memory/edit", { target_type: "fact", fact_id: factId, replacement, reason: "hatch-fact-edit" });
}
```

- [ ] **Step 3.4 — Run, verify pass.** `bun test apps/overlay/src/memory/memory-write.test.ts` → PASS.

- [ ] **Step 3.5 — Write the failing render tests.** Append to `render.test.ts` (DOM):
```ts
test("renderFacts: onEditFact attaches an Edit control that saves the fact id + new text", () => {
  const el = document.createElement("div");
  const saved: { id: string; text: string }[] = [];
  renderFacts(el, [{ id: "F1", fact: "colour blue", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    () => {}, { onEditFact: (id, text) => saved.push({ id, text }) });
  (el.querySelector(".act-edit") as HTMLButtonElement).click();      // open inline editor
  const ta = el.querySelector(".inline-editor textarea") as HTMLTextAreaElement;
  expect(ta.value).toBe("colour blue");                              // prefilled with current text
  ta.value = "colour green";
  (el.querySelector(".act-save") as HTMLButtonElement).click();
  expect(saved).toEqual([{ id: "F1", text: "colour green" }]);
});
test("renderFacts: persistent 'yours' badge iff authored_by==='human' (data-driven, not session)", () => {
  const el = document.createElement("div");
  renderFacts(el, [
    { id: "H", fact: "human fact", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "human" },
    { id: "M", fact: "machine fact", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], () => {});
  const rows = el.querySelectorAll(".fact-row");
  expect(rows[0]!.querySelector(".human-badge")).not.toBeNull();     // human → badge
  expect(rows[1]!.querySelector(".human-badge")).toBeNull();          // machine → no badge
});
```

- [ ] **Step 3.6 — Run, verify fail.** `bun test apps/overlay/src/memory/render.test.ts` → FAIL.

- [ ] **Step 3.7 — Implement in `render.ts`.** Extend `FactActions` and `renderFacts`:
```ts
export interface FactActions {
  onForget?: (factId: string) => void;
  /** chunk-05: inline Edit on a fact row → POST /memory/edit {target_type:"fact"} (5a "correct what it remembers"). */
  onEditFact?: (factId: string, newText: string) => void;
}
```
In `renderFacts`, right after `row.appendChild(factEl);` (`:99`), add the persistent badge:
```ts
// chunk-05: persistent, DATA-DRIVEN "yours" badge (from the fact's own authored_by; survives
// restart — unlike the session-local message "edited by you" tag).
if (f.authored_by === "human") {
  const badge = document.createElement("span");
  badge.className = "human-badge";
  badge.textContent = " yours";
  row.appendChild(badge);
}
```
And in the actions block near the forget control (`:139-143`), add the edit control:
```ts
if (actions?.onEditFact) {
  const onEditFact = actions.onEditFact;
  row.appendChild(buildEditControl(f.fact || "", (newText) => onEditFact(f.id, newText)));
}
```

- [ ] **Step 3.8 — Run, verify pass.** `bun test apps/overlay/src/memory/render.test.ts` → PASS.

- [ ] **Step 3.9 — Write the failing controller test.** Append to `controller.test.ts` (DOM) — mirror the existing forget-outcome case: a fake api whose POST returns 204, click a fact's Edit, save, assert `editFact` was POSTed to `/memory/edit` with `target_type:"fact"` and that the view re-fetched (loadThread called again). Assert an `unreachable` POST renders the `DOWN` state (no fake success).

- [ ] **Step 3.10 — Implement in `controller.ts`.** Import `editFact`:
```ts
import { forgetFact, editMessage, editFact, type WriteResult } from "./memory-write.js";
```
Add the action + wire it in `loadThread`'s `renderFacts` call:
```ts
async function editFactAction(factId: string, newText: string): Promise<void> {
  handleWriteResult(await editFact(deps.api, factId, newText));
}
```
```ts
renderFacts(els.factsEl, r.data.distilledFacts ?? [], openThread, {
  onForget: (factId) => void forgetAction(factId),
  onEditFact: (factId, newText) => void editFactAction(factId, newText), // chunk-05
});
```
(No session set for the badge — it is data-driven: `ok` → `refreshCurrentView()` re-fetches and the fact returns `authored_by:"human"`, so the badge is durable.)

- [ ] **Step 3.11 — Add `.human-badge` CSS in `memory.html`** (after the `.edited-tag` rule, `:38`):
```css
.human-badge { color: #2060b0; font-weight: 600; font-size: 12px; margin-left: 6px; }
```

- [ ] **Step 3.12 — Run overlay tests + both typechecks + lint.**
```bash
bun test apps/overlay/src/memory
bunx tsc -p tsconfig.json --noEmit
bunx tsc -p apps/overlay/tsconfig.memory-dom-tests.json --noEmit
bun run lint:strict
```
All green. (No tsconfig `include`/`exclude` edit — cases appended to already-registered files.)

- [ ] **Step 3.13 — Commit.**
```bash
git add apps/overlay/src/memory/memory-write.ts apps/overlay/src/memory/memory-write.test.ts apps/overlay/src/memory/render.ts apps/overlay/src/memory/render.test.ts apps/overlay/src/memory/controller.ts apps/overlay/src/memory/controller.test.ts apps/overlay/memory.html
git commit -m "feat(memory-transparency-ui): overlay fact-edit affordance + persistent human badge (honest write states)"
```

---

## Verification (chunk-05 DoD mapping)

| DoD box (from `05-…-fact-edit.md`) | Kind | Evidence |
|---|---|---|
| Editing a FACT's text saves, re-renders with a **persistent human badge**, and **survives app restart** | behavioral | Route test 2.1 (text + `authored_by='human'` persisted on disk) + harness FACT-EDIT step 2.7/2.8 (`applied` via real HTTP) + render/controller tests 3.5/3.9 (badge + re-fetch). **Restart durability requires runtime demo to confirm** — structurally guaranteed by the persisted `authored_by`/`fact` columns (readback proves persistence); consolidated in the chunk-04 JOINT live demo. |
| After a real distillation, the human-edited fact is **NOT overwritten / duplicated / re-derived-over** (5e + dedup) **and forget still works** | behavioral | **EXECUTED real-I/O:** integration test 2.5/2.6 (hard `bun test`; demote@`distiller-registration.ts:203-207` + dedup-suppress@`:277`; forget removes it) **and** harness FACT-EDIT step 2.7/2.8 `--mode=stub` hard-assert (GREEN) over the REAL daemon + `--mode=real` informational. Stdout pasted in PR (§6.1/Strike-5). |
| Error paths honest: daemon down mid-edit → `unreachable`, no fake success | behavioral | `memory-write.test.ts` 3.1 (500/network → `unreachable`) + `controller.test.ts` 3.9 (`unreachable` → `DOWN`, no re-render as success). **Live daemon-kill requires runtime demo to confirm** — rides chunk-04 demo. |
| `bun test` green (route + store + DOM), `lint:strict`, root+overlay typecheck green | mechanical | `bun test packages/daemon`; `bun test apps/overlay/src/memory`; `bun run lint:strict`; `bunx tsc -p tsconfig.json --noEmit`; `bunx tsc -p apps/overlay/tsconfig.memory-dom-tests.json --noEmit`. |
| `git diff packages/protocol/` empty; daemon diff limited to the additive edit path | mechanical | `git diff --stat packages/protocol/` empty (2.9). Daemon diff = `store.ts`/`write-gate.ts`/`hatch.ts`/`http-routes.ts` + tests + harness only — flag the first four (security-adjacent) for reviewer attention. |

---

## ADR worthy: no

**Reasoning.** This consumes already-decided, already-shipped contracts and introduces **no new boundary, protocol, dependency, or decision**:
- **ADR-0012 5a** (view/edit/**correct**/forget hatch) — this delivers the "correct what the agent remembers" half that chunk-03 explicitly FLAGGED as unbuilt (message-only edit). **5e** (never auto-overwrite human) is *consumed*, not extended: stamping the fact `authored_by:"human"` routes it through the existing never-replace-human demote — the machinery already exists (`distiller-registration.ts:203-207`) and was verified to cover an edited-then-redistilled fact (integration test 2.5). The ADR-0012 amendment's REPLACE/dedup model governs unchanged.
- **ADR-0015** — additive HTTP-body field only (`target_type:"fact"` on `/memory/edit`, mirroring the forget route); the separate-artifact B1 invariant is untouched (fact-edit touches only `distilled_facts`, never `messages`/`mutations`). `@agentic/protocol` byte-unchanged.
- **ADR-0013** — reuses the token-gated write surface + fixed `HTTP_CTX`; no new route family, no auth change (no "rule of three" third-mutating-route trigger — this is the *same* `/memory/edit` route, additive branch).
- **ADR-0005/0006** — overlay surfaces unchanged (closed-set DOM, tray-opened window).

The ADR-0012 rider documenting **both** edit semantics (message-correction vs fact-correction) rides **chunk-04**, not this chunk, per the chunk brief.

**Escalation clause (mirrors chunk-01/02/03):** the integration test (2.5) confirmed the human-precedence machinery *does* cover an edited-then-redistilled fact — so no new behavior was designed and no ADR is needed. **If, during build, the worker finds the machinery does NOT cover it** (e.g. the demote/dedup path does not fire for a human-stamped fact and new distiller logic is required), STOP — that is a new decision → escalate to `adr-curator` + freeze gate before proceeding.

---

## Risks & flags (chunk-05)

- **SECURITY-ADJACENT (reviewer must eyeball) — the ADR-0013 poisoning-write surface.** `http-routes.ts` (new fact branch), `write-gate.ts`/`hatch.ts` (`editFact`), `store.ts` (`editFactById`). Reviewer checkpoints: (a) the fact branch is **inside** the existing token gate (`tokenStore.verify` first); (b) it uses the fixed `HTTP_CTX` (human) — no client-supplied ctx; (c) `editFactById` **never** touches `messages`/`mutations` (B1 — fact path is structurally isolated); (d) `fact_id` is uuid-validated (no arbitrary-string dispatch); (e) zero `innerHTML` in `render.ts`/`memory-write.ts` (XSS — user-entered edit text).
- **MERGE-ORDER with chunk-04 (disjoint files, same daemon package).** Chunk-04 touches `history-page.ts`; this chunk does NOT. No file overlap → either order merges cleanly. If both land near-simultaneously, rebase-and-rerun `bun test packages/daemon` on the second to merge (the daemon suite is the shared surface). The behavioral live sign-off is **consolidated in the chunk-04 JOINT demo** unless the orchestrator finds a defect worth an early Lior pass (default: mechanical gates here).
- **"Not duplicated" inherits the v2 dedup ceiling — pre-existing, NOT introduced here.** `factExistsByDedupKey` suppresses a demoted re-insert only when the machine re-derivation's canonical normalizes to the same key as the edited fact's canonical. A **cross-language / heavily-reworded** re-derivation could still slip a duplicate past dedup (the demo-3 root, mitigated by all-facts-below-cap + superseded by roadmap **2d/embeddings**). The **5e "not overwritten"** guarantee is *unconditional* (keys on `authored_by`, not text) — only the *dedup* half carries the ceiling. Documented honestly; not a blocker and not new to this chunk.
- **Edit on a redacted/tombstoned concept N/A for facts** — facts are `distilled_facts` rows, not `messages`; there is no `[forgotten]` marker on a fact (forget durably deletes the row). So the chunk-03 "edit re-introduces redacted content" note does not apply to fact-edit.
- **`distiller_version`/`provenance` deliberately unchanged on a human edit** (a human edit is not a distiller output). If a reviewer wants a "human-edited" provenance marker, that is a separate additive read-side decision — not in scope.
- **Harness sentinel (`бірюзовий`) is dev-only stub scripting** — the `--mode=real` run is the language-agnostic behavioral check; the stub branch exists solely to make the executed real-daemon assertion deterministic. Not product code.

## Status: Done

---


---

## Chunk 04 — history.html fallback UX tails

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkboxes. Scope is FROZEN by `orchestration/chunks-todo/memory-transparency-ui/04-history-fallback-ux-and-closeout.md` (## Scope In items A+B) and `orchestration/docs/specs/2026-07-02-memory-transparency-ui.md` Scope-IN item 3. This section is the **code half only** — the closeout/archive/ADR-rider half is owned by the orchestrator and is explicitly out of this plan.

**Goal:** Two honest-state/token tails on the browser fallback page `history.html`: (A) an explicit locked / "paste a token to view" state that replaces the false "Loading…"→"no threads" sequence when there is no/bad token; (B) tolerate whitespace + the zsh trailing-`%` artifact on the paste path.

**Architecture:** Single daemon file `packages/daemon/src/memory/history-page.ts` (a server-rendered HTML string with inline JS, served verbatim by `http-routes.ts` at `GET /history.html`). A new pure sanitizer `sanitizeToken` becomes the single source of truth for B — kept as a JS-source string constant, inlined verbatim into the page `<script>` AND compiled in the unit test via `new Function`, so there is zero drift and no DOM harness / transpile dependency. A is static-copy + a `401` render branch. `@agentic/protocol` is untouched; no HTTP route, no wire change.

**Tech Stack:** Bun + TypeScript; `bun:test` (pure-function + string-presence assertions, matching `normalize-fact-text.test.ts`). No new deps (runtime or dev).

### Global Constraints (verbatim from chunk + spec + ADRs)

- **`@agentic/protocol` is FROZEN** — `git diff packages/protocol/` MUST be empty. This chunk touches only `packages/daemon/src/memory/`.
- **Token discipline (ADR-0013):** the credential is NEVER logged and travels ONLY in `Authorization: Bearer <token>` — never URL/query/body/log. The paste-path change must not introduce any log of the pasted value. (Existing code already obeys this; do not regress it.)
- **ADR-0013:** the locked state is the honest face of the read-gate — `GET /memory/*` is now token-gated (Option-A end-state shipped; see Reality check #2), so "you genuinely cannot view without a token" is the *true* state, which is exactly what the locked copy must say.
- **ADR-0012 decision 5a:** the fallback hatch stays truthful — no false "Loading…"; honest locked / empty / daemon-down states.
- **Scope OUT (deliberate cuts, PIPELINE §7.2):** NO restyling / feature-extending `history.html`; do NOT remove it; NO overlay/memory-window change (chunks 01–03/05 own that); do NOT touch `token-store.ts` or any auth mechanism (see Reality check #4). Keep the diff to the two tails.
- **CI gate:** `bun test`, `bun run lint:strict` (`--max-warnings=0`), `bun run typecheck` all green.

---

### Reality check

Findings are **code-path existence facts** verified by reading source. Per PIPELINE §6.1, no runtime/visible-behavior claim is asserted as verified — those are marked **"requires live demo to confirm."** Citations are `file:line`.

1. **Page structure — server-rendered HTML string with inline JS, one file, no build step.** `history-page.ts:15` exports `HISTORY_HTML` (a template literal). `http-routes.ts:131-136` serves it verbatim at `GET /history.html` (`content-type: text/html; charset=utf-8`, Host-guard only, open on loopback). The client-side fetch+render is the inline `<script>` (`history-page.ts:198-623`): `loadThreadList()` (`:240-251`) does `fetch("/memory/threads", { headers: { Authorization: "Bearer " + _authToken } })` and `renderThreadList()` (`:253-276`) builds the list via `textContent`/`createElement` only (no `innerHTML` with API data — must preserve this XSS discipline). It is a plain static string; there is **no separate asset** and no framework.

2. **Current no/bad-token behavior (the dishonest sequence).** *Code-path facts:* the thread-list ships a static placeholder `<li class="empty">Loading…</li>` (`history-page.ts:174`), and the bootstrap **does not** call `loadThreadList()` on load — it is deferred to the Unlock click (`:620-622`, comment: "loadThreadList() is NOT called here … deferred to the Unlock handler … ADR-0013 read-gate"). `loadThreadList()` resolves `r.json()` and calls `renderThreadList(data.threads || [])` (`:243`); on an empty/`undefined` array `renderThreadList` renders `"No threads yet."` (`:255-260`). Reads are token-gated, so a bad token yields `401` with a JSON body `{error:"Unauthorized"}` (`http-routes.ts:147,151`) — and because `fetch` does **not** reject on `401`, `data.threads` is `undefined` → `[]` → `"No threads yet."` *Requires live demo to confirm* the visible sequence, but by code-reading: **no token → "Loading…" shown perpetually** (nothing is loading; the honest state is "locked"); **bad token after Unlock → "No threads yet."** (dishonest — the truth is "unauthorized"). Both are the false states A must replace.

3. **Token capture / paste path.** Captured from a `<input type="password" id="token-input">` (`:154-160`) on Unlock click (`:220-232`): currently `var val = tokenInput.value.trim(); … _authToken = val; tokenInput.value = "";`. Held in a plain JS variable `_authToken` ONLY — never localStorage/sessionStorage/cookies (`:199-203`, ADR-0013 threat model). Sent as `Authorization: Bearer <token>` on every fetch (`:241,287,489,563`) — never URL/body. `.trim()` (`:221`) removes surrounding whitespace but **does not** strip the zsh trailing-`%` (a literal `%`, not whitespace) — this is exactly B's gap.

4. **Is the token ever displayed/served? NO → the "copy-clean at source" sub-item is a no-op for this page.** `history.html` displays only the token *file path* (`<code id="token-path">~/.agentic-engine/auth-token</code>`, `:164`) — a hardcoded string, not the secret. The page never serves/echoes the token value. So "make the served token copy-clean" has nothing to act on here. The *true* origin of the zsh `%` is that `token-store.ts:32` writes the hex secret with **no trailing newline** (`writeFileSync(tokenPath, hex, {mode:0o600})`), so `cat auth-token` in zsh renders the no-newline `%` marker. Writing `hex + "\n"` is **deliberately OUT of scope**: `token-store.ts` is not in this chunk's file scope, it is security-critical, and the overlay reads the same file Rust-side for the WS-subprotocol token (`read_auth_token`) with `verifyToken(raw)` doing an exact constant-time compare (`token-store.ts:83-86`) — a trailing newline could break overlay WS auth unless the Rust side also trims. Not "cheap," and cross-boundary. **The entire footgun is neutralized on the paste path by B** (sanitize strips the `%`), and A honestly handles any residual bad token with a `401` locked state. Record the optional trailing-newline-at-mint idea as a backlog note (orchestrator), do not implement.

5. **Test harness.** `bun:test`, no DOM/jsdom (confirmed: `packages/daemon/package.json` has no happy-dom/jsdom; deps are `@agentic/protocol`, `@anthropic-ai/sdk`, `zod`). Two styles: pure-function unit tests (`normalize-fact-text.test.ts` — the template for B) and real-HTTP `*.daemon.test.ts` (`http-routes.daemon.test.ts` already covers `GET /history.html` serving + `401` gating — no new daemon test needed). `history-page.ts` is currently **not** directly tested (`grep HISTORY_HTML` in test files = 0 hits). Consequence: **B gets real behavioral coverage** via an extracted pure sanitizer; **A's render branches are DOM-coupled inline JS**, so without a DOM lib they get **string-presence guards** on `HISTORY_HTML` — the true behavioral proof of A is Lior's live demo (§6.1). (Adding happy-dom/jsdom to unit-test the render branches is an available dev-dep option but is rejected: scope-creep for a two-tail chunk, no existing test uses it.)

---

### Steps

Three sequential, independently-testable tasks. Branch: `chunk/04-history-fallback-ux`. TDD within each (test → fail → implement → pass → commit).

#### Step 1 — B: extract + inline `sanitizeToken`, wire the paste path (test-first)

**Files:** Modify `packages/daemon/src/memory/history-page.ts`; Create `packages/daemon/src/memory/history-page.test.ts`.

- [ ] **1.1 — Write the failing unit test.** In the new `history-page.test.ts`:

```ts
import { test, expect } from "bun:test";
import { HISTORY_HTML, SANITIZE_TOKEN_FN } from "./history-page.js";

// Compile the SAME source the page inlines — real behavioral coverage, no DOM, no transpile dep.
const sanitizeToken = new Function(
  `${SANITIZE_TOKEN_FN}; return sanitizeToken;`,
)() as (raw: string) => string;

const T = "a".repeat(64); // token shape = 64 lowercase hex (token-store.ts)

test("sanitizeToken: strips zsh trailing % and surrounding whitespace", () => {
  expect(sanitizeToken(T + "%")).toBe(T);
  expect(sanitizeToken("  " + T + "  ")).toBe(T);
  expect(sanitizeToken(T + "%\n")).toBe(T);
  expect(sanitizeToken("\t" + T + " %")).toBe(T);
});

test("sanitizeToken: strips surrounding quotes; clean token unchanged; non-string → ''", () => {
  expect(sanitizeToken('"' + T + '"')).toBe(T);
  expect(sanitizeToken("'" + T + "'")).toBe(T);
  expect(sanitizeToken("deadbeef")).toBe("deadbeef");
  // @ts-expect-error runtime guard
  expect(sanitizeToken(undefined)).toBe("");
});

test("no drift: the served page inlines the exact tested sanitizer verbatim", () => {
  expect(HISTORY_HTML).toContain(SANITIZE_TOKEN_FN);
});
```

- [ ] **1.2 — Run:** `cd packages/daemon && bun test src/memory/history-page.test.ts` → Expected FAIL (`SANITIZE_TOKEN_FN` not exported).

- [ ] **1.3 — Implement in `history-page.ts`.** Add, above `export const HISTORY_HTML`, the single-source-of-truth sanitizer (kept as a JS-source string so it can be inlined verbatim; contains NO backticks, so no template escaping):

```ts
/**
 * Paste-path token sanitizer (chunk-04 tail B). Single source of truth:
 * inlined verbatim into the served <script> below AND compiled in the unit test.
 * Tolerates the zsh no-newline "%" marker + surrounding whitespace/quotes that
 * ride along when a token is copied from a terminal. Format-agnostic (does NOT
 * assume hex) so a future token format is unaffected; the real gate stays the
 * server-side constant-time compare (token-store.ts).
 */
export const SANITIZE_TOKEN_FN = `function sanitizeToken(raw) {
  if (typeof raw !== "string") return "";
  var t = raw.trim();
  t = t.replace(/%+$/, "").trim();            // zsh no-newline marker(s)
  t = t.replace(/^["']+|["']+$/g, "").trim(); // surrounding quotes
  return t;
}`;
```

- [ ] **1.4 — Inline it into the page and rewire the Unlock handler.** In the `<script>`, insert `${SANITIZE_TOKEN_FN}` once near the top of the script block (e.g. immediately after the `_authToken` declaration at `:203`), then change the Unlock handler (`:220-232`) so it uses the sanitizer instead of bare `.trim()`:

```js
    unlockBtn.addEventListener("click", function () {
      var val = sanitizeToken(tokenInput.value);   // chunk-04 tail B (was: .trim())
      if (!val) {
        setStatus("Enter a token first.", false);
        return;
      }
      _authToken = val;
      tokenInput.value = "";
      setStatus("Token set for this session.", true);
      loadThreadList();
    });
```

(Do NOT log `val`/`raw` anywhere — ADR-0013.)

- [ ] **1.5 — Run:** `bun test src/memory/history-page.test.ts` → Expected PASS.

- [ ] **1.6 — Commit:** `feat(memory-transparency-ui): chunk-04 tail B — tolerate zsh % / whitespace on history.html paste path`.

#### Step 2 — A: honest locked / empty / daemon-down states (test-first)

**Files:** Modify `packages/daemon/src/memory/history-page.ts`; extend `history-page.test.ts`.

- [ ] **2.1 — Add failing string-guard tests** to `history-page.test.ts`:

```ts
test("A: initial thread-list is the honest locked state, not 'Loading…'", () => {
  expect(HISTORY_HTML).toContain("Locked — paste your auth token"); // em-dash copy
  const listUl = HISTORY_HTML.match(
    /<ul class="thread-list" id="thread-list">([\s\S]*?)<\/ul>/,
  );
  expect(listUl).not.toBeNull();
  expect(listUl![1]).not.toContain("Loading…"); // list initial state must not be "Loading…"
});

test("A: loadThreadList has an explicit 401 -> locked branch (not 'No threads')", () => {
  expect(HISTORY_HTML).toContain("r.status === 401");
  expect(HISTORY_HTML).toContain("renderLocked");
});
```

- [ ] **2.2 — Run:** `bun test src/memory/history-page.test.ts` → Expected FAIL.

- [ ] **2.3 — Implement.** (a) Change the static list placeholder (`:174`) from `Loading…` to the locked copy:

```html
      <ul class="thread-list" id="thread-list"><li class="empty locked">&#128274; Locked &mdash; paste your auth token above to view your memory.</li></ul>
```

(b) Add a `renderLocked` helper near `renderThreadList` (uses `textContent` only — XSS discipline):

```js
    function renderLocked(msg) {
      clearChildren(threadList);
      var li = document.createElement("li");
      li.className = "empty locked";
      li.textContent = "🔒 " + (msg || "Locked — paste your auth token above to view your memory.");
      threadList.appendChild(li);
    }
```

(c) Rewrite `loadThreadList` (`:240-251`) to branch on status — honest locked (401), honest empty (200 + `[]`, unchanged path), honest daemon-down (network reject):

```js
    function loadThreadList() {
      fetch("/memory/threads", { headers: { "Authorization": "Bearer " + _authToken } })
        .then(function (r) {
          if (r.status === 401) {
            // Honest: unauthorized, NOT "no threads". (ADR-0012 5a / ADR-0013 read-gate.)
            renderLocked("Unauthorized — check the token you pasted.");
            setStatus("401 — bad or missing token.", false);
            return null;
          }
          return r.json();
        })
        .then(function (data) {
          if (data === null) return;              // 401 already handled
          renderThreadList(data.threads || []);   // 200: real list or honest "No threads yet."
        })
        .catch(function () {
          // Honest daemon-down / network error, NOT "no threads".
          clearChildren(threadList);
          var li = document.createElement("li");
          li.className = "empty";
          li.textContent = "Couldn’t reach the daemon — is it running?";
          threadList.appendChild(li);
        });
    }
```

Leave the thread-**detail** view's `Loading…` placeholders (`:184,189,194`) as-is: they are shown only during an already-authenticated in-flight fetch (post-`openThread`), so they are honest-transient, not the false state A targets. Note this in the commit body.

- [ ] **2.4 — Run:** `bun test src/memory/history-page.test.ts` → Expected PASS.

- [ ] **2.5 — Commit:** `feat(memory-transparency-ui): chunk-04 tail A — honest locked/empty/daemon-down states on history.html (kill false Loading…)`.

#### Step 3 — Full verification + protocol-freeze assertion

**Files:** none (verification only).

- [ ] **3.1 — Full suite green:** from repo root run `bun test`, `bun run lint:strict`, `bun run typecheck` — all must pass (0 warnings). Fix any fallout in the two touched files only.
- [ ] **3.2 — Freeze assertion:** `git diff --stat packages/protocol/` MUST be empty. `git diff --stat` should show ONLY `packages/daemon/src/memory/history-page.ts` and `packages/daemon/src/memory/history-page.test.ts`.
- [ ] **3.3 — Commit** any lint/type fixups if needed; push the branch and open the PR against `main` per CLAUDE.md (auto-merge only on the all-green gate set). **Leave the chunk file `in-progress`** with the closeout DoD boxes unchecked — the joint live demo + archive ritual are the orchestrator's post-demo half (do NOT split-archive).

---

### Test plan

Matches the existing harness (`bun:test`, pure-function + string-presence; no DOM lib added). All in the new `packages/daemon/src/memory/history-page.test.ts`.

- **B — trim tolerance (real behavioral coverage):** compile `SANITIZE_TOKEN_FN` via `new Function` and assert: trailing `%` stripped; trailing `%\n` stripped; leading/trailing whitespace stripped; interior `" %"` tail stripped; surrounding single/double quotes stripped; a clean token is returned unchanged; non-string → `""`. Plus the **drift guard** `HISTORY_HTML.toContain(SANITIZE_TOKEN_FN)` — proves the served bytes are exactly the tested function (no `.toString()`/transpile dependency, so nothing here is "requires runtime confirm").
- **A — honest states (mechanical guards on the served string):** the list-view initial placeholder contains the "Locked — paste your auth token" copy and does NOT contain `Loading…` (regex-scoped to the `#thread-list` `<ul>` so the honest detail-view transient placeholders don't trip it); the `loadThreadList` source contains the `r.status === 401` branch and calls `renderLocked`. These are guards that the copy/branch shipped; **the visible end-to-end behavior of A is verified only by the live demo** (see DoD).
- **No new `*.daemon.test.ts`:** `http-routes.daemon.test.ts` already covers `GET /history.html` serving and `401` gating; A/B add no route and need no server test.

---

### DoD mapping

Chunk `## Done criteria` boxes vs the code half:

1. **[behavioral] locked state on no token; trailing-`%`/whitespace paste works** → satisfied by A (locked initial + `401`→locked branch + honest daemon-down) and B (`sanitizeToken`). Mechanical proxy: Step 1/2 tests green. The **visible behavior is "requires live demo to confirm"** — it is part of the joint §6.1 demo, not self-certifiable from code/tests.
2. **[behavioral] joint feature demo (Lior, live), spec's 5-item checklist** → **NOT self-certifiable.** This is a §5.2 Lior gate. The code half must NOT check this box or run closeout before Lior signs the demo. (Out of this plan's authority.)
3. **[mechanical] `bun test` + `lint:strict` + typecheck green** → Step 3.1.
4. **[mechanical] archive ritual (spec/chunks/plans moved + banners + backlog/roadmap)** → **NOT the code half** — orchestrator-owned, post-demo. Out of this plan.
5. **[mechanical] `git diff packages/protocol/` empty** → Step 3.2 (this chunk touches only `packages/daemon/src/memory/`).

---

### ADR worthy: no

Executes existing decisions only — ADR-0013 (the locked state is the honest face of the already-shipped read-gate; token stays a Bearer header, never logged) and ADR-0012 5a (truthful fallback states). No new HTTP route, no new dependency (runtime or dev), no protocol/wire change, no new boundary. `sanitizeToken` is a client-side, in-page helper; `@agentic/protocol` is byte-unchanged.

### Status: shipped-pending-demo (code half planned + executable; joint §6.1 demo + closeout are orchestrator-owned, post-demo)
