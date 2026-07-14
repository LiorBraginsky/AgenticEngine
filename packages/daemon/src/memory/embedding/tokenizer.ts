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

  /** Tokenize `text` into ids + attention mask. Caller pre-applies the e5 "passage:"/
   *  "query:" prefix — this seam is prefix-agnostic. May throw; the adapter's `embed()`
   *  wraps every call site so a tokenizer error NEVER escapes as a throw to a consumer. */
  encode(text: string): WordPieceIds {
    const encoded = this.tokenizer(text) as { input_ids: number[]; attention_mask: number[] };
    return { inputIds: encoded.input_ids, attentionMask: encoded.attention_mask };
  }
}
