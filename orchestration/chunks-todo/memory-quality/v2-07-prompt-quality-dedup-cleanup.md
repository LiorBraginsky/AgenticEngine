# Chunk v2-07: prompt-quality (recall-usage + over-correction) + distiller dedup + hard-review cleanup

**Status:** in-progress
**Created:** 2026-06-16
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md`; ADR-0012 + 2026-06-13 STABILITY amendment)
**Depends on / BRANCH OFF:** **`chunk/v2-06-debug-env-and-demo-fixes`** (stacked — keeps v2-05 flip + v2-06 fixes + the harness/MEMORY_DEBUG). On demo-green the conductor merges this to main (brings v2-05+v2-06+v2-07), closes PR #67/#68 subsumed.
**THE LAST v2 fix chunk.** Lior's 2nd live re-demo (MEMORY_DEBUG=1 trace) confirmed v2-06's C/B/D/A-race fixes GREEN, and the debug-log PINPOINTED the remaining issues as prompt-quality + a distiller dedup gap (the STRUCTURE — inject/distill/forget/stability — is sound). Further recall-quality beyond this is ROADMAP (recall-usage, 2c, 2d, thread-forget, finer-provenance), NOT more v2 chunks.

## The 3 demo-2 findings (debug-log-proven) + the owed cleanup
- **A′ — the reply agent IGNORES an injected fact (LLM-usage; prompt fix; ASYMPTOTIC, not 100%).** Log
  proof: thread `aea1754d` retrieve injected "Мене звуть Ліор" (order:2), yet the agent replied "не маю
  інформації про твоє ім'я". The PIPELINE is correct (fact injected) — the reply-LLM just didn't use it.
  **Fix:** strengthen the reply system prompt (`system-prompt.ts` / the anthropic adapter): "When the
  user asks about themselves, FIRST check the `[remembered]` messages; if the answer is there, USE it
  and answer confidently. NEVER say you don't have / don't know information that appears in a
  `[remembered]` message." This RELIABLY improves it; it is LLM-non-deterministic so the bar is
  "reliably uses injected facts" (Lior's demo confirms), NOT a hard 1/1 harness gate.
- **E — duplicate fact from a QUESTION (+ no dedup).** Same thread: user only ASKED "як мене звати?"
  (no new statement) and the agent said "no info" → the distiller emitted `op:append targetOrdinal:2
  "Мене звуть Ліор"` → a 2nd duplicate "Мене звуть Ліор". **Fix (two layers, deterministic):**
  (a) distiller delta-prompt: derive facts ONLY from USER STATEMENTS — a user QUESTION (and the
  assistant's replies) are NOT fact sources; (b) a code-level **dedup guard**: never emit new/append
  whose normalized canonical already equals an existing fact's canonical (no-op instead). Harness
  asserts this DETERMINISTICALLY (seed name → ask "як мене звати?" → NO new/duplicate fact).
- **Over-correction — agent suggests History when it already captured the change.** Step 6: user said
  "колір тепер зелений" (distiller DID `op:replace`), agent replied "Можеш змінити це в History…" —
  confusing. The cannot-self-forget prompt (v2-01) over-generalized. **Fix:** prompt nuance — "You
  cannot manually delete/forget memories (the user does that via History). BUT new things the user
  tells you (incl. corrections) ARE captured automatically — do NOT tell the user to update History for
  information they just gave you; only mention History for viewing/editing/forgetting EXISTING memories."
- **Owed hard-review cleanup (v2-06 findings):** (1) add a test — user-ctx (HTTP_CTX, authored_by:human)
  CAN delete a human-authored fact (per ADR-0012 5a, Lior-confirmed) AND machine-ctx is refused (5e);
  (2) correct the v2-06 DoD wording ("5e = machine-can't-clobber-human; 5a = user CAN delete own facts");
  (3) `POST /memory/forget` `target_type:"fact"` REQUIRES a valid `fact_id` (reject malformed) and the
  UI-unreachable text/provenance `forgetFact`-by-provenance (the over-deleting path) is removed/guarded
  so no caller can reach it; (4) minor coverage: the bounded-wait TIMEOUT branch (whenIdle) + an
  overlapping-dismiss-then-new-thread integration test.

## Done criteria
- [ ] **[mechanical]** dedup deterministic (E harness assert GREEN: question → no duplicate); the cleanup
      tests (human-delete 5a/5e, forget requires fact_id, timeout-branch, overlapping-dismiss) green;
      `bun test` green; typecheck + lint:strict 0; frozen (@agentic/protocol + mock-agent.ts) untouched.
- [ ] **[EXECUTED]** the demo-flow harness (stub + real) green; real-mode shows A′ recall-uses-injected
      reliably (report the run; LLM-fuzzy — not a hard 1/1 gate).
- [ ] **[behavioral — Lior's LIVE re-demo, §6.1]** the 9-step demo: agent reliably uses injected facts
      (A′), NO duplicate facts (E), NO redundant "use History" for a just-stated fact (over-correction),
      and C/B/D/stability stay GREEN. NOT done until Lior signs.

## Orchestrator brief
/engine-orchestrator do chunk v2-07 from this file. **Branch off `chunk/v2-06-debug-env-and-demo-fixes`**
(stacked). Mostly prompt + a dedup guard + tests + the route-tighten — small, no new ADR (within
ADR-0012 + amendment + 5a/5e). Use MEMORY_DEBUG + the harness to verify E deterministically + A′ reliably.
Frozen surfaces untouched. Report DONE-ready / BLOCKED-on-Lior-demo; the conductor re-verifies (runs the
harness) + routes the §6.1 re-demo. NO new design seam expected; if A′ needs more than prompt-tuning,
FLAG it (it's roadmap-recall-quality, not this chunk).

## NOTE — memory-improvement ROADMAP (Lior, do not lose; recorded at closeout)
Beyond v2-07 the memory work CONTINUES (these are roadmap, not v2 chunks): **2c** agent memory-action
tools (conversational forget lever) · **2d** on-demand archive retrieval (FTS5→embeddings) · **thread-
forget** (content-erase primitive; reuses the dormant WriteGate scrub) · **finer (message-level)
provenance** (deferred from v2-06; better "dig deeper" + forget granularity) · **recall-usage quality**
(A′ asymptotic — the agent's reliable use of injected facts) · **archive-summarization tier** (the
O(archive) scaling trigger). The conductor records these in `docs/roadmap.md` at feature closeout.
