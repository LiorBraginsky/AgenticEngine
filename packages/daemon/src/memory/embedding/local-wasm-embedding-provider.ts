import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { XlmRobertaTokenizer } from "./tokenizer.js";

/**
 * Default local-WASM adapter (hybrid-retrieval spec §3.2 D2b; ADR-0017 decision 2) — the
 * in-process, no-native-addon lane (gotcha #46 honored: NO `onnxruntime-node`). Proven by
 * the Task-1 spike on Bun 1.3.4: `onnxruntime-web@1.27.0` WASM backend + `@lenml/tokenizers`.
 */
const MODEL_ID = "Xenova/multilingual-e5-small";
const MODEL_DIR_SLUG = "multilingual-e5-small";
const DIMS = 384;
const HF_BASE = "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main";
const FILES = { tokenizer: "tokenizer.json", model: "onnx/model_quantized.onnx" };
const DOC_PREFIX = "passage: "; // e5 corpus-side convention (see the query-prefix note on embed())

/** Configure onnxruntime-web once (module-lifetime, idempotent regardless of how many
 *  adapter instances are constructed): resolve the INSTALLED onnxruntime-web package's
 *  `dist/` (containing the .wasm binaries) via `import.meta.resolve` -> `fileURLToPath` ->
 *  `dirname` (monorepo-safe — never a script-relative path), and force numThreads=1
 *  (the Task-1 spike-proven mechanics; documented ort knobs, set once). */
let ortConfigured = false;
function configureOrtOnce(): void {
  if (ortConfigured) return;
  ortConfigured = true;
  const distDir = dirname(fileURLToPath(import.meta.resolve("onnxruntime-web")));
  ort.env.wasm.wasmPaths = `${distDir}/`;
  ort.env.wasm.numThreads = 1;
}

export class LocalWasmEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-wasm";
  readonly modelId = MODEL_ID;
  readonly dims = DIMS;

  private readonly modelDir: string;
  private session: ort.InferenceSession | null = null;
  private tokenizer: XlmRobertaTokenizer | null = null;
  private ready = false;
  private loading: Promise<void> | null = null;
  private loggedUnavailable = false;

  constructor(opts: { dataDir: string }) {
    // Construction touches NEITHER filesystem nor network (beyond configuring ort's
    // in-memory env, which resolves an already-installed npm dependency — no I/O of
    // model data). Model presence is checked lazily, only inside warmup()/embed().
    this.modelDir = join(opts.dataDir, "models", MODEL_DIR_SLUG);
    configureOrtOnce();
  }

  /** Eagerly load-from-cache (or download, iff AGENTIC_EMBED_AUTODOWNLOAD=1) in the
   *  background. Single-flight: concurrent calls share the same in-flight attempt.
   *  Never throws. */
  async warmup(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.doWarmup();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async doWarmup(): Promise<void> {
    if (this.ready) return; // early-exit: a prior warmup already built the session (backlog §D-post)
    try {
      const tokenizerPath = join(this.modelDir, FILES.tokenizer);
      const modelPath = join(this.modelDir, FILES.model);
      const present = existsSync(tokenizerPath) && existsSync(modelPath);
      if (!present && process.env["AGENTIC_EMBED_AUTODOWNLOAD"] === "1") {
        await this.downloadModelFiles(tokenizerPath, modelPath);
      }
      await this.loadFromDisk(tokenizerPath, modelPath);
      this.ready = true;
    } catch (err) {
      console.error(
        `[embedding] local-wasm model unavailable (${err instanceof Error ? err.message : String(err)}); degrading to lexical-only`,
      );
      this.ready = false;
    }
  }

  private async loadFromDisk(tokenizerPath: string, modelPath: string): Promise<void> {
    this.tokenizer = await XlmRobertaTokenizer.fromFile(tokenizerPath);
    this.session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
  }

  /** Download one file to `.part` then rename — a crash mid-download can never leave a
   *  half-file that a later run misreads as present. */
  private async downloadOne(url: string, destPath: string): Promise<void> {
    const partPath = `${destPath}.part`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(partPath, bytes);
    renameSync(partPath, destPath);
  }

  private async downloadModelFiles(tokenizerPath: string, modelPath: string): Promise<void> {
    mkdirSync(this.modelDir, { recursive: true });
    mkdirSync(dirname(modelPath), { recursive: true });
    await this.downloadOne(`${HF_BASE}/${FILES.tokenizer}`, tokenizerPath);
    await this.downloadOne(`${HF_BASE}/${FILES.model}`, modelPath);
  }

  /** Lazy load-from-cache-ONLY path used by embed() when warmup() hasn't (yet) run —
   *  NEVER downloads, regardless of AGENTIC_EMBED_AUTODOWNLOAD. Never throws. */
  private async loadFromCacheIfPresent(): Promise<void> {
    if (this.ready) return;
    try {
      const tokenizerPath = join(this.modelDir, FILES.tokenizer);
      const modelPath = join(this.modelDir, FILES.model);
      if (!existsSync(tokenizerPath) || !existsSync(modelPath)) return;
      await this.loadFromDisk(tokenizerPath, modelPath);
      this.ready = true;
    } catch (err) {
      console.error(
        `[embedding] local-wasm lazy cache-load failed (${err instanceof Error ? err.message : String(err)}); degrading to lexical-only`,
      );
      this.ready = false;
    }
  }

  /**
   * e5 uses asymmetric prefixes — `"passage: "` for corpus (applied here; chunk-03 only
   * embeds corpus) and `"query: "` for search queries. The frozen port `embed(texts)`
   * carries no role, so chunk-04's query-side embedding owns the query-prefix decision
   * (options for chunk-04: a role-carrying internal method distinct from the port's
   * `embed`, or accepting the symmetric-prefix quality delta — e5 is robust to mild
   * prefix mismatch). Chunk-03 deliberately does NOT widen the port.
   */
  async embed(texts: string[]): Promise<Float32Array[] | null> {
    try {
      if (!this.ready) {
        // reviewer MINOR fix: if a warmup() is already in flight (e.g. the daemon's
        // fire-and-forget startup warmup racing the startup-kick drain's embed() call on a
        // cached-model first boot), await THAT instead of also starting a second, redundant
        // loadFromCacheIfPresent() — avoids two concurrent InferenceSession.create/tokenizer
        // loads against the same modelDir.
        if (this.loading) await this.loading;
        else await this.loadFromCacheIfPresent();
      }
      if (!this.ready || !this.session || !this.tokenizer) {
        if (!this.loggedUnavailable) {
          this.loggedUnavailable = true;
          console.error("[embedding] local-wasm model not available; degrading to lexical-only");
        }
        return null;
      }
      const vectors: Float32Array[] = [];
      for (const text of texts) vectors.push(await this.embedOne(text));
      return vectors;
    } catch (err) {
      console.error(
        `[embedding] local-wasm embed failed (${err instanceof Error ? err.message : String(err)}); degrading to lexical-only`,
      );
      return null;
    }
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const session = this.session!;
    const tokenizer = this.tokenizer!;
    const { inputIds, attentionMask } = tokenizer.encode(DOC_PREFIX + text);
    const seqLen = inputIds.length;

    const inputIdsTensor = new ort.Tensor("int64", BigInt64Array.from(inputIds.map((x) => BigInt(x))), [1, seqLen]);
    const attentionMaskTensor = new ort.Tensor("int64", BigInt64Array.from(attentionMask.map((x) => BigInt(x))), [1, seqLen]);
    const tokenTypeIdsTensor = new ort.Tensor("int64", new BigInt64Array(seqLen).fill(0n), [1, seqLen]);

    const results = await session.run({
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
      token_type_ids: tokenTypeIdsTensor,
    });
    const lastHidden = results["last_hidden_state"]!;
    const [, sl, hidden] = lastHidden.dims as [number, number, number];
    const data = lastHidden.data as Float32Array;

    // Mean-pool over the seq axis, weighted by attention_mask (padding excluded).
    const pooled = new Float32Array(hidden);
    let count = 0;
    for (let t = 0; t < sl; t++) {
      if (!attentionMask[t]) continue;
      count += 1;
      for (let h = 0; h < hidden; h++) pooled[h] = pooled[h]! + data[t * hidden + h]!;
    }
    for (let h = 0; h < hidden; h++) pooled[h] = pooled[h]! / (count || 1);

    // L2-normalize.
    let normSq = 0;
    for (let h = 0; h < hidden; h++) normSq += pooled[h]! * pooled[h]!;
    const norm = Math.sqrt(normSq) || 1;
    for (let h = 0; h < hidden; h++) pooled[h] = pooled[h]! / norm;

    return pooled;
  }
}
