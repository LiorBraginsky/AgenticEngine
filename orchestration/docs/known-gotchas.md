---
title: Known Gotchas
status: living-document
last-major-update: 2026-05-30
tags: [engineering, gotchas, watch-list]
---

# Known Gotchas

Engineering pitfalls we know about — but haven't designed solutions for yet.

This is **not** an open-questions list (those are architectural decisions). This is the **engineering watch list**: things that will bite us during implementation if we ignore them.

Format: each item has a **severity** (`blocking-MVP` / `nice-to-fix` / `post-MVP`) and a **bucket**.

---

## Bucket: Tool execution lifecycle

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 1 | **Long-running tools without progress reporting** — user has no feedback during a 30s parse | `blocking-MVP` | Need a `tool_progress` event on the WebSocket protocol from day one |
| 2 | **Cancellation when user closes widget mid-flow** — tool keeps running, wastes API quota | `blocking-MVP` | **Skeleton v0 (2026-06-01): cancel path resolved & VERIFIED on macOS (chunk 03) — labeled Cancel button + Escape → tool_cancel → session_end{reason:'cancelled'}, graceful, no orphaned/leaked session, no crash.** Closing the picker (×/Cancel button or Escape) emits `tool_cancel` → daemon ends the session `session_end{reason:"cancelled"}` gracefully; leaked sessions on socket disconnect are cleaned in the `close(ws)` hook (`packages/daemon/src/index.ts`). **Still open for Phase 3:** when a REAL tool/LLM call is in flight, cancel must also abort the running work (`AbortSignal` to the tool runner) — the v0 mock has no long-running work to abort, so that half is deferred to the real-LLM phase. |
| 3 | **Streaming partial results** — for "3 of 10 docs parsed" — needs partial widget updates | `post-MVP` | Add streaming UI updates to protocol in v1.1 |
| 4 | **Tool timeout policy** — what's the default timeout? Per-tool override? | `blocking-MVP` | Sensible defaults: 30s tool, 5min for user-input ui-tool |
| 5 | **Concurrent tool calls** — multiple parallel calls to same tool from one LLM step — race conditions in shared resources | `nice-to-fix` | Document concurrency assumptions in SDK |

## Bucket: Errors

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 6 | **API key invalid / expired** — plugin needs to surface this gracefully | `blocking-MVP` | Standard error widget primitive + retry-with-new-key flow |
| 7 | **Rate limit exceeded** — plugin hits SaaS provider limit | `nice-to-fix` | Error widget with "retry in X seconds" |
| 8 | **Network down** — local engine, remote API unreachable | `nice-to-fix` | Generic offline error + queue for retry? |
| 9 | **Malformed LLM tool call** — LLM hallucinates argument types | `blocking-MVP` | Zod validation rejects, send error back to LLM, let it retry |
| 10 | **Plugin crash** — exception in plugin code shouldn't crash daemon | `blocking-MVP` | Plugin runs in worker thread, exceptions isolated |

## Bucket: Plugin lifecycle

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 11 | **Plugin upgrade during running session** — what happens to in-flight tool calls? | `post-MVP` | Finish current session with old version, new sessions use new version |
| 12 | **Plugin dependency version conflicts** — two plugins want different versions of same npm dep | `nice-to-fix` | npm workspace-style resolution; document plugin author best practices |
| 13 | **Plugin uninstall while in use** — same issue as upgrade | `nice-to-fix` | Block uninstall during active session, or queue it |
| 14 | **Plugin data persistence** — does plugin own a SQLite file? Use shared store? | `post-MVP` | Provide a key-value store API in SDK; isolated per plugin |
| 15 | **Plugin event emit (proactive)** — plugin wants to notify ("doctor sent a new report") | `post-MVP` | Out of MVP. Future: plugins can register event emitters that fire `inbound` triggers |

## Bucket: Plugin dev experience

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 16 | **Debug visibility** — plugin author can't see "what did LLM call with what args" | `nice-to-fix` | Web admin tab has a protocol inspector — surfaces all tool calls |
| 17 | **Test harness** — author needs to `npm test` without live engine | `nice-to-fix` | Provide `@agentic/sdk-test` with mocked engine context |
| 18 | **Hot reload during dev** — change widget code, see it without restart | `post-MVP` | Engine watches plugin source files, reloads on change |
| 19 | **Local plugin development** — `npm link` style, not via npm registry | `blocking-MVP` | Engine can load plugins from local path during dev |
| 20 | **Plugin manifest validation** — bad manifest crashes daemon | `blocking-MVP` | Validate manifest on load, refuse to install if invalid |

## Bucket: Inter-plugin / coordination

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 21 | **Can plugin A call plugin B's tools?** — e.g., MedScan wants to use OCR plugin | `post-MVP` | Yes, by name reference; needs permission grant |
| 22 | **Multi-step within one widget** — user clicks button, plugin shows another widget | `nice-to-fix` | Widget action triggers a new tool call back to engine, normal flow |
| 23 | **Multiple widgets stacked competing for attention** — UX confusion | `nice-to-fix` | Stack limit 3-5; older widgets fade or push out |

## Bucket: Localization & accessibility

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 24 | **Plugin strings localization** — how does a plugin support Ukrainian + English? | `post-MVP` | Plugin provides translation files, engine merges with user locale |
| 25 | **Accessibility for widgets** — keyboard navigation, screen reader | `post-MVP` | Renderer implements a11y for each primitive; plugin author gets it free |

## Bucket: Security

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 26 | **Permissions UX at install** — clear list of what plugin can do | `blocking-MVP` | Manifest-declared list rendered as plain-language install dialog |
| 27 | **Revoking permissions later** — user wants to take back permission | `nice-to-fix` | Settings UI lets user revoke; plugin gets graceful permission-denied |
| 28 | **Sandboxing strategy** — worker thread vs process vs V8 isolate (Q4) | `blocking-MVP` | Worker thread for MVP, process isolation post-MVP for paid plugins |
| 31 | **CSWSH exposure window** — the `Origin` header is spoofable by non-browser clients, so the v0 Origin-allowlist only stops casual cross-site *browser* tabs; an always-on localhost daemon stays reachable by a crafted non-browser client | `blocking-MVP` | Close before any non-dev/public release via the connection-level **per-install token** ([[adr/0003-local-daemon-ws-architecture]] Amendment 2026-05-30); the token is additive and does NOT touch the frozen message envelope. Ties to ADR-0003 Decision p.5. |

## Bucket: Engine core / sessions

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 29 | **Long-session context compaction** — multi-step sessions and especially cron rituals overflow LLM context over time | `post-MVP` | Two patterns: (a) **summarize-and-discard** (lossy — what most coding agents do) vs (b) **event-store append-only** with suppression markers (OpenHands-style, replay-able). Anthropic's compaction API (`compact-2026-01-12`) is available via the SDK — likely inherit it for (a). Claude Code itself is a strong reference: 5 mechanisms — microcompact (inline cleanup, no summary), tool-output clearing, full LLM summarization, cross-session cache reuse, user compact instructions. Triggers ~89% capacity. Worth studying before designing ours. |
| 30 | **Session state memory footprint** — engine holds active session state in-memory (ADR-0001); many concurrent or long-running sessions balloon RAM | `post-MVP` | Cap concurrent sessions; evict idle ones by timeout; persist to disk for resumable long rituals. Ties to ADR-0001 ephemeral-session decision. |

## Bucket: Overlay / window UX

> Surfaced during the chunk-03 macOS DoD demo (2026-06-02). None is a chunk-03 regression — #32 is the known multi-monitor limitation (engine-reviewer flagged), #33/#34 are pre-existing input-panel transient-state behavior Lior intentionally deferred. Recorded here so they are not silent leftovers. **#33 + #34 are coupled** (both about the input panel's transient text/timer lifecycle) and should be fixed together in one coherent follow-up, not piecemeal.

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 32 | **Overlay opens on the primary monitor, not the monitor the user is on** | `nice-to-fix` | `currentMonitor()` on a `visible:false` window resolves to the primary display, and the `main` (input) window centers on primary; so on a multi-monitor setup the panel/widget appear on monitor 1 regardless of where the user is working. v0 was DoD-verified single-monitor. Fix in a multi-monitor follow-up: resolve the **active/focused** monitor (cursor position or focused-window monitor) and position both the input and widget windows there. The chunk-03 `computeWidgetX` right-anchor fix is correct *for whichever monitor is returned* — this is the orthogonal "which monitor" question. |
| 33 | **Stale hide/reset timer closes a freshly-reopened input** | `nice-to-fix` | Repro: hotkey → type → pick a color → (quickly) hotkey again → the input reappears showing the previous session's transient `session … — completed` / `— cancelled` status, and the ~1200ms linger/reset timer from the prior session then auto-hides the *fresh* input. Root: the hide/reset timeout is **not scoped to its session** — a stale timer hides a new session's window. Harmless while v0 shows a transient status, but **must be fixed before the status text is removed/reworked** (Lior, chunk-03). Fix: tag the timer with its session id and cancel any pending hide-timer when a new session opens. Couples with #34. |
| 34 | **Input panel retains old text across opens** | `nice-to-fix` | Repro: fast open → write → close → open shows the previous text (the input `value` is not cleared on hide/show). Coupled with #33 — a naive "clear on hide" would also clear an input that #33's stale timer re-opened, so fix the two together. Relates to a future "clear input after idle timeout" nice-to-have (Lior), but should NOT be left as a silent leftover that resurfaces later (possibly entangled with the #33 status/timeout behavior) and is hard to trace. |

## Bucket: LLM provider / auth

> Surfaced during chunk-03 research + ADR-0011 authoring (2026-06-02). These are the landmines around Anthropic's subscription model, OAuth reuse, and `.env` key-loading. Cross-ref: **ADR-0011** (auth/subscription strategy) and spec §6. None of these are chunk-03 regressions — they are pre-existing policy/tooling constraints recorded here so they are not silent leftovers.

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 35 | **Subscription OAuth-reuse (`claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN`) is prohibited AND server-enforced** — attempting to reuse the user's existing Claude Code session token in-app will be rejected at the API level | `blocking-MVP` (if subscription is ever pursued as provider path); `awareness` otherwise | Claude's OAuth token belongs to the CLI session; Anthropic's servers enforce that it cannot be reused by a third-party app. Any subscription-via-OAuth approach is a dead end by design. See ADR-0011 §Decision. |
| 36 | **Subscription-via-Agent-SDK is metered AND capped** — usage through the Agent-SDK CLI-spawn path draws from a **separate monthly credit pool with no rollover** | `awareness` | This credit pool is distinct from the API-key quota. It is also **opt-in**, becoming available from 2026-06-15. Do not conflate "I have a Claude subscription" with "I have uncapped Agent-SDK access." Design provider #2 with this cap in mind. See ADR-0011 §Decision p.4. |
| 37 | **Anthropic flipped the 3rd-party subscription policy TWICE in 6 months** — the rules around what third-party apps may do with a user's subscription are actively changing | `awareness` — **time-sensitive; re-verify before relying** | As of 2026-06-02 the current policy is captured in ADR-0011. Do not rely on ADR-0011's subscription section without re-checking Anthropic's developer terms, especially before shipping provider #2. |
| 38 | **`.env` key-loading works for `bun run dev` but NOT the production launchd daemon** | `blocking-MVP` (for prod key deployment) | Bun auto-loads `packages/daemon/.env` in dev mode. The production launchd plist (ADR-0003) uses a different mechanism — `EnvironmentVariables` in the plist, system keychain, or a launch-time env injection. Do NOT assume `.env` reaches the daemon in production. These are two different key-loading surfaces; conflating them will cause silent "missing key" failures in prod. |
| 39 | **agent-harness providers own their own tool loop → do NOT fit the raw-API `AgentProvider` port → separate future sub-seam** | `awareness` | The thin `AgentProvider` port (`{ id, advance }`, ADR-0010) is designed for raw-API adapters (mock, `AnthropicApiProvider`). Agent-harness providers (e.g., Claude Code CLI, Gemini CLI) manage their own tool execution loop and cannot be wrapped behind `advance()`. When provider #2 (agent-harness family) lands, it requires a **separate sub-seam** — not a branch on the existing port. See ADR-0010 revised §Decision. |
| 40 | **Claude Code auth precedence ranks subscription OAuth LOWEST — `ANTHROPIC_API_KEY` wins if both are set** | `awareness` | If a user has both an API key in env and a Claude subscription, the API key takes precedence and the subscription OAuth is ignored. This surprises developers testing subscription flows who forget they have an env key set. When switching to subscription-based auth (provider #2), confirm `ANTHROPIC_API_KEY` is unset or cleared. |
| 41 | **Open question: is CLI-spawn *sanctioned* vs merely *tolerated*, and does it draw the metered Agent-SDK credit?** | `blocking-MVP` for subscription provider path | If Anthropic's terms only *tolerate* (not explicitly sanction) third-party CLI-spawn, that's a policy risk. And if CLI-spawn draws from the same metered Agent-SDK credit pool (gotcha #36), provider #2's economics change significantly. Both sub-questions must be answered before committing to the subscription path. See ADR-0011 §Open question / §Decision p.4. |

---

## Deferred cleanups (non-gotcha tech-debt — recorded so they don't rot)

| Item | Where | Note |
|------|-------|------|
| **Dead `session.ts` / `session.test.ts`** | `packages/daemon/src/` | `handleSessionStart` in `session.ts` is **unreferenced by `index.ts`** — the mock reducer (`advanceMockAgent`, and from chunk-02 the `AgentProvider` port) handles `session_start`; only `session.test.ts` imports it. Surfaced during chunk-02 planning (2026-06-02). **Deliberately left untouched in the chunk-02/03 PR** (Lior) to avoid scope-creep + a noisy diff. **Action:** delete both files in a separate tiny cleanup chunk (verify no other importer first: `grep -rn handleSessionStart packages/`). |
| **Overlay text-reply linger too short for reading** | `apps/overlay/src/main.ts` | The `show_text` reply reuses the existing ~1200ms input-panel linger (`main.ts`), which is short for a multi-sentence LLM reply. A longer **text-specific** read-linger would improve UX. However, adding any new timer is currently blocked by the coupled gotcha #33 (session-unscoped hide/reset timer) — a stale timer from the old session would interact badly with a new longer timer. **This must be done TOGETHER with the #33 fix** (scope the timer to its session first, then a longer text linger is safe to add). Flag for a follow-up chunk; do NOT add a new timer before #33 is resolved. |
| **Gotcha #2 abort-in-flight-on-cancel half remains deferred** | `packages/daemon/src/`, `apps/overlay/src/` | Chunk-03 explicitly deferred the abort-in-flight half of the cancel path. Single-turn has no cancel-during-wait UX — the `tool_cancel` envelope only arrives after a tool has already responded. When a real long-running LLM/tool call is in flight, cancel must also abort it (`AbortSignal` to the tool runner). This is the "Phase 3" open item noted in gotcha #2 itself. |

---

## Triage notes

**Must solve before Phase 5 (plugin system):**
- #1, #2, #4, #6, #9, #10, #19, #20, #26, #28 (most "blocking-MVP")

**Must solve before any non-dev / public release (security gate):**
- #31 (CSWSH exposure window — replace the interim Origin-allowlist with the per-install token)

**Solve when you have plugin authors complaining:**
- #16, #17, #18 (DX bucket)

**Solve when sessions get long (Phase 3+ real LLM, Phase 6 rituals):**
- #29, #30 (context compaction + session memory footprint)

**Solve when it actually bites:**
- Everything else

The point of this list is **awareness**, not pre-solving. When you hit gotcha #5 in implementation, you'll already know "yeah, we knew about this, here's a sketch."

---

## Related

- [[plugin-anatomy]] — what plugins are
- [[architecture]] — how plugins fit
- [[adr/0008-plugin-distribution-economic-model]] — economic model
- [[open-questions]] — bigger architectural questions
