> 🗄️ ARCHIVED 2026-07-13 — shipped. Historical record; do not edit.

# Memory Action Tools (2c) — Chunk 02 "Provider tool loop" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the first real LLM tool-use loop into `AnthropicApiProvider.advance()` so a capability-present provider can call the chunk-01 `MemoryActionPort` (`memory_forget`/`memory_remember`) mid-turn, bounded by the one shared cap, with the fact-targeting ordinal slice plumbed in — and prove it end-to-end on real SQLite + one executed real-API probe.

**Architecture:** A daemon-internal action-tool registry (`memory-action-tools.ts`, NOT `@agentic/protocol`) declares the closed set + Anthropic `tools[]` schemas + a total interaction table + a `kind:"read"|"write"` 2d slot. `advance()` gains a bounded tool loop (adapter-internal, ADR-0010 port signature unchanged) that runs **iff** a `MemoryActionPort` is injected via factory opts (the `clientFactory` posture). The per-turn ordinal slice (`ordinal → distilled_facts.id`) is derived from the exact post-filter `live` list `MemoryProvider.retrieve` injects, rides in on ONE additive optional field of `ProviderSessionState`, and index.ts adds the `[remembered] N.` index prefix only when the capability is active. No port ⇒ byte-identical to today.

**Tech Stack:** TypeScript on Bun; `@anthropic-ai/sdk` (existing, ADR-0011); `bun:sqlite` (real DB, no store/port mocks); `bun test`; the ONLY stub is the LLM network boundary (`clientFactory`, now scriptable to emit `tool_use` blocks).

## Status: shipped — merged to `main` (PR #87); feature verified-done + Lior's live §6.1 demo signed 2026-07-13

> **Review outcome (2026-07-10).** engine-reviewer pass 1: 0 blockers / **1 MAJOR** (index.ts dropped `memoryActionSlice` when `priorMessages` empty → malformed `"thread:"` provenance + `thread_id=""` audit on the first `remember`, defeating the ADR-0016 dec-4(e) audit-visibility guardrail — structurally uncatchable by the green tests + probe, which bypass index.ts) + 2 minors + 1 nit. hard-reviewer (frontier second pass, justified — first real tool-use loop + poisoning surface): **1 HIGH frontier-delta the Opus pass missed** — the C1 forced-final call OMITTED `tools` while the conversation history contained `tool_use`/`tool_result` blocks ⇒ guaranteed Anthropic **400** ("tool blocks must define tools") on a legitimate 3-forget turn ⇒ `session_end{reason:"error"}` after the deletes already applied (breaks guardrail d1 + the DoD "cap ⇒ forced exit to final text"); + 1 MEDIUM-LOW (max_tokens truncation honesty) + 1 LOW (doc). **ALL FIXED in `850bb4e`:** FIX 1 = keep `tools` declared for the whole turn + `tool_choice:{type:"none"}` on the forced-final round (Option C2; `tool_choice:{type:"none"}` confirmed valid on the STABLE messages.create via context7 + installed `@anthropic-ai/sdk@0.100.1`) — **proven against the REAL API** (probe Scenario 2 = HTTP 200 for the forced-final shape); FIX 2 = attach the slice whenever it exists even with empty messages + a real-`startDaemon` integration test (`memory-action-slice-wiring.daemon.test.ts`) asserting `thread:<realId>` + audit-queryable-under-real-thread; FIX 3 = 2 never-throw coverage tests; FIX 4 = `max_tokens: useTools ? 1024 : 512` (capability-absent stays 512, byte-identical) + empty-reply honest-fallback guard; FIX 5 = catch fallback code branches on tool name. Delta re-review: **0 blockers / 0 majors** — prior BLOCKER + MAJOR confirmed resolved; residual = 1 cosmetic nit (probe comment mislabels the boundary block "FIX 6"→should read "FIX 1"; accepted) + 2 informational-no-action (empty-guard also honests the capability-absent empty-reply case — request still byte-identical; a test-only dual-store-handle — production is single-store).
> Final gate at HEAD `850bb4e` (orchestrator-independently-verified): typecheck 0 · lint:strict 0 · `bun test` **682/0** · frozen byte-diff empty (`packages/protocol/**` + `mock-provider.ts` + `mock-agent.ts` + `system-prompt.ts`). All 6 mechanical DoD blocks proven with command evidence; the EXECUTED real-API probe (2 scenarios) PASSED live (Strike-5). NO behavioral Lior-demo gate this chunk — the joint live demo rides chunk-04 (spec §6). Commits: `0528b6b` / `8b00197` / `dc517fc` / `850bb4e`.
>
> **Both architect open questions RESOLVED by the orchestrator (below). Q1 contingency did NOT fire** — the real sonnet-4-6 called `memory_forget` on the first attempt despite the stale (chunk-03-pending) self-concept, so the "chunk-02 wires capability / chunk-03 rides prompt" decomposition holds.

> **Orchestrator resolutions (2026-07-10):**
> - **Q2 — retrieve return shape: ACCEPT A1** (single widened return `{ messages, injectedFactIds }`). This is architect-time latitude explicitly granted by spec §7 ("`{messages, injected}` or a second method"); the single-read guarantee is what §3.3 D3b requires; the ripple is compiler-enforced/mechanical. No cord-pull.
> - **Q1 — real-API probe trigger risk: PROCEED on the recommendation, with a hard escalate rule.** Build the tool descriptions directive; RUN the probe (Step 3.8). **If the executed probe does NOT emit the `memory_forget` `tool_use` because the stale chunk-03 self-concept ("you cannot forget") suppresses it → STOP and post `BLOCKED` — do NOT mask it, do NOT silently reorder chunk-03.** That outcome would mean the "chunk-02 wires capability, chunk-03 rides prompt" decomposition is wrong (a sequencing finding for Lior/decompose, not an autonomous fix). Not a pre-emptive gate — a contingency to surface only if it fires.

## Global Constraints

Every task implicitly includes these (copied from the chunk file + spec §3 + ADR-0016/0010 + chunk-01 handoff):

- **DO NOT TOUCH (frozen — byte-diff MUST be empty at PR time or the freeze gate fires):** `packages/protocol/**`; `packages/daemon/src/providers/mock-provider.ts` (mock adapter) and the mock reducer `packages/daemon/src/mock-agent.ts`; `packages/daemon/src/providers/system-prompt.ts` (self-concept flip is **chunk-03** — this chunk wires the CAPABILITY only). No wire/envelope change — memory tools are daemon-internal by **ADR-0016 decision 1**; the frozen 6-variant union + `ToolCallPayload` stay byte-unchanged.
- **`AgentProvider` port signature UNCHANGED** (ADR-0010): the tool loop is adapter-INTERNAL exactly the way auth already is. The mock provider is untouched.
- **`ProviderSessionState` gains ONE additive OPTIONAL field ONLY** (spec §3.3/§4 item 4). The mock ignores it (type-additive; verified by the frozen byte-diff on `mock-provider.ts`).
- **ONE cap constant:** import `MEMORY_ACTIONS_MAX_PER_TURN` (=3) from chunk-01's `packages/daemon/src/memory/memory-action-port.ts`; **do NOT redefine it.** It bounds BOTH loop iterations AND total actions; exceeding ⇒ the port already returns `cap_exceeded` — the loop force-exits to the final-text phase.
- **ONE per-turn action context object** (spec §7 CLOSED): chunk-01 owns cap enforcement + its test against `MemoryActionTurnContext`; chunk-02's loop CONSTRUCTS one per turn (`{ threadId, ordinalMap, actionsUsed: 0 }`) and hands the SAME object to every port call in the turn (shared cap counter).
- **Never throw across `advance()`** (gotcha #9): the loop validates parsed `tool_use.input` BEFORE the port call and wraps the port call defensively; malformed args → a typed `tool_result` the LLM can reason about, never a throw.
- **Ordinal targeting NEVER resolves from LLM-echoed ids** (spec §3.3 D3a): the ordinal map is server-side; the LLM only echoes the small integer + fact text.
- **The ordinal map derives from the EXACT post-filter `live` list actually injected** (after `isFactTombstoned`), NEVER raw DB rows (spec §3.3 D3b).
- **2d compatibility is a design requirement, not a build item:** the registry + loop dispatch must ADMIT a future `kind:"read"` tool without reshaping — build NO read tool.
- **Streaming / progress UX is OUT** (deferral #42/#43): add NO timers; verify by reasoning that a cap=3 tool turn fits the 30s handshake window; note it, don't fix it.
- **Real SQLite + real daemon path; only the LLM network boundary (`clientFactory`) may be stubbed.** No mocked store/Hatch/port internals. `bun test` + typecheck + `lint:strict` green; frozen byte-diff empty at PR time.
- **The executed real-API probe reads the ANTHROPIC key from Keychain INTERNALLY (via `resolveAnthropicKey`) and MUST NEVER print the key.**

---

## Reality check

Every claim in the brief was verified in-source. Confirmed unless marked **CORRECTED**. Behavioral DoD lines are marked *"requires the executed probe/test to confirm"* — never "verified" from code-reading (PIPELINE §6.1).

1. **`advance()` is a single `messages.create()` with NO `tools[]` — CONFIRMED.** `anthropic-api-provider.ts:276-291` — one `client.messages.create({ model:"claude-sonnet-4-6", max_tokens:512, thinking:{type:"disabled"}, system:[…COMPOSED_SYSTEM_PROMPT…], messages })`; first text block extracted (`:294-300`); `formatShowTextEnvelopes` (`:44-66`) emits the terminal envelopes. Spec's `:276-291` citation still matches.
2. **Chunk-01 `MemoryActionPort` API — CONFIRMED exactly as the brief states.** `memory-action-port.ts` exports `MEMORY_ACTIONS_MAX_PER_TURN = 3` (`:9`), `MemoryActionTurnContext { threadId; ordinalMap: Map<number,string>; actionsUsed: number }` (`:17-21`, port MUTATES `actionsUsed` at `:61`/`:132`), `MemoryActionResult` typed union (`:23-25`), and `class MemoryActionPort` `constructor(store, gate, scanner)` (`:46-51`) with `forget(ctx, {ordinal, expected_text, reason?})` (`:53`) and `remember(ctx, {fact, replaces_ordinal?, expected_text?})` (`:124`). **Also exports** `MemoryForgetInput` (`:27-31`) and `MemoryRememberInput` (`:33-37`) — chunk-02 may import these input types rather than re-declaring.
3. **Nit-fold target — CONFIRMED.** The defensive ordinal-prefix strip lives in the private `normalizeExpectedText` helper at `memory-action-port.ts:238-242`: `text.replace(/^\s*\d+\.\s*/, "")`. The trailing `\s*` is the exact token to change to `\s+`. (The brief's `expected_text.replace(...)` phrasing refers to the same regex; the helper param is named `text`.)
4. **`ProviderSessionState` shape / `AgentProvider` signature — CONFIRMED.** `provider.ts:17-19` is a 2-variant discriminated union (`awaiting_pick` | `done`), no memory field. `AgentProvider.advance(state, inbound)` (`:46-52`) is the thin port. Adding ONE optional field to both variants leaves the port signature untouched.
5. **retrieve return shape + the `id` availability — CONFIRMED, with a stale-comment CORRECTION.** Both providers' `retrieve(store, forThreadId): Promise<SessionMessage[]>` build `${REMEMBERED_LABEL}${f.fact}` from the post-filter `live` list (smart `:650-669`, dumb `:92-111`). **CORRECTED:** the inline comment "`rows currently lack id (Step 3 adds it)`" in both providers is STALE — `readDistilledFactsForThread` already `SELECT df.id AS id …` into `DistilledFactRow` (`store.ts:499-512`), and `DistilledFactRow` carries `id: string` (`store.ts:114-123`). So `live[i].id` is available today; exposing ids is a **return-SHAPE change only**, no store/SQL change.
6. **retrieve → beginTurn → index.ts data flow — CONFIRMED.** `ThreadLifecycle.beginTurn` calls `retrieve` in both the known-thread branch (`thread-lifecycle.ts:79-83`) and the new-thread branch (`:118-121`) and returns `{ threadId, priorMessages: [...facts, ...tail] }` (facts first). `index.ts:164-186` consumes it, builds `priorState`, and sets `injectedMemory` by `m.content.startsWith(REMEMBERED_LABEL)` (`:177-178`). `REMEMBERED_LABEL = "[remembered] "` (`system-prompt.ts:61`) — inserting `N. ` **after** the label (`[remembered] 3. <fact>`) preserves the `startsWith` check, so the provenance-stamp flag is unaffected.
7. **DI seam — CONFIRMED.** `buildInjector` (`injector.ts:17-36`) builds a registry from the pre-built singletons `mockProvider`/`anthropicApiProvider`; `startDaemon` (`index.ts:69-81`) already builds `store`/`scanner`/`gate`/`hatch` and calls `buildInjector()`. No `MemoryActionPort` is constructed today. `createAnthropicApiProvider(opts)` (`anthropic-api-provider.ts:147-186`) is the `clientFactory`-posture DI point — the new `memoryActionPort` opt lands here.
8. **Frozen-surface safety — CONFIRMED.** `mock-provider.ts:66-79` constructs `ProviderSessionState` via object literals that do NOT set any memory field; adding an OPTIONAL field keeps it byte-unchanged. No `@agentic/protocol` change is required (no wire/envelope touch).
9. **Test/probe conventions — CONFIRMED.** `anthropic-api-provider.test.ts:22-36` stubs `client.messages.create` with a `FakeClient` and can capture params — extend it to return `stop_reason` + `tool_use` blocks. `forget-roundtrip-probe.ts` is the probe template (banner, temp store seed, real daemon, asserts, `PROBE PASSED`, never prints secrets); the new probe reads the key via `resolveAnthropicKey` internally.
10. **Behavioral note (requires the executed probe to confirm):** during chunk-02 the port is wired (capability present) but `system-prompt.ts` still says "you cannot forget" (the honest flip is chunk-03). The probe therefore relies on **directive tool descriptions** to make sonnet-4-6 actually call `memory_forget` despite the stale self-concept. If the executed probe shows the old prompt suppresses the tool call, that is a real finding to escalate (it would make chunk-03's prompt flip a hard dependency of the capability). See `## Status` Q1 resolution — STOP + BLOCKED, do not mask.

**No spec claim was falsified.** One stale in-source comment corrected (item 5); one behavioral risk flagged (item 10).

---

## Approaches

Three design points are architect-time (spec §7 leaves them open); the rest is spec-frozen. Options + recommendation below.

### A. `retrieve` id-exposure shape (spec §7: "`{messages, injected}` or a second method — frozen: ids exposed, both providers, swap-proof re-asserted") — RESOLVED: A1

- **Option A1 — widen the return to `{ messages: SessionMessage[]; injectedFactIds: string[] }` (parallel arrays; `injectedFactIds[i]` is the id rendered at `messages[i]`).** Pros: ids and messages come from ONE read of the exact `live` list → the "exact injected slice" invariant (§3.3 D3b) is structurally guaranteed; matches how beginTurn already threads a single result. Cons: return-type change ripples to ~a dozen `.retrieve(` call sites (mechanical; the compiler flags each). **CHOSEN.**
- **Option A2 — keep `retrieve` returning `SessionMessage[]`, add a second method `retrieveInjectedIds`.** Pros: minimal ripple. Cons: two reads can diverge (a fact tombstoned between calls) → the ordinal map could point at the wrong/absent fact — the precise failure §3.3 D3b guards against. Rejected.

### B. Where the `[remembered] N.` prefix + ordinal map are built, and how the loop is gated — RESOLVED: B1

- **Option B1 — index.ts owns BOTH the prefix and the `ordinalMap`, gated on a `memoryActionsActive` boolean = `activeProvider.id === "anthropic-api"`; the map rides on `ProviderSessionState.memoryActionSlice`.** Pros: single source of order truth (prefix index ⇔ map key built together); the provider just consumes the slice + declares tools iff the port opt is set; capability-absent path is byte-identical because `active.id !== "anthropic-api"` (mock/keyless) ⇒ no prefix, no field. Cons: index.ts must know the active provider id (already public on `AgentProvider`). **CHOSEN.**
- **Option B2 — index.ts always populates the field + prefix; the provider decides whether to use them.** Rejected: the prefix would change the injected message format for the mock/keyless path too, breaking the byte-identical regression and the verbatim-format prompt/provenance tests.
- **Option B3 — the provider re-numbers `[remembered]` messages itself from the map.** Rejected: dual source of order truth (index.ts map vs provider re-numbering) is fragile.

### C. Loop bound + final-text exit — RESOLVED: C1 (omit `tools` on the forced final call)

- **Option C1 — bound tool-executing rounds by `MEMORY_ACTIONS_MAX_PER_TURN`; on hitting the bound, make one final `messages.create()` with `tools` omitted to force clean final text.** Pros: loop iterations AND actions both bounded by the ONE constant (spec §3.4 D4c); the port's `cap_exceeded` is the natural terminator, the round bound is the hard backstop against a misbehaving LLM; at most `cap+1 = 4` sequential model calls. Cons: one extra API call in the pathological case (bounded, acceptable). **CHOSEN.**
- **Option C2 — `tool_choice:{type:"none"}` on the final call instead of omitting `tools`.** Equivalent; omitting `tools` is simpler and keeps the payload closest to today's shape. Minor preference for omit.

**#42 handshake reasoning (no code):** worst case = `MEMORY_ACTIONS_MAX_PER_TURN + 1 = 4` sequential sonnet-4-6 calls (each typically 1–3s) + 3 SQLite port ops (sub-ms) ≈ well under 30s. No timers added; note only.

## Chosen Approach

A1 + B1 + C1. Concretely:

1. **Registry** (`memory-action-tools.ts`, new): closed set `memory_forget {ordinal, expected_text, reason?}` / `memory_remember {fact, replaces_ordinal?, expected_text?}`; Anthropic `tools[]` param array; a `MEMORY_ACTION_TOOLS` object `satisfies Record<MemoryActionToolName, MemoryActionToolSpec>` (adding a tool without a row = compile error); a `kind:"read"|"write"` discriminator (no read tool built); and a documented, stable `tool_result` JSON serialization (= the `MemoryActionResult` shape, the de-facto 2d contract).
2. **`retrieve` widening (A1)** → `{ messages, injectedFactIds }` in both providers (from the exact `live` list); swap-proof re-asserted; ripple through `beginTurn` + all `.retrieve(` call sites.
3. **`ProviderSessionState.memoryActionSlice?: MemoryTurnSlice`** (one additive optional field) carrying `{ threadId, ordinalMap }`.
4. **index.ts (B1)** on session_start: `memoryActionsActive = activeProvider.id === "anthropic-api"`; when active + `injectedFactIds.length>0`, index the first-N `[remembered]` messages (`withRememberedIndex`) and build `ordinalMap`; populate `priorState.memoryActionSlice`. `startDaemon` constructs `new MemoryActionPort(store, gate, scanner)` and passes it via `buildInjector(env, { memoryActionPort })`.
5. **Bounded loop (C1)** inside `advance()`, adapter-internal, tools declared iff `opts.memoryActionPort` present; typed-arg validation before every port call; final text through `formatShowTextEnvelopes` unchanged.
6. **Nit-fold** to chunk-01's `normalizeExpectedText` regex + regression test.
7. **Scripted-`tool_use` deterministic tests** + **one EXECUTED real-API probe.**

---

## ADR worthy: no

The chunk consumes accepted **ADR-0016** (two-plane decision, closed-set/`kind` discriminator, DI-into-adapter seam, guardrail package, ordinal targeting) and **ADR-0010** (thin `AgentProvider` port preserved — the loop is adapter-internal like auth). No new binding decision: the `tools[]` schema wording, the `{messages, injectedFactIds}` return shape, the `memoryActionSlice` field name, the loop bound, and the `tool_result` JSON serialization are all architect-time latitude explicitly granted by spec §7. No wire/protocol change (ADR-0002/0005 untouched), no new runtime dependency (`@anthropic-ai/sdk` already present). Nothing reopens a frozen decision. **If** the executed probe (Q1) shows the capability cannot fire without the chunk-03 prompt flip, that is a decomposition/sequencing finding to escalate — not an ADR — and does not change this ruling.

---

## File Structure

- `packages/daemon/src/providers/memory-action-tools.ts` **(new)** — registry: closed set, `MemoryActionToolName`, `ToolKind`, `MemoryActionToolSpec`, `MEMORY_ACTION_TOOLS satisfies Record<…>`, `MEMORY_ACTION_TOOLS_PARAM` (the `tools[]` array), `serializeToolResult(result)`.
- `packages/daemon/src/providers/memory-action-tools.test.ts` **(new)** — registry shape + `satisfies` totality + serialization stability.
- `packages/daemon/src/memory/memory-action-port.ts` **(modify — chunk-01 file, in-scope per handoff)** — nit-fold `\s*`→`\s+` at `:241`.
- `packages/daemon/src/memory/memory-action-port.daemon.test.ts` **(modify)** — add the digit-leading-fact regression test.
- `packages/daemon/src/providers/provider.ts` **(modify)** — add `MemoryTurnSlice` + `memoryActionSlice?` on both `ProviderSessionState` variants. **AgentProvider signature UNCHANGED.**
- `packages/daemon/src/providers/anthropic-api-provider.ts` **(modify)** — `memoryActionPort?` factory opt; the bounded loop + `dispatchTool` arg-validation; final text unchanged through `formatShowTextEnvelopes`.
- `packages/daemon/src/providers/anthropic-api-provider.test.ts` **(modify)** — scripted `tool_use` tests through `advance()`; capability-absent payload regression.
- `packages/daemon/src/memory/memory-provider.ts` **(modify)** — `retrieve` return type → `RetrievedSlice { messages; injectedFactIds }`.
- `packages/daemon/src/memory/providers/smart-distiller-provider.ts` + `packages/daemon/src/memory/providers/dumb-tail-provider.ts` **(modify)** — return `{ messages, injectedFactIds: live.map(f => f.id) }`.
- `packages/daemon/src/memory/thread-lifecycle.ts` **(modify)** — `beginTurn` returns `{ threadId, priorMessages, injectedFactIds }`; destructure `.messages` from retrieve, thread `.injectedFactIds` up.
- `packages/daemon/src/providers/injector.ts` **(modify)** — `buildInjector(env?, deps?: { memoryActionPort?: MemoryActionPort })`; wire the port into the anthropic provider only.
- `packages/daemon/src/index.ts` **(modify)** — construct the port; `memoryActionsActive`; `withRememberedIndex` helper + `ordinalMap` build; populate `memoryActionSlice` on session_start.
- `packages/daemon/src/providers/memory-turn-slice.ts` **(new, small)** OR inline in index.ts — the pure `withRememberedIndex` + `buildOrdinalMap` helpers, unit-tested.
- `packages/daemon/src/providers/memory-turn-slice.test.ts` **(new)** — prefix-iff-enabled + map-order tests.
- **Ripple (mechanical, compiler-flagged): every `.retrieve(` call site** destructures `.messages` — e.g. `thread-lifecycle.test.ts`, `smart-distiller-provider.test.ts`, `dumb-tail-provider.test.ts`, `provenance-stamp.daemon.test.ts`, `memory-integration.daemon.test.ts`, `distiller-integration.daemon.test.ts`, `write-gate-policy.daemon.test.ts`, `thread-adoption.daemon.test.ts`, `hatch.daemon.test.ts`, `http-routes.daemon.test.ts` (only the ones that actually call `provider.retrieve`).
- `packages/daemon/scripts/memory-action-tool-probe.ts` **(new)** — the EXECUTED real-API probe.

---

## Steps

### Step 1 — The action-tool registry + the chunk-01 nit-fold

**Named DoD:** the closed set + `tools[]` schemas compile; adding a tool name without a table row is a compile error; the `tool_result` serialization is stable; the digit-leading-fact regression is green.

**Files:** Create `packages/daemon/src/providers/memory-action-tools.ts` + `.test.ts`. Modify `packages/daemon/src/memory/memory-action-port.ts:241` + add a test in `memory-action-port.daemon.test.ts`.

**Interfaces — Produces (consumed by Step 2's loop):**
```ts
// memory-action-tools.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { MemoryActionResult } from "../memory/memory-action-port.js";

export type MemoryActionToolName = "memory_forget" | "memory_remember";
/** 2d forward-compat slot (ADR-0016 dec.2). NO read tool built in 2c. */
export type ToolKind = "read" | "write";

export interface MemoryActionToolSpec {
  name: MemoryActionToolName;
  kind: ToolKind;
  description: string;
  input_schema: Anthropic.Tool.InputSchema; // { type:"object", properties, required }
}

/** Total interaction table: `satisfies Record<…>` ⇒ adding a MemoryActionToolName
 *  without a row is a COMPILE ERROR (ADR-0005 versioning discipline, ported). */
export const MEMORY_ACTION_TOOLS = {
  memory_forget: {
    name: "memory_forget",
    kind: "write",
    description:
      "Permanently forget (delete) ONE fact from the numbered list of remembered " +
      "facts shown to you this turn. Call this when the user asks you to forget a " +
      "fact you can see in that list. `ordinal` is the fact's number (e.g. 3 for " +
      "`[remembered] 3. …`). `expected_text` is that fact's text EXACTLY as shown, " +
      "WITHOUT the leading number. Only facts in the current list can be forgotten.",
    input_schema: {
      type: "object",
      properties: {
        ordinal: { type: "integer", description: "The fact's number in the remembered list." },
        expected_text: { type: "string", description: "The fact text exactly as shown, without the leading number." },
        reason: { type: "string", description: "Optional short reason." },
      },
      required: ["ordinal", "expected_text"],
    },
  },
  memory_remember: {
    name: "memory_remember",
    kind: "write",
    description:
      "Remember a new fact about the user, or replace one already in the numbered list. " +
      "`fact` is the note text in the user's own language. To CHANGE a fact already " +
      "shown this turn (the user stated a different value for it), set `replaces_ordinal` " +
      "to its number and `expected_text` to its current text (without the leading number) " +
      "— do NOT emit a near-duplicate. Omit both to add a brand-new fact.",
    input_schema: {
      type: "object",
      properties: {
        fact: { type: "string", description: "The fact text to remember, in the user's language." },
        replaces_ordinal: { type: "integer", description: "The number of the fact this replaces, if any." },
        expected_text: { type: "string", description: "Current text of the fact being replaced, without the leading number." },
      },
      required: ["fact"],
    },
  },
} satisfies Record<MemoryActionToolName, MemoryActionToolSpec>;

/** The `tools[]` array declared in the request when the port is wired. */
export const MEMORY_ACTION_TOOLS_PARAM: Anthropic.Tool[] =
  Object.values(MEMORY_ACTION_TOOLS).map((t) => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
  }));

/** STABLE tool_result serialization = the MemoryActionResult JSON (de-facto 2d contract).
 *  Documented at the registry per the chunk-file Notes. */
export function serializeToolResult(result: MemoryActionResult): string {
  return JSON.stringify(result);
}
```

- [ ] **Step 1.1 — Failing registry tests** (`memory-action-tools.test.ts`): assert `MEMORY_ACTION_TOOLS_PARAM.map(t=>t.name)` deep-equals `["memory_forget","memory_remember"]`; each has `input_schema.type === "object"` and `memory_forget.input_schema.required` deep-equals `["ordinal","expected_text"]`, `memory_remember.input_schema.required` deep-equals `["fact"]`; both `kind === "write"`; `serializeToolResult({ok:true,action:"forget",factId:"x",message:"Forgotten."})` round-trips via `JSON.parse` to the same object. Add a `// @ts-expect-error` block that adds a 3rd key to a local `Record<MemoryActionToolName,…>`-typed literal missing a row, documenting the totality guard.
- [ ] **Step 1.2 — Run, verify FAIL** — `bun test packages/daemon/src/providers/memory-action-tools.test.ts` → FAIL (module not found).
- [ ] **Step 1.3 — Implement `memory-action-tools.ts`** per the interface above.
- [ ] **Step 1.4 — Nit-fold failing test** (`memory-action-port.daemon.test.ts`): seed a MACHINE fact `"3.14 is pi"`, map ordinal 1→id, call `forget({ordinal:1, expected_text:"3.14 is pi"})` → expect `{ok:true}` (row gone) — RED under the current `\s*` (it strips `"3."` → normalized mismatch → `stale_target`). Add a companion assert that an ORDINAL-prefixed echo `"3. favorite colour"` against a fact `"favorite colour"` still matches (`ok:true`).
- [ ] **Step 1.5 — Run, verify FAIL.**
- [ ] **Step 1.6 — Implement nit-fold** — `memory-action-port.ts:241`: change `text.replace(/^\s*\d+\.\s*/, "")` → `text.replace(/^\s*\d+\.\s+/, "")`. Update the `:238-239` doc comment to note the `\s+` guards digit-leading facts (`"3.14 is pi"`).
- [ ] **Step 1.7 — Run, verify PASS** — both registry + nit-fold tests green.
- [ ] **Step 1.8 — Typecheck + `lint:strict` green. Commit** — `feat(2c-02): action-tool registry (closed set + total table + kind slot) + port ordinal-strip nit-fold`.

---

### Step 2 — The bounded tool loop in `advance()` + arg validation + the `ProviderSessionState` field

**Named DoD (all on the REAL port + REAL store; only the LLM stubbed):** scripted `tool_use(memory_forget)` through `advance()` ⇒ fact durably gone + audit event; scripted `memory_remember` ⇒ fact inserted machine-authored/thread-provenance; 4+ tool_use blocks ⇒ `cap_exceeded` + forced exit; typed refusals round-trip, never throw; **no port ⇒ request payload has NO `tools` key** and behavior is byte-identical.

**Files:** Modify `provider.ts`, `anthropic-api-provider.ts`, `anthropic-api-provider.test.ts`.

**Interfaces — Produces:**
```ts
// provider.ts — ONE additive optional field (mock ignores it; mock-provider.ts byte-unchanged)
export interface MemoryTurnSlice {
  threadId: string;
  ordinalMap: Map<number, string>; // ordinal (1..N) → distilled_facts.id, from the exact injected `live` list
}
export type ProviderSessionState =
  | { phase: "awaiting_pick"; session_id: string; call_id: string; messages: SessionMessage[]; memoryActionSlice?: MemoryTurnSlice }
  | { phase: "done";          session_id: string; messages: SessionMessage[]; memoryActionSlice?: MemoryTurnSlice };
```
```ts
// anthropic-api-provider.ts — factory opt (clientFactory posture)
import type { MemoryActionPort, MemoryActionTurnContext, MemoryActionResult } from "../memory/memory-action-port.js";
import { MEMORY_ACTIONS_MAX_PER_TURN } from "../memory/memory-action-port.js"; // VALUE import — see cycle note
import { MEMORY_ACTION_TOOLS_PARAM, serializeToolResult } from "./memory-action-tools.js";
export interface AnthropicProviderOptions {
  // …existing apiKey/client/clientFactory/resolverOpts…
  /** ADR-0016 dec.3 DI seam. Present ⇒ tools[] declared + bounded loop runs. Absent ⇒ byte-identical to today. */
  memoryActionPort?: MemoryActionPort;
}
```

**Loop mechanics (inside `advance()`, session_start branch, after the existing key guard):**
```ts
const useTools = opts.memoryActionPort !== undefined;
const port = opts.memoryActionPort;
const slice = state?.memoryActionSlice;
const turnCtx: MemoryActionTurnContext | undefined = useTools
  ? { threadId: slice?.threadId ?? "", ordinalMap: slice?.ordinalMap ?? new Map(), actionsUsed: 0 }
  : undefined; // prod always populates the slice when useTools (index.ts); "" is a defensive floor

// existing single-turn context: [...priorMessages, userMessage]
const convo: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
let finalText = "";
let rounds = 0;
let requestTools = useTools;

// (try/catch around the whole block stays as today's network error handler)
while (true) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 512, thinking: { type: "disabled" },
    system: [{ type: "text", text: COMPOSED_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: convo,
    ...(requestTools ? { tools: MEMORY_ACTION_TOOLS_PARAM } : {}),
  });
  let text = "";
  const toolUses: Anthropic.ToolUseBlock[] = [];
  for (const block of response.content) {
    if (block.type === "text" && text === "") text = block.text;
    else if (block.type === "tool_use") toolUses.push(block);
  }
  if (!requestTools || response.stop_reason !== "tool_use" || toolUses.length === 0) {
    finalText = text;
    break;
  }
  convo.push({ role: "assistant", content: response.content });
  const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
    type: "tool_result",
    tool_use_id: tu.id,
    content: serializeToolResult(dispatchTool(tu.name, tu.input, port!, turnCtx!)),
  }));
  convo.push({ role: "user", content: results });
  rounds++;
  if (rounds >= MEMORY_ACTIONS_MAX_PER_TURN) requestTools = false; // force clean final text next call
}
// finalText → formatShowTextEnvelopes(client_session_id, session_id, call_id, finalText)  [UNCHANGED]
// nextState.messages = [...messages, { role:"assistant", content: finalText }]  (tool rounds NOT persisted)
```

**`dispatchTool` — arg validation → typed result (reconciliation item 1); NEVER throws:**
```ts
function dispatchTool(
  name: string, input: unknown, port: MemoryActionPort, ctx: MemoryActionTurnContext,
): MemoryActionResult {
  const i = (input ?? {}) as Record<string, unknown>;
  try {
    if (name === "memory_forget") {
      if (typeof i.ordinal !== "number" || !Number.isInteger(i.ordinal))
        return { ok: false, code: "not_in_view", message: "I couldn't tell which listed item to forget — give me its number." };
      if (typeof i.expected_text !== "string")
        return { ok: false, code: "stale_target", message: "I need the exact current text of that fact to safely forget it." };
      const reason = typeof i.reason === "string" ? i.reason : undefined;
      return port.forget(ctx, { ordinal: i.ordinal, expected_text: i.expected_text, reason });
    }
    if (name === "memory_remember") {
      if (typeof i.fact !== "string")
        return { ok: false, code: "rejected_by_scan", message: "I couldn't read the note text to remember." };
      if (i.replaces_ordinal !== undefined && (typeof i.replaces_ordinal !== "number" || !Number.isInteger(i.replaces_ordinal)))
        return { ok: false, code: "not_in_view", message: "I couldn't tell which listed item to replace." };
      if (i.expected_text !== undefined && typeof i.expected_text !== "string")
        return { ok: false, code: "stale_target", message: "I need the exact current text of the fact I'm replacing." };
      return port.remember(ctx, {
        fact: i.fact,
        replaces_ordinal: i.replaces_ordinal as number | undefined,
        expected_text: i.expected_text as string | undefined,
      });
    }
    return { ok: false, code: "not_in_view", message: "Unknown memory tool." }; // closed set ⇒ unreachable; defensive
  } catch (err) {
    console.error("[anthropic-provider] memory tool threw (should not happen):", err instanceof Error ? err.message : err);
    return { ok: false, code: "stale_target", message: "That memory action couldn't be completed." };
  }
}
```

**Arg-validation → existing-code mapping (no new result code — the set is spec-frozen):** malformed forget target → `not_in_view`; missing/bad `expected_text` → `stale_target`; missing/bad `fact` → `rejected_by_scan` (consistent with chunk-01's empty-fact precedent at `memory-action-port.ts:138-144`).

**Cycle note:** `MEMORY_ACTIONS_MAX_PER_TURN` is a VALUE import from `memory/memory-action-port.js`. Verify at build there is no runtime cycle (`memory/*` modules import `providers/provider.js` only via `import type`, which is erased). If a cycle surfaces, move the constant's re-export into a tiny leaf module — but chunk-01 owns the canonical constant; do NOT redefine it.

- [ ] **Step 2.1 — Add the field** to `provider.ts` (`MemoryTurnSlice` + `memoryActionSlice?` on both variants). Typecheck: `mock-provider.ts` must still compile byte-unchanged.
- [ ] **Step 2.2 — Failing loop tests** (`anthropic-api-provider.test.ts`): extend `FakeClient` so `messages.create` returns `{ stop_reason, content }` and can be SCRIPTED per-call (queue of responses). Real `MemoryStore` (temp file) + real `WriteGate` + real `RuleBasedScanner` + real `MemoryActionPort`. Prove:
  - **forget round-trip:** seed one machine fact; build a `ProviderSessionState` with `memoryActionSlice:{threadId, ordinalMap: new Map([[1, factId]])}` + a hydrated `[remembered] 1. <fact>` message; script response 1 = `stop_reason:"tool_use"` with a `tool_use{name:"memory_forget", input:{ordinal:1, expected_text:<fact>}}`, response 2 = `stop_reason:"end_turn"` text `"Done."`. Call `advance(state, session_start)`. Assert: `store.readFactById(factId) === null` (durably gone), a `memory_action_events` row `action:'forget' outcome:'applied'` exists, and the returned `finalText === "Done."` flowing through `formatShowTextEnvelopes` (assert the 3 envelopes shape unchanged).
  - **remember:** script `tool_use{memory_remember, input:{fact:"likes tea"}}` then text; assert a new machine/cross-thread fact with provenance `thread:<threadId>` inserted (via `store.factExistsByDedupKey` / read).
  - **loop bounds:** script a client that ALWAYS returns `stop_reason:"tool_use"` with `memory_forget{ordinal:1,…}`; assert (a) `create` was called at most `MEMORY_ACTIONS_MAX_PER_TURN + 1` times (capture call count), (b) `advance` returns (no hang/throw), (c) the port's shared counter capped — the 4th action produced a `cap_exceeded` `tool_result` (assert a `refused-cap_exceeded` audit row exists). Also script ONE response with 4 `memory_forget` blocks → actions 1–3 applied, 4th `cap_exceeded`.
  - **typed refusal round-trips, never throws:** script `memory_forget{ordinal:99, expected_text:"x"}` (out of map) → the `tool_result` fed back is a `not_in_view` result; wrap the whole `advance` in `expect(() => advance(...)).not.toThrow()` (async: assert it resolves, not rejects). Also script malformed args (`ordinal:"abc"`) → `not_in_view` result, no throw, port never called (assert no audit row / no counter increment).
  - **capability-absent regression:** construct the provider WITHOUT `memoryActionPort`, capture `create` params → assert `"tools" in params === false`; behavior identical to today (single call, text → envelopes).
- [ ] **Step 2.3 — Run, verify FAIL.**
- [ ] **Step 2.4 — Implement** the loop + `dispatchTool` + the `memoryActionPort` opt in `anthropic-api-provider.ts`. Keep the existing tool_result/tool_cancel park guard, key guard, error try/catch, and `formatShowTextEnvelopes`/`nextState` tail exactly as today.
- [ ] **Step 2.5 — Run, verify PASS.**
- [ ] **Step 2.6 — Full provider suite + typecheck + `lint:strict`** — `bun test packages/daemon/src/providers/` green; frozen byte-diff empty on `mock-provider.ts`, `mock-agent.ts`, `system-prompt.ts`, `packages/protocol/**`.
- [ ] **Step 2.7 — Commit** — `feat(2c-02): bounded memory-action tool loop in advance() + arg validation + ProviderSessionState slice`.

---

### Step 3 — retrieve id-exposure + ordinal-slice plumbing + DI wiring + EXECUTED real-API probe

**Named DoD:** both providers' `retrieve` return ids; **swap-proof re-asserted on the widened contract** (spec §4 item 1); `[remembered] N.` prefix present **iff** the capability is active; the port is constructed in `startDaemon` and threaded through `buildInjector`; **the executed real-API probe output is pasted in the PR** (Strike-5 — *requires the executed probe to confirm*).

**Files:** Modify `memory-provider.ts`, both providers, `thread-lifecycle.ts`, `injector.ts`, `index.ts`; create `memory-turn-slice.ts` (+ `.test.ts`) and `scripts/memory-action-tool-probe.ts`; update the mechanical `.retrieve(` ripple.

**Interfaces — Produces:**
```ts
// memory-provider.ts
export interface RetrievedSlice {
  messages: SessionMessage[];       // the [remembered] <fact> messages (UNINDEXED here)
  injectedFactIds: string[];        // parallel: injectedFactIds[i] is the id rendered at messages[i]
}
// retrieve(store, forThreadId): Promise<RetrievedSlice>
```
```ts
// memory-turn-slice.ts (pure helpers; single order-truth for prefix + map)
import type { SessionMessage } from "./provider.js";
import { REMEMBERED_LABEL } from "./system-prompt.js";
/** Insert the 1-based ordinal AFTER the label: "[remembered] <fact>" → "[remembered] 3. <fact>".
 *  Preserves startsWith(REMEMBERED_LABEL) (index.ts injectedMemory flag). */
export function withRememberedIndex(content: string, ordinal: number): string {
  if (!content.startsWith(REMEMBERED_LABEL)) return content; // defensive: only index remembered facts
  return `${REMEMBERED_LABEL}${ordinal}. ${content.slice(REMEMBERED_LABEL.length)}`;
}
export function buildOrdinalMap(injectedFactIds: string[]): Map<number, string> {
  return new Map(injectedFactIds.map((id, i) => [i + 1, id]));
}
```

**Both providers' `retrieve`** (smart + dumb): compute `live` exactly as today, then:
```ts
return { messages: live.map((f) => ({ role: "user" as const, content: `${REMEMBERED_LABEL}${f.fact}` })), injectedFactIds: live.map((f) => f.id) };
```
Update each provider's `memDebug("retrieve", …)` `injected` entry to include `id` (the stale "rows lack id" comments are removed — reality-check item 5).

**`ThreadLifecycle.beginTurn`** returns `{ threadId, priorMessages, injectedFactIds }`. Known-thread branch:
```ts
const slice = this.memoryProvider ? await this.memoryProvider.retrieve(this.store, requested) : { messages: [], injectedFactIds: [] };
const tail = this.store.readThreadTail(requested, TAIL_LIMIT);
return { threadId: requested, priorMessages: [...slice.messages, ...tail], injectedFactIds: slice.injectedFactIds };
```
New-thread branch: `priorMessages = slice.messages`, `injectedFactIds = slice.injectedFactIds`; no-provider path → `injectedFactIds: []`.

**`injector.ts`:**
```ts
import { createAnthropicApiProvider } from "./anthropic-api-provider.js";
import type { MemoryActionPort } from "../memory/memory-action-port.js";
export function buildInjector(env?: Record<string, string | undefined>, deps?: { memoryActionPort?: MemoryActionPort }): AgentProvider {
  const anthropic = deps?.memoryActionPort
    ? createAnthropicApiProvider({ memoryActionPort: deps.memoryActionPort })
    : anthropicApiProvider; // byte-identical singleton when no port
  const registry = new Map<string, AgentProvider>([[mockProvider.id, mockProvider], [anthropic.id, anthropic]]);
  const requested = (env ?? Bun.env)["LLM_PROVIDER"] ?? "mock";
  const active = registry.get(requested);
  if (!active) { console.error(`[injector] unknown LLM_PROVIDER='${requested}', falling back to 'mock'`); return mockProvider; }
  return active;
}
```

**`index.ts` (startDaemon + session_start branch):**
```ts
// after store/scanner/gate/hatch are built:
const memoryActionPort = new MemoryActionPort(store, gate, scanner);
const activeProvider = provider ?? buildInjector(undefined, { memoryActionPort });
const memoryActionsActive = activeProvider.id === "anthropic-api"; // the only port-consuming provider today

// …in message(): session_start branch, after `const begin = await lifecycle.beginTurn(inbound);`
let priorMessages = begin.priorMessages;
let memoryActionSlice: MemoryTurnSlice | undefined;
if (memoryActionsActive && begin.injectedFactIds.length > 0) {
  const n = begin.injectedFactIds.length;
  priorMessages = priorMessages.map((m, idx) => (idx < n ? { ...m, content: withRememberedIndex(m.content, idx + 1) } : m));
  memoryActionSlice = { threadId: turnThreadId!, ordinalMap: buildOrdinalMap(begin.injectedFactIds) };
} else if (memoryActionsActive) {
  memoryActionSlice = { threadId: turnThreadId!, ordinalMap: new Map() }; // remember-no-target still needs threadId
}
hydratedCount = priorMessages.length;
injectedMemory = priorMessages.some((m) => m.role === "user" && m.content.startsWith(REMEMBERED_LABEL));
priorState = priorMessages.length
  ? { phase: "done", session_id: "", messages: priorMessages, ...(memoryActionSlice ? { memoryActionSlice } : {}) }
  : undefined;
```
(The `injectedMemory`/`hydratedCount` computation moves to use the possibly-reindexed `priorMessages` — the `startsWith(REMEMBERED_LABEL)` check is unchanged and still passes because `N. ` sits after the label. **Verify the exact index.ts variable names/branch at build — chunk-01 may have shifted lines; the SHAPE above is the contract, adapt the names to the real code.**)

- [ ] **Step 3.1 — Failing retrieve/swap-proof test** (a focused test, e.g. in `distiller-integration.daemon.test.ts` beside the existing swap-proof, or a new `memory-provider-retrieve.daemon.test.ts`): seed ≥2 cross-thread machine facts on a real store; call `new DumbTailProvider().retrieve(store, t)` and `new SmartDistillerProvider({client: makeEchoStub()}).retrieve(store, t)`; assert BOTH return `{messages, injectedFactIds}` where `injectedFactIds` equals the store's live fact ids in the SAME order as `messages`, `messages.length === injectedFactIds.length`, and each `messages[i].content` starts with `REMEMBERED_LABEL` (UNINDEXED at the retrieve layer).
- [ ] **Step 3.2 — Failing helper test** (`memory-turn-slice.test.ts`): `withRememberedIndex("[remembered] blue", 3) === "[remembered] 3. blue"` and still `startsWith(REMEMBERED_LABEL)`; a non-remembered string is returned unchanged; `buildOrdinalMap(["a","b"])` deep-equals `Map([[1,"a"],[2,"b"]])`.
- [ ] **Step 3.3 — Failing DI/wiring test** (extend `injector.test.ts` + an `index`-level or provider-level check): `buildInjector({LLM_PROVIDER:"anthropic-api"}, {memoryActionPort})` returns a provider whose `advance` (with a scripted `create`-capturing client) includes `tools` in the payload; `buildInjector({LLM_PROVIDER:"anthropic-api"})` (no port) → no `tools`; `buildInjector({LLM_PROVIDER:"mock"}, {memoryActionPort})` → returns the mock (id `"mock"`), unaffected. (The prefix-iff-active behavior is covered by the helper test + `memoryActionsActive` gate.)
- [ ] **Step 3.4 — Run all three, verify FAIL.**
- [ ] **Step 3.5 — Implement** the `retrieve` widening (both providers), `beginTurn` widening + the mechanical `.retrieve(` ripple (destructure `.messages` at each call site — the compiler enumerates them), `memory-turn-slice.ts`, `injector.ts`, and the `index.ts` wiring above.
- [ ] **Step 3.6 — Run, verify PASS** — the three new tests + the FULL memory + provider suites green (the ripple must not regress any existing retrieve consumer).
- [ ] **Step 3.7 — Write the EXECUTED real-API probe** `scripts/memory-action-tool-probe.ts` (model on `forget-roundtrip-probe.ts`): fresh temp `MemoryStore`; seed ONE cross-thread machine fact (e.g. `"favourite colour: blue"`); build `ordinalMap = new Map([[1, factId]])` + a `ProviderSessionState` with `memoryActionSlice:{threadId, ordinalMap}` and a hydrated `[remembered] 1. favourite colour: blue` message; construct `createAnthropicApiProvider({ memoryActionPort: new MemoryActionPort(store, gate, scanner) })` (real client — key resolved INTERNALLY via `resolveAnthropicKey`; the probe MUST NEVER print the key); call `advance(state, session_start{text:"please forget my favourite colour"})`. Capture and print the transcript: the `memory_forget` `tool_use` name + input, the `tool_result` JSON, and the final text. Assert: `store.readFactById(factId) === null` (durable delete via the REAL loop + REAL port), a `memory_action_events` `action:'forget' outcome:'applied'` row exists, and the source-message/`messages` table is untouched (B1). Banner + `PROBE PASSED`. **This is a *behavioral* DoD — requires the executed probe to confirm; the pasted stdout IS the Strike-5 evidence.**
- [ ] **Step 3.8 — Orchestrator RUNS the probe** (`bun run packages/daemon/scripts/memory-action-tool-probe.ts` with `LLM_PROVIDER=anthropic-api` + a resolvable Keychain key) and pastes the FULL stdout into the PR body. If the model does NOT emit the `memory_forget` `tool_use` (old self-concept suppresses it — Q1), STOP and escalate `BLOCKED`; do not mask it.
- [ ] **Step 3.9 — Frozen byte-diff + gates** — `git diff --stat` empty on `packages/protocol/**`, `providers/mock-provider.ts`, `mock-agent.ts`, `providers/system-prompt.ts`; typecheck + `lint:strict` + `bun test` green.
- [ ] **Step 3.10 — Commit** — `feat(2c-02): retrieve id-exposure + ordinal slice plumbing + MemoryActionPort DI + executed real-API probe`.

---

## §7.1 couplings

- **§4 item 1 — `retrieve` contract widens** (returns injected-fact ids alongside messages): a behavioral change to the NON-frozen `MemoryProvider` port, rippling through **both providers**, `ThreadLifecycle.beginTurn`, `index.ts` state assembly, and every `.retrieve(` call site. **Named DoD:** the swap-proof-style test re-asserted on the widened contract (Step 3.1); the ordinal map derives from the exact post-filter `live` list (`live.map(f=>f.id)`), never raw DB rows.
- **§4 item 4 — `ProviderSessionState` additive field** (`memoryActionSlice?`): additive-on-type, but a **behavioral contract for WHO populates it** — `index.ts` session_start branch only, gated on `memoryActionsActive`. The mock ignores it (type-additive; verified by the frozen byte-diff on `mock-provider.ts`). **Named DoD:** capability-absent regression — no port ⇒ no `tools` key, no prefix, byte-identical behavior; mock untouched.
- **§4 item 5 (partial — capability wiring only) — the loop's tool-declaration is capability-conditional:** `tools[]` iff `opts.memoryActionPort` present. The self-concept prompt flip (`system-prompt.ts` turning dynamic) is **chunk-03**, explicitly out here. Behavioral coupling: during chunk-02 the prompt still says "cannot forget" while the tool works — the probe (Step 3.7/3.8) tests the mechanism despite the stale prompt (Q1).
- **#42 handshake-latency note (reason, no timers):** worst case = `MEMORY_ACTIONS_MAX_PER_TURN + 1 = 4` sequential model calls (each ~1–3s) + sub-ms SQLite port ops ≈ ≪ 30s. No streaming/progress UX and no timers added (deferral #42/#43). Noted, not fixed.
- **Cross-chunk fold — arg validation (chunk-01 §7.2 reconciliation):** the loop validates parsed `tool_use.input` types BEFORE the port call and maps malformed args to existing result codes (`not_in_view`/`stale_target`/`rejected_by_scan`), plus a defensive try/catch — so a non-string `expected_text`/`fact` or non-number `ordinal` can never throw past the never-throw port boundary and out of `advance()`.
- **Cross-chunk fold — the nit-fold** (`\s*`→`\s+` in chunk-01's `normalizeExpectedText`) is an in-scope edit to `memory-action-port.ts` per the explicit handoff, with a digit-leading-fact regression test (Step 1).
