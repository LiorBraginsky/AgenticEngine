/**
 * MF-03 5d (spec §3.3; ADR-0012 decision 5d; known-gotcha #31).
 * A deterministic, rule-based write-time scanner — NOT an ML detector. The
 * RULE SET is a closed, testable list with a clean extension seam: add a rule
 * here, or swap the whole scanner by implementing MemoryScanner. This defuses
 * the memory-poisoning surface (#31): content that could auto-inject a crafted
 * "fact" into every future thread is flagged at the gate before it can reach
 * the distilled/inject layer.
 */
export interface ScanInput {
  content: string;
  scope?: "thread-local" | "cross-thread" | "global";
  authored_by: "human" | "machine";
}

export type ScanVerdict = { ok: true } | { ok: false; rule: string; detail: string };

export interface MemoryScanner {
  readonly id: string;
  scan(input: ScanInput): ScanVerdict;
}

const MAX_FACT_LEN = 8192;

/** Injection-style imperatives aimed at a future agent. Extend this array to add phrases. */
const INJECTION_PHRASES = [
  "ignore previous instructions",
  "ignore all previous",
  "disregard the above",
  "you are now",
  "system prompt",
  "new instructions:",
  "override your",
];

// C0 controls except \t \n \r, plus zero-width / bidi smuggling chars.
const CONTROL_SMUGGLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/;

export class RuleBasedScanner implements MemoryScanner {
  readonly id = "rule-based-v0";

  scan(input: ScanInput): ScanVerdict {
    const text = input.content ?? "";

    if (text.length > MAX_FACT_LEN) {
      return { ok: false, rule: "oversized-payload", detail: `length ${text.length} > ${MAX_FACT_LEN}` };
    }
    if (CONTROL_SMUGGLE.test(text)) {
      return { ok: false, rule: "control-char-smuggling", detail: "control / zero-width / bidi char present" };
    }
    const lower = text.toLowerCase();
    const hit = INJECTION_PHRASES.find((p) => lower.includes(p));
    if (hit) {
      return { ok: false, rule: "injection-directive", detail: `matched phrase: ${hit}` };
    }
    if (input.authored_by === "machine" && input.scope === "global") {
      return { ok: false, rule: "scope-escalation", detail: "machine write declared global scope" };
    }
    return { ok: true };
  }
}
