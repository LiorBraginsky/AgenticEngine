---
title: Vision
status: living-document
last-major-update: 2026-05-25
tags: [vision, north-star]
---

# Vision

> **The OS layer for AI agents.**
> Plugins ship widgets and tools, users program rituals, AI-powered services come to you.
>
> *Mechanism: voice in, widgets out.*

**Alternate phrasings** (kept here as reference for different surfaces — landing page, pitch deck, README):

- *"Voice in. Widgets out. Plugins ship interfaces. Users program rituals."* (rhythm/mantra)
- *"The OS layer where you speak to AI, see widgets, and pull in services through plugins."* (single sentence)
- *"Your AI shell. Programmable in voice."* (dev-focused MVP positioning)

---

## The world we want to live in

Today, when you have a question or a small task, you do one of:

- Open a new ChatGPT/Claude tab, type a paragraph, paste back a paragraph.
- Open an app, navigate menus, do a thing, close it.
- Ask Siri/Alexa/Google, get a one-shot fragile answer.

All three are friction. The first treats AI as a destination. The second treats your machine as a museum of separate apps. The third treats voice as a parlor trick.

In **the AgenticEngine world**:

- **You speak when your hands are busy. You type when others are around.** The agent is one hotkey away in both modes.
- **The agent's answer is a thing you can touch** — a color picker for a color question, a flight selector for a travel question, a chart for a data question. Reading paragraphs is the fallback, not the default.
- **The agent learns your rituals.** Once you teach it "every Monday morning, brief me on the week," it survives there. You don't reopen anything.
- **The ecosystem extends naturally.** Want music control? Install the Spotify plugin — it brings its own player widget. Want weather? Plugin brings its own forecast widget. The AI doesn't just *act* — it *speaks the visual language* of each domain.

---

## Who it is for

**Primary persona: the prosumer-developer hybrid.**

People who:
- Live with their computer (5-8+ hours a day),
- Already extend their tools (Raycast extensions, iOS Shortcuts, Obsidian plugins, Notion templates, VS Code extensions),
- Don't necessarily write code professionally — but **can declaratively describe behavior**,
- Are tired of context-switching to AI tabs.

**Secondary persona: AI-curious mainstream users** — who want one consistent place to ask their machine to do things, without learning a new app per task.

**Not the target (yet):**
- Enterprise teams (different sale, different concerns).
- Mobile-first users (desktop-first by design — overlay UX requires a windowed OS).
- Hardcore voice-only users (we serve voice, but visual is primary).

---

## What success looks like

In rough order of ambition:

1. **6 months:** Lior uses it daily for at least one personal workflow that doesn't exist in any other tool.
2. **12 months:** 3rd-party plugin authors publish widgets and earn organic adoption.
3. **24 months:** "Ritual" becomes a recognized concept — people share their `.ritual` files like they share dotfiles today.
4. **36 months:** AgenticEngine is the answer to "where do I run my AI?" the way `cron` is the answer to "where do I schedule things?"

---

## Anti-vision (what we are NOT)

- **Not a chat app.** No persistent chat scrollback as the primary surface.
- **Not a Raycast clone.** Raycast is a launcher. We are an interaction layer for AI conversations + UI generation.
- **Not closed.** Plugin ecosystem is core, not bolted on.
- **Not voice-only.** Voice is one mode. Visual response is the moat.
- **Not cloud-hosted.** Engine runs on the user's machine. Cloud is opt-in for specific features later.

---

## Related

- [[concept]] — product thesis and four pillars of differentiation
- [[architecture]] — how this vision becomes software
- [[roadmap]] — phased path from concept to v1
