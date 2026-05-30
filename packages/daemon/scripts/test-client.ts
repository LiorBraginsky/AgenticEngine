// Throwaway manual client — foundation for 02a's CLI harness. Run: bun run test-client
import { parseEnvelope } from "@agentic/protocol";
import { DAEMON_PORT } from "../src/index.js";

const ws = new WebSocket(`ws://127.0.0.1:${DAEMON_PORT}`, { headers: { Origin: "tauri://localhost" } });

ws.addEventListener("open", () => {
  console.log("[client] connected; sending session_start");
  ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "demo", client_session_id: "manual-1" }));
});
ws.addEventListener("message", (e) => {
  const parsed = parseEnvelope(JSON.parse(e.data as string));
  console.log("[client] received (validated):", parsed.kind, parsed);
});
ws.addEventListener("close", () => console.log("[client] closed"));
