/**
 * Reusable rephrase / cross-language fixture — hybrid-retrieval chunk-02 (R2), REUSED by
 * chunk-04's golden set (spec §3.8a-2). Reconstructed from the 2c chunk-01 (PR #86)
 * hard-reviewer verification record: the classes by which a same-fact re-derivation varies.
 *
 * ANCHOR — one fact identity, two representations:
 *   canonical (English match-key, what fact_fts stores): "favorite color blue"
 *   display   (user-language, what distilled_facts.fact stores): "мій улюблений колір синій"
 *
 * SAME_CANONICAL — variants that MUST be treated as the SAME fact. `axis` names the match
 *   axis that is LOAD-BEARING for the variant:
 *     - "display"   : EN case / trailing-punct / connector-word / whitespace variants — caught
 *                     by the relaxed display key (2c chunk-01); a regression guard.
 *     - "canonical" : UK / cross-language rewordings sharing NO display tokens with the anchor
 *                     display — caught ONLY by the R2 canonical axis (the chunk-02 thesis).
 * DIFFERENT_CANONICAL_RESIDUAL — the NAMED residual (spec §3.5c): fully reworded AND a
 *   genuinely different canonical. MUST NOT be suppressed by any deterministic axis.
 * NEGATIVE_CONTROLS — unrelated facts that MUST NOT match on any axis.
 */
export interface RephraseCase {
  klass: string;
  text: string;
  canonical: string;
  axis: "display" | "canonical";
}

export const ANCHOR = {
  canonical: "favorite color blue",
  display: "мій улюблений колір синій",
} as const;

export const SAME_CANONICAL: RephraseCase[] = [
  // ── display-axis classes (caught byte-for-byte by the relaxed display key) ──
  { klass: "exact",            text: "favorite color is blue",         canonical: "favorite color blue", axis: "display" },
  { klass: "connector-drop",   text: "favorite color blue",            canonical: "favorite color blue", axis: "display" },
  { klass: "uppercase",        text: "FAVORITE COLOR IS BLUE",         canonical: "favorite color blue", axis: "display" },
  { klass: "title-case",       text: "Favorite Color Is Blue",         canonical: "favorite color blue", axis: "display" },
  { klass: "trailing-punct",   text: "favorite color is blue.",        canonical: "favorite color blue", axis: "display" },
  { klass: "extra-whitespace", text: "favorite   color   blue",        canonical: "favorite color blue", axis: "display" },
  // ── canonical-axis classes: same fact, but a display-key gap means ONLY canonical catches them ──
  { klass: "internal-punct",   text: "favorite color: blue",           canonical: "favorite color blue", axis: "canonical" }, // internal colon never stripped → "color:" ≠ "color"
  { klass: "british-spelling", text: "favourite colour is blue",       canonical: "favorite color blue", axis: "canonical" }, // no US/UK spelling fold
  { klass: "ordinal-echo",     text: "3. favorite color is blue",      canonical: "favorite color blue", axis: "canonical" }, // only trailing punct stripped → leading "3." survives
  { klass: "possessive",       text: "user's favorite color is blue",  canonical: "favorite color blue", axis: "canonical" }, // "user's" not a connector word → extra leading token
  // ── cross-language / heavy-reword classes ──
  { klass: "uk-exact",         text: "мій улюблений колір синій",       canonical: "favorite color blue", axis: "canonical" },
  { klass: "uk-connector",     text: "улюблений колір — синій",         canonical: "favorite color blue", axis: "canonical" },
  { klass: "uk-reworded",      text: "найбільше люблю синій колір",      canonical: "favorite color blue", axis: "canonical" },
  { klass: "uk-word-order",    text: "синій — мій улюблений колір",     canonical: "favorite color blue", axis: "canonical" },
  { klass: "en-paraphrase",    text: "I love the color blue the most",  canonical: "favorite color blue", axis: "canonical" },
  { klass: "mixed-script",     text: "favorite колір is blue",          canonical: "favorite color blue", axis: "canonical" },
];

export const DIFFERENT_CANONICAL_RESIDUAL: RephraseCase = {
  klass: "residual-different-canonical",
  text: "надає перевагу холодним відтінкам", // "prefers cool shades" — related idea, different canonical
  canonical: "prefers cool shades",
  axis: "canonical",
};

export const NEGATIVE_CONTROLS: RephraseCase[] = [
  { klass: "neg-food-en", text: "favorite food is pizza", canonical: "favorite food pizza", axis: "display" },
  { klass: "neg-food-uk", text: "улюблена їжа — піца",    canonical: "favorite food pizza", axis: "canonical" },
];
