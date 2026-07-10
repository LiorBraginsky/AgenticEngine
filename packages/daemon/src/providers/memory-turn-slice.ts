/**
 * memory-turn-slice.ts — pure helpers for the per-turn memory-action-tool slice
 * (chunk 2c-02, ADR-0016 decision 3). Single source of order-truth for BOTH the
 * `[remembered] N.` display prefix and the ordinal→factId map: index.ts builds
 * them together from the SAME `injectedFactIds` array, so the prefix index and
 * the map key always agree (spec §3.3 D3b — never a second read/derivation).
 */
import { REMEMBERED_LABEL } from "./system-prompt.js";

/**
 * Insert the 1-based ordinal AFTER the label: "[remembered] <fact>" →
 * "[remembered] 3. <fact>". Preserves `startsWith(REMEMBERED_LABEL)`
 * (index.ts's `injectedMemory` provenance-stamp flag is unaffected).
 * Defensive no-op on a non-remembered string (only indexes remembered facts).
 */
export function withRememberedIndex(content: string, ordinal: number): string {
  if (!content.startsWith(REMEMBERED_LABEL)) return content;
  return `${REMEMBERED_LABEL}${ordinal}. ${content.slice(REMEMBERED_LABEL.length)}`;
}

/**
 * Builds the 1-based ordinal → distilled_facts.id map from the EXACT
 * `injectedFactIds` array `MemoryProvider.retrieve` returned this turn (spec
 * §3.3 D3b — never raw DB rows, never a second read).
 */
export function buildOrdinalMap(injectedFactIds: string[]): Map<number, string> {
  return new Map(injectedFactIds.map((id, i) => [i + 1, id]));
}
