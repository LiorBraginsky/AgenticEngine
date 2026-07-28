---
title: "Continuation affordance UX — how comparable assistants handle the post-answer moment (Siri as primary reference)"
date: 2026-07-28
status: current
purpose: input to the continuation-affordance brainstorm + roadmap route part 2 (Live Card vs Continuation Pill)
triggered-by: >
  ADR-0012's deliberately-left-open choice (Live Card vs Continuation Pill) + Lior directive 2026-07-28
  pointing at Apple Siri's self-dismiss behavior ("воно видаляє як я хотів") as the named primary reference
---

# Continuation Affordance UX — Research Report

> **Scope note.** This report answers an external-knowledge question (how do comparable products handle
> the post-answer moment) to feed the continuation-affordance brainstorm. It does **not** decide Live
> Card vs Continuation Pill — that is the brainstorm's / conductor's / Lior's call per ADR-0012 and
> PIPELINE §5.2. Every load-bearing claim below is marked **VERIFIED** (corroborated, primary or
> multi-source), **SINGLE-SOURCE** (one source, not independently corroborated), or **CONTESTED**
> (sources disagree or the claim is forward-looking/speculative).

---

## 1. Executive decision-grade summary

### What Siri actually does (the named reference) — and a caution about it

**Two different Siris are in play right now, and the distinction matters for what Lior is actually
pointing at.**

- **"Classic" Siri (the one in daily use today, July 2026, on essentially every shipped iPhone/Mac)**
  is the ephemeral, no-persistent-history experience: invoke it, get a spoken + on-screen answer, the
  answer surface **lingers, then self-dismisses** — either because you tap/navigate away, or on an
  inactivity timeout Apple has never published an exact duration for. Within that lingering window you
  can ask a **follow-up without re-saying "Hey Siri"** ("back-to-back requests," a real, named,
  Apple-shipped feature since iOS 17) — VERIFIED as a feature's existence, **UNVERIFIED for exact
  timing** (§2, §8). This is almost certainly the behavior Lior is referring to as «видаляє» — it
  removes itself, you didn't have to manage a window.
- **The newly-announced "Siri AI"** (Apple Newsroom, June 2026, WWDC26; full rollout targeted for iOS 27,
  ~September 2026 — **not shipped as of this report's access date**) is the *opposite* move: a
  **dedicated app** with **iCloud-synced, cross-device, persistent conversation history** — i.e. Apple's
  own next-generation Siri is walking *toward* the "ChatGPT-thread-in-the-corner" shape ADR-0012 Option B
  already rejected for us. This is a genuinely important, honest data point, not a footnote: **even the
  primary named reference is moving away from pure ephemerality for its deep-agentic mode.** (§2)
- **A caution baked into the "self-dismiss" praise:** a large, well-corroborated body of user complaints
  (Apple Discussions, AppleVis, multiple how-to sites) says Siri's classic answer card frequently
  **disappears before the user finishes reading it**, with no supported way to extend it. This is the
  textbook anti-pattern Nielsen Norman Group warns against for toast-style transient UI: *never
  auto-dismiss on a timer content the user still needs to read* (§6, VERIFIED, primary NN/g citation).
  **Lior's "removes itself" praise and this complaint are two sides of the same mechanism** — the
  research below argues they are actually reconcilable by separating "dismiss on inactivity/explicit
  close" (good, what he likely means) from "dismiss on an opaque fixed timer regardless of read-state"
  (bad, what many users are complaining about). Our own ADR-0006 "rule of three" (content persists until
  dismissed; only *status* chrome auto-times-out) already makes exactly this distinction and should not
  be walked back by this reference.

### The 2–3 design forks the brainstorm must decide

1. **Where does the follow-up affordance live?** *Inline, at the still-open answer* (Live Card; Siri's
   own back-to-back model; Gemini-for-Home's "Continued Conversation" mic-stays-open model) **vs.** *an
   explicit re-summon action carrying a context marker* (Continuation Pill; the closest real analog is
   Android's new "minimize Gemini to a floating bubble, tap to resume with context intact" — currently
   in beta, not yet GA).
2. **What triggers dismissal, and of what?** A pure inactivity/opaque timer (Siri classic — the thing
   users complain about) **vs.** explicit-only (Escape / click-away / a new request replaces the old one
   — the "light dismiss" web/OS standard, and already ADR-0006's rule) **vs.** the hybrid we already
   ship: *status* auto-times-out (~1–3s), *content* never does. Evidence below corroborates the hybrid
   as the industry-recognized correct answer (§6) — this is a place to **confirm, not re-litigate**, our
   existing ADR-0006 decision.
3. **Does a follow-up replace the answer in place, or does it stack/escalate?** Siri and Gemini-voice
   replace in place (one active response at a time). Raycast's Quick AI keeps an in-view running thread
   until you explicitly start fresh or "promote" it to a full chat window (a two-tier escalation, echoing
   our own June-2026 internal research's "Two-Tier Escalation" concept, previously deferred as
   needs-work). The line between "one more turn" and "now it's a transcript" is exactly the anti-vision
   line ADR-0012 draws — every reference product that avoids becoming a chat log replaces in place.

### Lean for OUR constraints (Tauri ephemeral overlay · agent-not-chatbot · voice+text co-equal · gotcha #45)

This is a lean, not a decision — flagged as such per the researcher mandate.

- The evidence supports **replace-in-place + explicit/hybrid dismiss** (fork 2 and 3) as close to settled
  best practice, and it is what ADR-0006 already ships — treat this research as **confirmation with one
  caution** (don't regress toward Siri's "disappears while I'm still reading" complaint if a text
  follow-up window gets its own timer).
- Fork 1 (Live Card vs Pill) is genuinely still open, and the strongest real-world precedent for *each*
  side comes from a **different modality**: Siri/Gemini's voice-follow-up-without-rewake is structurally
  a **Live-Card-shaped idea carried by voice** (the channel stays open at the answer, no re-summon
  action); Android's emerging "minimize-to-bubble, tap-to-resume-with-context" is structurally a
  **Continuation-Pill-shaped idea for text/visual**. This suggests the fork may not need to be resolved
  as one-size-fits-both-modalities — voice's natural analog is Live-Card-like linger, text/visual's
  natural analog is Pill-like re-summon-with-badge — which also matches this team's own prior internal
  finding that voice is under-designed across concepts (`project_conversational_interaction_model`,
  GAPS item 1). Worth putting in front of the brainstorm explicitly rather than assuming one affordance
  must serve both.
- No reference product in this study cleanly solves gotcha #45 (fire-and-continue while the agent works)
  — the closest attempt is Android's *not-yet-shipped* Gemini "minimize instead of dismiss" beta, which
  is exactly a background-continuation pattern. It's evidence the industry sees the same gap, not a
  ready-made solution.

---

## 2. Apple Siri / Apple Intelligence (primary reference) — detailed findings

### 2.1 Two Siris — the timeline that matters for reading Lior's reference

- Apple's official WWDC26 announcement (Apple Newsroom, dated in the `2026/06` URL path — i.e. June 2026)
  introduces **"Siri AI"**: "an all-new dedicated Siri app" that users can open "when [they] want to
  revisit a past conversation or kick off a new one," which "uses iCloud to privately sync conversational
  history across a user's products, so they can start chatting with Siri on Mac and continue the
  conversation on iPhone, iPad, Apple Watch, or Apple Vision Pro." It also states users can "extend
  almost any response from Siri into a rich conversation and ask follow-up questions," and gives Siri
  "onscreen awareness" (can answer about on-screen content).
  **VERIFIED** — primary source, Apple's own newsroom.
  [Apple Newsroom, "Apple introduces Siri AI…"](https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/) (accessed 2026-07-28)
- Rollout timeline is contested-in-particulars but **directionally corroborated across many
  independent tech-press outlets**: the Gemini-backed overhaul was reported delayed out of iOS 26.4
  ([9to5Mac, 2026-02-11](https://9to5mac.com/2026/02/11/apple-reportedly-pushing-back-gemini-powered-siri-features-beyond-ios-26-4/)),
  Google itself confirmed a 2026 target
  ([MacRumors, 2026-04-22](https://www.macrumors.com/2026/04/22/google-gemini-powered-siri-2026/);
  [AppleInsider, 2026-04-22](https://appleinsider.com/articles/26/04/22/google-confirms-context-aware-siri-built-from-gemini-will-debut-in-2026)),
  and secondary aggregation places the **standalone app + persistent history** specifically at **iOS 27
  (~September 2026)**, i.e. **not yet shipped** as of this report (VERIFIED as "announced, not yet
  broadly available"; exact ship date **CONTESTED/single-outlet-synthesized** —
  [vertu.com timeline](https://vertu.com/ai-tools/siri-google-gemini-upgrade-complete-timeline-and-new-features-guide-2026)).
- The **visual redesign** (glowing Dynamic-Island-anchored effect) is reported by Bloomberg's Mark Gurman
  via 9to5Mac, explicitly **not officially confirmed by Apple**, and the article itself notes designs
  "could change by June" — **SINGLE-SOURCE / rumor-grade**.
  [9to5Mac, 2026-04-19](https://9to5mac.com/2026/04/19/apple-has-already-teased-siris-new-design-coming-in-ios-27/) (accessed 2026-07-28)

**Why this matters:** the Siri that Lior experiences day to day right now, and almost certainly the one
he's pointing at, is **classic Siri** — the sections below are about that one, and the "Siri AI" app is
flagged separately as a *contrary industry signal* (§1), not folded into "what Siri does."

### 2.2 Classic Siri's post-answer behavior

- **Follow-up without re-invoking "Hey Siri."** Apple has shipped "back-to-back requests" since iOS 17
  on iPhone 11 / SE (2nd gen) and later — you can ask a second question right after the first without
  saying the wake phrase again. Existence of the feature is **VERIFIED** (multiple corroborating
  consumer tech outlets in search results, e.g. Tom's Guide, MacRumors-adjacent coverage); **the exact
  listening/linger window in seconds is UNVERIFIED** — no Apple documentation surfaced states a number.
- **The search/answer field stays visible "until you close it."** Apple's own iPhone Siri guide content
  (via `support.apple.com` "Use Apple Intelligence with Siri on iPhone") describes the field as
  remaining on screen so you can continue interacting, rather than auto-hiding immediately —
  **SINGLE-SOURCE** in the sense that I could not independently re-fetch the exact verbatim paragraph
  (Apple's support pages render as navigation-only to automated fetch tools); treat as **medium
  confidence**, attributed to Apple support content, not directly re-verified word-for-word here.
- **Self-dismiss without a published timing spec.** A large, consistent body of first-person complaints
  (Apple Discussions threads, AppleVis accessibility forum, multiple "how to stop Siri answers
  disappearing" articles) describes the on-screen answer **auto-hiding after a few seconds**, with users
  actively looking for (and not finding) a supported way to make it linger longer. **VERIFIED that the
  behavior exists and frustrates a real user population; UNVERIFIED for exact default seconds** — Apple
  does not publish this number anywhere I could find, including the official HIG (§2.4).
  [Apple Discussions thread](https://discussions.apple.com/thread/255719775),
  [AppleVis forum thread](https://www.applevis.com/forum/ios-ipados/how-do-i-stop-siris-answers-disappearing-my-iphone-screen-so-fast)
  (accessed 2026-07-28)
- **A commonly-cited "fix" is actually a different setting.** Search summaries conflated "Siri Pause
  Time" (Settings → Accessibility → Siri; **VERIFIED** via Apple's own support-guide titles, e.g.
  [support.apple.com "Change Siri accessibility settings on iPhone"](https://support.apple.com/guide/iphone/change-siri-accessibility-settings-iphaff1d606/ios))
  with the answer's on-screen linger duration. **They are not the same thing**: Siri Pause Time governs
  *how long Siri waits for you to finish speaking* before it starts processing, not how long the answer
  card stays visible afterward. This is a genuine, worth-flagging correction — no user-facing setting
  controls the answer's visual linger.
- **No visible chat-log/transcript in classic Siri.** Nothing in official documentation or the community
  material surfaced describes a persistent, revisitable transcript in classic (pre-"Siri AI") Siri — this
  is consistent with Apple's own framing of the *new* Siri AI app's persistent history as a genuinely new
  capability (§2.1), implying classic Siri did **not** have it. **VERIFIED by absence** (nothing found
  claiming classic Siri kept history; the new-app announcement explicitly frames history-sync as new).
- **Type to Siri.** Confirmed to keep the text entry box visible below results specifically so a
  follow-up can be typed without re-triggering Siri — **SINGLE-SOURCE** (AppleInsider/PopSci-style
  how-to coverage; could not obtain a primary Apple citation with exact wording).
- **macOS Siri panel.** Behaves as a floating panel (menu-bar / hotkey activated) with a close control;
  I could **not** find primary documentation of its auto-dismiss timing, and treat the corner-panel
  analog to our own `widget` window as **plausible but UNVERIFIED** on timing specifics.

### 2.3 The redesign (glow, Dynamic Island, avatars) — status: unconfirmed by Apple

Per §2.1: reported by Gurman/Bloomberg via 9to5Mac and similar outlets, explicitly speculative, subject
to change before any official reveal. **Do not treat as settled** — flagged **SINGLE-SOURCE /
rumor-grade** throughout.

### 2.4 Apple HIG — what Apple *does* and *doesn't* officially prescribe

Apple's Human Interface Guidelines Siri section (`developer.apple.com/design/human-interface-guidelines/technologies/siri`)
gives **behavioral** principles — "respond quickly and minimize interaction," "people don't always look
at the screen," apps may supply custom content that should "feel like it belongs in Siri," don't
impersonate Siri, don't advertise — but **contains no published numeric guidance on response linger
duration, dismissal timing, or transcript/history policy.** This was independently confirmed against two
renderings of the guidance (the live Apple Developer page and an iOS HIG mirror). **VERIFIED absence** —
this is the report's clearest "Apple does not tell you the number" finding, worth stating plainly to the
brainstorm rather than implying a spec exists.
[Apple Developer HIG — Siri](https://developer.apple.com/design/human-interface-guidelines/technologies/siri/introduction) (accessed 2026-07-28)

---

## 3. ChatGPT — Advanced Voice Mode + macOS desktop companion

- **The macOS companion window is explicitly persistent, not ephemeral.** OpenAI's own materials
  describe it as staying "in front of all other windows," reopenable to its last state, customizable in
  position — this is a **docked utility window**, not a summoned-and-dismissed overlay.
  **VERIFIED**, primary-adjacent (OpenAI's own X announcement + `help.openai.com`).
  [help.openai.com, "Work with Apps on macOS"](https://help.openai.com/en/articles/10119604-work-with-apps-on-macos) (accessed 2026-07-28)
- **Advanced Voice Mode now runs inside the existing chat rather than a separate orb screen**, and
  explicitly **adds a transcript to the chat afterward** — i.e. ChatGPT's direction has been to merge
  voice *into* the persistent transcript, the opposite of ephemeral-and-gone.
  **VERIFIED**, corroborated across MacRumors and several secondary AI-news outlets.
  [MacRumors, 2025-11-26](https://www.macrumors.com/2025/11/26/chatgpt-voice-mode-update-seamless-chat/) (accessed 2026-07-28)
- **Net for our purposes:** ChatGPT's whole shape — persistent companion window + persistent transcript
  — is a live instance of the exact "ChatGPT-thread-in-the-corner" pattern ADR-0012 Option B already
  rejected. It is useful here only as the **negative reference** (what NOT to build), not as UX to
  emulate.

---

## 4. Google — Gemini / Assistant

- **"Continued Conversation" (Gemini for Home)** — Google's own blog: after a request, the mic "will
  remain active for a few additional seconds" so a follow-up needs no repeated wake word; ends on
  "thank you"/"stop" or a silence timeout. **VERIFIED, primary source (Google's own blog).**
  [blog.google, "Continued Conversation…"](https://blog.google/products-and-platforms/devices/how-to-use-gemini-continued-conversation/) (accessed 2026-07-28)
  (Historical note: the original Google Assistant version of this feature used an **8-second** no-speech
  timeout per 2018-era TechCrunch coverage — cited as **historical/legacy context only**, not confirmed
  as the current Gemini-for-Home number.)
- **The current Android Gemini overlay dismisses the whole session on tap-away or app-switch** — i.e.
  today's shipped behavior is "all-or-nothing": leaving the overlay ends the task. **VERIFIED**,
  corroborated across three independent tech-press write-ups.
- **A beta-stage "minimize instead of dismiss" upgrade is in testing** (not GA): a "Minimize Gemini"
  button collapses the overlay to a small floating bubble that **keeps the session alive in the
  background**; the user can multitask and get a completion notification, then **swipe to fully close**
  when done. This is architecturally the closest real-world instance of a **Continuation Pill** found in
  this study — a small persistent handle that preserves context and is dismissed by an explicit gesture.
  **VERIFIED as an existing beta feature description, but not yet shipped/GA** — treat directionally, not
  as a mature, battle-tested pattern.
  [Android Authority](https://www.androidauthority.com/gemini-overlay-multitasking-3627623/),
  [Android Headlines](https://www.androidheadlines.com/2026/06/google-tests-minimize-gemini-overlay-android-multitasking.html),
  [BigGo News](https://biggo.com/news/202512242220_gemini-android-overlay-multitasking-update) (accessed 2026-07-28)
- This is directly relevant to **gotcha #45** (single-session, can't fire-and-continue) — Google is
  visibly solving the *identical* problem, in beta, right now, with almost exactly the shape our roadmap
  route part 5 (concurrent threads/background) anticipates. Worth flagging to the conductor as
  corroboration that this is a real, industry-recognized gap, not a self-invented one.

---

## 5. Launcher-class tools (closest to our overlay paradigm)

### 5.1 Raycast — the most directly comparable precedent

Fetched directly from Raycast's own manual (`manual.raycast.com/ai/chat`) — **VERIFIED, primary source.**

- **Quick AI** appears **in the same window as Root Search** (i.e. inline, at the query surface) — the
  closest real-world **Live Card** analog: "Keep typing after a response to ask a follow-up. Quick AI is
  a full conversation, not a single-shot Q&A."
- **AI Chat** is a **separate, dedicated window** ("lives in its own window, so you can keep it alongside
  whatever you're working on") with a persistent sidebar of pinned/foldered/recent/archived chats — this
  is the **heavier, transcript-bearing tier**, structurally the same shape as our own internal 2026-06-03
  research's "Two-Tier Escalation" concept and *exactly* the surface ADR-0012 rules out as our default.
- **Explicit escalation, not automatic:** `Cmd/Ctrl+J` **promotes** a Quick AI conversation into full AI
  Chat — a deliberate user action carries the conversation from the light tier to the heavy tier. This is
  a clean precedent for "if a follow-up chain earns more room, the user asks for it explicitly" rather
  than silently ballooning.
- **Auto-dismiss-to-fresh on inactivity:** Raycast's "Auto-new Chat" starts a fresh chat automatically
  "after a period of inactivity," specifically to prevent accidental message-appending to a stale
  conversation. This is a directly reusable, named precedent for **self-dismiss-by-inactivity as a
  designed feature**, not an accident — closer to what we'd want to consciously design than Siri's
  undocumented timeout.
  [Raycast Manual — Chat](https://manual.raycast.com/ai/chat) (accessed 2026-07-28)

### 5.2 Perplexity macOS app

- A universal "both-Cmd-keys" shortcut opens a **Command Bar**; the desktop app supports **threaded
  conversations** where the assistant "recalls details from past chats." **SINGLE-SOURCE** (one primary
  tech-press write-up, 9to5Mac); no independent corroboration found on dismiss-on-focus-loss specifics,
  and the app appears to lean toward the persistent-thread model (like ChatGPT/Raycast AI Chat) rather
  than ephemeral-card. Flag as **weak evidence, not decision-grade** for the ephemeral side of this
  question.
  [9to5Mac, 2026-05-07](https://9to5mac.com/2026/05/07/perplexity-ai-app-introduces-all-new-native-mac-experience-for-personal-computer/) (accessed 2026-07-28)

### 5.3 Alfred / macOS Spotlight

- **Alfred** does not have a native, well-documented AI follow-up/chat model comparable to Raycast's;
  search turned up nothing decision-grade on its dismiss behavior for AI-specific flows. **Gap, not a
  finding** — do not cite Alfred as evidence either way.
- **macOS Spotlight** is single-shot per query by design — no conversational follow-up concept at all,
  dismiss is immediate on Escape or click-outside. This matches general, well-established knowledge of
  Spotlight's behavior, but no fresh citation was fetched to re-verify it for this report; treat as
  **background/common-knowledge, not independently re-verified today.**

---

## 6. Ephemeral-answer hardware (cautionary references)

### 6.1 Humane AI Pin

- **Interaction model:** "touch and hold" the touchpad/Pin to talk — a push-to-talk shape directly
  analogous to our own hold-to-talk voice hotkey. **VERIFIED**, primary source (Humane's own support
  docs).
  [support.humane.com, "Touchpad gestures"](https://support.humane.com/hc/en-us/articles/22369758732173-Touchpad-gestures) (accessed 2026-07-28)
- **Documented UX failures** (corroborated across multiple independent reviews — Core77, Infinum,
  Engadget, and others): the Laser Ink palm-projected display required holding your arm up to see
  anything, showed only a handful of words per line, and follow-up/conversational reliability was
  undermined by **multi-second processing waits and a meaningfully high failure rate on requests**.
  **Lesson is decision-grade (the affordance model was undermined by latency/reliability, not
  necessarily by the affordance itself); specific numbers in secondary coverage (e.g. "~10 seconds,"
  "about half of calls") are UNVERIFIED single-pass figures from aggregated review summaries, not
  independently re-confirmed against a primary benchmark** — flagged per this team's own established
  convention (see `prior-art-findings` memory: "lessons decision-grade, specific metrics UNVERIFIED").
  [Core77](https://www.core77.com/posts/131842/The-Horrific-UIUX-Design-of-Humanes-AI-Pin"),
  [Infinum](https://infinum.com/blog/ai-pin-ux-design-review/) (accessed 2026-07-28)
- **Transferable lesson:** a good conversational-continuation *shape* (hold-to-talk, ask a follow-up)
  is worthless if the underlying latency/feedback loop breaks trust — this is squarely our own gotcha
  #43 (no thinking/progress feedback) territory, corroborated from a different product's failure mode.

### 6.2 Rabbit R1

- **Follow-up questions worked** at a basic level (context retained across a couple of turns) per
  contemporary reviews, but the **original UX shipped with no way to dismiss stale cards and no visible
  confirmation of what was heard**, causing users to repeat themselves.
- **The OS2 update added an explicit manual-dismiss gesture** (swipe left to dismiss a card) and
  **real-time transcript display while listening** (so the user can see what the device thinks it heard
  before it responds). **VERIFIED, corroborated across Gizmodo/Tom's Guide/Yanko Design.**
  [Yanko Design](https://www.yankodesign.com/2025/09/09/rabbit-r1s-os-update-features-a-new-interface-and-speech-to-vibe-coding-abilities/) (accessed 2026-07-28)
- **Transferable lesson (directly reusable for us):** relying on *only* an implicit/timeout dismiss was a
  real, shipped mistake that had to be patched with an **explicit manual-dismiss gesture** — this is a
  cautionary corroboration for keeping ADR-0006's `× Close` / Escape affordance (already shipped) rather
  than trusting an inactivity timer alone. Real-time listening feedback is the same lesson as our own
  gotcha #43.

---

## 7. The design pattern itself — named HCI patterns + auto-dismiss timing norms

- **"Light dismiss"** is the canonical, named, cross-platform term for "a transient surface closes on
  tap/click outside, Escape, or an equivalent back/cancel action." Documented by Microsoft (Fluent/WinUI
  Flyouts — "Flyouts can be closed with a quick light dismiss action, including: Tap outside the flyout,
  Press the Escape keyboard key, Press the hardware or software system Back button, Press the gamepad B
  button") and by the web-standard **Popover API** (`popover="auto"` — "the popover can be 'light
  dismissed' — this means you can hide the popover by clicking outside it," plus Escape).
  **VERIFIED, primary, dated.**
  [Microsoft Learn — Flyout controls](https://learn.microsoft.com/en-us/windows/apps/design/controls/dialogs-and-flyouts/flyouts) (page `updated_at: 2026-06-25`, accessed 2026-07-28);
  [MDN — Using the Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using) (accessed 2026-07-28)
- **Auto-dismiss timing for transient *status* messaging is a settled industry number: ~4–10 seconds**
  (Material Design's Snackbar spec — "Snackbars automatically disappear from the screen after a minimum
  of four seconds, and a maximum of ten seconds"), corroborated by its adoption pattern across Android's
  own Material Snackbar API, Angular Material, and MUI's Snackbar component (all point back to the same
  M2 spec). **VERIFIED, decision-grade, but scoped specifically to passive/status notifications, not
  content.**
  [Material Design — Snackbars (M2)](https://m2.material.io/design/components/snackbars.html) (accessed 2026-07-28)
- **The load-bearing principle for *content*: never auto-dismiss on a timer something the user must still
  read or act on.** Nielsen Norman Group, fetched directly: toasts are "a small nonmodal popup that
  disappears after a few seconds," appropriate for passive notifications, and explicitly **not**
  appropriate when the message matters — their own case study describes a user who "spent 5 minutes
  waiting for some content to load only because she hadn't noticed the little error message... that
  quickly faded away after 5 seconds." **VERIFIED, primary, directly fetched.**
  [NN/g — Indicators, Validations, and Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/) (accessed 2026-07-28)
- **This is precisely the distinction our own ADR-0006 "rule of three" already encodes** (content
  persists until dismissed; status auto-dismisses ~1–3s; picker-confirmation ~1200ms) — the research
  **confirms** the existing shipped decision rather than surfacing a reason to change it. Worth stating
  to the brainstorm plainly: **don't relitigate the content/status split; it's already right by the
  industry's own standard.**
- **"Ephemeral UI" as a named pattern for AI-generated on-demand interfaces** is emergent
  terminology, found in a single design-blog source (Medium/isolutions) describing "designing experiences
  that assemble and disassemble interfaces on demand." **SINGLE-SOURCE, informal — not an established
  HCI canon term** the way "light dismiss" or "toast/snackbar" are; useful as color, not as a citable
  standard.

---

## 8. Mapping to our Live-Card-vs-Continuation-Pill binary — the money section

| Pattern found | Closest real product(s) | Shape | Maps to |
|---|---|---|---|
| Channel stays open at the answer; follow-up needs no re-summon action; self-closes on inactivity or explicit action | Classic Siri "back-to-back requests"; Gemini-for-Home "Continued Conversation" (voice, mic stays hot a few seconds) | Reply lands **at** the still-live answer, no separate re-invoke step | **Live Card**, carried by voice as the natural modality |
| Answer/session collapses to a small persistent handle; tapping it resumes with context; explicit gesture fully closes | Android Gemini overlay's beta "minimize to floating bubble … swipe to close" | Explicit collapse-and-resume, context preserved in the handle | **Continuation Pill**, carried by visual/text as the natural modality |
| Inline follow-up within one light view; explicit promotion to a heavier, persistent, transcript-bearing tier | Raycast Quick AI → `Cmd+J` → AI Chat | Two-tier: light default, heavy on request | Echoes our own June-2026 internal "Two-Tier Escalation" concept (previously deferred, needs-work) — **not** literally Live Card or Pill, a third shape worth the brainstorm re-weighing now that a real precedent exists |
| Persistent docked window, full retained transcript, reopens to last state | ChatGPT macOS companion window; ChatGPT Advanced Voice Mode (now inside chat + transcript appended); the announced (not-yet-shipped) "Siri AI" app with iCloud history sync | Always-there, chat-log-shaped | The **anti-pattern** — ADR-0012 Option B, already rejected; useful only as "what not to become" |
| Implicit-only dismiss, patched later with an explicit manual gesture after user complaints | Rabbit R1 (pre-OS2 → OS2's added swipe-to-dismiss) | Cautionary: don't ship implicit-dismiss-only | Reinforces keeping ADR-0006's explicit `× Close`/Escape alongside any timeout, for whichever fork wins |

**Reading across the table:** no mainstream reference product is a pure, unmodified instance of either
of our two named options — both "Live Card" and "Continuation Pill" as ADR-0012 frames them are closer
to **novel combinations** than off-the-shelf patterns, which matches our own prior internal research's
conclusion that Live Card in particular is "the genuinely novel pattern... nobody couples a non-activating
widget with inline reply." The clearest, most load-bearing transferable findings are not "which one
wins" but:

1. **Voice and text/visual may want different affordances** — Siri/Gemini's voice-follow-up model is
   structurally Live-Card-shaped; the emerging Android visual-overlay model is structurally
   Pill-shaped. The binary might not need a single universal winner.
2. **The dismiss-timing question is already answered by our own shipped ADR-0006 rule** and is
   independently corroborated by NN/g + Material Design: status auto-dismisses briefly, content never
   does on a timer alone.
3. **An explicit manual-dismiss control must coexist with any inactivity/timeout logic** — every hardware
   cautionary tale that shipped implicit-only dismiss had to retrofit an explicit one.

---

## 9. What I could NOT verify (honest gaps)

- **Apple has never published an exact number of seconds** for how long a classic Siri answer card
  lingers before self-dismissing, nor for how long the "back-to-back requests" follow-up window stays
  open. This was checked against the official HIG (§2.4), the iPhone/Mac support guides, and community
  troubleshooting threads — none contain a published figure. Treat any "X seconds" claim about Siri's
  timing (including the "8 seconds" figure, which is **Google Assistant's**, not Siri's) as folklore
  unless a primary Apple source surfaces one later.
- **Whether classic Siri lets you scroll up within a single live session to see the prior Q&A pair**
  before it fully dismisses — plausible from general product familiarity, but no citable primary or
  secondary source confirming this mechanic was found in this pass. Do not cite this report as
  confirming it.
- **Exact rollout date for the new "Siri AI" app / iOS 27** — reported consistently as "targeted for
  2026," specifically iOS 27 (~September 2026) in secondary aggregation, but this is a fast-moving,
  previously-delayed-once story; treat the date as provisional.
- **Perplexity's and Alfred's exact dismiss-on-focus-loss behavior** — genuinely thin evidence in both
  cases; do not lean on either as a citable precedent in either direction.
- **Exact Humane AI Pin / Rabbit R1 failure-rate and latency numbers** cited in secondary review
  aggregation (e.g. "~10 seconds," "about half of calls," "5 home runs" anecdote) are **UNVERIFIED**
  single-pass figures from review-summary syntheses, not independently re-derived from primary review
  transcripts — the qualitative lesson (latency/reliability undermines an otherwise-sound follow-up
  affordance) is decision-grade; the specific numbers are not.

---

## Related

- [[../adr/0012-conversation-and-memory-model]] — the open Live Card vs Continuation Pill choice this
  report feeds (decision 3, "Deliberately left open" section).
- [[../adr/0006-dual-hotkey-2zone-ux]] — the two-zone overlay + "rule of three" dismiss policy this
  report's §6/§7 findings corroborate rather than contradict.
- [[../known-gotchas]] #45 — the concurrent-session gap this report's §4 (Android Gemini "minimize"
  beta) is directly relevant to.
- Project memory `project_conversational_interaction_model` — the 2026-06-03 internal behavioral-UX
  study (Live Card / Continuation Pill / Two-Tier Escalation / Soft-Close concepts) this report's §8
  cross-references against real-world precedent.
- Project memory `project_prior_art_findings` — the "lessons decision-grade, specific metrics
  UNVERIFIED" convention this report follows for the hardware cautionary tales (§6).
