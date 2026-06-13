# Research findings — the conveyor's external-knowledge home

> **Process artifact (PIPELINE §7.4 — this is PROCESS, not product).** When a design/decompose seam
> turns on **external knowledge** the team doesn't readily have (best-practice · comparative · ToS/
> policy/licensing · library/SDK capability), the conveyor routes it to **`engine-researcher`**
> (`.claude/agents/engine-researcher.md`, sonnet) instead of guessing. The researcher fans out web
> search, verifies adversarially, and lands a **cited report here**. The decomposer / architect /
> conductor then decide from the evidence (discovery flows up, decisions flow down — §7).

## The research lane (third routing path)
- **design judgment** (which sound option fits our taste/north-star) → conductor, via the dev-bus.
- **frozen-contract / north-star / spec / ADR change** → Lior, §5.2 gate.
- **external knowledge the team lacks** → `engine-researcher` → a cited report here. ← this folder.

## Report convention
- File: `<YYYY-MM-DD>-<short-topic>.md`.
- Frontmatter: `title`, `date`, `triggered-by` (the feature/seam), `status: research` (not a spec/ADR).
- Body order: **(1) decision-oriented synthesis** (options · tradeoffs vs OUR constraints ·
  recommendation-if-evidence-supports, clearly separated from fact) → **(2) evidence** (every
  load-bearing claim CITED) → **(3) open / UNVERIFIED items** (single-source / stale / inferred).
- **Every load-bearing claim is `decision-grade` (corroborated) or `UNVERIFIED` — required distinction.**
- Cross-link: the spec/ADR that consumes a report links back to it; durable gotchas get promoted to
  `../known-gotchas.md` (product) or `../PIPELINE.md` (process) by the conductor.

## Why
Several past decisions had real external-knowledge uncertainty (provider abstraction, prior-art/
security baseline, ToS) researched ad-hoc. This makes research a **first-class, dispatchable conveyor
step with a durable, reusable home** — so the architect/decomposer build on evidence, not guesses, and
findings are reusable later. Rationale + pilot: `experiments/2026-06-13-engine-researcher.md`.
