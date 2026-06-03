> 🗄️ ARCHIVED 2026-06-03 — done. Historical record; do not edit.

# Chunk 3: AnthropicApiProvider + end-to-end wiring + overlay text renderer + live demo

**Status:** done
**Created:** 2026-06-02
**Phase:** llm-text-slice (first post-v0 vertical slice)
**Estimated size:** ~1 day
**Depends on:** Chunk 1 (`show_text` primitive) AND Chunk 2 (AgentProvider port + injector)

## Scope

**In:**
- **`AnthropicApiProvider`** (raw-api adapter): `@anthropic-ai/sdk`, reads `ANTHROPIC_API_KEY` from `.env`, model **Claude Sonnet 4.6**, a tiny system prompt ("concise assistant in a small overlay — keep replies short"); sends the (single-turn) `messages[]`; returns text → daemon emits `show_text`. Register + activate it in the injector. **Build with the `claude-api` skill** (SDK, prompt caching, model id).
- **Overlay text renderer:** render inbound `show_text` in the top-right widget window (reuse window + styling).
- **Wire end-to-end (single-turn):** hotkey → input → `session_start{text}` → injector→AnthropicApiProvider → Claude → `show_text` → overlay → `session_end{completed}`.
- **Error handling:** Claude API errors (missing key / timeout / rate-limit / malformed) → caught → graceful via the existing error path (no crash, no orphaned session). Typed errors, never throw.
- **Gotchas recorded** in `known-gotchas.md` (the 7 from spec §12).
- **Lior's live macOS demo** (real key) — the behavioral done-gate.

**Out:**
- **Subscription / Claude Agent SDK provider** (= provider #2; post-2026-06-15, re-verified). API-key only here.
- OpenAI / OpenRouter / other adapters.
- Streaming, LLM tool-calling, multi-turn UX.
- **Abort-in-flight-LLM-on-cancel** (gotcha #2 abort-half) — **DEFERRED** (Lior, 2026-06-02): single-turn has no cancel-during-wait UX. Record as still-open.
- Real auth-flow (settings UI, macOS Keychain, OAuth onboarding) — deferred backlog.
- Production daemon key-loading (arrives with .dmg packaging).

## Done criteria

- [ ] On **real macOS**: press hotkey, type a question, **Claude (Sonnet 4.6, `.env` key) replies, and the reply text appears in the overlay widget**; `session_end{completed}`. (Lior demo — behavioral gate.)
- [ ] API errors (missing/invalid key, timeout) → surfaced gracefully, no crash, no orphaned session.
- [ ] New provider unit tests with a **mocked Anthropic client** (input → client called with expected args → `show_text` emitted); overlay renderer seam test.
- [ ] All existing tests green.
- [ ] `known-gotchas.md` updated with the 7 gotchas (spec §12).
- [ ] `git diff packages/protocol` empty (contract already shipped in Chunk 1; no new contract change here).

## Orchestrator brief (ready to copy)

```
implement the first real LLM provider end-to-end, per orchestration/docs/specs/2026-06-02-llm-text-slice.md (§3 ②③, §5, §7, §8, §11 ADR-C, §12). Depends on Chunk 1 (show_text) + Chunk 2 (AgentProvider port). Build the Anthropic adapter with the claude-api skill.

Files to touch:
- packages/daemon (AnthropicApiProvider raw-api adapter; .env ANTHROPIC_API_KEY; register + activate in injector; error handling)
- apps/overlay (text renderer for show_text in the widget window; wire submit→session_start; render→session_end)
- orchestration/docs/known-gotchas.md (add the 7 gotchas from spec §12)

Behaviour (single-turn, real WS):
- hotkey → input → submit(text) → session_start{text} → daemon → injector picks AnthropicApiProvider → Claude (Sonnet 4.6, .env key, tiny system prompt, messages[]=1) → text → tool_call(show_text,{content}) → overlay renders → session_end{completed}.
- API errors → graceful (existing error path), no crash.

Done when (VERIFY ON REAL macOS — behavioral gate, not just tests):
- type a question → Claude replies → text visible in overlay → session_end{completed}; errors graceful; provider unit tests (mocked client) + renderer test; existing tests green; known-gotchas updated; protocol diff empty.

ADRs in scope: ADR-C (LLM auth & subscription strategy — API-key first; subscription via Agent-SDK CLI-spawn = #2 post-2026-06-15; never OAuth-reuse). Flag `## ADR worthy: yes` → adr-curator. (ADR-A/ADR-B already drafted in Chunks 1/2.)

Out of scope: subscription provider (#2), OpenAI, streaming, tool-calling, multi-turn, abort-on-cancel (gotcha #2 abort-half — DEFERRED per Lior), real auth-flow, prod key-loading.

GUARD: needs ANTHROPIC_API_KEY in packages/daemon/.env (gitignored) to demo. The behavioral done-gate is Lior running it on macOS — a worker CANNOT launch the native overlay.
```

## Notes / Open questions

- **Behavioral gate = Lior's live macOS demo** (real key). Per project lesson, behavioral DoD is proven by a live run, not code-reading or a prior PASS record (known-gotchas; memory `feedback_behavioral_dod_needs_runtime_proof`). A worker CANNOT close this chunk — only Lior's demo can.
- **Deferred (tracked, not pretended-done):** gotcha #2 abort-half (no cancel-during-wait UX here); real auth-flow (Keychain/settings/OAuth); subscription provider #2 (post-2026-06-15 — **re-verify the policy, it flipped twice in 6 months**).
- **Watch gotchas #33/#34** (coupled stale-timer + input-text retention): the `show_text` renderer reuses the linger-timer surface — do NOT worsen them (#33: must be fixed before status-text rework; this renderer is adjacent).
- **#6 (API key invalid):** surface gracefully here; the full "retry-with-new-key" flow is part of the deferred auth-flow.
