import type { Envelope } from "@agentic/protocol";
import type { MemoryStore } from "./store.js";
import type { WriteGate } from "./write-gate.js";
import type { SessionMessage } from "../providers/provider.js";

type SessionStart = Extract<Envelope, { type: "session_start" }>;

/** How many recent messages to hydrate into prior context (architect-time recency window). */
const TAIL_LIMIT = 50;

/**
 * ThreadLifecycle — the SINGLE place the MF-01 behavioral change lives (§7.1).
 * Two-phase, because the daemon does NOT know the provider-minted session_id
 * until AFTER provider.advance():
 *   beginTurn(session_start)   → resolve thread_id (inbound, or mint) + hydrate prior tail.
 *   bindSession(sid, thread)   → record session_id→thread_id once the provider returns it.
 *   endTurn(thread, sid, msgs) → flush the turn through the WRITE-GATE, then unbind.
 */
export class ThreadLifecycle {
  private readonly sessionToThread = new Map<string, string>();

  constructor(
    private readonly store: MemoryStore,
    private readonly gate: WriteGate,
  ) {}

  beginTurn(inbound: SessionStart): { threadId: string; priorMessages: SessionMessage[] } {
    const requested = inbound.thread_id;
    if (requested && this.store.threadExists(requested)) {
      return { threadId: requested, priorMessages: this.store.readThreadTail(requested, TAIL_LIMIT) };
    }
    // No / unknown thread_id ⇒ mint a NEW thread (single-turn = degenerate one-turn thread).
    return { threadId: this.store.createThread(), priorMessages: [] };
  }

  bindSession(sessionId: string, threadId: string): void {
    this.sessionToThread.set(sessionId, threadId);
  }

  threadForSession(sessionId: string): string | undefined {
    return this.sessionToThread.get(sessionId);
  }

  /** Flush the completed turn's messages to the durable thread via the WRITE-GATE, then unbind. */
  endTurn(threadId: string, sessionId: string, finalMessages: SessionMessage[]): void {
    if (finalMessages.length > 0) {
      this.gate.appendTurn(threadId, finalMessages, sessionId, { actor: "agent", authored_by: "machine" });
    }
    this.sessionToThread.delete(sessionId);
  }

  /** Connection drop cleanup (mirrors index.ts close()). */
  forgetSession(sessionId: string): void {
    this.sessionToThread.delete(sessionId);
  }
}
