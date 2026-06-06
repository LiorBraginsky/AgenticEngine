> 🗄️ ARCHIVED 2026-06-06 — done. Historical record; do not edit.

# Chunk 03: Write-gate logic — security-scan (5d) + no-silent-overwrite (5e)

**Status:** done
**Created:** 2026-06-04
**Phase:** Conversation & Interaction Model · route part 1 (Memory foundation)
**Estimated size:** ~1 day
**Depends on:** 02 *(the WRITE-GATE seam is from 01, but "scan before it enters the prompt" is only end-to-end provable once the injection path exists in 02)*
**Spec:** `orchestration/docs/specs/2026-06-04-memory-foundation.md` (§3.3) · **ADR:** [[../../docs/adr/0012-conversation-and-memory-model]] (decisions 5d, 5e; the poisoning↔CSWSH chain, known-gotcha #31)

## Scope

This chunk **fills the WRITE-GATE** (established as a pass-through in chunk 01) with policy. It does **not** re-plumb the write or inject path — only adds logic at the existing single gate (spec §3.3 rule: *only fill, never re-plumb*).

**In:**
- **5d — security-scan of memory writes** at the WRITE-GATE before they can later be injected. This is the **write-time scan** that defuses the memory-poisoning surface (ADR-0012 decision 5d; the #31 chain): nothing enters the archive/distilled layer that could auto-inject a crafted "fact" into every future thread.
- **5e — no-silent-overwrite of `authored_by:human` entries:** a machine distill/write **never** clobbers a human-authored fact or correction. What the user wrote or corrected is sacred (ADR-0012 decision 5e).

**Out:** (each states WHY)
- **Re-plumbing the write/inject path** — OUT / **forbidden** (spec §3.3): fill the single gate from 01, do not introduce a second write path.
- **Thread-isolation rules (5f)** — OUT, **chunk 04**.
- **Hatch UI / read API (5a)** — OUT, **chunk 05**.
- **A specific scanner engine/model choice** — left to the build; the requirement is *a* write-time scan at the gate, not a particular detector (start boring; the seam is what matters).

## Done criteria

- [ ] **[mechanical]** real-I/O: a crafted/poisoned write is rejected (or flagged-and-quarantined) at the gate and **never appears in a subsequent injected slice** — proven end-to-end through chunk-02's injection path (no mocked store/injection).
- [ ] **[mechanical]** real-I/O: a machine distill pass does **not** overwrite a `authored_by:human` fact/correction; the human entry survives byte-intact.
- [ ] **[mechanical]** **all** memory writes still flow through the single WRITE-GATE — assert no new write path was introduced (grep/structural check).
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

> No per-chunk live demo (spec §4) — real-I/O proof only.

## Orchestrator brief (read by the orchestrator from this file)

```
implement the write-gate policy (security-scan + no-silent-overwrite of human entries)
per orchestration/docs/specs/2026-06-04-memory-foundation.md §3.3 and ADR-0012 (5d, 5e).

Files to touch (indicative):
- packages/daemon/src/memory/  (the WRITE-GATE module from chunk 01 — ADD policy; do NOT add a new write path)

Done when (all real-I/O, end-to-end through chunk-02's injection path):
- a poisoned write is stopped at the gate and never reaches an injected slice (5d);
- a machine write never silently overwrites a human-authored entry (5e);
- every write still routes through the single gate (no second path);
- typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0012 (5d, 5e); known-gotcha #31 (the poisoning↔CSWSH chain this scan defuses).
Frozen — DO NOT: re-plumb the write/inject path; add isolation rules (chunk 04) or UI (chunk 05).
```

## Notes / Open questions

- **§7.1 runtime-coupling (grill F2):** 03 → 04 → 05 are a data-flow chain on the shared daemon+store (what 03 admits changes what 04 distills changes what 05 injects/surfaces). Build in that order or re-validate the reality check at integration — disjoint files do **not** make them independent.
- 5d/5e are **merged here** (both fill the one write-gate). If the build finds them genuinely separable, splitting is allowed — but neither may introduce a second write path.
- **Naming (grill S4):** this is **memory-foundation chunk 03 (MF-03)** — distinct from the LLM-slice's "chunk-03" (the `anthropic-api` adapter) referenced in `provider.ts`/`injector.ts` comments. Use MF-03 when grepping across routes.
