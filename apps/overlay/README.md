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
- Type anything, press **Enter** → input panel hides; **the color-picker widget appears in the
  top-right corner** (dark card, question + three swatches: Crimson / Forest / Azure).
  - Click a swatch → status briefly shows `session <uuid> — completed`; widget hides.
  - Click the **×** button → status shows `session <uuid> — cancelled`; widget hides.
  - On a transport failure (timeout / connection error) the error is shown in the status
    line and the panel stays open — press Escape to dismiss, or fix the daemon and retry.
- Press **Escape** → hides the panel without submitting.

The hotkey binding is the v0 default (ADR-0006, Amendment 2026-05-30).
User-rebindable UI is out of scope for this chunk.

---

## Two-window architecture (chunk 02b-ii, ADR-0006 Option B)

The overlay uses **two separate Tauri windows**:

| Window | Label | Role |
|---|---|---|
| Center input panel | `main` | Frameless input + status. Owns the live WebSocket session. |
| Top-right picker | `widget` | Content-sized, transparent, always-on-top. Renders the color-picker primitive. Holds NO WebSocket. |

**Click-through outside the widget is natural**: the `widget` window is content-sized, so outside
its bounds there is no window — clicks pass through to whatever app is underneath. No
`setIgnoreCursorEvents` is used.

**Cross-window data path = Tauri events** (intra-app only; not part of the frozen wire protocol):

| Event | Direction | Payload |
|---|---|---|
| `show-picker` | `main` → `widget` | `{ picker: ColorPickerPrimitive }` |
| `picker-result` | `widget` → `main` | `ColorSwatch` |
| `picker-cancel` | `widget` → `main` | (none) |

---

## v0 Round-trip flow (pick-to-complete)

The daemon (chunk 02a) answers `session_start` with `[session_ack, tool_call{show_color_picker}]`
and parks the session in `awaiting_pick` — it does NOT emit `session_end` until it receives
either a `tool_result` (→ `completed`) or a `tool_cancel` (→ `session_end{reason:"cancelled"}`).

The overlay (chunk 02b-ii) renders the picker in the dedicated `widget` window. The user clicks
a swatch to emit `tool_result{picked}` (first time the daemon's `completed` path is exercised),
or clicks **×** to emit `tool_cancel`.

Full message sequence:
```
overlay(main) → daemon          : session_start{trigger:"user", text, client_session_id}
daemon → overlay(main)          : session_ack{session_id, client_session_id}
daemon → overlay(main)          : tool_call{session_id, call_id, payload:{tool:"show_color_picker", args:{picker}}}
overlay(main) ⇄ overlay(widget) : Tauri event "show-picker" → render → "picker-result"|"picker-cancel"
overlay(main) → daemon          : tool_result{session_id, call_id, payload:{result:{picked}}}  (on swatch click)
                                  OR tool_cancel{session_id, call_id}                          (on ×)
daemon → overlay(main)          : session_end{reason:"completed"}  (result)  |  "cancelled" (cancel)
```

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
2. `bun run tauri dev` in `apps/overlay` → app starts; NO visible window (`main` and `widget`
   both start `visible:false`).
3. Grant macOS Accessibility permission (see above). Re-press the hotkey.
4. Hotkey → centered input panel appears, input focused, placeholder reads
   `(skeleton: type anything → shows picker)`.
5. Type anything, press Enter → input panel hides; **the color-picker widget appears in the
   top-right corner** (dark card, question `"Which color do you want?"`, swatches: Crimson /
   Forest / Azure). Status in the (now-hidden) panel shows `…`.
6. Click a swatch (e.g. Azure) → status briefly shows `session <uuid> — completed`; the widget
   window hides. (First time the daemon's `completed` path is exercised.)
7. Re-trigger (hotkey → type → Enter), click the **×** → status shows
   `session <uuid> — cancelled`; the widget window hides.
8. **Click-through (Option B's hard requirement):** re-trigger to show the widget, then click
   on the **desktop or another app OUTSIDE the small widget card** (e.g. a Finder window behind
   it). The click must pass through and land on that app — the widget window must NOT intercept
   it. Then click a swatch inside the card to settle.
9. A second Enter while pending must NOT open a second session (guarded).
   On a transport failure (daemon not running): status shows `error: …`; panel stays open;
   press Escape to dismiss.
10. Prod gate: `bun run tauri build`, launch the `.app`, repeat steps 4–8 against the running
    daemon — confirms the prod `tauri://localhost` Origin round-trip and that the second window +
    capabilities ship correctly in the bundle.
