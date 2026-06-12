# Chunk 01: Anthropic API key → macOS Keychain (+ env-isolated prod proof)

**Status:** in-progress
**Created:** 2026-06-12
**Phase:** Security hardening pass (pre-public-release gate)
**Estimated size:** ~1 day
**Depends on:** none — **parallelizable with 02/03** (the per-install token already has its 0600-file home; this chunk no longer provides it — spec §3.1, bus q#001)
**Closes:** known-gotcha #38 (T4)
**Refs:** [[../../docs/specs/2026-06-12-security-hardening]] §3.1/§3.7/§3.8 · [[../../docs/known-gotchas]] #38 #35 · [[../../docs/architecture]] (API keys in Keychain) · bus q#001/q#003

## Scope

**In:**
- A **cloud-secrets module** in `packages/daemon/src/`: resolve `ANTHROPIC_API_KEY` from the
  **macOS Keychain** (via the `security` CLI: `find-generic-password`), with **`.env` fallback in
  dev only**. Single resolution seam the provider consumes (today: `anthropic-api-provider.ts:230`
  reads `Bun.env` directly — route it through the module).
- A **setup affordance** to put the key INTO the Keychain (a small script or daemon-side one-shot —
  `security add-generic-password` wrapper; worker's choice, documented).
- **Env-isolated runtime proof** (spec §3.7 = L2): a real daemon launched with a cleaned env
  (`env -i`, no `.env` visible — the launchd no-inherited-env condition) authenticates to Anthropic
  with the Keychain-sourced key.

**Out:** (each states WHY — PIPELINE §7.2)
- **launchd packaging (plist / install / autostart)** — OUT: no launchd surface exists in the repo
  today; packaging is its own future distribution feature, not a secrets concern (spec §3.7, bus
  q#003-L2). The **L3 option** (one-off non-repo plist + live launchd demo) is **Lior's call at the
  §6.1 demo**, not pre-decided here.
- **The per-install token** — OUT: already lives in its 0600 file (`TokenStore`, MF-05); Keychain is
  for **cloud** secrets only (spec §3.1 posture rule).
- **Non-macOS keychain backends** — OUT, post-v1; don't preclude them in the module's interface.
- **Plugin/third-party secrets** — OUT, Phase 5.
- **Subscription OAuth reuse** — NOT a path this chunk may create (#35 is server-enforced
  prohibition; awareness check, not a task).

## Done criteria

- [ ] **[behavioral]** a real daemon launched **env-isolated** (cleaned env, no `.env` reachable)
      resolves the key from the **real Keychain** and completes a real Anthropic call (live check;
      L3 launchd variant at Lior's discretion).
- [ ] **[mechanical]** real-I/O test: Keychain write → read round-trip via the secrets module
      (no mocked Keychain).
- [ ] **[mechanical]** `bun run dev` still resolves the key via `.env` (dev fallback intact); the
      prod path does NOT read `.env`.
- [ ] **[mechanical]** the missing-key failure is **loud and named** (which store was tried, what to
      run to fix) — no silent empty-string fallthrough (`resolvedKey ?? ""` today).
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green; frozen surfaces
      (`packages/protocol`, mock reducer) byte-untouched.

## Orchestrator brief (read by the orchestrator from this file)

```
implement cloud-secret resolution: ANTHROPIC_API_KEY from macOS Keychain (prod) / .env (dev only),
per spec orchestration/docs/specs/2026-06-12-security-hardening.md §3.1/§3.7.

Files to touch (indicative):
- packages/daemon/src/secrets/ (new module: security-CLI Keychain read + dev .env fallback + setup write)
- packages/daemon/src/providers/anthropic-api-provider.ts (consume the module instead of Bun.env directly)
- packages/daemon/scripts/ (setup script or smoke probe as needed)

Done when:
- env-isolated real daemon + real Keychain + real Anthropic call succeeds (live);
- Keychain round-trip real-I/O test passes; dev .env fallback intact; missing-key error is loud;
- typecheck + lint:strict + bun test green; protocol/mock byte-untouched.

ADRs in scope: ADR-0003 (daemon), spec §3.1 posture (Keychain = cloud secrets ONLY).
NOT in scope: launchd packaging (L3 = Lior demo option), the per-install token (chunks 02/03), plugin secrets.

Known risk (was the draft's top OPEN): Keychain access from a non-session process — `security` CLI
items created by the CLI are readable by it without UI prompts in a logged-in user session; if the
env-isolated probe hits an ACL prompt/denial, surface it in the PR (it informs the future launchd
packaging feature), don't paper over it.
```

## Notes / Open questions

- Module API shape (sync/async, service/account naming) = worker-level detail (bus q#003 agreed).
- Only `ANTHROPIC_API_KEY` is a secret today (grep-verified); `AGENTIC_DATA_DIR` is config.
- **Grill pre-warn #1 (`env -i` strips PATH):** the env-isolated probe clears the ENTIRE env, PATH
  included — invoke the Keychain CLI by absolute path (`/usr/bin/security`) or set a minimal
  `PATH` in the cleaned env, else **ENOENT masquerades as a Keychain ACL denial** (the exact thing
  the Known-risk note tells the worker to watch for).
- **Grill pre-warn #2 (injection precedence):** `anthropic-api-provider.ts:230` resolves
  `opts.apiKey ?? Bun.env.ANTHROPIC_API_KEY ?? ""` — `opts.apiKey` is the test-injection seam and
  keeps its precedence; the secrets module replaces ONLY the `Bun.env... ?? ""` step. Do not route
  `opts.apiKey` through Keychain.
