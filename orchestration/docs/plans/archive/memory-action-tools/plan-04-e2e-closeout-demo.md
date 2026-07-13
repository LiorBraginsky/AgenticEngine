# Memory Action Tools (2c) — Chunk 04 "E2E closeout + live demo" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the render-only Memory-window audit trail (spec §3.9 D9b), prove the memory-action path end-to-end through the real daemon over the real WS + the real Memory-window HTTP read (a deterministic, executed probe), prep the demo runway, and stage the closeout docs reconcile — so Lior's live §5 demo (items 1–5) is the last gate.

**Architecture:** The audit field already reaches the wire (chunk-01: `Hatch.view` → `GET /memory/thread/:id`). Chunk-04 (a) widens the overlay's frontend-local `HatchView` to declare `memoryActionEvents` and renders a fourth, render-only list with agent-vs-distiller attribution (no new interaction affordances); (b) adds one deterministic WS→tool→store→Memory-window-API probe (only the LLM network boundary stubbed, per spec §5); (c) preps the runway (harness poll-until-present; chunk-02 probe faithfulness); (d) stages the backlog/roadmap reconcile. No product-code change beyond the overlay render — a demo-found defect routes back per §7.2, never patched inline (chunk file "Out").

**Tech Stack:** TypeScript on Bun; overlay = vanilla-TS DOM + happy-dom tests (`bun test`); daemon probe = `startDaemon` + real `MemoryStore` (WAL) + real `MemoryActionPort` + a scripted `client` (no key); `git diff` for frozen byte-diff.

---

## ⚠️ ORCHESTRATOR SEQUENCING NOTE (§6.1 — added at plan-persist time)

The behavioral DoD is **Lior's live demo** — a worker cannot perform it. §6.1 forbids committing "shipped/done" docs before the demo passes. Therefore this worker build-pass executes **Steps 1, 2, and 3.1–3.2 only**:

- **BUILD + VERIFY now (this worker run):** Step 1 (render), Step 2 (probe + runway), Step 3.1 (frozen byte-diff), Step 3.2 (full gates). Then engine-reviewer → clean → open PR with the executed-probe + byte-diff evidence.
- **DEFERRED to post-demo closeout (orchestrator, after Lior's sign-off):** Step 3.3–3.5 (backlog/roadmap "shipped" reconcile) and the §4.4 archive ritual (chunks 01–04 + all four plan files). Committing the "2c shipped" reconcile before the demo would be exactly the premature-done doc §6.1 warns against.
- **Step 3.6 is Lior's gate.** After the PR is ready + reviewer-clean, the orchestrator reports **BLOCKED — behavioral demo sign-off** and stops. Merge + reconcile + archival happen only after all five §5 items are GREEN and signed.

---

## Global Constraints

- **FROZEN — byte-diff MUST be empty at PR time (freeze gate, human):** `packages/protocol/**`; `packages/daemon/src/providers/mock-provider.ts`; `packages/daemon/src/mock-agent.ts` (the mock reducer).
- **Render-only (q#015 Ruling 2; chunk "Out"):** the Memory-window addition is a display list. **NO new interaction affordances** — no buttons/edit/forget controls on audit rows.
- **Type-checked consumption (standing decompose lesson):** additive-on-wire ≠ additive-on-type. The overlay consumes `memoryActionEvents` through a declared `HatchView` field — **no `as` cast, no `any`, no cast-past.**
- **Overlay bundle isolation:** do NOT import daemon types into the overlay — mirror the shape locally (the established `DistilledFactView`/`DistilledFactRow` pattern).
- **XSS discipline (`render.ts` header):** all API-derived strings via `textContent`/`createElement` — NEVER `innerHTML`.
- **No new product capability/fix (chunk "Out", §7.2):** a demo-found defect goes back as a fix task or escalates (§5.2). The closeout chunk does not grow scope.
- **Behavioral DoD = Lior's live demo (PIPELINE §6.1, non-negotiable):** sequence the demo BEFORE any closeout docs say "done." Behavioral criteria are marked *"requires runtime demo to confirm,"* never "verified."
- **Probe = evidence only when EXECUTED** (Strike-4/5 lineage): the E2E probe stdout must be pasted in the PR; type-checking it is not evidence.
- **ADRs in scope (consumed, not reopened):** 0016 (this demo is its behavioral proof), 0012 (5a/5d/5e live), 0015 (d.6 live).

---

## Reality check

Every brief claim verified in-source (Grep/Read). Confirmed unless marked. Behavioral lines are marked *"requires runtime demo to confirm"* — never asserted from code-reading (PIPELINE §6.1).

1. **The audit field is already on the wire — CONFIRMED.** `HatchViewResult.memoryActionEvents: MemoryActionEventRow[]` (`hatch.ts:39`); `view()` populates it via `store.readMemoryActionEvents(threadId)` (`hatch.ts:66`); `GET /memory/thread/:id` is `Response.json(hatch.view(id))`. So the render path's daemon+HTTP hops exist; only the overlay's typed consumption + render are chunk-04's. *Coupling note 7 join re-validated HERE.*
2. **The additive field is missing on the overlay type — CONFIRMED (the exact type to widen).** `apps/overlay/src/memory/types.ts` `HatchView` has `messages`/`distilledFacts`/`distillationEvents` only. Daemon row shape to mirror: `MemoryActionEventRow = { action: string; outcome: string; fact_text: string; actor: string; created_at: number }` (`store.ts:97-102`).
3. **Attribution data — CONFIRMED + PINNED.** Audit rows carry `actor` (`'agent'`); `distilled_facts` has no actor column and is not ALTERed. Render the memory-action events as a distinct list labeled as the AGENT's actions beside the existing "Distillation events" list (the DISTILLER's). The two labeled lists + the audit `actor` field ARE the "agent-vs-distiller attribution rendered FROM the audit trail." No per-fact actor invented on `distilled_facts`.
4. **Existing WS harness — CONFIRMED (`wsTurn` reusable; no deterministic tool-loop-over-WS mode).** `memory-demo-harness.ts` drives the real WS path (`wsTurn`, `wsTurnAndSettle`); stub mode wires the mock (no tool loop); the 2c section is real-mode-only + informational with fixed 300/400ms settles. chunk-02 `memory-action-tool-probe.ts` drives `advance()` directly (not WS) with a REAL LLM. Neither is a deterministic WS→tool→Memory-window-API path → chunk-04 adds one.
5. **Deterministic key-free probe is viable — CONFIRMED.** `createAnthropicApiProvider({ client })` bypasses key resolution (`anthropic-api-provider.ts:262`); `MemoryStore` opens WAL (`store.ts:181`); `startDaemon(0, provider)` with an injected `id==="anthropic-api"` provider makes index.ts build the ordinal-map/slice (`index.ts:84-85,188-196`).
6. **Demo-runway handoffs — CONFIRMED.** (a) chunk-02 probe scenario 2 uses `COMPOSED_SYSTEM_PROMPT` (`memory-action-tool-probe.ts:292`), not `composeSystemPrompt(true)`. (b) harness real-mode fixed settles (2c 300/400ms; FACT-EDIT 200ms) can be outrun by a 1–3s live distill — the chunk-03 reviewer MINOR + the FACT-EDIT stall.
7. **Behavioral DoD lines** *(requires runtime demo to confirm — Lior, chunk-04):* the Memory window VISIBLY showing the audit list + attribution; the fact visibly GONE; the five §5 items GREEN with the real LLM over the real overlay. Code-reading and the deterministic probe are NOT substitutes for the live demo (PIPELINE §6.1; the 3× v0 scar).

**No spec/chunk/ADR claim was falsified.** One frontend type gap identified (the D9b consumption point); one design fork (the E2E probe mode) resolved by spec §5's stub rule.

---

## Approaches — the E2E probe mode (the one genuine fork)

The chunk DoD tags the E2E probe **[mechanical]** (deterministic), while the real-LLM full path is the **[behavioral]** live demo. So the probe cannot be LLM-fuzzy.

- **Option A — deterministic scripted-`client` over the real WS + real HTTP read (CHOSEN).** `startDaemon(0, createAnthropicApiProvider({ client: scriptedToolUseClient, memoryActionPort: portOverSharedStore }))`; drive a WS turn; the loop fires `memory_forget` through the real port; then `GET /memory/thread/:id` asserts the fact is gone AND a `{forget, applied}` row is in `memoryActionEvents`. Exercises the true production boundary; only the LLM network boundary stubbed — exactly spec §5's rule; deterministic + key-free ⇒ a real [mechanical] DoD.
- **Option B — real-mode LLM WS probe (rejected as the mechanical probe).** LLM-fuzzy ⇒ behavioral, not mechanical; needs a key. Covered by chunk-02's executed real-API probe + Lior's live demo. Kept only as a runway rehearsal.

---

## ADR worthy: no

Chunk-04 is render + probe + docs. It consumes accepted **ADR-0016** (this demo is its behavioral proof; the audit render is dec-4(e) made visible), **ADR-0012** (5a/5d/5e), **ADR-0015** (d.6). No new decision, boundary, contract, dependency, or wire change; no frozen surface changes (proven by byte-diff).

---

## File Structure

- `apps/overlay/src/memory/types.ts` **(modify)** — add `MemoryActionEventView`; add `memoryActionEvents: MemoryActionEventView[]` to `HatchView` (the type-checked-consumption point).
- `apps/overlay/src/memory/render.ts` **(modify)** — add `renderAuditEvents(el, events)` (render-only; textContent-only; empty state).
- `apps/overlay/src/memory/render.test.ts` **(modify)** — DOM-harness tests (applied + refused rows + agent attribution + empty state + no-affordance guard).
- `apps/overlay/src/memory/controller.ts` **(modify)** — add `actionsEl` to `MemoryControllerEls`; render audit events in `loadThread`; clear it in Loading/LOCKED/DOWN, `applyDownState`, `renderActionError`.
- `apps/overlay/src/memory/controller.test.ts` **(modify)** — assert `loadThread` renders audit events; down/locked clears the actions panel.
- `apps/overlay/memory.html` **(modify)** — add a fourth panel `<div class="panel"><h2>Agent memory actions</h2><div id="actions-container"></div></div>` inside `#thread-view`.
- `apps/overlay/src/memory.ts` **(modify)** — add `actionsEl: el("actions-container")` to the controller `els`.
- `packages/daemon/scripts/memory-action-e2e-ws-probe.ts` **(new)** — the deterministic full-path WS→tool→store→Memory-window-API probe (Option A).
- `packages/daemon/scripts/memory-demo-harness.ts` **(modify)** — real-mode poll-until-fact-present (replace the fixed 2c 300/400ms + FACT-EDIT 200ms settles).
- `packages/daemon/scripts/memory-action-tool-probe.ts` **(modify)** — scenario 2 uses `composeSystemPrompt(true)`.
- `orchestration/docs/memory-backlog.md` **(modify — DEFERRED to post-demo closeout)** — §B reconcile to shipped.
- `orchestration/docs/roadmap.md` **(modify — DEFERRED to post-demo closeout)** — "Memory — next" 2c tick + open-case A′ tail note.

DO NOT touch: `packages/protocol/**`, `mock-provider.ts`, `mock-agent.ts`, and any 2c product code in `packages/daemon/src/memory/` or `providers/` (chunks 01–03 shipped it; §7.2 routes defects back).

---

## Steps

### Step 1 — Memory-window audit render (spec §3.9 D9b; render-only, type-checked)

**Named DoD:** the overlay declares `memoryActionEvents` on `HatchView` (no cast anywhere consumes it); the thread detail renders a fourth list of agent memory actions (action + outcome + fact_text + agent attribution + timestamp), with an honest empty/locked/down state; NO interaction affordance is added; overlay typecheck + tests + `lint:strict` green. *(The VISIBLE render working live = Lior's demo items 1 & 5 — requires runtime demo to confirm.)*

**Files:** `types.ts`, `render.ts`, `render.test.ts`, `controller.ts`, `controller.test.ts`, `memory.html`, `memory.ts`.

**Interfaces — Produces:**
```ts
// apps/overlay/src/memory/types.ts — frontend-local mirror of daemon store.ts MemoryActionEventRow.
// Do NOT import daemon types. additive-on-type: this is what makes the wire field type-checked.
export interface MemoryActionEventView {
  action: string;   // "forget" | "remember" | "reassert"
  outcome: string;  // "applied" | "refused-<code>"
  fact_text: string;
  actor: string;    // "agent"
  created_at: number;
}
export interface HatchView {
  messages: ThreadMessage[];
  distilledFacts: DistilledFactView[];
  distillationEvents: DistillationEventView[];
  memoryActionEvents: MemoryActionEventView[]; // 2c D9b — render-only audit trail
}
```

- [ ] **1.1 — Failing render test** (`render.test.ts`): `renderAuditEvents(el, [{action:"forget",outcome:"applied",fact_text:"likes tea",actor:"agent",created_at:1}])` renders text containing `"forget"`, `"applied"`, `"likes tea"`, and an agent-attribution token (`"agent"`); a `refused-refused_human_fact` row renders its outcome; `renderAuditEvents(el, [])` renders an honest empty state (`"No memory actions."`). Assert NO `.act-btn`/`.act-forget`/`.act-edit`/`.inline-editor` exists in the rendered subtree (render-only guard).
- [ ] **1.2 — Run, verify FAIL** — `bun test apps/overlay/src/memory/render.test.ts` → FAIL.
- [ ] **1.3 — Implement `renderAuditEvents`** in `render.ts`, modeled on `renderEvents`, textContent-only (agent-vs-distiller attribution via `actor` + a labeled list distinct from the distiller's).
- [ ] **1.4 — Add the panel** to `memory.html` `#thread-view` (after "Distillation events").
- [ ] **1.5 — Wire the element** in `memory.ts`: `actionsEl: el("actions-container")`.
- [ ] **1.6 — Wire the controller** (`controller.ts`): add `actionsEl` to `MemoryControllerEls`; import `renderAuditEvents`; in `loadThread` render Loading/LOCKED/DOWN states + on success `renderAuditEvents(els.actionsEl, r.data.memoryActionEvents ?? [])` — read the declared field directly; no `as`/`any`. In `applyDownState`/`renderActionError` add the clear.
- [ ] **1.7 — Controller test** (`controller.test.ts`): stub `fetchFn` returns a `HatchView` with one `{forget,applied}` row → actions element renders `"forget"`/`"applied"`; a down transition clears it.
- [ ] **1.8 — Run, verify PASS** — `bun test apps/overlay/src/memory/` green.
- [ ] **1.9 — Type-checked-consumption + no-cast check** — `bun run typecheck` green; `rg -n "as HatchView|as any|as unknown|memoryActionEvents as" apps/overlay/src/memory` shows NO cast on the audit field. `bun run lint:strict` green.
- [ ] **1.10 — Commit** — `feat(2c-04): Memory-window audit render (render-only events list + agent attribution; type-checked D9b consumption)`.

---

### Step 2 — Deterministic full-path E2E WS probe + demo-runway prep

**Named DoD:** an EXECUTED, deterministic probe drives a WS turn against a real `startDaemon`, the real tool loop forgets a fact through the real `MemoryActionPort`, and `GET /memory/thread/:id` shows the fact gone + a `{forget, applied}` audit row — output pasted in the PR (Strike-5); the harness real-mode polls-until-fact-present; the chunk-02 probe scenario-2 uses the capability-present prompt.

**Files:** `memory-action-e2e-ws-probe.ts` (new), `memory-demo-harness.ts` (modify), `memory-action-tool-probe.ts` (modify).

- [ ] **2.1 — Write the probe** `packages/daemon/scripts/memory-action-e2e-ws-probe.ts` (model on `memory-action-tool-probe.ts` seed/port pattern + harness `wsTurn` client): temp `AGENTIC_DATA_DIR`; real `store`/`scanner`/`gate`/`port`; seed a source message + ONE cross-thread machine fact (`FACT_TEXT`), capture `factId`; `scriptedClient` (call 1 → `tool_use(memory_forget, {ordinal:1, expected_text:FACT_TEXT})`; call 2+ → `end_turn` text); `provider = createAnthropicApiProvider({client, memoryActionPort:port})`; `server = startDaemon(0, provider)`; read `auth-token`; `wsTurn` a fresh thread ("please forget my favourite colour"); await `session_end` + bounded settle; `GET /memory/thread/:id` with Bearer token → assert no `id===factId` in `distilledFacts` AND a `memoryActionEvents` row `forget/applied`; print tool_use + tool_result + final text + assertions + `PROBE PASSED`; `exit(1)` on any miss; cleanup.
- [ ] **2.2 — Typecheck the probe** — `bun run typecheck` green.
- [ ] **2.3 — EXECUTE the probe (Strike-5 evidence)** — `bun run packages/daemon/scripts/memory-action-e2e-ws-probe.ts`; paste FULL stdout into the PR body. No key required. If it does not reach `PROBE PASSED`, STOP and escalate — do NOT mask.
- [ ] **2.4 — Harness poll-until-fact-present (real mode)** (`memory-demo-harness.ts`): a bounded poll helper (≤8s) replacing the fixed 2c 300/400ms + FACT-EDIT 200ms settles before the audit reads. Real-mode observations stay informational (no `exit(1)`). Stub-mode unchanged.
- [ ] **2.5 — Chunk-02 probe faithfulness** (`memory-action-tool-probe.ts`): scenario-2 forced-final `system` block → `composeSystemPrompt(true)` (+ import). Scenario 1 unchanged.
- [ ] **2.6 — Typecheck + lint** — `bun run typecheck` + `bun run lint:strict` green.
- [ ] **2.7 — Commit** — `feat(2c-04): deterministic full-path WS→tool→Memory-window-API E2E probe + demo-runway prep`.

---

### Step 3 — Frozen byte-diff evidence, full-suite gates, closeout reconcile (STAGED), demo sequencing

**Named DoD:** frozen surfaces byte-diff empty (pasted output); full `bun test` + `lint:strict` + typecheck green on the final branch; the backlog/roadmap reconcile is committed as the closeout stage **(DEFERRED post-demo — see sequencing note)**; Lior's live §5 demo is sequenced BEFORE the chunk flips to done (§6.1).

- [ ] **3.1 — Frozen byte-diff evidence** — `git diff main -- packages/protocol packages/daemon/src/providers/mock-provider.ts packages/daemon/src/mock-agent.ts` → MUST be empty; paste in the PR.
- [ ] **3.2 — Full gates** — `bun test` (full repo), `bun run typecheck`, `bun run lint:strict` all green; paste counts.
- [ ] **3.3 — Backlog reconcile [DEFERRED post-demo]** (`memory-backlog.md` §B): flip the IN-PROGRESS bullet to a SHIPPED note; keep the ⚠️ KNOWN RESIDUAL (canonical-vs-display d5 gap) verbatim — rides §D 2d hybrid pass.
- [ ] **3.4 — Roadmap reconcile [DEFERRED post-demo]** (`roadmap.md` "Memory — next"): tick 2c shipped; drop 2c from the queue line; note in open-case A′ tail that the 2c tool-based recall lever now exists.
- [ ] **3.5 — Commit the reconcile [DEFERRED post-demo]** — `docs(2c-04): closeout reconcile — memory-backlog §B + roadmap 2c tick (shipped)`. Do NOT archive chunks 01–04 here — that is the orchestrator's post-verified-done ritual (§4.4).
- [ ] **3.6 — Sequence Lior's LIVE demo (behavioral gate; orchestrator drives).** Verify demo env FIRST: ANTHROPIC key (Keychain), `LLM_PROVIDER=anthropic-api`, incremental provider active, fresh-enough store agreed with Lior, `MEMORY_DEBUG=action,distill,retrieve,forget`. Then Lior runs §5 items 1–5 (see spec §5). **All five GREEN + Lior's sign-off = the feature's behavioral DoD.** A demo-found defect routes back (§7.2/§5.2), never patched inline. If item 2 flakes on LLM non-determinism, the chunk-01 echo-stub test is the mechanical anchor; flag divergence, don't hand-wave.

---

## §7.1 couplings / risk flags

- **Coupling note 7 (audit surface ↔ Memory-window read join) — re-validated at THIS integration.** The join `memory_action_events → hatch.view → GET /memory/thread/:id → overlay HatchView → renderAuditEvents` is completed here. Additive at every hop; the ONLY new type-surface is the overlay `HatchView` widening (Step 1) — type-checked, uncasted. The deterministic probe (Step 2) exercises the full join end-to-end.
- **E2E probe dual-store-handle (Step 2) — flagged, mechanical-to-validate.** The probe's port writes via one `MemoryStore` handle; the daemon reads via its own handle over the same WAL dataDir. Writes are sequential on the critical path (seed → forget → read-after-session_end). Test-only pattern (chunk-02-acknowledged). Running the probe IS the validation.
- **Frozen-surface risk — none expected.** chunk-04 touches overlay + scripts + docs only; the byte-diff gate (Step 3.1) is the guard. Any daemon 2c product-file diff → STOP, route back (§7.2).
- **`system-prompt.ts` byte-diff:** chunk-04 does not touch it; `composeSystemPrompt(true)` is only consumed from a script.

## Review-complete — gate evidence (build pass)

**Commits on `chunk/04-e2e-closeout-demo`:** `24bac59` (Step 1 render) · `64d397a` (Step 2 probe + runway).

**Mechanical gates (command evidence, on the final branch):**
- `bun run typecheck` → PASS (`tsc --noEmit`, no errors).
- `bun run lint:strict` → PASS (`eslint . --max-warnings=0`, no warnings).
- `bun test` (full) → **703 pass / 0 fail**, 2370 expects, 70 files.
- `bun test apps/overlay/src/memory/` → 52 pass / 0 fail, 6 files.
- No-cast grep `rg -n "as HatchView|as any|as unknown|memoryActionEvents as" apps/overlay/src/memory` → **0 matches** (type-checked consumption, D9b).
- **Frozen byte-diff EMPTY** — `git diff main -- packages/protocol packages/daemon/src/providers/mock-provider.ts packages/daemon/src/mock-agent.ts` prints nothing.
- **E2E probe EXECUTED → `PROBE PASSED`** (exit 0, deterministic ×2): real WS turn → real tool loop → real `MemoryActionPort` durable delete → real `GET /memory/thread/:id` confirms fact GONE + `{forget,applied}` audit row. Stdout pasted in the PR.

**engine-reviewer verdict:** **CLEAN 0B/0M** (1 NIT, no change required — probe asserts real persisted end-state, not the tool's self-report; conscious choice). All 7 focus areas clean: type-checked consumption · render-only (no affordance leaked) · XSS discipline · probe honesty (DumbTailProvider only governs background distill, not the path under test) · frozen surfaces · stub-mode intact · no scope creep / no daemon product-code change.

**Deviation on record:** the probe pins `DumbTailProvider` as its background memory provider (3-arg `startDaemon`) — a pre-existing DI seam — to stay key-free/deterministic on a keyed machine; it does not touch the tool loop or read path under test (reviewer-confirmed).

## Status: Review-complete (build pass GREEN, reviewer CLEAN); **behavioral gate OPEN — pending Lior's live §5 demo (§6.1)**. Merge + docs reconcile (Step 3.3–3.5) + §4.4 archival are DEFERRED to post-demo closeout.
