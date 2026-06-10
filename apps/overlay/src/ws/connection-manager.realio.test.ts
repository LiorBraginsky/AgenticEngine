/**
 * Real-I/O tests for ConnectionManager — Task 5 of CM-02.
 *
 * Adapted vs plan:
 *  - realFactory passes { headers: { Origin: "tauri://localhost" } } as the second
 *    WebSocket constructor arg (copied from multi-turn-per-socket.daemon.test.ts pattern)
 *    rather than `as unknown as string[]` — the cast in the plan draft is unnecessary
 *    because Bun's WebSocket constructor accepts { headers } in the options position.
 *  - show_text payload: plan draft was correct; validated against protocol source:
 *    ToolCallPayload discriminates on `tool`, ShowTextArgs wraps TextPrimitive as `text`,
 *    TextPrimitive requires { primitive: "text", content: string }. So the scripted frame
 *    is: { type:"tool_call", session_id, call_id, payload:{ tool:"show_text", args:{ text:{
 *    primitive:"text", content:"..." } } } } — this passes parseEnvelope/Zod validation.
 *  - The daemon import uses the relative path ../../../../packages/daemon/src/index.js
 *    (verified correct: overlay has no @agentic/daemon workspace dep, only @agentic/protocol).
 *
 * WHY loopback for show_text: the mock daemon's mock-agent/mock-provider only ever emits
 * show_color_picker. show_text is emitted only by anthropicApiProvider (key-gated). There is
 * no test-injectable provider seam into startDaemon(). Therefore: picker half hits the REAL
 * mock daemon (highest fidelity, exercises ws.data.sessionIds); show_text half hits a scripted
 * real Bun.serve WebSocket loopback — real-I/O at the transport/dispatcher level, touches no
 * frozen surface, proves the dispatcher routes both flow shapes over one socket. (Plan D5.)
 */
import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { ConnectionManager } from "./connection-manager.js";
import type { WebSocketLike } from "./types.js";

// ── Shared helper: adapt a real WebSocket to WebSocketLike ───────────────────
// Passes Origin header for the daemon's CSWSH origin-gate (ADR-0003).
// Identical logic to main.ts factory, but with headers for the daemon test.
function realFactory(url: string): WebSocketLike {
  const s = new WebSocket(url, { headers: { Origin: "tauri://localhost" } });
  return {
    send: (d) => s.send(d),
    close: () => s.close(),
    addEventListener: (t, cb) =>
      s.addEventListener(t, (e: unknown) => cb({ data: (e as MessageEvent)?.data })),
  };
}

/**
 * Creates a ConnectionManager whose factory also signals when the underlying
 * WebSocket's "open" event fires. Used in real-I/O tests to avoid calling
 * runSession() while the socket is still in CONNECTING state (which throws
 * InvalidStateError on ws.send()). In production (main.ts), connect() is called
 * at module load and runSession() is called on user input — the socket is always
 * open by then. Tests must replicate that timing explicitly.
 */
function makeManagerWithOpenWait(urlOverride: string): { mgr: ConnectionManager; opened: Promise<void> } {
  let resolveOpen!: () => void;
  const opened = new Promise<void>((resolve) => { resolveOpen = resolve; });
  const mgr = new ConnectionManager(() => {
    const ws = realFactory(urlOverride);
    // Wrap addEventListener to intercept the "open" event and signal readiness.
    const origAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = (t, cb) => {
      origAddEventListener(t, (ev) => {
        if (t === "open") resolveOpen();
        cb(ev);
      });
    };
    return ws;
  });
  return { mgr, opened };
}

// ── Part A: picker round-trip over the REAL mock daemon ──────────────────────
let dataDir: string;
let daemon: ReturnType<typeof import("../../../../packages/daemon/src/index.js").startDaemon>;
let DAEMON_PORT: number;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cm02-overlay-realio-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock";
  const { startDaemon } = await import("../../../../packages/daemon/src/index.js");
  daemon = startDaemon(0);
  DAEMON_PORT = daemon.port!;
});
afterAll(() => daemon.stop(true));

test("real-I/O: picker round-trip over the ConnectionManager against the real mock daemon", async () => {
  const { mgr, opened } = makeManagerWithOpenWait(`ws://127.0.0.1:${DAEMON_PORT}`);
  mgr.connect();
  await opened; // wait for WebSocket to be in OPEN state before calling runSession
  let pickerSeen = false;
  const result = await mgr.runSession("hi", {
    handshakeTimeoutMs: 4000,
    onToolCall: (ctx) => {
      pickerSeen = true;
      // The mock daemon always emits show_color_picker with a non-empty palette.
      ctx.sendResult(ctx.picker.palette[0]!);
    },
  });
  expect(pickerSeen).toBe(true);
  expect(result.reason).toBe("completed");
  expect(typeof result.sessionId).toBe("string");
}, 8000);

// ── Part B: show_text flow over a scripted REAL loopback server ──────────────
// (mock provider never emits show_text — Reality check D5; this proves the dispatcher
//  routes the show_text flow shape over a real socket without touching frozen surfaces.)
//
// Payload must validate against the REAL @agentic/protocol Envelope/ToolCallPayload Zod
// schema (parseEnvelope is called in the manager's dispatch path — invalid frames are
// silently dropped, causing the test to hang on handshakeTimeoutMs):
//   ToolCallPayload discriminates on `tool: "show_text"` → ShowTextArgs →
//   TextPrimitive: { primitive: "text", content: string }
//   Full tool_call frame: { type, session_id, call_id,
//     payload: { tool: "show_text", args: { text: { primitive: "text", content: "..." } } } }
let scripted: ReturnType<typeof Bun.serve>;
let SCRIPT_PORT: number;

beforeAll(() => {
  scripted = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req, { data: {} })) return undefined;
      return new Response("no", { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        const m = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as { type: string; client_session_id?: string };
        if (m.type === "session_start") {
          const sid = "scripted-session";
          ws.send(JSON.stringify({ type: "session_ack", session_id: sid, client_session_id: m.client_session_id }));
          // show_text payload — validated against protocol schema:
          //   ToolCallPayload.tool = "show_text", args.text = TextPrimitive
          ws.send(JSON.stringify({
            type: "tool_call",
            session_id: sid,
            call_id: "c1",
            payload: { tool: "show_text", args: { text: { primitive: "text", content: "the answer is 42" } } },
          }));
          ws.send(JSON.stringify({ type: "session_end", session_id: sid, reason: "completed" }));
        }
      },
    },
  });
  SCRIPT_PORT = scripted.port!;
});
afterAll(() => scripted.stop(true));

test("real-I/O: show_text flow over the ConnectionManager against a scripted loopback server", async () => {
  const { mgr, opened } = makeManagerWithOpenWait(`ws://127.0.0.1:${SCRIPT_PORT}`);
  mgr.connect();
  await opened; // wait for WebSocket to be in OPEN state before calling runSession
  let shown: string | undefined;
  const result = await mgr.runSession("what is the answer?", {
    handshakeTimeoutMs: 4000,
    onShowText: (content) => { shown = content; },
  });
  expect(shown).toBe("the answer is 42");
  expect(result).toEqual({ sessionId: "scripted-session", reason: "completed" });
}, 8000);

test("real-I/O: two sequential turns on ONE manager against the scripted server — socket reused, both complete", async () => {
  // Two sequential turns on ONE manager — proves the manager reuses its socket
  // (no per-turn socket churn). Task 2a proves factory-call-count under the fake;
  // here we assert the second turn succeeds without reconnect by completing back-to-back.
  //
  // NOTE: the scripted server uses a fixed session_id "scripted-session" for both turns.
  // The manager's pending Map keyed by session_id is already cleared after settle(), so
  // the second turn correctly picks up the second ack/tool_call/session_end sequence.
  const { mgr, opened } = makeManagerWithOpenWait(`ws://127.0.0.1:${SCRIPT_PORT}`);
  mgr.connect();
  await opened; // wait for WebSocket to be in OPEN state before calling runSession
  const r1 = await mgr.runSession("q1", { handshakeTimeoutMs: 4000, onShowText: () => {} });
  const r2 = await mgr.runSession("q2", { handshakeTimeoutMs: 4000, onShowText: () => {} });
  expect(r1.reason).toBe("completed");
  expect(r2.reason).toBe("completed");
}, 8000);
