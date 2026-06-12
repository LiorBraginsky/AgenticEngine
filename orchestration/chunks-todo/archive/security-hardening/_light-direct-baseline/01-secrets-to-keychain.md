> ⚖️ **LIGHT-DIRECT DRAFT — DO NOT EXECUTE AS-IS.** Written without spec / brainstorm / grill. Revisit AFTER memory-foundation chunks, then brainstorm + grill + compare. See `README.md` in this folder. The `## Open / assumptions` section below is what a brainstorm would resolve.

# Chunk 01: Secrets → OS Keychain (+ prod launchd key-loading)

**Status:** postponed
**Created:** 2026-06-04
**Phase:** Security hardening pass (near-term, before any non-dev release)
**Estimated size:** ~1 day
**Depends on:** none
**Closes:** known-gotcha #38 · provides the secure home that chunk 02's per-install token needs
**Refs:** [[../../docs/architecture]] (API keys in macOS Keychain) · [[../../docs/known-gotchas]] #38 · [[../../docs/adr/0003-local-daemon-ws-architecture]]

## Scope

**In:**
- A **secrets module** (read/write) backed by the **macOS Keychain** — the single place the daemon resolves secrets at runtime.
- **Migrate the Anthropic API key out of `.env` into the Keychain for production.** Fixes #38: Bun auto-loads `packages/daemon/.env` for `bun run dev` but that file does **not** reach the production **launchd** daemon — conflating the two causes silent "missing key" failures in prod.
- **Retain the dev `.env` fallback** (so `bun run dev` keeps working without Keychain ceremony).
- The secrets module exposes a shape the **per-install token (chunk 02)** reuses — one secrets path, not two.

**Out:** (each states WHY)
- **The per-install WS token itself** — OUT, chunk 02 (this chunk only provides its storage home).
- **Plugin/third-party secrets** — OUT, Phase 5 (plugins don't exist yet).
- **Non-macOS keychain backends** (Windows Credential Manager / libsecret) — OUT, post-v1; the module's interface should not *preclude* them, but don't build them.
- **127.0.0.1 binding** — already DONE (`index.ts:6`); not in this pass.

## Done criteria

- [ ] **[behavioral]** on real macOS, the **production launchd daemon** starts and loads the API key **from the Keychain** (gotcha #38 closed — runtime proof, not code-reading; a live macOS check that the launchd daemon actually authenticates to Anthropic with the Keychain-sourced key).
- [ ] **[mechanical]** real-I/O test of the secrets module against the **real Keychain** (write → read round-trip; no mocked Keychain).
- [ ] **[mechanical]** `bun run dev` still resolves the key via `.env` (dev fallback intact); the prod path does **not** depend on `.env`.
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

## Orchestrator brief (read by the orchestrator from this file)

```
implement an OS-Keychain secrets module + migrate the prod Anthropic API key off .env (gotcha #38).

Files to touch (indicative):
- packages/daemon/src/        (a secrets module: Keychain read/write; key resolution = Keychain (prod) | .env (dev))
- the launchd plist / startup path (so the prod daemon resolves the key from Keychain, not .env)

Done when:
- the prod launchd daemon loads the API key from the Keychain on real macOS (live check);
- a real-I/O Keychain round-trip test passes (no mock);
- bun run dev still works via .env;
- typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0003 (daemon), architecture.md (Keychain). NOT in scope: the WS token (chunk 02), plugin secrets (Phase 5).
```

## Open / assumptions (un-brainstormed — a brainstorm would resolve these)

- **ASSUMED:** Keychain (not launchd plist `EnvironmentVariables`) as the prod secret store, per `architecture.md`. *(Brainstorm might weigh plist-env vs Keychain vs a launch-time injector — #38 lists all three.)*
- **ASSUMED:** dev keeps `.env`; prod uses Keychain. *(Brainstorm might prefer Keychain everywhere for parity.)*
- **OPEN:** secrets-module API shape (sync vs async; namespaced keys; one entry vs many).
- **OPEN:** whether any *other* current secret exists to migrate, or only the Anthropic key today.
- **OPEN:** Keychain access-control / prompt behavior under launchd (a daemon has no UI session — does Keychain access need a specific ACL / `kSecAttrAccessible` setting?). *This is the most likely grill-surfaced risk.*

## Notes

- This is the **"before"** snapshot for the process experiment (README). If you build it, preserve this file's content in git history so the post-ceremony version can be diffed against it.
