---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, architecture, deployment, transport]
---

# ADR-0003: Local Daemon + WebSocket + Multiple Frontends

## Status

`accepted` (with planned evolution to hybrid local/cloud later)

## Context

AgenticEngine could be deployed in several fundamentally different shapes:

1. **Local daemon** — long-running process on the user's machine, frontends connect to it.
2. **Embedded library** — the engine is an npm package that each host application includes inline.
3. **Cloud service** — engine runs on remote servers, frontends are thin clients.
4. **Hybrid** — engine can run locally or remotely; frontends are agnostic.

Plus the **transport** decision: WebSocket, gRPC, MCP stdio, SSE, IPC, etc.

This decision affects:
- Privacy posture (where user data lives).
- Latency (network hops vs in-process).
- Multi-frontend support (can one engine serve many UIs?).
- Cron-style proactive triggers (need to run when no UI is open).
- Installation complexity.

## Decision

**Engine runs as a local daemon, exposing a WebSocket server on `localhost:7777`. Multiple frontends (macOS overlay, web admin tab, future CLI) connect simultaneously to the same daemon. The protocol is transport-agnostic in design, so we can later add a remote-engine option without breaking frontends (hybrid mode).**

Concretely:

1. The daemon is a long-running TypeScript/Bun process.
2. On macOS, started via `launchd` with the `~/.agentic-engine/daemon.plist`. Possibly with `KeepAlive=Adaptive` for on-demand activation (see [[../open-questions]] Q6).
3. The daemon listens on `127.0.0.1:7777` (loopback only — no external network exposure).
4. WebSocket as the primary transport, with optional HTTP endpoints on the same port for large-asset transfer (e.g., file thumbnails for `show_file_preview` are inefficient over JSON-encoded WS).
5. Frontends authenticate via a per-install secret token (file-system-permission-protected) to prevent cross-origin browser tabs from connecting to a random user's daemon.
6. Future cloud/remote mode (post-MVP): the same WebSocket protocol, but `wss://` URL pointing to a hosted engine. Frontends pick endpoint via config.

## Consequences

### Positive

- **Privacy by default:** all session data, history, API keys, file access stays on the user's machine.
- **Low latency:** localhost WS RTT is ~0.1ms vs ~50-200ms for cloud.
- **Multi-frontend out of the box:** macOS overlay + browser admin tab + CLI can all observe the same engine state simultaneously, simply by subscribing.
- **OS integration freedom:** the macOS overlay can use system-level APIs (global hotkeys, accessibility, file access) without any network proxy.
- **Cron-jobs work offline:** the daemon runs regardless of which frontends are open. Rituals fire even with all windows closed.
- **No hosting costs:** users supply their own LLM API keys; we don't pay for their queries.
- **Transport-agnostic protocol** keeps the door open for hybrid (cloud engine for cron when laptop sleeps; mobile via remote engine).

### Negative

- **Installer required:** users must install a daemon and accept "process running in background." This is a friction step compared to "open a website."
- **Update management:** updating the daemon requires restart; updates must be smooth.
- **Cross-platform port:** Linux/Windows port needs systemd/Service Manager equivalents. Adds work.
- **Security surface:** loopback WS still needs auth tokens because browser tabs can probe localhost. Must do this right.
- **Crash recovery:** if daemon crashes, all open sessions are lost (no persistence in MVP).

### Trade-offs accepted

- We accept **installer friction** in exchange for **privacy + latency + cron + multi-frontend**.
- We accept **operational complexity of long-running daemon** in exchange for **always-on availability**.
- We accept **WebSocket** (not MCP stdio) because **multi-frontend support** requires it, even though MCP stdio is more standard for single-client agent setups.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "the installer friction lost us casual users; should have done a hosted version too" or "we underestimated multi-frontend bugs from concurrent sessions".]

## Alternatives Considered

### Option B: Embedded library

Engine ships as an npm package; each host (web app, macOS app) imports and instantiates its own engine.

**Why not:**
- Cannot have two frontends sharing one engine state.
- Cron rituals only fire when their host is running.
- Duplicates LLM client / tool registry per host.
- Closes the door to multi-device sync.

### Option C: Cloud engine from day one

Engine on a hosted server; frontends are thin clients (à la ChatGPT).

**Why not:**
- Privacy issue: every session goes through our servers.
- "Show me my local file" requires a local agent anyway — bringing us back to (A) hybrid territory.
- Hosting costs scale with usage.
- High latency for every interaction, including UI tool calls.

### Option D: Hybrid from day one

Frontend connects to either local or remote engine, transparent at the protocol level.

**Why not (yet):**
- All the work of (A) PLUS the complexity of a cloud product.
- Premature for an unvalidated concept.
- The protocol is **designed** to be hybrid-ready (see "Decision" point 6) — we just don't build the cloud variant in MVP.

## Related

- [[0001-interaction-pattern]] — sessions live in the daemon
- [[0004-typescript-bun-mcp]] — runtime that powers the daemon
- [[../architecture]] — system diagram showing daemon + frontends
- [[../open-questions]] Q6 — daemon hot/cold startup
