# Chunk 6: Default flip + closing demo — ⚠️ SUPERSEDED (do NOT build)

**Status:** SUPERSEDED — 2026-06-13
**Superseded by:** the memory-distiller-v2 re-decomposition — see `v2-01` … `v2-05` in this folder,
spec `docs/specs/2026-06-13-memory-distiller-v2.md`, and the ADR-0012 re-derivability amendment.

## Why this is parked (do NOT revive)

This chunk would have flipped `MEMORY_PROVIDER` default `dumb-tail → smart`, making the **GLOBAL
RE-PROJECTION** distiller the default. Lior's 2026-06-13 LIVE demo proved that global re-projection +
a non-deterministic LLM = **UNSTABLE memory** (facts churn, reorder, and disappear across dismisses;
a forget re-wrote every fact; a reload showed a different, smaller set). The default-flip is therefore
**PARKED**. The distiller is being re-architected to **INCREMENTAL** (stable-id, FTS5-similarity); the
default cutover now lives in **`v2-05`**, after the incremental distiller exists.

The behavioral demo steps this chunk defined (memory ownership, precise recall, fact-forget,
message-forget, option-B) are **carried into `v2-05`** and extended with the new **stability**,
**"cannot self-forget"**, and **language-preservation** steps.

> Kept as a tombstone (uniform archive convention, PIPELINE §8). The shipped chunks 01–05 remain valid
> history; only the global-reprojection STRATEGY and this default-flip are superseded.
