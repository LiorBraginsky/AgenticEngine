/**
 * memory-liveness — chunk-01 (memory-transparency-ui), Demo-1 fix Step 5.
 * Pure logic (no tauri/DOM imports) so it unit-tests under `bun test` without a webview.
 * Covers: runMemoryCheck's honest tri-state mapping + token discipline (ADR-0013 — Bearer
 * header ONLY, never in the URL), and createMemoryLiveness's connected<->unreachable flip
 * across injected ticks (Demo-1 clusters 2A + 2B window-half).
 */
import { test, expect } from "bun:test";
import { runMemoryCheck, createMemoryLiveness, type ShellState } from "./memory-liveness.js";

const URL = "http://127.0.0.1:7777/memory/threads";

// ---------------------------------------------------------------------------
// runMemoryCheck — honest tri-state mapping, never throws
// ---------------------------------------------------------------------------

test("runMemoryCheck: 200 -> connected with thread count", async () => {
  const fetchFn = async () => new Response(JSON.stringify({ threads: [1, 2, 3] }), { status: 200 });
  const result = await runMemoryCheck(fetchFn, URL, "tok");
  expect(result).toEqual({ state: "connected", detail: "3 threads" });
});

test("runMemoryCheck: 401 -> unauthorized", async () => {
  const fetchFn = async () => new Response(null, { status: 401 });
  const result = await runMemoryCheck(fetchFn, URL, "tok");
  expect(result).toEqual({ state: "unauthorized" });
});

test("runMemoryCheck: 500 -> unreachable with HTTP status detail", async () => {
  const fetchFn = async () => new Response(null, { status: 500 });
  const result = await runMemoryCheck(fetchFn, URL, "tok");
  expect(result).toEqual({ state: "unreachable", detail: "HTTP 500" });
});

test("runMemoryCheck: network error -> unreachable (never throws)", async () => {
  const fetchFn = async (): Promise<Response> => { throw new TypeError("Failed to fetch"); };
  const result = await runMemoryCheck(fetchFn, URL, "tok");
  expect(result).toEqual({ state: "unreachable" });
});

test("runMemoryCheck: token rides Authorization: Bearer header and is NEVER in the URL (ADR-0013)", async () => {
  const captured: { url: string; auth: string | null } = { url: "", auth: null };
  const fetchFn = async (url: string, init: RequestInit) => {
    captured.url = url;
    captured.auth = (init.headers as Record<string, string>)["Authorization"] ?? null;
    return new Response(JSON.stringify({ threads: [] }), { status: 200 });
  };
  const secretToken = "super-secret-token-xyz";
  await runMemoryCheck(fetchFn, URL, secretToken);
  expect(captured.auth).toBe(`Bearer ${secretToken}`);
  expect(captured.url).toBe(URL);
  expect(captured.url).not.toContain(secretToken);
});

// ---------------------------------------------------------------------------
// createMemoryLiveness — periodic re-check, injectable timers, mode-switched fake fetch
// ---------------------------------------------------------------------------

/** Flush pending microtasks so an un-awaited `void check()` inside start()/tick() settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("createMemoryLiveness: start() does an immediate check and reports the initial state", async () => {
  const states: ShellState[] = [];
  const fetchFn = async () => new Response(JSON.stringify({ threads: [] }), { status: 200 });
  const liveness = createMemoryLiveness({
    fetchFn,
    url: URL,
    token: "tok",
    onState: (state) => states.push(state),
    setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
  });
  liveness.start();
  await flush();
  expect(states).toEqual(["connected"]);
  liveness.stop();
});

test("createMemoryLiveness: flips connected -> unreachable -> connected across injected ticks (Demo-1 2A+2B)", async () => {
  const states: ShellState[] = [];
  let mode: "up" | "down" = "up";
  const fetchFn = async (): Promise<Response> => {
    if (mode === "down") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ threads: [] }), { status: 200 });
  };
  let tick: (() => void) | undefined;
  const liveness = createMemoryLiveness({
    fetchFn,
    url: URL,
    token: "tok",
    onState: (state) => states.push(state),
    setIntervalFn: (cb) => { tick = cb; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearIntervalFn: () => {},
  });

  liveness.start();
  await flush();
  expect(states).toEqual(["connected"]);

  mode = "down";
  tick?.();
  await flush();
  expect(states).toEqual(["connected", "unreachable"]);

  mode = "up";
  tick?.();
  await flush();
  expect(states).toEqual(["connected", "unreachable", "connected"]);

  liveness.stop();
});

test("createMemoryLiveness: skips the periodic tick while isHidden() is true", async () => {
  const states: ShellState[] = [];
  let hidden = true;
  const fetchFn = async () => new Response(JSON.stringify({ threads: [] }), { status: 200 });
  let tick: (() => void) | undefined;
  const liveness = createMemoryLiveness({
    fetchFn,
    url: URL,
    token: "tok",
    onState: (state) => states.push(state),
    isHidden: () => hidden,
    setIntervalFn: (cb) => { tick = cb; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearIntervalFn: () => {},
  });
  liveness.start();
  await flush();
  expect(states).toEqual(["connected"]); // start() always does an immediate check regardless of isHidden

  tick?.();
  await flush();
  expect(states).toEqual(["connected"]); // hidden -> periodic tick skipped, no new state

  hidden = false;
  tick?.();
  await flush();
  expect(states).toEqual(["connected", "connected"]); // visible again -> periodic tick runs

  liveness.stop();
});

test("createMemoryLiveness: checkNow() forces an immediate check regardless of isHidden()", async () => {
  const states: ShellState[] = [];
  const fetchFn = async () => new Response(JSON.stringify({ threads: [] }), { status: 200 });
  const liveness = createMemoryLiveness({
    fetchFn,
    url: URL,
    token: "tok",
    onState: (state) => states.push(state),
    isHidden: () => true,
    setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
  });
  liveness.start();
  await flush();
  expect(states).toEqual(["connected"]);

  liveness.checkNow();
  await flush();
  expect(states).toEqual(["connected", "connected"]);

  liveness.stop();
});

test("createMemoryLiveness: stop() clears the interval (via injected clearIntervalFn)", () => {
  let cleared: unknown;
  const fetchFn = async () => new Response(JSON.stringify({ threads: [] }), { status: 200 });
  const liveness = createMemoryLiveness({
    fetchFn,
    url: URL,
    token: "tok",
    onState: () => {},
    setIntervalFn: () => 42 as unknown as ReturnType<typeof setInterval>,
    clearIntervalFn: (h) => { cleared = h; },
  });
  liveness.start();
  liveness.stop();
  expect(cleared).toBe(42);
});
