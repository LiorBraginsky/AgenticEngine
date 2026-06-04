# Security hardening pass — ⚖️ LIGHT-DIRECT DRAFT (process experiment)

> **These two chunks are a deliberate "before" snapshot. DO NOT execute as-is. DO NOT silently overwrite them.**

## What this is

The near-term **security hardening pass** (roadmap → "Conversation & Interaction Model" §security): un-defer the **per-install WS token** (ADR-0003 p.5 — only the *timing* was deferred) and move secrets into the **OS Keychain**. Closes known-gotchas **#31** (CSWSH exposure window) and **#38** (`.env` doesn't reach the prod launchd daemon).

## Why it's a "light-direct" draft, not a normal decompose

Unlike `memory-foundation` (thick design, 4 open seams → spec-first + brainstorm + grill), this pass is **thin and already-decided** (ADR-0003 p.5 + `architecture.md` Keychain). So it was written **light-direct**: the author's first-pass chunk files, **without** a spec, **without** `superpowers:brainstorming` (no Lior seam-resolution), and **without** `grill-with-docs` (no adversarial fresh-eyes pass).

**This is an experiment (Lior, 2026-06-04):** after the memory-foundation chunks are built, come back and run the **full ceremony** on this same pass, then **compare** the result against this draft — to learn whether brainstorm + grill *materially* change a thin, already-decided decomposition, or whether light-direct was sufficient. For that comparison to be honest, **this draft must be preserved as the "before."**

## Revisit protocol (the experiment)

**Trigger:** AFTER the memory-foundation chunks (MF-01…MF-05) are built/merged.

Then:
1. Run `superpowers:brainstorming` to resolve the **`## Open / assumptions (un-brainstormed)`** sections in each chunk (the seams the author guessed at).
2. Run standalone `grill-with-docs` adversarially against the resulting decomposition.
3. **Diff** the post-ceremony chunks against this draft (keep this draft as the baseline — e.g. copy to `…/_light-direct-baseline/` before overwriting, or compare via git history).
4. **Conclude:** did the ceremony change scope, ordering, seams, or DoD? Was the delta worth the process cost? (Feeds the standing "is the ceremony worth it for thin features" question — relates to `feedback_orchestrate_chunks_from_jimmy`.)

## Already trimmed from scope (so the orchestrator doesn't redo or over-reach)

- **127.0.0.1-only binding is already DONE** — `packages/daemon/src/index.ts:6` (`DAEMON_HOST = "127.0.0.1"`, used as `Bun.serve` `hostname`). NOT pending work.
- **"Untrusted-by-default plugin/MCP supply chain" is OUT (premature)** — plugins/MCP don't exist yet (Phase 5). That hardening belongs with the plugin system, not this near-term pass.

## Sequencing note (why this matters more now)

The **#31 token chains with the memory-poisoning surface** that `memory-foundation` introduces — ADR-0012 decision 5 (line 52): *"a crafted non-browser client that can reach the daemon could plant a distilled 'fact' that then re-injects forever."* Building memory without closing #31 creates exactly the attack surface the transparency hatch was designed to mitigate. So closing #31 (chunk 02) is a **natural companion to memory-foundation**, not merely an optional parallel.

## Chunks

| # | Title | Status | Closes |
|---|-------|--------|--------|
| 01 | Secrets → OS Keychain (+ prod launchd key-loading) | postponed | #38 |
| 02 | Per-install WS token (connection-level, additive) | postponed | #31 (executes ADR-0003 p.5) |

02 depends on 01 (the token needs a secure home = Keychain).
