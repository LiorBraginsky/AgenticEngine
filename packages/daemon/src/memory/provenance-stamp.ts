import type { Envelope } from "@agentic/protocol";

/**
 * Line appended to show_text content when a reply used injected cross-thread memory.
 *
 * Points at the in-overlay Memory window (tray → "Open Memory…", the exact live label
 * in apps/overlay/src-tauri/src/lib.rs). The old history.html port-URL was dropped
 * (spec 2026-07-13-in-answer-provenance-affordance §0.3): the overlay is by definition
 * running when this line renders, so the tray path is always available, and the URL was
 * inert plain text anyway (text-reply.ts is textContent-only).
 */
export function provenanceLine(): string {
  return `\n\n— this reply used remembered context · view it in the menu bar → Open Memory…`;
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
export function stampProvenance(env: Envelope): Envelope {
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
          content: original + provenanceLine(),
        },
      },
    },
  };
}
