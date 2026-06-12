/**
 * Regression guard for keychain-prod-probe's anti-infinite-loop fix (§6.1 demo).
 *
 * ─── The bug the demo caught ───────────────────────────────────────────────
 * The probe re-execs under a "cleaned env" when it detects ANTHROPIC_API_KEY /
 * AGENTIC_ENV. But Bun auto-loads `.env` FROM THE PROCESS CWD on every startup.
 * The original re-exec inherited cwd=packages/daemon, so the child re-read
 * packages/daemon/.env → ANTHROPIC_API_KEY reappeared → contamination re-detected
 * → re-exec → ∞ loop. Tests + clean review missed it; the live demo did not.
 *
 * ─── What this file guards (no real Keychain / network / real .env needed) ──
 *   1. MECHANISM: Bun loads `.env` from cwd, so a clean cwd (no reachable .env)
 *      is what actually breaks the loop. Proven hermetically with a self-created
 *      temp `.env` — NOT the real packages/daemon/.env (which is gitignored and
 *      absent in CI, so depending on it would break the green branch there).
 *   2. SENTINEL: PROBE_REEXECED caps the re-exec at one. A child that is STILL
 *      contaminated after the marker is set fails loudly instead of looping.
 *
 * The sentinel test trips the FATAL branch, which exits before any resolve /
 * network call — and the mere fact that Bun.spawnSync RETURNS is the no-loop
 * proof (an infinite loop would hang until the test timeout).
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUN = process.execPath;
const PROBE = join(import.meta.dir, "keychain-prod-probe.ts");

// Mirrors the probe's re-exec env: HOME (Keychain session) + minimal PATH, and
// crucially NO ANTHROPIC_API_KEY in the env object itself.
const CLEAN_ENV: Record<string, string> = {
  HOME: Bun.env.HOME ?? "",
  PATH: "/usr/local/bin:/usr/bin:/bin",
};

/** Spawn a tiny `bun` child in `cwd` and report whether it sees ANTHROPIC_API_KEY. */
function keyVisibilityInCwd(cwd: string): string {
  const proc = Bun.spawnSync(
    [BUN, "-e", `process.stdout.write(Bun.env.ANTHROPIC_API_KEY === undefined ? "UNSET" : "SET")`],
    { cwd, env: CLEAN_ENV, stdout: "pipe", stderr: "pipe" },
  );
  return new TextDecoder().decode(proc.stdout).trim();
}

describe("keychain-prod-probe — env-isolation / anti-loop fix", () => {
  test("MECHANISM: a cwd WITH a .env re-contaminates a cleaned env (why same-cwd re-exec looped)", () => {
    const dirtyDir = mkdtempSync(join(tmpdir(), "probe-dirty-"));
    try {
      writeFileSync(join(dirtyDir, ".env"), "ANTHROPIC_API_KEY=sk-ant-from-dotenv\n");
      // Even though CLEAN_ENV has no ANTHROPIC_API_KEY, Bun reloads it from .env in cwd.
      expect(keyVisibilityInCwd(dirtyDir)).toBe("SET");
    } finally {
      rmSync(dirtyDir, { recursive: true, force: true });
    }
  });

  test("MECHANISM: a clean cwd (no reachable .env) keeps the cleaned env clean (the fix)", () => {
    const cleanDir = mkdtempSync(join(tmpdir(), "probe-clean-"));
    try {
      // This is what the probe's re-exec now does: cwd=os.tmpdir(), no .env reachable.
      expect(keyVisibilityInCwd(cleanDir)).toBe("UNSET");
    } finally {
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  test("SENTINEL: a STILL-contaminated re-exec fails loudly and does NOT loop", () => {
    // Simulate a child of a re-exec where .env exclusion FAILED: PROBE_REEXECED is
    // already set AND the env is still dirty. The probe must exit non-zero with a
    // clear message — and return promptly (spawnSync blocking-return == no loop).
    const proc = Bun.spawnSync([BUN, "run", PROBE], {
      cwd: tmpdir(),
      env: {
        ...CLEAN_ENV,
        PROBE_REEXECED: "1",
        ANTHROPIC_API_KEY: "sk-ant-still-dirty-sentinel-test",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const combined =
      new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
    expect(proc.exitCode).not.toBe(0);
    expect(combined).toContain("STILL contaminated");
  });
});
