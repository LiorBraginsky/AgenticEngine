/**
 * Memory window entry point (feature memory-transparency-ui).
 * Reads the per-install token Rust-side once (read_auth_token — no manual paste),
 * keeps the chunk-01 liveness connection banner driven by a real token-gated
 * GET /memory/threads, and starts the chunk-02 read UI (threads list + thread
 * detail) via createMemoryController — sharing the single token read here (no
 * second read_auth_token invoke).
 * Token discipline (ADR-0013): Bearer header ONLY — never logged, never in a URL/query.
 * No auto-hide/linger timers (gotchas #33/#34) — this is a normal, user-closed window.
 *
 * Demo-1 fix (Step 5): the memory window survives close (hidden, not destroyed — lib.rs
 * Step 4), so a one-shot fetch at load goes stale after a daemon restart while the window
 * stays open (cluster 2A) or stays open across a later daemon start (cluster 2B, window
 * half). `createMemoryLiveness` (memory-liveness.ts) adds a periodic re-check plus a forced
 * re-check on window focus/visibility. This is a read-only STATUS POLL — it never changes
 * window visibility, so it is unrelated to gotchas #33/#34.
 */
import { invoke } from "@tauri-apps/api/core";
import { createMemoryLiveness, type ShellState } from "./memory-liveness.js";
import { createMemoryController } from "./memory/controller.js";

const BASE_URL = "http://127.0.0.1:7777";
const THREADS_URL = `${BASE_URL}/memory/threads`;

function renderBanner(state: ShellState, detail?: string): void {
  const el = document.getElementById("conn-state");
  if (el === null) return;
  el.dataset.state = state;
  el.textContent =
    state === "no-token"     ? "🔒 No auth token found — is the engine installed?" :
    state === "unreachable"  ? "Daemon unreachable — is the engine running?" :
    state === "unauthorized" ? "🔒 Token rejected — the engine did not accept this token." :
    /* connected */            `Connected${detail ? ` (${detail})` : ""}`;
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id}`);
  return node;
}

async function main(): Promise<void> {
  let token: string;
  try { token = (await invoke<string>("read_auth_token")).trim(); }
  catch { renderBanner("no-token"); return; }
  if (!token) { renderBanner("no-token"); return; }

  // Read UI (chunk-02): threads list + thread detail. Constructed BEFORE the liveness poll so
  // the banner's per-poll onState result can be forwarded into the controller (Demo-1 fix item 4).
  const controller = createMemoryController({
    api: { fetchFn: (u, i) => fetch(u, i), baseUrl: BASE_URL, token },
    els: {
      listView: el("thread-list-view"), detailView: el("thread-view"),
      threadListEl: el("thread-list"), messagesEl: el("messages-container"),
      factsEl: el("facts-container"), eventsEl: el("events-container"),
      actionsEl: el("actions-container"), forgetControlEl: el("thread-forget-container"),
      backBtn: el("back-btn"),
    },
  });
  controller.start();

  // Top-of-window connection banner (chunk-01 liveness poll — renderBanner behavior unchanged).
  // Demo-1 fix (item 4): the SAME per-poll result that drives the banner is forwarded to the
  // controller so the content sections can never contradict the banner and recover on reconnect
  // without a restart. memory-liveness.ts is untouched — the controller de-dupes.
  const liveness = createMemoryLiveness({
    fetchFn: (u, i) => fetch(u, i), url: THREADS_URL, token,
    onState: (state, detail) => { renderBanner(state, detail); controller.onLivenessState(state); },
    intervalMs: 3000, isHidden: () => document.hidden,
  });
  liveness.start();
  window.addEventListener("focus", () => liveness.checkNow());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveness.checkNow(); });
}

void main();
