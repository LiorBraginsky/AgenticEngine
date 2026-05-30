# Walking Skeleton v0 — Chunk 02a: Mock Agent Loop (CLI-verified, NO UI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Every code step also requires superpowers:test-driven-development (red→green: write the failing test, run it, *see it fail*, implement, *see it pass*) and superpowers:verification-before-completion (real `bun test` + `bun run typecheck` + `bun run lint:strict` output shown BEFORE any "done" claim).
>
> **Git note (carried from chunk-01):** `git commit` is Lior's to make manually (declined by the permission layer). Workers write + test + verify; they do NOT commit/push/amend/force/--no-verify. Commit messages are provided for Lior's convenience only.

**Goal:** Add a hard-coded mock reasoning loop to the daemon — a pure reducer `advanceMockAgent(state, inbound) => { nextState, outbound }` — that drives the "find a color" path (`session_start` → `show_color_picker` tool_call → on `tool_result` final text + `session_end`; on `tool_cancel` graceful `session_end`; on malformed `tool_result` a typed error, never a crash), verified end-to-end by a CLI harness over the real WS protocol with NO UI.

**Architecture:** The reducer is a **pure function** with NO knowledge of WebSockets, timers, promises, or event emitters — a direct additive evolution of the existing pure `handleSessionStart(msg) => Envelope[]`. It lives in a new `packages/daemon/src/mock-agent.ts`. The daemon's `websocket.message` handler (in `index.ts`) owns ALL I/O: it holds a `Map<session_id, MockSessionState>`, calls the reducer, and performs every `ws.send`. **Loop = decision; daemon = I/O.** The contract is FROZEN — the loop codes ONLY against `@agentic/protocol` exports.

**Tech Stack:** Bun (runtime + `bun test`, NO Jest/Vitest), TypeScript (ESM-only, runtime-agnostic per ADR-0004), Zod via the frozen `@agentic/protocol` (no new runtime deps), `crypto.randomUUID()` for the `call_id` (web-standard per ADR-0004). Bun `ServerWebSocket` `ws.data` for per-connection session tracking; `close(ws)` lifecycle hook for leak-free cleanup.

---

## Implementation status — 2026-05-30

**Phase 2 implementation: COMPLETE (pending reviewer-gate).** All 3 Tasks executed via TDD by engine-worker; independently re-verified by the orchestrator.

- Task 1 (pure reducer + unit tests): done — 6 unit tests green.
- Task 2 (resolve/cancel/typed-malformed branches): done.
- Task 3 (daemon wiring + CLI integration harness + chunk-01 test reconcile + test-client driver): done — 3 integration tests green.
- **Verification gate (orchestrator-reproduced):** `bun test` → **39 pass / 0 fail** across 8 files; `bun run typecheck` → exit 0; `bun run lint:strict` → exit 0.
- **Live behaviour confirmed in test output:** daemon LOGS the computed final text (`[daemon] agent final text: you picked Crimson…`) — Option A — and DROPS a malformed inbound gracefully (`[daemon] inbound not in frozen contract: invalid`) — gotcha #9, no crash.
- Constraints held: `mock-agent.ts` imports only `@agentic/protocol` + `crypto` (pure reducer); `packages/protocol/**` untouched (no contract edit, no STOP-THE-LINE); no git commit (left for Lior); `session.ts` left green.
- Files: created `mock-agent.ts`, `mock-agent.test.ts`, `mock-agent.daemon.test.ts`; modified `index.ts`, `daemon.test.ts`, `scripts/test-client.ts`.

**Reviewer-gate (engine-reviewer vs baseline `main`, uncommitted working tree): `REVIEW: CLEAN`** — zero critical, zero major. Gate reproduced by reviewer (39 pass / typecheck 0 / lint:strict 0; integration re-run 5× stable). Confirmed: frozen contract untouched, pure-reducer held, Option A honoured (no 7th envelope variant), Map/`close(ws)` lifecycle leak-free, chunk-01 supersede correct, no frontend coupling.

Three NON-BLOCKING items (optional):
- [Minor] `mock-agent.daemon.test.ts` `nextN` helper leaves stale `message` listeners + uncleared `setTimeout` reject timers (benign today; remove listener + `clearTimeout` on settle to harden against future flake).
- [Minor] the over-the-wire malformed test proves the *daemon-level* graceful drop (envelope-layer reject); the reducer's `malformed_tool_result` typed-error branch is covered at the *unit* level (`mock-agent.test.ts`). Both layers covered — intentional, per Reality-check #3.
- [Nit] commit hygiene: working tree also holds unrelated **02b-i** changes (`adr/0006-*` modified, `plans/walking-skeleton-v0-02b-i-tauri-shell/` untracked). The 02a commit must stage ONLY the six 02a files and not sweep in 02b-i's work.

**Chunk 02a: DONE — green + review-clean.** Remaining (Jimmy/manual): commit the six 02a files; archive the chunk-todo per the chunk-01 precedent.

---

## Reality check

Every hypothesis in the brief, confirmed or corrected against actual code (file + line). No code exists for 02a yet — confirmed `Glob packages/daemon/src/*.ts` lists only `origin.ts`, `session.ts`, `index.ts` (+ tests). Chunk 01 is merged and review-CLEAN.

| Hypothesis | Evidence | Verdict |
|---|---|---|
| **(a) Current session round-trip & the exact seam to extend** | `packages/daemon/src/index.ts:44-47` — the `websocket.message` handler, on `parsed.message.type === "session_start"`, calls `handleSessionStart(parsed.message)` (in `session.ts:11-17`) and sends each reply. `handleSessionStart` returns `[session_ack, session_end{reason:"completed"}]` **immediately** — a stateless one-shot. Other known types (`tool_result`, `tool_cancel`) are **no-ops** (`index.ts:47` comment "Other known types are no-ops"). | **Confirmed + key correction.** The seam is `index.ts` `websocket.message` (lines 31-48). 02a must (1) stop ending the session on `session_start` — instead emit `session_ack` + a `tool_call`, and **keep the session open**; (2) add handling for `tool_result` / `tool_cancel` (today no-ops); (3) introduce a per-session state `Map` that does not exist today. `handleSessionStart` is **superseded** by the reducer for the session-start step (the reducer emits ack + tool_call, NOT ack + end). Keep `session.ts` for the minted-id helper or fold it in (see File structure). |
| **(b) Does `@agentic/protocol` export enough to build & validate every 02a message?** | See per-message table below. | **Confirmed — sufficient. No gaps.** |
| → `session_ack` (daemon→fe) | `envelope.ts:36-40` `SessionAck = { type, session_id, client_session_id? }`. Constructed as a plain object literal; validated on the way out by `index.ts`'s `send()` → `parseEnvelope` (defence in depth). | Build via object literal; `parseEnvelope` validates. |
| → `tool_call` `show_color_picker` | `envelope.ts:42-47` `ToolCall = { type, session_id, call_id, payload }`; `tools.ts:26-29` `ToolCallPayload` discriminated on `tool:"show_color_picker"` with `args: ShowColorPickerArgs`; `tools.ts:8-11` `ShowColorPickerArgs = { picker: ColorPickerPrimitive }`; `primitives.ts:27-31` `ColorPickerPrimitive = { primitive:"color-picker", question, palette: ColorSwatch[].min(1) }`; `primitives.ts:12-15` `ColorSwatch = { label, hex:/^#[0-9a-fA-F]{6}$/ }`. | Build the args object literal; the reducer **self-validates** it with `ShowColorPickerArgs.safeParse(...)` before emitting (proves the hard-coded palette is contract-valid); `send()` re-validates. `call_id` via `crypto.randomUUID()`. |
| → parse inbound `tool_result {picked}` | `tools.ts:31-34` `ToolResultPayload` discriminated on `tool`; `tools.ts:17-20` `ShowColorPickerResult = { picked: ColorSwatch }`. Inbound envelope first passes `parseEnvelope` in `index.ts:39`. | The reducer receives an already-`parseEnvelope`'d `Envelope` (narrowed via `Extract<Envelope,{type:"tool_result"}>`). For the **typed-error / malformed** branch it additionally calls `ShowColorPickerResult.safeParse(...)` to surface a typed error (gotcha #9). |
| → `tool_cancel` | `envelope.ts:57-61` `ToolCancel = { type, session_id, call_id }`. The SINGLE cancel representation (D4) — no `\|cancel` return variant. | Narrow via `Extract<Envelope,{type:"tool_cancel"}>`; reducer emits `session_end{reason:"cancelled"}`. |
| → `session_end` | `envelope.ts:63-67` `SessionEnd = { type, session_id, reason: SessionEndReason }`; `reason` is OPEN/degradable enum-or-string (`envelope.ts:18-21`); `"completed"`, `"cancelled"` are in the known enum. | Build via object literal. |
| → narrowing helper / classifier | `parseEnvelope` (`envelope.ts:95`, non-throwing) for inbound; `classifyTool` (`tools.ts:44`, non-throwing) exported but **not needed by 02a** — there is exactly one known tool and the daemon mints the `tool_call` itself, so the inbound `tool_result`/`tool_cancel` tool name is already discriminated by Zod. Worker should NOT add speculative `classifyTool` usage. | Confirmed; `classifyTool` is for unknown-tool inbound (an LLM-hallucination case that does not arise in the hard-coded mock). |
| **(c) Is `test-client.ts` a usable harness base?** | `packages/daemon/scripts/test-client.ts:1-16` — a throwaway manual client: opens a `WebSocket` with `Origin: tauri://localhost`, sends one `session_start`, logs each `parseEnvelope`'d reply. Comment line 1 explicitly: "foundation for 02a's CLI harness." | **Confirmed — grow from it.** It only does the start→ack→end happy path and never asserts. 02a's harness must (1) become an **assertion**-driven `bun test` integration test (mirroring `daemon.test.ts`'s ephemeral-port pattern, `index.ts:4` `startDaemon(0)`), AND (2) keep a runnable manual `scripts/` variant. Decision in File structure: the assertions live in a `bun test` file (`mock-agent.daemon.test.ts`); `test-client.ts` is upgraded to also drive the resolve path for manual inspection. |
| **(d) Do `lint:strict` + `typecheck` scripts exist; exact commands?** | Root `package.json:6-11` — `"test": "bun test"`, `"lint": "eslint ."`, `"lint:strict": "eslint . --max-warnings=0"`, `"typecheck": "tsc --noEmit -p tsconfig.json"`. Daemon `package.json:6-9` has only `dev` + `test-client` (NO test/lint/typecheck — those run from root, as chunk-01 did). Root `tsconfig.json:3` already includes `packages/*/src/**/*.ts` + `packages/*/scripts/**/*.ts`, so new daemon `src/` and `scripts/` files are in the tsc program automatically. | **Confirmed.** Verification gate commands (run from repo root): `bun test` · `bun run typecheck` · `bun run lint:strict`. All three must exit 0. No package.json edits needed. |

**Net corrections vs. the brief's framing:**
1. The seam change is **behavioural**, not purely additive: on `session_start` the daemon today *ends* the session; 02a must keep it open and emit a `tool_call` instead. `handleSessionStart`'s current ack+end pair is superseded for the start step.
2. A **per-session state `Map`** is genuinely new — chunk 01 was stateless.
3. The malformed-`tool_result` path has a subtlety: `parseEnvelope` in `index.ts:39` already rejects a *structurally* malformed envelope (returns `invalid`, dropped at line 41) before the reducer runs. So the reducer's typed-error branch is reachable only for payloads that pass envelope parse but are still semantically wrong **or** when the reducer is unit-tested directly. The plan exercises BOTH layers (daemon-drop AND reducer typed-error) so the gotcha-#9 guarantee is proven at the unit boundary where it lives. See Task 2 Step "malformed".

---

## STOP-THE-LINE: none

`@agentic/protocol` exports every schema/type/helper 02a needs to build and validate all five message kinds (`session_ack`, `tool_call`/`show_color_picker`, `tool_result` parse, `tool_cancel`, `session_end`). No constructor, validator, or type is missing or contradictory. The contract is used exactly as frozen; nothing here requires touching `packages/protocol`.

> **Orchestrator/Jimmy note (resolved interpretation, NOT a contract gap):** the frozen 6-variant envelope has no free-text / assistant-message variant, so the brief's "emit final text 'you picked X, fun fact: …'" cannot be a standalone WIRE message in v0. Resolution = **Option A** (see "Design resolution" below): the final text is **computed + asserted (unit) and logged**, while the wire message remains `session_end{reason:"completed"}`. The visible string is rendered once a frontend (02b) / demo (03) exists. This honours the frozen contract (a `text` primitive is Phase-2-deferred) and required NO contract change. Option B (add a text envelope variant) was rejected precisely because it WOULD be a STOP-THE-LINE.

### Jimmy's ruling at the Phase-1 gate (2026-05-30) — BINDING

Surfaced to Jimmy as a brief-vs-reality contradiction before Phase 2. Ruling: **Option A, with an explicit DoD revision (not a silent one).** Rationale recorded verbatim-in-spirit:

1. **Contract NOT touched.** `show_color_picker` already proves the fundamental `tool_call → render → tool_result` mechanism. Agent text is a **Phase-2 increment** (a second primitive + multi-tool-call), not skeleton foundation. A mocked agent's hard-coded fun-fact validates nothing real; genuine text is Phase 3.
2. **02a loop:** `session_start → tool_call(show_color_picker)`; on `tool_result{picked}` → compute the final text, **assert it in the unit test + log it**, → `session_end{completed}`. **No text is sent over the wire.**
3. **EXPLICIT DoD revision (critical — else the hole resurfaces at chunk 03):** the visible v0-skeleton result = **the color-picker widget confirming the selection** (the frontend already holds the `picked` label from the user's own click). The fun-fact text is **NOT part of the v0 wire-DoD.** → tracked follow-up (see "## Tracked follow-ups"): reformulate chunk-03 DoD + roadmap (~line 56 "you picked X, fun fact: …" and ~line 60 "the widget shows the result") to drop the fun-fact from the v0 criterion — **done DURING chunk 03**, decision RECORDED NOW.
4. **Forward architectural correction (for the record):** if/when agent text is added (Phase 2), it is a **`show_text` TOOL** — additive on the *tool* axis, which the registry is designed for — rendered as a text primitive. It is **NOT** a new envelope variant; a new envelope variant would violate **ADR-0002 ("UI = tool calls")**. This keeps the envelope at 6 variants permanently.
5. **Chunk-01 test supersede confirmed** as intended (not a regression): `session_start ⇒ ack + tool_call` replaces the chunk-01 placeholder `ack + session_end`. Task 3 Step 5 updates it.

---

## Decision notes (carry into implementation)

- **D-02a-1 — Reducer is pure (LOCKED, do not re-litigate).** `advanceMockAgent(state, inbound) => { nextState, outbound: Envelope[] }`. No WS, no async, no timers, no emitters, no lifecycle objects. Mirrors `handleSessionStart`'s proven pure-function pattern, tested synchronously.
- **D-02a-2 — Daemon owns I/O + state.** `Map<session_id, MockSessionState>` lives in `index.ts` (module-scope, per running daemon). The `message` handler: parse → look up/create state → call reducer → store `nextState` → `send` each `outbound` → on terminal state (a `session_end` was emitted) delete the Map entry. Per-connection `ws.data.sessionIds: Set<string>` tracks ownership so the `close(ws)` hook deletes orphaned sessions (leak-free, addresses ADR-0001 "leaked sessions on frontend disconnect").
- **D-02a-3 — Mock ignores typed text BY DESIGN.** `session_start.text` is read by NOTHING in the reducer — always the hard-coded "find a color" path. Documented in `mock-agent.ts` header comment and asserted by a test (`text:"buy me a sandwich"` still yields the color picker). Real input-driven reasoning is Phase 3 (roadmap).
- **D-02a-4 — Cancel reason.** `tool_cancel` → `session_end{reason:"cancelled"}` (a known value in the `SessionEndReason` enum, `envelope.ts:18`). Graceful: no throw, Map entry removed.
- **D-02a-5 — Hard-coded palette.** A fixed 3-swatch palette (red/green/blue) with valid 6-digit hex + labels, validated by `ShowColorPickerArgs.safeParse` inside the reducer before emit. The final text references the picked swatch's `label` (per `primitives.ts:3-7` rationale — structured data, no NL parsing).
- **D-02a-6 — Typed error, no crash (gotcha #9).** The reducer returns a typed discriminated result for a semantically-malformed `tool_result` (e.g. wrong `tool`, or a `picked` that fails `ShowColorPickerResult`). It NEVER throws. The daemon drops/logs it and the session stays alive. Use a typed error shape, not an exception.

---

## File structure

Repo-relative paths. ESM-only, web-standard APIs only (ADR-0004). No new runtime dependency.

**Create:**
- `packages/daemon/src/mock-agent.ts` — **the pure reducer.** Exports `MockSessionState` (the state type), `MockAgentInput` (narrowed inbound = `session_start | tool_result | tool_cancel` Envelope variants), `MockAgentResult` (`{ nextState; outbound: Envelope[]; finalText? }`), the typed-error helper, `MOCK_PALETTE` (the hard-coded palette const), and `advanceMockAgent(state, inbound): MockAgentResult`. NO imports beyond `@agentic/protocol` + `crypto` (web-standard). Header comment documents D-02a-1/3/5/6 + Option-A note.
- `packages/daemon/src/mock-agent.test.ts` — **pure unit tests** for the reducer (synchronous, no WS): start→tool_call, result→final-text+end, cancel→end, malformed-result→typed error (no throw), text-ignored.
- `packages/daemon/src/mock-agent.daemon.test.ts` — **CLI/integration harness** as a `bun test` file. Real `startDaemon(0)` on ephemeral port (mirrors `daemon.test.ts`), real `WebSocket` client with `Origin: tauri://localhost`. Asserts BOTH the resolve path AND the cancel path AND the malformed-`tool_result` graceful path, all over the wire with NO UI.

**Modify:**
- `packages/daemon/src/index.ts` — rewire `websocket.message` to drive the reducer + the `Map`; add `ws.data` typing + `close(ws)` cleanup. The `session_start` branch no longer calls `handleSessionStart`'s end-pair.
- `packages/daemon/scripts/test-client.ts` — grow it to drive the full resolve path (send `session_start`, on the inbound `tool_call` reply with a `tool_result` picking swatch 0, log the final text + `session_end`). Manual inspection aid; the *assertions* live in the test file.

**Removed/superseded:**
- `packages/daemon/src/session.ts` `handleSessionStart` — its ack+end behaviour is superseded by the reducer's start step. **Decision (safer for a parallel-chunk world):** leave `session.ts`/`session.test.ts` in place (still green) but stop calling `handleSessionStart` from `index.ts`. Delete only if the reviewer prefers — flagged in Task 3.

**Untouched (frozen / out of scope):** all of `packages/protocol/**`, `packages/daemon/src/origin.ts`.

> **⚠️ Cross-test conflict the worker MUST handle (Task 3):** `packages/daemon/src/daemon.test.ts` ("ALLOWED origin: full session round-trip (start → ack → end)") asserts that `session_start` yields `session_ack` then `session_end{completed}` as messages[0]/[1]. After 02a's seam change, `session_start` yields `session_ack` then a **`tool_call`** (not `session_end`). This chunk-01 test WILL go red. It must be **updated** to reflect the new behaviour (start → ack → tool_call), since the old one-shot behaviour was explicitly a chunk-01 placeholder ("Real reasoning-loop logic arrives in chunk 02a", `session.ts:7`). This is an intended supersede, not a regression. Task 3 covers it.

---

## Exact types & reducer shape (transcribe into `mock-agent.ts`)

```ts
import {
  type Envelope,
  ShowColorPickerArgs,
  ShowColorPickerResult,
  type ColorSwatch,
} from "@agentic/protocol";

/**
 * MOCK reasoning loop — Walking Skeleton v0 (NO real LLM, NO UI).
 *
 * PURE REDUCER (locked decision): advanceMockAgent(state, inbound) =>
 *   { nextState, outbound }. Knows NOTHING about WebSockets/async/timers.
 *   The daemon (index.ts) owns the Map<session_id,state> and all ws.send.
 *
 * BY DESIGN the mock IGNORES session_start.text — it always takes the
 * hard-coded "find a color" path. Real input-driven reasoning is Phase 3.
 *
 * The "final text" (you picked X, fun fact: …) is COMPUTED and asserted in
 * v0 but only *rendered* once a frontend (02b) exists; there is intentionally
 * NO text wire-message in the frozen v0 contract (a text primitive is Phase 2).
 *
 * Malformed tool_result ⇒ a TYPED error (gotcha #9), NEVER a throw.
 */

export const MOCK_PALETTE: ColorSwatch[] = [
  { label: "Crimson", hex: "#DC143C" },
  { label: "Forest",  hex: "#228B22" },
  { label: "Azure",   hex: "#1E90FF" },
];

const MOCK_QUESTION = "Which color do you want?";

// The reducer only ever consumes these three inbound variants.
export type MockAgentInput =
  | Extract<Envelope, { type: "session_start" }>
  | Extract<Envelope, { type: "tool_result" }>
  | Extract<Envelope, { type: "tool_cancel" }>;

// Minimal per-session memory: enough to correlate the tool_call we issued.
export type MockSessionState =
  | { phase: "awaiting_pick"; session_id: string; call_id: string }
  | { phase: "done"; session_id: string };

export type MockAgentError =
  | { kind: "malformed_tool_result"; detail: string }
  | { kind: "unexpected_message"; detail: string };

export type MockAgentResult =
  | { ok: true; nextState: MockSessionState; outbound: Envelope[]; finalText?: string }
  | { ok: false; error: MockAgentError; nextState: MockSessionState; outbound: Envelope[] };
```

`advanceMockAgent(state: MockSessionState | undefined, inbound: MockAgentInput): MockAgentResult` — branch table:

- **`session_start`** (state is `undefined` — first message): mint `session_id = crypto.randomUUID()` and `call_id = crypto.randomUUID()`; build `args = { picker: { primitive:"color-picker", question: MOCK_QUESTION, palette: MOCK_PALETTE } }`; assert `ShowColorPickerArgs.safeParse(args).success` (it must — proves the hard-coded palette is contract-valid); emit `[ session_ack{session_id, client_session_id}, tool_call{session_id, call_id, payload:{tool:"show_color_picker", args}} ]`; `nextState = { phase:"awaiting_pick", session_id, call_id }`.
- **`tool_result`** while `phase:"awaiting_pick"`: `ShowColorPickerResult.safeParse(inbound.payload.result)` (defensive — gotcha #9). On failure → `{ ok:false, error:{kind:"malformed_tool_result", ...}, nextState: state, outbound: [] }` (session stays open; NO throw). On success → `finalText = "you picked <label>, fun fact: ..."`, emit `[ session_end{session_id, reason:"completed"} ]`, `nextState:{phase:"done", session_id}`.
- **`tool_cancel`** while `phase:"awaiting_pick"`: emit `[ session_end{session_id, reason:"cancelled"} ]`; `nextState:{phase:"done"}`. Graceful.
- **any inbound while `phase:"done"`, or out-of-phase / missing state:** `{ ok:false, error:{kind:"unexpected_message"}, nextState: state ?? {phase:"done",session_id:""}, outbound: [] }` — no throw.

### Design resolution — where does the "final text" live? (must read before coding)

The frozen 6-variant envelope (`envelope.ts:70-77`) has **no free-text / assistant-message variant** — only `session_start, session_ack, tool_call, tool_result, tool_cancel, session_end`. The brief's "emit final text 'you picked X, fun fact: …'" therefore cannot be a standalone wire message in v0 without changing the contract (which would be STOP-THE-LINE).

- **Option A (CHOSEN — no contract change):** the final text is an **observable artifact of the reducer** (`MockAgentResult.finalText`), asserted in the unit test and logged by the daemon, while the WIRE message is simply `session_end{reason:"completed"}`. The visible "you picked X" string lands on the actual widget in chunk 02b / the demo in chunk 03 — 02a is CLI-verified with NO UI, so proving the string is *computed correctly* (unit) + the session closes cleanly (integration) fully satisfies the done-criteria. **Pros:** zero contract change; honours "NO UI"; the string is still asserted. **Cons:** the string isn't a wire message in v0 (acceptable — no text primitive until Phase 2, no client to render it until 02b).
- **Option B (REJECTED):** add a `text`/`assistant_message` envelope variant. Rejected: that is a change to the FROZEN contract = STOP-THE-LINE, and a `text` primitive is explicitly deferred to Phase 2. Do NOT do this.

> Worker: implement Option A.

---

## Tasks

### Task 1: The pure reducer (`mock-agent.ts`) — TDD

**Files:** Create `packages/daemon/src/mock-agent.ts`; Test `packages/daemon/src/mock-agent.test.ts`

- [ ] **Step 1: Write the failing reducer test — happy "start" branch**

`packages/daemon/src/mock-agent.test.ts`:
```ts
import { test, expect } from "bun:test";
import { advanceMockAgent, MOCK_PALETTE } from "./mock-agent.js";
import { ShowColorPickerArgs } from "@agentic/protocol";

test("session_start ⇒ session_ack + valid show_color_picker tool_call; session stays open", () => {
  const r = advanceMockAgent(undefined, {
    type: "session_start",
    trigger: "user",
    text: "this text is ignored by design",
    client_session_id: "c-1",
  });
  expect(r.ok).toBe(true);
  expect(r.outbound).toHaveLength(2);

  const ack = r.outbound[0]!;
  expect(ack.type).toBe("session_ack");
  if (ack.type === "session_ack") expect(ack.client_session_id).toBe("c-1");

  const call = r.outbound[1]!;
  expect(call.type).toBe("tool_call");
  if (call.type === "tool_call") {
    expect(call.payload.tool).toBe("show_color_picker");
    expect(ShowColorPickerArgs.safeParse(call.payload.args).success).toBe(true);
    expect(call.payload.args.picker.palette).toEqual(MOCK_PALETTE);
  }
  expect(r.nextState.phase).toBe("awaiting_pick");
});
```

- [ ] **Step 2: Run it, see it fail** — `bun test packages/daemon/src/mock-agent.test.ts` → FAIL (cannot resolve `./mock-agent.js`).

- [ ] **Step 3: Implement `mock-agent.ts` (start branch + types)** per the "Exact types & reducer shape" section. Implement the `session_start` branch fully; stub the other branches to an `unexpected_message` typed result for now (later steps fill them). Header comment documents D-02a-1/3/5/6 + Option-A note.

- [ ] **Step 4: Run it, see it pass** — `bun test packages/daemon/src/mock-agent.test.ts` → PASS (1 test).

- [ ] **Step 5: Add the "text-ignored-by-design" test**

```ts
test("mock ignores typed text — same color path regardless of input", () => {
  const a = advanceMockAgent(undefined, { type: "session_start", trigger: "user", text: "buy me a sandwich" });
  const b = advanceMockAgent(undefined, { type: "session_start", trigger: "user", text: "pick a color" });
  const callA = a.outbound[1]!; const callB = b.outbound[1]!;
  if (callA.type === "tool_call" && callB.type === "tool_call") {
    expect(callA.payload.args.picker.palette).toEqual(callB.payload.args.picker.palette);
    expect(callA.payload.args.picker.question).toBe(callB.payload.args.picker.question);
  }
});
```
Run → PASS (2 tests).

- [ ] **Step 6: Commit** (Lior; worker stages only)
```bash
git add packages/daemon/src/mock-agent.ts packages/daemon/src/mock-agent.test.ts
git commit -m "feat(daemon): mock-agent reducer — session_start emits show_color_picker tool_call"
```

---

### Task 2: Reducer resolve, cancel, and the typed-error path — TDD

**Files:** Modify `packages/daemon/src/mock-agent.ts`; extend `packages/daemon/src/mock-agent.test.ts`

- [ ] **Step 1: Write failing tests — resolve, cancel, malformed (typed error, no throw), out-of-phase**

```ts
import { type MockSessionState } from "./mock-agent.js"; // add to existing imports

const awaiting: MockSessionState = { phase: "awaiting_pick", session_id: "s-1", call_id: "k-1" };

test("tool_result {picked} ⇒ finalText with the label + session_end{completed}", () => {
  const r = advanceMockAgent(awaiting, {
    type: "tool_result", session_id: "s-1", call_id: "k-1",
    payload: { tool: "show_color_picker", result: { picked: { label: "Azure", hex: "#1E90FF" } } },
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.finalText).toContain("Azure");
  expect(r.outbound).toHaveLength(1);
  const end = r.outbound[0]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") { expect(end.reason).toBe("completed"); expect(end.session_id).toBe("s-1"); }
  expect(r.nextState.phase).toBe("done");
});

test("tool_cancel ⇒ session_end{cancelled}, no throw", () => {
  const r = advanceMockAgent(awaiting, { type: "tool_cancel", session_id: "s-1", call_id: "k-1" });
  expect(r.ok).toBe(true);
  const end = r.outbound[0]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") expect(end.reason).toBe("cancelled");
  expect(r.nextState.phase).toBe("done");
});

test("malformed tool_result ⇒ TYPED error (gotcha #9), NEVER a throw, session stays open", () => {
  const bad = {
    type: "tool_result" as const, session_id: "s-1", call_id: "k-1",
    payload: { tool: "show_color_picker", result: { picked: { label: "X", hex: "NOTHEX" } } },
  } as unknown as Extract<import("@agentic/protocol").Envelope, { type: "tool_result" }>;
  let threw = false; let r;
  try { r = advanceMockAgent(awaiting, bad); } catch { threw = true; }
  expect(threw).toBe(false);
  expect(r!.ok).toBe(false);
  if (!r!.ok) expect(r!.error.kind).toBe("malformed_tool_result");
  expect(r!.outbound).toHaveLength(0);
  expect(r!.nextState.phase).toBe("awaiting_pick");
});

test("inbound after done ⇒ typed unexpected_message, no throw", () => {
  const done: MockSessionState = { phase: "done", session_id: "s-1" };
  const r = advanceMockAgent(done, { type: "tool_cancel", session_id: "s-1", call_id: "k-1" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe("unexpected_message");
});
```

- [ ] **Step 2: Run, see the new tests fail.**

- [ ] **Step 3: Implement the resolve, cancel, malformed, and out-of-phase branches** in `mock-agent.ts`, replacing the stubs. Use `ShowColorPickerResult.safeParse` (never `.parse`); the reducer NEVER throws — all branches return.

- [ ] **Step 4: Run, see all reducer tests pass** (6 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/daemon/src/mock-agent.ts packages/daemon/src/mock-agent.test.ts
git commit -m "feat(daemon): mock-agent resolve/cancel branches + typed malformed-result error (no throw)"
```

---

### Task 3: Wire the reducer into the daemon + CLI harness + reconcile chunk-01 test — TDD

**Files:** Modify `packages/daemon/src/index.ts`, `packages/daemon/src/daemon.test.ts`, `packages/daemon/scripts/test-client.ts`; Create `packages/daemon/src/mock-agent.daemon.test.ts`

- [ ] **Step 1: Write the failing CLI harness (integration, over the wire, NO UI)**

`packages/daemon/src/mock-agent.daemon.test.ts`:
```ts
import { test, expect, afterAll } from "bun:test";
import { startDaemon } from "./index.js";

const server = startDaemon(0); // ephemeral port
const PORT = server.port;
afterAll(() => server.stop(true));
const ORIGIN = "tauri://localhost";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = any;

function open(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
  return new Promise((res, rej) => {
    ws.addEventListener("open", () => res(ws));
    ws.addEventListener("error", () => rej(new Error("ws error")));
    setTimeout(() => rej(new Error("open timeout")), 2000);
  });
}

function nextN(ws: WebSocket, n: number, send?: () => void): Promise<Msg[]> {
  const msgs: Msg[] = [];
  return new Promise((res, rej) => {
    ws.addEventListener("message", (e) => {
      msgs.push(JSON.parse(e.data as string));
      if (msgs.length >= n) res(msgs);
    });
    setTimeout(() => rej(new Error(`expected ${n} msgs, got ${msgs.length}`)), 2000);
    send?.();
  });
}

test("RESOLVE path: start → ack + tool_call(show_color_picker); reply tool_result → session_end{completed}", async () => {
  const ws = await open();
  const first = await nextN(ws, 2, () =>
    ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "ignored", client_session_id: "c-1" })),
  );
  expect(first[0].type).toBe("session_ack");
  expect(first[0].client_session_id).toBe("c-1");
  expect(first[1].type).toBe("tool_call");
  expect(first[1].payload.tool).toBe("show_color_picker");
  const sessionId = first[0].session_id;
  const callId = first[1].call_id;
  const pick = first[1].payload.args.picker.palette[0];
  const end = await nextN(ws, 1, () =>
    ws.send(JSON.stringify({
      type: "tool_result", session_id: sessionId, call_id: callId,
      payload: { tool: "show_color_picker", result: { picked: pick } },
    })),
  );
  expect(end[0].type).toBe("session_end");
  expect(end[0].reason).toBe("completed");
  expect(end[0].session_id).toBe(sessionId);
  ws.close();
});

test("CANCEL path: start → tool_call; reply tool_cancel → session_end{cancelled}, no crash", async () => {
  const ws = await open();
  const first = await nextN(ws, 2, () => ws.send(JSON.stringify({ type: "session_start", trigger: "user" })));
  const sessionId = first[0].session_id;
  const callId = first[1].call_id;
  const end = await nextN(ws, 1, () =>
    ws.send(JSON.stringify({ type: "tool_cancel", session_id: sessionId, call_id: callId })),
  );
  expect(end[0].type).toBe("session_end");
  expect(end[0].reason).toBe("cancelled");
  ws.close();
});

test("MALFORMED tool_result: daemon does not crash, session not ended", async () => {
  const ws = await open();
  const first = await nextN(ws, 2, () => ws.send(JSON.stringify({ type: "session_start", trigger: "user" })));
  const sessionId = first[0].session_id;
  const callId = first[1].call_id;
  ws.send(JSON.stringify({
    type: "tool_result", session_id: sessionId, call_id: callId,
    payload: { tool: "show_color_picker", result: { picked: { label: "X", hex: "NOTHEX" } } },
  }));
  const valid = first[1].payload.args.picker.palette[0];
  const end = await nextN(ws, 1, () =>
    ws.send(JSON.stringify({
      type: "tool_result", session_id: sessionId, call_id: callId,
      payload: { tool: "show_color_picker", result: { picked: valid } },
    })),
  );
  expect(end[0].type).toBe("session_end");
  expect(end[0].reason).toBe("completed");
  ws.close();
});
```
> The malformed message is rejected at the envelope layer (`index.ts` `parseEnvelope` drops it) — this proves the **daemon-level** gotcha-#9 guarantee (no crash, session survives). The **reducer-level** typed error is proven in Task 2. Both layers covered.

- [ ] **Step 2: Run, see it fail** (current `index.ts` ends the session on `session_start`).

- [ ] **Step 3: Rewire `index.ts` — Map, reducer, ws.data, close cleanup.** Target shape:
```ts
import { parseEnvelope, type Envelope } from "@agentic/protocol";
import { isOriginAllowed } from "./origin.js";
import { advanceMockAgent, type MockSessionState, type MockAgentInput } from "./mock-agent.js";

export const DAEMON_HOST = "127.0.0.1"; // loopback only (ADR-0003 p.3)
export const DAEMON_PORT = 7777;

const sessions = new Map<string, MockSessionState>();
type SocketData = { sessionIds: Set<string> };

function send(ws: { send(data: string): number }, msg: Envelope): void {
  const check = parseEnvelope(msg);
  if (check.kind !== "ok") { console.error("[daemon] refusing to send invalid outbound message", check); return; }
  ws.send(JSON.stringify(msg));
}

const REDUCER_INPUT_TYPES = new Set(["session_start", "tool_result", "tool_cancel"]);

export function startDaemon(port: number = DAEMON_PORT) {
  return Bun.serve<SocketData, undefined>({
    hostname: DAEMON_HOST,
    port,
    fetch(req, server) {
      if (!isOriginAllowed(req.headers.get("origin"))) return new Response("Forbidden origin", { status: 403 });
      if (server.upgrade(req, { data: { sessionIds: new Set<string>() } })) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        let json: unknown;
        try { json = JSON.parse(typeof raw === "string" ? raw : raw.toString()); }
        catch { console.error("[daemon] non-JSON frame ignored"); return; }
        const parsed = parseEnvelope(json);
        if (parsed.kind !== "ok") { console.error("[daemon] inbound not in frozen contract:", parsed.kind); return; }
        const msg = parsed.message;
        if (!REDUCER_INPUT_TYPES.has(msg.type)) return; // session_ack/tool_call/session_end inbound = no-op
        const inbound = msg as MockAgentInput;
        const sessionId = inbound.type === "session_start" ? undefined : inbound.session_id;
        const prior = sessionId ? sessions.get(sessionId) : undefined;
        const result = advanceMockAgent(prior, inbound);
        if (!result.ok) console.error("[daemon] mock-agent typed error:", result.error); // no crash
        const sid = result.nextState.session_id;
        if (sid) {
          sessions.set(sid, result.nextState);
          ws.data.sessionIds.add(sid);
          if (result.nextState.phase === "done") sessions.delete(sid);
        }
        for (const out of result.outbound) send(ws, out);
      },
      close(ws) { for (const sid of ws.data.sessionIds) sessions.delete(sid); },
    },
  });
}

if (import.meta.main) {
  const server = startDaemon();
  console.log(`[daemon] listening on ws://${server.hostname}:${server.port}`);
}
```
> Worker notes: (1) `Bun.serve<SocketData, undefined>` + `ws.data` is the confirmed Bun API for per-connection state; if the generic form fights the installed Bun types, type `ws.data` via the handler `data` field per Bun docs — do NOT cast to `any`. (2) `handleSessionStart` from `session.ts` is no longer imported — leave `session.ts`/`session.test.ts` in place (still green) unless the reviewer asks to delete them; do NOT delete in this task. (3) keep the `send()` defence-in-depth validation.

- [ ] **Step 4: Run the harness green** — `bun test packages/daemon/src/mock-agent.daemon.test.ts` → PASS (3 tests).

- [ ] **Step 5: Reconcile the superseded chunk-01 round-trip test.** In `packages/daemon/src/daemon.test.ts`, update the round-trip test's `messages[1]` expectation from `session_end{completed}` to:
```ts
expect(messages[1].type).toBe("tool_call");
expect(messages[1].payload.tool).toBe("show_color_picker");
expect(messages[1].session_id).toBe(messages[0].session_id);
// chunk-02a supersede: session_start now opens a session (ack + tool_call), it no longer ends immediately
```
Leave the two origin-reject tests untouched.

- [ ] **Step 6: Run, see the reconciled chunk-01 test green** (3 tests).

- [ ] **Step 7: Grow `test-client.ts` into a manual full-resolve driver** (send `session_start`; on the inbound `tool_call` auto-pick `palette[0]` and reply `tool_result`; on `session_end` log the reason + close). Validate every inbound with `parseEnvelope`.

- [ ] **Step 8: Manual smoke (optional but recommended).** Terminal A: `cd packages/daemon && bun run dev`; Terminal B: `cd packages/daemon && bun run test-client`. Expected: `session_ack` → `tool_call show_color_picker; auto-picking "Crimson"` → `session_end reason=completed`. Record observed output in the report.

- [ ] **Step 9: Full verification gate (repo root)** — `bun test && bun run typecheck && bun run lint:strict`. ALL green. Paste the real `bun test` summary into the report. Do NOT claim done before this is shown.

- [ ] **Step 10: Commit**
```bash
git add packages/daemon/src/index.ts packages/daemon/src/mock-agent.daemon.test.ts packages/daemon/src/daemon.test.ts packages/daemon/scripts/test-client.ts
git commit -m "feat(daemon): wire mock-agent reducer into WS session loop + CLI harness (resolve/cancel/malformed)"
```

---

## Definition of Done

Maps the chunk's Done criteria (`02a-mock-agent-loop.md:26-30`) to tasks:

- [ ] On `session_start`, daemon emits a valid `tool_call` for `show_color_picker` (args validate against the contract). → Task 1 + Task 3 (over-the-wire).
- [ ] On `tool_result {picked}`, **computes** final text incorporating the pick (asserted via `finalText` in the unit test + logged by the daemon — Option A, **NO text wire-message in v0** per Jimmy's ruling), then emits `session_end{completed}`. The fun-fact text is **not** a v0 wire-DoD item — the visible v0 result is the picker widget confirming the selection (frontend-side, chunk 02b/03). → Task 2 + Task 3.
- [ ] On `tool_cancel`, the loop ends gracefully (`session_end{cancelled}`, no throw). → Task 2 + Task 3.
- [ ] All emitted/received messages validate against the frozen contract; a malformed `tool_result` is rejected with a **typed error** (gotcha #9), not a crash. → Task 2 (reducer typed error) + Task 3 (daemon-level graceful drop).
- [ ] CLI harness runs end-to-end with NO UI, asserting BOTH the resolve path AND the cancel path AND the malformed path. → Task 3.
- [ ] Mock ignores typed text (documented + asserted). → Task 1 Step 5.
- [ ] No coupling to the frontend / Tauri / chunk 02b; only `@agentic/protocol` imported by the reducer.
- [ ] Pure reducer shape preserved (no WS/async/timers in `mock-agent.ts`). → Task 1.
- [ ] **Verification gate:** `bun test` + `bun run typecheck` + `bun run lint:strict` all exit 0, real output shown. → Task 3 Step 9.
- [ ] No new runtime dependency added (only `@agentic/protocol` + web-standard `crypto`).

**Reviewer-gate:** engine-reviewer enforces the chunk is NOT done until the three commands are green with real output in the worker's report, and confirms the loop/daemon separation (reducer has zero WS/async surface).

---

## ADR worthy: no

02a introduces no new architectural decision. The reducer shape is an implementation detail (LOCKED decision, consistent with `handleSessionStart`'s existing pure-function pattern). The session-state `Map` + multi-step `tool_call → tool_result/tool_cancel → session_end` flow is the **direct realisation** of already-accepted ADR-0001 (streaming multi-step sessions) and ADR-0002 (UI as async tool calls with resolve/cancel). "Final text has no wire-message" honours the frozen-contract deferral of a `text` primitive to Phase 2 — no decision, just scope. No new runtime dependency. Nothing to route to `adr-curator`.

Non-ADR note: the chunk-01 `daemon.test.ts` round-trip assertion is **intentionally superseded** by Task 3 Step 5 (start now opens a session instead of ending it). Expected behaviour evolution, not a regression.

---

## Tracked follow-ups (decided now, executed later)

These are NOT part of chunk 02a's implementation. They are recorded here per Jimmy's Phase-1 ruling so the decision is not lost; the edits happen in the chunk where they belong.

- **FU-1 (do during chunk 03):** Revise the v0 Definition-of-done to drop the agent fun-fact text from the wire-DoD, since the frozen contract deliberately does not carry it.
  - `orchestration/docs/roadmap.md` ~line 56: `Mock agent loop: hard-coded "find a color" → show_color_picker → "you picked X, fun fact: …"` — reframe the `"you picked X, fun fact: …"` tail as a Phase-2 `show_text` increment, not a v0 wire output.
  - `orchestration/docs/roadmap.md` ~line 60 (Walking Skeleton DoD): `"…clicks a color, and the widget shows the result"` — keep (widget confirms selection); ensure it is NOT read as "overlay shows the fun-fact text".
  - `orchestration/chunks-todo/walking-skeleton-v0/03-end-to-end-wiring-and-demo.md`: align its DoD with the above (visible result = picker confirms the pick; no fun-fact overlay required in v0).
- **FU-2 (Phase-2 architecture, for the record):** agent text, when added, is a **`show_text` TOOL** (additive on the tool axis), NOT a new envelope variant — preserves ADR-0002. If Jimmy wants this captured formally, append a clarifying note to `orchestration/docs/adr/0002-ui-as-tool-calls.md` rather than minting a new ADR. (Orchestrator did not edit ADR-0002 during chunk 02a; awaiting Jimmy's go-ahead.)

---

## Status: Done
