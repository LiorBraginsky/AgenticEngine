---
title: Roadmap
status: living-document
last-major-update: 2026-05-30
tags: [roadmap, milestones]
---

# Roadmap

## MVP Definition

> [TODO: Lior — define what "MVP done" means for you. This is the single most important line in this doc.]
>
> **My proposed framings (pick or write your own):**
>
> - **Personal-utility MVP:** "I personally use it daily for a week for at least one workflow that doesn't exist elsewhere."
> - **Demo MVP:** "I can show a friend a 60-second demo, they say wow, and they ask to install it."
> - **Ecosystem MVP:** "A third party (not me) writes a working plugin and it runs in my engine."
> - **Ritual MVP:** "I have at least one cron-triggered ritual that genuinely saves me time."
>
> Each implies a different feature priority. Pick one as the primary success metric.

---

## Phase 0: Concept lock-in (current)

**Goal:** Documented architecture, ready for build.

- [x] Grilling session through all major architectural decisions
- [x] 7 ADRs captured
- [x] Vision, concept, architecture docs
- [ ] [TODO: Lior — fill in remaining open questions in [[open-questions]] over time]
- [ ] First pass of UI primitives list (deferred — only when implementation starts)
- [ ] LLM provider strategy decided (single-provider Anthropic, or multi via Vercel AI SDK?)
- [ ] Plugin distribution strategy decided (npm? own registry? bundled?)

---

## Walking Skeleton v0 — first build milestone

> **Decided 2026-05-30.** This is the first thing we build, *before* completing Phase 1 (backend) and Phase 2 (frontend) as full capability areas.

**Approach — thin vertical slice.** Instead of building the whole backend first and CLI-testing it in isolation, we cut a **walking skeleton** (Alistair Cockburn): the narrowest possible path through *every* layer that produces a **visible** result on real macOS. This validates the core concept — *voice/text in, widget out* — end-to-end, which a CLI protocol test cannot do (no visible widget = no validation of what makes the product unique).

**Why Tauri-first** (not browser-first, not native Swift) — see [[0006-dual-hotkey-2zone-ux]] (macOS overlay = primary) and [[0003-local-daemon-ws-architecture]] (multi-frontend over one daemon):

- Tauri = Rust shell + **system webview**. The renderer (widgets) is identical to a browser; only the *shell* differs (native window, global hotkey, OS permissions). The protocol is plain WS+JSON — it speaks to a browser and a Tauri webview identically, so there are no "browser-isms" leaking into the protocol.
- **Browser-first** was rejected: it trains the wrong UX muscle ("just another tab") instead of the native-OS-layer feel that defines the product.
- **Native Swift** was rejected for now: it locks both renderer and shell into Apple with no portable renderer. Tauri gives macOS-first feel *now* + a cross-platform renderer essentially for free; the OS-shell layer is per-platform in any stack anyway. Native Swift overlay stays **post-v1**; deep OS integration (Accessibility, screen context) can be added later via a Swift sidecar without rewriting the product.

**The slice (thin, end-to-end):**

- [ ] Daemon: Bun + WebSocket on `localhost:7777` (minimal)
- [ ] Wire protocol v0 (Zod): `session_start`, `tool_call`, `tool_result`, `session_end`
- [ ] Mock agent loop: hard-coded "find a color" → `show_color_picker` → user picks → `session_end{completed}`. (The agent "fun fact" is computed and **logged daemon-side only** — Option A, ADR-0002-preserving; it is NOT a wire message in v0. A spoken/`show_text` reply is a Phase-2 increment, added as a TOOL, never as a 7th envelope variant. See chunk-02a plan, Jimmy's ruling 2026-05-30.)
- [ ] Minimal Tauri overlay shell + global hotkey (tap-to-open input panel)
- [ ] One UI primitive: `color-picker`, rendered in the Tauri webview
- [ ] Wire end-to-end: hotkey → input → mock agent → picker → selection → visible result

**Definition of done:** Lior presses a global hotkey, types "pick a color", a real color-picker widget appears in a native macOS overlay, clicks a color, and the **widget confirms the chosen color** (the `picked` swatch the overlay already holds) — all driven by the (mocked) agent loop over the real WS protocol. The visible v0 result is the picker confirming the selection; the agent fun-fact is logged daemon-side only (Option A), not rendered as wire text.

**Web admin tab** (settings / plugin management, per [[0003-local-daemon-ws-architecture]]) comes as a *separate later chunk* — a parallel frontend, not a replacement.

> Phases 1 and 2 below remain as **capability areas** (the complete backend and the complete frontend). The walking skeleton cuts a thin slice through both first; the remaining items in each phase are filled in afterward. **No new ADR needed** — this is a planning approach (walking-skeleton-first), not an architectural decision, and it is consistent with ADRs 0001–0008.

---

## Phase 1: Engine skeleton

**Goal:** Daemon runs, exposes WebSocket, executes a single hard-coded UI tool, returns result. No real LLM yet.

- [ ] Daemon process: Bun + TypeScript boilerplate, launchd plist
- [ ] WebSocket server on `localhost:7777`
- [ ] Wire protocol v0: messages for `tool_call`, `tool_result`, `session_start`, `session_end`
- [ ] Tool registry (in-memory, hard-coded with one demo tool)
- [ ] Mock LLM loop: hard-coded "ask color, then echo back"
- [ ] CLI test harness for protocol verification (no UI yet)

**Definition of done:** A node script can connect to the daemon, send a "start session" message, and observe the simulated agent calling `show_color_picker`, then sending back a chosen color, and the session closing.

---

## Phase 2: First frontend (macOS overlay)

**Goal:** A real, usable frontend rendering real widgets.

- [ ] Tauri shell with frameless transparent window
- [ ] Global hotkey registration (text-mode: tap to open input panel)
- [ ] Input panel UI (centered, Spotlight-style)
- [ ] WebSocket client, connected to daemon
- [ ] First 5 UI primitives implemented: `text`, `button`, `input`, `color-picker`, `image`
- [ ] Widget container: top-right ephemeral panel with stack-of-3

**Definition of done:** Lior can press a hotkey, type "pick a color from red/blue/green", and a real widget appears, click works, result is logged.

---

## Phase 3: Real LLM integration

**Goal:** Replace the mock loop with a real Anthropic Claude reasoning loop.

- [ ] Anthropic SDK integration
- [ ] Tool calling wired through (UI tools + at least one backend tool: `web_search`)
- [ ] Streaming token-by-token responses to frontend (for visible "thinking")
- [ ] Cancellation handling (user closes widget mid-flow)
- [ ] Error handling: LLM timeout, tool failure, malformed responses

**Definition of done:** Real agentic conversation working end-to-end. Lior asks something useful, agent reasons, calls tools, presents widget, gets answer.

---

## Phase 4: Voice + push-to-talk

**Goal:** Voice-in works.

- [ ] Second hotkey: hold-to-talk
- [ ] Cloud Whisper integration (OpenAI API)
- [ ] Audio capture (Tauri media APIs)
- [ ] Onboarding wizard: first-launch flow asking for STT preference (cloud vs local)
- [ ] (Optional opt-in) Local Whisper-small download flow

**Definition of done:** Lior holds the hotkey, says something, releases, and the agent responds correctly.

---

## Phase 5: Plugin system

**Goal:** Plugins can be installed and contribute tools + widgets.

- [ ] Plugin manifest spec (`agentic-engine` field in `package.json`)
- [ ] Plugin loader on daemon startup
- [ ] MCP integration for backend tools
- [ ] First-party "reference plugin" (probably weather or filesystem)
- [ ] Plugin management UI in web admin tab

**Definition of done:** A separate npm package can be installed and its tools/widgets are usable in the engine.

---

## Phase 6: Rituals

**Goal:** Cron-style triggers programmable from voice.

- [ ] `create_ritual` meta-tool
- [ ] Ritual storage (yaml files in `~/.agentic-engine/rituals/`)
- [ ] Cron scheduler in daemon
- [ ] Ritual management UI in web admin tab
- [ ] Inbound trigger protocol — sessions started from cron, not user

**Definition of done:** Lior says "every morning at 8am, brief me on the weather", and 24 hours later the morning brief appears.

---

## Phase 7: First public release

**Goal:** Other people can install and use it.

- [ ] Installer (`brew install agentic-engine`)
- [ ] Onboarding flow polish
- [ ] Documentation site (built from `docs/` markdown)
- [ ] Plugin SDK + authoring guide
- [ ] First public plugin showcase (3-5 plugins)
- [ ] Crash reporting + telemetry (opt-in only)

**Definition of done:** Someone outside Lior's circle installs it, uses it for a week, doesn't uninstall.

---

## Post-v1 (themes, not committed)

- Native macOS Swift overlay
- Windows / Linux frontends
- Cloud sync (opt-in)
- Multi-user / shared rituals
- iOS companion app (requires hybrid cloud architecture)
- Plugin marketplace + monetization
- Voice TTS (Jarvis-style voice-out)
- End-user plugin creation via `create_plugin` meta-tool
- Local LLM (Ollama / llama.cpp) support

---

## Related

- [[vision]] — the north star this roadmap pursues
- [[concept]] — features grouped by differentiation pillar
- [[open-questions]] — what blocks which phase
