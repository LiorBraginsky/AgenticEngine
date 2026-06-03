---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, ux, activation, frontend]
---

# ADR-0006: Dual-Hotkey Activation + Two-Zone Visual Surface

## Status

`accepted`

## Context

The user-facing shape of AgenticEngine — how a user invokes it and where they see results — is one of the most product-defining decisions. Several dimensions are in play:

- **Activation method:** hotkey? menu bar icon? floating bubble? voice wake word? always-open tab?
- **Input modality:** voice, text, or both?
- **Visual surface for input:** centered panel? sidebar? corner pop-up?
- **Visual surface for results:** where do widgets appear?
- **Web tab role:** equivalent to native overlay, or distinct purpose?

These decisions together define "what AgenticEngine feels like."

## Decision

**Use two global hotkeys: one tap-to-open-text-panel (centered), one hold-to-talk-voice. Render UI widgets as ephemeral micro-windows in a fixed corner zone (top-right by default). Web admin tab is a distinct surface for configuration/observability, not a duplicate of the overlay.**

Concretely:

1. **Two global hotkeys:**
   - **Tap hotkey** (e.g., `⌘+Space` or user-configurable) → opens a centered input panel (Spotlight-style). User types, hits Enter. Panel closes.
   - **Hold hotkey** (e.g., `⌥+Space` or user-configurable) → mic active while held; on release, transcribed text is sent. No visual panel needed.
2. **Two visual zones:**
   - **Center of screen** (transient) — input panel only. Shown for input, closes after submit.
   - **Top-right corner** (slightly persistent) — UI tool widgets stack here. Stack max 3-5; older widgets fade or push out.
3. **Web admin tab** at `http://localhost:7777`:
   - Settings (API keys, hotkey rebinding, LLM provider config).
   - Plugin management.
   - Session history.
   - Cron / Rituals management.
   - Developer / protocol inspector.
   - **Not** the daily-interactive surface. Daily use is the overlay.
4. **Menu bar (tray) icon:**
   - Status indicator (running / idle / error).
   - Quick toggles (mute mic, pause cron, etc.).
   - Link to admin tab.
5. **No floating bubble, no voice wake word** in MVP.

## Consequences

### Positive

- **Conventional hotkey activation** (Spotlight/Raycast/Alfred have trained users).
- **Push-to-talk is the highest-trust voice paradigm** — mic active only when intentionally held, eliminating false triggers and privacy concerns of wake words.
- **Top-right widget zone** matches macOS's existing convention for ephemeral content (notifications appear there).
- **Input center, results corner** matches natural attention model: center = focus, corner = periphery.
- **Web tab as admin surface** is a strong design move — it gives space for things that don't belong in a 400px overlay (history search, dataview tables, debugging) without bloating the overlay UI.
- **Cross-platform path open** — Linux/Windows can do the same dual-hotkey + corner-zone model; no Apple-only constructs.

### Negative

- **Two hotkeys** = two things for users to memorize. Mitigation: discoverable in admin UI, customizable.
- **Top-right corner** may conflict with users who have notifications there (visual clutter). May need user-configurable zone.
- **Global hotkey registration on macOS requires accessibility permissions** — adds installation friction.
- **Hold-to-talk may not work in all OSes equally** — Wayland on Linux has hostile global hotkey handling.

### Trade-offs accepted

- We accept **two hotkeys to memorize** in exchange for **clean, modal-free voice input**.
- We accept **accessibility permissions friction** in exchange for **real OS-overlay UX**.
- We accept the **web tab is distinct, not duplicate** in exchange for **clear surface delineation** — the daily UX is not a browser tab.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "two hotkeys was confusing; should have done press-and-hold-vs-tap on one key" or "top-right zone clashed with notifications too often, should have made it configurable from day one."]

## Alternatives Considered

### Option α-only: Single hotkey (tap = text, hold = voice)

One key with debounce-based mode detection.

**Why not yet:** More elegant in theory, but timing-detection has UX edge cases (accidental holds, missed taps). Defer to v1.1 if users ask.

### Option β: Menu bar primary

User clicks tray icon to open the agent.

**Why not:** Less discoverable, slower than a keypress. Tray icon is still present in our design — just not as the primary activation.

### Option γ: Floating bubble (persistent on-screen)

Always-visible Chat-Heads-style icon.

**Why not:**
- Visual clutter.
- Requires accessibility window permissions plus floating-window APIs (varies by OS).
- Hotkey achieves the same activation with zero visual cost.

### Option δ: Voice wake word ("Hey Engine")

Always-on microphone listening for a trigger phrase.

**Why not:**
- Privacy: always-on mic in a personal-OS-overlay product is a tough sell.
- Battery + CPU overhead.
- False positives interrupt user.
- Push-to-talk gives equivalent UX without these costs.

### Option (1) Centered widgets / Option (2) Sidebar

**Why not center:** Widgets in center block whatever the user was looking at.
**Why not sidebar:** Permanently consumes screen real estate.
**Top-right corner with stack** is the compromise that respects user attention.

## Amendment 2026-05-30

**This is NOT a supersede.** Decision point 1 (the tap hotkey) already says "`⌘+Space` *or user-configurable*" — `⌘+Space` was only an *example*, and the binding is explicitly framed as user-configurable. The original Decision text stands unchanged. What this amendment does is pin the concrete **v0 default** the example left open; it does not narrow the user-configurable promise.

Pinned by Lior during Walking Skeleton v0 — Chunk 02b-i planning (2026-05-30). See [[../plans/walking-skeleton-v0-02b-i-tauri-shell/plan]] (`## ADR worthy` #1, Step 3.4).

- **The v0 default tap-hotkey accelerator is `CommandOrControl+Shift+Space`** (Tauri accelerator-string notation; `CommandOrControl` resolves to ⌘ on macOS and Ctrl on Windows/Linux). This is the concrete default that Decision p.1's `⌘+Space` example deliberately left unpinned.

- **Why this binding:**
  - **Avoids the macOS Spotlight collision** (⌘Space) — the original `⌘+Space` example would have fought Spotlight on a stock macOS install.
  - **Avoids the input-source-switch collision** (⌃Space) — the macOS default for cycling keyboard input sources.
  - **Cross-platform-portable** — the single `CommandOrControl+Shift+Space` accelerator string works on macOS, Windows, and Linux without per-OS branching, consistent with this ADR's "cross-platform path open" consequence.
  - **Mnemonic** — a Spotlight-adjacent chord (⇧ added to the familiar ⌘Space) that stays in the same muscle-memory family without the conflict.

- **Scope boundary — this pins the DEFAULT only.** The hotkey remains user-rebindable exactly as Decision p.1 already states. The rebinding UI and the persistence of a custom binding (settings storage) are **explicitly OUT of scope for Chunk 02b-i** and deferred to a later chunk. Chunk 02b-i ships the hardcoded default; nothing here commits to *when* the rebinding surface lands.

- **Known residual:** some applications bind ⌘⇧Space in certain contexts (e.g. emoji / symbol pickers). This is **acceptable for a v0 default precisely because the binding is rebindable** — a user hitting the conflict can rebind once the rebinding surface exists. Recorded here so it is not later rediscovered as a surprise rather than a known, accepted trade-off.

## Amendment 2026-05-31

**This is NOT a supersede.** This pins *how* Decision p.2's two visual zones are realized in Walking Skeleton v0, leaving the original Decision text unchanged.

Pinned by Lior during Walking Skeleton v0 — Chunk 02b-ii planning (2026-05-31). See [[../plans/walking-skeleton-v0-02b-ii-color-picker/plan]].

- **Two zones = two separate Tauri windows.** The center input panel is the `main` window (chunk 02b-i). The top-right ephemeral widget zone is a dedicated `widget` window — content-sized, `transparent`, `decorations:false`, `alwaysOnTop:true`, and `visible:false` until a widget renders.

- **Click-through is a consequence of content-sizing, not cursor toggling.** Because the `widget` window is sized to its content, there is no window *outside* the widget bounds — clicks there land on the app underneath. No `setIgnoreCursorEvents` toggling is used.

- **Option A — single large window hosting the corner widget via CSS — rejected.** It would intercept clicks across its whole area and require fragile, platform-dependent regional cursor-event toggling.

- **Option C — resize/reposition the `main` window per render — rejected.** It breaks once input and a widget must be visible simultaneously (the persistent-widget case Decision p.2 anticipates with its "slightly persistent" + stacking corner zone).

- **Session ownership + relay.** The `main` window owns the live WebSocket session; it relays the picker primitive to the `widget` window and routes the user's pick/cancel back via intra-app Tauri events (`show-picker` / `picker-result` / `picker-cancel`). The frozen wire protocol (`packages/protocol`) and the daemon are untouched.

- **What this realizes.** The `widget` window renders the closed-set color-picker primitive from [[0005-ui-contract-closed-set]], and the pick/cancel round-trip resolves the underlying UI tool call per [[0002-ui-as-tool-calls]] (resolve = the user's pick, cancel = dismiss). This is the color-picker round-trip in chunk 02b-ii.

## Amendment 2026-06-01

**This is NOT a supersede.** This refines *how the top-right `widget` zone (Decision p.2) behaves on resolve*, and reaffirms cancel-reachability at the UX layer. It is **additive** to the two-zone model and does not touch the ephemeral-widget principle — the confirmation state introduced here is itself ephemeral (it auto-dismisses). The original Decision text and the 2026-05-31 amendment stand unchanged.

Surfaced by Lior's live macOS demo during Walking Skeleton v0 — Chunk 03 (2026-06-01); the integrated run revealed the overlay never *visibly* confirmed the pick (the completion status was being written to the already-hidden `main` window, so nothing was seen before the widget vanished) and that the cancel `×` was rendering off-screen (the `widget` window was hardcoded at `x:1500`). Decided by Lior the same day (chunk-03 plan, `## Reality check — REVISED` → "Decisions (Lior, 2026-06-01)", Q1=A and Q2=A). See [[../plans/walking-skeleton-v0-03-e2e-wiring/plan]] and [[../../chunks-todo/walking-skeleton-v0/03-end-to-end-wiring-and-demo]] (DoD line 25 requires the overlay to *visibly confirm the chosen color*).

- **Confirm-then-dismiss on resolve.** When the user picks a value, the `widget` window does **not** vanish immediately. It re-renders to a brief confirmation state showing the chosen value — the swatch the frontend already holds, e.g. `✓ Crimson  #DC143C` — lingers ~1200ms, then hides. This is what satisfies the chunk-03 DoD that the overlay "visibly confirms the chosen color"; the prior behavior hid the widget on result and wrote completion text to the hidden `main` window, so the user saw nothing.

- **Why the confirmation belongs in the `widget` zone, not the `main` zone.** Per the 2026-05-31 amendment the two zones are two windows; `main` (the input panel) is already hidden by the time a result lands. The resolved selection is content the user wants to *see*, and the top-right widget zone is the surface that is still on-screen at resolve time. Putting the confirmation anywhere in `main` is invisible by construction.

- **The confirmation state is ephemeral — this preserves, not breaks, the ephemeral-widget principle.** The confirmation is a terminal, auto-dismissing render of the same widget; it adds a short visible "settled" frame to the existing show→pick→hide lifecycle rather than introducing any persistent surface.

- **Cancel reachability (reaffirms [[0002-ui-as-tool-calls]] resolve/cancel) — Lior Q2=A, same date.** The widget's cancel control must be a **labeled, on-screen `× Cancel`** affordance — the `widget` window is **runtime right-anchored** (positioned from the display bounds at show time, not the hardcoded `x:1500` the demo exposed) so it is never clipped off the right edge — and is complemented by **Escape-to-cancel**. This is a UX-layer reaffirmation of the cancel half of the resolve/cancel contract in [[0002-ui-as-tool-calls]]; it adds no new wire semantics (`tool_cancel` is unchanged).

- **Scope boundary — overlay-only, frozen surfaces untouched.** Nothing here changes `packages/protocol` (the 6-variant envelope) or the daemon. Both behaviors are realized entirely in the overlay (`apps/overlay`), using the `picked` swatch and the `tool_cancel` path that already exist.

## Amendment 2026-06-03

**This is NOT a supersede; it is a REFINEMENT.** It refines *how the top-right `widget` zone (Decision p.2) manages the lifecycle of what it renders*, introducing an explicit **content-vs-transient dismiss policy**. It does **not** touch the activation hotkeys (2026-05-30), the two-window realization (2026-05-31), or the ephemeral picker confirmation (2026-06-01) — the picker confirmation **stays ephemeral (~1200ms auto-dismiss)**, exactly as the 2026-06-01 amendment requires. This amendment restores Decision p.2's original "slightly persistent" intent for the one surface that is *content the user reads*: the LLM text answer.

Surfaced by Lior post-llm-text-slice and decided 2026-06-03 (overlay-ux-pass; status-zone realization = Option A, confirmed by Lior). The `show_text` answer was being auto-hidden by the same ~1200ms timer that dismisses the picker confirmation (the `apps/overlay/src/main.ts` success branch), so multi-sentence replies vanished before they could be read. See [[../plans/overlay-ux-pass/plan]] (chunks 01/02/03).

- **Dismiss policy — the rule of three.** The `widget` zone classifies everything it renders into exactly three dismiss behaviors, made explicit in the renderer:
  - **`content`** (the LLM `show_text` answer) — **persists until the user dismisses it.** Dismissals are **Escape**, **a new request** (the next `session_start` / hotkey-submit replaces it), and an **on-card `× Close`** — display-only content is *closed*, not *cancelled*, using the same labeled-control style the 2026-06-01 amendment requires for the picker's `× Cancel`. **No timer ever auto-hides content.**
  - **`status`** (thinking loader, error, timeout, cancelled) — **timed auto-dismiss.** The thinking loader is replaced when content/picker arrives; an error lingers ~2s then auto-dismisses; a handshake-timeout shows a friendly "taking too long" card (~2.5s, not a bare error — see the loader point below); cancelled shows a brief card (~1.2s). Status never auto-hides content that is still on screen.
  - **`picker-confirm`** (the `✓ Name #HEX` confirmation) — **auto-dismisses ~1200ms**, unchanged from the 2026-06-01 amendment.

- **Dedicated status surface = a render *mode* of the existing `widget` window, NOT a third window (Option A, Lior 2026-06-03).** The 2026-05-31 amendment settled on **two windows** and rejected both "single large window" (its Option A) and "resize `main` per render" (its Option C). This amendment keeps the two windows: the `widget` window renders one mode at a time (`loader` | `text` | `picker` | `status` | `confirmation`). Status moves **out from under the input** — where it was invisible, written to the already-hidden `main` window — into this zone. A third dedicated status window was considered and **rejected** to preserve the two-window model and avoid a new window's positioning/focus/click-through/capabilities cost; loader→content→status are sequential within a single session and never need to coexist (a new session dismisses the prior answer first), so one window with modes suffices.

- **The thinking loader is frontend-only.** The overlay infers "in-flight" from "`session_start` sent, no `tool_call` yet" — observed via a new frontend `onSessionStart` callback on `runSession`. **No wire/progress signal, no protocol change.** When generation exceeds the handshake timeout (gotcha #42), the loader is replaced by a friendly **`timeout`** status ("the model is taking too long"), not a raw error — distinguishing a slow model from a genuine failure. Rendering the model's partial output while it thinks (streaming) is explicitly deferred; it needs a daemon/wire progress signal (gotchas #1/#43).

- **Scope boundary — overlay-only, frozen surfaces untouched.** Nothing here changes `packages/protocol` (the 6-variant envelope) or the daemon. This per-session transient overlay status zone is **distinct from** the global daemon tray/menubar status indicator (Decision p.4, running/idle/error) — complementary surfaces, not the same; the tray remains deferred.

## Related

- [[0002-ui-as-tool-calls]] — the UI-as-tool-call model whose resolve/cancel the widget round-trip fulfills (see Amendments 2026-05-31 and 2026-06-01; the latter reaffirms the cancel half at the UX layer)
- [[0005-ui-contract-closed-set]] — the closed-set color-picker primitive rendered in the `widget` window (see Amendment 2026-05-31)
- [[0007-voice-mvp-strategy]] — what hold-to-talk actually does for input
- [[../concept]] — UX surface is part of differentiation pillar 1
- [[../architecture]] — frontends in system context
- [[../plans/walking-skeleton-v0-02b-i-tauri-shell/plan]] — Walking Skeleton v0 Chunk 02b-i; source of the 2026-05-30 amendment that pins the default tap-hotkey
- [[../plans/walking-skeleton-v0-02b-ii-color-picker/plan]] — Walking Skeleton v0 Chunk 02b-ii; source of the 2026-05-31 amendment that pins the two-window zone realization
- [[../plans/walking-skeleton-v0-03-e2e-wiring/plan]] — Walking Skeleton v0 Chunk 03; source of the 2026-06-01 amendment (confirm-then-dismiss on resolve + cancel reachability)
- [[../plans/overlay-ux-pass/plan]] — overlay UX pass (chunks 01/02/03); source of the 2026-06-03 amendment (content-persist + dedicated status zone + dismiss-policy)
- [[../../chunks-todo/walking-skeleton-v0/02b-i-tauri-shell-and-hotkey]] — the chunk whose planning pinned the default tap-hotkey
- [[../../chunks-todo/walking-skeleton-v0/03-end-to-end-wiring-and-demo]] — the chunk whose macOS demo (DoD line 25) surfaced the 2026-06-01 amendment
