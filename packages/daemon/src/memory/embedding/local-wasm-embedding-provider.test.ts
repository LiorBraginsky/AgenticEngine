import { test, expect, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ort from "onnxruntime-web";
import { XlmRobertaTokenizer } from "./tokenizer.js";
import { LocalWasmEmbeddingProvider } from "./local-wasm-embedding-provider.js";

test("doWarmup early-exits when already ready — a second warmup builds no second InferenceSession", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "warmup-guard-"));
  const modelDir = join(dataDir, "models", "multilingual-e5-small");
  mkdirSync(join(modelDir, "onnx"), { recursive: true });
  writeFileSync(join(modelDir, "tokenizer.json"), "{}");
  writeFileSync(join(modelDir, "onnx", "model_quantized.onnx"), "stub");

  const createSpy = spyOn(ort.InferenceSession, "create").mockImplementation(async () => ({} as unknown as ort.InferenceSession));
  const tokSpy = spyOn(XlmRobertaTokenizer, "fromFile").mockImplementation(async () => ({} as unknown as XlmRobertaTokenizer));
  try {
    const p = new LocalWasmEmbeddingProvider({ dataDir });
    await p.warmup();
    await p.warmup(); // second, post-ready — must NOT rebuild
    expect(createSpy).toHaveBeenCalledTimes(1); // RED (pre-fix): 2
  } finally {
    createSpy.mockRestore();
    tokSpy.mockRestore();
  }
});
