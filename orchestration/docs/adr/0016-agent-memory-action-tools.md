---
status: accepted
date: 2026-07-10
deciders: [lior]
tags: [adr, memory, tools, agent-actions, tool-use, security, poisoning, 5d]
---

# ADR-0016: Agent action tools — a second, daemon-internal tool plane (memory actions first)

## Status

`accepted` — **by Lior 2026-07-10 at the decompose-PR gate** (full §5.2 acceptance, hard-to-reverse
tier honored: escalated before merge, no async shortcut). Spec §0 sign-off points 1–3 confirmed as
written; one acceptance rider recorded in the spec (D7a-bis rider: the extracted apply-core is
simple-but-extensible — future topic-consolidation ops land as new handlers; backlog §E).
*History: agent-authored during work (the memory-action-tools frontier decompose pass, PIPELINE §11,
2026-07-10; conductor rulings in bus q#014/q#015). Hard-to-reverse tier (new capability class + a
security surface on the just-hardened memory-write path) → escalated to Lior before merge per
PIPELINE §5.2 / Finding #5.*

## Context

Everything the LLM can *do* today is say things: `AnthropicApiProvider.advance()` is a single
`messages.create()` call with **no `tools[]`** — the reply is wrapped in `show_text` envelopes. The
only "tools" in the system are the **wire UI tools** of [[0002-ui-as-tool-calls]] /
[[0005-ui-contract-closed-set]] (`show_color_picker`, `show_text`): frozen-contract envelopes the
overlay renders.

Meanwhile the memory model matured to the point where the agent's *inability to act* is itself a
defect class: the v2-01 self-concept teaches the agent to say "I cannot forget — use the Memory
window" (a truthful deferral shipped after the agent LIED "Done! I forgot your name" with no such
tool). Roadmap **2c** commits the real capability: "forget what I said about X" / "remember Y"
should ACT mid-conversation. [[0015-intent-based-memory-forget]] decision 6 already reserved the
seam (the agent calls the same Hatch contract, machine ctx, never a source scrub);
[[0012-conversation-and-memory-model]]'s 2026-07-10 rider names "prompted edit (2c)" as one of the
only three legitimate fact-change paths — and its decision **5d makes a poisoning-surface review
mandatory** for exactly this kind of write path.

Two structural facts shape the decision:

1. **These tools must not be wire tools.** A memory action has no user-facing render; putting it on
   the wire would grow the frozen 6-variant envelope / `ToolCallPayload` union (a freeze gate) for
   zero UX benefit, and would route a daemon-internal side-effect through the overlay for no reason.
2. **These tools are a new attack class.** ADR-0013 gated *who may write* over HTTP; ADR-0012 5d
   gates *what content* enters the store. An agent action tool creates a third axis: **text inside
   the conversation** (pasted content, or a previously-poisoned remembered fact) can now cause
   durable memory side-effects. The guardrail set is therefore part of the capability decision
   itself, not an implementation detail.

## Decision

**Introduce a SECOND tool plane — engine-owned, closed-set, daemon-internal AGENT ACTION TOOLS —
executed inside the provider adapter, never on the wire. Ship memory actions first
(`memory_forget`, `memory_remember`), with the 5d guardrail package as a constitutive part of the
plane. The full mechanics live in the accepted spec
([[../specs/2026-07-10-memory-action-tools]]); this ADR fixes the decisions that outlive it:**

1. **Two tool planes, cleanly split.** *UI tools* (ADR-0002/0005): frozen wire contract, rendered by
   frontends. *Agent action tools* (this ADR): LLM-side `tools[]` declared and executed inside the
   daemon (`advance()` → `MemoryActionPort` → `Hatch`/`WriteGate`), invisible to the wire — the
   frozen envelope and `ToolCallPayload` are **byte-unchanged**. This *extends* ADR-0002's "the LLM
   acts via tool calls" model to side-effects; it does **not** touch ADR-0005's wire contract.

2. **The plane is a CLOSED SET, engine-owned, namespaced** (`memory_*` first), declared in a
   daemon-internal registry with a total interaction table (adding a tool without classifying it is
   a compile error) and a `read | write` discriminator. Additions are deliberate chunks — the
   ADR-0005 versioning discipline ported to this plane. 2c ships the two write tools; **2d adds
   read tools (`memory_search`) to this same plane** — the registry is designed for that now, built
   later. Plugin/MCP-contributed action tools are explicitly OUT until the plugin trust model
   (open-questions Q4) exists.

3. **Execution seam: DI into the provider adapter; the `AgentProvider` port is unchanged.** The
   capability arrives as a `MemoryActionPort` passed via factory options (the `clientFactory`
   posture, ADR-0010 preserved); the bounded tool loop lives inside `advance()`. **No port ⇒
   capability absent** (mock, keyless fallback) ⇒ no tools and the truthful "cannot forget"
   self-concept. The system prompt is **capability-conditional** — the agent never claims tools it
   lacks nor denies tools it has (both directions of the v2-01 lying defect excluded).

4. **The caller-auth answer for this plane is the guardrail package** (ADR-0012 5d review, ruled
   q#014): the "caller" is the conversation itself, so the gate is structural, not transport-level —
   **(a)** targetable set = only facts injected THIS turn, by server-side ordinal map (never
   LLM-echoed ids) + an expected-text optimistic-concurrency check; **(b)** hard caps (one shared
   constant bounds loop iterations and actions/turn = 3; one fact per forget; no bulk op);
   **(c)** 5e structural refusal — machine ctx can never delete/edit a human-authored fact;
   **(d)** write parity — tool-written facts pass the same 5d scan, dedup/REPLACE machinery, and are
   stamped `authored_by:'machine'` (a prompt can never mint a 5e-protected human fact), provenance
   resolving to the requesting thread; **(e)** every action AND refusal writes a durable,
   **user-visible** audit event — rendered in the Memory window via an additive-end-to-end read
   path widening (audit-not-confirm; no blocking confirmation dialog; without a visible surface the
   audit substitute for confirmation would be hollow); **(f)** typed refusal results, never throw.
   The read widening is additive on the existing token-gated `/memory/*` routes — **no new HTTP/WS
   surface or caller class** — ADR-0013/0014's posture is inherited, not modified.

5. **Forget keeps the ADR-0015 contract, plus a 2c-specific suppression.** Tool-forget =
   `forgetFactById` with machine ctx — durable delete, "release the reference", sources untouched
   ([[0012-conversation-and-memory-model]] rider Ruling 2). Because the forget-request turn itself
   is archived, the dismiss-time distiller could re-derive the fact from the conversation about
   forgetting it — so a tool-forget also records `forgotten_facts` (reviving the dormant v2-04
   table) and the delta-apply suppresses ANY machine-emitted matching text — `new`/`append`
   candidates AND a `replace`'s replacement text (a new|append-only gate would leak) — under the
   frozen precedence chain (human fact ▷ human un-forget ▷ forget record ▷ machine re-derivation).
   An explicit prompted re-assertion ("запам'ятай X" after "забудь X") bypasses and clears the
   record — it stops silent re-derivation, never the user's explicit intent.

6. **No `memory_update` tool.** The rider's "prompted edit" lane is delivered as
   remember-routed-to-REPLACE through the existing rule-gated destructive path — the agent passes an
   explicit this-turn target (`replaces_ordinal` + expected-text, symmetric with forget targeting;
   a missed target degrades to insert + the dismiss-time replace-on-change safety net) — one
   destructive path in the codebase, not two. (Also dodges a live 5e hazard: `editFact` promotes
   edited facts to human-authored; a machine edit would mint 5e-protected facts. The machine-ctx
   guard is fixed regardless.)

### Explicitly NOT decided here (so a future reader does not over-read this)

- **2d's retrieval tools** — the plane admits them; their design (hybrid BM25+embeddings, search
  scope) is the 2d pass (memory-backlog §D).
- **Non-memory action tools** (web search, files, etc.) — the plane is generic by construction, but
  each new tool family is its own deliberate decision (and Q4/Q12 territory for anything that
  executes outside the daemon).
- **A confirmation UI primitive** — audit-not-confirm is the 2c ruling; if a confirm widget ever
  joins the ADR-0005 vocabulary, the d1 stance can be revisited without touching this plane's shape.

## Consequences

### Positive

- **The agent stops being a liar-or-invalid about memory** — "forget X" acts, honestly, with the
  Memory window remaining the user's sovereign surface (5a intact; the conversational lane is the
  rider's path 2, now real).
- **The first tool-use loop lands behind the thin port** — no wire change, no freeze gate, mock and
  every existing test untouched; 2d inherits a working plane instead of designing one.
- **The poisoning surface is bounded by construction, and stated honestly:** *a fully successful
  prompt-injection buys ONE scanned, visible, machine-authored, forgettable fact — or the deletion
  of ≤3 currently-injected machine facts, each audited with recoverable text.* No human fact is
  reachable; no source content is reachable; nothing is silent.
- **Forget finally closes end-to-end:** durable delete + no-re-derivation-from-the-forget-turn —
  the last leak in the "release the reference" story.

### Negative

- **A second tool vocabulary to govern** — closed-set discipline now applies to two planes; the
  registry/total-table makes drift a compile error, but the human discipline is real.
- **The provider adapter grows a loop** — `advance()` is no longer one call; bounded (shared cap
  constant), but latency and failure surface grow with it.
- **`forgotten_facts` is live again** — the v2-04 simplification is partially unwound (a writer and
  a reader return, with the un-forget clear re-wired); accepted as the price of d5.
- **Audit-not-confirm means a maliciously-induced forget executes before a human sees it** —
  bounded by the cap + recoverable text; this is a deliberate, revisitable trade (spec §0 point 1).

### Trade-offs accepted

- We accept **acting without confirmation** in exchange for **a launcher-feel conversational lever
  with a durable audit trail** — visibility over veto, at dogfood scale, revisitable when a confirm
  primitive exists.
- We accept **ordinal-over-injected-slice targeting** (can't forget what isn't in view) in exchange
  for **the targeting mechanism doubling as the injection scope-guard**; the corpus outgrowing the
  slice is the same trigger that brings 2d search.
- We accept **machine-authorship for all tool-written facts** (an agent "remember" is never
  user-pinned) in exchange for **keeping 5e un-forgeable from inside a prompt**.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction at acceptance. Agent-drafted candidates: (a) audit-not-confirm
> proves too loose once threads run unattended (cron/background, #45) — a confirm tier returns;
> (b) the this-turn-slice targeting frustrates "forget X" for facts outside the top-20 slice
> earlier than expected, pulling 2d forward; (c) two tool planes tempt a future contributor to
> put a render-less action on the wire anyway — the registry comment must scream.]

## Alternatives Considered

### Option B: Memory tools as wire UI tools (grow the frozen closed set)

Add `memory_forget`/`memory_remember` to `ToolCallPayload` and round-trip them through the overlay.

**Why not:** a memory action has no render — routing it through the frontend adds a hop, a freeze
gate (the 6-variant union + tool registry are frozen), and an absurd dependency (memory actions
would require an overlay to be connected). ADR-0002's *reasoning* (tools as the LLM's act-verb)
carries; its *wire* does not.

### Option C: Structured output (the LLM emits an "actions" JSON block in its reply)

**Why not:** re-litigates ADR-0002's core choice against inline structured output — brittle parsing,
prompt-schema overhead, and modern models are simply better at native tool calls. Also erases the
typed-refusal channel (results feeding back into the loop) that the guardrails rely on.

### Option D: Reducer-style action requests (provider returns actions; daemon executes + re-advances)

**Why not (ruled q#014-C):** changes `ProviderResult` for every provider (including the
frozen-adjacent mock) and splits one logical turn across multiple advance() cycles for no structural
gain. DI into the adapter keeps the port thin (ADR-0010) exactly the way auth already is internal.

### Option E: Free-text / id-based fact targeting

**Why not (ruled q#014-B):** LLM-echoed uuids are unreliable (the grill-B2 finding that produced
`targetOrdinal`); free-text resolution over the full store is a hidden search tool (2d scope) with
over-deletion risk — the same failure class the v2-07 over-deleting HTTP fallback removal closed;
and both lose the scope-guard that ordinal-over-injected-slice provides for free.

### Option F: Defer 2c until a confirmation primitive exists

**Why not:** blocks the top queued memory lever on unrelated UI vocabulary work; the audit trail +
caps + 5e + scan bound the risk at dogfood scale, and the confirm tier remains an additive revisit.

## Rider 2026-07-13 (proposed): the d7 ceiling under 2d's read tool — archive search names a new second-order injection READ channel

> **Status:** `proposed` — rides the hybrid-retrieval (2d) decompose PR
> ([[../specs/2026-07-13-hybrid-retrieval]] §0.3) through the same §5.2 acceptance as that spec
> (conductor ruling bus q#017, rider 4). **⚠️ Agent-authored during work** (the 2d frontier
> decompose pass, 2026-07-13). Follows this file's sibling convention (ADR-0012's dated in-file
> riders). It records a WIDENED READ surface; every WRITE-side guardrail (d1–d7) is UNCHANGED.

**What changes:** decision 2's reserved `kind:read` slot is consumed — `memory_search` lets the
agent pull non-quarantined, non-tombstoned archive/fact content into its context mid-turn. The
d7 ceiling statement ("a fully successful prompt-injection buys ONE scanned fact or ≤3 in-view
deletions") was written when the agent could READ only the injected slice + the current turn; a
poisoned PAST message (benign as history, injection as a search result) can now re-enter the
context via search — a **second-order injection READ channel** that steers replies (and, only
within the unchanged d2/d7 write bounds, same-turn actions).

**The recorded posture:** (a) search results carry NO ordinals and never join the forget/replace
targetable map — the WRITE blast radius is byte-unchanged (spec §0.2); (b) search-result snippets
pass the existing `RuleBasedScanner` (flagged ⇒ withheld with a typed note — defense-in-depth,
honestly NOT a guarantee); (c) results are framed as quoted UNTRUSTED data in the `tool_result`,
never as instructions. **Ceiling restated under 2d:** a fully successful prompt-injection still
buys at most one scanned machine fact or ≤3 in-view deletions — plus, NEW, the ability to steer
the current reply with scanner-surviving archive text. Widening the *targetable* set remains a
deliberate future ADR-0016 amendment (full §5.2; trigger recorded in the 2d spec §0.2).

## Related

- [[../specs/2026-07-10-memory-action-tools]] — the mechanics, guardrail package, verification model, decomposition (rides the same PR; Lior signs both).
- [[0002-ui-as-tool-calls]] · [[0005-ui-contract-closed-set]] — the first tool plane this ADR extends-not-touches.
- [[0010-pluggable-llm-provider-abstraction]] — the thin port preserved by the DI seam.
- [[0012-conversation-and-memory-model]] — 5a/5d/5e; the 2026-07-10 rider (source-independence; "prompted edit (2c)" = this capability).
- [[0013-daemon-memory-write-http-surface-caller-auth]] · [[0014-connection-model-persistent-ws-dismiss-thread-adoption]] — the caller-auth lineage; this ADR adds no new transport surface.
- [[0015-intent-based-memory-forget]] — decision 6 (the reserved seam consumed here); the B1 separate-artifact invariant carried.
- [[../known-gotchas]] #9 (typed results, never throw) · #31 (the CSWSH↔poisoning chain 5d guards) · #45 (background threads — the d1 revisit trigger).
- `orchestration/.conveyor/bus/{q,a}/014-2c-tool-surface-core.md` — the conductor ruling of record.
- [[../PIPELINE]] §5.2 + Finding #5 — the acceptance gate this ADR awaits.

## Follow-up for Lior (NOT done by this ADR)

- **Accept / amend** (`proposed → accepted`) — together with the spec sign-off; the 2c chunks do not
  start before both. The §0 "Decision points for sign-off" in the spec (audit-not-confirm;
  no-update-tool) are the two taste calls folded into this acceptance.
- **Fill the regret prediction** above at acceptance.
