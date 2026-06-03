import { describe, expect, it } from "bun:test";
import { buildInjector } from "./injector.js";

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
});
