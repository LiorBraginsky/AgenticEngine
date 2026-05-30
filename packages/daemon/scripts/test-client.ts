// Manual test client — full resolve-path driver for 02a. Run: bun run test-client
// Assertions live in mock-agent.daemon.test.ts; this file is for manual inspection.
import { parseEnvelope } from "@agentic/protocol";
import { DAEMON_PORT } from "../src/index.js";

const ws = new WebSocket(`ws://127.0.0.1:${DAEMON_PORT}`, { headers: { Origin: "tauri://localhost" } });

ws.addEventListener("open", () => {
  console.log("[client] connected; sending session_start");
  ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "demo", client_session_id: "manual-1" }));
});

ws.addEventListener("message", (e) => {
  const parsed = parseEnvelope(JSON.parse(e.data as string));
  if (parsed.kind !== "ok") {
    console.log("[client] received (invalid/unknown):", parsed.kind, parsed);
    return;
  }
  const msg = parsed.message;
  console.log("[client] received:", msg.type, msg);

  // On tool_call for show_color_picker, auto-pick the first swatch and reply.
  if (msg.type === "tool_call" && msg.payload.tool === "show_color_picker") {
    const palette = msg.payload.args.picker.palette;
    const pick = palette[0]!;
    console.log(`[client] tool_call show_color_picker; auto-picking "${pick.label}"`);
    ws.send(JSON.stringify({
      type: "tool_result",
      session_id: msg.session_id,
      call_id: msg.call_id,
      payload: { tool: "show_color_picker", result: { picked: pick } },
    }));
  }

  if (msg.type === "session_end") {
    console.log(`[client] session_end reason=${msg.reason}`);
    ws.close();
  }
});

ws.addEventListener("close", () => console.log("[client] closed"));
ws.addEventListener("error", (e) => console.error("[client] error", e));
