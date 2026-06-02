import { test, expect } from "bun:test";
import {
  ShowColorPickerArgs,
  ShowColorPickerResult,
  ShowTextArgs,
  ToolCallPayload,
  ToolResultPayload,
  KNOWN_TOOLS,
  classifyTool,
} from "./tools.js";
import { ColorPickerPrimitive, TextPrimitive } from "./primitives.js";

const validArgs = {
  picker: {
    primitive: "color-picker",
    question: "Pick an accent",
    palette: [{ label: "Navy", hex: "#1A2B3C" }],
  },
};

test("ShowColorPickerArgs composes the primitive by single reference", () => {
  const parsed = ShowColorPickerArgs.parse(validArgs);
  expect(parsed.picker.question).toBe("Pick an accent");
  expect(parsed.picker.palette[0]!.label).toBe("Navy");
});

test("ColorPickerPrimitive is the standalone source of truth", () => {
  expect(ColorPickerPrimitive.safeParse(validArgs.picker).success).toBe(true);
});

test("palette must have at least one swatch", () => {
  const bad = { picker: { ...validArgs.picker, palette: [] } };
  expect(ShowColorPickerArgs.safeParse(bad).success).toBe(false);
});

test("malformed hex is rejected (no throw via safeParse)", () => {
  const bad = { picker: { ...validArgs.picker, palette: [{ label: "X", hex: "1A2B3C" }] } };
  expect(ShowColorPickerArgs.safeParse(bad).success).toBe(false);
});

test("ShowColorPickerResult is just {picked}; no cancel variant", () => {
  const ok = ShowColorPickerResult.safeParse({ picked: { label: "Navy", hex: "#1A2B3C" } });
  expect(ok.success).toBe(true);
});

test("ToolCallPayload rejects unknown tool name (discriminated union)", () => {
  expect(ToolCallPayload.safeParse({ tool: "show_mystery", args: {} }).success).toBe(false);
});

test("classifyTool: known tool", () => {
  expect(classifyTool("show_color_picker")).toEqual({ known: true, name: "show_color_picker" });
});

test("classifyTool: unknown tool handled gracefully, no throw", () => {
  expect(classifyTool("show_mystery")).toEqual({ known: false });
  expect(classifyTool(undefined)).toEqual({ known: false });
});

// ── Task 2: ShowTextArgs + show_text in ToolCallPayload + KNOWN_TOOLS ────────

const validTextArgs = { text: { primitive: "text", content: "Sunset orange is #FF5E3A." } };

test("ShowTextArgs composes the text primitive by single reference", () => {
  const parsed = ShowTextArgs.parse(validTextArgs);
  expect(parsed.text.content).toBe("Sunset orange is #FF5E3A.");
  expect(parsed.text.primitive).toBe("text");
});

test("ShowTextArgs rejects missing content", () => {
  expect(ShowTextArgs.safeParse({ text: { primitive: "text" } }).success).toBe(false);
});

test("ShowTextArgs rejects non-string content", () => {
  expect(ShowTextArgs.safeParse({ text: { primitive: "text", content: 5 } }).success).toBe(false);
});

test("ToolCallPayload accepts show_text (tool union grew additively)", () => {
  const r = ToolCallPayload.safeParse({ tool: "show_text", args: validTextArgs });
  expect(r.success).toBe(true);
});

test("ToolCallPayload still accepts show_color_picker (existing variant unchanged)", () => {
  const r = ToolCallPayload.safeParse({ tool: "show_color_picker", args: validArgs });
  expect(r.success).toBe(true);
});

test("ToolCallPayload tool union has exactly 2 known tools", () => {
  // structural witness: 1 (v0) + show_text (this chunk). Asserts ADDITIVE growth.
  expect(ToolCallPayload.options.length).toBe(2);
});

test("ToolResultPayload does NOT accept show_text (display-only: no result)", () => {
  expect(ToolResultPayload.safeParse({ tool: "show_text", result: { content: "x" } }).success).toBe(false);
  // and the result union did not grow
  expect(ToolResultPayload.options.length).toBe(1);
});

test("KNOWN_TOOLS includes show_text; classifyTool knows it", () => {
  expect(KNOWN_TOOLS).toContain("show_text");
  expect(classifyTool("show_text")).toEqual({ known: true, name: "show_text" });
});
