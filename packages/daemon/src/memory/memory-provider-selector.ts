import { DumbTailProvider } from "./providers/dumb-tail-provider.js";
import { FixedMarkerProvider } from "./providers/fixed-marker-provider.js";
import type { MemoryProvider } from "./memory-provider.js";

const REGISTRY = new Map<string, MemoryProvider>([
  ["dumb-tail", new DumbTailProvider()],
  ["fixed-marker", new FixedMarkerProvider()],
]);

/**
 * Select the active MemoryProvider by the MEMORY_PROVIDER env var.
 * Defaults to "dumb-tail". Unknown ids fall back to "dumb-tail" with a
 * console.error (never throws — ADR-0010 gotcha-#9 posture).
 */
export function buildMemoryProvider(): MemoryProvider {
  const id = process.env["MEMORY_PROVIDER"] ?? "dumb-tail";
  const provider = REGISTRY.get(id);
  if (!provider) {
    console.error(`[memory] Unknown MEMORY_PROVIDER="${id}", falling back to dumb-tail`);
    return REGISTRY.get("dumb-tail")!;
  }
  return provider;
}
