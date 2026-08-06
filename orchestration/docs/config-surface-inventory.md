---
title: Config-surface inventory — every knob that already exists, plus what the arc adds
status: NOTES — input to the settings brainstorm (the arc's last member). Not a settings design.
date: 2026-07-28
related:
  - specs/2026-07-28-voice-mode.md (D14 — voice keys)
  - specs/2026-07-28-chat-view.md (C14 — chat-view keys)
  - specs/2026-07-28-continuation-affordance.md (Decided-4 — "config-driven from day one" is why this doc exists)
  - adr/0006-dual-hotkey-2zone-ux.md (p.3 web-admin promises settings/hotkey-rebinding; p.4 tray toggles)
  - adr/0007-voice-mvp-strategy.md (first-launch onboarding wizard — promised, unbuilt)
  - adr/0011-llm-auth-and-subscription-strategy.md · adr/0013 · adr/0014 (auth/token surfaces)
  - adr/0017-embedding-provider-plane-and-egress-posture.md (egress posture — a policy, not a preference)
tags: [notes, settings, config, inventory, arc]
---

# Config-surface inventory

> **Why this exists.** The arc's customization constraint says every behavioral value is config-driven
> from day one so it can graduate into tray settings. Lior's sequencing puts **settings last** so it can
> aggregate everything. That only works if "everything" is actually enumerated — otherwise settings gets
> designed against the three new features and is incomplete on arrival.
>
> **Method + caveat.** A scan of `process.env` uses, exported/module constants, the tray/hotkey
> registration, and the DB schema. **Not exhaustive** — it finds declared knobs, not every magic number
> buried in a function body. Good enough to design sections against; not a migration checklist.

## 1. What exists today

### 1.1 Runtime / process

| Knob | Where | Now |
|---|---|---|
| `AGENTIC_DATA_DIR` | env | data root override |
| `AGENTIC_ENV` | env | environment selector |
| `DAEMON_HOST` | `packages/daemon/src/index.ts:28` | `127.0.0.1` — **security invariant** (ADR-0003 p.3), not a preference |
| `DAEMON_PORT` | `packages/daemon/src/index.ts:29` | `7777`, hardcoded; the overlay hardcodes it again (`apps/overlay/src/memory.ts:22`) |

### 1.2 Auth & secrets

| Knob | Where | Now |
|---|---|---|
| `ANTHROPIC_API_KEY` | env | API-key path (ADR-0011) |
| per-install auth token | `packages/daemon/src/memory/token-store.ts:19` (`auth-token`) | token-gated HTTP + WS subprotocol (ADR-0013 / ADR-0014) |
| Keychain | security-hardening pass | where secrets belong |

### 1.3 LLM

| Knob | Where | Now |
|---|---|---|
| `LLM_PROVIDER` | env | provider selection (ADR-0010) |
| answer model | `packages/daemon/src/providers/anthropic-api-provider.ts:428` | `claude-sonnet-4-6`, **hardcoded** |
| `max_tokens` | `…:429` | `1024` with tools / `512` without, hardcoded |

### 1.4 Memory / distiller

| Knob | Where | Now |
|---|---|---|
| `MEMORY_PROVIDER` | env | provider selection |
| distiller model | `smart-distiller-provider.ts:36` | `claude-haiku-4-5` |
| `SMART_MAX_TOKENS` | `…:46` | `4096` |
| `SMART_DIGEST_MAX_MSGS_PER_THREAD` | `…:48` | `50` |
| `RETRIEVE_SLICE_N` | `…:51`, `dumb-tail-provider.ts:9` | `20` (injected slice size) |
| `FORGOTTEN_NUDGE_MAX` | `…:59` | `10` |
| `TAIL_LIMIT` | `thread-lifecycle.ts:12` | `50` |
| `WHEN_IDLE_TIMEOUT_MS_DEFAULT` | `thread-lifecycle.ts:19` | `5000` (dismiss-idle → distill) |
| `CANDIDATE_TOP_K` | `store.ts:15` | `10` (hybrid candidate fetch) |
| `ALL_FACTS_CAP` | `store.ts:25` | `50` |
| `APPEND_LIST_CAP` | `store.ts:26` | `8` |
| `HATCH_VIEW_FACT_CAP` | `hatch.ts:27` | `1000` |

### 1.5 Memory action tools (ADR-0016)

| Knob | Where | Now |
|---|---|---|
| `MEMORY_ACTIONS_MAX_PER_TURN` | `memory-action-port.ts:9` | `3` (the 5d cap) |
| `MEMORY_SEARCH_MAX_PER_TURN` | `…:13` | `3` |
| `SEARCH_RESULT_CAP` | `…:14` | `8` |

### 1.6 Embeddings (ADR-0017)

| Knob | Where | Now |
|---|---|---|
| `EMBEDDING_PROVIDER` | env | provider selection |
| `AGENTIC_EMBED_AUTODOWNLOAD` | env | model auto-download gate |
| model id | `local-wasm-embedding-provider.ts:13` | `Xenova/multilingual-e5-small` |
| dims | `…:15` | `384` (**coupled to the model** — not independently settable) |
| batch / debounce | `embedding-drain.ts:12-13` | `32` / `50 ms` |
| egress posture | ADR-0017 | a **policy**, not a preference |

### 1.7 Overlay / UX

| Knob | Where | Now |
|---|---|---|
| main hotkey | `apps/overlay/src-tauri/src/lib.rs:81` | `CommandOrControl+Shift+Space`, **hardcoded in Rust** — ADR-0006 p.3 promised rebinding; unbuilt |
| widget width | `apps/overlay/src/main.ts:96` | `360` logical |
| widget y / right margin | `…:97-98` | `24` / `12` |
| liveness poll | `memory-liveness.ts:78` | `3000 ms` |
| daemon base URL | `memory.ts:22` | hardcoded, duplicates 1.1 |

### 1.8 Tray (ADR-0006 p.4)

Built: status glyph + tooltip, **Open Memory…**, **Quit** (`lib.rs:100-141`).
**Promised and unbuilt:** mute mic, pause cron, link to admin tab.

### 1.9 Dev-only

`MEMORY_DEBUG=1` (`debug-log.ts:68`) — trace logging.

## 2. What the arc adds

- **Voice** — 16 keys, voice-spec **D14** (`voice.*`, `stt.*`, incl. the disabled `voice.output = speak`
  "coming soon" slot and `stt.models.*` as a slot for the later model manager).
- **chat-view** — 5 keys, chat-view spec **C14** (`chatView.hotkey` unbound, `scrollbackEnabled`,
  `initialTurns`, `widthPct`, `heightPct`).
- **Continuation** — the ~5 s minimize timer, hover-pause, minimize/dismiss policy, minimized-widget
  size (continuation spec Decided-4 requires them to be keys; exact names not yet fixed).

## 3. The classification that actually matters for the settings design

**Tier A — user-facing.** Hotkeys (main / voice / chat-view) · voice gesture, language, mic device ·
STT provider + model · LLM provider + model · `chatView.scrollbackEnabled` · continuation timer ·
tray toggles (mute mic).

**Tier B — advanced / power-user, hidden by default.** Caps and timers (1.4, 1.5), embedding batch /
debounce, liveness poll, port, `MEMORY_DEBUG`.

**Tier C — must NOT become a setting.** Secrets (Keychain, never a settings file) · `127.0.0.1` binding
(security invariant, ADR-0003 p.3) · egress posture (ADR-0017 policy) · embedding `dims` (derived from
the model, not free) · the token itself.

**Tier D — promised but unbuilt** (settings inherits these debts): hotkey rebinding (ADR-0006 p.3) ·
tray mute-mic / pause-cron (p.4) · the ADR-0007 **first-launch onboarding wizard** (cloud-vs-local STT
choice) · the STT model manager (voice-spec O2).

## 4. Questions this hands to the settings brainstorm

1. **Where do settings live?** A file under `AGENTIC_DATA_DIR`, a SQLite table, or both? Today there is
   no settings store at all — every knob above is an env var or a compile-time constant.
2. **Who owns them?** The daemon holds secrets and providers; the overlay holds hotkeys and geometry.
   Two owners, or one store with the daemon as the authority and the overlay reading it?
3. **How does a change propagate live?** Restart-required vs hot-reload — and over which surface (the
   frozen WS protocol, or the token-gated HTTP one, per ADR-0013's posture).
4. **Surface shape:** tray menu vs a settings window in the overlay vs the existing loopback web page
   (ADR-0006 p.3 assigned settings to the web admin tab — is that still the intent, now that Memory
   moved *into* the overlay?).
5. **What is "minimal settings"** for the first build (it ships alongside voice)? Lean: the voice keys +
   STT provider/model + hotkeys — nothing from Tier B.
6. **Duplication cleanup:** the port and base URL are declared twice (1.1 vs 1.7). A settings store is
   the natural moment to make that single-source.
