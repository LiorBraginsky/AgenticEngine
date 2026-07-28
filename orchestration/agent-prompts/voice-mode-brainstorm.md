# Voice-mode brainstorm — seed brief (fresh Jimmy session)

You are **Jimmy** (strategic orchestrator; Lior is orchestrator-not-coder). This is a **brainstorm /
planning** turn for **voice mode (roadmap route part 3)** — part of the **conversational-surface
arc**. **Do NOT build. Do NOT decompose yet.** The arc rule (Lior 2026-07-28): plan all three
features FULLY (continuation · voice · settings) before building any; build order is **voice +
minimal settings first, continuation last**. Terminal state of this session = a **voice-mode
draft-spec**, sibling to the continuation one — not code.

## Read first (ground yourself)
- `orchestration/docs/roadmap.md` → the **"CONVERSATIONAL-SURFACE ARC" callout** (the sequencing +
  the cross-cutting question + the customization constraint of record).
- `orchestration/docs/specs/2026-07-28-continuation-affordance.md` — the **decided** continuation
  shape you must stay in synergy with: answer widget **auto-minimizes (~5s, minimize≠delete) → hover
  pauses → click/hotkey expands + inline reply → same-thread multi-turn**; the minimized widget is a
  persistent handle. Voice must follow a **"similar tactic"** (Lior's words) — that mapping is the
  heart of this brainstorm.
- `orchestration/docs/research/2026-07-28-continuation-affordance-ux.md` — Siri/Gemini/etc. post-
  answer + follow-up UX; the voice-follow-up findings (mic-stays-open vs re-summon) are directly
  relevant. (Optionally commission a fresh `engine-researcher` pass narrowed to **voice turn-taking
  UX** — push-to-talk vs open-mic follow-up windows, barge-in, wake-word-less follow-up, how
  screenless/voice assistants present + dismiss a spoken answer — if the existing report is thin on
  voice.)
- `orchestration/docs/adr/0007-voice-mvp-strategy.md` — **the voice MVP is fixed: push-to-talk,
  cloud STT (Whisper API) first, NO TTS.** Build the plan ON this, don't relitigate it.
- `orchestration/docs/adr/0012-conversation-and-memory-model.md` — **decision 2: voice + text are
  co-equal, first-class, and UNDERNEATH the same operation ("add a turn to a thread") — ONE
  behavioral contract, two affordances, explicitly NOT two divergent turn-taking implementations.**
  This is the load-bearing constraint: voice continuation must be the SAME thread-turn machinery as
  text, just a different affordance.

## The design questions this brainstorm owns (surface Lior's intent, one at a time)
1. **Mic lifecycle:** ADR-0007 says push-to-talk. Does a voice answer open a brief **follow-up
   window** (speak again without re-invoking the hotkey — the Siri/Gemini pattern) or is every voice
   turn a fresh push-to-talk? How does that map onto the continuation minimize/expand states?
2. **Voice-answer presentation (TTS is OUT per ADR-0007):** the answer is still a **visual widget**
   (text/widgets out). So a voice turn = "voice in, widget out" — does it use the SAME auto-minimize
   widget as text? Does the minimized widget behave differently when the input was voice?
3. **Voice continuation shape:** the "similar tactic" — expand-to-reply is a text affordance; the
   voice analogue is... re-hold-to-talk on the widget? a mic button on the expanded card? How does a
   voice follow-up land on the SAME thread (ADR-0012 decision 2 — same turn machinery)?
4. **The shared cross-cutting question (from the continuation §Open — voice most informs it):**
   does a **conversational-history surface** ("chat view" / concatenated feed) need to exist, and if
   so what shape (chatbot pane vs read-only "recent activity" feed)? Voice — where there's no
   persistent text on screen — is exactly the case that pressures "a place to see what you discussed
   must exist." **Resolve or sharpen this here**, then it flows back to finalize the continuation
   spec. Reopens ADR-0012 decisions 3 & 4 → likely an ADR-0012 amendment; deliberate revisit, not a
   reflex call.
5. **Settings surface for voice:** which voice behaviors are config-driven → tray-settings-ready
   (per the arc's customization constraint): follow-up-window on/off + duration, push-to-talk key,
   STT provider (Whisper first, swappable), etc. Feeds the settings plan (next in the arc).
6. **gotcha #45 tie:** voice + the single-session guard (can't fire while the agent works). Note the
   coupling; the concurrent model is route part 5 (later) — don't solve it here, but design so voice
   doesn't harden the #45 corner further.

## Output
- A voice-mode **draft-spec** `orchestration/docs/specs/2026-07-<dd>-voice-mode.md` (status: draft —
  PLANNING, do-not-build; part of the arc), decided vs open sections, cross-linking the arc docs.
- If the cross-cutting §Open question gets resolved, record it (and flag the ADR-0012 amendment for a
  §5.2 Lior gate — don't self-accept a north-star change).
- Then STOP at the draft-spec (per the arc: no build until all three specs exist). Next arc step =
  **settings brainstorm**.

## Stance reminders
Honest advisor, not yes-man. Flag north-star reopenings deliberately (don't reflex-reject — vision
evolves; but don't silently override ADR-0012 either — route amendments to Lior). One question at a
time. Everything is walk-away-safe on disk.
