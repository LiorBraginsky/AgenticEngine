/**
 * forget-roundtrip-probe — EXECUTED forget/re-projection round-trip smoke probe (Strike-5).
 *
 * ─── Purpose ─────────────────────────────────────────────────────────────────
 * Proves the chunk-04 forget flow works end-to-end on a REAL on-disk MemoryStore:
 *   1. Seed a real store with known messages.
 *   2. Distill (echo-stub re-emitting source content as facts — no LLM call).
 *   3. Forget a specific fact through the REAL Hatch → WriteGate → forgotten_facts path.
 *   4. Re-project with the SAME echo-stub (re-emits same text) — Layer-T must suppress it.
 *   5. Assert (a) the fact stays GONE after re-projection, AND
 *             (b) the source message content is BYTE-INTACT (no scrub on fact-forget path, B1).
 *
 * ─── STRIKE-5 BANNER ─────────────────────────────────────────────────────────
 * This script existing and type-checking is NECESSARY-BUT-NOT-SUFFICIENT.
 * A probe written + typechecked is NOT yet evidence (PIPELINE.md §6.1, Strike-5).
 * The EXECUTED run by the orchestrator — with full stdout pasted into the PR body —
 * is the actual DoD evidence.
 *
 * ─── Exact invocation command ────────────────────────────────────────────────
 *   bun run packages/daemon/scripts/forget-roundtrip-probe.ts
 *
 * ─── What success looks like ──────────────────────────────────────────────────
 *   [forget-probe] store seeded: 1 thread, 2 messages
 *   [forget-probe] distill produced 2 fact(s) (echo-stub)
 *   [forget-probe] fact[0]: "hi" (provenance: <msgId0>)
 *   [forget-probe] fact[1]: "my favourite colour is blue" (provenance: <msgId1>)
 *   [forget-probe] forgetting fact: "my favourite colour is blue"
 *   [forget-probe] forgotten_facts rows after forget: 1
 *   [forget-probe] re-projecting (echo-stub re-emits same text)...
 *   [forget-probe] re-projection produced 1 fact(s)
 *   [forget-probe] fact stays gone: true
 *   [forget-probe] source message content byte-intact: true  <-- B1 structural invariant
 *   PROBE PASSED
 */

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
console.log("║  forget-roundtrip-probe — Strike-5 EXECUTED evidence (chunk 04)             ║");
console.log("║  Uses echo-stub (no LLM/Keychain required). Requires real on-disk SQLite.   ║");
console.log("║  Type-check alone is NOT evidence. ORCHESTRATOR runs this for DoD.          ║");
console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
console.log("");

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { MemoryStore } from "../src/memory/store.js";
import { SmartDistillerProvider, normalizeFactText } from "../src/memory/providers/smart-distiller-provider.js";
import { WriteGate } from "../src/memory/write-gate.js";
import { RuleBasedScanner } from "../src/memory/scanner/memory-scanner.js";
import { Hatch } from "../src/memory/hatch.js";

// ── Echo stub (no real LLM) ─────────────────────────────────────────────────
// Parses the digest and re-emits each [role|msgId] content line as a fact.
// This is the same echo-stub pattern as makeEchoStub in distiller-integration.daemon.test.ts.

function makeEchoClient(): Anthropic {
  return {
    messages: {
      create: async (params: { messages: { role: string; content: string }[] }) => {
        const digestText = params.messages[0]?.content ?? "";
        const lines = digestText.split("\n");
        const facts: { fact: string; provenance: string; scope: string; expiry: null; confidence: number }[] = [];
        for (const line of lines) {
          const m = line.match(/^\[([^\|]+)\|([^\]]+)\]\s+(.+)$/);
          if (m) {
            facts.push({
              fact: m[3]!,
              provenance: m[2]!,
              scope: "cross-thread" as const,
              expiry: null,
              confidence: 0.8,
            });
          }
        }
        return { content: [{ type: "text", text: JSON.stringify(facts) }] };
      },
    },
  } as unknown as Anthropic;
}

const KNOWN_FACT = "my favourite colour is blue";
const SOURCE_CONTENT_BEFORE = "my favourite colour is blue";

const tmpDir = mkdtempSync(join(tmpdir(), "forget-probe-"));

try {
  // ── Step 1: Seed store ─────────────────────────────────────────────────────

  const store = new MemoryStore({ dataDir: tmpDir });
  const threadId = store.createThread("probe-thread");
  const [msg0Id, msg1Id] = store.appendMessages(
    threadId,
    [
      { role: "user", content: "hi" },
      { role: "user", content: SOURCE_CONTENT_BEFORE },
    ],
    "probe-session",
  );

  if (!msg0Id || !msg1Id) {
    throw new Error("appendMessages returned unexpected result");
  }

  console.log(`[forget-probe] store seeded: 1 thread, 2 messages`);
  console.log(`[forget-probe] msg0Id: ${msg0Id}`);
  console.log(`[forget-probe] msg1Id: ${msg1Id}`);
  console.log("");

  // ── Step 2: First distill (echo-stub) — produces facts from messages ───────

  const provider = new SmartDistillerProvider({ client: makeEchoClient() });
  const distill1 = await provider.distill(store, threadId);

  console.log(`[forget-probe] distill1 produced ${distill1.facts.length} fact(s):`);
  for (let i = 0; i < distill1.facts.length; i++) {
    const f = distill1.facts[i]!;
    console.log(`[forget-probe] fact[${i}]: ${JSON.stringify(f.fact)} (provenance: ${f.provenance})`);
  }
  console.log("");

  if (distill1.facts.length < 2) {
    throw new Error(`Expected ≥2 facts from echo-stub, got ${distill1.facts.length}`);
  }

  // Find the fact for the known content
  const knownFact = distill1.facts.find((f) => f.fact === KNOWN_FACT);
  if (!knownFact) {
    throw new Error(`Could not find the expected fact "${KNOWN_FACT}" in distill1 output`);
  }

  // Persist facts to distilled_facts (simulates what the daemon does after distill)
  store.insertDistilledFacts(distill1.facts, "smart");

  // ── Step 3: Forget the fact through REAL Hatch → WriteGate → forgotten_facts ─

  const gate = new WriteGate(store, new RuleBasedScanner());
  const hatch = new Hatch(store, gate);

  const forgetCtx = { actor: "user", authored_by: "human" as const };
  console.log(`[forget-probe] forgetting fact: ${JSON.stringify(KNOWN_FACT)}`);
  console.log(`[forget-probe] provenance: ${knownFact.provenance}`);
  hatch.forgetFact(KNOWN_FACT, knownFact.provenance, forgetCtx, "roundtrip-probe");

  const forgottenRows = store.readForgottenFacts();
  console.log(`[forget-probe] forgotten_facts rows after forget: ${forgottenRows.length}`);
  if (forgottenRows.length !== 1) {
    throw new Error(`Expected 1 forgotten_facts row, got ${forgottenRows.length}`);
  }
  console.log(`[forget-probe] forgotten row normalized_text: ${JSON.stringify(forgottenRows[0]!.normalized_text)}`);
  console.log("");

  // ── Step 4: Re-project with echo-stub (re-emits the SAME text under a fresh provenance) ──

  console.log("[forget-probe] re-projecting (echo-stub re-emits same text with its message id)...");
  const distill2 = await provider.distill(store, threadId);
  console.log(`[forget-probe] re-projection produced ${distill2.facts.length} fact(s)`);
  for (let i = 0; i < distill2.facts.length; i++) {
    const f = distill2.facts[i]!;
    console.log(`[forget-probe] re-projected fact[${i}]: ${JSON.stringify(f.fact)}`);
  }
  console.log("");

  // ── Step 5: Assert (a) fact stays GONE ─────────────────────────────────────

  const factNorm = normalizeFactText(KNOWN_FACT);
  const factStaysGone = !distill2.facts.some(
    (f) => normalizeFactText(f.fact) === factNorm,
  );
  console.log(`[forget-probe] fact stays gone: ${factStaysGone}`);

  // ── Step 5: Assert (b) source message content is BYTE-INTACT (B1 invariant) ──
  // B1: fact-forget must NEVER scrub the source message. Read raw messages.content directly.

  const rawRow = store.rawDb()
    .query<{ content: string }, string>("SELECT content FROM messages WHERE id = ?")
    .get(msg1Id);
  const sourceIntact = rawRow?.content === SOURCE_CONTENT_BEFORE;
  console.log(`[forget-probe] source message content byte-intact: ${sourceIntact}  <-- B1 structural invariant`);
  if (rawRow) {
    console.log(`[forget-probe] source message content: ${JSON.stringify(rawRow.content)}`);
  }
  console.log("");

  store.close();

  // ── Step 6: Final verdict ──────────────────────────────────────────────────

  if (!factStaysGone) {
    console.error("[forget-probe] PROBE FAILED — forgotten fact reappeared after re-projection.");
    console.error("  Layer-T (forgotten_facts.normalized_text) did not suppress it.");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  if (!sourceIntact) {
    console.error("[forget-probe] PROBE FAILED — B1 violated: source message content was scrubbed.");
    console.error(`  Expected: ${JSON.stringify(SOURCE_CONTENT_BEFORE)}`);
    console.error(`  Actual:   ${JSON.stringify(rawRow?.content)}`);
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  PROBE PASSED — fact stays gone + source intact (B1) after re-projection.   ║");
  console.log("║  Paste this stdout into the PR body = Strike-5 EXECUTED evidence (chunk 04).║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

} catch (err) {
  console.error(
    `[forget-probe] PROBE FAILED — unexpected error:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) {
    console.error(`  stack: ${err.stack}`);
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

try {
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[forget-probe] cleaned up tmpDir`);
} catch (cleanErr) {
  console.warn(`[forget-probe] warning: cleanup failed — ${cleanErr instanceof Error ? cleanErr.message : String(cleanErr)}`);
}

process.exit(0);
