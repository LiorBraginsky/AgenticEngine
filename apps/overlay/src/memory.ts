/**
 * Memory window shell (chunk-01, feature memory-transparency-ui).
 * Proves the auth wiring for chunk-02's real UI: reads the per-install token Rust-side
 * (read_auth_token — no manual paste) and renders an HONEST tri-state from a real
 * token-gated GET /memory/threads. NO threads/facts UI here (that is chunk-02).
 * Token discipline (ADR-0013): Bearer header ONLY — never logged, never in a URL/query.
 * No auto-hide/linger timers (gotchas #33/#34) — this is a normal, user-closed window.
 */
import { invoke } from "@tauri-apps/api/core";

const MEMORY_URL = "http://127.0.0.1:7777/memory/threads";

type ShellState = "no-token" | "unreachable" | "unauthorized" | "connected";

function render(state: ShellState, detail?: string): void {
  const el = document.getElementById("conn-state");
  if (el === null) return;
  el.dataset.state = state;
  el.textContent =
    state === "no-token"     ? "🔒 No auth token found — is the engine installed?" :
    state === "unreachable"  ? "Daemon unreachable — is the engine running?" :
    state === "unauthorized" ? "🔒 Token rejected — the engine did not accept this token." :
    /* connected */            `Connected${detail ? ` (${detail})` : ""}`;
}

async function main(): Promise<void> {
  let token: string;
  try {
    token = (await invoke<string>("read_auth_token")).trim();
  } catch {
    render("no-token");
    return;
  }
  if (!token) { render("no-token"); return; }

  // Defensive abort: a stalled TCP (accepts but never answers) flips to "unreachable"
  // rather than hanging on "Checking…". This is a fetch timeout, NOT a window timer.
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), 4000);

  try {
    const res = await fetch(MEMORY_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) { render("unauthorized"); return; }
    if (!res.ok) { render("unreachable", `HTTP ${res.status}`); return; }
    const body = (await res.json()) as { threads?: unknown[] };
    const n = Array.isArray(body.threads) ? body.threads.length : 0;
    render("connected", `${n} thread${n === 1 ? "" : "s"}`);
  } catch {
    // Network error / connection refused / abort → daemon down. Honest state, NOT "Loading…".
    render("unreachable");
  } finally {
    clearTimeout(abortTimer);
  }
}

void main();
