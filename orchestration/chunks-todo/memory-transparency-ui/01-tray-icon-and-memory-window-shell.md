# Chunk 1: Tray icon + memory-window shell

**Status:** in-progress
**Created:** 2026-07-02
**Phase:** memory-transparency-ui (backlog Theme A — spec `docs/specs/2026-07-02-memory-transparency-ui.md`)
**Estimated size:** ~1 day
**Depends on:** none

## Scope

**In:**
- macOS **menu-bar (tray) icon** for the overlay app (Tauri 2 `TrayIcon`, `tray-icon` cargo
  feature; template icon so it renders correctly in light/dark menu bars). Un-defers ADR-0006
  Decision p.4.
- Tray **status indicator**: icon/tooltip reflects daemon connection state — minimum
  `connected` / `disconnected(error)`; `busy` (in-flight) is a cheap optional third state since
  `main.ts` already tracks `inFlight`. State is **pushed from the main window's JS** (the
  ConnectionManager/`inFlight` owner) to Rust via a small `set_tray_status` command — the JS
  side READS existing state only.
- Tray **menu**: "Open Memory…" (opens the memory window), "Quit".
- A new **`memory` window** in `tauri.conf.json` + capabilities: a normal, resizable window
  (NOT alwaysOnTop, NOT skipTaskbar — this is a settings-class surface, not the launcher
  overlay), `visible:false` until opened from the tray. For this chunk it loads a **shell page**
  (`memory.html`) that proves the wiring: reads the auth token via the existing
  `read_auth_token` command and shows an honest tri-state — 🔒 no token / daemon unreachable /
  "connected" (a successful token-gated `GET /memory/threads` against `http://127.0.0.1:7777`).
- Re-opening from tray shows/focuses the existing window (no duplicate windows).

**Out:** (deliberate cuts — PIPELINE §7.2)
- The actual threads/facts UI — that is chunk-02; this chunk lands the entry point + auth wiring.
- Tray quick-toggles (mute mic, pause cron — named in ADR-0006 p.4) — OUT because neither mic
  nor cron features exist yet; nothing to toggle.
- Any change to the `main`/`widget` windows, the hotkey flow, or the `inFlight` guard —
  OUT because gotcha #45 marks the session/context model as a future spec/ADR; the tray only
  *reads* connection state.
- Auto-launch/login-item behavior — OUT, not part of the spec.
- `@agentic/protocol` — **frozen**, byte-unchanged (spec anchor: this feature is an
  engine-owned surface, no new primitives).

## Done criteria

> **Demo-1 result (Lior, live §6.1, 2026-07-02): PARTIAL FAIL.** PASS-half: tray icon shows,
> "Open Memory…" opens the window, real token-gated GET works ("Connected (8 threads)"), no
> token paste. Two defect clusters found → three criteria ADDED below (window-lifecycle +
> liveness). Original items were "sampled once" and fail under live transitions; the added
> criteria make them hold. All behavioral items ride Demo-2.

- [ ] **[behavioral]** Tray icon appears in the macOS menu bar; its state visibly changes when
      the daemon is stopped/started (connected ↔ error at minimum). *(Demo-1: icon shows;
      stop/start transition retested in Demo-2 — see the two transition criteria below.)*
- [ ] **[behavioral]** Tray → "Open Memory…" opens the memory window; the shell page shows
      "connected" state via a real token-gated `GET /memory/threads` (no manual token entry
      anywhere). Re-open focuses, does not duplicate. *(Demo-1: PASS on first open; re-open
      after native close is the added window-lifecycle criterion below.)*
- [ ] **[behavioral]** With the daemon down, the shell page shows the honest "daemon
      unreachable" state (NOT a false "Loading…" — spec inherits the history.html lesson).
      *(Demo-1: PASS on a fresh open with daemon down; the live-transition case is the added
      liveness criterion below.)*
- [ ] **[behavioral — added 2026-07-02 Demo-1 finding, cluster 1]** Close the memory window with
      the native **×** button, then re-open it from the tray "Open Memory…" — it opens **every
      time**, repeatably across multiple close→re-open cycles (no dead tray until a full app
      restart). *(Root cause: Tauri 2 native close DESTROYS the window; the open handler only
      show/focus-es an existing one.)*
- [ ] **[behavioral — added 2026-07-02 Demo-1 finding, cluster 2A]** With the memory window
      **open** showing "Connected", **kill the daemon** → the window transitions to the honest
      "unreachable" state within a few seconds, **without an app restart** (live re-check, not
      sampled-once).
- [ ] **[behavioral — added 2026-07-02 Demo-1 finding, cluster 2B]** Launch with the daemon
      **down** (tray shows disconnected), then **start the daemon** → the **tray flips to
      connected** AND an **open memory window recovers** to "Connected" within a few seconds,
      **both without an app restart** (down→up transition on both surfaces).
- [ ] **[mechanical]** `bun test` green, `lint:strict` green, typecheck green, `cargo build` clean.
- [ ] **[mechanical]** `git diff` on `packages/protocol/` is empty.

## Orchestrator brief (read by the orchestrator from this file)

```
implement the tray icon + memory-window shell per
orchestration/docs/specs/2026-07-02-memory-transparency-ui.md (Scope-IN item 1;
"Anchors" section is binding — engine-owned surface, protocol untouched, two-zone UX intact).

Files to touch:
- apps/overlay/src-tauri/Cargo.toml (tray-icon feature)
- apps/overlay/src-tauri/src/lib.rs (TrayIcon + menu + set_tray_status command + open/focus logic)
- apps/overlay/src-tauri/tauri.conf.json + capabilities (new `memory` window)
- apps/overlay/memory.html + apps/overlay/src/memory.ts (shell page: token via read_auth_token,
  tri-state connected/unreachable/no-token) + vite config if multi-page entry needs registering
- apps/overlay/src/main.ts (push connection/inFlight state to set_tray_status — read-only tap)

Done when: the five DoD boxes above hold (behavioral ones via live run — see spec
"Verification posture"; demo items 1 and 5 of the spec checklist are owned by this chunk,
final joint sign-off rides chunk 04).

ADRs in scope: 0006 (p.4 — executes the deferred tray decision; two-zone UX untouched),
0013 (consume the existing bearer-token model — token never in logs or URLs),
0012 (d.5 — this is the entry point of the 5a hatch).
```

## Notes / Open questions

- **Fetch-path seam (architect decides here, chunk-02 inherits):** the memory window's webview
  fetching `http://127.0.0.1:7777` may hit CORS (Tauri webview origin ≠ daemon origin). Options,
  all preserving bearer-token auth (ADR-0013): (a) narrow CORS header on the daemon's `/memory/*`
  routes allowing ONLY the overlay's origin (never `*`); (b) `tauri-plugin-http` (Rust-side fetch,
  no webview CORS); (c) point the `memory` window at the daemon-served page itself. If (a):
  touching `packages/daemon/src/memory/http-routes.ts` is security-adjacent → flag for reviewer
  attention; coordinate merge order with chunk-04 (same package, disjoint files). Token must never
  appear in a query string (server-visible); URL fragment is acceptable only as a last resort.
- Gotcha #32 (multi-monitor): centering the memory window on the primary monitor is acceptable
  v1; note only, do not build monitor-resolution logic.
- Gotchas #33/#34 (stale hide/reset timers): do NOT add any auto-hide/linger timers to the
  memory window — it is a normal window, closed by the user.
- **Liveness contract (added 2026-07-02 Demo-1, Lior — explicit honest contract):** the tray
  MUST reflect daemon up/down transitions in **BOTH directions within a few seconds** (e.g. the
  WS reconnect loop with backoff driving `set_tray_status`, or equivalent); the memory window
  MUST transition Connected ↔ unreachable **without an app restart** (a lightweight periodic
  re-check and/or a re-fetch on window focus and on tray re-open). A **status-poll / reconnect
  timer is EXPLICITLY ALLOWED** and is unrelated to gotchas #33/#34 — those forbid only
  auto-**HIDE** / linger timers (which change window visibility), not a read-only status poll.
- **Window lifecycle (added 2026-07-02 Demo-1):** native **×** close must NOT leave the tray's
  "Open Memory…" dead. Fix direction (implementation is the architect's call): intercept
  `WindowEvent::CloseRequested` for the `memory` window → `prevent_close()` + `hide()` so
  re-open show/focus works; AND/OR make the open handler recreate the window from config when
  `get_webview_window("memory")` returns `None` (belt-and-braces for any destroy path).
