---
title: Text continuation affordance (route part 2) — design (IN PLANNING)
status: draft — PLANNING, do-not-build; part of the conversational-surface arc (continuation + voice + settings planned together, built after all three specs exist — Lior 2026-07-28). Finalizes AFTER voice + settings inform the shared cross-cutting surface question (§Open).
date: 2026-07-28
deciders: [lior]
feeds: (arc) — build order = voice + minimal settings first, continuation last
related:
  - adr/0012-conversation-and-memory-model.md (the open Live-Card-vs-Continuation-Pill choice this resolves; decisions 3 & 4 reopened by §Open)
  - adr/0006-dual-hotkey-2zone-ux.md (rule-of-three dismiss; this owes it an amendment — see §Decided-3)
  - research/2026-07-28-continuation-affordance-ux.md (Siri-referenced UX research feeding this)
  - roadmap.md ("CONVERSATIONAL-SURFACE ARC" callout — the sequencing of record)
tags: [spec, draft, continuation, overlay, ux, north-star, arc]
---

# Text continuation affordance — design (in planning)

> **Planning status.** This spec is the walk-away-safe home for the continuation design. It is
> **not ready to decompose/build** — per Lior's 2026-07-28 ruling the three arc features
> (continuation · voice · settings) are planned FULLY first and built after, with continuation
> finalized LAST (its one cross-cutting question, §Open, needs the voice + settings picture). What
> is **Decided** below is firm; what is **Open** is deliberately carried.

## Origin

Roadmap route part 2 (ADR-0012 left the exact reply affordance as a build-time choice: inline
**Live Card** vs re-summoned **Continuation Pill**). Brainstormed 2026-07-28 with Apple Siri /
Apple Intelligence as Lior's named reference — specifically its **ephemeral self-removal** («воно
видаляє як я хотів»), which on inspection means **minimize, not delete**. Research report:
`research/2026-07-28-continuation-affordance-ux.md`.

## Decided (firm)

1. **Hybrid, not a pure pole — auto-minimize to a persistent widget → expand-to-inline-reply.**
   - The answer widget shows full. After **~5 s of no interaction** it **minimizes** into a small
     **persistent** widget (~½ a macOS notification) that simply hangs on the surface.
   - **`minimize ≠ delete`** — the content is compacted, never destroyed; one action restores it.
     This is the deliberate fix to classic Siri's most-hated behavior (it DELETES the answer mid-read
     — NN/g's named anti-pattern; the research documents the large complaint body). Compaction dodges
     it: worst case is "shrank while I was reading → one click back," never "lost."
   - **Hover pauses** the minimize (does not minimize while the pointer is over it; resumes when the
     pointer leaves).
   - **Click on the minimized widget OR press the hotkey → expand + focus an inline reply.**
   - The minimized widget IS the "Continuation Pill" (a persistent handle, not a re-summon from
     nothing); the expanded state's inline reply IS the "Live Card." The ADR-0012 binary resolves as
     a **synthesis of both**, both staying inside the agent/widget paradigm (neither is a chat box).
2. **Reply = the SAME thread, multi-turn.** Expanding and replying adds a turn to the live thread
   (within-thread multi-turn per ADR-0012 decision 4a). The minimized widget carries thread identity.
3. **ADR-0006 amendment owed (`minimize` = a third dismiss-state).** The rule-of-three (2026-06-03
   amendment) says *status* auto-dismisses on a timer but *content* dismisses only on explicit
   action. The 5 s auto-minimize is a timer acting on content — allowed **because content survives
   compacted**; only a true **dismiss** stays explicit. Record `minimize` as a distinct third state
   between the two. (Ruled acceptable by Lior 2026-07-28: "fixed 5 s, minimize≠delete is enough.")
4. **Customization-ready from day one (Lior, decided).** Every behavioral value — the ~5 s timer,
   the minimize/dismiss policy, hover-pause, minimized-widget size, later the voice tactics — is
   **config-driven from the start** so it graduates cleanly into **tray settings** (settings is a
   first-class arc member, not an afterthought). Group the code so the behavior→config→tray path is
   cheap. This is a structural constraint on the eventual implementation, recorded now.
5. **Voice follows a "similar tactic"** (Lior) — the same minimize/expand/continue shape adapted for
   a voice turn. Detail deliberately deferred to the voice-mode plan (next in the arc); recorded here
   only so the continuation design does not preclude it.

## Open — the cross-cutting north-star question (resolve during the arc, not now)

**Should the minimized widget expand into a "chat view," and should a concatenated cross-thread
feed exist?** Lior's idea (à la the just-released "Siri AI" app) + his verbatim insight:

> *"Memory must not be the only place you can see what you discussed with the agent — such a place
> should exist. Could concatenate threads into one feed, lazy-loaded as you scroll up, with a
> separator."*

- **This reopens ADR-0012 decision 3** (agent-not-chatbot; output is ephemeral widgets, **not** a
  persistent scrolling chat log — the explicitly-rejected Option B) **and decision 4** (the user
  interacts with THREADS, not one infinite feed).
- **NOT a reflex-reject.** Vision evolves; the insight is real. This is a **deliberate revisit** —
  likely an **ADR-0012 amendment** — to be settled once voice + settings inform the shared surface
  (Lior's own sequencing: "it's all connected, must work in synergy").
- **☆ Non-chatbot alternative to weigh:** a **read-only "recent activity" feed** — ephemeral cards
  in a history surface, not an editable transcript — satisfies "a place must exist" without breaking
  the paradigm. Continuation itself still lives on the widget; the feed is for *seeing*, not
  *continuing-from*. Candidate for the revisit round, not a decision here.
- **Why it can't be closed now:** its answer changes what the expanded state IS (inline-reply card
  vs chat pane), what voice's history looks like, and what settings expose — i.e. it is the
  entanglement that motivated planning all three together.

## Not deciding here

Voice turn-taking detail (own plan) · tray settings model + which values are exposed (own plan) ·
widget accumulation across threads / concurrent threads (route part 5, gotcha #45) · richer widget
output (route part 4).

## Next in the arc

Voice-mode brainstorm → settings brainstorm → close the §Open cross-cutting question → finalize all
three specs → build (voice + minimal settings first, continuation last).
