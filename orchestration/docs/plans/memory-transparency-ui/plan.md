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
