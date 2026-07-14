/**
 * retrieval-golden-eval — hybrid-retrieval chunk-04 (spec §3.8) EXECUTED probe.
 *
 * Seeds a fresh store with the golden positives + negative controls + filler facts (so the
 * corpus is > ALL_FACTS_CAP — below the cap the candidate lane under test never runs, spec
 * D5b/grill #4) + the archive messages for the search leg; embeds via the REAL local-WASM
 * model; runs a RED baseline (ranker with provider=null = BM25-only) then GREEN (real
 * provider); asserts the acceptance bar; prints stdout.
 *
 * NOT a `bun test` file — it downloads the model (~100-500 MB) on first run (gated on
 * AGENTIC_EMBED_AUTODOWNLOAD=1). CI never executes this. STRIKE-5: this script existing +
 * typechecking is NOT evidence; the EXECUTED run's stdout (pasted into the PR) is.
 *
 * Invocation: bun run --cwd packages/daemon retrieval-golden-eval
 *   (the package.json alias sets EMBEDDING_PROVIDER=local-wasm AGENTIC_EMBED_AUTODOWNLOAD=1)
 */
import { MemoryStore } from "../src/memory/store.js";
import { HybridRanker } from "../src/memory/embedding/hybrid-ranker.js";
import { buildEmbeddingProvider } from "../src/memory/embedding/embedding-provider-selector.js";
import { EmbeddingDrain } from "../src/memory/embedding/embedding-drain.js";
import { ALL_POSITIVES, NEGATIVES, CROSS_LANGUAGE } from "./retrieval-golden.fixture.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATE_TOP_K = 10; // the distiller cutoff the LLM actually sees (spec D8b)
const SEARCH_CAP = 8;       // the search-leg result cap (spec D8b)

// hybrid-04 MINOR-3 fix (frontier review): pin RED's expected misses to the MECHANISM-ISOLATING
// cases — zero token overlap between the query and the target canonical, so BM25 CANNOT find
// them and only the embedding leg can — rather than accepting "RED misses ANY one case"
// (`redPass < ALL_POSITIVES.length`), which a future D2c model-swap re-run could pass on a
// flaky single unrelated miss. Verified disjoint by inspection (see retrieval-golden.fixture.ts).
const EXPECTED_RED_MISS_KLASSES = new Set([
  "demo3-change", "rephrase-uk-exact", "rephrase-uk-connector", "rephrase-uk-reworded",
  "rephrase-uk-word-order", "xl-es", "xl-de",
]);

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "hr04-golden-"));
  const store = new MemoryStore({ dataDir });
  const provider = buildEmbeddingProvider({ dataDir }); // EMBEDDING_PROVIDER=local-wasm + AGENTIC_EMBED_AUTODOWNLOAD=1
  if (!provider) {
    console.error("no embedding provider — set EMBEDDING_PROVIDER=local-wasm");
    process.exit(1);
  }

  // Seed ONE fact PER DISTINCT canonical (several ALL_POSITIVES entries deliberately share a
  // canonical — e.g. every REPHRASE variant + xl-es all resolve to ANCHOR.canonical
  // "favorite color blue", by fixture design: many rephrased QUERIES probing the SAME
  // underlying fact). Inserting a duplicate row per case would (a) misrepresent production,
  // where op:replace keeps exactly ONE row per fact id, and (b) starve early-inserted
  // duplicates out of the ranker's `.slice(0, CANDIDATE_TOP_K)` cut via the rowid-DESC total
  // tie-break — a pure seeding artifact, not a retrieval defect. One row per canonical (using
  // the FIRST case's seedDisplay, in ALL_POSITIVES order) avoids both.
  const factByCanonical = new Map<string, string>();
  for (const p of ALL_POSITIVES) {
    if (factByCanonical.has(p.canonical)) continue;
    const id = store.insertFact({ fact: p.seedDisplay, canonical: p.canonical, topics: [], provenance: "thread:g", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
    factByCanonical.set(p.canonical, id);
  }
  // NEGATIVES (schedule/logistics domain, retrieval-calibrated — see fixture) each carry their
  // own distinct canonical by construction, so — unlike ALL_POSITIVES above — no dedup is
  // needed here: every entry seeds its own row.
  const negativeIds = new Set<string>();
  for (const n of NEGATIVES) {
    const id = store.insertFact({ fact: n.seedDisplay, canonical: n.canonical, topics: [], provenance: "thread:g", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
    negativeIds.add(id);
  }
  // hybrid-04 NIT-4 fix: a direct COUNT(*) (not fetchCandidates("x").length, whose above-cap
  // BM25 branch returns ~0 rows once total>50 — the `<=50` condition would then stay true
  // forever, so termination rested only on `filler<80`, silently over-seeding ~30 real-model
  // embeds; and if that bound were ever lowered below ~46 it would silently test the
  // BELOW-cap lane instead, the grill-#4 trap). Total is read directly off the table.
  const totalFacts = (): number => (store.rawDb().query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
  let filler = 0;
  while (totalFacts() <= 50 && filler < 80) { // ensure total > ALL_FACTS_CAP(50)
    store.insertFact({ fact: `unrelated filler statement number ${filler}`, canonical: `filler ${filler}`, topics: [], provenance: "thread:g", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }, "seed");
    filler++;
  }

  // Seed the archive messages for the SEARCH leg (cross-language paraphrase content), keyed by klass.
  const messageIdByKlass = new Map<string, string>();
  for (const c of CROSS_LANGUAGE) {
    const t = store.createThread();
    const [mid] = store.appendMessages(t, [{ role: "user", content: c.seedDisplay }], "s");
    messageIdByKlass.set(c.klass, mid!);
  }

  // Embed everything through the REAL model (drain to completion).
  await provider.warmup?.();
  const drain = new EmbeddingDrain(store, provider);
  const counts = await drain.drain();
  console.log(`[golden] seeded, embedded facts=${counts.factsEmbedded} messages=${counts.messagesEmbedded}`);

  // RED baseline (BM25-only): ranker with provider=null.
  const red = new HybridRanker(store, null);
  // GREEN (hybrid): ranker with the real provider.
  const green = new HybridRanker(store, provider);

  let redPass = 0, greenPass = 0, redMissViolations = 0;
  for (const p of ALL_POSITIVES) {
    const rHits = await red.searchFacts(p.query, CANDIDATE_TOP_K);
    const gHits = await green.searchFacts(p.query, CANDIDATE_TOP_K);
    const id = factByCanonical.get(p.canonical)!;
    const rIn = rHits.some((h) => h.id === id);
    const gIn = gHits.some((h) => h.id === id);
    if (rIn) redPass++; if (gIn) greenPass++;
    if (EXPECTED_RED_MISS_KLASSES.has(p.klass) && rIn) redMissViolations++; // a mechanism-isolating case unexpectedly HIT on RED
    console.log(`[distiller-leg] ${p.klass.padEnd(24)} RED(bm25)=${rIn ? "HIT " : "MISS"} GREEN(hybrid)=${gIn ? "HIT" : "MISS"}  "${p.query}"`);
  }
  console.log(`[golden] mechanism-isolating RED-miss check: ${redMissViolations === 0 ? "ALL MISS ✓" : `${redMissViolations} unexpectedly HIT ✗`} (${[...EXPECTED_RED_MISS_KLASSES].join(", ")})`);

  // Negative controls must NOT rank top-3 in the hybrid list for the shared "favorite color
  // blue" negative-control query (every NEGATIVES entry carries this fixed query).
  const negQuery = NEGATIVES[0]?.query ?? "favorite color blue";
  const negGHits = await green.searchFacts(negQuery, CANDIDATE_TOP_K);
  const negTop3 = negGHits.slice(0, 3).map((h) => h.id);
  const negViolations = negTop3.filter((id) => negativeIds.has(id)).length;
  console.log(`[negative-controls] top-3 for "${negQuery}": violations=${negViolations}/${negativeIds.size}`);
  if (negViolations > 0) {
    // Diagnostic detail on a violation: which ids/scores/legs actually landed in the fused
    // top-5, so a violation is attributable (model same-language bias vs a fusion bug) rather
    // than a bare pass/fail count.
    console.log(`[negative-controls] top-5 fused detail: ${JSON.stringify(negGHits.slice(0, 5))}`);
  }

  console.log(`\n[golden] distiller leg: RED ${redPass}/${ALL_POSITIVES.length} · GREEN ${greenPass}/${ALL_POSITIVES.length} within top-${CANDIDATE_TOP_K}`);

  // ARCHIVE sweep (search leg): each CROSS_LANGUAGE paraphrase's seeded message must rank
  // within SEARCH_CAP on GREEN (RED printed for the same RED-vs-hybrid contrast as the facts leg).
  let archiveRedPass = 0, archiveGreenPass = 0;
  for (const c of CROSS_LANGUAGE) {
    const mid = messageIdByKlass.get(c.klass)!;
    const rHits = await red.searchArchive(c.query, SEARCH_CAP);
    const gHits = await green.searchArchive(c.query, SEARCH_CAP);
    const rIn = rHits.some((h) => h.id === mid);
    const gIn = gHits.some((h) => h.id === mid);
    if (rIn) archiveRedPass++; if (gIn) archiveGreenPass++;
    console.log(`[archive-leg]   ${c.klass.padEnd(24)} RED(bm25)=${rIn ? "HIT " : "MISS"} GREEN(hybrid)=${gIn ? "HIT" : "MISS"}  "${c.query}"`);
  }
  console.log(`[golden] archive leg:   RED ${archiveRedPass}/${CROSS_LANGUAGE.length} · GREEN ${archiveGreenPass}/${CROSS_LANGUAGE.length} within top-${SEARCH_CAP}`);

  // ACCEPTANCE BAR (spec D8b): GREEN must surface EVERY positive within CANDIDATE_TOP_K; RED must
  // MISS every mechanism-isolating case (proves the defect via the pinned set, MINOR-3 fix —
  // not merely "misses ANY one case"); zero negative-control violations; GREEN must also surface
  // every cross-language archive message within SEARCH_CAP.
  const barMet = greenPass === ALL_POSITIVES.length && redMissViolations === 0 && negViolations === 0;
  const archiveBarMet = archiveGreenPass === CROSS_LANGUAGE.length;
  console.log(`[golden] ACCEPTANCE BAR ${barMet && archiveBarMet ? "MET ✓" : "NOT MET ✗"} (green=${greenPass}/${ALL_POSITIVES.length}, red=${redPass}/${ALL_POSITIVES.length}, redMissViolations=${redMissViolations}, negViolations=${negViolations}, archiveGreen=${archiveGreenPass}/${CROSS_LANGUAGE.length})`);
  store.close();
  process.exit(barMet && archiveBarMet ? 0 : 1); // FAIL ⇒ next candidate model (spec D2c) ⇒ still fail ⇒ BLOCKED, escalate §0.1 fork
}
if (import.meta.main) void main();
