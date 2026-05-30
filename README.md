# AgenticEngine

> **Voice in, widgets out.**
> An open OS-overlay AI agent where plugins ship their own interfaces and users program rituals in natural language.

**Status:** Early concept — pre-implementation. Architecture decided, build not started.

---

## What it is

AgenticEngine is a **local-first AI agent platform** that replaces "open another ChatGPT tab" with a thin **OS-overlay** invoked by hotkey. When you ask a question, the agent doesn't write a paragraph back — it generates **interactive widgets** (color pickers, file previews, multi-step forms, image galleries, charts) that you click, dismiss, or compose with.

It is **not** a chatbot. It is **not** a Raycast clone. It is a **new interaction layer between the user and their machine**, where:

- **Input is voice or quick text** (push-to-talk hotkey, or text panel).
- **Output is ephemeral UI widgets** rendered in the corner of the screen.
- **Plugins are first-class** — third-party authors and even end users can extend behavior **and** the visual vocabulary.
- **Rituals** — recurring agentic flows ("every morning at 8am, summarize my calendar") — are programmable in natural language.

---

## Why it might matter

The market is full of "AI chat in a box" products. AgenticEngine bets on three structural differences:

1. **Generative UI as the answer format** — not text, not voice, but tappable, dismissable interactive widgets.
2. **Plugin authors ship widgets, not just functions** — the ecosystem extends the UX vocabulary, not just the tool list.
3. **Programmable rituals** — users teach the agent reusable workflows by voice, and those rituals live on as cron-style triggers.

See [`orchestration/docs/concept.md`](orchestration/docs/concept.md) for the full positioning.

---

## Quick links

- [Vision](orchestration/docs/vision.md) — the north star
- [Concept](orchestration/docs/concept.md) — product thesis and 5 pillars of differentiation
- [Architecture](orchestration/docs/architecture.md) — high-level system shape
- [Plugin Anatomy](orchestration/docs/plugin-anatomy.md) — what a plugin is, layer by layer
- [Roadmap](orchestration/docs/roadmap.md) — milestones and MVP definition
- [Open Questions](orchestration/docs/open-questions.md) — what's still unresolved
- [Known Gotchas](orchestration/docs/known-gotchas.md) — engineering watch list for later
- [Glossary](orchestration/docs/glossary.md) — terminology
- [ADRs](orchestration/docs/adr/) — architecture decision records (0001-0008)

---

## Tech stack (decided)

- **Engine runtime:** TypeScript on Bun (Node-compatible fallback)
- **Transport:** WebSocket on `localhost:7777`
- **Backend tools:** MCP (Model Context Protocol) servers
- **UI contract:** Closed-set primitives + custom escape hatch
- **Frontends:** macOS overlay (Tauri-based for MVP, native Swift later) + web admin tab
- **STT (voice):** Cloud Whisper API for MVP, local Whisper opt-in
- **TTS:** Not in MVP

See ADRs in [`orchestration/docs/adr/`](orchestration/docs/adr/) for full reasoning per decision.

---

## License

TBD. Likely permissive (MIT / Apache-2.0) to encourage plugin ecosystem.
