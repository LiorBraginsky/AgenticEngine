import { test, expect } from "bun:test";
import { FixtureEmbeddingProvider } from "./fixture-embedding-provider.js";

test("embed returns one L2-normalized vector of length dims per text", async () => {
  const provider = new FixtureEmbeddingProvider();
  const result = await provider.embed(["a", "b"]);
  expect(result).not.toBeNull();
  const vectors = result!;
  expect(vectors.length).toBe(2);
  for (const v of vectors) {
    expect(v.length).toBe(provider.dims);
    let normSq = 0;
    for (const x of v) normSq += x * x;
    expect(Math.sqrt(normSq)).toBeCloseTo(1, 5);
  }
});

test("the same text yields a bit-identical vector across two separate calls (determinism)", async () => {
  const provider = new FixtureEmbeddingProvider();
  const [first] = (await provider.embed(["repeat me"]))!;
  const [second] = (await provider.embed(["repeat me"]))!;
  expect(Array.from(first!)).toEqual(Array.from(second!));
});

test("different texts yield different vectors", async () => {
  const provider = new FixtureEmbeddingProvider();
  const [a, b] = (await provider.embed(["alpha", "beta"]))!;
  expect(Array.from(a!)).not.toEqual(Array.from(b!));
});

test("onEmbed is invoked with the exact texts passed to embed (interleave hook)", async () => {
  const calls: string[][] = [];
  const provider = new FixtureEmbeddingProvider({ onEmbed: (texts) => calls.push(texts) });
  await provider.embed(["x", "y"]);
  expect(calls).toEqual([["x", "y"]]);
});

test("respects opts.dims and opts.modelId; id is fixed to \"fixture\"", () => {
  const provider = new FixtureEmbeddingProvider({ dims: 16, modelId: "custom-fixture" });
  expect(provider.dims).toBe(16);
  expect(provider.modelId).toBe("custom-fixture");
  expect(provider.id).toBe("fixture");
});

test("defaults: dims=8, modelId=\"fixture-v1\"", () => {
  const provider = new FixtureEmbeddingProvider();
  expect(provider.dims).toBe(8);
  expect(provider.modelId).toBe("fixture-v1");
});
