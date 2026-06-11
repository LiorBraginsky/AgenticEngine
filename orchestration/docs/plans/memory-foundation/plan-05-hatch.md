# Plan — MF-05 (5a): Transparency hatch — view/edit/forget + provenance affordance + route-closing demo

**Chunk:** `orchestration/chunks-todo/memory-foundation/05-hatch-view-edit-forget.md`
**Feature:** memory-foundation (route part 1) · final chunk
**Spec:** `orchestration/docs/specs/2026-06-04-memory-foundation.md` §3.3/§3.4/§3.5/§4.1/§4.2/§7
**ADRs in scope:** 0012 (5a, 5b-surface, decision 3), 0005 (closed-set), 0003 (daemon WS — Tranche-2 boundary)

## Status

**Phase 3 — Tranche 2 MECHANICAL VERIFIED-DONE + review-complete → `BLOCKED: live-demo` (2026-06-10).** Branch `chunk/mf-05-hatch-tranche2` (7 commits, 49707ee..c427506). Tranche 1 was MERGED as PR #28 (7049383); ADR-0013 accepted Option B (ca30317).

**Tranche-2 verification (command-evidence, orchestrator-re-run — not worker assertion):**
- `bun run typecheck` → exit 0 · `bun run lint:strict` → exit 0
- `bun test` (full repo) → **275 pass / 0 fail** (daemon subset 169; T1 baseline 143 → +26 new T2 tests, no regression)
- frozen `packages/protocol` + `mock-agent.ts` + `mock-provider.ts` → byte-unchanged vs merge-base c9415cc (`git diff --stat` empty)
- **engine-reviewer: 0 Critical / 0 Major.** 2 Minor + 1 Nit fixed in follow-up pass c427506 (`mutations`-table comment accuracy; guarded `decodeURIComponent` → 400 not 500; mapWriteError coupling comment). Flagged-not-built: typed error codes for mapWriteError (upgrade path if more throw sites appear); `Hatch` discriminated-result refactor (goes live with a future machine-actor HTTP path).
- Proves DoD **#3** (provenance = `show_text` closed-set, no escalation — mechanical leg) on top of T1's #1/#2/#6. DoD **#4, #5** are behavioral → **Lior's route-closing live demo (T2.4), NOT runnable/signable by this chat**; demo additionally still blocked on CM-01 for steps 2-4 (Gates summary #2).

**Demo-ready state:** daemon serves `GET /memory/threads`, `GET /memory/thread/:id`, `GET /history.html` (open on loopback) + token-gated `POST /memory/edit|forget` (`<dataDir>/auth-token`, 0600); cross-thread memory replies carry the provenance line → History URL. PR opened; merge AFTER demo sign-off (auto-merge precondition "demo-if-behavioral" is red until then).

**Tranche-1 verification (command-evidence, orchestrator-re-run — not worker assertion):**
- `bun run typecheck` → exit 0 · `bun run lint:strict` → exit 0
- `bun test packages/daemon` → **143 pass / 0 fail** (8 new hatch real-I/O tests + 4 fix-pass tests; no regression)
- frozen `packages/protocol` → byte-unchanged vs `main` (`git diff --stat` empty)
- **engine-reviewer: 0 Critical / 0 Major.** 2 Minor + 1 Nit all fixed in a follow-up pass (UUID-shape guard on `forgetFact`/`tombstoneFact` to enforce the seam invariant; a direct cross-thread `edit→distill→retrieve` test closing DoD #2's edit case; `HATCH_VIEW_FACT_CAP` named constant).
- Proves DoD **#1, #2, #6** with real-I/O evidence. DoD **#3, #4, #5** are Tranche 2 (gated — NOT built).

**Tranche-2 gate ledger (updated 2026-06-10):** gate 1 (ADR-0013 acceptance) → ✅ RESOLVED (Option B, accepted by Lior 2026-06-10). Gates 2 (CM-01 prerequisite) + 3 (live demo) remain — see Gates summary. The chunk is **NOT `done`** (behavioral DoD pending); chunk file stays `in-progress`, not archived.

**Tranche-2 carry-forwards (both resolved in the T2 design sections below):** (reviewer Minor 2) `Hatch.view` stays full-live-slice — see *`Hatch.view` shape for HTTP*; (T1 merge-review forward-flag) `WriteGate.forgetFact` discarded-boolean → refused/error HTTP mapping decided + tested — see *Refused-forget HTTP semantics*.

---

## Definition-of-Done tagging (orchestrator, Phase 0 — drives the verified-done gate §6)

| # | DoD criterion | Class | Tranche | Provable in this chat? |
|---|---|---|---|---|
| 1 | `view`/`edit`/`forget` over the **real store** (no mocks) | **mechanical** | 1 | ✅ command-evidence |
| 2 | forgotten/edited item reflected in **next thread's injection** | **mechanical** | 1 | ✅ command-evidence (projection-tombstone) |
| 3 | in-overlay provenance affordance is an **ADR-0005 closed-set primitive** | **mechanical** | 2 | ⚠️ primitive chosen (`show_text`, no escalation) but build is gated |
| 4 | **ROUTE-CLOSING LIVE DEMO** (6-step, macOS) | **behavioral** | 2 | ❌ Lior-gated §6.1 **+ blocked on CM-01** |
| 5 | provenance affordance visible & leads into History (demo step 6) | **behavioral** | 2 | ❌ Lior-gated §6.1 |
| 6 | `typecheck` + `lint:strict` + `bun test` green | **mechanical** | 1 | ✅ command-evidence |

Tranche 1 proves criteria **1, 2, 6** with real-I/O evidence. Criteria **3, 4, 5** are Tranche 2 (gated).

---

## Reality check (architect, authoritative — file-cited)

The foundation (MF-01..04, merged) is substantially built; MF-05 mostly **fills a read API + one real seam (projection-tombstone)** — it does **not** re-plumb the write/inject path.

- **Store + tables** — `packages/daemon/src/memory/store.ts` (`MemoryStore`) over `schema.ts` (`SCHEMA_DDL`): `threads`, `messages`, `mutations`, `distilled_facts`, `distillation_events`, `quarantine_markers`.
- **Write-gate** — `packages/daemon/src/memory/write-gate.ts` (`WriteGate`): **`edit()`** (appends `correction`) + **`forget()`** (appends `tombstone` + hard-scrubs `messages.content`→`REDACTION_MARKER` + redacts JSONL mirror) **already exist and route through the gate** (5e `isHumanAuthored` guard present). MF-05 adds a *read* API + wires the hatch caller — it does not rebuild edit/forget.
- **Injection-point** — `thread-lifecycle.ts` `ThreadLifecycle.beginTurn` → `memoryProvider.retrieve(store, threadId)`; port `memory-provider.ts` (`MemoryProvider.distill/.retrieve`).
- **Tombstone-honoring re-derive** — `providers/dumb-tail-provider.ts` `distill()` filters `REDACTION_MARKER`; `retrieve()` filters `!store.isMessageTombstoned(provenance)`.
- **Live-slice purge (grill-S2)** — `WriteGate.forget` already calls `dropDistilledFactsByProvenance` + `dropDistilledFactsForThread` (machine-only guarded).
- **`distillation_events`** — written every dismiss (even empty) by `distiller-registration.ts`; read via `store.readDistillationEvents`.
- **Daemon is pure-WS** — `index.ts` `Bun.serve`: `fetch` origin-gates→`upgrade()` (403/400) + `websocket` handler. No HTTP route-serving today.
- **`web-admin` does NOT exist** — only `apps/overlay`, `packages/daemon`, `packages/protocol`.
- **Overlay primitives = two** — `color-picker` (interactive) + `text` (`show_text`, display-only, `apps/overlay/src/widgets/text-reply.ts` ← `TextPrimitive` in `packages/protocol/src/primitives.ts`). Envelope union (`packages/protocol/src/envelope.ts`) is the byte-frozen surface.

### 🚩 FLAG — FOUNDATION GAP (the one real seam to fill; = the S1 carry-forward)
The **projection-tombstone**. Existing `forget-survives-re-derive` (`distiller-integration.daemon.test.ts:117`) only covers forget targeting a **`messages.id`** (re-derive then sees `REDACTION_MARKER`). It does **not** cover forgetting a **distilled fact whose source turns stay live** — esp. a **thread-level-provenance** fact (`provenance="thread:<id>"`), where `isMessageTombstoned("thread:<uuid>")` is structurally always false (`fixed-marker-provider.test.ts:103`) and the next `distill` rebuilds it. Per spec §3.3 this is **5a territory, additive (not re-plumb)** — design below. **Tranche 1.**

### 🚩 FLAG — PREREQUISITE NOT BUILT: CM-01 (blocks the route-closing demo)
`apps/overlay/src/ws/session-client.ts` still opens a WS per turn and `ws.close()`s on `session_end` (lines 165-167). connection-model spec §4.1 names **CM-01** (persistent WS + `close(ws)`→dismiss + overlay `thread_id` continuation) as the hard prerequisite for **demo steps 2-4** (within-thread multi-turn, dismiss→consolidate, cross-thread re-summon). MEMORY.md + memory-foundation spec §6 say *"CM-01 slots after MF-04 before MF-05,"* but **no CM chunk file exists** in `chunks-todo/`. → **The Tranche-2 demo cannot run on the real overlay until CM-01 ships.** Does not block Tranche 1. **Lior/Jimmy must resolve sequencing** (build CM-01 first, or approve a demo harness).

---

## Surface & security (Tranche 2 — orchestrator-decided surface, Lior-gated caller-auth)

**Surface (decided):** daemon-served minimal HTTP History surface — JSON `/memory/*` read/edit/forget API + a minimal static `history.html` on the existing `Bun.serve` `fetch` handler. Exercises §3.5's sanctioned "admin-tab HTTP" option. NOT a web-admin SPA (scope-forbidden), NOT overlay-as-management (against §3.5). Consumes the Tranche-1 transport-agnostic API.

**✅ RESOLVED 2026-06-10 — ADR-0013 accepted, Option B** (read-open-on-loopback, write-requires-token; the read-token rider is a hardening-pass / pre-public-release gate, NOT T2's). The original question, kept for history:

**🚩 Open caller-auth question (Lior must rule — the ADR substance):** the only caller-gate today is the **Origin allowlist** on the WS upgrade (`origin.ts`, ADR-0003 Amendment) — **#31-spoofable by non-browser clients** and **only guards the WS upgrade**, nothing for a new HTTP route. A `/memory/*` edit/forget route is a **new localhost memory-write surface any local process can hit** (the #31 CSWSH↔poisoning chain ADR-0012 dec.5 names). 5d/5e/5f protect write *content*, **not the caller**. Options:
- **(A)** Un-defer the per-install WS token (ADR-0003 p.5) as an HTTP bearer on all `/memory/*`.
- **(B, architect-recommended)** read-open-on-loopback / write-requires-token (`POST`/`DELETE` gated).
- **(C)** Origin-allowlist parity on the HTTP route — weakest (same #31 spoofability), interim only.

---

## Projection-tombstone design (Tranche 1 — the crux of DoD #2)

A **fact-level tombstone** on the existing `mutations` table, honored by `distill` + `retrieve`. Additive — no new table, no write/inject re-plumb.

**Three function-cited hooks:**
1. **`MemoryStore.tombstoneFact(provenance, ctx)`** (new, `store.ts`) — append `mutations` row `kind='tombstone'`, `target_message_id=provenance` (TEXT col accepts `"thread:<id>"`). 5e guard: refuse machine-tombstone of an `authored_by:'human'` fact.
2. **`MemoryStore.isFactTombstoned(provenance): boolean`** (new) — `SELECT 1 FROM mutations WHERE target_message_id=? AND kind='tombstone'`. Generalizes `isMessageTombstoned` (its message-id case is a subset).
3. **Honor at re-derive + inject** — both providers (`dumb-tail-provider.ts`, `fixed-marker-provider.ts`): `distill` drops facts where `isFactTombstoned(provenance)`; `retrieve` replaces `isMessageTombstoned` with `isFactTombstoned` (strict superset, no regression).

**Hatch forget routing:** message-id target → existing `WriteGate.forget`; distilled-fact-provenance target → new `WriteGate.forgetFact(provenance, ctx)` = `tombstoneFact` + existing live-slice purge. Result: gone from live slice immediately **and** suppressed on every future re-derive.

**Load-bearing failing test (TDD anchor, T1.2):** forget a `thread:<id>` FixedMarker fact; drop+re-derive with source turns still live; assert it does NOT re-appear in `distill` NOR `retrieve`. Fails today (proves the gap), passes after the three hooks.

---

## Provenance affordance (Tranche 2 — primitive decided now, NO escalation)

Composes from the existing **`show_text`** closed-set primitive — **no new overlay primitive, no Q2/ADR escalation**. The daemon stamps a provenance line into the `show_text` content when a reply drew on injected memory (it already prefixes injected slice `[remembered] ...`, `dumb-tail-provider.ts:58`); the "leads into History" link is the URL `http://127.0.0.1:7777/history` opened via the overlay's existing browser-open path — not a new interactive primitive. **🚩 If at build the text-line is judged insufficient for §7 discoverability → separate Q2/ADR escalation; do NOT invent a primitive.**

---

## ADR worthy: yes

**Title:** "Daemon memory-write HTTP surface + caller-auth model." Records (a) the new `/memory/*` HTTP route family on `localhost:7777` (first mutating non-WS route — ADR-0003 p.4 anticipated HTTP for *large-asset transfer*, NOT memory writes), (b) the caller-auth ruling (A/B/C above) + relation to the deferred per-install token + security-hardening pass, (c) a note that 5a closed the S1 projection-rebuild gap. Route to `adr-curator`; **Lior accepts before T2.1 builds.**

---

## HTTP surface design (T2 — re-validated against main @ 7049383)

ADR-0013 **Option B** is accepted and binding. The `/memory/*` family lives on the
**existing** `Bun.serve` `fetch` handler (`packages/daemon/src/index.ts:51`), wired onto
the **existing** transport-agnostic `Hatch` façade (`packages/daemon/src/memory/hatch.ts`,
built by T1 for exactly this). No new write path — the route calls `Hatch.view/edit/forget`
(spec §3.3 "fill, don't re-plumb").

### Route table (the complete closed set for T2)

| Method | Path | Auth | Hatch call | Body / response |
|---|---|---|---|---|
| `GET` | `/memory/threads` | none (loopback) | `store.listThreads()` *(new thin read, below)* | `200` JSON `{threads:[{thread_id,title,last_active_at}]}` |
| `GET` | `/memory/thread/:id` | none (loopback) | `hatch.view(id)` | `200` JSON `HatchViewResult` |
| `POST` | `/memory/edit` | **bearer token** | `hatch.edit(messageId, replacement, ctx, reason)` | `204` on success; `403` no/bad token; `409` refused-edit (below); `400` bad body |
| `POST` | `/memory/forget` | **bearer token** | `hatch.forget(target, ctx, reason)` | `204` on success; `403` no/bad token; `409` refused-forget (below); `400` bad body |
| `GET` | `/history.html` | none (loopback) | — (static) | `200` `text/html` |

- **`ctx` is fixed server-side**, NOT taken from the body: every HTTP-originated mutation is
  `{ actor: "user", authored_by: "human" }`. The HTTP caller IS the human operator at the
  hatch (that is the whole point of the token gate). This means the 5e machine-clobber guards
  in `WriteGate` will **never refuse** an HTTP edit/forget on `authored_by` grounds — see
  *Refused-forget HTTP semantics* for why a `409` path still exists and what actually triggers it.
- **No `DELETE` verb.** Forget is modeled as `POST /memory/forget` (a command, not a REST
  resource deletion) so the body can carry `{target, reason}`. ADR-0013 says "`POST`/`DELETE`
  … require the token"; we use `POST` for both mutations — still inside the ruling (the ruling
  gates *mutating* verbs; it does not mandate `DELETE`). Keeps the parser to one shape.

### Where it slots in `index.ts` `fetch` (the load-bearing wiring concern)

**Reality check — the origin gate runs FIRST today and would 403 the history page.**
`index.ts:53` returns `403 Forbidden origin` for any request whose `Origin` is not in
`ALLOWED_ORIGINS` (`origin.ts:9`: only the three Tauri/Vite origins). A browser opening
`http://127.0.0.1:7777/history.html` sends `Origin: http://127.0.0.1:7777` (or `null`), which
is **not** allowlisted. Therefore `/memory/*` routing MUST be inserted **before** the
origin-gate, and must `return` its own `Response` so it never falls through to `server.upgrade`.

The control flow becomes (T2.1a):

```
fetch(req, server):
  url = new URL(req.url)
  if url.pathname startswith "/memory/" OR url.pathname === "/history.html":
      return handleMemoryHttp(req, url, deps)   // NEW — returns a Response, never upgrades
  // ── unchanged below: WS upgrade path keeps the origin gate ──
  if (!isOriginAllowed(req.headers.get("origin"))) return 403
  if (server.upgrade(...)) return undefined
  return 400
```

- The WS upgrade path (origin gate → `upgrade()` → 403/400) is **byte-unchanged** below the new
  branch. `handleMemoryHttp` is a pure function over `(req, url, {hatch, store, tokenStore})` so it
  is unit-testable against a real store without standing up `Bun.serve`, AND exercised through the
  real server in the daemon integration test (spec §4.2 real-I/O bias).
- The `/memory/*` routes deliberately do **not** consult `isOriginAllowed`. Per ADR-0013 the
  caller-gate for this surface is the **token on writes**; reads are open-on-loopback. Adding the
  spoofable Origin check here would be Option C (rejected) and would also break the browser history
  page. The loopback bind (`DAEMON_HOST = "127.0.0.1"`, index.ts:15) is the only network-level
  guard on reads, which is exactly what Option B accepts.

### New thin store read (additive SELECT only)

`GET /memory/threads` needs a thread list for `history.html` to link into. `Hatch` has no
list-threads method and `view` is per-thread. Add one additive SELECT to the store
(`MemoryStore.listThreads()`), NOT to `Hatch` (keeps the façade's three verbs clean):
`SELECT thread_id, title, last_active_at FROM threads ORDER BY last_active_at DESC`.

---

## Token interim mechanics (T2 — minimal, ADR-0013 + ADR-0003 p.5 consistent)

ADR-0013 commits *that* writes are token-gated, **not how the token is minted** (full
mint/storage mechanics — Keychain, generation-on-install — belong to the hardening pass,
ADR-0013 "Explicitly NOT decided"). This plan picks the **minimal interim** that is
forward-compatible with ADR-0003 p.5 ("per-install secret token, file-system-permission-protected").

### Mint + storage

- **Location:** a token file at `<dataDir>/auth-token` where `dataDir` is the daemon's existing
  data dir — `Bun.env.AGENTIC_DATA_DIR ?? join(homedir(), ".agentic-engine")` (index.ts:39).
  Same dir as `memory.sqlite` and `threads/`. **Cited:** index.ts:39, store.ts:65-67.
- **Generation:** on first daemon start, if `<dataDir>/auth-token` does not exist, mint 32 random
  bytes hex via `crypto.getRandomValues`, write with file mode `0o600` (owner-only). If it exists,
  read it. This is the `TokenStore` seam (T2.1b).
- **Comparison:** direct `===` on the bearer value is the accepted interim (timing-attack
  resistance is the hardening pass's job). The seam (`TokenStore.verify(bearer): boolean`) lets the
  hardening pass swap the impl without touching the route.

### How `history.html` (a browser page) gets the token for write actions

ADR-0013's threat model names **two** attackers: (1) a non-browser local process, and (2) a
cross-site browser tab. The token must defeat **both**.

- ❌ **Rejected: a loopback GET that returns the token** (e.g. `GET /memory/token`) — defeats the
  entire gate: attacker (1) just fetches it. The token must never be served over an
  unauthenticated route. Explicitly do NOT build this.
- ✅ **Chosen: user pastes the token into `history.html` once per page load.** The page has an
  "Unlock writes" field; the user copies the token from `<dataDir>/auth-token` (the page shows the
  literal path, e.g. `~/.agentic-engine/auth-token`). The pasted value is held in a JS variable
  (memory only — NOT `localStorage`, so a later cross-site tab cannot read it) and sent as
  `Authorization: Bearer <token>` on `POST /memory/edit|forget`.
  - **Defeats attacker (1):** a non-browser process has no token unless it can already read the
    `0o600` owner-only file — and then it already has the user's whole home dir; the token adds no
    new exposure. The file-permission IS the gate.
  - **Defeats attacker (2):** a cross-site tab cannot read the `0o600` file nor the in-memory JS
    variable of a separate-origin page. It can still hit open `GET` reads (accepted
    read-disclosure, ADR-0013 Trade-offs) but cannot mint a write.
  - **Cost:** paste-per-page-load friction — accepted for the single-user dev phase (the ADR's
    "staged interim").

> **🚩 requires runtime demo to confirm** — the paste→bearer→`204` round-trip in a real browser is
> behavioral; tests prove the server-side gate (real `Bun.serve`, real header) only.

---

## Refused-forget HTTP semantics (T2 — T1 reviewer carry-forward, BINDING)

**The carry-forward (verified in code):** `WriteGate.forgetFact` (write-gate.ts:115-136) calls
`store.tombstoneFact` (store.ts:226-254), which **returns a boolean** — `false` when a
machine-actor tombstone of a human-authored distilled fact is refused (5e guard,
store.ts:240-247). `forgetFact` **discards** that boolean (write-gate.ts:128). Analogous swallowed
results audited: `WriteGate.forget` 5e-refuses via silent early `return` (write-gate.ts:76);
`WriteGate.edit` likewise (write-gate.ts:156); `Hatch.edit/forget` are `void`.

**Why this was safe in T1 and is NOT a 409-generator over HTTP:** the daemon always stamps HTTP
`ctx` as `{actor:"user", authored_by:"human"}` (route table above), so **the 5e machine-clobber
guard never fires on the HTTP path** — `tombstoneFact` returns `true` on every HTTP forgetFact.

**But two real error conditions MUST be distinguishable from success over HTTP**, and the `void`
signatures hide both:

1. **Edit/forget of a non-existent `messageId`** — `threadOf` THROWS `message <id> not found`
   (write-gate.ts:186-189); an uncaught throw would 500. MUST map to **`404`**.
2. **`forgetFact` on a UUID-shaped provenance** throws by design (write-gate.ts:121-126, seam
   invariant); normally unreachable via `Hatch.forget` routing — defensive **`400`**.

**Decision (BINDING):** the **route handler** wraps `hatch.edit/forget` in `try/catch` and maps:
"not found" throw → `404 {error:"target_not_found"}`; UUID-shape throw →
`400 {error:"bad_target_shape"}`; success → `204`. **The 5e-refusal `409` is reserved but
documented as currently-unreachable on the human-only HTTP path** — it goes live the moment a
non-human HTTP actor is introduced (a later ADR), at which point `Hatch.forget/edit` must surface
the boolean. T2 adds the `404`/`400` mapping plus a test asserting human-actor forget of a human
entry returns `204` (the "refusal-does-not-fire-on-HTTP" proof).

> ☆ Alternative considered: make `Hatch.edit/forget` return a discriminated result now and map
> `reason→409`. **Rejected for T2** — signature churn for a path that cannot fire on the
> human-only HTTP surface (YAGNI); flagged for the future machine-actor ADR, not built.

---

## `Hatch.view` shape for HTTP (T2 — T1 reviewer Minor 2 carry-forward)

**Decision: `view` stays full-live-slice — no pagination, no thread-scoping change.**

- `Hatch.view` (hatch.ts:52-62) returns this thread's full archive + the **full** live projection
  (capped at `HATCH_VIEW_FACT_CAP = 1000`) + this thread's `distillationEvents`. Single-user
  dev-phase hatch; the cap is already a safety bound; pagination now is the "needless ceremony"
  spec §3.3 warns against.
- HTTP maps **1:1**: `GET /memory/thread/:id` → `hatch.view(id)` → `HatchViewResult` as JSON. The
  `:id` path param IS the thread-scoping for messages; `distilledFacts` stays whole-slice — that
  is the *point* of a memory-management hatch.
- **🚩 If 1000 facts is unusable in the browser at demo time** → pagination is a *later* chunk's
  decision, not a T2 blocker. Do NOT add speculatively.

---

## Provenance-line mechanics (T2.3 — re-validated; NO new primitive, NO browser-open path)

**Reality check — three load-bearing findings from main:**

1. **Detection point is the daemon, not the provider.** The injected slice is `[remembered] `-
   prefixed by both providers (dumb-tail-provider.ts:65, fixed-marker-provider.ts:62), hydrated as
   `priorMessages` at `ThreadLifecycle.beginTurn`'s new-thread branch (thread-lifecycle.ts:54-56).
   The provider (anthropic-api-provider.ts:215) receives `state?.messages` and **cannot
   distinguish** injected memory from a same-thread tail. The daemon's `index.ts` handler KNOWS:
   on a new-thread `session_start`, `begin.priorMessages` came from `retrieve`
   (index.ts:103-112). The daemon is the correct, frozen-safe stamp point.
2. **Frozen boundary:** we do NOT edit the provider. The daemon's outbound `send` loop
   (index.ts:147) appends a provenance line to the `TextPrimitive.content` of a `show_text`
   `tool_call` — `content` is an **unconstrained string** (primitives.ts:47-51), so the append is
   purely additive; envelope union / primitives / tools byte-unchanged.
3. **NO browser-open path exists in the overlay** (`renderTextReply` uses `textContent` only,
   text-reply.ts:31; no opener anywhere in apps/overlay/src/). → the affordance is the **literal
   URL text** in the show_text content (ADR-0005-compliant: composes the existing `text`
   primitive; no new interactive primitive, no Q2/ADR escalation). "Leads into History" = the user
   opens `http://127.0.0.1:7777/history.html`.

**Mechanics (T2.3a):** per-turn flag `injectedMemory = true` ONLY on the new-thread branch where
`begin.priorMessages` came from `memoryProvider.retrieve` AND length > 0 (index.ts:103-112 —
distinct from same-thread hydration, index.ts:114-117, which is the user's own prior turns, NOT
"remembered context"). In the `send` loop, when the flag is set, `stampProvenance(env, port)`
appends `\n\n— this reply used remembered context · view in History: http://127.0.0.1:<port>/history.html`
to `show_text` content; non-`show_text` envelopes pass through untouched. Re-validate the stamped
envelope with the existing `parseEnvelope` defense in `send` (index.ts:27).

> **🚩 requires runtime demo to confirm** — *visible discoverability* in the overlay card (demo
> step 6) is the `[behavioral]` DoD #5; unit tests prove only that the line is present in the
> outbound envelope.

---

## Steps

### TRANCHE 1 — BUILD NOW (gate-free; real-I/O proven; branch `chunk/mf-05-hatch-tranche1`)

- **T1.1 — Read API over archive + distilled facts + distillation_events.** New `packages/daemon/src/memory/hatch.ts` (`Hatch(store, gate)` façade) + `MemoryStore.readThreadArchive`. TDD: failing real-I/O test → `hatch.view(threadId)` returns `{messages, distilledFacts, distillationEvents}` through the real store; tombstoned rows surface as `REDACTION_MARKER`. Additive SELECTs only.
- **T1.2 — Projection-tombstone (S1 fill) + edit/forget façade.** The three hooks above + `WriteGate.forgetFact` + `Hatch.edit/forget` dispatch. TDD: (a) forget-machine-projection survives re-derive (thread-level provenance — the load-bearing test); (b) edit→`authored_by:human` correction reflected in next injection; (c) forget→tombstone+hard-scrub absent from next injection; (d) **no regression** in existing MF-02/03 forget tests.
- **T1.3 — Surface distillation_events (incl. empty consolidation) + façade smoke.** `view` returns `readDistillationEvents` verbatim incl. `facts_produced===0` rows (5b: "deliberately retained nothing" ≠ "silently lost").

**Tranche-1 verified-done:** all real-I/O tests pass + `typecheck` + `lint:strict` + `bun test packages/daemon` green (command-evidence) + reviewer-clean.

### TRANCHE 2 — BUILD NOW (ADR-0013 ACCEPTED Option B; branch `chunk/mf-05-hatch-tranche2`)

> **Gating status (re-validated 2026-06-10):** ADR-0013 is **accepted (Option B)** — T2.1/T2.2/T2.3
> are **unblocked**. T2.4 (live demo) remains **Lior-gated §6.1** and is **NOT built/run by this
> chat**; it also still depends on CM-01 for demo steps 2-4 — that sequencing is Lior/Jimmy's call.
> **No frozen surface is touched by any T2 step** (token = HTTP header outside the envelope;
> provenance = unconstrained-string growth inside an existing `show_text`). If any step would
> require editing `packages/protocol/**`, `mock-agent.ts`, or `mock-provider.ts` → STOP, freeze gate.

**Worker discipline:** TDD per `superpowers:test-driven-development` — failing test first, red,
minimal impl, green, commit per task with the `Co-Authored-By` trailer. **Real-I/O bias (spec
§4.2):** route tests exercise the real `Bun.serve` fetch handler + real `MemoryStore` over a
`mkdtempSync` data dir — no mocked store/handler. **No-regression bar:** workers re-run
`bun test packages/daemon` BEFORE adding tests to confirm the live baseline (T1 recorded 143
pass / 0 fail for the daemon subset; full-repo `bun test` ≈ 249), then keep it green on top.

- [x] **T2.1a — DONE (49707ee; 143→146 pass/0 fail; typecheck+lint:strict exit 0; protocol diff empty) — Memory HTTP handler skeleton + read routes (open on loopback).**
  Create `packages/daemon/src/memory/http-routes.ts` (`handleMemoryHttp(req, url, deps)` pure fn:
  `GET /memory/threads` → `store.listThreads()`; `GET /memory/thread/:id` → `hatch.view(id)`;
  404 otherwise). Add `MemoryStore.listThreads()` (additive SELECT). Modify `index.ts` fetch:
  insert the `/memory/*` + `/history.html` branch BEFORE the origin gate; construct
  `Hatch(store, gate)` in `startDaemon`. Failing-test anchors
  (`http-routes.daemon.test.ts`, real daemon on ephemeral port + mkdtemp `AGENTIC_DATA_DIR`):
  (1) `GET /memory/threads` без token → 200 + seeded thread; (2) `GET /memory/thread/:id` →
  `{messages, distilledFacts, distillationEvents}`; (3) WS path byte-unchanged — disallowed
  Origin on `/` still 403s. Evidence: new tests green + `bun test packages/daemon` no regression.
- [x] **T2.1b — DONE (f098d87; 146→153 pass/0 fail; typecheck+lint:strict exit 0; frozen unchanged) — Token mint/storage seam (`TokenStore`).**
  Create `packages/daemon/src/memory/token-store.ts`: read-or-mint `<dataDir>/auth-token`
  (32 random bytes hex, mode `0o600`); `token(): string`; `verify(authHeader): boolean`
  (requires `Bearer ` scheme). Wire into `startDaemon` + `MemoryHttpDeps`. Failing-test anchors
  (`token-store.test.ts`): mints 0600 on first start + reuses on second; verify() accepts minted
  token, rejects wrong/missing/scheme-less. Evidence: tests green + no regression.
- [x] **T2.1c — DONE (7309f1e; 153→158 pass/0 fail; typecheck+lint:strict exit 0; frozen unchanged; edit-leg HTTP test proves mutation-row-on-disk, injection leg cited to T1 `Fix-2` in hatch.daemon.test.ts) — Token-gated write routes + refused/error mapping.**
  Extend `http-routes.ts`: `POST /memory/edit` + `POST /memory/forget`; no/bad bearer → 403;
  bad JSON/body → 400; `ctx` fixed server-side `{actor:"user", authored_by:"human"}`;
  try/catch maps "not found" → 404 `target_not_found`, UUID-shape throw → 400
  `bad_target_shape`; success → 204. Failing-test anchors: 403-without-token;
  204-with-token + **real-disk redaction** (`messages.content` → `REDACTION_MARKER`);
  404-unknown-id (no 500); edit→204 + corrected content reflected in next-thread injection
  (DoD #2's edit case over HTTP, real-I/O). Evidence: tests green + no regression.
- [x] **T2.2a — DONE (9e46e9d; 158→159 pass/0 fail; typecheck+lint:strict exit 0; frozen unchanged; token = in-memory JS var, no localStorage) — Minimal static `history.html` (History slice ONLY).**
  Create `packages/daemon/src/memory/history-page.ts` (exports `HISTORY_HTML` string constant —
  no static-file-path resolution); route `GET /history.html` → `text/html`. Page: thread list via
  `GET /memory/threads`; click → `GET /memory/thread/:id` (messages + facts + events); "Unlock
  writes" token field (memory-only JS var, NOT `localStorage`); per-row edit/forget POSTs with
  bearer. API data inserted via `textContent`/DOM creation ONLY (never `innerHTML`). NOT an SPA;
  no settings/plugins/devtools. Failing-test anchor: `GET /history.html` → 200 text/html,
  contains "History" + `/memory/threads`, does NOT contain `localStorage`. Evidence: tests green
  + no regression. 🚩 browser rendering/paste-UX = behavioral, demo-gated.
- [x] **T2.3a — DONE (ea7d8c7; 159→168 pass/0 fail; typecheck+lint:strict exit 0, orchestrator re-ran typecheck → exit 0; frozen unchanged; helper in memory/provenance-stamp.ts; integration via fake-client anthropic provider through `startDaemon(port, provider?)` — always runs, not env-gated) — Provenance line stamped on cross-thread memory replies.**
  Modify `index.ts`: per-turn `injectedMemory` flag on the new-thread branch
  (`begin.priorMessages` from `retrieve`, length > 0, index.ts:103-112); pure
  `stampProvenance(env, port)` helper appends the History-URL line to `show_text` content in the
  `send` loop when flagged; non-`show_text` untouched; existing `parseEnvelope` defense re-runs.
  Failing-test anchors: unit (`provenance-stamp.test.ts`) — appends URL, keeps original content,
  `parseEnvelope` ok, non-show_text returned as-is; integration (extend
  `memory-integration.daemon.test.ts`, real-provider-gated path) — cross-thread re-summon reply
  contains the History URL; within-thread turn does NOT. Evidence: tests green + no regression +
  `git diff --stat packages/protocol` empty, mock-agent/mock-provider byte-unchanged.
  🚩 visible discoverability = behavioral DoD #5, demo-gated.
- [x] **T2.5a — DONE (0060d31; 168 pass/0 fail unchanged; comment-only) — Fix stale "S3" test comments (opportunistic T1-review MINOR).** ⚠️ orchestrator note for review: the new line-102 comment says "fact_tombstones table" — per plan/ADR-0013 the projection-tombstone lives on the existing `mutations` table; verify wording.
  `packages/daemon/src/memory/providers/fixed-marker-provider.test.ts:84` + `:103-105`:
  comments falsely claim `retrieve()` does no tombstone check — T1 re-introduced one via
  `isFactTombstoned` (fixed-marker-provider.ts:60, dumb-tail-provider.ts:63); tests pass because
  message-UUID and `thread:<id>` provenance keyspaces are disjoint. Rewrite comments to state
  exactly that. Comment-only; evidence: file's tests pass unchanged. Commit as `docs(test):`.
- [ ] **T2.4 — Route-closing live demo — GATED, NOT BUILT/RUN BY THIS CHAT.**
  6-step `yeet.sh` demo (spec §4.1) through real overlay → daemon → disk (DoD #4/#5).
  **Behavioral — requires runtime demo to confirm; NEVER self-certified.** Depends on CM-01 for
  steps 2-4; step 5 exercises T2.1c + T2.2a; step 6 exercises T2.3a + T2.2a. This chat hands off
  the demo (`BLOCKED: live-demo`); it does not run it.

---

## Gates summary (what this chat escalates)

1. **ADR acceptance** — ✅ **RESOLVED.** ADR-0013 accepted (Option B) by Lior 2026-06-10
   (ca30317). T2.1/2.2/2.3 unblocked. (Read-token rider = later hardening-pass gate, NOT T2.)
2. **CM-01 missing prerequisite** — UNCHANGED. The route-closing demo (T2.4) cannot run on the
   real overlay until CM-01 (persistent-WS overlay) ships or a demo harness is approved.
   Sequencing decision for Lior/Jimmy. Does NOT block T2.1/2.2/2.3 (real-I/O provable without it).
3. **Route-closing live demo** — Lior-gated §6.1 (the route's single behavioral gate; gates DoD
   #4, #5). Terminal state of this cycle: mechanical verified-done + `BLOCKED: live-demo`.

## Reality check (T2, re-validated 2026-06-10 — file:line citations)

- **`index.ts` fetch:** origin-gate at `index.ts:53` runs on EVERY request (`origin.ts:9` allows
  only the 3 Tauri/Vite origins) → upgrade `:56` / 400 `:57`. A browser hitting `/history.html`
  sends a non-allowlisted Origin → the memory branch MUST precede the origin gate (T2.1a); the WS
  upgrade path stays byte-unchanged below it.
- **`Hatch` façade (as merged):** `view(threadId): Promise<HatchViewResult>` (hatch.ts:52),
  `edit(messageId, replacement, ctx, reason?)` (hatch.ts:68), `forget(target, ctx, reason?)`
  (hatch.ts:81); `HatchViewResult = {messages, distilledFacts, distillationEvents}`
  (hatch.ts:29-36). T2.1 wires exactly these three.
- **Daemon data dir:** `Bun.env.AGENTIC_DATA_DIR ?? join(homedir(), ".agentic-engine")`
  (index.ts:39); `MemoryStore` keeps `memory.sqlite` + `threads/` there (store.ts:65-67). Token →
  `<dataDir>/auth-token` mode `0o600` (ADR-0003 p.5-consistent).
- **Overlay:** `renderTextReply` uses `textContent` only (text-reply.ts:31); NO open-URL
  affordance anywhere in apps/overlay/src/ → provenance = literal URL text (ADR-0005-compliant).
- **Provenance detection:** `[remembered] ` prefix (dumb-tail-provider.ts:65,
  fixed-marker-provider.ts:62); new-thread hydration at thread-lifecycle.ts:54-56, counted at
  index.ts:103-112; stamp point = daemon `send` loop (index.ts:147) growing the unconstrained
  `TextPrimitive.content` (primitives.ts:47-51) — no frozen-type change.
- **Refused-forget carry-forward (verified):** boolean refusal from `tombstoneFact`
  (store.ts:226-254, refusal `:240-247`) discarded at write-gate.ts:128; `forget`/`edit`
  5e-refuse via silent `return` (write-gate.ts:76, :156); `threadOf` throws on unknown id
  (write-gate.ts:186-189). HTTP ctx always human → live HTTP error conditions are unknown-id
  (→404) + UUID-into-forgetFact (→400); 5e `409` reserved-but-unreachable, documented.
- **Stale S3 comments (verified false):** fixed-marker-provider.test.ts:84 + :103-105 — both
  providers' `retrieve` DO call `isFactTombstoned`. Comment-only fix (T2.5a).
- **Baseline:** T1 verified-done recorded 143 pass / 0 fail for `bun test packages/daemon`
  (full-repo ≈ 249 per ledger). Workers re-run before adding tests.

> **Behavioral items in T2 are "requires runtime demo to confirm" throughout** (token paste
> round-trip in a real browser; provenance line visibly discoverable; history.html rendering).
> Tests prove the code path + the server-side gate over real I/O — NOT the end-to-end macOS
> overlay experience. That is T2.4, Lior-gated §6.1, never self-certified.
