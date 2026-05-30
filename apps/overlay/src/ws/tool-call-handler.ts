import { classifyTool, ShowColorPickerResult } from "@agentic/protocol";
import type { Envelope, ColorPickerPrimitive, ColorSwatch } from "@agentic/protocol";

type ToolCall = Extract<Envelope, { type: "tool_call" }>;
type ToolResult = Extract<Envelope, { type: "tool_result" }>;
type ToolCancel = Extract<Envelope, { type: "tool_cancel" }>;

export type RenderDecision =
  | { kind: "render"; session_id: string; call_id: string; picker: ColorPickerPrimitive }
  | { kind: "ignore" };

export function decideRender(call: ToolCall, confirmedSessionId: string | undefined): RenderDecision {
  if (confirmedSessionId === undefined || call.session_id !== confirmedSessionId) {
    return { kind: "ignore" };
  }
  const cls = classifyTool(call.payload.tool);
  if (!cls.known || cls.name !== "show_color_picker") {
    return { kind: "ignore" };
  }
  return { kind: "render", session_id: call.session_id, call_id: call.call_id, picker: call.payload.args.picker };
}

export function buildToolResult(session_id: string, call_id: string, picked: ColorSwatch): ToolResult {
  const result = { picked };
  ShowColorPickerResult.parse(result);
  return { type: "tool_result", session_id, call_id, payload: { tool: "show_color_picker", result } };
}

export function buildToolCancel(session_id: string, call_id: string): ToolCancel {
  return { type: "tool_cancel", session_id, call_id };
}
