---
status: proposed
date: 2026-06-06
deciders: [lior]
tags: [adr, security, daemon, transport, memory, http, caller-auth]
---

# ADR-0013: Daemon memory-write HTTP surface + caller-auth model

## Status

`proposed`

> This is a **decision package for Lior to accept/amend**. It is **not** accepted.
> Status `proposed → accepted` is a Lior-only gate ([[../PIPELINE]] §5.2). The
> recommended option is **(B)**; all three are presented so Lior can rule. The
> daemon HTTP route (MF-05 Tranche 2, `T2.1`) **must not be built until this ADR
> is accepted** — see [[../plans/memory-foundation/plan-05-hatch]] Gates.

## Context

The memory transparency hatch — ADR-0012 decision **5a** ("a view / edit / forget
escape hatch... the user can always see, correct, and delete what the agent
remembers", [[0012-conversation-and-memory-model]]) — is the final chunk of the
memory-foundation route, **MF-05 (5a)**. The store, write-gate (`edit`/`forget`),
injection-point, and tombstone-honoring re-derive are already built and merged
(MF-01..04); MF-05 adds a **read API over the archive** plus the one remaining
seam (the projection-tombstone, below) and **a surface to drive it**.

The memory-foundation spec §3.5 ([[../specs/2026-06-04-memory-foundation]]) froze
only the **transport-agnostic, daemon-internal read/edit/forget API**, and named
three candidate surfaces for 5a to pick from at build: **admin-tab HTTP**,
**WS-additive**, or an **overlay widget**. The recorded lean was a web-admin
"History" tab ([[../architecture]] §3). But `web-admin` **does not exist** — the
repo has only `apps/overlay`, `packages/daemon`, `packages/protocol`. So the
orchestrator chose, within §3.5's sanctioned "admin-tab HTTP" option, a
**daemon-served minimal HTTP `/memory/*` surface**: a JSON read/edit/forget API
plus a minimal static `history.html`, served on the daemon's existing
`Bun.serve` `fetch` handler at `127.0.0.1:7777`. This is **not** a web-admin SPA
(scope-forbidden) and **not** overlay-as-management (against §3.5's "no settings
in the launcher hot path", ADR-0012 decision 3).

**This is the daemon's first mutating, non-WS, non-upgrade route.** Today the
daemon is pure-WS: `index.ts` `Bun.serve` does `fetch` → origin-gate → `upgrade()`
and a `websocket` handler; it serves no HTTP routes. ADR-0003 decision **p.4**
([[0003-local-daemon-ws-architecture]]) chose a WS-only transport and anticipated
optional HTTP on the same port **only for large-asset transfer** (e.g. file
thumbnails for `show_file_preview`) — explicitly **not** memory-mutating
endpoints. This ADR **extends** that surface and must exist so a future reader
does not over-read ADR-0003 p.4 as already covering write endpoints. It is not a
supersede of ADR-0003; it adds a route family p.4 did not contemplate.

### The security crux — caller-auth (the real decision)

The daemon's **only caller-gate today** is the **Origin allowlist on the WS
upgrade** (`packages/daemon/src/origin.ts`, ADR-0003 Amendment 2026-05-30). That
gate has two properties that matter here:

1. It is **spoofable by non-browser localhost clients** — the `Origin` header is
   trivially forged by anything that isn't a browser. This is **known-gotcha #31**
   ([[../known-gotchas]] #31, `blocking-MVP`), the CSWSH exposure window the
   interim allowlist knowingly leaves open. The file itself says so in its header
   comment.
2. It **only guards the WS upgrade**. It does nothing for a new HTTP route —
   `isOriginAllowed` is called in the upgrade path, not on `fetch` responses that
   return content.

A `/memory/*` **edit/forget** route is therefore a **new localhost memory-write
surface that any local process can reach**. That is precisely the **#31 CSWSH ↔
memory-poisoning chain** that ADR-0012 decision 5 names: *plant-once,
inject-forever*. A crafted local process that can `POST`/`DELETE` against
`/memory/*` could plant a "fact" — or forget a true one — and the distilled slice
then re-injects (or omits) it into every future thread.

Critically, the mitigations already shipped — **5d write-scan**, **5e
no-silent-overwrite**, **5f thread-isolation** (MF-03/MF-04) — protect the write
**content** (*what* is written: it is scanned, it cannot clobber human-authored
entries, it cannot bleed cross-thread). They do **nothing about the caller**
(*who* may write). So a forget/edit endpoint with **no caller-auth** lets any
local process silently mutate the super-chat, regardless of how well-behaved the
content rules are. Caller-auth is the missing axis, and it is the substance of
this ADR.

This decision is the concrete first instance of the **deferred per-install token**
(ADR-0003 decision p.5, deferred in the 2026-05-30 Amendment) coming due, and it
is adjacent to the **light-direct security-hardening pass** (postponed, PR #18;
project memory `project_agentic_engine_status`). It does not resolve either in
full — it rules how *this one route* is gated and how that relates to the larger
token rollout.

## Decision

**Adopt Option B: read-open-on-loopback, write-requires-token.** `GET /memory/*`
is open on `127.0.0.1`; `POST`/`DELETE` (the `edit`/`forget` poisoning-write
surface) is gated by the **per-install token** (ADR-0003 p.5). This pre-stages
the token on exactly the surface that needs it — the write path — without blocking
the hatch **read** path or the route-closing demo on a full token rollout across
the WS handshake and all read endpoints.

> Lior gates this. The three options are laid out under *Alternatives Considered*;
> **B is recommended**, A and C are the amendment space.

Concretely, for Option B:

1. The `/memory/*` route family lives on the daemon's existing `Bun.serve`
   `fetch` handler at `127.0.0.1:7777` (loopback only, consistent with ADR-0003
   decision p.3).
2. `GET /memory/*` and the static `history.html` are reachable on loopback
   **without** a token — the read/audit path is not blocked.
3. `POST`/`DELETE /memory/*` (`edit`, `forget`, `forgetFact`) require the
   per-install token, presented as an **HTTP bearer** (header), living **outside**
   any message payload — purely additive, touching no frozen surface.
4. The token, when minted, is the **same per-install secret** ADR-0003 p.5
   defers; this route is its first consumer. Wiring it to the WS handshake and to
   `GET` endpoints remains the broader security-hardening pass's job — **not
   forced by this ADR**.

### Explicitly NOT decided here (so a future reader does not over-read this)

- **The token's full rollout** — applying it to the WS upgrade and to reads — is
  the **security-hardening pass** (PR #18, postponed) + the #31 release gate, not
  this ADR. Option B deliberately scopes the token to the **write** path only,
  for now.
- **The final mint/storage mechanics of the per-install token** (file-permission
  protection, Keychain, generation-on-install) — ADR-0003 p.5 / the hardening
  pass own that. This ADR commits *that the write path is token-gated*, not *how
  the token is minted*.
- **Whether the hatch ever moves to a real web-admin SPA / WS-additive transport**
  — §3.5 left that open; this ADR records the daemon-HTTP surface actually chosen
  for 5a, not a forever-commitment against the other two.

### Also recorded: the projection-tombstone (NOT itself ADR-worthy)

MF-05 adds a **fact-level tombstone** on the existing `mutations` table, honored
by re-derive (`distill`) and injection (`retrieve`) in both providers. This is
**additive — no new table, no write/inject re-plumb** — and on its own is **not a
new boundary and not ADR-worthy**. It is noted here only because it **closes the
S1 projection-rebuild gap** that was deferred from MF-03: previously, forgetting a
**distilled fact whose source turns stay live** (especially a thread-level
provenance fact, `provenance="thread:<id>"`) would let the next `distill` rebuild
it, because `isMessageTombstoned("thread:<uuid>")` is structurally always false. A
forgotten machine-projection of live content no longer re-appears on re-derive,
which **completes the #31 audit/forget guarantee** — forget is now real and
durable across the projection, not just over `messages.id` targets.

## Consequences

### Positive

- **Closes the caller axis of the #31 poisoning chain for the write path.** The
  one route that can plant/forget memory is the one route gated by a real secret —
  not by a spoofable `Origin` header. This is the highest-leverage point to spend
  the token first.
- **Does not block the hatch or the demo on a full token rollout.** Reads stay
  open on loopback, so the view/audit path and the route-closing demo can land
  without first wiring the token through the WS handshake and every read endpoint.
- **Pre-stages the deferred token (ADR-0003 p.5) on its highest-value surface** —
  the security-hardening pass inherits a working token consumer instead of a
  greenfield rollout.
- **Records the daemon's first mutating HTTP route explicitly**, so ADR-0003 p.4
  ("HTTP only for large-asset transfer") is not silently over-read as covering
  memory writes.
- **Token lives outside the envelope** — like ADR-0003's connection-level token,
  it touches **no frozen surface** (the 6-variant envelope, the mock reducer). No
  freeze gate is triggered by the auth mechanism itself.

### Negative

- **A second, partial auth posture exists during the gap.** Reads-open /
  writes-token means the daemon temporarily has *two* caller-gates with *different*
  strength (spoofable Origin on WS + reads; real token on writes). Until the
  hardening pass unifies them, "what protects this surface?" has a non-uniform
  answer — a small cognitive/audit cost.
- **Read endpoints remain reachable by any local process on loopback.** Option B
  accepts that `GET /memory/*` leaks the super-chat's contents to any local
  process. That is a **read-disclosure** surface (a local process can *see* your
  memory), traded against not blocking the hatch — see Trade-offs.
- **The token's broader rollout is still owed.** This ADR does not close #31; it
  closes only the write-caller for one route. The WS-upgrade and read-path token
  work is still the release gate.

### Trade-offs accepted

- We accept **read-disclosure of memory to any local loopback process**, in
  exchange for **not blocking the hatch read path and the route-closing demo** on
  a full token rollout. The justification: the *poisoning* threat (#31, ADR-0012
  dec.5) is a **write** threat — plant/forget that re-injects forever — and Option
  B gates exactly that, while read-disclosure on a single-user local machine is a
  materially lower-severity exposure that the hardening pass can close later.
- We accept **a temporarily non-uniform auth posture** (spoofable Origin on WS +
  reads, real token on writes), in exchange for **putting the scarce token effort
  on the write surface first** rather than waiting to do everything at once.
- We accept **adding the daemon's first mutating HTTP route** — widening the
  attack surface beyond pure WS — in exchange for **shipping 5a without a
  non-existent `web-admin` SPA**, using §3.5's already-sanctioned admin-tab-HTTP
  option.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Candidate regrets: "the reads-open compromise
> meant some local app slurped the whole super-chat and we wished we'd just
> token-gated reads too (Option A) from day one"; or, the opposite, "we
> over-rotated on a single-user local read surface and the dual-posture confusion
> cost more than it saved — should have shipped C as honest interim parity and
> done the whole token in the hardening pass"; or "the daemon HTTP route was the
> camel's nose — six months later it's a sprawling admin API and ADR-0003's
> WS-only intent is a fiction."]

## Alternatives Considered

### Option A: Full per-install token on all `/memory/*` (read + write)

**What it was:** un-defer the ADR-0003 p.5 per-install token now and require it as
an **HTTP bearer on every `/memory/*` request** — `GET` reads included. Aligns
cleanly with the security-hardening pass: one uniform gate, no read-disclosure.

**Why not (recommended-against, not forbidden):** it is the **heaviest rollout** —
it forces the full token-mint/storage mechanics and a token-bearing client *before*
the hatch read path or the route-closing demo can run, coupling 5a's delivery to
the whole hardening pass. It is the *correct* end-state; Option B is the staged
path to it. If Lior wants the uniform posture now and accepts the rollout cost,
this is the amendment.

### Option B: Read-open-on-loopback, write-requires-token *(RECOMMENDED — the Decision)*

**What it was:** `GET /memory/*` open on `127.0.0.1`; `POST`/`DELETE` gated by the
per-install token. See **Decision** for the full shape.

**Why this one:** it puts the scarce token effort exactly on the
**poisoning-write** surface (#31's actual threat vector) while leaving the
read/audit path and the demo unblocked. It pre-stages the deferred token on its
highest-value consumer without committing to the full rollout. The accepted cost
is read-disclosure on loopback and a temporarily non-uniform posture (see
Trade-offs).

### Option C: Origin-allowlist parity on the HTTP route

**What it was:** apply the same `origin.ts` Origin-allowlist to the new
`/memory/*` route as an interim parity measure, so the HTTP route is "no worse
guarded" than the WS upgrade.

**Why not:** it carries the **same #31 spoofability** — the `Origin` header is
forgeable by any non-browser local client, so it stops *casual cross-site browser
tabs* and **nothing else**. For a *memory-write* route that is the weakest option:
it gives the *appearance* of a gate while leaving the plant-once/inject-forever
write surface open to exactly the crafted local client #31 describes. Defensible
**only** as temporary parity if neither A nor B can land in time — never as the
resting state for a mutating route.

## Related

- [[0003-local-daemon-ws-architecture]] — the WS-only transport this **extends**;
  decision **p.4** anticipated HTTP **only for large-asset transfer** (NOT memory
  writes), and decision **p.5** is the **deferred per-install token** this ADR
  first consumes. The 2026-05-30 Amendment established the spoofable Origin
  allowlist (`origin.ts`) that is the only caller-gate today.
- [[0012-conversation-and-memory-model]] — decision **5a** (the view/edit/forget
  hatch this surface serves) and decision **5** (the memory-poisoning ↔ CSWSH
  chain this caller-auth defuses on the write path).
- [[0005-ui-contract-closed-set]] — the closed-set the in-overlay provenance
  affordance must use (`show_text`, no new primitive / no escalation per the
  MF-05 plan); the hatch surface is HTTP/History, not an overlay management UI.
- [[../specs/2026-06-04-memory-foundation]] — §3.5 sanctioned the "admin-tab
  HTTP" surface this route realizes; §3.4 the MUTATION-AS-APPEND model the
  projection-tombstone rides; §3.3 the "additive, not re-plumb" rule it obeys.
- [[../plans/memory-foundation/plan-05-hatch]] — the MF-05 (5a) plan that flagged
  `## ADR worthy: yes`; **Tranche 2 (`T2.1` the HTTP route) is gated on this ADR
  being accepted**.
- [[../known-gotchas]] #31 — the CSWSH exposure window (spoofable Origin); the
  release-gate the per-install token closes, and the threat this write-caller-auth
  addresses for the `/memory/*` route.
- [[../architecture]] §3 — the planned web-admin "History" tab that does not yet
  exist, whose first real job the daemon-HTTP History surface stands in for.
- [[../PIPELINE]] §5.2 — the Lior-only `proposed → accepted` gate this ADR awaits.
- Project memory: `project_agentic_engine_status` — the **light-direct
  security-hardening pass** (PR #18, postponed) that owns the broader token
  rollout this ADR pre-stages.

## Follow-up for Lior (NOT done by this ADR)

- **Accept / amend the option** — rule A, B, or C (B recommended). Until then,
  MF-05 Tranche 2 (`T2.1`) does not build.
- **Update [[../architecture]]** to reference this ADR for the daemon's HTTP
  surface — flagged as a follow-up, intentionally not edited here.
