import type { Envelope } from "@agentic/protocol";

/**
 * Trivial v0 session lifecycle (just enough for 02a + 02b-i to build against):
 * the daemon MINTS session_id (crypto.randomUUID — web-standard, ADR-0004),
 * acks it (echoing the client's correlation id), then ends the session.
 * Real reasoning-loop logic arrives in chunk 02a — out of scope here.
 */
type SessionStartMsg = Extract<Envelope, { type: "session_start" }>;

export function handleSessionStart(msg: SessionStartMsg): Envelope[] {
  const session_id = crypto.randomUUID();
  return [
    { type: "session_ack", session_id, client_session_id: msg.client_session_id },
    { type: "session_end", session_id, reason: "completed" },
  ];
}
