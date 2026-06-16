# Chunk v2-06: Memory dev-env (debug-log + demo-flow harness) + the 3 demo defects

**Status:** in-progress
**Created:** 2026-06-14
**Phase:** memory-distiller-v2 (spec `docs/specs/2026-06-13-memory-distiller-v2.md`; ADR-0012 Amendment 2026-06-13 STABILITY)
**Depends on / BRANCH OFF:** **`chunk/v2-05-migration-flip-and-demo`** (NOT main — it carries the
default flip dumb-tail→smart + the migration; this chunk stacks the fixes + dev-env on top so the
re-demo runs with smart as default). On this chunk's demo-green, the conductor merges v2-06 to main
(which brings v2-05's flip+migration along) and closes PR #67 as subsumed.
**Estimated size:** ~1–1.5 day. **Why:** Lior's 2026-06-13 live demo (v2-05) found 3 real defects that
every green test + executed probe + reviewer missed (the probes were isolated-op + used a unique-
provenance fact; the bugs live in the FLOW + the real thread-shared-provenance shape). Build the dev-env
that would have caught them, then fix them.

## Part 1 — the dev-env (build FIRST; it's the diagnosis enabler)
- **D1. `MEMORY_DEBUG` debug logging** (env-gated, OFF by default; committed, NOT a prod default).
  When `MEMORY_DEBUG=1`, log the memory pipeline at each step: (a) **distill** input (the thread tail
  read) + the returned **delta ops** (op:new/append/replace + targetOrdinal + why); (b) **retrieve /
  injection** at a NEW thread's start (which facts were injected, in order); (c) **forget** (the target
  + the rows actually deleted, with their ids/provenance). Structured, greppable, no secrets/key. This
  is the reusable tool for THIS + future memory bugs.
- **D2. Headless demo-flow harness** (`scripts/memory-demo-harness.ts`, a real-I/O EXECUTED harness like
  the probes — NOT in the main `bun test` suite; the conductor runs it on re-verify). It drives the
  REAL daemon via the SAME interfaces the overlay uses (WS add-turn + dismiss; HTTP forget + fact
  query), replaying the **full demo SEQUENCE** and ASSERTING:
  - seed 3 facts (name/colour/work) → dismiss → all 3 distilled (Ukrainian preserved);
  - new thread → recall each fact (esp. **work** — the demo's failing case) → present + provenance;
  - **stability:** several more dismisses → the seeded facts are **byte-stable** (no rewording,
    reordering, or vanishing) — the headline;
  - change a preference → only THAT fact replaced, others byte-stable;
  - **forget ONE fact** (via the HTTP forget the overlay uses) → **only that one fact is gone**, the
    others remain, the source message byte-intact;
  - recall after forget → the forgotten fact is not recalled.
  Two modes: **stub-LLM** (deterministic — asserts the structural pipeline: forget-targets-one,
  facts-stable, retrieve-injects-the-fact, the race) + **real-LLM** (end-to-end, like the existing
  probes). The harness MUST reproduce the 3 defects below on the CURRENT code before the fixes (RED),
  then pass after (GREEN).

## Part 2 — the 3 demo defects (fix using the dev-env above)
- **C (BLOCKER — forget over-deletes).** Deleting ONE fact via history.html deleted **ALL** facts.
  Root (conductor-confirmed): the demo's facts all share a **thread-level provenance**
  (`thread:<id>`), and `deleteMachineFactsByForget(provenance, norm)` deletes by
  `provenance=? OR normalized_text=?` → the `provenance=` clause matches every fact of that thread →
  all deleted. **Fix: forget targets the SPECIFIC fact by its stable id** (history.html sends the
  fact's id; the delete removes that one row), NOT by the shared provenance. **Test:** several machine
  facts sharing one `thread:<id>` provenance → forget one → exactly one gone, the rest remain, source
  intact. (REFINE per Lior: forget-by-id NOW; finer message-level provenance is DEFERRED — note it.)
- **A (recall inconsistent).** Same "де я працюю?" → "no data" in one thread, correct "IT" in another,
  though the fact exists. **Lior's hypothesis (likely):** distill-on-dismiss is async; a fast
  reopen+ask races the in-flight distillation → the new thread's retrieve reads the PRE-commit (stale)
  fact instance. **Diagnose with the debug-log + harness** (was the fact injected when it failed? →
  race/injection; or injected-but-ignored → LLM). Then fix the CONSISTENCY: a new thread's retrieve
  must see the latest COMMITTED facts. **ROUTE the consistency-model choice UP via the bus** (block
  retrieve until in-flight distillation commits · vs accept eventual-consistency · vs faster/sync
  distill) — genuine design seam.
- **B (fact reworded without a genuine change — stability chink).** "Люблю синій колір" → "Мій
  улюблений колір — синій" across dismisses though the user never restated the colour (possibly the
  agent's RECALL reply got re-distilled, or a non-deterministic REPLACE). **Diagnose with the log**
  (which delta op reworded it). Fix so a fact is NOT reworded absent a genuine new user statement
  (tighten the REPLACE/append decision; do not distill the agent's own recall replies into competing
  facts). Add a harness assertion.

## Done criteria
- [ ] **[mechanical]** debug-log gated-off-by-default; harness reproduces all 3 defects RED→GREEN;
      `bun test` green + the harness (stub-mode) green; typecheck + lint:strict 0; frozen
      (@agentic/protocol + mock-agent.ts) byte-untouched.
- [ ] **[EXECUTED]** the real-LLM harness / probe run green (Strike-5: actually RAN, output in PR).
- [ ] **[behavioral — Lior's LIVE re-demo, §6.1]** the original 9-step demo passes live — especially
      forget-one-only, consistent recall, and STABILITY (no rewording/vanishing). NOT done until green.

## Orchestrator brief
/engine-orchestrator do chunk v2-06 from this file. **Branch off `chunk/v2-05-migration-flip-and-demo`**
(stacked — needs the flip). Build Part 1 (debug-log + harness) FIRST, use it to diagnose Part 2, fix C
(forget-by-id) + A (route the consistency-model up the bus) + B. Real-I/O (only the LLM clientFactory
may be stubbed). Frozen surfaces untouched. Report DONE-ready / BLOCKED-on-Lior-demo to the ledger;
the conductor re-verifies (incl. running the harness) + routes the §6.1 re-demo to Lior.

ADRs in scope: ADR-0012 + its 2026-06-13 amendment (STABILITY); ADR-0015 (forget — decision 5 already
superseded). No new ADR expected (fixes within the accepted model); the consistency-model bus seam, if
it changes the dismiss/retrieve contract materially, may warrant a spec note — flag it.
