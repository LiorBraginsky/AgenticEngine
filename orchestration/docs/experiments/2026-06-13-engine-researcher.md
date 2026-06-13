# engine-researcher — the conveyor's research lane (experiment)

> **Зріз: 2026-06-13.** Process tooling, NOT product (PIPELINE §7.4) — like the dev-bus. No product
> ADR. Lives in `.claude/agents/engine-researcher.md` + `docs/research/` + this doc.

**Status:** NEW — piloting on the memory-quality v2 (incremental distiller) semantic-layer seam.

## Why (Lior, 2026-06-13)
At design/decompose seams that turn on **external knowledge** — "embeddings local vs API, which is
better?", a ToS question, an industry-norm — neither the worker, the conductor, nor Lior reliably
knows, and *guessing in the box* (or asking up to someone who also doesn't know) is the wrong move.
The `deep-research` skill already exists; what was missing is **conveyor integration**: a trigger, a
runner, and a durable home for findings. So research becomes a first-class, dispatchable step.

## What was built
- **Agent `engine-researcher`** (sonnet — capable for search+synthesis+adversarial-verify; haiku alone
  too weak for synthesis). Thin: scopes the question, runs `deep-research` (or a focused WebSearch/
  WebFetch pass for narrow questions), verifies adversarially, writes a **cited report**, returns a
  decision-oriented synthesis. Does NOT decide design or write code.
- **Home `orchestration/docs/research/`** (cited reports; `decision-grade` vs `UNVERIFIED` required;
  README has the template + the routing rule). Durable gotchas → promoted to known-gotchas/PIPELINE.
- **The third routing lane:** design-judgment → conductor (dev-bus); frozen/north-star/§5.2 → Lior;
  **external-knowledge → engine-researcher → docs/research/**. Decomposer/architect read the report.

## What we measure (like the dev-bus verdict — over a few uses)
- Did research change the design vs what would have been guessed? (the "earning its keep" signal)
- decision-grade vs unverified ratio; did the architect actually build on the report?
- model fit (sonnet enough? deep-research fan-out cost?).
- Verdict (keep / adjust / fold into the skill) after ~2-3 uses — first = the v2 semantic-layer seam.

## Links
- `.claude/agents/engine-researcher.md` · `docs/research/README.md` · the `deep-research` skill.
- PIPELINE §7.4 (product-vs-process), §11 (conveyor). Parent process pattern: the dev-bus experiment.
