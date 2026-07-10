/**
 * memory-action-tools.ts — daemon-internal AGENT ACTION TOOL registry (ADR-0016).
 *
 * A SECOND tool plane, distinct from the frozen wire UI-tool contract
 * (`@agentic/protocol`'s `ToolCallPayload`, ADR-0002/0005): these tools have no
 * render, execute INSIDE the provider adapter (`advance()`), and never touch the
 * wire. Closed set, engine-owned, namespaced `memory_*` (ADR-0016 decision 2).
 *
 * The `satisfies Record<MemoryActionToolName, MemoryActionToolSpec>` below is
 * the TOTALITY GUARD: adding a MemoryActionToolName without a corresponding row
 * is a COMPILE ERROR (ADR-0005 versioning discipline, ported to this plane).
 *
 * `kind:"read"|"write"` is the 2d forward-compat slot (ADR-0016 decision 2):
 * the registry ADMITS a future read tool (e.g. `memory_search`) without
 * reshaping. NO read tool is built in 2c.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { MemoryActionResult } from "../memory/memory-action-port.js";

export type MemoryActionToolName = "memory_forget" | "memory_remember";

/** 2d forward-compat slot (ADR-0016 decision 2). NO read tool built in 2c. */
export type ToolKind = "read" | "write";

export interface MemoryActionToolSpec {
  name: MemoryActionToolName;
  kind: ToolKind;
  description: string;
  input_schema: Anthropic.Tool.InputSchema; // { type:"object", properties, required }
}

/** Total interaction table: `satisfies Record<…>` ⇒ adding a MemoryActionToolName
 *  without a row is a COMPILE ERROR (ADR-0005 versioning discipline, ported). */
export const MEMORY_ACTION_TOOLS = {
  memory_forget: {
    name: "memory_forget",
    kind: "write",
    description:
      "Permanently forget (delete) ONE fact from the numbered list of remembered " +
      "facts shown to you this turn. Call this when the user asks you to forget a " +
      "fact you can see in that list. `ordinal` is the fact's number (e.g. 3 for " +
      "`[remembered] 3. …`). `expected_text` is that fact's text EXACTLY as shown, " +
      "WITHOUT the leading number. Only facts in the current list can be forgotten.",
    input_schema: {
      type: "object",
      properties: {
        ordinal: { type: "integer", description: "The fact's number in the remembered list." },
        expected_text: { type: "string", description: "The fact text exactly as shown, without the leading number." },
        reason: { type: "string", description: "Optional short reason." },
      },
      required: ["ordinal", "expected_text"],
    },
  },
  memory_remember: {
    name: "memory_remember",
    kind: "write",
    description:
      "Remember a new fact about the user, or replace one already in the numbered list. " +
      "`fact` is the note text in the user's own language. To CHANGE a fact already " +
      "shown this turn (the user stated a different value for it), set `replaces_ordinal` " +
      "to its number and `expected_text` to its current text (without the leading number) " +
      "— do NOT emit a near-duplicate. Omit both to add a brand-new fact.",
    input_schema: {
      type: "object",
      properties: {
        fact: { type: "string", description: "The fact text to remember, in the user's language." },
        replaces_ordinal: { type: "integer", description: "The number of the fact this replaces, if any." },
        expected_text: { type: "string", description: "Current text of the fact being replaced, without the leading number." },
      },
      required: ["fact"],
    },
  },
} satisfies Record<MemoryActionToolName, MemoryActionToolSpec>;

/** The `tools[]` array declared in the request when the port is wired. */
export const MEMORY_ACTION_TOOLS_PARAM: Anthropic.Tool[] =
  Object.values(MEMORY_ACTION_TOOLS).map((t) => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
  }));

/** STABLE tool_result serialization = the MemoryActionResult JSON (de-facto 2d contract). */
export function serializeToolResult(result: MemoryActionResult): string {
  return JSON.stringify(result);
}
