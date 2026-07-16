# Chunk hybrid-retrieval/06 — e2e closeout + LIVE demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax. This is the feature-CLOSING chunk: it ASSEMBLES + PROVES — it adds **no new capability** (chunk §Scope). It touches ONLY `packages/daemon/scripts/*` and `orchestration/docs/*`. If you find yourself needing a change to product source under `packages/daemon/src/**`, STOP — that is scope for decompose (§7.2 citation test), not this chunk.

**Goal:** Prove the assembled hybrid-retrieval feature (chunks 01–05, all merged to `main`, PRs #97–#101) works end-to-end through the real daemon, build the scripted glass-box demo scenes for Lior's live feature-closing demo, and — only after Lior signs the demo — reconcile the docs.

**Architecture:** Three parts split by the DEMO GATE. **PRE-DEMO (Steps 1–2, mechanical, build+run now):** demo-harness 2d scenes + full-path wiring proof (re-run the chunk-04 golden-eval and chunk-05 memory_search probes against assembled `main`) + mechanical gate + frozen byte-diff. **DEMO GATE (behavioral, NOT the worker's, NOT the architect's):** Lior's live demo, spec §5 items 1–5 — runtime-proof-only, Lior-gated, non-negotiable; the orchestrator reports BLOCKED here. **POST-DEMO (Step 3, mechanical, staged — do NOT apply before demo sign-off):** the docs reconcile.

**Tech Stack:** TypeScript on Bun 1.3.x, `bun:sqlite`, `bun test`, `@anthropic-ai/sdk`, `onnxruntime-web` (the local-wasm embedding lane). Reuses the chunk-03 `EmbeddingProvider`/`EmbeddingDrain`, chunk-04 `HybridRanker`, chunk-05 `memory_search`, and the existing `retrieval-golden.fixture.ts` seeding mechanism. **No new dependencies. No new product source.**

## Global Constraints

- **Docs are truth.** Spec `orchestration/docs/specs/2026-07-13-hybrid-retrieval.md` §5 (verification model — the behavioral DoD is Lior's live demo), §3.5/§3.8 (the seeded-above-cap requirement + the golden-set instrument), §0.1 (embedding lane = `local-wasm` default via `onnxruntime-web` direct, per the q#018 spike outcome). ADR-0017 (EmbeddingProvider plane + egress posture — accepted with the spec). **No new ADR** (see `## ADR worthy: no`; spec §6 lists none).
- **NO new capability, NO product-source change.** Edits are confined to `packages/daemon/scripts/memory-demo-harness.ts` and `orchestration/docs/*`. Scene/probe work only. Anything that looks like it needs a `packages/daemon/src/**` change → FLAG it (§7.2), do not plan or build it.
- **Frozen surfaces — byte-unchanged across the whole feature branch set:** `@agentic/protocol` (`packages/protocol/`) and the mock reducer (`packages/daemon/src/mock-agent.ts`, `packages/daemon/src/providers/mock-provider.ts`). Byte-diff at PR time (Step 2).
- **§6.1 sequencing is non-negotiable.** No step, PR body, ledger line, or commit message may write "verified on macOS" / "demo passed" / "behaviorally done" before Lior's live demo. Behavioral DoD is marked **"requires runtime demo to confirm."** Code-reading, green tests, and a green harness run are NOT behavioral evidence (the recurring §6.1 scar — falsified live 5×).
- **Demo env (spec §5):** ANTHROPIC key in macOS Keychain, `LLM_PROVIDER=anthropic-api`, `EMBEDDING_PROVIDER=local-wasm` (`AGENTIC_EMBED_AUTODOWNLOAD=1` for the one-time model fetch), `MEMORY_DEBUG=action,distill,retrieve,forget,search`.
- **Commands:** typecheck `bun run --cwd packages/daemon typecheck`; lint `bun run --cwd packages/daemon lint:strict` (0 warnings); tests `bun test`; degrade-suite `EMBEDDING_PROVIDER=none bun test`. Branch `chunk/hybrid-06-e2e-closeout-and-demo`; never commit on `main`. Commit per task with trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Status

**Plan authored — ready for engine-worker.** Execution status: PRE-DEMO (Steps 1–2) not started → DEMO GATE (orchestrator reports BLOCKED, Lior-gated) → POST-DEMO (Step 3) staged, apply-only-after-sign-off. Resume from the first unchecked `- [ ]`.

---

## Reality check (§6.1 — every anchor re-read against current `main`; chunks 01–05 merged, PRs #97–#101)

**Nothing here is a runtime behavioral assertion.** Code-path/script existence is stated; every "it works end-to-end" claim is marked *requires an EXECUTED run* (Step 2) or *requires Lior's live demo* (DEMO GATE) — never "verified" from this recon.

**`packages/daemon/scripts/memory-demo-harness.ts` (drift: it is the v09 harness; NO 2d scenes exist yet):**
- Monolithic script, boots ONE daemon at "Step 0" into a top-level `try/catch`, runs sequential scenes against it, cleans up + `process.exit(0)`. Modes: `--mode=stub` (default; `LLM_PROVIDER=mock` + a scripted `SmartDistillerProvider` client, no key) and `--mode=real` (real daemon, needs the Keychain key).
- Existing scenes (all BELOW the cap, 3 seeded facts): C (forget-one), B (no-reword), A (recall-race), E (dedup), STEP-2b (multi-turn recall), DEDUP-AFTER-RECALL, CHANGE→ONE-FACT, FACT-EDIT (POST `/memory/edit` `{target_type:"fact"}`), and a **real-mode-only informational 2c section** (items 1–5 rehearsal, never `process.exit(1)`).
- Reusable module-scope helpers: `wsTurn`, `wsTurnAndSettle`, `wsTurnAndPollDistillSettle`, `countColourFacts(dir)`, `buildChatStub()`, `buildScriptedClient()`. The scripted client's **`зелений` branch emits an `op:"replace"` targeting the colour candidate IF a colour fact ("синій"/"колір"/"зелений") is present in the candidate pool** (`candidateLines`) — else it emits `op:"new"` (a duplicate). This is exactly the deterministic lever scene (b) needs: whether the blue fact is surfaced as a candidate decides replace-vs-duplicate.
- The harness sets `LLM_PROVIDER` but **does NOT set `EMBEDDING_PROVIDER`** today, so the existing (below-cap) scenes run lexical-only, which is correct for them (below the cap the LLM sees all facts; embeddings add nothing).

**`packages/daemon/scripts/retrieval-golden-eval.ts` (chunk-04; name CONFIRMED):**
- Alias `retrieval-golden-eval` → `EMBEDDING_PROVIDER=local-wasm AGENTIC_EMBED_AUTODOWNLOAD=1 bun run scripts/retrieval-golden-eval.ts` (package.json:18).
- Seeds one fact per distinct canonical from `ALL_POSITIVES`+`NEGATIVES`, then a **filler loop `while (totalFacts() <= 50 && filler < 80)`** to exceed `ALL_FACTS_CAP`, seeds `CROSS_LANGUAGE` archive messages, embeds via `EmbeddingDrain(store, provider).drain()`, then runs **RED baseline (`new HybridRanker(store, null)` = BM25-only) → GREEN (`new HybridRanker(store, provider)`)**, asserts the acceptance bar (every positive within `CANDIDATE_TOP_K=10`, every mechanism-isolating klass MISSES on RED, 0 negative-control violations, every cross-language archive msg within `SEARCH_CAP=8`), `process.exit(barMet?0:1)`. **This is the seeding seam scene (b) reuses — same fixture, same `insertFact`+filler+`EmbeddingDrain` mechanism, NOT a new one.**

**`packages/daemon/scripts/memory-search-probe.ts` (chunk-05; name CONFIRMED):**
- Alias `memory-search-probe` → `LLM_PROVIDER=anthropic-api bun run scripts/memory-search-probe.ts` (package.json:19). Key resolves INTERNALLY via `resolveAnthropicKey` (never logged). Real sonnet API call; TWO scenarios (facts + archive scope), each must observe a real `memory_search` tool_use; `process.exit(1)` (Q1 contingency) if the model doesn't call it in BOTH scopes.

**Constants + fixture (CONFIRMED):** `ALL_FACTS_CAP = 50` (`store.ts:25`); `CANDIDATE_TOP_K = 10` (`store.ts:15`); `ANCHOR = { canonical: "favorite color blue", display: "мій улюблений колір синій" }` (`rephrase-matrix.fixture.ts:27-30`) — `display` contains "колір"+"синій", so the harness colour-matcher and the scripted-client `colourCandidateIdx` both match it. `store.ts:16-24` comment already records "As of hybrid-retrieval 2d (chunk-04) the DISTILLER calls fetchCandidatesRanked; below-cap unchanged; above the cap the hybrid ranker REPLACES BM25-only."

**Can the worker run the EXECUTED (real-resource) probes headlessly? — honest answer:**
- **Golden-eval (real embedding model):** needs a ~100–500 MB one-time model download (`AGENTIC_EMBED_AUTODOWNLOAD=1`). Chunk-04 EXECUTED this in-env (PR #100 carries its stdout), so the lane is available on this machine — but **confirm at run time; do not assume**. If the download is blocked in this worker's env, the golden-eval re-run rides Lior's machine and this chunk guarantees only the CI-deterministic layer.
- **memory_search probe + demo-harness `--mode=real` (real LLM):** needs the ANTHROPIC key in Keychain + network (metered API). Chunk-05 EXECUTED the probe in-env (PR #101, commit `9441492`), so the key resolved on this machine days ago — but **confirm at run time**. If it does not resolve here, the real-LLM re-runs ride Lior's live demo/machine.
- **Deterministic layer the worker ALWAYS runs regardless of resources:** `bun test`, the degrade-suite (`EMBEDDING_PROVIDER=none bun test`), typecheck, lint, frozen byte-diff, and the **stub-mode scene (b)** (deterministic: the scripted distiller emits the REPLACE; only the *embedding leg* is real, and that is the same model download the golden-eval uses).

**Scene (b) needs NO real LLM.** The scripted `SmartDistillerProvider` client makes the REPLACE deterministic given the candidate pool; the only real resource is the embedding model (to make the cross-language surfacing genuine). This is *stronger* than a real-LLM run because it removes steering luck — exactly what a "scripted glass-box fallback" should be.

**Runtime facts requiring an EXECUTED run (Step 2) — NOT asserted here:** that scene (b) surfaces the blue candidate on GREEN and misses on RED and that the REPLACE fires; that both probes still pass against assembled `main`. **Behavioral DoD (spec §5 items 1–5) — requires Lior's live demo, NOT verifiable by any run in this chunk.**

**No product-code change is required and none is planned.** `fetchCandidatesRanked` (chunk-04), `EmbeddingDrain`/`EmbeddingProvider` (chunk-03), `HybridRanker` (chunk-04), and `memory_search` (chunk-05) are all on `main`; scene (b) and the probes only *consume* them.

---

## Approaches (the one architect-time seam — how to add the 2d scenes without disturbing the existing harness)

The existing harness boots one daemon (no `EMBEDDING_PROVIDER`) and runs the below-cap scenes in a shared store. Scene (b) needs (i) `EMBEDDING_PROVIDER=local-wasm` set BEFORE `startDaemon` (the provider is built at boot, not toggleable mid-run) and (ii) a >50-fact seed that must not pollute the existing colour/name/work assertions.

- **Option A (chosen): a `--suite` selector with a self-contained `run2dSuite()`.** Add `--suite=core|2d` (default `core`). When `--suite=2d`, an early branch runs `run2dSuite(MODE)` — which boots its OWN daemon in its OWN `tmpDir` with the embedding env, runs the 2d scenes, cleans up, and `process.exit`s — BEFORE the existing top-level `try`. The existing `core` flow is byte-behavior-unchanged (the branch only fires on the flag). Pros: total isolation of the >50-fact seed + embedding env; the existing scenes stay green; RED/GREEN contrast printed in one run via direct `HybridRanker` (mirrors golden-eval, no second daemon boot). Cons: two daemon-boot paths in one file (acceptable; they share the module helpers).
- **Option B: inline the 2d scenes into the existing `core` flow after the 2c section.** Cons: must set `EMBEDDING_PROVIDER` at the single top boot (forces the whole below-cap run through the embedding drain for no benefit + real-model cost on every harness run); the >50-fact seed shares the store with the colour/name/work counts (fragile); harder to run "just the 2d scenes."
- **Recommendation: A.** Isolation is worth one extra boot path. The default `bun run --cwd packages/daemon memory-demo-harness` stays fast and key-free; `--suite=2d` is the opt-in embedding run.

## Chosen Approach

Option A. Step 1 builds `run2dSuite()` (scene b HARD-asserted deterministic; items 4 + 5 HARD-asserted deterministic; item 2 referenced to `memory-search-probe.ts`; item 3 a light deterministic stub scene) and self-verifies it stub+real-embedding. Step 2 runs the full-path wiring proof (both existing probes re-run against assembled `main` + the new `--suite=2d` run) + mechanical gate + frozen byte-diff + opens the PR with all captured stdout. DEMO GATE. Step 3 (deferred) reconciles the docs with the exact edits below, apply-only-after-Lior-signs.

## ADR worthy: no

Spec §6 records no new ADR for the feature; ADR-0017 (EmbeddingProvider plane + egress posture) was authored in the decompose PR and **accepted with the spec on 2026-07-14**. This chunk adds no protocol, dependency, HTTP/WS surface, or boundary — it only assembles, proves, and reconciles docs. If, while building the harness, you find a behavior that seems to need a `packages/daemon/src/**` change, that is a decompose-scope finding — STOP and escalate; do not invent scope.

---

## Steps

### Step 1 — Demo-harness 2d scenes (the scripted glass-box fallback for the live demo) — [mechanical, BUILD now]

**Files:**
- Modify: `packages/daemon/scripts/memory-demo-harness.ts` (add the `--suite` selector + `run2dSuite()`; the existing `core` flow is untouched).

**Interfaces:**
- Consumes (all on `main`): `startDaemon` (`../src/index.js`), `MemoryStore` (`../src/memory/store.js`), `HybridRanker` (`../src/memory/embedding/hybrid-ranker.js`), `EmbeddingDrain` (`../src/memory/embedding/embedding-drain.js`), `buildEmbeddingProvider` (`../src/memory/embedding/embedding-provider-selector.js`), `ANCHOR` (`../src/memory/rephrase-matrix.fixture.js`), and the module-scope helpers `wsTurn`/`wsTurnAndSettle`/`countColourFacts`/`buildChatStub`/`buildScriptedClient`/`SmartDistillerProvider`.
- Produces: a `--suite=2d` run path. No exported symbols; no other file consumes it.

- [ ] **Step 1.1 — Add the `--suite` selector.** Just after the existing `--mode` parse (`const MODE = …`), add:
```ts
const suiteArg = args.find((a) => a.startsWith("--suite="));
const SUITE: "core" | "2d" = suiteArg === "--suite=2d" ? "2d" : "core";
console.log(`[demo-harness] suite: ${SUITE}`);
```
Then, immediately BEFORE the top-level `try {` that begins the `core` flow ("Step 0: boot daemon"), add the early branch:
```ts
if (SUITE === "2d") {
  await run2dSuite(MODE);
  process.exit(0); // run2dSuite exits non-zero itself on a hard-assert failure
}
```

- [ ] **Step 1.2 — Add `run2dSuite()` (self-contained: own tmpDir, own daemon, embedding env).** Add these imports at the top of the file (next to the existing imports):
```ts
import { HybridRanker } from "../src/memory/embedding/hybrid-ranker.js";
import { EmbeddingDrain } from "../src/memory/embedding/embedding-drain.js";
import { buildEmbeddingProvider } from "../src/memory/embedding/embedding-provider-selector.js";
import { ANCHOR } from "../src/memory/rephrase-matrix.fixture.js";
```
Then add the function (place it after `buildScriptedClient()`):
```ts
// ── run2dSuite ───────────────────────────────────────────────────────────────
// Self-contained hybrid-retrieval (2d) glass-box scenes for Lior's live demo
// (spec §5 items 1,3,4,5). Own tmpDir + own daemon booted WITH the embedding
// env so the below-cap `core` flow stays fast/key-free. Deterministic: the
// scripted distiller client emits the REPLACE; only the embedding LEG is real
// (the same ~100-500MB local-wasm model the golden-eval uses). NO real LLM
// needed for the HARD asserts. Item 2 (memory_search) is proven by the separate
// EXECUTED memory-search-probe.ts (real LLM); referenced, not duplicated here.
async function run2dSuite(mode: "stub" | "real"): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "demo-harness-2d-"));
  const cleanup2d = (srv: ReturnType<typeof import("../src/index.js").startDaemon> | null): void => {
    if (srv) { try { srv.stop(true); } catch { /* ignore */ } }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  let srv: ReturnType<typeof import("../src/index.js").startDaemon> | null = null;
  try {
    console.log("\n╔═ hybrid-retrieval 2d GLASS-BOX SUITE (spec §5 items 1,3,4,5) ═╗");

    // Embedding env MUST be set before startDaemon (provider is built at boot).
    process.env.AGENTIC_DATA_DIR = dir;
    process.env.EMBEDDING_PROVIDER = "local-wasm";
    process.env.AGENTIC_EMBED_AUTODOWNLOAD = "1";
    process.env.LLM_PROVIDER = "mock";

    const { startDaemon } = await import("../src/index.js");
    const scriptedClient = buildScriptedClient();
    const memStub = new SmartDistillerProvider({ client: scriptedClient });
    srv = startDaemon(0, buildChatStub(), memStub);
    const PORT = srv.port!;
    const token = readFileSync(join(dir, "auth-token"), "utf8").trim();
    console.log(`[2d] daemon on port ${PORT}`);

    // ── SCENE (b) — item 1(b): seeded ABOVE-cap, BM25-alone MISSES, hybrid SURFACES → REPLACE ──
    // Seed the blue anchor (Ukrainian display, English canonical) + >ALL_FACTS_CAP(50) filler,
    // reusing the golden-eval seam (insertFact + filler loop + EmbeddingDrain). A second
    // MemoryStore on the same dataDir is the established snapshot pattern (countColourFacts).
    console.log("\n[2d] SCENE (b): seed blue fact + >50 filler; RED(bm25) misses, GREEN(hybrid) surfaces → REPLACE");
    const seedStore = new MemoryStore({ dataDir: dir });
    const provider = buildEmbeddingProvider({ dataDir: dir });
    if (!provider) {
      console.error("[2d] SCENE (b): SKIP — no embedding provider resolved (set EMBEDDING_PROVIDER=local-wasm AGENTIC_EMBED_AUTODOWNLOAD=1). Scene (b) rides Lior's machine.");
      seedStore.close(); cleanup2d(srv); return;
    }
    const blueId = seedStore.insertFact({ fact: ANCHOR.display, canonical: ANCHOR.canonical, topics: ["#preferences"], provenance: "thread:seed2d", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed2d");
    const totalFacts = (): number => (seedStore.rawDb().query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
    let filler = 0;
    while (totalFacts() <= 50 && filler < 80) { // exceed ALL_FACTS_CAP so the hybrid candidate lane runs (spec D5b/grill #4)
      seedStore.insertFact({ fact: `unrelated filler statement number ${filler}`, canonical: `filler ${filler}`, topics: [], provenance: "thread:seed2d", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed2d");
      filler++;
    }
    console.log(`[2d] SCENE (b): seeded ${totalFacts()} facts (>50); blueId=${blueId.slice(0, 8)}…`);
    await provider.warmup?.();
    await new EmbeddingDrain(seedStore, provider).drain();

    // RED vs GREEN candidate contrast (direct ranker — mirrors golden-eval; no second daemon boot).
    // The contradiction tail is the user's OWN language (Ukrainian) vs the stored English canonical:
    // BM25 (query tokens vs English canonical) shares NOTHING → MISS; the embedding leg (Ukrainian
    // tail ↔ Ukrainian display) carries it → HIT.
    const CANDIDATE_TOP_K = 10;
    const contradictionTail = "тепер мій улюблений колір зелений";
    const redHits = await new HybridRanker(seedStore, null).searchFacts(contradictionTail, CANDIDATE_TOP_K);
    const greenHits = await new HybridRanker(seedStore, provider).searchFacts(contradictionTail, CANDIDATE_TOP_K);
    const redSurfaced = redHits.some((h) => h.id === blueId);
    const greenSurfaced = greenHits.some((h) => h.id === blueId);
    console.log(`[2d] SCENE (b): RED(bm25-only) surfaces blue candidate = ${redSurfaced} (expect false); GREEN(hybrid) = ${greenSurfaced} (expect true)`);
    seedStore.close();
    if (redSurfaced) { console.error("[2d] SCENE (b): RED — BM25-alone unexpectedly surfaced the cross-language candidate; the mechanism is NOT isolated (attribute honestly, do not mask)."); cleanup2d(srv); process.exit(1); }
    if (!greenSurfaced) { console.error("[2d] SCENE (b): RED — the hybrid lane did NOT surface the blue candidate; the feature thesis FAILS (STOP-THE-LINE, spec §3.5b)."); cleanup2d(srv); process.exit(1); }

    // End-to-end REPLACE (GREEN daemon): the contradiction turn → dismiss → distill → above-cap
    // hybrid fetchCandidatesRanked surfaces blue → scripted client emits op:replace → exactly one
    // colour fact, the new value (green), no duplicate.
    const colourBefore = countColourFacts(dir);
    const t = crypto.randomUUID();
    await wsTurnAndSettle(PORT, token, { threadId: t, text: contradictionTail }, 300);
    const colourAfter = countColourFacts(dir);
    const verify = new MemoryStore({ dataDir: dir });
    const colourRows = verify.rawDb().query("SELECT id, fact FROM distilled_facts WHERE fact LIKE '%синій%' OR fact LIKE '%зелений%' OR fact LIKE '%колір%'").all() as { id: string; fact: string }[];
    verify.close();
    const exactlyOne = colourRows.length === 1;
    const isGreen = colourRows.some((r) => r.fact.includes("зелений"));
    const noStaleBlue = !colourRows.some((r) => r.fact.includes("синій"));
    console.log(`[2d] SCENE (b): colour facts before=${colourBefore} after=${colourAfter}; rows=[${colourRows.map((r) => `"${r.fact}"`).join(", ")}]`);
    if (mode === "stub") {
      if (!exactlyOne || !isGreen || !noStaleBlue) {
        console.error(`[2d] SCENE (b): RED — expected exactly ONE colour fact (green, no stale blue); got ${colourRows.length}. The hybrid candidate surfaced but the REPLACE did not fire (STOP-THE-LINE — spec §Notes: a red scene (b) is stop-the-line, not polish).`);
        cleanup2d(srv); process.exit(1);
      }
      console.log("[2d] SCENE (b): GREEN — hybrid surfaced the cross-language candidate above the cap → REPLACE fired → exactly one colour fact (green). THE FEATURE THESIS.");
    } else {
      console.log(`[2d] SCENE (b): informational (real mode, LLM-fuzzy) — exactlyOne=${exactlyOne} isGreen=${isGreen} noStaleBlue=${noStaleBlue}.`);
    }

    // ── item 5 — degrade: provider absent ⇒ lexical-only, availability holds ──
    // A same-language (Ukrainian display) lexical query still returns the blue fact with NO provider.
    console.log("\n[2d] item 5 (degrade): with provider=null (lexical-only), a same-language lexical query still answers");
    const degStore = new MemoryStore({ dataDir: dir });
    const lexHits = await new HybridRanker(degStore, null).searchFacts("улюблений колір", CANDIDATE_TOP_K);
    degStore.close();
    const lexAnswers = lexHits.length > 0;
    console.log(`[2d] item 5: lexical-only hits for "улюблений колір" = ${lexHits.length} (availability holds = ${lexAnswers})`);
    if (!lexAnswers) { console.error("[2d] item 5: RED — lexical-only degrade returned nothing for a lexically-matchable query; availability regressed (spec §4 note 7 — degrade contract)."); cleanup2d(srv); process.exit(1); }
    console.log("[2d] item 5: GREEN — retrieval quality degrades to lexical-only, availability never does.");

    // ── item 4 — message-edit GONE; fact-edit alive ──
    // POST /memory/edit with a MESSAGE body ⇒ 400 (chunk-01 removed the message branch);
    // with a FACT body ⇒ 204 + text persists as human.
    console.log("\n[2d] item 4: message-edit removed (400) — fact-edit alive (204, durable human)");
    const msgEditRes = await fetch(`http://127.0.0.1:${PORT}/memory/edit`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target_type: "message", message_id: "any", replacement: "x", reason: "msg-edit-gone-check" }),
    });
    console.log(`[2d] item 4: POST /memory/edit {target_type:"message"} → ${msgEditRes.status} (expect 400)`);
    const factEditRes = await fetch(`http://127.0.0.1:${PORT}/memory/edit`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target_type: "fact", fact_id: blueId, replacement: "мій улюблений колір бірюзовий", reason: "fact-edit-alive-check" }),
    });
    console.log(`[2d] item 4: POST /memory/edit {target_type:"fact"} → ${factEditRes.status} (expect 204)`);
    if (msgEditRes.status !== 400) { console.error("[2d] item 4: RED — the message-edit branch still answers (chunk-01 R1 removal not on assembled main)."); cleanup2d(srv); process.exit(1); }
    if (factEditRes.status !== 204) { console.error("[2d] item 4: RED — fact-edit no longer works (regression)."); cleanup2d(srv); process.exit(1); }
    console.log("[2d] item 4: GREEN — message-edit is GONE (400); fact-edit alive (204).");

    // ── item 3 — forget → reworded same-canonical re-derivation suppressed (R2 canonical axis) ──
    // Referenced deterministic coverage: chunk-02's forgotten_facts-canonical tests + the live demo.
    // A light live rehearsal here would require the anthropic-api provider + port (stub mode wires
    // neither), so item 3's headless proof is chunk-02's suite; the demo covers it live.
    console.log("\n[2d] item 3: reworded same-canonical re-derivation suppression — deterministic proof = chunk-02 forgotten_facts-canonical tests; live coverage = demo item 3.");

    // ── item 2 — memory_search out-of-slice ──
    console.log("[2d] item 2: memory_search out-of-slice — EXECUTED proof = scripts/memory-search-probe.ts (real LLM, fact + archive scopes); live coverage = demo item 2.");

    console.log("\n╔═ 2d GLASS-BOX SUITE COMPLETE — scene (b) is the feature thesis; paste this stdout into the PR ═╗");
    cleanup2d(srv);
  } catch (err) {
    console.error(`[2d] UNEXPECTED ERROR: ${err instanceof Error ? err.stack : String(err)}`);
    cleanup2d(srv); process.exit(1);
  }
}
```
> If any imported symbol's real signature differs from the plan (e.g. `insertFact`'s field names, `EmbeddingDrain`'s constructor, `buildEmbeddingProvider`'s options, `startDaemon`'s return/`stop` shape, `wsTurnAndSettle`'s args), match the REAL signature — cross-check against `retrieval-golden-eval.ts` (which uses the identical seam) and `memory-search-probe.ts`. Do NOT change product source to fit the plan.

- [ ] **Step 1.3 — Self-verify the suite (deterministic layer).** Run stub-mode with the real embedding lane:
```bash
bun run --cwd packages/daemon memory-demo-harness -- --suite=2d --mode=stub
# (first run downloads the local-wasm model, ~100-500MB, if not cached)
```
Expected: `SCENE (b): GREEN … THE FEATURE THESIS`; `item 5: GREEN`; `item 4: GREEN`; process exit 0. If the model download is blocked in this env, expect the `SCENE (b): SKIP` line — record that honestly and note scene (b) rides Lior's machine (do NOT fake a pass). Capture the full stdout for the PR.

- [ ] **Step 1.4 — Typecheck + lint.** `bun run --cwd packages/daemon typecheck && bun run --cwd packages/daemon lint:strict` → 0.

- [ ] **Step 1.5 — Commit.**
```bash
git add packages/daemon/scripts/memory-demo-harness.ts
git commit -m "test(memory): demo-harness 2d glass-box scenes — seeded above-cap scene (b) (BM25 misses, hybrid surfaces → REPLACE), lexical-only degrade, message-edit-gone/fact-edit-alive (hybrid-retrieval chunk-06)

Adds a self-contained --suite=2d path (own daemon + embedding env) so the below-cap
core flow stays fast/key-free. Scene (b) reuses the golden-eval seeding seam
(insertFact + filler + EmbeddingDrain) and the scripted distiller so the REPLACE is
deterministic; only the embedding LEG is real. No product source touched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Done-criteria coverage:** builds the glass-box fallback for the behavioral DoD (spec §5 items 1,3,4,5). *Its GREEN run is NOT behavioral sign-off — that is Lior's live demo (DEMO GATE).*

---

### Step 2 — Full-path wiring proof + mechanical gate + frozen byte-diff + PR — [mechanical]

**Files:** none modified (this step RUNS + captures evidence + opens the PR). If a probe re-run against assembled `main` surfaces a wiring break, that is a **stop-the-line assembly finding for the orchestrator** — report it, do not patch product source in this chunk.

- [ ] **Step 2.1 — Re-run the chunk-04 golden-eval against assembled `main` (RED baseline → hybrid pass).**
```bash
bun run --cwd packages/daemon retrieval-golden-eval
```
Expected (per spec D8b): `ACCEPTANCE BAR MET ✓`, RED misses every mechanism-isolating klass, GREEN surfaces every positive within top-10, 0 negative-control violations, exit 0. **If the model download is blocked in this env:** record that this re-run rides Lior's machine (chunk-04 EXECUTED it in PR #100); do NOT claim a pass you did not observe. Capture full stdout.

- [ ] **Step 2.2 — Re-run the chunk-05 memory_search probe against assembled `main`.**
```bash
bun run --cwd packages/daemon memory-search-probe
```
Expected: `PROBE PASSED — a REAL LLM invoked memory_search across fact + archive scopes`, exit 0. **If the ANTHROPIC key does not resolve in this env:** record that this rides Lior's machine (chunk-05 EXECUTED it in PR #101, commit `9441492`); do NOT fabricate. Capture full stdout.

- [ ] **Step 2.3 — Run the 2d glass-box suite for the PR record** (Step 1.3's run; paste its stdout).

- [ ] **Step 2.4 — Mechanical gate (the deterministic layer — always runnable).**
```bash
bun run --cwd packages/daemon typecheck        # → 0
bun run --cwd packages/daemon lint:strict       # → 0 warnings
bun test                                         # → green (repo-wide)
EMBEDDING_PROVIDER=none bun test                 # degrade-suite → green (spec §4 note 7 / §5 CI-has-no-provider)
```

- [ ] **Step 2.5 — Frozen byte-diff empty across the whole feature branch set.** Confirm the frozen surfaces are byte-identical to the pre-feature baseline (the commit before PR #97). Confirm the exact frozen paths against spec §2 at run time:
```bash
BASE=<the commit on main immediately before PR #97 merged — verify with git log>
git diff "$BASE" HEAD -- packages/protocol packages/daemon/src/mock-agent.ts packages/daemon/src/providers/mock-provider.ts
```
Expected: EMPTY output.

- [ ] **Step 2.6 — Open the PR** (`gh pr create`, target `main`, branch `chunk/hybrid-06-e2e-closeout-and-demo`). Body: paste all captured stdout (golden-eval, memory_search probe, 2d suite), the mechanical-gate results, and the frozen byte-diff (empty). **The PR body states the behavioral DoD is BLOCKED pending Lior's live demo (§5 items 1–5) — it does NOT claim behavioral done.** End with the standard Claude Code attribution line. Do NOT self-merge; do NOT stage Step 3 into this PR.

**Done-criteria coverage:** **[mechanical]** DoD item 1 (assembled-main probes re-run green — outputs in PR; frozen byte-diff empty) — *marked as observed only for the layers actually EXECUTED in this env; any real-resource probe that could not run is explicitly "rides Lior's machine," never "verified."*

---

### ⛔ DEMO GATE — behavioral DoD, Lior-gated, NON-NEGOTIABLE (spec §5 / PIPELINE §6.1)

**NOT the worker's step. NOT the architect's. The orchestrator reports BLOCKED here.** No code-read, green test, or green harness run substitutes. Lior runs the live feature-closing demo in the demo env (Keychain key, `LLM_PROVIDER=anthropic-api`, `EMBEDDING_PROVIDER=local-wasm`, `MEMORY_DEBUG=action,distill,retrieve,forget,search`), spec §5 items 1–5:

1. UK↔EN root-fix, TWO scenes: (a) natural scale — no duplicate, change→REPLACE visible in the Memory window; **(b) the SEEDED above-cap scene where BM25-alone provably misses and the hybrid lane surfaces the candidate → REPLACE fires. THE FEATURE THESIS.** The `--suite=2d` harness is the scripted glass-box fallback.
2. Out-of-slice «що я казав про X?» → live `memory_search`, attributed answer.
3. Forget a fact → a reworded same-canonical re-derivation stays suppressed (R2).
4. Message-edit GONE (overlay + `history.html`); fact-edit alive with the durable badge.
5. Provider unset → lexical-only degrade, everything still answers.

**§Notes attribution rule:** a green scene (a) with a **red scene (b)** means 2c steering is masking a retrieval miss — attribute honestly (spec D8b: the eval measures surfacing; the demo measures the REPLACE). A red scene (b) is **stop-the-line**, not polish.

**Behavioral DoD status: requires runtime demo to confirm — NEVER "verified" from any artifact in this plan.**

Do NOT flip any chunk (01–06) to done/archive before this gate passes.

---

### Step 3 — Docs reconcile (STAGED — apply ONLY after Lior signs the demo) — [mechanical]

> **Guard:** every edit below is deferred. Do NOT commit any of Step 3 before the DEMO GATE passes (§6.1 sequencing). These are the EXACT edits; when sign-off lands, apply them, commit, and PR (or fold into the closeout PR per the orchestrator).

**Files + exact changes:**

- [ ] **`orchestration/docs/memory-backlog.md`:**
  - **§D** — mark **2d — HYBRID retrieval SHIPPED + CLOSED** (BM25 + embeddings via RRF, `EmbeddingProvider` plane / ADR-0017, `memory_search` read tool, above-cap hybrid candidate-fetch); mark **"REMOVE message-edit" → SHIPPED** (chunk-01: overlay + `history.html` + `/memory/edit` message branch removed, append-only machinery kept). Add the "Lior live §6.1 demo signed <DATE>" line only if the demo passed.
  - **§B** — mark the **`forgotten_facts` canonical-axis residual CLOSED** (chunk-02 R2: additive `canonical` column + two-axis D6b consult); update the "↔ chunk-05 relation (still OPEN)" note to CLOSED-by-chunk-02.
  - **Open cases / §B** — add two backlog notes, **flagged do-NOT-build (this chunk assembles only)**:
    - **(a)** `isFactVisibleToThread` extraction — a chunk-05 conductor-reviewer MINOR; a refactor, out of chunk-06 scope; record as a small future cleanup.
    - **(b)** the **7-sequential-model-calls worst case vs the overlay 30s handshake timeout** (raised loop bound `MEMORY_ACTIONS_MAX_PER_TURN + MEMORY_SEARCH_MAX_PER_TURN` + final text ⇒ up to 7 sequential Sonnet calls) — a **#42/#43 tie**; record the risk (a search-heavy turn could false-timeout the overlay until streaming lands).
  - **"Suggested next step"** — advance the queue head off 2d.

- [ ] **`orchestration/docs/roadmap.md`** ("Memory — next"): tick **2d — on-demand archive retrieval + HYBRID candidate-fetch** to **SHIPPED + CLOSED** with the spec reference (`specs/2026-07-13-hybrid-retrieval.md` → implemented) + ADR-0017; advance the queue head.

- [ ] **`orchestration/docs/known-gotchas.md`:**
  - **#46** — status note: the native `onnxruntime-node` crash (`oven-sh/bun#30431`) **remains OPEN**; the shipped default lane is `local-wasm` via **`onnxruntime-web` DIRECT** (pure-WASM `InferenceSession`, bypassing transformers.js — the q#018 spike outcome, chunk-03), which sidesteps the native backend. Record the chunk-03 re-verify finding (the Bun version tested + the issue's still-open status per the chunk-03 PR text).
  - **#47** — status note: **brute-force cosine over a plain BLOB column shipped** (chunk-03/04); no `sqlite-vec`/`setCustomSQLite`, gotcha avoided as sized; re-verified still true at build time.

- [ ] **`orchestration/docs/specs/2026-06-13-memory-distiller-v2.md`** (§3.4 / §1 out-of-scope): add the superseded-lane cross-note — D-V4a's "FTS5, NOT embeddings" is **superseded for the ABOVE-CAP candidate lane only** by hybrid-retrieval 2d (per its own "the same layer 2d will reuse" forward pointer); point to `specs/2026-07-13-hybrid-retrieval.md` §3.5.

- [ ] **Commit** (post-sign-off) with a message noting the demo was signed and the reconcile is staged AFTER §6.1 sign-off; trailer as above.

> **NOT in this chunk (orchestrator closeout duty, §4.4):** the uniform feature-folder ARCHIVE of `chunks-todo/hybrid-retrieval/` (chunks 01–06) + `docs/plans/hybrid-retrieval/` (plans 01–06). Note it; do not script it.

**Done-criteria coverage:** **[mechanical]** DoD item 3 (docs reconcile merged, staged AFTER the demo sign-off).

---

## Done-criteria map (chunk §Done criteria)

| DoD item | Kind | Where satisfied |
|---|---|---|
| Assembled-main probe re-runs green (outputs in PR); frozen byte-diff empty | **mechanical** | Steps 1–2 (real-resource probes marked "rides Lior's machine" if the env can't run them; never overclaimed) |
| Lior's live demo — items 1–5 ALL PASS | **behavioral** | DEMO GATE — **requires runtime demo to confirm; NEVER verified from code-reading/tests/harness** |
| Docs reconcile merged (backlog/roadmap/gotchas/spec cross-notes), staged AFTER sign-off | **mechanical** | Step 3 (deferred; apply-only-after-sign-off) |

## Related

- Chunk file: `orchestration/chunks-todo/hybrid-retrieval/06-e2e-closeout-and-demo.md`
- Spec: `orchestration/docs/specs/2026-07-13-hybrid-retrieval.md` §5 (verification), §3.5/§3.8 (above-cap + golden set), §0.1 (embedding lane), §6 (no new ADR)
- Sibling plans: `orchestration/docs/plans/hybrid-retrieval/plan-0{1..5}-*.md`
- Probes: `packages/daemon/scripts/retrieval-golden-eval.ts`, `packages/daemon/scripts/memory-search-probe.ts`, `packages/daemon/scripts/retrieval-golden.fixture.ts`
- Backlog to reconcile: `orchestration/docs/memory-backlog.md` §D/§B; `orchestration/docs/roadmap.md`; `orchestration/docs/known-gotchas.md` #46/#47; `orchestration/docs/specs/2026-06-13-memory-distiller-v2.md`
- ADR-0017: `orchestration/docs/adr/0017-embedding-provider-plane-and-egress-posture.md` (accepted with the spec)

## Status: Done
