---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, ui, tools, protocol]
---

# ADR-0002: UI Generation as Tool Calls (Not Structured Output)

## Status

`accepted`

## Context

The product's core idea is that the agent answers with **interactive UI widgets** instead of text. There are two fundamentally different ways to implement this mechanism:

1. **As structured output:** the LLM emits JSON describing UI alongside its prose response. The engine parses and forwards to the frontend.
2. **As tool calls:** the LLM has tools whose effect is "show this UI to the user." Calling these tools is indistinguishable from calling any other tool from the LLM's perspective.

This decision shapes the entire engine ↔ frontend protocol and how plugins extend the UI vocabulary.

## Decision

**Treat UI generation as tool calls. The LLM has a category of tools called "UI Tools" whose semantics are: "show this widget to the user, return their response."**

Concretely:

1. UI tools live in the same tool registry as backend tools (web search, file read, etc.).
2. From the LLM's perspective, calling `show_color_picker(question, palette)` is the same kind of operation as calling `web_search(query)` — it's a function that returns information.
3. UI tools may return a result (e.g., the color the user picked) or be fire-and-forget (e.g., `show_image` — user just looks at it).
4. UI tools may be **async with no fixed timeout** — the user might take 5 seconds or 5 minutes to respond. Engine must handle this.
5. UI tools are declared by plugins the same way backend tools are — there is no separate "UI declaration" mechanism.

## Consequences

### Positive

- **Unified mental model for the LLM:** "get info externally via a function call" — whether the info comes from the web or from the user. This is exactly the reasoning pattern modern LLMs are trained for.
- **Natural extensibility:** new widget? Add a tool. New frontend that doesn't support a widget? Don't register that tool handler. The engine doesn't care.
- **Inbound triggers (cron) work uniformly:** a ritual firing a notification is just the cron scheduler invoking `show_notification` directly, bypassing the LLM if needed. Same protocol.
- **Multi-window naturally:** parallel tool calls = parallel widgets. No special-casing for "multiple UI elements."
- **Async-with-user-input is built in:** tool calls already have request/response semantics with no fixed latency.
- **Plugin authors only learn one concept:** "I define tools." Some happen to render UI. The boundary is one config flag.

### Negative

- **Frontend complexity:** the frontend must handle async-with-no-timeout tool calls gracefully (loading states, cancellation when user closes widget).
- **Tool count grows fast:** dozens of UI tools per plugin is expected. Tool registry has to scale and be discoverable for the LLM.
- **Tool-call serialization overhead:** every UI render is an RPC. Latency must stay under ~50ms for snappy feel.

### Trade-offs accepted

- We accept **larger tool registries** (potentially hundreds of tools) in exchange for **unified semantics**.
- We accept that **the LLM has to learn many UI tool names** in exchange for **plugin-driven UX vocabulary**.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "LLM gets confused with too many UI tools" or "tool-call latency makes UI feel sluggish".]

## Alternatives Considered

### Option X: Structured output (UI in the model's reply)

LLM emits something like:
```json
{
  "speak": "Pick a color",
  "ui": { "type": "color-picker", "palette": ["#FF0000", "#00FF00", "#0000FF"] }
}
```

**Why not:**
- Conflates two channels in one LLM response (prose + UI), making prompts more complex.
- Requires UI schema as part of every system prompt — wastes context.
- LLMs trained for function calling are better at "call show_color_picker" than at "emit nested UI JSON inline."
- Plugin extensibility requires schema updates, not just new tools.

### Option Z: Hybrid (simple UI as output, complex as tools)

Some UI inline, some as tool calls.

**Why not:** Two mental models is worse than one. Frontend has to render both. Plugins have to choose which channel.

## Related

- [[0001-interaction-pattern]] — session model that enables async UI tools
- [[0005-ui-contract-closed-set]] — what UI tools look like in practice
- [[../concept]] — generative UI is a core differentiation pillar
