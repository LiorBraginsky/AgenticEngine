# Chunk v2-08: recall injection lifecycle (turn-2+ fact loss) + dedup hardening

**Status:** todo
**Created:** 2026-06-16
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md`; ADR-0012 + 2026-06-13 STABILITY amendment)
**Depends on / BRANCH:** the branch **`chunk/v2-08-recall-injection-lifecycle` ALREADY EXISTS and is checked out** (stacked on v2-07), with the confirmed-diagnosis commit `c294795` (the `inject` MEMORY_DEBUG stage + harness STEP 2b). **CONTINUE on this branch — do NOT re-branch.** On demo-green the conductor merges the whole stack (v2-05+06+07+08) to main.
**Why:** Lior's 2nd live re-demo (v2-07) still failed recall. The conductor root-caused + **confirmed with the new `inject` log** that the demo-2 "A′" failure is NOT LLM-asymptotic — it is a **structural injection bug**, and the v2-07 prompt fix treated the wrong cause. Fix variant **A** chosen by Lior.

## The confirmed root cause (MEMORY_DEBUG=1, commit c294795)
`beginTurn` (thread-lifecycle.ts:64-106) injects distilled facts via `retrieve()` **ONLY on the new-thread branch**. A **known-thread** turn (line 66-68) hydrates `readThreadTail()` with **NO fact re-injection**. Each overlay message is a separate `session_start`, so **every turn 2+ of a thread loses cross-thread memory.** Proof on one thread:
```
turn 1 "Який мій улюблений колір?"  priorContext = [ [remembered] work, [remembered] colour, [remembered] name ]   ✓
turn 2 "Як мене звати?" (same thread) priorContext = [ {user "Який колір?"}, {assistant "Recall:…"} ]   ← ZERO [remembered]
```
Recall "sometimes worked" only when the asked fact matched a thread's FIRST turn. The harness stayed green because STEP 2 only ever recalled as a thread's first turn (now fixed by STEP 2b).

## Part 1 — A′ fix (variant A: re-inject [remembered] facts every turn)
- **`beginTurn` known-thread branch (thread-lifecycle.ts:66-68) must ALSO `retrieve()`** the cross-thread distilled facts and **prepend them (as the existing `[remembered]` user-messages) BEFORE the thread tail**, returning `[...facts, ...tail]`. Keep the new-thread branch as-is (facts only, no tail). The `[remembered]` message format, system-prompt semantics, chat-stub, and provenance-stamp are UNCHANGED — this is the small-diff variant.
- **whenIdle (consistency) stays NEW-THREAD-ONLY.** Do NOT await `whenIdle` on known-thread turns: the facts are already committed, and awaiting every turn adds latency + would re-introduce a per-turn block. Only the new-thread FIRST turn needs the read-after-write wait (v2-06 FIX-A). Keep that branch's behavior intact.
- **⚠️ RUNTIME COUPLING — the `injectedMemory` / provenance-stamp flag (index.ts:156-182,223).** Today the comment (index.ts:157-159) DELIBERATELY sets `injectedMemory` only on the new-thread branch, because plain same-thread tail hydration is "the user's own prior turns," NOT cross-thread memory. With fix A, a known-thread turn now ALSO injects cross-thread FACTS. So `injectedMemory` must fire **iff this turn injected ≥1 cross-thread `[remembered]` fact** (new OR known thread) — but must STILL be false for a known-thread turn that injected only the tail and no facts (e.g. memory empty). Distinguish "retrieve returned facts" from "tail hydrated." Update the provenance-stamp test (`provenance-stamp.daemon.test.ts`) to match the new (correct) rule. Resolve this explicitly — do not leave the flag semantics ambiguous. (Architect: this is the design seam of the chunk.)
- **Frozen surfaces:** injection is daemon-internal (`priorMessages` → `priorState.messages`), NOT the wire. `@agentic/protocol` + `mock-agent.ts` MUST stay byte-unchanged. Confirm no envelope/type-surface change.

## Part 2 — E dedup hardening (the demo's duplicate "Мій улюблений колір — синій")
Demo + log root cause: a recall reply ("синій") got re-distilled into a NEW colour fact even though one existed, because **(a)** the existing colour fact was **not even a BM25 candidate** for that thread (so the v2-07 dedup guard had nothing to compare against), and **(b)** the canonicals differed (`favorite color is blue` ≠ `favorite color blue`) so even exact-canonical compare would miss.
- **Harden the dedup guard:** before inserting a new/demoted fact, compare its **normalized canonical against ALL existing facts** (a direct normalized lookup over `distilled_facts`/`fact_fts`), NOT only the BM25 candidate set. Use the existing `normalizeFactText` for the compare so "is blue"/"blue" variants collapse. Exists → no-op (as today). Scope unchanged (new/demoted/append-fallback only; never replace/normal-append).
- **Keep E-a** (prompt: a user QUESTION / assistant line is not a fact source) — it is the LLM-fuzzy first line; the hardened structural guard (above) is the deterministic backstop for what the prompt misses.

## Part 3 — harness regression asserts (flip RED→GREEN)
- **STEP 2b** (already added, currently a logged RED): flip to a **HARD assertion** — turn-1 memory-present AND turn-2 memory-present (process.exit(1) on miss). GREEN only after Part 1.
- **Add a dedup-after-recall assert:** new thread → recall colour (a question, agent answers) → dismiss → assert **NO new/duplicate colour fact** was created (count stable). Deterministic in stub mode. GREEN only after Part 2.
- Keep the `inject` MEMORY_DEBUG stage (committed dev-env).

## Done criteria
- [ ] **[mechanical]** harness STEP 2b hard-assert GREEN (turn-2 recall survives) + dedup-after-recall GREEN; `bun test` green; typecheck + lint:strict 0; frozen (`@agentic/protocol` + `mock-agent.ts`) byte-unchanged.
- [ ] **[EXECUTED]** the harness (stub + real) green; real-mode shows multi-turn recall uses injected facts on turn 2+ (report the run).
- [ ] **[behavioral — Lior's LIVE re-demo, §6.1]** the 9-step demo with MULTIPLE questions per thread: agent recalls name/colour/work on follow-up turns (not just turn 1), NO duplicate facts, and C/B/D/stability stay GREEN. NOT done until Lior signs.

## Orchestrator brief
/engine-orchestrator do chunk v2-08 from this file. **CONTINUE on the existing `chunk/v2-08-recall-injection-lifecycle` branch (HEAD c294795)** — do NOT re-branch. This is a runtime-coupling chunk (injection lifecycle + the `injectedMemory`/provenance-stamp flag + whenIdle) → architect FIRST, then engine-worker, then **engine-reviewer + hard-reviewer** (high-stakes, layered — the prior demo defects all lived in flow/coupling cracks). Real-I/O (only the LLM clientFactory may be stubbed). Use MEMORY_DEBUG + the harness to verify the turn-2 recall deterministically. No new ADR expected (within ADR-0012 + amendment + 5a/5e); if the `injectedMemory` semantics change warrants a spec note, FLAG it (don't silently drift). Report DONE-ready / BLOCKED-on-Lior-demo; the conductor re-verifies (runs the harness both modes) + routes the §6.1 re-demo.

## NOTE — memory ROADMAP unchanged (recorded at feature closeout)
v2-08 is the recall-lifecycle + dedup structural fix. Beyond it the roadmap stands: **variant B** (facts → system-prompt; pairs with the 2c/2d memory-architecture work) · **2c** agent memory-action tools · **2d** on-demand archive retrieval (FTS5→embeddings; would also give semantic dedup) · **thread-forget** · **finer message-level provenance** · **archive-summarization tier**. Recorded in `docs/roadmap.md` at closeout.
