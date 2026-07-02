/**
 * memory-liveness — chunk-01 (memory-transparency-ui), Demo-1 fix Step 5.
 * PURE logic — NO tauri/DOM imports — so it unit-tests under `bun test` without a webview.
 * Fixes Demo-1 clusters 2A (open+Connected -> daemon killed -> stale "Connected") and the
 * window-half of 2B (open+unreachable -> daemon started -> stale "unreachable"): memory.ts
 * was a one-shot fetch at load with no re-check. `createMemoryLiveness` adds a periodic +
 * forced re-check; `memory.ts` wires focus/visibilitychange to `checkNow()`.
 * This is a read-only STATUS POLL, not an auto-hide/linger timer (unrelated to gotchas
 * #33/#34 — those forbid changing window VISIBILITY; this never does).
 * Token discipline (ADR-0013): Bearer header ONLY — never logged, never in a URL/query.
 */

export type ShellState = "no-token" | "unreachable" | "unauthorized" | "connected";

export interface MemoryCheckResult {
  state: ShellState;
  detail?: string;
}

/** Minimal fetch shape — matches `(url, init) => fetch(url, init)` at the call site. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * One honest liveness check. NEVER throws — every path (2xx/4xx/5xx/network-error/abort)
 * resolves to a terminal MemoryCheckResult. Uses an AbortController timeout so a stalled
 * TCP (accepts but never answers) still resolves instead of hanging.
 */
export async function runMemoryCheck(
  fetchFn: FetchLike,
  url: string,
  token: string,
  timeoutMs = 2500,
): Promise<MemoryCheckResult> {
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) return { state: "unauthorized" };
    if (!res.ok) return { state: "unreachable", detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { threads?: unknown[] };
    const n = Array.isArray(body.threads) ? body.threads.length : 0;
    return { state: "connected", detail: `${n} thread${n === 1 ? "" : "s"}` };
  } catch {
    // Network error / connection refused / abort -> daemon down. Honest state, never throws.
    return { state: "unreachable" };
  } finally {
    clearTimeout(abortTimer);
  }
}

export interface MemoryLivenessDeps {
  fetchFn: FetchLike;
  url: string;
  token: string;
  /** Fired with every terminal result — matches memory.ts's `render(state, detail?)` signature. */
  onState: (state: ShellState, detail?: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (h: ReturnType<typeof setInterval>) => void;
  /** Gate to skip the periodic tick while the window is hidden (e.g. `() => document.hidden`). */
  isHidden?: () => boolean;
}

export interface MemoryLiveness {
  /** Immediate check + starts the periodic interval. */
  start: () => void;
  /** Forces one immediate check now, bypassing the isHidden() gate (e.g. on focus/re-open). */
  checkNow: () => void;
  /** Clears the interval. No-op if never started. */
  stop: () => void;
}

/** Default poll interval — bounded well under "within a few seconds" (Demo-1 liveness contract). */
const DEFAULT_INTERVAL_MS = 3000;

export function createMemoryLiveness(deps: MemoryLivenessDeps): MemoryLiveness {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const setIntervalFn = deps.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h));

  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function check(): Promise<void> {
    if (inFlight) return; // guard: checks never stack
    inFlight = true;
    try {
      const result = await runMemoryCheck(deps.fetchFn, deps.url, deps.token, deps.timeoutMs);
      deps.onState(result.state, result.detail);
    } finally {
      inFlight = false;
    }
  }

  return {
    start(): void {
      void check();
      timer = setIntervalFn(() => {
        if (deps.isHidden?.() === true) return; // skip the periodic tick while hidden
        void check();
      }, intervalMs);
    },
    checkNow(): void {
      void check();
    },
    stop(): void {
      if (timer !== undefined) clearIntervalFn(timer);
      timer = undefined;
    },
  };
}
