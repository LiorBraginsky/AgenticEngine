import { readFileSync } from "node:fs";
import { TokenizerLoader } from "@lenml/tokenizers";

/**
 * Model-family assumption: XLM-RoBERTa (SentencePiece Unigram) — the tokenizer family for
 * `Xenova/multilingual-e5-small` (hybrid-retrieval spec §3.2 D2c). Swap the underlying lib
 * HERE only; the port (`embedding-provider.ts`) and the adapter above it are family-agnostic.
 *
 * Chosen lib + version: `@lenml/tokenizers@3.7.2` — proven on Bun 1.3.4 by the Task-1 spike
 * (`tokenizer.json` loaded via `TokenizerLoader.fromPreTrained`; produced XLM-R BOS/EOS ids
 * `0`/`2` for both a Ukrainian and an English string, no native addon).
 */

export interface WordPieceIds {
  inputIds: number[];
  attentionMask: number[];
}

/** The tokenizer instance type produced by `TokenizerLoader.fromPreTrained` — inferred
 *  rather than imported by name so this file stays the one place naming the concrete lib. */
type PreTrainedTokenizer = ReturnType<typeof TokenizerLoader.fromPreTrained>;

/**
 * The model's max position count. XLM-RoBERTa / `Xenova/multilingual-e5-small` has 512
 * position embeddings; a longer sequence makes `session.run` throw an ONNX Runtime broadcast
 * error ("512 by <N>") — the live D3 failure this chunk fixes (real archive, 2026-07-16).
 *
 * The model's `tokenizer_config.json` declares `model_max_length: 512`, but this file loads
 * with `tokenizerConfig: {}` (no truncation config reaches the lib), so we cap explicitly here.
 *
 * HONEST TRADEOFF: a text longer than 512 tokens is represented by its FIRST ~512 tokens only.
 * Chunking / windowed-averaging is deliberately OUT (spec §7.2 — this is the minimal starvation
 * fix, not a retrieval-quality feature; revisit only on golden-set-class evidence). The trailing
 * EOS is intentionally not re-appended — mean-pool over the head window is well-defined for e5.
 */
export const MODEL_MAX_POSITIONS = 512;

/** Cap an encoding to the model's max positions (first-N tokens). Pure + exported so the cap
 *  is unit-testable without loading the model (CI has no model files). */
export function truncateEncoding(ids: WordPieceIds, maxPositions = MODEL_MAX_POSITIONS): WordPieceIds {
  if (ids.inputIds.length <= maxPositions) return ids;
  return {
    inputIds: ids.inputIds.slice(0, maxPositions),
    attentionMask: ids.attentionMask.slice(0, maxPositions),
  };
}

export class XlmRobertaTokenizer {
  private constructor(private readonly tokenizer: PreTrainedTokenizer) {}

  /** Load a HF `tokenizer.json` file from disk and construct the wrapped tokenizer.
   *  Callers (the local-wasm adapter) are responsible for catching any throw here —
   *  this method itself may throw (missing/corrupt file, unparseable JSON). */
  static async fromFile(tokenizerJsonPath: string): Promise<XlmRobertaTokenizer> {
    const tokenizerJSON = JSON.parse(readFileSync(tokenizerJsonPath, "utf8"));
    const tokenizer = TokenizerLoader.fromPreTrained({ tokenizerJSON, tokenizerConfig: {} });
    return new XlmRobertaTokenizer(tokenizer);
  }

  /** Tokenize `text` into ids + attention mask, capped to MODEL_MAX_POSITIONS (long texts are
   *  represented by their first ~512 tokens — see truncateEncoding). Caller pre-applies the e5
   *  "passage:"/"query:" prefix. May throw; the adapter's `embed()` wraps every call site. */
  encode(text: string): WordPieceIds {
    const encoded = this.tokenizer(text) as { input_ids: number[]; attention_mask: number[] };
    return truncateEncoding({ inputIds: encoded.input_ids, attentionMask: encoded.attention_mask });
  }
}
