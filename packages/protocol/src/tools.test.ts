import { test, expect } from "bun:test";
import {
  ShowColorPickerArgs,
  ShowColorPickerResult,
  ToolCallPayload,
  classifyTool,
} from "./tools.js";
import { ColorPickerPrimitive } from "./primitives.js";

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
