---
status: accepted
date: 2026-07-13
deciders: [lior]
tags: [adr, memory, retrieval, embeddings, provider-plane, privacy, egress, hybrid]
---

# ADR-0017: EmbeddingProvider plane — local-first embeddings, egress posture, and the vector lifecycle

## Status

`accepted` — **by Lior 2026-07-14 at the decompose-PR gate** (spec §0.4 of the one-event package
via AskUserQuestion; hard-to-reverse tier honored — full §5.2, no async shortcut), together with
[[../specs/2026-07-13-hybrid-retrieval]] (accepted same event, all four §0 points as recommended).
*History: agent-authored during work (the hybrid-retrieval frontier decompose pass, PIPELINE §11,
2026-07-13; conductor ruling of record: bus q#017 — all-as-recommended + 4 riders). Tier rationale:
a NEW provider plane + a NAMED future egress lane for personal memory content is closer to
ADR-0016's decision-grade tier than to a doc-style record.*

## Context

ADR-0012 decision 6 committed the posture: *"vector / graph retrieval is a swappable provider, not
a v1 bet."* The 2d hybrid-retrieval feature is that provider arriving — the first time the system
computes and stores EMBEDDINGS of memory content (distilled facts + archived messages). Two facts
make this an ADR and not an implementation detail:

1. **Embedding text means handing that text to a model.** Where that model runs is a PRIVACY
   decision about personal memory content, not a performance knob. The product's local-first
   posture (per-install token, Keychain, 127.0.0.1 — ADR-0012/0013; security-as-pitch per the
   prior-art study) sets a default; hosted embedding APIs (Voyage et al.) exist and are
   quality-attractive, so the temptation to silently flip will recur.
2. **Vectors are derived state with a lifecycle.** They are model-specific (vectors from different
   models are incomparable), must die with their source content (scrub semantics), and must
   survive a model swap by deliberate migration — silent staleness here is a retrieval-quality
   corruption no test suite notices.

The runtime constraints are researched and version-stamped
([[../research/2026-07-13-hybrid-retrieval-bm25-embeddings]]): the native `onnxruntime-node` path
crashes on our exact platform (gotcha #46, open `oven-sh/bun#30431`); `sqlite-vec` extension
loading on macOS/Bun is unresolved (gotcha #47) and unnecessary 2–3 orders of magnitude below the
ANN threshold.

## Decision

**Introduce a THIRD provider plane — `EmbeddingProvider` — with a local-first default, an
explicit-opt-in-only egress lane, and a stamped vector lifecycle. The feature mechanics live in
the accepted spec ([[../specs/2026-07-13-hybrid-retrieval]]); this ADR fixes the decisions that
outlive it:**

1. **The plane.** `EmbeddingProvider` is a thin swappable port
   (`{id, modelId, dims, embed(texts) → vectors|null}`) following the established house pattern
   (`AgentProvider` ADR-0010, `MemoryProvider` selector): registry Map + env selection
   (`EMBEDDING_PROVIDER`) + loud-log graceful fallback. **`null`/absent NEVER throws and NEVER
   blocks** — every consumer (hybrid ranker, distiller candidate-fetch, `memory_search`) degrades
   to lexical-only. Availability never depends on the embedding lane; only retrieval quality does.

2. **Local-first default; egress is opt-in-only, forever-explicit.** The DEFAULT lane runs
   **in-process, WASM backend** (no native addon — gotcha #46; nothing leaves the machine). A
   HOSTED lane (Voyage-class) may exist ONLY as an explicit per-install opt-in (env/config act =
   the informed-consent line) — **no code path may select a hosted embedding lane by default, and
   no fallback may silently flip to one** (bus q#017 rider 1: a failed local lane escalates with
   data; the pick between Ollama-opt-in and hosted-with-consent is a recorded human decision).
   The hosted adapter itself is NOT built until a real trigger fires (q#017 rider 2: the golden
   set failing ALL local candidate models is the named condition).

3. **The vector lifecycle.** Embed at WRITE-time (facts at distill/mutation; messages at archive),
   never query-time bulk; **`model_id` is stamped on every vector row**; vectors from different
   models are never compared (mixed rows are excluded, loudly). A model swap is a **deliberate,
   logged FULL re-embed migration** (at this corpus scale: seconds-to-minutes) — never lazy mixed
   reads. Scrubbed/tombstoned content's vectors are DELETED with the scrub, and the async embed
   path re-checks tombstone status inside its write transaction so a scrub can never be
   re-materialized as a vector (the spec's D3b race guard).

4. **Storage stays boring (gotcha #47 honored).** Plain SQLite BLOB columns + brute-force cosine
   in TypeScript — no `sqlite-vec`, no extension loading, no ANN index, no new native dependency.
   Revisit trigger: the archive corpus reaching tens of thousands of rows.

### Explicitly NOT decided here

- **The embedding MODEL** — architect-time, golden-set-gated (spec §3.8); swappable by
  construction via `modelId`.
- **Hybrid ranking mechanics** (RRF, leg sizes, cutoffs) — the spec's §3.4; they can change
  without touching this plane.
- **Ollama's lane** — documented pattern, built on real demand; never the default (zero-infra).

## Consequences

### Positive
- Cross-language retrieval (the UK↔EN root defect) becomes closable with ZERO egress of personal
  content by default — the local-first pitch survives the feature that most tempts it.
- The plane is swappable per-install; a future quality upgrade (hosted or better local model) is
  an adapter + a logged re-embed, not a rewrite.
- Degrade-to-lexical keeps CI, keyless installs, and offline machines fully functional.

### Negative
- **Local WASM quality for Ukrainian is UNVERIFIED** (UA absent from every public benchmark —
  research §3); the golden set arbitrates, and it may force the hosted-lane decision sooner than
  hoped (the ladder exists for exactly that).
- A one-time model download (~100–500 MB) joins the install footprint; offline first-use is
  lexical-only until it lands.
- A third provider plane to govern (Agent, Memory, Embedding) — selector/env sprawl is real;
  bounded by reusing one house pattern.

### Trade-offs accepted
- We accept **possibly-weaker retrieval quality by default** in exchange for **zero default
  egress of memory content** — reversible per-install, arbitrated by our own eval.
- We accept **WASM inference cost** (no native/GPU) in exchange for **dodging the live
  native-addon crash class** (#46) — irrelevant at hundreds-of-rows scale.
- We accept **full re-embed as the only migration** in exchange for **never reasoning about
  mixed-model vector spaces** — correct at this scale, revisit with the ANN trigger.

### What we'll regret in 6 months (predict it now)
> [TODO: Lior — your prediction at acceptance. Agent-drafted candidates: (a) local UA quality
> disappoints and the hosted lane arrives anyway — the consent gate then feels like ceremony;
> (b) the model download becomes the first "install didn't work" support class (offline/proxy);
> (c) brute-force cosine meets a grown archive earlier than predicted and the #47 revisit fires.]

## Alternatives Considered

### Option B: hosted-by-default (Voyage), local as opt-out
**Why not:** every fact + every archived message would egress by default under third-party
retention/training terms — inverts the local-first posture and the security-as-pitch moat for a
quality delta no benchmark can even quantify for Ukrainian (research §3). Ruled out q#017 sub-1.

### Option C: Ollama sidecar as default
**Why not:** requires the user to install and run a separate service — violates the zero-infra
install target (ADR-0012 posture). Stays as the documented opt-in local lane and a pre-framed
spike-failure fallback.

### Option D: native `onnxruntime-node` in-process
**Why not:** a live, open crash on our exact platform (macOS arm64 + Bun — gotcha #46,
`oven-sh/bun#30431`); independently corroborated native-dependency packaging pain in a direct
competitor (OpenClaw memory-lancedb issues). Forbidden, not merely disfavored.

### Option E: sqlite-vec / LanceDB vector storage
**Why not:** gotcha #47 (extension loading unresolved on macOS/Bun; pre-v1 breaking-change risk;
native-binary packaging class) for an ANN benefit that starts mattering ~100k vectors — 2–3 orders
above our corpus. Brute-force BLOB is the correct v1.

### Option F: no ADR (spec-only)
**Why not:** the spec archives on `implemented`; the egress posture and the plane's invariants
(no-silent-hosted-flip, model_id stamping, full re-embed) must bind FUTURE features and
contributors — that is what ADRs are for. Ruled q#017 sub-2.

## Related

- [[../specs/2026-07-13-hybrid-retrieval]] — the mechanics, golden-set eval, decomposition (rides the same PR; Lior signs both).
- [[0012-conversation-and-memory-model]] — decision 6 (the posture this EXECUTES); STABILITY amendment untouched.
- [[0010-pluggable-llm-provider-abstraction]] — the provider-port house pattern reused.
- [[0016-agent-memory-action-tools]] — the sibling plane; its `kind:read` slot is consumed by the same feature (and its d7 ceiling gains a dated rider in the same PR).
- [[0013-daemon-memory-write-http-surface-caller-auth]] — no new INBOUND surface; the hosted lane (if ever opted in) is a named OUTBOUND client only.
- [[../research/2026-07-13-hybrid-retrieval-bm25-embeddings]] — the cited evidence base (forks, gotchas #46/#47 re-verification anchors).
- [[../known-gotchas]] #46 · #47 — honored by construction.
- `orchestration/.conveyor/bus/{q,a}/017-privacy-adr-guardrails.md` — the conductor ruling of record.
- [[../PIPELINE]] §5.2 + Finding #5 — the acceptance gate this ADR awaits.

## Follow-up for Lior (NOT done by this ADR)

- **Accept / amend** (`proposed → accepted`) — together with the spec §0 package; the 2d chunks do
  not start before both.
- **Fill the regret prediction** above at acceptance.
