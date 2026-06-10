import type { Envelope } from "@agentic/protocol";

/** Line appended to show_text content when a reply used injected cross-thread memory. */
export function provenanceLine(port: number): string {
  return `\n\n— this reply used remembered context · view in History: http://127.0.0.1:${port}/history.html`;
}

/**
 * Pure helper — stamps a provenance line onto a show_text tool_call envelope.
 *
 * If `env` is a `tool_call` whose `payload.tool === "show_text"`, returns a deep
 * copy with the provenance line appended to `payload.args.text.content`.
 * All other envelopes are returned as the SAME reference (no allocation).
 *
 * The stamped envelope passes `parseEnvelope` validation because `content` is
 * an unconstrained string in `TextPrimitive` (primitives.ts:47-51).
 *
 * FROZEN: does not modify packages/protocol/** (additive string growth only).
 */
export function stampProvenance(env: Envelope, port: number): Envelope {
  if (env.type !== "tool_call") return env;
  if (env.payload.tool !== "show_text") return env;

  const original = env.payload.args.text.content;
  return {
    ...env,
    payload: {
      ...env.payload,
      args: {
        text: {
          ...env.payload.args.text,
          content: original + provenanceLine(port),
        },
      },
    },
  };
}
