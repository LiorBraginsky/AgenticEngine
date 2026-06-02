---
status: draft (awaiting Lior review)
date: 2026-06-02
phase: llm-text-slice (first post-v0 vertical slice; cuts through roadmap Phase 2 `text` primitive + Phase 3 real-LLM)
supersedes: nothing
feeds: decompose-feature → chunks-todo/llm-text-slice/ → per-chunk engine-orchestrator
---

# Spec: LLM Text-Reply Slice (first real LLM + provider abstraction)

> **This is the foundation of the product, not a throwaway.** Scope is thin (single-turn, one provider, `.env` key) but the **seams are load-bearing** — the provider abstraction here is what the whole multi-provider product rests on. "Play / пощупать" = Lior wants to feel a real LLM answer him; architecturally this is the base.

## 1. Goal & scope

**Goal:** prove the real path **text-in → real LLM → text-out**, live on macOS, single-turn, behind a **swappable provider abstraction** so subscription-Claude / GPT / OpenRouter drop in later as adapters, not rewrites.

### In scope
- `text` UI primitive (`show_text`, **display-only**) in `packages/protocol`.
- `AgentProvider` port + an `llm-injector` (registry/selector) in `packages/daemon`.
- First adapter: **`AnthropicApiProvider`** (raw-API kind, API key via `.env`, model **Claude Sonnet 4.6**).
- Existing **mock kept behind the same port** (tests stay green; gives the port 2 implementations from day 1).
- **memory-ready session state** (a `messages[]` array; single-turn puts 1 in it).
- Overlay **text renderer** (reuse the top-right widget window).
- Wire end-to-end (single-turn): hotkey → input → `session_start{text}` → daemon → Claude → `show_text` → overlay → `session_end{completed}`.
- Error handling (API errors → graceful, reuse v0 error path).
- **Behavioral macOS demo** (Lior, real key) as the done-gate.

### Out of scope (deferred — tracked, not pretended-done)
- Streaming token-by-token (Phase 3 later).
- **LLM choosing tools** (the agent calling UI primitives itself) — Phase 3.
- Multi-turn UX + persistent session lifecycle (the *state* is memory-ready, but the lifecycle/UX is later).
- Durable conversation persistence across daemon restarts (ADR-0003 already defers persistence).
- **Subscription / Claude Agent SDK provider** (provider #2; post-2026-06-15, see §6).
- OpenAI / OpenRouter / opencode / codex adapters (#3+).
- Real **auth-flow** as a feature (settings UI, macOS Keychain secure storage, OAuth onboarding).
- The other Phase-2 primitives (button / input / image).
- Production daemon key-loading (arrives with `.dmg` packaging, which is itself TBD).

## 2. Reuses from Walking Skeleton v0 (unchanged)
Global hotkey; input panel (`main` window); WS transport + Origin-allowlist (ADR-0003 amendment); top-right widget window (ADR-0006); session lifecycle (`session_start`/`session_ack`/`session_end`); the existing error-status display path (v0 demo step 10). This reuse is the walking-skeleton payoff — the slice is small because the pipe already exists.

## 3. Design — four parts

### ① Protocol — `text` UI primitive (`show_text`, display-only)
- New envelope variant via the existing `tool_call` mechanism: `tool_call{ payload: { tool: "show_text", args: { content: string } } }`.
- **Display-only:** unlike `show_color_picker`, `show_text` expects **no `tool_result`**. This introduces a **display-only vs interactive** primitive distinction the daemon/session must handle (interactive → parks `awaiting_*`; display-only → no await, straight to `session_end`).
- Zod schema `ShowTextArgs = { content: string }` (mirrors `ShowColorPickerArgs`), self-validated.
- Frozen envelope **6 → 7 variants, additive** (does not break the existing union). **Contract change → ADR** (§11 ADR-A).

### ② Daemon — `AgentProvider` port + `llm-injector` + first adapter
- **`AgentProvider` port** — the swappable seam. An async producer: given the user input + memory-ready session state (`messages[]`), produce outbound envelopes (emit `show_text`, then `session_end`). **Auth is a property of the adapter** — the port knows nothing about credentials.
- **Two provider KINDS** (discriminated union, per research / t3code `ProviderKind`):
  - **raw-API** — single request→response, no tool loop (Anthropic API, OpenAI, OpenRouter). Fits a Vercel-AI-SDK-style registry.
  - **agent-harness** — owns its own tool loop (Claude Agent SDK, opencode, codex). Does NOT fit the raw-API interface → a separate sub-seam.
  - **This slice builds the raw-API kind only**; the union *anticipates* the agent-harness kind but does not implement it (rule of three — the 2nd real provider corrects the abstraction).
- **`llm-injector`** — a registry/selector. Holds registered providers; selects the active one by config (e.g. `LLM_PROVIDER=anthropic-api` env). Hands the active `AgentProvider` to the daemon. From the consumer's view it's one selector; internally it dispatches over `ProviderKind`.
- **`AnthropicApiProvider`** (first adapter, raw-API) — `@anthropic-ai/sdk`, reads `ANTHROPIC_API_KEY` from `.env`, model **Sonnet 4.6**, a tiny system prompt ("a concise assistant rendered in a small desktop overlay — keep replies short"), sends the (single-turn) history, returns the text reply → daemon emits `show_text`. **Build with the `claude-api` skill** (prompt caching, model id, SDK usage).
- **Mock-behind-port** — the existing `mock-agent` reducer wrapped as a (trivially async) provider so its tests + the v0 color-picker flow remain reachable, and the port has 2 implementations immediately (validates the abstraction cheaply).
- **Async** — the Claude call is network I/O, so it lives in the daemon's imperative shell; a thin pure part formats the `show_text` envelope (keep the functional-core/imperative-shell split).

### ③ Overlay — text renderer
- Render inbound `show_text` in the top-right widget window (reuse window + styling; the confirm-card pattern from chunk-03). Display-only: no interaction; auto-dismiss after a linger (or stays until next hotkey, single-turn).

### ④ Session state — memory-ready
- Session state holds a `messages[]` conversation array even though single-turn only ever puts one turn in it. **Multi-turn later = keep the session open + append, NOT a rewrite.** This is the seam that defuses "memory will be hard": *storage* is trivial here; the genuinely hard parts (lifecycle, context-window mgmt, durable persistence) stay deferred and don't block this slice.

## 4. Provider abstraction (the heart — expanded)
The product requirement (Lior): adding a new connection (subscription, GPT, OpenRouter, opencode, codex, or "some new interface invented tomorrow") must be **"implement an adapter"**, never "rip out and replace."

- **`AgentProvider` port** with auth as an adapter property.
- **`ProviderKind` discriminated union**: `raw-api` | `agent-harness` (extensible).
- **`llm-injector` registry**: register adapters, select active by config; dispatch over kind.
- **Built now:** port, injector, mock adapter, `AnthropicApiProvider` (raw-api).
- **Anticipated, not built:** `agent-harness` kind (subscription via Claude Agent SDK, #2); other raw-api adapters (OpenAI #3).
- Reference patterns (verify, don't copy): Vercel AI SDK `createProviderRegistry`/`providerId:modelId` (opencode uses it, 75+ providers via Models.dev); t3code's discriminated `ProviderKind` union behind one `ProviderAdapterRegistry` + `ProviderService`.

## 5. Auth strategy
- **Now:** `.env` `ANTHROPIC_API_KEY=…` in `packages/daemon` (gitignored; Bun auto-loads on `bun run dev`). The adapter reads it. **No auth-flow code.**
- **Auth = adapter property:** `.env` is `AnthropicApiProvider`'s internal concern; the port has no global auth.
- **Subscription (#2):** spawn the user's local Claude Code via Claude Agent SDK `pathToClaudeCodeExecutable` — **no key in our app**, inherits the CLI's login. Deferred (see §6).
- **Real auth-flow (deferred backlog):** settings UI to enter/store the key, **macOS Keychain** instead of plaintext `.env`, OAuth onboarding. Separate post-slice chunk.
- **Dev vs prod gotcha:** `.env` works for `bun run dev`; the **production launchd daemon** (ADR-0003) does NOT read a project `.env` — production key-loading is a separate concern that arrives with `.dmg` packaging. Do not conflate.

## 6. Subscription-Claude — feasibility (research, time-sensitive)
- **Prohibited & server-enforced:** an app may not do claude.ai OAuth login itself, route through Pro/Max OAuth credentials, or mint/reuse `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`). ToS-codified; enforced Jan→Apr 2026.
- **The one compliant path:** Claude Agent SDK + delegate auth to the user's **local Claude Code CLI** via `pathToClaudeCodeExecutable` (app holds no credentials). This is what t3code does.
- **Timing:** effective **2026-06-15** (reverses an April 2026 block). As of this spec (2026-06-02) it is ~2 weeks out and may still be blocked now → **API-key is the path that works today.** Anthropic flipped twice in 6 months → **re-verify before relying on it.**
- **Metered + capped:** from 2026-06-15, Agent SDK / `claude -p` draws a separate monthly credit (Pro $20 / Max5x $100 / Max20x $200), no rollover, opt-in.
- **Decision:** **API-key (raw-API) is provider #1**; subscription/Agent-SDK is **provider #2** (post-2026-06-15, re-verified). API-key also stays as a permanent hedge against further policy flips.

## 7. Data flow (single-turn)
```
hotkey → input panel → submit(text)
  → [WS] session_start{text} → daemon
  → llm-injector selects active AgentProvider (AnthropicApiProvider)
  → adapter calls Claude (Sonnet 4.6, .env key) with messages[] (1 turn)
  → Claude returns text
  → [WS] tool_call(show_text, {content}) → overlay renders in widget (display-only)
  → [WS] session_end{completed}
```

## 8. Error handling (minimal)
Claude API errors (missing key / timeout / rate-limit / malformed) → caught in the daemon → surfaced via the existing error-status path (v0) → `session_end` gracefully, no crash, no orphaned session. Typed errors, never throw (carry the mock-agent's gotcha-#9 discipline into the provider).

## 9. Testing
- **Unit:** each provider behind the port with a **mocked Anthropic client** (input → client called with expected args → `show_text` emitted); the `llm-injector` (selects the right provider by config); `ShowTextArgs` schema validation; mock-provider tests (existing, kept green).
- **Overlay:** text-renderer seam test.
- **Behavioral gate (Lior, real key):** type a question on macOS, see Claude's text reply in the overlay. **This is THE "it works" gate** — per the project lesson, a behavioral DoD is proven by a live demo, not by code-reading or a prior "PASS" record (see known-gotchas; see project memory `feedback_behavioral_dod_needs_runtime_proof`).

## 10. Research basis (deep-research 2026-06-02, verified 17/8; for the architect & curator)
Key cited sources:
- Subscription via Agent SDK + plan: `support.claude.com/en/articles/15036540`
- Claude Code auth + precedence: `code.claude.com/docs/en/authentication`; legal: `code.claude.com/docs/en/legal-and-compliance`
- Agent SDK overview (metering, API-key default): `platform.claude.com/docs/en/agent-sdk/overview`
- Provider abstraction (registry): `ai-sdk.dev/docs/ai-sdk-core/provider-management`
- t3code Claude-via-CLI-spawn: `github.com/pingdotgg/t3code/pull/179`
- opencode provider management: `deepwiki.com/sst/opencode/4.1-provider-management`
- Policy timeline (secondary): `winbuzzer.com/2026/02/19/...`, `theregister.com/2026/02/20/...`, `venturebeat.com/...anthropic-reinstates...`

Refuted (do NOT pursue): reusing `CLAUDE_CODE_OAUTH_TOKEN` in a 3rd-party app (0-3); opencode driving subscription OAuth itself (0-3); "API key is the only path, subscription wholly impossible" (0-3 — the CLI-spawn path exists).

## 11. ADRs to draft (pre-digested for adr-curator; architect confirms ADR-worthiness via reality-check + grilling gate)

### ADR-A — `text` display-only UI primitive
- **Decision:** add `show_text` to the closed UI-primitive set as a **display-only** primitive (no `tool_result`); frozen envelope 6 → 7, additive.
- **Context:** extends ADR-0005 (UI contract closed set) and ADR-0002 (UI as tool calls); the agent's conversational text is rendered as a UI primitive (consistent with "everything shown is a tool call"), not a side-channel message.
- **Consequences:** introduces the display-only vs interactive distinction (affects session phase handling); needed anyway for future `image`. Wire-additive, doesn't break v0.

### ADR-B — Pluggable LLM provider abstraction
- **Decision:** an `AgentProvider` port + `llm-injector` registry; a `ProviderKind` discriminated union (`raw-api` | `agent-harness`); **auth is a property of the adapter**.
- **Context:** product must support many connections (subscription Claude, API-key Claude, GPT, OpenRouter, opencode, codex, future); two genuinely different shapes — raw-API (single-shot) vs agent-harness (owns its tool loop). Refs: Vercel AI SDK registry; t3code ProviderKind union; opencode.
- **Consequences:** adding a provider = implement an adapter (no rip-out). Two sub-seams to maintain. Thin now (raw-api + mock); agent-harness kind validated when provider #2 lands.

### ADR-C — LLM authentication & subscription strategy
- **Decision:** API-key (Console, per-token) is the primary/first auth; subscription-Claude is supported **only** via Claude Agent SDK spawning the local Claude Code CLI (`pathToClaudeCodeExecutable`), as provider #2 post-2026-06-15; **never** OAuth-token reuse (prohibited). `.env` for dev; secure key storage + production loading deferred.
- **Context:** Anthropic ToS prohibits 3rd-party subscription-OAuth; policy time-sensitive (flipped twice in 6 months); subscription path is metered+capped. Sources in §10.
- **Consequences:** API-key works today + hedges policy volatility; subscription is a bonus, not a dependency; must re-verify the policy before shipping; CLI-spawn explicitly-sanctioned-vs-tolerated is an open question.

## 12. Gotchas to record (ready for known-gotchas.md; worker adds during execution)
- Subscription OAuth-reuse (`claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN`) is **prohibited + server-enforced** — never attempt in-app.
- Subscription-via-Agent-SDK is **metered + capped** (separate monthly credit, no rollover, opt-in from 2026-06-15).
- Anthropic flipped the 3rd-party-subscription policy **twice in 6 months** — time-sensitive; re-verify before relying.
- `.env` key-loading works for `bun run dev` but **NOT** for the production launchd daemon — different mechanism; don't conflate.
- **agent-harness providers own their tool loop** → don't fit the raw-API interface → two sub-seams required.
- Claude Code auth precedence ranks subscription OAuth **lowest, below `ANTHROPIC_API_KEY`** — if both are set, the API key wins (surprises when switching to subscription).
- Open question: is CLI-spawn explicitly sanctioned vs merely tolerated, and does CLI-spawn draw the metered Agent SDK credit?

## 13. Likely decomposition (decompose-feature confirms; not pinned here)
- **Chunk 1** — `show_text` display-only primitive in `packages/protocol` (+ ADR-A). Contract foundation.
- **Chunk 2** — `AgentProvider` port + `llm-injector` + mock-behind-port + memory-ready session state (+ ADR-B). The abstraction, validated with the mock before any real LLM.
- **Chunk 3** — `AnthropicApiProvider` (`.env` key) + end-to-end wiring + overlay text renderer + error handling + ADR-C + gotchas + **Lior's live macOS demo**. First real provider — where Lior plays.

## 14. Process
brainstorm (done) → **this spec** (design + research harvest) → **decompose-feature** → `chunks-todo/llm-text-slice/` → per chunk: `engine-orchestrator` (architect plan + grilling gate against ADR-0002/0005/0006 + adr-curator drafts ADR-A/B/C + worker builds + worker records gotchas + engine-reviewer). Project convention (decompose + orchestrator), NOT superpowers:writing-plans.
