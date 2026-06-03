---
status: proposed
date: 2026-06-02
deciders: [lior]
tags: [adr, daemon, llm, provider, architecture]
---

# ADR-0010: Pluggable LLM provider abstraction (thin AgentProvider port + llm-injector)

## Status

`proposed`

## Context

The product requirement (Lior, spec [[../specs/2026-06-02-llm-text-slice]] §4): adding a new LLM connection — subscription Claude, API-key Claude, GPT, OpenRouter, opencode, codex, or "some interface invented tomorrow" — must be **"implement an adapter," never "rip out and replace."** The provider seam is the load-bearing one: it is what the whole multi-provider product rests on, even though the first slice is thin (single-turn, one real provider, `.env` key).

Two provider shapes are genuinely different, not cosmetically different:

- **raw-API** providers do a single request → response and own **no** tool loop of their own (Anthropic API, OpenAI, OpenRouter). These fit a single-call `advance()` port cleanly.
- **agent-harness** providers own **their own** tool loop and lifecycle (Claude Agent SDK, opencode, codex). They do **not** fit a single-call port — driving them means handing off control, not making one call — so they will need a **separate sub-seam** of their own.

The tempting move is to encode that two-shapes reality *in the type now*, as a `ProviderKind` discriminated union (`raw-api` | `agent-harness`) the injector dispatches over. **We deliberately do not.** Laying down a union branch whose adapter does not exist — and cannot be tested — is speculative abstraction: it ships a shape we are *guessing* at, with zero implementation to validate it against. Our research confidence that agent-harness needs its **own** sub-seam (not the same port with a tag) is **3-0**; a `switch`-on-kind dispatch is the wrong shape for a control-handoff provider, so the union branch would very likely be reworked the moment provider #2 actually lands. The seam we commit now is the **port itself** — that is the anticipation. The *type* encodes only what has a real implementation plus a test today.

This seam lives in `packages/daemon` and must preserve the daemon's **functional-core / imperative-shell** split established by [[0003-local-daemon-ws-architecture]]: pure formatting stays in the core (the unchanged reducer), async network I/O lives in the adapter (the imperative shell). It must also carry forward the **never-throw, typed-error** discipline (known-gotchas #9) so a future network adapter is forced to honour it.

The first slice gives us a cheap way to validate the abstraction *before* any real LLM exists: the existing **pure** mock reducer (`advanceMockAgent`, decision D-02a-1) becomes the functional core of the first adapter, so the port has a second implementation from day one.

This ADR **consumes and decides open-question Q1 (LLM provider strategy)** — "default to one provider behind a futureproofing abstraction" — arriving early via this slice rather than at Phase 3. See [[../open-questions]] Q1.

It is the architectural decision behind **chunk-02** of the `llm-text-slice` feature (spec §3②, §4, §11 **ADR-B**). Its sibling [[0009-text-display-only-ui-primitive]] (ADR-A, chunk-01) is already accepted and frozen.

## Decision

**Introduce a thin `AgentProvider` port plus an `llm-injector` registry/selector in `packages/daemon`, and make auth a property of the adapter — the port has no credential surface. The port is `{ readonly id: string; advance(state, inbound): Promise<ProviderResult> }` — there is NO `kind` field and NO `ProviderKind` discriminated union. Adapters implement the port directly (the mock now; the real `AnthropicApiProvider` in chunk-03). agent-harness providers do not fit this port; they get a separate future sub-seam, built when provider #2 actually lands — we do not encode a family discriminant in the type now (YAGNI / rule of three).**

Concretely:

1. **Thin `AgentProvider` port.** A swappable seam with a single async method `advance(state, inbound) → Promise<ProviderResult>`, mirroring the existing reducer's single-input shape exactly. `advance` is async so a network adapter (chunk-03) satisfies the same signature the mock satisfies trivially. The port carries exactly **one** identifying field, `readonly id: string` (e.g. `"mock"`, `"anthropic-api"`) — **no `kind`, no family tag.** It consumes the three existing reducer-input envelopes (`session_start | tool_result | tool_cancel`) — **not** only `session_start` — so the existing color-picker resolve and cancel paths are preserved.

2. **Adapters implement the port directly.** There is no shape-classification layer between the registry and the adapter. The mock implements `AgentProvider` directly; `AnthropicApiProvider` (chunk-03) implements `AgentProvider` directly. No `switch`-on-kind, no "unsupported kind" default branch — those constructs do not exist, because there is no kind.

3. **Auth is a property of the adapter.** The port has **no** credential surface. How an adapter authenticates (`.env` key, spawned CLI, OAuth) is the adapter's private internal concern. This deliberately leaves the auth/subscription strategy to a separate decision (chunk-03's [[0011-llm-auth-and-subscription-strategy]], ADR-C) without polluting the port.

4. **`llm-injector` registry/selector.** A `Map` registry **keyed by `id`**, seeded with the mock, selecting the active provider by config (`LLM_PROVIDER` env, default `mock`). It selects by `id` — it does **not** dispatch over a kind. Unknown selector → `console.error` + graceful fallback to mock, **never throw** (gotcha #9 spirit). The injector is the only place that knows the registry; the imperative shell (`index.ts`) sees exactly one `AgentProvider`. `env` is injectable so tests select deterministically without touching process env.

5. **memory-ready session state.** `ProviderSessionState` carries `messages: SessionMessage[]` (`{ role: "user" | "assistant"; content: string }`) **additively** on both existing phases (`awaiting_pick` / `done`). Single-turn populates exactly one user message at `session_start`. Multi-turn later = append, not rewrite.

6. **Behaviour-preserving wrap.** The pure `advanceMockAgent` reducer is left **byte-unchanged** and becomes the mock adapter's functional core; the adapter only adds the `messages[]` envelope around it, so **every outbound envelope stays byte-identical** to today. The daemon routes all reducer-input envelopes through `provider.advance(...)` instead of calling the reducer directly.

### Explicitly NOT decided here (so a future reader does not over-read this)

- **The agent-harness sub-seam is NOT designed here.** This ADR commits **only the port** as the anticipation of a second provider shape. The agent-harness providers (Claude Agent SDK / opencode / codex) own their own tool loop and do not fit `advance()`; their sub-seam is a **separate future decision**, made when provider #2 lands (post-2026-06-15, spec §6), so the second *real* provider corrects the abstraction. No type-level placeholder for it ships now.
- **Auth / subscription strategy is NOT decided here.** API-key vs subscription-via-Claude-Agent-SDK, `.env` vs Keychain, OAuth onboarding — all of that is **[[0011-llm-auth-and-subscription-strategy]]** (ADR-C, chunk-03). This ADR only asserts that auth is *adapter-internal*; it does not pick the mechanism.
- **Multi-turn lifecycle and persistence are NOT decided here.** The state is memory-*ready* (`messages[]` exists), but multi-turn UX, context-window/footprint management (gotchas #29/#30), compaction, and durable persistence across daemon restarts ([[0003-local-daemon-ws-architecture]] already defers persistence) are out of scope and unsolved by design.

### Supersedes spec §4 / §11 ADR-B (the type-level union)

The spec ([[../specs/2026-06-02-llm-text-slice]] §4, §11 **ADR-B**) called for anticipating the agent-harness shape **in a `ProviderKind` discriminated union** (`raw-api` | `agent-harness`) that the injector dispatches over. **This ADR supersedes that detail.** The *seam-level* anticipation stands and is exactly the point — the **port** is the anticipation of "more providers, dropped in as adapters." What is dropped is the *type-level* anticipation: the union branch with no adapter and no test. We commit the seam, not a speculative type branch. (Earlier drafts of this ADR encoded the union; that draft shipped a branch whose adapter did not exist — a weaker application of rule-of-three than this one.)

## Consequences

### Positive

- **Adding a provider = implement an adapter, never rip-out.** This is the exact product requirement, satisfied structurally rather than by convention — the port is the seam new providers drop into.
- **The abstraction is validated immediately, for free.** The mock gives the port a second implementation from day one, so the seam is exercised before any real LLM exists — the cheap validation the slice was designed to buy.
- **The `mock` provider is PERMANENT, not throwaway scaffolding (Lior, 2026-06-03).** `LLM_PROVIDER=mock` is retained indefinitely as a first-class **test / integration harness** — a deterministic, network-free, zero-cost provider for exercising the daemon↔overlay wire, the session lifecycle, and future integrations without spending real LLM tokens or depending on Anthropic availability. It is a feature of the architecture, not debt to be removed once real providers exist; **do not delete or deprecate the mock provider** when adding real adapters.
- **No speculative type branch.** Every line of the type surface has a real implementation plus a test behind it. There is no untested `agent-harness` branch waiting to be wrong; the port is narrow enough that the *second real* provider — not a guess — shapes whatever the agent-harness sub-seam becomes.
- **The functional-core / imperative-shell split is preserved.** Pure formatting stays in the unchanged reducer (core); async network I/O lives in the adapter (shell). Consistent with [[0003-local-daemon-ws-architecture]].
- **Typed-error discipline is carried forward.** `ProviderResult` is an `ok`/`error` discriminated union that never throws, so chunk-03's network adapter is *forced* by the type to honour gotcha #9.
- **v0 unbroken.** Purely additive in behaviour: the mock reducer and its unit tests are byte-unchanged; the WS color-picker flow emits byte-identical envelopes via the injected mock; `git diff packages/protocol` stays empty (this is a daemon-only refactor).
- **Auth stays out of the port.** Keeping credentials adapter-internal means ADR-C can decide the auth mechanism later without touching the seam.

### Negative

- **The agent-harness sub-seam is unsketched.** By not laying down even a type-level placeholder, we have no compiler-visible reminder that a second shape is coming; the knowledge that agent-harness needs its own seam lives in this ADR's prose (and §6 of the spec), not in the types. We accept that the *port* — not a type tag — is the durable anticipation, and that provider #2's arrival is when the sub-seam gets designed.
- **One fact encoded in two places.** The reducer's `MockSessionState` (no `messages`) and the port's `ProviderSessionState` (with `messages`) must be translated at the adapter boundary on every call; the strip-in / re-attach-out logic is a small but real surface for drift.
- **A contract whose richest consumer ships later.** The network-adapter consumer of this port arrives in chunk-03; this chunk can only prove the *mechanical* correctness (typecheck + the mock behind the port + the injector selection), not the real-LLM path.

### Trade-offs accepted

- We accept **an intentionally thin port** (one method, one `id` field, no family discriminant) in exchange for a **stable seam the multi-provider product rests on** with **no untested type committed**; the agent-harness sub-seam is deferred to provider #2 — only the seam (the port) is committed now, not a speculative type branch.
- We accept **no compiler-visible placeholder for agent-harness** in exchange for **not baking in a shape we cannot yet validate** — the second real provider corrects the abstraction (rule of three), rather than us pre-committing to a `switch`-on-kind that the control-handoff model is likely to break.
- We accept **a translation layer at the adapter boundary** (`messages[]` strip-in / re-attach-out around the byte-unchanged reducer) in exchange for **leaving the pure reducer and its tests untouched** — the smallest behaviour-preserving diff.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Candidate regrets: "we should have left a one-line type marker for agent-harness after all — when provider #2 landed there was no compiler nudge and we missed a call site," or "`advance(state, inbound)` as a single method was too coarse once streaming arrived — we needed an event/callback shape and the single-method port forced an awkward retrofit," or "`messages[]` being adapter-translated rather than reducer-native let the two state shapes drift and a bug slipped through the strip/re-attach seam."]

## Alternatives Considered

### Option A: `ProviderKind` discriminated union in the type now (`raw-api` | `agent-harness`)

**What it was:** classify providers by a `ProviderKind` union *value* — `{ kind: "raw-api" }` | `{ kind: "agent-harness" }` — that the injector `switch`es over, shipping the `agent-harness` branch as a type-level anticipation with an exhaustive "unsupported kind" `default` and no adapter behind it. This was the original draft of this ADR and the spec's §4 / §11 ADR-B wording.

**Why not:**

- It ships a **branch whose adapter does not exist and cannot be tested** — speculative abstraction. The agent-harness shape is a *guess*; with zero real agent-harness providers, the type encodes something we have not validated, and rule-of-three says the right shape only emerges from the second *real* provider.
- Our research confidence is **3-0** that agent-harness needs its **own sub-seam**, not the same port with a tag: a control-handoff provider does not fit a single `advance()` call, so a `switch`-on-kind dispatch over a shared port is the wrong shape and would be reworked the day provider #2 lands — exactly the rip-out the requirement forbids, just relocated into the type.
- The genuine anticipation — "more providers drop in as adapters" — is carried by the **port itself**, which costs nothing speculative. The union branch adds risk without adding that anticipation.

**Rejected.** Commit the seam (the port), not a speculative type branch. This is a *stronger* application of rule-of-three than the two-variant union: the type encodes only what has a real implementation plus a test.

### Option B: Build the agent-harness adapter now too

**What it was:** implement a real agent-harness adapter (Claude Agent SDK spawn) in this slice, alongside the raw-API mock, so the second shape is real rather than anticipated.

**Why not:**

- The compliant subscription path (Agent SDK delegating to the local Claude Code CLI) is **time-sensitive and not yet live** — effective 2026-06-15, and Anthropic flipped the policy twice in six months (spec §6, [[0011-llm-auth-and-subscription-strategy]]). Building against it now is building on sand.
- **Rule of three:** the right abstraction for agent-harness emerges from the *second real* provider, not from a guess. Implementing it now would bake in an unvalidated shape we would likely rip out — the opposite of the goal.

**Rejected.** Defer the agent-harness sub-seam entirely (no adapter *and* no type placeholder) until provider #2 forces the abstraction to be correct.

### Option C: Put auth on the port (a credential surface in the interface)

**What it was:** give the `AgentProvider` port a credential/auth surface (e.g. a `configure(credentials)` method or an `auth` field), so the injector or shell handles credentials uniformly.

**Why not:**

- Auth mechanisms differ **fundamentally** by provider: a `.env` API key, a spawned CLI that inherits its own login, an OAuth flow. A single port-level credential surface would have to be the union of all of them — a leaky abstraction coupling the seam to an undecided auth strategy.
- It would force this ADR to pre-empt **[[0011-llm-auth-and-subscription-strategy]]** (ADR-C, chunk-03), which is precisely the decision we are deferring. Keeping auth adapter-internal lets ADR-C choose freely without reopening the port.

**Rejected.** Auth is a property of the adapter; the port has no credential surface.

### Option D: Separate per-event methods on the port (`onSessionStart` / `onToolResult` / `onToolCancel`)

**What it was:** instead of one `advance(state, inbound)`, give the port a method per inbound envelope type.

**Why not:**

- It **diverges from the existing single-reducer shape** (`advanceMockAgent(state, inbound)`), breaking the clean byte-unchanged wrap of the mock and producing a larger behaviour-changing diff.
- It enlarges the surface every future adapter (including chunk-03's network adapter) must implement, for no gain — the dispatch on inbound type is internal to the adapter anyway.

**Rejected.** A single `advance` mirrors the existing reducer exactly → smallest behaviour-preserving diff.

## Related

- [[0003-local-daemon-ws-architecture]] — this seam lives in the daemon; it preserves the functional-core (pure reducer) / imperative-shell (async adapter, network I/O) split, and inherits the daemon's no-persistence-in-MVP stance.
- [[0002-ui-as-tool-calls]] — related context: the provider's job is to *produce* the outbound `tool_call`/`session_*` envelopes the UI renders; everything the user sees is still a tool call, regardless of which provider produced it.
- [[0005-ui-contract-closed-set]] — related context: providers emit the closed-set UI vocabulary (the mock emits `show_color_picker`; chunk-03's real provider will emit `show_text` from [[0009-text-display-only-ui-primitive]]). The provider seam does not widen the UI contract.
- [[0009-text-display-only-ui-primitive]] — **sibling ADR** (ADR-A, chunk-01) from the same `llm-text-slice` spec. That one cut the protocol seam (`show_text`); this one cuts the daemon provider seam (chunk-02). Both are load-bearing foundations of the same slice.
- [[0011-llm-auth-and-subscription-strategy]] — **sibling ADR** (ADR-C, chunk-03). This ADR deliberately defers all auth/subscription strategy; auth is adapter-internal here, and `AnthropicApiProvider` (ADR-C's first real adapter) implements this port directly.
- [[../specs/2026-06-02-llm-text-slice]] §4, §11 **ADR-B** — the spec this ADR formalizes (provider abstraction is "the heart"). **This ADR supersedes the §4 / §11 detail that anticipated agent-harness in a `ProviderKind` union**: the seam-level anticipation (the port) stands; the type-level union branch is dropped.
- [[../open-questions]] Q1 — **LLM provider strategy: this ADR decides it.** Annotated with a forward-pointer; the full strike happens on acceptance.
- [[../known-gotchas]] #9 (never-throw typed errors, carried into `ProviderResult`), #29/#30 (multi-turn footprint/context management — deferred, not solved here).
- [[../architecture]] — daemon in system context (follow-up for Lior: wire a reference to this ADR once accepted; this ADR does not edit `architecture.md`).
