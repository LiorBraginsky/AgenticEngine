import type { Envelope } from "@agentic/protocol";
import type { MemoryStore } from "./store.js";
import { isUuidShaped } from "./store.js";
import type { WriteGate } from "./write-gate.js";
import type { SessionMessage } from "../providers/provider.js";
import type { MemoryProvider } from "./memory-provider.js";
import { memDebug } from "./debug-log.js";

type SessionStart = Extract<Envelope, { type: "session_start" }>;

/** How many recent messages to hydrate into prior context (architect-time recency window). */
const TAIL_LIMIT = 50;

/**
 * Bounded-wait timeout (ms) for whenIdle before proceeding with retrieve.
 * On timeout: log + proceed anyway (never hang).
 * The default is 5000ms. Pass a custom value to the constructor for tests.
 */
const WHEN_IDLE_TIMEOUT_MS_DEFAULT = 5000;

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
 *
 * v2-06 FIX-A: whenIdle? — optional hook returned by registerDistiller.
 *   On the new-thread FIRST turn ONLY, beginTurn awaits whenIdle() before retrieve()
 *   so the retrieve always sees facts committed by the most-recently-started distill run.
 *   Bounded at WHEN_IDLE_TIMEOUT_MS (5s) — on timeout, proceed + log (never hang).
 *
 * v2-08: the known-thread branch ALSO retrieves the cross-thread distilled slice
 *   (prepended before the tail) so a follow-up turn (turn 2+) keeps cross-thread
 *   memory. whenIdle stays NEW-THREAD-ONLY: the facts are already committed on a
 *   known-thread turn, and awaiting per turn would re-add latency + a per-turn block
 *   (the new-thread read-after-write race the whenIdle wait closes does NOT apply here).
 */
export class ThreadLifecycle {
  private readonly sessionToThread = new Map<string, string>();
  /** How many messages were hydrated (from the durable store) at beginTurn for each session. */
  private readonly sessionHydratedCount = new Map<string, number>();
  private readonly whenIdleTimeoutMs: number;

  constructor(
    private readonly store: MemoryStore,
    private readonly gate: WriteGate,
    private readonly memoryProvider?: MemoryProvider,
    private readonly whenIdle?: () => Promise<void>,
    /** Optional override for the whenIdle bounded-wait timeout (ms). Defaults to 5000.
     * Pass a small value in tests to keep the test fast. */
    whenIdleTimeoutMs?: number,
  ) {
    this.whenIdleTimeoutMs = whenIdleTimeoutMs ?? WHEN_IDLE_TIMEOUT_MS_DEFAULT;
  }

  async beginTurn(inbound: SessionStart): Promise<{ threadId: string; priorMessages: SessionMessage[] }> {
    const requested = inbound.thread_id;
    if (requested && this.store.threadExists(requested)) {
      // v2-08 fix A: a known-thread turn ALSO re-injects the cross-thread distilled
      // slice (the [remembered] facts) BEFORE the thread's own tail, so a follow-up
      // turn (turn 2+) keeps cross-thread memory. New-thread branch is unchanged.
      // whenIdle is NEW-THREAD-ONLY: the facts are already committed on a known-thread
      // turn, and awaiting per turn would re-add latency + a per-turn block (the
      // new-thread read-after-write race the whenIdle wait closes does NOT apply here).
      const facts = this.memoryProvider
        ? await this.memoryProvider.retrieve(this.store, requested)
        : [];
      const tail = this.store.readThreadTail(requested, TAIL_LIMIT);
      return { threadId: requested, priorMessages: [...facts, ...tail] };
    }
    // No / unknown thread_id ⇒ mint a NEW thread (MF-01 §3.1).
    // CM-01 adoption (spec §3.3): an unknown-but-UUID-shaped thread_id is adopted
    // as the new thread's id, so the overlay (which mints it client-side, since
    // session_ack carries no thread_id) and the daemon agree on the durable id
    // without any wire change. Non-UUID garbage is NOT adopted → fresh mint
    // (gotcha #9: no garbage durable keys). Single write path through createThread.
    const adoptId = requested && isUuidShaped(requested) ? requested : undefined;
    const newThreadId = this.store.createThread(undefined, adoptId);
    // v2-06 FIX-A: on the new-thread FIRST turn, await whenIdle() before retrieve()
    // so retrieve always reads facts committed by the most-recently-started distill run.
    // Bounded at WHEN_IDLE_TIMEOUT_MS — on timeout, proceed + log (never hang).
    // Timer is always cleared (no leak): the timeout promise clears it on settle,
    // and the whenIdle promise also clears it on settle via the outer Promise.race winner.
    if (this.whenIdle) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<"timeout">((res) => {
        timeoutHandle = setTimeout(() => res("timeout"), this.whenIdleTimeoutMs);
      });
      const settled = await Promise.race([
        this.whenIdle().then(() => "idle" as const),
        timeoutPromise,
      ]);
      // Always clear the timer — prevents a dangling setTimeout after whenIdle() wins.
      clearTimeout(timeoutHandle);
      if (settled === "timeout") {
        console.error(
          `[lifecycle] whenIdle timed out after ${this.whenIdleTimeoutMs}ms for new thread ${newThreadId} — proceeding with retrieve`,
        );
        memDebug("retrieve", { forThreadId: newThreadId, whenIdleTimedOut: true });
      }
    }
    // Cross-thread distilled-slice injection (MF-02 injection-point) — fires on
    // the adopted id identically, because it keys off the returned newThreadId.
    const priorMessages = this.memoryProvider
      ? await this.memoryProvider.retrieve(this.store, newThreadId)
      : [];
    return { threadId: newThreadId, priorMessages };
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
    // MF-03 (5e, Q1): per-message authorship derives from role — a user turn is
    // human, an assistant turn is machine. appendTurn scans + stamps each message
    // individually; this replaces the MF-01/02 blanket "machine" stamp that
    // over-claimed for user turns. appendMessages assigns monotonic turn_index per
    // call (store.ts:80), so per-message flushing preserves order.
    for (const m of delta) {
      this.gate.appendTurn(threadId, [m], sessionId, {
        actor: m.role === "user" ? "user" : "agent",
        authored_by: m.role === "user" ? "human" : "machine",
      });
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
