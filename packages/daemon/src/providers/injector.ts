import { mockProvider } from "./mock-provider.js";
import type { AgentProvider } from "./provider.js";

/**
 * Builds and returns the active AgentProvider selected by the LLM_PROVIDER
 * environment variable. Defaults to "mock" when unset or unknown.
 *
 * @param env - Injectable env record (defaults to Bun.env). Tests pass an
 *   explicit object so they never depend on process env.
 *
 * Unknown provider IDs log an error and fall back to "mock" — never throw
 * (gotcha #9 spirit: typed-error discipline at the port boundary).
 *
 * chunk-03 registration point: add one Map entry for anthropicApiProvider.
 */
export function buildInjector(
  env?: Record<string, string | undefined>,
): AgentProvider {
  const registry = new Map<string, AgentProvider>([
    [mockProvider.id, mockProvider],
    // chunk-03 registers anthropicApiProvider here
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
