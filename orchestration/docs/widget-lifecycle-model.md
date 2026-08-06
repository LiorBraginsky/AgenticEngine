---
title: Widget lifecycle model — terminal vs awaiting widgets, and how a parked tool call coexists with conversation
status: NOTES — open model, do-not-build. Feeds roadmap route part 4 (richer widgets) and part 5 (concurrent threads / background). Candidate for an ADR-0002/0005 rider once a build actually needs it.
date: 2026-07-28
deciders: [lior]
related:
  - adr/0002-ui-as-tool-calls.md (a widget IS a tool call — the premise this model unpacks)
  - adr/0005-ui-contract-closed-set.md (the closed set whose members split into the two classes below)
  - adr/0009-text-display-only-ui-primitive.md (the repo already knows the split: `text` was deliberately made display-only)
  - adr/0001-interaction-pattern.md (ephemeral sessions + eviction — what an awaiting widget pins alive)
  - adr/0016-agent-memory-action-tools.md (precedent for a daemon-internal agent action plane — the family a widget-retire op belongs to)
  - adr/0006-dual-hotkey-2zone-ux.md (the widget stack of 3–5 this model gives rules for)
  - specs/2026-07-28-voice-mode.md (D11 — the `canAcceptTurn` seam this model CORRECTS)
  - known-gotchas.md #45 (single-session guard) · #30 (session eviction)
tags: [notes, widgets, tool-calls, lifecycle, concurrency, route-4, route-5]
---

# Widget lifecycle model (notes)

> **Not a spec, not a plan.** Captured 2026-07-28 during the chat-view brainstorm, when Lior's
> use-cases exposed that "one active thread" and "several live widgets" are not in conflict — and that
> one rule written in the voice spec is **wrong** for one of those use-cases. Recorded so the reasoning
> and the examples are not re-derived. **Build belongs to route 4 / route 5.**

## 1. The three things we conflate

- **thread** — the conversation (turn history, memory identity).
- **session** — one ephemeral agent run ([[adr/0001-interaction-pattern]]).
- **widget** — the rendering of **one tool call** belonging to some session.

**Consequence:** "several live widgets" does **not** imply "several threads." In a single turn the agent
may call `show_weather` *and* `show_color_picker`; both widgets belong to the same session in the same
thread. Multi-widget is already inside [[adr/0002-ui-as-tool-calls]] / [[adr/0005-ui-contract-closed-set]]
and is what ADR-0006's stack-of-3–5 anticipated. **Multi-thread** concurrency is the separate, harder
problem (route 5, gotcha #45).

## 2. Two classes of widget

The closed set splits along "does a response come back?":

| Class | Members (today) | Nature |
|---|---|---|
| **Terminal** | `text`, `image`, a weather card | The tool call is **complete**. The widget is a rendered result. Nothing upstream waits. Free to hang, minimize, dismiss. Holds no session open. |
| **Awaiting** | `button`, `input`, `color-picker` | A **suspended tool call**. The agent's turn is **not** finished — a loop upstream awaits a `tool_result`. **Pins a session alive**, has a lifetime, and its answer must route to a specific `tool_call_id`. |

[[adr/0009-text-display-only-ui-primitive]] is the repo already recognizing half of this: `text` was
deliberately made **display-only**.

> ☆ Alternative shape: one class with a `response_expected` flag. Fine as the *implementation* of the
> taxonomy; bad as a *replacement* for it — with a flag, every widget is potentially session-pinning and
> falls under eviction pressure, and the free property "terminal widgets cost nothing" disappears.

## 3. Rules (proposed, not yet ratified)

**A — an awaiting widget needs an explicit EXPIRED state.** Sessions are ephemeral and get evicted
(gotcha #30). If the user ignores a color-picker until its session dies, the click must say *"this can
no longer be answered"* — a dead click that silently does nothing is the worst failure of this class.

**B — dismissing an awaiting widget = CANCELLING the tool call.** It emits a `tool_result` of the
"user declined" shape so the loop can continue. Silently dropping it leaves an agent waiting forever
for an answer nobody will give. (Roadmap Phase 3 already lists "Cancellation handling — user closes
widget mid-flow"; this is what it means.)

**C — ⚠️ CORRECTED: awaiting-a-human is NOT "busy".** The first draft of this rule (in
[[specs/2026-07-28-voice-mode]] D11) unified two causes of "busy" — *agent is thinking* and *agent
awaits a `tool_result`* — behind one `canAcceptTurn` verdict. **Lior's GPU use-case (§4.2) falsifies
that:** when the agent is parked waiting for a human choice it is **not working**, and the user must be
able to keep talking. The corrected rule:

- **busy because thinking** → a new turn is **queued** as editable pending text (voice-spec D11 stands
  for this cause);
- **busy because awaiting a human** → **not busy**. The conversation continues; the pending call stays
  parked.

The seam stays **one place**; it just returns a per-cause verdict instead of one boolean.

## 4. The use-cases that drove this (keep them — they are the test suite)

### 4.1 Weather + color-picker + text, simultaneously

*"I asked for the weather in London — that widget just hangs. I invoked a color-picker that awaits my
answer. And a text widget where I'm talking to the agent."*

- All three: **one thread, one session, three tool calls.** No concurrency model required.
- Weather + text = **terminal**; color-picker = **awaiting**.
- Routing of the pick is unambiguous — back to its `tool_call_id`.
- **Stack rule that follows:** when a widget expands into chat-view, **terminal** widgets may collapse
  into a count badge, but **awaiting** widgets must stay visible — hiding one hides a parked agent.

### 4.2 The GPU-choice detour (the hard one)

*"I'm picking a graphics card. The agent renders three options and awaits my choice — but I want to ask
clarifying questions about those options first, which may need further research from it. Can it hold
the tool result while I ask? And how do we keep that choice widget from going stale — or should the
agent be able to close the choice itself if it considers it deprecated?"*

**The hard technical constraint nobody had noticed:** with the Messages API, every `tool_use` block
must be answered by a `tool_result` in the **immediately following** user message. You **cannot** slip
a plain user turn in while a tool call is unresolved. So "hold the result while we chat" is not
directly expressible on the wire.

**The only sane resolution (pattern to build later):**

1. Reply to the pending `tool_use` with a **synthetic "not yet" `tool_result`** — *"the user has not
   chosen; they are asking a follow-up"* — carrying the user's question in the same user message.
2. The agent answers the question normally (and may research).
3. Because the `tool_use` is now consumed, the eventual choice can no longer arrive as a `tool_result`.
   It arrives as a **normal user turn** — *"user selected option 2"*.

**Therefore:** an awaiting widget is a **rendered form** whose answer may arrive by either path — the
fast path (`tool_result`) or, after a conversational detour, as a plain turn. This is also the real
mechanical reason such a widget "goes stale": after the detour it is no longer wired to a live call.

**Which makes Lior's own second idea necessary, not optional:** the agent must be able to **supersede
or retire its own widget** ("after that research, here are five better options" → the old choice is
deprecated and should visibly retire). That is an **agent-side widget-lifecycle action** — the same
family as [[adr/0016-agent-memory-action-tools]]'s daemon-internal action plane, not a UI-render tool.

**Open inside this case:** does a superseded widget disappear, or stay visible marked *"outdated"*?
(Lean: mark, don't vanish — same instinct as `minimize ≠ delete`.)

## 5. Consequence for chat-view / history

**Widget interactions are invisible in history.** `messages` is `role` (`user`|`assistant`) +
`content TEXT` (`packages/daemon/src/memory/schema.ts:47`); a `tool_result` is not a message and is
**stored nowhere**. So a chat-view feed shows *"show me the weather in London"* and the text answer —
but not **what you clicked**.

Options: synthesize a compact user-role message (`[selected: blue]`) so history reads coherently, or
leave the gaps. **Lean: synthesize, with an explicit marker** so the distiller can ignore it — because
this is a **memory write** and would otherwise flow into fact derivation. Decision belongs to chat-view
or route 4, not to voice.

## 6. What must NOT happen because of these notes

- **Do not** expand the voice or chat-view features to implement any of this. Voice ships with D11 as
  written for the *thinking* cause; §3-C's correction becomes real only when an **awaiting** widget can
  actually exist (route 4).
- **Do not** treat §3/§4 as ratified. They are the recorded reasoning; ratification (likely an
  ADR-0002/0005 rider) happens when a build needs them.
