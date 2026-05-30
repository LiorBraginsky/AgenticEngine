# AgenticEngine Overlay

Tauri v2 frameless transparent overlay app — the primary interactive surface
for AgenticEngine. Global tap-hotkey reveals a centered Spotlight-style input
panel; typing and pressing Enter sends an ECHO round-trip to the daemon.

---

## Prerequisites

- **Rust toolchain** (via `rustup`): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  — required to compile the Tauri Rust shell.
- **Bun** (>=1.x): `curl -fsSL https://bun.sh/install | bash`
- From the repo root: `bun install` — links workspace packages and installs all JS deps.

---

## Run (development)

Terminal A — start the daemon:

```
cd packages/daemon
bun run dev
```

Terminal B — start the overlay app:

```
cd apps/overlay
bun run tauri dev
```

The Vite dev server is pinned to port **1420** (`vite.config.ts`, `strictPort: true`).
This is load-bearing: `http://localhost:1420` is in the daemon's Origin allowlist
(ADR-0003 Amendment 2026-05-30). Changing this port causes a 403 on the WS upgrade.

---

## Build (production)

```
cd apps/overlay
bun run tauri build
```

The built `.app` lands in `src-tauri/target/release/bundle/macos/`.

---

## macOS Accessibility permission (MANUAL — required for the global hotkey)

The global hotkey (`CommandOrControl+Shift+Space`) uses the macOS Accessibility API.
macOS will not fire it until the app (or the terminal running `tauri dev`) is granted
Accessibility access.

**One-time grant:**

1. Open **System Settings** → **Privacy & Security** → **Accessibility**.
2. Click the **+** button (you may need to unlock with your password).
3. Add:
   - For `tauri dev`: add the **Terminal** app (or iTerm2 / Warp / whichever you use).
   - For the built `.app`: add **overlay.app** from the release bundle path above.
4. Toggle the switch ON.
5. Re-press the hotkey — it should now fire.

Note: if you switch terminals or rename the app, you may need to re-grant.

---

## Hotkey

**`CommandOrControl+Shift+Space`** (⌘⇧Space on macOS, Ctrl+Shift+Space on Windows/Linux)

- Press once → the frameless transparent panel appears and is focused.
- Type your query, press **Enter** → sends an ECHO round-trip to the daemon.
  - The panel immediately shows `…` (pending indicator) and locks against a second submit.
  - On success the status line shows `session <uuid> — cancelled` (see v0 flow below).
    The result stays visible for ~1.2 s so it's readable, then the panel hides.
  - On a transport failure (timeout / connection error) the error is shown in the status
    line and the panel stays open — press Escape to dismiss, or fix the daemon and retry.
- Press **Escape** → hides the panel without submitting.

The hotkey binding is the v0 default (ADR-0006, Amendment 2026-05-30).
User-rebindable UI is out of scope for this chunk.

---

## v0 Round-trip flow (cancel-to-complete)

The daemon (chunk 02a) answers `session_start` with `[session_ack, tool_call{show_color_picker}]`
and parks the session in `awaiting_pick` — it does NOT emit `session_end` until it receives
either a `tool_result` (→ `completed`) or a `tool_cancel` (→ `session_end{reason:"cancelled"}`).

The overlay (chunk 02b-i) does NOT render the color-picker widget — that is chunk 02b-ii.
Instead, on receiving the `tool_call`, the seam **automatically sends `tool_cancel`** back
to the daemon. The daemon replies `session_end{reason:"cancelled"}` and the round-trip ends.

Full message sequence:
```
overlay → daemon : session_start{trigger:"user", text, client_session_id}
daemon → overlay : session_ack{session_id, client_session_id}   ← overlay learns session_id
daemon → overlay : tool_call{session_id, call_id, payload:{tool:"show_color_picker",...}}
overlay → daemon : tool_cancel{session_id, call_id}             ← auto-cancel (no widget)
daemon → overlay : session_end{session_id, reason:"cancelled"}
```

This proves the transport end-to-end — the full WS round-trip is exercised without choosing
a color. Widget rendering is chunk 02b-ii.

---

## Origin (dev vs prod) — Branch A

| Context | Origin sent by WKWebView | In allowlist? |
|---|---|---|
| `tauri dev` (Vite at :1420) | `http://localhost:1420` | Yes |
| `tauri build` `.app` | `tauri://localhost` | Yes |

Both Origins were empirically confirmed during the Step-1 spike (2026-05-31).
No allowlist changes were needed (Branch A outcome).
The allowlist lives in `packages/daemon/src/origin.ts`.

---

## Manual smoke checklist (Lior — native gate, not automatable)

1. `bun run dev` in `packages/daemon` → logs `listening on ws://127.0.0.1:7777`.
2. `bun run tauri dev` in `apps/overlay` → app starts; NO visible window (starts hidden).
3. Grant macOS Accessibility permission (see above). Re-press the hotkey.
4. Hotkey → frameless transparent centered panel appears, input focused.
5. Type `hello`, press Enter →
   - Status immediately shows `…` (pending).
   - Status updates to `session <uuid> — cancelled` after ~0.5–1 s.
   - Panel hides ~1.2 s after the result appears.
   - A second Enter while pending must NOT open a second session (guarded).
   - On a transport failure (daemon not running): status shows `error: …`; panel stays open.
6. Press hotkey again, press Escape → panel hides without submitting.
7. Prod gate: `bun run tauri build`, launch the `.app`, repeat steps 4–5 against the running
   daemon — confirms the prod `tauri://localhost` Origin round-trip.
