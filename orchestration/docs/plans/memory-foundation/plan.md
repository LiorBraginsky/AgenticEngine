# MF-01 — Durable Store + Thread/Session Model + Within-Thread Multi-Turn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable persistence substrate (SQLite + per-thread JSONL files) and the daemon thread/session lifecycle that lets a turn's messages flush to a durable thread on end and rehydrate on the next `session_start{thread_id}`, with the WRITE-GATE, ARCHIVE-AS-TRUTH, MUTATION-AS-APPEND (tombstone + hard-scrub / correction), and the 5b consolidation-hook all established as clean pass-throughs — proven by real-I/O tests and a smoke-probe, with the wire frozen to exactly one additive `thread_id` field on `session_start`.

**Architecture:** The daemon is the sole owner of thread↔session correlation; the `AgentProvider` port stays thread-agnostic (it consumes a hydrated `messages[]` exactly as it does today). All memory writes flow through a single `WriteGate.appendTurn / forget / edit` function (no policy in MF-01 — pass-through). SQLite holds the canonical structured bytes; per-thread JSONL files are an append-only human-readable mirror. The behavioral change (flush-to-thread replacing silent `sessions.delete`) is localized to the one site in `index.ts` that terminates a session.

**Tech Stack:** TypeScript on Bun; `bun:sqlite` (Bun built-in — no new dependency); Zod (existing); `bun test`; existing `eslint` strict + `tsc --noEmit`.

---

## Goal

This chunk lays the persistence substrate and the foundation seams as pass-throughs. It delivers a SQLite+files store (`threads`, append-only `messages`, append-only `mutations`, `distillation_events` table-only, `distilled_facts` table with tag columns present-but-unpopulated), an additive optional `thread_id` on `session_start` (no 7th variant; other 5 byte-unchanged), a daemon thread lifecycle that hydrates a thread's tail into `ProviderSessionState.messages[]` on start and flushes the turn back through the WRITE-GATE on end (replacing the silent `sessions.delete(sid)` discard), the MUTATION-AS-APPEND storage seam for forget (tombstone + hard-scrub) and edit (correction), a tombstone-honoring within-thread tail read, the 5b consolidation-hook fired on `threads.status→dismissed`, within-thread multi-turn over the real daemon→SQLite path, and a real-I/O smoke-probe. It adds NO distiller, NO write-gate policy, NO injection-point, NO cross-thread, NO UI.

---

## Reality check

Everything below is VERIFIED by reading the cited source unless explicitly marked otherwise. Behavioral claims are marked "requires runtime demo/test."

**Envelope union — confirmed 6-variant frozen union, additive-optional precedent confirmed.**
- `packages/protocol/src/envelope.ts:69-78`: `Envelope = z.discriminatedUnion("type", [SessionStart, SessionAck, ToolCall, ToolResult, ToolCancel, SessionEnd])` — exactly 6 variants. `KNOWN_MESSAGE_TYPES` (`envelope.ts:80-87`) lists the same 6.
- `SessionStart` (`envelope.ts:27-32`) already carries two **additive optional** fields the exact way the brief wants `thread_id` mirrored: `text: z.string().optional()` and `client_session_id: z.string().optional()`. The closed `trigger` enum (`envelope.ts:10`) is the *required* discriminator; the optional fields ride alongside it. So `thread_id: z.string().optional()` is a faithful mirror of the established additive-optional precedent.
- The envelope test already pins the count twice (`envelope.test.ts:60-63, 77-80`: `expect(Envelope.options.length).toBe(6)`), so "other 5 variants byte-unchanged + still 6" is a witnessed invariant the new test extends, not invents.
- `apps/overlay/src/ws/session-client.ts:49` derives its `SessionStart` type via `Extract<Envelope, { type: "session_start" }>` and never sets `thread_id` — confirmed the frontend will neither break nor need changes when the field is added (it stays absent ⇒ daemon mints a new thread). Daemon/frontend separation holds; surfacing `thread_id` to the frontend is route-part-2, not MF-01.

**`sessions.delete(sid)` end-of-turn behavior — confirmed; this is the single flush site.**
- `packages/daemon/src/index.ts:67-75`: after `provider.advance()`, the daemon reads `const sid = result.nextState.session_id`; if `result.nextState.phase === "done"` it calls `sessions.delete(sid)` (line 70), else `sessions.set(sid, result.nextState)`. **This `phase === "done"` branch is the ONE place a turn terminates** — the flush hooks here, before/around the delete. (The brief's "~line 70" is exact.)
- `index.ts:56-57`: `const sessionId = inbound.type === "session_start" ? undefined : inbound.session_id; const prior = sessionId ? sessions.get(sessionId) : undefined;`. So **on `session_start`, `prior` is always `undefined` today** — there is currently no hydration path. The hydration injection is precisely "build `prior` from the thread instead of passing `undefined`."
- `index.ts:79-82` (`close`): cleans up sessions owned by a dropped connection via `ws.data.sessionIds`. The thread↔session map must be cleaned up symmetrically.

**`ProviderSessionState.messages[]` seam + `AgentProvider` port — confirmed thread-agnostic; the spec's `provider.ts:5` citation is accurate.**
- `packages/daemon/src/providers/provider.ts:8-11` defines `SessionMessage { role: "user"|"assistant"; content: string }` with the comment "Multi-turn later = append more; NOT a rewrite" (`provider.ts:5`). `ProviderSessionState` (`provider.ts:17-19`) carries `messages: SessionMessage[]` on both phases.
- The port reads prior context generically: `anthropic-api-provider.ts:215` `const priorMessages = state?.messages ?? []`; `mock-provider.ts:53` `const priorMessages = state?.messages ?? []`. **Neither provider reads a `thread_id`.** Feeding a hydrated `messages[]` as `prior` is the reserved seam — no provider change needed.
- **Load-bearing nuance:** the provider mints its OWN `session_id` inside `advance()` (`mock-agent.ts:79`, `anthropic-api-provider.ts:210` both `crypto.randomUUID()`); the daemon does NOT supply it on `session_start`, it reads it back at `result.nextState.session_id`. Therefore the daemon must correlate `thread_id` from the **inbound `session_start.thread_id`**, hydrate `prior` *before* the provider call, and record the `session_id → thread_id` mapping *after* the call (when it first learns `session_id`).
- **Turn-shape nuance (requires runtime demo/test to confirm end-to-end):** mock reaches `phase:"done"` after TWO advances (start→`awaiting_pick`→tool_result→done; `mock-agent.ts:112-116, 168-176`); anthropic reaches `done` after ONE (`anthropic-api-provider.ts:223, 301-305`). The flush-on-`done` site handles both because both terminate through the same `phase==="done"` branch. The mock only appends the *user* message to `messages[]` (`mock-provider.ts:55-57`); the anthropic provider appends user + assistant (`anthropic-api-provider.ts:296-300`). MF-01's criterion 2 ("turn-2's provider input contains turn-1's messages") is satisfiable with the mock (user message carries over) and asserted directly on the hydrated `prior.messages`.

**Tooling — confirmed.**
- Root `package.json:7-11`: `test` → `bun test`; `lint:strict` → `eslint . --max-warnings=0`; `typecheck` → `tsc --noEmit -p tsconfig.json`. `eslint.config.js` is `typescript-eslint` recommended, no warnings allowed under `lint:strict`.
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `types:["bun"]`. `tsconfig.json` `include` already globs `packages/*/src/**/*.ts`, `packages/*/scripts/**/*.ts`, and `smoke.test.ts` — so new files under `packages/daemon/src/**` and `packages/daemon/scripts/**` are typechecked automatically, and a root `smoke.test.ts` already exists (`smoke.test.ts:1-5`, currently a trivial placeholder) and is in the typecheck program.
- Tests run by file via `bun test` and use `bun:test` (`test`, `expect`, `afterAll`) with real `WebSocket` clients against `startDaemon(0)` (ephemeral port) — pattern at `daemon.test.ts:1-6`. The smoke-probe script pattern is `packages/daemon/scripts/test-client.ts` (a real WS client over `startDaemon`).

**SQLite driver — confirmed no driver in use yet; `bun:sqlite` is the built-in to use.**
- Grep for `bun:sqlite|Database|node:fs|writeFile` across the repo: **no matches** — no SQLite usage and no driver dependency exists today. `packages/daemon/package.json:10-14` depends only on `@agentic/protocol`, `@anthropic-ai/sdk`, `zod`. `bun:sqlite` is a Bun built-in (no package install, no `package.json` change) and `types:["bun"]` is already configured — so using it introduces **no new runtime dependency** and needs no ADR. (ADR-0003 establishes Bun as the daemon runtime; `bun:sqlite` is part of that runtime.)

**Behavioral claims requiring runtime demo/test (NOT verified by reading):** that within-thread multi-turn actually hydrates turn-1's messages into turn-2's provider input; that forget hard-scrubs on disk while leaving the event+tombstone rows; that the consolidation-hook is actually invoked on dismiss; that the smoke-probe drives the real daemon→store and asserts on-disk persistence. These are exactly the criteria the real-I/O tests in `## Steps` prove. Per PIPELINE §6.1 / the Strike-4 scar, none of these are claimed PASS from code-reading — they are proven by the command output of the tests below, with **no mocked store**.

---

## Reality check addendum (provider-hydration fork)

**Path correction.** An earlier draft cited `packages/daemon/src/providers/mock-agent.ts` — that file does not exist. The two real files are:
- `packages/daemon/src/mock-agent.ts` — the **pure reducer** `advanceMockAgent(state, inbound)` (`MockSessionState` has **no** `messages` field). **Frozen byte-unchanged by ADR-0010 decision 6.**
- `packages/daemon/src/providers/mock-provider.ts` — the **adapter** that wraps the reducer behind the `AgentProvider` port and owns the `messages[]` strip-in / re-attach-out translation.

**The guard — identified correctly.** A `done`-phase hydration seed `{ phase: "done", session_id: "", messages: tail }` does NOT trip the `session_start while active` guard; it trips the **out-of-phase guard FIRST** at `mock-agent.ts:59-66`:

```typescript
// mock-agent.ts:59-66
if (state?.phase === "done") {
  return {
    ok: false,
    error: { kind: "unexpected_message", detail: `inbound '${inbound.type}' after session is done` },
    nextState: state,
    outbound: [],
  };
}
```

The `session_start`-while-active guard (`mock-agent.ts:70-78`) only fires for an `awaiting_pick` seed and is unreachable for a `done` seed. Either way, the **pure reducer accepts a `session_start` only when `state === undefined`** — it has no concept of prior history at all.

**The conflation diagnosis.** The `state` parameter serves double duty:
- **In the reducer** (`mock-agent.ts`): `state` is *purely* a phase machine — `undefined` = "no active turn", `awaiting_pick` = "mid-turn", `done` = "terminated". `MockSessionState` (`mock-agent.ts:42-44`) has **no** `messages` field; history is not the reducer's concern.
- **In the adapter/port** (`provider.ts:17-19`): `ProviderSessionState` *additively* adds `messages: SessionMessage[]` (ADR-0010 decision 5). Here `state` carries BOTH phase AND prior history.

Hydration is a *fresh* `session_start` carrying *prior history* — semantically NOT "session_start while active". The mock reducer has no phase expressing "fresh start + prior history" because history is the **adapter's** concern (ADR-0010 decision 6). Therefore the fix belongs in the adapter's strip-in, not the reducer's guard.

---

## Frozen-assumption impact (⚠️ orchestrator surfaced this to Lior at the plan-approval gate)

**Does the clean resolution require a provider-behavior change? YES — to the mock *adapter*, NOT the mock *reducer*; it nicks the spec's soft prose, not ADR-0010's hard freeze.**

- **Hard freeze HELD.** ADR-0010 **decision 6** (accepted 2026-06-03) freezes the pure `advanceMockAgent` reducer **byte-unchanged** ("the mock reducer and its unit tests are byte-unchanged"). This resolution does **not** edit `mock-agent.ts` / `mock-agent.test.ts` at all — the reducer still receives `state === undefined` on every `session_start` and emits byte-identical envelopes. **ADR-0010 decision 6 is honored.**
- **Soft prose NICKED (flagged).** The fix is one change to the **adapter** `mock-provider.ts` strip-in: on `session_start`, always pass `reducerState = undefined` to the reducer (guard never tripped) while *re-attaching the hydrated tail* onto outgoing `messages[]`. This nicks the memory-foundation **spec §3.1** (line 64): *"the existing provider consumes it unchanged" / `provider.ts:5` "Multi-turn later = append more; NOT a rewrite."*

**Assessment — small and safe, squarely "append more, not a rewrite."** The adapter already appends the user message onto `state?.messages ?? []` (`mock-provider.ts:53-57`); the prior tail flows through that same path. The only new logic forces `reducerState = undefined` on `session_start` (the reducer never observed `messages` anyway). Nothing is overwritten — hydrated tail is *prepended history*, the new user turn is *appended*. Reversible, daemon-internal, one adapter file. The anthropic provider needs **no** change.

**Recommendation (architect):** proceed with the adapter-only fix; it is the minimal "append" the spec's own seam reserved (`provider.ts:5`), and it leaves ADR-0010's frozen reducer untouched. **No ADR escalation.** Strictly, spec §3.1's "consumes it unchanged" is "the *reducer* consumes it unchanged; the *adapter* gains the one `messages[]` re-attach the seam was reserved for." If desired, spec §3.1 prose can be tightened to "reducer-unchanged" — a one-line doc edit, not a design change.

---

## File Structure

New module lives under `packages/daemon/src/memory/` (one responsibility: durable memory store + seams). Files that change together live together.

- **Create** `packages/daemon/src/memory/schema.ts` — SQLite DDL + table/column constants. Single source of truth for the storage shape.
- **Create** `packages/daemon/src/memory/store.ts` — `MemoryStore`: opens the DB, runs DDL, owns all raw SQL (threads/messages/mutations/distillation_events CRUD-append), the per-thread JSONL mirror writer, and the tombstone-honoring within-thread tail read. The ARCHIVE-AS-TRUTH boundary lives here.
- **Create** `packages/daemon/src/memory/write-gate.ts` — `WriteGate`: the single pass-through every memory write flows through (`appendTurn`, `forget`, `edit`). No policy. Shaped so MF-03 fills policy without re-plumbing.
- **Create** `packages/daemon/src/memory/consolidation-hook.ts` — `ConsolidationHook`: a registration mechanism + `fireDismiss(thread_id)` pass-through. No-op default handler.
- **Create** `packages/daemon/src/memory/thread-lifecycle.ts` — `ThreadLifecycle`: the daemon-facing facade that resolves `thread_id` on start, hydrates `prior.messages`, records the `session_id→thread_id` map, and flushes on end. The one place the behavioral change is encoded.
- **Modify** `packages/protocol/src/envelope.ts` — add optional `thread_id` to `SessionStart`.
- **Modify** `packages/daemon/src/index.ts` — wire `ThreadLifecycle` into the message handler: hydrate on `session_start`, flush on `phase==="done"`, clean up on `close`.
- **Create tests** alongside each module (`*.test.ts`) + one real-I/O integration test `packages/daemon/src/memory/memory-integration.daemon.test.ts`.
- **Create** `packages/daemon/scripts/memory-smoke.ts` — the real-I/O smoke-probe.

**Store-bytes split (architect call, frozen for this chunk):** **SQLite holds the canonical bytes** (structured, searchable, the substrate MF-02's distiller will read). Per-thread JSONL files (`<dataDir>/threads/<thread_id>.jsonl`) are an **append-only human-readable mirror/export/audit surface** — written on every event, never read back by the store. ARCHIVE-AS-TRUTH governs regardless of medium (spec §3.4): the event history in SQLite is immutable except via explicit mutation events; forget hard-scrubs the `messages.content` cell AND appends a redaction line to the JSONL mirror (the mirror never holds plaintext after a forget either).

**Within-thread tail read — REDACT, not exclude (architect call, justified):** a tombstoned (forgotten) turn is returned in the tail with its content replaced by the redaction marker; an edited turn is returned with the latest `correction.replacement_content`. Rationale: (1) the content is already hard-scrubbed in `messages.content`, so the read naturally yields the marker — *excluding* it would require an extra anti-join and lose turn ordering/`turn_index` continuity that the provider's `messages[]` ordering relies on; (2) redaction preserves conversational structure ("[the user retracted a message here]") which is more faithful to multi-turn context than a silent gap; (3) it keeps MF-01's read trivially consistent with the hard-scrub already on disk — the read does not re-implement forget logic, it just surfaces what the store holds plus any correction overlay. (Cross-thread re-derive's stricter *exclusion* is MF-02's job, per spec §3.4 F1 split.)

---

## Tag schema (present-but-unpopulated in MF-01)

`distilled_facts` and `distillation_events` tables are CREATED with full columns but MF-01 writes **zero rows** to them (the distiller is MF-02). They exist so MF-02 fills them without a schema migration. `distilled_facts` columns: `id`, `fact`, `provenance`, `scope`, `expiry`, `confidence`, `authored_by`, `derived_at`, `distiller_version`. `distillation_events` columns: `id`, `thread_id`, `trigger`, `facts_produced`, `distiller_version`, `created_at`.

---

## Steps

> Conventions for every step: exact file paths; complete code in code steps; run-and-expected for test steps; per-task commit (project CLAUDE.md: branch `chunk/MF-01-durable-store`, commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer, push branch, open PR at the end — never merge). Run the full gate (`bun test && bun run typecheck && bun run lint:strict`) before each commit.

### Task 1: Additive optional `thread_id` on `session_start` (wire-frozen except this one field)

**Files:**
- Modify: `packages/protocol/src/envelope.ts:27-32`
- Test: `packages/protocol/src/envelope.test.ts`

- [ ] **Step 1: Write the failing test** — append to `envelope.test.ts`:

```typescript
test("session_start with optional thread_id parses (additive field, MF-01)", () => {
  const r = parseEnvelope({ type: "session_start", trigger: "user", text: "hi", thread_id: "t-1" });
  expect(r.kind).toBe("ok");
  if (r.kind === "ok" && r.message.type === "session_start") {
    expect(r.message.thread_id).toBe("t-1");
  }
});

test("session_start WITHOUT thread_id still parses (field is optional)", () => {
  expect(parseEnvelope({ type: "session_start", trigger: "user", text: "hi" }).kind).toBe("ok");
});

test("adding thread_id does NOT grow the envelope union (still 6 variants)", () => {
  expect(Envelope.options.length).toBe(6);
});
```

- [ ] **Step 2: Run to verify it fails** — `bun test packages/protocol/src/envelope.test.ts` → FAIL on the first new test (`r.message.thread_id` is `undefined` / property not in type until the schema changes; under `verbatimModuleSyntax`/strict the `.thread_id` access fails typecheck — confirm via `bun run typecheck` shows the property error).

- [ ] **Step 3: Implement** — change ONLY `SessionStart` in `envelope.ts:27-32` to add the field as the last optional property, mirroring the `text`/`client_session_id` precedent:

```typescript
export const SessionStart = z.object({
  type: z.literal("session_start"),
  trigger: Trigger,
  text: z.string().optional(),
  client_session_id: z.string().optional(),
  /**
   * MF-01 (spec §3.1 / §5): additive optional thread continuation handle.
   * Present ⇒ daemon hydrates that thread's tail; absent/unknown ⇒ daemon mints
   * a NEW thread (single-turn = a degenerate one-turn thread). This is the SAME
   * additive-optional posture as `trigger`/`source` — NOT a 7th envelope variant;
   * the 6-variant discriminated union is byte-unchanged.
   */
  thread_id: z.string().optional(),
});
```

Do NOT touch any other schema, the `Envelope` union, `KNOWN_MESSAGE_TYPES`, or `parseEnvelope`.

- [ ] **Step 4: Run to verify it passes** — `bun test packages/protocol/src/envelope.test.ts` → all PASS, including both pre-existing `Envelope.options.length).toBe(6)` assertions (proves the union is byte-unchanged).

- [ ] **Step 5: Commit** — `git add packages/protocol/src/envelope.ts packages/protocol/src/envelope.test.ts && git commit` (message: `feat(protocol): add additive optional thread_id to session_start (MF-01)` + trailer).

---

### Task 2: SQLite schema + `MemoryStore` append/read core (ARCHIVE-AS-TRUTH + JSONL mirror)

**Files:**
- Create: `packages/daemon/src/memory/schema.ts`
- Create: `packages/daemon/src/memory/store.ts`
- Test: `packages/daemon/src/memory/store.test.ts`

- [ ] **Step 1: Write the schema** — `packages/daemon/src/memory/schema.ts`:

```typescript
/**
 * MF-01 storage shape (spec §3.4). SQLite holds the CANONICAL bytes; per-thread
 * JSONL files are an append-only human-readable MIRROR (store.ts). ARCHIVE-AS-TRUTH
 * (spec §3.2 invariant 1): the event history is immutable except via explicit
 * mutation events; forget hard-scrubs `messages.content` (real erasure), the row
 * + its tombstone remain.
 *
 * `distilled_facts` and `distillation_events` are CREATED here with full columns
 * but UNPOPULATED in MF-01 (the distiller is MF-02) — present so MF-02 fills them
 * with no schema migration.
 */
export const REDACTION_MARKER = "[forgotten]";

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS threads (
  thread_id      TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'dismissed'
  title          TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES threads(thread_id),
  turn_index  INTEGER NOT NULL,
  role        TEXT NOT NULL,                       -- 'user' | 'assistant'
  content     TEXT NOT NULL,                       -- scrub-able by a forget tombstone
  created_at  INTEGER NOT NULL,
  session_id  TEXT NOT NULL                        -- ephemeral session that produced it
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, turn_index);

CREATE TABLE IF NOT EXISTS mutations (
  id                  TEXT PRIMARY KEY,
  target_message_id   TEXT NOT NULL REFERENCES messages(id),
  kind                TEXT NOT NULL,               -- 'tombstone' | 'correction'
  actor               TEXT,
  reason              TEXT,
  replacement_content TEXT,                        -- only for kind='correction'
  authored_by         TEXT NOT NULL,               -- 'human' | 'machine'
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mutations_target ON mutations(target_message_id);

CREATE TABLE IF NOT EXISTS distilled_facts (
  id               TEXT PRIMARY KEY,
  fact             TEXT NOT NULL,
  provenance       TEXT,
  scope            TEXT,
  expiry           INTEGER,
  confidence       REAL,
  authored_by      TEXT,                           -- 'human' | 'machine'
  derived_at       INTEGER,
  distiller_version TEXT
);

CREATE TABLE IF NOT EXISTS distillation_events (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL,
  trigger           TEXT NOT NULL,                 -- 'dismiss' | ...
  facts_produced    INTEGER NOT NULL DEFAULT 0,
  distiller_version TEXT,
  created_at        INTEGER NOT NULL
);
`;
```

- [ ] **Step 2: Write the failing test** — `packages/daemon/src/memory/store.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-"));
  return { store: new MemoryStore({ dataDir: dir }), dir };
}

test("createThread + appendMessages persist to SQLite and the JSONL mirror", () => {
  const { store, dir } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "deploy script is yeet.sh" }], "sess-1");
  const tail = store.readThreadTail(t, 10);
  expect(tail).toEqual([{ role: "user", content: "deploy script is yeet.sh" }]);
  const mirror = join(dir, "threads", `${t}.jsonl`);
  expect(existsSync(mirror)).toBe(true);
  expect(readFileSync(mirror, "utf8")).toContain("yeet.sh");
  store.close();
});

test("appendMessages assigns monotonic turn_index across calls", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "a" }], "s1");
  store.appendMessages(t, [{ role: "user", content: "b" }, { role: "assistant", content: "c" }], "s2");
  expect(store.readThreadTail(t, 10)).toEqual([
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
  ]);
  store.close();
});

test("readThreadTail respects the limit and returns the most recent N in order", () => {
  const { store } = freshStore();
  const t = store.createThread();
  for (let i = 0; i < 5; i++) store.appendMessages(t, [{ role: "user", content: `m${i}` }], "s");
  expect(store.readThreadTail(t, 2)).toEqual([
    { role: "user", content: "m3" },
    { role: "user", content: "m4" },
  ]);
  store.close();
});

test("threadExists distinguishes a minted thread from an unknown id", () => {
  const { store } = freshStore();
  const t = store.createThread();
  expect(store.threadExists(t)).toBe(true);
  expect(store.threadExists("nope")).toBe(false);
  store.close();
});
```

- [ ] **Step 3: Run to verify it fails** — `bun test packages/daemon/src/memory/store.test.ts` → FAIL ("Cannot find module './store.js'").

- [ ] **Step 4: Implement** — `packages/daemon/src/memory/store.ts`. Use `bun:sqlite` (built-in). `readThreadTail` LEFT JOINs the latest mutation per message so a tombstone yields the marker and a correction yields its replacement (tombstone-honoring within-thread read — REDACT semantics):

```typescript
import { Database } from "bun:sqlite";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_DDL, REDACTION_MARKER } from "./schema.js";
import type { SessionMessage } from "../providers/provider.js";

export interface MemoryStoreOptions {
  /** Directory for the SQLite file + the threads/ JSONL mirror. */
  dataDir: string;
}

interface TailRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tombstoned: number;
  correction: string | null;
}

export class MemoryStore {
  private readonly db: Database;
  private readonly threadsDir: string;

  constructor(opts: MemoryStoreOptions) {
    mkdirSync(opts.dataDir, { recursive: true });
    this.threadsDir = join(opts.dataDir, "threads");
    mkdirSync(this.threadsDir, { recursive: true });
    this.db = new Database(join(opts.dataDir, "memory.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA_DDL);
  }

  createThread(title?: string): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .query(
        "INSERT INTO threads (thread_id, created_at, last_active_at, status, title) VALUES (?, ?, ?, 'active', ?)",
      )
      .run(id, now, now, title ?? null);
    this.mirror(id, { event: "thread_created", thread_id: id, created_at: now });
    return id;
  }

  threadExists(threadId: string): boolean {
    const row = this.db.query("SELECT 1 FROM threads WHERE thread_id = ?").get(threadId);
    return row !== null;
  }

  appendMessages(threadId: string, messages: SessionMessage[], sessionId: string): string[] {
    const now = Date.now();
    const base = this.nextTurnIndex(threadId);
    const ids: string[] = [];
    const insert = this.db.query(
      "INSERT INTO messages (id, thread_id, turn_index, role, content, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const tx = this.db.transaction(() => {
      messages.forEach((m, i) => {
        const id = crypto.randomUUID();
        insert.run(id, threadId, base + i, m.role, m.content, now, sessionId);
        ids.push(id);
        this.mirror(threadId, { event: "message", id, turn_index: base + i, role: m.role, content: m.content, session_id: sessionId, created_at: now });
      });
      this.db.query("UPDATE threads SET last_active_at = ? WHERE thread_id = ?").run(now, threadId);
    });
    tx();
    return ids;
  }

  /** Tombstone-honoring within-thread tail (REDACT): tombstone ⇒ marker; correction ⇒ replacement. */
  readThreadTail(threadId: string, limit: number): SessionMessage[] {
    const rows = this.db
      .query(
        `SELECT m.id AS id, m.role AS role, m.content AS content,
                MAX(CASE WHEN x.kind = 'tombstone' THEN 1 ELSE 0 END) AS tombstoned,
                (SELECT replacement_content FROM mutations
                   WHERE target_message_id = m.id AND kind = 'correction'
                   ORDER BY created_at DESC LIMIT 1) AS correction
         FROM messages m
         LEFT JOIN mutations x ON x.target_message_id = m.id
         WHERE m.thread_id = ?
         GROUP BY m.id
         ORDER BY m.turn_index DESC
         LIMIT ?`,
      )
      .all(threadId, limit) as TailRow[];
    return rows
      .reverse()
      .map((r) => ({
        role: r.role,
        content: r.tombstoned ? REDACTION_MARKER : (r.correction ?? r.content),
      }));
  }

  /** Raw helpers used by WriteGate (mutations) — kept here so all SQL lives in the store. */
  rawDb(): Database {
    return this.db;
  }

  mirrorEvent(threadId: string, payload: Record<string, unknown>): void {
    this.mirror(threadId, payload);
  }

  close(): void {
    this.db.close();
  }

  private nextTurnIndex(threadId: string): number {
    const row = this.db
      .query("SELECT COALESCE(MAX(turn_index) + 1, 0) AS n FROM messages WHERE thread_id = ?")
      .get(threadId) as { n: number };
    return row.n;
  }

  private mirror(threadId: string, payload: Record<string, unknown>): void {
    appendFileSync(join(this.threadsDir, `${threadId}.jsonl`), JSON.stringify(payload) + "\n");
  }
}
```

- [ ] **Step 5: Run to verify it passes** — `bun test packages/daemon/src/memory/store.test.ts` → all PASS.

- [ ] **Step 6: Run the gate + commit** — `bun test && bun run typecheck && bun run lint:strict` → green; `git add packages/daemon/src/memory/schema.ts packages/daemon/src/memory/store.ts packages/daemon/src/memory/store.test.ts && git commit` (`feat(daemon): MF-01 SQLite memory store + JSONL mirror + tombstone-honoring tail`).

---

### Task 3: WRITE-GATE pass-through (appendTurn / forget / edit) — MUTATION-AS-APPEND, NO policy

**Files:**
- Create: `packages/daemon/src/memory/write-gate.ts`
- Test: `packages/daemon/src/memory/write-gate.test.ts`

The gate's signature is shaped so MF-03 fills 5d scan + 5e no-overwrite WITHOUT re-plumbing: every write takes a `WriteContext { actor; authored_by }` and is the single choke point. MF-01's body just forwards to the store. forget = append `tombstone` + hard-scrub `messages.content`; edit = append `correction`, never in-place.

- [ ] **Step 1: Write the failing test** — `packages/daemon/src/memory/write-gate.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate, REDACTION_MARKER } from "./write-gate.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-wg-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, gate: new WriteGate(store) };
}
const CTX = { actor: "user", authored_by: "human" as const };

test("appendTurn flows through the gate and lands in the store", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  gate.appendTurn(t, [{ role: "user", content: "hello" }], "s1", CTX);
  expect(store.readThreadTail(t, 10)).toEqual([{ role: "user", content: "hello" }]);
  store.close();
});

test("forget appends a tombstone AND hard-scrubs the message content; rows remain", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "secret token abc" }], "s1", CTX);
  gate.forget(mid!, CTX, "user requested");
  const db = store.rawDb();
  const msg = db.query("SELECT content FROM messages WHERE id = ?").get(mid) as { content: string };
  expect(msg.content).toBe(REDACTION_MARKER);             // hard-scrub, not soft hide
  expect(msg.content).not.toContain("secret token");
  const tomb = db.query("SELECT kind FROM mutations WHERE target_message_id = ?").get(mid) as { kind: string };
  expect(tomb.kind).toBe("tombstone");                    // event + tombstone remain
  // within-thread read redacts it
  expect(store.readThreadTail(t, 10)).toEqual([{ role: "user", content: REDACTION_MARKER }]);
  store.close();
});

test("edit appends a correction; the original message row is NOT mutated in place", () => {
  const { store, gate } = fresh();
  const t = store.createThread();
  const [mid] = gate.appendTurn(t, [{ role: "user", content: "deploy is deploy.sh" }], "s1", CTX);
  gate.edit(mid!, "deploy is yeet.sh", CTX, "user correction");
  const db = store.rawDb();
  const original = db.query("SELECT content FROM messages WHERE id = ?").get(mid) as { content: string };
  expect(original.content).toBe("deploy is deploy.sh");   // original NOT touched
  const corr = db.query("SELECT kind, replacement_content FROM mutations WHERE target_message_id = ?").get(mid) as { kind: string; replacement_content: string };
  expect(corr.kind).toBe("correction");
  expect(corr.replacement_content).toBe("deploy is yeet.sh");
  // within-thread read surfaces the correction
  expect(store.readThreadTail(t, 10)).toEqual([{ role: "user", content: "deploy is yeet.sh" }]);
  store.close();
});
```

- [ ] **Step 2: Run to verify it fails** — `bun test packages/daemon/src/memory/write-gate.test.ts` → FAIL ("Cannot find module './write-gate.js'").

- [ ] **Step 3: Implement** — `packages/daemon/src/memory/write-gate.ts`:

```typescript
import type { MemoryStore } from "./store.js";
import type { SessionMessage } from "../providers/provider.js";
import { REDACTION_MARKER } from "./schema.js";

export { REDACTION_MARKER };

/**
 * Context every memory write carries. MF-01 only records `authored_by` (so the
 * mutations/messages provenance columns are populated); MF-03 (5d scan / 5e
 * no-overwrite) READS this same context — it FILLS policy here without adding a
 * second write path. This is the §7.1 localization point: all memory writes
 * choke through this one object.
 */
export interface WriteContext {
  actor: string;
  authored_by: "human" | "machine";
}

/**
 * WRITE-GATE (spec §3.3) — the SINGLE function every memory write flows through.
 * MF-01 = pure pass-through (NO scan, NO no-overwrite). MF-03 fills policy by
 * adding checks at the TOP of each method; callers and the store API do not change.
 */
export class WriteGate {
  constructor(private readonly store: MemoryStore) {}

  /** Append a completed turn's messages to the durable thread. Returns message ids. */
  appendTurn(
    threadId: string,
    messages: SessionMessage[],
    sessionId: string,
    _ctx: WriteContext, // MF-03 reads this; MF-01 ignores it (pass-through)
  ): string[] {
    return this.store.appendMessages(threadId, messages, sessionId);
  }

  /** forget = appended tombstone + hard-scrub of the referenced message content. */
  forget(messageId: string, ctx: WriteContext, reason?: string): void {
    const db = this.store.rawDb();
    const now = Date.now();
    const tx = db.transaction(() => {
      db.query(
        "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'tombstone', ?, ?, NULL, ?, ?)",
      ).run(crypto.randomUUID(), messageId, ctx.actor, reason ?? null, ctx.authored_by, now);
      db.query("UPDATE messages SET content = ? WHERE id = ?").run(REDACTION_MARKER, messageId);
    });
    tx();
    this.store.mirrorEvent(this.threadOf(messageId), { event: "forget", target_message_id: messageId, actor: ctx.actor, created_at: now });
  }

  /** edit = appended correction record referencing the original (never in-place). */
  edit(messageId: string, replacement: string, ctx: WriteContext, reason?: string): void {
    const db = this.store.rawDb();
    const now = Date.now();
    db.query(
      "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'correction', ?, ?, ?, ?, ?)",
    ).run(crypto.randomUUID(), messageId, ctx.actor, reason ?? null, replacement, ctx.authored_by, now);
    this.store.mirrorEvent(this.threadOf(messageId), { event: "edit", target_message_id: messageId, replacement, actor: ctx.actor, created_at: now });
  }

  private threadOf(messageId: string): string {
    const row = this.store.rawDb().query("SELECT thread_id FROM messages WHERE id = ?").get(messageId) as { thread_id: string };
    return row.thread_id;
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `bun test packages/daemon/src/memory/write-gate.test.ts` → all PASS.

- [ ] **Step 5: Gate + commit** — full gate green; `git add packages/daemon/src/memory/write-gate.ts packages/daemon/src/memory/write-gate.test.ts && git commit` (`feat(daemon): MF-01 WRITE-GATE pass-through (append/forget/edit, MUTATION-AS-APPEND)`).

---

### Task 4: Consolidation-hook (5b) — registration + `fireDismiss` on `threads.status→dismissed`

**Files:**
- Create: `packages/daemon/src/memory/consolidation-hook.ts`
- Test: `packages/daemon/src/memory/consolidation-hook.test.ts`

The criterion is: a registered handler is provably CALLED on dismiss; the `distillation_events` table is present (it is — Task 2). The hook is a no-op stub by default; MF-02 registers the distiller.

- [ ] **Step 1: Write the failing test** — `packages/daemon/src/memory/consolidation-hook.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { ConsolidationHook } from "./consolidation-hook.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-hook-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, hook: new ConsolidationHook(store) };
}

test("dismissing a thread flips status to 'dismissed' AND invokes the registered handler", () => {
  const { store, hook } = fresh();
  const t = store.createThread();
  const calls: string[] = [];
  hook.register((threadId, trigger) => { calls.push(`${threadId}:${trigger}`); });
  hook.dismiss(t);
  expect(calls).toEqual([`${t}:dismiss`]);
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});

test("default (no registration) dismiss is a no-op pass-through that still flips status", () => {
  const { store, hook } = fresh();
  const t = store.createThread();
  expect(() => hook.dismiss(t)).not.toThrow();
  const status = (store.rawDb().query("SELECT status FROM threads WHERE thread_id = ?").get(t) as { status: string }).status;
  expect(status).toBe("dismissed");
  store.close();
});

test("distillation_events table exists (schema present; MF-01 writes no rows)", () => {
  const { store } = fresh();
  const count = (store.rawDb().query("SELECT COUNT(*) AS n FROM distillation_events").get() as { n: number }).n;
  expect(count).toBe(0);
  store.close();
});
```

- [ ] **Step 2: Run to verify it fails** — `bun test packages/daemon/src/memory/consolidation-hook.test.ts` → FAIL ("Cannot find module './consolidation-hook.js'").

- [ ] **Step 3: Implement** — `packages/daemon/src/memory/consolidation-hook.ts`:

```typescript
import type { MemoryStore } from "./store.js";

export type ConsolidationTrigger = "dismiss";
export type ConsolidationHandler = (threadId: string, trigger: ConsolidationTrigger) => void;

/**
 * 5b CONSOLIDATION-HOOK (spec §3.3) — the dismiss-lifecycle pass-through where
 * distillation will fire. MF-01 = a registration mechanism + a no-op default;
 * dismiss() flips threads.status→'dismissed' and invokes the registered handler.
 * MF-02 registers the real distiller (which writes the distillation_events row,
 * even on an empty consolidation). MF-01 deliberately writes NO event rows.
 */
export class ConsolidationHook {
  private handler: ConsolidationHandler = () => { /* no-op stub (MF-02 fills) */ };

  constructor(private readonly store: MemoryStore) {}

  register(handler: ConsolidationHandler): void {
    this.handler = handler;
  }

  /** Mark a thread dismissed and fire the consolidation pass-through. */
  dismiss(threadId: string): void {
    this.store.rawDb().query("UPDATE threads SET status = 'dismissed' WHERE thread_id = ?").run(threadId);
    this.handler(threadId, "dismiss");
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `bun test packages/daemon/src/memory/consolidation-hook.test.ts` → all PASS.

- [ ] **Step 5: Gate + commit** — green; `git add packages/daemon/src/memory/consolidation-hook.ts packages/daemon/src/memory/consolidation-hook.test.ts && git commit` (`feat(daemon): MF-01 5b consolidation-hook pass-through on thread dismiss`).

---

### Task 5: `ThreadLifecycle` facade + mock-adapter hydration + wire into `index.ts` — the §7.1 localized behavioral change

> The hydration mechanism is stated ONCE here. The pure reducer (`mock-agent.ts`) is **NOT touched** (ADR-0010 decision 6). The one provider change is adapter-only (`mock-provider.ts`), flagged under `## Frozen-assumption impact`.

**Files:**
- Create: `packages/daemon/src/memory/thread-lifecycle.ts`
- Test: `packages/daemon/src/memory/thread-lifecycle.test.ts`
- Modify: `packages/daemon/src/providers/mock-provider.ts` (adapter strip-in — the §3.1-flagged change)
- Test: `packages/daemon/src/providers/mock-provider.test.ts` (one new test: hydration multi-turns through the mock)
- Modify: `packages/daemon/src/index.ts`

**The one mechanism (state it once, here):** On `session_start`, the daemon resolves the thread and hydrates its tail into `ProviderSessionState.messages[]`, passing `priorState = { phase: "done", session_id: "", messages: tail }` to `provider.advance()` (the natural `ProviderSessionState` shape; `phase` is a don't-care on start). The **mock adapter** is taught to treat a `session_start` as *always* a fresh reducer call (`reducerState = undefined`) while *re-attaching the hydrated tail* onto outgoing `messages[]`. The reducer stays byte-unchanged; prior history reaches the provider via the reserved `messages[]` seam; the default mock path performs within-thread multi-turn.

- [ ] **Step 1: `ThreadLifecycle` facade + failing test** — `packages/daemon/src/memory/thread-lifecycle.ts`. `beginTurn(inbound)` resolves/mints `threadId` + returns `priorMessages` (hydrated tail via `store.readThreadTail(threadId, TAIL_LIMIT)`, `TAIL_LIMIT = 50`); `bindSession`, `threadForSession`, `endTurn` (flush via `gate.appendTurn` then unbind), `forgetSession`. No `phase`/seed logic lives in the facade — it returns a plain `SessionMessage[]`; the daemon wraps it into the seed.

```typescript
// packages/daemon/src/memory/thread-lifecycle.ts
import type { Envelope } from "@agentic/protocol";
import type { MemoryStore } from "./store.js";
import type { WriteGate } from "./write-gate.js";
import type { SessionMessage } from "../providers/provider.js";

type SessionStart = Extract<Envelope, { type: "session_start" }>;

/** How many recent messages to hydrate into prior context (architect-time recency window). */
const TAIL_LIMIT = 50;

/**
 * ThreadLifecycle — the SINGLE place the MF-01 behavioral change lives (§7.1).
 * Two-phase, because the daemon does NOT know the provider-minted session_id
 * until AFTER provider.advance():
 *   beginTurn(session_start)   → resolve thread_id (inbound, or mint) + hydrate prior tail.
 *   bindSession(sid, thread)   → record session_id→thread_id once the provider returns it.
 *   endTurn(thread, sid, msgs) → flush the turn through the WRITE-GATE, then unbind.
 */
export class ThreadLifecycle {
  private readonly sessionToThread = new Map<string, string>();

  constructor(
    private readonly store: MemoryStore,
    private readonly gate: WriteGate,
  ) {}

  beginTurn(inbound: SessionStart): { threadId: string; priorMessages: SessionMessage[] } {
    const requested = inbound.thread_id;
    if (requested && this.store.threadExists(requested)) {
      return { threadId: requested, priorMessages: this.store.readThreadTail(requested, TAIL_LIMIT) };
    }
    // No / unknown thread_id ⇒ mint a NEW thread (single-turn = degenerate one-turn thread).
    return { threadId: this.store.createThread(), priorMessages: [] };
  }

  bindSession(sessionId: string, threadId: string): void {
    this.sessionToThread.set(sessionId, threadId);
  }

  threadForSession(sessionId: string): string | undefined {
    return this.sessionToThread.get(sessionId);
  }

  /** Flush the completed turn's messages to the durable thread via the WRITE-GATE, then unbind. */
  endTurn(threadId: string, sessionId: string, finalMessages: SessionMessage[]): void {
    if (finalMessages.length > 0) {
      this.gate.appendTurn(threadId, finalMessages, sessionId, { actor: "agent", authored_by: "machine" });
    }
    this.sessionToThread.delete(sessionId);
  }

  /** Connection drop cleanup (mirrors index.ts close()). */
  forgetSession(sessionId: string): void {
    this.sessionToThread.delete(sessionId);
  }
}
```

  Failing test `packages/daemon/src/memory/thread-lifecycle.test.ts` (four facade tests):

```typescript
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { WriteGate } from "./write-gate.js";
import { ThreadLifecycle } from "./thread-lifecycle.js";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-tl-"));
  const store = new MemoryStore({ dataDir: dir });
  return { store, lifecycle: new ThreadLifecycle(store, new WriteGate(store)) };
}

test("no thread_id mints a NEW thread; prior tail is empty (single-turn = degenerate one-turn thread)", () => {
  const { lifecycle } = fresh();
  const begin = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi" });
  expect(typeof begin.threadId).toBe("string");
  expect(begin.priorMessages).toEqual([]);
});

test("unknown thread_id ALSO mints a new thread (graceful, never throws)", () => {
  const { lifecycle } = fresh();
  const begin = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "hi", thread_id: "does-not-exist" });
  expect(begin.threadId).not.toBe("does-not-exist");
  expect(begin.priorMessages).toEqual([]);
});

test("turn 1 flush → turn 2 with that thread_id hydrates turn-1's messages (within-thread multi-turn)", () => {
  const { lifecycle } = fresh();
  const t1 = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "deploy is yeet.sh" });
  lifecycle.endTurn(t1.threadId, "sess-1", [{ role: "user", content: "deploy is yeet.sh" }]);
  const t2 = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "what's the deploy?", thread_id: t1.threadId });
  expect(t2.threadId).toBe(t1.threadId);
  expect(t2.priorMessages).toEqual([{ role: "user", content: "deploy is yeet.sh" }]);
});

test("session_id→thread_id mapping resolves later turns, then is cleaned up", () => {
  const { lifecycle } = fresh();
  const t = lifecycle.beginTurn({ type: "session_start", trigger: "user", text: "x" });
  lifecycle.bindSession("sess-9", t.threadId);
  expect(lifecycle.threadForSession("sess-9")).toBe(t.threadId);
  lifecycle.endTurn(t.threadId, "sess-9", [{ role: "user", content: "x" }]);
  expect(lifecycle.threadForSession("sess-9")).toBeUndefined();
});
```

- [ ] **Step 2: Run facade test to fail then implement to pass** — `bun test packages/daemon/src/memory/thread-lifecycle.test.ts` → fail (no module) → implement → pass.

- [ ] **Step 3: Teach the mock adapter to accept a hydrated start (the §3.1-flagged change)** — modify `packages/daemon/src/providers/mock-provider.ts`. The reducer (`mock-agent.ts`) is **NOT touched** (ADR-0010 decision 6 freeze). On `session_start`, force `reducerState = undefined` so the byte-unchanged reducer takes its normal fresh-start path even when `state.messages` is populated. The existing re-attach (`mock-provider.ts:53-57`) already prepends `state?.messages ?? []` then appends the user turn — so the hydrated tail flows through unchanged. Replace the strip-in block (`mock-provider.ts:30-46`) with:

```typescript
    // 1. Derive the reducer's MockSessionState | undefined by stripping messages[].
    //    HYDRATION (MF-01): a session_start may carry a hydrated tail in
    //    state.messages (within-thread multi-turn). The pure reducer has NO
    //    concept of prior history (MockSessionState has no messages[]) and
    //    accepts session_start only when state === undefined (mock-agent.ts:59-78).
    //    So on session_start we ALWAYS hand the reducer `undefined` (its normal
    //    fresh-start path, BYTE-UNCHANGED per ADR-0010 decision 6) and re-attach
    //    the hydrated tail onto messages[] in step 3 — "append more, NOT a
    //    rewrite" (provider.ts:5 / spec §3.1). Adapter translation, not a reducer change.
    let reducerState: MockSessionState | undefined;
    if (inbound.type === "session_start" || state === undefined) {
      reducerState = undefined;
    } else if (state.phase === "awaiting_pick") {
      reducerState = {
        phase: "awaiting_pick",
        session_id: state.session_id,
        call_id: state.call_id,
      };
    } else {
      // phase: "done"
      reducerState = { phase: "done", session_id: state.session_id };
    }
```

  The rest of `advance()` (`mock-provider.ts:48-94`) is unchanged: step 3 still computes `nextMessages = inbound.type === "session_start" ? [...priorMessages, userMsg] : [...priorMessages]` with `priorMessages = state?.messages ?? []`, so the hydrated tail is preserved and the new user turn appended.

  > Worker: verify the exact pre-edit shape of `mock-provider.ts:30-46` before replacing — match the real strip-in branches (`awaiting_pick`/`done`) to the current `MockSessionState` definition. The ONLY behavioral delta is the added `inbound.type === "session_start"` disjunct that forces `undefined`.

- [ ] **Step 4: Prove the mock multi-turns through the adapter (unit, default path)** — append to `packages/daemon/src/providers/mock-provider.test.ts`:

```typescript
test("hydrated session_start: prior tail preserved and new user turn appended (within-thread multi-turn, mock path)", async () => {
  const hydrated: ProviderSessionState = {
    phase: "done",
    session_id: "",
    messages: [{ role: "user", content: "deploy is yeet.sh" }],
  };
  const result = await mockProvider.advance(hydrated, {
    type: "session_start",
    trigger: "user",
    text: "what's the deploy?",
    client_session_id: "c-hydrate",
  });
  // Reducer took its normal fresh-start path → byte-identical color-picker flow.
  expect(result.ok).toBe(true);
  expect(result.nextState.phase).toBe("awaiting_pick");
  // Multi-turn: turn-1's message carried into turn-2's state, turn-2 appended.
  expect(result.nextState.messages).toEqual([
    { role: "user", content: "deploy is yeet.sh" },
    { role: "user", content: "what's the deploy?" },
  ]);
});
```

  Run: `bun test packages/daemon/src/providers/mock-provider.test.ts` → all PASS. This is the **default-path proof** of within-thread multi-turn — no test-double, no anthropic dependency. (Match the import names — `mockProvider`/`ProviderSessionState` — to the existing test file's imports.)

- [ ] **Step 5: Verify the reducer + its tests are byte-unchanged (ADR-0010 decision 6 guard)** — `bun test packages/daemon/src/mock-agent.test.ts` → all PASS with **zero edits** to `mock-agent.ts` / `mock-agent.test.ts`. Also `bun test packages/daemon/src/mock-agent.daemon.test.ts` → PASS (the WS color-picker round-trip is byte-identical). `git diff --stat packages/daemon/src/mock-agent.ts` → empty (proves adapter-only).

- [ ] **Step 6: Wire `ThreadLifecycle` into `index.ts`** — construct store + gate + lifecycle once; hydrate on `session_start`; flush on `phase==="done"` (replacing the bare `sessions.delete(sid)` at `index.ts:70`); unbind on `close`. Imports + construction (after the `buildInjector()` line, ~`index.ts:25`):

```typescript
import { join } from "node:path";
import { homedir } from "node:os";
import { MemoryStore } from "./memory/store.js";
import { WriteGate } from "./memory/write-gate.js";
import { ThreadLifecycle } from "./memory/thread-lifecycle.js";
// ...
export function startDaemon(port: number = DAEMON_PORT) {
  const provider = buildInjector();
  const dataDir = Bun.env.AGENTIC_DATA_DIR ?? join(homedir(), ".agentic-engine");
  const store = new MemoryStore({ dataDir });
  const lifecycle = new ThreadLifecycle(store, new WriteGate(store));
```

  Replace the inbound block (`index.ts:55-77`) with thread-aware handling:

```typescript
        const inbound = msg as ProviderInput;

        // Resolve the durable thread for THIS turn BEFORE the provider runs.
        // session_start → from inbound.thread_id (or mint). Later turns →
        // via the session_id→thread_id binding recorded after the provider minted it.
        let turnThreadId: string | undefined;
        let priorState: ProviderSessionState | undefined;
        if (inbound.type === "session_start") {
          const begin = lifecycle.beginTurn(inbound);
          turnThreadId = begin.threadId;
          // Hydrate the thread tail into the messages[] seam (provider.ts:5).
          // phase:"done"/session_id:"" are don't-cares on start — every provider
          // reads only `.messages`; the mock adapter maps a session_start to a
          // fresh reducer call regardless of this phase.
          priorState = begin.priorMessages.length
            ? { phase: "done", session_id: "", messages: begin.priorMessages }
            : undefined;
        } else {
          priorState = sessions.get(inbound.session_id);
          turnThreadId = lifecycle.threadForSession(inbound.session_id);
        }

        const result = await provider.advance(priorState, inbound);

        if (!result.ok) {
          console.error("[daemon] provider typed error:", result.error);
        } else if (result.finalText) {
          console.log("[daemon] agent final text:", result.finalText);
        }

        const sid = result.nextState.session_id;
        if (sid) {
          if (turnThreadId) lifecycle.bindSession(sid, turnThreadId);
          if (result.nextState.phase === "done") {
            // ── §7.1 behavioral change: flush the turn to the durable thread,
            //    THEN drop RAM (was a bare sessions.delete(sid) at index.ts:70).
            const threadId = lifecycle.threadForSession(sid) ?? turnThreadId;
            if (threadId) lifecycle.endTurn(threadId, sid, result.nextState.messages);
            sessions.delete(sid);
          } else {
            sessions.set(sid, result.nextState);
            ws.data.sessionIds.add(sid);
          }
        }

        for (const out of result.outbound) send(ws, out);
```

  In `close(ws)` (`index.ts:79-82`):

```typescript
      close(ws) {
        for (const sid of ws.data.sessionIds) {
          sessions.delete(sid);
          lifecycle.forgetSession(sid);
        }
      },
```

  > Worker note: the mock reaches `phase:"done"` only after the tool_result round-trip (`mock-agent.ts:141-176`), so a mock turn's messages flush when the *picker is answered*, not at `session_start` (which yields `awaiting_pick`). The flush site handles both providers because both terminate through the same `phase==="done"` branch. The smoke-probe (Task 8) and integration test (Task 6) drive the mock to `done` by answering the picker. **Match `priorState`/`ProviderSessionState` to the real provider types; confirm `ProviderInput`/`ProviderSessionState` import sites in the current `index.ts`.**

- [ ] **Step 7: No-regression + gate + commit** — `bun test packages/daemon/src/daemon.test.ts packages/daemon/src/mock-agent.daemon.test.ts packages/daemon/src/providers/mock-provider.test.ts packages/daemon/src/mock-agent.test.ts` → all PASS. Full gate `bun test && bun run typecheck && bun run lint:strict` green. `git add packages/daemon/src/memory/thread-lifecycle.ts packages/daemon/src/memory/thread-lifecycle.test.ts packages/daemon/src/providers/mock-provider.ts packages/daemon/src/providers/mock-provider.test.ts packages/daemon/src/index.ts && git commit` (`feat(daemon): MF-01 thread lifecycle — hydrate on start (mock multi-turns), flush on done`).

---

### Task 6: Real-I/O integration test (real daemon → real SQLite, DEFAULT mock provider, NO mocked store)

> **No `recording-provider`.** Criterion 2 is proven over the **default mock path** the production daemon actually takes — no bespoke guard-free provider (which would re-introduce the Strike-4 mock-bypass blind spot spec §4.2 forbids), no `injector.ts` change.

**Files:**
- Create: `packages/daemon/src/memory/memory-integration.daemon.test.ts`

**How criterion 2 is observed without a test double.** Criterion 2 = "turn-2's provider input contains turn-1's messages." Asserted on the **durable store the daemon wrote**: after turn 1 flushes, turn 2 with that `thread_id` hydrates — and the effect is asserted two ways: (a) the daemon's `readThreadTail` returns turn-1's message (the input the daemon feeds the provider as `priorState.messages`); (b) after turn 2, the thread contains **both** turns' messages in order (turn-2 appended onto turn-1's hydrated history — only possible if hydration carried turn-1 forward). Real on-disk SQLite, no mocked store, default mock provider.

**Injector selection mechanism (nailed).** `index.ts` calls `buildInjector()` with **no argument**; `injector.ts` reads `(env ?? Bun.env)["LLM_PROVIDER"] ?? "mock"` and `registry.get(requested)`. A test selects the provider by setting `process.env.LLM_PROVIDER` **before** `startDaemon()` runs (the daemon binds the provider once at construction). This test uses **`mock`** (deterministic, network-free) — set explicitly though it is the default. (Verify the exact `buildInjector` env key + default at build before relying on it.)

- [ ] **Step 1: Write the integration test** — `packages/daemon/src/memory/memory-integration.daemon.test.ts`:

```typescript
import { test, expect, afterAll, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

let dataDir: string;
let server: ReturnType<typeof import("../index.js").startDaemon>;
let PORT: number;
const ORIGIN = "tauri://localhost";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mf01-int-"));
  process.env.AGENTIC_DATA_DIR = dataDir;
  process.env.LLM_PROVIDER = "mock"; // default production provider; set explicitly
  const { startDaemon } = await import("../index.js");
  server = startDaemon(0);
  PORT = server.port;
});
afterAll(() => server.stop(true));

function openDb() {
  return new Database(join(dataDir, "memory.sqlite"));
}

/** Drive ONE full mock turn to `done` (answer the color-picker), with optional thread_id. */
function runTurn(text: string, threadId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } });
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({
        type: "session_start", trigger: "user", text, client_session_id: "c",
        ...(threadId ? { thread_id: threadId } : {}),
      })),
    );
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data as string);
      if (m.type === "tool_call" && m.payload.tool === "show_color_picker") {
        const pick = m.payload.args.picker.palette[0];
        ws.send(JSON.stringify({
          type: "tool_result", session_id: m.session_id, call_id: m.call_id,
          payload: { tool: "show_color_picker", result: { picked: pick } },
        }));
      }
      if (m.type === "session_end") { ws.close(); resolve(); }
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}

test("turn 1 persists a thread + its messages on disk (real daemon → real SQLite, mock provider)", async () => {
  await runTurn("deploy is yeet.sh");
  const db = openDb();
  const threads = db.query("SELECT thread_id FROM threads").all() as { thread_id: string }[];
  expect(threads.length).toBe(1);
  const msgs = db
    .query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threads[0]!.thread_id) as { content: string }[];
  expect(msgs.map((m) => m.content)).toContain("deploy is yeet.sh");
  db.close();
});

test("turn 2 with the minted thread_id hydrates turn-1's messages (within-thread multi-turn, default mock path)", async () => {
  const db = openDb();
  const threadId = (db.query("SELECT thread_id FROM threads LIMIT 1").get() as { thread_id: string }).thread_id;
  const tailBefore = db
    .query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { content: string }[];
  expect(tailBefore.map((m) => m.content)).toContain("deploy is yeet.sh");
  db.close();

  await runTurn("what's the deploy?", threadId);

  // The hydration EFFECT: after turn 2 the SAME thread has BOTH turns in order —
  // turn-2 flushed ONTO turn-1's hydrated history (criterion 2, over the real path).
  const db2 = openDb();
  const all = db2
    .query("SELECT content FROM messages WHERE thread_id = ? ORDER BY turn_index")
    .all(threadId) as { content: string }[];
  db2.close();
  const contents = all.map((m) => m.content);
  expect(contents).toContain("deploy is yeet.sh"); // turn 1, carried forward
  expect(contents).toContain("what's the deploy?"); // turn 2, appended after it
  expect(contents.indexOf("deploy is yeet.sh")).toBeLessThan(contents.indexOf("what's the deploy?"));
});
```

  > Worker note: turn 2 carries `thread_id`, so `beginTurn` resolves the *existing* thread (not a mint). If turn 2 minted a new thread, `all` would contain only turn-2's message and the ordering assertion would fail — so this also guards the resolve-vs-mint branch over the real path.

- [ ] **Step 2: Run** — `bun test packages/daemon/src/memory/memory-integration.daemon.test.ts` → both PASS. (Default mock provider; real on-disk SQLite; no mocked store; no test-double provider.)

- [ ] **Step 3: Gate + commit** — full gate green; `git add packages/daemon/src/memory/memory-integration.daemon.test.ts && git commit` (`test(daemon): MF-01 real-I/O within-thread multi-turn over the DEFAULT mock daemon→SQLite path`).

---

### Task 7: forget/edit real-I/O proof + dismiss-hook real-I/O proof over the daemon-constructed store

**Files:**
- Modify: `packages/daemon/src/memory/memory-integration.daemon.test.ts` (append)

These prove criteria 3, 4, 5 over the real on-disk store the daemon created (not a fresh in-test store). Forget/edit/dismiss are daemon-internal (no wire surface in MF-01 — that's MF-05), so the test reaches them by opening the same SQLite file and applying the same WriteGate/ConsolidationHook against it. This proves the storage seam on real I/O.

- [ ] **Step 1: Append the tests**:

```typescript
import { MemoryStore } from "./store.js";
import { WriteGate, REDACTION_MARKER } from "./write-gate.js";
import { ConsolidationHook } from "./consolidation-hook.js";

test("forget hard-scrubs content on disk; message + tombstone rows remain; tail redacts", () => {
  const store = new MemoryStore({ dataDir }); // SAME on-disk DB the daemon wrote
  const gate = new WriteGate(store);
  const db = store.rawDb();
  const row = db.query("SELECT id, thread_id FROM messages WHERE content = 'deploy is yeet.sh' LIMIT 1").get() as { id: string; thread_id: string };
  gate.forget(row.id, { actor: "user", authored_by: "human" }, "test");
  const after = db.query("SELECT content FROM messages WHERE id = ?").get(row.id) as { content: string };
  expect(after.content).toBe(REDACTION_MARKER);
  expect(after.content).not.toContain("yeet.sh");
  const tomb = db.query("SELECT kind FROM mutations WHERE target_message_id = ? AND kind='tombstone'").get(row.id);
  expect(tomb).not.toBeNull();
  const stillThere = db.query("SELECT 1 FROM messages WHERE id = ?").get(row.id);
  expect(stillThere).not.toBeNull();
  expect(store.readThreadTail(row.thread_id, 50).some((m) => m.content === REDACTION_MARKER)).toBe(true);
  store.close();
});

test("edit appends a correction; original message row is unchanged in place", () => {
  const store = new MemoryStore({ dataDir });
  const gate = new WriteGate(store);
  const db = store.rawDb();
  const row = db.query("SELECT id FROM messages WHERE role='assistant' LIMIT 1").get() as { id: string };
  const before = (db.query("SELECT content FROM messages WHERE id = ?").get(row.id) as { content: string }).content;
  gate.edit(row.id, "edited reply", { actor: "user", authored_by: "human" }, "test");
  const afterOriginal = (db.query("SELECT content FROM messages WHERE id = ?").get(row.id) as { content: string }).content;
  expect(afterOriginal).toBe(before); // NOT mutated in place
  const corr = db.query("SELECT replacement_content FROM mutations WHERE target_message_id=? AND kind='correction'").get(row.id) as { replacement_content: string };
  expect(corr.replacement_content).toBe("edited reply");
  store.close();
});

test("dismiss invokes the registered consolidation-hook and flips status to dismissed", () => {
  const store = new MemoryStore({ dataDir });
  const hook = new ConsolidationHook(store);
  const calls: string[] = [];
  hook.register((tid, trig) => calls.push(`${tid}:${trig}`));
  const tid = (store.rawDb().query("SELECT thread_id FROM threads LIMIT 1").get() as { thread_id: string }).thread_id;
  hook.dismiss(tid);
  expect(calls).toEqual([`${tid}:dismiss`]);
  expect((store.rawDb().query("SELECT status FROM threads WHERE thread_id=?").get(tid) as { status: string }).status).toBe("dismissed");
  store.close();
});
```

- [ ] **Step 2: Run to verify** — `bun test packages/daemon/src/memory/memory-integration.daemon.test.ts` → all PASS.

- [ ] **Step 3: Gate + commit** — green; `git add packages/daemon/src/memory/memory-integration.daemon.test.ts && git commit` (`test(daemon): MF-01 real-I/O forget/edit/dismiss over the daemon's on-disk store`).

---

### Task 8: Real-I/O smoke-probe script (no UI; drives real daemon → store; exits 0; asserts on-disk persistence)

**Files:**
- Create: `packages/daemon/scripts/memory-smoke.ts`
- Modify: `packages/daemon/package.json` (add a `memory-smoke` script)

Mirrors the existing `scripts/test-client.ts` pattern: a real WS client against the real daemon, plus a SQLite read to assert persistence. Exits 0 on success, non-zero on failure (the isolation probe per spec §4.2).

- [ ] **Step 1: Write the probe** — `packages/daemon/scripts/memory-smoke.ts`:

```typescript
// MF-01 real-I/O smoke-probe (spec §4.2). Drives the REAL daemon → REAL SQLite
// once, asserts a thread + its messages persisted on disk, exits 0 / non-zero.
// NO mocked store, NO UI. Run: bun run memory-smoke
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const dataDir = mkdtempSync(join(tmpdir(), "mf01-smoke-"));
process.env.AGENTIC_DATA_DIR = dataDir;
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "mock";

const { startDaemon } = await import("../src/index.js");
const server = startDaemon(0);
const port = server.port;

function fail(msg: string): never {
  console.error(`[memory-smoke] FAIL: ${msg}`);
  server.stop(true);
  process.exit(1);
}

await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: "tauri://localhost" } });
  let pickerSeen = false;
  ws.addEventListener("open", () =>
    ws.send(JSON.stringify({ type: "session_start", trigger: "user", text: "smoke probe", client_session_id: "smoke" })),
  );
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data as string);
    // mock path: answer the color picker so the session reaches 'done' and flushes.
    if (m.type === "tool_call" && m.payload.tool === "show_color_picker") {
      pickerSeen = true;
      const pick = m.payload.args.picker.palette[0];
      ws.send(JSON.stringify({ type: "tool_result", session_id: m.session_id, call_id: m.call_id, payload: { tool: "show_color_picker", result: { picked: pick } } }));
    }
    if (m.type === "session_end") { ws.close(); resolve(); }
    void pickerSeen;
  });
  ws.addEventListener("error", () => reject(new Error("ws error")));
  setTimeout(() => reject(new Error("timeout")), 3000);
}).catch((e) => fail(String(e)));

// Assert on-disk persistence.
const db = new Database(join(dataDir, "memory.sqlite"));
const threads = db.query("SELECT thread_id FROM threads").all() as { thread_id: string }[];
if (threads.length < 1) fail("no thread persisted");
const msgs = db.query("SELECT content FROM messages WHERE thread_id = ?").all(threads[0]!.thread_id) as { content: string }[];
if (!msgs.some((r) => r.content.includes("smoke probe"))) fail("turn message not persisted");
db.close();

console.log(`[memory-smoke] OK: thread=${threads[0]!.thread_id} messages=${msgs.length} dir=${dataDir}`);
server.stop(true);
process.exit(0);
```

- [ ] **Step 2: Add the script to `packages/daemon/package.json`** scripts block:

```json
    "memory-smoke": "bun run scripts/memory-smoke.ts"
```

- [ ] **Step 3: Run the probe** — `cd packages/daemon && bun run memory-smoke` → prints `[memory-smoke] OK: ...` and exits 0. Verify exit code: `echo $?` → `0`.

- [ ] **Step 4: Final full-gate + commit** — `bun test && bun run typecheck && bun run lint:strict` all green (run from repo root). `git add packages/daemon/scripts/memory-smoke.ts packages/daemon/package.json && git commit` (`test(daemon): MF-01 real-I/O smoke-probe (real daemon→store, asserts on-disk persistence)`).

- [ ] **Step 5: Push + open PR** — `git push -u origin chunk/MF-01-durable-store` then `gh pr create --base main` with a body summarizing the chunk and the verification (the 7 done criteria + the smoke-probe output) and the Claude Code attribution line. Do NOT merge (Lior's gate).

---

## Done-criteria → task crosswalk (self-review against the chunk's 7 criteria)

1. envelope `session_start.thread_id` optional + tests green + union still 6 → **Task 1**.
2. real-I/O within-thread multi-turn, turn-2 input contains turn-1 messages, no mocked store → **Task 6** (proven over the **default mock provider** path the production daemon runs; the mock multi-turns via the Task-5 adapter fix, not a test double).
3. real-I/O forget = hard-scrub + tombstone row + rows remain + tail redacts → **Task 7** (+ unit in Task 3).
4. real-I/O edit = correction appended, original not in-place → **Task 7** (+ unit in Task 3).
5. dismiss invokes the consolidation-hook + `distillation_events` table present → **Task 4** (unit) + **Task 7** (real-I/O).
6. real-I/O smoke-probe: real daemon→store, exits 0, asserts on-disk persistence → **Task 8**.
7. `typecheck` + `lint:strict` + `bun test` green → run at the end of every task; final at **Task 8 Step 4**.

All seven map to a task. No spec requirement is unaddressed. **No `recording-provider`, no `injector.ts` change** — criterion 2 runs on the real default path.

---

## ADR worthy: no

ADR-0012 is accepted and the spec froze every load-bearing seam (thread↔session model §3.1, storage shape + MUTATION-AS-APPEND §3.4, the checkpoint quartet + 5b §3.3, the verification stance §4.2). The architect-time calls this plan makes — (a) `bun:sqlite` built-in (a property of the already-decided Bun runtime per ADR-0003/0004, **no new dependency**), (b) SQLite = canonical bytes / JSONL = mirror (explicitly handed to the architect by §3.4), (c) within-thread tail = REDACT not exclude (a reversible, internal read-shape detail), (d) the mock-**adapter** hydration re-attach (fills the ADR-0010 decision-5/6 `messages[]` seam; reducer byte-unchanged) — are all *fills of frozen seams*, not new load-bearing decisions. None is hard-to-reverse or surprising-given-the-spec. The frozen 6-variant union is preserved exactly (one additive optional field, no new variant). **One soft-prose nick is flagged for Lior under `## Frozen-assumption impact`** (spec §3.1 "consumes it unchanged" → "reducer-unchanged; adapter re-attaches via the reserved seam"); the architect assesses it as safe and within "append more, not a rewrite," needing no ADR. No ADR escalation required.

---

## Status: APPROVED — in implementation (Phase 2)

**Lior approved 2026-06-04 (plan-approval + freeze gate, PIPELINE §5.2).** Verdict: the adapter re-attach IS the `messages[]` seam ADR-0010 reserved (`provider.ts:5`); the reducer stays frozen (ADR-0010 decision 6 intact) → **no ADR needed**. Lior also directed the spec §3.1 prose be tightened ("provider consumes it unchanged" → "reducer-unchanged; adapter re-attaches via the reserved `messages[]` seam") — **done** in `orchestration/docs/specs/2026-06-04-memory-foundation.md` §3.1.

The approved mechanism: the within-thread-multi-turn mechanism uses a **two-line, adapter-only** change to `mock-provider.ts` (force a fresh reducer call on `session_start` while re-attaching the hydrated tail onto `messages[]`). It **honors ADR-0010's hard freeze** (the `mock-agent.ts` reducer + its tests stay byte-unchanged — Task 5 Step 5 asserts `git diff --stat` is empty). The wire (frozen 6-variant union) and all four checkpoints/seams are unchanged.

**Relevant absolute paths for the worker:**
- Plan target: `/Users/lior/WebstormProjects/playground/AgenticEngine/orchestration/docs/plans/memory-foundation/plan.md`
- Wire change: `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/protocol/src/envelope.ts`
- New module: `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/` (`schema.ts`, `store.ts`, `write-gate.ts`, `consolidation-hook.ts`, `thread-lifecycle.ts` + `*.test.ts`)
- Daemon wiring: `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/index.ts`
- Mock adapter (the one flagged change): `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/providers/mock-provider.ts` (+ `mock-provider.test.ts`)
- Reducer (frozen, MUST stay byte-unchanged): `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/mock-agent.ts`
- Integration test: `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/src/memory/memory-integration.daemon.test.ts`
- Smoke-probe: `/Users/lior/WebstormProjects/playground/AgenticEngine/packages/daemon/scripts/memory-smoke.ts`
- Frozen lines cited: ADR-0010 decision 6 (`orchestration/docs/adr/0010-pluggable-llm-provider-abstraction.md`); spec §3.1 (`orchestration/docs/specs/2026-06-04-memory-foundation.md`).
