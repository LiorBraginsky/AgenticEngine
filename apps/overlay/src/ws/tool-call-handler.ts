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
  if (call.payload.tool !== "show_color_picker") {
    return { kind: "ignore" };
  }
  return { kind: "render", session_id: call.session_id, call_id: call.call_id, picker: call.payload.args.picker };
}

export type TextRenderDecision =
  | { kind: "render-text"; content: string }
  | { kind: "ignore" };

/**
 * Display-only decider for show_text tool_calls. Parallel to decideRender.
 * Returns render-text with the text content when the call is a show_text
 * for the confirmed session; otherwise returns ignore.
 * NEVER throws (gotcha #9 discipline).
 */
export function decideTextRender(call: ToolCall, confirmedSessionId: string | undefined): TextRenderDecision {
  if (confirmedSessionId === undefined || call.session_id !== confirmedSessionId) {
    return { kind: "ignore" };
  }
  if (call.payload.tool !== "show_text") {
    return { kind: "ignore" };
  }
  // Narrow the payload to show_text before reading args (type-safe access).
  const content = call.payload.args.text.content;
  return { kind: "render-text", content };
}

export function buildToolResult(session_id: string, call_id: string, picked: ColorSwatch): ToolResult {
  const result = { picked };
  ShowColorPickerResult.parse(result);
  return { type: "tool_result", session_id, call_id, payload: { tool: "show_color_picker", result } };
}

export function buildToolCancel(session_id: string, call_id: string): ToolCancel {
  return { type: "tool_cancel", session_id, call_id };
}
