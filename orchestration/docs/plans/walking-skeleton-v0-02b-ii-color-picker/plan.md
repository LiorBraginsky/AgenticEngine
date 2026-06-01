# Color-Picker Primitive Renderer + Selection/Cancel Round-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 02b-i's auto-cancel transport-proof with a real `color-picker` widget the user clicks: render the inbound `tool_call(show_color_picker)` as a label + clickable swatches in a dedicated top-right Tauri **widget window** (ADR-0006 top-right zone), emit `tool_result{picked}` on click (reaching the daemon's `completed` path for the first time) or `tool_cancel` on dismiss.

**Architecture:** Two-window realization of ADR-0006's "two zones". The existing `main` window (center input panel, 02b-i) keeps the live WebSocket and the DOM-free seam. A **second content-sized, transparent, always-on-top top-right `widget` window** (its own Vite entry) renders the picker. The seam is split into a pure, unit-testable **decision/build layer** (`tool-call-handler.ts`, DOM-free, `bun test`) plus the thin DOM renderer in the widget window. The `main` window relays picker data to the `widget` window and result/cancel back over **Tauri events** (the WebSocket stays solely in `main`). Only `packages/protocol` (FROZEN) is imported for shapes; `packages/daemon` is untouched.

**Tech Stack:** TypeScript on Bun, Zod (via `@agentic/protocol`), Tauri v2 multi-window (`@tauri-apps/api/webviewWindow`, `/dpi`, `/event`), Vite multi-page build, `bun test` with injected fake transport.

---

## Reality check

Per-hypothesis verification against current code. **All three hypotheses confirmed.**

### H1 — Contract shape: **CONFIRMED, exactly as stated.**

- `tool_call` envelope (`packages/protocol/src/envelope.ts:42-47`): `{ type:"tool_call", session_id, call_id, payload }`. `payload` is `ToolCallPayload`.
- `ToolCallPayload` (`packages/protocol/src/tools.ts:26-28`) is a discriminated union on `tool`; the one known member is `{ tool:"show_color_picker", args: ShowColorPickerArgs }`.
- `ShowColorPickerArgs` (`tools.ts:8-10`) = `{ picker: ColorPickerPrimitive }` — **nested under `args.picker`, NOT flat.**
- `ColorPickerPrimitive` (`primitives.ts:27-31`) = `{ primitive:"color-picker", question: string, palette: ColorSwatch[] (min 1) }`.
- `ColorSwatch` (`primitives.ts:12-15`) = `{ label: string (REQUIRED), hex: /^#[0-9a-fA-F]{6}$/ }`.
- `tool_result` envelope (`envelope.ts:49-54`): `{ type:"tool_result", session_id, call_id, payload }` where `payload` is `ToolResultPayload` = `{ tool:"show_color_picker", result: ShowColorPickerResult }` (`tools.ts:31-34`), and `ShowColorPickerResult` = `{ picked: ColorSwatch }` (`tools.ts:17-19`). **The wire result is `payload.result.picked`.**
- `tool_cancel` (`envelope.ts:57-61`): `{ type:"tool_cancel", session_id, call_id }` — carries `call_id`.
- Exported validators/guards to import (FROZEN): `parseEnvelope`, `classifyTool`, `KNOWN_TOOLS`, `ShowColorPickerArgs`, `ShowColorPickerResult`, `ColorSwatch`, `ColorPickerPrimitive`, `ToolCallPayload`, `ToolResultPayload`, `Envelope`, plus type aliases (`index.ts:58-60`).
- **Type-import discipline (from 02b-i, `session-client.ts:24-31`):** importing a Zod *schema value* into the overlay can trigger TS2749 under the root typecheck program. Use `Extract<Envelope, {type:"..."}>` for envelope *types*; import only the runtime validators genuinely needed.

### H2 — Current flow: **CONFIRMED.**

`session-client.ts:142-155`: on inbound `tool_call` matching `confirmedSessionId`, the seam builds a `ToolCancel` and `ws.send`s it immediately (02b-i transport proof; does NOT render). 02b-ii removes this and routes to render-then-(result|cancel).

### H3 — Daemon behavior: **CONFIRMED; the `completed` path is reachable for the first time here.**

- `mock-agent.ts:99-117`: on `session_start`, emits `[session_ack, tool_call]` and parks `{ phase:"awaiting_pick", session_id, call_id }`. **It IGNORES `session_start.text`** (`mock-agent.ts:16-18`) — always takes the color path, so any non-empty input triggers the picker.
- Mock palette (`mock-agent.ts:27-33`): `[{Crimson,#DC143C},{Forest,#228B22},{Azure,#1E90FF}]`, question `"Which color do you want?"`.
- On `tool_result` while `awaiting_pick`, validates `inbound.payload.result` via `ShowColorPickerResult.safeParse`; success → `session_end{reason:"completed"}`. On `tool_cancel` while `awaiting_pick` → `session_end{reason:"cancelled"}`.
- **Runtime-coupling note (02a→02b-i lesson):** daemon emits `session_ack` then `tool_call` as two ordered `send()`s in one turn; WS preserves order, so "render only after `confirmedSessionId` is set" holds. A `tool_call` for an unconfirmed session is ignored.
- **Malformed-result behavior:** a malformed `tool_result` leaves the session open (daemon emits nothing) → `runEcho` would hang to its 2000ms timeout. Our renderer builds `picked` directly from a contract swatch, so this cannot happen in normal flow.

---

## DECISION (Lior, 2026-05-31): Option B — separate top-right Tauri window

ADR-0006 mandates the top-right corner, but 02b-i shipped a single 600×120 **centered** window (`tauri.conf.json:13-26`, label `main`) that cannot reach the corner. **Lior chose Option B** (a dedicated second Tauri window for the widget zone), explicitly NOT Option A. Rationale (verbatim intent):

- **Hard requirement:** a click OUTSIDE the widget must pass through to the app underneath; the widget floats above other windows.
- A small content-sized window does not intercept clicks outside its own bounds — outside it there is simply *no window*, so the click lands on whatever is underneath. **This gives click-through naturally, with no `setIgnoreCursorEvents` toggling.**
- Option A (one large window) was rejected: enlarging the window to host a corner widget would intercept clicks across its whole area → breaks click-through. Restoring it under A needs fragile, platform-dependent regional `setIgnoreCursorEvents` driven by cursor position.
- B is the **correct** realization of ADR-0006's "two zones" — essentially the target architecture, minimal rework later. (Option C — render the widget inside the resized `main` window — was also rejected: it breaks once input + widget must be visible simultaneously, the persistent-widget case ADR-0006 anticipates.)

**Flow confirmations (Lior, baked into the wiring below):**
- Input window (`main`) hides on submit / click-away — already works in 02b-i, unchanged.
- The mock daemon ignores typed text and always returns the picker — so any non-empty input triggers it (confirmed H3).
- Input placeholder text becomes `(skeleton: type anything → shows picker)`.

---

## Tauri v2 mechanism — CONFIRMED via docs (so the worker does not guess)

Verified against the Tauri v2 reference and the canonical permission source. **Confirmed facts** (build against these):

1. **Declare the second window statically** in `tauri.conf.json` `app.windows[]` (a second `WindowConfig` object). This is cleaner than `WebviewWindowBuilder` for a fixed, always-present-but-hidden widget surface: it exists from launch (so `getByLabel` always resolves), needs no runtime creation/teardown, and mirrors how `main` is already declared. **Confirmed `WindowConfig` field names (camelCase):** `label`, `width`, `height`, `x`, `y`, `transparent`, `decorations`, `alwaysOnTop`, `visible`, `skipTaskbar`, `resizable`, `focus`, `center`. (`x`/`y` are supported positioning fields.)
2. **A second window needs its own URL/document.** Pointing it at `index.html` would re-run `main.ts` (re-registering the input panel + WS round-trip) inside the widget window — wrong. So the widget window gets its own Vite entry (`widget.html` → `widget.ts`) via `tauri.conf.json` window `"url": "widget.html"` + Vite `build.rollupOptions.input` multi-page wiring. **Confirmed: this is the standard v2 multi-window + multi-page pattern.**
3. **Show/hide/position via the JS API** from `main.ts`: `import { WebviewWindow } from "@tauri-apps/api/webviewWindow"`. **Confirmed: `WebviewWindow.getByLabel(label)` is ASYNC** — `static getByLabel(label: string): Promise<WebviewWindow | null>` (must be `await`ed). Methods: `show(): Promise<void>`, `hide(): Promise<void>`, `setPosition(position): Promise<void>`, `setAlwaysOnTop(b: boolean): Promise<void>`. **Position requires a `LogicalPosition`/`PhysicalPosition` instance** (`import { LogicalPosition } from "@tauri-apps/api/dpi"`), not a plain `{x,y}` object.
4. **Capability permissions** the second window's mutation requires (literal identifiers confirmed from the canonical Tauri permission source): `core:window:allow-show`, `core:window:allow-hide`, `core:window:allow-set-position`, `core:window:allow-set-always-on-top`. The read-only `core:window` default set does NOT include these state-mutating ones, so they are added **explicitly** (same discipline 02b-i used for `global-shortcut:allow-*`). The capability `windows` array is extended to include `"widget"`.
5. **Cross-window data path = Tauri events** (NOT a second WebSocket). The live WS/session lives only in `main` (`runEcho`). `main` `emit`s the picker payload to the widget; the widget renders and `emit`s the user's choice/cancel back; `main` calls the seam's `sendResult`/`sendCancel` on the still-open socket. **Confirmed: `core:event` default (`allow-listen`, `allow-unlisten`, `allow-emit`, `allow-emit-to`) is bundled in `core:default`** — already present in `capabilities/default.json:6` — so NO new event permission is needed. Use `emit`/`emitTo`/`listen` from `@tauri-apps/api/event`.
6. **Click-through outside the widget is natural.** Confirmed: a content-sized window does not exist outside its bounds, so clicks there hit whatever is underneath. `setIgnoreCursorEvents` is NOT used (it is only for click-through THROUGH a window's own area — not our case).

**Remaining manual-tuning details (NOT design decisions — eyeball during the manual checklist):** the exact widget window `width`/`height` (start `360×200`, content-sized) and the exact top-right `x`/`y` offset (start `x` = screen-width − width − 20, `y` = 20). The plan uses a fixed `x:1500, y:24` as a v0 starting point that Lior nudges live; precise multi-monitor-aware positioning is post-skeleton.

**No protocol/daemon change in any case.** Option B is pure frontend windowing + intra-app events; the wire contract and daemon stay byte-identical. (If this were not true the plan would be Blocked — it is true; verified.)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/overlay/src/ws/tool-call-handler.ts` | **Create** | Pure, DOM-free decision/build layer. `decideRender`, `buildToolResult`, `buildToolCancel`. |
| `apps/overlay/src/ws/tool-call-handler.test.ts` | **Create** | `bun test` unit tests for the pure layer (no daemon/DOM). |
| `apps/overlay/src/ws/session-client.ts` | **Modify** | Replace auto-cancel with an injected `onToolCall` callback carrying picker + ids + bound `sendResult`/`sendCancel`. |
| `apps/overlay/src/ws/session-client.test.ts` | **Modify** | Update tests: `tool_call` fires `onToolCall`; result/cancel emit correct envelopes; `completed`/`cancelled` resolve. |
| `apps/overlay/src/widgets/color-picker.ts` | **Create** | DOM renderer for the primitive (label + swatch buttons + close), framework-free. |
| `apps/overlay/widget.html` | **Create** | Second Vite entry / document for the widget window. |
| `apps/overlay/src/widget.ts` | **Create** | Widget-window bootstrap: listen for the `show-picker` event, render, emit `picker-result`/`picker-cancel` back. |
| `apps/overlay/src/widget.css` | **Create** | Widget-window-scoped styles (transparent body + `.color-picker-widget`). |
| `apps/overlay/src/main.ts` | **Modify** | Wire `onToolCall` → `emitTo("widget", …)` + show/position widget window; listen for `picker-result`/`picker-cancel` → `sendResult`/`sendCancel`; hide widget on settle; placeholder text update. |
| `apps/overlay/index.html` | **Modify** | Placeholder text → `(skeleton: type anything → shows picker)`. |
| `apps/overlay/vite.config.ts` | **Modify** | `build.rollupOptions.input` = `{ main: index.html, widget: widget.html }`. |
| `apps/overlay/src-tauri/tauri.conf.json` | **Modify** | Add second `widget` window: content-sized, `transparent`, `decorations:false`, `alwaysOnTop:true`, top-right `x`/`y`, `visible:false`, `url:"widget.html"`. |
| `apps/overlay/src-tauri/capabilities/default.json` | **Modify** | Add `"widget"` to `windows`; add 4 explicit `core:window:allow-*` permissions. |
| `apps/overlay/README.md` | **Modify** | Document the two-window picker round-trip + manual checklist. |

`apps/overlay/src-tauri/src/lib.rs` / `main.rs`: **no change** — all window control is via the JS API; no new Rust command needed.

---

## Tasks

### Task 1: Pure render-decision layer (DOM-free, TDD) — ✅ DONE (commit 6a5b7e8; 5 bun tests green, root typecheck + lint:strict clean, byte-for-byte match to frozen contract, no deviations)

**Files:**
- Create: `apps/overlay/src/ws/tool-call-handler.ts`
- Test: `apps/overlay/src/ws/tool-call-handler.test.ts`

- [ ] **Step 1: Write the failing test for `decideRender`**

```typescript
// apps/overlay/src/ws/tool-call-handler.test.ts
import { test, expect } from "bun:test";
import { decideRender } from "./tool-call-handler.js";

const colorPickerToolCall = {
  type: "tool_call" as const,
  session_id: "srv-1",
  call_id: "call-1",
  payload: {
    tool: "show_color_picker" as const,
    args: { picker: { primitive: "color-picker" as const, question: "Pick", palette: [{ label: "Red", hex: "#FF0000" }] } },
  },
};

test("decideRender returns render with the picker when tool_call matches confirmed session", () => {
  const d = decideRender(colorPickerToolCall, "srv-1");
  expect(d.kind).toBe("render");
  if (d.kind === "render") {
    expect(d.session_id).toBe("srv-1");
    expect(d.call_id).toBe("call-1");
    expect(d.picker.question).toBe("Pick");
    expect(d.picker.palette[0]!.label).toBe("Red");
  }
});

test("decideRender ignores a tool_call for an unconfirmed/mismatched session", () => {
  expect(decideRender(colorPickerToolCall, undefined).kind).toBe("ignore");
  expect(decideRender(colorPickerToolCall, "other").kind).toBe("ignore");
});

test("decideRender ignores an unknown tool gracefully (no throw, forward-compat)", () => {
  const unknown = { ...colorPickerToolCall, payload: { tool: "show_mystery", args: {} } } as unknown as Parameters<typeof decideRender>[0];
  expect(() => decideRender(unknown, "srv-1")).not.toThrow();
  expect(decideRender(unknown, "srv-1").kind).toBe("ignore");
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun test apps/overlay/src/ws/tool-call-handler.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement the pure layer**

```typescript
// apps/overlay/src/ws/tool-call-handler.ts
import { classifyTool, ShowColorPickerResult } from "@agentic/protocol";
import type { Envelope, ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";

type ToolCall = Extract<Envelope, { type: "tool_call" }>;
type ToolResult = Extract<Envelope, { type: "tool_result" }>;
type ToolCancel = Extract<Envelope, { type: "tool_cancel" }>;

export type RenderDecision =
  | { kind: "render"; session_id: string; call_id: string; picker: ColorPickerPrimitive }
  | { kind: "ignore" };

export function decideRender(call: ToolCall, confirmedSessionId: string | undefined): RenderDecision {
  if (confirmedSessionId === undefined || call.session_id !== confirmedSessionId) {
    return { kind: "ignore" };
  }
  const cls = classifyTool(call.payload.tool);
  if (!cls.known || cls.name !== "show_color_picker") {
    return { kind: "ignore" };
  }
  return { kind: "render", session_id: call.session_id, call_id: call.call_id, picker: call.payload.args.picker };
}

export function buildToolResult(session_id: string, call_id: string, picked: ColorSwatch): ToolResult {
  const result = { picked };
  ShowColorPickerResult.parse(result);
  return { type: "tool_result", session_id, call_id, payload: { tool: "show_color_picker", result } };
}

export function buildToolCancel(session_id: string, call_id: string): ToolCancel {
  return { type: "tool_cancel", session_id, call_id };
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS (3 tests).

- [ ] **Step 5: Add builder tests (red→green)**

```typescript
// append to tool-call-handler.test.ts
import { buildToolResult, buildToolCancel } from "./tool-call-handler.js";
import { parseEnvelope } from "@agentic/protocol";

test("buildToolResult emits a contract-valid tool_result with picked nested under payload.result", () => {
  const msg = buildToolResult("srv-1", "call-1", { label: "Azure", hex: "#1E90FF" });
  expect(parseEnvelope(msg).kind).toBe("ok");
  expect(msg.payload.result.picked.label).toBe("Azure");
});

test("buildToolCancel emits a contract-valid tool_cancel carrying call_id", () => {
  const msg = buildToolCancel("srv-1", "call-1");
  expect(parseEnvelope(msg).kind).toBe("ok");
  expect(msg.call_id).toBe("call-1");
});
```

- [ ] **Step 6: Commit** — `git commit -m "feat(overlay): pure DOM-free tool-call decision/build layer"`

---

### Task 2: Rewire the seam — replace auto-cancel with an onToolCall callback (TDD) — ✅ DONE (code complete + verified: whole-repo bun test 53 pass / 0 fail, root typecheck + lint:strict clean; files STAGED, commit pending harness git-block)

**Files:**
- Modify: `apps/overlay/src/ws/session-client.ts` (replace `tool_call` branch at lines 142-155; add `onToolCall` param; remove the local `ToolCancel` type at line 31, now unused)
- Modify: `apps/overlay/src/ws/session-client.test.ts`

- [ ] **Step 1: Write failing seam tests** for the new flow. Concretely:
  - Replace the happy-path test so `tool_call` does NOT auto-send a cancel; instead it must invoke an injected `onToolCall` whose `ctx` carries `picker`, `sessionId:"srv-1"`, `callId:"call-abc"`, and callable `sendResult`/`sendCancel`.
  - Add a test: calling `ctx.sendResult({label:"Azure",hex:"#1E90FF"})` makes the seam `send` a `tool_result` (parse-valid, `payload.result.picked.label==="Azure"`, matching `call_id`); a following `session_end{reason:"completed"}` resolves `{sessionId:"srv-1", reason:"completed"}`.
  - Add a test: calling `ctx.sendCancel()` makes the seam `send` a `tool_cancel` (matching `call_id`); a following `session_end{reason:"cancelled"}` resolves.
  - Keep the unknown/invalid-frame test (gotcha #9): an unknown tool name in `tool_call` must NOT fire `onToolCall` and must not throw; drive completion by directly firing `session_end`. Keep the non-correlating-ack test unchanged.

- [ ] **Step 2: Run tests to verify they fail** — `bun test apps/overlay/src/ws/session-client.test.ts` → FAIL.

- [ ] **Step 3: Rewire the seam.** Add the imports and options, change the `runEcho` signature, replace the `tool_call` branch.

```typescript
// add near the existing imports
import { decideRender, buildToolResult, buildToolCancel } from "./tool-call-handler.js";
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";

// add the option/context interfaces (after EchoResult)
export interface ToolCallContext {
  picker: ColorPickerPrimitive;
  sessionId: string;
  callId: string;
  sendResult: (picked: ColorSwatch) => void;
  sendCancel: () => void;
}
export interface RunEchoOptions {
  onToolCall?: (ctx: ToolCallContext) => void;
}
```

Change the signature to `export function runEcho(text: string, factory: WebSocketFactory, options: RunEchoOptions = {}): Promise<EchoResult>`. Delete the now-unused `type ToolCancel = …` (line 31). Replace the `tool_call` branch (lines 142-155) with:

```typescript
if (envelope.type === "tool_call") {
  const decision = decideRender(envelope, confirmedSessionId);
  if (decision.kind === "render") {
    const { session_id, call_id, picker } = decision;
    options.onToolCall?.({
      picker,
      sessionId: session_id,
      callId: call_id,
      sendResult: (picked) => { if (!settled) ws.send(JSON.stringify(buildToolResult(session_id, call_id, picked))); },
      sendCancel: () => { if (!settled) ws.send(JSON.stringify(buildToolCancel(session_id, call_id))); },
    });
  }
  // unknown tool / unconfirmed session ⇒ ignore (graceful, no throw)
  return;
}
```

Update the file header comment block (lines 1-14, 57-75): the seam now surfaces a render decision via `onToolCall` and the renderer drives `sendResult`/`sendCancel`; it no longer auto-cancels.

- [ ] **Step 4: Run tests to verify they pass** — `bun test apps/overlay/src/ws/session-client.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(overlay): seam surfaces onToolCall instead of auto-cancel"`

---

### Task 3: Color-picker renderer + dedicated top-right widget WINDOW (Option B) + cross-window wiring — ✅ DONE (code complete + verified: bun test 53 pass, root typecheck 0, apps/overlay typecheck 0, lint:strict 0; protocol+daemon diff empty, lib.rs unchanged; files STAGED, commit pending harness git-block; DOM/window placement = Lior's manual macOS checklist)

**Files:**
- Create: `apps/overlay/src/widgets/color-picker.ts`, `apps/overlay/widget.html`, `apps/overlay/src/widget.ts`, `apps/overlay/src/widget.css`
- Modify: `apps/overlay/vite.config.ts`, `apps/overlay/src-tauri/tauri.conf.json`, `apps/overlay/src-tauri/capabilities/default.json`, `apps/overlay/src/main.ts`, `apps/overlay/index.html`, `apps/overlay/README.md`

This task has no new `bun test` units (the testable logic is Tasks 1-2; the renderer + windowing are verified by the manual macOS checklist + typecheck/lint). Steps are ordered so the app stays compilable after each.

- [ ] **Step 1: Add the second window to `tauri.conf.json`.** Insert a second object into `app.windows[]` (after the existing `main` object at line 24). Exact entry:

```json
{
  "label": "widget",
  "url": "widget.html",
  "width": 360,
  "height": 200,
  "x": 1500,
  "y": 24,
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "focus": false,
  "visible": false
}
```

(`x:1500, y:24` is a v0 starting point for top-right on a common display; nudge live during the manual checklist — it is a tuning detail, not a design decision.)

- [ ] **Step 2: Grant the window-control permissions and scope the capability.** Edit `apps/overlay/src-tauri/capabilities/default.json` so `windows` includes both labels and the four explicit window-mutation permissions are present:

```json
{
  "identifier": "default",
  "description": "default",
  "windows": ["main", "widget"],
  "permissions": [
    "core:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-position",
    "core:window:allow-set-always-on-top"
  ]
}
```

(`core:event:*` is already covered by `core:default` — no event permission added.)

- [ ] **Step 3: Add the Vite multi-page entry.** Replace `apps/overlay/vite.config.ts` with:

```typescript
import { defineConfig } from "vite";
import { resolve } from "node:path";

// Port 1420 is LOAD-BEARING: the daemon allowlist includes "http://localhost:1420"
// as the dev origin (ADR-0003 Amendment 2026-05-30). If this port drifts to the
// Vite default 5173, the WebSocket upgrade is rejected with 403.
export default defineConfig({
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        widget: resolve(__dirname, "widget.html"),
      },
    },
  },
});
```

- [ ] **Step 4: Create the framework-free DOM renderer.** `apps/overlay/src/widgets/color-picker.ts` — pure DOM, no Tauri/WS imports, so it stays trivially reasoned-about:

```typescript
// apps/overlay/src/widgets/color-picker.ts
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";

export interface ColorPickerCallbacks {
  onPick: (picked: ColorSwatch) => void;
  onCancel: () => void;
}

/**
 * Renders the color-picker primitive into `host` (replacing its contents):
 * a question label, a row of clickable swatch buttons, and a close (×) button.
 * DOM-only — no Tauri, no WebSocket. The caller wires the callbacks to the
 * cross-window event bridge (widget.ts).
 */
export function renderColorPicker(
  host: HTMLElement,
  picker: ColorPickerPrimitive,
  cb: ColorPickerCallbacks,
): void {
  host.replaceChildren();

  const card = document.createElement("div");
  card.className = "color-picker-widget";

  const close = document.createElement("button");
  close.className = "cp-close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Cancel");
  close.addEventListener("click", () => cb.onCancel());
  card.appendChild(close);

  const label = document.createElement("div");
  label.className = "cp-question";
  label.textContent = picker.question;
  card.appendChild(label);

  const row = document.createElement("div");
  row.className = "cp-swatches";
  for (const swatch of picker.palette) {
    const btn = document.createElement("button");
    btn.className = "cp-swatch";
    btn.type = "button";
    btn.style.backgroundColor = swatch.hex;
    btn.title = `${swatch.label} ${swatch.hex}`;
    btn.setAttribute("aria-label", swatch.label);
    btn.addEventListener("click", () => cb.onPick(swatch));

    const tag = document.createElement("span");
    tag.className = "cp-swatch-label";
    tag.textContent = swatch.label;
    btn.appendChild(tag);

    row.appendChild(btn);
  }
  card.appendChild(row);

  host.appendChild(card);
}
```

- [ ] **Step 5: Create the widget document.** `apps/overlay/widget.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgenticEngine Widget</title>
    <link rel="stylesheet" href="/src/widget.css" />
  </head>
  <body>
    <div id="widget-host"></div>
    <script type="module" src="/src/widget.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create the widget styles.** `apps/overlay/src/widget.css`:

```css
/* Transparent body — the Tauri widget window transparency shows through. */
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
  height: 100%;
  width: 100%;
}

#widget-host {
  padding: 12px;
  box-sizing: border-box;
}

.color-picker-widget {
  position: relative;
  background: rgba(28, 28, 30, 0.94);
  border-radius: 14px;
  padding: 16px 16px 18px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #f5f5f7;
}

.cp-close {
  position: absolute;
  top: 8px;
  right: 10px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.12);
  color: #f5f5f7;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.cp-close:hover { background: rgba(255, 255, 255, 0.22); }

.cp-question {
  font-size: 14px;
  margin: 2px 28px 14px 2px;
}

.cp-swatches {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.cp-swatch {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  width: 64px;
  height: 64px;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  cursor: pointer;
  padding: 0;
  overflow: hidden;
}
.cp-swatch:hover { border-color: rgba(255, 255, 255, 0.6); }

.cp-swatch-label {
  width: 100%;
  font-size: 10px;
  text-align: center;
  padding: 2px 0;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
}
```

- [ ] **Step 7: Create the widget-window bootstrap (event bridge).** `apps/overlay/src/widget.ts` — listens for the picker payload from `main`, renders, and emits the user's choice/cancel back. The widget window holds NO WebSocket.

```typescript
// apps/overlay/src/widget.ts
import { listen, emit } from "@tauri-apps/api/event";
import type { ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";
import { renderColorPicker } from "./widgets/color-picker.js";

// Event channel names — shared contract between main.ts and widget.ts.
// (Intra-app only; NOT part of the frozen wire protocol.)
const EV_SHOW = "show-picker";        // main → widget : { picker }
const EV_RESULT = "picker-result";    // widget → main : ColorSwatch
const EV_CANCEL = "picker-cancel";    // widget → main : (no payload)

const host = document.getElementById("widget-host");
if (host === null) throw new Error("Required DOM element #widget-host not found");

void listen<{ picker: ColorPickerPrimitive }>(EV_SHOW, (event) => {
  renderColorPicker(host, event.payload.picker, {
    onPick: (picked: ColorSwatch) => { void emit(EV_RESULT, picked); },
    onCancel: () => { void emit(EV_CANCEL); },
  });
});
```

- [ ] **Step 8: Update the input placeholder.** In `apps/overlay/index.html`, change the `placeholder` attribute (line 14) from `"Ask anything..."` to `"(skeleton: type anything → shows picker)"`.

- [ ] **Step 9: Wire `main.ts` — relay to the widget window, drive result/cancel, hide on settle.** Edit `apps/overlay/src/main.ts`:

  9a. Add imports near the existing `@tauri-apps/api/core` import:
```typescript
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { ToolCallContext } from "./ws/session-client.js";
import type { ColorSwatch } from "@agentic/protocol";
```

  9b. Add the widget-window helpers + the cross-window pick/cancel listener (after the `hidePanel` helper, before the `inFlight` guard). The listeners are registered ONCE at module load; the per-session `sendResult`/`sendCancel` are routed through a module-scoped `activeCtx`.

```typescript
// ── Widget window (top-right zone, ADR-0006) ───────────────────────────────
// The widget lives in a separate Tauri window ("widget"). main.ts owns the WS
// session; it relays the picker to the widget over Tauri events and routes the
// user's choice/cancel back to the seam's sendResult/sendCancel.
const WIDGET_LABEL = "widget";
const EV_SHOW = "show-picker";
const EV_RESULT = "picker-result";
const EV_CANCEL = "picker-cancel";

// Only one picker is live at a time in v0 (single in-flight session, 6.5a guard).
let activeCtx: ToolCallContext | undefined;
let pickerSettled = false;

async function showWidgetWindow(): Promise<void> {
  const w = await WebviewWindow.getByLabel(WIDGET_LABEL);
  if (w === null) return;
  await w.setPosition(new LogicalPosition(1500, 24)); // tuning detail; matches tauri.conf x/y
  await w.setAlwaysOnTop(true);
  await w.show();
}

async function hideWidgetWindow(): Promise<void> {
  const w = await WebviewWindow.getByLabel(WIDGET_LABEL);
  if (w === null) return;
  await w.hide();
}

function onToolCall(ctx: ToolCallContext): void {
  activeCtx = ctx;
  pickerSettled = false;
  // Hide the input window so the picker is the only surface (input already
  // hides on submit in main flow; this guards the click-away/Escape-less path).
  hidePanel().catch(() => {/* ignore */});
  emitTo(WIDGET_LABEL, EV_SHOW, { picker: ctx.picker }).catch(() => {/* ignore */});
  showWidgetWindow().catch(() => {/* ignore */});
}

// Cross-window result/cancel — registered once.
void listen<ColorSwatch>(EV_RESULT, (event) => {
  if (activeCtx === undefined || pickerSettled) return;
  pickerSettled = true;
  activeCtx.sendResult(event.payload);
  hideWidgetWindow().catch(() => {/* ignore */});
});
void listen(EV_CANCEL, () => {
  if (activeCtx === undefined || pickerSettled) return;
  pickerSettled = true;
  activeCtx.sendCancel();
  hideWidgetWindow().catch(() => {/* ignore */});
});
```

  9c. Pass `onToolCall` into the existing `runEcho` call (line 68). Change `runEcho(text, factory)` to `runEcho(text, factory, { onToolCall })`. In the `.then(...)` settle handler, also hide the widget window so a `completed`/`cancelled` settle clears it, and reset the picker guards:

```typescript
runEcho(text, factory, { onToolCall })
  .then(({ sessionId, reason }) => {
    setStatus(`session ${sessionId} — ${reason}`);
    setTimeout(() => {
      hidePanel().catch(() => {/* ignore hide errors */});
      hideWidgetWindow().catch(() => {/* ignore */});
      input.value = "";
      inFlight = false;
      activeCtx = undefined;
      pickerSettled = false;
    }, 1200);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`error: ${msg}`);
    hideWidgetWindow().catch(() => {/* ignore */});
    inFlight = false;
    activeCtx = undefined;
    pickerSettled = false;
  });
```

  (Note: the user-driven `sendResult`/`sendCancel` fire BEFORE `session_end`; the seam's `settled` guard plus the `pickerSettled` guard make duplicate emits no-ops — the swatch click sends the `tool_result`, the daemon then sends `session_end{completed}`, and the `.then` only hides the already-emptied widget.)

- [ ] **Step 10: Update `apps/overlay/README.md`.** Replace the "v0 Round-trip flow" section's auto-cancel description with the two-window picker flow, and update the manual smoke checklist. Add a subsection documenting the two windows (`main` = center input; `widget` = top-right picker, content-sized, click-through outside its bounds) and the new message sequence:

```
overlay(main) → daemon : session_start{trigger:"user", text, client_session_id}
daemon → overlay(main) : session_ack{session_id, client_session_id}
daemon → overlay(main) : tool_call{session_id, call_id, payload:{tool:"show_color_picker", args:{picker}}}
overlay(main) ⇄ overlay(widget) : Tauri event "show-picker" → render → "picker-result"|"picker-cancel"
overlay(main) → daemon : tool_result{session_id, call_id, payload:{result:{picked}}}  (on click)
                         OR tool_cancel{session_id, call_id}                          (on ×)
daemon → overlay(main) : session_end{reason:"completed"}  (result)  |  "cancelled" (cancel)
```

- [ ] **Step 11: Commit** — `git commit -m "feat(overlay): color-picker renderer in dedicated top-right widget window (Option B)"`

---

## Verification

**No "done" claim until every command below shows real green output. Per superpowers:verification-before-completion.**

- [ ] `bun test` — whole repo green; paste real pass count (expect the 5 new `tool-call-handler` tests + the updated `session-client` tests + all existing daemon/protocol tests).
- [ ] `bun run typecheck` (root) — exit 0.
- [ ] `cd apps/overlay && bun run typecheck` — exit 0. (Watch for TS2749 on any accidental Zod-schema-value import — use `Extract<Envelope,…>` for envelope types, per the 02b-i discipline.)
- [ ] `bun run lint:strict` (root, `eslint . --max-warnings=0`) — exit 0.
- [ ] `git diff packages/protocol packages/daemon` — **EMPTY** (frozen contract + daemon byte-untouched). This MUST be empty under Option B.
- [ ] **EXPECTED under Option B:** `git diff apps/overlay/src-tauri` is NON-empty — `tauri.conf.json` gains the `widget` window and `capabilities/default.json` gains the `widget` scope + four `core:window:allow-*` permissions. This is the intended, called-out `src-tauri` change for the second window. (`lib.rs`/`main.rs` should remain unchanged — flag if a Rust edit appears, as none is required.)

### Manual macOS checklist (Lior — native gate, not automatable)

1. `cd packages/daemon && bun run dev` → logs `listening on ws://127.0.0.1:7777`.
2. `cd apps/overlay && bun run tauri dev` → app starts; NO visible window (`main` and `widget` both start `visible:false`).
3. Grant macOS Accessibility permission if not already (README). Re-press the hotkey.
4. Hotkey → centered input panel appears, focused, placeholder reads `(skeleton: type anything → shows picker)`.
5. Type anything, Enter → input panel hides; **the color-picker widget appears in the top-right corner** (dark card with question `"Which color do you want?"` and three swatches: Crimson / Forest / Azure).
6. Click a swatch (e.g. Azure) → status briefly shows `session <uuid> — completed`; the widget window hides. (First time the daemon's `completed` path is exercised.)
7. Re-trigger (hotkey → type → Enter), click the **×** → status shows `session <uuid> — cancelled`; the widget window hides.
8. **CLICK-THROUGH (Option B's hard requirement):** re-trigger to show the widget, then click on the **desktop or another app OUTSIDE the small widget card** (e.g. a Finder window behind it). The click must pass through and land on that app (Finder gets focus / the desktop item gets selected) — the widget window must NOT intercept it. Then click a swatch inside the card to settle.
9. Unknown-tool fallback → covered by automated tests (`decideRender` ignore path); no live step.
10. **Prod gate:** `bun run tauri build`, launch the `.app`, repeat steps 4–8 against the running daemon — confirms the prod `tauri://localhost` Origin round-trip and that the second window + capabilities ship correctly in the bundle.

---

## Approaches

### Renderer/window-entry strategy

- **Chosen — separate Vite entry (`widget.html` → `widget.ts`) + Tauri-event bridge.** Each native window loads its own document, so the widget cannot share `main`'s WebSocket JS object. A separate entry keeps the widget a pure render+emit surface; the WS/session stays solely in `main`. Pros: clean window/responsibility split, matches Tauri v2 multi-window idiom, the daemon/frontend separation holds, the pure layer (Task 1) and seam callback (Task 2) are untouched. Cons: one extra HTML/Vite entry + cross-window event plumbing (mitigated — `core:event` is already in `core:default`).
- **Rejected — point the second window at `index.html` and branch by window label.** Reusing one document means `main.ts` re-runs in the widget window (re-registers input + WS). Branching on `getCurrentWindow().label` to suppress the input path is more fragile than two small focused entries, and still leaves a stray WS in the widget unless carefully guarded. More foot-guns for no gain.
- **Rejected — widget opens its own WebSocket.** A second socket = a second session; breaks correlation with the already-open `awaiting_pick` session. Wrong by construction.

### Chosen Approach

Separate `widget.html`/`widget.ts` entry rendered in a dedicated content-sized, transparent, always-on-top, top-right `widget` Tauri window (statically declared in `tauri.conf.json`, `visible:false`). `main` owns the WS session and the seam's `onToolCall` callback; it relays the picker to the widget and routes the user's choice/cancel back over Tauri events (`show-picker` / `picker-result` / `picker-cancel`). Click-through outside the widget is natural (content-sized window, no `setIgnoreCursorEvents`). Tauri v2 APIs and permission identifiers were confirmed against the docs (see "Tauri v2 mechanism" section). Pure layer (Task 1) and seam callback (Task 2) are Option-independent and locked. No `packages/protocol` or `packages/daemon` change.

---

## ADR worthy: amend-0006

A dated amendment to **ADR-0006** suffices — this is the correct realization of its already-accepted "two visual zones" (Decision p.2), not a new architectural decision. It is not a supersede; it pins *how* the two zones are realized in v0. No new dependency (the `@tauri-apps/api` subpaths used are part of the already-present `^2.0.0` dep) and no protocol/boundary change, so a standalone ADR would be bloat. Recommended amendment text for `adr-curator` to append to `orchestration/docs/adr/0006-dual-hotkey-2zone-ux.md`:

> ## Amendment 2026-05-31
>
> **Not a supersede.** This pins *how* the two visual zones (Decision p.2) are realized in Walking Skeleton v0, leaving the decision text unchanged.
>
> The two zones are implemented as **two separate Tauri windows**: the center input panel is the `main` window (02b-i); the top-right ephemeral widget zone is a dedicated `widget` window — content-sized, `transparent`, `decorations:false`, `alwaysOnTop:true`, `visible:false` until a widget renders. **Click-through outside the widget is a natural consequence of the window being content-sized** (outside its bounds there is no window, so clicks land on the app underneath); no `setIgnoreCursorEvents` is used. Option A (one large window hosting the corner via CSS) was rejected because it would intercept clicks across its whole area and require fragile, platform-dependent regional cursor-event toggling. The `main` window owns the live WebSocket session; it relays the picker primitive to the `widget` window and routes the user's pick/cancel back via intra-app Tauri events — the frozen wire protocol and daemon are untouched. Pinned by Lior during Chunk 02b-ii planning (2026-05-31). See [[../plans/walking-skeleton-v0-02b-ii-color-picker/plan]].

---

## ADR: orchestration/docs/adr/0006-dual-hotkey-2zone-ux.md (Amendment 2026-05-31 — LANDED via adr-curator; `## Amendment 2026-05-31`, original decision text preserved, status still `accepted`)

---

## Status: REVIEW-COMPLETE (2026-06-01)

All 3 tasks implemented + verified. engine-reviewer against baseline `c18b7d1`: **0 Critical / 0 Major**, 3 optional minor nits (non-blocking). All 5 chunk Done criteria met; all gates green (bun test 53 pass, root + apps/overlay typecheck 0, lint:strict 0; protocol+daemon diff empty; lib.rs unchanged). Runtime coupling to mock-agent's `completed`/`cancelled` paths verified byte-aligned.

**Remaining (NOT code):**
1. **Commits** — Task 1 committed (`6a5b7e8`); Tasks 2 & 3 STAGED, uncommitted (harness blocks `git commit` for the agent — Lior commits).
2. **Manual macOS checklist** (Lior — native gate, not automatable): see `## Verification → Manual macOS checklist`. Widget top-right, click→completed, ×→cancelled, click-through outside widget.

**Optional minor nits (reviewer, Lior's discretion):**
- main.ts:69 hardcodes `LogicalPosition(1500,24)` duplicating tauri.conf `x/y` — can drift during live tuning; consider a shared const.
- onToolCall fires 3 un-awaited promises; theoretical first-render race (not real for v0 — widget window + listener exist from launch).
- widget.ts/color-picker.ts throw on missing `#widget-host` — correct fail-fast, outside the wire-frame path (not a gotcha #9 violation).


**Self-review:** Spec coverage — all five chunk Done criteria map to tasks (render from contract mock → Task 1+widget; top-right zone → Task 3 `widget` window; click → `tool_result{picked}` → seam `sendResult`/Task 2; close → `tool_cancel` → `sendCancel`; unknown-tool no-throw → `decideRender` ignore path, tested). Type consistency — `onToolCall`/`ToolCallContext`/`sendResult`/`sendCancel`, the `show-picker`/`picker-result`/`picker-cancel` event names, and the `widget` window label are used identically across `session-client.ts`, `widget.ts`, and `main.ts`. No placeholders: every Tauri symbol (`WebviewWindow.getByLabel` async, `LogicalPosition`, `emitTo`/`listen`) and every permission identifier (`core:window:allow-show|hide|set-position|set-always-on-top`) is verified-real, not guessed. Frozen-contract + daemon diff must be empty (verification gate); `src-tauri` change is expected and called out.
