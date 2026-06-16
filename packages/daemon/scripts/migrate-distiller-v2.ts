/**
 * migrate-distiller-v2 — ONE-TIME, EXPLICIT, LOGGED migration (spec §3.8 D-V8).
 * NOT auto-on-startup. Run deliberately ONCE after the v2-05 cutover.
 *
 * DEFAULT = WIPE-FORWARD (no ordered-replay): wipe machine distilled_facts (known-bad:
 * churned + wrong-language from the global-reprojection era); HUMAN facts PRESERVED (5e —
 * never wiped); rebuild fact_fts + fact_topics for surviving human rows; add the live-store
 * distilled_through_turn column (the sanctioned §3.8 ALTER, v2-03 R2 forward-flag). The
 * resurrection-risk report is emitted regardless (forgotten_facts rows with no surviving
 * live match) — informational under wipe-forward (durable-delete already removed them).
 *
 * Invocation (real live store):  bun run --cwd packages/daemon migrate-distiller-v2
 * Throwaway run (executed DoD):  bun run packages/daemon/scripts/migrate-distiller-v2.ts --data-dir <tmp>
 *
 * STRIKE-5: this script existing + typechecking is NOT evidence. The EXECUTED run against a
 * real (throwaway) sqlite — stdout pasted into the PR — is the DoD evidence (q#011 rider).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import { normalizeFactText } from "../src/memory/normalize-fact-text.js";

export interface ResurrectionRow {
  normalized_text: string;
  raw_text: string;
  provenance: string | null;
}

export interface MigrationReport {
  columnAdded: boolean;
  machineBefore: number;
  machineWiped: number;
  humanPreserved: number;
  humanReindexed: number;
  distilledFactsAfter: number;
  factFtsAfter: number;
  countEquality: boolean;
  orphanTopics: number;
  resurrectionRisk: ResurrectionRow[];
}

export function runMigration(store: MemoryStore, opts: { quiet?: boolean } = {}): MigrationReport {
  const log = (m: string) => {
    if (!opts.quiet) console.log(`[migrate-v2] ${m}`);
  };
  const db = store.rawDb();

  const columnAdded = store.ensureDistilledThroughTurnColumn();
  log(`distilled_through_turn column ${columnAdded ? "ADDED (pre-v2-03 live store)" : "already present"}`);

  const machineBefore = (db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='machine'").get() as { n: number }).n;
  const humanBefore = (db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='human'").get() as { n: number }).n;
  log(`before: ${machineBefore} machine fact(s), ${humanBefore} human fact(s)`);

  store.dropAllDistilledFacts();
  const machineAfter = (db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='machine'").get() as { n: number }).n;
  log(`wiped ${machineBefore - machineAfter} machine fact(s); ${machineAfter} remain (must be 0)`);

  const humanReindexed = store.rebuildDerivedForHumanFacts();
  log(`reindexed ${humanReindexed} human fact(s) into fact_fts`);

  const distilledFactsAfter = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
  const factFtsAfter = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
  const orphanTopics = (db.query("SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id NOT IN (SELECT id FROM distilled_facts)").get() as { n: number }).n;
  const countEquality = factFtsAfter === distilledFactsAfter;
  log(`COUNT(fact_fts)=${factFtsAfter} === COUNT(distilled_facts)=${distilledFactsAfter}: ${countEquality}; orphan fact_topics: ${orphanTopics}`);

  const forgotten = store.readForgottenFacts();
  const resurrectionRisk: ResurrectionRow[] = forgotten.filter((f) => {
    const hits = store.fetchCandidates(f.normalized_text);
    return !hits.some((c) => normalizeFactText(c.fact) === f.normalized_text);
  });
  log(`forgotten_facts checked: ${forgotten.length}; with no surviving live match: ${resurrectionRisk.length}`);
  for (const r of resurrectionRisk) {
    log(`  resurrection-risk (none resurrected under wipe-forward): "${r.raw_text}"`);
  }

  return {
    columnAdded,
    machineBefore,
    machineWiped: machineBefore - machineAfter,
    humanPreserved: humanBefore,
    humanReindexed,
    distilledFactsAfter,
    factFtsAfter,
    countEquality,
    orphanTopics,
    resurrectionRisk,
  };
}

if (import.meta.main) {
  console.log("=== migrate-distiller-v2 (WIPE-FORWARD; ONE-TIME; §3.8) ===");
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf("--data-dir");
  const dataDir = dirIdx >= 0 ? argv[dirIdx + 1]! : join(homedir(), ".agentic-engine");
  console.log(`[migrate-v2] data dir: ${dataDir}`);
  const store = new MemoryStore({ dataDir });
  try {
    const report = runMigration(store);
    const ok =
      report.machineWiped === report.machineBefore &&
      report.countEquality &&
      report.orphanTopics === 0;
    console.log(ok ? "MIGRATION OK" : "MIGRATION FAILED — invariant breach (see above)");
    store.close();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`[migrate-v2] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    store.close();
    process.exit(1);
  }
}
