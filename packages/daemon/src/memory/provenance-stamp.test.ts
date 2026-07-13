/**
 * Unit tests for stampProvenance helper (T2.3a).
 *
 * TDD: these tests are written FIRST — before the implementation exists.
 *
 * A. stampProvenance on a show_text tool_call:
 *    - appends the provenance line to the content
 *    - original content is preserved (prefix unchanged)
 *    - parseEnvelope(stamped) still returns kind:"ok"
 *
 * B. stampProvenance on a non-show_text envelope (e.g. session_ack):
 *    - returns the same reference unchanged
 */

import { test, expect } from "bun:test";
import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { stampProvenance } from "./provenance-stamp.js";

// ─── A. show_text tool_call ────────────────────────────────────────────────

const showTextEnv: Envelope = {
  type: "tool_call",
  session_id: "s-1",
  call_id: "c-1",
  payload: {
    tool: "show_text",
    args: {
      text: {
        primitive: "text",
        content: "Hello, world! This is the LLM reply.",
      },
    },
  },
};

test("stampProvenance: show_text → appends provenance line to content", () => {
  const stamped = stampProvenance(showTextEnv);
  expect(stamped.type).toBe("tool_call");
  if (stamped.type !== "tool_call") return;
  expect(stamped.payload.tool).toBe("show_text");
  if (stamped.payload.tool !== "show_text") return;
  const content = stamped.payload.args.text.content;
  expect(content).toContain("\n\n— this reply used remembered context · view it in the menu bar → Open Memory…");
});

test("stampProvenance: show_text → original content is preserved as prefix", () => {
  const stamped = stampProvenance(showTextEnv);
  if (stamped.type !== "tool_call") return;
  if (stamped.payload.tool !== "show_text") return;
  const content = stamped.payload.args.text.content;
  expect(content.startsWith("Hello, world! This is the LLM reply.")).toBe(true);
});

test("stampProvenance: stamped show_text passes parseEnvelope validation", () => {
  const stamped = stampProvenance(showTextEnv);
  const result = parseEnvelope(stamped);
  expect(result.kind).toBe("ok");
});

test("stampProvenance: original envelope is not mutated (returns a copy)", () => {
  const originalContent = "Hello, world! This is the LLM reply.";
  const stamped = stampProvenance(showTextEnv);
  // original must be unchanged
  if (showTextEnv.type !== "tool_call") return;
  if (showTextEnv.payload.tool !== "show_text") return;
  expect(showTextEnv.payload.args.text.content).toBe(originalContent);
  // stamped must differ
  expect(stamped).not.toBe(showTextEnv);
});

// ─── B. Non-show_text envelopes returned as-is ───────────────────────────

const sessionAckEnv: Envelope = {
  type: "session_ack",
  session_id: "s-1",
};

test("stampProvenance: session_ack returned as same reference (unchanged)", () => {
  const result = stampProvenance(sessionAckEnv);
  expect(result).toBe(sessionAckEnv);
});

const sessionEndEnv: Envelope = {
  type: "session_end",
  session_id: "s-1",
  reason: "completed",
};

test("stampProvenance: session_end returned as same reference (unchanged)", () => {
  const result = stampProvenance(sessionEndEnv);
  expect(result).toBe(sessionEndEnv);
});

const showColorPickerEnv: Envelope = {
  type: "tool_call",
  session_id: "s-1",
  call_id: "c-2",
  payload: {
    tool: "show_color_picker",
    args: {
      picker: {
        primitive: "color-picker",
        question: "Pick a color",
        palette: [{ label: "Red", hex: "#FF0000" }],
      },
    },
  },
};

test("stampProvenance: show_color_picker tool_call returned as same reference (unchanged)", () => {
  const result = stampProvenance(showColorPickerEnv);
  expect(result).toBe(showColorPickerEnv);
});
