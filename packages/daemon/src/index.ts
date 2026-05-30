import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { isOriginAllowed } from "./origin.js";
import { advanceMockAgent, type MockSessionState, type MockAgentInput } from "./mock-agent.js";

export const DAEMON_HOST = "127.0.0.1"; // loopback only (ADR-0003 p.3)
export const DAEMON_PORT = 7777;

const sessions = new Map<string, MockSessionState>();
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
      message(ws, raw) {
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

        const inbound = msg as MockAgentInput;
        const sessionId = inbound.type === "session_start" ? undefined : inbound.session_id;
        const prior = sessionId ? sessions.get(sessionId) : undefined;
        const result = advanceMockAgent(prior, inbound);

        if (!result.ok) {
          console.error("[daemon] mock-agent typed error:", result.error); // no crash — session may stay open
        } else if (result.finalText) {
          // Option A (Jimmy's ruling): log the final text; it is NOT sent as a wire message.
          console.log("[daemon] agent final text:", result.finalText);
        }

        const sid = result.nextState.session_id;
        if (sid) {
          if (result.nextState.phase === "done") {
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
        for (const sid of ws.data.sessionIds) sessions.delete(sid);
      },
    },
  });
}

if (import.meta.main) {
  const server = startDaemon();
  console.log(`[daemon] listening on ws://${server.hostname}:${server.port}`);
}
