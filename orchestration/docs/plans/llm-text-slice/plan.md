# LLM Text-Reply Slice — Implementation Plan (chunks 02 + 03, one PR)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution shape (Lior, 2026-06-02):** chunks **02 and 03 ship in ONE session, ONE pull request**, with **per-chunk commits**. Build chunk-02 (first half) → build chunk-03 (second half) → **HARD STOP for Lior's live macOS demo** (chunk-03 behavioral gate, §6.1) → reviewer pass → one PR → Lior reviews + merges → archive **both** chunk files + this plan at closeout.

**Goal:** Introduce a pluggable LLM-provider seam in `packages/daemon` (thin `AgentProvider` port + `llm-injector`), validate it with the mock (chunk-02), then land the first real LLM end-to-end — `AnthropicApiProvider` + overlay `show_text` renderer + live demo (chunk-03). Session state is memory-ready (`messages[]`).

**THE THIN PORT (Lior decision, 2026-06-02 — supersedes the spec's "anticipate agent-harness in the union"):** the port is `{ readonly id: string; advance(state, inbound): Promise<ProviderResult> }` — **no `kind` field, NO `ProviderKind` discriminated union.** Adapters implement the port directly (mock now, `AnthropicApiProvider` in chunk-03). agent-harness providers (own their tool loop) get a **separate future sub-seam** built when provider #2 lands — we do NOT lay down a family discriminant with no impl/test (rule of three; research 3-0). Captured in **ADR-0010 (revised)**.

**Tech Stack:** TypeScript on Bun, Zod (existing), `bun test`. Chunk-03 adds `@anthropic-ai/sdk` (new runtime dep — ADR-gated by ADR-0011).

---

## Status

`IN PROGRESS — chunk-02 implementation` (plan approved by Lior 2026-06-02; ADR-0010/0011 `proposed`; chunk-03 planned below; one PR for both; chunk-03 demo gate pending).

## ADRs

- `orchestration/docs/adr/0010-pluggable-llm-provider-abstraction.md` (status: `proposed`) — "ADR-B". **Revised 2026-06-02 to the THIN port** (no `ProviderKind` union). Resolves open-question Q1 (forward-pointer set; full strike on acceptance at closeout).
- `orchestration/docs/adr/0011-llm-auth-and-subscription-strategy.md` (status: `proposed`) — "ADR-C" (chunk-03). API-key first; subscription via Agent-SDK CLI-spawn = provider #2 post-2026-06-15; never OAuth-reuse. Gates the new `@anthropic-ai/sdk` dependency.

Both `proposed` — awaiting Lior's acceptance at PR review (PIPELINE.md §5.2).

---

# CHUNK 02 — AgentProvider port + llm-injector + mock-behind-port + memory-ready `messages[]`

## Context

This is **chunk-02 of the `llm-text-slice` feature** (first post-v0 vertical slice; spec `orchestration/docs/specs/2026-06-02-llm-text-slice.md` §3②, §4, §11 ADR-B). Chunk-01 (`show_text` display-only primitive + ADR-0009) is **merged and frozen**. This chunk is a **behaviour-preserving daemon refactor**: it builds the provider abstraction and validates it with the mock *before* any real LLM (chunk-03). The frozen yardstick is `orchestration/chunks-todo/llm-text-slice/02-agent-provider-port-and-injector.md`. No real LLM call, no `agent-harness` adapter, no multi-turn — those are out of scope here.

## Reality check

**This section is authoritative. Every reality assumption in the chunk brief was verified against source; corrections are called out explicitly.**

### What the existing daemon code actually looks like

- **The mock is a PURE, SYNCHRONOUS reducer**, not an async agent. `packages/daemon/src/mock-agent.ts` exports `advanceMockAgent(state: MockSessionState | undefined, inbound: MockAgentInput): MockAgentResult`. Its header comment locks this as decision D-02a-1: "Knows NOTHING about WebSockets/async/timers. The daemon (index.ts) owns the `Map<session_id,state>` and all `ws.send`." The chunk brief calls the port an "async producer" — correct as the *target shape*, but the **mock's core is sync today** and must stay sync to keep its unit tests green (see below). The async-ness is added by the **wrapper**, not by editing the reducer.

- **The reducer handles the FULL session lifecycle, not just `session_start`.** `MockAgentInput` is a union of three inbound envelopes: `session_start | tool_result | tool_cancel`. The chunk brief and spec §3② emphasize "route `session_start` through the injector," which **under-specifies the real requirement**: to preserve the color-picker resolve and cancel paths, the active provider must process **all three** reducer-input types, not only `session_start`. The design below routes **all reducer-input envelopes** (the existing `REDUCER_INPUT_TYPES` set) through the active provider. Routing only `session_start` would break the existing `daemon.test.ts` / `mock-agent.daemon.test.ts` resolve + cancel + malformed paths.

- **`session_start` is currently routed through `advanceMockAgent`, NOT through `session.ts`.** `index.ts:55` calls `advanceMockAgent(prior, inbound)` for every reducer-input envelope. `packages/daemon/src/session.ts` (`handleSessionStart`) is **DEAD CODE** — it is imported by nothing in `index.ts` (verified: only `session.test.ts` imports it). The chunk/spec wording "route `session_start` through the injector → active provider" should be read as "replace the direct `advanceMockAgent(...)` call in `index.ts` with `activeProvider.advance(...)`." `session.ts` is irrelevant to this refactor and is intentionally left untouched (deleting it is out of scope; see Open questions).

- **The imperative shell is `index.ts`.** `startDaemon()` owns: the `Bun.serve` WS server, the `sessions: Map<string, MockSessionState>` registry, `send()` (with defence-in-depth outbound validation via `parseEnvelope`), the `REDUCER_INPUT_TYPES` gate, and per-connection session cleanup on `close`. This is where the injector is wired and where the provider's async boundary lands.

- **Current session-state shape:** `MockSessionState = { phase: "awaiting_pick"; session_id; call_id } | { phase: "done"; session_id }`. There is **no `messages[]` today.** The chunk wants `messages[]` added (memory-ready). This must be **additive** so the existing phase-discriminated logic is untouched.

- **Typed-error discipline (gotcha #9) is real and tested.** The reducer **never throws**; it returns `{ ok: false; error: MockAgentError; nextState; outbound }`. `mock-agent.test.ts` asserts no-throw on malformed `tool_result`. The port's result type must carry this discriminated `ok/error` shape forward so chunk-03's real adapter honours it.

### Constraint achievability

- **`git diff packages/protocol` stays empty — ACHIEVABLE and required.** This chunk touches only `packages/daemon`. It imports `Envelope` (and, for chunk-03 readiness only, may import the *existing* `TOOL_INTERACTION` / `ShowTextArgs` — but this chunk emits no `show_text`, so it need not). No protocol shape changes. **Citation test:** the design below requires no new envelope variant, no new tool, no schema edit. If any worker step appears to need a protocol edit, that is a **stop-the-line** signal — halt and flag, do not design one.

- **`show_text` / `TOOL_INTERACTION` already exist in protocol** (chunk-01, `packages/protocol/src/tools.ts`). The chunk brief does not mention this. It is relevant only as context: the port shape is designed to *later* emit `show_text` (chunk-03), but **this chunk's mock emits only `show_color_picker`** — behaviour unchanged. No protocol interaction needed.

- **Mock can be wrapped without behaviour change — ACHIEVABLE.** The only consumers of the mock are `index.ts` and `mock-agent.test.ts` (verified by grep — no other files reference `advanceMockAgent` / `MockSessionState` / `MockAgentResult`). Strategy: **leave `mock-agent.ts` byte-unchanged** (its unit tests keep calling `advanceMockAgent` directly and stay green untouched), and create a **thin adapter** `providers/mock-provider.ts` that wraps the reducer behind the port. The integration tests (`daemon.test.ts`, `mock-agent.daemon.test.ts`) exercise the WS path and stay green because the default-selected provider is `mock` and produces the identical envelopes.

- **DoD is all mechanical** (typecheck / `bun test` green / empty protocol diff). Per project lesson on runtime proof: there is no behavioral/UI claim here, so **command-evidence at execution time is the proof** — no live demo needed for this chunk (that gate is chunk-03).

### Net correction to the brief

The brief's "route `session_start` through the injector" is necessary-but-insufficient phrasing; the verified requirement is **route all reducer-input envelopes (session_start, tool_result, tool_cancel) through the active provider**, and `session.ts` is dead code uninvolved in the routing. Everything else in the brief holds.

## Design

### The seam, precisely

```
index.ts (imperative shell)
  ├─ buildInjector()  ──selects by LLM_PROVIDER env (default "mock")──►  activeProvider: AgentProvider
  └─ on each reducer-input envelope:
        const result = await activeProvider.advance(priorState, inbound)   // async boundary
        // index.ts still owns the Map + ws.send + cleanup (unchanged)

providers/
  ├─ provider.ts        ── AgentProvider port (THIN — no kind) + ProviderResult types
  ├─ mock-provider.ts   ── wraps the BYTE-UNCHANGED advanceMockAgent reducer
  └─ injector.ts        ── registry/selector (Map keyed by id; select by LLM_PROVIDER)

mock-agent.ts  ── UNCHANGED (pure reducer = the mock provider's functional core)
```

### `AgentProvider` port (TypeScript signature sketch)

In `packages/daemon/src/providers/provider.ts`:

```ts
import type { Envelope } from "@agentic/protocol";

/** Memory-ready conversation turn. Single-turn puts exactly one in messages[].
 *  Multi-turn later = append more; NOT a rewrite. No tool/role taxonomy beyond
 *  user|assistant yet (kept minimal per gotchas #29/#30 — deferred). */
export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

/** Per-session state the provider reads/writes. Additive superset of the
 *  mock's existing phase machine: phase fields stay; messages[] is new. */
export type ProviderSessionState =
  | { phase: "awaiting_pick"; session_id: string; call_id: string; messages: SessionMessage[] }
  | { phase: "done"; session_id: string; messages: SessionMessage[] };

/** The three inbound envelopes a provider consumes (= existing MockAgentInput). */
export type ProviderInput =
  | Extract<Envelope, { type: "session_start" }>
  | Extract<Envelope, { type: "tool_result" }>
  | Extract<Envelope, { type: "tool_cancel" }>;

export type ProviderError =
  | { kind: "malformed_tool_result"; detail: string }
  | { kind: "unexpected_message"; detail: string }
  | { kind: "provider_failure"; detail: string }; // reserved for chunk-03 real adapters

/** Typed result — NEVER throw (gotcha #9 carried forward). Mirrors MockAgentResult. */
export type ProviderResult =
  | { ok: true; nextState: ProviderSessionState; outbound: Envelope[]; finalText?: string }
  | { ok: false; error: ProviderError; nextState: ProviderSessionState; outbound: Envelope[] };

/** The swappable seam — THIN (no `kind` field). Auth is INTERNAL to the adapter
 *  — the port has no credential surface. advance() is async (imperative shell)
 *  so a network adapter (chunk-03) fits the same signature the mock satisfies
 *  trivially. agent-harness providers get a SEPARATE future sub-seam, not a
 *  branch here (Lior 2026-06-02; ADR-0010 revised). */
export interface AgentProvider {
  readonly id: string;          // e.g. "mock", "anthropic-api" (chunk-03)
  advance(state: ProviderSessionState | undefined, inbound: ProviderInput): Promise<ProviderResult>;
}
```

### No `ProviderKind` family-tag (Lior decision, 2026-06-02)

The earlier draft put a `ProviderKind` discriminated union (`raw-api | agent-harness`) on the port. **Removed.** Rationale: laying down a family discriminant with **no implementation and no test** is speculative abstraction — the union would ship a branch (`agent-harness`) whose adapter does not exist, so only its *type-level* anticipation is provable, not its runtime correctness. Research (3-0) confirms agent-harness providers own their own tool loop and do **not** fit this port → they need a **separate sub-seam**, built when provider #2 (the agent-harness family) actually lands (rule of three).

**What stays:** the *seam* (the thin `AgentProvider` port) is the real anticipation — adding a raw-API provider = implement the port directly (mock, then `AnthropicApiProvider`). The injector is a `Map` keyed by `id`; it does NOT dispatch over a kind. (Captured in ADR-0010, revised.)

### `mock-provider.ts` — mock behind the port

Wraps the **unchanged** pure reducer. The adapter is trivially async (`async` wrapper over a sync call) and translates between `ProviderSessionState` (with `messages[]`) and the reducer's `MockSessionState` (without):

- On the way **in**: strip `messages` to hand the reducer its existing `MockSessionState` (or `undefined`).
- On the way **out**: re-attach `messages` to the reducer's `nextState`. For `session_start`, append a `{ role: "user", content: inbound.text ?? "" }` message (memory-ready — single-turn puts one in). The mock still **ignores** `text` for its color path (behaviour unchanged); `messages[]` is recorded but not used by the mock's logic.
- `MockAgentError` maps 1:1 onto `ProviderError` (`malformed_tool_result`, `unexpected_message`); `provider_failure` is unused by the mock.
- `finalText` passes through unchanged (still logged, not wired — Option A preserved).

Because the reducer is untouched and the adapter only adds the `messages[]` envelope around it, **every outbound envelope is byte-identical** to today. This is the behaviour-preserving guarantee.

### `injector.ts` — registry/selector

```ts
export function buildInjector(env?: Record<string, string | undefined>): AgentProvider {
  const registry = new Map<string, AgentProvider>([
    [mockProvider.id, mockProvider],         // "mock"
    // chunk-03 registers anthropicApiProvider here
  ]);
  const requested = (env ?? Bun.env)["LLM_PROVIDER"] ?? "mock";
  const active = registry.get(requested);
  if (!active) {
    console.error(`[injector] unknown LLM_PROVIDER='${requested}', falling back to 'mock'`);
    return mockProvider;             // graceful default — never throw (gotcha #9 spirit)
  }
  return active;
}
```

The injector is the only place that knows the registry; `index.ts` sees one `AgentProvider`. `env` is injectable so the injector test selects deterministically without touching process env.

### `messages[]` session-state shape

`ProviderSessionState` carries `messages: SessionMessage[]` on **both** phases (additive to the existing `awaiting_pick` / `done` discriminated union). Single-turn populates exactly one user message at `session_start`. **No** multi-turn lifecycle, compaction (gotcha #29), footprint mgmt (gotcha #30), or persistence — explicitly deferred; do not solve.

### How `session_start` (and all inbound) routes through the injector

In `index.ts`:
- Change the `sessions` map type from `Map<string, MockSessionState>` to `Map<string, ProviderSessionState>`.
- Build the active provider once at `startDaemon()`: `const provider = buildInjector();`
- Replace `const result = advanceMockAgent(prior, inbound);` with `const result = await provider.advance(prior, inbound);` (the `message` handler becomes `async`).
- The rest of the shell — minting nothing (provider does), `sessions.set/delete`, `ws.data.sessionIds`, `send()`, `finalText` logging — is unchanged because `ProviderResult` is a structural superset of `MockAgentResult` (`nextState` now has `messages[]`, which the shell ignores).

☆ Альтернатива (port granularity): a **single `advance(state, inbound)` method** (chosen) vs **separate `onSessionStart` / `onToolResult` / `onToolCancel` methods**. Плюси separate: explicit per-event hooks. Мінуси: forces a method-per-envelope contract that diverges from the existing single-reducer shape, more surface for chunk-03's real adapter to implement, and breaks the clean wrap of `advanceMockAgent`. Single-method wins because it mirrors the existing reducer exactly → smallest behaviour-preserving diff.

### Files to create / modify

- **Create** `packages/daemon/src/providers/provider.ts` — thin port interface (no `kind`), `ProviderSessionState`, `SessionMessage`, `ProviderInput`, `ProviderError`, `ProviderResult`.
- **Create** `packages/daemon/src/providers/mock-provider.ts` — `mockProvider: AgentProvider` wrapping `advanceMockAgent`.
- **Create** `packages/daemon/src/providers/injector.ts` — `buildInjector(env?)`.
- **Create** `packages/daemon/src/providers/injector.test.ts` — selects by config; unknown → mock fallback.
- **Create** `packages/daemon/src/providers/mock-provider.test.ts` — port-contract test: same envelopes as the reducer, `messages[]` populated, typed-error no-throw.
- **Modify** `packages/daemon/src/index.ts` — wire `buildInjector()`, `await provider.advance(...)`, map type → `ProviderSessionState`.
- **UNCHANGED** `packages/daemon/src/mock-agent.ts` + `mock-agent.test.ts` (pure core stays green untouched).
- **UNCHANGED** all of `packages/protocol` (citation-tested empty diff).
- **UNCHANGED** `packages/daemon/src/session.ts` (dead code, not in scope).

## ADR — 0010 (revised to thin port)

The decision is authored and **revised** in `orchestration/docs/adr/0010-pluggable-llm-provider-abstraction.md` (`status: proposed`). Summary: a **thin `AgentProvider` port** + `llm-injector` registry/selector in `packages/daemon`; **auth is a property of the adapter** (no credential surface on the port); adapters implement the port directly (mock now, `AnthropicApiProvider` chunk-03). **No `ProviderKind` family-tag** — the agent-harness sub-seam is deferred to provider #2 (rule of three). ADR-0010 **resolves open-question Q1** (forward-pointer set in open-questions.md; full strike on acceptance). Scope guard: 0010 decides the provider seam + Q1; auth/subscription is ADR-0011 (chunk-03); multi-turn/persistence deferred (gotchas #29/#30).

## Steps

Each step is independently committable. TDD order: failing test → run-red → implement → run-green → commit. Branch per repo convention: `chunk/02-agent-provider-port` (never commit on `main`).

### Step 1 — Define the `AgentProvider` port + wrap the mock behind it (raw-api), with a port-contract test

**Files:**
- Create: `packages/daemon/src/providers/provider.ts`
- Create: `packages/daemon/src/providers/mock-provider.ts`
- Create: `packages/daemon/src/providers/mock-provider.test.ts`
- UNCHANGED: `packages/daemon/src/mock-agent.ts` (wrapped, not edited)

- [ ] **1a. Write the port-contract failing test** in `mock-provider.test.ts`. Cover: (i) `session_start` ⇒ `await mockProvider.advance(undefined, {type:"session_start", trigger:"user", text:"hi"})` returns `ok:true`, `outbound` has 2 envelopes (`session_ack` + `tool_call` with `payload.tool === "show_color_picker"`), `nextState.phase === "awaiting_pick"`, and `nextState.messages` deep-equals `[{role:"user", content:"hi"}]`; (ii) `tool_result {picked}` from an `awaiting_pick` state (with `messages:[…]`) ⇒ `ok:true`, one `session_end{completed}`, `finalText` contains the picked label, `messages` preserved; (iii) `tool_cancel` ⇒ `session_end{cancelled}`; (iv) malformed `tool_result` ⇒ `ok:false`, `error.kind === "malformed_tool_result"`, **no throw** (wrap in try/catch, assert not thrown), `nextState.phase === "awaiting_pick"`, `outbound` empty; (v) `mockProvider.id === "mock"` (the port is thin — no `kind` field to assert).
- [ ] **1b. Run red:** `bun test packages/daemon/src/providers/mock-provider.test.ts` → FAIL (module not found).
- [ ] **1c. Implement `provider.ts`** exactly as the Design sketch (thin port interface — **no `kind` field, no `ProviderKind`**; `ProviderSessionState` with `messages[]` on both phases, `SessionMessage`, `ProviderInput`, `ProviderError`, `ProviderResult`).
- [ ] **1d. Implement `mock-provider.ts`:** `export const mockProvider: AgentProvider`. `advance` is `async`; it (1) derives the reducer's `MockSessionState | undefined` by stripping `messages` from the incoming `ProviderSessionState`; (2) calls `advanceMockAgent(stripped, inbound)`; (3) computes `nextMessages`: start from `state?.messages ?? []`, and if `inbound.type === "session_start"` append `{role:"user", content: inbound.text ?? ""}`; (4) re-attaches `nextMessages` onto `result.nextState` to form `ProviderSessionState`; (5) maps `MockAgentError → ProviderError` 1:1; (6) returns the same `ok`/`outbound`/`finalText`. Set `id:"mock"` (no `kind` field — thin port).
- [ ] **1e. Run green:** `bun test packages/daemon/src/providers/mock-provider.test.ts` → PASS. Also run `bun test packages/daemon/src/mock-agent.test.ts` → still PASS (reducer untouched).
- [ ] **1f. Commit:** `feat(daemon): thin AgentProvider port + mock-behind-port, memory-ready messages[]` with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

### Step 2 — `llm-injector` registry/selector + selection test

**Files:**
- Create: `packages/daemon/src/providers/injector.ts`
- Create: `packages/daemon/src/providers/injector.test.ts`

- [ ] **2a. Write the injector failing test** in `injector.test.ts`: (i) `buildInjector({})` (no `LLM_PROVIDER`) returns a provider with `id === "mock"`; (ii) `buildInjector({ LLM_PROVIDER: "mock" })` returns `id === "mock"`; (iii) `buildInjector({ LLM_PROVIDER: "does-not-exist" })` returns `id === "mock"` (graceful fallback) and **does not throw**; (iv) the returned value exposes the port surface (`.id` + `.advance`). (Inject `env` explicitly so the test never depends on process env.)
- [ ] **2b. Run red:** `bun test packages/daemon/src/providers/injector.test.ts` → FAIL (module not found).
- [ ] **2c. Implement `injector.ts`** as the Design sketch: a `Map` registry seeded with `mockProvider`, select by `(env ?? Bun.env)["LLM_PROVIDER"] ?? "mock"`, unknown → `console.error` + return `mockProvider` (never throw). **No kind-dispatch** — the registry is keyed by `id` only (thin port); chunk-03 adds one registry entry (`anthropic-api`).
- [ ] **2d. Run green:** `bun test packages/daemon/src/providers/injector.test.ts` → PASS.
- [ ] **2e. Commit:** `feat(daemon): llm-injector registry/selector (LLM_PROVIDER env, mock default)`.

### Step 3 — Route the daemon through the injector + verify behaviour-preservation and empty protocol diff

**Files:**
- Modify: `packages/daemon/src/index.ts`
- Verify (no edit): `packages/daemon/src/daemon.test.ts`, `packages/daemon/src/mock-agent.daemon.test.ts`, `packages/daemon/src/mock-agent.test.ts`

- [ ] **3a. Modify `index.ts`:** (1) import `buildInjector` and `type ProviderSessionState`, `type ProviderInput` from `./providers/...`; drop the direct `advanceMockAgent` / `MockSessionState` / `MockAgentInput` imports; (2) change `const sessions = new Map<string, MockSessionState>()` → `Map<string, ProviderSessionState>`; (3) inside `startDaemon()`, before `Bun.serve`, add `const provider = buildInjector();`; (4) make the `websocket.message` handler `async`; (5) replace `const inbound = msg as MockAgentInput` → `as ProviderInput` and `const result = advanceMockAgent(prior, inbound)` → `const result = await provider.advance(prior, inbound)`. The Map-set/delete, `ws.data.sessionIds`, `send()`, and `finalText` logging stay identical (ProviderResult is a structural superset).
- [ ] **3b. Run the FULL existing daemon suite UNTOUCHED:** `bun test packages/daemon` → all of `daemon.test.ts` (allowed/rejected origin + round-trip), `mock-agent.daemon.test.ts` (resolve / cancel / malformed), `mock-agent.test.ts`, plus the two new provider tests → **all PASS**. This is the behaviour-preservation proof (same color-picker envelopes over the WS path via the injected mock).
- [ ] **3c. Typecheck the workspace:** `bun run typecheck` (`tsc --noEmit`) → no errors. Then `bun run lint:strict` → clean.
- [ ] **3d. Citation-tested empty protocol diff:** run `git diff --stat packages/protocol` → **must print nothing** (empty). If it shows any change, **stop-the-line**: a protocol edit was introduced — halt and flag rather than proceeding (this violates the daemon-only constraint).
- [ ] **3e. Commit:** `refactor(daemon): route session lifecycle through llm-injector→active provider (behaviour-preserving)`.
- [ ] **3f. Do NOT open a PR yet.** Chunk-02 and chunk-03 ship in ONE PR (Lior, 2026-06-02). After 3e, chunk-02 is code-complete + mechanically verified on the branch — continue to **CHUNK 03** below in the **same branch**. The single PR opens only after chunk-03's steps + Lior's live macOS demo (chunk-03 Step 4c). (Optionally push the branch to `origin` now for backup — no PR.)

## Open questions for Lior — RESOLVED 2026-06-02

1. **Dead `session.ts` / `session.test.ts`.** `handleSessionStart` is unreferenced by `index.ts` (the reducer handles `session_start`). **RESOLVED — DEFER:** leave `session.ts` / `session.test.ts` untouched in this PR; removal goes in a separate tiny cleanup chunk (avoids scope-creep + a noisy diff). Worker must NOT touch these files.
2. **`SessionMessage` content shape.** **RESOLVED — KEEP MINIMAL:** `{ role: "user" | "assistant"; content: string }`. Enough for single-turn; chunk-03's `AnthropicApiProvider` widens it under the rule of three. Do NOT pre-build a richer tool/system-role taxonomy here (gotchas #29/#30 deferred).
3. **Grilling gate.** Lior chose to **skip** the interactive `grill-with-docs` stress-test — the architect's Reality check already verified non-contradiction with ADR-0002/0003/0005, and ADR-B has its own acceptance gate. Proceeded straight to ADR-B drafting + plan review.

---

# CHUNK 03 — AnthropicApiProvider + end-to-end wiring + overlay text renderer + live demo

**Goal:** Ship the first real LLM provider end-to-end — `AnthropicApiProvider` (Claude **Sonnet 4.6** via `@anthropic-ai/sdk`, `.env` key) registered behind the thin port, an overlay text renderer for `show_text`, the full hotkey→input→Claude→overlay→`session_end{completed}` path, graceful API-error handling — **gated by Lior's live macOS demo.**

**Architecture:** `AnthropicApiProvider` implements the THIN `AgentProvider` port directly (imperative shell: the network call; functional core: a pure `formatShowTextEnvelopes` that builds `session_ack` + `tool_call{show_text}` + `session_end{completed}`). The injector registers it under `"anthropic-api"`, activated by `LLM_PROVIDER=anthropic-api`. The overlay's session-client gains a **display-only branch** (`show_text` → render in the widget window, disarm the handshake timeout, await `session_end`), reusing the v0 confirm-card window + styling. API errors become a graceful `session_end{error}` (never a throw), surfaced by the overlay's existing `runSession`-reject status path.

## Context (chunk-03)

Depends on **chunk-01** (`show_text` display-only primitive + ADR-0009, merged & frozen — `ShowTextArgs`/`TextPrimitive`/`TOOL_INTERACTION` exist in `packages/protocol`) and **chunk-02** (the THIN `AgentProvider` port + `llm-injector` + memory-ready `messages[]`, built above in the same branch). Frozen yardstick: `orchestration/chunks-todo/llm-text-slice/03-anthropic-provider-wire-and-demo.md`. This is where the real LLM lands and **where Lior plays** — its done-gate is **behavioral**, not mechanical.

## Reality check (chunk-03) — AUTHORITATIVE

**Behavioral/runtime claims are marked as requiring Lior's live run — NOT asserted as verified.**

### Overlay: the widget window + v0 confirm-card renderer (what you reuse)
- The top-right widget is a **separate Tauri window labeled `"widget"`** (`apps/overlay/src/main.ts` `WIDGET_LABEL="widget"`; `widget.html`). `main.ts` owns the WS session and relays to the widget over Tauri events (`EV_SHOW="show-picker"`, `EV_RESULT`, `EV_CANCEL`); the widget DOM is driven by `apps/overlay/src/widget.ts` into `#widget-host`.
- The v0 confirm-card renderer is **`renderConfirmation(host, picked)` in `apps/overlay/src/widgets/color-picker.ts`** — DOM-only (no Tauri/WS), builds a `.color-picker-widget.cp-confirmation` card; styling in `apps/overlay/src/widget.css`. The text renderer **reuses this window + the `.color-picker-widget` card chrome** but needs a new display function + a text-specific CSS class.
- Show/hide + the **~1200ms linger** live in `main.ts` (`showWidgetWindow()`/`hideWidgetWindow()`; the linger is the `setTimeout(..., 1200)` in the `runSession(...).then(...)` success branch). The text card auto-dismisses on this **same** linger surface.

### Overlay: submit→session_start is HARDCODED to the color-picker (CRITICAL — the real wiring work)
- Submit→session_start is the `main.ts` Enter handler → `runSession(text, factory, {onToolCall})`. `runSession` (`apps/overlay/src/ws/session-client.ts`) builds `session_start{trigger:"user", text, client_session_id}`, opens the WS, correlates on `session_ack.client_session_id`, resolves on `session_end`.
- **`runSession` is hardwired to the interactive color-picker contract:** on `tool_call` it calls `decideRender(envelope, confirmedSessionId)` (`tool-call-handler.ts`), which returns `{kind:"ignore"}` for **any tool ≠ `show_color_picker`** → a `show_text` tool_call is **silently ignored**; and the **2s handshake timeout** (`ECHO_TIMEOUT_MS=2000`) is disarmed **only** inside the `decision.kind==="render"` branch. So with zero overlay changes, a `show_text` path **times out and `runSession` rejects** before `session_end{completed}` arrives.
- **Required change (additive):** add a **display-only branch** to `session-client.ts` that, on a `show_text` tool_call for the confirmed session, (a) disarms the handshake timeout, (b) invokes a new `onShowText(content)` callback so `main.ts` renders into the widget, (c) keeps the promise open until `session_end`. The color-picker branch stays **byte-unchanged** → existing overlay tests stay green.

### `session_ack` is LOAD-BEARING
- The overlay learns its `session_id` by correlating on `session_ack.client_session_id` (`session-client.ts`). The mock emits `session_ack` then `tool_call`. **Therefore `AnthropicApiProvider` MUST also emit `session_ack{session_id, client_session_id: inbound.client_session_id}` as the FIRST outbound** on `session_start`, before `tool_call{show_text}` + `session_end`. Without the ack the overlay never confirms the session and ignores everything.

### Daemon error path is in the OVERLAY, not the daemon (CORRECTION)
- The daemon's `!result.ok` branch emits **NO envelope** today — it only `console.error`s and forwards `result.outbound` (the `for (const out of result.outbound)` loop runs unconditionally). The "existing error path (v0 step 10)" is the **overlay's** `runSession(...).catch(err => setStatus("error: "+err.message))` + the `runSession` rejections.
- **Consequence:** an Anthropic failure must be turned by the provider into a **graceful terminal `outbound`** — `session_end{reason:"error"}` (the enum already has `"error"`) — and the provider returns `{ok:false, error:{kind:"provider_failure", detail}}` so `index.ts` logs it AND still forwards the `session_end`. The overlay resolves `runSession` on that `session_end` (any reason) → shows `session … — error`. **No daemon error envelope invented; no protocol change.**

### Protocol: `show_text`/`ShowTextArgs` exist & are display-only; diff stays EMPTY
- `packages/protocol/src/tools.ts`: `ShowTextArgs = { text: TextPrimitive }`, `tool_call` union has the `show_text` variant, `TOOL_INTERACTION.show_text = "display-only"`, intentionally **no** `ShowTextResult`. `TextPrimitive = { primitive:"text", content:string }`. Frozen by ADR-0009.
- The adapter emits `tool_call{ payload:{ tool:"show_text", args:{ text:{ primitive:"text", content } } } }` using the **existing** schema. **Composition shape:** args nest the primitive — `{ text: { primitive:"text", content } }`, NOT flattened to `{ content }` (the daemon `send()` `parseEnvelope` would reject it; self-validate with `ShowTextArgs.safeParse` before emitting, mirroring the mock's `ShowColorPickerArgs.safeParse`). **`git diff packages/protocol` MUST stay empty** — stop-the-line if any step seems to need a protocol edit.

### Injector registration point + `@anthropic-ai/sdk` new dep
- The injector (`packages/daemon/src/providers/injector.ts`, chunk-02) is the registration point: add one `Map` entry `[anthropicApiProvider.id, anthropicApiProvider]`. Default selection stays `mock` (so existing daemon tests, which don't set `LLM_PROVIDER`, keep the mock and stay green). `index.ts` needs no change (already routes through `provider.advance`).
- **The port is THIN (no `kind`)** — chunk-02 built it that way (Lior decision). `AnthropicApiProvider` implements `{ id, advance }` directly; **do not add a `kind` field, do not re-litigate the port.** Conform to the as-merged `provider.ts` in the same branch.
- `@anthropic-ai/sdk` is a **new runtime dependency** (daemon deps are currently `@agentic/protocol` + `zod`). New runtime dep → ADR-gated: covered by **ADR-0011** (the API-key-first decision; the dep is its mechanical consequence). Worker adds it to `packages/daemon/package.json` + `bun install`; does not author the ADR.

### `.env` / key
- `packages/daemon/.env` is gitignored; Bun auto-loads it on `bun run dev`. The adapter reads `Bun.env.ANTHROPIC_API_KEY` (injectable for tests). **Never commit a key.** The live demo needs Lior's real key locally. The production launchd daemon does NOT read this `.env` — out of scope (gotcha #38).

### Behavioral DoD — REQUIRES LIOR'S LIVE RUN, NOT VERIFIED
- The criterion "press hotkey, type a question, Claude (Sonnet 4.6, real key) replies, reply text appears in the overlay widget, `session_end{completed}`" is the behavioral done-gate. A worker **CANNOT** launch the native Tauri overlay or hold the real key; code-reading + prior PASS records falsely claimed this 3× in v0. **Marked "requires Lior's live macOS run to confirm" — must NOT be marked verified from tests/code-reading.** The demo is sequenced **BEFORE** any closeout docs (Step 4 = hard STOP).

### Net corrections to the brief
1. The overlay is **not** "reuse window + styling" — `session-client.ts` needs an additive **display-only branch** or the e2e path times out before the reply. This is the load-bearing wiring.
2. The "existing error path" is in the **overlay**, not a daemon error envelope. API errors route there via a graceful `session_end{error}` outbound.
3. Out-of-scope abort-in-flight-on-cancel (gotcha #2 abort-half) is correctly deferred — single-turn has no cancel-during-wait UX.

## Design (chunk-03)

### `AnthropicApiProvider` — raw-API adapter
**File:** `packages/daemon/src/providers/anthropic-api-provider.ts`. Implements the THIN port directly: `id="anthropic-api"`, async `advance`.
- **Pure core** — `formatShowTextEnvelopes(client_session_id, session_id, call_id, content): Envelope[]` returns `[ session_ack{session_id, client_session_id}, tool_call{show_text,{text:{primitive:"text",content}}}, session_end{reason:"completed"} ]`, self-validating args with `ShowTextArgs.safeParse` (no I/O, unit-tested). Sibling `formatErrorEnd(session_id, client_session_id, detail): Envelope[]` returns `[ session_ack{…}, session_end{reason:"error"} ]` (ack still first so the overlay confirms the session before it ends).
- **Imperative shell** — the Anthropic network call, try/catch.
- **`advance` on `session_start{text}`:** mint `session_id`+`call_id` (`crypto.randomUUID()`); append `{role:"user", content: inbound.text ?? ""}` to `messages`; build the client lazily from `ANTHROPIC_API_KEY` (injectable in tests). **Missing/empty key →** do NOT call the SDK → `provider_failure` (`"ANTHROPIC_API_KEY not set"`). Else call `client.messages.create({ model:"claude-sonnet-4-6", max_tokens:512, system: SYSTEM_PROMPT, thinking:{type:"disabled"}, messages })`, `SYSTEM_PROMPT="You are a concise assistant rendered in a small desktop overlay. Keep replies short."`; extract text from the first `block.type==="text"` block (else empty string).
  - *Model/params (claude-api skill):* `claude-sonnet-4-6` (bare id, no date). Tiny single-turn overlay reply → `thinking:disabled` + small `max_tokens` for latency; no streaming (well under the non-streaming ceiling). **Prompt caching:** the tiny system prompt is below Sonnet's 2048-token cache minimum → caching is a documented **no-op** here (add `cache_control:{type:"ephemeral"}` on the system block per skill convention with a code comment that `cache_creation_input_tokens` will be 0 — documented, not a bug).
  - **Success:** `nextMessages=[...messages,{role:"assistant",content:replyText}]`; return `{ok:true, nextState:{phase:"done", session_id, messages:nextMessages}, outbound: formatShowTextEnvelopes(...), finalText:replyText}`.
  - **Any SDK error / missing key (never throw):** `{ok:false, error:{kind:"provider_failure", detail: classifyAnthropicError(err)}, nextState:{phase:"done", session_id, messages}, outbound: formatErrorEnd(...)}`. `classifyAnthropicError` maps `AuthenticationError`→"invalid/missing API key", `RateLimitError`→"rate limited", timeout/`APIError`→"provider unavailable" (gotcha #9 discipline).
- **`tool_result`/`tool_cancel`:** display-only parks nothing, so a real adapter shouldn't get these in the happy path — mirror the mock's guard: `{ok:false, error:{kind:"unexpected_message", …}, outbound:[]}` (never throw).

### Injector registration / overlay renderer / error routing
- **Injector** (`injector.ts`, +1 entry): add `[anthropicApiProvider.id, anthropicApiProvider]`. Default stays `mock`. No `index.ts` change.
- **Overlay text renderer** (display-only, reuse window):
  - **New** `apps/overlay/src/widgets/text-reply.ts` — `renderTextReply(host, content)`: DOM-only `.color-picker-widget.text-reply-card` with `.text-reply-content` holding `content` via **`textContent` (never `innerHTML`)**. Mirrors `renderConfirmation`.
  - **Modify** `apps/overlay/src/widget.css` — `.text-reply-card`/`.text-reply-content` (reuse `.color-picker-widget` dark-card base; wrap long replies, max-height scroll).
  - **Modify** `apps/overlay/src/widget.ts` — listen for `EV_SHOW_TEXT="show-text"` (`{content}`) → `renderTextReply(host, content)`.
  - **Modify** `apps/overlay/src/ws/tool-call-handler.ts` — add pure `decideTextRender(call, confirmedSessionId): {kind:"render-text"; content} | {kind:"ignore"}` (matches `show_text` for the confirmed session, pulls `call.payload.args.text.content`). Parallel to `decideRender`.
  - **Modify** `apps/overlay/src/ws/session-client.ts` — add `onShowText?:(content:string)=>void` to `RunSessionOptions`; after the color-picker `decideRender` branch, on `decideTextRender→render-text`: `clearTimeout(timer)` + `options.onShowText?.(content)` + `return` (do NOT settle — `session_end` resolves it). Color-picker branch byte-unchanged.
  - **Modify** `apps/overlay/src/main.ts` — pass `onShowText` to `runSession`: `hidePanel()` + `emitTo(WIDGET_LABEL, EV_SHOW_TEXT, {content})` + `showWidgetWindow()`. The existing ~1200ms linger auto-dismisses the card.
  - **Gotcha #33/#34 guard:** reuse the existing linger `setTimeout(…,1200)` **as-is** — add **NO new timer**, do **NOT** mutate `input.value`. Verify the diff introduces neither. (A longer read-linger for text is a separate follow-up — flag, don't implement.)
- **Error routing:** `provider_failure` → `index.ts` logs + forwards the `session_end{error}` outbound → overlay resolves `runSession` on it → `session … — error`, lingers/hides. Missing/invalid key, rate-limit, timeout all funnel through this one graceful path. No crash, no orphaned session (`phase:"done"` → `index.ts` deletes it).

### Files to create / modify (chunk-03)
- **Create** `packages/daemon/src/providers/anthropic-api-provider.ts` + `anthropic-api-provider.test.ts` (mocked client).
- **Modify** `packages/daemon/src/providers/injector.ts` (+1 entry); `packages/daemon/package.json` (+`@anthropic-ai/sdk`).
- **Create** `apps/overlay/src/widgets/text-reply.ts` + renderer test.
- **Modify** `apps/overlay/src/ws/tool-call-handler.ts` (+`decideTextRender`) + its test; `session-client.ts` (+display-only branch, +`onShowText`); `widget.ts`; `widget.css`; `main.ts`.
- **Modify** `orchestration/docs/known-gotchas.md` (+7 LLM/auth gotchas, #35-#41).
- **UNCHANGED** all of `packages/protocol`; `index.ts`; `mock-agent.ts`; the color-picker overlay branch (additive only).

## ADR worthy: yes (chunk-03)
**ADR-0011** (LLM auth & subscription strategy) — authored by the adr-curator (`status: proposed`). API-key first + permanent hedge; subscription only via Agent-SDK CLI-spawn as provider #2 (post-2026-06-15, re-verify); never OAuth-reuse; Keychain + prod key-loading deferred. **ADR-0011 records the `@anthropic-ai/sdk` new-dep** (satisfies "no new runtime deps without ADR"). Worker references it in the PR body + adds the dep; does not author it.

## Steps (chunk-03) — same branch as chunk-02

### Step C3-1 — `AnthropicApiProvider` (mocked-client unit-tested) + register + add dep
**Files:** create `anthropic-api-provider.ts` + `.test.ts`; modify `injector.ts`, `packages/daemon/package.json`.
- [ ] **1a.** Conform to the as-merged THIN `provider.ts` (`{ id, advance }`, no `kind`). Do not re-design the port.
- [ ] **1b.** Add `"@anthropic-ai/sdk"` (current stable) to `packages/daemon/package.json` deps; `bun install`. (ADR-gated by 0011.)
- [ ] **1c.** Write the failing unit test with a **mocked Anthropic client** (injected fake `client.messages.create` stub — no network). Cover: (i) happy path — `advance(undefined, {type:"session_start", trigger:"user", text:"hi", client_session_id:"c-1"})` calls the stub **once** with `model:"claude-sonnet-4-6"` + the system prompt + `messages:[{role:"user",content:"hi"}]`; stub returns text `"hello!"`; assert `ok:true`, `outbound` === `[session_ack{client_session_id:"c-1"}, tool_call{tool:"show_text", args.text.content:"hello!"}, session_end{reason:"completed"}]`, `nextState.phase==="done"`, `messages` deep-equals user+assistant, `finalText==="hello!"`; (ii) every outbound passes `parseEnvelope(...).kind==="ok"`; (iii) API error → stub rejects with a fake `AuthenticationError` → **no throw**, `ok:false`, `error.kind==="provider_failure"`, `outbound===[session_ack, session_end{error}]`; (iv) missing key → empty `apiKey` → stub NOT called, `provider_failure`, `outbound===[session_ack, session_end{error}]`; (v) `id==="anthropic-api"`.
- [ ] **1d.** Run red → FAIL.
- [ ] **1e.** Implement per Design (pure `formatShowTextEnvelopes`/`formatErrorEnd` with `session_ack` first + `ShowTextArgs.safeParse`; imperative `advance` with lazy injectable client, the `claude-sonnet-4-6` call, typed `classifyAnthropicError`, never-throw).
- [ ] **1f.** Register in `injector.ts` (+1 entry; default stays `mock`).
- [ ] **1g.** Run green: `bun test packages/daemon` → new test PASS + all existing daemon/injector/mock tests still PASS.
- [ ] **1h. Commit:** `feat(daemon): AnthropicApiProvider (Sonnet 4.6, .env key) behind the port + injector registration`.

### Step C3-2 — Overlay: `show_text` renderer + display-only session-client branch + e2e wiring
**Files:** create `text-reply.ts` + test; modify `tool-call-handler.ts` + test, `session-client.ts`, `widget.ts`, `widget.css`, `main.ts`.
- [ ] **2a.** Write seam failing tests: `decideTextRender(showTextCall,"srv-1")→{kind:"render-text",content}` for the confirmed session, `{kind:"ignore"}` for mismatch; **regression guard** — `decideRender(showTextCall,"srv-1")→{kind:"ignore"}` (color-picker decider must NOT claim a `show_text` call). `renderTextReply(host,"hello world")` → `.text-reply-card` with `.text-reply-content` whose `textContent==="hello world"` (DOM harness as the color-picker tests use).
- [ ] **2b.** Run red → FAIL.
- [ ] **2c.** Implement the pure seams (`decideTextRender`, `renderTextReply` with `textContent`).
- [ ] **2d.** Wire the display-only branch in `session-client.ts` (+`onShowText`, `clearTimeout`, no-settle); color-picker branch byte-unchanged.
- [ ] **2e.** Wire `widget.ts` (`EV_SHOW_TEXT`) + `main.ts` (`onShowText` handler) + `widget.css`. **No new timer; no `input.value` mutation** (gotcha #33/#34).
- [ ] **2f.** Run green: `bun test apps/overlay` → new + existing overlay tests PASS (color-picker round-trip stays green — additive).
- [ ] **2g. Commit:** `feat(overlay): show_text display-only renderer + session-client branch + e2e wiring`.

### Step C3-3 — Record the 7 LLM/auth gotchas + full mechanical verification
**Files:** modify `orchestration/docs/known-gotchas.md`.
- [ ] **3a.** Append the 7 spec-§12 gotchas as `#35-#41` (file already has #1-#34): (35) subscription OAuth-reuse prohibited+server-enforced; (36) subscription-via-Agent-SDK metered+capped (from 2026-06-15); (37) Anthropic flipped the policy twice in 6 months — re-verify; (38) `.env` works for `bun run dev` but NOT the prod launchd daemon; (39) agent-harness owns its tool loop → separate sub-seam (ADR-0010); (40) Claude Code auth precedence ranks subscription OAuth below `ANTHROPIC_API_KEY`; (41) open: CLI-spawn sanctioned-vs-tolerated + does it draw the metered credit. Cross-ref ADR-0011 / spec §6. Also note gotcha #2 abort-half stays deferred.
- [ ] **3b.** Typecheck + lint: `bun run typecheck` → no errors; `bun run lint:strict` → clean.
- [ ] **3c.** Full suite: `bun test` (daemon + overlay + protocol) → all green (incl. mocked-client provider test + renderer/decider seam tests). **Proves code paths + mocked behavior — NOT the behavioral DoD (Step 4).**
- [ ] **3d.** Citation-tested empty protocol diff: `git diff --stat packages/protocol` → prints nothing. Any change → **stop-the-line**, halt + flag.
- [ ] **3e. Commit:** `docs(known-gotchas): record 7 LLM/auth gotchas (#35-#41); chunk-03 verification`.

### Step C3-4 — STOP: Lior's live macOS demo (behavioral done-gate) — BEFORE any closeout
- [ ] **4a. HARD STOP — worker CANNOT close this chunk.** Hand to Lior with a demo checklist (real macOS, real key): (1) put a valid `ANTHROPIC_API_KEY` in `packages/daemon/.env`; (2) `LLM_PROVIDER=anthropic-api bun run dev` (daemon) + start the overlay per the v0 run procedure; (3) hotkey → type a question → Enter; (4) **gate:** Claude (Sonnet 4.6) replies, the reply text appears in the top-right widget, status `session … — completed`, widget lingers ~1200ms then hides, no crash/orphan; (5) error checks: blank/invalid key → graceful `error:` no crash; (optional) airplane-mode/timeout → graceful.
- [ ] **4b.** Lior records the result as the behavioral evidence. **Only Lior's PASS closes the behavioral DoD.** Demo fails → systematic-debugging, fix on branch, re-demo — do NOT mark done.
- [ ] **4c. (After Lior's PASS only) Closeout PR:** push branch + `gh pr create` targeting `main` (ONE PR, both chunks). PR body: the thin-port seam (chunk-02) + AnthropicApiProvider/overlay/e2e (chunk-03); verification = full suite green + typecheck/lint clean + `git diff packages/protocol` empty + **Lior's live macOS demo PASS**; ADRs 0010+0011 (`proposed` → Lior accepts at review). Standard attribution line. **Lior reviews + merges — worker does NOT merge.**

## Open questions for chunk-03 — RESOLVED 2026-06-02
1. **Error UX surface.** **RESOLVED — status-line only.** On an API failure, graceful `session_end{error}` → the overlay's existing `error: …` status text is enough for the demo (this is exactly the chunk-03 brief's "graceful via the existing error path"). The richer in-widget error `show_text` is gotcha #6's deferred "retry-with-new-key" flow — NOT built here.
2. **Port shape as-merged.** **RESOLVED — THIN, conform don't re-litigate.** chunk-02 ships the thin port (no `kind`); `AnthropicApiProvider` implements `{ id, advance }` directly.
