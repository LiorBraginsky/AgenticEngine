/**
 * Golden-set fixture — hybrid-retrieval chunk-04 (spec §3.8a), the EXECUTED eval's data.
 * LANGUAGE-AGNOSTIC (Lior ruling 2026-07-14): the product is NOT positioned as Ukrainian.
 * The UA↔EN pairs STAY (the real dogfood defect cases) but are joined by non-UA cross-language
 * pairs so the acceptance protects the GENERAL user-language↔canonical-language property, not
 * one language. NO UA-specific stemming/tokenizers anywhere.
 *
 * Each case: `query` (the fresh tail statement) must surface `expectCanonical`'s fact/message
 * within the consumer cutoff. Negatives must NOT rank in the top-3.
 */
import { SAME_CANONICAL, ANCHOR } from "../src/memory/rephrase-matrix.fixture.js";

export interface GoldenPositive { klass: string; seedDisplay: string; canonical: string; query: string; }
export interface GoldenNegative { klass: string; seedDisplay: string; canonical: string; query: string; }

// (1) demo-3 pair + change case: seed the blue fact (Ukrainian display); the green contradiction
//     must surface the blue canonical for the REPLACE.
export const DEMO3: GoldenPositive[] = [
  { klass: "demo3-restate", seedDisplay: ANCHOR.display, canonical: ANCHOR.canonical, query: "my favorite color is blue" },
  { klass: "demo3-change",  seedDisplay: ANCHOR.display, canonical: ANCHOR.canonical, query: "Тепер мій улюблений колір зелений" },
];

// (2) the 16 rephrase classes (reused) — each variant's query must surface the anchor canonical.
export const REPHRASE: GoldenPositive[] = SAME_CANONICAL.map((c) => ({
  klass: `rephrase-${c.klass}`, seedDisplay: ANCHOR.display, canonical: ANCHOR.canonical, query: c.text,
}));

// (3) cross-language PARAPHRASE (not literal translation) — UA↔EN plus ≥2 non-UA (es, de).
export const CROSS_LANGUAGE: GoldenPositive[] = [
  { klass: "xl-ua",  seedDisplay: "мій улюблений напій — кава",  canonical: "favorite drink coffee", query: "I really love drinking coffee" },
  { klass: "xl-es",  seedDisplay: "mi color favorito es el azul", canonical: "favorite color blue",   query: "the color I like most is blue" },
  { klass: "xl-de",  seedDisplay: "ich wohne in Berlin",          canonical: "lives in Berlin",        query: "my home city is Berlin" },
];

// (4) negative controls — genuinely UNRELATED to "favorite color blue": share NO core token
// (favorite/color/blue), NO "favorite X is Y" preference frame, and a canonical distinct from
// EVERY positive canonical. Retrieval-calibrated, deliberately NOT reused from chunk-02's
// NEGATIVE_CONTROLS (rephrase-matrix.fixture.ts) — "favorite food pizza" is a CORRECT
// near-miss for chunk-02's DEDUP/canonical-axis test (store.test.ts:619-621; shares the
// "favorite X" frame, on purpose, to prove dedup doesn't over-collapse) but is the WRONG
// instrument for THIS retrieval-suppression test (a hybrid ranker correctly ranking a
// shared-frame/shared-token fact high is not a suppression defect). A schedule/logistics
// domain avoids both the shared frame AND (architect note) an "I live in X"-style collision
// with the xl-de positive ("lives in Berlin").
export const NEGATIVES: GoldenNegative[] = [
  { klass: "neg-schedule-en", seedDisplay: "the team standup is at 9am", canonical: "standup at 9am", query: "favorite color blue" },
  { klass: "neg-schedule-de", seedDisplay: "das Meeting ist um 15 Uhr",  canonical: "meeting at 3pm",  query: "favorite color blue" },
];

export const ALL_POSITIVES: GoldenPositive[] = [...DEMO3, ...REPHRASE, ...CROSS_LANGUAGE];
