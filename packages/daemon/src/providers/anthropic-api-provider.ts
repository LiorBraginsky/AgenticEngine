/**
 * AnthropicApiProvider — raw-API adapter for the THIN AgentProvider port.
 *
 * Architecture (functional-core / imperative-shell split):
 *   Pure core  — formatShowTextEnvelopes / formatErrorEnd (no I/O, unit-tested
 *                via the envelopes they return).
 *   Shell      — advance() owns the Anthropic network call + error handling.
 *
 * Lint: no `any` outside test fixtures (strict-mode enforced).
 * Dependency: @anthropic-ai/sdk (ADR-0011-gated new runtime dep).
 */

import Anthropic from "@anthropic-ai/sdk";
import { ShowTextArgs } from "@agentic/protocol";
import type { Envelope } from "@agentic/protocol";
import type {
  AgentProvider,
  ProviderError,
  ProviderInput,
  ProviderResult,
  ProviderSessionState,
  SessionMessage,
} from "./provider.js";
import { resolveAnthropicKey } from "../secrets/cloud-secrets.js";
import type { ResolveOpts } from "../secrets/cloud-secrets.js";

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a concise assistant rendered in a small desktop overlay. Keep replies short.";

// ── Pure formatters (functional core) ─────────────────────────────────────

/**
 * Builds the three outbound envelopes for a successful show_text flow.
 *
 * Envelope order is LOAD-BEARING:
 *   1. session_ack  — overlay learns session_id from this (must come FIRST)
 *   2. tool_call    — show_text with nested { text: { primitive:"text", content } }
 *   3. session_end  — reason "completed"
 *
 * Self-validates args with ShowTextArgs.safeParse (mirrors the mock's
 * ShowColorPickerArgs.safeParse guard).
 *
 * NOTE: this function returns Envelope[] | null when ShowTextArgs validation
 * fails (treated as provider_failure by the caller).
 */
export function formatShowTextEnvelopes(
  client_session_id: string | undefined,
  session_id: string,
  call_id: string,
  content: string,
): Envelope[] | null {
  const args = { text: { primitive: "text" as const, content } };
  const argsCheck = ShowTextArgs.safeParse(args);
  if (!argsCheck.success) {
    return null;
  }
  const envelopes: Envelope[] = [
    { type: "session_ack", session_id, client_session_id },
    {
      type: "tool_call",
      session_id,
      call_id,
      payload: { tool: "show_text", args: argsCheck.data },
    },
    { type: "session_end", session_id, reason: "completed" },
  ];
  return envelopes;
}

/**
 * Builds the error terminal envelopes.
 *
 * Envelope order is LOAD-BEARING:
 *   1. session_ack  — overlay confirms session before seeing the error
 *   2. session_end  — reason "error"
 */
export function formatErrorEnd(
  ids: { client_session_id: string | undefined; session_id: string },
  // detail is accepted for symmetry with callers that log it; not embedded in
  // the wire envelope to avoid leaking internal error strings to the overlay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _detail: string,
): Envelope[] {
  const { client_session_id, session_id } = ids;
  return [
    { type: "session_ack", session_id, client_session_id },
    { type: "session_end", session_id, reason: "error" },
  ];
}

// ── Error classifier ───────────────────────────────────────────────────────

/**
 * Maps SDK error types to human-readable detail strings (gotcha #9 discipline:
 * typed classification, never throw, never leak raw stack traces).
 *
 * Checks both:
 *   1. instanceof SDK classes — production path (real Anthropic client)
 *   2. .status HTTP code — test path (injected fake clients whose constructors
 *      don't extend the SDK classes but carry the same HTTP status)
 */
export function classifyAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "invalid/missing API key";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "rate limited";
  }
  // Fallback: check HTTP status on non-SDK fakes (e.g. injected test clients)
  const status =
    err !== null && typeof err === "object" && "status" in err
      ? (err as { status: unknown }).status
      : undefined;
  if (status === 401) {
    return "invalid/missing API key";
  }
  if (status === 429) {
    return "rate limited";
  }
  if (err instanceof Anthropic.APIError) {
    return "provider unavailable";
  }
  // Plain Error thrown by the SDK at construction time when apiKey is empty:
  // "Could not resolve authentication method. Expected one of apiKey, authToken, ..."
  // This is NOT an Anthropic.APIError so it falls here.
  if (
    err instanceof Error &&
    err.message.includes("Could not resolve authentication")
  ) {
    return "invalid/missing API key";
  }
  // Non-SDK errors (network timeouts, etc.)
  return "provider unavailable";
}

// ── Injectable factory ─────────────────────────────────────────────────────

/**
 * Dependency-injection options for tests and production.
 *
 *   apiKey         — if set (truthy), used verbatim; resolver is NOT called (Grill #2).
 *                   Empty string → missing-key guard fires (provider_failure).
 *   client         — injectable for unit tests; if omitted, built lazily from apiKey
 *   clientFactory  — injectable factory for tests that need to assert the resolved
 *                   key reaches client construction; default: (key) => new Anthropic({ apiKey: key })
 *   resolverOpts   — injected into resolveAnthropicKey() for unit tests that need to
 *                   fake the Keychain without shelling out.
 */
export interface AnthropicProviderOptions {
  /** ANTHROPIC_API_KEY string. Truthy → used verbatim (resolver NOT called). */
  apiKey?: string;
  /** Pre-built Anthropic client (injectable for tests). */
  client?: Anthropic;
  /** Factory used to construct the lazy client. Overridable in tests. */
  clientFactory?: (apiKey: string) => Anthropic;
  /** Injected resolver options for unit tests (e.g. fake Keychain getter). */
  resolverOpts?: ResolveOpts;
}

/**
 * Creates an AnthropicApiProvider implementing the THIN AgentProvider port.
 *
 * Production usage:
 *   const provider = createAnthropicApiProvider({ apiKey: Bun.env.ANTHROPIC_API_KEY });
 *
 * Test usage:
 *   const provider = createAnthropicApiProvider({ apiKey: "sk-ant-fake", client: mockClient });
 */
export function createAnthropicApiProvider(
  opts: AnthropicProviderOptions = {},
): AgentProvider {
  // Lazy client: built once on first use if not injected.
  let _client: Anthropic | null = opts.client ?? null;

  /**
   * Constructs (or returns the cached) Anthropic client.
   *
   * resolvedKey MUST be the key already validated by the guard above —
   * guaranteed non-empty so the SDK constructor never sees "".
   */
  function getClient(resolvedKey: string): Anthropic {
    if (!_client) {
      const factory =
        opts.clientFactory ?? ((apiKey: string) => new Anthropic({ apiKey }));
      _client = factory(resolvedKey);
    }
    return _client;
  }

  const provider: AgentProvider = {
    id: "anthropic-api",

    async advance(
      state: ProviderSessionState | undefined,
      inbound: ProviderInput,
    ): Promise<ProviderResult> {
      // ── display-only park guard (no interactive loop for show_text) ──────
      if (inbound.type === "tool_result" || inbound.type === "tool_cancel") {
        const fallback_session_id =
          inbound.session_id ?? (state?.session_id ?? "");
        const fallbackState: ProviderSessionState = state ?? {
          phase: "done",
          session_id: fallback_session_id,
          messages: [],
        };
        const error: ProviderError = {
          kind: "unexpected_message",
          detail: `AnthropicApiProvider received '${inbound.type}'; show_text is display-only`,
        };
        return { ok: false, error, nextState: fallbackState, outbound: [] };
      }

      // ── session_start ───────────────────────────────────────────────────
      const session_id = crypto.randomUUID();
      const call_id = crypto.randomUUID();
      const client_session_id = inbound.client_session_id;

      // Build messages array (memory-ready single-turn)
      const priorMessages: SessionMessage[] = state?.messages ?? [];
      const userMessage: SessionMessage = {
        role: "user",
        content: inbound.text ?? "",
      };
      const messages: SessionMessage[] = [...priorMessages, userMessage];

      // Terminal state (used for error paths too)
      const doneState: ProviderSessionState = {
        phase: "done",
        session_id,
        messages,
      };

      // ── Missing/empty key guard — do NOT call the SDK ───────────────────
      //
      // Grill #2: opts.apiKey keeps TOP precedence. If truthy, use it verbatim
      // and do NOT invoke the resolver (no shell-out in unit tests).
      // The resolver replaces ONLY the Bun.env.ANTHROPIC_API_KEY ?? "" tail.
      let resolvedKey: string;
      let resolveDetail: string | undefined;
      if (opts.apiKey !== undefined && opts.apiKey !== null) {
        // Direct injection path (tests / callers that pass an explicit key)
        resolvedKey = opts.apiKey;
      } else {
        // Production path: resolve from Keychain (or .env in dev)
        const resolved = resolveAnthropicKey(opts.resolverOpts);
        if (resolved.ok) {
          resolvedKey = resolved.key;
        } else {
          // Build the loud, named error detail (DoD #4).
          // fixHint already contains the full message; use it directly.
          resolveDetail = resolved.fixHint;
          resolvedKey = "";
        }
      }

      if (!resolvedKey.trim()) {
        const detail =
          resolveDetail ??
          "ANTHROPIC_API_KEY not set (tried: none — key was empty string)";
        console.error(`[anthropic-provider] ${detail}`);
        const error: ProviderError = { kind: "provider_failure", detail };
        return {
          ok: false,
          error,
          nextState: doneState,
          outbound: formatErrorEnd({ client_session_id, session_id }, detail),
        };
      }

      // ── Imperative shell: network call ──────────────────────────────────
      try {
        const client = getClient(resolvedKey);

        // Prompt caching: add cache_control on the system block per the
        // skill's convention. NOTE: the tiny system prompt is below Sonnet's
        // 2048-token cache minimum → cache_creation_input_tokens will be 0.
        // This is a documented no-op, not a bug (plan C3-1 Design note).
        const response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          thinking: { type: "disabled" },
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        // Extract text from first text block (else empty string)
        let replyText = "";
        for (const block of response.content) {
          if (block.type === "text") {
            replyText = block.text;
            break;
          }
        }

        // Build outbound — formatShowTextEnvelopes self-validates with safeParse
        const outbound = formatShowTextEnvelopes(
          client_session_id,
          session_id,
          call_id,
          replyText,
        );
        if (!outbound) {
          // Defensive: ShowTextArgs.safeParse rejected the content (should not
          // happen with a plain string, but follow the never-throw discipline).
          const detail = "show_text args validation failed";
          const error: ProviderError = { kind: "provider_failure", detail };
          return {
            ok: false,
            error,
            nextState: doneState,
            outbound: formatErrorEnd({ client_session_id, session_id }, detail),
          };
        }

        // Append assistant reply to messages for memory-ready nextState
        const nextMessages: SessionMessage[] = [
          ...messages,
          { role: "assistant", content: replyText },
        ];
        const nextState: ProviderSessionState = {
          phase: "done",
          session_id,
          messages: nextMessages,
        };

        return {
          ok: true,
          nextState,
          outbound,
          finalText: replyText,
        };
      } catch (err: unknown) {
        // Log the raw error server-side for observability without leaking to wire.
        console.error(
          "[anthropic-provider] raw error:",
          err instanceof Error ? `${err.name}: ${err.message}` : err,
        );
        // Any SDK error OR unexpected throw → graceful provider_failure
        const detail = classifyAnthropicError(err);
        const error: ProviderError = { kind: "provider_failure", detail };
        return {
          ok: false,
          error,
          nextState: doneState,
          outbound: formatErrorEnd({ client_session_id, session_id }, detail),
        };
      }
    },
  };

  return provider;
}

/**
 * Singleton instance for injector registration.
 * In production, reads ANTHROPIC_API_KEY from Bun.env lazily on first advance().
 */
export const anthropicApiProvider: AgentProvider =
  createAnthropicApiProvider();
