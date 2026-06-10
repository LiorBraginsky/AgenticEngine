import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { join } from "node:path";
import { homedir } from "node:os";
import { isOriginAllowed } from "./origin.js";
import { buildInjector } from "./providers/injector.js";
import type { ProviderSessionState, ProviderInput } from "./providers/provider.js";
import { MemoryStore } from "./memory/store.js";
import { WriteGate } from "./memory/write-gate.js";
import { RuleBasedScanner } from "./memory/scanner/memory-scanner.js";
import { ThreadLifecycle } from "./memory/thread-lifecycle.js";
import { ConsolidationHook } from "./memory/consolidation-hook.js";
import { buildMemoryProvider } from "./memory/memory-provider-selector.js";
import { registerDistiller } from "./memory/distiller-registration.js";

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

function send(ws: { send(data: string): number }, msg: Envelope): void {
  // Outbound is validated against the frozen contract too (defence in depth).
  const check = parseEnvelope(msg);
  if (check.kind !== "ok") {
    console.error("[daemon] refusing to send invalid outbound message", check);
    return;
  }
  ws.send(JSON.stringify(msg));
}

const REDUCER_INPUT_TYPES = new Set(["session_start", "tool_result", "tool_cancel"]);

export function startDaemon(port: number = DAEMON_PORT) {
  const provider = buildInjector();
  const dataDir = Bun.env.AGENTIC_DATA_DIR ?? join(homedir(), ".agentic-engine");
  const store = new MemoryStore({ dataDir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(store, scanner);
  const memoryProvider = buildMemoryProvider();
  const hook = new ConsolidationHook(store);
  registerDistiller(hook, store, memoryProvider, scanner);
  const lifecycle = new ThreadLifecycle(store, gate, memoryProvider);

  return Bun.serve<SocketData>({
    hostname: DAEMON_HOST,
    port,
    fetch(req, server) {
      // Origin-allowlist gate BEFORE upgrade (interim CSWSH mitigation).
      if (!isOriginAllowed(req.headers.get("origin"))) {
        return new Response("Forbidden origin", { status: 403 });
      }
      if (server.upgrade(req, { data: { sessionIds: new Set<string>() } })) return undefined; // 101 Switching Protocols
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
        if (inbound.type === "session_start") {
          const begin = await lifecycle.beginTurn(inbound);
          turnThreadId = begin.threadId;
          ws.data.activeThreadId = turnThreadId;
          // CM-03: remember this thread so close(ws) can dismiss every active thread
          // on the connection (not just the last one).
          if (turnThreadId) (ws.data.touchedThreadIds ??= new Set<string>()).add(turnThreadId);
          hydratedCount = begin.priorMessages.length;
          // Hydrate the thread tail into the messages[] seam (provider.ts:5).
          // phase:"done"/session_id:"" are don't-cares on start — every provider
          // reads only `.messages`; the mock adapter maps a session_start to a
          // fresh reducer call regardless of this phase.
          priorState = begin.priorMessages.length
            ? { phase: "done", session_id: "", messages: begin.priorMessages }
            : undefined;
        } else {
          priorState = sessions.get(inbound.session_id);
          turnThreadId = lifecycle.threadForSession(inbound.session_id);
        }

        const result = await provider.advance(priorState, inbound);

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

        for (const out of result.outbound) send(ws, out);
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
        //    B1 discipline: each dismiss is non-fatal — log, never crash, never block
        //    cleanup. finally always records the id so a partial/failed dismiss never
        //    retry-loops (same discipline the retired provisional block used).
        for (const threadId of ws.data.touchedThreadIds ?? []) {
          if (ws.data.dismissedThreadIds?.has(threadId)) continue;
          try {
            await hook.dismiss(threadId);
          } catch (err) {
            console.error("[daemon] dismiss error on close (non-fatal, thread:", threadId, "):", err);
          } finally {
            (ws.data.dismissedThreadIds ??= new Set<string>()).add(threadId);
          }
        }
      },
    },
  });
}

if (import.meta.main) {
  const server = startDaemon();
  console.log(`[daemon] listening on ws://${server.hostname}:${server.port}`);
}
