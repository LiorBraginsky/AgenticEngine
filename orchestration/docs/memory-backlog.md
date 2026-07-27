---
title: Memory — backlog & deferred work (single source of truth)
status: living
created: 2026-06-16
owner: lior
purpose: One place that captures everything PROPOSED-but-not-yet-built in the memory area, so the next session (or a future Lior) finds it all without relying on chat history. Chat is disposable; this doc is canonical.
related:
  - adr/0012-conversation-and-memory-model.md (the north-star + the "memory transparency day-one" mandate)
  - adr/0015-intent-based-memory-forget.md (forget contract; decision 5 superseded; its retained scrub primitive consumed by 2e 2026-07-28)
  - specs/2026-06-13-memory-distiller-v2.md (what shipped)
  - specs/archive/2026-07-22-thread-forget.md (2e — the arc-closing feature, implemented 2026-07-28)
  - roadmap.md ("Memory — next" — the high-level pointer to this doc)
---

# Memory — backlog & deferred work

> **Walk-away-safe.** Everything we discussed and deferred about memory lives here, grouped and
> pointed-to. Created at the **memory-distiller-v2 closeout (2026-06-16)** by consolidating items that
> were scattered across specs, ADRs, archived chunk notes, bus rulings, the conductor journal, and the
> conversation. If you shut the machine for days, a fresh chat can rebuild full context from this file +
> `roadmap.md` + ADR-0012.

## Where we are (SHIPPED, the baseline)

**memory-distiller-v2 (memory-quality 2a + 2b) — SHIPPED 2026-06-16** (PRs #71+#72 merged to `main`).
Incremental delta distiller (op new/append/replace), durable forget-by-id, suppress-only normalized
dedup, stable replace-on-change, all-facts candidate-pool below a cap (BM25 only as the above-cap
fallback), self-concept module (agent knows it cannot self-forget), language preservation, and the
`MEMORY_DEBUG` (distill/retrieve/forget/inject) + headless demo-harness dev-env. **Backend only.** The
user views/edits/forgets via the loopback **`history.html`** page (browser), NOT in the overlay.
Spec: `specs/2026-06-13-memory-distiller-v2.md` (status: implemented).

**Update 2026-07-10 — Theme A (`memory-transparency-ui`) SHIPPED:** the user now views / edits /
forgets memory **in the overlay** (tray → "Open Memory…"), not only via the loopback `history.html`
page — which stays as the no-install browser fallback. See §A below.

**Update 2026-07-13 — 2c (`memory-action-tools`) SHIPPED + CLOSED:** the
agent now *acts* on memory mid-conversation — `memory_forget` / `memory_remember` tool calls
(daemon-internal action-tool plane, ADR-0016) with the 5d poisoning guardrails, the
capability-conditional honest self-concept, durable audit events, and a render-only audit trail in the
Memory window. **Lior's live §6.1 demo SIGNED 2026-07-13 (all §5 items 1–5 PASS).** The one in-feature
DEFECT (D1 case-duplicate) was **fixed in chunk-05** (merged 2026-07-13) — root cause was
**canonical-language divergence** (tool path stores a user-language canonical, distiller an English
one, so `factExistsByDedupKey` never matched the same statement across paths), *not* case-sensitivity;
fix = add the user-language display-text dedup axis. Two observations (O2/O3) are recorded in
§B. Spec `specs/archive/2026-07-10-memory-action-tools.md` now **implemented** (all chunks 01–05
merged). See §B below.

**Update 2026-07-21 — 2d (`hybrid-retrieval`) SHIPPED + CLOSED**, and **2026-07-22** its post-close
fix pass (PR #107). See §D / §D-post.

**Update 2026-07-28 — 2e (`thread-forget`) SHIPPED + CLOSED — and with it the WHOLE memory arc.**
The user can now erase a whole conversation's CONTENT (overlay Memory window + `history.html`), with
the derived facts deliberately living on (ADR-0012 rider Ruling 2 — fact source-independence, proven
live at the demo). Spec `specs/archive/2026-07-22-thread-forget.md` (implemented). See §C below.

> **⛳ The June-queued memory arc is COMPLETE (2026-07-28).** 2a/2b (`memory-distiller-v2`) →
> Theme A (`memory-transparency-ui`) → 2c (`memory-action-tools`) → provenance-affordance → 2d
> (`hybrid-retrieval`) → the post-close fix pass → 2e (`thread-forget`). **No committed memory
> feature remains queued.** What is left in this file is genuinely optional: dogfood-watch items
> (§D-post), polish observations (§B O2/O3, §C O4/O5), un-triggered scale work (§E/§F,
> archive-summarization), and §G — which is not memory polish at all but the **north-star route**
> (continuation affordance · voice parity · concurrent threads). Picking the next feature is now a
> roadmap-route question, not a memory-backlog question.

The structure is sound for single-user dogfood. Everything below is **deferred / not-yet-built**.

---

## Deferred backlog (grouped by theme)

### A. Transparency & control — the user SEES and CONTROLS memory  ⭐ Lior's #1 vision item
> Vision (ADR-0012 + memory `project_conversational_interaction_model`): *"the user never directly
> contacting the super-chat is the single most expensive mistake."* Build view/edit/forget +
> provenance + expiry day-one. Today this exists ONLY as the browser `history.html` page.
>
> **→ SHIPPED 2026-07-10** — the `memory-transparency-ui` feature (Theme A) shipped: chunks
> 01–05 merged + Lior's joint §6.1 live demo signed. Spec (now `implemented`) =
> `specs/archive/2026-07-02-memory-transparency-ui.md`. Of the two carve-outs below, the
> in-answer provenance affordance is **resolved** (2026-07-13, first bullet); token
> revocation remains deferred.

- **In-overlay memory UI + tray-icon shell + history.html UX tails** — ✅ **SHIPPED 2026-07-10**
  (Theme A). Tray icon status + "Open Memory…" window (no token paste, ADR-0006 p.4 un-deferred);
  in-overlay threads/facts VIEW with per-fact thread-level provenance; distilled-fact-text EDIT
  (durable human "yours" badge, survives restart) + message-correction (session-local tag);
  "release the reference" FORGET (fact-delete, sources untouched); expiry/confidence shown only
  when non-default; honest locked/401/daemon-down states; and the browser `history.html` fallback
  tails (🔒 locked instead of false "Loading…", zsh-`%`/whitespace token-trim). Chunks archived in
  `chunks-todo/archive/memory-transparency-ui/`.
- **In-answer "where did this come from?" provenance affordance** — ✅ **RESOLVED + SHIPPED + CLOSED
  2026-07-13** (spec `specs/archive/2026-07-13-in-answer-provenance-affordance.md` (implemented),
  Lior §5.2 sign-off; chunk `provenance-affordance/01` shipped via PR #93; bus ruling q#016). **Mandate archaeology reversed the carve-out's premise:** the
  earlier «⚠️ ADR-0012 5a names it MANDATORY» wording here was a **mis-attribution** — ADR-0012 5a's
  text is the view/edit/forget *hatch*; the "MANDATORY in-answer affordance" ruling lives in the
  **memory-foundation spec §3.5/§7 (5a-open)**, asks only for a *lightweight generic* "from where?"
  → leads into the memory surface, and was already satisfied by the MF-05 generic line (demo step 6
  signed). **Resolution: O1** — retargeted the generic line to the Memory window (chunk archived at
  `chunks-todo/archive/provenance-affordance/01`; dropped the stale `history.html`
  port-URL); **per-fact in-answer linkage = deliberate deferral, NOT built** (Lior's
  overcomplication concern upheld; revisit triggers: stale-fact wrong-answer incident in dogfood ·
  multi-user · 2d search landing — escalation ladder O2 chip → O3 per-fact, re-gated). **No
  ADR-0012 rider** (nothing in the ADR changes; fallback doc-style rider recorded in spec §0.1 if
  Lior reads the quotes differently). Anchor unchanged: forget stays "release the reference".
  *Lives:* the 2026-07-13 spec (the record); `specs/2026-06-04-memory-foundation.md` §7 (5a-open).
- **Expiry / confidence per fact — decision RECORDED 2026-07-02: leave as-is, do NOT build.** The DB
  columns exist and `retrieve` filters `WHERE expiry IS NULL OR expiry > now`, but the distiller
  hardcodes `expiry: null` / `confidence: 1` — dormant. Ruling: no scoring/decay until Lior's own
  fact base shows stale-fact pain; columns stay (cheap); the in-overlay UI shows these fields only
  when non-default. *Lives:* 2026-07-02 spec (display rule); verified dormant in code 2026-06-16.
- **Token revocation / rotation — noted 2026-07-09 (chunk-03 demo, item 4).** Deleting the
  auth-token FILE mid-session does not lock live windows: both overlay and daemon hold the bearer
  in memory from startup, and file deletion is not revocation (standard bearer semantics; the
  at-load 🔒 locked state works). If revocation ever matters (multi-user, or a leaked-token drill):
  daemon re-reads/rotates the token + rejects stale bearers → live sessions drop. ADR-0013 polish;
  low priority for single-user loopback. *Lives:* here + chunk-03 DONE ledger line.

### B. Conversational forget / memory-action tools  (roadmap 2c)
- **2c — agent memory-action tools.** Today the agent can only *say* "I can't forget — use History"
  (the self-concept module). **2c gives it a real tool** so "forget what I said about X" / "remember Y"
  actually act mid-conversation (wires to `Hatch.forget`/recall). A NEW class of *side-effecting* action
  tools (distinct from UI-render tools). *Deferred:* needs an ADR-0002/0005 closed-set extension + a
  poisoning-surface review (ADR-0012 5d). Shares a design+ADR pass with 2d. *Lives:* roadmap "Memory —
  next"; relay-001; v2-01/04/07/08/09 chunk notes. **This is Lior's "забути що я казав про X без
  адмінки" lever.**
  - **✅ SHIPPED + CLOSED 2026-07-13** — spec
    `specs/archive/2026-07-10-memory-action-tools.md` (implemented) + ADR-0016 (accepted); built 2c only via
    conveyor (chunks 01–05, PRs #86/#87/#88/#89 + chunk-05). Delivered: the `memory_forget` + `memory_remember`
    closed set, ordinal-over-injected-slice targeting, the provider tool loop + `MemoryActionPort` DI,
    the 5d poisoning-guardrail package (incl. the d5 re-derivation suppression), remember→REPLACE
    routing, the capability-conditional self-concept flip, and durable audit events + the render-only
    Memory-window audit trail. **Lior's live §6.1 demo SIGNED 2026-07-13 — §5 items 1–5 ALL PASS**
    (forget→gone+audit-visible · d5 no-re-derive after dismiss+new-thread · 5e refusal on a pinned fact
    + not-in-view honest deferral · d7 injection blob ⇒ ZERO deletions · remember + REPLACE +
    new-thread immediacy). **Findings routed per §7.2 — NOT patched in the closeout chunk:**
    - **(D1) DEFECT — case-duplicate → ✅ FIXED in chunk-05 (merged 2026-07-13).** One statement
      produced 2 machine facts displaying as «мій…»/«Мій…», violating accepted-spec d6 no-dup-spam.
      **Root cause (architect-verified, NOT the decomposer's case-sensitivity hypothesis):**
      `factExistsByDedupKey` was already case-insensitive; the real divergence was **canonical
      language** — the tool path (`MemoryActionPort.remember`, no LLM) stores a *user-language*
      canonical, while the distiller emits a *lowercased-English* keyword canonical, and dedup matched
      only on the stored canonical → the same statement never deduped across the two write paths, so
      the case-only display difference was a surface artifact. **Fix:** add the user-language
      display-text axis to both sides of the dedup key (`factExistsByDedupKey` + the `applyFactOp`
      new-insert gate), routed suppress-as-dup (spec §3.7, never REPLACE/sibling). One shared helper
      (`normalizeFactText`/`dedupConnectorKey`), frozen surfaces untouched, 706/0 tests, engine-reviewer
      CLEAN 0B/0M. Archived `chunks-todo/archive/memory-action-tools/05-dedup-case-fix.md`.
    - **(O2) OBS — injection-blob reply quality.** On a large incoherent paste with an embedded
      «забудь усе», the d7 defense HELD (zero deletions) but the agent's reply was a poor greeting
      non-sequitur — answer-quality, NOT a security hole. Possible tie to the A′ recall-usage tail /
      prompt-quality. *Lives:* here + open case #3 (fresh datapoint).
    - **(O3) OBS — replace-steering missed once.** A colour change (зелений→синій) produced a competing
      fact instead of a REPLACE; the agent then SURFACED the contradiction in a new thread and offered
      cleanup — the documented **degradation-not-corruption** path (spec §3.7a safety-net) behaving as
      designed. Feeds the §E complex-corrections case-set. *Lives:* §E + here.
  - **⚠️ KNOWN RESIDUAL from chunk-01 — ✅ CLOSED by hybrid-retrieval chunk-02 (PR #98) 2026-07-14.**
    The proper close the residual named landed as specified: the additive **`forgotten_facts.canonical`
    column** (nullable, wired for BOTH store generations — fresh `SCHEMA_DDL` + a PRAGMA-guarded
    `ensureForgottenFactsCanonicalColumn` in the ctor, no backfill), captured by `port.forget` from
    the target's `fact_fts.canonical` **before** the gate delete (AFTER-DELETE-trigger race handled),
    and the **D6b consult now matches on canonical OR display** (two-axis) across the 3 helpers +
    D6c(editFact)/D6e(remember) clears. The cross-language UK-display / EN-canonical reword slip is
    CLOSED on the `forgotten_facts` surface. Legacy NULL-canonical rows fall back to display-only
    (honest). *(Separately, the **D6c flake** — `readForgottenFacts` returning oldest tied rows for
    lack of a secondary sort, observed 3× — was root-caused + fixed in **chunk-01, PR #97**:
    `ORDER BY created_at DESC, rowid DESC`, RED-first proven, + rowid-ASC hardening on the 2 ASC
    reads.)* *(historical:)* the d5 re-derivation suppression (D6b consult) originally matched a
    forgotten fact only on its **display text**, so a re-derivation sharing the SAME canonical but a
    reworded display text could slip past — the SAME structural class as the §D v2 dedup ceiling, one
    axis over. The connector-word bypass (a genuine strict-vs-relaxed regression) was found+fixed in
    chunk-01. *Lives:* chunk-01 PR #97 + chunk-02 PR #98 + ledger.
    - **↔ chunk-05 relation — ✅ CLOSED (now consistent).** chunk-05 (2c D1 fix) had aligned the
      *sibling* **live-fact** dedup (`factExistsByDedupKey` matching BOTH English canonical AND
      user-language display); this residual — the separate **`forgotten_facts` D6b consult** surface —
      is now closed by chunk-02's `forgotten_facts.canonical` column above. Both surfaces (live-fact
      dedup + forgotten-fact consult) now match on the canonical axis; the reworded cross-language slip
      that was 2d's to close is closed on both.

### C. Content erase — thread-forget  (roadmap 2e)  ✅ SHIPPED + CLOSED 2026-07-28
> **✅ 2e — thread-forget SHIPPED + CLOSED 2026-07-28.** Spec
> `specs/archive/2026-07-22-thread-forget.md` (implemented); **no new ADR** (spec §0.6 — it executes
> ADR-0012 rider Ruling 2 + the ADR-0015 retained scrub primitive + the ADR-0013 write posture).
> Built via conveyor in 3 sequential chunks (PRs **#110 / #111 / #112**, decompose PR #109):
> **`WriteGate.forgetThread` = ONE atomic tx** (per-message tombstone + `content='[forgotten]'` +
> `deleteMessageDerived` clearing FTS/embeddings + `status='forgotten'`/`title=NULL` husk +
> `memory_action_events.fact_text` scrub + legacy-correction plaintext scrub; post-tx DB-first mirror
> redaction) · **Ruling 2 honored STRUCTURALLY** — zero fact-table references, grep-proven, and the
> ×2-flagged dormant fact-sweep (`dropDistilledFactsByProvenance` / `dropDistilledFactsForThread`)
> was **deleted** and its 6 pinning tests flipped RED-first to *facts survive* · additive
> `target_type:"thread"` on `POST /memory/forget` (401/400/404/**409 `thread_live`**/204 +
> idempotent) · the `isThreadLive` refcount registry + §3.3a *erased id is never re-adopted* ·
> arm→confirm with the FROZEN §0.2 copy and a real message count, in **both** surfaces (overlay
> Memory window detail view + `history.html` fallback) · the honest **husk banner** replacing the
> message list while the facts section still renders live (the visible Ruling-2 proof).
> **Lior's live §6.1 feature-closing demo SIGNED 2026-07-28** — husk+banner · THE TRAP live (a fact
> SURVIVES the erase and is still injected into a NEW thread, log-confirmed) · audit-skeleton
> `[forgotten]` scrub · live-guard 409 · CANCEL. Bonus finding: asked to thread-forget, the agent
> honestly REFUSED and pointed at the Memory window — the deliberate §3.6 *absence* (no agent-side
> thread-forget tool; ADR-0016 untouched) working live. Frontier-delta held for a 6th/7th/8th
> consecutive chunk (`hard-reviewer` caught a MAJOR each chunk that the Opus reviewer missed —
> headline-test hole · stranded-refcount + plaintext-onto-husk · stale-409 cross-thread clobber).
> **This closed the entire June-queued memory arc** (2a/2b → Theme A → 2c → provenance-affordance →
> 2d → fix pass → 2e). *Artifact note:* chunks 01–03 + the chunk-01/02 plans are archived under
> `chunks-todo/archive/thread-forget/` and `plans/archive/thread-forget/`; **chunk-03 shipped without
> a separate plan file** (worked straight off the chunk brief) — nothing is missing.

**Observations from the 2026-07-28 demo (NOT defects — polish candidates, nothing queued):**
- **O4 — the audit `fact_text → [forgotten]` scrub is redundant when the same fact survives
  visibly one section up.** Per Ruling 2 the fact itself stays and renders in the Memory window's
  facts list with its full text, while its own `memory_action_events` audit row shows `[forgotten]`.
  Internally consistent (two rulings meeting: audit rows are thread *content*, facts are not), but
  it reads as noise-with-no-privacy-gain to a user who can see the text right above. *Minor UX
  polish candidate:* either render the surviving fact's text in its audit row, or drop the scrubbed
  rows from the render. Revisit trigger = dogfood confusion at the audit section.
- **O5 — demo item 4's PURE archive-search miss was never strictly exercised.** The intended proof
  was «що я казав про X?» → the archive leg finds nothing from the erased conversation while the
  facts leg still carries the surviving fact (the designed §3.6 asymmetry). In the live run the
  surviving fact **pre-empted `memory_search` entirely** (logs show a retrieve-only turn, no search
  stage), so archive-scrub was proven **indirectly** — audit `[forgotten]` + messages gone + the
  chunk-02 executed probe (which asserts `message_fts`/`message_embeddings` EMPTY for the erased
  thread and the facts leg still surfacing). Honest caveat, recorded rather than papered over.
  *If ever worth closing directly:* erase a thread whose topic has **no** surviving fact, then ask
  about it.

**Accepted residuals (disclosed, ruled acceptable at single-user dogfood scale):**
- **Mirror crash-window (chunk-01).** The JSONL mirror is redacted **after** the DB transaction
  commits (DB-first ordering, deliberate). A crash in that window leaves plaintext in the mirror
  file while the DB is already erased. Accepted: DB-first is the right ordering (the DB is the
  read surface), and the window is milliseconds on a local single-user machine. Revisit if the
  mirror ever becomes a read/export surface.
- **TOCTOU on the live-thread guard (chunk-02, spec §0.5).** `isThreadLive` is a point-in-time
  refcount check with no lock, so a thread could in principle bind between the check and the
  scrub. Accepted at single-user scale — and the two concurrency guards that shipped (unconditional
  decrement-on-close + the guard on the HOT `appendTurn` path) compose so that **erase always wins
  structurally**: a late bind cannot append plaintext onto a forgotten husk. Revisit at
  multi-client / concurrent-threads (route part 5).

*(historical charter below — the deferral record 2e executed)*

- **thread-forget** — forget a WHOLE conversation (content-erase), the chosen replacement for the
  dropped per-message message-forget. Scrubs the thread's messages (reuses the dormant, already-built
  `WriteGate.forget` hard-scrub primitive). **⚠️ RULING CHANGE (Lior 2026-07-10, ADR-0012 rider
  Ruling 2 — fact source-independence): thread-forget does NOT delete the thread's facts.** Facts
  change/disappear ONLY via manual edit / prompted edit (2c) / explicit fact-forget; the earlier
  "deletes its facts" sketch here is SUPERSEDED. *Deferred:* its own feature; pairs with
  2d (a forgotten topic could otherwise resurface via message-search). *Lives:* ADR-0012 rider
  2026-07-10; `specs/2026-06-13-memory-distiller-v2.md` §1/§3.6; roadmap.
  - **⤳ NOW UNBLOCKED (2026-07-21) — 2d shipped the coupling this bullet predicted.** The
    `memory_search` READ tool (2d chunk-05) makes the archive genuinely searchable, so a
    conversation the user "forgot" can now resurface its content via archive search — the exact
    reason §C said thread-forget "pairs with 2d." The scrub primitive (`WriteGate.forget`) is
    already built and dormant; the 2e WriteGate Ruling-2 trap (thread-forget must NOT sweep facts —
    fact source-independence) was flagged twice during 2d (chunk-03/05) for the 2e designer. 2e is
    the next feature after the D-post fix pass drains.

### D. Retrieval quality — semantic candidate-fetch  (roadmap 2d)  ⭐ the root fix — ✅ SHIPPED + CLOSED 2026-07-21
> **✅ 2d — HYBRID retrieval SHIPPED + CLOSED 2026-07-21.** Spec
> `specs/archive/2026-07-13-hybrid-retrieval.md` (implemented); ADR-0017 (`EmbeddingProvider` plane +
> egress posture, accepted with the spec) + ADR-0016 d7 rider (archive-search injection channel).
> Built via conveyor (chunks 01–07): **HYBRID candidate-fetch = FTS5 BM25 ∪ brute-force embedding
> cosine, fused via RRF (k=60)** on the above-`ALL_FACTS_CAP` lane (below-cap all-facts pool byte
> unchanged); `EmbeddingProvider` plane w/ the **local-wasm `onnxruntime-web`-DIRECT** lane
> (no-egress + zero-infra — Lior Lane-A ruling after the transformers.js WASM spike failed on Bun,
> q#018); `fact_embeddings`/`message_embeddings`/`message_fts` storage (brute-force cosine over a BLOB
> col — no `sqlite-vec`, gotcha #47 avoided); a restart-safe stateless embedding drain; the
> `memory_search` READ tool on the ADR-0016 read slot (id-free non-targetable results, scanner +
> untrusted framing); embed truncation to the model 512-window + poison-row isolation (chunk-07, from
> the D3 live-demo finding). **Lior's live §6.1 feature-closing demo SIGNED 2026-07-21 — all §5 items
> 1–5 GREEN** (1a REPLACE-chain · 1b the RED→GREEN above-cap thesis via the conductor-run `--suite=2d`
> · 2 cross-language archive search · 3/4/5). PRs #97/#98/#99/#100/#101/#103 (chunks) + #102 (e2e/demo
> closeout). Findings routed as a **separate post-close fix pass** (Lior chose close-first) — see the
> **D-post** block below.
- **2d — on-demand archive retrieval + SEMANTIC (embeddings) candidate-fetch.** ✅ **SHIPPED (see
  callout).** *(historical)* The PROPER
  cross-language / reworded retrieval. The current BM25 (matching the user's Ukrainian tail against the
  English LLM canonical) is why the demo-3 colour-change duplicated; the all-facts-below-cap pool is the
  cheap stopgap. **2d (embeddings) supersedes BOTH** once the corpus outgrows "pass them all." First cut
  could be FTS5 keyword search over the message archive; vector/embeddings as a swappable provider.
  *Lives:* `specs/archive/2026-07-13-hybrid-retrieval.md`; `specs/2026-06-13-memory-distiller-v2.md` §1/§3.4 (superseded-lane cross-note); q#008;
  `research/2026-07-13-hybrid-retrieval-bm25-embeddings.md`.
- **2d shape = HYBRID retrieval (BM25 + embeddings) — Lior direction 2026-07-10** ✅ **SHIPPED as
  ruled** (RRF fusion of the two legs, not embeddings-only). *(historical)* Recorded at the
  memory-transparency-ui joint demo, on the accepted-as-known v2 dedup ceiling: combine lexical BM25
  with semantic embeddings so exact-term matches and cross-language/reworded matches both land — the
  dedup ceiling (a cross-language re-derivation slipping past normalized dedup) is the concrete miss
  the hybrid ranker closes (the embedding leg is the ONLY half that closes it cross-script — golden-set
  proven, chunk-04).
- **REMOVE message-edit — DECIDED (Lior 2026-07-10, final), EXECUTION scheduled at the 2d pass.**
  ✅ **SHIPPED — chunk-01 (PR #97).** Message-edit removed end-to-end: overlay Edit affordance +
  `history.html` Edit/doEdit + the `/memory/edit` **message** branch (→ 400 `bad_body`; `Hatch.edit`
  retired as dead — its sole caller was that branch). **KEPT** as designed: `target_type:"fact"`
  edit + the append-only mutation/correction machinery in the store (immutable-history primitive,
  ADR-0015 B1). End state achieved: **archive = read-only immutable history; memory (facts) = the
  editable surface** (ADR-0012 rider 2026-07-10 Ruling 1 executed). *(historical rationale:)* with
  fact-edit shipped as the real "correct what the agent remembers" lever, the archive
  message-correction surface was pointless ("бестолковий") — per fact source-independence it fed
  nothing downstream. *Lives:* chunk-01 PR #97 + ledger; ADR-0012 rider 2026-07-10 Ruling 1.

### D-post. 2d post-close fix pass — ✅ FIX PASS SHIPPED 2026-07-22 (PR #107); residuals = dogfood-watch
> The 2d live §6.1 demo signed GREEN on all five items; Lior chose **close-first** and routed the
> findings here. **memory-fix-pass/01 MERGED 2026-07-22 (PR #107, 815/0, reviewer 0B/0M/0m):**
> D4 RESOLVED (Lior ruling 2026-07-22, option A — REPLACE re-stamps provenance to the REPLACING
> thread in the one shared `applyFactOp` lane, both call-paths; `replaced_facts` keeps the prior
> text) · D1-lang + D2 steering SHIPPED (capability-present lane only, language-agnostic wording,
> propose-then-consent; absent lane byte-pinned) · `isFactVisibleToThread` extracted · `doWarmup`
> early-exit · harness arg-parse fail-closed. **Remaining below = dogfood-watch (D1/D2 steering
> efficacy proves out in daily use) + the Watch block + O2/O3 observations — no build queued.
> QUEUE HEAD → §C 2e thread-forget.**

**Steering (prompt/self-concept level — no schema/wire change; the bulk of this pass):**
- **D1-lang — stored-fact AND reply language must follow the USER's utterance language.** 4 demo
  datapoints (2026-07-16 + 2026-07-21): an EN statement stored as a UA fact; EN→UA / UA→UA / EN→EN
  eye-colour transitions nondeterministically; a reply came back half-UA/half-EN on an EN question.
  The LLM picks the language on a whim rather than mirroring the user. **LANGUAGE-AGNOSTIC steering
  fix** — follow the user's utterance language, **no UA-specific machinery** (binds Lior's 2026-07-14
  ruling; the architecture is already canonical-key/multilingual-embedding language-neutral).
- **D2 — unprompted duplicate cleanup.** The agent forgot/cleaned up duplicate facts *without being
  asked* — violates the prompted-edit spirit (act on memory only when the user prompts it). A
  self-concept / prompt steering fix; guardrails d1–d7 held perfectly (this is behaviour tuning, not
  a security gap). *(2c demo-finding D2, carried 2026-07-16 → 2026-07-21.)*
- **O2 — injection-blob reply quality** (carried from 2c, open-case #3): on a large incoherent paste
  with an embedded «забудь усе», the d7 defense HELD (zero deletions) but the reply degraded to a
  greeting non-sequitur. Answer-quality / prompt-quality on the recall-usage A′ tail — re-measurable
  against the live 2c tool path.
- **O3 — replace-steering miss** (carried from 2c): a colour change once produced a competing fact
  instead of a REPLACE; the agent then surfaced the contradiction + offered cleanup (the documented
  degradation-not-corruption safety-net, spec §3.7a). Feeds the §E complex-corrections case-set.

**Mechanical (small, scoped code fixes; one needs a Lior ruling first):**
- **D4 — REPLACE keeps the ORIGINAL thread provenance** — ✅ **RESOLVED 2026-07-22 (PR #107).**
  Lior ruled option A (provenance = the replacing thread; `replaced_facts` keeps prior text; the
  Memory-window replace-history render was declined — revisit on demand). RED-first tested.
- **`isFactVisibleToThread` extraction** — ✅ **DONE 2026-07-22 (PR #107)**: one predicate, two call-sites.
- **arg-parse fail-open nit** — ✅ **DONE 2026-07-22 (PR #107)**: `resolveSuite` fails loudly on unknown values.
- **`doWarmup` no `ready` early-exit** — ✅ **DONE 2026-07-22 (PR #107)**: early-exit added (no stale-ready hole — `ready` only set on successful load).

**Watch (observe at real scale before deciding to build — no fix yet):**
- **Query-pooling dilution above-cap (Finding 1b, escalated at chunk-06).** `distillOneThread` pools
  the whole tail into ONE query embedding with no last-turn weighting ⇒ above-cap + injection-active,
  a real assistant reply restating injected facts can dilute the query enough to drop the
  contradicting fact out of the candidate top-K → `op:new` → an above-cap duplicate (tied to O2).
  The demo-watch flag did **NOT** manifest at Lior's scale on 2026-07-21, but watch scene-(b)-shaped
  turns at larger real scale: a red REPLACE above-cap = this retrieval-input dilution, not just LLM
  steering (spec §3.8b attribution). Lever if it bites: last-turn / recency weighting on the query
  embedding, or first-envelope streaming.
- **7 sequential model calls vs the overlay 30s handshake (#42/#43 tie, chunk-05 backlog).** The
  raised loop bound (`MEMORY_ACTIONS_MAX_PER_TURN` + `MEMORY_SEARCH_MAX_PER_TURN` + final text) can
  reach up to 7 sequential Sonnet calls; a search-heavy turn could false-timeout the overlay 30s
  handshake window until in-loop-deadline / first-envelope streaming lands. Bound is spec-frozen
  (§3.6 D6b); record the risk, revisit when streaming lands.

### E. What's remembered / fact richness
- **Complex corrections & deletion-via-statement — NOT specced (open case).** Replace currently fires
  only on a single-attribute USER contradiction ("colour is now green"). Unhandled / untested: *"I don't
  work in IT anymore"* (a deletion expressed as a statement — should it forget the work fact?), partial
  edits, multi-fact statements. The distiller has no defined behavior here. **This is a case-set Lior
  likely had in mind — capture it before designing E.** *Lives:* nowhere yet — recorded here.
- **Kind-typed / structured fact fields** (entity / preference / count with typed values) — **RULED OUT**
  for now (see Ruled-out below), but explicitly "additive-later if a semantic query engine lands."
- **Topic-based fact consolidation («append-механізм») — anticipated, NOT designed (Lior 2026-07-10,
  at the 2c spec sign-off).** When facts get grouped/merged by topic, the mutation machinery is the
  2c-extracted `applyFactOp` core (spec 2026-07-10 D7a-bis rider): the replace lane is expected to be
  reused, plus a DISTINCT consolidation/append-style op added as a new handler. The 2c build keeps the
  core simple-but-extensible for exactly this; design the op itself when topic-grouping work starts.
  *Lives:* spec 2026-07-10-memory-action-tools D7a-bis rider + chunk-01 design note; here.

### F. Injection architecture — variant B
- **Variant B — render facts into the SYSTEM prompt** instead of `[remembered]` user-messages.
  Architecturally cleaner per-turn injection; pairs with 2c/2d. *Deferred:* from v2-08 — the
  `[remembered]`-as-messages format is load-bearing across the system prompt + provenance-stamp + tests;
  too big a rewrite for the recall fix (variant A — re-inject every turn — shipped instead). *Lives:*
  roadmap; conductor journal; v2-08/09 chunk notes.

### G. Adjacent — north-star route (not strictly "memory polish", but the super-chat vision is coupled)
- **Text continuation affordance** — Live Card (inline reply on the answer) vs Continuation Pill
  (re-summon with a context pill). A build-time choice deliberately left open. *Lives:* ADR-0012;
  `project_conversational_interaction_model`; roadmap route part 2.
- **Voice parity** — co-equal voice+text ("both just add a turn to a thread"). *Lives:* ADR-0007; roadmap Phase 4.
- **Concurrent threads / background tasks** (gotcha #45) — multiple live threads + long-running work; the
  single-session `inFlight` guard blocks new input while the agent works. *Lives:* `project_concurrent_
  session_context_model`; open-questions Q12.

---

## Ruled out (do NOT re-propose without revisiting the recorded "why")

- **Kind-typed structured fact fields** — rejected (nothing consumes types today; injection flattens to
  text; precision comes from WHERE/WHEN structure is computed, not schema types). Revisit only if a
  semantic query engine lands. [q#001 Sub-1]
- **Option B: "forget fact AND its source messages"** (dual-delete hard-escape) — SUPERSEDED. v2's durable
  fact-delete + no-re-derivation makes the source-scrub redundant. [ADR-0015 decision 5; relay-005]
- **Per-message message-forget as a user path** — DROPPED. The agent uses FACTS, not raw archive;
  fact-delete already removes it from the agent's view. Replaced by **thread-forget** (§C). [v2 spec §3.6]
- **Global re-projection distiller (the original 2b)** — proven UNSTABLE on Lior's 2026-06-13 demo
  (facts churned/reordered/vanished); re-architected to the incremental distiller that shipped.
- **Finer (message-level) provenance** — CLOSED 2026-07-02 (was §A, deferred since v2-06): no concrete
  benefit identified — thread-level provenance suffices for "where from", and the finer-forget upside
  died with per-message forget (already ruled out above). Revisit only if a real "dig deeper" need
  shows up in dogfood.

---

## Open cases worth capturing before the next design pass
*(these have no home in any spec yet — they would be lost if not written here)*
1. **Complex corrections** (§E): negation / deletion-via-statement ("I don't work in IT anymore"),
   partial edits, multi-fact statements. No defined distiller behavior.
2. **Expiry / confidence are dormant** (§A): plumbing exists, values hardcoded — decide if/when facts
   should age or be confidence-weighted, or rip the dead columns.
3. **Recall-usage A′ tail** (LLM-fuzzy): the structural turn-2+ loss was fixed (v2-08); the residual is
   the model occasionally not USING an injected fact. Asymptotic; 2c (tool-based recall) is the likely
   lever — **now LIVE (2c shipped 2026-07-13)**, so the tail can be re-measured against the real tool
   path. **Fresh datapoint: O2** (2c live demo, 2026-07-13) — on a large incoherent injection blob the
   reply degraded to a greeting non-sequitur (the d7 defense held; answer-quality suffered), an
   answer-quality / prompt-quality signal on this same tail. *Lives:* roadmap; §B (O2).
4. **Archive-summarization tier**: the O(archive) scaling trigger; also the point at which the
   candidate-fetch flips from all-facts → semantic (2d). *Lives:* roadmap; spec §3.3 D8.
5. ~~**Should message-edit re-trigger fact derivation?**~~ **MOOT (Lior 2026-07-10, same day):**
   message-edit itself is decided-for-removal (§D) — with no message-edit there is no re-derivation
   question. Kept struck-through for the record only.

---

## Vision anchor (read this first when picking up)
The north star is in **ADR-0012** + the memory `project_conversational_interaction_model`:
one agent · co-equal voice+text · **agent paradigm, not chatbot** (ephemeral widgets, not a chat log) ·
memory = "super-chat" (threads distill into a persistent store; new threads draw on it) · and the
**day-one transparency mandate**: keep memory invisible by default BUT build view/edit/forget +
provenance + (recoverable, explicit) distillation + never-overwrite-human + thread-isolation. The single
costliest mistake to avoid: an opaque always-injecting store the user can't inspect (churn + poisoning
surface). **Theme A was the direct execution of that mandate — SHIPPED 2026-07-10, and as of
2026-07-28 the mandate is fully built out: view (Theme A) · edit (Theme A fact-edit) · forget-a-fact
(release-the-reference) · forget-a-conversation (2e) · provenance (MF-05 + the affordance pass) ·
agent-side action tools with guardrails (2c) · honest liveness/absence states.** What stays dormant
by choice: expiry / confidence (open case 2).

---

## Suggested next step
**⛳ THE MEMORY QUEUE IS EMPTY OF COMMITTED FEATURES (2026-07-28).** Everything the June-2026 arc
committed to has shipped and closed: Theme A `memory-transparency-ui` (2026-07-10) · 2c
`memory-action-tools` (2026-07-13) · provenance-affordance (2026-07-13) · 2d `hybrid-retrieval`
(2026-07-21) · the 2d post-close fix pass (2026-07-22, PR #107) · **2e `thread-forget`
(2026-07-28)** — each with a Lior-signed live §6.1 demo. There is **no queue head in this file
anymore.**

**So the next pick is a ROADMAP-ROUTE question, not a memory question** → `roadmap.md` "The route"
+ §G below. The route's own ordering puts **part 2 — the text continuation affordance** next (Live
Card vs Continuation Pill — the build-time choice ADR-0012 deliberately left open), then part 3
voice parity, then part 5 concurrent threads / background tasks (the deferred
`project_concurrent_session_context_model`).

What remains HERE is optional and un-triggered — pick from it only if dogfood makes it hurt:
- **Dogfood-watch, no build queued** (§D-post): D1-lang / D2 steering efficacy in daily use; the
  two watch items (above-cap query-pool dilution · 7-sequential-calls vs the overlay 30s handshake).
- **Polish observations:** §B O2 (injection-blob reply quality) / O3 (replace-steering miss) ·
  §C **O4** (redundant `[forgotten]` audit row for a fact that survives visibly) / **O5** (the
  un-exercised pure archive-search-miss proof).
- **Scale-triggered, not now:** archive-summarization tier (§D / open case 4) · §F variant-B
  system-prompt injection · §E fact richness + open case 1 (complex corrections) · open case 2
  (expiry/confidence dormant — decide or rip the dead columns).
- **§G is not memory polish** — it *is* the north-star route above.
