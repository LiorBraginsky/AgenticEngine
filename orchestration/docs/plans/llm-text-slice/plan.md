# llm-text-slice / Chunk 1 — `show_text` display-only protocol primitive — Implementation Plan

> **For the engine-worker:** Execute task-by-task, TDD. Steps use checkbox (`- [ ]`) syntax. Per project CLAUDE.md: branch first (`chunk/01-show-text-protocol-primitive`), commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer, push, open a PR targeting `main`. Never merge — Lior reviews.

**Goal:** Add a `show_text` display-only UI primitive to `packages/protocol` — a new `tool_call` payload variant `{ tool: "show_text", args: { content: string } }` that carries a machine-readable "expects no `tool_result`" marker a consumer (daemon) can branch on.

**Architecture:** Mirror the existing ADR-0005 composition direction — a base `TextPrimitive` in `primitives.ts` is the source of truth; `ShowTextArgs` in `tools.ts` composes it by single reference, exactly as `ShowColorPickerArgs` composes `ColorPickerPrimitive`. The display-only-vs-interactive distinction is encoded as a **static capability table** (`TOOL_INTERACTION`) co-located with the tool union — derivable, importable, and reused unchanged by future `image`.

**Tech Stack:** TypeScript, Zod v3, `bun:test`. Single package: `@agentic/protocol` (`packages/protocol`).

---

## Status

`Phase 3 — REVIEW-COMPLETE + VERIFIED-DONE. Reviewer verdict CLEAN on re-review (root typecheck + lint:strict + 74 tests all green; envelope byte-unchanged; scope = packages/protocol + 2 sanctioned consumer files). 5 commits on chunk/01-show-text-protocol-primitive. All 5 DoD criteria (all mechanical) have command-evidence. Pushing + opening PR; archive ritual pending Lior's merge.`

---

## Grilling gate outcome (orchestrator, 2026-06-02)

The plan touches ADR-0002 + ADR-0005 and proposes ADR-A, so it ran the `grill-with-docs` gate against the documented decisions before plan sign-off. Outcomes:

1. **RC-1 / DoD #1 reconciliation — Lior approved.** The chunk's Done criterion #1 ("envelope union 6 → 7") is imprecise: `show_color_picker` lives in the **tool** sub-union (`ToolCallPayload`, 1 variant), not the 6-variant `Envelope` union. Corrected acceptance: **tool union 1 → 2 additive; `Envelope` stays 6, `envelope.ts` byte-unchanged.** The chunk file's DoD #1 was annotated with this reconciliation (orchestrator, Lior-approved per §7.2 — reconciliation-to-reality, not new scope). Intent (additive; existing variants byte-unchanged) fully preserved.
2. **Display-only marker encoding — Lior chose the static `TOOL_INTERACTION` table** (keyed by tool name, total over `KNOWN_TOOLS` via `satisfies`). Confirmed as ADR-A's mechanism. Rejected: inline wire field (spoofable; would mutate the byte-frozen color-picker variant) and implicit `ToolResultPayload`-absence (not ergonomically consumable; kept only as a corroborating secondary signal).
3. **Terminology lineage (grill-with-docs sharpening).** ADR-0002 decision-point 3 already documents this distinction as **"return a result" vs "fire-and-forget"** (with `show_image` as the example). "display-only" is the concrete codification of ADR-0002's "fire-and-forget" — **not** a new concept. ADR-A must cite this lineage (extends ADR-0002, does not introduce a novel distinction).
4. **Versioning / Q2 — no premature contradiction.** ADR-0005 §4 ("new primitives → minor version bump") does not bite yet: no published engine version / plugin ecosystem exists (walking skeleton). Adding `show_text` internally needs no semver bump; open-question Q2 (full primitive list + versioning policy) stays open. ADR-0005 §1 already lists `text` among planned primitives, so this chunk materializes a named primitive rather than deciding the set.

---

## Reality check

AUTHORITATIVE — read from source (`packages/protocol/src/{envelope,tools,primitives,index}.ts` + tests) at plan time, not from the chunk/spec prose. Where the chunk/spec and the code disagree, **the code wins**, and the worker must follow this section.

**RC-1 — "6 → 7 variants" is the WRONG union (load-bearing correction).**
The chunk and spec §3① both say "envelope **6 → 7** variants, additive." The code does not support that framing:

- `Envelope` (`envelope.ts`) is a `z.discriminatedUnion("type", [...])` with **6** variants: `session_start`, `session_ack`, `tool_call`, `tool_result`, `tool_cancel`, `session_end`. `show_color_picker` is **NOT** an envelope variant.
- `show_color_picker` lives one level down, inside `ToolCallPayload` (`tools.ts`) — a **separate** `z.discriminatedUnion("tool", [...])` that currently has **exactly 1** variant.

So `show_text` is added to the **tool union** (`ToolCallPayload`: 1 → 2 tools), **NOT** the envelope union. The envelope union stays at **6** and `envelope.ts` is **byte-unchanged** by this chunk. The Done-criterion that matters and is achievable: *the existing `Envelope` 6-variant union and all existing tool variants are byte-unchanged; the `ToolCallPayload` tool union grows 1 → 2 additively.* The literal "envelope 6 → 7" criterion as written is **unmeetable without corrupting the contract** and is reinterpreted here as above (Lior-approved at the grilling gate). The existing test `"Envelope union has exactly 6 known message types"` (`envelope.test.ts:60`) MUST stay green and unchanged — it is the structural witness that we did not touch the envelope.

**RC-2 — `ShowColorPickerArgs` shape, export, test pattern (the template to mirror).**
- Defined in `tools.ts` as `z.object({ picker: ColorPickerPrimitive })` — it **composes a base primitive by single reference** (ADR-0005 direction, codified in the `index.ts` banner: "The PRIMITIVE is the base/source of truth. The TOOL composes the primitive by a SINGLE reference"). The args object does **not** re-declare the primitive's fields.
- The base primitive `ColorPickerPrimitive` lives in `primitives.ts` with a `primitive: z.literal("color-picker")` tag.
- Both the type and the schema are exported (`export const` + `export type ... = z.infer<...>`), and re-exported via `index.ts` (`export * from "./primitives.js"` / `"./tools.js"`). Note the **`.js` extension** on every relative import (ESM/NodeNext) — the worker MUST use `.js` too.
- Tests live in `tools.test.ts` (schema-level) and `envelope.test.ts` (parsed-through-the-envelope). They use `bun:test` (`test`/`expect`) and assert both happy-path `.parse(...)` and rejection via `.safeParse(...).success === false`. There is no separate test runner config — `bun test` discovers `*.test.ts`.

**RC-3 — There is currently NO `text` primitive (no collision).**
`primitives.ts` contains only `ColorSwatch` + `ColorPickerPrimitive`. The v0 deferral note there explicitly says `question` was kept *inside* the color-picker and **not** decomposed into a `text` primitive ("multi-primitive composition is Phase 2"). This chunk introduces the first standalone `text` primitive. This does **not** retroactively decompose the color-picker — `ColorPickerPrimitive` stays byte-unchanged; `show_text.content` is its own thing.

**RC-4 — The consumer that reads the marker is the daemon in Chunks 2/3, not this chunk.**
Per spec §3① and Chunk 2's file: the session logic must branch "interactive → park `awaiting_*`; display-only → no await → straight to `session_end`." That consumer lives in `packages/daemon` and is **OUT** of this chunk's diff. Therefore the marker this chunk ships must be (a) a value importable from `@agentic/protocol`, and (b) usable without instantiating a payload (the daemon decides *before* it has a result). A pure static lookup keyed by tool name satisfies both. **Behavioral confirmation that the daemon actually branches correctly is OUT of scope here and requires the Chunk 2/3 runtime demo to confirm — this chunk proves only that the marker exists, is correct, and is importable (mechanical: typecheck + unit test).**

**RC-5 — `KNOWN_TOOLS` and `classifyTool` exist and must stay consistent.**
`tools.ts` has `KNOWN_TOOLS = ["show_color_picker"]` and a `classifyTool` graceful-classifier. Adding a tool means `KNOWN_TOOLS` becomes `["show_color_picker", "show_text"]` so `classifyTool("show_text")` returns `{ known: true }`. Forgetting this would leave `show_text` classified as an unknown/hallucinated tool by the daemon. This is mechanical and covered by a task below.

**RC-6 — Scope-guard Q2 holds.** Adding `text` does not settle the full primitive list or the versioning policy (open-question Q2). No `KNOWN_TOOLS`-completeness assertion, no version field, no "primitive set is now frozen" comment. Add exactly one primitive + one tool + one marker entry.

---

## Requirements

R1. `primitives.ts` gains a `TextPrimitive` = `z.object({ primitive: z.literal("text"), content: z.string() })`, exported (const + inferred type), self-validating. (Mirrors `ColorPickerPrimitive`; satisfies ADR-0005 "primitive is the source of truth.")

R2. `tools.ts` gains `ShowTextArgs` = `z.object({ text: TextPrimitive })` composing the primitive by single reference (mirrors `ShowColorPickerArgs`'s `{ picker: ... }`). Exported const + inferred type. Validates `{ text: { primitive: "text", content: "..." } }`; rejects malformed (missing `content`, wrong type, missing `primitive` tag).

R3. `ToolCallPayload` discriminated union grows **1 → 2** additively: existing `show_color_picker` variant **byte-unchanged**, new `{ tool: z.literal("show_text"), args: ShowTextArgs }` appended.

R4. `show_text` gets **NO** entry in `ToolResultPayload` — it is display-only and never produces a result. `ToolResultPayload` stays byte-unchanged (still only `show_color_picker`).

R5. A **machine-readable display-only marker** is shipped from `packages/protocol`: a static `TOOL_INTERACTION` table mapping each tool name to `"interactive"` | `"display-only"`, plus a helper `toolInteraction(tool)`. The daemon can read it *without* a payload instance. `show_color_picker → "interactive"`, `show_text → "display-only"`.

R6. `KNOWN_TOOLS` becomes `["show_color_picker", "show_text"]`; `classifyTool("show_text") === { known: true, name: "show_text" }`.

R7. `envelope.ts` is byte-unchanged. The `Envelope` union stays at 6 variants; the existing "exactly 6" witness test stays green.

R8. New tests cover: `TextPrimitive` validate/reject; `ShowTextArgs` validate/reject; `ToolCallPayload` accepts `show_text` and the tool union now has 2 options; `ToolResultPayload` does NOT accept `show_text`; `TOOL_INTERACTION`/`toolInteraction` returns the right value for both tools and is total over `KNOWN_TOOLS`; `classifyTool("show_text")` is known; a parsed-through-envelope `tool_call{show_text}` round-trips. Existing tests stay green.

R9. `git diff` touches **only** `packages/protocol`.

---

## Design

The one real decision: **how is "this primitive expects no `tool_result`" encoded so a consumer (the daemon) can branch on it generically, reused unchanged by future `image`?** **Decided at grilling gate: the static `TOOL_INTERACTION` table (below).**

Constraints from the Reality check that prune the option space:
- The daemon decides *before* it has any result, so the marker must be derivable from the **tool name / tool-call alone**, not from a result payload (RC-4).
- The marker must be **importable as a value** from `@agentic/protocol` (the consumer is in another package, out of this chunk's diff).
- It must **generalize cleanly** to `image` (also display-only) and to all future interactive tools, with no per-consumer hardcoding.
- It must respect ADR-0005 composition (primitive = source of truth) and the STOP-THE-LINE "additive only" discipline in `index.ts`.

### Chosen: static `TOOL_INTERACTION` capability table (a third, parallel discriminator)

Add to `tools.ts`, right beside `KNOWN_TOOLS`:

```ts
/**
 * Interaction class of each UI tool — the DISPLAY-ONLY vs INTERACTIVE
 * discriminator (ADR-A). The daemon reads this to decide session phase:
 *   interactive   → emit tool_call, PARK in awaiting_* until tool_result/tool_cancel
 *   display-only  → emit tool_call, NO await, proceed straight to session_end
 * Keyed by tool NAME so a consumer can branch BEFORE it has any result.
 * Future display-only primitives (image) add one entry here — nothing else.
 *
 * Lineage: ADR-0002 decision-point 3 already split UI tools into "returns a
 * result" vs "fire-and-forget" (show_image). This table is the concrete
 * codification of that already-decided distinction, not a new concept.
 */
export const TOOL_INTERACTION = {
  show_color_picker: "interactive",
  show_text: "display-only",
} as const satisfies Record<KnownToolName, "interactive" | "display-only">;

export type ToolInteraction = (typeof TOOL_INTERACTION)[KnownToolName];

/** Graceful lookup; unknown tool ⇒ undefined (never throws). */
export function toolInteraction(tool: string): ToolInteraction | undefined {
  return (TOOL_INTERACTION as Record<string, ToolInteraction>)[tool];
}
```

This mirrors the protocol's **existing** pattern of "a small closed table + a graceful non-throwing classifier" (`KNOWN_TOOLS` + `classifyTool`; `KNOWN_MESSAGE_TYPES` + `parseEnvelope`). The `satisfies Record<KnownToolName, ...>` makes the table **total over the tool set at compile time** — if someone adds a tool to `KNOWN_TOOLS` and forgets to classify its interaction, typecheck fails. That is the cleanest possible generality: the contract *forces* every future primitive (including `image`) to declare its interaction class, and the daemon branches with one `toolInteraction(name)` call.

**Why this is the right fit (not over-engineering):**
- Pure data + one pure function — lives entirely in the functional core, no I/O, trivially testable (mechanical Done criteria).
- Decouples the marker from payload instances → the daemon reads it at tool-call dispatch time, exactly when it must decide await-vs-not.
- Additive: `ToolCallPayload`, `ToolResultPayload`, and `envelope.ts` are untouched in shape; the marker is a new export, not a field mutation → honors STOP-THE-LINE "additive only."
- The absence of a `show_text` row in `ToolResultPayload` (R4) is a **second, independent** signal of display-only-ness that stays consistent with the table — belt and suspenders, but the table is the one the daemon should read (it's keyed by name and total).

### Alternatives weighed (and rejected at the grilling gate)

- **Alternative A — inline `interaction` field inside the payload** (`{ tool: "show_text", interaction: "display-only", args }`): redundant + spoofable; the interaction class is an intrinsic property of the tool *name*, not per-call data; would also force adding the field to the byte-frozen `show_color_picker` variant → breaks the byte-unchanged criterion. **Rejected.**
- **Alternative B — derive implicitly from `ToolResultPayload` membership** ("display-only iff no result variant"): implicit and not ergonomically consumable (daemon must introspect a Zod union at runtime); conflates "produces no result type" with "expects no await." **Rejected as primary; kept as a corroborating secondary signal (R4).**

### Primitive vs args shape (mirroring, not a new decision)

Per ADR-0005 + the `index.ts` banner, the **primitive is the source of truth and the tool composes it by single reference.** So:
- `TextPrimitive` (in `primitives.ts`): `{ primitive: "text", content: string }`.
- `ShowTextArgs` (in `tools.ts`): `{ text: TextPrimitive }`.

This is deliberately parallel to `ColorPickerPrimitive` / `ShowColorPickerArgs = { picker: ... }`. It costs one extra object but keeps the composition direction uniform, which the banner explicitly demands ("Tool-args-as-source was rejected: it would be a structural stop-the-line at the 2nd primitive"). **`show_text` IS the 2nd primitive — flattening `content` directly into `ShowTextArgs` would be exactly the rejected pattern.** Mirror the existing one.

### File map

- `packages/protocol/src/primitives.ts` — **modify**: append `TextPrimitive`.
- `packages/protocol/src/tools.ts` — **modify**: append `ShowTextArgs`; add `show_text` to `ToolCallPayload`; extend `KNOWN_TOOLS`; add `TOOL_INTERACTION` + `ToolInteraction` + `toolInteraction`. **Do NOT add `show_text` to `ToolResultPayload`.**
- `packages/protocol/src/index.ts` — **modify (doc only)**: extend the banner to document display-only and the tool union 1→2. `export *` already re-exports the new symbols; no export line change needed.
- `packages/protocol/src/primitives.test.ts` — **create**: focused `TextPrimitive` tests.
- `packages/protocol/src/tools.test.ts` — **modify**: add `ShowTextArgs`, `ToolCallPayload`-accepts-`show_text`, tool-union-count, `ToolResultPayload`-rejects-`show_text`, `TOOL_INTERACTION`/`toolInteraction`, and `classifyTool("show_text")` tests.
- `packages/protocol/src/envelope.test.ts` — **modify**: add one parsed-through-envelope `tool_call{show_text}` round-trip test + a guard that `Envelope.options.length === 6`. **Do NOT touch** the existing "exactly 6" witness test (it must stay and stay green).
- `packages/protocol/src/envelope.ts` — **DO NOT TOUCH** (R7).

---

## Steps

Three sequential tasks. TDD: failing test → minimal impl → green → commit. Tests run with `bun test packages/protocol` (or `cd packages/protocol && bun test`).

### Task 1 — `TextPrimitive` base primitive (source of truth)

**Files:** create `packages/protocol/src/primitives.test.ts`; modify `packages/protocol/src/primitives.ts`.

- [ ] **Step 1.1 — Write the failing test.** Create `packages/protocol/src/primitives.test.ts`:

```ts
import { test, expect } from "bun:test";
import { TextPrimitive } from "./primitives.js";

test("TextPrimitive validates { primitive: 'text', content: string }", () => {
  const ok = TextPrimitive.safeParse({ primitive: "text", content: "hello" });
  expect(ok.success).toBe(true);
});

test("TextPrimitive rejects missing content", () => {
  expect(TextPrimitive.safeParse({ primitive: "text" }).success).toBe(false);
});

test("TextPrimitive rejects non-string content", () => {
  expect(TextPrimitive.safeParse({ primitive: "text", content: 42 }).success).toBe(false);
});

test("TextPrimitive rejects wrong primitive tag", () => {
  expect(TextPrimitive.safeParse({ primitive: "color-picker", content: "x" }).success).toBe(false);
});

test("TextPrimitive accepts empty-string content (display-only, no min)", () => {
  // content is not constrained to non-empty in this slice (Q2 / versioning stays open).
  expect(TextPrimitive.safeParse({ primitive: "text", content: "" }).success).toBe(true);
});
```

- [ ] **Step 1.2 — Run, verify it fails.** `bun test packages/protocol/src/primitives.test.ts`. Expected: FAIL — `TextPrimitive` not exported.

- [ ] **Step 1.3 — Implement.** Append to `packages/protocol/src/primitives.ts` (after `ColorPickerPrimitive`):

```ts
/**
 * SOURCE OF TRUTH for the `text` UI primitive (ADR-0005 closed-set; ADR-A).
 * The FIRST standalone primitive besides color-picker. Display-only: it is
 * rendered and never produces a tool_result (the display-only-vs-interactive
 * distinction is declared in tools.ts via TOOL_INTERACTION).
 *
 * Mirrors ColorPickerPrimitive: the primitive is the base; the tool
 * (ShowTextArgs) COMPOSES it by single reference (tools.ts).
 *
 * NOTE: adding `text` does NOT settle the full primitive set or versioning
 * (open-question Q2 stays open). `content` is an unconstrained string in this
 * slice (no min/max, no markdown flag — additive later).
 */
export const TextPrimitive = z.object({
  primitive: z.literal("text"),
  content: z.string(),
});
export type TextPrimitive = z.infer<typeof TextPrimitive>;
```

- [ ] **Step 1.4 — Run, verify green.** `bun test packages/protocol/src/primitives.test.ts` (PASS, 5 tests). Then `bun test packages/protocol` (no regression).

- [ ] **Step 1.5 — Commit.**

```bash
git checkout -b chunk/01-show-text-protocol-primitive   # if not already on it
git add packages/protocol/src/primitives.ts packages/protocol/src/primitives.test.ts
git commit -m "feat(protocol): add TextPrimitive base (source of truth for show_text)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2 — `ShowTextArgs` + `show_text` in the tool union + `KNOWN_TOOLS`

**Files:** modify `packages/protocol/src/tools.ts`, `packages/protocol/src/tools.test.ts`.

- [ ] **Step 2.1 — Write the failing tests.** Append to `tools.test.ts`. Add `ShowTextArgs`, `ToolResultPayload`, `KNOWN_TOOLS` to the import from `./tools.js`, and `TextPrimitive` to the import from `./primitives.js`. Then add:

```ts
const validTextArgs = { text: { primitive: "text", content: "Sunset orange is #FF5E3A." } };

test("ShowTextArgs composes the text primitive by single reference", () => {
  const parsed = ShowTextArgs.parse(validTextArgs);
  expect(parsed.text.content).toBe("Sunset orange is #FF5E3A.");
  expect(parsed.text.primitive).toBe("text");
});

test("ShowTextArgs rejects missing content", () => {
  expect(ShowTextArgs.safeParse({ text: { primitive: "text" } }).success).toBe(false);
});

test("ShowTextArgs rejects non-string content", () => {
  expect(ShowTextArgs.safeParse({ text: { primitive: "text", content: 5 } }).success).toBe(false);
});

test("ToolCallPayload accepts show_text (tool union grew additively)", () => {
  const r = ToolCallPayload.safeParse({ tool: "show_text", args: validTextArgs });
  expect(r.success).toBe(true);
});

test("ToolCallPayload still accepts show_color_picker (existing variant unchanged)", () => {
  const r = ToolCallPayload.safeParse({ tool: "show_color_picker", args: validArgs });
  expect(r.success).toBe(true);
});

test("ToolCallPayload tool union has exactly 2 known tools", () => {
  // structural witness: 1 (v0) + show_text (this chunk). Asserts ADDITIVE growth.
  expect(ToolCallPayload.options.length).toBe(2);
});

test("ToolResultPayload does NOT accept show_text (display-only: no result)", () => {
  expect(ToolResultPayload.safeParse({ tool: "show_text", result: { content: "x" } }).success).toBe(false);
  // and the result union did not grow
  expect(ToolResultPayload.options.length).toBe(1);
});

test("KNOWN_TOOLS includes show_text; classifyTool knows it", () => {
  expect(KNOWN_TOOLS).toContain("show_text");
  expect(classifyTool("show_text")).toEqual({ known: true, name: "show_text" });
});
```

(`validArgs` is the existing const at the top of the file — reuse it; do not redeclare. Adapt the `classifyTool` expected shape if the existing tests show a different return form.)

- [ ] **Step 2.2 — Run, verify it fails.** `bun test packages/protocol/src/tools.test.ts`. Expected: FAIL.

- [ ] **Step 2.3 — Implement.** In `tools.ts`:

  (a) Add `TextPrimitive` to the import from `./primitives.js`:
  ```ts
  import { ColorPickerPrimitive, ColorSwatch, TextPrimitive } from "./primitives.js";
  ```
  (b) After `ShowColorPickerResult`, add the args (note: **no** corresponding `Result` type — display-only):
  ```ts
  /**
   * Tool args for the display-only `text` primitive. COMPOSES TextPrimitive by
   * a SINGLE reference (mirrors ShowColorPickerArgs's `picker`). DISPLAY-ONLY:
   * there is intentionally NO ShowTextResult and NO show_text variant in
   * ToolResultPayload — show_text never returns (see TOOL_INTERACTION below).
   */
  export const ShowTextArgs = z.object({
    text: TextPrimitive,
  });
  export type ShowTextArgs = z.infer<typeof ShowTextArgs>;
  ```
  (c) Extend `ToolCallPayload` ADDITIVELY — append the new variant, leave `show_color_picker` byte-unchanged:
  ```ts
  export const ToolCallPayload = z.discriminatedUnion("tool", [
    z.object({ tool: z.literal("show_color_picker"), args: ShowColorPickerArgs }),
    z.object({ tool: z.literal("show_text"), args: ShowTextArgs }),
  ]);
  ```
  (d) Leave `ToolResultPayload` **byte-unchanged** (still only `show_color_picker`).
  (e) Extend `KNOWN_TOOLS`:
  ```ts
  export const KNOWN_TOOLS = ["show_color_picker", "show_text"] as const;
  ```

- [ ] **Step 2.4 — Run, verify green.** `bun test packages/protocol` (all PASS incl. the envelope "exactly 6" witness + `classifyTool` tests).

- [ ] **Step 2.5 — Commit.**

```bash
git add packages/protocol/src/tools.ts packages/protocol/src/tools.test.ts
git commit -m "feat(protocol): add show_text tool variant + ShowTextArgs (display-only, no result)

ToolCallPayload tool union 1->2 (additive). show_color_picker byte-unchanged.
No ToolResultPayload variant: show_text is display-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3 — Display-only marker (`TOOL_INTERACTION` + `toolInteraction`) + envelope round-trip + banner doc

**Files:** modify `tools.ts`, `tools.test.ts`, `envelope.test.ts`, `index.ts` (doc banner only).

- [ ] **Step 3.1 — Write the failing tests.** Append to `tools.test.ts` (add `TOOL_INTERACTION`, `toolInteraction` to the `./tools.js` import):

```ts
test("TOOL_INTERACTION marks show_text display-only and show_color_picker interactive", () => {
  expect(TOOL_INTERACTION.show_text).toBe("display-only");
  expect(TOOL_INTERACTION.show_color_picker).toBe("interactive");
});

test("TOOL_INTERACTION is total over KNOWN_TOOLS (every tool classified)", () => {
  for (const t of KNOWN_TOOLS) {
    expect(TOOL_INTERACTION[t]).toBeDefined();
  }
});

test("toolInteraction: display-only consumer branch is readable by name alone", () => {
  expect(toolInteraction("show_text")).toBe("display-only");
  expect(toolInteraction("show_color_picker")).toBe("interactive");
});

test("toolInteraction: unknown tool ⇒ undefined, never throws", () => {
  expect(toolInteraction("show_mystery")).toBeUndefined();
  expect(() => toolInteraction("show_mystery")).not.toThrow();
});
```

And append to `envelope.test.ts` (does NOT modify the existing "exactly 6" test; add `Envelope` to the `./envelope.js` import if not already present):

```ts
test("tool_call envelope with show_text payload parses (display-only primitive)", () => {
  const r = parseEnvelope({
    type: "tool_call",
    session_id: "s1",
    call_id: "c2",
    payload: { tool: "show_text", args: { text: { primitive: "text", content: "Sunset orange is #FF5E3A." } } },
  });
  expect(r.kind).toBe("ok");
});

test("Envelope union STILL has exactly 6 known message types (show_text is a TOOL, not an envelope variant)", () => {
  // RC-1: show_text is additive to the TOOL union, never the envelope union.
  expect(Envelope.options.length).toBe(6);
});
```

(Worker: confirm the exact `parseEnvelope` success shape against the existing tests — `r.kind === "ok"` vs another form — and the envelope field names (`session_id`/`call_id`) against an existing `tool_call` test; mirror them.)

- [ ] **Step 3.2 — Run, verify it fails.** `bun test packages/protocol/src/tools.test.ts packages/protocol/src/envelope.test.ts`. Expected: FAIL on `TOOL_INTERACTION`/`toolInteraction` undefined. (The two new envelope tests may already PASS — they are regression guards.)

- [ ] **Step 3.3 — Implement the marker.** Append to `tools.ts` (after `classifyTool`):

```ts
/**
 * DISPLAY-ONLY vs INTERACTIVE discriminator (ADR-A). The daemon reads this to
 * decide session phase at tool-call dispatch time — BEFORE it has any result:
 *   "interactive"  → emit tool_call, PARK awaiting_* until tool_result/tool_cancel
 *   "display-only" → emit tool_call, NO await, proceed straight to session_end
 * Keyed by tool NAME (a consumer branches without a payload instance). Future
 * display-only primitives (e.g. image) add exactly one row here — nothing else.
 * `satisfies Record<KnownToolName, ...>` makes this TOTAL: adding a tool to
 * KNOWN_TOOLS without classifying its interaction is a COMPILE error.
 *
 * Lineage: codifies ADR-0002 decision-point 3 ("returns a result" vs
 * "fire-and-forget"). Consistent with ToolResultPayload: display-only tools
 * have no result variant. This table — keyed by name, total — is the signal
 * the daemon should read.
 */
export const TOOL_INTERACTION = {
  show_color_picker: "interactive",
  show_text: "display-only",
} as const satisfies Record<KnownToolName, "interactive" | "display-only">;

export type ToolInteraction = (typeof TOOL_INTERACTION)[KnownToolName];

/** Graceful lookup by tool name; unknown tool ⇒ undefined, never throws. */
export function toolInteraction(tool: string): ToolInteraction | undefined {
  return (TOOL_INTERACTION as Record<string, ToolInteraction>)[tool];
}
```

(Worker: `KnownToolName` should be the existing type derived from `KNOWN_TOOLS` — reuse it; if it doesn't exist yet, derive `type KnownToolName = (typeof KNOWN_TOOLS)[number]` next to `KNOWN_TOOLS`.)

- [ ] **Step 3.4 — Update the `index.ts` banner (doc only, no export change).** Update the TOOL REGISTRY count to **(2)** listing `show_text`, and add a short "display-only vs interactive (ADR-A)" note explaining: interactive (`show_color_picker`) awaits a `tool_result`; display-only (`show_text`) returns none and the daemon proceeds to `session_end`; display-only tools have no `ToolResultPayload` variant; future `image` reuses it via one `TOOL_INTERACTION` row; this is additive — the envelope union is untouched (still 6), `show_text` is a new TOOL (1 → 2). Do **not** add any "primitive set frozen" / version language (Q2 stays open).

- [ ] **Step 3.5 — Run, verify green + typecheck.** `bun test packages/protocol` (ALL PASS). Then typecheck: `cd packages/protocol && bunx tsc --noEmit -p tsconfig.json` (the `satisfies` totality check must compile clean). If the repo exposes a `typecheck`/`lint:strict` script, prefer it.

- [ ] **Step 3.6 — Verify diff is protocol-only.** `git status --porcelain` and `git diff --name-only origin/main...HEAD`. Expected: every path under `packages/protocol/`. If anything outside appears, STOP — R9 violated.

- [ ] **Step 3.7 — Commit + push + PR.**

```bash
git add packages/protocol/src/tools.ts packages/protocol/src/tools.test.ts \
        packages/protocol/src/envelope.test.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): TOOL_INTERACTION display-only marker + show_text envelope round-trip

Static per-tool interaction table (total over KNOWN_TOOLS) so the daemon can
branch display-only vs interactive by tool name before it has a result.
Envelope union untouched (still 6); banner updated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin chunk/01-show-text-protocol-primitive
# PR body: see the chunk + this plan; note the RC-1 reconciliation (tool union 1→2, envelope unchanged).
```

---

## ADR worthy: yes — title: "text display-only UI primitive"

**## ADR: `orchestration/docs/adr/0009-text-display-only-ui-primitive.md`** (drafted by adr-curator; **`status: accepted` by Lior 2026-06-02**).

Per spec §11 ADR-A. Pre-digested below (the durable source of truth is now ADR-0009).

### ADR section (for adr-curator)

**Title:** `ADR-0009: text display-only UI primitive`. **Status:** proposed.

**Context.** The first real-LLM slice (`llm-text-slice`) must render the agent's conversational text. Per ADR-0002 (UI as tool calls) everything the user sees is a tool call, and per ADR-0005 the UI vocabulary is a closed set of engine-defined primitives (ADR-0005 §1 already lists `text`). The text reply must therefore be a UI primitive rendered via a `tool_call`, not a side-channel "message" envelope (which would reopen ADR-0002). The existing tool vocabulary has exactly one tool, `show_color_picker`, which is **interactive**: it emits a `tool_call` and the daemon parks the session awaiting a `tool_result`. A text reply is **display-only**: shown, never returns a result. ADR-0002 decision-point 3 already named this split ("returns a result" vs "fire-and-forget", e.g. `show_image`) but the protocol had no machine-readable way to express it for the session layer (Chunks 2/3) to branch on.

**Decision.**
1. Add `show_text` to the closed UI-primitive set (ADR-0005) as the second UI tool, carrying `{ content: string }` via a `TextPrimitive` composed by `ShowTextArgs` (same composition direction as `show_color_picker`/`ColorPickerPrimitive`).
2. Introduce a **display-only vs interactive** distinction as a first-class, machine-readable contract property: a static `TOOL_INTERACTION` table (keyed by tool name, total over `KNOWN_TOOLS` via `satisfies`) plus a `toolInteraction()` helper. `show_text` is `display-only`; `show_color_picker` is `interactive`. Display-only tools additionally have **no** variant in `ToolResultPayload`. This codifies ADR-0002's "fire-and-forget" concept.
3. **Additive and wire-compatible:** the tool union grows 1 → 2; the 6-variant **envelope** union and the existing `show_color_picker` variant are **byte-unchanged**. (Corrects the spec/chunk "envelope 6 → 7" wording — the growth is in the tool union, not the envelope union.)

**Consequences.**
- Positive: the daemon branches generically on `toolInteraction(name)` — interactive → park `awaiting_*`; display-only → no await → `session_end`. Future display-only primitives (`image`) reuse it by adding one row; `satisfies` totality forces every future tool to declare its class at compile time. Consistent with ADR-0002 (text is a tool call, not a message channel) and ADR-0005 (closed set, primitive-as-source-of-truth). v0 unbroken.
- Negative / accepted: a second interaction class adds a branch to the session phase machine (lands in Chunks 2/3, not here). Two consistent signals exist (the table + absence of a `ToolResultPayload` variant); the table, keyed by name and total, is canonical.
- **Explicitly NOT decided (open-question Q2 stays open):** the full Phase-2 primitive list (button/input/image) and the primitive versioning policy. This ADR adds exactly one primitive + the interaction-class mechanism; it does not freeze the set.
- Relationship: extends ADR-0005 (adds a primitive + the interaction-class dimension) and ADR-0002 (confirms display-only output is still a tool call, codifies "fire-and-forget"). Supersedes nothing.
