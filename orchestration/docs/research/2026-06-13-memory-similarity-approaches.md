---
title: "Memory similarity approaches: local embeddings vs hosted API vs FTS5 for incremental distiller"
date: 2026-06-13
triggered-by: memory-quality feature (chunk-03 smart distiller / 2d retrieval design seam)
status: research
---

# Memory Similarity Approaches — Research Report

## 1. Decision-Oriented Synthesis

### The question
The smart distiller (`SmartDistillerProvider`, memory-quality spec §3.3) must, on conversation-end,
(a) distill facts from the just-ended session and (b) **find a CONTRADICTING or RELATED existing fact**
among ~hundreds of stored `distilled_facts` rows. The SAME layer must not paint us into a corner for
the planned **2d retrieval feature** (archive search over messages). Three approaches were evaluated:
(A) local embeddings, (B) hosted embedding API, (C) SQLite FTS5 keyword / BM25 search.

### OUR constraints (grounding the evaluation)
- **ADR-0004**: Bun runtime. Code must be runtime-agnostic but Bun is the primary target; macOS
  daemon is the first-class platform.
- **ADR-0011**: No new metered API dependency. Any hosted embedding API reintroduces the cost/auth
  tension ADR-0011 specifically avoids by anchoring the product on subscription-Claude + API-key
  paths. A second metered API is a new class of operational dependency.
- **ADR-0012**: Local-first, zero-infra install. SQLite already in-process. Vector store must not
  require an external service or a user-visible install step.
- **Current scale**: personal/dogfood — hundreds of `distilled_facts` rows, not millions.
- **Specific use in 2b**: find facts that CONTRADICT or RELATE TO a candidate new fact, across a
  bounded set (~50–500 rows). Not a document-archive RAG. Facts are short NL sentences.

---

### Recommendation (evidence-backed — see §2 for sources)

**Recommendation: use FTS5 keyword/BM25 search for the incremental distiller's dedup/contradiction
layer NOW; defer local embeddings to the 2d archive-retrieval feature when that feature is scoped.**

Rationale in order of weight:

1. **FTS5 is already in-process.** The daemon already uses SQLite (`bun:sqlite`). Adding an FTS5
   virtual table on `distilled_facts.fact` is zero-infra: no new dependency, no install step, no
   native addon, no model download. The schema change is purely additive.

2. **At personal scale (~50–500 facts), brute-force FTS5 + BM25 is fast enough.** Brute-force text
   search over a few hundred short rows completes in <1 ms in SQLite on modern hardware. An index is
   not needed at this scale for performance reasons; it is needed for recall quality, which FTS5
   delivers via BM25 ranking and stemming (porter tokenizer).

3. **The semantic gap matters LESS for the specific contradiction-detection use case than it would for
   archive RAG.** Short canonical facts produced by the LLM distiller ("favourite colour: blue")
   are MORE lexically predictable than raw user messages. The LLM distiller can be prompted to
   produce facts in canonical form and to surface synonymic equivalences ("blue" / "cerulean") at
   distill time, moving the synonym burden onto a step that already has an LLM available (the
   distiller call itself). This sidesteps the main FTS5 weakness.

4. **The local embedding option (A) has a confirmed Bun/macOS compatibility risk that is not yet
   fully resolved.** The `onnxruntime-node` native addon is the load-bearing dependency for
   transformers.js on a Node/Bun server backend. It has a tracked history of Bun compatibility
   regressions (issues #3574 and #18079 in oven-sh/bun). The macOS extension-loading constraint
   compounds this: `sqlite-vec` under Bun/macOS requires `Database.setCustomSQLite()` pointing to a
   Homebrew-installed SQLite, which violates the zero-infra install invariant unless bundled. These
   are resolvable but add real integration cost and a surface for future Bun regressions.

5. **The hosted embedding option (B) directly conflicts with ADR-0011.** Anthropic does not offer a
   native embedding endpoint; the recommended third-party is Voyage AI, which is a new metered API
   dependency with personal-data privacy considerations.

6. **FTS5 does not paint us into a corner for 2d.** The recommended path (FTS5 now, embeddings for
   2d) maps exactly to ADR-0012 decision 6: "vector/graph retrieval is a swappable provider, not a
   v1 bet." The 2d archive-retrieval feature can add `sqlite-vec` + a local model at that point,
   when Bun/macOS compatibility has additional maturity and the install complexity is warranted by
   the richer use case.

### Where FTS5 will fail (bounded by design)
FTS5 misses semantic synonyms that the LLM distiller does NOT canonicalize ("likes blue" vs "favourite
colour is cerulean"), and cannot detect numeric contradictions ("3 siblings" vs "2 siblings") unless
those appear as shared tokens. At personal/dogfood scale with LLM-produced canonical facts, these
failure modes are **rare and recoverable**: a missed dedup produces a redundant fact, which the user
can delete via the existing hatch. This is a UX inconvenience, not a correctness-breaking defect.

---

## 2. Evidence Per Option

### Option A: Local Embeddings

#### Which runtime/model is realistic on Bun?

**`@huggingface/transformers` (transformers.js) v4 — DECISION-GRADE with caveats.**

Transformers.js v4 (released after a year of development starting March 2025) explicitly supports Bun
as a server-side runtime. The blog post states: "you can now run WebGPU-accelerated models directly
in Node, Bun, and Deno."
Source: [Transformers.js v4 blog post](https://huggingface.co/blog/transformersjs-v4)

However, the underlying mechanism on a Node/Bun backend is `onnxruntime-node` (a native C++ addon).
This is where the Bun compatibility risk lives:

- **Issue #3574 (oven-sh/bun, July 2023):** `onnxruntime-node` caused a bus error crash on macOS
  arm64 in Bun 0.6.13. Closed (status: fixed at some later version).
  Source: [Bus error issue](https://github.com/oven-sh/bun/issues/3574)

- **Issue #18079 (oven-sh/bun, March 2025):** `onnxruntime-node` FAILS on Windows in Bun 1.2.5
  with corrupted file path encoding. Worked on Bun 1.2.4, failed on 1.2.5. Fix via PR #18107
  (closed). Platform: Windows only; macOS unaffected by this specific regression.
  Source: [onnxruntime-node Bun 1.2.5 failure](https://github.com/oven-sh/bun/issues/18079)

- **Open CVE**: `@huggingface/transformers` v3.x depends on `onnxruntime-node@1.21.0`, which
  depends on a vulnerable `tar` (<7.5.8) — CVE-2026-26960. Any project using v3.x triggers a
  high-severity `bun audit` finding.
  Source: [CVE issue #1550](https://github.com/huggingface/transformers.js/issues/1550)

**Verdict on Bun compat:** Transformers.js v4 is claimed to support Bun, and prior issues appear
fixed per closed issue status. However, `onnxruntime-node` has a documented regression-prone
history in Bun; the fact that a regression appeared as recently as Bun 1.2.5 (March 2025) is a
meaningful signal. This is **DECISION-GRADE (corroborated: two separate tracked regressions
resolved, current v4 claims Bun support)** with a standing caveat: native addons in Bun have an
established regression surface.

#### Model sizes and memory (DECISION-GRADE for sizes; inference speed UNVERIFIED for Bun/macOS daemon context)

- **`Xenova/all-MiniLM-L6-v2` (quantized q8):** ~23 MB download, 384-dimensional vectors.
  Source: [Transformers.js production optimization](https://www.sitepoint.com/optimizing-transformers-js-production/)
- **ONNX model file (non-quantized):** ~90 MB. Source: [HuggingFace model repo](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX)
- **Inference memory:** ~43 MB resident for float16/bf16 precision (single model).
  Source: [HuggingFace model memory requirements discussion](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/discussions/39)
- **Cold-start latency (Node.js, local model, post-download):** ~200 ms on subsequent loads (model
  cached after first download). First-ever load = model download (23 MB quantized) + ONNX graph
  deserialization + WASM JIT warmup. Estimated 2–10 s first start depending on disk I/O.
  **UNVERIFIED: no specific Bun/macOS daemon cold-start benchmark found.** Source: promptfoo docs
  and optimization blog (403'd), inferred from browser-context data.
- **Offline after first download:** yes (models cache to `~/.cache/huggingface` or configurable).
- **Model inference throughput (CPU):** ~14k sentences/sec for all-MiniLM-L6-v2. For 500 short
  facts, batch inference would complete in ~35 ms. **UNVERIFIED specific to Bun/WASM backend.**

#### Vector storage at personal scale

**Brute-force cosine in JS — DECISION-GRADE.**

For 500 vectors at 384 dimensions, brute-force cosine similarity in JavaScript completes in single-
digit milliseconds (well below the <100k vector threshold where indexing becomes worthwhile).
Source: [Simon Willison llm issue on brute-force speed](https://github.com/simonw/llm/issues/246)

A vector index (sqlite-vec or otherwise) is **not needed for performance** at hundreds-of-facts scale.
It becomes beneficial at 10k+ rows for latency-sensitive queries.

**`sqlite-vec` — DECISION-GRADE with macOS/Bun gotcha.**

`sqlite-vec` v0.1.9 (as of March 2026) has explicit Bun support and a `simple-bun` example in the
repo. The official JS docs list `bun:sqlite` as a supported runtime.
Source: [sqlite-vec JS guide](https://alexgarcia.xyz/sqlite-vec/js.html)

**Bun/macOS gotcha (DECISION-GRADE, corroborated by multiple sources):** The default Bun SQLite on
macOS uses Apple's proprietary SQLite build, which does NOT support loading extensions. To use
`sqlite-vec` (or any SQLite extension) under Bun on macOS, the caller MUST:
1. Install Homebrew (`brew install sqlite`)
2. Call `Database.setCustomSQLite('/opt/homebrew/Cellar/sqlite/<version>/libsqlite3.dylib')` before
   ANY `Database` constructor call.

This is documented in the sqlite-vec JS guide, the Bun SQLite docs, and corroborated by the
open GitHub issue requesting native vector search primitives baked into Bun's SQLite build (issue
#26736, opened Feb 2026 — **open, not implemented**).
Sources:
- [Bun SQLite docs](https://bun.com/docs/runtime/sqlite)
- [sqlite-vec JS guide](https://alexgarcia.xyz/sqlite-vec/js.html)
- [Built-in vector search request (open)](https://github.com/oven-sh/bun/issues/26736)

**Impact on zero-infra install:** requiring Homebrew and a hardcoded dylib path violates the
zero-infra install invariant. This is a distribution complexity blocker for sqlite-vec under
Bun/macOS unless workarounds are bundled (e.g., statically compiling the extension into the binary
or shipping a custom SQLite build with the daemon). These are non-trivial for a personal-computer
daemon that targets a standard dmg install.

**Note:** `sqlite-vec` is pre-v1 (v0.1.9 as of March 2026). The project itself warns "expect
breaking changes."
Source: [sqlite-vec repo](https://github.com/asg017/sqlite-vec)

#### Dimensionality recommendation (if embeddings are adopted later)
384-dim (all-MiniLM-L6-v2 quantized) is the practical sweet spot: small download (~23 MB), good
retrieval quality for English NL, CPU-viable. For 2d archive search where quality matters more,
`Xenova/bge-small-en-v1.5` (also 384-dim, ~33 MB q8) has better MTEB benchmark scores.
Source: [Supabase/bge-small-en on HuggingFace](https://huggingface.co/Supabase/bge-small-en)

---

### Option B: Hosted Embedding API

#### Does Anthropic expose an embedding endpoint?

**DECISION-GRADE: No.** Anthropic's API documentation states explicitly: "Anthropic does not offer
its own embedding model." The recommended third-party is Voyage AI.
Source: [Anthropic embeddings docs](https://platform.claude.com/docs/en/build-with-claude/embeddings)

This means any hosted embedding approach requires a NEW metered API dependency beyond the existing
Anthropic API key. This directly conflicts with ADR-0011's principle of avoiding new metered
dependencies that reintroduce cost/auth tension.

#### Voyage AI pricing (DECISION-GRADE approximate; verify before any adoption)
- `voyage-4-lite`: $0.02/MTok (cheapest general-purpose)
- `voyage-4`: $0.18/MTok (balanced)
Source: [Embedding pricing comparison 2026](https://tokenmix.ai/blog/text-embedding-models-comparison)

At personal scale (hundreds of short facts), cost per distillation run would be fractions of a cent
per call — not a financial concern. The concern is the CATEGORY: a new metered API with a separate
key to manage, a potential privacy exposure for personal conversational data, and a new external
service dependency that can fail or change pricing.

#### Voyage AI privacy considerations (DECISION-GRADE: default training use; opt-out available)
Voyage AI's ToS (Section 3) permits use of customer content for training AI models by default.
Users can opt out via the dashboard, but free-tier credits may be voided on opt-out.
For a personal-computer product where `distilled_facts` are personal NL facts about the user, the
default-on training use is a real privacy exposure — the user's personal memory facts would be sent
to Voyage's servers and used for model training unless explicitly opted out.
Source:
- [Voyage AI Terms of Service](https://www.voyageai.com/tos)
- [Voyage AI opt-out discussion](https://docs.voyageai.com/discuss/6697f3313d38730012b50a7b)

**ADR-0011 verdict:** Introducing Voyage AI (or any hosted embedding API) would require a new API
key, a new metered billing relationship, a privacy disclosure to users about their personal facts
being processed externally, and the same re-verify-before-shipping discipline as provider #2
subscription (which ADR-0011 already identifies as a maintenance cost). This is a significant
expansion of the dependency surface for a feature that can be achieved locally.

---

### Option C: SQLite FTS5 Keyword/BM25 Search

#### Is FTS5 already available in the daemon's SQLite?

**DECISION-GRADE: Yes.** The daemon uses `bun:sqlite`, and Bun bundles SQLite with FTS5 enabled.
Bun's built-in SQLite build includes standard SQLite extensions including FTS5. No separate install
required. Current schema uses plain `distilled_facts` columns; an FTS5 virtual table is an additive
`CREATE VIRTUAL TABLE` DDL that can be added in a migration step.

#### Can keyword search alone make "find the contradicting fact" tractable at personal scale?

**DECISION-GRADE: Yes, with the identified failure modes bounded by design.**

At personal/dogfood scale with LLM-produced canonical facts, FTS5 + BM25 is sufficient for
deduplication and related-fact detection for the following reasons:

1. **Facts are LLM-produced, not raw user text.** The distiller already calls an LLM (Haiku) to
   produce canonical, deduplicated natural-language sentences. The LLM can be prompted to produce
   canonically normalized forms ("favourite colour: blue", not "I told them it was kind of cerulean").
   This significantly reduces the synonym problem that makes FTS5 fail on raw text.

2. **The dedup/contradiction task is not open-ended retrieval.** The task is: "given a new candidate
   fact, find an existing fact that says the same or opposite thing." With short canonical sentences,
   shared key terms (colour, siblings, age, name) are highly likely to appear in both.

3. **At ~50–500 rows, BM25 over an FTS5 virtual table is sub-millisecond.** No performance concern.

4. **FTS5 porter stemming catches morphological variants** ("run"/"running", "like"/"liked") at zero
   additional cost.

#### Where FTS5 fails (semantic gap — DECISION-GRADE)

FTS5 cannot detect semantic equivalence between zero-overlap synonyms. Key failure cases for the
contradiction-detection use:

| Example pair | FTS5 result | Impact |
|---|---|---|
| "favourite colour: blue" vs "preferred shade: cerulean" | NO match (zero shared content tokens) | Duplicate fact stored; user sees both |
| "3 siblings" vs "2 siblings" | MATCH (shared "siblings") | Detected — BM25 ranks it highly |
| "greeted 3 times" vs "said hi 3 times" | WEAK match ("3 times" shared) | Might rank low; "greeted" vs "hi" not matched |
| "user likes jazz" vs "user dislikes jazz" | MATCH (shared "jazz", "likes/dislikes" stem gap) | Contradiction NOT reliably detected via BM25 score alone |

The most impactful failure: FTS5 cannot detect antonym-based contradictions ("likes jazz" vs "dislikes
jazz"). Both will surface in results but BM25 score alone does not flag the contradiction; the
CALLING CODE (the distiller prompt) still needs to compare them. Since the distiller already uses an
LLM (Haiku), the recommended implementation is: FTS5 retrieves the top-K related facts by BM25
score, and the LLM distiller prompt receives those candidates and is instructed to identify
contradictions and duplicates. This hybrid approach captures the semantic contradiction detection via
the already-present LLM step without adding a separate embedding layer.

#### The "likes blue" vs "favourite colour is red" case (adversarial scenario)

This is the canonical failure mode for pure keyword search. With LLM-produced canonical facts, the
producer (Haiku) can be prompted:

> "Normalize colour preferences as: 'favourite colour: [canonical colour name]'."

This shifts the canonicalization responsibility to the distiller step, which already exists. The
resulting facts ("favourite colour: blue" / "favourite colour: red") share the key token "favourite
colour" and FTS5 will retrieve the existing fact as a strong BM25 hit. The LLM then handles
"blue" ≠ "red" (a trivial comparison task for an LLM).

---

## 3. Comparison Table

| Dimension | (A) Local Embeddings | (B) Hosted API | (C) FTS5 / BM25 |
|---|---|---|---|
| **Install complexity** | `onnxruntime-node` native addon (Node-API); first-run model download (~23 MB quantized) | API key + network call per distillation | Zero — built into SQLite/Bun |
| **Bun/macOS compat** | Claimed working in v4; historical regressions in #3574, #18079; native addon = Bun regression surface | HTTP call — no Bun compat concern | Built-in — no compat concern |
| **sqlite-vec macOS** | Requires `setCustomSQLite` + Homebrew SQLite for extension loading | N/A | N/A (pure SQL, no extension) |
| **Cold start** | ~200ms warmup after first download; first-ever launch adds model download delay | Negligible (HTTP) | Negligible (SQL query) |
| **Memory footprint** | ~43–50 MB resident for model + ONNX runtime | Zero (HTTP call, no local model) | Negligible |
| **Privacy** | Local — facts never leave device | Personal facts sent to Voyage (default: used for training; opt-out available) | Local — facts never leave device |
| **ADR-0011 tension** | None | HIGH — new metered API + new API key | None |
| **Contradiction detection quality** | High (semantic similarity catches synonym gaps) | High (same as A, better model) | Medium — zero-overlap synonyms missed; caught via LLM prompt over FTS5 hits |
| **At-scale suitability (2d)** | YES — 2d archive search over messages is the right use case | YES but privacy/cost worsens at scale | WEAK — archive RAG is the hardest case for FTS5 |
| **Dedup at ~500 facts** | Excellent | Excellent | Good (with LLM-canonical prompting); excellent for numeric/lexical dedup |
| **Pre-v1 risk** | sqlite-vec = pre-v1 (if used) | Voyage stable | FTS5 = SQLite built-in, stable |
| **Operational risk** | Bun regression on future Bun update | API outage / pricing change / ToS change | None |
| **Zero-infra install** | Partially — onnxruntime-node NAPI, no sqlite-vec needed for brute-force | Requires VOYAGE_API_KEY (new secret) | YES |

---

## 4. Open / UNVERIFIED Items

- **Cold-start time for `onnxruntime-node` on Bun/macOS daemon specifically (UNVERIFIED).** The
  ~200 ms figure comes from browser-context data; the Bun daemon context may differ due to WASM
  backend vs Node native backend selection. A spike would take ~30 minutes to measure.

- **Whether transformers.js v4 uses `onnxruntime-node` or WASM by default on Bun (UNVERIFIED — matters for performance and Bun compat risk).** The v4 blog states WebGPU runtime but doesn't specify the default CPU fallback backend on Bun. If v4 falls back to WASM (not native addon), the onnxruntime-node regression risk is moot and the performance is different. This is load-bearing for option A's Bun-compat risk rating and should be verified before adopting local embeddings.

- **Whether `sqlite-vec`'s `load()` helper auto-selects the pre-built binary or requires calling
  `setCustomSQLite` first on macOS/Bun (UNVERIFIED: some npm wrapper packages may bundle the SQLite
  dylib).** The `@photostructure/sqlite-vec` npm package appeared in search results — it may handle
  this automatically. Not verified against current source.

- **Voyage AI enterprise data handling terms (UNVERIFIED).** The ToS analysis covered the standard
  (free-tier) terms. Enterprise contracts with Voyage may offer stronger data isolation. Not
  relevant unless option B is reconsidered.

- **FTS5 trigram tokenizer availability in Bun's bundled SQLite (UNVERIFIED).** Standard FTS5 is
  confirmed present; the optional trigram tokenizer (for substring matching) is a compile-time option
  and not confirmed available in Bun's specific SQLite build.

---

## 5. Durable Gotchas (flag for promotion)

**Recommend promoting to `known-gotchas.md`:**

1. **Bun/macOS + SQLite extensions: `setCustomSQLite` required.** Any SQLite extension (including
   sqlite-vec) under Bun on macOS requires calling `Database.setCustomSQLite(path)` with a Homebrew-
   installed SQLite path before any `Database` constructor call. The default Apple SQLite in Bun
   disallows extension loading. This is a HARD requirement for any feature that adds SQLite
   extensions to the daemon, and a zero-infra install blocker unless workarounds are shipped.
   Source: Bun SQLite docs + sqlite-vec JS guide + Bun issue #26736.

2. **`onnxruntime-node` + Bun: established regression surface.** Native NAPI addons in Bun have
   broken on point releases (examples: Bun 0.6.13, Bun 1.2.5). Any local embedding solution
   depending on `onnxruntime-node` should be regression-tested against each Bun minor version
   update. This is a standing maintenance cost if local embeddings are adopted.

3. **Anthropic has no embedding endpoint.** Voyage AI is Anthropic's recommended third-party.
   Voyage's default ToS allows training on customer content; opt-out is available but may void
   free-tier credits. Any adoption requires a new metered API key and privacy disclosure.

---

## 6. Sources (all load-bearing claims cited)

- [Transformers.js v4 blog post — Bun support claim](https://huggingface.co/blog/transformersjs-v4)
- [onnxruntime-node bus error Bun 0.6.13 — issue #3574](https://github.com/oven-sh/bun/issues/3574)
- [onnxruntime-node Bun 1.2.5 regression — issue #18079](https://github.com/oven-sh/bun/issues/18079)
- [CVE-2026-26960 via onnxruntime-node (transformers.js v3.x) — issue #1550](https://github.com/huggingface/transformers.js/issues/1550)
- [all-MiniLM-L6-v2 ONNX model ~90 MB, quantized ~23 MB](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX)
- [all-MiniLM-L6-v2 memory requirements discussion (~43 MB float16)](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/discussions/39)
- [sqlite-vec JS guide — Bun support + macOS setCustomSQLite requirement](https://alexgarcia.xyz/sqlite-vec/js.html)
- [Bun SQLite docs — macOS extension loading, setCustomSQLite](https://bun.com/docs/runtime/sqlite)
- [Built-in vector search for bun:sqlite — open enhancement issue #26736](https://github.com/oven-sh/bun/issues/26736)
- [sqlite-vec repo — pre-v1 status, v0.1.9](https://github.com/asg017/sqlite-vec)
- [Anthropic embeddings docs — no native embedding model](https://platform.claude.com/docs/en/build-with-claude/embeddings)
- [Voyage AI ToS — default training use of customer content, opt-out](https://www.voyageai.com/tos)
- [Voyage AI opt-out of training discussion](https://docs.voyageai.com/discuss/6697f3313d38730012b50a7b)
- [Embedding pricing comparison 2026 — voyage-4-lite $0.02/MTok](https://tokenmix.ai/blog/text-embedding-models-comparison)
- [Brute-force cosine similarity at <100k vectors: single-digit ms](https://github.com/simonw/llm/issues/246)
- [FTS5 for agent memory deduplication (Gaia project)](https://github.com/amd/gaia/issues/542)
- [Supabase/bge-small-en — 384-dim, better MTEB](https://huggingface.co/Supabase/bge-small-en)
