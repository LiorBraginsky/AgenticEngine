import { z } from "zod";

/**
 * A single named color. `label` is REQUIRED: the agent must use the picked
 * color as structured data INCLUDING its human name without NL-parsing
 * (concept.md — "structured data the agent can use without natural-language
 * parsing"); the v0 demo references the NAMED color.
 *
 * `hex` is restricted to 6-digit #RRGGBB. Alpha / 3-digit shorthand are
 * DEFERRED (additive later).
 */
export const ColorSwatch = z.object({
  label: z.string(),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type ColorSwatch = z.infer<typeof ColorSwatch>;

/**
 * SOURCE OF TRUTH for the color-picker UI (ADR-0005: closed-set primitive).
 * Tools COMPOSE this primitive by reference (see tools.ts) — they do NOT
 * re-declare question/palette.
 *
 * NOTE (v0 deferral): `question` stays INSIDE this primitive. We do NOT yet
 * decompose it into a separate `text` primitive — multi-primitive composition
 * is Phase 2.
 */
export const ColorPickerPrimitive = z.object({
  primitive: z.literal("color-picker"),
  question: z.string(),
  palette: z.array(ColorSwatch).min(1),
});
export type ColorPickerPrimitive = z.infer<typeof ColorPickerPrimitive>;
