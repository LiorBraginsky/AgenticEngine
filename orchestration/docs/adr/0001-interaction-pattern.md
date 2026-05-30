---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, interaction, sessions, triggers]
---

# ADR-0001: Interaction Pattern — Streaming Sessions + Inbound Triggers

## Status

`accepted`

## Context

AgenticEngine needs a fundamental decision about **how a single user interaction is shaped**: is each engagement a one-shot request/response, an interactive multi-step session, or an always-on persistent buddy?

This decision constrains everything else:
- Whether the engine needs session state at all.
- Whether multiple UI windows can coexist (streaming flow).
- Whether the agent can ask clarifying questions or only answer.
- Whether long-term memory is required from day one.

Additionally, the product wants to support **proactive agent behaviors** ("every morning at 8am, brief me") — this implies the engine receives **triggers it didn't initiate**.

## Decision

**Adopt a streaming-session model as the base interaction unit, with first-class support for inbound triggers (cron-driven sessions) symmetrical to user-initiated sessions.**

Concretely:

1. Every interaction is a **Session**: a bounded, stateful exchange with a unique ID.
2. Sessions support **multi-step flows**: the agent can call tools, wait for user input via UI widgets, reason, call more tools, etc., all within one session.
3. Multiple UI widgets can exist within a single session, simultaneously or sequentially.
4. Sessions are **ephemeral** by default — closed on completion, cancellation, or timeout. **No persistent memory across sessions in MVP.**
5. **Inbound triggers** (cron rituals, future webhooks) start sessions through the same code path as user-initiated sessions. Source is recorded as metadata (`trigger: user | cron | external`).
6. **Long-term memory and cross-session "do you mean continuing yesterday's chat?" logic** is layered on top later — not part of this decision.

## Consequences

### Positive

- One unified mental model for all interactions: "session." User-initiated and cron-initiated both look like sessions.
- Multi-step flows ("ask color → ask size → confirm") are natural; no rearchitecting needed.
- Symmetry between user triggers and inbound triggers means cron isn't a second-class citizen — it's the same machinery.
- Memory layer can be added later as a wrapper that injects context into new sessions, without breaking session semantics.

### Negative

- Slightly heavier engine state model than pure stateless request/response.
- Need to handle session lifecycle bugs: orphaned sessions, leaked sessions on frontend disconnect, timeouts.
- Engineers will be tempted to add memory features ad-hoc into sessions; need discipline to keep this as a separate layer.

### Trade-offs accepted

- We accept **stateful engine** in exchange for **multi-step UX**.
- We accept **no memory in MVP** in exchange for **shipping the core mechanism first**.
- We accept **cron is a fully equal citizen** in exchange for the **complexity of inbound triggers from day one**.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "we should have built memory from day one, users hate restating context" or "sessions should have been simpler, we overengineered the lifecycle".]

## Alternatives Considered

### Option A: Single-shot ("Spotlight-style")

User hits hotkey → asks → agent does one thing → result → done. No state between calls.

**Why not:** Doesn't support clarifying questions, multi-step flows, or "show me 3 options and let me pick". Lior's example use cases ("ask for color → show form → confirm") would all fail.

### Option C: Persistent buddy ("always-on agent")

Agent has full long-term memory, recognizes returning context, runs as one perpetual session.

**Why not:** Memory is its own huge problem (what to remember, privacy, retrieval correctness). Tackling it alongside the core mechanism would 3× MVP scope. Defer to v2.

## Related

- [[../concept]] — interaction-pattern is a core element of the thesis
- [[../architecture]] — sessions are central to the engine architecture
- [[0002-ui-as-tool-calls]] — sessions enable the asynchronous UI-tool semantics
