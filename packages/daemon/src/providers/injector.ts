import { mockProvider } from "./mock-provider.js";
import { anthropicApiProvider, createAnthropicApiProvider } from "./anthropic-api-provider.js";
import type { AgentProvider } from "./provider.js";
import type { MemoryActionPort } from "../memory/memory-action-port.js";

/**
 * Builds and returns the active AgentProvider selected by the LLM_PROVIDER
 * environment variable. Defaults to "mock" when unset or unknown.
 *
 * @param env - Injectable env record (defaults to Bun.env). Tests pass an
 *   explicit object so they never depend on process env.
 * @param deps - ADR-0016 decision 3 DI seam: a `memoryActionPort`, when present,
 *   is threaded into a freshly-constructed anthropic-api provider (the
 *   `clientFactory` posture) so its `advance()` runs the bounded memory-action
 *   tool loop. Absent ⇒ the byte-identical singleton (no port, no tools[]).
 *   The mock provider is unaffected either way.
 *
 * Unknown provider IDs log an error and fall back to "mock" — never throw
 * (gotcha #9 spirit: typed-error discipline at the port boundary).
 */
export function buildInjector(
  env?: Record<string, string | undefined>,
  deps?: { memoryActionPort?: MemoryActionPort },
): AgentProvider {
  const anthropic = deps?.memoryActionPort
    ? createAnthropicApiProvider({ memoryActionPort: deps.memoryActionPort })
    : anthropicApiProvider; // byte-identical singleton when no port

  const registry = new Map<string, AgentProvider>([
    [mockProvider.id, mockProvider],
    [anthropic.id, anthropic],
  ]);

  const requested = (env ?? Bun.env)["LLM_PROVIDER"] ?? "mock";
  const active = registry.get(requested);

  if (!active) {
    console.error(
      `[injector] unknown LLM_PROVIDER='${requested}', falling back to 'mock'`,
    );
    return mockProvider; // graceful default — never throw (gotcha #9 spirit)
  }

  return active;
}
