---
title: Concept & Product Thesis
status: stable
last-major-update: 2026-05-25
tags: [concept, positioning, strategy]
---

# Concept & Product Thesis

## The pain we treat

Chat is the **lowest-bandwidth interface** for AI we could have invented. When an agent asks "what color are you looking for?", the natural human response is **to point at a color**, not to type "dark navy blue with a slight violet undertone, like an evening sky."

Today's AI products force the user to translate intent into prose, then translate prose responses back into action. **AgenticEngine inverts this**: the agent generates the right interface for the question, the user performs the action directly, and the result is structured data the agent can use without natural-language parsing.

This unlocks an entirely new texture of interaction — fluid, fast, low-cognitive-load — that chat fundamentally cannot replicate.

---

## Product thesis

> **"Voice in, widgets out."**
>
> AgenticEngine is the local AI agent platform where:
>
> 1. The user invokes by voice or hotkey.
> 2. The agent reasons, calls tools, and asks the user **through generated UI widgets**, not paragraphs.
> 3. The widgets live as **ephemeral micro-windows** in the OS overlay — not in a chat tab.
> 4. Plugins extend both **what the agent can do** (tools) **and how it presents results** (widgets).
> 5. Recurring workflows become **rituals** — programmable cron-style triggers.

---

## Five pillars of differentiation

These are the five structural reasons AgenticEngine is **not a wrapper** around ChatGPT/Claude.

### Pillar 1: Voice in, widgets out

The mechanism. Voice (or quick text) is the **input** channel; **interactive UI widgets are the output**. Reading or listening is fallback.

**Why this is structurally different:**
- Chat returns scrollable text. We return tappable UI.
- Jarvis returns voice. We return UI you can see across the room and engage on your own pace.
- Apple/Google assistants embed in their own pop-ups. We are pluggable, customizable, and yours.

**What this enables:**
- Speed: you tap a color, not type a hex code.
- Composition: multiple widgets can coexist on screen.
- Glanceability: peripheral widgets in the corner don't demand your full attention.

### Pillar 2: Plugins ship widgets, not just functions

The moat. In every existing agent ecosystem (ChatGPT plugins, MCP servers, OpenAI Apps SDK), plugins extend the **tool list** but the **UI is generic**. Search results look like search results everywhere.

In AgenticEngine, a plugin like `agentic-plugin-spotify` ships:

- **Backend tools:** `play_track`, `search_album`, `get_playlist` (standard MCP-style).
- **UI tools:** `show_now_playing`, `show_album_card`, `show_playlist_picker` (declared widget descriptions).
- **Reasoning hints:** when to use which UI for which intent.

When the user says "play Daft Punk Discovery," the response is not text "playing now" — it's a **mini-player widget** with controls. Music plugins look like music. Calendar plugins look like calendar. The UX vocabulary expands with the ecosystem.

**This is the architectural moat:** copying it requires re-engineering the protocol, not adding features.

### Pillar 3: Programmable rituals

The retention engine. Single queries get answered and forgotten. **Rituals** — recurring agentic flows — give the agent ongoing presence in the user's life.

**Example rituals:**
- "Every morning at 8am, check weather, check my calendar, show me one widget."
- "Every Friday at 5pm, summarize what I worked on this week."
- "When I get an email from my landlord, surface it as a top-right notification."

Rituals are:
- **Voice-programmable:** declared in natural language, the agent generates the underlying cron + flow.
- **Persistent:** they survive engine restarts, edits, exports.
- **Shareable:** like dotfiles, you can publish a `.ritual` file someone else can install.

This makes the agent **part of your environment**, not a tab you visit.

### Pillar 4: End-user plugin creation

The democratization layer. Users with no engineering background can say:

> *"Create a plugin that tracks my running splits in a CSV and shows me a chart at the end of each run."*

The agent has a built-in meta-tool `create_plugin(description)` which:
1. Generates plugin code (via embedded code-generation sub-agent),
2. Tests it in a sandbox,
3. Registers it in the user's local plugin registry.

The user doesn't write code — they describe outcomes. The agent writes code on their behalf.

**This is what closes the loop:** the ecosystem is not gated by "who knows TypeScript." Anyone can extend the platform.

### Pillar 5: Plugins are a marketplace for AI-powered services

The economic moat. AgenticEngine is a **two-sided platform**:

- **Side A (end-users)** install plugins and consume services.
- **Side B (SaaS providers)** ship paid mini-SaaS as plugins, gaining distribution into desktop workflows without building their own AI UX.

Concretely: a SaaS provider that parses medical certificates can ship `agentic-plugin-medscan`. The user installs it, supplies their API key (during MVP), and from that point on, says "parse my latest lab results" — and the agent calls the SaaS, gets structured data, renders a widget. No browser switch. No "upload here, download there." The service comes to the user's workflow, not vice versa.

**This unlocks a new distribution channel:**

- Free plugins (open-source utilities, hobby projects) and paid plugins (commercial mini-SaaS) coexist via a `pricing` field in the manifest.
- The platform handles auth, permissions, billing facilitation; the provider focuses on their service.
- Distribution becomes "ship a plugin" instead of "build a website + marketing funnel + AI UX from scratch."

**This is structurally different from:**
- ChatGPT plugins (closed marketplace, OpenAI-controlled, no UI customization).
- npm packages (no billing, no auth, no UI-tool primitives).
- Browser extensions (no agentic orchestration, no shared LLM context).

**Why this is the strongest moat:** copying the technical mechanism is hard. Copying the **two-sided economy with locked-in providers** is significantly harder. Network effects emerge once the second 100 plugins arrive.

#### Plugin complexity spectrum

Not all plugins look the same. The architecture supports a spectrum:

| Type | Example | Heavy lifting | UI |
|------|---------|---------------|-----|
| **Trivial** | `agentic-plugin-quick-search` | Calls built-in `web_search`, returns text | Single `markdown` primitive |
| **Lightweight** | `agentic-plugin-weather` | Calls free weather API | Composed primitives (`text`, `chart`) |
| **Standard** | `agentic-plugin-spotify` | OAuth + own API | Multiple widgets (player, album, queue) |
| **Mini-SaaS** | `agentic-plugin-medscan` | Hosted MCP server, paid API | Domain-specific widgets (doc detail, history view) |
| **Complex (post-MVP)** | `agentic-plugin-figma` | May need its own embedded web view (Electron-style WebView) for design surfaces | Custom rendered area through `custom_content` escape hatch |

The "complex" tier — where a plugin might need a full embedded web view — is **explicitly out of scope for MVP**, but the architecture's `custom_content` primitive ([[adr/0005-ui-contract-closed-set]]) leaves the door open for it later.

---

## What we are NOT

| Not this | Because |
|----------|---------|
| Another chat app | The chat surface is the very thing we're replacing. |
| A Raycast clone | Raycast is keyboard-driven command palette. We are conversational. |
| A voice assistant (Siri/Alexa style) | Voice is input; the moat is in the visual response, not speech generation. |
| A cloud SaaS | Engine runs locally. Privacy and latency depend on it. |
| A walled garden | Plugin ecosystem and protocols are open. Lock-in is the failure mode. |
| A general-purpose chatbot | We focus on **agentic action** + structured UI, not philosophy or casual chat. |

---

## Target user, in one sentence

> The person who already extends their tools and is tired of context-switching to AI tabs.

If you have Raycast extensions, write Shortcuts, use Obsidian plugins, customize VS Code — you are the user.

---

## Related

- [[vision]] — the north star
- [[architecture]] — how this thesis becomes software
- [[adr/0001-interaction-pattern]] — streaming session decision
- [[adr/0002-ui-as-tool-calls]] — UI mechanism decision
