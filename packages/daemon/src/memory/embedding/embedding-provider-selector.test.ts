import { test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { buildEmbeddingProvider } from "./embedding-provider-selector.js";

// Save + restore EMBEDDING_PROVIDER around each test.
let saved: string | undefined;
beforeEach(() => {
  saved = process.env["EMBEDDING_PROVIDER"];
});
afterEach(() => {
  if (saved === undefined) delete process.env["EMBEDDING_PROVIDER"];
  else process.env["EMBEDDING_PROVIDER"] = saved;
});

test("EMBEDDING_PROVIDER=fixture => a FixtureEmbeddingProvider", () => {
  process.env["EMBEDDING_PROVIDER"] = "fixture";
  const provider = buildEmbeddingProvider();
  expect(provider).not.toBeNull();
  expect(provider!.id).toBe("fixture");
});

test("EMBEDDING_PROVIDER=none => null", () => {
  process.env["EMBEDDING_PROVIDER"] = "none";
  const provider = buildEmbeddingProvider();
  expect(provider).toBeNull();
});

test("unknown EMBEDDING_PROVIDER id => null + a loud console.error (never throws)", () => {
  process.env["EMBEDDING_PROVIDER"] = "nonexistent-provider-xyz";
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const provider = buildEmbeddingProvider();
  expect(errSpy).toHaveBeenCalled();
  errSpy.mockRestore();
  expect(provider).toBeNull();
});

test("EMBEDDING_PROVIDER unset => defaults to local-wasm (construction only — no I/O, no download)", () => {
  delete process.env["EMBEDDING_PROVIDER"];
  const provider = buildEmbeddingProvider({ dataDir: "/tmp/embedding-provider-selector-test" });
  expect(provider).not.toBeNull();
  expect(provider!.id).toBe("local-wasm");
});
