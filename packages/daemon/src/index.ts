import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { isOriginAllowed } from "./origin.js";
import { handleSessionStart } from "./session.js";

export const DAEMON_HOST = "127.0.0.1"; // loopback only (ADR-0003 p.3)
export const DAEMON_PORT = 7777;

function send(ws: { send(data: string): number }, msg: Envelope): void {
  // Outbound is validated against the frozen contract too (defence in depth).
  const check = parseEnvelope(msg);
  if (check.kind !== "ok") {
    console.error("[daemon] refusing to send invalid outbound message", check);
    return;
  }
  ws.send(JSON.stringify(msg));
}

export function startDaemon(port: number = DAEMON_PORT) {
  return Bun.serve({
    hostname: DAEMON_HOST,
    port,
    fetch(req, server) {
      // Origin-allowlist gate BEFORE upgrade (interim CSWSH mitigation).
      if (!isOriginAllowed(req.headers.get("origin"))) {
        return new Response("Forbidden origin", { status: 403 });
      }
      if (server.upgrade(req)) return undefined; // 101 Switching Protocols
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
        if (parsed.message.type === "session_start") {
          for (const reply of handleSessionStart(parsed.message)) send(ws, reply);
        }
        // Other known types are no-ops in the v0 skeleton.
      },
    },
  });
}

if (import.meta.main) {
  const server = startDaemon();
  console.log(`[daemon] listening on ws://${server.hostname}:${server.port}`);
}
