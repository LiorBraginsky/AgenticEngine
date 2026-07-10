import { test, expect } from "bun:test";
import {
  MEMORY_ACTION_TOOLS,
  MEMORY_ACTION_TOOLS_PARAM,
  serializeToolResult,
  type MemoryActionToolName,
  type MemoryActionToolSpec,
} from "./memory-action-tools.js";

// ─── closed-set shape ───────────────────────────────────────────────────────

test("MEMORY_ACTION_TOOLS_PARAM declares exactly memory_forget + memory_remember, in that order", () => {
  expect(MEMORY_ACTION_TOOLS_PARAM.map((t) => t.name)).toEqual([
    "memory_forget",
    "memory_remember",
  ]);
});

test("both tool specs have an object input_schema", () => {
  expect(MEMORY_ACTION_TOOLS.memory_forget.input_schema.type).toBe("object");
  expect(MEMORY_ACTION_TOOLS.memory_remember.input_schema.type).toBe("object");
});

test("memory_forget.input_schema.required is [ordinal, expected_text]", () => {
  expect(MEMORY_ACTION_TOOLS.memory_forget.input_schema.required).toEqual([
    "ordinal",
    "expected_text",
  ]);
});

test("memory_remember.input_schema.required is [fact]", () => {
  expect(MEMORY_ACTION_TOOLS.memory_remember.input_schema.required).toEqual([
    "fact",
  ]);
});

test("both tools are kind:'write' (no read tool built in 2c)", () => {
  expect(MEMORY_ACTION_TOOLS.memory_forget.kind).toBe("write");
  expect(MEMORY_ACTION_TOOLS.memory_remember.kind).toBe("write");
});

// ─── tool_result serialization stability ───────────────────────────────────

test("serializeToolResult round-trips through JSON.parse to the same object", () => {
  const result = {
    ok: true as const,
    action: "forget" as const,
    factId: "x",
    message: "Forgotten.",
  };
  const serialized = serializeToolResult(result);
  expect(typeof serialized).toBe("string");
  expect(JSON.parse(serialized)).toEqual(result);
});

// ─── totality guard (compile-time) ─────────────────────────────────────────
// Adding a 3rd MemoryActionToolName without a corresponding table row is a
// COMPILE ERROR under `satisfies Record<MemoryActionToolName, MemoryActionToolSpec>`.
// This block documents the guard; it is a type-only assertion (no runtime check).

test("totality guard: Record<MemoryActionToolName,...> missing a row is a compile error (documented)", () => {
  type IncompleteTable = Record<MemoryActionToolName, MemoryActionToolSpec>;
  const incomplete = {
    memory_forget: MEMORY_ACTION_TOOLS.memory_forget,
    // @ts-expect-error — memory_remember row is missing; totality guard fires.
  } satisfies IncompleteTable;
  // Runtime assertion just so the test body isn't ONLY a type check.
  expect(incomplete.memory_forget.name).toBe("memory_forget");
});
