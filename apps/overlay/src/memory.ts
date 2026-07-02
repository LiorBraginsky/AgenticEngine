/**
 * Memory window shell (chunk-01, feature memory-transparency-ui).
 * Proves the auth wiring for chunk-02's real UI: reads the per-install token Rust-side
 * (read_auth_token — no manual paste) and renders an HONEST tri-state from a real
 * token-gated GET /memory/threads. NO threads/facts UI here (that is chunk-02).
 * Token discipline (ADR-0013): Bearer header ONLY — never logged, never in a URL/query.
 * No auto-hide/linger timers (gotchas #33/#34) — this is a normal, user-closed window.
 *
 * Demo-1 fix (Step 5): the memory window survives close (hidden, not destroyed — lib.rs
 * Step 4), so a one-shot fetch at load goes stale after a daemon restart while the window
 * stays open (cluster 2A) or stays open across a later daemon start (cluster 2B, window
 * half). `createMemoryLiveness` (memory-liveness.ts) adds a periodic re-check plus a forced
 * re-check on window focus/visibility. This is a read-only STATUS POLL — it never changes
 * window visibility, so it is unrelated to gotchas #33/#34.
 *
 * chunk-02: adds the real read UI (threads list + thread detail) via createMemoryController,
 * sharing the single token read here (no second read_auth_token invoke).
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

  // Top-of-window connection banner (chunk-01 liveness poll — unchanged behavior).
  const liveness = createMemoryLiveness({
    fetchFn: (u, i) => fetch(u, i), url: THREADS_URL, token,
    onState: renderBanner, intervalMs: 3000, isHidden: () => document.hidden,
  });
  liveness.start();
  window.addEventListener("focus", () => liveness.checkNow());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveness.checkNow(); });

  // Read UI (chunk-02): threads list + thread detail.
  const controller = createMemoryController({
    api: { fetchFn: (u, i) => fetch(u, i), baseUrl: BASE_URL, token },
    els: {
      listView: el("thread-list-view"), detailView: el("thread-view"),
      threadListEl: el("thread-list"), messagesEl: el("messages-container"),
      factsEl: el("facts-container"), eventsEl: el("events-container"), backBtn: el("back-btn"),
    },
  });
  controller.start();
}

void main();
