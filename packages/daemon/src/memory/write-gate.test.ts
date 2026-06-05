import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate, REDACTION_MARKER } from "./write-gate.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-wg-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, gate: new WriteGate(store), dir };
}
const CTX = { actor: "user", authored_by: "human" as const };

test("appendTurn flows through the gate and lands in the store", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "hello" }], "s1", CTX);
  expect(store.readThreadTail(t, 10)).toEqual([{ role: "user", content: "hello" }]);
  store.close();
});

test("forget appends a tombstone AND hard-scrubs the message content; rows remain", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "secret token abc" }], "s1", CTX);
  gate.forget(mid!, CTX, "user requested");
  const db = store.rawDb();
  const msg = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(msg.content).toBe(REDACTION_MARKER);             // hard-scrub, not soft hide
  expect(msg.content).not.toContain("secret token");
  const tomb = db.query("SELECT kind FROM mutations WHERE target_message_id = ?").get(mid!) as { kind: string };
  expect(tomb.kind).toBe("tombstone");                    // event + tombstone remain
  // within-thread read redacts it
  expect(store.readThreadTail(t, 10)).toEqual([{ role: "user", content: REDACTION_MARKER }]);
  store.close();
});

test("forget rewrites the JSONL mirror so plaintext is gone and REDACTION_MARKER is present (Finding 2 — ARCHIVE-AS-TRUTH)", () => {
  // This test reproduces the reviewer's finding: after a forget, the JSONL mirror
  // previously still contained the original {event:"message", content:"<plaintext>"}
  // line, violating the plan's "the mirror never holds plaintext after a forget either"
  // contract and spec §3.2 invariant 1 ("real erasure, not a soft hide").
  const { store, gate, dir } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "secret token abc" }], "s1", CTX);
  gate.forget(mid!, CTX, "user requested");
  store.close();

  const mirrorPath = join(dir, "threads", `${t}.jsonl`);
  const mirrorContent = readFileSync(mirrorPath, "utf8");

  // The mirror must NOT contain the original plaintext.
  expect(mirrorContent).not.toContain("secret token abc");
  // The mirror MUST contain the redaction marker (either in the rewritten message
  // line or in the appended forget event line).
  expect(mirrorContent).toContain(REDACTION_MARKER);
});

// ---- Step 4.1: forget purges live distilled_facts (grill S2) ----

test("forget IMMEDIATELY purges the live distilled_facts row for the forgotten message (grill S2)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "secret token abc" }], "s1", CTX);
  // distill → the fact is live in distilled_facts (provenance = mid)
  store.insertDistilledFacts(
    [{ fact: "secret token abc", provenance: mid!, scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    "dumb-tail",
  );
  expect(store.readDistilledFacts(10).length).toBe(1);
  gate.forget(mid!, CTX, "user requested");
  // The LIVE slice is empty IMMEDIATELY — not only after a re-derive.
  expect(store.readDistilledFacts(10).length).toBe(0);
  store.close();
});

test("forget also purges a thread-level (fixed-marker) fact derived from the forgotten thread (grill S2)", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "x" }], "s1", CTX);
  store.insertDistilledFacts(
    [{ fact: `thread:${t} has 1 live messages`, provenance: `thread:${t}`, scope: "cross-thread", expiry: null, confidence: 0.5, authored_by: "machine" }],
    "fixed-marker",
  );
  gate.forget(mid!, CTX);
  expect(store.readDistilledFacts(10).length).toBe(0); // thread-level fact purged too
  store.close();
});

test("S2: forget throws a descriptive error for an unknown messageId instead of null-deref", () => {
  // Verifies the S2 fix: threadOf() used to blindly cast null to { thread_id: string },
  // causing a silent TypeError. Now it throws a descriptive error including the messageId.
  const { store, gate } = fresh();
  expect(() => gate.forget("nonexistent-id", CTX)).toThrow("nonexistent-id");
  store.close();
});

test("edit appends a correction; the original message row is NOT mutated in place", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "deploy is deploy.sh" }], "s1", CTX);
  gate.edit(mid!, "deploy is yeet.sh", CTX, "user correction");
  const db = store.rawDb();
  const original = db.query("SELECT content FROM messages WHERE id = ?").get(mid!) as { content: string };
  expect(original.content).toBe("deploy is deploy.sh");   // original NOT touched
  const corr = db.query("SELECT kind, replacement_content FROM mutations WHERE target_message_id = ?").get(mid!) as { kind: string; replacement_content: string };
  expect(corr.kind).toBe("correction");
  expect(corr.replacement_content).toBe("deploy is yeet.sh");
  // within-thread read surfaces the correction
  expect(store.readThreadTail(t, 10)).toEqual([{ role: "user", content: "deploy is yeet.sh" }]);
  store.close();
});
