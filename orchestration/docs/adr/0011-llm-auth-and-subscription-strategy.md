---
status: proposed
date: 2026-06-02
deciders: [lior]
tags: [adr, daemon, llm, auth, subscription]
---

# ADR-0011: LLM authentication & subscription strategy

## Status

`proposed`

## Context

[[0010-pluggable-llm-provider-abstraction]] deliberately left **how an adapter authenticates** out of the `AgentProvider` port — auth is an adapter-internal concern. This ADR decides the actual mechanism for the first real adapter (`AnthropicApiProvider`, chunk-03) and the policy for how subscription-Claude may — and may not — ever be reached. It is the architectural decision behind **chunk-03** of the `llm-text-slice` feature (spec [[../specs/2026-06-02-llm-text-slice]] §5, §6, §11 **ADR-C**).

There are three candidate ways to authenticate against Claude, and they are **not** interchangeable — one is prohibited:

1. **API key** (Anthropic Console, per-token). The adapter holds a key and bills per-token usage. Works today, unconditionally.
2. **Subscription via the Claude Agent SDK spawning the user's local Claude Code CLI** (`pathToClaudeCodeExecutable`). The app holds **no** credentials; it delegates auth to the CLI's own login, inheriting the user's Pro/Max subscription. This is the path t3code uses.
3. **Subscription via OAuth-token reuse** — an app doing claude.ai OAuth login itself, routing through Pro/Max OAuth credentials, or minting/reusing `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`).

Three forces make this a decision rather than a default:

- **Policy prohibition, server-enforced.** Path 3 is **prohibited by Anthropic's ToS and server-enforced** (codified and enforced Jan→Apr 2026). It is not a grey area to exploit; our research refuted reusing `CLAUDE_CODE_OAUTH_TOKEN` in a 3rd-party app and opencode driving subscription OAuth itself, both **0-3** (spec §10). Path 3 is off the table, full stop.
- **Time-sensitivity.** The one compliant subscription path (path 2) is **effective 2026-06-15**, reversing an April 2026 block. As of this decision (2026-06-02) it is ~2 weeks out and may still be blocked *right now*. Anthropic **flipped this policy twice in six months** — so even path 2 must be **re-verified before we rely on it**, and the "API key is the only path / subscription is wholly impossible" claim was itself refuted (0-3): the CLI-spawn path does exist.
- **Metering & caps.** From 2026-06-15 the Agent SDK / `claude -p` draws a **separate monthly credit** (Pro $20 / Max5x $100 / Max20x $200), no rollover, opt-in. Subscription is a *capped, metered* path, not an unmetered free lunch — another reason it is a bonus, not a foundation.

This ADR does **not** reopen the port from [[0010-pluggable-llm-provider-abstraction]]: it decides what goes *inside* the adapter (and which future adapter is allowed to exist), not the seam.

## Decision

**API-key authentication (Anthropic Console, per-token; `ANTHROPIC_API_KEY` read from `.env`) is the primary and first auth — it is how provider #1 (`AnthropicApiProvider`) authenticates. Subscription-Claude is supported ONLY via the Claude Agent SDK spawning the user's local Claude Code CLI (`pathToClaudeCodeExecutable`), as provider #2 post-2026-06-15 (re-verified before reliance). OAuth-token reuse (`claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` / app-driven claude.ai OAuth) is NEVER used — it is prohibited and server-enforced. `.env` is the dev key-loading mechanism only; secure key storage (macOS Keychain) and production launchd key-loading are deferred backlog.**

Concretely:

1. **Provider #1 = API key via `.env`.** `AnthropicApiProvider` reads `ANTHROPIC_API_KEY` from a gitignored `.env` in `packages/daemon` (Bun auto-loads it on `bun run dev`). No auth-flow code, no settings UI, no key entry. The key is the adapter's private internal concern — consistent with [[0010-pluggable-llm-provider-abstraction]] decision 3 (auth is an adapter property; the port has no credential surface).

2. **Subscription = provider #2, CLI-spawn only.** The *only* sanctioned subscription path is the Claude Agent SDK delegating to the user's **local Claude Code CLI** via `pathToClaudeCodeExecutable` — the app holds **no** credentials and inherits the CLI's login. This is provider #2, post-2026-06-15, and is an **agent-harness** provider: it owns its own tool loop and therefore does **not** fit the thin `AgentProvider` port — it lands on the separate agent-harness sub-seam deferred by [[0010-pluggable-llm-provider-abstraction]] (built when provider #2 actually lands).

3. **OAuth-token reuse is prohibited — never attempt it.** No app-driven claude.ai OAuth login, no routing through Pro/Max OAuth credentials, no minting/reusing `CLAUDE_CODE_OAUTH_TOKEN`. This is server-enforced; attempting it is both a ToS violation and operationally futile. This is a hard "never," not a "not yet."

4. **API key is a permanent hedge, not a stepping stone.** Even after subscription (provider #2) lands, API-key auth **stays** as the always-works path against further policy flips. Subscription is a *bonus*, not a dependency — nothing in the product is allowed to require it.

5. **Re-verify before shipping subscription.** Because the policy flipped twice in six months, the subscription path must be **re-confirmed against current Anthropic policy** immediately before any chunk that relies on it ships. The 2026-06-15 effective date and the §10 sources are a snapshot, not a standing guarantee.

6. **`.env` is dev-only; secure & production key-loading are deferred backlog.** `.env` works for `bun run dev`. It does **NOT** cover the production launchd daemon ([[0003-local-daemon-ws-architecture]]), which does not read a project `.env`. Secure key storage (macOS **Keychain** instead of plaintext `.env`), a key-entry settings UI, OAuth-style onboarding, and production key-loading are all **deferred backlog** — a separate post-slice chunk that arrives with `.dmg` packaging (itself TBD). Do not conflate dev `.env` with the production mechanism.

### Explicitly NOT decided here (so a future reader does not over-read this)

- **The agent-harness sub-seam's shape is NOT decided here.** This ADR decides *which* subscription path is sanctioned (CLI-spawn) and *when* (provider #2, post-2026-06-15). The actual port/sub-seam the Agent SDK provider plugs into is deferred to provider #2's landing by [[0010-pluggable-llm-provider-abstraction]]; this ADR does not design it.
- **Secure storage mechanism is NOT decided here.** "macOS Keychain" names the *intended* direction for deferred backlog; the actual storage design, settings UX, and production launchd key-loading are out of scope.
- **Multi-provider key management is NOT decided here.** Per-provider credentials, key rotation, and a credentials registry are not in scope — each adapter still owns its own auth internally per [[0010-pluggable-llm-provider-abstraction]].

## Consequences

### Positive

- **It works today.** API-key auth is unconditionally available right now; the slice's behavioral macOS demo (Lior, real key) does not depend on any time-sensitive or unbuilt path.
- **It hedges policy volatility.** Because subscription flipped twice in six months, anchoring provider #1 on the API key means a future flip cannot strand the product — the always-works path is the foundation, not the bonus.
- **Subscription is a bonus, not a dependency.** Provider #2 (CLI-spawn) adds value for Pro/Max users without anything in the product requiring it; if Anthropic blocks it again, nothing breaks.
- **We never touch the prohibited path.** Ruling out OAuth-token reuse explicitly — as a hard "never," server-enforced — removes a tempting but ToS-violating and futile shortcut from the design space.
- **Auth stays adapter-internal.** This decision lives *inside* the adapters; it does not reopen or pollute the [[0010-pluggable-llm-provider-abstraction]] port.

### Negative

- **Subscription requires re-verification before shipping** — a standing maintenance cost. The 2026-06-15 date and §10 sources can be invalidated by another policy flip, so any subscription chunk must re-confirm current policy first, and may find the path closed again.
- **`.env` plaintext key is a known interim** — it is gitignored but unencrypted on disk, acceptable for dev only. Until Keychain lands, there is no secure-at-rest story, and there is no production key-loading at all (the launchd daemon won't read `.env`).
- **CLI-spawn depends on the user's local Claude Code install** — provider #2 only works for users who already have the CLI logged in; it is not a self-contained auth flow we control.

### Trade-offs accepted

- We accept **a plaintext `.env` key for dev** in exchange for **zero auth-flow code in this slice** — secure storage (Keychain) and production loading are deferred to a backlog chunk that ships with packaging.
- We accept **subscription as a deferred, re-verify-before-use bonus** in exchange for **a foundation that works today and survives policy flips** — API key is the permanent hedge, subscription is additive.
- We accept **ruling out OAuth-token reuse entirely** (a path some 3rd-party tools have flirted with) in exchange for **staying inside Anthropic's ToS and avoiding server-side enforcement** — it is prohibited and futile, so there is no real cost to forgoing it.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Candidate regrets: "subscription flipped a third time and our 're-verify before shipping' note wasn't enough — we built provider #2 against a 2026-06-15 snapshot and it was blocked again by the time we shipped," or "the `.env` plaintext key bit us in an early-access build because Keychain stayed in the backlog longer than planned," or "CLI-spawn turned out to be merely tolerated, not sanctioned, and Anthropic clarified it away — we should have treated the open question as blocking, not informational."]

## Alternatives Considered

### Option A: Subscription-first (lead with Pro/Max, API key as fallback)

**What it was:** make subscription-Claude (the CLI-spawn path) the primary auth so users with a Pro/Max plan don't pay per-token, and treat API key as the fallback.

**Why not:**

- The compliant subscription path is **not live until 2026-06-15** and Anthropic **flipped the policy twice in six months** — leading with it builds the foundation on sand and risks stranding the product on the next flip.
- Subscription is **metered + capped** (separate monthly credit, no rollover) and **depends on the user's local CLI being installed and logged in** — too many preconditions for the path the whole product rests on.

**Rejected.** API key leads (works today, survives flips); subscription is the additive bonus.

### Option B: OAuth-token reuse (`claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN`)

**What it was:** reach the user's subscription by having the app perform claude.ai OAuth, or by minting/reusing a `CLAUDE_CODE_OAUTH_TOKEN`, so subscription works without spawning the CLI.

**Why not:**

- **Prohibited by ToS and server-enforced** (Jan→Apr 2026). Our research scored reusing `CLAUDE_CODE_OAUTH_TOKEN` in a 3rd-party app **0-3** and opencode driving subscription OAuth itself **0-3** (spec §10) — it does not work and violates the agreement.
- There is no compliant variant of this; it is a hard "never," not a "not yet."

**Rejected — permanently, not deferred.** Recorded as a gotcha so no future contributor re-attempts it.

### Option C: Build secure key storage (Keychain) + a settings auth-flow now

**What it was:** ship macOS Keychain storage, a key-entry settings UI, and OAuth-style onboarding as part of this slice instead of `.env`.

**Why not:**

- The slice's goal is **text-in → real LLM → text-out**, single-turn, behind the provider seam — a real auth-*flow* is an entire feature orthogonal to that goal, and `.env` proves the path end-to-end for the dev demo at zero auth-UI cost.
- Production key-loading is coupled to `.dmg` packaging (TBD); building Keychain now would be ahead of the packaging story it serves.

**Rejected for this slice.** Deferred to a dedicated backlog chunk that lands with packaging.

## Related

- [[0010-pluggable-llm-provider-abstraction]] — **sibling ADR** (ADR-B, chunk-02). That ADR deliberately left auth out of the `AgentProvider` port (auth is an adapter property); this ADR fills in the mechanism. `AnthropicApiProvider` is that port's **first real adapter** and authenticates by the API-key decision here. The subscription provider (#2) is the deferred **agent-harness** provider that does *not* fit the port and lands on its own future sub-seam.
- [[0003-local-daemon-ws-architecture]] — the daemon this auth runs in. Carries the **dev-vs-production key-loading distinction**: `.env` works for `bun run dev`; the production **launchd** daemon does **not** read a project `.env` — production key-loading is a separate mechanism that arrives with packaging. Do not conflate the two.
- [[../specs/2026-06-02-llm-text-slice]] §5 (auth strategy), §6 (subscription feasibility — time-sensitive), §10 (research basis / cited sources), §11 **ADR-C** — the spec this ADR formalizes.
- [[../known-gotchas]] — OAuth-token reuse is prohibited + server-enforced; subscription is metered + capped (separate monthly credit, no rollover, opt-in from 2026-06-15); the policy flipped twice in six months (re-verify); `.env` works for `bun run dev` but NOT the production launchd daemon; Claude Code auth precedence ranks subscription OAuth lowest (below `ANTHROPIC_API_KEY`) so the API key wins when both are set (worker records these during chunk-03 execution, spec §12).
- [[../architecture]] — daemon + provider in system context (follow-up for Lior: wire a reference to this ADR once accepted; this ADR does not edit `architecture.md`).
