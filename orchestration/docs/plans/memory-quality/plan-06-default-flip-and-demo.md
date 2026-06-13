# Plan — memory-quality chunk 06: Default flip + feature-closing live demo (2b cutover)

**Chunk:** `orchestration/chunks-todo/memory-quality/06-default-flip-and-demo.md`
**Specs:** `orchestration/docs/specs/2026-06-12-memory-quality.md` §3.4 + §5 · `orchestration/docs/specs/2026-06-13-forget-flow.md` §6
**ADRs:** `orchestration/docs/adr/0012-conversation-and-memory-model.md` (the feature's behavioral promise) · `orchestration/docs/adr/0015-intent-based-memory-forget.md` (the forget contract demoed in steps 3–5). This chunk IMPLEMENTS both — it does not amend either.
**Branch:** `chunk/06-default-flip-and-demo`
**Baseline for review:** `main`

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. **TDD RED-first** on the two selector tests. This is a ~0.5-day chunk: one production-line change (the default literal) plus two selector tests plus a PR-body demo runbook. Sequence the **live demo BEFORE closeout** (PIPELINE §6.1). Do **not** self-certify the behavioral DoD — escalate to Lior via the conductor.

**Goal:** Flip the `MEMORY_PROVIDER` default `dumb-tail → smart` in `memory-provider-selector.ts` (the last 2b chunk, per memory-quality §3.4 / q#001 Sub-4), prove the keyless daemon suite stays green and deterministic by routing through the no-key fallback BY DESIGN, add two explicit selector tests (default-unset = smart; default-unset-without-key = dumb-tail fallback with the loud log), and carry the feature-closing live-demo runbook in the PR body.

**Architecture:** A single literal change to one line of `buildMemoryProvider` — the `?? "dumb-tail"` default becomes `?? "smart"`. Everything that makes this safe already exists and ships unchanged: the `"smart"` branch already resolves a key and, on no-key, fires a loud `console.error` (with `fixHint`) and returns the registered `dumb-tail` provider so the daemon stays up. `dumb-tail` stays registered as both the swap-proof second leg and the no-key fallback. No new files, no new dependencies, frozen surfaces untouched.

**Tech Stack:** Bun + TypeScript, `bun:test`, `eslint --max-warnings=0`, `tsc --noEmit`. No new runtime dependency.

---

## Status: Done (plan ready for execution)

---

## Reality check (architect — verified at file:line on `main`; behavioral claims marked "requires runtime demo to confirm" per PIPELINE §6.1)

I read every claimed source. Findings:

**1. Current `MEMORY_PROVIDER` default = `"dumb-tail"`, and the flip lands on exactly one line.**
`packages/daemon/src/memory/memory-provider-selector.ts:50`:
```ts
const id = process.env["MEMORY_PROVIDER"] ?? "dumb-tail";
```
This `?? "dumb-tail"` IS the default. The flip is changing this single literal to `"smart"`. The chunk-04(old) guard test the brief references is live at `memory-provider-selector.test.ts:61` — `"MEMORY_PROVIDER unset => provider.id === 'dumb-tail' (default UNCHANGED — chunk-04 guard)"`. **This test must be UPDATED (not deleted) by this chunk** — it currently asserts the OLD default and will go RED on the flip BY DESIGN. That is the headline RED→GREEN of this chunk. (Brief confirmed: "add explicit selector tests: (a) default (env unset) = smart". This supersedes the old guard's assertion; the test's identity flips from "default unchanged" to "default IS smart".)

**2. The no-key fallback already works as the brief describes — no new code needed for it.**
`buildSmartProvider` (`selector.ts:29-39`): calls `resolveKey()`; if `!resolved.ok` → `console.error("[memory] MEMORY_PROVIDER=smart but no ANTHROPIC_API_KEY resolved; falling back to dumb-tail. " + resolved.fixHint)` and returns `null`. `buildMemoryProvider` (`selector.ts:52-58`): on the `"smart"` branch, if `buildSmartProvider` returns `null` it returns `REGISTRY.get("dumb-tail")!`. Daemon stays up (ADR-0010 gotcha-#9 posture, documented in the file). The two NEW selector tests this chunk adds **already exist in spirit** at `memory-provider-selector.test.ts:39` (smart + key ⇒ id `'smart'`) and `:47` (smart + no key ⇒ `console.error` fired incl. `fixHint` AND id `'dumb-tail'`). So the only genuinely-new assertion this chunk introduces is the **default-unset ⇒ smart** one (by editing the `:61` test) plus the **default-unset + no-key ⇒ dumb-tail** path (a different env setup from the explicit-`smart` test at `:47`). **Flag:** the brief asks for "two NEW tests"; in reality one is an EDIT of an existing test and the no-key behavior is already covered for the explicit-`smart` case at `:47`. The honest delta is: 1 edited test (default ⇒ smart) + 1 new default-unset+no-key test + re-confirm the pre-existing `:39`/`:47` still pass. Do NOT add a literal duplicate of `:47`.

**3. The keyless daemon suite will route through the no-key fallback deterministically after the flip — confirmed by construction, with one caveat to watch.**
`startDaemon()` (`index.ts:62-72`) calls `buildMemoryProvider()` with **no `resolveKey` injection** → production path. After the flip, in a keyless CI/test environment `id` defaults to `"smart"` → `resolveAnthropicKey()` is called → returns `!ok` (no Keychain item, no `.env` key in CI) → loud `console.error` + fall back to `dumb-tail`. **No network is attempted on the no-key path** — `buildSmartProvider` returns `null` *before* a `SmartDistillerProvider` is ever constructed (`selector.ts:34-38`), and `SmartDistillerProvider` is the only thing that holds the Anthropic client. So a keyless suite never instantiates the network-capable provider. This is deterministic. **Caveat / finding to surface:** `resolveAnthropicKey` (`secrets/cloud-secrets.ts`) shells out to `/usr/bin/security` on macOS in the production path — in a keyless macOS dev box it returns `!ok` quickly, but it IS a real shell-out, not a pure function. It does NOT hit the *network*, and it does NOT make the daemon test-suite flaky in CI (no Keychain item ⇒ deterministic `!ok`), but a worker running the suite **locally on a machine that HAS the key in Keychain** would get `id="smart"` resolving `ok=true` and a real `SmartDistillerProvider` — which then only calls the network on an actual distill (thread dismiss), not at construction. **Mitigation already in place:** every daemon test that drives a real distill injects a stub `clientFactory`/`client` (spec §5 — the only permitted stub is the LLM client), so even with a resolvable key, the suites that exercise distillation use the stub, not the network. **The one thing the worker MUST verify (mechanical):** run `bun test` in a **keyless** environment (unset/absent ANTHROPIC key) and confirm 0 failures and no network attempt. If any daemon test constructs `startDaemon()` AND triggers a real thread-dismiss distill WITHOUT injecting a memory provider or stub client, that test would — only on a key-present machine — hit the live API.

**4. No daemon test today calls `buildMemoryProvider()` via `startDaemon` and then drives a real network distill.** The distill-exercising suites construct providers directly with stub clients, not via the selector. The selector's own tests inject `resolveKey`. The integration tests that go through `startDaemon` drive the *agent* path with an injected fake `AgentProvider` (`startDaemon(port, provider)`), and their memory provider is whatever `buildMemoryProvider()` returns — which after the flip is `dumb-tail` in keyless CI. **A worker on a key-present machine should confirm these integration tests still pass and do not silently fan out to the network on dismiss.** This is the precise place the brief's "identify any test that would now hit a live network path after the flip" lands. **Requires the worker to actually run `bun test` keyless to confirm** (PIPELINE §6.1; this is a mechanical-but-runtime claim, so the worker runs it, not the architect).

**5. The whole forget + recall demo surface exists as code on `main` (chunks 01–05 merged) — existence confirmed, behavior NOT.** For the runbook to be followable the architect confirmed these code paths exist (NOT that they work — that is Lior's live demo):
- Self-concept prompt: `packages/daemon/src/providers/system-prompt.ts` — `MEMORY_SELF_CONCEPT` + `COMPOSED_SYSTEM_PROMPT` (chunk 01, ADR-0012 d1/d4).
- Provenance stamping: the History link is stamped mechanically post-reply.
- Forget surface: `hatch.ts`, `write-gate.ts`, `http-routes.ts` (`POST /memory/forget` with `target_type`; `GET /memory/cofed`), `history-page.ts` (the "Forget" / "Forget fact" buttons, option-B confirm, co-fed-count fetch).
- History page served at `GET /history.html` on loopback, Host-guarded.
- Smart distiller + truncation guard: `smart-distiller-provider.ts` (chunks 03/05).
**All behavioral demo steps are "requires runtime demo to confirm" — Lior's live macOS demo over real overlay → daemon → store → Anthropic is the only evidence. Code-reading, green tests, and prior PASS records are NOT evidence (the route lied 5×).**

**6. Frozen surfaces — this plan touches NONE.** `@agentic/protocol` (`packages/protocol/src`) and the mock agent/reducer (`packages/daemon/src/mock-agent.ts`) are not in the change set. The flip touches only `memory-provider-selector.ts` + `memory-provider-selector.test.ts`. The PR runbook is PR-body text, not a file.

**Contradiction with the brief:** one, surfaced in finding #2 — the brief says "add two NEW selector tests," but the no-key-fallback test already exists for the explicit-`smart` case at `:47`. The accurate change is: **edit the `:61` default-guard test to assert `smart`**, **add a default-unset + no-key test**, and **re-confirm (do not duplicate) the existing tests at `:39`/`:47`**. Everything else in the brief matches `main` exactly. This contradiction is within the chunk's own chartered scope (the chunk EXISTS to flip the default + adjust the default tests) — it is a reconciliation, not new scope; no §7.2 escalation.

---

## ADR worthy: no

This chunk **implements** two already-accepted, frozen decisions and changes neither:
- **memory-quality spec §3.4 / q#001 Sub-4** explicitly stages the default flip into "the LAST chunk … after the real-API smoke probe has been EXECUTED green." Chunk 03's probe is executed (merged); 04/05 are merged. Flipping now is the planned cutover, not a new decision.
- **ADR-0012** (the behavioral promise "one agent that remembers — owned, precise, transparent") and **ADR-0015** (the intent-based forget contract) are unchanged: the flip activates code that already implements them; it does not alter the contracts.
- **Frozen surfaces** (`@agentic/protocol`, mock reducer) are byte-unchanged.
- **No new dependency.** `@anthropic-ai/sdk` is already present and ADR-0011-gated.
- The default flip is a config-default change behind an existing, accepted fallback — not a new protocol choice, boundary, or dependency. Implementing an accepted decision is not itself ADR-worthy.

If the keyless-suite run (Task 2) surfaced a test that DOES route the selector to the live network at daemon construction — that would be a defect to fix in-chunk (or a finding to escalate), still not an ADR. None found by code-reading; confirmed-clean requires the executed run.

---

## File Structure

- **Modify** `packages/daemon/src/memory/memory-provider-selector.ts` — one line: the `?? "dumb-tail"` default → `?? "smart"`, with a comment citing memory-quality §3.4 / q#001 Sub-4 + the no-key-fallback safety net.
- **Modify** `packages/daemon/src/memory/memory-provider-selector.test.ts` — edit the existing default-guard test (line 61) from "default = dumb-tail" to "default (env unset) = smart"; add a default-unset + no-key fallback test; re-confirm the existing `:39`/`:47` still pass. No duplicate of `:47`.
- **PR body** — carries the `## Demo runbook` below verbatim (NOT a new doc; the in-overlay-UI follow-on owns any doc, per spec §1 scope split).

No new files; no new dependencies; frozen surfaces untouched.

> **Worker note:** the test snippets below are illustrative — adapt to the ACTUAL existing helpers in the file (`fakeOk`/`fakeMissing` ResolveResult fixtures, the `beforeEach`/`afterEach` env save-restore, the dynamic `await import("./memory-provider-selector.js")` pattern the file uses so each test re-reads env). TDD RED→GREEN is the contract.

---

## Tasks

### Task 1: Flip the default to `smart` (selector — TDD RED via the edited guard test)

**Files:**
- Test: `packages/daemon/src/memory/memory-provider-selector.test.ts`
- Modify: `packages/daemon/src/memory/memory-provider-selector.ts`

- [ ] **Step 1: Edit the existing default-guard test to assert the NEW default (write the RED).** Replace the test at `memory-provider-selector.test.ts:61` (currently `"MEMORY_PROVIDER unset => provider.id === 'dumb-tail' (default UNCHANGED — chunk-04 guard)"`). The unset-env path must now resolve `"smart"`; because the production `buildMemoryProvider()` (no `resolveKey` injection) would shell out to Keychain, **inject `fakeOk`** so the test is deterministic and offline (asserts the DEFAULT routes to the smart branch, which is the behavior under test — not key resolution):

```ts
test("MEMORY_PROVIDER unset => default routes to smart (chunk-06 flip; resolvable key => id 'smart')", async () => {
  delete process.env["MEMORY_PROVIDER"];
  const { buildMemoryProvider } = await import("./memory-provider-selector.js");
  // Inject a resolvable key so the default's smart branch is deterministic + offline.
  // The point under test: env-unset now defaults to "smart" (was "dumb-tail" pre-flip).
  const provider = buildMemoryProvider({ resolveKey: () => fakeOk });
  expect(provider.id).toBe("smart");
});

test("MEMORY_PROVIDER unset + NO key => default falls back to dumb-tail with loud log (keyless-env path)", async () => {
  delete process.env["MEMORY_PROVIDER"];
  const { buildMemoryProvider } = await import("./memory-provider-selector.js");
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const provider = buildMemoryProvider({ resolveKey: () => fakeMissing });
  expect(errSpy).toHaveBeenCalled();
  const allText = errSpy.mock.calls.map((c) => c.join(" ")).join(" ");
  expect(allText).toContain(fakeMissing.fixHint);
  errSpy.mockRestore();
  expect(provider.id).toBe("dumb-tail");
});
```
(The second test makes explicit that the default-environment keyless path = the existing no-key fallback — this is what keeps the keyless daemon suite green BY DESIGN. The pre-existing `MEMORY_PROVIDER=smart` tests at `:39`/`:47` stay untouched and still pass; do not duplicate them.)

- [ ] **Step 2: Run, verify the first new test FAILS.** `bun test packages/daemon/src/memory/memory-provider-selector.test.ts`. Expected: the `default => 'smart'` test FAILS (default is still `"dumb-tail"` pre-flip → `provider.id` is `"dumb-tail"` not `"smart"`). Confirm it is RED.

- [ ] **Step 3: Flip the default literal.** In `memory-provider-selector.ts:50`, change:
```ts
  const id = process.env["MEMORY_PROVIDER"] ?? "dumb-tail";
```
to:
```ts
  // memory-quality §3.4 / q#001 Sub-4: the dumb-tail->smart default flip lands in THIS
  // last chunk, after chunk-03's real-API probe ran green + chunks 04/05 merged. Safety
  // net unchanged: on the smart branch a no-key environment fires a loud console.error
  // (with fixHint) and falls back to the still-registered dumb-tail provider — the daemon
  // stays up and keyless test environments exercise that fallback BY DESIGN (grill #10).
  const id = process.env["MEMORY_PROVIDER"] ?? "smart";
```
Also update the JSDoc on `buildMemoryProvider` (currently `'Defaults to "dumb-tail".'`) to read `'Defaults to "smart" (chunk-06 flip); no-key environments fall back to dumb-tail with a loud log.'`

- [ ] **Step 4: Run, verify PASS.** `bun test packages/daemon/src/memory/memory-provider-selector.test.ts` — both new tests + the two pre-existing `smart` tests (`:39`, `:47`) green.

- [ ] **Step 5: Commit.**
```bash
git add packages/daemon/src/memory/memory-provider-selector.ts \
        packages/daemon/src/memory/memory-provider-selector.test.ts
git commit -m "feat(memory-quality): flip MEMORY_PROVIDER default dumb-tail->smart (chunk 06 cutover)

Default env-unset now selects the smart distiller; no-key environments fall back
to dumb-tail with a loud log (existing safety net). memory-quality spec §3.4 / q#001 Sub-4.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Prove the keyless suite survives the flip (mechanical, deterministic, no network)

**Files:** none (verification task — the brief's grill #10 assertion). Surfaces any test that would now hit a live network path.

- [ ] **Step 1: Confirm the environment is keyless.** Ensure NO Anthropic key is resolvable: `unset ANTHROPIC_API_KEY` in the shell AND confirm no Keychain item resolves (`/usr/bin/security find-generic-password -s agentic-engine -a ANTHROPIC_API_KEY -w` returns non-zero / "could not be found"). If a Keychain item EXISTS on the dev box, either run the suite on a key-less machine/CI, or temporarily verify by reasoning that distill-exercising tests inject stub clients (finding #3) — but the authoritative check is a genuinely keyless run.

- [ ] **Step 2: Run the full suite keyless.** `bun test` from repo root. Expected: exit 0, 0 failures. **This is the grill #10 proof:** after the flip, `startDaemon()`-based integration tests resolve the default `"smart"` → no key → loud `console.error` + `dumb-tail` fallback → deterministic, no network attempted at construction.

- [ ] **Step 3: Assert no network was attempted.** Confirm no test emitted a real Anthropic HTTP call. Mechanism: (a) the run completes without network-timeout flakiness; (b) `bun test 2>&1 | grep -i "api.anthropic.com\|fetch failed\|ECONNREFUSED"` should be empty (allowing for the expected loud `console.error` fallback text, which is NOT a network call). If any test routes the production selector to a live distill, that is a **finding to surface in the PR + escalate** (it would only manifest on a key-present machine).

- [ ] **Step 4: Record the evidence.** Capture the keyless `bun test` summary (pass count, 0 failures) for the PR body alongside the runbook. (No commit — this is verification, not a code change.)

---

### Task 3: Mechanical gates + PR with demo runbook (sequence demo BEFORE closeout)

**Files:** none (gates + PR). PR body carries the `## Demo runbook` verbatim.

- [ ] **Step 1: Run all mechanical gates, each exits 0.**
  - `bun test` (keyless — Task 2)
  - `bun run lint:strict` (`eslint . --max-warnings=0`)
  - `bun run typecheck` (`tsc --noEmit -p tsconfig.json`)

- [ ] **Step 2: Confirm frozen surfaces byte-unchanged** (expect empty output):
```bash
git diff --stat main -- packages/protocol/src
git diff --stat main -- packages/daemon/src/mock-agent.ts
```
Both must be empty. (Sanity: `git diff --stat main` should show only `memory-provider-selector.ts` + its test.)

- [ ] **Step 3: Push the branch and open the PR.** PR body = a chunk summary (what flipped, how verified: keyless `bun test` pass count + lint + typecheck + frozen-surface diff empty) **PLUS the `## Demo runbook` below verbatim**, ending with the standard Claude Code attribution line. Mark the PR clearly: **DOES NOT auto-merge until Lior's live demo (§6.1) is green** (behavioral DoD, non-negotiable).

- [ ] **Step 4: Escalate the live demo to Lior via the conductor — do NOT self-certify.** The chunk (and the whole memory-quality feature) is NOT `done` and the PR does NOT auto-merge until Lior runs the `## Demo runbook` on real macOS and signs off all steps. Code-reading, green tests, and prior PASS records are NOT evidence (the route lied 5×; PIPELINE §6.1). Closeout docs come AFTER the green demo, not before.

- [ ] **Step 5 (after green demo only): Closeout.** On Lior's signed demo, record the green in the PR + ledger and merge per the all-green gate set (CI green + reviewer-clean + frozen-surface unchanged + behavioral demo signed). This is the LAST chunk of memory-quality — note feature-complete in the conveyor ledger.

---

## Demo runbook (copy-pasteable; goes in the PR body — Lior's §6.1 live feature-closing demo on macOS)

> This is the behavioral gate for the **whole memory-quality feature** (memory-quality §5 recall/ownership + forget-flow §6 forget steps 3–5). Run on real macOS, over the real overlay → daemon → store → Anthropic path — nothing stubbed. The chunk is NOT done until every step passes live.

### Preconditions (memory-quality §5 / q#001 rider c — get these EXACTLY right)

1. **Anthropic key in the macOS Keychain** (the smart distiller + the chat provider both read it):
   ```bash
   bun run --cwd packages/daemon keychain-set    # paste the key at the stdin prompt (never in argv)
   # verify:
   /usr/bin/security find-generic-password -s agentic-engine -a ANTHROPIC_API_KEY -w
   ```
2. **`LLM_PROVIDER=anthropic-api`** exported for the daemon process (real Claude chat, not mock).
3. **`MEMORY_PROVIDER` UNSET** — after this chunk's flip, unset = `smart`. **Warning:** if the key is missing, the daemon silently falls back to `dumb-tail` and step 2 (precise recall) will NOT demonstrate 2b — you would be demoing the old fuzzy tail. Confirm the key resolves (precondition 1's verify line) before starting.
4. Build/run the daemon (real, on `localhost:7777`):
   ```bash
   LLM_PROVIDER=anthropic-api bun run --cwd packages/daemon src/index.ts
   ```
   (Keep `MEMORY_PROVIDER` unset so the new default `smart` is exercised.)
5. Run the overlay frontend:
   ```bash
   bun run --cwd apps/overlay tauri dev     # or `vite` for the browser surface
   ```
6. Note the daemon's per-install WS token + the loopback History URL it logs (`http://127.0.0.1:7777/history.html`). The History page holds the token in a JS variable only (it is the demo's forget surface).

### Demo steps (all must pass live)

**Step 1 — meta-question → truthful memory ownership (2a, ADR-0012 d1/d4).**
Open the overlay, ask: **"How does your memory work?"** (or "Do you remember things between conversations?").
- ✅ The agent **owns** its memory: describes itself as one persistent agent that remembers across conversations via distilled facts, mentions the user can view/edit/delete from the History page.
- ❌ FAIL if it says "I'm stateless / I don't have memory / I can't remember" (the original disowning defect).

**Step 2 — structured recall → precise answer + provenance link (2b).**
In one or more PRIOR threads, greet the agent a few times ("hi", "привіт", etc.), then dismiss those threads (close the overlay) so a smart re-projection runs. In a FRESH thread ask: **"How many times did I say hi?"**
- ✅ A **precise** count (matching what you actually said), and a **History link is attached** to the reply (stamped automatically — the agent must NOT have typed the link itself).
- ✅ Click the link → it opens `history.html` showing the source thread(s)/messages behind the count.
- ❌ FAIL if the number is a fuzzy guess, or no provenance link appears, or the agent wrote out a fake link.

**Step 3 — forget a FACT via the hatch → source byte-INTACT + not re-derived (ADR-0015 best-effort; forget-flow §6).**
On `history.html`, find a distilled FACT (e.g. "favourite colour: blue" — teach the agent a fact in a thread first, dismiss it, let it distill). Click **"Forget fact"** (the plain fact-forget, NOT option B).
- ✅ The fact disappears from the History fact list.
- ✅ The **source message is byte-INTACT** — open the source thread; the original message text is unchanged (no scrub). This is MAJOR-2 fixed: forgetting a derived fact does NOT destroy history.
- ✅ Open a FRESH thread, ask for that fact ("what's my favourite colour?") → the agent does NOT use it (best-effort Layer-T suppression fires; the re-projection drops the re-derived equivalent by normalized text).
- ❌ FAIL if the source message got scrubbed, or the agent re-states the forgotten fact in a fresh thread.

**Step 4 — forget a MESSAGE via the hatch → hard-scrub, fact gone in a fresh thread (the §4 HARD guarantee).**
On `history.html`, on a specific MESSAGE (one that fed a fact), click **"Forget"** (message-forget).
- ✅ The message content is hard-scrubbed at the source (redaction tombstone; content no longer visible).
- ✅ A fresh thread proves the fact derived from it is **gone and cannot be regenerated** (the scrubbed content never reaches the distiller's tombstone-honored digest).
- ❌ FAIL if the scrubbed content still appears or the fact re-derives.

**Step 5 — option B: "also forget source messages" on a fact → source scrubbed + co-fed-count confirm (ADR-0015 decision 5).**
On a fact with real message sources, choose **"Forget fact + also forget source(s)"** (option B).
- ✅ Before committing, the confirm surfaces the **source-message count AND the count of OTHER facts those messages feed** (the co-fed blast radius — fetched from `GET /memory/cofed`). Example shape: "Confirm? Delete N source msg(s). M other fact(s) also use these messages."
- ✅ On confirm, the source message(s) ARE scrubbed (the opt-in HARD escape).
- ❌ FAIL if option B scrubs without showing the co-fed count, or if plain "Forget fact" (step 3) ever scrubbed a source.

### Sign-off
All five steps green on real macOS → Lior signs the behavioral DoD → the PR may merge per the all-green gate set → memory-quality is feature-complete. Any step red → do NOT merge; escalate.

---

## Verification (mechanical gates)

| Gate | Command | Pass condition |
|---|---|---|
| Keyless test suite | `bun test` (with NO resolvable Anthropic key) | exit 0; 0 failures; no network attempted (Task 2 Step 3) |
| Lint strict | `bun run lint:strict` | exit 0 (`--max-warnings=0`) |
| Typecheck | `bun run typecheck` | exit 0 |
| Frozen surface — protocol | `git diff --stat main -- packages/protocol/src` | empty |
| Frozen surface — mock reducer | `git diff --stat main -- packages/daemon/src/mock-agent.ts` | empty |
| Change scope | `git diff --stat main` | only `memory-provider-selector.ts` + `memory-provider-selector.test.ts` |
| Behavioral DoD | Lior's live demo (runbook above) | all 5 steps green — **requires runtime demo to confirm; not self-certifiable** |

---

## Self-review

- **Spec coverage:** memory-quality §3.4 default-flip staging → Task 1 (flip lands in the last chunk, after probe + 04/05). grill #10 keyless-suite-survives-flip → Task 2. memory-quality §5 demo env preconditions + recall/ownership steps → Demo runbook preconditions + steps 1–2. forget-flow §6 forget steps 3–5 → Demo runbook steps 3–5. q#001 rider c missing-key warning → runbook precondition 3.
- **Brief contradiction surfaced:** the "two NEW selector tests" — one is an EDIT of the existing `:61` guard (default→smart), the no-key fallback for explicit-`smart` is ALREADY at `:47`; the plan edits + adds a default-unset+no-key test rather than duplicating (Reality check #2). Within chartered scope — no §7.2 escalation.
- **Type/identity consistency:** the change is one literal (`"dumb-tail"`→`"smart"`) at `selector.ts:50`; tests use the file's existing `fakeOk`/`fakeMissing` fixtures + dynamic-import-per-test pattern. No new symbols.
- **PIPELINE §6.1 discipline:** every behavioral claim marked "requires runtime demo to confirm"; demo sequenced BEFORE closeout; no self-certification; no auto-merge until the live demo is green.
- **No new dependency, no frozen surface touched, no ADR amendment** — ADR worthy: no.

## Status: Done
