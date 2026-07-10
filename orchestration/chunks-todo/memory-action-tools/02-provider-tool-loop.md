# Chunk 2: Provider tool loop — registry, bounded tool-use, DI wiring, real-API probe

**Status:** in-progress
**Created:** 2026-07-10
**Phase:** memory-action-tools (2c)
**Estimated size:** ~1 day
**Depends on:** 01

## Scope

**In:**
- **The action-tool registry** `packages/daemon/src/providers/memory-action-tools.ts` (spec §3.1):
  closed set (`memory_forget {ordinal, expected_text, reason?}`, `memory_remember {fact,
  replaces_ordinal?, expected_text?}` — spec §3.2, q#015 Ruling 1), Anthropic `tools[]` JSON
  schemas, total interaction table (`satisfies Record<…>` — adding a tool without classifying it =
  compile error), `kind: "read" | "write"` discriminator (the 2d forward-compat slot; NO read tool
  built).
- **The bounded tool-use loop in `AnthropicApiProvider.advance()`** (spec §3.4): declare `tools[]`
  iff the `MemoryActionPort` is injected; `tool_use` → port → typed `tool_result` → continue; loop
  and total actions bounded by the ONE `MEMORY_ACTIONS_MAX_PER_TURN` constant (chunk-01's export);
  final text still flows through `formatShowTextEnvelopes` unchanged.
- **DI wiring** (spec §3.4 D4b): factory opts (`clientFactory` posture) → `buildInjector` param →
  `startDaemon` constructs the port over hatch/gate/store. No port ⇒ byte-identical behavior to
  today (no `tools[]`, no loop).
- **The per-turn slice map plumbing** (spec §3.3 D3b + §4 items 1/4): `MemoryProvider.retrieve`
  exposes injected-fact ids (both providers; swap-proof test re-asserted; `DistilledFactRow` already
  carries `id` — return-shape change only); the ordinal map derives from the exact post-filter
  `live` list actually injected, never raw DB rows; `ProviderSessionState` gains the additive
  optional field; `index.ts` populates it on session_start; `[remembered] N.` index prefix added
  ONLY when the port is wired (minimal delta). Tool schemas instruct echoing fact text WITHOUT the
  index; the port strips a leading ordinal prefix defensively before the expected-text match
  (spec §3.3 D3c note).
- Stub-LLM deterministic tests (scripted `tool_use` blocks via `clientFactory`) + **one EXECUTED
  real-API probe** (Strike-5): a real conversation where the real LLM invokes `memory_forget`
  end-to-end on a fresh store — output evidence in the PR.

**Out:** (WHY — §7.2)
- Self-concept text changes — chunk-03 (this chunk wires capability; the honest prompt rides it).
- Any wire/envelope change — memory tools are daemon-internal by ADR-0016 decision 1; the frozen
  union stays byte-unchanged (freeze gate otherwise).
- Streaming / progress UX for the (now longer) tool turns — pre-existing deferral (#42/#43); a 2c
  turn stays within the 30s handshake window at cap=3; note it, don't fix it.
- Any 2d read tool — the discriminator slot only (deliberate designed-not-built, roadmap ruling).

## Done criteria

- [ ] **[mechanical]** Scripted `tool_use(memory_forget ordinal+expected_text)` through
      `advance()` ⇒ fact durably gone + audit event (chunk-01 paths fire through the REAL loop);
      scripted `memory_remember` ⇒ fact inserted machine-authored/thread-provenance.
- [ ] **[mechanical]** Loop bounds: a script emitting 4+ tool_use blocks ⇒ `cap_exceeded` results +
      forced exit to final text; no unbounded loop; typed refusals round-trip to the LLM as
      tool_results (never throw).
- [ ] **[mechanical]** Capability-absent regression: no port ⇒ request payload contains NO `tools`
      key; existing full suite green UNCHANGED; mock provider untouched.
- [ ] **[mechanical]** retrieve id-exposure: both providers return ids; swap-proof test re-asserted
      on the widened contract (spec §4 item 1 named DoD); `[remembered] N.` prefix present iff port
      wired.
- [ ] **[mechanical]** **EXECUTED** real-API probe output in the PR (a probe is evidence only when
      actually run — Strike-5).
- [ ] **[mechanical]** Frozen surfaces byte-diff empty (`packages/protocol/**`, mock reducer);
      typecheck + `lint:strict` + `bun test` green.

## Orchestrator brief (read by the orchestrator from this file)

```
implement chunk 02 (provider tool loop) of memory-action-tools per
orchestration/docs/specs/2026-07-10-memory-action-tools.md §3.1, §3.3 D3b, §3.4 (+ §4 items 1,4,5).

Files to touch (expected):
- packages/daemon/src/providers/memory-action-tools.ts (new registry);
- packages/daemon/src/providers/anthropic-api-provider.ts (tools[] + bounded loop + factory opt);
- packages/daemon/src/providers/provider.ts (ProviderSessionState additive optional field ONLY —
  AgentProvider signature UNCHANGED, ADR-0010);
- packages/daemon/src/providers/injector.ts + packages/daemon/src/index.ts (port construction/pass);
- packages/daemon/src/memory/memory-provider.ts + both providers (retrieve id-exposure) + the
  swap-proof test;
- packages/daemon/scripts/ — the real-API probe.

Do NOT touch: packages/protocol/**, mock-agent.ts (frozen); system-prompt.ts (chunk-03).

Done when: the six DoD blocks pass with command evidence, probe output pasted in the PR.
Couplings: spec §4 items 1 (retrieve widening), 4 (state field population contract), plus the
pre-existing #42 handshake-latency note (do not add timers; just verify cap=3 turns fit 30s).

ADRs in scope: 0016 (plane + DI seam), 0010 (thin port preserved), 0002/0005 (wire untouched).
```

## Notes / Open questions

- Exact tool descriptions/schema wording = architect-time (spec §7); the closed set + result codes
  are spec-frozen.
- If the Anthropic SDK's tool_result content shape forces a text-serialization choice, keep the
  typed-result JSON stable and documented at the registry (it is a de-facto contract for 2d).
