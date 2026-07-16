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
import { composeSystemPrompt } from "./system-prompt.js";
import type {
  MemoryActionPort,
  MemoryActionTurnContext,
  MemoryActionResult,
} from "../memory/memory-action-port.js";
import { MEMORY_ACTIONS_MAX_PER_TURN, MEMORY_SEARCH_MAX_PER_TURN } from "../memory/memory-action-port.js";
import { buildMemoryToolsParam, serializeToolResult } from "./memory-action-tools.js";
import { memDebug, previewStr } from "../memory/debug-log.js";

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

// ── memory-action tool dispatch (chunk 2c-02, ADR-0016 decision 3) ────────

/**
 * review FIX 4: honest fallback shipped instead of an empty show_text bubble
 * when the loop's `replyText` is empty after the network call(s) complete
 * (e.g. a `stop_reason:"max_tokens"` truncation before any text was emitted).
 */
const EMPTY_REPLY_FALLBACK_TEXT =
  "I didn't get a reply together for that — could you try again?";

/**
 * Validates a scripted `tool_use` block's parsed `input` BEFORE calling the port
 * (gotcha #9 / cross-chunk fold: the loop must never throw across advance()).
 * Malformed args map to EXISTING typed result codes (no new code — the set is
 * spec-frozen): a malformed forget target → `not_in_view`; missing/bad
 * `expected_text` → `stale_target`; missing/bad `fact` → `rejected_by_scan`.
 * The try/catch is a defensive backstop — the port itself never throws, but a
 * malformed-input path here must not either.
 */
async function dispatchTool(
  name: string,
  input: unknown,
  port: MemoryActionPort,
  ctx: MemoryActionTurnContext,
): Promise<MemoryActionResult> {
  const i = (input ?? {}) as Record<string, unknown>;
  try {
    if (name === "memory_forget") {
      if (typeof i["ordinal"] !== "number" || !Number.isInteger(i["ordinal"])) {
        return { ok: false, code: "not_in_view", message: "I couldn't tell which listed item to forget — give me its number." };
      }
      if (typeof i["expected_text"] !== "string") {
        return { ok: false, code: "stale_target", message: "I need the exact current text of that fact to safely forget it." };
      }
      const reason = typeof i["reason"] === "string" ? i["reason"] : undefined;
      return port.forget(ctx, { ordinal: i["ordinal"], expected_text: i["expected_text"], reason });
    }
    if (name === "memory_remember") {
      if (typeof i["fact"] !== "string") {
        return { ok: false, code: "rejected_by_scan", message: "I couldn't read the note text to remember." };
      }
      if (i["replaces_ordinal"] !== undefined && (typeof i["replaces_ordinal"] !== "number" || !Number.isInteger(i["replaces_ordinal"]))) {
        return { ok: false, code: "not_in_view", message: "I couldn't tell which listed item to replace." };
      }
      if (i["expected_text"] !== undefined && typeof i["expected_text"] !== "string") {
        return { ok: false, code: "stale_target", message: "I need the exact current text of the fact I'm replacing." };
      }
      return port.remember(ctx, {
        fact: i["fact"],
        replaces_ordinal: i["replaces_ordinal"] as number | undefined,
        expected_text: i["expected_text"] as string | undefined,
      });
    }
    if (name === "memory_search") {
      if (typeof i["query"] !== "string") return { ok: true, action: "search", results: [] }; // malformed → honest empty (no throw, no new code)
      const scope = i["scope"] === "facts" || i["scope"] === "archive" || i["scope"] === "all" ? i["scope"] : "all";
      return await port.search(ctx, { query: i["query"], scope });
    }
    // Closed set (ADR-0016 decision 2) ⇒ unreachable via the declared tools[]; defensive only.
    return { ok: false, code: "not_in_view", message: "Unknown memory tool." };
  } catch (err) {
    console.error(
      "[anthropic-provider] memory tool threw (should not happen):",
      err instanceof Error ? err.message : err,
    );
    // review FIX 5: branch the fallback code on the tool name — `stale_target`
    // reads as forget-flavored ("that fact no longer exists / changed"), which
    // is a misleading label to hand back for a thrown memory_remember.
    if (name === "memory_search") return { ok: true, action: "search", results: [] }; // read: empty is honest, never a forget-flavored refusal
    const code = name === "memory_remember" ? "rejected_by_scan" : "stale_target";
    return { ok: false, code, message: "That memory action couldn't be completed." };
  }
}

/**
 * Best-effort preview of a tool call's user-supplied fact/target text, for the
 * MEMORY_DEBUG `action` glass-box channel (chunk 2c-03, spec §3.9). Never
 * throws — carries only content the tool call already holds, no secret.
 */
function actionInputPreview(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const src = name === "memory_remember" ? i["fact"] : i["expected_text"];
  return typeof src === "string" ? src : "";
}

/** hybrid-05: typed debug-fields helper for the MEMORY_DEBUG `search` channel (spec §3.6 D6b).
 *  NO `any` — mirrors the malformed-input tolerance dispatchTool's memory_search branch applies. */
function searchDebugFields(input: unknown): { scope: string; query: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const scope = i["scope"] === "facts" || i["scope"] === "archive" || i["scope"] === "all" ? i["scope"] : "all";
  return { scope, query: typeof i["query"] === "string" ? i["query"] : "" };
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
  /** ADR-0016 decision 3 DI seam (the clientFactory posture). Present ⇒ `tools[]`
   *  is declared and the bounded tool loop runs. Absent ⇒ byte-identical to today
   *  (no tools key on the request, no loop). */
  memoryActionPort?: MemoryActionPort;
}

/**
 * Creates an AnthropicApiProvider implementing the THIN AgentProvider port.
 *
 * Production usage (no args — the singleton below is sufficient):
 *   const provider = createAnthropicApiProvider();
 *
 * Test usage (inject a pre-built or mock client):
 *   const provider = createAnthropicApiProvider({ client: mockClient });
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

      // ── Imperative shell: network call (bounded memory-action tool loop) ──
      //
      // ADR-0016 decision 3: the loop is adapter-INTERNAL (AgentProvider port
      // unchanged). It runs iff opts.memoryActionPort is present; otherwise the
      // request carries NO `tools` key and behavior is byte-identical to today.
      try {
        const client = getClient(resolvedKey);

        const port = opts.memoryActionPort;
        const useTools = port !== undefined;
        const includeSearch = useTools && (port?.canSearch ?? false); // spec §3.6 D6d
        const systemPromptText = composeSystemPrompt(useTools, includeSearch);
        const toolsParam = buildMemoryToolsParam(includeSearch); // stable across rounds
        const slice = state?.memoryActionSlice;
        // Constructed ONCE per turn (spec §7 CLOSED): the SAME object is handed
        // to every port call this turn, so the shared cap counter (actionsUsed)
        // is enforced across the whole turn, not per-call. "" is a defensive
        // floor — production always populates the slice when useTools (index.ts).
        const turnCtx: MemoryActionTurnContext | undefined = useTools
          ? { threadId: slice?.threadId ?? "", ordinalMap: slice?.ordinalMap ?? new Map(), actionsUsed: 0, searchesUsed: 0 }
          : undefined;

        const convo: Anthropic.MessageParam[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        let replyText = "";
        let rounds = 0;
        let requestTools = useTools;

        // Prompt caching: add cache_control on the system block per the
        // skill's convention. NOTE: the tiny system prompt is below Sonnet's
        // 2048-token cache minimum → cache_creation_input_tokens will be 0.
        // This is a documented no-op, not a bug (plan C3-1 Design note).
        //
        // #42/#43 latency note (no timers added — deferral honored): worst case is
        // (MEMORY_ACTIONS_MAX_PER_TURN + MEMORY_SEARCH_MAX_PER_TURN) + 1 = 7 sequential
        // model calls (hybrid-05 — the round bound rose for the read cap) + bounded sub-ms
        // SQLite port ops. Memory action tools are DAEMON-INTERNAL (ADR-0016): the overlay
        // receives NO envelope until this loop emits the final show_text, so the WHOLE loop
        // runs inside the overlay's DEFAULT_HANDSHAKE_TIMEOUT_MS (30s, measured to-first-
        // envelope; it disarms on the first WS frame, which is the final reply here). At a
        // typical 1-3s/call the 7-call worst case is ~7-21s, but a slow tail (~5s/call) CAN
        // approach or exceed 30s and trip the handshake timeout → the turn is killed and the
        // user retries. No in-loop wall-clock deadline and no first-envelope streaming exist
        // yet — both are the deferred #42/#43 latency work (backlog), NOT this chunk. The
        // raised bound is spec-mandated (§3.6 D6b — searches must not starve a write), so it
        // is not lowered here.
        //
        // review FIX 4: tool-capable turns get a larger budget (1024 vs 512) now
        // that tool_use JSON shares it with the reply text — shrinks the
        // truncation window opened by the chunk. Capability-absent path (no
        // memoryActionPort) stays at 512 — byte-identical to pre-chunk.
        for (;;) {
          const response = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: useTools ? 1024 : 512,
            thinking: { type: "disabled" },
            system: [
              {
                type: "text",
                text: systemPromptText,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: convo,
            // review FIX 1 (BLOCKER): the Anthropic API 400s ANY request whose
            // `messages` already contain tool_use/tool_result blocks (which the
            // convo does from round 2 on) but whose `tools` param is ABSENT.
            // `tools` must therefore stay declared for the ENTIRE turn once
            // useTools is true — never conditioned on requestTools. On the
            // forced-final round (requestTools flipped false by the cap
            // backstop below), `tool_choice:{type:"none"}` is what forces clean
            // final text instead — omitting `tools` is NOT a valid way to do it.
            ...(useTools ? { tools: toolsParam } : {}),
            ...(useTools && !requestTools ? { tool_choice: { type: "none" as const } } : {}),
          });

          let text = "";
          const toolUses: Anthropic.ToolUseBlock[] = [];
          for (const block of response.content) {
            if (block.type === "text" && text === "") {
              text = block.text;
            } else if (block.type === "tool_use") {
              toolUses.push(block);
            }
          }

          if (!requestTools || response.stop_reason !== "tool_use" || toolUses.length === 0) {
            // review FIX 4 (residual, not fixed here): a response truncated by
            // `stop_reason:"max_tokens"` mid-tool-generation can land here with
            // `text` empty or a bare preamble — deeper truncation-honesty
            // detection is deferred (backlog); the empty-guard below is the
            // minimal hardening for THIS turn's reply, not a full fix.
            replyText = text;
            break;
          }

          convo.push({ role: "assistant", content: response.content });
          // hybrid-05: SEQUENTIAL await loop — cap-counting is order-dependent (the shared
          // turnCtx counters mutate per call), so a .map() (which would run dispatchTool calls
          // in parallel via Promise resolution order) is not safe once dispatchTool is async.
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            const result = await dispatchTool(tu.name, tu.input, port!, turnCtx!);
            if (result.ok && result.action === "search") {
              // MEMORY_DEBUG `search` channel (hybrid-05, spec §3.6 D6b): the read-tool
              // glass-box — reads have NO audit event, so this line is the only observability.
              const { scope, query } = searchDebugFields(tu.input);
              memDebug("search", {
                threadId: turnCtx!.threadId,
                scope,
                query: previewStr(query),
                resultCount: result.results.length,
                withheldCount: result.results.filter((r) => r.withheld).length,
              });
            } else {
              // MEMORY_DEBUG `action` channel (chunk 2c-03, spec §3.9): one line per
              // dispatchTool result, applied AND refused alike — off by default.
              // hybrid-05: this `else` is reached only when NOT (result.ok && result.action === "search")
              // (the branch above), so TS already narrows `result.ok===true` here to exclude the `search`
              // arm structurally — an explicit `result.action !== "search"` re-check would be a provably-dead
              // comparison (tsc TS2367) given that narrowing, so it is not repeated; the exclusion still holds.
              memDebug("action", {
                threadId: turnCtx!.threadId,
                tool: tu.name,
                outcome: result.ok ? "applied" : `refused-${result.code}`,
                ...(result.ok && result.factId !== undefined ? { factId: result.factId } : {}),
                factPreview: previewStr(actionInputPreview(tu.name, tu.input)),
              });
              // review-gate FIX 5: a memory_search REFUSAL (e.g. cap_exceeded) still deserves a
              // `search`-channel line — the read glass-box (D6b) should fire for capped reads too,
              // not only successes. Happy-path `search` payload shape (above) is unchanged.
              if (tu.name === "memory_search" && !result.ok) {
                const { scope, query } = searchDebugFields(tu.input);
                memDebug("search", {
                  threadId: turnCtx!.threadId,
                  scope,
                  query: previewStr(query),
                  resultCount: 0,
                  refused: result.code,
                });
              }
            }
            results.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: serializeToolResult(result),
            });
          }
          convo.push({ role: "user", content: results });

          rounds++;
          // C1 backstop RISES for the READ cap (spec §3.6 D6b): bound loop-executing rounds at
          // write-cap + read-cap so 3 searches can no longer exhaust the rounds a legitimate write
          // needs. Worst case = (MEMORY_ACTIONS_MAX_PER_TURN + MEMORY_SEARCH_MAX_PER_TURN) + 1 = 7
          // sequential model calls; the port's per-tool caps (actionsUsed / searchesUsed) are the
          // real terminators — this guards a misbehaving LLM calling one tool per round.
          // review FIX 1: this ONLY flips requestTools (which now controls
          // tool_choice:none, not `tools` presence — see the create() call above).
          if (rounds >= MEMORY_ACTIONS_MAX_PER_TURN + MEMORY_SEARCH_MAX_PER_TURN) requestTools = false;
        }

        // review FIX 4: never ship an empty show_text bubble — substitute an
        // honest short fallback rather than silently sending "" (which would
        // read to the user as a blank/broken reply with no signal either way).
        if (!replyText) {
          replyText = EMPTY_REPLY_FALLBACK_TEXT;
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
 * Resolves ANTHROPIC_API_KEY lazily on first advance() via the cloud-secrets
 * resolver: macOS Keychain in production, Bun.env/.env fallback in dev
 * (AGENTIC_ENV=dev gate).
 */
export const anthropicApiProvider: AgentProvider =
  createAnthropicApiProvider();
