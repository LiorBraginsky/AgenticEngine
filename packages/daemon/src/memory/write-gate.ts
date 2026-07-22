import type { MemoryStore } from "./store.js";
import type { SessionMessage } from "../providers/provider.js";
import { REDACTION_MARKER } from "./schema.js";
import type { MemoryScanner } from "./scanner/memory-scanner.js";
import { normalizeFactText } from "./normalize-fact-text.js";
import { memDebug } from "./debug-log.js";

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
 * Typed result for `WriteGate.forgetThread` (thread-forget 2e, spec §3.1). Never-throw
 * for caller-input cases (gotcha #9); internal faults (disk/DB errors) still propagate
 * as throws.
 */
export type ForgetThreadResult =
  | { ok: true } // applied — incl. idempotent repeat
  | { ok: false; reason: "not_found" } // unknown thread → route maps 404
  | { ok: false; reason: "refused_machine" }; // machine ctx → human-only by construction

/**
 * WRITE-GATE (spec §3.3) — the SINGLE function every memory write flows through.
 * MF-03 fills two policies at the TOP of each method:
 *   5d scan: each message scanned at appendTurn; flagged messages are STILL
 *            archived (ARCHIVE-AS-TRUTH) but marked quarantined so the distiller
 *            skips them — they never reach an injected slice (#31).
 *   5e no-overwrite: a machine edit/forget of a human-authored entry is refused
 *            — appends a competing machine note (edit) or is a no-op (forget).
 *            Behavioral only; no audit row (Q2-minimal).
 */
export class WriteGate {
  constructor(
    private readonly store: MemoryStore,
    private readonly scanner: MemoryScanner,
  ) {}

  /**
   * Append a completed turn's messages to the durable thread. Returns message ids.
   * 5d: each message is scanned; a flagged message is STILL archived
   * (ARCHIVE-AS-TRUTH — never silently drop the user's words) but a minimal
   * quarantine marker is recorded, so the distiller skips it
   * (isMessageQuarantined) and it can never reach an injected slice (#31).
   */
  appendTurn(
    threadId: string,
    messages: SessionMessage[],
    sessionId: string,
    ctx: WriteContext,
  ): string[] {
    const ids = this.store.appendMessages(threadId, messages, sessionId);
    messages.forEach((m, i) => {
      // No `scope` is passed here — messages (turns) have no scope concept.
      // The `scope-escalation` rule (machine write claiming global scope) is enforced
      // at the distillation layer (distiller-registration.ts), where distilled_facts
      // carry an explicit scope field. It cannot and should not fire at turn-append.
      const verdict = this.scanner.scan({ content: m.content, authored_by: ctx.authored_by });
      if (!verdict.ok) {
        this.store.recordQuarantine({ target_id: ids[i]!, rule: verdict.rule });
      }
    });
    return ids;
  }

  /**
   * forget = appended tombstone + hard-scrub of the referenced message content.
   * 5e: a machine forget of a human-authored entry is refused — no scrub, no
   * tombstone. Human content survives byte-intact. Behavioral only — no audit
   * row (Q2-minimal). A human forget is always applied.
   */
  forget(messageId: string, ctx: WriteContext, reason?: string): void {
    const db = this.store.rawDb();
    const now = Date.now();
    const threadId = this.threadOf(messageId);
    // 5e guard: machine cannot clobber a human-authored entry
    if (ctx.authored_by === "machine" && this.isHumanAuthored(messageId)) {
      return; // refused — human content survives byte-intact; no scrub, no record
    }
    const tx = db.transaction(() => {
      db.query(
        "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'tombstone', ?, ?, NULL, ?, ?)",
      ).run(crypto.randomUUID(), messageId, ctx.actor, reason ?? null, ctx.authored_by, now);
      db.query("UPDATE messages SET content = ? WHERE id = ?").run(REDACTION_MARKER, messageId);
      // hybrid-retrieval chunk-03 (spec §0.3/§3.3): scrubbed content must be unreachable by
      // BOTH the vector leg AND the archive-lexical leg, atomically with the scrub itself —
      // deleteMessageDerived has no own tx (Task 4), so it commits together with the two
      // writes above. This is also HALF of the scrub-race guard: the other half is the
      // in-tx re-check inside upsertMessageEmbedding (store.ts) that refuses a late write
      // landing after this tx already committed.
      this.store.deleteMessageDerived(messageId);
    });
    tx();
    // v2-02: bump the per-thread mutation marker — applied forget path (human, or machine-over-machine;
    // the early return above blocks machine-over-human only) — mutation marker for v2-03's skip decision
    // (edit/forget are NOT append; they do not touch last_active_at — the marker tracks all three)
    this.store.bumpThreadMarker(threadId);
    // Rewrite the JSONL mirror so the message line's content is replaced with the
    // redaction marker. Required by plan.md §109 ("the mirror never holds plaintext
    // after a forget either") and spec §3.2 invariant 1 ("real erasure, not a soft hide").
    this.store.redactMirrorMessage(threadId, messageId);
    // Append the redaction event line so the audit trail records that a forget occurred.
    this.store.mirrorEvent(threadId, { event: "forget", target_message_id: messageId, actor: ctx.actor, created_at: now });
    // N1: any quarantine_markers row for this messageId is intentionally left — the tombstone
    // already hard-redacts the content, making the quarantine marker harmless (a dead filter
    // on a tombstoned message). Dropping it would require a new store method for ~zero benefit.
  }

  /**
   * forgetThread — content-erase a WHOLE conversation in ONE atomic tx (spec §3.1).
   * ZERO fact-table touches (ADR-0012 rider Ruling 2 — facts are source-independent;
   * structural, like ADR-0015 B1). NO bumpThreadMarker (§3.1 [critic m5] — 'forgotten'
   * is terminal). Human-only by construction (defense-in-depth mirror of editFact's
   * machine-ctx refusal). Idempotent: already-tombstoned messages are
   * skipped; a second call is a no-op that still returns { ok: true }.
   */
  forgetThread(threadId: string, ctx: WriteContext, reason?: string): ForgetThreadResult {
    if (ctx.authored_by === "machine") return { ok: false, reason: "refused_machine" };
    if (!this.store.threadExists(threadId)) return { ok: false, reason: "not_found" };
    const db = this.store.rawDb();
    const now = Date.now();
    const tx = db.transaction(() => {
      // not-yet-tombstoned messages only (idempotence)
      const rows = db.query(
        `SELECT m.id AS id FROM messages m
          WHERE m.thread_id = ?
            AND NOT EXISTS (SELECT 1 FROM mutations x WHERE x.target_message_id = m.id AND x.kind = 'tombstone')`,
      ).all(threadId) as { id: string }[];
      const insTomb = db.query(
        "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'tombstone', ?, ?, NULL, ?, ?)",
      );
      const scrub = db.query("UPDATE messages SET content = ? WHERE id = ?");
      for (const { id } of rows) {
        insTomb.run(crypto.randomUUID(), id, ctx.actor, reason ?? null, ctx.authored_by, now);
        scrub.run(REDACTION_MARKER, id);
        // tx-less by design — see MemoryStore.deleteMessageDerived (commits with THIS tx; no nested tx; bun:sqlite forbids it)
        this.store.deleteMessageDerived(id);
      }
      // husk (q#019 rider 1): status flip + defensive title scrub (no future content-derived title survives)
      db.query("UPDATE threads SET status = 'forgotten', title = NULL WHERE thread_id = ?").run(threadId);
      // §0.4 audit-trail scrub (rows KEPT — action/outcome/actor/timestamps survive)
      db.query("UPDATE memory_action_events SET fact_text = ? WHERE thread_id = ?").run(REDACTION_MARKER, threadId);
      // [critic MAJOR-2] legacy correction-plaintext scrub (COALESCE read would resurface it)
      db.query(
        `UPDATE mutations SET replacement_content = ?
          WHERE kind = 'correction'
            AND target_message_id IN (SELECT id FROM messages WHERE thread_id = ?)`,
      ).run(REDACTION_MARKER, threadId);
    });
    tx(); // ATOMIC-ERASE INVARIANT: all writes above commit together or not at all
    // DB-first ordering (write-gate.ts:107-112): mirror is the sole post-tx step (§3.1a crash window accepted)
    this.store.redactMirrorThread(threadId);
    this.store.mirrorEvent(threadId, { event: "thread_forget", actor: ctx.actor, created_at: now });
    return { ok: true };
  }

  /**
   * forgetFact — durable delete of a distilled fact by its text + provenance (v2-04).
   *
   * v2-04 rewrite: durable delete via deleteMachineFactsByForget; the AFTER DELETE trigger
   * cleans fact_fts + fact_topics. No forgotten_facts write on this path (Ruling 1-b).
   * B1 untouched: no scrub of messages.content, no mutations row.
   *
   * Under incremental + stable-id + watermark, a durably-deleted fact is NOT re-derived on
   * a normal dismiss, so THIS HTTP path still has no need to write forgotten_facts (Ruling
   * 1-b, unchanged). The table itself is NOT dormant in 2c, though: MemoryActionPort.forget
   * (the tool path) DOES record a row on every applied tool-forget, and the D6b delta-apply
   * consult (distiller-registration.ts) reads it to suppress re-derivation there — LIVE again
   * via that path, just not via this one.
   *
   * DOES NOT call tombstoneFact — the isMessageId throw stays on the message path (ADR-0015 decision 1).
   * 5e guard: deleteMachineFactsByForget carries authored_by != 'human' guard.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ctx and reason are positional (Hatch calls with all 4 args); argsIgnorePattern not configured
  forgetFact(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
    const norm = normalizeFactText(factText);
    // Durable delete via trigger-backed deleteFactById loop (5e guard inside)
    this.store.deleteMachineFactsByForget(provenance, norm);
    // ── D1 forget log (env-gated, zero-cost when OFF) ─────────────────────────
    memDebug("forget", {
      route: "forgetFact",
      target: { provenance, normalizedText: norm },
      deletedIds: [],
      deletedCount: 0, // deleteMachineFactsByForget does not return ids/count — conservative log
    });
  }

  /**
   * forgetFactById — v2-06 C-fix: the precise forget intent (ADR-0015 decision-1 intent dispatch).
   *
   * Deletes exactly the stable-id row; NEVER scrubs messages (B1). The HTTP path is
   * human-ctx, so a human deleting a human pin is allowed; the machine-ctx refusal is
   * the 2c (5e) seam.
   *
   * REFINE (Lior): forget-by-id NOW; finer message-level provenance is DEFERRED to the
   * future THREAD-forget.
   *
   * The text/provenance forgetFact primitive above survives for its unit tests but has NO caller
   * route post-v2-07 (the over-deleting HTTP fallback was removed; it over-deleted all facts
   * sharing a thread provenance — store.deleteMachineFactsByForget).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reason kept for API symmetry with forgetFact; argsIgnorePattern not configured
  forgetFactById(factId: string, ctx: WriteContext, reason?: string): void {
    // Resolve the row to check authored_by (5e seam)
    const db = this.store.rawDb();
    const row = db.query("SELECT authored_by FROM distilled_facts WHERE id = ?").get(factId) as { authored_by: string } | null;
    if (!row) {
      // Idempotent: unknown id is a no-op
      memDebug("forget", {
        route: "forgetFactById",
        target: { factId },
        deletedIds: [],
        deletedCount: 0,
      });
      return;
    }
    // 5e seam: machine ctx must not delete a human-authored row
    if (row.authored_by === "human" && ctx.authored_by === "machine") {
      memDebug("forget", {
        route: "forgetFactById",
        target: { factId },
        deletedIds: [],
        deletedCount: 0,
        refused: "5e-machine-vs-human",
      });
      return;
    }
    this.store.deleteFactById(factId);
    // ── D1 forget log (env-gated, zero-cost when OFF) ─────────────────────────
    memDebug("forget", {
      route: "forgetFactById",
      target: { factId },
      deletedIds: [factId],
      deletedCount: 1,
    });
  }

  /**
   * editFact — human correction of a distilled fact's TEXT (chunk-05 FACT-EDIT; ADR-0012 5a).
   *
   * Delegates to store.editFactById: updates the text in place (id stable) + stamps
   * authored_by='human' so the fact is 5e-protected against future machine re-derivation
   * (distiller-registration Q5 step 3 never-replace-human demote + factExistsByDedupKey suppress).
   * NEVER scrubs messages, NEVER writes a tombstone (B1 — the fact path never touches messages/mutations).
   *
   * 5e seam (mirrors forgetFactById): a MACHINE ctx must not overwrite a human-authored fact → no-op.
   * The HTTP path is human-ctx (HTTP_CTX), so this refusal never fires there; it reserves the 2c
   * (agent memory-action) seam. A human editing any fact (human OR machine) is always applied.
   * Returns true iff applied (false = id absent OR a machine-over-human refusal → the route maps to 404).
   */
  editFact(factId: string, newText: string, ctx: WriteContext, reason?: string): boolean {
    const db = this.store.rawDb();
    const row = db.query("SELECT authored_by FROM distilled_facts WHERE id = ?").get(factId) as { authored_by: string } | null;
    if (!row) return false;
    // Defense-in-depth (spec §3.2 D2d, 2c chunk-01): reject ANY machine ctx outright, before
    // delegating. store.editFactById's stamp is unconditionally 'human' — a machine-over-MACHINE
    // ctx would otherwise promote a machine fact to 5e-protected human-owned (inverting
    // never-replace-human), the 5e jackpot. This never fires on the HTTP path (human-ctx only);
    // it closes the seam ahead of the agent memory-action port being wired through this method.
    if (ctx.authored_by === "machine") return false;
    const applied = this.store.editFactById(factId, newText, { actor: ctx.actor, reason });
    // D6c (human un-forget leg, spec §3.6): a human authoring/editing a fact whose normalized
    // text matches a forgotten_facts row clears that row — the explicit human re-assertion
    // beats a stale forget-suppression record (precedence: human ▷ un-forget ▷ forget-record).
    if (applied) this.store.clearForgottenByNormalizedText(normalizeFactText(newText), normalizeFactText(newText));
    return applied;
  }

  /**
   * edit = appended correction record referencing the original (never in-place).
   * 5e: a machine edit of a human-authored entry is refused as a clobber —
   * appended as a competing, low-precedence machine note instead (MUTATION-AS-
   * APPEND). The store's "latest HUMAN correction wins, else latest correction"
   * precedence means the human's content still surfaces. No audit row (Q2-minimal).
   * A human edit is always applied.
   */
  edit(messageId: string, replacement: string, ctx: WriteContext, reason?: string): void {
    const db = this.store.rawDb();
    const now = Date.now();
    // B1: validate existence BEFORE any INSERT — threadOf throws for unknown ids,
    // preventing an orphaned mutations row with a dangling target_message_id FK.
    const threadId = this.threadOf(messageId);
    // 5e guard: machine edit of human entry → no-op (human content survives
    // byte-intact). Q2-minimal: no competing row is written; the un-changed
    // original is the behavioral proof. A human edit is always applied.
    if (ctx.authored_by === "machine" && this.isHumanAuthored(messageId)) {
      return;
    }
    db.query(
      "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'correction', ?, ?, ?, ?, ?)",
    ).run(crypto.randomUUID(), messageId, ctx.actor, reason ?? null, replacement, ctx.authored_by, now);
    // v2-02: bump the per-thread mutation marker — applied edit path (human, or machine-over-machine;
    // the early return above blocks machine-over-human only) — mutation marker for v2-03's skip decision
    this.store.bumpThreadMarker(threadId);
    this.store.mirrorEvent(threadId, { event: "edit", target_message_id: messageId, replacement, actor: ctx.actor, created_at: now });
    // Un-forget block REMOVED (v2-04): the durable-delete path no longer writes forgotten_facts
    // on a fact-forget, so there is no per-dismiss suppression record to clear.
    // clearForgottenByNormalizedText is retained as dormant v2-05 optional ordered-replay Layer-T
    // substrate (no live per-dismiss consumer).
  }

  /**
   * A message is human-authored if its archive role is 'user' (a human turn)
   * OR a human correction already exists for it (human has edited this entry).
   * 5e keys off role (not the authored_by scan context) because the Q1 fix
   * in ThreadLifecycle.endTurn now stamps per-message, but role is the durable
   * truth in the archive.
   *
   * THIS is the load-bearing 5e enforcement point. The COALESCE precedence in
   * store.ts readThreadTail/readThreadMessagesForDistill is NOT a second line of
   * defense — when no human correction row exists it falls through to any machine
   * correction. The full 5e guarantee rests on this check being the SOLE gatekeeper
   * for the mutations table. Any future mutations writer MUST replicate this guard
   * or it silently reopens the 5e hole. Ref: MF-03 §5e, ADR-0012 decision 5e.
   */
  private isHumanAuthored(messageId: string): boolean {
    const db = this.store.rawDb();
    const msg = db.query("SELECT role FROM messages WHERE id = ?").get(messageId) as { role: string } | null;
    if (msg?.role === "user") return true;
    const human = db.query("SELECT 1 FROM mutations WHERE target_message_id = ? AND authored_by = 'human' LIMIT 1").get(messageId);
    return human !== null;
  }

  private threadOf(messageId: string): string {
    const row = this.store.rawDb().query("SELECT thread_id FROM messages WHERE id = ?").get(messageId);
    if (!row) throw new Error(`[WriteGate] message ${messageId} not found — cannot determine thread`);
    return (row as { thread_id: string }).thread_id;
  }
}
