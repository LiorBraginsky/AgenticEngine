/**
 * Unit tests for AnthropicApiProvider.
 *
 * Uses a mocked Anthropic client — NEVER hits the network.
 * Covers the five required cases from the plan (C3-1 §1c).
 */
import { test, expect, describe } from "bun:test";
import { parseEnvelope } from "@agentic/protocol";
import type { ProviderInput } from "./provider.js";

// ── Fake Anthropic client types ────────────────────────────────────────────

interface FakeTextBlock {
  type: "text";
  text: string;
}

interface FakeMessagesCreateResponse {
  content: FakeTextBlock[];
}

interface FakeClient {
  messages: {
    create: (params: unknown) => Promise<FakeMessagesCreateResponse>;
  };
}

function makeTextClient(replyText: string): FakeClient {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text" as const, text: replyText }],
      }),
    },
  };
}

// ── Import the provider ────────────────────────────────────────────────────

// The provider is imported here; before implementation it will throw module-not-found.
const { createAnthropicApiProvider } = await import(
  "./anthropic-api-provider.js"
);
const { _resetMemo } = await import("../secrets/cloud-secrets.js");

const SESSION_START_INBOUND: Extract<ProviderInput, { type: "session_start" }> =
  {
    type: "session_start",
    trigger: "user",
    text: "hi",
    client_session_id: "c-1",
  };

const SYSTEM_PROMPT =
  "You are a concise assistant rendered in a small desktop overlay. Keep replies short.";

// ── (v) id assertion ───────────────────────────────────────────────────────

test("anthropicApiProvider.id === 'anthropic-api'", async () => {
  const provider = createAnthropicApiProvider({
    apiKey: "sk-ant-test",
    client: makeTextClient("hello") as never,
  });
  expect(provider.id).toBe("anthropic-api");
  // THIN port — no `kind` field
  expect("kind" in provider).toBe(false);
});

// ── (i) happy path ─────────────────────────────────────────────────────────

describe("happy path: session_start", () => {
  test("calls messages.create once with correct model + system + messages", async () => {
    let capturedParams: unknown = null;
    const client: FakeClient = {
      messages: {
        create: async (params: unknown) => {
          capturedParams = params;
          return { content: [{ type: "text" as const, text: "hello!" }] };
        },
      },
    };

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
    });

    await provider.advance(undefined, SESSION_START_INBOUND);

    expect(capturedParams).not.toBeNull();
    const p = capturedParams as {
      model: string;
      system: unknown;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(p.model).toBe("claude-sonnet-4-6");
    // system is an array of blocks with cache_control (prompt caching convention)
    const sysBlocks = p.system as Array<{ type: string; text: string }>;
    expect(Array.isArray(sysBlocks)).toBe(true);
    expect(sysBlocks[0]!.text).toBe(SYSTEM_PROMPT);
    expect(p.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(p.max_tokens).toBe(512);
  });

  test("returns ok:true with correct outbound envelopes and state", async () => {
    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: makeTextClient("hello!") as never,
    });

    const result = await provider.advance(undefined, SESSION_START_INBOUND);

    expect(result.ok).toBe(true);
    expect(result.outbound).toHaveLength(3);

    // 1st: session_ack with correct client_session_id
    const ack = result.outbound[0]!;
    expect(ack.type).toBe("session_ack");
    if (ack.type === "session_ack") {
      expect(ack.client_session_id).toBe("c-1");
      expect(typeof ack.session_id).toBe("string");
    }

    // 2nd: tool_call{show_text, args.text.content === "hello!"}
    const call = result.outbound[1]!;
    expect(call.type).toBe("tool_call");
    if (call.type === "tool_call") {
      expect(call.payload.tool).toBe("show_text");
      if (call.payload.tool === "show_text") {
        expect(call.payload.args.text.primitive).toBe("text");
        expect(call.payload.args.text.content).toBe("hello!");
      }
    }

    // 3rd: session_end{reason: "completed"}
    const end = result.outbound[2]!;
    expect(end.type).toBe("session_end");
    if (end.type === "session_end") {
      expect(end.reason).toBe("completed");
    }

    // nextState
    expect(result.nextState.phase).toBe("done");

    // finalText
    if (result.ok) {
      expect(result.finalText).toBe("hello!");

      // messages: user + assistant
      expect(result.nextState.messages).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello!" },
      ]);
    }
  });

  // ── (ii) every outbound passes parseEnvelope ────────────────────────────
  test("every outbound envelope passes parseEnvelope (frozen-contract validity)", async () => {
    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: makeTextClient("hello!") as never,
    });

    const result = await provider.advance(undefined, SESSION_START_INBOUND);

    for (const env of result.outbound) {
      const parsed = parseEnvelope(env);
      expect(parsed.kind).toBe("ok");
    }
  });
});

// ── (iii) API error path ───────────────────────────────────────────────────

describe("API error: stub rejects with AuthenticationError", () => {
  test("no throw, ok:false, provider_failure with key detail, outbound=[session_ack, session_end{error}]", async () => {
    // Create a fake AuthenticationError matching the SDK's shape
    class FakeAuthError extends Error {
      status = 401;
      constructor() {
        super("invalid api key");
        this.name = "AuthenticationError";
      }
    }

    const client: FakeClient = {
      messages: {
        create: async () => {
          throw new FakeAuthError();
        },
      },
    };

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
    });

    let threw = false;
    let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
    try {
      result = await provider.advance(undefined, SESSION_START_INBOUND);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.ok).toBe(false);

    if (!result!.ok) {
      expect(result!.error.kind).toBe("provider_failure");
      // detail should mention key / auth
      expect(result!.error.detail.toLowerCase()).toContain("key");
    }

    // outbound: [session_ack, session_end{error}]
    expect(result!.outbound).toHaveLength(2);
    expect(result!.outbound[0]!.type).toBe("session_ack");
    const errEnd = result!.outbound[1]!;
    expect(errEnd.type).toBe("session_end");
    if (errEnd.type === "session_end") {
      expect(errEnd.reason).toBe("error");
    }

    // Every outbound still parses OK
    for (const env of result!.outbound) {
      const parsed = parseEnvelope(env);
      expect(parsed.kind).toBe("ok");
    }
  });
});

// ── (iv) missing/empty API key ─────────────────────────────────────────────

describe("missing/empty apiKey", () => {
  test("stub NOT called, provider_failure 'ANTHROPIC_API_KEY not set', outbound=[session_ack, session_end{error}]", async () => {
    let stubCalled = false;
    const client: FakeClient = {
      messages: {
        create: async () => {
          stubCalled = true;
          return { content: [{ type: "text" as const, text: "should not reach" }] };
        },
      },
    };

    const provider = createAnthropicApiProvider({
      apiKey: "",
      client: client as never,
    });

    let threw = false;
    let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
    try {
      result = await provider.advance(undefined, SESSION_START_INBOUND);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(stubCalled).toBe(false);
    expect(result!.ok).toBe(false);

    if (!result!.ok) {
      expect(result!.error.kind).toBe("provider_failure");
      // Detail is the loud named form: mentions ANTHROPIC_API_KEY and the empty-key condition
      expect(result!.error.detail).toContain("ANTHROPIC_API_KEY");
    }

    // outbound: [session_ack, session_end{error}]
    expect(result!.outbound).toHaveLength(2);
    expect(result!.outbound[0]!.type).toBe("session_ack");
    const errEnd = result!.outbound[1]!;
    expect(errEnd.type).toBe("session_end");
    if (errEnd.type === "session_end") {
      expect(errEnd.reason).toBe("error");
    }

    // Every outbound still parses OK
    for (const env of result!.outbound) {
      const parsed = parseEnvelope(env);
      expect(parsed.kind).toBe("ok");
    }
  });
});

// ── (v) regression: lazy getClient() receives the RESOLVED key, not "" ────
//
// This test exercises the path where opts.apiKey is undefined but the resolver
// returns a key from the Keychain (injected via resolverOpts.keychainGet).
// Pre-fix: getClient() was called with "" because opts.apiKey was always used.
// Post-fix: getClient(resolvedKey) passes the key from the resolver (Keychain or .env).

describe("lazy getClient() path: resolved key reaches client construction", () => {
  test("clientFactory is called with the resolved key, not empty string", async () => {
    const FAKE_KEY = "sk-ant-regression-test-key";

    // Reset the secrets memo so the injected getter runs fresh
    _resetMemo();

    let factoryCalledWith: string | undefined;

    // Stub client that returns a successful response
    const stubClient = {
      messages: {
        create: async () => ({
          content: [{ type: "text" as const, text: "hi there" }],
        }),
      },
    };

    const provider = createAnthropicApiProvider({
      // deliberately NO apiKey — production singleton pattern
      clientFactory: (apiKey: string) => {
        factoryCalledWith = apiKey;
        return stubClient as never;
      },
      // Inject a fake Keychain getter so no shell-out occurs
      resolverOpts: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        keychainGet: (_s, _a) => ({ ok: true, value: FAKE_KEY }),
      },
    });

    const result = await provider.advance(undefined, SESSION_START_INBOUND);

    // The factory must have been invoked with the real resolved key
    expect(factoryCalledWith).toBe(FAKE_KEY);
    expect(factoryCalledWith).not.toBe("");

    // And the advance must succeed end-to-end
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalText).toBe("hi there");
    }

    // Reset memo after test
    _resetMemo();
  });
});

// ── unexpected inbound (tool_result / tool_cancel guard) ──────────────────

test("tool_result on anthropic provider: ok:false, unexpected_message, no throw", async () => {
  const provider = createAnthropicApiProvider({
    apiKey: "sk-ant-test",
    client: makeTextClient("x") as never,
  });

  // Fabricate a fake tool_result (would only arrive in error scenarios)
  const fakeDoneState = {
    phase: "done" as const,
    session_id: "s-1",
    messages: [],
  };
  const fakeToolResult = {
    type: "tool_result" as const,
    session_id: "s-1",
    call_id: "c-1",
    payload: {
      tool: "show_color_picker" as const,
      result: { picked: { label: "Red", hex: "#FF0000" } },
    },
  };

  let threw = false;
  let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
  try {
    result = await provider.advance(fakeDoneState, fakeToolResult as ProviderInput);
  } catch {
    threw = true;
  }

  expect(threw).toBe(false);
  expect(result!.ok).toBe(false);
  if (!result!.ok) {
    expect(result!.error.kind).toBe("unexpected_message");
  }
  expect(result!.outbound).toHaveLength(0);
});
