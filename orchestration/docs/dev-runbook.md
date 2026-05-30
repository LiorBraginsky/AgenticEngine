---
title: Dev Runbook
status: living-document
last-major-update: 2026-05-31
tags: [dev, debugging, commands, cheatsheet]
---

# Dev Runbook

**Purpose:** the "how did I do that again?" cheatsheet. Practical commands for running, verifying, and debugging the engine locally — grouped by the question you're actually asking, not by theory. Add to it whenever you figure something out the hard way.

> Repo layout: `packages/daemon` (Bun WS server), `packages/protocol` (frozen contract), `apps/overlay` (Tauri frontend). Runtime: Bun. Daemon listens on `127.0.0.1:7777` (loopback only).

---

## Verify / build (the gate commands)

Run from repo root. These are what "green" means before any chunk is done.

| Question | Command |
|---|---|
| Do all tests pass? | `bun test` |
| Does it typecheck? (packages + WS seam) | `bun run typecheck` |
| Does the DOM renderer typecheck? | `cd apps/overlay && bun run typecheck` |
| Is lint clean (zero warnings)? | `bun run lint:strict` |
| Lint without failing on warnings | `bun run lint` |

---

## Run the daemon

```bash
cd packages/daemon && bun run dev
```
- Prints `listening on ws://127.0.0.1:7777` when up.
- Leave the terminal open — it's a long-running process. `Ctrl+C` to stop.
- Sessions are **in-memory** — stopping the daemon loses nothing on disk; just restart it.

**Quick manual round-trip** (separate terminal, daemon running):
```bash
cd packages/daemon && bun run test-client
```
Sends one `session_start`, logs the validated `session_ack` + `session_end`.

---

## Is the daemon actually listening? (port / "is it up?")

```bash
lsof -nP -iTCP:7777 -sTCP:LISTEN
```
- Shows a `bun` row → daemon is up.
- Empty output → nothing listening; the daemon isn't running (or crashed).

**Kill a stuck daemon** (e.g. "port already in use"):
```bash
lsof -nP -iTCP:7777 -sTCP:LISTEN          # find the PID
kill <PID>                                 # graceful
# or, force everything on the port:
lsof -ti:7777 | xargs kill -9
```

---

## Run the Tauri overlay (frontend)

**First make sure the Rust toolchain is on PATH** (needed for any Tauri build). In a fresh shell:
```bash
source "$HOME/.cargo/env"     # only if `cargo`/`rustc` are "command not found"
rustc --version               # sanity check
```

Then:
```bash
# dev mode (Vite HTTP, fast iteration, hot-ish reload)
cd apps/overlay && bun run tauri dev

# production bundle (real packaged .app — slower, full Rust release compile)
cd apps/overlay && bun run tauri build
# built app lands at:
#   apps/overlay/src-tauri/target/release/bundle/macos/overlay.app
open apps/overlay/src-tauri/target/release/bundle/macos/overlay.app
```

- `tauri dev` and `tauri build` are **mutually exclusive in one terminal** — `Ctrl+C` the dev process before building.
- First `cargo` compile pulls dependencies → **several minutes**, normal.
- Always run/test the **freshly built** app from `target/...`, not a copy macOS may have moved to `/Applications` (that one is stale).

---

## Measure the WS Origin (the "spike" debug technique)

Used to find out what `Origin` header a webview actually sends on the WS handshake (dev vs prod differ; the daemon's allowlist depends on it). Useful any time origin-rejection is suspected.

1. Temporarily add **one line** in `packages/daemon/src/index.ts`, immediately **before** the `isOriginAllowed(...)` check, so it logs even rejected origins:
   ```ts
   console.log("[spike] inbound Origin:", req.headers.get("origin")); // TEMP — REVERT
   ```
2. Run the daemon (terminal A) + the app (terminal B). Watch **terminal A** (the daemon prints it, not the app).
3. Read the printed value:
   - `http://localhost:1420` → `tauri dev` (Vite). Confirms `strictPort:1420` held (if it shows `5173`, the port pin failed).
   - `tauri://localhost` → production webview (macOS). **This is the value that ships.**
   - `null` / no line → see "reading the result" below.
4. **Revert the line** when done; confirm `git diff packages/daemon` is empty.

**Reading the result (don't confuse these):**
| Terminal A shows | Meaning |
|---|---|
| `[spike] inbound Origin: tauri://localhost` (or another value) | The app connected — that's the real Origin. |
| **No `[spike]` line at all**, but the app window appeared | The WS never opened — a frontend/connection bug, **not** a `null` origin. |
| `[spike] inbound Origin: null` | The app really sent no Origin — genuinely empty. |

The window must be **visible** during a spike so "window appeared but no log" (connection bug) is distinguishable from "no origin" (a `null` result).

---

## Tauri gotchas hit so far

- **`failed to open icon .../icons/icon.png`** at build — Tauri's `generate_context!` macro needs `src-tauri/icons/icon.png` even if `tauri.conf.json` `"icon"` is `[]`. Fix: generate a full icon set from any 1024×1024 PNG — `bunx @tauri-apps/cli icon <source>.png` — then list the outputs in `tauri.conf.json` `bundle.icon`. (Hit 2026-05-30, walking-skeleton 02b-i spike.)
- **`cargo: command not found`** in an already-open shell after installing Rust — the installer edits your profile but the current shell hasn't reloaded PATH. Fix: `source "$HOME/.cargo/env"` (or open a new terminal).
- **Vite dev origin is `:5173` not `:1420`** unless `vite.config.ts` pins `server: { port: 1420, strictPort: true }`. The daemon allowlist expects `1420`, so an unpinned port gets rejected.

---

## Related

- [[known-gotchas]] — engineering watch-list (e.g. #31 CSWSH / Origin-allowlist)
- [[architecture]] — daemon + WS + frontends shape
- [[adr/0003-local-daemon-ws-architecture]] — loopback, allowlist, Origin rationale
