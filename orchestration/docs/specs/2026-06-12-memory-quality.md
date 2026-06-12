---
title: Memory Quality — spec (2a self-awareness + 2b smart distiller)
status: draft
date: 2026-06-12
deciders: [lior]
feeds: memory-quality
implements: adr/0012-conversation-and-memory-model
route-part: 1 (quality pass on the shipped memory foundation)
tags: [spec, memory, distiller, self-awareness, projection, llm, provenance]
---

# Memory Quality — spec

> **Pipeline placement.** CONDITIONAL `spec` stage (PIPELINE §3) for the **memory-quality**
> feature. The design is **thick** (a projection-contract redefinition + an LLM-in-distill
> contract shared across chunks), so the shared decisions are frozen once here.
> `status: draft` → **Lior signs off** (`accepted`, §5.2 gate) → the chunk files in
> `chunks-todo/memory-quality/` execute it. **No chunk may re-litigate a decision frozen
> here without an ADR escalation.**
>
> **Decision provenance:** every decision below was routed through the dev-bus
> (PIPELINE §11.4) and ruled by the conductor — q#001 (2b distiller contract), q#002
> (2a self-concept), q#003 (global-projection semantics, post-grill). The adversarial
> grill pass (engine-reviewer subagent) ran 2026-06-12; its BLOCKER/MAJOR findings are
> folded in and cited inline as (grill #N).
>
> **⚠️ §5.2 ATTENTION AT SIGN-OFF → read §4 "Guarantees & their boundaries" first.**
> It clarifies the *strength* of an ADR-0012 non-negotiable (fact-level forget under a
> generative distiller is BEST-EFFORT; message-level forget stays HARD). The conductor
> escalates that section explicitly; Lior must consciously bless it.

---

## 1. Purpose & scope

Fix the two live memory defects exposed by thread `1ba9f64d` (2026-06-12, see
`../2026-06-12-memory-quality-scope.md` — the scope note of record):

- **(2a) Memory self-awareness — the *disowning* defect.** The agent USED injected
  cross-thread memory (answered "3"; the provenance→History link fired) and then claimed
  *"I have no long-term memory, I'm stateless"* and *"I made up the 3"* — both false.
  Root cause: the system prompt (`anthropic-api-provider.ts:29`) never tells the agent it
  HAS a persistent memory, so meta-questions fall back to the base-model "stateless LLM"
  self-concept.
- **(2b) Smart distiller — the *imprecise-recall* defect.** The "3" was a fuzzy guess over
  a verbatim dumb-tail (`distilled_facts` rows are literally "hi", "Привіт, Ліор!").
  Counting / structured recall can't be precise over a verbatim tail. The MF-02
  `MemoryProvider` port makes this a **provider swap, not a re-plumb**.

**In scope:** 2a + 2b ONLY — backend/agent, no UI dependency. The demo uses the existing
`history.html` hatch.

**Out of scope (recorded, with WHY — PIPELINE §7.2):**
- **In-overlay hatch UI** — separate follow-on feature; its prerequisite (tray-icon +
  settings-overlay shell, ADR-0006 p.4) is deferred. UX backlog items **A** (history.html
  🔒 locked state) and **B** (auth-token trailing-`%` trim) move WITH that follow-on.
  **No chunk here may touch `history-page.ts`** (grill #12 over-reach guard).
- **Archive summarization / hierarchical distillation tier** — the named future fix for
  the O(total archive) re-projection cost (q#003 Sub-1 rider; §3.3 below).
- **Incremental "re-distill only changed threads + merge"** — REJECTED, not deferred
  (q#001 Sub-2, q#003 Sub-1): merge logic reintroduces a second source of truth.
- **A typed/`kind`-widened fact shape** — REJECTED for now (q#001 Sub-1): nothing consumes
  types today (injection flattens to prompt text; retrieval is recency+scope SQL).
  Stays additive-later if a semantic query engine ever lands.

---

## 2. Frame carried (locked elsewhere, not re-decided here)

- ADR-0012: one agent that remembers; two stores; transparency 5a–f; **HARD INVARIANT**
  (MF-spec §3.2): archive = lossless event-history; distilled slice = disposable,
  **re-derivable projection**; forget hard-scrubs content, the event/tombstone remains.
- MF-spec §3.3/§3.4: the checkpoint quartet + 5b consolidation-hook; MUTATION-AS-APPEND;
  tombstone-honoring reads (`readThreadMessagesForDistill` redacts).
- LLM-in-distill is **already Lior-approved** (port comment Q3, `memory-provider.ts:25-26`).
- Frozen surfaces: `@agentic/protocol`, the `mock-agent.ts` reducer. The MF-02
  `MemoryProvider` port is **NOT frozen** (conductor-confirmed, q#001) — its semantics
  change deliberately in §3.2.

---

## 3. Spec decisions

### 3.1 — 2a: memory self-concept (q#002)

**D1. Placement: STATIC-ALWAYS, shared module.** New
`packages/daemon/src/providers/system-prompt.ts` exports, as ONE module:
- the base prompt (today's "concise assistant" text),
- the **memory self-concept paragraph**,
- the **`REMEMBERED_LABEL`** constant (the `[remembered] ` prefix — today hardcoded in
  `dumb-tail-provider.ts:65` and `fixed-marker-provider.ts:62`; both import it instead).

The anthropic adapter composes `system = base + self-concept`. The text is phrased
**truthfully and unconditionally** (fixes fact-less threads too — the (B)/(C) options
don't, q#002):

> "You are one persistent agent with memory across conversations with this user.
> Messages labelled `[remembered]` are your own recollections from **past**
> conversations; **unlabelled earlier messages are part of THIS conversation** —
> attribute only `[remembered]` facts to past conversations. If no `[remembered]`
> messages appear, nothing relevant is remembered — never claim to be stateless or that
> you cannot remember. The user can view, edit, and delete what you remember via the
> History page. Never invent or write out a History link yourself — when you use a
> remembered fact, a link is attached automatically."

(Exact final wording is architect-time; the **bolded discriminator** (grill #7), the
never-claim-stateless clause, the view/edit/delete mention, and the **no-fabricated-links
rule** (q#002 rider — the link is stamped mechanically post-reply by
`index.ts`/`stampProvenance`) are FROZEN requirements of the text.)

**D2. No new ADR** (q#002): the self-concept *implements* ADR-0012 decisions 1+4; the
disowning was a bug vs the committed model. This spec is where the prompt contract is
frozen; Lior reviews the text at sign-off.

### 3.2 — 2b: the projection contract (q#001 Sub-2 + q#003)

**D3. Fact shape stays THIN** (q#001 Sub-1). `DistilledFact` remains
`{fact: string, provenance, scope, expiry, confidence, authored_by}`. The smart distiller
emits **canonical, deduplicated natural-language sentences** ("user greeted 3 times
(threads X,Y)"; "favourite colour: blue"). Precision is fixed by WHERE structure is
computed (distill-time, one careful pass) — not by typed columns.

**D4. GLOBAL RE-PROJECTION.** `MemoryProvider.distill()` is **redefined**: it returns the
**COMPLETE projection over the whole tombstone-honored archive**, not one thread's facts.
- **Signature kept**: `distill(store, threadId)` — `threadId` = the trigger thread
  (recorded in the event rows); the projection itself iterates `listThreads()`
  (store.ts:437). `DistillResult.threadId` keeps the trigger-thread meaning (grill #2).
- **DumbTail + FixedMarker are updated** to loop all threads (one tail / one count-fact
  per thread) so the swap-proof test stays meaningful; **both stay registered**.
- **Registration flow** (`registerDistiller`, grill #1): compute the projection FIRST
  (the LLM call, **outside any transaction** — an open-tx-await stalls the
  single-connection daemon, grill #6) → **scan EACH fact** (5d scanner + per-fact
  quarantine recording stay exactly where they are, per-fact pre-insert) → ONE synchronous
  `db.transaction { dropAllDistilledFacts() + insertDistilledFacts(clean) + event rows }`
  → commit. `dropAllDistilledFacts` already 5e-guards human rows (store.ts:338).
- **Failure ordering** (q#001 rider 1 + q#003 Sub-2): on distill failure do NOT drop —
  keep the existing projection intact, write per-thread **failure** event rows
  (`trigger = "reprojection-failed"`, `facts_produced` reflecting the unchanged
  projection) + `console.error`; the next disconnect retries by construction (the archive
  is lossless ⇒ nothing is lost). Never an empty projection from a crash between drop and
  insert.

**D5. Dismiss lifecycle: ONE re-projection per disconnect** (q#003 Sub-2). `close(ws)`
currently loops `touchedThreadIds` → N dismissals. New flow: flip ALL touched threads'
statuses → run **ONE** re-projection → one tx. **5b event semantics (self-describing,
don't overload):** one `distillation_events` row **per dismissed thread** in the run
(preserves per-thread observability in History), with `trigger = "reprojection"` and
`facts_produced` = clean facts in the **RESULTING projection** (same value across the
run's rows). The old per-thread `trigger="dismiss"` rows remain historically valid; a
consumer tells the two meanings apart by the trigger value.

**D6. Human precedence (5e).** Human-authored `distilled_facts` rows survive the replace
(the `!= 'human'` DELETE). Human corrections/tombstones in the archive are honored by the
tombstone-/correction-aware reads the digest uses. If a machine fact contradicts a
human-authored fact, **human wins at injection** (the human row is never dropped; ordering
at retrieve puts human-authored facts ahead of machine ones — mechanism architect-time,
the precedence rule itself is frozen).

**D7. Expiry enforcement.** `readDistilledFactsForThread` gains
`(expiry IS NULL OR expiry > now)` — a purely-additive read-filter (MF-spec §3.3 rule:
no seam ceremony). Test: an expired fact is not injected.

### 3.3 — 2b: smart distiller mechanics (q#001 Sub-3 + q#003 Sub-1)

**D8. The digest** (the LLM input):
- Iterate **ALL threads** (`listThreads()`); bound only the **INTRA-thread** digest —
  the **M most recent messages per thread (M=50 initial, architect may tune)**.
  This is the q#003 Sub-1 ruling (i): completeness across threads is preserved;
  invariant 1/3 stays literally true; token cost is bounded per thread.
- **No silent truncation:** if a thread's digest is truncated at M, log it loudly.
  Never drop whole threads silently.
- Built **only** from tombstone-honored reads (`readThreadMessagesForDistill` — redacts
  scrubbed content) AND **excluding quarantined source messages**
  (`isMessageQuarantined`) — otherwise quarantine is defeated by re-summarization
  (grill #1). Tombstoned-fact exclusions per §4.
- **Scaling limit, accepted consciously:** global re-projection is **O(total archive) per
  disconnect** — fine at personal/dogfood scale NOW. The named future fix is an archive
  summarization / hierarchical distillation tier (out of scope, §1).

**D9. The LLM call:**
- Model **`claude-haiku-4-5`** (bounded extraction — cheapest active model).
  Request shape mirrors the existing adapter: `thinking: { type: "disabled" }`, bounded
  `max_tokens`, **NO `output_config.effort`** (unsupported on Haiku — errors; grill #11),
  no sampling params.
- Key via the existing `resolveAnthropicKey(opts.resolverOpts)` (Keychain in prod,
  `.env` dev gate — gotcha #38 inherited, not re-implemented).
- **Injectable `clientFactory`** DI (same pattern as `createAnthropicApiProvider`) —
  offline tests run a deterministic stub; no test ever hits the network.
- **Never-throw** (port contract): any LLM/parse failure → the D4 failure path.
- **No key ⇒ the selector falls back to dumb-tail with a LOUD log** (the daemon keeps
  working; memory quality degrades, never availability).

**D10. Canonicalization / dedup rules** (what the distiller must produce):
- One fact per distinct entity/preference/aggregate — **deduplicated across threads**
  ("hi"×3 across threads → ONE count fact naming its source threads).
- Counts/aggregates computed at distill time over the digest (the agent then CITES an
  authoritative number instead of guessing at answer time).
- Each fact stamped: `provenance` (source message id(s) — a `messages.id` or a JSON ref,
  per the existing port comment), `scope` (thread-local/cross-thread/global — distiller
  judgment), `expiry` (null unless clearly time-bound), `confidence` (0..1),
  `authored_by: "machine"`.
- Output is parsed defensively; malformed LLM output → the D4 failure path (never a
  partial projection).

### 3.4 — Default flip staging (q#001 Sub-4 + grill #10)

The smart provider lands **selectable but non-default** first (chunk 03); the
`MEMORY_PROVIDER` default flips `dumb-tail → smart` only in the **LAST** chunk (04),
**after** the real-API smoke probe has been EXECUTED green, with an explicit assertion
that the no-key fallback keeps the existing daemon test suite green and deterministic
(after the flip, keyless test environments exercise the fallback path BY DESIGN — the
smart path's coverage comes from the stub-LLM tests + the executed probe, not from the
general suite).

---

## 4. Guarantees & their boundaries  ⚠️ (READ AT SIGN-OFF — conductor escalates this)

> This section clarifies the STRENGTH of an ADR-0012 non-negotiable (decision 5a
> view/edit/**forget**; 5d poisoning surface) under a generative distiller. q#003 Sub-3
> ruling; flagged by the conductor for Lior's conscious blessing.

| Operation | Guarantee | Mechanism |
|---|---|---|
| **Forget a MESSAGE** (the hatch's `forget`) | **HARD** | `forget()` hard-scrubs `messages.content` at the source; every digest is built from tombstone-honored reads, so scrubbed content **never reaches the LLM** and the fact **cannot be regenerated**. Test-covered (D12). |
| **Forget a distilled FACT** (`forgetFact` / fact-level tombstone) | **BEST-EFFORT** | 3 layers: (1) post-filter drops candidates whose provenance matches a tombstoned provenance; (2) post-filter drops candidates whose **normalized text** equals a tombstoned fact's normalized text; (3) tombstoned fact texts are passed to the LLM as explicit exclusions. A generative distiller can still regenerate an equivalent fact under a fresh provenance / rephrased text — **this is not a hard guarantee and is not claimed as one.** |
| **Quarantined source** (5d) | **HARD at the digest** | Quarantined messages are excluded from the digest BEFORE the LLM call (D8) — a poisoned source cannot resurface re-summarized. Test-covered. |
| **Human-authored entries** (5e) | **HARD** | Never dropped by the replace; human-wins at injection (D6). |

**The user-facing consequence:** a user who wants a fact gone *permanently* must forget
the underlying message(s). **Recorded for the follow-on in-overlay UI:** "forget fact"
should offer **"also forget source messages"** so users can reach the hard guarantee.
(If Lior wants a hard fact-forget NOW, that is a spec revision: couple fact-forget to
source-message deletion.)

---

## 5. Verification model (PIPELINE §6; Strike-4/5 scars)

- **Intermediate chunks → real-I/O proof**: real SQLite + files + the real daemon path.
  The ONLY permitted stub is the **LLM `clientFactory`** (network boundary; same accepted
  pattern as the anthropic adapter's injected clients). No mocked store/injection-point.
- **Mechanical proofs carried forward and EXTENDED to the new semantics** (named test
  breakages are listed per chunk so the build worker isn't surprised — q#003 heads-up):
  - **swap-proof** (now: all providers project all threads from the same archive; the
    shared-DB integration test is isolated to a fresh store or set-membership asserts —
    grill #3);
  - **forget-survives-re-derive** — extended with the D12 hard-guarantee test: forget a
    message → run a SMART re-projection with a stub clientFactory that **echoes its
    input** → assert the scrubbed content never entered the digest AND no fact contains it;
  - **lossless integrity** — after a full smart re-projection, `messages`/`mutations` are
    byte-identical (read-only distill cycle);
  - **distillation-observable** — every re-projection writes per-thread event rows;
    **failure is observably distinct from empty-success** (`reprojection-failed`);
  - **quarantine-survives-summarization** — a quarantined source never resurfaces as a
    smart fact (grill #1);
  - **expired-fact-not-injected** (D7);
  - **transactional failure** — LLM failure leaves the previous projection intact.
- **One real-API smoke probe, EXECUTED** (chunk 03 DoD; output evidence in the PR — a
  probe is evidence only when actually run, Strike-5).
- **Behavioral DoD = Lior's LIVE feature-closing demo** (§6.1, non-negotiable):
  1. meta-question ("how does your memory work?") → the agent **owns + truthfully
     describes** its memory (2a);
  2. structured recall ("how many times did I say hi?") → a **precise** answer **with the
     provenance link** → `history.html` (2b);
  3. forget a message via the hatch → a fresh thread proves the fact is gone (the §4 hard
     guarantee, live).
  **Demo env preconditions** (q#001 rider c): ANTHROPIC key present (Keychain),
  `LLM_PROVIDER=anthropic-api`, `MEMORY_PROVIDER` unset (=smart after the flip) — else 2b
  silently demos dumb-tail.

---

## 6. Proposed decomposition (formalized in `chunks-todo/memory-quality/`)

Strictly sequential (shared daemon + store + the `[remembered]` label contract — §7.1
runtime coupling; q#002 Sub-3):

| # | Chunk | Establishes | Depends on | Size |
|---|---|---|---|---|
| **01** | 2a memory self-concept | `system-prompt.ts` (base + self-concept + `REMEMBERED_LABEL`); adapter composes; label single-sourced | none | ~0.5–1 d |
| **02** | 2b projection contract (NO LLM) | distill = complete projection; DumbTail/FixedMarker loop-all-threads; transactional replace + failure path; batch-dismiss (one re-projection per disconnect); `reprojection`/`reprojection-failed` events; expiry filter; all carried tests re-asserted | 01 | ~1 d |
| **03** | smart distiller provider | `SmartDistillerProvider` ("smart", non-default): digest (D8) + haiku call (D9) + canonicalization (D10) + best-effort fact-forget layers (§4); stub-LLM deterministic tests; **EXECUTED real-API probe** | 02 | ~1–1.5 d |
| **04** | default flip + closing demo | `MEMORY_PROVIDER` default → smart; no-key-fallback keeps suite green; demo runbook; **Lior live demo** (§5) | 03 | ~0.5 d |

---

## 7. Open at build (architect-time, NOT spec-frozen)

- Exact self-concept wording (frozen requirements in D1 hold).
- M (per-thread digest bound) tuning; digest serialization format for the LLM.
- The failure-event encoding detail (the `trigger` values are frozen; whether an
  additive `outcome` column is also added is architect-time — beware: `CREATE TABLE IF
  NOT EXISTS` won't alter the existing `~/.agentic-engine/memory.sqlite`; an additive
  column needs a real `ALTER TABLE` migration step).
- Human-wins-at-injection ordering mechanism (D6 rule frozen, mechanism free).
- Normalized-text matching algorithm for the best-effort layer (§4).
- `system-prompt.ts` placement note: memory providers importing the label from
  `providers/` rides an EXISTING memory→providers edge (no cycle; grill #9) — the
  architect may re-home the constant if a cleaner seam appears, keeping ONE definition.

## Related

- [[../adr/0012-conversation-and-memory-model]] — the model; §4 clarifies 5a/5d strength.
- [[../2026-06-12-memory-quality-scope.md]] — the scope note + live evidence (thread `1ba9f64d`).
- [[2026-06-04-memory-foundation]] — the MF spec (port, invariants, verification posture).
- `orchestration/.conveyor/bus/{q,a}/00{1,2,3}-*.md` — the decision record of this spec.
- [[../PIPELINE]] §3 (spec conditional), §5.2 (sign-off gate), §6 (verified-done), §7.1/§7.2.
