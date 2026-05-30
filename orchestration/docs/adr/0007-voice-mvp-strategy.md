---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, voice, mvp, scope]
---

# ADR-0007: Voice MVP Strategy — Cloud STT First, No TTS

## Status

`accepted`

## Context

Voice is **central to product positioning** — "Voice in, widgets out" is the core tagline ([[0006-dual-hotkey-2zone-ux]]). Without voice as a first-class entry point, AgenticEngine starts to look like Raycast with a chat UI.

However, voice features have several axes that don't all need to be solved at once:

- **STT (Speech-to-Text):** local vs cloud, model size, language support.
- **TTS (Text-to-Speech):** off, system TTS, premium TTS (ElevenLabs).
- **Voice-to-voice flow:** can the agent ask questions back in voice?
- **Onboarding:** how does the user configure voice preferences at first launch?

Pushing for full Jarvis-style voice-to-voice in MVP would add weeks-to-months of work and significant install bloat. Cutting voice entirely would gut the product positioning.

## Decision

**MVP voice scope: push-to-talk input only, cloud STT (OpenAI Whisper API) as default, local Whisper as opt-in for privacy users, no TTS, no voice-to-voice flow. Onboarding wizard at first launch presents the cloud-vs-local choice.**

Concretely:

| Component | MVP | v1.x | v2.0+ |
|-----------|-----|------|-------|
| **Push-to-talk hotkey** | ✅ Required | — | — |
| **STT — cloud (Whisper API)** | ✅ Default | — | — |
| **STT — local (Whisper.cpp)** | ⚠️ Opt-in via onboarding | Expanded model options | GPU-accelerated large model |
| **TTS — text-to-speech** | ❌ Off | Opt-in system `say` for confirmations | ElevenLabs / OpenAI TTS for fluency |
| **Voice-to-voice flow** | ❌ — | Partial | Full Jarvis-style flow |
| **Onboarding wizard** | ✅ First-launch flow | Settings UI for adjustments | — |

## Consequences

### Positive

- **No 1.5GB install bloat** in MVP — cloud Whisper API is "$0 disk, $0.006/min when used."
- **Cloud Whisper has 95%+ accuracy** for English and Ukrainian out of the box.
- **Push-to-talk privacy** — mic never on unless user explicitly holds the key.
- **Privacy-conscious users get a path** — onboarding wizard lets them download local Whisper and use it instead.
- **Reduced MVP scope** — voice input works without solving TTS or back-and-forth voice conversations.
- **Vision still intact** — "Voice in, widgets out" tagline holds; TTS is for v2 Jarvis upgrade.

### Negative

- **Cloud STT means internet required** for voice mode. Privacy-conscious users must opt in to local download.
- **No TTS means agent has no voice in MVP** — this contradicts the "Jarvis vibe" Lior dreams of long-term. Mitigation: vision doc commits to TTS as v2 feature.
- **OpenAI API key required** for default cloud STT. User must sign up and create a key. Adds onboarding friction.
- **Voice quality vs typing** is a UX hierarchy that we may not have right — most use may end up keyboard-only. We accept the risk.
- **Local Whisper is heavy** (~250MB for small model, ~1.5GB for large) — even as opt-in, the download experience needs polish.

### Trade-offs accepted

- We accept **dependency on OpenAI for cloud STT** in exchange for **zero install bloat and good multilingual accuracy**.
- We accept **no voice output** in exchange for **shipping faster**. The "answer is a widget, not a voice" framing actually aligns with our positioning.
- We accept the **onboarding-wizard complexity** in exchange for **letting users choose their privacy posture upfront**, not as an afterthought.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "users wanted TTS for accessibility / multitasking, should have done MVP with system `say` integration" or "cloud STT created a friction we didn't anticipate (OpenAI key required), should have done local first."]

## Alternatives Considered

### Option A: Local STT only from day one

Whisper.cpp + small model bundled in installer.

**Why not for MVP:** 250MB-1.5GB download in installer is a hard drop-off. We can add this as opt-in (which we did) without forcing it on everyone.

### Option B: Full voice-to-voice in MVP

STT + TTS + back-and-forth voice flow.

**Why not:** Adds weeks of work. TTS quality is hard. Public-space usage of TTS is awkward (laptops in cafes). Defer to v2.

### Option C: No voice in MVP

Type-only.

**Why not:** Loses the "Voice in, widgets out" positioning. AgenticEngine becomes a Raycast-AI competitor — generic. Voice is the differentiation hook.

### Option D: Wake word ("Hey Engine") instead of push-to-talk

Always-on mic listening for trigger.

**Why not:** See [[0006-dual-hotkey-2zone-ux]] — privacy, battery, false-trigger problems.

## Related

- [[0006-dual-hotkey-2zone-ux]] — hold-hotkey is the push-to-talk mechanism
- [[../concept]] — voice is integral to differentiation pillar 1
- [[../roadmap]] — voice lands in Phase 4
- [[../open-questions]] — TTS and voice-to-voice questions remain open for v2
