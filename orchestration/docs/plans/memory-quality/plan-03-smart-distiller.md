# Plan — memory-quality chunk 03: Smart distiller provider (LLM-backed, non-default, 2b)

**Chunk:** `orchestration/chunks-todo/memory-quality/03-smart-distiller-provider.md`
**Spec:** `orchestration/docs/specs/2026-06-12-memory-quality.md` §3.3 (D8/D9/D10), §4 (guarantees), §5 (verification), §7 (architect-time)
**Conductor relay folded:** `orchestration/.conveyor/bus/relay-003-chunk03-major3.md` (MAJOR-3 serialize concurrent re-projections)
**Branch:** `chunk/03-smart-distiller`
**Baseline for review:** `main`

---

## Orchestrator notes (read alongside the architect content)

### DoD tagging (Phase 0, drives the §6 verified-done gate)
The chunk file tags 4 criteria `[mechanical]` + 1 `[behavioral — DEFERRED to chunk 04's
feature-closing Lior demo]`. So **chunk 03 has NO behavioral demo gate** — precise
structured-recall-with-provenance is proven at chunk 04 (spec §5). Chunk 03's gates:
- **[mechanical]** all stub-LLM/selector/MAJOR-3/integration tests green; full `bun test` +
  `lint:strict` + typecheck exit 0; real SQLite I/O everywhere except the LLM `clientFactory`.
- **[mechanical]** `MEMORY_PROVIDER=smart`+key ⇒ smart; no key ⇒ loud-log fallback to dumb-tail;
  default unset ⇒ STILL dumb-tail (explicit test).
- **[mechanical — EXECUTED evidence]** the real-API smoke probe RAN; its stdout (facts from a
  seeded archive) pasted in the PR. Not "written+typechecked" — RUN (Strike-5).
- **[mechanical]** frozen surfaces byte-unchanged (`@agentic/protocol`, `mock-agent.ts`).

### EXECUTED-probe de-risk (Phase 0 — the relay-003 hard-blocker, cleared)
relay-003: "If no API key is reachable, STOP + report BLOCKED." **De-risked at pickup:**
the ANTHROPIC key **IS reachable via macOS Keychain** (`/usr/bin/security find-generic-password
-s agentic-engine -a ANTHROPIC_API_KEY -w` → exit 0; `source=keychain`). The probe runs the
production Keychain path (no `AGENTIC_ENV=dev` needed). Presence checked by exit-code only —
the key value was never printed (spec §3.8). ⇒ the EXECUTED-probe DoD CAN be satisfied; no
BLOCKED on the key.

### Grilling gate — skipped (judgment, recorded — same posture as chunk 02)
The plan *implements* the Lior-signed spec (§3.3 D8/D9/D10, §4, §3.4) and ADR-0012 (HARD
INVARIANT lossless/re-derivable; 5d quarantine-survives-summarization; 5e human precedence
inherited from chunk-02 reads; decision 6 swappable provider — "a provider swap, not a
re-plumb", exactly what the model anticipated). It does NOT contradict the ADR, concept.md, or
architecture.md, and introduces **no new decision touching ADR-0012's substance** (architect
confirmed `## ADR worthy: no`). The design was already adversarially grilled at decompose
(grill #1–12, cited inline in the spec) and frozen at Lior sign-off. A re-grill would
re-litigate frozen-and-accepted decisions → skipped. (Also: a detached fire-and-complete
orchestrator worker has no interactive user for `grill-with-docs`.)

### Plan-escalation (§7.2 citation test) — not triggered
The plan fits the decompose-blessed chunk, cites no frozen conflict it intends to break, and
introduces no new scope. The architect found no frozen-vs-frozen contradiction (no `## FLAG`).
The one re-touch of a frozen-ish surface — `distiller-registration.ts` (chunk-02's rewrite),
for the MAJOR-3 queue — is purely **additive** (a promise-queue wrapper + an extracted
`doOneRun`), with the three-phase flow + `recordReprojectionFailure` contract byte-preserved
inside `doOneRun`. Proceeds autonomously to Phase 2 (PIPELINE §5.2, narrowed 2026-06-06).

### Architect-time decisions accepted (spec §7 delegated these)
- **Digest format**: per-thread `=== thread <id> ===` block, `[role|<messageId>] <content>`
  lines, newest-M-first, `M = SMART_DIGEST_MAX_MSGS_PER_THREAD = 50`. Provenance-carrying so
  the LLM can stamp a real `messages.id`. ✓
- **Output format**: strict JSON array + defensive parse (NOT structured-outputs/`output_config`
  — the chunk froze "NO `output_config.effort`"; tool-use rejected as YAGNI). ✓
- **Normalization algorithm** (best-effort layer 2): NFKC → lower → strip `REMEMBERED_LABEL` →
  collapse whitespace → strip trailing punct/quotes; exact-after-normalize match (conservative,
  explicitly NOT fuzzy/semantic — framed as MITIGATION). ✓
- **MAJOR-3**: promise-queue in `registerDistiller` (`lastRun.catch().then(doOneRun)`), enqueue
  order = disconnect-arrival order = latest-wins. Rejected alternatives: store-side version CAS
  (touches chunk-02 `replaceProjection`, needs an ALTER-TABLE — the OUT-list trap) and a mutex
  (more machinery, no benefit). ✓
- **Layer-3 (LLM exclusions) interpretation** — WATCH AT REVIEW: fact-level tombstones record
  *provenance* (`target_message_id`), not text, so the load-bearing exclusion is **digest
  exclusion (D8 step 3 — tombstoned-provenance messages never enter the digest)**; the
  prompt-level exclusion string is a secondary nudge populated only where a tombstoned fact's
  text is recoverable. Architect flagged the worker to keep this minimal and NOT add a schema
  migration to recover texts. Within §7 architect-time latitude + §4 best-effort framing;
  reviewer should confirm the framing never overclaims a guarantee.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development`) to implement this plan task-by-task. **TDD RED-first throughout** — the only permitted mock is the LLM `clientFactory` (Strike-4 boundary); real SQLite everywhere else.

**Goal:** Add a `SmartDistillerProvider` (id `"smart"`) that LLM-distills the whole tombstone-honored archive into deduplicated canonical facts, register it as selectable-but-non-default, serialize concurrent re-projections (MAJOR-3), and prove it with deterministic stub-LLM tests plus an EXECUTED real-haiku probe.

**Architecture:** The smart provider implements the chunk-02 `MemoryProvider` port (`distill` returns the COMPLETE global projection). Its `distill` runs in chunk-02's Phase-1 compute seam (outside any tx), building a tombstone/quarantine-honored digest, calling Haiku via an injectable `clientFactory` (the `createAnthropicApiProvider` DI pattern), parsing defensively into `DistilledFact[]`, and applying three best-effort fact-forget post-filters. Never-throw: any failure routes to chunk-02's `recordReprojectionFailure` path. MAJOR-3 adds a promise-queue in `registerDistiller` so overlapping disconnects serialize. The selector registers `"smart"` and falls back to `dumb-tail` with a loud log when no key resolves; default stays `dumb-tail`.

**Tech Stack:** Bun + TypeScript, `bun:sqlite`, `@anthropic-ai/sdk` (already an ADR-0011-gated runtime dep — NOT new), `bun:test`.

---

## Status: Planning complete — entering Phase 2 (implementation)

---

## Requirements

- **R1 — `SmartDistillerProvider` implements the chunk-02 port** (`id="smart"`): `distill(store, triggerThreadId)` returns the COMPLETE projection over ALL threads (`DistillResult.threadId = triggerThreadId`); `retrieve` is identical to the other providers (reads `readDistilledFactsForThread`, honors fact-tombstones, prefixes `REMEMBERED_LABEL`). Spec D3/D4.
- **R2 — Digest (D8):** iterate `listThreads()`; per thread take the **M=50 most-recent** messages (tunable const); built ONLY from `readThreadMessagesForDistill` (tombstone-redacted) AND excluding `isMessageQuarantined` sources AND excluding `isFactTombstoned`-matched provenances; **loud `console.warn` on per-thread truncation**; never silently drop a whole thread. Document the digest serialization format.
- **R3 — LLM call (D9):** model `claude-haiku-4-5`, `thinking: { type: "disabled" }`, bounded `max_tokens`, **NO `output_config.effort`** (errors on Haiku), no sampling params; key via `resolveAnthropicKey(opts.resolverOpts)`; **injectable `clientFactory`** (default `(key) => new Anthropic({ apiKey: key })`); **never-throw** — any SDK/network/parse failure surfaces as a thrown error to chunk-02's Phase-1 catch (NOT swallowed inside `distill`).
- **R4 — Canonicalization / parse contract (D10):** the model returns a strict JSON array of fact objects; parsed **defensively** into `DistilledFact[]` (each stamped `provenance`, `scope`, `expiry`, `confidence`, `authored_by:"machine"`); counts/aggregates are computed by the LLM at distill-time and cite source threads; malformed/non-conforming output → failure path (throw, never a partial projection).
- **R5 — Best-effort fact-forget layers (§4 — phrased as MITIGATION, never a guarantee):** (1) provenance-match post-filter (drop candidates whose provenance is `isFactTombstoned`); (2) normalized-text post-filter (drop candidates whose normalized text equals a tombstoned fact's normalized text — normalization algorithm defined below); (3) tombstoned-fact texts passed to the LLM as explicit exclusions in the prompt. No code comment, doc string, or test name may call these a hard guarantee.
- **R6 — Selector registers `"smart"`:** `MEMORY_PROVIDER=smart` + resolvable key ⇒ smart; `MEMORY_PROVIDER=smart` + no key ⇒ **loud `console.error` + fall back to `dumb-tail`** (daemon stays up). Default (`MEMORY_PROVIDER` unset) ⇒ STILL `dumb-tail` (flip is chunk 04). Unknown id behavior unchanged.
- **R7 — MAJOR-3 serialize concurrent re-projections:** because Smart's Phase-1 `distill` now `await`s the network, two overlapping disconnects can interleave (A computes slow → B computes+commits → A commits its STALE projection clobbering B + writing stale success rows). `registerDistiller` SERIALIZES runs via a promise-queue so the committed projection + event rows reflect the LATEST run; archive stays lossless regardless. Preserves never-drop + per-run `reprojection-failed`.
- **R8 — EXECUTED real-API smoke probe** (Strike-5): `packages/daemon/scripts/smart-distiller-probe.ts` drives a real haiku call through the provider against a real on-disk store seeded with a known archive; captures the produced facts to stdout for the PR body; resolves the key via Keychain (`resolveAnthropicKey()`), never logs the key value.
- **R9 — Deterministic stub-LLM tests** (the stub `clientFactory` is the ONLY mock; real SQLite throughout): hard-guarantee forget (D12), quarantine-survives-summarization, swap-proof + lossless-integrity extended to smart-with-stub, failure-keeps-projection, best-effort layer units, MAJOR-3 serialization, selector (smart/no-key-fallback/default-unset). Full `bun test` + `lint:strict` + typecheck exit 0.
- **R10 — Frozen surfaces byte-unchanged:** `@agentic/protocol`, `mock-agent.ts` reducer. No `history-page.ts` touch. No `MEMORY_PROVIDER` default flip. No archive summarization / hierarchical tier. No hard fact-level forget claim anywhere.

---

## Reality check (architect — code paths verified at file:line; behavioral claims marked)

Chunk 03 has **no behavioral Lior-demo DoD** (the demo is chunk 04's feature-closing gate, spec §5/§6.1). Its DoD is all `[mechanical]` (stub-LLM tests + selector tests + frozen diff) PLUS the **EXECUTED probe** (`[mechanical — EXECUTED evidence]`, Strike-5).

- **Chunk-02 IS merged and is the seam I plug into.** The three-phase flow in `distiller-registration.ts:34-106` is live: Phase 1 `await provider.distill(store, triggerThreadId)` (`:57-63`), Phase 2 per-fact scan (`:67-87`), Phase 3 `store.replaceProjection(...)` (`:97-104`); `recordReprojectionFailure` (`:46-54`) writes per-thread `reprojection-failed` rows + `console.error` and the caller rethrows. **Exactly the failure contract chunk-03 routes Smart into.** ✓
- **Phase-1 compute is OUTSIDE any tx** — `distiller-registration.ts:56-63` plain `await`; `replaceProjection` (`store.ts:362-410`) one flat synchronous `db.transaction`, NO `await` inside. Smart's network `await` lives in Phase 1, cannot stall a tx (grill #6). ✓
- **`replaceProjection` capture-`now`-once + `rowid ASC` tie-breaker** — `store.ts:375`, read order `store.ts:222`. Smart must emit facts newest-relevant-first so the LIMIT-20 slice keeps the most useful facts (MAJOR-1 fix is order-deterministic). Static observation.
- **Port** — `memory-provider.ts:28-50`; `DistilledFact` thin `:5-12` (no `kind`). ✓
- **DI pattern to mirror** — `anthropic-api-provider.ts:147-186` (`clientFactory`, `resolverOpts`, lazy `getClient`); request shape `:276-291` (`model`, `max_tokens`, `thinking:{type:"disabled"}`, `system[]`, `messages`). No `output_config`/`effort`/sampling — the Haiku-safe shape. ✓
- **Key resolver** — `cloud-secrets.ts:225-267`: Keychain prod / `.env` dev-gate; never throws/logs the key. De-risk confirmed reachable; probe needs NO `AGENTIC_ENV=dev`. **Probe success requires runtime proof.**
- **Store reads Smart needs** — `listThreads()` (`store.ts:507-511`, ALL threads incl. dismissed); `readThreadMessagesForDistill` (`:476-501`, tombstone-redacted); `isMessageQuarantined` (`:308-313`); `isFactTombstoned` (`:285-290`). All present. ✓
- **Scanner scope-escalation guard** — `memory-scanner.ts:56-58`: a `machine`+`global` fact is quarantined by Phase 2. ⇒ Smart stamps `cross-thread`/`thread-local`, reserves `global` deliberately. Static observation.
- **`ConsolidationHook.dismiss(threadIds[], triggerThreadId?)`** — `consolidation-hook.ts:32-40`; MAJOR-3's queue wraps the handler body, not the hook. ✓
- **Real-API probe pattern to mirror** — `scripts/keychain-prod-probe.ts` (banner, `resolveAnthropicKey()`, never prints the key). Smart probe reuses the skeleton but drives `provider.distill` against a real on-disk store. ✓
- **Frozen surfaces** — no chunk-03 file touches `@agentic/protocol` or `mock-agent.ts`. ✓
- **`@anthropic-ai/sdk` already a dep** — `anthropic-api-provider.ts:13` (ADR-0011-gated). No new runtime dep. ✓
- **Haiku constraint confirmed** (claude-api skill): `claude-haiku-4-5`; `output_config.effort` errors on Haiku; `thinking:{type:"disabled"}` valid on Haiku (Fable-5 "disabled→400" rule does NOT apply). Frozen request shape correct.

**No frozen-vs-frozen contradiction** (chunk file ↔ spec ↔ chunk-02 plan ↔ ADR-0012). No `## FLAG`.

---

## Design

### File structure
- **Create** `providers/smart-distiller-provider.ts` — provider + `SmartDistillerOptions` (DI) + digest builder + parse contract + best-effort post-filters + tunable consts (helpers exported for unit tests, co-located).
- **Create** `providers/smart-distiller-provider.test.ts` — stub-`clientFactory` tests.
- **Modify** `memory-provider-selector.ts` — register `"smart"` lazily; no-key loud-log fallback; default untouched.
- **Modify/Create** `memory-provider-selector.test.ts`.
- **Modify** `distiller-registration.ts` — MAJOR-3 promise-queue around the existing three-phase handler.
- **Modify** `distiller-registration.test.ts` — MAJOR-3 out-of-order serialization test.
- **Modify** `distiller-integration.daemon.test.ts` — swap-proof / lossless / quarantine-survives / forget-survives extended to smart-with-stub.
- **Create** `packages/daemon/scripts/smart-distiller-probe.ts`.

### Digest format (D8 — architect-time, frozen here)
Per-thread newest-M-first labeled block; `M = SMART_DIGEST_MAX_MSGS_PER_THREAD = 50` (exported const).
```
=== thread <threadId> ===
[user|<messageId>] <content>
[assistant|<messageId>] <content>
```
`buildDigest(store)`: iterate `listThreads()` (never skip a thread); `readThreadMessagesForDistill` (tombstone-redacted); filter out `REDACTION_MARKER`, `isMessageQuarantined`, `isFactTombstoned` (the dumb-tail triple); if `> M` → `console.warn` truncation + take last M; emit provenance-carrying lines; track `validProvenanceIds`. Empty digest ⇒ short-circuit `{threadId, facts:[]}` WITHOUT an LLM call (5b). `SMART_MAX_TOKENS=1024` output.

### LLM request shape (D9 — Haiku-safe, mirrors `anthropic-api-provider.ts`)
`model:"claude-haiku-4-5"`, `max_tokens:SMART_MAX_TOKENS`, `thinking:{type:"disabled"}`, `system:[{type:"text",text:SMART_SYSTEM_PROMPT}]`, `messages:[{role:"user",content:digest}]`. NO `output_config`/`effort`, no sampling, no `cache_control`. Key via DI (`opts.apiKey` verbatim else `resolveAnthropicKey(opts.resolverOpts)`); throw on unresolved key when no injected client; lazy cached `clientFactory`. Never log the key.

### System prompt (D10) — frozen-shape requirements (wording architect-time)
JSON-array-only output; per object `{fact, provenance(messages.id / comma-joined), scope("thread-local"|"cross-thread"), expiry:null, confidence:0..1}`; dedup across threads (ONE fact naming source threads); compute counts/aggregates at distill time; `expiry:null` unless time-bound; **never scope `global`**; best-effort exclusions list (only when recoverable); no prose/fences.

### Parse contract (D10 — defensive)
`parseFacts(raw, validProvenanceIds)`: strip optional ```` ```json ```` fence; `JSON.parse` in try/catch → throw `SmartDistillError`; assert array else throw; per-element shape validate (`fact` non-empty string, `scope` in set, `confidence` clamped `[0,1]`, `expiry` null/number, `provenance` string) — **drop** bad elements (one bad ≠ whole failure); zero valid facts from a non-empty digest is acceptable (`[]`, 5b); stamp `authored_by:"machine"`; unresolvable provenance kept (layer-2 backstops). `SmartDistillError` surfaces to chunk-02's Phase-1 catch → `recordReprojectionFailure` → `reprojection-failed` + rethrow; **`distill` does not catch the LLM/parse error** (never-throw = becomes a failure-event, not an uncaught crash).

### Best-effort fact-forget post-filters (§4 — MITIGATION, never a guarantee)
- **Layer 1 — provenance match:** drop iff `store.isFactTombstoned(candidate.provenance)` (comma-joined → drop if ANY component tombstoned).
- **Layer 2 — normalized-text match:** drop iff `normalizeFactText(candidate.fact)` byte-equals a tombstoned fact's normalized text. `normalizeFactText`: NFKC → lowercase → strip `REMEMBERED_LABEL` → collapse whitespace+trim → strip trailing `. ! ? ; ,` + surrounding quotes. Conservative exact-after-normalize (NOT fuzzy); doc string states a generative distiller can defeat it by rephrasing.
- **Layer 3 — LLM exclusions:** load-bearing mechanism = **digest exclusion (D8 step 3)** (tombstoned-provenance messages never enter the digest). Prompt-level exclusion string is a secondary nudge, only where recoverable. **Worker note:** keep minimal; do NOT add a schema read/migration to recover texts (OUT-list trap); rely on layers 1+2+digest-exclusion + flag the orchestrator if a clean recovery path exists.

### MAJOR-3 — serialize concurrent re-projections (promise-queue)
```ts
export function registerDistiller(hook, store, provider, scanner): void {
  let lastRun: Promise<void> = Promise.resolve();
  hook.register((dismissedThreadIds, triggerThreadId) => {
    const thisRun = lastRun
      .catch(() => { /* prior run already recorded its failure + rethrew to its own caller */ })
      .then(() => doOneRun(store, provider, scanner, dismissedThreadIds, triggerThreadId));
    lastRun = thisRun;
    return thisRun; // caller (hook.dismiss → close(ws)) still awaits THIS run + sees its rejection
  });
}
```
`doOneRun` = the existing Phase 1/2/3 body + `recordReprojectionFailure`, extracted verbatim. Each run's compute+scan+replace completes before the next compute starts ⇒ last-enqueued = last-committed; a slow earlier run can't clobber a later commit (RED without the queue). `lastRun.catch(()=>{})` isolates a prior failure so the chain survives (the failure was already recorded + rethrown to its own caller). Ordering = enqueue = disconnect-arrival = latest-wins. Composes with chunk-02: queue wraps; three-phase + failure contract byte-preserved inside `doOneRun`. Additive — no new decision.

### Selector fallback (R6)
`buildMemoryProvider(opts?: { resolveKey?: () => ResolveResult })`: `case "smart"` ⇒ `buildSmartProvider(opts?.resolveKey ?? resolveAnthropicKey)`; `!resolved.ok` ⇒ `console.error(...fixHint)` + return null ⇒ caller returns the dumb-tail instance. Default unchanged (`process.env["MEMORY_PROVIDER"] ?? "dumb-tail"`; unset ⇒ dumb-tail). Injected-resolver seam keeps the no-key unit test deterministic (Strike-4: no shell-out); production callers pass nothing.

### Probe script design (R8 — EXECUTED, Strike-5)
`scripts/smart-distiller-probe.ts` (modeled on `keychain-prod-probe.ts`): banner (Strike-5 disclaimer); `resolveAnthropicKey()` named-failure exits; seed a real on-disk `MemoryStore` in `mkdtempSync(tmpdir())` (2–3 threads, repeated "hi" + "favourite colour: blue"); `new SmartDistillerProvider()` real client; `await provider.distill(...)`; print each fact (`fact`/`scope`/`confidence`/`provenance` — NEVER the key); assert ≥1 fact; `PROBE PASSED`/`FAILED`, exit 0/1. Run: `bun run packages/daemon/scripts/smart-distiller-probe.ts`. PR evidence = full stdout (banner → source=keychain → fact list → PROBE PASSED → exit 0).

### Approaches considered
- **Output format:** strict JSON array + defensive parse (chosen) vs. structured-outputs `output_config` (rejected — `effort` baggage + schema-compile latency + unfrozen surface) vs. tool-use (rejected, YAGNI).
- **MAJOR-3:** promise-queue (chosen, spec-recommended, composes, enqueue-ordered) vs. store-side version CAS (rejected — touches chunk-02 `replaceProjection` + ALTER-TABLE trap + wastes tokens) vs. mutex (rejected — more machinery, no benefit).

---

## ADR worthy: no
Implements the Lior-signed spec §3.3/§4/§3.4 + ADR-0012 (HARD INVARIANT; 5d; 5e inherited from chunk-02 reads; decision 6 swappable provider). No new product decision/dependency/protocol/boundary: `@anthropic-ai/sdk` already ADR-0011-gated; wire + mock reducer frozen; LLM-in-distill already Lior-approved (port comment Q3, spec §2; q#001 Sub-3); digest/normalization/M/parse delegated by spec §7; MAJOR-3 queue is internal mechanics on a frozen wire (spec mandated serialization). **Confirmed: no ADR. No FLAG.**

---

## Steps

### Step 1 — `SmartDistillerProvider` + digest/parse/post-filters, stub-LLM tests (TDD: RED first)
**Files:** create `providers/smart-distiller-provider.ts` + `.test.ts`.
**RED** (stub `clientFactory` only; real SQLite via `mkdtempSync`): (1) `id==="smart"`; (2) digest excludes tombstoned+quarantined (echo-stub); (3) per-thread M truncation logs loudly, never drops thread; (4) empty archive short-circuits (stub never called); (5) parse happy (N facts, `authored_by:"machine"`, scope valid, confidence clamped); (6) parse defensive (fenced parsed; bad element dropped; non-JSON throws `SmartDistillError`; non-array throws); (7) layer-1 tombstoned-provenance dropped; (8) layer-2 normalized-text dropped (case/punct-insensitive); (9) scope guard (`global` dropped at parse, `cross-thread` survives); (10) failure surfaces (rejecting stub ⇒ `distill` rejects, no partial/empty success).
**GREEN:** implement consts (`SMART_MODEL`, `SMART_MAX_TOKENS=1024`, `SMART_DIGEST_MAX_MSGS_PER_THREAD=50`, `SMART_SYSTEM_PROMPT`), `SmartDistillError`, `normalizeFactText`, `buildDigest`, `parseFacts`, `SmartDistillerOptions`+lazy `getClient`, `SmartDistillerProvider` (`distill`: buildDigest → empty short-circuit → LLM → parseFacts → layer1+layer2 → return; `retrieve`: copy dumb-tail/fixed-marker verbatim). Post-filter doc strings = MITIGATION.
**Run:** `bun test packages/daemon/src/memory/providers/smart-distiller-provider.test.ts`.
**Commit:** `feat(memory-quality): smart distiller provider (digest+haiku+canonicalization+best-effort layers) — chunk 03`.

### Step 2 — Selector registers `"smart"` + MAJOR-3 serialization; selector/registration/integration tests (TDD: RED first)
**Files:** modify `memory-provider-selector.ts` + `.test.ts`; `distiller-registration.ts` + `.test.ts`; `distiller-integration.daemon.test.ts`.
**RED (selector):** smart+key ⇒ `id==="smart"`; smart+no-key ⇒ `console.error`+`id==="dumb-tail"`; unset ⇒ `id==="dumb-tail"` (injected-resolver seam, no shell-out).
**RED (MAJOR-3):** real store + async stub resolving OUT OF ORDER; two overlapping `hook.dismiss` runs (A slow/older, B fast/newer, A resolves after B) ⇒ FINAL projection = run B's facts; no stale/duplicate `reprojection` success rows. RED without the queue. Document the deferred-promise harness.
**RED (integration, smart-with-stub):** swap-proof extended (ALL threads, set-membership/fresh-store isolation); lossless (messages/mutations byte-identical); quarantine-survives-summarization; forget-survives-re-derive (D12, echo-stub); failure-keeps-projection (throwing stub ⇒ prior projection intact + `reprojection-failed` + `console.error`).
**GREEN:** selector `case "smart"` + `buildSmartProvider` + injected-resolver seam (default untouched); `distiller-registration.ts` extract `doOneRun` (verbatim) + add promise-queue (comment: enqueue=arrival=latest-wins; catch isolates prior failure; contract byte-preserved).
**Run:** `bun test packages/daemon/src/memory/` then full `bun test`, `bun run lint:strict`, typecheck — all exit 0; frozen diff empty.
**Commit:** `feat(memory-quality): register smart (non-default, no-key fallback) + MAJOR-3 serialize re-projections — chunk 03`.

### Step 3 — EXECUTED real-API smoke probe (Strike-5)
**Files:** create `packages/daemon/scripts/smart-distiller-probe.ts` (+ `package.json` alias if the repo convention has one).
**Implement** per the probe design.
**Run (orchestrator runs live + captures stdout):** `bun run packages/daemon/scripts/smart-distiller-probe.ts`. Expected: banner → `source=keychain` → fact list → `PROBE PASSED` → exit 0. **This RAN output is the DoD evidence (Strike-5).**
**Verify (mechanical):** full `bun test` exit 0 (real SQLite; only stub = `clientFactory`/fake provider); `bun run lint:strict` exit 0; typecheck exit 0; frozen-surface diff byte-empty; probe stdout pasted into the PR body.
**Commit:** `test(memory-quality): EXECUTED real-haiku smart-distiller probe (Strike-5 evidence) — chunk 03`.

---

## Test plan
All tests REAL SQLite (`mkdtempSync` fresh store / isolated daemon dirs). ONLY permitted mock = LLM `clientFactory` (or a deterministic fake `MemoryProvider`). No mocked store.

| Test (file) | Assertion shape |
|---|---|
| `smart-distiller-provider.test.ts` — id / digest exclusion / M truncation / empty short-circuit / parse happy / parse defensive / layer-1 / layer-2 / scope guard / failure surfaces | per Step 1 RED list |
| `memory-provider-selector.test.ts` — smart+key / no-key fallback / default-unset | per Step 2 RED |
| `distiller-registration.test.ts` — MAJOR-3 serialization | out-of-order stub ⇒ FINAL = later run; no stale/dup success rows. RED without queue. |
| `distiller-integration.daemon.test.ts` — swap-proof / lossless / quarantine-survives / forget-survives (D12) / failure-keeps-projection (smart) | per Step 2 RED |
| EXECUTED probe (`scripts/smart-distiller-probe.ts`) | RAN against real Keychain+network+on-disk store; ≥1 fact; stdout in PR. **requires runtime proof (Strike-5).** |
| Full gate | `bun test` + `bun run lint:strict` + typecheck exit 0; frozen surfaces byte-unchanged. |

---
