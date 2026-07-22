/** Fail-closed --suite parse for memory-demo-harness (backlog §D-post): an unknown value ERRORS
 *  instead of silently running the core suite (the 2026-07-21 --suite=2d-on-main confusion).
 *  Absent flag → "core" (the documented default). */
export function resolveSuite(args: string[]): "core" | "2d" {
  const suiteArg = args.find((a) => a.startsWith("--suite="));
  if (suiteArg === undefined) return "core";
  const val = suiteArg.slice("--suite=".length);
  if (val !== "core" && val !== "2d") {
    throw new Error(`unknown --suite value "${val}" (expected: core | 2d)`);
  }
  return val;
}
