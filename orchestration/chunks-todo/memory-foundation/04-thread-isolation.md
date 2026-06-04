# Chunk 04: Thread-isolation logic (5f) — cross-thread bleed rules via the scope tag

**Status:** todo
**Created:** 2026-06-04
**Phase:** Conversation & Interaction Model · route part 1 (Memory foundation)
**Estimated size:** ~1 day
**Depends on:** 02 *(sequence AFTER 03 per spec §6 F2 data-flow — what the write-gate admits feeds what isolation scopes)*
**Spec:** `orchestration/docs/specs/2026-06-04-memory-foundation.md` (§3.3) · **ADR:** [[../../docs/adr/0012-conversation-and-memory-model]] (decision 5f)

## Scope

This chunk **fills the PROVIDER-PORT + the `scope` tag** (established in chunk 02) with thread-isolation rules. It does **not** re-plumb the provider/inject path — only adds the isolation policy (spec §3.3 rule: *only fill, never re-plumb*).

**In:**
- **5f — thread-isolation against cross-thread bleed (ADR-0012 decision 5f):** one thread's working context does not silently leak into another **except** through the distilled, scanned, tagged super-chat path.
- **`scope`-tag enforcement:** thread-local-scoped facts stay thread-local; only cross-thread / global-scoped facts cross into another thread's injected slice. The retrieval/injection respects the `scope` tag set on `distilled_facts`.

**Out:** (each states WHY)
- **Re-plumbing the provider-port / injection-point** — OUT / **forbidden** (spec §3.3): fill the port + scope tag from 02, no new path.
- **Write-gate scan / no-overwrite (5d/5e)** — OUT, **chunk 03**.
- **Hatch UI / read API (5a)** — OUT, **chunk 05**.
- **A scope *taxonomy* beyond what 5f needs** (rich ACLs, per-fact sharing UI, etc.) — OUT; this is the bleed-prevention boundary, not a permissions system.

## Done criteria

- [ ] **[mechanical]** real-I/O: a `thread-local`-scoped fact from thread A does **not** appear in thread B's injected slice.
- [ ] **[mechanical]** real-I/O: a `cross-thread`/`global`-scoped fact from thread A **does** appear in thread B's injected slice.
- [ ] **[mechanical]** real-I/O: assert the isolation boundary — no cross-thread context crosses **except** via the distilled + scanned + tagged path (no raw `messages` leak between threads).
- [ ] **[mechanical]** `typecheck` + `lint:strict` + `bun test` green.

> No per-chunk live demo (spec §4) — real-I/O proof only.

## Orchestrator brief (read by the orchestrator from this file)

```
implement thread-isolation (cross-thread bleed rules via the scope tag)
per orchestration/docs/specs/2026-06-04-memory-foundation.md §3.3 and ADR-0012 (5f).

Files to touch (indicative):
- packages/daemon/src/memory/  (PROVIDER-PORT + scope-tag from chunk 02 — ADD isolation rules; no new path)

Done when (all real-I/O):
- thread-local facts never cross into another thread's injected slice;
- cross-thread/global facts do cross;
- no raw cross-thread bleed except via the distilled+scanned+tagged path;
- typecheck + lint:strict + bun test green.

ADRs in scope: ADR-0012 (5f).
Frozen — DO NOT: re-plumb the provider/inject path; build a permissions system; add UI (chunk 05).
```

## Notes / Open questions

- **§7.1 runtime-coupling (grill F2):** part of the 03 → 04 → 05 data-flow chain on the shared daemon+store. Re-validate the reality check at integration; isolation rules read what 03's write-gate admitted.
