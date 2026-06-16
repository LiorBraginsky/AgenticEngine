# Chunk 5: Smart-distiller truncation guard (MINOR-3 livelock fix)

**Status:** in-progress
**Created:** 2026-06-13
**Phase:** memory-quality (spec `docs/specs/2026-06-13-forget-flow.md` §2 D-E)
**Estimated size:** ~0.5 day (small, isolated)
**Depends on:** 03 (the smart distiller; **independent of chunk 04** — relative order is free)

## Why this chunk exists

`SmartDistillerProvider` caps the LLM **output** at `SMART_MAX_TOKENS=1024` with **no
`stop_reason` check**. The fact set (output) grows monotonically with the archive (global
re-projection is O(total archive), §3.3 D8). Once the JSON array outgrows the cap it is
**truncated mid-JSON** → `parseFacts` throws `SmartDistillError` → routes to
`reprojection-failed` → "retry next disconnect" — but the projection only grows, so it fails
**identically forever**: the machine projection **freezes** at the last-good slice and memory
quality silently stops improving. A separate concern from the forget contract (it's about the
distiller's output cap), so the conductor (q#006) isolated it here.

## Scope

**In** (spec §2 D-E):

- **`stop_reason` guard.** After the Haiku call in `SmartDistillerProvider.distill`, check
  `response.stop_reason`. On `"max_tokens"` → throw a **distinct truncation error**
  (`SmartDistillError("truncated")` or a dedicated subclass/flag) — do NOT parse the partial
  body.
- **Distinct, observable failure (not silent corruption).** The truncation error routes
  through chunk-02's EXISTING never-drop failure path (`recordReprojectionFailure` in
  `distiller-registration.ts`) but writes a DISTINCT `trigger="reprojection-truncated"`
  (≠ `reprojection-failed`). The prior projection stays intact (never-drop preserved);
  History shows the truncation wall is distinct from a transient failure.
- **`recordReprojectionFailure` gains a `trigger` param** (default `"reprojection-failed"`;
  the truncation path passes `"reprojection-truncated"`). The Phase-1 catch maps the
  truncation error → the truncated trigger; any other error → the existing trigger.
- **Raise `SMART_MAX_TOKENS`** to ~4096–8192 (architect tunes within that band). **State
  plainly in the code comment + spec: this is a RUNWAY extension, NOT the cure** — at
  O(total archive) the cap is eventually re-hit. Truncation is now the **NAMED TRIGGER** for
  the future **summarization tier** (out of scope, spec §1); the guard makes the wall
  observable + non-corrupting, which is what unblocks the flip.

**Out** (PIPELINE §7.2):
- The summarization / hierarchical-distillation tier itself — OUT (spec §1; this chunk only
  RECORDS its trigger).
- Any forget-contract change → chunk 04. The flip + demo → chunk 06.

## §7.1 runtime-coupling note (decompose flag)

Adding a `trigger` param to `recordReprojectionFailure` is a **behavioral** change to
chunk-02's failure handler (`distiller-registration.ts`) — NOT a frozen surface (frozen =
`@agentic/protocol` + `mock-agent.ts` only), the change is **additive** (new trigger value in
the existing free-TEXT `distillation_events.trigger` column → no schema migration), and the
**never-drop invariant is preserved**. Keep a test asserting never-drop still holds on the
truncated path (prior projection intact + the truncated event row written + rethrow). If
chunk 04 also lands, both touch `smart-distiller-provider.ts` — re-validate at integration
(no logic collision: 04 changes the suppression layers, 05 the stop_reason guard).

## Done criteria

- [ ] **[mechanical]** a stub `clientFactory` returning `stop_reason:"max_tokens"` → distill
      throws the truncation error → `recordReprojectionFailure` writes per-thread
      `reprojection-truncated` rows + `console.error`; the PRIOR projection is byte-intact
      (never-drop). RED without the guard (today: parses garbage → generic
      `reprojection-failed` or a silently-empty projection).
- [ ] **[mechanical]** a non-truncated failure still writes `reprojection-failed` (the default
      trigger is unchanged — no regression to chunk-02's contract).
- [ ] **[mechanical]** `SMART_MAX_TOKENS` raised; existing smart tests + the EXECUTED probe
      still green.
- [ ] **[mechanical]** full `bun test` + `lint:strict` + typecheck exit 0; frozen surfaces
      (`@agentic/protocol`, `mock-agent.ts`) byte-unchanged.
- [ ] **[behavioral]** none this chunk — observability is mechanical; the feature-closing Lior
      demo is chunk 06.

## Orchestrator brief (read by the orchestrator from this file)

```
implement memory-quality chunk 05 per docs/specs/2026-06-13-forget-flow.md §2 D-E.

Files to touch:
- packages/daemon/src/memory/providers/smart-distiller-provider.ts  (stop_reason guard;
                                                                      raise SMART_MAX_TOKENS)
- packages/daemon/src/memory/distiller-registration.ts              (recordReprojectionFailure
                                                                      gains a `trigger` param;
                                                                      catch maps truncation →
                                                                      reprojection-truncated)

Verification: TDD; stub clientFactory with stop_reason="max_tokens"; assert distinct trigger +
never-drop (prior projection intact) RED-without-guard → GREEN. Real store, only the LLM
clientFactory stubbed. The max_tokens raise is runway, not cure — say so in the comment.

ADRs in scope: ADR-0012 (HARD INVARIANT — never-drop, observable failure). NO new ADR
(additive trigger value + a param; no schema migration). Frozen: @agentic/protocol,
mock-agent.ts — byte-unchanged.
```

## Notes / Open questions

- The truncation→trigger mapping needs a way for the catch to tell a truncation error from a
  generic parse/LLM error — a dedicated error subclass or a boolean flag on `SmartDistillError`
  is the architect's call; keep it minimal.
