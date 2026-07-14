import { Database } from "bun:sqlite";
// spec §3.1 D1b: re-run the OBSERVED-at-design-time check on the BUILD machine's Bun/SQLite.
const db = new Database(":memory:");
db.exec("CREATE VIRTUAL TABLE t USING fts5(c);");
db.query("INSERT INTO t(c) VALUES (?)").run("Привіт колір");
const variants = ["привіт", "ПРИВІТ", "Привіт", "колір", "КОЛІР"];
console.log(`bun ${Bun.version} · sqlite via bun:sqlite`);
for (const v of variants) {
  const n = (db.query("SELECT COUNT(*) AS n FROM t WHERE t MATCH ?").get(v) as { n: number }).n;
  console.log(`unicode61: '${v}' → ${n === 1 ? "MATCH ✓" : "NO MATCH ✗"}`);
}
// cross-script negative control (the root defect): a Cyrillic query must NOT match an English row.
db.query("INSERT INTO t(c) VALUES (?)").run("favorite color blue");
const cross = (db.query("SELECT COUNT(*) AS n FROM t WHERE t MATCH ?").get("колір") as { n: number }).n;
console.log(`cross-script control: 'колір' matches English row? ${cross > 1 ? "YES ✗" : "NO ✓"}`);
db.close();
