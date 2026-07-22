import { test, expect } from "bun:test";
import {
  MEMORY_ACTION_TOOLS,
  MEMORY_ACTION_TOOLS_PARAM,
  serializeToolResult,
  type MemoryActionToolName,
  type MemoryActionToolSpec,
} from "./memory-action-tools.js";
import { buildMemoryToolsParam } from "./memory-action-tools.js";
import type { MemoryActionResult } from "../memory/memory-action-port.js";

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

// ─── hybrid-05: memory_search read tool (registry row + capability gating) ─

test("hybrid-05: memory_search is registered as kind:'read' (the totality guard forces classification)", () => {
  expect(MEMORY_ACTION_TOOLS.memory_search.kind).toBe("read");
  expect(MEMORY_ACTION_TOOLS.memory_search.input_schema.type).toBe("object");
  expect(MEMORY_ACTION_TOOLS.memory_search.input_schema.required).toEqual(["query"]);
});

test("hybrid-05: MEMORY_ACTION_TOOLS_PARAM stays write-only (byte-identical to 2c — the no-search invariant)", () => {
  expect(MEMORY_ACTION_TOOLS_PARAM.map((t) => t.name)).toEqual(["memory_forget", "memory_remember"]);
});

test("hybrid-05: buildMemoryToolsParam gates memory_search on the capability flag (D6d)", () => {
  expect(buildMemoryToolsParam(false).map((t) => t.name)).toEqual(["memory_forget", "memory_remember"]);
  expect(buildMemoryToolsParam(true).map((t) => t.name)).toEqual(["memory_forget", "memory_remember", "memory_search"]);
});

test("hybrid-05: serializeToolResult frames search results as UNTRUSTED data with a leading note", () => {
  const result: MemoryActionResult = {
    ok: true, action: "search",
    results: [{ kind: "archive", source: "you said in a past conversation", text: "deadline is Friday" }],
  };
  const parsed = JSON.parse(serializeToolResult(result)) as { note: string; results: unknown[] };
  expect(parsed.note).toContain("UNTRUSTED");
  expect(parsed.results).toHaveLength(1);
});

test("D1-lang: memory_remember description steers same-language storage (language-agnostic)", () => {
  expect(MEMORY_ACTION_TOOLS.memory_remember.description.toLowerCase()).toContain("same language the user used");
});

test("hybrid-05: serializeToolResult leaves non-search results byte-unchanged", () => {
  const forget: MemoryActionResult = { ok: true, action: "forget", factId: "f1", message: "Forgotten." };
  expect(serializeToolResult(forget)).toBe(JSON.stringify(forget));
});
