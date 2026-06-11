import { parseEnvelope } from "@agentic/protocol";
import type { WebSocketFactory } from "./types.js";
import {
  buildSessionStart, routeInbound, WS_URL, DEFAULT_HANDSHAKE_TIMEOUT_MS,
  type RunSessionOptions, type SessionResult, type SessionContext,
} from "./session-client.js";
import { backoffDelayMs, DEFAULT_BACKOFF } from "./backoff.js";

/**
 * CM-02: owns ONE persistent WebSocket for the overlay's lifetime.
 * - connect() opens the socket (on overlay activation; close-on-dismiss is chunk 03).
 * - runSession() rides the shared socket: registers a per-turn SessionContext into
 *   a dispatcher Map<sessionId, SessionContext> (single-flight today, Map-ready seam).
 * - Inbound frames route by session_id (correlated via client_session_id echo);
 *   unknown/non-active session_id frames are silently dropped (gotcha #9 / spec §3.5).
 * - Mid-flight drop settles the active turn LOCALLY as {reason:"cancelled"} (nothing
 *   on the wire) and schedules a backoff reconnect (D1). currentThreadId is owned by
 *   the caller (main.ts) and is NOT reset here (involuntary drop ≠ dismiss).
 */
export interface ConnectionManagerDeps {
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (h: ReturnType<typeof setTimeout>) => void;
  random?: () => number;
  baseMs?: number;
  capMs?: number;
}

export class ConnectionManager {
  private ws?: WebSocketLike_Internal;
  private readonly pending = new Map<string, SessionContext>(); // confirmed: keyed by session_id
  private pendingByCid?: SessionContext;                         // the one turn awaiting its session_ack
  private reconnectAttempt = 0;
  private active = false;                                        // connect() called, not torn down
  private readonly setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (h: ReturnType<typeof setTimeout>) => void;
  private readonly random: () => number;
  private readonly baseMs: number;
  private readonly capMs: number;

  constructor(private readonly factory: WebSocketFactory, deps: ConnectionManagerDeps = {}) {
    this.setTimeoutFn = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutFn = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));
    this.random = deps.random ?? Math.random;
    this.baseMs = deps.baseMs ?? DEFAULT_BACKOFF.baseMs;
    this.capMs = deps.capMs ?? DEFAULT_BACKOFF.capMs;
  }

  connect(): void {
    this.active = true;
    this.openSocket();
  }

  private openSocket(): void {
    const ws = this.factory(WS_URL);
    this.ws = ws;
    ws.addEventListener("open", () => { this.reconnectAttempt = 0; });
    ws.addEventListener("message", (ev) => this.dispatch(ev.data));
    ws.addEventListener("error", () => {/* close event drives recovery */});
    ws.addEventListener("close", () => this.onSocketClose());
  }

  private onSocketClose(): void {
    // Mid-flight drop: settle the active turn LOCALLY as cancelled (nothing on wire). D6.
    // The pending Map holds ≤1 entry by the single-flight invariant (gotcha #45), so [0] is the
    // one active confirmed turn — not a pick-first-of-many.
    const ctx = this.pendingByCid ?? [...this.pending.values()][0];
    if (ctx && !ctx.settled) {
      ctx.disarmTimeout();
      ctx.settle({ sessionId: ctx.confirmedSessionId ?? "", reason: "cancelled" });
    }
    this.pending.clear();
    this.pendingByCid = undefined;
    this.ws = undefined;
    if (this.active) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = backoffDelayMs(this.reconnectAttempt++, { baseMs: this.baseMs, capMs: this.capMs, random: this.random });
    this.setTimeoutFn(() => { if (this.active && !this.ws) this.openSocket(); }, delay);
  }

  /**
   * Voluntary dismiss (CM-03): close the socket and do NOT reconnect. Sets active=false
   * BEFORE ws.close() so the shared onSocketClose() handler — which reconnects only while
   * active — settles any in-flight turn locally (cancelled-equivalent) and stays down.
   * The caller (main.ts) owns currentThreadId reset and any fresh-manager re-creation;
   * this method only severs the connection. Contrast: an involuntary drop fires close while
   * active is still true → reconnect (the load-bearing asymmetry, spec §3.1/§3.2).
   */
  dismiss(): void {
    this.active = false;
    this.ws?.close();
  }

  /**
   * Single-flight INVARIANT (cross-file): callers must not start a new turn while one is
   * in flight. main.ts enforces this via its `inFlight` guard; the dispatcher Map therefore
   * holds at most ONE SessionContext (gotcha #45 unchanged).
   */
  runSession(text: string, options: RunSessionOptions = {}): Promise<SessionResult> {
    return new Promise<SessionResult>((resolve, reject) => {
      const { msg, clientSessionId } = buildSessionStart(text, options.threadId);
      const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const ctx: SessionContext = {
        clientSessionId, options, settled: false,
        send: (d) => this.ws?.send(d),
        disarmTimeout: () => { if (timer !== undefined) { this.clearTimeoutFn(timer); timer = undefined; } },
        settle: (result) => {
          if (ctx.settled) return;
          ctx.settled = true; ctx.disarmTimeout();
          if (ctx.confirmedSessionId) this.pending.delete(ctx.confirmedSessionId);
          if (this.pendingByCid === ctx) this.pendingByCid = undefined;
          resolve(result);
        },
        failTurn: (err) => {
          if (ctx.settled) return;
          ctx.settled = true; ctx.disarmTimeout();
          if (ctx.confirmedSessionId) this.pending.delete(ctx.confirmedSessionId);
          if (this.pendingByCid === ctx) this.pendingByCid = undefined;
          reject(err);
        },
      };

      this.pendingByCid = ctx;

      timer = this.setTimeoutFn(() => {
        const err = new Error(`runSession timed out after ${timeoutMs}ms`);
        err.name = "HandshakeTimeoutError";
        ctx.failTurn(err);
      }, timeoutMs);

      if (this.ws === undefined) {
        // No live socket yet (rare: submit before first open). Fail this turn as timeout
        // would; but simplest correct behavior: reject so main.ts shows an error card and
        // the user retries once reconnect lands. (Reconnect is automatic; the turn itself
        // is not auto-resent — single-flight, gotcha #45.)
        ctx.failTurn(new Error("no connection"));
        return;
      }
      // Wrap send in try/catch: the socket may still be CONNECTING when runSession is called
      // (rare race — ws is assigned in openSocket() before the "open" event fires). A send
      // on a CONNECTING socket throws InvalidStateError synchronously inside this executor,
      // AFTER the handshake timer is armed and BEFORE any disarm → timer leak + raw rejection.
      // Funnelling through failTurn ensures the timer is disarmed via the existing path (option b).
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (sendErr) {
        ctx.failTurn(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
        return;
      }
      options.onSessionStart?.();
    });
  }

  private dispatch(raw: unknown): void {
    const parsed = parseEnvelope(typeof raw === "string" ? safeJson(raw) : raw);
    if (parsed.kind !== "ok") return; // unknown/invalid silently dropped (gotcha #9)
    const env = parsed.message;

    if (env.type === "session_ack") {
      const ctx = this.pendingByCid;
      if (ctx && env.client_session_id === ctx.clientSessionId) {
        routeInbound(env, ctx);                 // binds confirmedSessionId
        this.pending.set(env.session_id, ctx);  // now routable by session_id
        this.pendingByCid = undefined;
      }
      return; // ack for an unknown cid → dropped
    }
    // tool_call / session_end / others: route by session_id; drop if not in the Map.
    const sid = (env as { session_id?: string }).session_id;
    const ctx = sid ? this.pending.get(sid) : undefined;
    if (!ctx) return; // unknown/non-active session_id → silently dropped (spec §3.5)
    routeInbound(env, ctx);
  }
}

// Internal alias to avoid confusion with the exported WebSocketFactory's return type.
type WebSocketLike_Internal = ReturnType<WebSocketFactory>;

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
