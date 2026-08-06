# Chunk 2: STT plane in the daemon — STTProvider port, whisper-cloud adapter, token-gated /voice/transcribe

**Status:** todo
**Created:** 2026-08-06
**Phase:** route part 3 (voice-mode)
**Estimated size:** ~1 day
**Depends on:** none (parallelizable with chunk 01; see Notes on the chunk-04/05 type-surface coupling)

> ⚠️ **Build gate:** spec `2026-07-28-voice-mode.md` is `draft — do-not-build` until Lior flips it to
> `accepted` (§5.2).

## Scope

**In:**
- **`STTProvider` port** (spec D12), mirroring the ADR-0010 posture: thin port
  (`readonly id: string` + one async method `transcribe(audio, opts) → Promise<SttResult>`), auth is
  adapter-internal, registry/selector keyed by `id`, selected via config (`stt.provider` env, per
  today's env/constants pattern — brief-of-record R1: plumbing, not settings UI).
- **`whisper-cloud` adapter** — OpenAI Whisper API (ADR-0007 decision). `voice.language = auto`
  default (D13, language-agnostic — no UA-specific machinery).
- **STT key in the macOS Keychain** (spec D14: `stt.apiKeyRef` is a Keychain *reference*, never a
  value). **Reuse the security-hardening path** (brief-of-record R2 rider — the path EXISTS):
  `packages/daemon/src/secrets/cloud-secrets.ts` (service `agentic-engine`) +
  `packages/daemon/scripts/keychain-set.ts` (stdin-read, never argv). Generalize for a second
  production account (proposed account name: `OPENAI_API_KEY`, matching the account=env-var-name
  convention) — a parameterized resolve + a parameterized/sibling `keychain-set`. **No onboarding
  wizard** (R2: the O3 local lane is out, so the cloud-vs-local fork does not exist; the wizard would
  be dead UI). This keychain reuse IS the minimum key-entry mechanism the behavioral DoD needs on a
  fresh install — a DoD prerequisite, not a wizard.
- **`POST /voice/transcribe`** on the daemon's existing `Bun.serve` fetch handler — **token-gated
  (bearer)**, same posture as the `/memory/*` write routes (ADR-0013 / spec D9). Accepts the audio
  body **in memory only**; calls the selected `STTProvider`; returns `{ transcript, … }` JSON.
  **⚠️ "Same posture" is NOT inherited automatically (spec-critic m3):** the `/memory/*` CORS layer
  (OPTIONS preflight + reflected allowed-origin) lives INSIDE `handleMemoryHttp`, and the
  DNS-rebinding Host guard in `index.ts` is scoped to `/memory/*` + `/history.html`. A cross-origin
  webview `fetch` with an `Authorization` header is ALWAYS preflighted — this route must get the same
  OPTIONS/CORS treatment (reuse `origin.ts` allowlist, never `*`) AND the Host guard, or chunk 05's
  upload dies with an opaque CORS error at integration.
- **Audio is NEVER persisted** (D9): no filesystem write, no DB row, no debug dump of audio bytes.
- **Input cap at the boundary**: reject bodies above a config ceiling (default sized to the 60 s
  capture cap + margin) — the 2d D3 lesson (cap at the entrance, isolate poison inputs).
- Config plumbing (R1): `stt.provider`, `stt.model`, `voice.language` as env/constants per today's
  pattern (see `config-surface-inventory.md` §1 for the pattern).

**Out:** (WHY per §7.2)
- Turn-landing (who makes the transcript a turn) — deferred to chunk 05 because it is overlay-side
  routing (interpretation of record: the endpoint returns the transcript; the OVERLAY lands the turn
  via the existing `session_start` path — this keeps `@agentic/protocol` byte-unchanged, D9).
- The local STT branch — OUT per spec O3 ruling (own spike, own lane; gotcha #46 family).
- The STT model manager — OUT per spec D12 ruling («менеджер потім»); `stt.models.*` is a named slot
  only.
- Settings UI for any of these keys — OUT per brief-of-record R1 (sibling decompose; no settings spec
  exists).
- Any `@agentic/protocol` change — **frozen per D9**; audio rides HTTP. Touching the wire = freeze
  gate, stop and escalate.

## Done criteria

- [ ] **[mechanical]** Unit tests: port selection by `stt.provider` (unknown id → graceful error
  result surfaced to the caller, daemon never crashes); adapter called with the in-memory buffer;
  language `auto` passed through.
- [ ] **[mechanical]** `POST /voice/transcribe` without/with-bad bearer token → 401; with token →
  provider invoked (mock adapter in tests).
- [ ] **[mechanical]** Oversize body → 4xx, provider NOT invoked.
- [ ] **[mechanical]** No-persistence proof: test asserts no fs writes / no store rows from the route
  (and code review confirms no audio bytes reach `memDebug` logs — secret-discipline pattern of
  `debug-log.ts`). *Scope-honesty (spec-critic DoD note): this covers the ROUTE level only —
  webview/MediaRecorder temp files and OS caches are system-level and stay a demo item (chunk 05/06
  "no audio file anywhere on disk").*
- [ ] **[mechanical]** CORS/Host-guard parity tests: OPTIONS preflight answered; disallowed Origin
  refused; bad Host refused — same behavior the `/memory/*` family has.
- [ ] **[mechanical]** `@agentic/protocol` byte-unchanged (`git diff --stat packages/protocol` empty).
- [ ] **[mechanical]** Keychain resolve for the STT account unit-tested via the injectable
  `KeychainGetFn` seam (as `cloud-secrets` already does); real-I/O probe optional, gated on key
  presence.
- [ ] **[behavioral]** With a real key in the Keychain: a real audio sample POSTed to the endpoint
  returns a plausible transcript (can fold into the chunk-05/06 live demo; per §6.1 this line is only
  done with runtime proof).

## Orchestrator brief (read by the orchestrator from this file)

```
Implement the daemon-side STT plane per orchestration/docs/specs/2026-07-28-voice-mode.md D9/D12/D13/D14
and brief-of-record R1/R2 (orchestration/agent-prompts/voice-mode-decompose.md).

Files to touch:
- packages/daemon/src/stt/ (new): stt-provider.ts (port), whisper-cloud-provider.ts (adapter),
  stt-provider-selector.ts (registry/selector — mirror ADR-0010's llm-injector shape)
- packages/daemon/src/secrets/cloud-secrets.ts: generalize resolve for a second production account
  (keep resolveAnthropicKey behavior byte-equivalent; add a parameterized entry or resolveSttKey)
- packages/daemon/scripts/keychain-set.ts: parameterize account (or sibling script) — key via stdin,
  NEVER argv (keep the existing security discipline comments true)
- packages/daemon/src/index.ts + a new packages/daemon/src/stt/http-route.ts: wire POST
  /voice/transcribe BEFORE the origin gate like handleMemoryHttp, bearer-token gated via TokenStore
- tests alongside, following the http-routes / cloud-secrets test patterns

Done when:
- All mechanical criteria above pass (bun test + lint:strict + typecheck)
- packages/protocol untouched (byte-check)
- Audio handled in memory only; body size cap enforced

ADRs in scope: 0013 (token posture), 0010 (port shape), 0007 (whisper-cloud), 0017 (egress precedent:
cloud STT egress is ADR-0007's accepted trade-off, no new decision). Frozen: @agentic/protocol.
```

## Notes / Open questions

- **Type-surface coupling (§7.1):** the `/voice/transcribe` request/response DTO is defined HERE and
  consumed by chunks 04/05 (overlay). Additive-on-wire ≠ additive-on-type: chunks 04/05 must import,
  not re-declare, the shape.
- Proposed Keychain account `OPENAI_API_KEY` is a chunk-level proposal; if the orchestrator finds a
  reason for a provider-neutral name (`STT_API_KEY`), flag it in the PR — do not silently diverge from
  the account=env-var-name convention.
- **⚠️ Known hazard when generalizing `cloud-secrets` (spec-critic watch item):** `_memo` at
  `cloud-secrets.ts:203` is a SINGLE unkeyed module cache — a naive second caller would be served the
  cached ANTHROPIC key for the STT account. Key the memo by (service, account) or split per-account
  memos; add a test that resolves both accounts and asserts distinct values.
- Whisper API audio-container acceptance is verified by chunk 01 (spike A4); if the spike mandated a
  re-encode, the *overlay* (chunk 03) owns it — this endpoint stays container-agnostic pass-through.
