/**
 * normalizeFactText — shared text normalization for the fact-forget machinery.
 *
 * Extracted from smart-distiller-provider.ts to avoid a store→provider import cycle:
 * store.ts needs normalizeFactText for the forget primitives (deleteMachineFactsByForget,
 * isForgottenNormalizedText, etc.), and store.ts must not import from providers/.
 *
 * Algorithm: NFKC → lowercase → strip REMEMBERED_LABEL prefix →
 *   collapse whitespace runs to one space + trim →
 *   strip trailing sentence punctuation (. ! ? ; ,) → strip surrounding quotes.
 *
 * Conservative exact-after-normalize match. A generative distiller can defeat
 * this by rephrasing the fact. Never call this a hard guarantee.
 *
 * Re-exported from smart-distiller-provider.ts (that file now re-exports from here).
 */

// Matches the REMEMBERED_LABEL constant from system-prompt.ts ("[remembered] ")
// Lower-cased for the normalization step. Kept as a literal here to avoid importing system-prompt.ts.
const REMEMBERED_LABEL_LOWER = "[remembered] ";

export function normalizeFactText(s: string): string {
  // NFKC normalization (e.g. fi ligature → fi, full-width chars → ASCII)
  let n = s.normalize("NFKC");
  // Lowercase
  n = n.toLowerCase();
  // Strip REMEMBERED_LABEL prefix if present (lower-cased)
  if (n.startsWith(REMEMBERED_LABEL_LOWER)) {
    n = n.slice(REMEMBERED_LABEL_LOWER.length);
  }
  // Collapse whitespace runs to a single space and trim
  n = n.replace(/\s+/g, " ").trim();
  // Strip trailing sentence punctuation (. ! ? ; ,) repeatedly
  n = n.replace(/[.!?;,]+$/, "");
  // Strip surrounding quotes (single or double)
  n = n.replace(/^["']+|["']+$/g, "");
  // Final trim
  n = n.trim();
  return n;
}

// v2-08 refined-B (bus q#013): a DEDUP-LOCAL secondary key. Runs normalizeFactText
// first, then drops a CLOSED set of function words at WORD boundaries so connector-only
// variants ("favorite color is blue" / "favorite color blue") collapse for dedup.
// HAZARD GUARD — the set NEVER contains negations (not/no/never/n't), quantifiers
// (all/any/some/none/every), or comparatives: keeping them means a CONTRADICTING fact
// ("...is NOT blue") never collapses into its opposite. NOT the shared normalizer —
// used ONLY by the suppress-only dedup guard, so forget/reindex are unaffected.
const DEDUP_CONNECTOR_WORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "being",
]);

export function dedupConnectorKey(text: string): string {
  const norm = normalizeFactText(text); // lowercases + collapses whitespace already
  if (norm === "") return "";
  return norm
    .split(" ")
    .filter((w) => w !== "" && !DEDUP_CONNECTOR_WORDS.has(w))
    .join(" ");
}
