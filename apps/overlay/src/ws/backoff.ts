/**
 * Capped exponential backoff with full jitter (CM-02 reconnect, plan D1).
 *   ceiling(n) = min(capMs, baseMs * 2^n)
 *   delay      = floor(random() * ceiling)   // full jitter, random() in [0,1)
 * WHY full jitter: avoids self-synchronized retry storms across reconnect loops
 * and keeps the first retry fast (base 500ms) while bounding the worst case (cap 10s).
 */
export interface BackoffConfig {
  baseMs: number;
  capMs: number;
  /** Injected for deterministic tests; defaults to Math.random at the call site. */
  random: () => number;
}

export const DEFAULT_BACKOFF: Omit<BackoffConfig, "random"> = { baseMs: 500, capMs: 10_000 };

/** Deterministic ceiling before jitter — exported so the doubling/cap is unit-testable. */
export function backoffCeilingMs(attempt: number, baseMs: number, capMs: number): number {
  const exp = baseMs * 2 ** attempt;
  return Number.isFinite(exp) ? Math.min(capMs, exp) : capMs;
}

/** Full-jitter delay: floor(random() * ceiling). */
export function backoffDelayMs(attempt: number, cfg: BackoffConfig): number {
  return Math.floor(cfg.random() * backoffCeilingMs(attempt, cfg.baseMs, cfg.capMs));
}
