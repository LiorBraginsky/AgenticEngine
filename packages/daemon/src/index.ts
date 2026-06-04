import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { join } from "node:path";
import { homedir } from "node:os";
import { isOriginAllowed } from "./origin.js";
import { buildInjector } from "./providers/injector.js";
import type { ProviderSessionState, ProviderInput } from "./providers/provider.js";
import { MemoryStore } from "./memory/store.js";
import { WriteGate } from "./memory/write-gate.js";
import { ThreadLifecycle } from "./memory/thread-lifecycle.js";

export const DAEMON_HOST = "127.0.0.1"; // loopback only (ADR-0003 p.3)
export const DAEMON_PORT = 7777;

const sessions = new Map<string, ProviderSessionState>();
type SocketData = { sessionIds: Set<string> };

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
  const lifecycle = new ThreadLifecycle(store, new WriteGate(store));

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
        if (inbound.type === "session_start") {
          const begin = lifecycle.beginTurn(inbound);
          turnThreadId = begin.threadId;
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
          if (turnThreadId) lifecycle.bindSession(sid, turnThreadId);
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
      close(ws) {
        // Leak-free cleanup: remove any sessions owned by this connection.
        for (const sid of ws.data.sessionIds) {
          sessions.delete(sid);
          lifecycle.forgetSession(sid);
        }
      },
    },
  });
}

if (import.meta.main) {
  const server = startDaemon();
  console.log(`[daemon] listening on ws://${server.hostname}:${server.port}`);
}
