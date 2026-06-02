import { z } from "zod";
import { ColorPickerPrimitive, ColorSwatch, TextPrimitive } from "./primitives.js";

/**
 * Tool args COMPOSE the primitive by a SINGLE reference (D2). No duplicated
 * question/palette fields — the primitive is the single source of truth.
 */
export const ShowColorPickerArgs = z.object({
  picker: ColorPickerPrimitive,
});
export type ShowColorPickerArgs = z.infer<typeof ShowColorPickerArgs>;

/**
 * Result carries ONLY the picked swatch. Cancellation is the `tool_cancel`
 * envelope — there is NO `| cancel` return variant (D4). One source of truth.
 */
export const ShowColorPickerResult = z.object({
  picked: ColorSwatch,
});
export type ShowColorPickerResult = z.infer<typeof ShowColorPickerResult>;

/**
 * Tool args for the display-only `text` primitive. COMPOSES TextPrimitive by
 * a SINGLE reference (mirrors ShowColorPickerArgs's `picker`). DISPLAY-ONLY:
 * there is intentionally NO ShowTextResult and NO show_text variant in
 * ToolResultPayload — show_text never returns (see TOOL_INTERACTION below).
 */
export const ShowTextArgs = z.object({
  text: TextPrimitive,
});
export type ShowTextArgs = z.infer<typeof ShowTextArgs>;

/**
 * Tool registry — discriminated union on `tool`. Grows 1 → 2 additively.
 * Adding a tool = a NEW frozen-contract chunk (stop-the-line), never ad-hoc.
 */
export const ToolCallPayload = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("show_color_picker"), args: ShowColorPickerArgs }),
  z.object({ tool: z.literal("show_text"), args: ShowTextArgs }),
]);
export type ToolCallPayload = z.infer<typeof ToolCallPayload>;

export const ToolResultPayload = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("show_color_picker"), result: ShowColorPickerResult }),
]);
export type ToolResultPayload = z.infer<typeof ToolResultPayload>;

/** The closed set of known tool names — for graceful unknown-tool handling. */
export const KNOWN_TOOLS = ["show_color_picker", "show_text"] as const;
export type KnownToolName = (typeof KNOWN_TOOLS)[number];

/**
 * Graceful, NON-THROWING classification of a tool name. Unknown `tool`
 * (e.g. an LLM hallucination, gotcha #9) ⇒ { known: false }, NEVER a throw.
 */
export function classifyTool(
  tool: unknown,
): { known: true; name: KnownToolName } | { known: false } {
  if (typeof tool === "string" && (KNOWN_TOOLS as readonly string[]).includes(tool)) {
    return { known: true, name: tool as KnownToolName };
  }
  return { known: false };
}

/**
 * DISPLAY-ONLY vs INTERACTIVE discriminator (ADR-0009). The daemon reads this to
 * decide session phase at tool-call dispatch time — BEFORE it has any result:
 *   "interactive"  → emit tool_call, PARK awaiting_* until tool_result/tool_cancel
 *   "display-only" → emit tool_call, NO await, proceed straight to session_end
 * Keyed by tool NAME (a consumer branches without a payload instance). Future
 * display-only primitives (e.g. image) add exactly one row here — nothing else.
 * `satisfies Record<KnownToolName, ...>` makes this TOTAL: adding a tool to
 * KNOWN_TOOLS without classifying its interaction is a COMPILE error.
 *
 * Lineage: codifies ADR-0002 decision-point 3 ("returns a result" vs
 * "fire-and-forget"). Consistent with ToolResultPayload: display-only tools
 * have no result variant. This table — keyed by name, total — is the signal
 * the daemon should read.
 */
export const TOOL_INTERACTION = {
  show_color_picker: "interactive",
  show_text: "display-only",
} as const satisfies Record<KnownToolName, "interactive" | "display-only">;

export type ToolInteraction = (typeof TOOL_INTERACTION)[KnownToolName];

/** Graceful lookup by tool name; unknown tool => undefined, never throws. */
export function toolInteraction(tool: string): ToolInteraction | undefined {
  return (TOOL_INTERACTION as Record<string, ToolInteraction>)[tool];
}
