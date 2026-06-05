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
 *   bindSession(sid, thread, hydratedCount)  → record session_id→thread_id + how many
 *                               messages were hydrated, so endTurn can slice the DELTA only.
 *   endTurn(thread, sid, msgs) → flush ONLY the new-this-turn delta (msgs.slice(hydratedCount))
 *                               through the WRITE-GATE, then unbind.
 *
 * WHY hydratedCount is stored keyed by session_id (not by threadId or inline):
 *   For the mock provider, one logical turn spans TWO WS messages: session_start →
 *   awaiting_pick (no flush yet), then tool_result → done (the flush). hydratedCount is
 *   known at beginTurn (session_start) but needed at endTurn (tool_result). bindSession
 *   is called between the two — after provider.advance() returns the minted session_id —
 *   so it is the natural place to record the count under that session_id.
 *   Invariant: only the session_start-triggered beginTurn sets hydratedCount; a later
 *   non-session_start message of the same session does NOT call bindSession again, so
 *   the stored count is never accidentally reset to 0.
 */
export class ThreadLifecycle {
  private readonly sessionToThread = new Map<string, string>();
  /** How many messages were hydrated (from the durable store) at beginTurn for each session. */
  private readonly sessionHydratedCount = new Map<string, number>();

  constructor(
    private readonly store: MemoryStore,
    private readonly gate: WriteGate,
  ) {}

  beginTurn(inbound: SessionStart): { threadId: string; priorMessages: SessionMessage[] } {
    const requested = inbound.thread_id;
    if (requested && this.store.threadExists(requested)) {
      const priorMessages = this.store.readThreadTail(requested, TAIL_LIMIT);
      return { threadId: requested, priorMessages };
    }
    // No / unknown thread_id ⇒ mint a NEW thread (single-turn = degenerate one-turn thread).
    return { threadId: this.store.createThread(), priorMessages: [] };
  }

  /**
   * Record the session_id → thread_id binding AND the number of hydrated messages
   * (from beginTurn's priorMessages.length). Called once per session, after
   * provider.advance() returns the provider-minted session_id.
   */
  bindSession(sessionId: string, threadId: string, hydratedCount: number): void {
    this.sessionToThread.set(sessionId, threadId);
    this.sessionHydratedCount.set(sessionId, hydratedCount);
  }

  threadForSession(sessionId: string): string | undefined {
    return this.sessionToThread.get(sessionId);
  }

  /**
   * Flush ONLY the turn DELTA (the messages new this turn) to the durable thread via
   * the WRITE-GATE, then unbind. The delta = finalMessages.slice(hydratedCount): the
   * provider re-attaches the hydrated prefix onto finalMessages so the LLM sees context,
   * but only the suffix (the messages actually produced this turn) must be persisted.
   */
  endTurn(threadId: string, sessionId: string, finalMessages: SessionMessage[]): void {
    const hydratedCount = this.sessionHydratedCount.get(sessionId) ?? 0;
    const delta = finalMessages.slice(hydratedCount);
    if (delta.length > 0) {
      // MF-01 stamps turn-level "machine" provenance as a placeholder.
      // TODO (chunk 03, 5e): derive per-message human-authorship from `role` —
      // `role === "user"` messages are human-authored; this stamp currently
      // over-claims "machine" for them. 5e no-overwrite must key off `role`, not
      // this authored_by stamp, until a per-message column is added.
      this.gate.appendTurn(threadId, delta, sessionId, { actor: "agent", authored_by: "machine" });
    }
    this.sessionToThread.delete(sessionId);
    this.sessionHydratedCount.delete(sessionId);
  }

  /** Connection drop cleanup (mirrors index.ts close()). */
  forgetSession(sessionId: string): void {
    this.sessionToThread.delete(sessionId);
    this.sessionHydratedCount.delete(sessionId);
  }
}
