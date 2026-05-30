import { test, expect, afterAll } from "bun:test";
import { startDaemon } from "./index.js";

const server = startDaemon(0); // ephemeral port — avoids clashing with a running dev daemon
const PORT = server.port;
afterAll(() => server.stop(true));

const TAURI_ORIGIN = "tauri://localhost";

function collect(messages: unknown[], resolve: () => void, expectedCount: number) {
  return (data: string) => {
    messages.push(JSON.parse(data));
    if (messages.length >= expectedCount) resolve();
  };
}

test("ALLOWED origin: full session round-trip (start → ack → end)", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: TAURI_ORIGIN } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  await new Promise<void>((resolve, reject) => {
    const onMsg = collect(messages, resolve, 2);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "hi", client_session_id: "c-1" })),
    );
    ws.addEventListener("message", (e) => onMsg(e.data as string));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 2000);
  });
  ws.close();

  expect(messages[0].type).toBe("session_ack");
  expect(messages[0].client_session_id).toBe("c-1");
  expect(typeof messages[0].session_id).toBe("string");
  expect(messages[1].type).toBe("session_end");
  expect(messages[1].reason).toBe("completed");
  expect(messages[1].session_id).toBe(messages[0].session_id);
});

test("REJECTED origin: arbitrary cross-site origin cannot connect", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: "https://evil.example.com" } });
  const rejected = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(false)); // should NOT open
    ws.addEventListener("error", () => resolve(true));
    ws.addEventListener("close", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });
  expect(rejected).toBe(true);
});

test("REJECTED origin: missing origin cannot connect", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); // no Origin header
  const rejected = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(false));
    ws.addEventListener("error", () => resolve(true));
    ws.addEventListener("close", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });
  expect(rejected).toBe(true);
});
