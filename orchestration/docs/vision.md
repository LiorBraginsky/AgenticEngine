---
title: Vision
status: living-document
last-major-update: 2026-08-06
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

---

## 🎯 THE NORTH-STAR HORIZON — conversation is the stream, widgets are the agent's hands

> **Recorded 2026-08-06 — Lior's own framing, deliberately set down in the vision doc rather than a backlog.**
> This is the **destination**, not the next build. It changes **nothing** about what we are building now.
> It exists so that nothing we build accidentally forecloses it.

### The end-state, in Lior's words

> **I talk with the agent in conversation mode.** I say something, it answers me — **and it shows me widgets.**
> The **conversation is the main stream.** The **widgets are its hands** — what it uses to show me something,
> or what we interact with together.

### Why this is being written down only now — and why it is NOT a pivot

When this project started, **there were no speech-to-speech implementations to look at.** By mid-2026 there are —
native realtime speech-to-speech (sub-second, with barge-in) exists across multiple providers. The absence of this
idea from the original framing had a reason, and that reason has expired. So this is a **horizon that became
visible**, not a change of mind.

### What this does NOT change — most of the concept survives intact

- **Widgets out stays.** This is not "voice replaces the visual answer." It is the **completion of
  [[adr/0002-ui-as-tool-calls]]**: a widget *is* a tool call, so in a continuous conversation the speech carries the
  dialogue and the tool calls render as widgets. Structurally that is what ADR-0002 already says.
- **Agent-not-chatbot stays.** The stream is *spoken*, not a scrolling transcript. ADR-0012 decision 3 is untouched.
- **Dual-modality, one behavioral contract** ([[adr/0012-conversation-and-memory-model]] decision 2) is not just
  preserved — it is *strengthened*: a spoken turn and a typed turn remain the same thing underneath.
- **The memory model is unaffected.** Super-chat, threads, transparency hatch — all orthogonal.

### What it eventually revises (do NOT touch these now)

- **[[adr/0007-voice-mvp-strategy]]'s accepted trade-off** — *"the answer is a widget, not a voice… actually aligns
  with our positioning"*. In the end-state it becomes **widget AND voice**: voice carries the dialogue, the widget
  carries the demonstrable artifact. The ADR's *MVP scope line* (push-to-talk, cloud-STT-first, no TTS) stands until
  then; the trade-off sentence is what flips.
- **The invocation model** — hotkey-per-turn ([[adr/0006-dual-hotkey-2zone-ux]]) versus an **open session**. These are
  different interaction models, not a setting.
- **Ephemeral sessions + eviction** ([[adr/0001-interaction-pattern]]) — a live conversation pins a session alive.
  The same tension the [[widget-lifecycle-model]] already names for awaiting widgets, one level up.

### The two hard constraints, named now so they are not a surprise later

1. **The Claude API has no audio modality at all** (verified 2026-08-06: text · images · PDF; no audio block, no
   realtime endpoint). Claude's own "voice mode" is dictation in Anthropic's *apps*, not an API capability. So a
   native speech-to-speech lane means **a different model drives the voice loop**, or a cascaded
   STT→LLM→TTS pipeline with its own turn-taking layer keeps Claude as the brain at a higher latency floor.
2. **Two postures take the hit:** subscription-first ([[adr/0011-llm-auth-and-subscription-strategy]]) — realtime is
   metered, on the order of cents per minute — and the egress posture
   ([[adr/0017-embedding-provider-plane-and-egress-posture]]) — a realtime lane streams a **live microphone** to a
   third party, which is the opposite of the local-first stance we just shipped for embeddings.

### What it authorizes right now: nothing

No build, no chunk, no ADR edit, no provider switch. **The current direction continues unchanged** (see
[[roadmap]] — the conversational-surface arc). The cheapest honest next step, whenever it comes, is a **throwaway
spike outside the product** to answer one question: *is this AgenticEngine's product, or just someone else's
impressive demo?* Everything downstream of that is a §5.2 north-star decision, and Lior's alone.

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
