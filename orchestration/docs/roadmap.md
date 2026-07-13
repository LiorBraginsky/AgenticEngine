---
title: Roadmap
status: living-document
last-major-update: 2026-06-04
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

## Conversation & Interaction Model — north-star + route (locked 2026-06-04)

> **Post-v0 status:** Walking Skeleton v0, the **LLM text-reply slice** (real Claude, ADR-0009/0010/0011), and an **overlay UX pass** (persistent text, status zone, widget resize) have all shipped. This section sets the **stable interaction north-star** the next work aims at — it refines *how* Phases 2–4 below realize interaction. Decisions are recorded in **[[adr/0012-conversation-and-memory-model]]**; behavioral + prior-art rationale lives in project memory (conversational-interaction-model, prior-art-findings).

**North-star — "one agent, talked to two ways, that remembers":**
- ONE agent; the user always talks only to it.
- **Dual-modality input is FIRM and co-equal: voice + text** — both unified underneath as "add a turn to a thread" (one behavioral contract, two affordances).
- Output = ephemeral **widgets, not a chat log**. Agent paradigm, not chatbot.
- **Memory = a persistent "super-chat":** each conversation is a **thread** that distills into the super-chat; new threads draw on it. Within-thread = multi-turn; cross-thread continuity = the super-chat.

**Locked decisions** (→ [[adr/0012-conversation-and-memory-model]]): dual-modality co-equal · agent-paradigm (widgets out) · memory = super-chat, user interacts only via threads · within-thread multi-turn / cross-thread = super-chat. **Memory transparency (non-negotiable):** invisible *by default*, BUT a **view/edit/forget escape-hatch + provenance/expiry tags + security-scanned writes + no silent overwrite of human entries**, built from day one (default-hidden). An opaque always-injecting memory is the category's #1 churn driver *and* a poisoning surface that chains with the CSWSH gap (known-gotcha #31).

**The route (big parts, ordered — not all at once):**
1. **Memory foundation** — super-chat + thread model (within-thread multi-turn now; cross-thread distillation as it matures) + the transparency hatch. Two stores (uncapped archive + small distilled slice); SQLite + files first, vector/graph as a swappable provider. **Chunk-1; everything depends on it.**
2. **Text continuation affordance** — lightweight add-a-turn to the live thread, widgets out, **not a persistent chat box**. Exact affordance (inline "Live Card" vs re-summoned "Continuation Pill") decided at build, per the interaction research.
3. **Voice parity** — voice as a co-equal turn (open-mic continuation; refines Phase 4), designed as a primary driver, not bolted on.
4. **Richer widget output** — beyond text (compare-tables, etc.; closed-set primitives, ADR-0005 open-question Q2).
5. **Concurrent threads + background** ([[known-gotchas]] #45) — multiple live threads, long/background tasks. Later.

**Memory follow-ons — FIRMLY QUEUED (Lior, 2026-06-12; immediate-next after memory-quality, not "someday"):**
- **2c — Agent memory-action tools (the conversational forget lever).** The agent can ACT on its memory mid-conversation — "forget X" *actually forgets* (wires to the existing `Hatch.forget`/`forgetFact`), not just says it did. New capability class: the agent gets **action tools** (side-effecting), distinct from UI-render tools → an **ADR-0002/0005 extension** + a security/poisoning surface (ADR-0012 5d; re-touches the just-locked memory-write path) → needs its **own design+ADR pass**. Also the committed path to making fact-forget stick in practice without deleting history (spec [[specs/2026-06-12-memory-quality]] §4).
- **2d — On-demand archive retrieval (the agent searches its memory).** When a fact isn't in the distilled slice, the agent searches the archive on demand. First cut = **SQLite FTS5** keyword search (no new model/embedding dependency); **semantic/vector retrieval = a swappable provider upgrade** — exactly the ADR-0012 decision-6 posture. Same agent-action-tool surface as 2c.
- **2c + 2d SHARE one design+ADR pass** — "agent action-tools over memory" (the ADR-0002/0005 closed-set extension: an agent tool that performs a memory action with a side-effect, distinct from a UI-render tool). That pass is the next ceremony once the memory-quality build is underway.
- **2e — Content-forget = THREAD-forget (the future content-erase primitive).** Surfaced by the **memory-distiller-v2** pivot (2026-06-13): v2 makes the user-facing forget **fact-forget ONLY** (durable delete of a stable-id fact) and **drops the per-message message-forget user path** + option B (the `WriteGate` hard-scrub **primitive is retained** for this). The way a user erases *content* (not just a derived fact) becomes **forgetting a whole conversation** — scrub its messages (reuse the kept primitive) + delete its facts (`dropDistilledFactsForThread`) — **simpler than per-message and matches "user interacts with THREADS"** ([[adr/0012-conversation-and-memory-model]]). **Pairs naturally with 2d** (a forgotten topic could otherwise resurface via message-search). NOT built in v2 — recorded in [[specs/2026-06-13-memory-distiller-v2]] §3.6/§1; its own feature.

**Security hardening pass (near-term, before any non-dev release):** un-defer the per-install WS token + all secrets in the OS Keychain + bind 127.0.0.1-only + untrusted-by-default plugin/MCP supply chain. Executes the already-decided token (ADR-0003 p.5; only timing was deferred); maps to known-gotchas #31/#35/#38. Prior-art-verified as the highest-leverage, lowest-risk security move.

**Bounded-open (resolve at the relevant part):** exact text reply affordance · voice↔text mixing within one thread · discoverability of the reply affordance · distillation mechanics (when/how a thread consolidates; retrieval/scoping/privacy) · **external/third-party rich-widget rendering** (Spotify/weather mini-apps *not* built from our primitives — [[open-questions]] Q11; A2UI / sandboxed-mini-app candidates; ADR-0005's `custom_content` is the weak current answer). *(A2UI is **not** adopted for our **own** primitives — ADR-0005 covers those natively — but it stays a live candidate for the external case.)*

> **Reuse note (answers "won't I lose competitors' ecosystem?"):** integration breadth = the open **MCP** commons + the open **SKILL.md** standard, NOT competitors' proprietary skill catalogs. Reuse = point at the same MCP servers (and competitors can be mounted as MCP servers). **Caveat:** MCP is decided (ADR-0004) but **not yet built** — this is roadmap, not a current capability.

> **Non-goal — "self-improvement" is NOT a separate feature/chunk.** The felt "it gets better over time" is **emergent**, not something to build directly: ~80% comes from **memory done well** (ADR-0012 — personalization + preference-application; the provenance/expiry/no-silent-overwrite hygiene is exactly what makes improvement *healthy* rather than compounding-wrong), and the "notice a repeated pattern → automate it" part is **Phase 6 Rituals + a proactivity layer**. **Do NOT build a "self-improvement" chunk.** (Outcome/procedural learning — learning from failures to change *approach* — is a far-later, research-heavy step, never under this marketing banner. "Agent rewrites its own code/prompts" = marketing frontier + overlaps [[open-questions]] Q12.)

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

## Memory — next (after memory-distiller-v2, shipped 2026-06-16)

> **Full structured backlog (single source of truth): [[memory-backlog]]** (`docs/memory-backlog.md`) —
> grouped themes, deferral reasons, ruled-out items, open cases, and the vision anchor. The summary
> below is the high-level view.

> **Theme A — in-overlay memory transparency & control — SHIPPED 2026-07-10.** The
> `memory-transparency-ui` feature (chunks 01–05 + Lior's joint §6.1 live demo) delivered the
> day-one transparency mandate in the overlay: tray entry point (ADR-0006 p.4 un-deferred), threads/
> facts VIEW with per-fact provenance, distilled-fact-text EDIT (durable human badge) + message
> correction, "release the reference" FORGET, and honest locked/daemon-down states (+ `history.html`
> fallback tails). Spec `specs/archive/2026-07-02-memory-transparency-ui.md` (implemented). **Queue
> now: in-answer provenance-affordance design task → 2d (hybrid).** (chunk-05 D1 dedup fix merged 2026-07-13 — 2c closed.)

> **2c — agent memory-action tools (conversational forget/remember) — SHIPPED + CLOSED 2026-07-13.**
> The agent now ACTS on memory mid-conversation via `memory_forget` /
> `memory_remember` tool calls (daemon-internal action-tool plane, ADR-0016) with the 5d poisoning
> guardrails, the capability-conditional honest self-concept, durable audit events, and a render-only
> Memory-window audit trail. **Lior's live §6.1 demo SIGNED 2026-07-13 (§5 items 1–5 all PASS).** The
> one in-feature defect (D1 case-duplicate — one statement ⇒ 2 facts) was fixed in **chunk-05** — root
> cause was **canonical-language divergence** (tool path stores a user-language canonical; distiller
> stores an English one → the same statement never deduped), *not* case-sensitivity; the fix adds the
> user-language display-text dedup axis. **2c formally closed: spec accepted→implemented (chunk-05
> merged).** Two observations (O2 injection-blob reply quality; O3 replace-steering miss =
> degradation-not-corruption) are recorded in [[memory-backlog]] §B/§E. Spec
> `specs/archive/2026-07-10-memory-action-tools.md` (implemented).

`memory-distiller-v2` shipped the incremental distiller: per-turn cross-thread fact injection,
durable forget-by-id, suppress-only dedup, stable replace-on-change, and a single-user "all-facts
candidate pool" (BM25 retained only as the above-cap fallback). The remaining memory work, in
rough priority:

- **2c — agent memory-action tools** — ✅ **SHIPPED + CLOSED 2026-07-13 (see the callout
  above).** A conversational forget/recall lever — the agent ACTS on memory via tool-use ("forget X"
  actually forgets), not only passive injection. Shipped as the daemon-internal action-tool plane
  (ADR-0016) + the 5d poisoning-guardrail package. **chunk-05 (D1 case-duplicate dedup fix) merged —
  spec implemented, folder drained.**
- **In-answer "where did this come from?" provenance-affordance design task** *(carved out of
  Theme A, Lior 2026-07-02)*. Weigh dragging fact→thread linkage through live agent answers (UX
  overcomplication concern). ⚠️ ADR-0012 5a names it MANDATORY — a recorded deliberate revisit, not
  a drop; the design task owns reconciling with (or amending) ADR-0012.
- **2d — on-demand archive retrieval + HYBRID candidate-fetch (BM25 + embeddings).** The proper
  cross-language / reworded retrieval. **Lior direction 2026-07-10: HYBRID (lexical BM25 + semantic
  embeddings), not embeddings-only** — so exact-term and reworded/cross-language matches both land.
  **Supersedes BOTH plain BM25 AND the all-facts-below-cap stopgap** once the fact corpus outgrows
  "pass them all to the distiller." The cross-language BM25 miss it replaces was the root of the
  demo-3 duplicate-colour defect (and the accepted-as-known v2 dedup ceiling; Ukrainian tail vs
  English canonical).
- **Variant B — distilled facts rendered into the SYSTEM prompt** (instead of `[remembered]`
  user-messages). Architecturally cleaner per-turn injection; pairs naturally with 2c/2d. Considered
  and deferred in v2-08 (the `[remembered]`-as-messages format is load-bearing across system-prompt +
  provenance-stamp + tests — too big a rewrite for the recall fix; variant A shipped instead).
- **thread-forget** — a content-erase primitive (reuses the dormant `WriteGate` scrub); the
  successor to the dropped message-forget (ADR-0015 decision 5 superseded).
- **Finer (message-level) provenance** — deferred from v2-06; better "dig deeper" + forget
  granularity than the current thread-level provenance.
- **Archive-summarization tier** — the O(archive) scaling trigger; also the point at which the
  candidate-fetch flips from all-facts → semantic (2d).
- **Recall-usage quality (A′ tail)** — the structural cause (turn-2+ fact loss) was fixed in v2-08;
  the residual is the LLM-fuzzy tail (the model occasionally not using an injected fact). Asymptotic;
  2c (tool-based recall) is the lever — **now LIVE (shipped 2026-07-13)**, re-measurable against the
  real tool path. Fresh datapoint **O2** (2c live demo): a large incoherent injection blob degraded
  the reply to a greeting non-sequitur (the defense held), an answer/prompt-quality signal on this
  tail ([[memory-backlog]] §B / open-case #3).

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
- **"Do work" / long-running coding-agent tasks** ([[open-questions]] Q12) — a **background-task tier** (gotcha #45) driven from the overlay command surface, via MCP work-tools + **sandboxing**; explicitly NOT a pivot to a coding agent (moat = the surface, not capability). Differentiated entry = kick off by voice/overlay command + glance progress. Don't close the door (MCP + agent-port + #45 accommodate it); don't build yet.

---

## Related

- [[vision]] — the north star this roadmap pursues
- [[concept]] — features grouped by differentiation pillar
- [[open-questions]] — what blocks which phase
