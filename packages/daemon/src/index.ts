import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { join } from "node:path";
import { homedir } from "node:os";
import { isOriginAllowed } from "./origin.js";
import { buildInjector } from "./providers/injector.js";
import type { AgentProvider, ProviderSessionState, ProviderInput, MemoryTurnSlice } from "./providers/provider.js";
import { withRememberedIndex, buildOrdinalMap } from "./providers/memory-turn-slice.js";
import { MemoryStore } from "./memory/store.js";
import { WriteGate } from "./memory/write-gate.js";
import { RuleBasedScanner } from "./memory/scanner/memory-scanner.js";
import { ThreadLifecycle } from "./memory/thread-lifecycle.js";
import { ConsolidationHook } from "./memory/consolidation-hook.js";
import { buildMemoryProvider } from "./memory/memory-provider-selector.js";
import type { MemoryProvider } from "./memory/memory-provider.js";
import { registerDistiller } from "./memory/distiller-registration.js";
import { Hatch } from "./memory/hatch.js";
import { MemoryActionPort } from "./memory/memory-action-port.js";
import { handleMemoryHttp } from "./memory/http-routes.js";
import { TokenStore } from "./memory/token-store.js";
import { stampProvenance } from "./memory/provenance-stamp.js";
import { memDebug, previewStr } from "./memory/debug-log.js";
import { REMEMBERED_LABEL } from "./providers/system-prompt.js";

export const DAEMON_HOST = "127.0.0.1"; // loopback only (ADR-0003 p.3)
export const DAEMON_PORT = 7777;

const sessions = new Map<string, ProviderSessionState>();
type SocketData = {
  sessionIds: Set<string>;
  activeThreadId?: string;
  dismissedThreadIds?: Set<string>;
  // CM-03: every durable thread this connection touched (one per session_start).
  // close(ws) dismisses each not-yet-dismissed one. A single value (activeThreadId)
  // is insufficient — a same-socket thread switch must dismiss BOTH on close (spec §3.2).
  touchedThreadIds?: Set<string>;
};

function send(
  ws: { send(data: string): number },
  msg: Envelope,
  port: number,
  injectedMemory: boolean,
): void {
  // T2.3a: stamp the provenance line on show_text envelopes when this turn drew
  // on cross-thread injected memory (new OR known thread; iff ≥1 [remembered] fact injected this turn).
  const out = injectedMemory ? stampProvenance(msg, port) : msg;
  // Outbound is validated against the frozen contract too (defence in depth).
  const check = parseEnvelope(out);
  if (check.kind !== "ok") {
    console.error("[daemon] refusing to send invalid outbound message", check);
    return;
  }
  ws.send(JSON.stringify(out));
}

const REDUCER_INPUT_TYPES = new Set(["session_start", "tool_result", "tool_cancel"]);

/**
 * Start the daemon on the given port.
 *
 * @param port    - TCP port (0 = OS-assigned ephemeral port). Defaults to DAEMON_PORT.
 * @param provider - Optional AgentProvider override for testing. When omitted, the
 *                   production provider is selected by the LLM_PROVIDER env var via
 *                   buildInjector(). Tests inject a fake provider so they can drive
 *                   show_text envelopes without a real LLM key or network call.
 * @param memoryProvider - additive test/harness injection seam (mirrors provider?);
 *                   production uses buildMemoryProvider(). The demo harness injects
 *                   a SmartDistillerProvider with a scripted clientFactory so the full
 *                   flow runs deterministically without a live Anthropic key.
 */
export function startDaemon(port: number = DAEMON_PORT, provider?: AgentProvider, memoryProvider?: MemoryProvider) {
  const dataDir = Bun.env.AGENTIC_DATA_DIR ?? join(homedir(), ".agentic-engine");
  const store = new MemoryStore({ dataDir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(store, scanner);
  const hatch = new Hatch(store, gate);
  const tokenStore = new TokenStore(dataDir);
  // ADR-0016 decision 3 DI seam: the port is constructed once and threaded into
  // buildInjector so the anthropic-api provider (if selected) can declare tools[]
  // and run the bounded memory-action tool loop. memoryActionsActive gates the
  // index.ts-side ordinal-map/prefix wiring below — only the anthropic-api
  // provider consumes the capability today.
  const memoryActionPort = new MemoryActionPort(store, gate, scanner);
  const activeProvider = provider ?? buildInjector(undefined, { memoryActionPort });
  const memoryActionsActive = activeProvider.id === "anthropic-api";
  // memoryProvider? — additive test/harness injection seam (mirrors provider?); production uses buildMemoryProvider().
  const memProvider = memoryProvider ?? buildMemoryProvider();
  const hook = new ConsolidationHook(store);
  const { whenIdle } = registerDistiller(hook, store, memProvider, scanner);
  const lifecycle = new ThreadLifecycle(store, gate, memProvider, whenIdle);

  const memoryDeps = { hatch, store, tokenStore };

  // T2.3a: the websocket handler needs the actual bound port (which may differ from
  // the requested `port` when port=0 is used for ephemeral test ports). Capture via
  // a mutable ref that is set immediately after Bun.serve() returns.
  let boundPort: number = port === 0 ? DAEMON_PORT : port;

  const server = Bun.serve<SocketData>({
    hostname: DAEMON_HOST,
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      // Memory HTTP surface — BEFORE origin gate (ADR-0013 Option B: reads open on loopback).
      // /history.html will 404 via handleMemoryHttp until T2.2a builds it — that's correct.
      if (url.pathname.startsWith("/memory/") || url.pathname === "/history.html") {
        // DNS-rebinding guard: only 127.0.0.1 and localhost with the bound port are
        // allowed as Host headers — this preserves ADR-0013's "local-process read-disclosure
        // only" boundary (Option B intact). Writes stay token-gated; reads protected here.
        const host = req.headers.get("host") ?? "";
        const p = (server.port ?? boundPort).toString();
        if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) {
          return new Response("forbidden host", { status: 403 });
        }
        return handleMemoryHttp(req, url, memoryDeps);
      }
      // ── WS upgrade path: token gate (layer 1) + origin gate (layer 2) ──
      // Token gate (spec §3.2, ADR-0003 p.5 un-deferred): verify the per-install
      // token presented as the Sec-WebSocket-Protocol subprotocol BEFORE upgrade.
      const proto = req.headers.get("sec-websocket-protocol");
      if (!tokenStore.verifyToken(proto)) {
        // Log origin + reason for audit; NEVER log the token value (spec §3.8, DoD #7).
        console.error("[daemon] WS upgrade rejected:", {
          origin: req.headers.get("origin"),
          reason: "bad-or-missing-token",
        });
        return new Response("Unauthorized", { status: 401 });
      }
      // Origin-allowlist gate (layer 2, interim CSWSH mitigation — ADR-0003 Amendment).
      if (!isOriginAllowed(req.headers.get("origin"))) {
        return new Response("Forbidden origin", { status: 403 });
      }
      // Echo the negotiated subprotocol on the 101 (RFC 6455 §4.1; browser drops
      // the connection if the daemon does not echo it back).
      // Bun echoes Sec-WebSocket-Protocol automatically when the client offered it —
      // DO NOT manually repeat it in `headers`; doing so causes a 1002 protocol error
      // (Bun detects the duplicate and closes the connection). Verified by runtime probe.
      if (server.upgrade(req, {
        data: { sessionIds: new Set<string>() },
      })) return undefined; // 101 Switching Protocols
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      async message(ws, raw) {
        let json: unknown;
        try {
          json = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        } catch {
          console.error("[daemon] non-JSON frame ignored");
          return; // never throw / crash
        }
        const parsed = parseEnvelope(json);
        if (parsed.kind !== "ok") {
          console.error("[daemon] inbound not in frozen contract:", parsed.kind);
          return; // graceful: unknown type / invalid body ignored, no crash
        }
        const msg = parsed.message;
        if (!REDUCER_INPUT_TYPES.has(msg.type)) return; // session_ack/tool_call/session_end inbound = no-op

        const inbound = msg as ProviderInput;

        // Resolve the durable thread for THIS turn BEFORE the provider runs.
        // session_start → from inbound.thread_id (or mint). Later turns →
        // via the session_id→thread_id binding recorded after the provider minted it.
        let turnThreadId: string | undefined;
        let priorState: ProviderSessionState | undefined;
        let hydratedCount = 0;
        // v2-08: true iff this turn's priorMessages contains ≥1 cross-thread [remembered]
        // fact (new-thread OR known-thread branch). A known-thread turn with only its own
        // tail (no [remembered] messages) stays false. Reset to false on every message
        // invocation so it cannot leak across turns on a persistent socket.
        let injectedMemory = false;
        if (inbound.type === "session_start") {
          const begin = await lifecycle.beginTurn(inbound);
          turnThreadId = begin.threadId;
          ws.data.activeThreadId = turnThreadId;
          // CM-03: remember this thread so close(ws) can dismiss every active thread
          // on the connection (not just the last one).
          if (turnThreadId) (ws.data.touchedThreadIds ??= new Set<string>()).add(turnThreadId);

          // 2c-02 (ADR-0016 decision 3): index the first-N `[remembered]` messages
          // and build the ordinal→factId map ONLY when the active provider consumes
          // the memory-action-tool capability (memoryActionsActive). Gated on
          // begin.injectedFactIds — the EXACT post-filter `live` slice retrieve()
          // injected this turn (never raw DB rows, never LLM-echoed ids — D3a/D3b).
          let priorMessages = begin.priorMessages;
          let memoryActionSlice: MemoryTurnSlice | undefined;
          if (memoryActionsActive && begin.injectedFactIds.length > 0) {
            const n = begin.injectedFactIds.length;
            priorMessages = priorMessages.map((m, idx) =>
              idx < n ? { ...m, content: withRememberedIndex(m.content, idx + 1) } : m,
            );
            memoryActionSlice = { threadId: turnThreadId, ordinalMap: buildOrdinalMap(begin.injectedFactIds) };
          } else if (memoryActionsActive) {
            // remember-with-no-target still needs a threadId for provenance.
            memoryActionSlice = { threadId: turnThreadId, ordinalMap: new Map() };
          }

          hydratedCount = priorMessages.length;
          // v2-08 seam: injectedMemory fires iff THIS turn injected ≥1 cross-thread
          // [remembered] fact — for BOTH the new-thread branch (retrieve) AND the
          // known-thread branch (which, post-v2-08, prepends facts before the tail).
          // The thread's own hydrated tail is NOT a [remembered] fact, so a known-thread
          // turn with empty memory stays false. withRememberedIndex preserves the
          // REMEMBERED_LABEL prefix, so this check is unaffected by the ordinal indexing.
          injectedMemory = priorMessages.some(
            (m) => m.role === "user" && m.content.startsWith(REMEMBERED_LABEL),
          );
          // Hydrate the thread tail into the messages[] seam (provider.ts:5).
          // phase:"done"/session_id:"" are don't-cares on start — every provider
          // reads only `.messages`; the mock adapter maps a session_start to a
          // fresh reducer call regardless of this phase.
          priorState = priorMessages.length
            ? { phase: "done", session_id: "", messages: priorMessages, ...(memoryActionSlice ? { memoryActionSlice } : {}) }
            : undefined;
        } else {
          priorState = sessions.get(inbound.session_id);
          turnThreadId = lifecycle.threadForSession(inbound.session_id);
        }

        // D-v2-08 inject log (env-gated): the ACTUAL prior context this turn hands
        // the agent — distinguishes "fact retrieved" from "fact present THIS turn".
        // A known-thread turn (turn 2+) shows the conversation tail with NO
        // [remembered] entries → the structural reason a follow-up recall misses.
        memDebug("inject", {
          threadId: turnThreadId,
          turnType: inbound.type,
          userText: previewStr(inbound.type === "session_start" ? (inbound.text ?? "") : ""),
          priorContext: (priorState?.messages ?? []).map((m) => ({
            role: m.role,
            preview: previewStr(m.content),
          })),
        });

        const result = await activeProvider.advance(priorState, inbound);

        if (!result.ok) {
          console.error("[daemon] provider typed error:", result.error);
        } else if (result.finalText) {
          console.log("[daemon] agent final text:", result.finalText);
        }

        const sid = result.nextState.session_id;
        if (sid) {
          // bindSession is called on every advance that returns a sid, but
          // hydratedCount is only meaningful on the session_start advance (the
          // first message of a session). For non-session_start messages, the
          // binding already exists (set during the session_start advance) and
          // we must NOT overwrite the stored hydratedCount with 0.
          if (turnThreadId && inbound.type === "session_start") lifecycle.bindSession(sid, turnThreadId, hydratedCount);
          if (result.nextState.phase === "done") {
            // ── §7.1 behavioral change: flush the turn to the durable thread,
            //    THEN drop RAM (was a bare sessions.delete(sid) at index.ts:70).
            const threadId = lifecycle.threadForSession(sid) ?? turnThreadId;
            if (threadId) lifecycle.endTurn(threadId, sid, result.nextState.messages);
            sessions.delete(sid);
          } else {
            sessions.set(sid, result.nextState);
            ws.data.sessionIds.add(sid);
          }
        }

        for (const out of result.outbound) send(ws, out, boundPort, injectedMemory);
      },
      async close(ws) {
        // ── S1 partial-turn flush (UNCHANGED): persist any in-flight turn's delta
        //    before dropping RAM, so the distiller (below) sees the final turn.
        for (const sid of ws.data.sessionIds) {
          const session = sessions.get(sid);
          const threadId = lifecycle.threadForSession(sid);
          if (session && threadId && session.messages.length > 0) {
            try {
              lifecycle.endTurn(threadId, sid, session.messages);
            } catch (err) {
              console.error("[daemon] partial-turn flush error on disconnect (sid:", sid, "):", err);
            }
          }
          sessions.delete(sid);
          lifecycle.forgetSession(sid);
        }

        // ── CM-03: dismiss = close(ws). After the flush, consolidate EVERY active
        //    (not-yet-dismissed) thread on this connection (spec §3.2; ADR-0014 d.2).
        //    dismiss ⇒ persist + distill (ADR-0012): the thread is NOT deleted.
        //    v2-03 incremental: handler fires once with the batch; the distiller runs N
        //    independent per-thread incremental distills (§3.3 D-V3e).
        //    B1 discipline: the whole batch is non-fatal — log, never crash, never block
        //    cleanup. finally always records all ids so a failed batch never retry-loops.
        const toDismiss = [...(ws.data.touchedThreadIds ?? [])].filter(
          (id) => !ws.data.dismissedThreadIds?.has(id),
        );
        if (toDismiss.length > 0) {
          try {
            await hook.dismiss(toDismiss);
          } catch (err) {
            console.error("[daemon] batch dismiss error on close (non-fatal, threads:", toDismiss, "):", err);
          } finally {
            for (const id of toDismiss) {
              (ws.data.dismissedThreadIds ??= new Set<string>()).add(id);
            }
          }
        }
      },
    },
  });
  // T2.3a: update boundPort to the actual OS-assigned port (matters when port=0).
  // server.port is number | undefined per Bun types; port=0 always resolves to a real port.
  if (server.port !== undefined) boundPort = server.port;
  return server;
}

if (import.meta.main) {
  const server = startDaemon();
  console.log(`[daemon] listening on ws://${server.hostname}:${server.port}`);
}
