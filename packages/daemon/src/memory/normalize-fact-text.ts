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
