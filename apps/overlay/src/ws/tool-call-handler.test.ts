import { test, expect } from "bun:test";
import { decideRender } from "./tool-call-handler.js";

const colorPickerToolCall = {
  type: "tool_call" as const,
  session_id: "srv-1",
  call_id: "call-1",
  payload: {
    tool: "show_color_picker" as const,
    args: { picker: { primitive: "color-picker" as const, question: "Pick", palette: [{ label: "Red", hex: "#FF0000" }] } },
  },
};

test("decideRender returns render with the picker when tool_call matches confirmed session", () => {
  const d = decideRender(colorPickerToolCall, "srv-1");
  expect(d.kind).toBe("render");
  if (d.kind === "render") {
    expect(d.session_id).toBe("srv-1");
    expect(d.call_id).toBe("call-1");
    expect(d.picker.question).toBe("Pick");
    expect(d.picker.palette[0]!.label).toBe("Red");
  }
});

test("decideRender ignores a tool_call for an unconfirmed/mismatched session", () => {
  expect(decideRender(colorPickerToolCall, undefined).kind).toBe("ignore");
  expect(decideRender(colorPickerToolCall, "other").kind).toBe("ignore");
});

test("decideRender ignores an unknown tool gracefully (no throw, forward-compat)", () => {
  const unknown = { ...colorPickerToolCall, payload: { tool: "show_mystery", args: {} } } as unknown as Parameters<typeof decideRender>[0];
  expect(() => decideRender(unknown, "srv-1")).not.toThrow();
  expect(decideRender(unknown, "srv-1").kind).toBe("ignore");
});

import { buildToolResult, buildToolCancel } from "./tool-call-handler.js";
import { parseEnvelope } from "@agentic/protocol";

test("buildToolResult emits a contract-valid tool_result with picked nested under payload.result", () => {
  const msg = buildToolResult("srv-1", "call-1", { label: "Azure", hex: "#1E90FF" });
  expect(parseEnvelope(msg).kind).toBe("ok");
  expect(msg.payload.result.picked.label).toBe("Azure");
});

test("buildToolCancel emits a contract-valid tool_cancel carrying call_id", () => {
  const msg = buildToolCancel("srv-1", "call-1");
  expect(parseEnvelope(msg).kind).toBe("ok");
  expect(msg.call_id).toBe("call-1");
});
