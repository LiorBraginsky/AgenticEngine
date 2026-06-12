import { test, expect, afterAll, beforeAll, describe } from "bun:test";
import { startDaemon } from "./index.js";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { TokenStore } from "./memory/token-store.js";

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

test("ALLOWED origin: full session round-trip (start → ack → tool_call)", async () => {
  // chunk-02a supersede: session_start now opens a session (ack + tool_call),
  // it no longer ends immediately. The old chunk-01 placeholder (ack + session_end)
  // is intentionally replaced — this is not a regression.
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
  expect(messages[1].type).toBe("tool_call");
  expect(messages[1].payload.tool).toBe("show_color_picker");
  expect(messages[1].session_id).toBe(messages[0].session_id);
  // chunk-02a supersede: session_start now opens a session (ack + tool_call), it no longer ends immediately
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

// ─── Step-1: WS token-gate tests (per-install token via Sec-WebSocket-Protocol) ─

describe("WS token gate (step 1)", () => {
  let gateServer: ReturnType<typeof startDaemon>;
  let GATE_PORT: number;
  let gateDataDir: string;
  let token: string;

  beforeAll(() => {
    gateDataDir = mkdtempSync(join(tmpdir(), "daemon-gate-"));
    process.env.AGENTIC_DATA_DIR = gateDataDir;
    process.env.LLM_PROVIDER = "mock";
    gateServer = startDaemon(0);
    GATE_PORT = gateServer.port!;
    token = new TokenStore(gateDataDir).token();
  });

  afterAll(() => gateServer.stop(true));

  test("step1-gate-1: no token → rejected before upgrade (no open event)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${GATE_PORT}`, {
      headers: { Origin: TAURI_ORIGIN },
      // no protocols — no token
    });
    const rejected = await new Promise<boolean>((resolve) => {
      ws.addEventListener("open", () => resolve(false)); // must NOT open
      ws.addEventListener("error", () => resolve(true));
      ws.addEventListener("close", () => resolve(true));
      setTimeout(() => resolve(false), 1500);
    });
    expect(rejected).toBe(true);
  });

  test("step1-gate-2: wrong token (same length) → rejected before upgrade", async () => {
    const wrongToken = "a".repeat(64); // same 64-char length, wrong value
    const ws = new WebSocket(`ws://127.0.0.1:${GATE_PORT}`, {
      headers: { Origin: TAURI_ORIGIN },
      protocols: [wrongToken],
    });
    const rejected = await new Promise<boolean>((resolve) => {
      ws.addEventListener("open", () => resolve(false));
      ws.addEventListener("error", () => resolve(true));
      ws.addEventListener("close", () => resolve(true));
      setTimeout(() => resolve(false), 1500);
    });
    expect(rejected).toBe(true);
  });

  test("step1-gate-3: valid token → accepted + subprotocol echoed on 101 (ws.protocol === token)", async () => {
    // DoD #3 (subprotocol echo) is verified in the `open` handler, BEFORE any
    // messages arrive, via a separate promise. Bun 1.3.4 has a buffer-aliasing
    // quirk where ws.protocol appears to change after the first message frame
    // is received (the getter reads from the same ring buffer used for messages).
    // Verifying in `open` (before sending anything) is both correct per RFC 6455
    // and immune to this quirk.

    // Phase A: open the socket and verify ws.protocol before any messages
    const protocolResult = await new Promise<{ matched: boolean; gatedWs: WebSocket }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${GATE_PORT}`, {
        headers: { Origin: TAURI_ORIGIN },
        protocols: [token],
      });
      ws.addEventListener("open", () => {
        const matched = ws.protocol === token;
        resolve({ matched, gatedWs: ws });
      });
      ws.addEventListener("error", () => reject(new Error("ws error opening gate")));
      setTimeout(() => reject(new Error("timeout opening gate")), 1500);
    });

    // DoD #3: subprotocol echoed in the 101
    expect(protocolResult.matched).toBe(true);

    // Phase B: drive a full session round-trip to prove the gated socket still works
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = protocolResult.gatedWs;
      ws.addEventListener("message", (e) => {
        messages.push(JSON.parse(e.data as string));
        if (messages.length >= 2) { ws.close(); resolve(); }
      });
      ws.addEventListener("error", () => reject(new Error("ws error on round-trip")));
      ws.send(JSON.stringify({
        type: "session_start",
        trigger: "user",
        text: "token gate test",
        client_session_id: "c-gate",
      }));
      setTimeout(() => reject(new Error("timeout — round-trip")), 3000);
    });

    // End-to-end session still works through the gated socket
    expect(messages[0].type).toBe("session_ack");
    expect(messages[0].client_session_id).toBe("c-gate");
    expect(messages[1].type).toBe("tool_call");
    expect(messages[1].payload?.tool).toBe("show_color_picker");
  });
});
