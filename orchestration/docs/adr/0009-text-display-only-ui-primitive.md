---
status: accepted
date: 2026-06-02
deciders: [lior]
tags: [adr, ui, protocol]
---

# ADR-0009: text display-only UI primitive

## Status

`accepted`

## Context

The first post-v0 vertical slice (`llm-text-slice`) must render the agent's conversational reply — plain text — on screen. Per [[0002-ui-as-tool-calls]], **everything the user sees is a tool call**; per [[0005-ui-contract-closed-set]], the UI vocabulary is a closed set of engine-defined primitives. So the text reply has to be a UI primitive carried by a `tool_call`, **not** a side-channel "message" envelope variant — a message channel would quietly reopen ADR-0002.

The existing tool vocabulary has exactly one tool, `show_color_picker`. It is **interactive**: the daemon emits the `tool_call` and then parks the session in `awaiting_*` until a `tool_result` (or `tool_cancel`) comes back. A text reply is the opposite: it is shown and **never returns a result**. The session layer (lands in Chunks 2/3) needs to decide *at dispatch time, before it has any result*, whether to park or to proceed straight to `session_end`. The protocol had no machine-readable way to express that branch.

This distinction is **not new**. [[0002-ui-as-tool-calls]] decision-point 3 already split UI tools into **"may return a result"** vs **"fire-and-forget"** (its example was `show_image`). What was missing was a concrete, importable encoding of that already-decided split that a consumer in another package can branch on. This ADR supplies that encoding; it does not invent the concept.

It also materializes a primitive that was already anticipated: [[0005-ui-contract-closed-set]] §1 lists `text` among the planned primitives. This ADR names and ships that one primitive — it does not decide the full set.

## Decision

**Add `show_text` as the second tool in the closed UI vocabulary — a display-only primitive carrying `{ content: string }` — and codify the display-only-vs-interactive split as a static, machine-readable per-tool capability table.**

Concretely:

1. **`show_text` primitive.** A base `TextPrimitive` (`{ primitive: "text", content: string }`) lives in `primitives.ts` as the source of truth; the tool `ShowTextArgs` (`{ text: TextPrimitive }`) **composes it by a single reference**. This is the exact composition direction already used by `ColorPickerPrimitive` / `ShowColorPickerArgs` (`{ picker: ... }`), mandated by ADR-0005 and the `index.ts` banner ("the PRIMITIVE is the base/source of truth; the TOOL composes the primitive by a SINGLE reference"). `show_text` is the *second* primitive — flattening `content` directly into the args would be precisely the "tool-args-as-source" pattern that was rejected to avoid a stop-the-line refactor at the 2nd primitive.

2. **Display-only vs interactive as a first-class, machine-readable contract property.** A static `TOOL_INTERACTION` table, keyed by tool name, maps each tool to `"interactive" | "display-only"`, plus a graceful `toolInteraction(name)` helper (unknown tool ⇒ `undefined`, never throws). `show_text` is `display-only`; `show_color_picker` is `interactive`. The table is made **total over `KNOWN_TOOLS`** via TypeScript `satisfies Record<KnownToolName, ...>` — adding a future tool to `KNOWN_TOOLS` without classifying its interaction is a *compile error*. The daemon branches generically: `interactive → park awaiting_*`; `display-only → no await → session_end`. As a corroborating (secondary, not primary) signal, display-only tools also have **no** variant in `ToolResultPayload`.

3. **Additive and wire-compatible.** The **tool** union (`ToolCallPayload`) grows **1 → 2**; the existing `show_color_picker` tool variant and the **6-variant envelope union (`Envelope`) are byte-unchanged**. This corrects the looser "envelope 6 → 7" phrasing in the spec/chunk: the growth is in the *tool* sub-union, not the *envelope* union. This ADR is the durable source of truth for that framing.

### Explicitly NOT decided here (so a future reader does not over-read this)

- **Open-question Q2 stays open.** This ADR adds **exactly one** primitive (`text`) plus the interaction-class mechanism. It does **not** freeze the Phase-2 primitive list (`button` / `input` / `image`) nor the primitive **versioning policy**. See [[../open-questions]] Q2.
- ADR-0005 §4 ("new primitives → minor version bump") does not bite yet: there is no published engine version or plugin ecosystem (walking skeleton), so adding `show_text` internally needs no semver bump. That policy decision remains Q2's to make.

## Consequences

### Positive

- **The daemon branches generically.** One `toolInteraction(name)` call at tool-call dispatch decides park-vs-proceed, with no per-tool hardcoding — keyed by name, so it works *before* any result exists.
- **Forced future discipline.** The `satisfies` totality means every future tool — including `image` (also display-only) — must declare its interaction class at compile time. Adding `image` is one `TOOL_INTERACTION` row, nothing else.
- **Stays consistent with both prior ADRs.** Text remains a tool call, not a message channel ([[0002-ui-as-tool-calls]]); the vocabulary stays a closed set with the primitive as source of truth ([[0005-ui-contract-closed-set]]).
- **v0 unbroken.** Purely additive: existing `show_color_picker` flow, the `Envelope` union, and `ToolResultPayload` are untouched in shape.
- **Lives in the functional core.** Pure data + one pure helper — no I/O, trivially unit-testable.

### Negative

- **A second interaction class adds a branch** to the session phase machine. That branch is implemented downstream (Chunks 2/3), not in this protocol slice — so this ADR ships a contract whose consumer does not yet exist, and only the *mechanical* correctness (typecheck + unit test that the marker is present, correct, and importable) is provable here. Behavioral confirmation that the daemon actually branches correctly waits for the Chunk 2/3 runtime demo.
- **Two signals encode the same fact** (the `TOOL_INTERACTION` row and the absence of a `ToolResultPayload` variant). They must stay consistent. The table — keyed by name and total — is canonical; the result-union absence is a secondary corroboration only.

### Trade-offs accepted

- We accept **one extra composition object** (`ShowTextArgs` wrapping `TextPrimitive` rather than inlining `content`) in exchange for a **uniform composition direction** across all primitives, avoiding a stop-the-line refactor at the 2nd primitive.
- We accept **a contract whose consumer ships later** in exchange for a clean protocol foundation that the session layer can build straight onto.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Candidate regrets: "binary interactive/display-only was too coarse — we needed a third class (e.g. streaming/append-only) and the `satisfies` table forced an awkward retrofit," or "two signals drifted: someone added a result variant for a display-only tool and nothing caught it because the table was the only thing the daemon read."]

## Alternatives Considered

### Option A: Inline `interaction` field on the wire payload

**What it was:** carry the class in the payload itself, e.g. `{ tool: "show_text", interaction: "display-only", args }`.

**Why not:**
- The interaction class is an **intrinsic property of the tool name**, not per-call data — putting a per-tool constant into every call is redundant and **spoofable** (a malformed/hostile producer could mislabel a tool).
- It would require adding the field to the **byte-frozen `show_color_picker` variant**, breaking the "existing variants byte-unchanged" guarantee.

**Rejected.**

### Option B: Derive implicitly from `ToolResultPayload` membership

**What it was:** treat "display-only" as *implied* by the absence of a `ToolResultPayload` variant for the tool — "display-only iff no result variant."

**Why not:**
- **Implicit and not ergonomically consumable** — the daemon would have to introspect a Zod discriminated union at runtime to answer a question it needs at dispatch time.
- It **conflates** "produces no result *type*" with "expects no *await*," which are not guaranteed to be the same thing forever.

**Rejected as the primary mechanism — but kept as a corroborating secondary signal:** display-only tools do, in fact, have no `ToolResultPayload` variant, which the static table stays consistent with.

### Chosen: static `TOOL_INTERACTION` table

A small closed table keyed by tool name + a graceful non-throwing helper — mirroring the protocol's existing `KNOWN_TOOLS` + `classifyTool` and `KNOWN_MESSAGE_TYPES` + `parseEnvelope` patterns. Explicit, importable as a value, total at compile time, and the concrete **codification of ADR-0002's "fire-and-forget" split** rather than a new invention.

## Related

- [[0002-ui-as-tool-calls]] — decision-point 3 already split "returns a result" vs "fire-and-forget" (`show_image`); this ADR **codifies** that split as `TOOL_INTERACTION` and confirms display-only output is still a tool call, not a message channel.
- [[0005-ui-contract-closed-set]] — closed-set primitives, primitive-as-source-of-truth; §1 already lists `text`. This ADR **extends** it by materializing the `text` primitive and adding the interaction-class dimension.
- [[../specs/2026-06-02-llm-text-slice]] §11 ADR-A — the spec this ADR formalizes (and whose "envelope 6 → 7" wording it corrects to "tool union 1 → 2").
- [[../open-questions]] Q2 — full primitive list + versioning policy: **stays open**; this ADR does not settle it.
- [[../glossary]] — "Primitive", "UI Tool", "Widget". A "display-only / interactive primitive" term may belong here (follow-up for Lior; the glossary is in `proposed`/TODO state and out of this ADR's scope to edit).
- [[../architecture]] — UI contract in system context.
