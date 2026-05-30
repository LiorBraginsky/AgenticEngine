---
title: Glossary
status: proposed
last-major-update: 2026-05-25
tags: [glossary, terminology]
---

# Glossary

The **language of AgenticEngine**. Every term here is a load-bearing piece of vocabulary — if it drifts, the whole codebase drifts with it.

> [TODO: Lior — review each term below. For each, decide: **keep as-is** / **rename to ___** / **kill (don't use)**. The proposed names are my recommendations after the grilling. Once you sign off, this becomes the canonical reference.]

---

## Core actors

### **Engine** *(or rename: Core, Kernel, Brain, Hub)*

> *[TODO: Lior — keep "Engine"? It's in the product name. But "AgenticEngine engine" sounds awkward. Maybe "Core" for the runtime?]*

The local daemon process that runs the LLM loop, manages tools, executes rituals, and serves WebSocket connections. Singleton on the user's machine.

### **Frontend** *(or rename: Client, Host, Surface)*

> *[TODO: Lior — "Frontend" is fine but generic. "Host" is interesting because each frontend hosts a different mode (overlay, admin, CLI). Pick one.]*

A connected client that renders UI tool calls in its own native vocabulary. Multiple frontends can connect to one engine simultaneously. Examples: macOS overlay, web admin tab, CLI.

### **Daemon**

Synonym for Engine's process form. Use "Engine" when talking about behavior, "daemon" when talking about the process (launchd, restart, kill).

---

## Tools & UI

### **Tool**

A function callable by the agent. Two subcategories:

### **Backend Tool**

A tool that performs an action without involving the user: `web_search`, `read_file`, `send_email`. Synchronous (call → result). Spoken in MCP.

### **UI Tool**

A tool that asks the user something **through a generated UI widget**: `show_color_picker`, `show_form`. Asynchronous (call → user interacts → result). Spoken in AgenticEngine's own protocol.

> *[TODO: Lior — consider whether "UI Tool" is the right term. Alternative: "Surface", "Prompt-Tool", "Widget-Tool", "Ask". The term needs to be intuitive for plugin authors. Default: keep "UI Tool".]*

### **Meta Tool**

A special tool the engine offers to itself, like `create_plugin` or `create_ritual`. These are tools that **modify the engine's own capabilities**.

### **Widget**

The **rendered UI** that a UI tool produces. A widget has a lifecycle: open → user-interaction → close (or dismiss, or cancel). Widgets are ephemeral by design.

> *[TODO: Lior — "Widget" is fine but ambiguous (everyone uses it for everything). Alternative: "Card", "Tile", "Bubble", "Pane". Default: keep "Widget".]*

### **Primitive**

A **single UI building block** defined by the engine: `button`, `text`, `slider`, `image`. Plugins compose primitives to declare widget appearance. The set of primitives is closed; new ones added by minor version bumps to the engine.

---

## Plugins & extension

### **Plugin**

A bundle of tools + UI declarations + permissions, packaged as an npm package and registered with the engine. Sources can be: first-party (built-in), third-party (community-published), user-created (generated via `create_plugin` meta-tool).

### **Plugin Manifest**

The `agentic-engine` field in a plugin's `package.json`, declaring its tools, ui-tools, permissions, and minimum engine version.

---

## Interaction concepts

### **Session**

A **bounded streaming interaction** with the agent. Starts on user trigger (hotkey, voice) or inbound trigger (cron ritual). Ends on completion, cancellation, or timeout. Sessions have an ID. Long-term memory across sessions is post-MVP.

### **Ritual**

A **named, persistent, scheduled workflow** — a saved agentic flow triggered by cron. The user-facing name for "scheduled agent flow." Rituals are how the product accumulates value over time.

> *[TODO: Lior — "Ritual" is poetic but might be confusing. Alternatives: "Routine", "Recipe", "Flow", "Schedule", "Habit". Default: keep "Ritual" — it has emotional resonance and is search-distinct.]*

### **Inbound Trigger**

Any non-user-initiated start of a session — currently means "a ritual fired by cron." Future: webhook, system event, file change, etc.

### **Hotkey**

A keyboard shortcut that triggers the engine. AgenticEngine uses **two hotkeys**: tap-to-open-text-panel and hold-to-talk-voice.

---

## Architecture concepts

### **Protocol** *(or rename: Wire Protocol)*

The set of WebSocket messages spoken between engine and frontends. Versioned. See `orchestration/docs/protocol/` (forthcoming).

### **Reasoning Loop**

The core LLM-driven cycle: receive input → think → call tools → receive results → think more → respond. The "agentic" part of the engine.

### **Tool Registry**

The in-memory list of all tools known to the engine: backend tools, UI tools, meta tools. Populated at startup by scanning plugins.

---

## Conventions

When in doubt, follow these:

1. **Engine has tools, frontends render widgets.** Tools are server-side; widgets are client-side. Don't mix.
2. **"UI Tool" describes what the agent calls; "Widget" describes what the user sees.** They are two views of the same thing.
3. **Sessions are bounded; rituals are recurring.** A ritual fires sessions; a session never becomes a ritual.

---

## Related

- [[concept]] — these terms in product context
- [[architecture]] — these terms in system context
