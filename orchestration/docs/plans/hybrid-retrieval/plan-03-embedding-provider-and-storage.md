# Chunk hybrid-retrieval/03 — EmbeddingProvider port + vector/archive-lexical storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax. **Task 1 is a BLOCKING spike gate — do not write any product code until it is green.** All test-cycle steps follow `superpowers:test-driven-development`: red → green → commit.

**Goal:** Introduce a swappable `EmbeddingProvider` plane (default local-WASM adapter via `onnxruntime-web`, plus a deterministic fixture provider), additive vector + archive-lexical SQLite storage (`fact_embeddings`, `message_embeddings`, `message_fts`), and a stateless restart-safe write-time embedding drain — such that "vectors exist and are queryable raw," with lexical-only graceful degrade when no provider/model is present. The ranker/fusion, `memory_search`, and the golden-set eval are OUT of scope (chunks 04/05/06).

**Architecture:** Daemon-side only. The store keeps its "stores+matches, never computes" contract — all embedding computation lives in the new `embedding/` module; the store gains raw vector storage/read SQL + a write-observer hook. "Pending = a query" (a row lacking a current-`model_id` vector), so the drain is restart-safe by construction with no persisted queue. Egress posture (ADR-0017): local-first WASM default, no hosted lane built, `null`/absent provider never throws and degrades every consumer to lexical-only.

**Tech Stack:** TypeScript on Bun 1.3.x, `bun:sqlite` (single connection, owned by `MemoryStore`), `onnxruntime-web@1.27.0` (pure-WASM inference, spike-proven), a pure-JS tokenizer (candidate `@lenml/tokenizers`, spike-gated in Task 1), model `Xenova/multilingual-e5-small` (int8 quantized ONNX, dims=384, XLM-RoBERTa tokenizer, MIT license).

## Global Constraints

- **Docs are truth.** Spec `orchestration/docs/specs/2026-07-13-hybrid-retrieval.md` §3.2 (D2) + §3.3 (D3) is the frozen design; ADR-0017 (accepted 2026-07-14) is binding. Do NOT re-derive spike outcomes — Lane A (direct `onnxruntime-web`, transformers.js abandoned) is ruled (`.conveyor/bus/a/018-wasm-spike-fail.md`).
- **Frozen surfaces — byte-unchanged.** `@agentic/protocol` (`packages/protocol/`) and the mock reducer (`packages/daemon/src/mock-agent.ts`, `packages/daemon/src/providers/mock-provider.ts`). This chunk touches none of them; verified by byte-diff at PR time.
- **No native addon.** `onnxruntime-node` is FORBIDDEN (gotcha #46). Do NOT add it, transformers.js, `sqlite-vec`, or any ANN/extension dependency. New runtime deps allowed for this chunk = `onnxruntime-web@1.27.0` + the Task-1-chosen tokenizer ONLY, added to `packages/daemon/package.json` (never root). These are pre-authorized by ADR-0017 decision 2 (the local-WASM lane) + q#018 Lane A — no new ADR.
- **No `process.release.name` spoofing / runtime-metadata faking in product code.** If any hack is needed even to *test* viability, that is a STOP-and-escalate finding, not a foundation.
- **`EmbeddingProvider.embed()` NEVER throws** — `null` = unavailable. Absent/failed provider ⇒ `null` ⇒ every consumer degrades to lexical-only. Availability never depends on the embedding lane; only retrieval quality does.
- **Additive schema only:** `CREATE TABLE/VIRTUAL TABLE/TRIGGER IF NOT EXISTS`; no `ALTER`, no edit to the existing `trg_distilled_facts_ad` trigger.
- **CI reality:** the full suite MUST be green with NO embedding provider / no model present. CI must NEVER download the model. Model acquisition is explicit (backfill script) or opt-in (`AGENTIC_EMBED_AUTODOWNLOAD=1`).
- **Commands:** tests `bun test <path>`; typecheck `bun run typecheck`; lint `bun run lint:strict` (0 warnings). Commit per task with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `chunk/hybrid-03-embedding-provider-and-storage`; never commit on `main`.

---

## Reality check (§6.1 — anchors re-validated against current source; chunks 01/02 landed)

Chunk 01 (message-edit removal + flake fix) and chunk 02 (`forgotten_facts` canonical axis) are already merged to `main`. Every spec anchor below was re-read; drift is recorded. **Nothing here is a runtime behavioral assertion — all runtime facts are marked as requiring the Task-1 spike / an executed run to confirm.**

**Store/schema/write-gate anchors (spec value → current value):**
- `memory-provider-selector.ts:51-73` → **still `:51-73`** (`buildMemoryProvider`). House pattern to mirror: static `REGISTRY` Map for zero-arg providers, env selection with a default, loud `console.error` + fallback, never throws.
- `store.ts:26-28` "stores+matches, never computes" comment → **still `:26-28`**. Load-bearing: the store must not compute embeddings.
- `store.ts` SCHEMA_DDL exec → spec said `:182`, **now `store.ts:185`** (`this.db.exec(SCHEMA_DDL)`); constructor spans `:179-187`; `ensureForgottenFactsCanonicalColumn()` already called at `:186`.
- `appendMessages` → spec said `:211-238`, **now `store.ts:215-242`**; its tx spans `:222-239` (message `INSERT` at `:225`); this is the single archive write path.
- Fact-write / `writeFactDerived` call sites → spec said `:930/961/995/1018`, **now:** `insertFact` `:979-990` (writeFactDerived `:986`); `updateFactById` `:1007-1021` (REPLACE; writeFactDerived `:1017`, deletes fact_fts/fact_topics `:1015-1016`); `editFactById` `:1037-1055` (human REPLACE; writeFactDerived `:1051`); `appendToFactById` `:1066+` (canonical UPDATE `:1074`). `writeFactDerived` helper `:1379-1384`.
- `dropDistilledFactsByProvenance` `:730-733`; `dropDistilledFactsForThread` `:737-741`.
- `deleteFactById` `:1194-1197`; existing `trg_distilled_facts_ad` at `schema.ts:127-132` (do NOT edit).
- `write-gate.ts:98-99` (the `dropDistilledFactsByProvenance` / `dropDistilledFactsForThread` sweep inside `forget()`) → **still `:98-99`**; `forget()`'s scrub tx spans `:79-85`. This is the Ruling-2 doc-comment target.
- `store.ts:363-372` `readForgottenFacts` (chunk-01/R3 territory) → now `:377`; `fetchCandidates` (chunk-04) now `:1221`; `retrieve` (out of scope). **None touched by chunk-03.**
- `schema.ts:92-101` `forgotten_facts` → the `canonical` column is already present (`:96`) from chunk-02. **Not touched by chunk-03.**

**Daemon wiring:** `startDaemon(port?, provider?, memoryProvider?)` at `packages/daemon/src/index.ts:70`; store constructed `:72`, gate `:74`, `buildMemoryProvider()` `:86`, `registerDistiller`/`whenIdle` `:88`. `startDaemon` already uses optional injection seams (`provider?`, `memoryProvider?`) — we add a 4th, `embeddingProvider?`, in the same style. `store.rawDb()` exists (used at `write-gate.ts:72`, `migrate-distiller-v2.ts:46`) — the single DB connection.

**Scripts posture:** `packages/daemon/scripts/migrate-distiller-v2.ts` is the template for the backfill script (explicit, `import.meta.main` guard, `--data-dir`, `console.log` progress, exit codes, "existing+typechecking is NOT evidence — the executed run's stdout in the PR is").

**Confirmed model/tokenizer/license facts (from primary sources this pass; the license quote must be RE-CONFIRMED at build per DoD):**
- `Xenova/multilingual-e5-small` HF repo ships `tokenizer.json` (17.1 MB), `tokenizer_config.json` (declares `tokenizer_class: "XLMRobertaTokenizer"`, `model_max_length: 512`), `sentencepiece.bpe.model`, and an `onnx/` dir with the quantized model.
- `intfloat/multilingual-e5-small` (base model) frontmatter declares `license: mit` (single-declaring-party caveat stands — re-quote at build).
- `@lenml/tokenizers` = "lightweight no-dependency fork from transformers.js (only tokenizers)"; zero runtime deps; loads a HF `tokenizer.json` via `TokenizerLoader.fromPreTrained(jsonObject)` / `fromPreTrainedUrls(...)`. This is literally the transformers.js tokenizer carved away from `onnxruntime-node` — the strongest primary candidate. **Requires the Task-1 spike to confirm it runs on Bun and produces correct ids end-to-end.**

**Runtime facts requiring the spike to confirm (NOT asserted here):** that `onnxruntime-web@1.27.0` embeds end-to-end on the build machine's Bun; that the chosen tokenizer loads `tokenizer.json` and tokenizes UA+EN on Bun with no native addon; that `ort.env.wasm.wasmPaths` + `numThreads=1` resolve correctly in-process; the current status of `oven-sh/bun#30431` and the installed Bun version.

## ADR worthy: no

ADR-0017 (accepted 2026-07-14) already fixes the `EmbeddingProvider` plane, the local-first WASM default lane, the egress posture, and the stamped vector lifecycle — this chunk *executes* it. The Lane-A substitution (direct `onnxruntime-web` + a manual tokenizer, replacing the falsified transformers.js assumption) is within the already-accepted local-WASM lane and was explicitly ruled by Lior in q#018 with a "one-line §0.1 implementation note, no spec/ADR change" instruction. The tokenizer choice is an internal implementation detail of the `local-wasm` adapter behind a swappable seam — not an architectural boundary; the two new runtime deps are pre-authorized by ADR-0017 decision 2 + the chunk brief. **No new ADR.** (If the Task-1 spike is BLOCKED — no pure-JS/WASM tokenizer runs on Bun — that is a re-escalation to Lior per q#018, not an ADR.)

---

## File structure

**New (`packages/daemon/src/memory/embedding/`):**
- `embedding-provider.ts` — the port interface + Voyage/Ollama documented adapter-shape doc-comments.
- `vector-codec.ts` — Float32 ↔ little-endian BLOB encode/decode.
- `fixture-embedding-provider.ts` — deterministic vectors; the port's 2nd impl, used by every CI test; includes the `onEmbed` interleave hook.
- `local-wasm-embedding-provider.ts` — the default lane (onnxruntime-web + tokenizer seam + mean-pool + L2-norm + cache/download/warmup).
- `tokenizer.ts` — the swappable tokenizer seam (wraps the Task-1-chosen lib; model-family assumption explicit).
- `embedding-provider-selector.ts` — `buildEmbeddingProvider()` (registry + `EMBEDDING_PROVIDER` env + degrade).
- `embedding-drain.ts` — the stateless restart-safe drain.
- Tests: `vector-codec.test.ts`, `fixture-embedding-provider.test.ts`, `embedding-provider-selector.test.ts`, `embedding-drain.test.ts`, `embedding-storage.test.ts`.

**Modified:**
- `packages/daemon/src/memory/schema.ts` — 3 additive tables + 1 new AFTER DELETE trigger.
- `packages/daemon/src/memory/store.ts` — write-observer hook; `message_fts` sync write in `appendMessages`; stale-vector delete inside the 3 REPLACE-ish fact txns; new vector/fts SQL methods.
- `packages/daemon/src/memory/write-gate.ts` — scrub-tx cleanup of `message_embeddings`+`message_fts`; the Ruling-2 doc-comment flag at `:98-99`.
- `packages/daemon/src/index.ts` — `embeddingProvider?` seam + drain wiring + startup kick + guarded warmup.
- `packages/daemon/package.json` — add the two pinned deps.

**New script:** `packages/daemon/scripts/backfill-embeddings.ts` (+ `backfill-embeddings.test.ts`) and an optional manual `packages/daemon/scripts/embed-probe.ts` (spike reproduction / dogfood smoke, not a CI test).

---

## Steps

### Task 1: Tokenizer + WASM inference spike-gate (BLOCKING — scratchpad only, no product code)

**Files:** scratchpad only — `/private/tmp/claude-501/.../scratchpad/spike/` (a throwaway Bun project). Nothing committed to the repo in this task except, on success, the PR-evidence notes captured for Task 7.

**Goal of the gate:** prove that on the build machine's Bun, a **pure-JS/WASM tokenizer** produces correct `input_ids` for a Ukrainian AND an English string, and that those ids fed into a real `onnxruntime-web` `InferenceSession` produce a `[1, seq, 384]` output — with NO `onnxruntime-node` / native addon loaded. If this cannot be done cleanly, the chunk is BLOCKED (re-escalate; Lior pre-authorized no fallback).

- [ ] **Step 1.1 — Record environment facts.** In scratchpad, capture: `bun --version`; the current status of GitHub issue `oven-sh/bun#30431` (open/closed? — use `gh issue view oven-sh/bun#30431` or WebFetch); and confirm `onnxruntime-node` is NOT installed anywhere in the daemon dep tree. Save this text — it is Task 7 PR evidence.

- [ ] **Step 1.2 — Scaffold the spike.** `cd` to a scratchpad dir; `bun init -y`; `bun add onnxruntime-web@1.27.0` and the primary tokenizer candidate `bun add @lenml/tokenizers`. Download the two model artifacts once into the scratch dir:
  - `tokenizer.json` from `https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json`
  - `model_quantized.onnx` from `https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx`

- [ ] **Step 1.3 — Tokenizer viability.** Write `spike-tok.ts`: load `tokenizer.json` via `TokenizerLoader.fromPreTrained(JSON.parse(readFileSync("tokenizer.json")))`; tokenize `"passage: мій улюблений колір синій"` and `"passage: my favorite color is blue"`; print the `input_ids` + `attention_mask` arrays and their lengths. Run `bun run spike-tok.ts`. **Expected:** two non-empty id arrays, each starting with the XLM-R BOS id (`0` = `<s>`) and ending with EOS (`2` = `</s>`), with distinct ids for the two languages, and **no DYLD assert / native-addon crash**. If `@lenml/tokenizers` fails to run on Bun, try the fallback candidate (a WASM build of HF `tokenizers`, or driving `sentencepiece.bpe.model` through a pure-JS Unigram) — evaluate via WebFetch, time-box it. If NO pure-JS/WASM tokenizer runs cleanly → **STOP: post BLOCKED with the measured failure (which lib, which Bun/OS, the exact error), bus-escalate; do not proceed.**

- [ ] **Step 1.4 — End-to-end inference.** Write `spike-embed.ts`: set `ort.env.wasm.wasmPaths` to the ABSOLUTE path of the installed `node_modules/onnxruntime-web/dist/` (resolve via `import.meta.resolve("onnxruntime-web")` → `fileURLToPath` → `dirname`); set `ort.env.wasm.numThreads = 1`; create the session from `model_quantized.onnx` with `{ executionProviders: ["wasm"] }`; build the three inputs — `input_ids` and `attention_mask` from the tokenizer (as `BigInt64Array` ort.Tensors of shape `[1, seq]`), `token_type_ids` as an all-zeros tensor of the same shape; run; print `results.last_hidden_state.dims`. Run `bun run spike-embed.ts`. **Expected:** dims `[1, <seq>, 384]`, printed. Assert no native addon: confirm `onnxruntime-node` is absent from the resolved module graph (grep the scratch `node_modules`; on Bun `process.moduleLoadList` may be unavailable — the definitive assert is that `onnxruntime-node` is neither installed nor importable, since `onnxruntime-web` has zero dependency on it). Capture stdout — Task 7 PR evidence.

- [ ] **Step 1.5 — Mean-pool + L2 sanity.** In `spike-embed.ts`, add mean-pooling over the seq axis weighted by `attention_mask`, then L2-normalize the 384-vector; print the vector norm (must be ≈ 1.0) and the cosine between the UA and EN "blue" sentences (expected clearly positive, e.g. > 0.7 — a soft sanity check, not a gate; the golden set in chunk-04 is the real bar). Record the printed values.

- [ ] **Step 1.6 — Gate decision.** If Steps 1.3–1.4 are green: record "SPIKE PASS" with the chosen tokenizer lib + version, the resolved `wasmPaths` strategy, and all captured stdout, then proceed to Task 2. If any step required a `process.release.name` (or similar) spoof even to run: STOP and report it as a finding. If BLOCKED: stop the chunk and escalate.

**Verification:** the spike scripts run to completion on the build machine's Bun with the expected outputs above; evidence captured for the PR. (No commit — scratchpad only.)

> **✅ RESULT — TASK-1 PASS (2026-07-14).** Full local-WASM pipeline proven end-to-end on Bun 1.3.4.
> - Tokenizer = **`@lenml/tokenizers@3.7.2`** (pure-TS, zero runtime deps, no ONNX). API: `TokenizerLoader.fromPreTrained({ tokenizerJSON, tokenizerConfig: {} })` → `tokenizer(text)` → `{input_ids, attention_mask}`. UA + EN both start BOS `0` / end EOS `2`, distinct per-language ids.
> - Inference = `onnxruntime-web@1.27.0`; real ids → session → `last_hidden_state [1,seq,384]` → mean-pool + L2-norm; norms ≈ 1.0; **UA↔EN cosine = 0.855** (soft sanity — the cross-language signal the feature exists for; golden set is chunk-04's real bar).
> - Zero native onnx addon (DYLD-proven). #46 (`oven-sh/bun#30431`) still OPEN (2026-05-13). Model license MIT (`intfloat/multilingual-e5-small` primary card; single-source caveat).
> - `wasmPaths` for product code: resolve via `import.meta.resolve("onnxruntime-web")` (NOT a script-relative URL) + `ort.env.wasm.numThreads = 1`.
> - Raw evidence captured for the PR (Task 7). Steps 1.1–1.6 all green.

---

### Task 2: Dependencies, the port, the codec, the fixture provider, the selector

**Files:**
- Modify: `packages/daemon/package.json`
- Create: `packages/daemon/src/memory/embedding/embedding-provider.ts`
- Create: `packages/daemon/src/memory/embedding/vector-codec.ts` + `vector-codec.test.ts`
- Create: `packages/daemon/src/memory/embedding/fixture-embedding-provider.ts` + `fixture-embedding-provider.test.ts`
- Create: `packages/daemon/src/memory/embedding/embedding-provider-selector.ts` + `embedding-provider-selector.test.ts`

**Interfaces produced (later tasks rely on these exact names/types):**
```ts
// embedding-provider.ts
export interface EmbeddingProvider {
  readonly id: string;        // "local-wasm" | "fixture" | (future) "voyage" | "ollama"
  readonly modelId: string;   // stamped on every vector row — the swap-detection key
  readonly dims: number;
  embed(texts: string[]): Promise<Float32Array[] | null>; // null = unavailable; NEVER throws
  /** OPTIONAL lifecycle hook: eagerly load/download the model in the background
   *  (production daemon startup). Absent on providers that need no warmup
   *  (fixture, hosted). Never throws. Not part of the consumer contract — only
   *  embed() is consumed by the ranker/drain/search. */
  warmup?(): Promise<void>;
}

// vector-codec.ts
export function encodeVector(v: Float32Array): Uint8Array;         // little-endian
export function decodeVector(bytes: Uint8Array, dims: number): Float32Array;

// fixture-embedding-provider.ts
export class FixtureEmbeddingProvider implements EmbeddingProvider {
  constructor(opts?: { dims?: number; modelId?: string; onEmbed?: (texts: string[]) => void });
}

// embedding-provider-selector.ts
export function buildEmbeddingProvider(opts?: { dataDir?: string }): EmbeddingProvider | null;
```

- [ ] **Step 2.1 — Add pinned deps.** Add to `packages/daemon/package.json` `dependencies`: `"onnxruntime-web": "1.27.0"` (exact, no caret) and the Task-1-chosen tokenizer at the version the spike validated (e.g. `"@lenml/tokenizers": "<pinned>"`). Run `bun install`. Confirm `onnxruntime-node`, transformers.js, and `sqlite-vec` are absent. Commit.

- [ ] **Step 2.2 — Write the port + doc-comments.** Create `embedding-provider.ts` with the `EmbeddingProvider` interface above. Below it, add a doc-comment block documenting the two NOT-BUILT adapter shapes (spec D2d), verbatim enough that a fast-follow chunk needs no re-design:
  - **Voyage (hosted, opt-in-only):** `POST https://api.voyageai.com/v1/embeddings` with `{ input: texts, model: "voyage-multilingual-2" }`; API key resolved via the existing Keychain secret pattern (mirror `resolveAnthropicKey` in `../secrets/cloud-secrets.ts`); `modelId = "voyage-multilingual-2"`, `dims = 1024`; egress-gated — never default, selecting it is the informed-consent line (ADR-0017 decision 2).
  - **Ollama (local sidecar, opt-in):** `POST http://127.0.0.1:11434/api/embeddings` with `{ model, prompt }`; documented pattern only; never default (zero-infra posture).

- [ ] **Step 2.3 — Codec (TDD).** Write `vector-codec.test.ts` first: round-trip `encodeVector`/`decodeVector` for a known `Float32Array([1, -0.5, 0, 3.25])` → assert byte length `= 4 * len`, assert decode with the correct dims returns bit-equal floats, assert first 4 bytes are little-endian for a known value. Run it → RED. Implement `vector-codec.ts` with `DataView.setFloat32(offset, v, /*littleEndian=*/true)` / `getFloat32(..., true)`; `decodeVector` takes `dims` and reads exactly `dims` floats. Run → GREEN. Commit.

- [ ] **Step 2.4 — Fixture provider (TDD).** Write `fixture-embedding-provider.test.ts` first: `embed(["a","b"])` returns 2 vectors of length `dims`; the SAME text yields a bit-identical vector across two calls (determinism); different texts yield different vectors; each vector is L2-normalized (norm ≈ 1); `onEmbed` is invoked with the texts (interleave hook). Run → RED. Implement: deterministic per-text vector from a hash-seeded PRNG (e.g. FNV-1a hash of the text → seed a small xorshift → fill `dims` floats in [-1,1]), then L2-normalize; default `dims = 8`, default `modelId = "fixture-v1"`, `id = "fixture"`; call `opts.onEmbed?.(texts)` at the top of `embed`. Run → GREEN. Commit.

- [ ] **Step 2.5 — Selector (TDD).** Write `embedding-provider-selector.test.ts` first (set/restore `process.env.EMBEDDING_PROVIDER` per case): `"fixture"` → a `FixtureEmbeddingProvider`; `"none"` → `null`; an unknown id → `null` + a `console.error` (spy); unset env → a provider with `id === "local-wasm"` (construction only — no I/O, no download). Run → RED. Implement `buildEmbeddingProvider`: read `process.env["EMBEDDING_PROVIDER"] ?? "local-wasm"`; `switch`: `"local-wasm"` → `new LocalWasmEmbeddingProvider({ dataDir })` (import the class from Task 3 — write Task 3 first if executing strictly TDD, or stub-then-fill; the selector test for the local-wasm case only checks `id`, which is a cheap constant), `"fixture"` → `new FixtureEmbeddingProvider()`, `"none"` → `null`, default → `console.error("[embedding] Unknown EMBEDDING_PROVIDER=... — embeddings disabled (lexical-only)")` + `null`. Never throws. Run → GREEN. Commit.

**Verification:** `bun test packages/daemon/src/memory/embedding/` green for the three new suites; `bun run typecheck` + `bun run lint:strict` clean.

> **Note for execution order:** Task 3 defines `LocalWasmEmbeddingProvider`, which Task 2.5's `"local-wasm"` branch imports. If using strict per-task TDD, implement Task 3's class skeleton (constructor + `id`) before wiring Task 2.5's branch, or land Task 3 first and Task 2.5's local-wasm branch after. The plan lists Task 2 first for narrative flow; the worker may reorder 2.5↔3 freely.

---

### Task 3: The local-WASM adapter (default lane)

**Files:**
- Create: `packages/daemon/src/memory/embedding/tokenizer.ts`
- Create: `packages/daemon/src/memory/embedding/local-wasm-embedding-provider.ts`
- (No CI unit test — this needs the model; it is proven by the Task-1 spike and, downstream, chunk-04's executed golden-eval. Add the optional manual `scripts/embed-probe.ts` reproduction here.)

**Interfaces produced:**
```ts
// tokenizer.ts — the swappable seam; model-family assumption explicit
export interface WordPieceIds { inputIds: number[]; attentionMask: number[]; }
export class XlmRobertaTokenizer {  // wraps the Task-1 lib; name states the family
  static async fromFile(tokenizerJsonPath: string): Promise<XlmRobertaTokenizer>;
  encode(text: string): WordPieceIds;   // caller pre-applies the "passage:"/"query:" prefix
}

// local-wasm-embedding-provider.ts
export class LocalWasmEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-wasm";
  readonly modelId = "Xenova/multilingual-e5-small";
  readonly dims = 384;
  constructor(opts: { dataDir: string });
  warmup(): Promise<void>;                       // load-from-cache; download only if AGENTIC_EMBED_AUTODOWNLOAD=1
  embed(texts: string[]): Promise<Float32Array[] | null>;
}
```

**Constants (define at top of the adapter):**
```ts
const MODEL_ID = "Xenova/multilingual-e5-small";
const MODEL_DIR_SLUG = "multilingual-e5-small";
const DIMS = 384;
const HF_BASE = "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main";
const FILES = { tokenizer: "tokenizer.json", model: "onnx/model_quantized.onnx" };
const DOC_PREFIX = "passage: "; // e5 corpus-side convention (see the query-prefix note below)
```

- [ ] **Step 3.1 — Tokenizer seam.** Implement `tokenizer.ts` wrapping the Task-1 lib. `fromFile` reads the `tokenizer.json` and constructs via `TokenizerLoader.fromPreTrained(...)`. `encode(text)` returns `{ inputIds, attentionMask }` (numbers). Add a top-of-file doc-comment: "Model-family assumption: XLM-RoBERTa (SentencePiece Unigram), the tokenizer for multilingual-e5-small. Swap the lib here only; the port and adapter above are family-agnostic. Chosen lib + version: <from Task 1>." Never let a tokenizer error escape as a throw to `embed()` — `embed` wraps it (Step 3.4).

- [ ] **Step 3.2 — Adapter construction + `wasmPaths`.** Implement the constructor: store `modelDir = join(opts.dataDir, "models", MODEL_DIR_SLUG)`; set `id/modelId/dims`; do NOT touch the filesystem or network. Configure ort once (module-load or first-use, idempotent): `ort.env.wasm.wasmPaths = <abs dist path>` (resolve `onnxruntime-web`'s `dist/` via `import.meta.resolve` → `fileURLToPath` → `dirname` + `/`, using the exact strategy the Task-1 spike proved) and `ort.env.wasm.numThreads = 1`. Keep private nullable fields `session`, `tokenizer`, `ready = false`, `loading?: Promise<void>`.

- [ ] **Step 3.3 — `warmup()` + cache/download.** `warmup()`: single-flight (reuse `this.loading` if in-flight). If both model files exist under `modelDir` → load the session (`ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] })`) + the tokenizer → set `ready = true`. If files are missing → download them from `HF_BASE/<file>` into `modelDir` **only if `process.env["AGENTIC_EMBED_AUTODOWNLOAD"] === "1"`** (write to a `.part` temp then rename, so a crash can't leave a half-file that later reads as present), then load. Wrap everything in try/catch → on any failure log once (`[embedding] local-wasm model unavailable (<reason>); degrading to lexical-only`) and leave `ready = false`. Never throws.

- [ ] **Step 3.4 — `embed()`.** If `!ready`: attempt a lazy **load-from-cache only** (call a private `loadFromCacheIfPresent()` — never downloads); if still not ready → return `null` (with a one-time loud log). Else, for each text: prepend `DOC_PREFIX`; tokenize → `inputIds`/`attentionMask`; build ort tensors `input_ids` (`BigInt64Array`, shape `[1, seq]`), `attention_mask` (same), `token_type_ids` (all-zeros `BigInt64Array`, shape `[1, seq]`); `await session.run({...})`; read `last_hidden_state` (`[1, seq, 384]`); mean-pool over seq weighted by `attentionMask`; L2-normalize → `Float32Array(384)`. Return the array. Batch by iterating texts (single-string sessions are fine at dogfood scale; a true batched tensor is an optional optimization, not required). Wrap the whole body in try/catch → return `null` on any error (NEVER throw).

- [ ] **Step 3.5 — Query-prefix note (do not build).** Add a doc-comment on `embed`: "e5 uses asymmetric prefixes — `\"passage: \"` for corpus (applied here; chunk-03 only embeds corpus) and `\"query: \"` for search queries. The frozen port `embed(texts)` carries no role, so chunk-04's query-side embedding owns the query-prefix decision (options for chunk-04: a role-carrying internal method distinct from the port's `embed`, or accepting the symmetric-prefix quality delta — e5 is robust to mild prefix mismatch). Chunk-03 deliberately does NOT widen the port."

- [ ] **Step 3.6 — Manual probe (optional, not CI).** Create `scripts/embed-probe.ts` (`import.meta.main`, `--data-dir`): builds a `LocalWasmEmbeddingProvider`, `await warmup()` with `AGENTIC_EMBED_AUTODOWNLOAD=1`, embeds one UA + one EN string, prints dims + norm + cross-lang cosine. This reproduces the spike inside product code and is the dogfood smoke; it is NOT a `bun test` file (would download the model). Add a `package.json` script `"embed-probe": "AGENTIC_EMBED_AUTODOWNLOAD=1 bun run scripts/embed-probe.ts"`.

**Verification:** `bun run typecheck` + `bun run lint:strict` clean (the adapter compiles against the real `onnxruntime-web` + tokenizer types). CI does not execute the adapter (no model). Manually run `bun run --cwd packages/daemon embed-probe -- --data-dir <tmp>` once to confirm end-to-end in product code — capture stdout for Task 7. Commit.

---

### Task 4: Storage schema + store SQL methods

**Files:**
- Modify: `packages/daemon/src/memory/schema.ts`
- Modify: `packages/daemon/src/memory/store.ts`
- Create: `packages/daemon/src/memory/embedding/embedding-storage.test.ts`

**Interfaces produced (store methods the drain/backfill/write-gate consume):**
```ts
// store.ts additions
setWriteObserver(fn: () => void): void;                                  // fired AFTER commit at every embeddable write site
pendingFactEmbeddings(modelId: string, limit: number): { id: string; fact: string }[];
pendingMessageEmbeddings(modelId: string, limit: number): { id: string; content: string }[]; // excludes tombstoned/scrubbed
upsertFactEmbedding(factId: string, modelId: string, dims: number, vector: Uint8Array): "written" | "skipped";     // tx re-checks fact exists
upsertMessageEmbedding(messageId: string, modelId: string, dims: number, vector: Uint8Array): "written" | "skipped"; // tx re-checks NOT tombstoned/scrubbed
deleteMessageDerived(messageId: string): void;                           // deletes message_embeddings + message_fts; NO own tx (call inside scrub tx)
readFactVectors(modelId: string): { id: string; vector: Uint8Array; dims: number }[];      // excludes mixed-model rows, logs count
readMessageVectors(modelId: string): { id: string; vector: Uint8Array; dims: number }[];   // excludes mixed-model rows, logs count
backfillMessageFts(): number;                                            // idempotent; inserts missing non-tombstoned message_fts rows; returns inserted count
```

- [ ] **Step 4.1 — Schema tables + trigger.** In `schema.ts` `SCHEMA_DDL`, append (additive, after the existing tables):
```sql
-- hybrid-retrieval chunk-03 (spec §3.3 D3a): vector storage (plain BLOB, brute-force cosine —
-- gotcha #47 honored) + archive lexical leg. model_id stamped per row (ADR-0017 dec.3 — swap = full re-embed).
CREATE TABLE IF NOT EXISTS fact_embeddings (
  fact_id    TEXT PRIMARY KEY,
  model_id   TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message_embeddings (
  message_id TEXT PRIMARY KEY,
  model_id   TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
-- Archive lexical leg (first FTS surface over Cyrillic message content). unicode61 (spec D1b provisional).
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(message_id UNINDEXED, content);
-- Additive SECOND AFTER DELETE trigger on distilled_facts — cleans fact_embeddings.
-- Do NOT edit trg_distilled_facts_ad; SQLite fires both. (Message rows are never row-deleted;
-- message_embeddings/message_fts are cleaned in the scrub tx — see WriteGate.forget.)
CREATE TRIGGER IF NOT EXISTS trg_distilled_facts_ad_embeddings
AFTER DELETE ON distilled_facts
BEGIN
  DELETE FROM fact_embeddings WHERE fact_id = old.id;
END;
```
Update the top-of-file schema doc-comment to name the chunk-03 additions. No `ALTER`; no edit to `trg_distilled_facts_ad`.

- [ ] **Step 4.2 — Write-observer hook + `message_fts` sync write + REPLACE stale-vector delete (TDD-guarded by 4.4/4.5).** In `store.ts`:
  - Add `private writeObserver?: () => void;` + `setWriteObserver(fn){ this.writeObserver = fn; }` + `private notifyWrite(){ this.writeObserver?.(); }`.
  - In `appendMessages`, INSIDE the existing tx (after the `insert.run(...)` per message, `:225`), also `INSERT INTO message_fts (message_id, content) VALUES (?, ?)` for the same `id`/`content` (cheap, no I/O — mirrors `writeFactDerived`). After `tx()` (at `:240`), call `this.notifyWrite()`.
  - In `updateFactById` (`:1007`), `editFactById` (`:1037`), `appendToFactById` (`:1066`): inside each tx, alongside the existing `DELETE FROM fact_fts` / `fact_topics`, add `this.db.query("DELETE FROM fact_embeddings WHERE fact_id = ?").run(id)` (text changed ⇒ stored vector stale ⇒ row becomes pending again). After each `tx()`, call `this.notifyWrite()`.
  - In `insertFact` (`:979`): after `tx()`, call `this.notifyWrite()` (a new fact is pending; no vector to delete).
  - **The observer must be scheduled, not synchronous** — the store just calls `writeObserver()`; the drain's `kick()` (Task 5) does the `setTimeout` debounce, so the drain never runs inside these txns (honors chunk Notes §4.2: enqueue sits after commit, never inside; `bun:sqlite` forbids tx nesting). Add a one-line comment at each `notifyWrite()` site stating this.

- [ ] **Step 4.3 — Pending-scan, upsert-with-re-check, deletes, raw reads, fts backfill.** Add the methods (all SQL in the store — the store owns SQL; the drain only orchestrates):
  - `pendingFactEmbeddings`: `SELECT d.id, d.fact FROM distilled_facts d LEFT JOIN fact_embeddings e ON e.fact_id = d.id AND e.model_id = ? WHERE e.fact_id IS NULL ORDER BY d.rowid LIMIT ?`.
  - `pendingMessageEmbeddings`: `SELECT m.id, m.content FROM messages m LEFT JOIN message_embeddings e ON e.message_id = m.id AND e.model_id = ? WHERE e.message_id IS NULL AND m.content != ? /*REDACTION_MARKER*/ AND NOT EXISTS (SELECT 1 FROM mutations x WHERE x.target_message_id = m.id AND x.kind='tombstone') ORDER BY m.rowid LIMIT ?`.
  - `upsertFactEmbedding`: open a tx; `SELECT 1 FROM distilled_facts WHERE id = ?` — if absent return `"skipped"`; else `INSERT OR REPLACE INTO fact_embeddings (fact_id, model_id, dims, vector, created_at) VALUES (?,?,?,?,?)`; return `"written"`.
  - `upsertMessageEmbedding`: open a tx; `SELECT content FROM messages WHERE id = ?` — if absent → `"skipped"`; if `content === REDACTION_MARKER` → `"skipped"`; `SELECT 1 FROM mutations WHERE target_message_id = ? AND kind='tombstone' LIMIT 1` — if present → `"skipped"`; else `INSERT OR REPLACE INTO message_embeddings (...)`; return `"written"`. **This in-tx re-check is the scrub-race guard (spec [grill #1]) — do not move it outside the tx.**
  - `deleteMessageDerived(messageId)`: `DELETE FROM message_embeddings WHERE message_id = ?; DELETE FROM message_fts WHERE message_id = ?` — NO own tx (documented: "call within an existing tx", used inside `WriteGate.forget`'s scrub tx).
  - `readFactVectors(modelId)` / `readMessageVectors(modelId)`: `SELECT <id>, vector, dims FROM <table> WHERE model_id = ?` (vector cast to `Uint8Array`); before returning, `SELECT COUNT(*) ... WHERE model_id != ?` and if > 0 `console.warn("[embedding] excluding N <table> rows from a different model_id (mixed-model exclusion)")`. (These are the raw reads chunk-04's cosine leg consumes; chunk-03 only provides + tests them.)
  - `backfillMessageFts()`: `INSERT INTO message_fts (message_id, content) SELECT m.id, m.content FROM messages m WHERE m.content != ? AND NOT EXISTS (SELECT 1 FROM mutations x WHERE x.target_message_id = m.id AND x.kind='tombstone') AND NOT EXISTS (SELECT 1 FROM message_fts f WHERE f.message_id = m.id)` — returns the changed row count (`this.db.query(...).run(...).changes`). Idempotent (skips already-indexed + tombstoned/scrubbed).

- [ ] **Step 4.4 — Storage tests (TDD).** Write `embedding-storage.test.ts` (real `MemoryStore` on a tmp dir; fixture provider or direct `encodeVector` for bytes). Cover:
  - **Write-time lifecycle:** append a turn → `message_fts` has the rows synchronously (query it); a distilled fact `insertFact` → it appears in `pendingFactEmbeddings(modelId)`; after `upsertFactEmbedding` it no longer appears; a mixed-model `upsertFactEmbedding("id","other-model",...)` leaves the row still pending for the current model.
  - **REPLACE → pending again:** insert fact, upsert a vector; `updateFactById` (and separately `editFactById`, `appendToFactById`) → the `fact_embeddings` row for that id is gone (stale delete) → the fact is pending again.
  - **Count-invariants (M2 pattern):** after `deleteFactById` / `dropDistilledFactsByProvenance` / `dropDistilledFactsForThread` / `dropAllDistilledFacts` → zero orphan `fact_embeddings` (the new trigger fired). After a `WriteGate.forget` scrub (Task 5 wires `deleteMessageDerived`) → zero orphan `message_embeddings` + `message_fts` for that message. (The scrub-path assertion can be added here after Task 5, or lives in Task 5's suite — cross-reference it.)
  - **In-tx re-check (the RED-without-recheck proof):** insert a message, upsert its embedding once (1 row); scrub it via `WriteGate.forget`; call `upsertMessageEmbedding(id,...)` directly → returns `"skipped"`, and `message_embeddings` has 0 rows for that id. (Confirm this test FAILS if the in-tx tombstone re-check is removed — note that in the test comment.)
  - **Raw reads + mixed-model exclusion:** upsert two vectors under `modelId` "A" and one under "B"; `readFactVectors("A")` returns only the 2, and a `console.warn` spy fired for the excluded 1.
  - **`backfillMessageFts` idempotency:** clear `message_fts` for a store with 3 messages (1 scrubbed) → first call inserts 2, second call inserts 0; the scrubbed message is skipped.
  Run → RED, implement 4.1–4.3 → GREEN. Commit.

**Verification:** `bun test packages/daemon/src/memory/embedding/embedding-storage.test.ts` green; existing `store.test.ts` / distiller suites stay green (`bun test packages/daemon/src/memory/`); typecheck + lint:strict clean.

---

### Task 5: The stateless drain, daemon wiring, scrub cleanup, the Ruling-2 flag

**Files:**
- Create: `packages/daemon/src/memory/embedding/embedding-drain.ts` + `embedding-drain.test.ts`
- Modify: `packages/daemon/src/memory/write-gate.ts`
- Modify: `packages/daemon/src/index.ts`

**Interfaces produced:**
```ts
// embedding-drain.ts
export class EmbeddingDrain {
  constructor(store: MemoryStore, provider: EmbeddingProvider | null,
              opts?: { batchSize?: number; debounceMs?: number });
  kick(): void;                                              // debounced, single-flight; no-op if provider null
  drain(): Promise<{ factsEmbedded: number; messagesEmbedded: number }>; // for tests/backfill: run to completion
}
```

- [ ] **Step 5.1 — Drain (TDD).** Write `embedding-drain.test.ts` first (real store + `FixtureEmbeddingProvider`):
  - **Lexical-only degrade:** `new EmbeddingDrain(store, null)` — `kick()`/`await drain()` are no-ops (no throw; 0 embedded); a fact stays pending. Also assert a `null`-returning fixture (a provider whose `embed` returns `null`) leaves rows pending, no throw.
  - **Happy path:** seed 3 facts + 2 messages; `await drain()` → all 5 embedded (query pending-scans return empty afterwards); `factsEmbedded===3`, `messagesEmbedded===2`.
  - **Scrub-mid-drain interleave (the headline test):** use a `FixtureEmbeddingProvider({ onEmbed })` whose `onEmbed` scrubs a specific message (via `WriteGate.forget`) the FIRST time it is called — simulating the scrub landing between the drain's scan and its upsert. Assert: after `drain()`, the scrubbed message has NO `message_embeddings`/`message_fts` row, while the non-scrubbed message does. (RED without Task 4.3's in-tx re-check.)
  - **Restart-safety:** seed 6 messages; construct a drain with `batchSize: 2` and a fixture that returns vectors for only the first batch then `null` (or stop after one batch); `await drain()` → some rows still pending. Construct a FRESH `EmbeddingDrain` over the SAME store (simulating restart) with a normal fixture; `await drain()` → all remaining rows embedded. (Proves pending-is-a-query.)
  Run → RED. Implement `embedding-drain.ts`:
  - `kick()`: if `provider == null` return; debounce via `setTimeout(this.debounceMs ?? 50)` coalescing multiple kicks into one scheduled `drain()`.
  - `drain()`: single-flight guard (`if (this.running) { this.rerun = true; return; }`); loop: `store.pendingFactEmbeddings(modelId, batchSize)` → if non-empty, `await provider.embed(texts)`; if `null` break (lexical-only); else `store.upsertFactEmbedding(id, modelId, dims, encodeVector(vec))` per row; repeat until a batch returns empty. Then the same for messages via `pendingMessageEmbeddings`/`upsertMessageEmbedding`. On finish, if `this.rerun` clear it and re-drain. Wrap in try/finally to clear `running`. Never throws (catch → log → stop). `modelId`/`dims` come from `provider.modelId`/`provider.dims`.
  Run → GREEN. Commit.

- [ ] **Step 5.2 — Scrub cleanup + Ruling-2 doc-comment (write-gate).** In `write-gate.ts` `forget()`: inside the existing scrub tx (`:79-85`, after the `UPDATE messages SET content = REDACTION_MARKER`), add `this.store.deleteMessageDerived(messageId)` (removes the message's `message_embeddings` + `message_fts` rows atomically with the scrub — spec §0.3/§3.3: scrubbed content unreachable by BOTH legs). Add a doc-comment ABOVE the `dropDistilledFactsByProvenance`/`dropDistilledFactsForThread` calls at `:98-99`:
  ```
  // ⚠️ ADR-0012 rider Ruling 2 (fact source-independence, 2026-07-10) TRAP — flagged for 2e
  // [hybrid-retrieval §4.3, grill #9]: this scrub primitive ALSO sweeps derived facts
  // (dropDistilledFacts* below), which Ruling 2 FORBIDS for source erasure ("source erasure
  // never sweeps facts"). 2d does NOT fix this — no user path calls WriteGate.forget today —
  // but 2e thread-forget CANNOT reuse this primitive unchanged: these fact-sweep calls must be
  // removed/reworked at 2e design time. Doc-comment only; zero behavior change in this chunk.
  ```
  No behavior change beyond the `deleteMessageDerived` call. (Add/extend the count-invariant scrub assertion in `embedding-storage.test.ts` from Task 4.4 now that the wiring exists.) Commit.

- [ ] **Step 5.3 — Daemon wiring.** In `index.ts`: import `buildEmbeddingProvider` + `EmbeddingDrain`. Add a 4th optional param to `startDaemon(port?, provider?, memoryProvider?, embeddingProvider?)`. After the store is built (`:72`):
  ```ts
  const embedding = embeddingProvider ?? buildEmbeddingProvider({ dataDir });
  const embeddingDrain = new EmbeddingDrain(store, embedding);
  store.setWriteObserver(() => embeddingDrain.kick());
  embeddingDrain.kick();                          // startup drain (spec D3b trigger)
  void embedding?.warmup?.();                     // fire-and-forget; downloads only if AGENTIC_EMBED_AUTODOWNLOAD=1
  ```
  Place this near the other memory wiring; keep it above the `registerDistiller` line so a distill-apply write also flows through the observer. Do NOT block startup on warmup. Commit.

**Verification:** `bun test packages/daemon/src/memory/embedding/` green (drain suite incl. scrub-race + restart-safety); `bun test packages/daemon/` green (daemon wiring compiles + existing integration tests unaffected — they inject or omit the provider, so no download); typecheck + lint:strict clean.

---

### Task 6: Backfill script

**Files:**
- Create: `packages/daemon/scripts/backfill-embeddings.ts` + `packages/daemon/scripts/backfill-embeddings.test.ts`
- Modify: `packages/daemon/package.json` (add script `"backfill-embeddings": "AGENTIC_EMBED_AUTODOWNLOAD=1 bun run scripts/backfill-embeddings.ts"`)

**Interface produced:**
```ts
// backfill-embeddings.ts — testable core (mirror migrate-distiller-v2's runMigration shape)
export interface BackfillReport {
  ftsInserted: number; factsEmbedded: number; messagesEmbedded: number;
  factsPendingAfter: number; messagesPendingAfter: number; providerAvailable: boolean;
}
export async function runBackfill(store: MemoryStore, provider: EmbeddingProvider | null,
                                  opts?: { quiet?: boolean }): Promise<BackfillReport>;
```

- [ ] **Step 6.1 — Backfill core (TDD).** Write `backfill-embeddings.test.ts` first (real store + `FixtureEmbeddingProvider`): seed a store with N facts + M messages (1 scrubbed); first `runBackfill` → `ftsInserted` = non-tombstoned message count, `factsEmbedded===N`, `messagesEmbedded===(M-1)`, scrubbed message NOT embedded, pending-after = 0; **second `runBackfill` → all counts 0 (idempotent)**; a `runBackfill(store, null)` → still builds fts (`ftsInserted` > 0), `providerAvailable===false`, 0 embedded (degrade honesty). Run → RED. Implement `runBackfill`: log via a `quiet`-gated logger (mirror `migrate-distiller-v2`); Step A `store.backfillMessageFts()` (sync, idempotent); Step B if `provider` present → `await provider.warmup?.()` then run an `EmbeddingDrain(store, provider).drain()` to completion (reuse the drain — backfill = "drain everything once, synchronously"); collect counts; report `factsPendingAfter`/`messagesPendingAfter` via the pending-scans. Run → GREEN. Commit.

- [ ] **Step 6.2 — CLI entrypoint.** Add the `import.meta.main` block mirroring `migrate-distiller-v2.ts`: parse `--data-dir` (default `~/.agentic-engine`); `console.log` a header; build the store + `buildEmbeddingProvider({ dataDir })`; `await runBackfill`; print the report; `store.close()`; `process.exit(0/1)` on invariant (`factsPendingAfter===0 && messagesPendingAfter===0` when the provider was available, else a clear "lexical-only: fts built, embeddings skipped" message + exit 0). Add the top-of-file doc-block: "ONE-TIME, EXPLICIT, LOGGED, idempotent per model_id, tombstone-honoring — the migrate-distiller-v2 posture. NOT auto-on-startup. STRIKE-5: existing+typechecking is NOT evidence; the executed run's stdout in the PR is." Commit.

**Verification:** `bun test packages/daemon/scripts/backfill-embeddings.test.ts` green (idempotency + tombstone-skip + degrade with fixture — no download). Execute against a throwaway seeded sqlite with the fixture provider and paste stdout for Task 7 (the executed-run evidence; a real-model run is optional and only if the model is cached locally).

---

### Task 7: Verification sweep + PR evidence

**Files:** none (verification + PR authoring).

- [ ] **Step 7.1 — Degrade-green proof.** With NO `EMBEDDING_PROVIDER` env and no model cached, run the full daemon suite: `bun test packages/daemon/`. Expected: fully green; confirm no network/model download occurred (the drain/consumers degraded to lexical-only). Also run `EMBEDDING_PROVIDER=none bun test packages/daemon/src/memory/embedding/` — green.

- [ ] **Step 7.2 — Full gates.** `bun run typecheck` → 0 errors; `bun run lint:strict` → 0 warnings; `bun test` (repo-wide) → green.

- [ ] **Step 7.3 — Frozen byte-diff.** `git diff --stat origin/main -- packages/protocol packages/daemon/src/mock-agent.ts packages/daemon/src/providers/mock-provider.ts` → EMPTY. If non-empty, revert those changes (they are out of scope / forbidden).

- [ ] **Step 7.4 — Assemble PR evidence (mechanical DoD).** In the PR body include, as actually-run command output:
  1. **Spike evidence (Task 1):** installed Bun version; `oven-sh/bun#30431` status quote; the WASM-only embed run output (`[1, seq, 384]`) + the "no `onnxruntime-node` in the dep tree" assertion; the chosen tokenizer lib + version.
  2. **License quote (Task 2/spike):** the `license: mit` line quoted from `intfloat/multilingual-e5-small`'s primary card (with the single-source caveat).
  3. **Lifecycle + count-invariant + scrub-race + restart-safety + mixed-model tests:** the passing `embedding-storage.test.ts` + `embedding-drain.test.ts` output; explicitly note the scrub-race test is RED without the in-tx re-check.
  4. **Backfill:** the executed throwaway-store run showing idempotent second run = 0 new rows + scrubbed-message skip.
  5. **Gates:** typecheck 0 / lint:strict 0 / frozen byte-diff empty.
  6. **Optional:** the `embed-probe` real-model stdout if run locally.
  End the PR body with the standard Claude Code attribution line. Open the PR targeting `main`.

- [ ] **Step 7.5 — Self-review vs spec §3.2/§3.3 + chunk Done criteria.** Walk each Done-criterion checkbox in `03-embedding-provider-and-storage.md` and each of §3.2 D2a–D2e / §3.3 D3a–D3c; confirm a task covers it (or is explicitly out-of-scope: ranker/fusion=chunk-04, `memory_search`=chunk-05, query-prefix=chunk-04, quarantine read-filter=chunk-05). Note the two accepted named residuals in the PR: (a) **fact-REPLACE-mid-drain micro-race** — an in-flight embed of OLD fact text landing after the mutation-tx stale-vector delete could leave a stale (quality-only, never-scrubbed-content) vector until the fact's next write; negligible at single-user dogfood scale (sequential turns, debounced fast drain); self-heals on the next edit/replace; the future fix if ever needed is a content-hash/`derived_at` stamp on the vector row — deliberately not built. (b) **quarantined messages are embedded/indexed** by chunk-03; read-time exclusion of quarantined content is chunk-05's `memory_search` responsibility (spec §3.6) — flagged for chunk-05.

**Verification:** all chunk Done criteria checked; PR open with the evidence above; branch pushed.

---

## Self-review notes (author)

- **Spec coverage:** D2a port+registry+env+degrade → Task 2/5; D2b local-WASM + non-blocking download + null-degrade → Task 3; D2c model constraints + license → Task 1/3/7; D2d fixture 2nd impl + Voyage/Ollama doc-only → Task 2; D2e display-text embedded + `"passage:"` prefix → Task 3 (query-prefix deferred to chunk-04, documented); D3a tables + BLOB + model_id stamp + mixed-model exclusion → Task 4; D3b stateless drain + triggers + kicks + scrub-race guard + REPLACE→pending + graceful-missing → Tasks 4/5; D3c backfill → Task 6. §4 coupling notes (appendMessages↔drain, scrub↔cleanup↔race, no-tx-nesting, degrade-per-consumer) → Tasks 4/5. §5 verification model (real SQLite, fixture-vector CI-determinism, scrub interleave, restart-safety, count-invariants, degrade-green) → Tasks 4/5/6/7.
- **Out-of-scope held:** no ranker/fusion, no `memory_search`, no golden-set eval, no hosted/Ollama adapter build, no persisted queue, no `sqlite-vec`/ANN, no `onnxruntime-node`/transformers.js, no protocol/mock-reducer edits, no edit to `trg_distilled_facts_ad`.
- **No new ADR** — ADR-0017 executes here; Lane-A substitution pre-authorized (q#018).

## Status: executing Phase 2 (orchestrator: engine-orchestrator, chunk hybrid-retrieval/03)

**Progress:**
- ✅ **Task 1** (tokenizer + WASM spike-gate) — PASS 2026-07-14 (`@lenml/tokenizers@3.7.2` + `onnxruntime-web@1.27.0`, UA↔EN cosine 0.855, no native addon).
- ✅ **Tasks 2-4** (deps + port + codec + fixture + selector + local-wasm adapter + storage schema/SQL) — DONE + orchestrator-verified 2026-07-14 (6 commits `e95ac85`→`460bad2`; typecheck 0 · lint:strict 0 · 746 tests pass/0 fail · frozen byte-diff empty). Worker disclosed a TDD-order deviation closed by a targeted per-behavior regression proof; surfaced + fixed an FTS5 `.changes`-inflation bug (→ COUNT(*) diff).
- ✅ **Tasks 5-6** (stateless drain + daemon wiring + scrub cleanup + Ruling-2 flag + backfill script) — DONE + orchestrator-verified 2026-07-14 (2 commits `33aca63`, `7819536`; scrub-race RED-without-recheck re-proven; backfill CLI idempotency executed w/ fixture). Full tree: typecheck 0 · lint:strict 0 · **755 tests pass/0 fail** · frozen byte-diff empty. Worker-flagged residual: drain `kick()` `setTimeout` timers not torn down in daemon-test `afterAll` (harmless, all pass) → handed to reviewer.
- ✅ **engine-reviewer** gate (baseline `main`) — **VERDICT 0 BLOCKER / 0 MAJOR** 2026-07-14. Scrub-race guard + drain concurrency traced + verified correct. Findings: 2 MINOR + 2 NIT.
- ✅ **Reviewer MINOR-fix** — DONE (commits `51a5793`, `845b889`): MINOR #1 = `EmbeddingDrain.stop()` teardown wired into daemon shutdown (wraps `server.stop`) + `EMBEDDING_PROVIDER=none` pinned before all daemon-test boots → latent timer-leak removed + ENOENT/degrade noise gone (0 lines) + the "suite green w/ NO provider" DoD now literally true; MINOR #2 = `embed()` lazy path awaits in-flight `warmup()` (double-load guard). NIT #3 → chunk-04 handoff (throttle `readVectors` warn on model-swap). NIT #4 acknowledged in-code.
- ✅ **Task 7** (verification sweep + PR) — DONE. Orchestrator-independent final gates on tip: typecheck 0 · lint:strict 0 · **757 pass/0 fail** · degrade-noise 0 · frozen byte-diff empty · 10 code commits + 1 docs commit, all `packages/**`+chunk-03 docs (ledger/chunk-04 left to conductor). **PR #99** opened (target `main`), full spike+test+reviewer evidence in the body.
- ➡️ **Ready-to-merge (crawl §11.4)** — NOT self-merged. Conductor re-verifies clean checkout + independent reviewer, then merges. Behavioral DoD (UK↔EN root-fix / search / degrade-live) rides chunk-06 — not claimed here (chunk-03 DoD is entirely mechanical).
