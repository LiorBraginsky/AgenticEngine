import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { FixedMarkerProvider } from "./providers/fixed-marker-provider.js";
import { SmartDistillerProvider } from "./providers/smart-distiller-provider.js";
import type { MemoryProvider } from "./memory-provider.js";
import { resolveAnthropicKey, type ResolveResult } from "../secrets/cloud-secrets.js";

const REGISTRY = new Map<string, MemoryProvider>([
  ["dumb-tail", new DumbTailProvider()],
  ["fixed-marker", new FixedMarkerProvider()],
]);

/** Options accepted by buildMemoryProvider.
 *
 * resolveKey — test seam (Strike-4: no shell-out in unit tests). Injected tests
 * supply a fake resolver; production callers pass nothing (defaults to the real
 * resolveAnthropicKey). */
export interface BuildMemoryProviderOpts {
  resolveKey?: () => ResolveResult;
}

/**
 * Build a SmartDistillerProvider when MEMORY_PROVIDER=smart and a key is resolvable.
 * On no-key: loud console.error (includes fixHint) + returns null so the caller
 * falls back to dumb-tail. Daemon stays up regardless (ADR-0010 gotcha-#9 posture).
 *
 * `"smart"` is NOT in the static REGISTRY map — it requires key resolution at
 * build-time and is never zero-arg constructible from the map.
 */
function buildSmartProvider(resolveKey: () => ResolveResult): MemoryProvider | null {
  const resolved = resolveKey();
  if (!resolved.ok) {
    console.error(
      `[memory] MEMORY_PROVIDER=smart but no ANTHROPIC_API_KEY resolved; ` +
        `falling back to dumb-tail. ${resolved.fixHint}`,
    );
    return null;
  }
  return new SmartDistillerProvider({ apiKey: resolved.key });
}

/**
 * Select the active MemoryProvider by the MEMORY_PROVIDER env var.
 * Defaults to "smart" (chunk-06 flip); no-key environments fall back to dumb-tail with a loud log.
 * Unknown ids fall back to "dumb-tail" with a console.error (never throws — ADR-0010 gotcha-#9 posture).
 *
 * opts.resolveKey — injectable key-resolver (test seam; Strike-4: no shell-out
 * in unit tests). Production callers omit this; the real resolveAnthropicKey is used.
 */
export function buildMemoryProvider(opts?: BuildMemoryProviderOpts): MemoryProvider {
  // memory-quality §3.4 / q#001 Sub-4: the dumb-tail->smart default flip lands in THIS
  // last chunk, after chunk-03's real-API probe ran green + chunks 04/05 merged. Safety
  // net unchanged: on the smart branch a no-key environment fires a loud console.error
  // (with fixHint) and falls back to the still-registered dumb-tail provider — the daemon
  // stays up and keyless test environments exercise that fallback BY DESIGN (grill #10).
  const id = process.env["MEMORY_PROVIDER"] ?? "smart";

  if (id === "smart") {
    const resolveKey = opts?.resolveKey ?? resolveAnthropicKey;
    const smart = buildSmartProvider(resolveKey);
    if (smart) return smart;
    // No key → loud-log fallback: return dumb-tail (daemon stays up)
    return REGISTRY.get("dumb-tail")!;
  }

  const provider = REGISTRY.get(id);
  if (!provider) {
    console.error(`[memory] Unknown MEMORY_PROVIDER="${id}", falling back to dumb-tail`);
    return REGISTRY.get("dumb-tail")!;
  }
  return provider;
}
