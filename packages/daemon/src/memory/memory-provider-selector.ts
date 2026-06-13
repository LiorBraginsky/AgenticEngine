import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { SmartDistillerProvider } from "./providers/smart-distiller-provider.js";
import type { MemoryProvider } from "./memory-provider.js";
import { resolveAnthropicKey, type ResolveResult } from "../secrets/cloud-secrets.js";

const REGISTRY = new Map<string, MemoryProvider>([
  ["dumb-tail", new DumbTailProvider()],
  // fixed-marker retired in v2-03 (spec §6). Default stays dumb-tail; flip to smart is v2-05.
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
 * Defaults to `smart` (the incremental distiller; v2-05 cutover). Unknown ids
 * and a no-key `smart` both fall back to `dumb-tail` with a `console.error`
 * (never throws — ADR-0010 gotcha-#9 posture). The keyless fallback keeps the
 * full suite green + deterministic with no network, AND is the swap-proof second
 * leg (spec §6).
 *
 * opts.resolveKey — injectable key-resolver (test seam; Strike-4: no shell-out
 * in unit tests). Production callers omit this; the real resolveAnthropicKey is used.
 */
export function buildMemoryProvider(opts?: BuildMemoryProviderOpts): MemoryProvider {
  // v2-05 cutover (§3.8 / §6): the incremental SmartDistiller is the default.
  // Keyless env (no resolvable ANTHROPIC key) falls back to the DumbTail delta with
  // the loud log below — daemon stays up; quality degrades, not availability. This
  // keyless leg keeps the full suite green + deterministic with no network, AND is the
  // swap-proof second leg (spec §6).
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
