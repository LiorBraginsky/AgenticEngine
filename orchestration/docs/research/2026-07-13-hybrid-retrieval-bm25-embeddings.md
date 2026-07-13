---
title: "Hybrid retrieval (BM25 + embeddings) for the memory 2d design pass"
date: 2026-07-13
status: current
supersedes: 2026-06-13-memory-similarity-approaches.md
purpose: input to 2d design pass
triggered-by: memory-backlog.md §D (2d hybrid retrieval charter) — Lior directive 2026-07-13 ("BM25+embeddings, дослідити гарненько, важливо все")
---

# Hybrid Retrieval (BM25 + Embeddings) — Research Report for 2d

> **Relationship to the prior report** (`2026-06-13-memory-similarity-approaches.md`): that report answered
> "FTS5 vs local embeddings vs hosted embeddings for the 2b incremental distiller's dedup layer" and
> recommended FTS5-now / embeddings-deferred-to-2d. **This report supersedes it for the 2d question**
> (hybrid retrieval architecture, not "which one instead of the other"). Every load-bearing claim from
> the June report that is still relevant is re-verified below; where the picture changed (mostly: it got
> *more* cautious on local embeddings, not less), that is called out explicitly.

---

## 1. Executive decision-grade summary

### OUR constraints (restated, so the evidence below is graded against them, not the abstract)
- **Runtime:** Bun (`packages/daemon`), `bun:sqlite`, macOS-first daemon (ADR-0004).
- **Scale:** single-user dogfood. Distilled facts: dozens–low hundreds of rows. Message archive: bigger
  but still small (thousands, not millions) — this is the corpus 2d's "on-demand archive retrieval" acts on.
- **Local-first posture:** per-install token auth, Keychain secrets, zero-infra install target (no
  required Homebrew/Docker/system service) — ADR-0012.
- **Swappable-provider house style:** ADR-0010/0012 decision 6 — vector/graph retrieval is explicitly a
  *swappable provider*, not a v1 architectural bet.
- **The concrete defect this must close:** the demo-3 duplicate-colour case and the 2c chunk-01 residual
  — a Ukrainian user statement fails to match its own English LLM-canonical fact key because BM25
  requires shared tokens and there are none across scripts/languages.

### The recommended architecture shape
**Hybrid = lexical (SQLite FTS5, BM25) + semantic (embedding cosine similarity) candidate-fetch, fused
by Reciprocal Rank Fusion (RRF).** This is not merely "defensible" — it is now the corroborated default
across every mature search engine (Elasticsearch, Weaviate, Qdrant, OpenSearch all ship native RRF) and,
more importantly for us, across every comparable **agent-memory** system checked (mem0 v3, Zep/Graphiti —
§7). Nobody in this space ships embeddings-only or BM25-only as their production default anymore.
RRF over a weighted score blend is the correct fusion choice **because it sidesteps the BM25/cosine
score-incompatibility problem** (§2), not merely because it's popular.

**Only embeddings close the UK↔EN gap.** BM25/FTS5, including the trigram tokenizer, requires shared
character sequences; a Ukrainian sentence and its English canonical share zero substrings, so no amount
of lexical tuning fixes the root defect. A cross-lingual embedding model maps semantically-equivalent
sentences in different scripts into nearby vector space **by construction** — this is the actual
mechanism that closes the gap, not an incidental side effect of "hybrid" as a buzzword. Confirm this before
the design pass treats hybrid as a checkbox: the fusion (RRF) doesn't create cross-lingual matching, the
*embedding model* does; RRF just lets that signal through without lexical score dominating or hiding it.

### The 3 forks the design pass must decide (each with a lean)

**FORK 1 — Where does the embedding vector come from (local in-process vs hosted API vs localhost
sidecar)?**
Lean: **do NOT default to transformers.js's native `onnxruntime-node` backend in-process.** The June
report treated the Bun/`onnxruntime-node` regression history as "mostly resolved, decision-grade with a
caveat." Re-verification this round found a **fresh, currently-open crash** (oven-sh/bun#30431, opened
May 2026, still open at access date 2026-07-13) that reproduces on **macOS arm64** (our target platform)
on **Bun 1.3.13**, deterministic on Linux, ~66% on macOS — and Bun's stable release is now 1.3.14
(2026-07-08), i.e. this is a *live*, current-version risk, not settled history. This materially
**worsens**, not improves, the June assessment. Two safer paths exist under the same
transformers.js/embedding-model choice: (a) force the WASM backend (`onnxruntime-web`, no native addon,
slower but crash-free — acceptable at hundreds-of-rows scale) or (b) go hosted (Voyage
`voyage-multilingual-2`, Anthropic's own recommended third party, with a 50M-token/month free tier that
dogfood volume will not approach) behind a provider port. Ollama (localhost HTTP, hosts `bge-m3` and
`nomic-embed-text-v2-moe`) is attractive but requires the user to install and run a separate service —
treat it as an **opt-in swappable lane for power users who already have Ollama**, not the shipped
default, to respect zero-infra-install.

**FORK 2 — Fusion: RRF vs weighted score blending.**
Lean: **RRF.** Corroborated as the practical default (§2) precisely because it operates on rank position,
not raw score, so it never needs BM25/cosine score normalization — the single most commonly cited
production pitfall in this space. It is also less code than a tuned weighted blend and needs no
per-corpus alpha parameter (k=60 is a broadly-cited default that works without tuning).

**FORK 3 — Vector storage: `sqlite-vec` extension vs brute-force cosine in TypeScript vs LanceDB.**
Lean: **brute-force cosine over a plain BLOB column, in TypeScript, at query time — no vector-search
extension for v1.** At single-user dogfood scale (low-hundreds of facts, low-thousands of archive
messages) we are **one to two orders of magnitude under** the ~100k-vector threshold the field cites for
where an ANN index starts to matter (§5). `sqlite-vec` is still pre-v1 (0.1.10-alpha.4) and its
Bun+macOS extension-loading gotcha (`Database.setCustomSQLite()` + a Homebrew SQLite path) is
**still unresolved** — the Bun feature request to bake vector search into `bun:sqlite` natively
(oven-sh/bun#26736) is still open with no maintainer response as of 2026-07-13, five months after filing.
Brute-force skips both the pre-v1 breaking-change risk and the Homebrew zero-infra violation entirely.
Revisit only if the archive corpus crosses into the tens of thousands of rows.

**A non-fork, but load-bearing:** embed at **write-time** (facts at distill-time; archive messages when
they're archived), storing `model_id` alongside each vector, not at query-time. This is the documented
industry pattern for surviving a future embedding-model swap (§8) and is cheap at our scale.

### What stayed true from the June report vs what changed
- **Anthropic has no embeddings API; Voyage is their recommended third party.** RE-VERIFIED,
  still true, official doc unchanged in substance (§4).
- **`sqlite-vec` macOS/Bun `setCustomSQLite` gotcha.** RE-VERIFIED, still true, still unresolved (§5).
- **The `onnxruntime-node`/Bun regression surface.** RE-VERIFIED **and materially worse** — a fresh
  open crash on the current stable Bun, not a closed historical issue (§3). This is the single biggest
  update this report makes to the prior document's risk read.
- **FTS5 is zero-infra and already available.** RE-VERIFIED, unchanged (§6).
- **Brute-force is fine at our scale.** RE-VERIFIED and reinforced with a cited threshold (§5).
- **NEW, not covered in June:** Ukrainian is absent from MIRACL, the standard multilingual retrieval
  benchmark — so no embedding model has a *hard, direct* Ukrainian retrieval-quality number. This is a
  genuine evidence gap, not a solved problem (§2), and the design pass should treat cross-lingual quality
  as **empirically-verify-with-our-own-golden-set**, not assume-from-marketing.
- **NEW:** every comparable agent-memory system now does hybrid retrieval, not vector-only (§7) — this
  wasn't checked in June and is one of the strongest corroborations for the hybrid direction.

---

## 2. Hybrid retrieval architecture — RRF vs weighted fusion, and when hybrid actually wins

**The score-incompatibility problem (VERIFIED, multiple independent sources).** BM25 produces unbounded
positive scores; cosine similarity is bounded in [-1, 1]. Naively summing or averaging them lets BM25
dominate; without explicit normalization, "weighting" is meaningless.
Sources: [RAG Engine hybrid search guide](https://rag-engine.cloud/blog/hybrid-search-bm25-plus-vectors),
[Andrey Chauzov — RRF score normalization](https://avchauzov.github.io/blog/2025/hybrid-retrieval-rrf-rank-fusion/),
[Pinecone community — hybrid score normalization](https://community.pinecone.io/t/normailized-score-when-using-hybrid-search-which-is-only-supported-now-with-dot-product-instead-of-cosine-similarity/3051).

**RRF as the standard fix (VERIFIED).** RRF operates on rank position, `score(d) = Σ 1/(k + rank(d))`
(default `k=60`), which sidesteps normalization entirely because it never touches the raw score scale.
Native RRF support ships in Elasticsearch, OpenSearch, Weaviate, and Qdrant.
Sources: [Guillaume Laforge — RRF in hybrid search](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/),
[Serghei's blog — RRF explained](https://blog.serghei.pl/posts/reciprocal-rank-fusion-explained/),
[Digital Applied — Hybrid Search Reference 2026](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026).

**Weighted/relative score fusion (RSF) — the alternative, SINGLE-SOURCE quality tradeoff.** RSF min-max
normalizes each retriever's scores to [0,1] then weights them; it preserves score *magnitude* (a very
confident single-retriever hit can dominate), which RRF (rank-only) discards. This is a real tradeoff,
not RRF being strictly better — but RSF requires tuned normalization per corpus, which is exactly the
pitfall in the paragraph above. **Lean for our small, static corpus: RRF's zero-tuning property outweighs
RSF's magnitude-preservation upside.**
Source: [apxml — Hybrid Search Result Fusion & Ranking](https://apxml.com/courses/advanced-vector-search-llms/chapter-3-hybrid-search-approaches/result-fusion-ranking-strategies).

**Does hybrid actually beat either alone? (VERIFIED direction; exact magnitude CONTESTED/vendor-specific.)**
Multiple independent sources agree on the *direction and mechanism* — BM25 wins on exact identifiers/
rare terms/acronyms, dense wins on paraphrase/synonymy/cross-lingual, and the two have **complementary
recall** (documents missed by one are often caught by the other) — but the *magnitude* of the hybrid lift
varies a lot by source and should not be quoted as a single universal number:
- WANDS e-commerce benchmark (Doug Turnbull, March 2025 — a recognized search-relevance practitioner, not
  an anonymous blog): basic RRF NDCG 0.7068 vs BM25-alone 0.6983 vs KNN-alone 0.6953 — **roughly a 1–1.5%
  lift** for un-tuned RRF; a well-tuned hybrid variant reached 0.7497 (**~7.4% lift**). This is the most
  concretely-sourced number found and is cited via [Digital Applied's reference (which attributes it to Turnbull)](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026)
  — **SINGLE-SOURCE for the exact figures**, though the underlying WANDS dataset is a real, named public benchmark.
- Elasticsearch's own 2025 benchmark (per a secondary summary): RRF added ~1.3% NDCG un-tuned, ~7.5% tuned
  — **directionally consistent** with the WANDS numbers above (independent corroboration of "single-digit
  percent lift, more with tuning"), via [TianPan — "Hybrid Search in Production"](https://tianpan.co/blog/2026-04-12-hybrid-search-production-bm25-dense-embeddings)
  (this specific article is explicitly critical of hybrid-search hype and argues dense retrieval fails
  *silently* on exact-identifier queries — useful adversarial counterweight, not a hybrid cheerleader).
- A higher-end claim — "91% recall@10 hybrid+RRF vs 78% dense-only vs 65% sparse-only" — appeared in
  vendor-blog aggregation content without a traceable primary benchmark; treat as **UNVERIFIED /
  marketing-flavored**, not decision-grade.
- **General BEIR-class finding (VERIFIED, multiple corroborating summaries):** dense retrieval now
  generally outperforms BM25-alone on BEIR by a wide margin in aggregate, but hybrid still adds a further
  few-percent, especially out-of-domain — consistent across [BEIR leaderboard summary](https://app.ailog.fr/en/blog/news/beir-benchmark-update)
  and [mbrenndoerfer's interactive explainer](https://mbrenndoerfer.com/writing/hybrid-search-bm25-dense-retrieval-fusion).

**Net read for us:** the *mechanism* claim (hybrid catches what either retriever alone misses, especially
cross-lingual/paraphrase for dense and exact-term for lexical) is VERIFIED and is the actual reason to
build this, independent of which specific percentage anyone quotes. The *specific percentage lift* is not
something to cite as a number in a spec — it is corpus- and query-mix-dependent, and our real target
metric should be **our own golden set** (the UK/EN colour-change pair + the 2c 16-rephrase matrix — see §8).

**Candidate-pool / top-K sizing for SMALL corpora — UNVERIFIED / no direct source found.** Every source
found addresses large-corpus RAG (recommendations like "first-stage top-50–500 per retriever, rerank
shortlist 50–200" — [Digital Applied](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026))
scaled for corpora far bigger than ours. **No source specifically addresses hundreds-of-documents
corpora.** Reasoned inference (not evidence): at low-hundreds of facts, retrieving top-20 from *each*
retriever before RRF-fusing is generous relative to corpus size and costs nothing at this scale; for the
archive (thousands of messages), top-50–100 per retriever is a safe, conservative starting point
consistent with the low end of the large-corpus guidance. **Flag this explicitly as inferred, not
cited** — the design pass should treat these as a starting default to tune against the golden set, not
a researched number.

---

## 3. Cross-lingual matching — the root problem — and embedding model options

### Ukrainian coverage: the central evidence gap
**MIRACL, the standard multilingual retrieval benchmark, does NOT include Ukrainian** among its 18
languages (ar, bn, de, en, es, fa, fi, fr, hi, id, ja, ko, ru, sw, th, yo, zh + one more). VERIFIED via
[MIRACL's own paper/HF dataset card](https://huggingface.co/datasets/miracl/miracl) and the
[ACL Anthology paper](https://aclanthology.org/2023.tacl-1.63/), corroborated across two independent
search passes. **This means no embedding model has a hard, leaderboard-backed Ukrainian retrieval-quality
number** — every claim of "supports 100+ languages including Ukrainian" is a coverage claim (Ukrainian
was in the pretraining data), not a *quality* claim. A concrete community attempt to fill this gap exists
(a GitHub issue proposing to benchmark EmbeddingGemma-300M vs BGE-M3 specifically for Ukrainian retrieval
— [issue #712](https://github.com/learn-ukrainian/learn-ukrainian.github.io/issues/712)) but it is a
**proposal with no results posted**, i.e. it confirms the gap exists rather than closing it.
**Bottom line: treat cross-lingual UK↔EN retrieval quality as UNVERIFIED for any specific model, and
build our own small golden set (§8) before trusting any model's marketing claim.**

### Candidate models (dimensions/license VERIFIED via official sources; Ukrainian quality UNVERIFIED for all)

| Model | Dims | License | Local-runnable | MTEB (multilingual, ~2026) | Ukrainian evidence |
|---|---|---|---|---|---|
| **BGE-M3** | 1024 (+ sparse + multi-vector) | MIT | Yes (ONNX/HF, Ollama) | Competitive, top open-source multilingual pick per multiple 2026 comparisons | Coverage-only claim (100+ languages); no MIRACL number (UK absent) |
| **multilingual-e5-large/base/small** | 1024/768/384 | MIT | Yes (ONNX/HF) | mE5-base: 62.5 nDCG@10 avg on MIRACL (VERIFIED, but MIRACL excludes UK) | Same gap |
| **LaBSE** | 768 | Apache-2.0 | Yes | Tatoeba P@1 83.7% avg (112 langs, VERIFIED), but explicitly weaker on non-translation semantic similarity | Included in the 109-language set; no UK-specific number found |
| **jina-embeddings-v3** | 1024 (Matryoshka-truncatable to 32) | **CC BY-NC 4.0** (non-commercial for self-hosted weights; API/managed platforms OK) | Yes, but license-gated for commercial self-hosting | 65.52 avg MTEB, beats text-embedding-3-large/mE5-large-instruct/Cohere-v3 per Jina's own paper | No UK-specific number found |
| **Voyage voyage-multilingual-2** | not specified in fetched docs (Voyage's newer `voyage-4`/`voyage-context-4` family is 1024 default, truncatable) | Proprietary/hosted only | No (API-only) | Not on public MTEB (proprietary) | No UK-specific number found |
| **OpenAI text-embedding-3-large/small** | 3072/1536 (truncatable) | Proprietary/hosted only | No | 54.9% MIRACL avg (large) — VERIFIED via search-result summary of OpenAI's own reporting | MIRACL excludes UK |
| **Cohere embed-multilingual-v3 / embed-v4** | v3: 1024, 100+ langs | Proprietary/hosted only | No | v4: 65.2 MTEB | MIRACL excludes UK |

**License caveat worth flagging for the design pass:** jina-embeddings-v3's CC BY-NC 4.0 means
self-hosting the weights commercially requires a separate Jina license — irrelevant to a personal dogfood
tool today, but a real constraint if AgenticEngine ever ships to other users. BGE-M3 and multilingual-e5
(MIT) have no such restriction — this alone is a reason to prefer them over jina-v3 if going local.
Sources: [Jina — CC BY-NC 4.0](https://jina.ai/news/jina-embeddings-v3-a-frontier-multilingual-embedding-model/),
[BAAI/bge-m3 HF model card — MIT](https://huggingface.co/BAAI/bge-m3), multilingual-e5 MIT per multiple
2026 comparison sources (SINGLE-SOURCE-clustered, not the primary HF card directly fetched this round —
flag for a 2-minute confirm before locking).

**LaBSE's documented weakness is specifically relevant to us:** LaBSE "works less well for assessing the
similarity of sentence pairs that are **not** translations of each other" — our use case (a Ukrainian
*statement* vs an English *canonical paraphrase*, not a literal translation) sits closer to this weak spot
than to LaBSE's strength (bitext/translation retrieval). VERIFIED via [emergentmind LaBSE summary](https://www.emergentmind.com/topics/language-agnostic-bert-sentence-embedding-labse).
**This is a concrete reason to prefer bge-m3 or multilingual-e5 over LaBSE** for our specific
paraphrase-not-translation matching need.

---

## 4. Local embedding execution on Bun — the deployment reality (UPDATED, worse than June)

**transformers.js v4 does support Bun as a target runtime (VERIFIED, official).** The v4 blog explicitly
lists Node, Bun, and Deno as supported server runtimes for the new WebGPU-capable runtime.
Source: [Transformers.js v4 blog](https://huggingface.co/blog/transformersjs-v4).

**But the Bun+`onnxruntime-node` native-addon regression surface is CURRENT, not historical (VERIFIED,
worse than the June report found).** Beyond the two closed issues the June report cited (#3574, #18079 —
both fixed/platform-limited), a **new crash is open right now**:
- **oven-sh/bun#30431** (opened ~May 2026, **status: open** as of access 2026-07-13). `onnxruntime-node`'s
  test suite crashes Bun **1.3.13** — deterministic segfault on Linux x86-64, ~66%-reproducible C++
  exception on **macOS 26.4 arm64** (our platform) during shutdown — while Bun **1.2.23** is unaffected.
  Bun's current stable is **1.3.14** (released 2026-07-08), i.e. this is a regression on a *recent, still
  broadly-deployed* Bun line, not an ancient fixed bug.
  Source: [oven-sh/bun#30431](https://github.com/oven-sh/bun/issues/30431).
- A related/adjacent report of segfaults in `onnxruntime_binding.node` on Windows during model
  init/loading also surfaced in the same search pass (a downstream project's issue tracker), suggesting
  the native-addon fragility is not macOS-only.

**Net: local in-process embedding via transformers.js's default (native) backend carries a real, live
crash risk on our exact target platform (macOS/Bun) as of the current Bun release.** This is the single
most important update this report makes vs. the June document, which read the Bun-compat picture as
"mostly resolved history." **It is not resolved; it recurred.**

**Mitigation exists and doesn't require abandoning transformers.js:** force the **WASM** backend
(`onnxruntime-web`, no native addon) instead of the native `onnxruntime-node` backend. Official docs
confirm WASM is the browser default and is also usable in server runtimes, at a performance cost (no
native/CUDA acceleration) that is irrelevant at our scale (hundreds of short facts, background
distill-time embedding, no user-facing latency budget pressure).
Source: [Transformers.js backend docs](https://huggingface.co/docs/transformers.js/api/backends/onnx).
**UNVERIFIED: exact steps to force Bun onto the WASM backend instead of auto-selecting native** — this
needs a short spike before being relied on in a spec.

**fastembed-js is archived; a maintained fork exists but still depends on `onnxruntime-node`.** The
original `fastembed-js` package is archived (unmaintained); `@mastra/fastembed` is a maintained fork that
vendors the source directly, but it is still built on `onnxruntime-node` — i.e. it inherits the exact same
native-addon risk profile as transformers.js's native path, not an escape from it.
Sources: [fastembed-js GitHub](https://github.com/Anush008/fastembed-js), [@mastra/fastembed npm](https://www.npmjs.com/package/@mastra/fastembed).

**node-llama-cpp supports embeddings (VERIFIED) but is oriented at GGUF LLM models, not the
sentence-embedding model families above.** `embed`/`embedMany` APIs exist; multilingual-embedding-specific
GGUF models exist but require separate sourcing/quantization — more integration work than transformers.js
or Ollama for our specific need. Source: [node-llama-cpp embedding guide](https://node-llama-cpp.withcat.ai/guide/embedding).

**Ollama as a localhost HTTP embedding provider (VERIFIED, and architecturally clean).** Ollama exposes
`POST http://localhost:11434/api/embed` and hosts `bge-m3`, `nomic-embed-text`, and
`nomic-embed-text-v2-moe` (the latter explicitly multilingual/MoE). Because it's a separate long-running
HTTP service rather than an in-process native addon, it has **zero Bun-native-addon crash exposure** —
the entire onnxruntime-node risk class above is moot for this lane. The tradeoff is exactly the one ADR-
0012's zero-infra posture exists to avoid: the user must install and run Ollama themselves.
Sources: [Ollama bge-m3](https://ollama.com/library/bge-m3), [Ollama nomic-embed-text-v2-moe](https://ollama.com/library/nomic-embed-text-v2-moe).
**Recommendation: treat as an opt-in swappable provider (ADR-0012 decision-6 pattern), not the default.**

**Comparable local-first products DO ship local embeddings today — with the exact packaging pain we'd
expect.** Obsidian's "Smart Connections" plugin ships local embeddings, offline-capable, "never phones
home" (VERIFIED via its own site: [smartconnections.app](https://smartconnections.app/smart-connections/)).
A newer plugin, **VaultSearch**, explicitly does hybrid keyword(BM25)+semantic(embeddings)+fuzzy matching,
multilingual, on-device — i.e. **an independent product already validating exactly our proposed
architecture shape** at a comparable (single-vault, personal) scale.
Separately, in our own prior-art competitor set (`project_prior_art_findings` — OpenClaw/Hermes-class
tools), OpenClaw's `memory-lancedb` plugin ships `@lancedb/lancedb` and hits **exactly the native-binary
packaging pain this report flags**: missing platform-specific binaries on Intel Mac
([openclaw#67857](https://github.com/openclaw/openclaw/issues/67857)), broken native-module resolution
after upgrades ([openclaw#45788](https://github.com/openclaw/openclaw/issues/45788),
[openclaw#13409](https://github.com/openclaw/openclaw/issues/13409)). **This is independent corroboration,
from a directly comparable competitor product, that shipping a native vector-embedding dependency in a
cross-platform desktop tool is a recurring maintenance cost, not a one-time integration task.**

---

## 5. Vector storage in SQLite-land

**`sqlite-vec` is still pre-v1 (VERIFIED, updated version number).** Latest release found:
**0.1.10-alpha.4** (alpha channel active through April 2026); the project's own docs still warn of
breaking changes before v1.0. Bun support exists and is documented (`bun:sqlite` is explicitly listed as
supported, with a `simple-bun` example in-repo).
Sources: [sqlite-vec JS guide](https://alexgarcia.xyz/sqlite-vec/js.html), [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases).

**The macOS/Bun extension-loading gotcha is RE-VERIFIED, unresolved, current.** Apple's bundled SQLite on
macOS disables extension loading; `bun:sqlite`'s official docs confirm `Database.setCustomSQLite(path)`
must point at a non-Apple SQLite (typically a Homebrew install path) *before* any `Database` constructor
call — and this call is a no-op on Linux/Windows (they already statically link an extension-capable
SQLite), meaning **this is a macOS-specific tax**, exactly on our first-class platform.
Source: [Bun SQLite docs — setCustomSQLite](https://bun.com/reference/bun/sqlite/Database/setCustomSQLite).
**The Bun feature request to bake vector search into `bun:sqlite` natively (obviating this entirely) is
still open, unresolved, five months after filing, with zero visible maintainer engagement:**
[oven-sh/bun#26736](https://github.com/oven-sh/bun/issues/26736) (opened 2026-02-04, status: open at
access 2026-07-13).

**Brute-force vs ANN threshold (VERIFIED, general figure; not JS-specific).** The commonly-cited crossover
is **~100k vectors**: brute-force exact search is "fine" below that; above it, an ANN index (HNSW etc.)
becomes necessary for interactive latency, and brute-force becomes multi-second per query in the
millions-of-vectors range. No source specifically benchmarked JavaScript/Bun, but the O(N·d) complexity
argument is language-independent and N=hundreds-to-low-thousands (our case) is **2–3 orders of magnitude**
under the cited threshold.
Sources: [ANN benchmarks explainer](https://zilliz.com/glossary/ann-benchmarks), general corroboration
across multiple summaries in the same search pass. **This specific "~100k" number is best treated as a
widely-repeated rule of thumb rather than a single rigorously-benchmarked citation — SINGLE-SOURCE-
clustered, not a controlled experiment we can point to.** It is more than sufficient margin for our
decision, though, given we're not close to the boundary either way.

**LanceDB — viable, but adds a native dependency for a benefit we don't need yet.** LanceDB has an
official `@lancedb/lancedb` Node.js package, is embeddable/local (no server), and persists to a local
path. It is NOT confirmed Bun-tested in official docs, and the OpenClaw evidence above shows the exact
native-binary packaging failure mode (missing `darwin-x64` build) that this class of dependency risks.
**Recommendation: skip LanceDB for v1** — it solves a scale problem (ANN indexing, columnar storage) we
don't have yet, at a packaging-risk cost we do have evidence of.
Source: [LanceDB GitHub](https://github.com/lancedb/lancedb), [@lancedb/lancedb npm](https://www.npmjs.com/package/@lancedb/lancedb).

**Recommended storage shape for v1:** a plain SQLite table (`fact_embeddings` or similar) with columns
`(fact_id, model_id, dims, vector BLOB, created_at)`; brute-force cosine similarity computed in
TypeScript over the (small) result of a `SELECT`. No `vec0` virtual table, no extension loading, no
Homebrew dependency, no pre-v1 breaking-change exposure.

---

## 6. FTS5 for Ukrainian/Cyrillic — what closes, what doesn't

**FTS5 is built into Bun's bundled SQLite (RE-VERIFIED, unchanged from June).** No install step.

**`unicode61`'s Cyrillic case-folding behavior is CONTESTED / ambiguous in the docs — flag for a 5-minute
empirical check before relying on it.** The official SQLite FTS5 docs state, for the **ascii** tokenizer
specifically, that "case-folding is only performed for ASCII characters" (implying, by the doc's own
contrast, that **unicode61** folds more broadly) — but the docs do not explicitly confirm Cyrillic
case-folding for unicode61, and a separate summary of the same docs (in a different search pass) quoted
the ASCII-only case-folding line in a way that reads as if it applied to unicode61 too. SQLite's actual
implementation (`ext/fts5/fts5_unicode2.c`) is described (in secondary sources, not the primary source
file directly) as containing a generated non-ASCII case-fold table, which would mean Cyrillic uppercase/
lowercase folding *does* work — but this is **not confirmed from a primary source in this pass.**
Sources: [SQLite FTS5 docs](https://www.sqlite.org/fts5.html) (fetched; ambiguous on this specific point),
[SQLite forum thread on Unicode folding](https://sqlite.org/forum/info/0c8af2da929ed34b) (confirms
"FTS5 does Unicode folding" in general terms, doesn't confirm script coverage).
**Action for the design pass, not this report: write a 5-line Bun test —
`INSERT INTO t VALUES ('Привіт')`, `SELECT * FROM t('привіт')` — and confirm empirically before the spec
assumes it.**

**`unicode61`'s `remove_diacritics` is explicitly Latin-script-scoped (VERIFIED) and does not apply to
Cyrillic** — Cyrillic doesn't use the same combining-diacritic patterns this feature targets, so this
specific FTS5 feature is a non-issue (neither helps nor hurts) for Ukrainian.

**Trigram tokenizer (VERIFIED, official docs) — substring matching, own independent `case_sensitive`
option (default 0 = insensitive) that does not depend on the unicode61 ambiguity above.** This makes
trigram a **safer bet for the Ukrainian lexical layer** than relying on unicode61's uncertain non-ASCII
case-folding — its case-insensitivity is documented independently of script. Cost: larger index (an
accepted, explicitly-documented tradeoff), and substrings under 3 characters never match. `bm25()` works
identically over a trigram-tokenized table.
Source: [SQLite FTS5 docs — trigram tokenizer](https://www.sqlite.org/fts5.html).

**No usable Ukrainian stemmer exists in the JS Snowball ecosystem (VERIFIED, checked multiple packages).**
`snowball-stemmers`, `snowball-js`, and `node-snowball` all support Russian but **not** Ukrainian. A
standalone (non-Snowball) Ukrainian stemmer package was found referenced but not independently verified
in this pass — treat as **UNVERIFIED, needs a direct check** if lexical Ukrainian stemming is ever
pursued. **Given no reliable JS stemmer exists, the porter tokenizer (English-only per its own docs) is
not an option for Ukrainian, and stemming should not be relied on for the Ukrainian lexical layer at all
— trigram substring matching is the practical fallback for "reworded within the same language."**

**Does FTS5 (even trigram) close the UK↔EN gap? NO (VERIFIED by construction, not by benchmark).** Trigram
substring matching operates on shared character sequences. A Ukrainian word and its English translation
share zero character sequences (different scripts entirely). Trigram FTS5 can close **same-language
reworded/typo gaps** ("кольор" vs "колір") but cannot and does not close **cross-language** gaps under any
configuration. **Only the embedding half of the hybrid closes the actual root defect.** This directly
answers research question 6: no, trigram-FTS does not partially close the cross-lingual gap — it closes a
different, same-language gap that is a real but separate problem.

---

## 7. Agent-memory prior art — how comparable systems actually retrieve today

**mem0 (VERIFIED via its own docs/architecture summaries) — hybrid, not vector-only, as of its V3
algorithm (April 2026).** Retrieval fuses semantic (vector) search, BM25 keyword search, and entity
matching **in parallel**, then fuses scores and takes top-K. Default embedding model is OpenAI
`text-embedding-3-small`; dedup uses a two-stage approach — retrieve top-10 related existing memories via
the hybrid retriever as *dedup context* for an LLM extraction call, then MD5 hash-based exact-dup
filtering before insert. **This is architecturally close to what our design pass should build** (hybrid
candidate-fetch feeding an LLM decision step, not the retriever making the dedup call alone) — it
validates the "FTS5+embeddings feed the distiller LLM which decides" pattern the June report already
leaned toward for dedup, now extended with a real semantic-retrieval leg.
Sources: [Mem0 OSS v2→v3 migration docs](https://docs.mem0.ai/migration/oss-v2-to-v3), [DeepWiki mem0ai/mem0 architecture](https://deepwiki.com/mem0ai/mem0).
**Caveat: mem0's hash-based dedup (MD5) is exact-match only** — it does not, by itself, solve
cross-language paraphrase dedup either; the semantic leg of *their* hybrid retriever is what would catch
that, same as our proposed design. No public documentation found describing how well mem0 specifically
handles cross-language duplicate facts — **UNVERIFIED**, not addressed in available sources.

**Zep/Graphiti (VERIFIED via Zep's own architecture docs + arXiv paper) — hybrid semantic + BM25 + graph
traversal, explicitly avoiding LLM calls at retrieval time.** Graphiti's bi-temporal knowledge graph
stores facts as graph edges with both event-time and ingestion-time, which is how it "handles contradictory
or updated facts without information loss" — a different mechanism from our replace-on-change distiller,
worth noting as an alternative pattern (graph-edge versioning vs our REPLACE-op) but not something this
report recommends adopting (out of scope; graph modeling is a much bigger architectural bet than 2d).
Reported P95 latency ~300ms.
Sources: [Zep/Graphiti arXiv paper](https://arxiv.org/abs/2501.13956), [Neo4j blog on Graphiti](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/).

**Letta/MemGPT (VERIFIED) — tiered memory (core/archival/recall), vector-only within each tier, agent-
directed (not automatic) retrieval.** Archival memory is backed by Postgres+pgvector; the agent explicitly
calls `archival_memory_search`/`conversation_search` tools rather than having memory silently injected.
This is architecturally close to our shipped 2c (`memory_forget`/`memory_remember` action tools) —
worth noting that Letta validates the "agent calls a memory tool" pattern we already built, but Letta's
retrieval leg itself is vector-only (no BM25 leg documented), i.e. **Letta does NOT corroborate hybrid** —
it's the one system found in this pass that leans purely semantic. Flag as a genuine counter-data-point,
not cherry-picked support.
Source: [Letta memory architecture summaries](https://www.lmatlas.com/building-blocks/memgpt-letta), [vectorize.io Letta comparison](https://vectorize.io/articles/mem0-vs-letta).

**LangMem (VERIFIED) — backend-agnostic, vector-similarity search over namespaced JSON memories with
"automatic semantic deduplication."** No BM25 leg documented; storage is pluggable (works with vector DBs,
KV stores, Postgres). Another semantic-only data point, though its "backend-agnostic" framing means a
hybrid backend is *possible*, just not what's documented as the default.
Source: [LangMem semantic memory docs](https://deepwiki.com/langchain-ai/langmem/2.1-semantic-memory).

**ChatGPT's memory feature (SINGLE-SOURCE / reverse-engineered, not officially documented) — described as
embedding-based retrieval into the system prompt, with a reported ~100–150 distinct-memory practical
cap before pruning.** No official OpenAI architecture doc was found describing this precisely; treat as
**UNVERIFIED / inferred from third-party reverse-engineering**, not an authoritative source.
Source: [llmrefs — reverse-engineering ChatGPT memory](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory).

**Net for §7: 2 of 4 well-documented systems (mem0, Zep/Graphiti) are explicitly hybrid; 2 (Letta,
LangMem) are vector-only as documented.** This is corroborating evidence for hybrid, not unanimous
industry consensus — presented honestly rather than rounded up. The systems that skew hybrid are
notably the ones most focused on **exact recall of discrete facts** (closer to our use case) vs Letta/
LangMem's more general-purpose framing — a plausible reason for the split, though this report did not
find a source stating that reasoning explicitly (it's this researcher's inference, flagged as such).

---

## 8. Embedding lifecycle & ops

**Write-time vs query-time embedding (VERIFIED as the standard pattern, general RAG literature).**
Embedding at write/ingest time (once per fact/message, cached) is standard; only the *query* is embedded
at query-time (cheap, one string). This matches our two corpora naturally: **facts** get embedded once at
distill-time (they change rarely — a REPLACE op re-embeds); **archive messages** get embedded once when
archived. Neither corpus benefits from query-time bulk embedding, which would be wasted repeated work.

**Storing `model_id` per vector row is a documented, named pattern for surviving model swaps (VERIFIED,
multiple named strategies found).** Three named strategies for handling an embedding-model upgrade:
**(1) blue/green** — dual-write vectors under old+new model, shadow-query, promote only if quality holds;
**(2) lazy re-embedding** — embed new writes with the new model, re-embed old rows lazily on access/in
background batches; **(3) full re-index-and-swap** — re-embed everything, cut over atomically. At our
scale (hundreds of facts, thousands of messages), **(3) full re-index-and-swap is realistic and simplest**
— a full re-embed of our entire corpus is a batch job measured in seconds-to-minutes, not the
multi-day/rolling operation these strategies exist to avoid at real production scale. Store `model_id`
per row regardless, so a future swap is a detectable, deliberate migration rather than silent staleness.
Source: [Gary Stafford — "Different Embedding Models, Different Spaces"](https://medium.com/data-science-collective/different-embedding-models-different-spaces-the-hidden-cost-of-model-upgrades-899db24ad233).

**Facts vs raw archive — do comparable systems embed them differently?** Letta explicitly has two tiers
(archival = vector-searchable, recall = conversation-log-searchable) suggesting some systems *do* treat
raw history and curated memory differently at the retrieval-mechanism level, though Letta's recall-memory
search mechanism specifics weren't confirmed as embeddings-based vs something else in the sources found —
**UNVERIFIED at the mechanism level**, though the *tiering itself* (raw history vs curated facts as
separate retrievable stores) directly matches our existing two-corpora shape (uncapped archive + distilled
facts, per the memory-foundation spec) and is a useful validation that the two-corpora split itself is a
sound, prior-art-consistent shape — independent of what mem0/Zep do for retrieval mechanics.

**Eval harness — no published pattern found specific to a "personal memory corpus," but the shape of the
need is standard IR eval.** No source in this pass described a golden-set methodology for a personal-scale
memory system specifically. **Recommendation, not a citation:** build the golden set from our own known
defects — the demo-3 UK/EN colour-change pair and the 2c chunk-01 16-rephrase matrix already exist as
real, motivating cases; measuring hybrid-retrieval recall against those before/after is a stronger
evaluation than any borrowed benchmark number, precisely because those benchmarks don't cover Ukrainian
(§3). This is this researcher's synthesis, not an external citation — flagged as such.

---

## 9. What we did NOT verify (honest gaps)

- **Whether Bun auto-selects `onnxruntime-node` (native) or WASM by default for transformers.js v4 on
  Bun specifically, and the exact API to force WASM.** Carried over from the June report as unresolved;
  still unresolved this round. A ~30-minute spike would settle it before any spec assumes a specific
  backend-selection default.
- **Whether `unicode61` case-folds Cyrillic uppercase/lowercase.** Docs are ambiguous/contested (§6); a
  5-line empirical test would settle it in minutes. Do not assume either way in a spec.
- **Any hard Ukrainian-specific retrieval-quality number for any embedding model.** Genuinely doesn't
  exist in public benchmarks as of this research pass (§3) — this is a real gap, not a research failure;
  build our own golden set instead of hunting further for a number that may not exist.
- **Exact embedding dimensions for `voyage-multilingual-2`** — the official pricing/model page did not
  state it directly in the fetched content; the newer `voyage-4` family defaults to 1024 (truncatable).
  Confirm directly with Voyage's API docs (`GET` a sample embedding) before locking a schema column width.
- **Multilingual-e5's exact license text from HF's own model card** — clustered across secondary sources
  as MIT; not confirmed by directly fetching the primary HF model card this round. Low-risk (MIT is
  consistent across all sources checked) but a 2-minute confirm before shipping is cheap insurance.
- **Whether any standalone (non-Snowball) Ukrainian JS stemmer package is actually usable/maintained** —
  a reference surfaced but was not independently vetted (README read, npm download counts, last-publish
  date). Given the trigram-tokenizer fallback recommended in §6, this is low-priority to chase further.
  its
- **The exact magnitude of hybrid's retrieval lift for OUR corpus and query mix** — by design, this can
  only be measured empirically once the golden set (§8) exists; every percentage cited in §2 is from a
  different corpus/domain and should not be treated as predictive of our numbers.
- **mem0/ChatGPT-memory's specific handling (or failure) of cross-language duplicate facts** — no public
  documentation found either confirming or denying this for either system.

---

## 10. Sources (consolidated)

**Hybrid architecture / fusion:**
- [RAG Engine — BM25 + Vectors hybrid guide](https://rag-engine.cloud/blog/hybrid-search-bm25-plus-vectors)
- [Andrey Chauzov — RRF score normalization](https://avchauzov.github.io/blog/2025/hybrid-retrieval-rrf-rank-fusion/)
- [Guillaume Laforge — Understanding RRF in hybrid search](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/)
- [Serghei's Blog — RRF explained](https://blog.serghei.pl/posts/reciprocal-rank-fusion-explained/)
- [Digital Applied — Hybrid Search: BM25, Vector & Reranking Reference 2026](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026)
- [apxml — Hybrid Search Result Fusion & Ranking](https://apxml.com/courses/advanced-vector-search-llms/chapter-3-hybrid-search-approaches/result-fusion-ranking-strategies)
- [TianPan — Hybrid Search in Production: Why BM25 Still Wins on the Queries That Matter](https://tianpan.co/blog/2026-04-12-hybrid-search-production-bm25-dense-embeddings)
- [mbrenndoerfer — Hybrid Search: BM25 and Dense Retrieval Combined](https://mbrenndoerfer.com/writing/hybrid-search-bm25-dense-retrieval-fusion)
- [Pinecone community — normalized score in hybrid search](https://community.pinecone.io/t/normailized-score-when-using-hybrid-search-which-is-only-supported-now-with-dot-product-instead-of-cosine-similarity/3051)
- [BEIR benchmark leaderboard 2025/2026 summary](https://app.ailog.fr/en/blog/news/beir-benchmark-update)

**Cross-lingual embeddings:**
- [MIRACL dataset card (HuggingFace)](https://huggingface.co/datasets/miracl/miracl)
- [MIRACL — ACL Anthology paper](https://aclanthology.org/2023.tacl-1.63/)
- [learn-ukrainian GitHub issue #712 — proposed EmbeddingGemma vs BGE-M3 Ukrainian benchmark (no results yet)](https://github.com/learn-ukrainian/learn-ukrainian.github.io/issues/712)
- [BAAI/bge-m3 model card](https://huggingface.co/BAAI/bge-m3)
- [Multilingual E5 Text Embeddings — technical report](https://arxiv.org/pdf/2402.05672)
- [emergentmind — LaBSE summary (incl. translation-vs-similarity weakness)](https://www.emergentmind.com/topics/language-agnostic-bert-sentence-embedding-labse)
- [Jina — jina-embeddings-v3 announcement (license, MTEB score)](https://jina.ai/news/jina-embeddings-v3-a-frontier-multilingual-embedding-model/)
- [Anthropic — Embeddings guide (no native model, Voyage recommended)](https://platform.claude.com/docs/en/build-with-claude/embeddings)
- [Voyage AI — pricing page](https://docs.voyageai.com/docs/pricing)
- [Voyage AI — Terms of Service (training opt-in/opt-out mechanics)](https://www.voyageai.com/tos)
- [Voyage AI — opt-out of training discussion thread](https://docs.voyageai.com/discuss/6697f3313d38730012b50a7b)
- [Jina — legal/privacy (data retention, anonymized use for training)](https://jina.ai/legal/)
- [Cohere — Embed model docs (pricing, retention, no-training-use)](https://docs.cohere.com/docs/cohere-embed)
- [OpenAI — how your data is used to improve model performance](https://openai.com/policies/how-your-data-is-used-to-improve-model-performance/)
- [Google — Gemini Embedding pricing/availability](https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/)

**Bun / local execution:**
- [Transformers.js v4 blog — Bun/Node/Deno support](https://huggingface.co/blog/transformersjs-v4)
- [Transformers.js backend docs (ONNX WASM vs native)](https://huggingface.co/docs/transformers.js/api/backends/onnx)
- [oven-sh/bun#30431 — onnxruntime-node crash on Bun 1.3.13, macOS/Linux, OPEN](https://github.com/oven-sh/bun/issues/30431)
- [oven-sh/bun#18079 — onnxruntime-node Bun 1.2.5 Windows regression (historical, fixed)](https://github.com/oven-sh/bun/issues/18079)
- [oven-sh/bun#3574 — onnxruntime-node bus error Bun 0.6.13 (historical, fixed)](https://github.com/oven-sh/bun/issues/3574)
- [fastembed-js GitHub (archived)](https://github.com/Anush008/fastembed-js)
- [@mastra/fastembed npm (maintained fork, still onnxruntime-node)](https://www.npmjs.com/package/@mastra/fastembed)
- [node-llama-cpp — embedding guide](https://node-llama-cpp.withcat.ai/guide/embedding)
- [Ollama — bge-m3](https://ollama.com/library/bge-m3), [Ollama — nomic-embed-text-v2-moe](https://ollama.com/library/nomic-embed-text-v2-moe)
- [Smart Connections (Obsidian) — local-first embeddings, offline](https://smartconnections.app/smart-connections/)
- [OpenClaw #67857 — LanceDB native binary missing on Intel Mac](https://github.com/openclaw/openclaw/issues/67857)
- [OpenClaw #45788 — memory-lancedb loses native module after upgrade](https://github.com/openclaw/openclaw/issues/45788)
- [OpenClaw #13409 — memory-lancedb native dependency resolution broken](https://github.com/openclaw/openclaw/issues/13409)

**SQLite vector storage:**
- [sqlite-vec — JS/Bun guide (Alex Garcia)](https://alexgarcia.xyz/sqlite-vec/js.html)
- [sqlite-vec — GitHub releases (0.1.10-alpha.4, pre-v1)](https://github.com/asg017/sqlite-vec/releases)
- [oven-sh/bun#26736 — built-in vector search for bun:sqlite, OPEN since 2026-02-04](https://github.com/oven-sh/bun/issues/26736)
- [Bun docs — Database.setCustomSQLite](https://bun.com/reference/bun/sqlite/Database/setCustomSQLite)
- [Bun docs — SQLite runtime guide](https://bun.com/docs/runtime/sqlite)
- [LanceDB — GitHub](https://github.com/lancedb/lancedb), [@lancedb/lancedb npm](https://www.npmjs.com/package/@lancedb/lancedb)
- [Zilliz — ANN benchmarks explainer (brute-force/ANN crossover)](https://zilliz.com/glossary/ann-benchmarks)

**FTS5 / Ukrainian lexical:**
- [SQLite — official FTS5 documentation](https://www.sqlite.org/fts5.html)
- [SQLite forum — Unicode folding thread](https://sqlite.org/forum/info/0c8af2da929ed34b)
- [snowball-stemmers npm (no Ukrainian)](https://www.npmjs.com/package/snowball-stemmers)
- [node-snowball GitHub (no Ukrainian)](https://github.com/hthetiot/node-snowball)

**Agent-memory prior art:**
- [Mem0 — OSS v2→v3 migration docs](https://docs.mem0.ai/migration/oss-v2-to-v3)
- [Mem0 architecture — DeepWiki](https://deepwiki.com/mem0ai/mem0)
- [Zep/Graphiti — arXiv paper](https://arxiv.org/abs/2501.13956)
- [Neo4j — Graphiti blog](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)
- [Letta/MemGPT memory model overview](https://www.lmatlas.com/building-blocks/memgpt-letta)
- [vectorize.io — Mem0 vs Letta comparison](https://vectorize.io/articles/mem0-vs-letta)
- [LangMem semantic memory — DeepWiki](https://deepwiki.com/langchain-ai/langmem/2.1-semantic-memory)
- [llmrefs — reverse-engineering ChatGPT memory (unofficial)](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory)

**Embedding lifecycle:**
- [Gary Stafford — Different Embedding Models, Different Spaces (re-embedding strategies)](https://medium.com/data-science-collective/different-embedding-models-different-spaces-the-hidden-cost-of-model-upgrades-899db24ad233)

**Prior report (re-verified against):**
- [2026-06-13-memory-similarity-approaches.md](./2026-06-13-memory-similarity-approaches.md)
