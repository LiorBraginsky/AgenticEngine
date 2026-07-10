import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInjector } from "./injector.js";
import { anthropicApiProvider } from "./anthropic-api-provider.js";
import { mockProvider } from "./mock-provider.js";
import { MemoryStore } from "../memory/store.js";
import { WriteGate } from "../memory/write-gate.js";
import { RuleBasedScanner } from "../memory/scanner/memory-scanner.js";
import { MemoryActionPort } from "../memory/memory-action-port.js";

function freshMemoryActionPort(): MemoryActionPort {
  const dir = mkdtempSync(join(tmpdir(), "2c02-injector-"));
  const store = new MemoryStore({ dataDir: dir });
  const scanner = new RuleBasedScanner();
  const gate = new WriteGate(store, scanner);
  return new MemoryActionPort(store, gate, scanner);
}

describe("buildInjector", () => {
  it("(i) returns mock provider when env has no LLM_PROVIDER key", () => {
    const active = buildInjector({});
    expect(active.id).toBe("mock");
  });

  it("(ii) returns mock provider when LLM_PROVIDER='mock'", () => {
    const active = buildInjector({ LLM_PROVIDER: "mock" });
    expect(active.id).toBe("mock");
  });

  it("(iii) falls back to mock (no throw) when LLM_PROVIDER is unknown", () => {
    let thrown = false;
    let active: ReturnType<typeof buildInjector> | undefined;
    try {
      active = buildInjector({ LLM_PROVIDER: "does-not-exist" });
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(false);
    expect(active?.id).toBe("mock");
  });

  it("(iv) exposes the AgentProvider port surface (.id string + .advance function)", () => {
    const active = buildInjector({});
    expect(typeof active.id).toBe("string");
    expect(typeof active.advance).toBe("function");
  });

  // ── 2c chunk-02: MemoryActionPort DI wiring (ADR-0016 decision 3) ─────────

  it("(v) LLM_PROVIDER='anthropic-api' with NO memoryActionPort dep returns the byte-identical singleton", () => {
    const active = buildInjector({ LLM_PROVIDER: "anthropic-api" });
    expect(active.id).toBe("anthropic-api");
    expect(active).toBe(anthropicApiProvider);
  });

  it("(vi) LLM_PROVIDER='anthropic-api' WITH a memoryActionPort dep returns a distinct anthropic-api instance (the port was threaded through construction)", () => {
    const memoryActionPort = freshMemoryActionPort();
    const active = buildInjector({ LLM_PROVIDER: "anthropic-api" }, { memoryActionPort });
    expect(active.id).toBe("anthropic-api");
    expect(active).not.toBe(anthropicApiProvider);
  });

  it("(vii) LLM_PROVIDER='mock' WITH a memoryActionPort dep still returns the mock, unaffected", () => {
    const memoryActionPort = freshMemoryActionPort();
    const active = buildInjector({ LLM_PROVIDER: "mock" }, { memoryActionPort });
    expect(active.id).toBe("mock");
    expect(active).toBe(mockProvider);
  });
});
