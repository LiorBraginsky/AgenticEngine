---
title: Voice mode (route part 3) — design (IN PLANNING)
status: draft — PLANNING, do-not-build; part of the conversational-surface arc (continuation + voice + settings planned together, built after all three specs exist — Lior 2026-07-28). Voice + minimal settings are FIRST in the build order. This pass also RESOLVED the arc's cross-cutting question (chat-view) → the arc gains a 4th member, sequenced last.
date: 2026-07-28
deciders: [lior]
feeds: (arc) — build order = voice + minimal settings first, continuation next, chat-view last
related:
  - adr/0007-voice-mvp-strategy.md (push-to-talk + cloud-STT-first + NO TTS — held intact by the scope cut; one wording note owed, see §Amendments owed)
  - adr/0012-conversation-and-memory-model.md (decision 2 = voice/text one contract, honored literally; decisions 3 & 4 need a RIDER for chat-view — §5.2 gate)
  - adr/0006-dual-hotkey-2zone-ux.md (p.1 hold-hotkey + "no visual panel needed" — two amendment notes owed)
  - adr/0013-daemon-memory-write-http-surface-caller-auth.md (the token-gated HTTP posture the audio upload rides)
  - adr/0017-embedding-provider-plane-and-egress-posture.md (precedent for a local model + model_id lifecycle → the STT model-manager follow-on)
  - specs/2026-07-28-continuation-affordance.md (the widget states voice reuses; its §Open is resolved here)
  - research/2026-07-28-continuation-affordance-ux.md (Siri/Gemini voice-follow-up findings)
  - roadmap.md ("CONVERSATIONAL-SURFACE ARC" callout — the sequencing of record)
  - known-gotchas.md #45 (single-session guard — voice must not harden it)
tags: [spec, draft, voice, stt, overlay, ux, north-star, arc]
---

# Voice mode — design (in planning)

> **Planning status.** Walk-away-safe home for the voice design. **Do not build yet** — per the arc
> ruling the three (now four) surfaces are planned first. What is **Decided** below is firm; what is
> **Open** is deliberately carried.

## Origin

Roadmap route part 3. Brainstormed 2026-07-28 (Jimmy session, seed brief
`agent-prompts/voice-mode-brainstorm.md`) directly after the continuation-affordance pass, because
Lior's ruling was that continuation, voice and settings are one synergistic surface. Voice was to
follow a "similar tactic" to continuation — this spec is that mapping, plus the resolution of the
arc's cross-cutting north-star question.

Lior's own reference point for the input experience: **superwhisper** ("я бачу, що голос іде на
input") — a visible live-level indicator at the moment of speaking.

**Code state at design time:** voice is **0% built**. No `whisper` / mic / `getUserMedia` anywhere.
Exactly **one** global hotkey is registered (`CommandOrControl+Shift+Space`,
`apps/overlay/src-tauri/src/lib.rs:81`) and its handler reacts only to `ShortcutState::Pressed`.
ADR-0006's second (voice) hotkey does not exist yet.

## Scope of this pass

**IN:** voice **input** only — hotkey → speak → STT → the transcript becomes a turn on a thread; the
answer is the existing widget.
**OUT (Lior, explicit):** voice **output** / TTS / voice-to-voice. ADR-0007's "no TTS, no
voice-to-voice" therefore **stands unamended**. Settings carries a **disabled "voice output — coming
soon"** slot so the direction is visible without being built.

> **Design-session note (recorded so it isn't re-litigated):** voice-to-voice *was* raised mid-brainstorm
> (agent speaks the answer back, with a speaking indicator in the widget) and would have reopened
> ADR-0007's decision line and its "the answer is a widget, not a voice **actually aligns with our
> positioning**" accepted trade-off. Lior cut it to a coming-soon settings slot instead. The cheapest
> future path, if it returns: **TTS as a rendering mode of the `text` primitive on the frontend**
> (`speechSynthesis` / `say`) behind a swappable `TTSProvider` — this keeps `@agentic/protocol`
> byte-unchanged (frozen surface) and matches ADR-0005's per-frontend-native-renderer posture. Barge-in
> (hotkey during speech = stop + record) would become mandatory the moment it lands.

## Decided (firm)

### D1 — Hotkey 2 is voice mode; the gesture is a SETTING, not a fixed choice

A second global hotkey enters voice input. The gesture is user-configurable:

- **`hold`** — mic live while held, release sends (ADR-0006 p.1 / ADR-0007 as written), **or**
- **`toggle`** — tap starts, **tap again sends** ("натискаємо хоткей 2 знову це release").

**`Esc` cancels** in both modes (records nothing, sends nothing).

**Cost of offering `toggle`, named:** `hold` gives free endpointing (the human marks the phrase
boundaries) and a free privacy property (the mic physically cannot stay on). `toggle` gives up both →
it **requires** silence auto-stop (VAD) + a hard duration cap (see D8). Both are in D8 regardless, so
the marginal cost is the VAD dependency itself.

### D2 — Fire-on-release: the transcript goes straight to the agent (variant A)

On send, the transcript becomes a **turn on a thread** immediately. It does **not** land in the text
input panel for review/editing first (that variant was weighed and rejected: if you must look at the
centre of the screen and press Enter anyway, typing is cheaper — it kills the point of voice).

**Accepted consequence:** STT-error feedback is **indirect** — you notice a misrecognition from a
strange answer, or later in chat-view. There is deliberately **no** "here's what I heard, confirm?"
step. The one exception is the busy case (D11), where the transcript *does* land as editable text.

### D3 — Voice in, the SAME widget out

A voice turn produces exactly the same answer widget as a text turn, with the same
auto-minimize/hover-pause/expand machinery from
[[specs/2026-07-28-continuation-affordance]]. There is **no** separate "voice widget". This is the
literal reading of **ADR-0012 decision 2**: one behavioral contract, two input affordances, one output.

### D4 — Indicator placement rule (Lior's words, verbatim shape)

- **New conversation** → the indicator (live **voice waves**) appears **in the centre** of the screen,
  the same zone ADR-0006 assigns to input.
- **A widget is already open** → the indicator is **born inside that widget, in the reply-input slot**.

This is the exact voice analogue of continuation's text affordance: text's expanded widget focuses an
inline reply input; voice's replaces that same slot with the listening indicator. One slot, two
modalities.

### D5 — Three distinct status states, not one

`listening` (moving waves) → `transcribing` (waves stop; pulse/shimmer while the STT round-trip runs,
0.5–3 s) → `agent thinking` (the existing thinking indicator). Conflating them makes a network wait
look like a dead mic. All three are **status** chrome, so ADR-0006's rule-of-three lets them
self-dismiss on a timer.

### D6 — No transcript on the widget; the user's own utterance lives in chat-view

Rejected (Lior): showing "what I heard" as a label on the minimized/expanded widget — there is no
natural place for it in the state sequence (indicator → thinking → answer text). The user's own
utterance is read in **chat-view** (§Cross-cutting).

**Interim, until chat-view ships:** the only place to read a past utterance is the **Memory window's
thread-detail** view, which already exists (`apps/overlay/src/memory/render.ts:32`,
`controller.ts:78`). Recorded as an interim, not a gap.

### D7 — Continuation is ROUTING, not mic state

The mic lifecycle never changes (no follow-up window, no auto-open mic — ADR-0007 untouched). What is
context-aware is **where the turn lands**:

- a **live widget exists** (expanded or minimized) → the voice turn is added to **that thread**;
- **no live widget** → the turn starts a new thread.

**Why not a Siri-style follow-up window:** Siri's "speak again without re-saying Hey Siri" solves the
cost of *re-uttering a wake phrase*. Our invocation cost is **a keypress** — the problem does not
exist here, and an auto-open mic would trade a real privacy property for nothing. (Kept as an Open
opt-in, §O1.)

**Target thread:** there is only **one active thread** (architectural — Lior). Ambiguity when several
minimized widgets from different threads coexist is **route part 5** (concurrent threads), not here.

### D8 — Guard-rails (numbers are the defaults, all config-driven)

| Rail | Behavior |
|---|---|
| Too short / too quiet | `< 400 ms` **or** below a level threshold → **discard**, micro-status "nothing heard". Nothing reaches the agent or memory. |
| Hard cap | `60 s` → auto-stop and **send** what was captured (never silently lose a minute of speech), status "limit reached". |
| Silence auto-stop | `2.5 s` of silence → stop + send. **`toggle` mode only**; not applied in `hold`. |
| Focus | The overlay is shown for recording **without `set_focus()`** — pressing the voice hotkey must never eject the user from the app they were in (today's hotkey does call `set_focus()`, `lib.rs:91`). |

**Why the short/quiet rail matters beyond UX:** a junk turn is distilled into a **fact** and then
injected into every later thread. This is input hygiene at the entrance to long-term memory, not a
cosmetic filter.

### D9 — STT runs in the daemon; audio rides HTTP, never the frozen WS protocol

The overlay captures audio and **uploads it to the daemon**; the daemon calls the STT provider and
turns the text into a normal turn.

- **Why:** the provider key belongs in the **Keychain on the daemon side** (security-hardening pass);
  an overlay-side STT would put an API key in the frontend.
- **Transport:** a new **token-gated HTTP endpoint**, the same posture as `/memory/*`
  ([[adr/0013-daemon-memory-write-http-surface-caller-auth]]). **`@agentic/protocol` (WS) stays
  byte-unchanged** — no freeze gate.
- **Audio is NEVER persisted.** Only the transcript is stored (it *is* the archive message).
  Persisting audio would hand `forgetThread` (2e) and fact-forget a whole new erase surface right
  after we closed the text one.

### D10 — Voice↔text mixing within one thread is ALLOWED

Speak a turn, type the follow-up, speak again — all on the same thread. **This closes a
roadmap bounded-open item** ("voice↔text mixing within one thread").

### D11 — Voice while the agent is busy (gotcha #45): record → transcribe → land in the reply input

Pressing the voice hotkey while a request is in flight does **not** reject and does **not** send:
recording proceeds, and the transcript lands in the **reply input as editable pending text**, sent
**explicitly** by the user once the agent is free.

- **Never** silently refuse — the worst outcome is speaking into a void.
- **Never** auto-send when the agent finishes — twenty seconds later the context may have moved.
- **Structural requirement (the "don't harden the corner" part):** the busy check lives at **one
  seam** (`canAcceptTurn`-shaped), so route part 5 can later turn it into real queueing/routing
  instead of it being scattered across the voice path.
- **⚠️ Scope of "busy" (corrected 2026-07-28, same session):** this rule covers busy-because-the-agent-
  is-**thinking**. It does **NOT** cover busy-because-the-agent-**awaits-a-human** (a pending
  `button`/`input`/`color-picker` tool call) — there the agent is parked, not working, and the user must
  be able to keep talking. The seam therefore returns a **per-cause** verdict, not one boolean. See
  [[widget-lifecycle-model]] §3-C. Nothing changes for voice MVP (no awaiting widget can exist yet —
  only `text` ships), but the seam must not be written as a single boolean.

**Unverified:** Lior's suggestion to check how ChatGPT-class UIs handle input during generation was
**not researched** in this pass. Offered as a narrow `engine-researcher` pass; not commissioned.

### D12 — `STTProvider` seam now, model manager later

The provider and the model id are **config from day one** (`stt.provider`, `stt.model`) — the
[[adr/0010-pluggable-llm-provider-abstraction]] posture. Lior's request for **choosing / downloading /
deleting / installing** transcription models in settings is **accepted as direction but scoped OUT of
voice MVP** (his ruling: "менеджер потім"): it is a registry + download progress + checksums + disk
accounting + delete-while-in-use feature, and it only makes sense for the **local** STT branch (a
cloud API has nothing to download). Precedent for its eventual shape:
[[adr/0017-embedding-provider-plane-and-egress-posture]] (local-first model with a `model_id`
lifecycle).

### D13 — Language: `auto`, mixed-language accepted as unavoidable

Mixed UA/EN speech is the real usage pattern and cannot be designed away (Lior). Default
`voice.language = auto`; the mitigation is **model choice**, which is exactly what the (later) model
manager is for. **Framing constraint:** this is a language-**agnostic** requirement — mixed-language
input is a general STT property, and no Ukrainian-specific machinery is to be built (the product is
not positioned as Ukrainian-language; UA is the dogfood language only).

### D14 — Config-driven from day one → tray-settings-ready

Per the arc's customization constraint. Every value below is a config key before it is a UI control,
so the behavior→config→tray path is cheap.

| Key | Default / values |
|---|---|
| `voice.enabled` | `true` |
| `voice.hotkey` | accelerator (hotkey 2) |
| `voice.gesture` | **`hold` \| `toggle`** |
| `voice.minDurationMs` | `400` |
| `voice.maxDurationMs` | `60000` |
| `voice.silenceStopMs` | `2500` (applies in `toggle`) |
| `voice.inputDevice` | system default \| specific mic |
| `voice.language` | `auto` \| ISO code |
| `voice.whenBusy` | `queue-to-reply-input` (default) \| `reject` |
| `voice.minimizeMs` | separate key, same default as `text.minimizeMs` |
| `stt.provider` | `whisper-cloud` \| `local` |
| `stt.model` | `model_id` |
| `stt.apiKeyRef` | **Keychain reference, never the value** |
| `stt.models.*` | slot only — manager is a follow-on (D12) |
| `voice.output` | `widget-text` (only value in MVP) + **disabled `speak` = "coming soon"** |
| tray: mute mic | already promised by ADR-0006 p.4 |

## The arc's cross-cutting question — RESOLVED (chat-view)

The continuation spec carried one open north-star question: must a place exist to see what you
discussed, and in what shape. **Lior resolved it in this session.**

**chat-view = an EXPANSION of the answer widget into a chat-shaped view: a feed of the conversation
with the reply input at the bottom.** Not a new surface, not a threads browser, not memory — just the
**history of the conversation**, so you can see what you wrote "не заходячи в меморі і не копирсатись
по тредам".

**The load-bearing invariant (Lior's distinction, and the whole reason this isn't "ChatGPT in the
corner"):**

> **read-continuous / write-tail-only.** Reading is one continuous chronological history — scrolling
> **up** reveals **past conversations, separated by dividers**, lazy-loaded. Writing is possible
> **only into the live tail**. You cannot roam cross-thread: no sidebar, no thread picker, no
> branching, no replying into a past conversation.

**What it explicitly is NOT:** the "sidebar full of chats, chats, chats" shape Lior rejected at project
start. One ordered feed read as history ≠ a chat-management app.

**Widget states: three+** (extensible — later there will be other widget kinds, and widgets nested in
widgets; three only because today we render text):

1. `minimized` — the persistent handle,
2. `expanded` — the answer + inline reply input,
3. `chat-view` — the feed + the same reply input, opened by an explicit control.

`chat-view` is deliberately **not** the default expanded state: every answer opening as a chat window
in the corner is exactly the feeling being avoided, and it costs vertical space on the hot path.

**Sequencing:** chat-view is built **after voice + settings** (Lior) → the arc has **four** members:
continuation · voice · settings · chat-view.

### ⚠️ §5.2 gate — ADR-0012 rider owed (NOT self-accepted)

chat-view touches **ADR-0012 decision 3** (output is ephemeral widgets, *not* a persistent scrolling
chat log — the explicitly-rejected Option B) **and decision 4** (the user interacts with THREADS, not
one infinite feed). Both bend; neither is discarded:

- **decision 3** — the unit is still an ephemeral, dismissible widget; the feed is a *view* on turns,
  not a permanent transcript surface;
- **decision 4** — *interaction* stays single-thread (write-tail-only); only *reading* becomes
  continuous.

Proposed rider wording (to be gated by Lior when chat-view enters planning, **not** now): *"A
thread-scoped-writable, history-continuous transcript is allowed as an expanded state of the answer
widget. Read is continuous across past threads (dividers, lazy-loaded); write reaches only the live
tail. The widget remains ephemeral; no cross-thread navigation, no thread browser."* This is
**rider-sized, not a rewrite** — the same shape as the `minimize`-as-third-dismiss-state note.

### Notes handed to the chat-view design pass (recorded so it isn't re-derived)

- **New read API needed.** Today's memory HTTP surface is **per-thread** (`GET /memory/threads` +
  thread detail). A continuous scroll-up feed needs **chronological cross-thread message pagination** —
  a new endpoint, not a reuse.
- **Erased threads must render as tombstones, not gaps.** `forgetThread` (2e) leaves husks with
  `[forgotten]` content; the feed must show that explicitly, or history silently lies.
- **Facts survive source erasure** (ADR-0012 Ruling 2, structural) — the feed showing a forgotten
  thread's tombstone while a derived fact still exists is **correct**, not a bug. Do not "fix" it.
- **The Memory window stays authoritative** for per-thread operations (forget-thread, fact edit/forget,
  provenance). chat-view is a reading affordance; it does not absorb memory controls.

## Open — carried deliberately

- **O1 — Siri-style follow-up mic window as an opt-in setting.** `voice.followUpWindow.enabled=false`
  + `durationMs`. Weighed and set aside for MVP (D7). If ever enabled it needs an **ADR-0007
  amendment**, because it puts the mic on without an explicit hold.
- **O2 — the model manager** (D12) — its own feature, naturally after/inside settings.
- **O3 — the local STT branch.** ADR-0007 marks it opt-in; install size is 250 MB–1.5 GB. Note: the
  2d finding that **transformers.js is unusable on Bun** does *not* transfer — a whisper.cpp-class
  native binary is a different path than a WASM/onnx in-process model. Needs its own spike.
- **O4 — discoverability of the voice hotkey.** No mic icon anywhere (Lior, D4/D6) → discovery rests
  entirely on the hotkey + onboarding. Already a roadmap bounded-open ("discoverability of the reply
  affordance"); voice does not improve it.
- **O5 — how chat-UIs handle input during generation** (D11) — unresearched; narrow research pass
  available on request.
- **O6 — the onboarding wizard** ADR-0007 promises (cloud-vs-local choice at first launch). The arc's
  "minimal settings" build must decide whether it ships the wizard or only the settings keys.
- **O7 — mic permission (macOS TCC) flow** on first use, and what is shown when permission is denied.
  Mechanical, but nobody has specified it.

## Amendments owed

1. **ADR-0006 p.1** — two notes (**Lior authorized recording them at this stage**):
   (a) `hold hotkey` → **`hold | toggle` as a setting**; (b) *"No visual panel needed"* → voice gets a
   **visible status indicator** (centre for a new conversation, in-widget reply-input slot otherwise).
2. **ADR-0007** — the *decision* line survives (explicit per-turn user action, no wake word, cloud STT
   first, no TTS). But its stated positive *"mic never on unless user explicitly **holds** the key"* is
   **narrowed** by the `toggle` option → a wording note is owed at build time, with the mitigations
   named (visible indicator + silence auto-stop + hard cap + tray mute).
3. **ADR-0012** — the chat-view rider above, **at chat-view planning time, gated by Lior**.
4. **[[specs/2026-07-28-continuation-affordance]]** — its `§Open` is now answered; back-edit it when
   the arc closes (it is finalized last by design).

## Not deciding here

TTS / voice-to-voice (out by ruling; ADR-0007 stands) · the settings model itself and its UI (next arc
member) · chat-view's own design (feed pagination, virtualization, tombstone rendering — its own pass)
· concurrent threads / multi-widget targeting (route part 5, gotcha #45) · richer widget output
(route part 4) · the model manager (O2).

## Behavioral DoD sketch (for the eventual build, not a plan)

Per the repo norm that behavioral "done" needs runtime proof — a live demo must show, with a real mic
and real STT: speak → waves in the centre → pulse while transcribing → answer widget; speak again with
a widget alive → the indicator appears **in the widget's reply-input slot** and the turn lands on the
**same** thread; a typed follow-up on that same voice thread; `Esc` mid-record cancels with nothing
sent; a 0.2 s accidental tap produces **no** turn and **no** fact; `toggle` mode auto-stops on silence;
the voice hotkey pressed inside another app does **not** steal focus; a turn spoken while the agent is
busy shows up as **editable** pending text and is sent by hand; the transcript is readable in the
Memory window's thread-detail; and **no audio file exists anywhere on disk** afterwards.

## Next in the arc

**Settings brainstorm** (the third member) → then close/finalize all specs → build **voice + minimal
settings first**, continuation next, **chat-view last**.
