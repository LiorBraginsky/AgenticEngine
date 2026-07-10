/**
 * Unit tests for AnthropicApiProvider.
 *
 * Uses a mocked Anthropic client — NEVER hits the network.
 * Covers the five required cases from the plan (C3-1 §1c).
 */
import { test, expect, describe } from "bun:test";
import { parseEnvelope } from "@agentic/protocol";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInput, ProviderSessionState } from "./provider.js";
import { MemoryStore } from "../memory/store.js";
import { WriteGate } from "../memory/write-gate.js";
import { RuleBasedScanner } from "../memory/scanner/memory-scanner.js";
import { MemoryActionPort } from "../memory/memory-action-port.js";

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

// ── Scripted tool-use fake client (chunk 2c-02 loop tests) ────────────────

interface FakeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

type FakeAnyBlock = FakeTextBlock | FakeToolUseBlock;

interface FakeScriptedResponse {
  content: FakeAnyBlock[];
  stop_reason: string;
}

/**
 * A scriptable fake client: `messages.create` returns `responses[i]` for the
 * i-th call, clamped to the last entry once the script is exhausted (so a
 * single-element script behaves as "always returns this"). Captures every
 * call's params for assertions (call count, tools presence, tool_result content).
 */
function makeScriptedClient(responses: FakeScriptedResponse[]) {
  const captured: unknown[] = [];
  let calls = 0;
  return {
    client: {
      messages: {
        create: async (params: unknown) => {
          captured.push(params);
          const idx = Math.min(calls, responses.length - 1);
          calls++;
          return responses[idx]!;
        },
      },
    } as FakeClient,
    callCount: () => calls,
    capturedParams: () => captured,
  };
}

/** Extracts the JSON-parsed tool_result content from a captured create() params object
 *  (the LAST message in the convo, which the loop pushes as {role:"user", content:[...]}). */
function lastToolResultJSON(params: unknown): unknown {
  const p = params as { messages: Array<{ role: string; content: unknown }> };
  const last = p.messages[p.messages.length - 1]!;
  const blocks = last.content as Array<{ type: string; content: string }>;
  const toolResult = blocks.find((b) => b.type === "tool_result");
  if (!toolResult) throw new Error("no tool_result block found in last message");
  return JSON.parse(toolResult.content);
}

/** Fresh real SQLite store + real gate/scanner/port harness (real I/O; only the
 *  LLM network boundary is stubbed — per Global Constraints). */
function freshMemoryHarness() {
  const dir = mkdtempSync(join(tmpdir(), "2c02-anthropic-loop-"));
  const store = new MemoryStore({ dataDir: dir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(store, scanner);
  const port = new MemoryActionPort(store, gate, scanner);
  return { store, scanner, gate, port };
}

// ── Import the provider ────────────────────────────────────────────────────

// The provider is imported here; before implementation it will throw module-not-found.
const { createAnthropicApiProvider } = await import(
  "./anthropic-api-provider.js"
);
const { _resetMemo } = await import("../secrets/cloud-secrets.js");
const { COMPOSED_SYSTEM_PROMPT, COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS } = await import(
  "./system-prompt.js"
);

const SESSION_START_INBOUND: Extract<ProviderInput, { type: "session_start" }> =
  {
    type: "session_start",
    trigger: "user",
    text: "hi",
    client_session_id: "c-1",
  };

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
    const sysBlocks = p.system as Array<{
      type: string;
      text: string;
      cache_control: { type: string };
    }>;
    expect(Array.isArray(sysBlocks)).toBe(true);
    expect(sysBlocks[0]!.text).toBe(COMPOSED_SYSTEM_PROMPT);
    // cache_control shape must be preserved exactly (R2 — caching unchanged)
    expect(sysBlocks[0]!.cache_control).toEqual({ type: "ephemeral" });
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

// ── capability-conditional system prompt (chunk 2c-03, spec §3.8) ─────────
//
// The no-port assertion at line ~173 above (`=== COMPOSED_SYSTEM_PROMPT`) stays
// green, unmodified — that IS the byte-identical capability-ABSENT DoD line.
// This describe adds the capability-PRESENT counterpart.

describe("capability-conditional system prompt (chunk 2c-03, spec §3.8)", () => {
  test("port wired -> system block equals COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS (owns the capability, drops the cannot-forget clause)", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();

    const { client, capturedParams } = makeScriptedClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map() },
    };

    await provider.advance(priorState, {
      type: "session_start",
      trigger: "user",
      text: "hi",
      client_session_id: "c-2c03-present",
    });

    const params = capturedParams()[0] as {
      system: Array<{ type: string; text: string }>;
    };
    const sysText = params.system[0]!.text;

    expect(sysText).toBe(COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS);
    expect(sysText.toLowerCase()).toContain("this turn");
    expect(sysText).not.toContain(
      "You cannot modify, delete, or forget your own memory.",
    );

    store.close();
  });
});

// ── memory-action tool loop (chunk 2c-02) ──────────────────────────────────
//
// Real MemoryStore (temp file) + real WriteGate + real RuleBasedScanner + real
// MemoryActionPort throughout — the ONLY stub is the LLM network boundary
// (the scripted fake client). Per Global Constraints: no mocked store/port internals.

describe("memory-action tool loop (chunk 2c-02)", () => {
  test("scripted tool_use(memory_forget) through advance() -> fact durably gone + audit event; finalText/envelopes unchanged", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();
    const factId = store.insertFact({
      fact: "favorite color blue",
      canonical: "favorite color blue",
      topics: [],
      provenance: `thread:${t}`,
      scope: "cross-thread",
      expiry: null,
      confidence: 1,
      authored_by: "machine",
    }, "seed");

    const { client, callCount } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-1", name: "memory_forget", input: { ordinal: 1, expected_text: "favorite color blue" } },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [{ role: "user", content: "[remembered] 1. favorite color blue" }],
      memoryActionSlice: { threadId: t, ordinalMap: new Map([[1, factId]]) },
    };

    const result = await provider.advance(priorState, {
      type: "session_start",
      trigger: "user",
      text: "please forget my favorite colour",
      client_session_id: "c-loop-1",
    });

    expect(result.ok).toBe(true);
    expect(callCount()).toBe(2);
    expect(store.readFactById(factId)).toBeNull();

    const events = store.readMemoryActionEvents(t);
    expect(events.some((e) => e.action === "forget" && e.outcome === "applied")).toBe(true);

    if (result.ok) {
      expect(result.finalText).toBe("Done.");
    }
    expect(result.outbound).toHaveLength(3);
    expect(result.outbound[0]!.type).toBe("session_ack");
    expect(result.outbound[1]!.type).toBe("tool_call");
    if (result.outbound[1]!.type === "tool_call") {
      expect(result.outbound[1]!.payload.tool).toBe("show_text");
    }
    expect(result.outbound[2]!.type).toBe("session_end");

    store.close();
  });

  test("scripted tool_use(memory_remember) through advance() -> new machine/cross-thread fact inserted with thread provenance", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();

    const { client } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-1", name: "memory_remember", input: { fact: "likes tea" } },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Got it." }],
      },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map() },
    };

    const result = await provider.advance(priorState, {
      type: "session_start",
      trigger: "user",
      text: "please remember I like tea",
      client_session_id: "c-loop-2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalText).toBe("Got it.");

    const facts = store.readDistilledFacts(50);
    const inserted = facts.find((f) => f.fact === "likes tea");
    expect(inserted).toBeDefined();
    expect(inserted!.authored_by).toBe("machine");
    expect(inserted!.provenance).toBe(`thread:${t}`);

    store.close();
  });

  test("loop bound: an ALWAYS-tool_use client is called at most MEMORY_ACTIONS_MAX_PER_TURN+1 times and resolves (no hang/throw)", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();
    const factId = store.insertFact({
      fact: "some fact",
      canonical: "some fact",
      topics: [],
      provenance: `thread:${t}`,
      scope: "cross-thread",
      expiry: null,
      confidence: 1,
      authored_by: "machine",
    }, "seed");

    // A single scripted response, always returned (script exhaustion clamps to
    // the last entry) — simulates a misbehaving LLM that never stops calling tools.
    const { client, callCount } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-x", name: "memory_forget", input: { ordinal: 1, expected_text: "some fact" } },
        ],
      },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map([[1, factId]]) },
    };

    let threw = false;
    let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
    try {
      result = await provider.advance(priorState, {
        type: "session_start",
        trigger: "user",
        text: "forget it",
        client_session_id: "c-loop-3",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.ok).toBe(true);
    // At most cap+1 sequential model calls (3 tool-executing rounds + 1 forced final).
    expect(callCount()).toBeLessThanOrEqual(4);

    store.close();
  });

  test("loop bound: ONE response with 4 memory_forget blocks -> actions 1-3 applied, 4th cap_exceeded (shared per-turn counter)", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();
    const factIds = [1, 2, 3, 4].map((n) =>
      store.insertFact({
        fact: `fact number ${n}`,
        canonical: `fact number ${n}`,
        topics: [],
        provenance: `thread:${t}`,
        scope: "cross-thread",
        expiry: null,
        confidence: 1,
        authored_by: "machine",
      }, "seed"),
    );

    const { client } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [1, 2, 3, 4].map((n) => ({
          type: "tool_use" as const,
          id: `tu-${n}`,
          name: "memory_forget",
          input: { ordinal: n, expected_text: `fact number ${n}` },
        })),
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const ordinalMap = new Map<number, string>(factIds.map((id, i) => [i + 1, id]));
    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap },
    };

    const result = await provider.advance(priorState, {
      type: "session_start",
      trigger: "user",
      text: "forget facts 1 2 3 and 4",
      client_session_id: "c-loop-4",
    });

    expect(result.ok).toBe(true);

    // facts 1-3 gone, fact 4 survives (capped)
    expect(store.readFactById(factIds[0]!)).toBeNull();
    expect(store.readFactById(factIds[1]!)).toBeNull();
    expect(store.readFactById(factIds[2]!)).toBeNull();
    expect(store.readFactById(factIds[3]!)).not.toBeNull();

    const events = store.readMemoryActionEvents(t);
    expect(events.filter((e) => e.action === "forget" && e.outcome === "applied").length).toBe(3);
    expect(events.some((e) => e.outcome === "refused-cap_exceeded")).toBe(true);

    store.close();
  });

  test("typed refusal round-trip: out-of-map ordinal -> not_in_view tool_result, no throw", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();

    const { client, capturedParams } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-1", name: "memory_forget", input: { ordinal: 99, expected_text: "x" } },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK." }],
      },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map() },
    };

    let threw = false;
    let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
    try {
      result = await provider.advance(priorState, {
        type: "session_start",
        trigger: "user",
        text: "forget ordinal 99",
        client_session_id: "c-loop-5",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.ok).toBe(true);

    const toolResult = lastToolResultJSON(capturedParams()[1]) as { ok: boolean; code?: string };
    expect(toolResult.ok).toBe(false);
    expect(toolResult.code).toBe("not_in_view");

    store.close();
  });

  test("typed refusal round-trip: malformed args (non-integer ordinal) -> not_in_view, no throw, port never called (no audit row)", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();

    const { client, capturedParams } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-1", name: "memory_forget", input: { ordinal: "abc", expected_text: "x" } },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK." }],
      },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map() },
    };

    let threw = false;
    let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
    try {
      result = await provider.advance(priorState, {
        type: "session_start",
        trigger: "user",
        text: "forget a malformed ordinal",
        client_session_id: "c-loop-6",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.ok).toBe(true);

    const toolResult = lastToolResultJSON(capturedParams()[1]) as { ok: boolean; code?: string };
    expect(toolResult.ok).toBe(false);
    expect(toolResult.code).toBe("not_in_view");

    // Port never called: no audit row written for this thread.
    expect(store.readMemoryActionEvents(t).length).toBe(0);

    store.close();
  });

  // ── review FIX 1 (BLOCKER): the forced-final call must NOT omit `tools` ────
  //
  // The Anthropic Messages API 400s ANY request whose `messages` already contain
  // tool_use/tool_result blocks but whose `tools` param is ABSENT. The forced-final
  // call's `convo` always already contains the prior rounds' tool blocks, so
  // omitting `tools` there is a guaranteed real-API 400 (guardrail d1 — every
  // action must still be acknowledged). Fix: keep `tools` declared throughout and
  // add `tool_choice:{type:"none"}` ONLY on the forced-final round.
  test("FIX 1: forced-final call keeps `tools` declared + adds tool_choice:none; no call omits tools while useTools", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();
    const factId = store.insertFact({
      fact: "some fact",
      canonical: "some fact",
      topics: [],
      provenance: `thread:${t}`,
      scope: "cross-thread",
      expiry: null,
      confidence: 1,
      authored_by: "machine",
    }, "seed");

    // Always returns tool_use — forces the loop to hit the round cap and issue
    // the forced-final call (call #cap+1 = the 4th sequential model call).
    const { client, capturedParams, callCount } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-x", name: "memory_forget", input: { ordinal: 1, expected_text: "some fact" } },
        ],
      },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map([[1, factId]]) },
    };

    const result = await provider.advance(priorState, {
      type: "session_start",
      trigger: "user",
      text: "forget it forever",
      client_session_id: "c-fix1",
    });

    expect(result.ok).toBe(true);
    expect(callCount()).toBe(4); // 3 tool-executing rounds (the cap) + 1 forced-final

    const params = capturedParams() as Array<{ tools?: unknown; tool_choice?: { type: string } }>;
    expect(params).toHaveLength(4);

    // NO call may omit `tools` while useTools — every round's convo may already
    // carry tool_use/tool_result blocks from a prior round.
    for (const p of params) {
      expect("tools" in p).toBe(true);
    }

    // The forced-final (LAST) call ALSO carries tool_choice:{type:"none"} — the
    // model is not permitted to call tools, but `tools` stays declared so the
    // real API's tool-blocks-in-history constraint is satisfied.
    const forcedFinal = params[params.length - 1]!;
    expect(forcedFinal.tool_choice).toEqual({ type: "none" });

    // Earlier (non-forced) rounds must NOT set tool_choice:none (default "auto").
    for (const p of params.slice(0, -1)) {
      expect(p.tool_choice).toBeUndefined();
    }

    store.close();
  });

  // ── review FIX 3: dispatchTool never-throw branches, exercised through advance() ──

  test("FIX 3: memory_forget with non-string expected_text -> stale_target tool_result, port never called (no audit row)", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();

    const { client, capturedParams } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-1", name: "memory_forget", input: { ordinal: 1, expected_text: 42 } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "OK." }] },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map([[1, "some-fact-id"]]) },
    };

    let threw = false;
    let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
    try {
      result = await provider.advance(priorState, {
        type: "session_start",
        trigger: "user",
        text: "forget it with a bad expected_text",
        client_session_id: "c-fix3-a",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.ok).toBe(true);

    const toolResult = lastToolResultJSON(capturedParams()[1]) as { ok: boolean; code?: string };
    expect(toolResult.ok).toBe(false);
    expect(toolResult.code).toBe("stale_target");

    // Port never called: no audit row written for this thread.
    expect(store.readMemoryActionEvents(t).length).toBe(0);

    store.close();
  });

  test("FIX 3: memory_remember with missing/non-string fact -> rejected_by_scan tool_result, port never called (no audit row)", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();

    const { client, capturedParams } = makeScriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu-1", name: "memory_remember", input: { fact: 123 } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "OK." }] },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map() },
    };

    let threw = false;
    let result: Awaited<ReturnType<typeof provider.advance>> | undefined;
    try {
      result = await provider.advance(priorState, {
        type: "session_start",
        trigger: "user",
        text: "remember something with a bad fact type",
        client_session_id: "c-fix3-b",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.ok).toBe(true);

    const toolResult = lastToolResultJSON(capturedParams()[1]) as { ok: boolean; code?: string };
    expect(toolResult.ok).toBe(false);
    expect(toolResult.code).toBe("rejected_by_scan");

    expect(store.readMemoryActionEvents(t).length).toBe(0);

    store.close();
  });

  // ── review FIX 4: max_tokens budget for tool-capable turns + empty finalText guard ──

  test("FIX 4: tool-capable turns get a larger max_tokens budget (1024) now that tool_use JSON shares it", async () => {
    const { store, port } = freshMemoryHarness();
    const t = store.createThread();

    const { client, capturedParams } = makeScriptedClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      memoryActionPort: port,
    });

    const priorState: ProviderSessionState = {
      phase: "done",
      session_id: "",
      messages: [],
      memoryActionSlice: { threadId: t, ordinalMap: new Map() },
    };

    await provider.advance(priorState, {
      type: "session_start",
      trigger: "user",
      text: "hi",
      client_session_id: "c-fix4-a",
    });

    const params = capturedParams()[0] as { max_tokens: number };
    expect(params.max_tokens).toBe(1024);

    store.close();
  });

  test("FIX 4: empty finalText after the loop is never shipped verbatim -- an honest fallback is substituted", async () => {
    // No text block and a non-tool_use stop_reason -> the loop breaks immediately
    // with text="" (e.g. a max_tokens truncation before any text was emitted).
    const { client } = makeScriptedClient([
      { stop_reason: "max_tokens", content: [] },
    ]);

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      // deliberately NO memoryActionPort — the guard must fire regardless of
      // tool-capability (this class of empty-reply bug pre-dates the tool loop).
    });

    const result = await provider.advance(undefined, SESSION_START_INBOUND);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalText).not.toBe("");
      expect(result.finalText?.length ?? 0).toBeGreaterThan(0);
    }
    const call = result.outbound[1]!;
    expect(call.type).toBe("tool_call");
    if (call.type === "tool_call" && call.payload.tool === "show_text") {
      expect(call.payload.args.text.content).not.toBe("");
    }
  });

  // ── review FIX 5: dispatchTool's defensive catch must not mislabel memory_remember ──
  // as a forget-flavored code. Uses a fake port whose forget/remember THROW, to reach
  // the (should-not-happen) catch branch deterministically.

  describe("FIX 5: dispatchTool catch fallback code branches on tool name", () => {
    function makeThrowingPort(): MemoryActionPort {
      return {
        forget: () => {
          throw new Error("boom");
        },
        remember: () => {
          throw new Error("boom");
        },
      } as unknown as MemoryActionPort;
    }

    test("memory_forget throwing -> caught, code stale_target", async () => {
      const { client, capturedParams } = makeScriptedClient([
        {
          stop_reason: "tool_use",
          content: [
            { type: "tool_use", id: "tu-1", name: "memory_forget", input: { ordinal: 1, expected_text: "x" } },
          ],
        },
        { stop_reason: "end_turn", content: [{ type: "text", text: "OK." }] },
      ]);

      const provider = createAnthropicApiProvider({
        apiKey: "sk-ant-test",
        client: client as never,
        memoryActionPort: makeThrowingPort(),
      });

      const priorState: ProviderSessionState = {
        phase: "done",
        session_id: "",
        messages: [],
        memoryActionSlice: { threadId: "t-fix5", ordinalMap: new Map([[1, "f-1"]]) },
      };

      const result = await provider.advance(priorState, {
        type: "session_start",
        trigger: "user",
        text: "forget",
        client_session_id: "c-fix5-a",
      });

      expect(result.ok).toBe(true);
      const toolResult = lastToolResultJSON(capturedParams()[1]) as { ok: boolean; code?: string };
      expect(toolResult.ok).toBe(false);
      expect(toolResult.code).toBe("stale_target");
    });

    test("memory_remember throwing -> caught, code rejected_by_scan (NOT the forget-flavored stale_target)", async () => {
      const { client, capturedParams } = makeScriptedClient([
        {
          stop_reason: "tool_use",
          content: [
            { type: "tool_use", id: "tu-1", name: "memory_remember", input: { fact: "x" } },
          ],
        },
        { stop_reason: "end_turn", content: [{ type: "text", text: "OK." }] },
      ]);

      const provider = createAnthropicApiProvider({
        apiKey: "sk-ant-test",
        client: client as never,
        memoryActionPort: makeThrowingPort(),
      });

      const priorState: ProviderSessionState = {
        phase: "done",
        session_id: "",
        messages: [],
        memoryActionSlice: { threadId: "t-fix5", ordinalMap: new Map() },
      };

      const result = await provider.advance(priorState, {
        type: "session_start",
        trigger: "user",
        text: "remember",
        client_session_id: "c-fix5-b",
      });

      expect(result.ok).toBe(true);
      const toolResult = lastToolResultJSON(capturedParams()[1]) as { ok: boolean; code?: string };
      expect(toolResult.ok).toBe(false);
      expect(toolResult.code).toBe("rejected_by_scan");
    });
  });

  test("capability-absent regression: no memoryActionPort -> request payload has NO tools key; behavior byte-identical to today", async () => {
    let capturedParams: unknown = null;
    const client: FakeClient = {
      messages: {
        create: async (params: unknown) => {
          capturedParams = params;
          return { content: [{ type: "text" as const, text: "hello, no tools here" }] };
        },
      },
    };

    const provider = createAnthropicApiProvider({
      apiKey: "sk-ant-test",
      client: client as never,
      // deliberately NO memoryActionPort
    });

    const result = await provider.advance(undefined, SESSION_START_INBOUND);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalText).toBe("hello, no tools here");

    expect(capturedParams).not.toBeNull();
    expect("tools" in (capturedParams as Record<string, unknown>)).toBe(false);
  });
});
