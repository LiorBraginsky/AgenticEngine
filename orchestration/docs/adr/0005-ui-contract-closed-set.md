---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, ui, protocol, plugins]
---

# ADR-0005: UI Contract — Closed-Set Primitives + Custom Escape Hatch

## Status

`accepted`

## Context

Given that UI generation is done via tool calls ([[0002-ui-as-tool-calls]]), there is still a fundamental question: **how exactly does a UI tool describe what to render?**

Three categories of approach:

1. **Closed-set primitives:** the engine defines a finite vocabulary of UI elements (button, slider, color-picker, ...); plugins compose these.
2. **Open-set components:** plugins ship arbitrary code (React components, etc.) that frontends execute.
3. **Generated code:** plugins or the LLM emit HTML/JSX strings.

This decision controls:
- Whether non-web frontends (native macOS, future iOS) can render plugin UI.
- Security posture (arbitrary plugin code in the UI = XSS surface).
- Cross-frontend UI consistency.
- LLM ergonomics for generating UI descriptions.

## Decision

**Use a closed set of UI primitives, defined and versioned by the engine. Provide one escape-hatch primitive (`custom_content`) for restricted sanitized HTML/Markdown when truly needed.**

Concretely:

1. The engine defines a versioned list of UI primitives (e.g., `button`, `text`, `input`, `select`, `color-picker`, `image`, `image-gallery`, `markdown`, `form`, `confirmation`, etc.). The full list is TBD — see [[../open-questions]] Q2.
2. UI tools declare their widget as a **composition of primitives** via a typed schema (Zod, JSON Schema).
3. Each frontend (web, macOS overlay, future native) implements its own **renderer** for each primitive in its native idiom.
4. New primitives are added by **minor version bumps** of the engine. Plugins declare `peerDependencies` for minimum engine version.
5. Removing primitives is a **major version bump** and avoided unless deprecation cycle is complete.
6. The escape hatch is a single primitive: `custom_content` with sanitized HTML/Markdown payload. Native frontends may render it as a WebView; web frontends sanitize and inject. Plugin authors are encouraged to **not use it** unless no primitive fits.

## Consequences

### Positive

- **Universal renderer contract:** native macOS overlay (Tauri / SwiftUI), web admin tab, CLI, and future iOS all render the same UI tool description in their native style.
- **Consistent UX:** all plugins look like first-party in the active host's idiom. Buttons look like buttons everywhere.
- **No XSS / sandbox concerns** for 95% of UI (the closed-set is fully owned).
- **Plugin authors write less code** — declarative JSON-Schema-ish descriptions, not CSS + React.
- **LLM-friendly:** the LLM emits JSON describing UI, which it does well, rather than React/HTML strings, which it does worse.
- **Centralized theming, accessibility, i18n** — implemented once per host, free for all plugins.
- **Diff-friendly** — UI updates are JSON deltas, easy to stream and reason about.

### Negative

- **Limited expressiveness** out of the box. Some plugin authors will hit walls ("I want an interactive map with custom pin clusters — there's no `interactive-map` primitive yet").
- **Engine maintainers (us) become a bottleneck** for new UI vocabulary. Every plugin author who needs a new primitive has to either: wait for engine update, contribute upstream, or use the escape hatch.
- **`custom_content` escape hatch is a known security risk** and operational pain (sanitization, native-frontend fallback).
- **Versioning discipline required** — once a primitive ships, removing it breaks plugins.

### Trade-offs accepted

- We accept **constrained expressiveness** in exchange for **cross-frontend, secure, consistent UI**.
- We accept **engine maintainers as gatekeepers** of UI vocabulary growth, in exchange for **architectural moat** (plugin UI works on any frontend).
- We accept the **escape hatch security risk** in exchange for **5% case coverage** of complex one-off UI needs.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "we picked the wrong initial primitives; the first 10 plugins all needed something we didn't have" or "the escape hatch became the default, defeating the whole closed-set strategy."]

## Alternatives Considered

### Option B: Open-set (plugins ship React components)

Plugins export real React/Svelte/etc. components; frontend mounts them.

**Why not:**
- Native macOS overlay (Swift / native renderer) **cannot** execute React. Plugins become web-only.
- Security: arbitrary plugin JS in the UI = XSS attack vector. Sandboxing (iframes) adds latency and complexity.
- Inconsistent UX — each plugin invents its own button.
- Cross-platform is dead from day one.

### Option C: Generated HTML/JSX

LLM generates HTML directly; frontend renders.

**Why not:**
- Same security issues as Open-set.
- Brittle — LLMs occasionally generate broken markup.
- No way to handle interaction events back to the agent.
- No native rendering possible.

## Related

- [[0002-ui-as-tool-calls]] — UI tools are the carrier of these primitives
- [[../open-questions]] Q2 — the actual list of primitives is still TBD
- [[../architecture]] — UI contract in system context
- [[../glossary]] — terminology around primitives and widgets
