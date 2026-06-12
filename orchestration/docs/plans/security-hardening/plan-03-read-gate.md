# Plan: Chunk 03 — Token-gate `/memory/*` reads + history.html paste-extend (ADR-0013 read-token rider)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every new daemon assertion uses a **real socket/real-fetch against the real `startDaemon`** — no mocked handler where the wire is the point (Strike-4 discipline).

## Status: review-complete — reviewer-clean (0 blockers); mechanically verified; behavioral DoD #1 PENDING Lior §6.1 live demo

- **Feature:** security-hardening
- **Chunk:** `orchestration/chunks-todo/security-hardening/03-memory-read-token-gate.md`
- **Spec:** `orchestration/docs/specs/2026-06-12-security-hardening.md` §3.5 / §3.6 (context) / §3.8 / §4 (status: accepted)
- **ADR worthy:** no (discharges the accepted ADR-0013 read-token rider → Option A end-state; authors no new contract or boundary)
- **Depends on:** chunk 02 (MERGED to `main`) — shares `TokenStore` + the `index.ts` `fetch` handler. Rebase on its merge; do NOT re-implement verify or touch the WS-upgrade branch.
- **Step tracker:** Step 1 ☑ · Step 2 ☑ · Step 3 (3.1–3.4) ☑ · Review ☑ (engine-reviewer CLEAN, 0 blockers, 8/8 security axes PASS) · Demo ☐ (Lior §6.1) — 3 commits, 355/0 suite, typecheck+lint:strict 0, frozen empty; B1 harmonize taken. One reviewer NIT (stale http-routes header) fixed in `fd0a497`.

**Goal:** Require `Authorization: Bearer <token>` on every `GET /memory/*` data route (→ 401 on missing/bad), keep `GET /history.html` open on loopback behind the existing Host-guard, and extend history.html's shipped paste-UX so nothing renders until the token is pasted — discharging the ADR-0013 read-token rider (Option A end-state) with the frozen protocol + mock byte-untouched.

**Architecture:** Reuse chunk 02's hardened, timing-safe `TokenStore.verify(authHeader)` (the HTTP `Bearer` method — already the sole comparison sink) on the two read routes in `http-routes.ts`. The DNS-rebinding Host-guard at `index.ts:93-97` stays as-is (assert, do not re-implement). The page reuses its existing in-memory `_authToken` JS variable (never web storage) and now sends `Authorization: Bearer <token>` on the read fetches, deferring all rendering until paste.

**Tech Stack:** TypeScript on Bun, `Bun.serve` `fetch` handler, real-I/O `bun:test`, vanilla-JS static page string.

---

## Reality check

Each claim tagged **fact-from-source** (file:line verified) or **hypothesis-needing-runtime** (cannot be confirmed by code-reading — PIPELINE §6.1). The chunk's prose is accurate on every checked point; the additions below are drift the chunk did not surface.

**1. Chunk 02 is merged; verify is dual-method and timing-safe; reuse it, do not re-implement.** — **fact-from-source.**
- `packages/daemon/src/memory/token-store.ts:52-71` — private `safeEqual` (constant-time `timingSafeEqual` over `Buffer.from`, length-guard, no data-dependent early return); `verify(authHeader)` strips `"Bearer "` then `safeEqual`; `verifyToken(raw)` for the bare WS subprotocol. **Reads must reuse `verify(...)` (the HTTP `Bearer` method)** — identical to the write path. No new method, no re-implementation.
- `TokenStore` is already a dep of the route handler: `http-routes.ts:25,29-33` (`MemoryHttpDeps.tokenStore`), constructed at `index.ts:69` and passed via `memoryDeps` (`index.ts:75`). No new wiring to reach the token on the read path.

**2. The write path returns 403, at the two cited sites — confirmed; the "6 sites" enumerated.** — **fact-from-source.**
- Server: `http-routes.ts:103` (`handleForget`) and `:129` (`handleEdit`) — both `Response.json({ error: "Unauthorized" }, { status: 403 })` on `!deps.tokenStore.verify(...)`.
- Page (user-facing): `history-page.ts:487-488` and `:557-558` — `else if (r.status === 403) { setStatus("403 — unlock first or bad token.", false); ... }`.
- Test: `http-routes.daemon.test.ts:122-128` — `T2.1c-1: POST /memory/forget without Authorization header → 403`.
- **That is the 6 sites** the chunk/q#003 measured (2 server + 2 page + the write-path test pair counts as the test site). See the harmonization decision below — recommendation: **harmonize 403→401** (all 6 are mechanical), but the decision rule and the fallback (record inconsistency) are both specified so the worker can flip at build if any site proves non-trivial.

**3. The two read routes today have ZERO auth and ZERO token check.** — **fact-from-source.**
- `http-routes.ts:57-61` — `GET /memory/threads` → `Response.json({ threads })`, no auth.
- `http-routes.ts:63-75` — `GET /memory/thread/:id` → `deps.hatch.view(id)`, no auth.
- These are the two data routes to gate. There is **no** `GET /memory/forgetFact` or other read route in this file — the family is exactly these two GETs (`forget`/`edit` are POST).

**4. The page's read fetches send NO token and run UNCONDITIONALLY at bootstrap — this is the real behavioral change.** — **fact-from-source.**
- `history-page.ts:610` — `loadThreadList();` is called at the bottom of the script with no gate. It calls `fetch("/memory/threads")` (`:237`) with no `Authorization` header.
- `history-page.ts:283` — `loadThread(...)` calls `fetch("/memory/thread/...")`, also no `Authorization` header.
- Once reads are 401-gated, **these fetches will 401 and the page will render "Failed to load threads."** unless the page is changed to (a) defer the data load until paste and (b) send `Authorization: Bearer <token>` on the read fetches. The chunk's "nothing renders until the token is pasted" requirement maps exactly here. The existing `_authToken` variable (`history-page.ts:201`, set on Unlock at `:225`) is reused; the unlock handler must additionally trigger the data load. **The "data does NOT render pre-paste" DoD is satisfied structurally by not calling `loadThreadList()` until `_authToken` is set.**

**5. The Host-guard lives at `index.ts:93-97` (NOT in `http-routes.ts`); it STAYS; assert, don't re-implement.** — **fact-from-source.**
- `index.ts:89-98` — the `if (url.pathname.startsWith("/memory/") || url.pathname === "/history.html")` block runs the Host check (`:93-96`, reject foreign Host → 403 `"forbidden host"`) BEFORE delegating to `handleMemoryHttp` (`:98`). Existing coverage: `http-routes.daemon.test.ts:275-311` (`dns-rebind-1..4`). The read-gate does NOT touch this block.

**6. Chunk 02 owns the WS-upgrade branch (`index.ts:100-124`); the read-gate must NOT touch it.** — **fact-from-source.**
- `index.ts:103-104` — `verifyToken(proto)` on the subprotocol → 401. `index.ts:113-115` — origin gate (layer 2) → 403. This is chunk 02's surface. Chunk 03 changes only `http-routes.ts` (and `history-page.ts`); **`index.ts` is NOT modified** — the dispatch at `:89-98` already routes `/memory/*` into `handleMemoryHttp`, which is where the read gate is added. (The brief's "only if route dispatch needs it" → it does **not**; no `index.ts` edit. This avoids any collision with 02.)

**7. ORDERING LANDMINE: the malformed-`%ZZ` guard test calls `handleMemoryHttp` directly with a tokenless GET and expects 400.** — **fact-from-source.**
- `http-routes.daemon.test.ts:238-268` — builds a `Request` for `GET /memory/thread/%ZZ` with **no `Authorization` header** and asserts `400 bad_target_shape`.
- **Consequence:** if the read gate is placed as a blanket pre-check at the *top* of `handleMemoryHttp` (before route matching), this tokenless request returns **401** and the guard test breaks (it would now need a token). The gate MUST be placed **inside each GET data-route handler, after the route is matched** (mirroring how the write routes gate inside `handleForget`/`handleEdit`), so the `%ZZ` decode-guard at `http-routes.ts:67-72` still runs and returns 400 for malformed targets regardless of auth. Decision: **per-route gate inside the two GET handlers** (see Approaches A). The `%ZZ` test stays tokenless and green.
  - Alternatively the worker MAY add a token to the `%ZZ` test and gate-first; rejected — it changes a frozen-ish test's intent (it tests the decode guard, not auth) and re-orders 400-vs-401 semantics. Keep the decode guard reachable tokenless.

**8. Existing tests that will FLIP from 200→401 when reads are gated (must be updated, not just added to).** — **fact-from-source.**
- `http-routes.daemon.test.ts:63-71` (`T2.1a-1`): `GET /memory/threads` **without** token currently asserts 200. After gating, tokenless → 401. This test must be **rewritten** to assert 401 (tokenless) and a **new** sibling added for 200-with-`Bearer`.
- `http-routes.daemon.test.ts:75-85` (`T2.1a-2`): `GET /memory/thread/:id` without token currently asserts 200. Same rewrite.
- `http-routes.daemon.test.ts:291-296` (`dns-rebind-3`): `GET /memory/threads` with `Host: localhost:<port>` and **no token** asserts 200. Its purpose is the Host-**allow** path, not auth — so it must gain a `Bearer` token to keep asserting 200 (otherwise it would 401 and stop testing what it tests).
- `T2.1a-3` / `T2.1a-3b` (`:94-112`) are WS-path tests (chunk 02) — **leave untouched**.

**9. Behavioral DoD cannot be closed by this plan.** — **hypothesis-needing-runtime (PIPELINE §6.1).**
- "open history.html via provenance link → shell loads → data does NOT render pre-paste → paste → threads/facts render; edit+forget still work" is a live-macOS behavioral criterion. Code-reading and green real-I/O tests are necessary but NOT sufficient (this scar lied 5× in v0). **Requires live demo to confirm — never assert from code-reading.** The chunk stays `in-progress` and the PR does NOT auto-merge until Lior's §6.1 demo signs off.

**No drift in the chunk's prose was found.** The only facts the chunk did not surface are items 7 and 8 (the ordering landmine and the three existing 200-tests that flip) — both are handled explicitly in Steps below.

---

## Approaches (decisions taken)

### A. Read-gate placement → per-route, inside each GET handler (NOT a blanket pre-check)

- **Chosen — A1: add the `verify` gate at the top of each of the two GET route bodies in `handleMemoryHttp`, after the path is matched.** Concretely: extract `handleThreads(deps)` and `handleThread(req, url, deps)` helpers (mirroring `handleForget`/`handleEdit`), each beginning with the bearer check → 401. The write routes already gate this way (`http-routes.ts:101-104,127-130`), so this is the established local pattern.
  - *Why:* preserves the malformed-`%ZZ` decode guard's tokenless 400 path (Reality check 7); keeps the static `GET /history.html` branch (`http-routes.ts:88-92`) ungated (it must stay open — spec §3.5, §4); matches the write-route idiom so the file reads uniformly; reuses the exact same `deps.tokenStore.verify(req.headers.get("authorization"))` call the write path uses (one comparison sink, spec §2).
- **Rejected — A2: a single blanket gate at the top of `handleMemoryHttp` (before route matching), with a path allowlist for `/history.html`.** Breaks the `%ZZ` guard test (returns 401 before the decode-guard 400), conflates the static-shell exception into an allowlist branch, and re-orders 400-vs-401 semantics. More code, more coupling, one frozen-test casualty.
  - ☆ Альтернатива: gate at the `index.ts` dispatch (`:89-98`) — rejected: collides with chunk 02's handler ownership, can't distinguish `/history.html` (open) from `/memory/*` (gated) without duplicating route knowledge already in `http-routes.ts`, and would force an `index.ts` edit the brief says to avoid.
- **Method reused:** `deps.tokenStore.verify(req.headers.get("authorization"))` — the HTTP `Bearer` method, identical to write routes. **Do NOT use `verifyToken`** (that is the bare-subprotocol WS method).

### B. 403→401 harmonization on the write path → HARMONIZE (recommended), with a flip-to-record fallback rule

- **Decision rule (binding for the worker):** harmonize the shipped write-path **403→401** iff all 6 sites are trivial mechanical edits with no behavioral ripple. After reading the 6 sites (enumerated in Reality check 2), **they are all trivial** — two server status literals, two page status-checks + user-facing strings, one write-path test assertion + its sibling. **Recommendation: harmonize.**
  - *Why harmonize:* the chunk's own framing and ADR-0013's Option A end-state want a **uniform** auth posture (the ADR's recorded Negative was precisely "a non-uniform auth posture"; this pass exists to remove it). 401 ("Unauthorized" — no/bad credential) is the semantically-correct code for a missing/invalid bearer on both reads and writes; 403 ("Forbidden") implies an authenticated-but-not-permitted caller, which is never the case here (the token IS the only authorization axis). Leaving writes on 403 while reads are 401 re-introduces the exact non-uniformity the rider closes.
- **Chosen — B1: harmonize.** Change `http-routes.ts:103` and `:129` to `status: 401`; update `history-page.ts:487,557` status-checks `=== 403` → `=== 401` and the strings `"403 —"` → `"401 —"`; update the write-path test `http-routes.daemon.test.ts:122-128` to assert 401.
- **Fallback — B2 (if the worker finds ANY of the 6 non-trivial at build):** do NOT harmonize. Leave writes on 403, gate reads on 401, and **record the inconsistency in this plan's `## Recorded inconsistency` section + the chunk file + the pass README** (per spec §3.5: "else record the inconsistency"). The plan ships either way; harmonization is a clean-up, not a blocker.
  - ☆ Альтернатива: keep the split permanently and document 403-on-write as intentional — rejected: it would contradict ADR-0013's Option A "uniform gate, no read-disclosure" end-state and leave the regret the rider was written to close.

### C. history.html read-gating → defer data load until paste; reuse the existing `_authToken` variable; send `Bearer` on read fetches

- **Chosen — C1:** (a) remove the unconditional `loadThreadList()` bootstrap call (`history-page.ts:610`); (b) in the Unlock click handler (`:218-228`), after `_authToken = val`, call `loadThreadList()` so the thread list loads only post-paste; (c) add `headers: { "Authorization": "Bearer " + _authToken }` to the two read fetches (`fetch("/memory/threads")` at `:237` and `fetch("/memory/thread/...")` at `:283`); (d) keep the token in the existing in-memory `var _authToken` — **NEVER** localStorage/sessionStorage/cookies (ADR-0013 threat model; `:197-201` discipline preserved, and the existing test `T2.2a-1` at `:317-329` asserts `body not.toContain("localStorage")` — stays green).
  - *Why:* smallest change that satisfies "nothing renders pre-paste" (the data containers keep their "Loading…" placeholders until Unlock fires the load) AND "open → paste → see" (Unlock both sets the token and triggers the load). The page already holds the token for writes; reusing it for reads is the natural unification.
  - **Pre-paste UX:** the thread list / detail containers show their existing `Loading…` placeholders until paste. Acceptable for the minimal shell (no new "locked" empty-state copy needed — YAGNI; the Unlock panel at `:148-166` already explains the paste step). The worker MAY change the initial `Loading…` text to a neutral "Paste your token to load history." in `renderThreadList`'s pre-load state if trivial — optional, not required.
- **Rejected — C2: auto-load on page open by reading the token client-side from the daemon.** Impossible/wrong — the browser page has no Tauri `invoke` (it's served to any loopback browser, not only the overlay webview); the paste-UX IS the decided provisioning for the page (spec §3.4, q#003). No auto-read.
  - ☆ Альтернатива: prompt for the token via a native dialog — rejected: the page is explicitly free of native dialogs (test `T2.2a-2` at `:334-341` asserts no `confirm/prompt/alert`); the paste input is the pattern.

### D. Reject-logging on 401 → log path + reason, never the credential (spec §3.8)

- **Chosen — D1:** on each read-route 401, `console.error("[memory-http] read rejected:", { path: url.pathname, reason: "bad-or-missing-token" })`. **Never** include `req.headers.get("authorization")` or the token value. Mirrors chunk 02's WS-reject log shape (`index.ts:106-109`). The write routes do not currently log their 403 — the worker MAY add the same reject log to `handleForget`/`handleEdit` for symmetry **if harmonizing (B1)**; optional, not required by DoD.

---

## ADR worthy: NO

This chunk **discharges** the accepted ADR-0013 acceptance rider (read-open is "a staged interim only … token-gating the read path → the Option A end-state is a REQUIRED part of the security-hardening pass") and **executes** the accepted spec §3.5. It authors no new contract, boundary, dependency, or wire field:
- The token, the verify sink, and the HTTP `Bearer` transport are all pre-existing (ADR-0013 Option B write path + chunk 02 hardening). Reads ride the **same** transport and sink — a narrowing-within-an-accepted-decision, not a new one (§7.2 citation test: the gate cites ADR-0013 + spec §3.5; the rider names this exact work).
- 403→401 harmonization is a status-code clean-up within the existing route family, not a contract change (no envelope, no new route, no new method).
- No new runtime dependency (reuses `node:crypto` via `TokenStore`).
- FROZEN surfaces untouched: `packages/protocol` (the 6-variant envelope — the token rides an HTTP header, never the wire) and the mock reducer.

**Watch-flag:** ADR-0013's recorded 6-month regret is the **camel's-nose** — "a third mutating HTTP route is the trigger to stop and design the HTTP surface." This chunk adds **zero new routes** (it gates two existing GETs); it does not advance the rule-of-three counter. If the worker is tempted to add any new `/memory/*` route → STOP, flag to orchestrator (ADR check).

---

## Steps

Three independently-testable, sequential steps. Branch: `chunk/03-memory-read-token-gate`. Commit per step with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Do not push to `main`; open a PR; behavioral DoD #1 means **nothing merges before Lior's live macOS demo** (§5.2 / §6.1). TDD throughout: test before impl, watch it fail, then make it pass.

### Step 1 — Daemon: token-gate the two `GET /memory/*` data routes (401), keep `/history.html` open, log rejects

**Files:**
- Modify: `packages/daemon/src/memory/http-routes.ts` (gate inside the two GET handlers; extract `handleThreads`/`handleThread` helpers mirroring the write helpers)
- Test: `packages/daemon/src/memory/http-routes.daemon.test.ts` (rewrite the two tokenless-200 read tests to 401; add 200-with-Bearer siblings; fix `dns-rebind-3` to carry a token; assert no token in log)

- [ ] **Step 1.1 — Write the failing tests (real fetch through `startDaemon`).** In `http-routes.daemon.test.ts`, **replace** `T2.1a-1` (lines 63-71) and `T2.1a-2` (lines 75-85) with the 401/200 matrix below, and add a `readToken()`-using 200 variant. Keep using the existing `readToken()` helper (`:117-119`) and `seededThreadId`/`seededMessageId` fixtures.

```ts
// ─── Read-route auth matrix (chunk 03) ───────────────────────────────────────

test("read-gate: GET /memory/threads WITHOUT token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`);
  expect(res.status).toBe(401);
});

test("read-gate: GET /memory/threads with BAD token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`, {
    headers: { Authorization: "Bearer deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
  });
  expect(res.status).toBe(401);
});

test("read-gate: GET /memory/threads with VALID Bearer → 200 + seeded thread", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`, {
    headers: { Authorization: `Bearer ${readToken()}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { threads: { thread_id: string }[] };
  expect(body.threads.some((t) => t.thread_id === seededThreadId)).toBe(true);
});

test("read-gate: GET /memory/thread/:id WITHOUT token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(seededThreadId)}`);
  expect(res.status).toBe(401);
});

test("read-gate: GET /memory/thread/:id with VALID Bearer → 200 + HatchViewResult shape", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/thread/${encodeURIComponent(seededThreadId)}`, {
    headers: { Authorization: `Bearer ${readToken()}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, unknown>;
  expect(Array.isArray(body["messages"])).toBe(true);
  expect(Array.isArray(body["distilledFacts"])).toBe(true);
  expect(Array.isArray(body["distillationEvents"])).toBe(true);
});
```

Also **fix `dns-rebind-3`** (lines 291-296) so it still tests the Host-allow path under the new gate — add the token:

```ts
test("dns-rebind-3: GET /memory/threads with Host: localhost:<port> + token → 200 (allowed)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/memory/threads`, {
    headers: { Host: `localhost:${PORT}`, Authorization: `Bearer ${readToken()}` },
  });
  expect(res.status).toBe(200);
});
```

Leave `T2.1a-3` / `T2.1a-3b` (WS-path, chunk 02) and the `%ZZ` guard test (lines 238-268) **unchanged** — the `%ZZ` test must keep passing tokenless (it asserts 400, the decode guard, not auth).

- [ ] **Step 1.2 — Run, watch fail.** Run: `bun test packages/daemon/src/memory/http-routes.daemon.test.ts`. Expected: the new tokenless-401 tests FAIL (routes still return 200), the `%ZZ` test still PASSES.

- [ ] **Step 1.3 — Implement the read gate in `http-routes.ts`.** Extract the two GET bodies into helpers that gate first, then run the existing logic. Replace the inline `GET /memory/threads` block (`:57-61`) and `GET /memory/thread/:id` block (`:63-75`) with calls to new helpers placed alongside `handleForget`/`handleEdit`:

```ts
// in handleMemoryHttp, replace the two inline GET blocks with:

  // GET /memory/threads — token-gated read (ADR-0013 Option A end-state; spec §3.5)
  if (pathname === "/memory/threads" && req.method === "GET") {
    return handleThreads(req, url, deps);
  }

  // GET /memory/thread/:id — token-gated read
  const threadMatch = pathname.match(/^\/memory\/thread\/(.+)$/);
  if (threadMatch && req.method === "GET") {
    return handleThread(req, url, threadMatch[1]!, deps);
  }
```

Add the helpers (after `handleEdit`). **The decode guard runs BEFORE the auth check inside `handleThread`** so a malformed target → 400 regardless of auth (preserves the tokenless `%ZZ` guard test; the target shape is not a secret):

```ts
// ─── Read route helpers (token-gated; ADR-0013 Option A end-state) ──────────

function rejectRead(url: URL): Response {
  // spec §3.8: log path + reason, NEVER the credential value (DoD: no token in logs).
  console.error("[memory-http] read rejected:", { path: url.pathname, reason: "bad-or-missing-token" });
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function handleThreads(req: Request, url: URL, deps: MemoryHttpDeps): Response {
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) return rejectRead(url);
  const threads = deps.store.listThreads();
  return Response.json({ threads });
}

async function handleThread(
  req: Request,
  url: URL,
  rawId: string,
  deps: MemoryHttpDeps,
): Promise<Response> {
  // Decode guard FIRST so a malformed target → 400 regardless of auth (preserves the
  // tokenless %ZZ guard test; the target shape is not a secret).
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return Response.json({ error: "bad_target_shape" }, { status: 400 });
  }
  if (!deps.tokenStore.verify(req.headers.get("authorization"))) return rejectRead(url);
  const result = await deps.hatch.view(id);
  return Response.json(result);
}
```

> NOTE: the exact body of `handleThreads`/`handleThread` (`deps.store.listThreads()` vs `deps.hatch.view`) must mirror whatever the current inline blocks at `http-routes.ts:57-75` actually do — copy the existing logic verbatim into the helper, only PREPENDING the gate (and, for `handleThread`, keeping the existing decode guard FIRST). Do not change response shapes.

Leave the `/history.html` branch (`:88-92`) UNCHANGED — it stays open (Host-guard only). Leave `handleForget`/`handleEdit` for Step 2.

- [ ] **Step 1.4 — Run, watch pass.** Run: `bun test packages/daemon/src/memory/http-routes.daemon.test.ts`. Expected: all read-gate tests PASS; `%ZZ` guard still PASSES (tokenless → 400); `dns-rebind-3` PASSES with token; the static `/history.html` tests (`T2.2a-1/2`, `dns-rebind-2`) still PASS (no token needed). Inspect the test output: confirm no log line prints a token value (the reject log carries only `path` + `reason`).

- [ ] **Step 1.5 — Commit.**

```bash
git add packages/daemon/src/memory/http-routes.ts packages/daemon/src/memory/http-routes.daemon.test.ts
git commit -m "feat(daemon): token-gate GET /memory/* reads (401); /history.html stays open"
```

### Step 2 — 403→401 write-path harmonization (per decision B1) + history.html read paste-extend

**Files:**
- Modify: `packages/daemon/src/memory/http-routes.ts` (`:103`, `:129` → 401)
- Modify: `packages/daemon/src/memory/history-page.ts` (defer load until paste; send Bearer on reads; 403→401 status-checks + strings)
- Test: `packages/daemon/src/memory/http-routes.daemon.test.ts` (the tokenless-write test 403→401)

> **Decision gate (B):** before editing, the worker re-confirms the 6 sites (Reality check 2) are all trivial. They are. Harmonize (B1). If ANY proves non-trivial at build, switch to B2: skip the 403→401 edits, gate reads on 401 only, and fill `## Recorded inconsistency` + note it in the chunk file + pass README.

- [ ] **Step 2.1 — Write/adjust the failing write-path test.** In `http-routes.daemon.test.ts`, change `T2.1c-1` (lines 122-128) assertion `expect(res.status).toBe(403)` → `expect(res.status).toBe(401)` and rename the title to `→ 401`. (The `dns-rebind-4` test at `:298-311` asserts 403 for a **bad Host** — that is the Host-guard, NOT auth — leave it 403, unchanged.)

- [ ] **Step 2.2 — Run, watch fail.** Run: `bun test packages/daemon/src/memory/http-routes.daemon.test.ts`. Expected: the tokenless-write test FAILS (server still returns 403).

- [ ] **Step 2.3 — Harmonize the server write path.** In `http-routes.ts`, change line 103 (`handleForget`) and line 129 (`handleEdit`) from `{ status: 403 }` to `{ status: 401 }`. (Optionally add the same `rejectRead`-style log; not required.)

- [ ] **Step 2.4 — Extend history.html to gate reads behind paste + send Bearer.** In `history-page.ts`:
  - Remove the unconditional bootstrap call at line 610 (`loadThreadList();`) — replace the bootstrap comment block with a no-op (the list loads on Unlock now).
  - In the Unlock handler (`:218-228`), after `_authToken = val;` and `setStatus("Token set for this session.", true);`, add `loadThreadList();`.
  - In `loadThreadList` (`:237`), change `fetch("/memory/threads")` → `fetch("/memory/threads", { headers: { "Authorization": "Bearer " + _authToken } })`.
  - In `loadThread` (`:283`), change `fetch("/memory/thread/" + encodeURIComponent(threadId))` → add the same `headers: { "Authorization": "Bearer " + _authToken }`.
  - In `doForget` (`:487-488`) and `doEdit` (`:557-558`): change `r.status === 403` → `r.status === 401` and the string `"403 — unlock first or bad token."` → `"401 — unlock first or bad token."`.
  - Keep `_authToken` in the JS variable only (no web storage) — do not add any storage API.

- [ ] **Step 2.5 — Run, watch pass + verify page invariants.** Run: `bun test packages/daemon/src/memory/http-routes.daemon.test.ts`. Expected: the tokenless-write test now asserts 401 and PASSES; the static-page tests `T2.2a-1` (no `localStorage`) and `T2.2a-2` (no `confirm/prompt/alert`) still PASS. The page-string change does not break them.

- [ ] **Step 2.6 — Commit.**

```bash
git add packages/daemon/src/memory/http-routes.ts packages/daemon/src/memory/history-page.ts packages/daemon/src/memory/http-routes.daemon.test.ts
git commit -m "refactor(daemon): harmonize write-path 403->401; history.html gates reads behind paste + sends Bearer"
```

### Step 3 — Full-suite green + Host-guard assertion + frozen-surface proof + PR (behavioral demo pending)

**Files:**
- Test: `packages/daemon/src/memory/http-routes.daemon.test.ts` (add an explicit Host-guard-on-read assertion if not already covered; verify `hatch.daemon.test.ts` needs no change)
- No source edits (verification step)

- [ ] **Step 3.1 — Add an explicit "Host-guard still rejects foreign Host on a read" assertion (DoD).** The chunk's mechanical DoD requires "Host-guard still rejects foreign Host (403)" on the read path. `dns-rebind-1` (`:275-281`) already covers `GET /memory/threads` with `Host: evil.com:<port>` → 403 (Host check runs before the route, so no token needed — it 403s on Host). Confirm it still passes unchanged (it tokenlessly 403s on Host before reaching the auth gate, which is correct: Host-guard is the outer layer). If green, no new test needed; record in the PR body that `dns-rebind-1` is the read-path Host-guard proof.

- [ ] **Step 3.2 — Confirm `hatch.daemon.test.ts` is unaffected.** Run: `bun test packages/daemon/src/memory/hatch.daemon.test.ts`. Expected: all PASS unchanged — these tests drive `Hatch`/`WriteGate`/store directly (no HTTP layer), so the read gate does not touch them. (The chunk lists this file in the matrix, but on reading it the tests are store-level, not HTTP — no edit required. Recorded as a non-blocking flag.)

- [ ] **Step 3.3 — Full gates.** Run, expecting exit 0 / all green:
  - `bun test` (full root suite — all read-gate + harmonization + chunk-02 WS tests green)
  - `bun run typecheck`
  - `bun run lint:strict`
  - `git diff main -- packages/protocol` → **empty** (frozen envelope untouched)
  - `git diff main -- 'packages/daemon/src/**/mock-agent.ts' 'packages/daemon/src/**/mock-provider.ts'` → **empty** (frozen mock reducer untouched)

- [ ] **Step 3.4 — Confirm no credential in any log line (DoD).** Grep the diff and the reject path: `console.error("[memory-http] read rejected:", { path, reason })` carries no token; the WS reject log (chunk 02) is untouched. Confirm no test output prints the token value.

- [ ] **Step 3.5 — Commit + open PR (do NOT merge).**

```bash
git add -A
git commit -m "test(security): read-path Host-guard assertion + full-suite green; frozen surfaces byte-untouched"
git push -u origin chunk/03-memory-read-token-gate
gh pr create --base main --title "chunk 03: token-gate /memory/* reads + history paste-extend (ADR-0013 rider)" --body "<see PR body template below>"
```

PR body must record: what the chunk did (read-gate 401 + harmonized writes 401 + page paste-extend), how verified (the 401/200 matrix, Host-guard assertion, frozen diffs empty, suite/typecheck/lint green), the harmonization decision taken (B1 harmonized), and the standard attribution line. End with the behavioral DoD reminder below.

**Behavioral DoD reminder (NOT closeable by this plan — Lior live macOS demo, §6.1 — requires live demo to confirm, never assert from code-reading):**
- DoD #1: open `history.html` via the provenance link → shell loads → data does NOT render pre-paste → paste token → threads/facts render; edit + forget still work. **requires live demo to confirm.**

---

## Recorded inconsistency

**N/A — B1 (harmonize) was taken.** Write path harmonized to 401 in Step 2 (all 6 sites confirmed trivial); auth posture is uniform (reads + writes both 401 on missing/bad credential). ADR-0013 Option A end-state reached. No inconsistency to record.

---

## Files

**Create:** (none)

**Edit:**
- `packages/daemon/src/memory/http-routes.ts` — gate the two GET read routes (401) via extracted `handleThreads`/`handleThread`; harmonize write 403→401 (Steps 1, 2)
- `packages/daemon/src/memory/history-page.ts` — defer load until paste, send `Bearer` on read fetches, 403→401 status-checks + strings (Step 2)
- `packages/daemon/src/memory/http-routes.daemon.test.ts` — read 401/200 matrix; `dns-rebind-3` carries token; tokenless-write 403→401 (Steps 1, 2)

**Must NOT touch (frozen / out-of-scope):**
- `packages/protocol/**` — the 6-variant envelope (DoD: `git diff packages/protocol` empty). Token rides an HTTP header, never the wire.
- `packages/daemon/src/**/mock-agent.ts`, `mock-provider.ts` — frozen mock reducer.
- `packages/daemon/src/index.ts` — NOT modified. The dispatch (`:89-98`) + Host-guard (`:93-97`) STAY; the WS-upgrade branch (`:100-124`) is chunk 02's surface. Assert the Host-guard in tests; do NOT re-implement.
- `packages/daemon/src/memory/token-store.ts` — reuse `verify(...)` as-is (chunk 02 hardened it); no edit.
- ADR files — no edits; this chunk discharges the accepted ADR-0013 rider and executes accepted spec §3.5.

---

## Non-blocking flags (surfaced; none change scope)
1. **Ordering landmine (Reality check 7):** the read gate goes per-route inside `handleThread`/`handleThreads`, with the `%ZZ` decode guard BEFORE the auth check in `handleThread`, so the tokenless `%ZZ` guard test stays green at 400. A blanket pre-gate would break it.
2. **Three existing 200-tests flip to 401 (Reality check 8):** `T2.1a-1`, `T2.1a-2` rewritten; `dns-rebind-3` gains a token. Not new tests — rewrites.
3. **`hatch.daemon.test.ts` needs no edit (Step 3.2):** its tests are store-level, not HTTP — the chunk's file list is indicative; on reading, no change required. Recorded so the worker doesn't invent edits.
4. **Behavioral DoD #1** is Lior's live §6.1 run — the chunk reaches mechanically-complete + reviewer-clean, then BLOCKS on the demo (same shape as chunks 01/02). The PR must NOT auto-merge until the demo signs off.

## Status: Done
