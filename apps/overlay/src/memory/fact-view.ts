/**
 * fact-view (chunk-02, memory-transparency-ui) — pure display helpers.
 * ADR-0012 5c: thread-level provenance display. Spec ruling 2026-07-02: expiry/confidence
 * shown ONLY when non-default (display-only; no scoring/decay/editing). ADR-0012 5b: a
 * 0-fact distillation event is an OBSERVABLE "deliberately retained nothing", never a gap.
 */
import type { DistilledFactView, DistillationEventView } from "./types.js";

export type ProvenanceRef =
  | { kind: "thread"; threadId: string }
  | { kind: "text"; raw: string };

/** Parse a provenance string. Only the "thread:<id>" shape is a client-resolvable jump
 *  target; message-id lists / legacy shapes render as plain text (history.html parity). */
export function parseProvenance(raw: string): ProvenanceRef {
  if (raw.startsWith("thread:")) {
    const threadId = raw.slice("thread:".length);
    if (threadId) return { kind: "thread", threadId };
  }
  return { kind: "text", raw };
}

export function shouldShowExpiry(f: Pick<DistilledFactView, "expiry">): boolean {
  return f.expiry !== null && f.expiry !== undefined;
}
export function shouldShowConfidence(f: Pick<DistilledFactView, "confidence">): boolean {
  return f.confidence !== 1;
}

export function eventLabel(e: Pick<DistillationEventView, "facts_produced">): string {
  return e.facts_produced === 0
    ? "0 facts (deliberately retained nothing)"
    : `${e.facts_produced} fact${e.facts_produced === 1 ? "" : "s"} produced`;
}

export function formatTs(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "—";
  const n = typeof ts === "number" ? ts : Number(ts);
  return Number.isNaN(n) ? String(ts) : new Date(n).toLocaleString();
}
