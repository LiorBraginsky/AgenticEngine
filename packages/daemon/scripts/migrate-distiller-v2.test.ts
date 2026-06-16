import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";
import { runMigration } from "./migrate-distiller-v2.js";

test("v2-05 migration: machine wiped, human preserved+reindexed, count-equality, resurrection report", () => {
  const dir = mkdtempSync(join(tmpdir(), "v2-05-migrate-"));
  const store = new MemoryStore({ dataDir: dir });
  store.rawDb().query(
    "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES ('h1','my name is Lior',NULL,'cross-thread',NULL,1,'human',1,'pre-v2')",
  ).run();
  store.insertFact({ fact: "user likes tea", canonical: "user likes tea", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["#preferences"] }, "v2b");
  store.insertFact({ fact: "user likes coffee", canonical: "user likes coffee", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine", topics: ["#preferences"] }, "v2b");
  store.recordForgottenFact({ raw_text: "user lives in Berlin", provenance: null, actor: "user", authored_by: "human" });

  const report = runMigration(store, { quiet: true });

  const db = store.rawDb();
  expect((db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='machine'").get() as { n: number }).n).toBe(0);
  expect((db.query("SELECT COUNT(*) AS n FROM distilled_facts WHERE authored_by='human'").get() as { n: number }).n).toBe(1);
  expect(db.query("SELECT 1 FROM distilled_facts WHERE id='h1'").get()).not.toBeNull();
  const dfCount = (db.query("SELECT COUNT(*) AS n FROM distilled_facts").get() as { n: number }).n;
  const ftsCount = (db.query("SELECT COUNT(*) AS n FROM fact_fts").get() as { n: number }).n;
  expect(ftsCount).toBe(dfCount);
  expect((db.query("SELECT COUNT(*) AS n FROM fact_topics WHERE fact_id NOT IN (SELECT id FROM distilled_facts)").get() as { n: number }).n).toBe(0);
  expect(store.fetchCandidates("lior").some((c) => c.id === "h1")).toBe(true);
  expect(report.machineWiped).toBe(2);
  expect(report.humanPreserved).toBe(1);
  expect(report.humanReindexed).toBe(1);
  expect(report.columnAdded).toBe(false);
  expect(report.resurrectionRisk).toContainEqual(expect.objectContaining({ normalized_text: "user lives in berlin" }));
  store.close();
});
