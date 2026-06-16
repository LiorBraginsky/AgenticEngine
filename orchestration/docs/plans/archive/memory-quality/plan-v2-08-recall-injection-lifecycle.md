# v2-08: Recall Injection Lifecycle + Dedup Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. All paths repo-relative to `/Users/lior/WebstormProjects/playground/AgenticEngine`.

> **✅ BUS q#013 RESOLVED → refined-B (Jimmy, override of orchestrator's A).** Part 2 = symmetric-normalize base (A's part, kept) **PLUS** a **dedup-LOCAL connector-strip secondary key** (do NOT touch the shared `normalizeFactText`). Rails that neutralize the negation hazard: (1) closed strip set = articles `a/an/the` + copulas `is/are/am/was/were/be/been/being`, word-boundary tokens only; (2) NEVER strip negations `not/no/never/n't` / quantifiers `all/any/some/none/every` / comparatives; (3) **SUPPRESS-ONLY** — the connector key may ONLY no-op a new/demoted insert, NEVER replace/merge/delete/touch an existing row (STABILITY untouched by construction). E-a stays the FIRST line. **If suppress-only can't be cleanly gated in the insertion path → STOP and flag.** Mandated deterministic asserts: `is blue`/`blue` collapses (no-op); `is NOT blue` does NOT collapse (stays 2 facts); suppress-only routing never calls replace/delete; + the chunk's dedup-after-recall assert. No spec edit, no ADR for Part 2 (within §3.2 + STABILITY amendment — it strengthens). The empirical driver for B-over-A: the v2-07 demo ran the tightened E-a and STILL produced `op:new "Мій улюблений колір — синій"` — so the prompt layer is not reliable enough alone; the deterministic backstop is required.

**Goal:** Fix the structural turn-2+ recall loss (variant A: re-inject `[remembered]` facts on every known-thread turn), resolve the `injectedMemory`/provenance-stamp seam so it fires iff ≥1 cross-thread fact was injected this turn (new OR known thread), harden the dedup guard to a normalization-symmetric all-facts compare, and flip the harness STEP 2b + a new dedup-after-recall check to hard asserts.

**Architecture:** Three small daemon-internal changes — `beginTurn` known-thread branch (`thread-lifecycle.ts`), the `injectedMemory` computation (`index.ts`), and the Phase-3 dedup guard (`distiller-registration.ts`) — plus test/harness drivers. No wire/port/dependency change. Build ON the checked-out `chunk/v2-08-recall-injection-lifecycle` branch (HEAD `c294795`).

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (real, never mocked); `@anthropic-ai/sdk` (Haiku — only `clientFactory` stubbed); WS + HTTP over the real `startDaemon`. No new dependency.

---

## Status: Done

(The plan is complete and worker-executable. One design fork — the dedup-symmetry mechanism — is resolved explicitly in Part 2 below, with the chosen option and the rejected alternative stated. ORCHESTRATOR added a bus-flag on the Part-2 aggressiveness; Steps 1 + 3 proceed regardless.)

---

## Reality check

Every claim below is grounded in file evidence read by the architect. **Behavioral/runtime claims are flagged "requires runtime demo to confirm" (PIPELINE §6.1) — never asserted "verified" from code-reading. Prior PASS records and the harness are NECESSARY-not-SUFFICIENT (the route lied 5× / falsified 3× in v0).**

### Part 1 — the A′ root cause (CONFIRMED, code-path)
- `ThreadLifecycle.beginTurn` (`packages/daemon/src/memory/thread-lifecycle.ts:64-107`) has two branches:
  - **Known-thread** (lines 66-69): `const priorMessages = this.store.readThreadTail(requested, TAIL_LIMIT); return { threadId: requested, priorMessages };` — **NO `retrieve()` call, NO `whenIdle` await.** It hydrates only the thread's own tail.
  - **New-thread** (lines 70-106): mints/adopts, optionally `await this.whenIdle()` (lines 83-100, v2-06 FIX-A), then `priorMessages = await this.memoryProvider.retrieve(this.store, newThreadId)` (lines 103-105).
- Each overlay message is a separate `session_start` (CM-01/CM-03). So **turn 2+ of any thread takes the known-thread branch → no cross-thread facts injected → recall lost.** *(The behavioral loss is RED-reproduced by harness STEP 2b under MEMORY_DEBUG; the root cause is confirmed in code. The fix's effectiveness "requires runtime demo to confirm.")*
- The `inject` MEMORY_DEBUG stage (`index.ts:196-208`, commit `c294795`) already logs `priorContext` per turn — the runtime evidence that turn-2 has zero `[remembered]` entries.

### Part 1 — the `injectedMemory` / provenance-stamp seam (THE DESIGN SEAM, CONFIRMED code-path)
- `injectedMemory` is a per-message local in the WS handler (`index.ts:161`), reset to `false` every message (the C/persistent-socket invariant).
- It is set true ONLY at `index.ts:180-183`: `const isNewThread = !wasKnownThread; if (isNewThread && begin.priorMessages.length > 0) injectedMemory = true;`
- The deliberate comment at `index.ts:158-160` states same-thread hydration is "the user's own prior turns," NOT cross-thread memory, so the flag stays false on known-thread turns.
- It feeds `send(ws, out, boundPort, injectedMemory)` (`index.ts:238`) → `stampProvenance(msg, port)` (`index.ts:43`), which appends the `/history.html` provenance line to `show_text`.
- **With fix A, a known-thread turn now ALSO injects cross-thread facts.** So `injectedMemory` must become true on a known-thread turn that injected ≥1 fact, and stay false on a known-thread turn that injected only tail (memory empty). The current `isNewThread`-gated computation is no longer correct. **This is the seam the chunk requires resolved.**
- The discriminator is unambiguous and already present in the codebase: injected facts are exactly the messages of the shape `{role:"user", content: REMEMBERED_LABEL + fact}` where `REMEMBERED_LABEL = "[remembered] "` (`packages/daemon/src/providers/system-prompt.ts:60`; emitted by both providers' `retrieve` — `smart-distiller-provider.ts:645`, `dumb-tail-provider.ts:108-110`). The thread tail (`readThreadTail`) contains NO `[remembered] `-prefixed messages (it returns the thread's own stored content; injected facts are never persisted — confirmed below).

### Part 1 — endTurn delta-slice is SAFE under fix A (CONFIRMED code-path)
- `endTurn` (`thread-lifecycle.ts:129-145`) flushes `finalMessages.slice(hydratedCount)`; `hydratedCount = begin.priorMessages.length` (`index.ts:175`).
- Today (known-thread): `priorMessages = tail`, `hydratedCount = tail.length`. After fix A: `priorMessages = [...facts, ...tail]`, `hydratedCount = facts.length + tail.length`. The provider re-attaches the full hydrated prefix; `slice(hydratedCount)` still excludes BOTH facts and tail → **injected facts are NOT re-persisted.** This matches the existing new-thread guard test `injected cross-thread slice is NOT re-persisted into the new thread (delta-flush guard)` (`thread-lifecycle.test.ts:105-123`). *(Double-persist absence is deterministically testable — Step 1.)*

### Part 1 — whenIdle stays NEW-THREAD-ONLY (chunk-mandated; confirmed feasible)
- The chunk requires NOT awaiting `whenIdle` on known-thread turns (facts already committed; per-turn await re-introduces latency + a per-turn block). The known-thread branch must call `retrieve()` WITHOUT the `whenIdle` Promise.race wrapper. The new-thread branch keeps its `whenIdle` block (lines 83-100) verbatim.

### Part 2 — the dedup guard reality (CONFIRMED code-path; the chunk's framing needs a correction)
- The v2-07 E-b guard lives in `distiller-registration.ts` Phase-3, in BOTH the append-fallback branch (lines 253-268) and the new/demoted branch (lines 275-290). It already does: `store.rawDb().query("SELECT 1 FROM fact_fts WHERE canonical = ? LIMIT 1").get(newItemCanonical)`.
- **Correction to the chunk's "only the BM25 candidate set" framing:** the v2-07 guard ALREADY queries the FULL `fact_fts` table directly (not the BM25/`fetchCandidates` top-K) — so the "compare against ALL facts, not just BM25 candidates" requirement is **already satisfied by the existing query shape.** The real residual gap is the chunk's item **(b)**: the comparison is a brittle **exact-string** match against the STORED canonical, and `fact_fts.canonical` is written **verbatim from the LLM's `op.canonical`** — it is NOT normalized at insert time (`store.ts:1098-1100` `writeFactDerived` runs `INSERT INTO fact_fts (fact_id, canonical, topic)` with the raw canonical; only the human-fact reindex paths at `store.ts:917` and `rebuildDerivedForHumanFacts` apply `normalizeFactText`). So `"favorite color is blue"` (stored) ≠ `"favorite color blue"` (new op.canonical) → the guard misses → duplicate inserted. **This is the demo's duplicate-colour root.** *(The miss is deterministically reproducible with a real store + two ops whose canonicals differ only by a stopword/punctuation — Step 3.)*
- `normalizeFactText` (`packages/daemon/src/memory/normalize-fact-text.ts:22-40`): NFKC → lowercase → strip `[remembered] ` → collapse whitespace → strip trailing `.!?;,` → strip surrounding quotes. It does NOT strip interior stopwords (e.g. "is"), so `"favorite color is blue"` and `"favorite color blue"` still differ after normalization. **This is load-bearing for the chosen Part-2 option below — and is the subject of the ORCHESTRATOR bus-flag at the top.**
- `CANDIDATE_TOP_K` / `fetchCandidates` (`store.ts:956-972`) is the BM25 path used by the SMART distiller to pick contradiction candidates; it is NOT used by the dedup guard. Untouched by this chunk.

### Part 3 — harness STEP 2b is currently a SOFT log (CONFIRMED code-path)
- `packages/daemon/scripts/memory-demo-harness.ts:513-539`: STEP 2b runs turn-1 + turn-2 on one thread (`threadMT`), computes `t1HadMemory`/`t2HadMemory` via `memPresent()` (matches `"[remembered]"` or `"Recall:"`), and only `console.log`s RED/GREEN/INCONCLUSIVE — **no `process.exit(1)`.** The chunk requires flipping this to a HARD assert.
- The chat-stub (`memory-demo-harness.ts:111-118`) builds its reply from `state.messages` filtered by `m.content.startsWith("[remembered]")` — so once fix A injects facts on turn 2, the stub's turn-2 reply will contain `[remembered]`/`Recall:` and `t2HadMemory` becomes true. *(Stub determinism confirmed; turn-2 GREEN after Part 1 "requires the harness run to confirm.")*
- There is NO existing dedup-after-recall assert (recall a colour question → dismiss → assert no new/duplicate colour fact). The existing E assert (lines 847-915) covers question→no-dup for a NAME fact in a question-only thread, not the recall-reply path. Part 3 adds the colour-recall-then-dismiss assert.

### Frozen-surface check (FLAG-cleared)
- `@agentic/protocol` and `packages/daemon/src/mock-agent.ts` are the ONLY byte-frozen surfaces (CLAUDE.md). NONE are touched: all edits are daemon-internal — `thread-lifecycle.ts` (`priorMessages` composition), `index.ts` (a local-variable computation), `distiller-registration.ts` (the apply-loop guard), and tests/harness. Injection is `priorMessages` → `priorState.messages` (`index.ts:188-190`), never the wire. The `[remembered]` message format, system-prompt semantics, chat-stub, and `stampProvenance` are unchanged. Plan asserts `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty at every step DoD.

### Behavioral DoD
- The 9-step live re-demo (multiple questions per thread: name/colour/work recalled on follow-up turns, NO duplicate facts, C/B/D/stability stay GREEN) is **behavioral — requires Lior's live demo to confirm; NOT verifiable by code-reading, tests, prior PASS records, or even the harness.** The conductor re-verifies (runs the harness both modes) + routes the §6.1 re-demo.

---

## File Structure (what each touched file is responsible for)

- `packages/daemon/src/memory/thread-lifecycle.ts` — Part 1: known-thread branch ALSO `retrieve()`s facts and returns `[...facts, ...tail]`; new-thread branch + `whenIdle` unchanged.
- `packages/daemon/src/index.ts` — Part 1 seam: compute `injectedMemory` from "≥1 injected `[remembered]` message in this turn's `priorMessages`", for BOTH branches; update the deliberate comment.
- `packages/daemon/src/memory/distiller-registration.ts` — Part 2: replace the two exact-canonical dedup `SELECT 1 FROM fact_fts WHERE canonical = ?` lookups with a normalization-symmetric all-facts existence check.
- `packages/daemon/src/memory/store.ts` — Part 2: add a `factExistsByNormalizedCanonical(normalized: string): boolean` read helper (the symmetric lookup substrate).
- `packages/daemon/src/memory/thread-lifecycle.test.ts` — Part 1 RED→GREEN: known-thread turn injects facts + does NOT re-persist them; whenIdle NOT awaited on known-thread.
- `packages/daemon/src/memory/provenance-stamp.daemon.test.ts` — Part 1 seam: rewrite scenarios B/C/D turn-2 to the new (correct) rule + add a no-facts known-thread case.
- `packages/daemon/src/memory/store.test.ts` — Part 2 RED→GREEN: `factExistsByNormalizedCanonical` matches across canonical wording variants.
- `packages/daemon/src/memory/distiller-integration.daemon.test.ts` — Part 2 RED→GREEN: a `new` op whose canonical differs only by a stopword from an existing fact is a no-op.
- `packages/daemon/scripts/memory-demo-harness.ts` — Part 3: STEP 2b hard-assert; new dedup-after-recall assert; banner re-labeled v2-08; keep the `inject` MEMORY_DEBUG stage.

---

## THE DESIGN SEAM — `injectedMemory` resolution (concrete, unambiguous)

**Rule (the new, correct semantics):** `injectedMemory` is true for THIS turn **iff this turn's `priorMessages` contains ≥1 cross-thread `[remembered]` fact** — regardless of new vs known thread. It is false when `priorMessages` contains only the thread's own tail (no facts) or is empty.

**Exact mechanism (where + how):**
- **Discriminator:** a message is an injected cross-thread fact iff `m.role === "user" && m.content.startsWith(REMEMBERED_LABEL)` where `REMEMBERED_LABEL = "[remembered] "`. Both providers' `retrieve()` emit exactly this shape; `readThreadTail` never produces it (the tail is the thread's own stored content, and the injected facts are never persisted — see Reality check / endTurn). So the prefix test is a sound, false-positive-free discriminator.
- **Where computed:** in `index.ts`, in the `session_start` branch, AFTER `const begin = await lifecycle.beginTurn(inbound)` (replacing the `isNewThread`-gated block at `index.ts:176-183`):
  ```ts
  // v2-08 seam: injectedMemory fires iff THIS turn injected ≥1 cross-thread
  // [remembered] fact — for BOTH the new-thread branch (retrieve) AND the
  // known-thread branch (which, post-v2-08, prepends facts before the tail).
  // The thread's own hydrated tail is NOT a [remembered] fact, so a known-thread
  // turn with empty memory stays false. import REMEMBERED_LABEL from system-prompt.
  injectedMemory = begin.priorMessages.some(
    (m) => m.role === "user" && m.content.startsWith(REMEMBERED_LABEL),
  );
  ```
- **Add the import:** `import { REMEMBERED_LABEL } from "./providers/system-prompt.js";` at the top of `index.ts` (system-prompt.ts is a leaf data module, no cycle — already imported by providers/).
- **Delete:** the now-stale `wasKnownThread` capture (`index.ts:168`) and `isNewThread` local (`index.ts:180`) become unused for the flag. KEEP `wasKnownThread`/`isNewThread` ONLY if some other consumer needs them — grep confirms the sole consumer is the `injectedMemory` block, so REMOVE both to avoid a dead-variable lint failure. (Verify with `bun run lint:strict`.)
- **Update the comment** at `index.ts:158-160` to the new rule, removing the "same-thread tail = user's own prior turns, never stamped" assertion (that assertion is now FALSE for a known-thread turn that injected facts).

**Why the prefix-test over alternatives:** the daemon does not need `beginTurn` to return a separate `injectedFactCount` — the discriminator is already carried in the message content, and a content-based test needs no signature change to `beginTurn` (frozen-safe, smaller diff). The architect considered returning a structured `{ priorMessages, injectedFactCount }` from `beginTurn` (cleaner typing) but rejected it: it widens an internal method signature for zero behavioral gain, and every consumer would still derive the same boolean. The content prefix is the single source of truth that the provenance-stamp's own meaning ("this reply drew on remembered facts") rests on.

**Provenance-stamp test changes (lock the new rule):** the test seeds a cross-thread fact and starts new/known-thread turns. Under the new rule:
- **Scenario A (new thread, fact seeded):** still stamped (`/history.html` present) — UNCHANGED.
- **Scenario B (same-thread turn against `sourceThreadId`, fact seeded):** turn-2 previously asserted NOT stamped. **Now: the known-thread branch retrieves the seeded fact → stamped.** Flip the assertion to `expect(content).toContain("/history.html")`. (This is the test that locks the corrected rule — it was asserting the OLD bug as desired behavior.)
- **Scenario C (persistent socket, turn 2 same-thread):** turn 1 new-thread stamped (unchanged); turn 2 same-thread — with a seeded fact present, **now stamped**. Flip turn-2 to `toContain`. The per-message-reset invariant the test exists to prove is preserved by ADDING a NEW sub-case: a known-thread turn against a thread with NO retrievable facts must NOT stamp (see new Scenario E).
- **Scenario D (CM-01 adopted-id, turn 2 same known thread):** same as B/C — turn 2 now stamped (seeded fact retrieved). Flip turn-2 to `toContain`.
- **NEW Scenario E (known-thread turn, memory EMPTY → NOT stamped):** create a thread, append a turn, then start a known-thread turn against it on a store with NO distilled facts → `retrieve()` returns [] → `priorMessages` = tail only → `injectedMemory` false → `show_text` does NOT contain `/history.html`. This is the case that proves "tail-only hydration is not stamped," which scenarios B/C/D used to (incorrectly) cover. Seed this in a separate thread/dataDir or clear facts so the assertion is deterministic.

---

## Steps (ordered; each independently executable; RED→GREEN where deterministic)

### Step 1 — Part 1: known-thread retrieve (fix A) + the `injectedMemory` seam

> Land the structural fix and its runtime-coupling seam together (they are one behavioral change: a known-thread turn now injects facts AND must stamp). RED→GREEN via the lifecycle test + the provenance-stamp test.

**Files:**
- Modify: `packages/daemon/src/memory/thread-lifecycle.ts` (known-thread branch)
- Modify: `packages/daemon/src/index.ts` (the `injectedMemory` seam + import)
- Test: `packages/daemon/src/memory/thread-lifecycle.test.ts`
- Test: `packages/daemon/src/memory/provenance-stamp.daemon.test.ts`

- [ ] **1.1 (RED) Add a lifecycle test: known-thread turn injects facts before the tail + does NOT re-persist them.**
  Add to `thread-lifecycle.test.ts` (use the `freshTL()` helper — it wires `dumbTailProvider`):
  ```ts
  test("v2-08: a KNOWN-thread turn ALSO injects the cross-thread distilled slice BEFORE the tail", async () => {
    const { store, lifecycle } = freshTL();
    const hook = new ConsolidationHook(store);
    registerDistiller(hook, store, dumbTailProvider, new RuleBasedScanner());
    // Thread A: state + distill a fact (prior dismiss).
    const tA = store.createThread();
    store.appendMessages(tA, [{ role: "user", content: "deploy is yeet.sh" }], "sa");
    await hook.dismiss([tA]);
    // Thread B: turn 1 (new) — flush a turn so B becomes a KNOWN thread.
    const b1 = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
    lifecycle.bindSession("sb1", b1.threadId, b1.priorMessages.length);
    lifecycle.endTurn(b1.threadId, "sb1", [...b1.priorMessages, { role: "user", content: "hi" }]);
    // Thread B turn 2: KNOWN thread → must inject A's fact BEFORE B's own tail.
    const b2 = await lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "and now?", thread_id: b1.threadId });
    expect(b2.threadId).toBe(b1.threadId);
    expect(b2.priorMessages[0]).toEqual({ role: "user", content: "[remembered] deploy is yeet.sh" });
    expect(b2.priorMessages).toContainEqual({ role: "user", content: "hi" }); // the tail follows
    // The injected fact must NOT be re-persisted on this turn (delta-flush guard).
    lifecycle.bindSession("sb2", b2.threadId, b2.priorMessages.length);
    lifecycle.endTurn(b2.threadId, "sb2", [...b2.priorMessages, { role: "user", content: "and now?" }]);
    const persisted = store.readThreadTail(b1.threadId, 50).map((m) => m.content);
    expect(persisted).toEqual(["hi", "and now?"]); // no [remembered] row persisted
  });
  ```
  Run: `bun test packages/daemon/src/memory/thread-lifecycle.test.ts` → FAIL (known-thread branch returns tail only).

- [ ] **1.2 (GREEN) Edit the known-thread branch in `thread-lifecycle.ts:66-69`.**
  Replace:
  ```ts
  if (requested && this.store.threadExists(requested)) {
    const priorMessages = this.store.readThreadTail(requested, TAIL_LIMIT);
    return { threadId: requested, priorMessages };
  }
  ```
  with:
  ```ts
  if (requested && this.store.threadExists(requested)) {
    // v2-08 fix A: a known-thread turn ALSO re-injects the cross-thread distilled
    // slice (the [remembered] facts) BEFORE the thread's own tail, so a follow-up
    // turn (turn 2+) keeps cross-thread memory. New-thread branch is unchanged.
    // whenIdle is NEW-THREAD-ONLY: the facts are already committed on a known-thread
    // turn, and awaiting per turn would re-add latency + a per-turn block (the
    // new-thread read-after-write race the whenIdle wait closes does NOT apply here).
    const facts = this.memoryProvider
      ? await this.memoryProvider.retrieve(this.store, requested)
      : [];
    const tail = this.store.readThreadTail(requested, TAIL_LIMIT);
    return { threadId: requested, priorMessages: [...facts, ...tail] };
  }
  ```
  Update the class doc-comment (`thread-lifecycle.ts:41-44`) to note: "v2-08: the known-thread branch ALSO retrieves the cross-thread slice (prepended before the tail); whenIdle stays new-thread-only."
  Run: `bun test packages/daemon/src/memory/thread-lifecycle.test.ts` → PASS (the v2-07 whenIdle-timeout test + the existing new-thread tests still pass).

- [ ] **1.3 (RED) Rewrite the provenance-stamp test to the new (correct) rule.**
  In `packages/daemon/src/memory/provenance-stamp.daemon.test.ts`:
  - Scenario **B** (`T2.3a-B`, lines 179-185): change `expect(content).not.toContain("/history.html")` → `expect(content).toContain("/history.html")`; update the test name + the comment block (lines 174-177) to: "same-thread turn now ALSO injects the cross-thread slice (v2-08 fix A) → stamped."
  - Scenario **C** (`T2.3a-C`, lines 244-273): change the turn-2 assertion (line 269) `not.toContain` → `toContain`; update the name + comment (lines 187-196) to: "turn 2 (same thread) now injects the seeded fact → stamped. The per-message reset invariant is proven by NEW Scenario E (a known-thread turn with NO retrievable facts is NOT stamped)."
  - Scenario **D** (`T2.3a-D`, lines 289-305): change the turn-2 assertion (line 304) `not.toContain` → `toContain`; update name + comment (lines 275-287).
  - **Add NEW Scenario E** — a known-thread turn against a store with NO distilled facts → NOT stamped. Because the shared `beforeAll` seeds a fact into the shared store, Scenario E needs an isolated daemon/dataDir. Implement E as a self-contained test that boots its OWN daemon on a fresh dataDir (no seeded facts), creates+flushes a thread (so it is known), then runs a known-thread turn and asserts NO `/history.html`:
    ```ts
    test("T2.3a-E: known-thread turn with EMPTY memory → NOT stamped (tail-only hydration is not [remembered] memory)", async () => {
      const dir2 = mkdtempSync(join(tmpdir(), "mf05-t23a-e-"));
      const prev = process.env.AGENTIC_DATA_DIR;
      process.env.AGENTIC_DATA_DIR = dir2;
      const { createAnthropicApiProvider } = await import("../providers/anthropic-api-provider.js");
      const fake = createAnthropicApiProvider({ apiKey: "sk-ant-fake", client: makeFakeClient("Reply E.") as never });
      const { startDaemon } = await import("../index.js");
      const srv = startDaemon(0, fake);
      const p = srv.port!;
      const tok = new TokenStore(dir2).token();
      try {
        const tid = crypto.randomUUID();
        // turn 1 (new) — no seeded facts → not stamped; makes tid a KNOWN thread.
        await runTurnOn(p, tok, "first", tid);
        // turn 2 (known thread, still no facts) → tail-only → NOT stamped.
        const envs = await runTurnOn(p, tok, "second", tid);
        const content = findShowTextContent(envs);
        expect(content).toBeDefined();
        expect(content).not.toContain("/history.html");
      } finally {
        srv.stop(true);
        process.env.AGENTIC_DATA_DIR = prev;
      }
    });
    ```
    Add a small `runTurnOn(port, token, text, threadId)` helper (mirror `runTurn` but parameterized by port/token), or inline a port/token-parameterized copy. (The existing `runTurn` closes over the shared `PORT`/`token`; E needs its own.)
  Run: `bun test packages/daemon/src/memory/provenance-stamp.daemon.test.ts` → B/C/D FAIL on current code (they still assert the old no-stamp), E may already pass or fail depending on order — confirm B/C/D RED.

- [ ] **1.4 (GREEN) Implement the `injectedMemory` seam in `index.ts`.**
  - Add the import: `import { REMEMBERED_LABEL } from "./providers/system-prompt.js";`
  - Replace the block at `index.ts:176-183` (the `isNewThread`-gated set) with the content-discriminator computation shown in **THE DESIGN SEAM** section above.
  - Remove the now-unused `wasKnownThread` capture (`index.ts:168`) and `isNewThread` local (`index.ts:180`) — confirm via lint they have no other consumer.
  - Update the comment at `index.ts:158-160` to the new rule (delete the "same-thread tail = never stamped" claim).
  Run: `bun test packages/daemon/src/memory/provenance-stamp.daemon.test.ts` → PASS (A/B/C/D/E all green). Run `bun run typecheck && bun run lint:strict` → exit 0 (catches the dead-variable case).

- [ ] **1.5 (GREEN) Run the full memory suite + commit.**
  Run: `bun test packages/daemon/src/memory && bun run typecheck && bun run lint:strict` → exit 0. Confirm `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty.
  Commit: `fix(memory): v2-08 A′ — known-thread turn re-injects [remembered] facts; injectedMemory fires iff ≥1 cross-thread fact injected (new OR known thread)` + the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

**DoD (command-evidence):** `bun test packages/daemon/src/memory/thread-lifecycle.test.ts packages/daemon/src/memory/provenance-stamp.daemon.test.ts` PASS; the new known-thread-injection + non-re-persist tests GREEN; provenance-stamp B/C/D flipped + E added; `lint:strict`/`typecheck` exit 0; frozen `git diff` empty.

---

### Step 2 — Part 2: harden the dedup guard — symmetric-normalize base + dedup-local connector-strip key (refined-B, bus q#013)

> The deterministic backstop layer (E-a prompt stays the FIRST line; this is belt-and-suspenders because the v2-07 demo proved E-a leaks `op:new "Мій улюблений колір — синій"` on the real LLM). Two layers, BOTH dedup-local (do NOT touch the shared `normalizeFactText`):
> 1. **Symmetric-normalize base** — the v2-07 guard already queries the FULL `fact_fts` corpus, but compares the new op's canonical to the STORED canonical by exact string, and stored canonicals are un-normalized LLM text (`writeFactDerived` stores `op.canonical` verbatim). Normalize BOTH sides → case/whitespace/punctuation/quote/`[remembered]`-prefix variants collapse.
> 2. **Connector-strip secondary key** — apply `normalizeFactText` then remove a CLOSED set of function words at word boundaries so connector-only variants collapse (the demo-cited `"favorite color is blue"` / `"favorite color blue"`).

**Mechanism (refined-B, exactly as bus q#013 mandates):**
- New dedup-local pure function `dedupConnectorKey(text)` in `normalize-fact-text.ts` (a NEW export — do NOT modify `normalizeFactText`; forget/reindex blast radius stays zero). It runs `normalizeFactText` first, then drops a **closed** token set at word boundaries: articles `a/an/the` + copulas `is/are/am/was/were/be/been/being`. **NEVER in the set (hazard guard — comment it):** negations `not/no/never/n't`, quantifiers `all/any/some/none/every`, comparatives/contrastives — so `"favorite color is not blue"` → strip `is` → `"favorite color not blue"` ≠ `"favorite color blue"`; the contradicting fact stays a separate row. The closed allow-list makes the hazard structurally impossible.
- A store read helper that scans the (bounded, dogfood-scale) fact corpus once and returns true iff ANY existing fact matches the new op on the **normalized key** (base) OR the **connector key** (secondary). The connector key subsumes the base (normalize-then-strip applied to base-equal strings stays equal); both clauses are kept explicit for legibility + independent testing.
- **SUPPRESS-ONLY (the load-bearing bound):** these checks are wired ONLY into the existing new/demoted + append-fallback branches of the Phase-3 apply loop — the branches that today already do `if (dedupHit) { log + skip insert }`. They may ONLY no-op a new insert; they NEVER call replace/merge/delete or touch an existing row. STABILITY (existing facts unchanged) is untouched by construction. **The worker MUST confirm the connector key is applied in NO other branch (never replace/normal-append). If suppress-only cannot be cleanly gated in the insertion path → STOP and flag (bus q#013 condition).**

**Why refined-B over the orchestrator's conservative A (Jimmy, bus q#013):** (1) the demo failed on exactly the connector variant and the PRIMARY prompt defense (E-a) already failed on the real LLM in v2-07 — "trust the prompt" is empirically unreliable here; (2) Lior's §6.1 demo is the scarce resource and two cycles were already burned on this dup; (3) B strictly dominates A — if E-a holds, no fact is derived (both pass); if E-a leaks a connector-variant, A misses and B catches deterministically; B never does worse. The negation hazard the orchestrator raised is real but neutralized by the closed set + suppress-only (worst case = one skipped redundant insert; the lossless archive still holds the source). On spec-drift: a closed function-word filter on a still-lexical exact key is normalization, not semantic matching (it won't collapse "I love blue" vs "blue is my favorite") — genuine reworded/semantic dedup stays assigned to 2d embeddings, so spec §3.2's seam holds.
- ☆ Alternative (rejected, recorded): a normalized-canonical **column** + index + backfill. Cons: a schema ALTER on the live sqlite (spec §9 forbids it on the per-dismiss path; needs a migration) + a backfill + scope widening. Dogfood scale does not justify it; documented upgrade if fact volume ever grows.

**Files:**
- Modify: `packages/daemon/src/memory/normalize-fact-text.ts` (add `dedupConnectorKey` — new export, leave `normalizeFactText` byte-identical)
- Modify: `packages/daemon/src/memory/store.ts` (add the dedup-key existence helper)
- Modify: `packages/daemon/src/memory/distiller-registration.ts` (both suppress-only dedup lookups)
- Test: `packages/daemon/src/memory/normalize-fact-text.test.ts` (connector-key: collapses connectors, NEVER collapses negations/quantifiers)
- Test: `packages/daemon/src/memory/store.test.ts` (existence helper: base + connector layers)
- Test: `packages/daemon/src/memory/distiller-integration.daemon.test.ts` (the cited demo case + the hazard case + suppress-only routing)

- [ ] **2.1 (RED) Add a `dedupConnectorKey` unit test (the hazard guard is the headline assert).**
  In `normalize-fact-text.test.ts`:
  ```ts
  test("v2-08 refined-B: dedupConnectorKey collapses closed connectors but NEVER negations/quantifiers", () => {
    // connectors collapse (the demo-cited case):
    expect(dedupConnectorKey("favorite color is blue")).toBe(dedupConnectorKey("favorite color blue"));
    expect(dedupConnectorKey("the user likes blue")).toBe(dedupConnectorKey("user likes blue"));
    // HAZARD GUARD — negation MUST NOT collapse into its opposite:
    expect(dedupConnectorKey("favorite color is not blue")).not.toBe(dedupConnectorKey("favorite color is blue"));
    expect(dedupConnectorKey("favorite color is not blue")).not.toBe(dedupConnectorKey("favorite color blue"));
    // quantifier MUST NOT be stripped:
    expect(dedupConnectorKey("some users like blue")).not.toBe(dedupConnectorKey("users like blue"));
    // word-boundary only — "this"/"theory" must not lose "the" as a substring:
    expect(dedupConnectorKey("theory of colour")).toBe("theory of colour");
  });
  ```
  Run: `bun test packages/daemon/src/memory/normalize-fact-text.test.ts` → FAIL (function does not exist).

- [ ] **2.2 (GREEN) Add `dedupConnectorKey` to `normalize-fact-text.ts` (new export; leave `normalizeFactText` byte-identical).**
  ```ts
  // v2-08 refined-B (bus q#013): a DEDUP-LOCAL secondary key. Runs normalizeFactText
  // first, then drops a CLOSED set of function words at WORD boundaries so connector-only
  // variants ("favorite color is blue" / "favorite color blue") collapse for dedup.
  // HAZARD GUARD — the set NEVER contains negations (not/no/never/n't), quantifiers
  // (all/any/some/none/every), or comparatives: keeping them means a CONTRADICTING fact
  // ("...is NOT blue") never collapses into its opposite. NOT the shared normalizer —
  // used ONLY by the suppress-only dedup guard, so forget/reindex are unaffected.
  const DEDUP_CONNECTOR_WORDS = new Set([
    "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "being",
  ]);
  export function dedupConnectorKey(text: string): string {
    const norm = normalizeFactText(text); // lowercases + collapses whitespace already
    if (norm === "") return "";
    return norm
      .split(" ")
      .filter((w) => w !== "" && !DEDUP_CONNECTOR_WORDS.has(w))
      .join(" ");
  }
  ```
  (Splitting normalized text on " " is safe — `normalizeFactText` already collapsed runs of whitespace to single spaces, so each token is a whole word → word-boundary, never substring.) Run: `bun test packages/daemon/src/memory/normalize-fact-text.test.ts` → PASS.

- [ ] **2.3 (RED) Add a store existence-helper test (base + connector layers).**
  In `store.test.ts`, seed a fact whose canonical is stored RAW (verbatim LLM casing/punct), and assert the helper matches across BOTH layers and a genuinely-different fact does not:
  ```ts
  test("v2-08 refined-B: factExistsByDedupKey matches case/whitespace/punct (base) AND connector variants, never different facts", () => {
    const store = freshStore();
    store.insertFact(
      { fact: "Favorite color blue.", canonical: "Favorite Color Blue.", topics: [], provenance: "thread:x", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
      "test",
    );
    expect(store.factExistsByDedupKey("  favorite color blue  ")).toBe(true);   // base: case/ws/punct
    expect(store.factExistsByDedupKey("favorite color is blue")).toBe(true);    // connector: the cited case
    expect(store.factExistsByDedupKey("favorite color is not blue")).toBe(false); // hazard: stays separate
    expect(store.factExistsByDedupKey("favorite color red")).toBe(false);       // genuinely different
    store.close();
  });
  ```
  (Import `normalizeFactText`/`dedupConnectorKey` from `./normalize-fact-text.js`; use the file's existing fresh-store helper.) Run: `bun test packages/daemon/src/memory/store.test.ts` → FAIL (method does not exist).

- [ ] **2.4 (GREEN) Add `factExistsByDedupKey` to `store.ts`.**
  Add near the other fact reads (after `readDistilledFactsForThread`, ~line 478). One scan; matches on the normalized key (base) OR the connector key (secondary):
  ```ts
  /**
   * v2-08 refined-B dedup (bus q#013): true iff ANY existing fact matches `text` on
   * EITHER the normalized key (symmetric base — fact_fts.canonical is stored VERBATIM
   * by writeFactDerived, so we normalizeFactText the STORED side too) OR the connector
   * key (closed function-word strip; collapses "is blue"/"blue", never negations). The
   * connector clause subsumes the base; both kept explicit for legibility. Scans the
   * bounded fact corpus (dogfood scale). READ-ONLY: callers use it to SUPPRESS a new
   * insert only — it never mutates a row (STABILITY untouched by construction).
   */
  factExistsByDedupKey(text: string): boolean {
    const norm = normalizeFactText(text);
    if (norm === "") return false;
    const conn = dedupConnectorKey(text);
    const rows = this.db
      .query(
        `SELECT COALESCE(f.canonical, d.fact) AS key
           FROM distilled_facts d
           LEFT JOIN fact_fts f ON f.fact_id = d.id`,
      )
      .all() as { key: string }[];
    return rows.some((r) => normalizeFactText(r.key) === norm || dedupConnectorKey(r.key) === conn);
  }
  ```
  Import `dedupConnectorKey` alongside the existing `normalizeFactText` import in `store.ts`. Run: `bun test packages/daemon/src/memory/store.test.ts` → PASS.

- [ ] **2.5 (RED) Add the integration asserts: the cited demo case + the hazard + suppress-only routing.**
  In `distiller-integration.daemon.test.ts` (reuse the scripted-clientFactory pattern):
  - **(cited case)** seed one fact via a first dismiss whose op stores canonical RAW (e.g. `"favorite color blue"`); then a second thread + dismiss whose scripted delta emits a `new` op with the connector variant canonical `"favorite color is blue"`. Assert AFTER: count still 1 (no duplicate) + `COUNT(fact_fts) == COUNT(distilled_facts)`.
  - **(hazard)** repeat with the second op `"favorite color is not blue"` → assert count becomes 2 (the contradicting fact is NOT suppressed) + count-equality holds.
  - **(suppress-only routing)** assert the connector match took the no-op path, NOT a replace/delete: after the cited-case dismiss, the ORIGINAL fact row id is unchanged and its `fact`/`canonical` text is byte-identical (a replace/merge would have rewritten it). This proves the connector key only suppressed the insert and never touched the existing row.
  Run: `bun test packages/daemon/src/memory/distiller-integration.daemon.test.ts` → the cited-case + suppress-only asserts FAIL on current code (v2-07 exact-match inserts the connector variant as a 2nd row).

- [ ] **2.6 (GREEN) Wire both suppress-only dedup lookups in `distiller-registration.ts` + confirm the bound.**
  In the append-fallback branch (`distiller-registration.ts:253-256`) and the new/demoted branch (`distiller-registration.ts:275-277`) ONLY, replace:
  ```ts
  const dedupRow = store.rawDb()
    .query("SELECT 1 FROM fact_fts WHERE canonical = ? LIMIT 1")
    .get(newItemCanonical);
  if (dedupRow) { … }
  ```
  with (in both places):
  ```ts
  // v2-08 refined-B dedup (bus q#013): SUPPRESS-ONLY existence check over ALL facts —
  // symmetric normalize (stored canonical is verbatim) + closed connector-strip key.
  // Only no-ops a NEW/demoted insert here; never reaches replace/normal-append, so it
  // never mutates an existing row (STABILITY untouched by construction). E-a (prompt)
  // is the first line; this is the deterministic backstop for when E-a leaks.
  const dedupHit = store.factExistsByDedupKey(newItemCanonical);
  if (dedupHit) { …memDebug + skip insert… }
  ```
  Keep the existing `memDebug(...)` skip log in both branches. **CONFIRM the suppress-only bound:** grep `distiller-registration.ts` — the replace branch and the normal-append branch must NOT call `factExistsByDedupKey`; the only two call sites are the two suppress branches above. If the insertion path cannot be cleanly gated to suppress-only (e.g. a shared site also handles replace), **STOP and report a BLOCKED flag** per bus q#013 — do NOT proceed. Otherwise update both branch doc-comments to the refined-B semantics.
  Run: `bun test packages/daemon/src/memory/distiller-integration.daemon.test.ts` → PASS. Confirm the existing v2-07 dedup test + idempotence tests still pass.

- [ ] **2.7 (GREEN) Run the suite + commit.**
  Run: `bun test packages/daemon/src/memory && bun run typecheck && bun run lint:strict` → exit 0. Frozen `git diff` empty.
  Commit: `fix(memory): v2-08 E refined-B — suppress-only dedup over full corpus (symmetric normalize + closed connector-strip key); collapse "is blue"/"blue", never negations` + trailer.

**DoD (command-evidence):** `bun test …/normalize-fact-text.test.ts …/store.test.ts …/distiller-integration.daemon.test.ts` PASS; the 3 mandated asserts GREEN (cited case collapses → no-op; `is NOT blue` stays 2 facts; suppress-only never mutates the existing row); count-equality `fact_fts == distilled_facts` holds; scope unchanged (replace/normal-append untouched + grep-confirmed); `normalizeFactText` byte-identical; frozen `git diff` empty.

---

### Step 3 — Part 3: harness hard-asserts (STEP 2b + dedup-after-recall) + final verification + §6.1 escalation

> Flip STEP 2b from a soft log to a hard assert (GREEN only after Step 1); add a dedup-after-recall assert (GREEN only after Step 2). Then the full-green gate + EXECUTED both modes + the §6.1 re-demo escalation.

**Files:**
- Modify: `packages/daemon/scripts/memory-demo-harness.ts`

- [ ] **3.1 — Flip STEP 2b to a HARD assert (`memory-demo-harness.ts:532-538`).**
  Replace the soft `console.log` branch with: turn-1 AND turn-2 must both be memory-present; `process.exit(1)` on any miss (after cleanup):
  ```ts
  console.log(`[demo-harness] STEP 2b turn 1 (new thread)  reply: "${t1.reply.slice(0, 90)}"  memory-present=${t1HadMemory}`);
  console.log(`[demo-harness] STEP 2b turn 2 (same thread) reply: "${t2.reply.slice(0, 90)}"  memory-present=${t2HadMemory}`);
  if (!t1HadMemory) {
    console.error("[demo-harness] STEP 2b: RED — turn 1 (new thread) had no injected memory (check seeding/stub).");
    await cleanup(); process.exit(1);
  }
  if (!t2HadMemory) {
    console.error("[demo-harness] STEP 2b: RED — recall LOST on turn 2 (known-thread branch did not re-inject facts). v2-08 fix A not applied.");
    await cleanup(); process.exit(1);
  }
  console.log("[demo-harness] STEP 2b: GREEN — recall survives a same-thread follow-up turn (turn 1 AND turn 2 memory-present).");
  ```
  Keep the `memPresent()` discriminator (`[remembered]`/`Recall:`) — it is stub-definitive and avoids the Ukrainian false-positive documented at lines 523-526.

- [ ] **3.2 — Add a dedup-after-recall assert (new harness sequence, stub mode hard / real mode informational).**
  After the existing E block (or adjacent to STEP 2b), add: open a NEW thread, ask a COLOUR recall question ("Який мій улюблений колір?"), let the agent answer (the chat-stub echoes the `[remembered]` colour), dismiss (`wsTurnAndSettle`), then assert the colour-fact COUNT is unchanged (no new/duplicate colour fact created from the recall reply). Snapshot before/after via the rawDb pattern already used (lines 853-873). In stub mode `process.exit(1)` on an increase; in real mode print-only (LLM-fuzzy). Deterministic in stub mode because the scripted client (a) skips questions (E-a, trailing `?`) and (b) derives ops only from `[user|` lines, never the assistant recall reply (B-fix):
  ```ts
  console.log("[demo-harness] DEDUP-AFTER-RECALL: a colour recall (question + agent answer) → dismiss → no new/duplicate colour fact");
  const colourCountBefore = countColourFacts(tmpDir); // SELECT ... LIKE '%синій%'/'%зелений%'/'%колір%'/'%Люблю%'
  const threadDR = crypto.randomUUID();
  await wsTurnAndSettle(PORT, token, { threadId: threadDR, text: "Який мій улюблений колір?" }, 200);
  const colourCountAfter = countColourFacts(tmpDir);
  console.log(`[demo-harness] DEDUP-AFTER-RECALL: colour facts before=${colourCountBefore} after=${colourCountAfter}`);
  if (MODE === "stub" && colourCountAfter > colourCountBefore) {
    console.error("[demo-harness] DEDUP-AFTER-RECALL: RED — a recall reply created a new/duplicate colour fact (Part 2 dedup hardening not applied).");
    await cleanup(); process.exit(1);
  }
  console.log(`[demo-harness] DEDUP-AFTER-RECALL: ${MODE === "stub" ? "GREEN" : "informational"} — colour fact count stable across recall.`);
  ```
  Add a small `countColourFacts(dir)` helper (open a `MemoryStore`, run the colour `SELECT COUNT(*)`, close). Reuse the colour matcher already used at lines 727-729.

- [ ] **3.3 — Keep the `inject` MEMORY_DEBUG stage + re-label the banner v2-08.**
  Do NOT remove the `inject` stage in `index.ts` (committed dev-env, `c294795`). Update the harness banner/summary strings (`memory-demo-harness.ts:49-53`, 919-930) from v2-07 → v2-08; add STEP 2b hard-assert + DEDUP-AFTER-RECALL to the summary box.

- [ ] **3.4 — Full-green gate + EXECUTE both harness modes.**
  From repo root: `bun test && bun run lint:strict && bun run typecheck` → exit 0. `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` → empty. EXECUTE `bun run packages/daemon/scripts/memory-demo-harness.ts --mode=stub` (STEP 2b GREEN, DEDUP-AFTER-RECALL GREEN, all v2-06/v2-07 defects stay GREEN) AND `--mode=real` (real Haiku; skips-with-message if no Keychain key — note it; the conductor re-runs with a key). **Paste BOTH full stdouts into the PR**, marked "memory-demo-harness: EXECUTED, output below." For real mode, report whether turn-2 recall uses injected facts (Done criterion 2). Commit: `test(memory): v2-08 harness — STEP 2b hard-assert (turn-2 recall survives) + dedup-after-recall assert; banner v2-08` + trailer.

- [ ] **3.5 — Push + PR; escalate the §6.1 re-demo.**
  Push `chunk/v2-08-recall-injection-lifecycle`. PR body carries: (a) the lifecycle + provenance-stamp + dedup RED→GREEN test outputs, (b) the EXECUTED stub+real harness stdouts (STEP 2b + DEDUP-AFTER-RECALL GREEN), (c) the real-mode turn-2 recall-usage report, (d) the §7.1 seam resolution summary + the spec-note flag (below), (e) the demo runbook (multiple questions per thread). **Does NOT auto-merge** — Done criterion 3 (Lior's LIVE 9-step re-demo with multiple questions per thread) is the whole-feature gate. Report DONE-ready / BLOCKED-on-Lior-demo to the ledger; the conductor re-verifies (runs the harness both modes) + routes the §6.1 re-demo, then merges the whole stack (v2-05+06+07+08).

**DoD (command-evidence):** repo-root `bun test && bun run lint:strict && bun run typecheck` exit 0; frozen `git diff` empty; harness EXECUTED both modes (stdout in PR, STEP 2b + DEDUP-AFTER-RECALL GREEN); real-mode turn-2 recall reported; behavioral §6.1 re-demo escalated to Lior — **NOT done until the live demo is green (requires runtime demo to confirm; code-reading/tests/harness are necessary, not sufficient).**

---

## §7.1 runtime-coupling notes (flagged at decompose)

1. **Known-thread branch now calls `retrieve()` + the `whenIdle` asymmetry.** The known-thread branch gains a `retrieve()` await but deliberately does NOT use the `whenIdle` bounded-wait (new-thread-only). Couples the known-thread path to the memory provider (was tail-only). DoD: the known-thread-injection test + the non-re-persist test; the v2-07 whenIdle-timeout test stays green (it exercises the new-thread branch).
2. **`injectedMemory` semantics change (THE SEAM).** The flag's meaning widens from "new-thread branch retrieved ≥1 message" to "this turn's priorMessages contains ≥1 `[remembered]` fact (any branch)." Computed from message content (no signature change). The provenance-stamp test is the lock (B/C/D flipped + E added). Removes the dead `wasKnownThread`/`isNewThread` locals.
3. **endTurn delta-slice depends on `hydratedCount` counting injected facts.** Confirmed safe (the slice excludes both facts and tail because `hydratedCount = priorMessages.length`). No change to `endTurn`; the non-re-persist test guards it.
4. **Dedup guard couples to a new store read (`factExistsByNormalizedCanonical`).** A full-corpus scan inside the existing apply tx (bounded dogfood scale). Provider-agnostic. Scope unchanged (new/demoted/append-fallback only). DoD: the canonical-variant dedup test + count-equality.

---

## Frozen surfaces (confirmation)

`@agentic/protocol` and `packages/daemon/src/mock-agent.ts` stay **byte-unchanged.** Injection is daemon-internal (`priorMessages` → `priorState.messages`, `index.ts:188-190`), NOT the wire. The `[remembered]` message format, `REMEMBERED_LABEL`, `stampProvenance`, the chat-stub, and the system prompt are unchanged. No envelope/type-surface change is needed. Every step DoD asserts `git diff --stat main -- packages/protocol packages/daemon/src/mock-agent.ts` empty.

---

## ADR worthy: no

This chunk fixes a defect WITHIN the already-accepted model: ADR-0012 + the 2026-06-13 STABILITY amendment + 5a/5e. Specifically: fix A operationalizes decision 6's "small bounded distilled slice injected at thread start" so it injects on EVERY turn of a thread (the cross-thread continuity decision 4 promises was structurally broken for turn 2+); the `injectedMemory` seam preserves transparency 5c (the provenance link now correctly fires whenever a reply drew on remembered facts, on any turn); the dedup hardening operationalizes the amendment's STABILITY + spec §3.2 Failure-mode-B "redundant fact" mitigation on the canonical layer. No new protocol, no new dependency, no new boundary, no wire change. **No new ADR.**

### Spec-note flag (route to adr-curator/Lior, NOT orchestrator-edited)

**FLAGGED — a flag-only spec note, NOT an ADR.** The `injectedMemory` / known-thread-injection semantics change touches two documented assertions in `orchestration/docs/specs/2026-06-13-memory-distiller-v2.md` and the `MemoryProvider` port doc:
- The port doc for `retrieve` (`packages/daemon/src/memory/memory-provider.ts:69-76`) says "Compose the bounded distilled slice to inject at a **NEW thread's start**." With fix A, `retrieve` is now also called on KNOWN-thread turns. **This doc comment becomes a silent contradiction** unless reworded to "…to inject at a thread turn's start (every turn, new or known — v2-08)." The worker MAY reword this doc-comment in-chunk (it is a code doc-comment reconciliation to the new behavior, annotation-only, §7.2 citation-test: reconciliation-to-the-shipping-behavior, not new scope).
- The spec's §5/§7.1 currently frame retrieval/injection around new-thread start + the read-after-write `whenIdle` race (v2-06 FIX-A). v2-08 establishes that **cross-thread facts are re-injected on every turn of a thread, with `whenIdle` new-thread-only.** This is a refinement of the documented injection lifecycle. **Recommend a one-paragraph spec note** in `2026-06-13-memory-distiller-v2.md` §5 (or a §7.1 note) recording the v2-08 per-turn-injection + new-thread-only-whenIdle decision and the `injectedMemory`-fires-on-any-fact-injection rule. **This is a flag-only spec note (documentation of a within-amendment refinement), NOT a new/superseding ADR.** Flag to Lior/adr-curator at the bus answer; do NOT edit the spec from the orchestrator.
