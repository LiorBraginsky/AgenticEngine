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

/**
 * SOURCE OF TRUTH for the `text` UI primitive (ADR-0005 closed-set; ADR-0009).
 * The FIRST standalone primitive besides color-picker. Display-only: it is
 * rendered and never produces a tool_result (the display-only-vs-interactive
 * distinction is declared in tools.ts via TOOL_INTERACTION).
 *
 * Mirrors ColorPickerPrimitive: the primitive is the base; the tool
 * (ShowTextArgs) COMPOSES it by single reference (tools.ts).
 *
 * NOTE: adding `text` does NOT settle the full primitive set or versioning
 * (open-question Q2 stays open). `content` is an unconstrained string in this
 * slice (no min/max, no markdown flag — additive later).
 */
export const TextPrimitive = z.object({
  primitive: z.literal("text"),
  content: z.string(),
});
export type TextPrimitive = z.infer<typeof TextPrimitive>;
