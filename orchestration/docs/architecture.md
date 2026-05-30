---
title: Architecture Overview
status: living-document
last-major-update: 2026-05-25
tags: [architecture, system-design]
---

# Architecture Overview

This document captures the **high-level shape** of AgenticEngine. Detailed protocol specs, primitive definitions, and plugin authoring are in dedicated docs (forthcoming).

For per-decision reasoning, see ADRs.

---

## System diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                       USER'S MACHINE                                 │
│                                                                      │
│   ┌──────────────────────────────────────────────────┐               │
│   │             AgenticEngine Daemon                  │               │
│   │             (TypeScript on Bun)                   │               │
│   │                                                   │               │
│   │  ┌────────────┐  ┌──────────────┐  ┌───────────┐ │               │
│   │  │ LLM Client │  │ Tool Registry│  │  Session  │ │               │
│   │  │ (Anthropic │  │              │  │  Manager  │ │               │
│   │  │  /OpenAI)  │  │ - MCP tools  │  │           │ │               │
│   │  └─────┬──────┘  │ - UI tools   │  └───────────┘ │               │
│   │        │         │ - Meta tools │                 │               │
│   │  ┌─────▼──────┐  └──────────────┘  ┌───────────┐ │               │
│   │  │  Reasoning │                    │   Cron    │ │               │
│   │  │    Loop    │                    │  Scheduler│ │               │
│   │  └────────────┘                    │ (Rituals) │ │               │
│   │                                    └───────────┘ │               │
│   │            WebSocket on localhost:7777            │               │
│   └────────────────────────────┬──────────────────────┘               │
│                                │                                      │
│         ┌──────────────────────┼──────────────────────┐               │
│         ▼                      ▼                      ▼               │
│  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐         │
│  │   macOS     │       │  Web admin  │       │     CLI     │         │
│  │  Overlay    │       │     tab     │       │   client    │         │
│  │  (Tauri)    │       │ (localhost) │       │  (future)   │         │
│  │             │       │             │       │             │         │
│  │ - Hotkey    │       │ - Settings  │       │             │         │
│  │ - Input     │       │ - Plugins   │       │             │         │
│  │   panel     │       │ - History   │       │             │         │
│  │ - Widgets   │       │ - Cron mgmt │       │             │         │
│  │ - Voice STT │       │ - Devtools  │       │             │         │
│  └─────────────┘       └─────────────┘       └─────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

External services (optional):
  - OpenAI Whisper API (STT) — for cloud transcription
  - Anthropic / OpenAI LLM APIs — for reasoning
  - Third-party MCP servers (GitHub, Slack, Filesystem, ...) — for tools
```

---

## Key components

### 1. **Engine Daemon** (core process)

- **Runtime:** TypeScript on Bun. See [[adr/0004-typescript-bun-mcp]].
- **Lifecycle:** Long-running daemon, started by `launchd` on macOS, on-demand activation.
- **State:** In-memory session state + persistent plugin registry + persistent rituals.
- **Transport:** WebSocket server on `localhost:7777`. See [[adr/0003-local-daemon-ws-architecture]].

The daemon **owns**:
- The LLM client(s).
- The tool registry (backend tools via MCP + UI tools native).
- Active session state for in-progress streaming sessions.
- The cron scheduler that fires ritual triggers.

The daemon **does NOT own** any UI rendering — it only emits tool-call events.

### 2. **Tool Registry**

Two categories, unified interface:

**Backend tools** (MCP-spoken):
- `web_search`, `read_file`, `run_shell_command`, `send_email`, etc.
- Provided by MCP servers (built-in or installed plugins).
- Synchronous from agent's perspective: call → result.

**UI tools** (AgenticEngine-native protocol):
- `show_color_picker`, `show_image_gallery`, `show_form`, `show_file_preview`, etc.
- Declared by plugins via a typed schema (args, returns, ui description).
- Asynchronous from agent's perspective: call → user-interaction → result (or cancellation).
- See [[adr/0002-ui-as-tool-calls]] and [[adr/0005-ui-contract-closed-set]].

**Meta tools** (special):
- `create_plugin` — generates new plugins on user request.
- `create_ritual` — saves a workflow as a recurring trigger.
- `update_ritual`, `list_rituals`, etc.

### 3. **Frontends** (multiple, parallel)

Frontends are **independent clients** that connect to the daemon over WebSocket. Each frontend:
- Subscribes to **a subset of events** relevant to its purpose.
- Renders UI tool calls using its own native primitives.
- Does NOT contain any LLM logic or tool definitions.

**MVP frontends:**

| Frontend | Tech | Purpose |
|----------|------|---------|
| **macOS Overlay** | Tauri (Rust shell + web renderer) | Primary interactive surface. Hotkey, input panel, widgets, voice. |
| **Web admin tab** | Same web codebase, runs in browser | Settings, plugin management, history, cron management, devtools. |

**Post-MVP:**
- **macOS native overlay** (SwiftUI) — for premium native feel.
- **CLI client** — for power users and scripting.
- **iOS/Android** — via remote engine (requires hybrid cloud architecture; see [[adr/0003]]).

### 4. **Plugin System**

Plugins are **npm packages** that declare themselves via a custom `agentic-engine` field in `package.json`:

```json
{
  "name": "agentic-plugin-spotify",
  "agentic-engine": {
    "backend-tools": ["./tools/play.ts", "./tools/search.ts"],
    "ui-tools": ["./ui/now-playing.ts", "./ui/album-card.ts"],
    "permissions": ["network:api.spotify.com", "oauth"]
  }
}
```

The daemon scans `~/.agentic-engine/plugins/` on startup and registers everything declared.

**Plugin distribution** is an open question — see [[open-questions]].

### 5. **Cron Scheduler (Rituals)**

Rituals are **named, persistent, scheduled workflows**:

```yaml
name: "morning-brief"
cron: "0 8 * * *"
prompt: |
  Check today's weather. Check my calendar.
  Show me one summary widget with both.
created-from: "user voice command 2026-05-25"
```

The scheduler:
- Runs in the daemon process.
- Triggers stored rituals at their cron times.
- Each trigger starts a new session that proceeds like a user-initiated one — but with `inbound: cron` as the trigger source.

---

## Cross-cutting concerns

### Privacy & data ownership

- **Everything runs locally by default.** Sessions, history, plugin configs — all on the user's machine.
- **External calls** (LLM API, web search) are opt-in per provider; user supplies their own API keys.
- **Optional cloud sync** (post-MVP) is a separate layer; never required.

### Security model (open)

- Plugin code runs in the daemon process. Sandboxing strategy — TBD. See [[open-questions]].
- API keys stored in macOS Keychain (or equivalent on other OSes).

### Versioning

- Engine + protocol use semver.
- Plugins declare minimum engine version via `peerDependencies`.
- UI primitives are versioned in lockstep with the engine; new primitives = minor version bump; removed primitives = major.

---

## Related ADRs

- [[adr/0001-interaction-pattern]] — streaming session + inbound triggers
- [[adr/0002-ui-as-tool-calls]] — UI is tools, not a separate output channel
- [[adr/0003-local-daemon-ws-architecture]] — daemon + WS + multiple frontends
- [[adr/0004-typescript-bun-mcp]] — runtime and ecosystem choices
- [[adr/0005-ui-contract-closed-set]] — UI contract: primitives, not React
- [[adr/0006-dual-hotkey-2zone-ux]] — UX surface and activation
- [[adr/0007-voice-mvp-strategy]] — voice in MVP scope
- [[adr/0008-plugin-distribution-economic-model]] — plugin distribution and economic model

---

## Related

- [[concept]] — what we're building and why
- [[plugin-anatomy]] — concrete shape of a plugin
- [[roadmap]] — phased path from concept to v1
- [[known-gotchas]] — engineering watch list
- [[glossary]] — terminology
