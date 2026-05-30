# Chunk 01: Frozen wire-protocol contract + minimal daemon

**Status:** todo
**Created:** 2026-05-30
**Phase:** Walking Skeleton v0 (pre-Phase-1/2 vertical slice)
**Estimated size:** ~1 day
**Depends on:** none

## Scope

**In:**
- Bootstrap a greenfield **Bun + TypeScript monorepo** — ESM-only, runtime-agnostic discipline (ADR-0004): root workspace (`package.json` with Bun workspaces), `tsconfig.base.json`, lint config.
- **`packages/protocol`** — the **FROZEN** shared contract module. Two levels of forward-compatible discriminated union:
  - **Envelope** (discriminant `type`): `session_start`, `tool_call`, `tool_result`, `session_end`, `tool_cancel` (`{session_id, reason?}`). Unknown `type` → graceful handling, **not** throw.
  - **Tool registry** (discriminant `tool`): exactly **one** — `show_color_picker`, full Zod `args` (`{question, palette}`) + `return` (`{picked}` | cancel). Bound to the `color-picker` primitive (ADR-0005 closed-set). Unknown `tool` → graceful fallback, **not** throw.
  - `tool_call.args` / `tool_result.result` are **typed via the registry** (not `any`/`unknown`); the envelope stays tool-agnostic via a generic typed payload.
- **`packages/daemon`** — minimal Bun WebSocket server on `127.0.0.1:7777` (loopback only, ADR-0003 p.3), always-on for the dev session (Q6 → always-on). Validates every inbound/outbound message against `packages/protocol`. Trivial session lifecycle (accept `session_start`, round-trip an echo) — just enough for 02a and 02b-i to build against.
- **Origin-allowlist on WS upgrade**: server rejects connections whose `Origin` is outside the Tauri webview (interim CSWSH mitigation; ~5 lines server-side, 0 client). Confirm the Tauri v2 webview origin value against Tauri docs (context7) before hardcoding.

**Out:**
- No mock agent logic (chunk 02a). No UI / Tauri (chunks 02b-*).
- No `tool_progress` message — deferred to Phase 3, additive. known-gotcha #1 stays open.
- No per-install auth token (ADR-0003 p.5) — deferred; Origin-allowlist is the v0 interim. Token is connection-level, added additively later.
- No `launchd` plist — packaging concern, deferred; run the daemon via `bun run` in dev.
- No MCP, no real LLM, no streaming (the skeleton has no backend tools).

## Done criteria

- [ ] `packages/protocol` exports Zod schemas: envelope union (5 message types) + tool registry (`show_color_picker`) + `color-picker` primitive schema; importable by other workspaces.
- [ ] Contract is **FROZEN**: the module documents that any change after this chunk = **stop-the-line** (pause 02a + 02b-*, update contract atomically as a new chunk, resume).
- [ ] Forward-compatibility proven by test: an unknown `type` **and** an unknown `tool` are handled gracefully (no throw); valid messages parse; malformed messages rejected with a typed error (gotcha #9).
- [ ] Daemon boots on `127.0.0.1:7777`, accepts a WS connection from an allowed (Tauri) origin, validates messages, round-trips a trivial session.
- [ ] Origin-allowlist rejects a connection from a disallowed origin (tested with a non-Tauri origin); the legitimate Tauri origin is **not** rejected.
- [ ] A throwaway test client (bun/node script) connects, sends `session_start`, observes a validated round-trip. (Foundation for 02a's CLI harness.)
- [ ] Flagged for adr-curator/architect (doc edits happen during execution, not by this skill): update ADR-0003 (p.5 token deferred; v0 uses Origin-allowlist interim; full token planned **before non-dev/public release**) + add a known-gotcha for the CSWSH exposure window.

## Orchestrator brief (ready to copy)

```
implement the frozen wire-protocol contract + minimal daemon for Walking Skeleton v0, per orchestration/docs/roadmap.md ("Walking Skeleton v0" section).

This is the FOUNDATION chunk. The protocol module it produces is FROZEN: once merged, any change to it is a stop-the-line event (pause the parallel chunks 02a and 02b-*, update the contract atomically as a new chunk, then resume). Chunks 02a and 02b-* both import this module as the single source of truth and code against it independently.

Files to touch (greenfield — establish layout; architect confirms exact names):
- root: package.json (Bun workspaces), tsconfig.base.json, lint config — ESM-only, runtime-agnostic (ADR-0004)
- packages/protocol/src/: envelope.ts (discriminated union by `type`), tools.ts (tool registry discriminated union by `tool`), primitives.ts (color-picker primitive schema), index.ts
- packages/daemon/src/: index.ts (Bun WS server on 127.0.0.1:7777 + origin-allowlist), session.ts (minimal session lifecycle)
- a throwaway test client script for protocol verification

Contract shape (FROZEN, two levels, both forward-compatible):
- Envelope discriminated union on `type`: session_start, tool_call, tool_result, session_end, tool_cancel ({session_id, reason?}). Unknown `type` -> graceful, not throw.
- Tool registry discriminated union on `tool`: exactly one -- show_color_picker, Zod args {question, palette} + return {picked} | cancel, bound to the color-picker primitive (ADR-0005). Unknown `tool` -> graceful fallback, not throw.
- tool_call.args / tool_result.result are TYPED via the registry, not any/unknown. Envelope stays tool-agnostic.

Done when:
- packages/protocol exports the above; importable by other workspaces.
- Tests prove: valid messages parse; malformed rejected with typed error; unknown `type` and unknown `tool` handled gracefully (no throw).
- Daemon boots on 127.0.0.1:7777 (loopback only), accepts a WS connection from an allowed (Tauri) origin, validates messages, round-trips a trivial session.
- Origin-allowlist rejects a disallowed origin (tested); legitimate Tauri origin is not rejected.
- A test client connects, sends session_start, observes a validated round-trip.
- The module documents that the contract is frozen (stop-the-line on change).

Explicit deferrals (do NOT implement; document as assumptions so ADRs aren't silently reopened):
- tool_progress message -- NOT in v0 (shape depends on Phase 3 stream semantics; will be added additively). known-gotcha #1 stays open.
- per-install auth token (ADR-0003 p.5) -- deferred; origin-allowlist is the v0 interim mitigation. Auth is connection-level (query-param/header at handshake), outside the message contract, so the token adds additively later without touching the envelope union.
- launchd plist -- deferred (packaging); run the daemon via `bun run` in dev. Q6 resolved as always-on for the dev session.
- MCP, real LLM, streaming -- out of scope (skeleton has no backend tools).
- Confirm the Tauri v2 webview Origin value against Tauri docs (use context7) before hardcoding the allowlist.

Flag for adr-curator/architect (doc edits during execution, not this skill's job):
- Update ADR-0003: p.5 token deferred; v0 uses Origin-allowlist as interim CSWSH mitigation; full token planned before non-dev/public release (NOT gated on the web admin tab -- any browser tab + always-on localhost daemon is the threat).
- Add a known-gotcha entry for the CSWSH exposure window.

ADRs in scope: 0001 (sessions), 0002 (UI as tool calls), 0003 (daemon/WS/loopback/auth), 0004 (Bun/TS/ESM), 0005 (UI contract closed-set / primitive schema).
```

## Notes / Open questions

- **Linchpin chunk.** The frozen contract is what makes the parallel execution model (02a ∥ 02b-i) safe. Treat the freeze seriously.
- **Resolved open questions (do not reopen):** Q6 (hot/cold daemon) → always-on (manual `bun run` in dev for the skeleton); Q2 (full primitive list) → skeleton uses only `color-picker`.
- **Threat-model note (Lior, decompose session):** CSWSH does **not** depend on our own web frontend — any browser tab + an always-on localhost daemon is the threat. Hence the full-token gate is "before non-dev/public release", not "before web admin tab".
- **Decompose-session decisions:** contract is two-level (envelope + tool registry), both forward-compatible; `tool_cancel` is in v0 (async-tool correctness per ADR-0002, not a feature); `tool_progress` deferred (unknown shape → additive in Phase 3).

- **⚠️ Architect MUST pin these three BEFORE freezing the contract — currently underspecified; freezing ambiguity = a guaranteed future stop-the-line (Jimmy review, 2026-05-30; last two salvaged from the ORIGINAL phase-1 decompose session's insight block, which never reached chunk files):**
  - **`session_start` payload + initiator + `trigger`.** Who emits it (frontend on submit, per 02b-i?) and who mints `session_id` (frontend or daemon)? Does it carry the user's typed text (mock ignores it, but the field must exist if sent)? **AND include `trigger: 'user' | 'cron' | 'external'` now** (skeleton sends only `'user'`) — ADR-0001 requires symmetric trigger design so cron/inbound sessions (Phase 6 rituals) don't break `session_start` later. This is forward-compatibility on the *trigger-source* axis — the same principle we applied to message-types and tool-types, which this payload was missing.
  - **Single representation of cancel.** Cancel is the envelope message `tool_cancel {session_id}` (our v0 decision). Therefore `show_color_picker`'s `return` should be **just `{picked}`** — drop the "`| cancel`" return variant noted in Scope (line ~15), so cancellation isn't modelled twice (once as an envelope message, once as a tool-return value). Pick one source of truth: the envelope `tool_cancel`.
  - **`session_end` `reason` enum (covers timeout, gotcha #4).** Give `session_end` a forward-compatible `reason` field (`'completed' | 'cancelled' | 'timeout' | …`). A hung/no-response session is then just `session_end {reason: 'timeout'}` — **no new message type needed**. Daemon timeout *behavior* can be post-skeleton, but reserve the `reason` field now so it's additive, not breaking. (Original phase-1 decompose flagged #4 as blocking-MVP; this is the cheap forward-compatible way to honour it.)
