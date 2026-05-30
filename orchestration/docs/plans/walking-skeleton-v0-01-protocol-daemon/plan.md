# Walking Skeleton v0 — Chunk 01: Frozen Wire-Protocol Contract + Minimal Daemon — Implementation Plan

> **Orchestration status:** Phase 1 (planning) — finalized after grilling gate (`grill-with-docs`, 2026-05-30). 5 freeze decisions pinned by Lior (D1–D5). ADR pass routed to adr-curator (see `## ADR worthy`). **Pending: ADR draft + Lior approval before Phase 2.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every code step here also requires superpowers:test-driven-development (red→green: write the failing test, run it, *see it fail*, implement, *see it pass*) and superpowers:verification-before-completion (real `bun test` + `bun run lint` + `bun run typecheck` output shown BEFORE any "done" claim).

**Goal:** Establish the greenfield Bun+TypeScript monorepo, a FROZEN `packages/protocol` Zod contract (6-variant envelope union + single-tool registry + color-picker primitive), and a minimal `packages/daemon` WebSocket server on `127.0.0.1:7777` with an Origin-allowlist, such that parallel chunks 02a and 02b-* can build against an immovable single source of truth.

**Architecture:** Two workspace packages. `packages/protocol` is a pure, dependency-light Zod module (the contract) — no I/O, importable everywhere. `packages/daemon` imports the contract, runs `Bun.serve` with WS upgrade gated by an Origin-allowlist, validates every inbound/outbound message against the contract, and performs one trivial session round-trip (`session_start` → daemon-minted `session_ack` → `session_end{reason:"completed"}`). Per ADR-0003 + architecture.md, the daemon owns no UI rendering; per ADR-0002/0005 the contract is the carrier of UI-tool calls. The contract is FROZEN: any post-merge change is a stop-the-line event.

**Tech Stack:** Bun (runtime + workspaces + built-in `bun test` runner), TypeScript (ESM-only, runtime-agnostic per ADR-0004), Zod (typed schema validation per ADR-0005 + gotcha #9), `crypto.randomUUID()` (web-standard session-id minting per ADR-0004). No Jest/Vitest. No new runtime dependency beyond Zod (already sanctioned by ADR-0005).

---

## Reality check

Every claim that drives this plan, mapped to file evidence. (Greenfield: no `src/`/`packages/` exists — confirmed via `Glob packages/**/*.ts` → no files. Docs are therefore the sole truth source.)

| Claim driving the plan | Evidence | Verdict |
|---|---|---|
| Greenfield — no source yet; this chunk establishes layout | `Glob packages/**/*.ts` → "No files found" | Confirmed |
| Phase = Walking Skeleton v0, the linchpin foundation chunk; 02a ∥ 02b-* depend on the frozen contract | `01-protocol-contract-and-daemon.md` lines 5, 42, 79; MEMORY: "first build milestone = Walking Skeleton v0" | Confirmed |
| Envelope union is now **6** types, not 5 (`session_ack` added) | D3 (frozen ruling) — overrides brief line 14/29 which said 5 | **Updated by D3.** Brief's "5 message types" is superseded. |
| `trigger` is a CLOSED enum `["user","cron","external"]`, skeleton sends only `"user"` | ADR-0001 Decision p.5 ("`trigger: user \| cron \| external`"); D1 | Confirmed; D1 also DELETES any prior prose claiming "tolerates unknown trigger strings." We never emit an unknown trigger. |
| `ColorPickerPrimitive` is USED-by-reference (not dead code); the tool composes it by a single reference | D2; ADR-0005 Decision p.2 ("UI tools declare their widget as a composition of primitives"), p.1 (`color-picker` is a primitive) | Confirmed; D2 updates the prior framing where the primitive risked being a stray/dead schema. It is now the single source of truth that `ShowColorPickerArgs` references. |
| Cancel is modeled ONCE, as the `tool_cancel` envelope; tool `return` is just `{picked}` — no `\| cancel` variant | Brief Notes line 86 (FLAG A path); ADR-0002 p.4 (async tools, cancellation on widget-close); D4 | Confirmed |
| `session_end.reason` is forward-compatible/open (covers timeout, gotcha #4) | Brief Notes line 87; known-gotcha #4 (`blocking-MVP`, "no new message type needed"); D1 rationale | Confirmed |
| Daemon mints `session_id` via `crypto.randomUUID()` (web-standard) and returns it via `session_ack` | D3; ADR-0004 p.2 (runtime-agnostic, web-standard APIs) | Confirmed |
| Daemon loopback-only on `127.0.0.1:7777` | ADR-0003 Decision p.3 ("listens on `127.0.0.1:7777` — loopback only") | Confirmed |
| Origin-allowlist is the v0 interim CSWSH mitigation; per-install token deferred | ADR-0003 p.5 (token planned), Status note "(with planned evolution...)"; brief lines 18, 23, 65; D5 | Confirmed; per-install token deferred to release-time, not feature-time. |
| Tauri v2 webview Origin values to allow | Verified pre-session: macOS/Linux prod `tauri://localhost`; Windows/Android `http://tauri.localhost`; `tauri dev` Vite default `http://localhost:1420` | Confirmed. All three are allowlisted (the daemon is cross-platform-portable per ADR-0003/0004 and runs against `tauri dev` during skeleton work). |
| `Bun.serve` exposes `req.headers.get("origin")` in `fetch` before `server.upgrade(req,{data})`; reject by returning a `Response` (no upgrade) | Bun WebSocket docs (fetched this session): `fetch(req, server)` has full `req.headers`; `server.upgrade` returns boolean; "do not return a Response" only on success — return a `Response` to reject | Confirmed |
| `tool_progress` deferred; gotcha #1 stays open | Brief lines 22, 64; known-gotcha #1 still `blocking-MVP`/open | Confirmed — out of scope, additive in Phase 3 |
| Zod runtime dep needs no new ADR | ADR-0005 ("typed schema (Zod, JSON Schema)") + gotcha #9 ("Zod validation rejects"); D5 | Confirmed — one-line confirmation only, no new ADR |

Net: two reality-check items moved since the brief was written — (a) the union is **6** types (D3), and (b) `ColorPickerPrimitive` is now live, referenced by `ShowColorPickerArgs` (D2). Everything else holds.

---

## Frozen decisions (D1–D5, pinned by Lior at the grilling gate, 2026-05-30)

- **D1 — `trigger` = CLOSED enum** `["user","cron","external"]` (matches ADR-0001 p.5 exactly). Skeleton sends only `"user"`. Forward-compat is the same DISCIPLINE as `session_end.reason` but a different MECHANISM, on purpose: `trigger` is a semantic discriminator (closed; finer granularity arrives as an additive optional `source?` field, never a change to `trigger`); `reason` is a degradable status (open, `.or(string)`). We NEVER emit an unknown trigger.
- **D2 — `color-picker` MINIMAL composition.** `ColorPickerPrimitive` (in `primitives.ts`) is the single source of truth; `ShowColorPickerArgs` composes it by a SINGLE reference (`{ picker: ColorPickerPrimitive }`) — no duplicated fields. Full multi-primitive composition deferred to Phase 2; for v0 `question` stays inside the color-picker primitive.
- **D3 — `session_ack` is IN the frozen union** (`{ type, session_id, client_session_id? }`). Daemon mints `session_id` (`crypto.randomUUID()`). Union now has 6 known message types. No "transport convenience outside the contract" loophole.
- **D4 — swatch shape** `ColorSwatch = { label: string, hex: /^#[0-9a-fA-F]{6}$/ }`; `picked` = one `ColorSwatch`. Cancel only via `tool_cancel` envelope (no `| cancel` return). Alpha/3-digit hex deferred.
- **D5 — ADR worthy: yes.** Amend ADR-0003 as an added dated section (not supersede, not overwrite); add known-gotcha #31; zod confirmed covered by ADR-0005 (no new ADR). See `## ADR worthy`.

---

## File structure

Repo-relative paths. All files ESM-only (`"type": "module"`), TypeScript, web-standard APIs only (ADR-0004).

**Root (Task 1 — bootstrap):**
- `package.json` — Bun workspaces (`"workspaces": ["packages/*"]`), root scripts: `test` (→ `bun test`), `lint`, `typecheck`. `"type": "module"`. Declares `zod` and `typescript` once at root.
- `tsconfig.base.json` — strict, ESM (`"module": "ESNext"`, `"moduleResolution": "bundler"`, `"target": "ESNext"`, `"verbatimModuleSyntax": true`, `"strict": true`).
- `tsconfig.json` — root, references the two packages; used by `typecheck`.
- `.gitignore` — `node_modules`, `dist`, `*.log`.
- Lint config — `eslint.config.js` (flat config, ESM) with `@typescript-eslint` recommended + `eslint`/`typescript-eslint` as **dev** deps (dev deps OK without ADR). Root `lint` script → `eslint .`, `lint:strict` → `eslint . --max-warnings=0`.
- `bunfig.toml` — minimal; ensures `bun test` runs. (No extra config needed; present for explicitness.)
- `smoke.test.ts` (root) — ONE example/smoke test proving `bun test` is wired, so downstream chunks have a target shape to copy.

**`packages/protocol` (Task 2 — FROZEN contract):**
- `packages/protocol/package.json` — name `@agentic/protocol`, `"type": "module"`, `main`/`exports` → `./src/index.ts`, depends on `zod`.
- `packages/protocol/tsconfig.json` — extends base.
- `packages/protocol/src/primitives.ts` — `ColorSwatch`, `ColorPickerPrimitive` (the SOURCE OF TRUTH per D2).
- `packages/protocol/src/tools.ts` — tool registry: `ShowColorPickerArgs` (composes the primitive by single reference, D2), `ShowColorPickerResult` (D4), the `KnownTool` discriminated union (discriminant `tool`), and the safe-parse helpers for unknown-tool graceful handling.
- `packages/protocol/src/envelope.ts` — the 6-variant `Envelope` discriminated union (discriminant `type`, D3), `Trigger` enum (D1), `SessionEndReason` (open, D1), and the FROZEN banner doc-comment.
- `packages/protocol/src/index.ts` — re-exports everything; carries the top-level FROZEN banner.
- `packages/protocol/src/envelope.test.ts` — envelope + trigger + session_ack + session_end-reason tests.
- `packages/protocol/src/tools.test.ts` — tool registry + primitive + unknown-tool tests.

**`packages/daemon` (Task 3 — minimal daemon):**
- `packages/daemon/package.json` — name `@agentic/daemon`, `"type": "module"`, depends on `@agentic/protocol` (workspace), `zod`. Script `dev` → `bun run src/index.ts`.
- `packages/daemon/tsconfig.json` — extends base.
- `packages/daemon/src/origin.ts` — `ALLOWED_ORIGINS` set + `isOriginAllowed(origin: string | null): boolean`.
- `packages/daemon/src/session.ts` — `handleSessionStart(raw)` → produces the `session_ack` + `session_end` reply pair (pure, testable; daemon mints `session_id`).
- `packages/daemon/src/index.ts` — `startDaemon(port?)` returns the `Bun.Server`; `Bun.serve` with Origin-gated upgrade + message validation + round-trip; bottom-of-file `if (import.meta.main) startDaemon()`.
- `packages/daemon/src/origin.test.ts` — allow/reject origin unit tests.
- `packages/daemon/src/session.test.ts` — pure session round-trip logic tests.
- `packages/daemon/src/daemon.test.ts` — integration: real `startDaemon()` on an ephemeral port, real WS client connect, round-trip + origin reject.
- `packages/daemon/scripts/test-client.ts` — throwaway manual client (foundation for 02a's CLI harness); connects, sends `session_start`, logs the validated round-trip.

---

## FROZEN CONTRACT BANNER (verbatim — goes in `packages/protocol/src/index.ts` and is summarized atop `envelope.ts`)

The worker MUST place this doc-comment at the top of `index.ts` exactly:

```ts
/**
 * ════════════════════════════════════════════════════════════════════════
 *  FROZEN WIRE-PROTOCOL CONTRACT — AgenticEngine Walking Skeleton v0
 * ════════════════════════════════════════════════════════════════════════
 *
 * This module is the SINGLE SOURCE OF TRUTH for the engine ↔ frontend wire
 * protocol. Chunks 02a (mock agent) and 02b-* (Tauri frontend) import it and
 * build against it INDEPENDENTLY and IN PARALLEL.
 *
 * ⛔ STOP-THE-LINE RULE: any change to this contract after merge is a
 *    stop-the-line event. Pause 02a + 02b-*, update the contract ATOMICALLY
 *    as a NEW chunk, then resume. Do NOT edit shapes here ad-hoc.
 *
 * ── Two forward-compatible levels ──────────────────────────────────────
 *  1. ENVELOPE — discriminated union on `type`. KNOWN types (6):
 *       session_start | session_ack | tool_call | tool_result |
 *       tool_cancel  | session_end
 *     Unknown `type` ⇒ graceful "unknown" classification, NEVER a throw.
 *  2. TOOL REGISTRY — discriminated union on `tool`. KNOWN tools (1):
 *       show_color_picker
 *     Unknown `tool` ⇒ graceful fallback, NEVER a throw.
 *
 * ── Forward-compat is the same DISCIPLINE, two different MECHANISMS ─────
 *  • `trigger` (session_start) is a CLOSED enum: ["user","cron","external"].
 *    It is a SEMANTIC DISCRIMINATOR. We NEVER emit an unknown trigger.
 *    Future granularity (webhook / system-event / file-change — see glossary
 *    "Inbound Trigger") all map onto trigger:"external"; finer detail arrives
 *    LATER as an ADDITIVE optional `source?` field — NEVER as a change to
 *    `trigger`. (Closed because the producer is us, not an external client.)
 *  • `session_end.reason` is an OPEN/degradable STATUS: enum-or-string.
 *    A hung session is just session_end{reason:"timeout"} — no new message
 *    type (honours gotcha #4 cheaply). Open because a status can degrade
 *    gracefully to an unknown label without breaking the receiver.
 *  Same goal (forward-compatibility); different FORM, ON PURPOSE.
 *
 * ── Cancel is modeled ONCE ──────────────────────────────────────────────
 *  Cancellation is the `tool_cancel` envelope. Tool returns carry NO cancel
 *  variant (ShowColorPickerResult is just {picked}). One source of truth.
 *
 * ── UI composition direction (ADR-0005) ────────────────────────────────
 *  The PRIMITIVE (ColorPickerPrimitive) is the base/source of truth. The TOOL
 *  (ShowColorPickerArgs) COMPOSES the primitive by a SINGLE reference — no
 *  duplicated question/palette fields. This scales ADDITIVELY when the 2nd
 *  primitive lands in Phase 2. (Tool-args-as-source was rejected: it would be
 *  a structural stop-the-line at the 2nd primitive.)
 *
 * ── Deferred (additive later; do NOT add now) ──────────────────────────
 *  • tool_progress — Phase 3, shape depends on stream semantics; gotcha #1
 *    stays open.
 *  • Multi-primitive composition — Phase 2. For v0 `question` stays INSIDE
 *    the color-picker primitive (NOT yet decomposed into a `text` primitive).
 *  • Per-install auth token (ADR-0003 p.5) — release-driven, connection-level,
 *    outside this message contract; adds additively without touching the
 *    envelope union. v0 interim mitigation = Origin-allowlist (daemon).
 *  • Alpha / 3-digit-shorthand hex — additive to ColorSwatch later.
 * ════════════════════════════════════════════════════════════════════════
 */
```

---

## Exact Zod (frozen — transcribe into the three files)

### `packages/protocol/src/primitives.ts` (D2 + D4)

```ts
import { z } from "zod";

/**
 * A single named color. `label` is REQUIRED: the agent must use the picked
 * color as structured data INCLUDING its human name without NL-parsing
 * (concept.md — "structured data the agent can use without natural-language
 * parsing"); the v0 demo references the NAMED color.
 *
 * `hex` is restricted to 6-digit #RRGGBB. Alpha / 3-digit shorthand are
 * DEFERRED (additive later).
 */
export const ColorSwatch = z.object({
  label: z.string(),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type ColorSwatch = z.infer<typeof ColorSwatch>;

/**
 * SOURCE OF TRUTH for the color-picker UI (ADR-0005: closed-set primitive).
 * Tools COMPOSE this primitive by reference (see tools.ts) — they do NOT
 * re-declare question/palette.
 *
 * NOTE (v0 deferral): `question` stays INSIDE this primitive. We do NOT yet
 * decompose it into a separate `text` primitive — multi-primitive composition
 * is Phase 2.
 */
export const ColorPickerPrimitive = z.object({
  primitive: z.literal("color-picker"),
  question: z.string(),
  palette: z.array(ColorSwatch).min(1),
});
export type ColorPickerPrimitive = z.infer<typeof ColorPickerPrimitive>;
```

### `packages/protocol/src/tools.ts` (D2 + D4)

```ts
import { z } from "zod";
import { ColorPickerPrimitive, ColorSwatch } from "./primitives.js";

/**
 * Tool args COMPOSE the primitive by a SINGLE reference (D2). No duplicated
 * question/palette fields — the primitive is the single source of truth.
 */
export const ShowColorPickerArgs = z.object({
  picker: ColorPickerPrimitive,
});
export type ShowColorPickerArgs = z.infer<typeof ShowColorPickerArgs>;

/**
 * Result carries ONLY the picked swatch. Cancellation is the `tool_cancel`
 * envelope — there is NO `| cancel` return variant (D4). One source of truth.
 */
export const ShowColorPickerResult = z.object({
  picked: ColorSwatch,
});
export type ShowColorPickerResult = z.infer<typeof ShowColorPickerResult>;

/**
 * Tool registry — discriminated union on `tool`. Exactly ONE known tool in v0.
 * Adding a tool = a NEW frozen-contract chunk (stop-the-line), never ad-hoc.
 */
export const ToolCallPayload = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("show_color_picker"), args: ShowColorPickerArgs }),
]);
export type ToolCallPayload = z.infer<typeof ToolCallPayload>;

export const ToolResultPayload = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("show_color_picker"), result: ShowColorPickerResult }),
]);
export type ToolResultPayload = z.infer<typeof ToolResultPayload>;

/** The closed set of known tool names — for graceful unknown-tool handling. */
export const KNOWN_TOOLS = ["show_color_picker"] as const;
export type KnownToolName = (typeof KNOWN_TOOLS)[number];

/**
 * Graceful, NON-THROWING classification of a tool name. Unknown `tool`
 * (e.g. an LLM hallucination, gotcha #9) ⇒ { known: false }, NEVER a throw.
 */
export function classifyTool(
  tool: unknown,
): { known: true; name: KnownToolName } | { known: false } {
  if (typeof tool === "string" && (KNOWN_TOOLS as readonly string[]).includes(tool)) {
    return { known: true, name: tool as KnownToolName };
  }
  return { known: false };
}
```

### `packages/protocol/src/envelope.ts` (D1 + D3)

```ts
import { z } from "zod";
import { ToolCallPayload, ToolResultPayload } from "./tools.js";

/**
 * D1 — CLOSED enum (ADR-0001 Decision p.5). The skeleton sends only "user".
 * cron/inbound triggers (Phase 6 rituals) map onto these three; finer
 * granularity arrives later as an ADDITIVE optional `source?` field, NEVER as
 * a change to `trigger`. We NEVER emit an unknown trigger.
 */
export const Trigger = z.enum(["user", "cron", "external"]);
export type Trigger = z.infer<typeof Trigger>;

/**
 * D1 — OPEN/degradable status (covers gotcha #4 timeout cheaply). Known values
 * parse as the enum; any other string degrades gracefully to a raw label —
 * no new message type, no break.
 */
export const SessionEndReason = z
  .enum(["completed", "cancelled", "timeout", "error"])
  .or(z.string());
export type SessionEndReason = z.infer<typeof SessionEndReason>;

// ── The 6 KNOWN envelope variants (discriminant `type`) ──────────────────

/** Frontend → daemon. Carries the user's typed text (mock ignores it, but the
 *  field must exist if sent) + an optional client-side correlation id. */
export const SessionStart = z.object({
  type: z.literal("session_start"),
  trigger: Trigger,
  text: z.string().optional(),
  client_session_id: z.string().optional(),
});

/** Daemon → frontend. Daemon MINTS `session_id` (crypto.randomUUID) and echoes
 *  the client's correlation id so 02b-i can learn its session_id (D3). */
export const SessionAck = z.object({
  type: z.literal("session_ack"),
  session_id: z.string(),
  client_session_id: z.string().optional(),
});

export const ToolCall = z.object({
  type: z.literal("tool_call"),
  session_id: z.string(),
  call_id: z.string(),
  payload: ToolCallPayload,
});

export const ToolResult = z.object({
  type: z.literal("tool_result"),
  session_id: z.string(),
  call_id: z.string(),
  payload: ToolResultPayload,
});

/** The SINGLE representation of cancellation (D4). */
export const ToolCancel = z.object({
  type: z.literal("tool_cancel"),
  session_id: z.string(),
  call_id: z.string(),
});

export const SessionEnd = z.object({
  type: z.literal("session_end"),
  session_id: z.string(),
  reason: SessionEndReason,
});

/** The KNOWN envelope union — 6 variants (D3). */
export const Envelope = z.discriminatedUnion("type", [
  SessionStart,
  SessionAck,
  ToolCall,
  ToolResult,
  ToolCancel,
  SessionEnd,
]);
export type Envelope = z.infer<typeof Envelope>;

export const KNOWN_MESSAGE_TYPES = [
  "session_start",
  "session_ack",
  "tool_call",
  "tool_result",
  "tool_cancel",
  "session_end",
] as const;
export type KnownMessageType = (typeof KNOWN_MESSAGE_TYPES)[number];

/**
 * Graceful, NON-THROWING parse of a raw inbound message. Unknown `type`,
 * malformed body, or unknown trigger ⇒ { kind: "unknown" } / { kind: "invalid" }
 * — NEVER a throw (gotcha #9). The daemon classifies and does NOT crash.
 */
export function parseEnvelope(
  raw: unknown,
):
  | { kind: "ok"; message: Envelope }
  | { kind: "unknown"; type?: string }
  | { kind: "invalid"; error: z.ZodError } {
  const result = Envelope.safeParse(raw);
  if (result.success) return { kind: "ok", message: result.data };

  const type =
    raw && typeof raw === "object" && "type" in raw
      ? (raw as { type?: unknown }).type
      : undefined;
  const typeStr = typeof type === "string" ? type : undefined;
  if (typeStr === undefined || !(KNOWN_MESSAGE_TYPES as readonly string[]).includes(typeStr)) {
    return { kind: "unknown", type: typeStr };
  }
  // Known type, but body failed validation (incl. an unknown trigger value on
  // session_start, which fails the CLOSED Trigger enum) ⇒ invalid, not a throw.
  return { kind: "invalid", error: result.error };
}
```

> Worker note on the `index.ts` re-export: place the FROZEN banner at the very top, then `export * from "./primitives.js"; export * from "./tools.js"; export * from "./envelope.js";`. Use `.js` ESM specifiers (TS `verbatimModuleSyntax` + bundler resolution; Bun resolves `.ts`).

---

## Tasks

### Task 1: Bootstrap the monorepo + `bun test` runner

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `bunfig.toml`, `.gitignore`
- Test: `smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

`smoke.test.ts`:
```ts
import { test, expect } from "bun:test";

test("bun test runner is wired", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 2: Run it, confirm the runner is even reachable**

Run: `bun test smoke.test.ts`
Expected: FAIL — `bun test` errors because there is no `package.json`/workspace yet (or "Cannot find module"). This proves the harness is not yet bootstrapped.

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "agentic-engine",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "lint": "eslint .",
    "lint:strict": "eslint . --max-warnings=0",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 5: Create root `tsconfig.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "include": ["packages/*/src/**/*.ts", "smoke.test.ts"]
}
```

- [ ] **Step 6: Create `eslint.config.js` (flat, ESM)**

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ["node_modules", "dist", "**/*.d.ts"] },
);
```

- [ ] **Step 7: Create `bunfig.toml` and `.gitignore`**

`bunfig.toml`:
```toml
[test]
# bun's built-in test runner; no Jest/Vitest.
```

`.gitignore`:
```
node_modules
dist
*.log
```

- [ ] **Step 8: Install + run the smoke test green**

Run: `bun install && bun test smoke.test.ts`
Expected: PASS — `1 pass, 0 fail`.

- [ ] **Step 9: Confirm lint + typecheck are wired**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0 (no errors). If eslint warns on the empty `bunfig`, ignore — it lints `.ts` only.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.base.json tsconfig.json eslint.config.js bunfig.toml .gitignore smoke.test.ts bun.lock
git commit -m "chore: bootstrap Bun+TS ESM monorepo with bun test runner"
```

---

### Task 2: `packages/protocol` — the FROZEN contract (Zod)

**Files:**
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/src/primitives.ts`, `packages/protocol/src/tools.ts`, `packages/protocol/src/envelope.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/tools.test.ts`, `packages/protocol/src/envelope.test.ts`

- [ ] **Step 1: Create the package scaffolding**

`packages/protocol/package.json`:
```json
{
  "name": "@agentic/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.0" }
}
```

`packages/protocol/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts"] }
```

- [ ] **Step 2: Write the failing tools/primitive test**

`packages/protocol/src/tools.test.ts`:
```ts
import { test, expect } from "bun:test";
import {
  ShowColorPickerArgs,
  ShowColorPickerResult,
  ToolCallPayload,
  classifyTool,
} from "./tools.js";
import { ColorPickerPrimitive } from "./primitives.js";

const validArgs = {
  picker: {
    primitive: "color-picker",
    question: "Pick an accent",
    palette: [{ label: "Navy", hex: "#1A2B3C" }],
  },
};

test("ShowColorPickerArgs composes the primitive by single reference", () => {
  const parsed = ShowColorPickerArgs.parse(validArgs);
  expect(parsed.picker.question).toBe("Pick an accent");
  expect(parsed.picker.palette[0]!.label).toBe("Navy");
});

test("ColorPickerPrimitive is the standalone source of truth", () => {
  expect(ColorPickerPrimitive.safeParse(validArgs.picker).success).toBe(true);
});

test("palette must have at least one swatch", () => {
  const bad = { picker: { ...validArgs.picker, palette: [] } };
  expect(ShowColorPickerArgs.safeParse(bad).success).toBe(false);
});

test("malformed hex is rejected (no throw via safeParse)", () => {
  const bad = { picker: { ...validArgs.picker, palette: [{ label: "X", hex: "1A2B3C" }] } };
  expect(ShowColorPickerArgs.safeParse(bad).success).toBe(false);
});

test("ShowColorPickerResult is just {picked}; no cancel variant", () => {
  const ok = ShowColorPickerResult.safeParse({ picked: { label: "Navy", hex: "#1A2B3C" } });
  expect(ok.success).toBe(true);
});

test("ToolCallPayload rejects unknown tool name (discriminated union)", () => {
  expect(ToolCallPayload.safeParse({ tool: "show_mystery", args: {} }).success).toBe(false);
});

test("classifyTool: known tool", () => {
  expect(classifyTool("show_color_picker")).toEqual({ known: true, name: "show_color_picker" });
});

test("classifyTool: unknown tool handled gracefully, no throw", () => {
  expect(classifyTool("show_mystery")).toEqual({ known: false });
  expect(classifyTool(undefined)).toEqual({ known: false });
});
```

- [ ] **Step 3: Run it, see it fail**

Run: `bun test packages/protocol/src/tools.test.ts`
Expected: FAIL — cannot resolve `./tools.js` / `./primitives.js` (files not created yet).

- [ ] **Step 4: Implement `primitives.ts` and `tools.ts`**

Create `packages/protocol/src/primitives.ts` and `packages/protocol/src/tools.ts` with the EXACT Zod from the "Exact Zod" section above (primitives.ts then tools.ts).

- [ ] **Step 5: Run the tools test green**

Run: `bun test packages/protocol/src/tools.test.ts`
Expected: PASS — all 8 tests pass.

- [ ] **Step 6: Write the failing envelope test**

`packages/protocol/src/envelope.test.ts`:
```ts
import { test, expect } from "bun:test";
import { Envelope, SessionEndReason, Trigger, parseEnvelope } from "./envelope.js";

test("valid session_start (trigger: user) parses", () => {
  const r = parseEnvelope({ type: "session_start", trigger: "user", text: "hi" });
  expect(r.kind).toBe("ok");
});

test("session_ack parses (D3 — in the frozen union)", () => {
  const r = parseEnvelope({ type: "session_ack", session_id: "s1", client_session_id: "c1" });
  expect(r.kind).toBe("ok");
});

test("session_end with KNOWN reason parses", () => {
  expect(parseEnvelope({ type: "session_end", session_id: "s1", reason: "completed" }).kind).toBe("ok");
});

test("session_end with UNKNOWN reason tolerated (open/degradable, D1)", () => {
  expect(SessionEndReason.safeParse("rate_limited").success).toBe(true);
  expect(parseEnvelope({ type: "session_end", session_id: "s1", reason: "rate_limited" }).kind).toBe("ok");
});

test("trigger is a CLOSED enum (D1)", () => {
  expect(Trigger.safeParse("user").success).toBe(true);
  expect(Trigger.safeParse("cron").success).toBe(true);
  expect(Trigger.safeParse("external").success).toBe(true);
  expect(Trigger.safeParse("webhook").success).toBe(false);
});

test("session_start with UNKNOWN trigger ⇒ invalid (known type, bad body), no throw", () => {
  const r = parseEnvelope({ type: "session_start", trigger: "webhook" });
  expect(r.kind).toBe("invalid"); // known type, closed-enum violation — daemon must not crash
});

test("unknown message type ⇒ graceful 'unknown', no throw", () => {
  const r = parseEnvelope({ type: "telepathy", foo: 1 });
  expect(r.kind).toBe("unknown");
  if (r.kind === "unknown") expect(r.type).toBe("telepathy");
});

test("totally malformed input ⇒ unknown/invalid, never throws", () => {
  expect(() => parseEnvelope(null)).not.toThrow();
  expect(() => parseEnvelope(42)).not.toThrow();
  expect(parseEnvelope({}).kind).toBe("unknown");
});

test("tool_call envelope with valid payload parses", () => {
  const r = parseEnvelope({
    type: "tool_call",
    session_id: "s1",
    call_id: "c1",
    payload: {
      tool: "show_color_picker",
      args: { picker: { primitive: "color-picker", question: "q", palette: [{ label: "Navy", hex: "#1A2B3C" }] } },
    },
  });
  expect(r.kind).toBe("ok");
});

test("Envelope union has exactly 6 known message types", () => {
  // discriminatedUnion options length is the structural witness of the count.
  expect(Envelope.options.length).toBe(6);
});
```

- [ ] **Step 7: Run it, see it fail**

Run: `bun test packages/protocol/src/envelope.test.ts`
Expected: FAIL — cannot resolve `./envelope.js`.

- [ ] **Step 8: Implement `envelope.ts` and `index.ts`**

Create `packages/protocol/src/envelope.ts` with the EXACT Zod from the "Exact Zod" section. Create `packages/protocol/src/index.ts`:
```ts
// (FROZEN CONTRACT BANNER doc-comment goes here — see "FROZEN CONTRACT BANNER" section, verbatim)
export * from "./primitives.js";
export * from "./tools.js";
export * from "./envelope.js";
```
Paste the full FROZEN banner doc-comment above the exports.

- [ ] **Step 9: Run the envelope test green**

Run: `bun test packages/protocol/src/envelope.test.ts`
Expected: PASS — all 10 tests pass.

- [ ] **Step 10: Verify the whole package + lint + typecheck**

Run: `bun test packages/protocol && bun run typecheck && bun run lint`
Expected: all green. Show the real `bun test` summary in the report.

- [ ] **Step 11: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): frozen 6-variant envelope + color-picker tool/primitive contract"
```

---

### Task 3: `packages/daemon` — minimal WS server + Origin-allowlist + session round-trip

**Files:**
- Create: `packages/daemon/package.json`, `packages/daemon/tsconfig.json`, `packages/daemon/src/origin.ts`, `packages/daemon/src/session.ts`, `packages/daemon/src/index.ts`, `packages/daemon/scripts/test-client.ts`
- Test: `packages/daemon/src/origin.test.ts`, `packages/daemon/src/session.test.ts`, `packages/daemon/src/daemon.test.ts`

- [ ] **Step 1: Create the package scaffolding**

`packages/daemon/package.json`:
```json
{
  "name": "@agentic/daemon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run src/index.ts",
    "test-client": "bun run scripts/test-client.ts"
  },
  "dependencies": { "@agentic/protocol": "workspace:*", "zod": "^3.23.0" }
}
```

`packages/daemon/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "scripts/**/*.ts"] }
```

Run `bun install` so the `@agentic/protocol` workspace link resolves.

- [ ] **Step 2: Write the failing origin test**

`packages/daemon/src/origin.test.ts`:
```ts
import { test, expect } from "bun:test";
import { isOriginAllowed } from "./origin.js";

test("ALLOW: Tauri prod origin (macOS/Linux)", () => {
  expect(isOriginAllowed("tauri://localhost")).toBe(true);
});
test("ALLOW: Tauri prod origin (Windows/Android)", () => {
  expect(isOriginAllowed("http://tauri.localhost")).toBe(true);
});
test("ALLOW: tauri dev Vite default", () => {
  expect(isOriginAllowed("http://localhost:1420")).toBe(true);
});
test("REJECT: arbitrary cross-site origin", () => {
  expect(isOriginAllowed("https://evil.example.com")).toBe(false);
});
test("REJECT: wrong localhost port", () => {
  expect(isOriginAllowed("http://localhost:3000")).toBe(false);
});
test("REJECT: missing origin", () => {
  expect(isOriginAllowed(null)).toBe(false);
});
```

- [ ] **Step 3: Run it, see it fail**

Run: `bun test packages/daemon/src/origin.test.ts`
Expected: FAIL — cannot resolve `./origin.js`.

- [ ] **Step 4: Implement `origin.ts`**

`packages/daemon/src/origin.ts`:
```ts
/**
 * v0 interim CSWSH mitigation (ADR-0003 Amendment 2026-05-30). The per-install
 * token (ADR-0003 p.5) is DEFERRED to before any non-dev/public release.
 *
 * ⚠️ known-gotcha #31: the Origin header is spoofable by NON-browser clients,
 * so this allowlist only stops casual cross-site BROWSER tabs. It does NOT
 * replace the connection-level token; close that gap before release.
 */
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "tauri://localhost",      // Tauri v2 prod webview — macOS / Linux
  "http://tauri.localhost", // Tauri v2 prod webview — Windows / Android
  "http://localhost:1420",  // `tauri dev` (Vite default) during skeleton work
]);

export function isOriginAllowed(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}
```

- [ ] **Step 5: Run the origin test green**

Run: `bun test packages/daemon/src/origin.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 6: Write the failing session-logic test**

`packages/daemon/src/session.test.ts`:
```ts
import { test, expect } from "bun:test";
import { handleSessionStart } from "./session.js";

test("session_start ⇒ [session_ack(minted id, echoed client id), session_end(completed)]", () => {
  const replies = handleSessionStart({
    type: "session_start",
    trigger: "user",
    text: "hello",
    client_session_id: "c-123",
  });
  expect(replies).toHaveLength(2);

  const ack = replies[0]!;
  expect(ack.type).toBe("session_ack");
  if (ack.type === "session_ack") {
    expect(typeof ack.session_id).toBe("string");
    expect(ack.session_id.length).toBeGreaterThan(0);
    expect(ack.client_session_id).toBe("c-123");
  }

  const end = replies[1]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") {
    expect(end.reason).toBe("completed");
    if (ack.type === "session_ack") expect(end.session_id).toBe(ack.session_id);
  }
});

test("daemon mints a fresh session_id per call (crypto.randomUUID)", () => {
  const a = handleSessionStart({ type: "session_start", trigger: "user" });
  const b = handleSessionStart({ type: "session_start", trigger: "user" });
  const idA = a[0]!.type === "session_ack" ? a[0]!.session_id : "";
  const idB = b[0]!.type === "session_ack" ? b[0]!.session_id : "";
  expect(idA).not.toBe(idB);
});
```

- [ ] **Step 7: Run it, see it fail**

Run: `bun test packages/daemon/src/session.test.ts`
Expected: FAIL — cannot resolve `./session.js`.

- [ ] **Step 8: Implement `session.ts`**

`packages/daemon/src/session.ts`:
```ts
import type { Envelope } from "@agentic/protocol";

/**
 * Trivial v0 session lifecycle (just enough for 02a + 02b-i to build against):
 * the daemon MINTS session_id (crypto.randomUUID — web-standard, ADR-0004),
 * acks it (echoing the client's correlation id), then ends the session.
 * Real reasoning-loop logic arrives in chunk 02a — out of scope here.
 */
type SessionStartMsg = Extract<Envelope, { type: "session_start" }>;

export function handleSessionStart(msg: SessionStartMsg): Envelope[] {
  const session_id = crypto.randomUUID();
  return [
    { type: "session_ack", session_id, client_session_id: msg.client_session_id },
    { type: "session_end", session_id, reason: "completed" },
  ];
}
```
> The `Extract<Envelope, ...>` form is self-sufficient — do not add an unused `SessionStart` type import (keep lint green).

- [ ] **Step 9: Run the session test green**

Run: `bun test packages/daemon/src/session.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 10: Implement `index.ts` (the server) — no test yet**

`packages/daemon/src/index.ts`:
```ts
import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { isOriginAllowed } from "./origin.js";
import { handleSessionStart } from "./session.js";

export const DAEMON_HOST = "127.0.0.1"; // loopback only (ADR-0003 p.3)
export const DAEMON_PORT = 7777;

function send(ws: { send(data: string): number }, msg: Envelope): void {
  // Outbound is validated against the frozen contract too (defence in depth).
  const check = parseEnvelope(msg);
  if (check.kind !== "ok") {
    console.error("[daemon] refusing to send invalid outbound message", check);
    return;
  }
  ws.send(JSON.stringify(msg));
}

export function startDaemon(port: number = DAEMON_PORT) {
  return Bun.serve({
    hostname: DAEMON_HOST,
    port,
    fetch(req, server) {
      // Origin-allowlist gate BEFORE upgrade (interim CSWSH mitigation).
      if (!isOriginAllowed(req.headers.get("origin"))) {
        return new Response("Forbidden origin", { status: 403 });
      }
      if (server.upgrade(req)) return undefined; // 101 Switching Protocols
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        let json: unknown;
        try {
          json = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        } catch {
          console.error("[daemon] non-JSON frame ignored");
          return; // never throw / crash
        }
        const parsed = parseEnvelope(json);
        if (parsed.kind !== "ok") {
          console.error("[daemon] inbound not in frozen contract:", parsed.kind);
          return; // graceful: unknown type / invalid body ignored, no crash
        }
        if (parsed.message.type === "session_start") {
          for (const reply of handleSessionStart(parsed.message)) send(ws, reply);
        }
        // Other known types are no-ops in the v0 skeleton.
      },
    },
  });
}

if (import.meta.main) {
  const server = startDaemon();
  console.log(`[daemon] listening on ws://${server.hostname}:${server.port}`);
}
```

- [ ] **Step 11: Write the failing daemon integration test**

`packages/daemon/src/daemon.test.ts`:
```ts
import { test, expect, afterAll } from "bun:test";
import { startDaemon } from "./index.js";

const server = startDaemon(0); // ephemeral port — avoids clashing with a running dev daemon
const PORT = server.port;
afterAll(() => server.stop(true));

const TAURI_ORIGIN = "tauri://localhost";

function collect(messages: unknown[], resolve: () => void, expectedCount: number) {
  return (data: string) => {
    messages.push(JSON.parse(data));
    if (messages.length >= expectedCount) resolve();
  };
}

test("ALLOWED origin: full session round-trip (start → ack → end)", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: TAURI_ORIGIN } });
  const messages: any[] = [];
  await new Promise<void>((resolve, reject) => {
    const onMsg = collect(messages, resolve, 2);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "hi", client_session_id: "c-1" })),
    );
    ws.addEventListener("message", (e) => onMsg(e.data as string));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 2000);
  });
  ws.close();

  expect(messages[0].type).toBe("session_ack");
  expect(messages[0].client_session_id).toBe("c-1");
  expect(typeof messages[0].session_id).toBe("string");
  expect(messages[1].type).toBe("session_end");
  expect(messages[1].reason).toBe("completed");
  expect(messages[1].session_id).toBe(messages[0].session_id);
});

test("REJECTED origin: arbitrary cross-site origin cannot connect", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: "https://evil.example.com" } });
  const rejected = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(false)); // should NOT open
    ws.addEventListener("error", () => resolve(true));
    ws.addEventListener("close", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });
  expect(rejected).toBe(true);
});

test("REJECTED origin: missing origin cannot connect", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); // no Origin header
  const rejected = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(false));
    ws.addEventListener("error", () => resolve(true));
    ws.addEventListener("close", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });
  expect(rejected).toBe(true);
});
```

- [ ] **Step 12: Run the daemon test green**

Run: `bun test packages/daemon/src/daemon.test.ts`
Expected: PASS — 3 tests pass (round-trip + 2 origin rejections). If the Bun client `WebSocket` `headers` option is unavailable in your Bun version, the constructor extension is documented Bun behavior; verify the Bun version supports it. The reject tests assert the connection does NOT open from a bad/missing origin.

- [ ] **Step 13: Implement the throwaway test client (foundation for 02a)**

`packages/daemon/scripts/test-client.ts`:
```ts
// Throwaway manual client — foundation for 02a's CLI harness. Run: bun run test-client
import { parseEnvelope } from "@agentic/protocol";
import { DAEMON_PORT } from "../src/index.js";

const ws = new WebSocket(`ws://127.0.0.1:${DAEMON_PORT}`, { headers: { Origin: "tauri://localhost" } });

ws.addEventListener("open", () => {
  console.log("[client] connected; sending session_start");
  ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "demo", client_session_id: "manual-1" }));
});
ws.addEventListener("message", (e) => {
  const parsed = parseEnvelope(JSON.parse(e.data as string));
  console.log("[client] received (validated):", parsed.kind, parsed);
});
ws.addEventListener("close", () => console.log("[client] closed"));
```

- [ ] **Step 14: Manually verify the client against a running daemon**

Run (terminal A): `cd packages/daemon && bun run dev`
Run (terminal B): `cd packages/daemon && bun run test-client`
Expected: client logs a validated `session_ack` (with a minted `session_id` + `client_session_id: "manual-1"`) then `session_end` (`reason: "completed"`). Document this observed output in the report.

- [ ] **Step 15: Full verification — the whole suite + lint + typecheck**

Run: `bun test && bun run typecheck && bun run lint`
Expected: ALL green. Paste the real `bun test` summary (file count + pass count) into the report. Do NOT claim done before this is shown (superpowers:verification-before-completion).

- [ ] **Step 16: Commit**

```bash
git add packages/daemon
git commit -m "feat(daemon): minimal loopback WS server, origin-allowlist, session round-trip"
```

---

## Definition of Done

The chunk is DONE only when EVERY box below is checked AND the reviewer-gate passes. This folds the brief's done-criteria (lines 29-36) together with the test-layer requirements Lior added.

**Contract (`packages/protocol`):**
- [ ] Exports Zod schemas: 6-variant envelope union (`session_start`, `session_ack`, `tool_call`, `tool_result`, `tool_cancel`, `session_end`) + tool registry (`show_color_picker`) + `ColorPickerPrimitive`; importable by `@agentic/daemon` (and, later, 02a/02b-*). [brief line 29, updated to 6 by D3]
- [ ] FROZEN banner present in `index.ts` documenting stop-the-line discipline. [brief line 30]
- [ ] Tests prove forward-compat + safety (gotcha #9, all via `safeParse`/`parseEnvelope`, NO throws):
  - [ ] valid messages parse;
  - [ ] malformed body ⇒ typed error path (`invalid`), no throw;
  - [ ] unknown `type` ⇒ graceful `unknown`, no throw;
  - [ ] unknown `tool` ⇒ `classifyTool` returns `{known:false}`, no throw;
  - [ ] D1: `trigger` closed — unknown trigger on a known `session_start` ⇒ `invalid` (daemon does not crash); `Trigger` rejects `"webhook"`;
  - [ ] D3: `session_ack` parses inside the union; union option count is exactly 6;
  - [ ] session_end unknown `reason` tolerated (open/degradable).

**Daemon (`packages/daemon`):**
- [ ] Boots on `127.0.0.1:7777` (loopback only, ADR-0003 p.3); `startDaemon(0)` works on ephemeral port for tests. [brief line 32]
- [ ] Accepts a WS connection from an ALLOWED origin, validates messages, round-trips a trivial session (`session_start` → daemon-minted `session_ack` → `session_end{reason:"completed"}`). [brief lines 32, 34; D3]
- [ ] Origin-allowlist: ALLOW `tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`; REJECT arbitrary origin, wrong localhost port, missing origin. [brief line 33]
- [ ] Throwaway test client connects, sends `session_start`, observes a validated round-trip (foundation for 02a's CLI harness). [brief line 34]

**Test-layer + process (Lior's additions):**
- [ ] Test runner is Bun's built-in `bun test` — NO Jest/Vitest added; root `test` script + a smoke test exist.
- [ ] Worker followed superpowers:test-driven-development (red→green, fail-first observed) for every code step.
- [ ] superpowers:verification-before-completion satisfied: REAL `bun test` output (file + pass counts) shown, plus `bun run lint` and `bun run typecheck` green, BEFORE any "done" claim.

**Reviewer-gate:** The orchestrator's engine-reviewer enforces that the chunk is NOT done until `bun test` is green AND `bun run lint` + `bun run typecheck` are green, with the real output present in the worker's report.

**Forward-note — downstream testing policy (explicitly OUT of chunk-01 scope; recorded here so it isn't lost):**
- Chunk 02b-ii renderer logic (pick → `tool_result`, close → `tool_cancel`, unknown-tool → fallback) is tested componentwise against a MOCK WebSocket — not part of chunk 01.
- Chunks 02b / 03 frontend + e2e use a MANUAL checklist on real macOS — not automated here.

---

## ADR worthy: yes

Routing instructions for `adr-curator` (the orchestrator spawns it during Phase 1; doc edits are NOT the worker's job). Transcribe these edits exactly.

**1. Amend ADR-0003 (`orchestration/docs/adr/0003-local-daemon-ws-architecture.md`) — ADDED dated section, NOT a supersede, NOT an overwrite of Decision p.5.**
- Append a NEW section titled `## Amendment 2026-05-30` AFTER the existing content. Do NOT modify or delete the original Decision point 5 ("Frontends authenticate via a per-install secret token...") — preserve decision history.
- Rationale to record in the amendment: this is NOT a supersede. The decision "auth is needed" is unchanged; only the **timing + interim mechanism** change, which aligns with this ADR's own Status note: "`accepted` (with planned evolution...)".
- Content of the amendment:
  - The per-install secret token (Decision p.5) is **DEFERRED**.
  - The **v0 interim CSWSH mitigation** is an **Origin-allowlist** on the WS upgrade (`tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`), implemented in `packages/daemon/src/origin.ts`.
  - The full per-install token gate is **release-driven** — required before any **non-dev / public release** — NOT feature-driven. Specifically it is **NOT** gated on shipping the web admin tab: the threat is *any* browser tab plus an always-on localhost daemon, which exists regardless of whether we ship our own web frontend.
  - The token, when added, is **connection-level** (query-param/header at handshake), **outside the message envelope**, so it is additive and does NOT touch the frozen 6-variant contract.

**2. Add known-gotcha #31 (`orchestration/docs/known-gotchas.md`, Security bucket).**
- New row in the `## Bucket: Security` table:
  - `# = 31`
  - Gotcha = **CSWSH exposure window** — the Origin header is spoofable by non-browser clients, so the v0 Origin-allowlist only stops casual cross-site *browser* tabs; an always-on localhost daemon remains reachable by a crafted non-browser client.
  - Severity = `blocking-MVP` (must close before non-dev/public release).
  - Note = Close before any non-dev/public release via the connection-level **per-install token** (ADR-0003 Amendment 2026-05-30). The token is additive and does NOT touch the frozen message envelope. Ties to ADR-0003 Decision p.5.

**3. Zod runtime dependency — NO new ADR (one-line confirmation only).**
- `zod` as a runtime dependency is already covered by ADR-0005 ("UI tools declare their widget as a composition of primitives via a typed schema (Zod, JSON Schema)") and reinforced by known-gotcha #9 ("Zod validation rejects, send error back to LLM"). No new ADR is needed; adr-curator should simply confirm this in passing and not open one.

---

## ADR

Curated by adr-curator (2026-05-30):
- **ADR-0003 amendment** — `orchestration/docs/adr/0003-local-daemon-ws-architecture.md` → `## Amendment 2026-05-30` (added dated section; original Decision p.5 preserved verbatim, NOT superseded; token deferred, Origin-allowlist interim, release-driven gate).
- **Known-gotcha #31** — `orchestration/docs/known-gotchas.md` → `## Bucket: Security`, row `#31` (CSWSH exposure window, `blocking-MVP`).
- **Zod** — no new ADR; covered by ADR-0005 + known-gotcha #9 (confirmation only).

> Curator follow-ups (for Lior, not blocking): (a) `architecture.md` daemon/security section was deliberately untouched — link the amendment there if desired; (b) ADR-0003 Decision p.5 still reads present-tense "Frontends authenticate via…" — add a one-line pointer to the amendment if you want readers redirected; (c) the plan↔ADR wikilink is a new convention (ADRs previously only linked siblings/`../` docs) — flag if a different link form is preferred.

---

## Status: Done (planning) — ADR pass complete; **pending Lior approval before Phase 2**
