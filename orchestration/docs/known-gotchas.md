---
title: Known Gotchas
status: living-document
last-major-update: 2026-05-28
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
| 2 | **Cancellation when user closes widget mid-flow** — tool keeps running, wastes API quota | `blocking-MVP` | Pass `AbortSignal` to tool runner; engine triggers on widget-close |
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

## Bucket: Engine core / sessions

| # | Gotcha | Severity | Note |
|---|--------|----------|------|
| 29 | **Long-session context compaction** — multi-step sessions and especially cron rituals overflow LLM context over time | `post-MVP` | Two patterns: (a) **summarize-and-discard** (lossy — what most coding agents do) vs (b) **event-store append-only** with suppression markers (OpenHands-style, replay-able). Anthropic's compaction API (`compact-2026-01-12`) is available via the SDK — likely inherit it for (a). Claude Code itself is a strong reference: 5 mechanisms — microcompact (inline cleanup, no summary), tool-output clearing, full LLM summarization, cross-session cache reuse, user compact instructions. Triggers ~89% capacity. Worth studying before designing ours. |
| 30 | **Session state memory footprint** — engine holds active session state in-memory (ADR-0001); many concurrent or long-running sessions balloon RAM | `post-MVP` | Cap concurrent sessions; evict idle ones by timeout; persist to disk for resumable long rituals. Ties to ADR-0001 ephemeral-session decision. |

---

## Triage notes

**Must solve before Phase 5 (plugin system):**
- #1, #2, #4, #6, #9, #10, #19, #20, #26, #28 (most "blocking-MVP")

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
