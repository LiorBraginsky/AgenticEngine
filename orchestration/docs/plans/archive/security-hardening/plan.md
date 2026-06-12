# Plan: Chunk 01 — Anthropic API key → macOS Keychain (+ env-isolated prod proof)

## Status: Review-complete — BEHAVIORAL DEMO PENDING (not shipped, not merged)

- **Feature:** security-hardening
- **Chunk:** `orchestration/chunks-todo/security-hardening/01-api-key-to-keychain.md`
- **Spec:** `orchestration/docs/specs/2026-06-12-security-hardening.md` §3.1 / §3.7 / §3.8 (status: accepted)
- **ADR worthy:** no (posture rule already doc-reconciled in spec §3.1; no new contract/boundary)
- **Step tracker:** Step 1 ☑ · Step 2 ☑ · Step 3 ☑ · Step 4 ☑ · Step 5 ☑ · Step 6 ☑ · Review ☑

### Closeout state (orchestrator-verified)
- **Mechanical DoD #2/#4/#5 — GREEN (own command-evidence):** full root suite **334 pass / 0 fail**;
  `typecheck` exit 0; `lint:strict` exit 0; frozen surfaces (`packages/protocol`, mock reducer,
  `injector.ts`) **byte-untouched** (empty diff vs `main`).
- **Reviewer-clean:** engine-reviewer 0 Critical/0 Major on first pass; **0/0/0/0 on the fix-round
  re-review** (final state reviewer-clean).
- **Security:** automated commit-review flagged **[HIGH] CWE-214 argv secret leak** in
  `keychain-set.ts` (engine-reviewer had missed it). FIXED + verified: secret now flows via piped
  stdin (`Bun.spawn` ReadableStream password+retype), `-w` with no value in argv — secret nowhere in
  argv, zero new dependency. (Empirically validated round-trip on a real Keychain.)
- **Classifier hardened (review Findings 2/3):** removed false-`missing` `"44"` substring; lowercased
  two dead `errSec*` branches; extracted testable `_classifyKeychainStderr`; real-I/O test now drives
  the PRODUCTION `keychainGetMacOS` (not a copy). 7 new regression tests incl. ACL-denial-with-"44"
  → `acl_denied`.

### ⛔ The one gate left — DoD #1 (BEHAVIORAL, §6.1, Lior only)
"env-isolated real daemon + real Keychain + real Anthropic call" **cannot be closed by code/tests**
(PIPELINE §6.1 — code-reading & green tests are NOT behavioral evidence; this scar lied 3× in v0).
Requires Lior's **live run** of the probe driver. The chunk stays `in-progress`, NOT archived, and the
PR is NOT auto-merged until the demo signs off. **Demo command + L3 option in the PR body + ledger.**

---

## Reality check

Each claim is tagged **fact-from-source** (verified by reading the cited file) or
**hypothesis-needing-runtime** (cannot be confirmed by code-reading per PIPELINE §6.1).

### The injection seam (Grill #2 — verbatim confirmed)

- **fact-from-source.** `packages/daemon/src/providers/anthropic-api-provider.ts:230` reads exactly
  `const resolvedKey = opts.apiKey ?? Bun.env.ANTHROPIC_API_KEY ?? "";`. The reported expression
  matches the source byte-for-byte. `opts.apiKey` is the test/DI injection seam (declared at
  `AnthropicProviderOptions.apiKey`, line 148-149); the secrets module replaces **only** the
  `Bun.env.ANTHROPIC_API_KEY ?? ""` middle+tail. `opts.apiKey` keeps top precedence, NOT routed
  through Keychain.
- **fact-from-source.** The empty-string guard already exists at lines 231-240: `if (!resolvedKey.trim())`
  → returns a typed `provider_failure` with `detail = "ANTHROPIC_API_KEY not set"`. There is **no
  silent `?? ""` fallthrough into the SDK**. So DoD #4's "no silent fallthrough" is *partly already
  true*; this chunk upgrades the **detail string** to be loud-and-named, not the control flow.

### How the provider is wired / consumed

- **fact-from-source.** Production provider is a lazy singleton:
  `anthropicApiProvider = createAnthropicApiProvider()` (line 339-340) with **no `apiKey`**, so the
  `Bun.env.ANTHROPIC_API_KEY` read fires lazily on the **first `advance()`**. `injector.ts:22`
  registers this singleton; `index.ts:63` selects it via `buildInjector()` when
  `LLM_PROVIDER=anthropic-api`.
- **fact-from-source.** Resolution is lazy-per-advance today, so the secrets module can resolve once
  at first use (preserving laziness, avoiding a per-turn shell-out).

### Dev-vs-prod discrimination (the one genuine seam — DoD #3)

- **fact-from-source.** There is **no `NODE_ENV` / `isDev` / production flag in `packages/daemon/src`**.
  The only operative dev/prod difference today: **Bun auto-loads `packages/daemon/.env`** when running
  `bun run dev` (= `bun run src/index.ts`, per `packages/daemon/package.json:7`). A real
  `packages/daemon/.env` exists.
- **fact-from-source.** There is **no prod build/run script** in either `package.json`. "Prod daemon"
  is a concept (launchd, gotcha #38) with no repo artifact — consistent with spec §3.7.
- **Consequence (design-forcing):** "`.env` fallback **dev only**" cannot key off an existing flag.
  The discriminator must be **introduced** by this chunk. See Approach C.

### Done-criteria tags

| # | DoD | Tag | Confirmable by? |
|---|-----|-----|-----------------|
| 1 | env-isolated real daemon + real Keychain + real Anthropic call | **behavioral** | **requires runtime demo to confirm** (Lior, §6.1) — NEVER "verified" from code |
| 2 | Keychain write→read round-trip real-I/O test (no mock) | **mechanical** | `bun test` on a `*.daemon.test.ts` — touches the *real* login Keychain, see Risk |
| 3 | `bun run dev` resolves via `.env`; prod path does NOT read `.env` | **mechanical** (dev half) + **behavioral** (prod-doesn't-read-.env half) | dev half = `bun run dev` smoke; prod half folds into DoD #1's probe — **requires runtime demo** |
| 4 | missing-key failure loud + named | **mechanical** | unit test asserting the error detail string |
| 5 | typecheck + lint:strict + bun test green; frozen surfaces byte-untouched | **mechanical** | run the three gates; `git diff --stat packages/protocol` + mock reducer = empty |

### Grill #1 (`env -i` strips PATH) — confirmed load-bearing

- **fact-from-source / fact-from-environment.** `env -i` clears the entire environment incl. `PATH`;
  a child `Bun.spawn(["security", ...])` would fail with **ENOENT**, which a naive catch could
  misreport as a Keychain ACL denial. **Design mandate:** invoke the CLI by **absolute path
  `/usr/bin/security`**, never bare `security`. Non-negotiable for DoD #1; baked into Step 1.

### Known risk (non-session Keychain ACL) — hypothesis-needing-runtime

- **hypothesis-needing-runtime.** "`security`-CLI-created items are readable by the CLI without a UI
  prompt in a logged-in session" is the working assumption; whether an `env -i`-launched process
  still gets non-interactive read access is **exactly what the behavioral probe tests**. If it hits
  an ACL prompt/denial, the probe MUST surface it distinctly from ENOENT and from missing-item — and
  record the finding in the PR (informs the future launchd packaging feature). Do not paper over it.

### Frozen surfaces

- **fact-from-source.** Nothing here touches `packages/protocol` or the mock reducer
  (`mock-agent.ts`/`mock-provider.ts`). Only existing file edited: `anthropic-api-provider.ts`
  (line 230 + error detail) and `package.json`. DoD #5 byte-untouched is structurally easy.

### Test-suite contamination caveat (FLAG — not a scope edit)

- Real-I/O Keychain tests (DoD #2) write to the developer's **real login Keychain** (no per-test temp
  Keychain primitive like `mkdtempSync`). **Mitigation (in-scope, Step 6):** unique namespaced
  service/account (e.g. service `agentic-engine-test`, randomized account per run) + **delete the item
  in `afterEach`/`finally`**. Flagged because it is the single most likely source of flaky
  `bun test`-not-green-on-CI. Does NOT change scope.

---

## Approaches (decisions taken)

### A. Where resolution happens → **A1 (chosen)**
Resolve inside the provider, replacing line 230's middle term: `opts.apiKey ?? resolveAnthropicKey()`.
Minimal blast radius; matches "single resolution seam the provider consumes". **A2 (resolve in
injector, inject via `opts.apiKey`) REJECTED** — it collapses the test-injection seam and the
prod-secrets seam into one, violating Grill #2.

### B. When resolution happens → **B1 (chosen)**
Synchronous, cached-on-first-resolve via `Bun.spawnSync(["/usr/bin/security", ...])`. One shell-out
per process lifetime; keeps line-230 control flow (no `await` into the guard). The **result-object
return contract** (Step 1) is designed so a future async/non-macOS backend is additive, not breaking.

### C. The dev-vs-prod discriminator (DoD #3) → **C1 (chosen)**
Introduce an explicit **default-deny** gate: resolver permits `.env`/`Bun.env` fallback **only** when
`Bun.env.AGENTIC_ENV === "dev"` (absent ⇒ deny ⇒ prod-safe). `packages/daemon/package.json` `"dev"`
becomes `"AGENTIC_ENV=dev bun run src/index.ts"`. **Fails closed:** an `env -i` daemon (flag absent)
gets NO `.env` path — exactly the prod condition the probe needs. **C2 (implicit ".env reachable")
REJECTED** — a prod launchd plist with `EnvironmentVariables` would silently re-open the `.env`-style
path, breaking "prod does NOT read `.env`".

### D. Setup affordance → **D1 (chosen)**
Standalone script `packages/daemon/scripts/keychain-set.ts` wrapping
`/usr/bin/security add-generic-password -U`. Matches `scripts/` convention; read secret from **stdin**
(never lands in shell history). **D2 (daemon subcommand) rejected** — more surface, no runtime benefit.

---

## ADR worthy: no

Per spec §3.1 the posture rule is doc-reconciliation in the pass README — explicitly NOT a roadmap
change and NOT a new ADR. `architecture.md` already states "API keys stored in macOS Keychain". The
`security`-CLI mechanism, the `secrets/` module boundary, and the `AGENTIC_ENV` dev gate are all
implementation detail inside one daemon package — no new protocol, no cross-boundary contract, no new
npm dependency (the `security` CLI is an OS binary). Reversible by editing one script → does not meet
the §5.2 hard-to-reverse bar. (Non-macOS backend interface considered & rejected as ADR-worthy:
additive/reversible; premature until a second backend lands.)

---

## Steps

### Step 1 — The cloud-secrets module + its interface
**Files:** create `packages/daemon/src/secrets/cloud-secrets.ts` (+ co-located test in Step 6).

Build a single resolver with a stable, backend-agnostic **result contract** (worker may refine naming
per bus q#003, but keep the contract):
- `resolveAnthropicKey(opts?)` returns a **result object**, not a bare string:
  - `{ ok: true; key: string; source: "keychain" | "dotenv" }`
  - `{ ok: false; reason: "missing" | "acl_denied" | "cli_not_found"; triedStores: string[]; fixHint: string }`
- Resolution order: **Keychain first**
  (`/usr/bin/security find-generic-password -s <service> -a <account> -w` via `Bun.spawnSync` —
  **absolute path, Grill #1**), then `.env`/`Bun.env` fallback **only if the dev gate (Step 3) permits**.
- Service/account naming = worker detail (bus q#003). **Recommendation:** service `agentic-engine`,
  account `ANTHROPIC_API_KEY`; document the chosen pair so setup script (Step 5) and the demo write
  match exactly. A mismatch here is the #1 way the probe falsely reports "ACL denied".
- **Distinguish the three failure modes:** ENOENT/spawn failure → `cli_not_found` (Grill #1);
  exit code with item-not-found stderr → `missing`; exit code consistent with ACL prompt/denial →
  `acl_denied`.
- **Never log the key value** (spec §3.8); logging `source`/`reason` is fine.
- Memoize the successful resolution (B1).
- Keep macOS specifics behind an internal `keychainGet()` helper so a future backend slots beside it
  (§3.7 "must not preclude").

### Step 2 — Wire the provider to consume the module (Grill #2 boundary)
**Files:** edit `packages/daemon/src/providers/anthropic-api-provider.ts` (line 230 + missing-key detail).

- Replace line 230 so `opts.apiKey` **keeps top precedence** and the resolver replaces ONLY the
  `Bun.env.ANTHROPIC_API_KEY ?? ""` tail. If `opts.apiKey` is set (test/DI), use it verbatim and
  **do not call the resolver** (don't shell out in unit tests). Otherwise call `resolveAnthropicKey()`.
- Keep the existing `!trim()` guard as the single missing-key sink; the resolver's `{ok:false}` feeds
  the loud detail (Step 4).
- Do NOT touch `injector.ts` (A2 rejected). The singleton at line 339 still constructs with no
  `apiKey` → resolver fires lazily on first `advance()`.
- **Worker verification:** existing `anthropic-api-provider.test.ts` injects `apiKey` (e.g.
  `"sk-ant-test"`), so they must continue to pass **without** any Keychain present. Add/confirm one
  unit test asserting the resolver is NOT invoked when `opts.apiKey` is truthy.

### Step 3 — The dev-vs-prod discriminator (DoD #3)
**Files:** edit `packages/daemon/package.json` (`dev` script); the gate is *read* in `cloud-secrets.ts`.

- Introduce the **default-deny** dev gate (Approach C1): resolver permits the `.env`/`Bun.env`
  fallback **only** when `Bun.env.AGENTIC_ENV === "dev"` (absent ⇒ deny ⇒ prod-safe).
- Change `"dev"` to `"AGENTIC_ENV=dev bun run src/index.ts"`.
- Guarantees DoD #3 both halves: `bun run dev` (flag on) falls back to `.env` if Keychain empty; an
  `env -i` daemon (flag absent) **cannot** fall back even if a `.env` were reachable.
- **FLAG (non-blocking):** `bun test` runs without the flag, so any test relying on `.env` fallback
  must set `AGENTIC_ENV=dev` explicitly (the round-trip test in Step 6 tests the **Keychain** path).

### Step 4 — Loud, named missing-key error (DoD #4)
**Files:** `cloud-secrets.ts` (the `fixHint`), `anthropic-api-provider.ts` (the `detail` it surfaces).

- On failure, daemon-side log + the provider's `ProviderError.detail` must name **which stores were
  tried** and **the exact command to fix** — e.g. `ANTHROPIC_API_KEY not found (tried: macOS Keychain
  service 'agentic-engine'; .env fallback disabled — AGENTIC_ENV≠dev). Fix: bun run --cwd
  packages/daemon keychain-set`.
- Distinguish `acl_denied` and `cli_not_found` in the message (serves the known-risk + Grill #1).
- Keep the wire-facing envelope unchanged (`formatErrorEnd` already withholds detail from the overlay)
  — the loud message is **daemon-side log + the typed `ProviderError.detail`**, never leaked to the
  wire. The credential value is never logged (§3.8).
- Upgrades the existing `"ANTHROPIC_API_KEY not set"` string (line 232) to the named form. Control
  flow unchanged.

### Step 5 — Setup affordance (key → Keychain)
**Files:** create `packages/daemon/scripts/keychain-set.ts`; add a `keychain-set` script in
`packages/daemon/package.json`.

- Wrap `/usr/bin/security add-generic-password -U -s <service> -a <account> -w <value>` (absolute
  path; `-U` = update if exists). Use the **same service/account** chosen in Step 1.
- **Recommendation:** read the secret from **stdin** (or prompt), not a positional arg (never lands in
  shell history). Worker's choice per bus q#003; document chosen ergonomics.
- Print a confirmation naming service/account written (never echo the value) + the verify one-liner.
- Operator path that makes DoD #1/#2 runnable; NOT in the daemon hot path.

### Step 6 — Real-I/O round-trip test (DoD #2) + env-isolated smoke probe (DoD #1)
**Files:** create `packages/daemon/src/secrets/cloud-secrets.daemon.test.ts` (round-trip) and
`packages/daemon/scripts/keychain-prod-probe.ts` (the behavioral demo driver).

**6a — Keychain round-trip test (mechanical, DoD #2):**
- Real-I/O, no mocked Keychain (Strike-4 discipline, `*.daemon.test.ts` convention). Write a key via
  the module's write path (or the Step 5 helper) → resolve back via `resolveAnthropicKey()` → assert
  `{ok:true, source:"keychain"}` and value round-trips.
- **Namespaced, randomized service/account** (e.g. service `agentic-engine-test`, account = random
  UUID per run) + **delete in `afterEach`/`finally`**. If `bun test` runs headless / non-interactive
  ACL, **skip-guard with reason** rather than hard-fail; record the limitation in the PR (FLAG — safe
  default; spec doesn't settle CI Keychain availability).

**6b — env-isolated prod probe (behavioral, DoD #1 + prod half of #3):**
- Standalone script (convention: like `memory-smoke.ts`) the demo runs as:
  `env -i HOME="$HOME" /path/to/bun run packages/daemon/scripts/keychain-prod-probe.ts` (or re-exec
  under a cleaned env). It must:
  1. Run under a **cleaned env** (no `AGENTIC_ENV`, no `ANTHROPIC_API_KEY`, no `.env` reachable —
     confirming the prod condition). `HOME` preserved (Keychain lives under the user's home/login
     session); **PATH deliberately absent** → why the module uses `/usr/bin/security` (Grill #1).
  2. Resolve the key from the **real Keychain** via the module, make **one real Anthropic call**
     (drive a single `session_start`), assert a successful `show_text`/`session_end{completed}`
     (not `error`).
  3. Exit 0 on success; on failure print the **distinct** reason (`cli_not_found` vs `acl_denied` vs
     `missing` vs Anthropic auth error) so an ACL prompt/denial is surfaced, not masked.
- **This is the behavioral DoD.** The probe *existing and passing on the worker's machine* is
  necessary evidence but is **NOT** the sign-off; Lior's live run (§6.1) is. Never record this as
  "verified" from the script's existence. L3 launchd variant remains Lior's call at the demo, out of
  scope (§3.7).

**Closing gate (DoD #5):** run `typecheck` + `lint:strict` + `bun test`; confirm `git diff` touches
zero bytes in `packages/protocol/**` and the mock reducer.

---

## Files (absolute paths)

**Create:**
- `packages/daemon/src/secrets/cloud-secrets.ts`
- `packages/daemon/src/secrets/cloud-secrets.daemon.test.ts`
- `packages/daemon/scripts/keychain-set.ts`
- `packages/daemon/scripts/keychain-prod-probe.ts`

**Edit:**
- `packages/daemon/src/providers/anthropic-api-provider.ts` (line 230 resolution seam + missing-key detail)
- `packages/daemon/package.json` (`dev` gains `AGENTIC_ENV=dev`; add `keychain-set` script)

**Must NOT touch (frozen / out of scope):**
- `packages/protocol/**`
- `packages/daemon/src/mock-agent.ts`, `.../providers/mock-provider.ts`
- `packages/daemon/src/providers/injector.ts` (A2 rejected)

---

## Non-blocking flags (surfaced to PR, none change scope)
1. Real Keychain test pollution → namespaced + cleaned-up item + headless-CI skip-guard.
2. The `AGENTIC_ENV` gate is the introduced dev/prod signal — document it (trivial swap if Lior
   prefers a different name / a config-file gate; not a re-plan).
3. The behavioral probe is necessary-but-not-sufficient evidence — Lior's live §6.1 run is the
   actual sign-off, never the script alone.
