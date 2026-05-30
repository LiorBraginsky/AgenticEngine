---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, runtime, language, ecosystem]
---

# ADR-0004: TypeScript on Bun + MCP for Backend Tools

## Status

`accepted`

## Context

Once we decided on a local daemon ([[0003-local-daemon-ws-architecture]]), we needed to choose:

- **Language / runtime** for the daemon (TS/Node, Python, Rust, Go, Swift).
- **Tool protocol** for backend tools — whether to invent our own or adopt an existing standard like MCP (Model Context Protocol).

These decisions affect ecosystem reach, plugin author experience, performance, and our ability to "borrow" existing tools rather than build everything from scratch.

## Decision

**Use TypeScript as the source language, Bun as the primary runtime (with Node.js fallback), and MCP as the standard protocol for backend tools.**

Concretely:

1. **Language:** TypeScript end-to-end — daemon, web frontend, plugin SDK.
2. **Runtime:** Bun preferred for daemon (fast startup matters for `launchd` on-demand activation). Code is written to be **runtime-agnostic** (use `fetch` instead of `node-fetch`, web-standard APIs, ESM-only) so it runs equally well on Node, Bun, and Deno.
3. **Backend tools protocol:** MCP. The daemon is an **MCP client**; tools are MCP servers (in-process or external).
4. **UI tools protocol:** Our own, layered on top of MCP-style tool definitions but with extra UI metadata.
5. **Plugin packaging:** npm packages. Plugins declare themselves via a custom `agentic-engine` field in `package.json`.

## Consequences

### Positive

- **One language for daemon + web frontend** — shared types (Zod schemas, message types) between engine and renderer. No translation cost.
- **Best-in-class Anthropic + OpenAI SDKs** in TypeScript — streaming, prompt caching, tool calls all natively supported.
- **MCP native support in TS** — both client and server libraries from Anthropic.
- **npm as plugin marketplace** — semver, dependency resolution, install/update mechanics all already exist.
- **Massive existing ecosystem of MCP servers** (filesystem, GitHub, Slack, browser-use, etc.) — AgenticEngine inherits them for free.
- **Bun gives ~10× faster startup** than Node, which matters for `launchd` on-demand activation (200ms vs 20ms).
- **Runtime-agnostic discipline** keeps us portable: if Bun has a critical issue, switch to Node with one line.

### Negative

- **Node's RAM overhead** (~50-100MB resident for the daemon) is higher than Rust (~5-20MB) or Go. Acceptable for a personal-computer daemon, not for embedded systems.
- **Some npm packages with native bindings** (older sqlite3, etc.) may not work on Bun — must use runtime-agnostic alternatives. Mitigation: documented constraints for plugin authors.
- **TS isn't ideal for systems-level integrations** (e.g., true native macOS overlay — see [[0006-dual-hotkey-2zone-ux]]). We mitigate by using **Tauri** (Rust shell + web renderer) for the macOS overlay, which lets us share the web codebase.
- **MCP is young** (2024) — protocol may evolve, and we follow that evolution.

### Trade-offs accepted

- We accept **higher RAM than Rust/Go** in exchange for **dev velocity + shared web-frontend codebase**.
- We accept **Bun's smaller ecosystem caveats** in exchange for **faster cold start**, with Node as fallback always available.
- We accept **MCP's youth and evolution risk** in exchange for **immediate compatibility with the broader agent ecosystem**.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "Bun caused subtle compatibility bugs with plugins, should have started on Node" or "TS isn't strict enough for engine internals, should have used Rust core + TS host."]

## Alternatives Considered

### Option B: Python

**Why not:**
- Cannot share code with web frontend (would need separate TS frontend codebase + types crossed via HTTP).
- Daemon ergonomics on Python are weaker (GIL, packaging hell, `pyinstaller` is ugly).
- Worse for streaming-heavy WebSocket use.

### Option C: Rust

**Why not:**
- Best-in-class daemon characteristics (RAM, startup), but ~3× slower to write.
- AI/LLM SDK landscape in Rust is still patchy (community-maintained Anthropic/OpenAI clients).
- Closes off "share code with web frontend" path.
- For MVP we need development speed; Rust would push first usable version back 2-3 months.

### Option D: Go

**Why not:**
- Great for daemons, but weak AI/LLM ecosystem.
- Cannot share types with web frontend.
- No clear win over TS for our use case.

### Option E: Swift (native macOS)

**Why not:**
- Locks us to Apple platforms forever — no Linux/Windows port path.
- The web admin tab would need to be a separate codebase.
- Better as a **second-frontend** option (native macOS overlay v2.0), not as the engine itself.

## Related

- [[0003-local-daemon-ws-architecture]] — the architectural shape this runtime serves
- [[0005-ui-contract-closed-set]] — UI tools layered on top of MCP-style definitions
- [[../architecture]] — runtime in system context
