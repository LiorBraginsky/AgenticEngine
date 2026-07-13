# Chunk 01 — retarget the generic provenance line to the Memory window

Status: todo — **gated on spec acceptance** (`specs/2026-07-13-in-answer-provenance-affordance.md`, §5.2 Lior sign-off; do not start before the spec flips draft→accepted)
Feature: provenance-affordance
Depends on: none (single chunk)
Size: ~0.25 d

## What

The daemon-side generic provenance line appended to every memory-using reply
(`packages/daemon/src/memory/provenance-stamp.ts`) still points at the browser fallback:

```
— this reply used remembered context · view in History: http://127.0.0.1:<port>/history.html
```

Theme A (2026-07-10) shipped the in-overlay Memory window (tray → "Open Memory…"), demoting
`history.html` to the no-install fallback — the line is now a stale pointer, rendered as inert
plain text in the overlay anyway (`text-reply.ts` is `textContent`-only, the URL was never
clickable). Retarget it to teach the tray path:

```
— this reply used remembered context · view: menu-bar → Open Memory…
```

(Exact final wording = worker's call at build; MUST match the live tray label — verify against
`apps/overlay/src-tauri/src/lib.rs:105` (`"Open Memory…"`). Per the spec §0.3 ruling the
`history.html` URL is dropped — the overlay is by definition running when the line renders, so
the tray path is always available. Wording bonus context: Lior's recorded polish wish on this
exact string — «привабливіше» (MF route-closing demo, ledger 2026-06-11) — this chunk is also
that polish landing; keep the line short, but it may as well read well.)

## Tasks

1. Reword the string in `provenanceLine()`; drop the now-unused `port` parameter.
2. Ripple the signature: `stampProvenance(env, port)` → `stampProvenance(env)` + the call site
   in `packages/daemon/src/index.ts` (the `injectedMemory`-gated `send()` path). If `port` has
   no other consumer on that path, remove its plumbing; do not refactor beyond the ripple.
3. Update **every consumer that pins the string** (critic-verified list — grep
   `used remembered context` / `history.html` at build to re-confirm):
   - `provenance-stamp.test.ts`;
   - `provenance-stamp.daemon.test.ts` — 6 positive `toContain("/history.html")` assertions
     **plus 2 negative ones (~lines 399, 414)**; ⚠️ the negatives MUST be re-keyed to the new
     marker text, otherwise they keep checking the old string and pass **vacuously**;
   - `packages/daemon/scripts/memory-demo-harness.ts` (~lines 644-647) — the real-mode
     provenance probe does `reply.includes("/history.html")`; left stale it false-reports
     "no provenance stamps" on every real run.
4. Full gate: `bun test` + `lint:strict` + typecheck + **frozen byte-diff empty**
   (`@agentic/protocol`, mock provider/reducer).

## Scope-cut rationale (PIPELINE §7.2)

- **Why this exact scope:** the spec resolved the Theme A carve-out to "retarget the
  already-blessed affordance" (bus ruling q#016, O1). The affordance *mechanism* (daemon text
  append gated on `injectedMemory`) is demo-blessed since MF-05 and stays byte-identical in
  shape; only the string and a dead parameter change.
- **Deliberately NOT in scope** (recorded in the spec — do not freelance): any overlay change
  (no chip, no link parsing in `text-reply.ts`), any wire/protocol touch, any Memory-window
  deep-link, per-fact anything, `history.html` changes. If implementation reveals the string
  change forcing anything beyond the named files → STOP, flag up (that would falsify the
  spec's zero-contract-risk claim).
- **DoD tier:** mechanical (§6.2 command evidence). No behavioral demo — the visible behavior
  (a line of text under memory-using replies) is unchanged in kind; §6.1 was satisfied for
  this affordance at the MF-05 route-closing demo (step 6).

## Verification

- RED-first is overkill for a string constant; instead: update the pinned-string tests FIRST,
  see them fail, then change the source (cheap direction-proof, same spirit).
- Command evidence in the PR body: test count, lint/typecheck zeroes, frozen-diff-empty output.
