import type { MemoryStore } from "./store.js";
import { isMessageId } from "./store.js";
import type { SessionMessage } from "../providers/provider.js";
import { REDACTION_MARKER } from "./schema.js";
import type { MemoryScanner } from "./scanner/memory-scanner.js";
import { normalizeFactText } from "./normalize-fact-text.js";

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
    });
    tx();
    // v2-02: bump the per-thread mutation marker on the human forget path
    // (edit/forget are NOT append; they do not touch last_active_at — the marker tracks all three)
    this.store.bumpThreadMarker(threadId);
    // Rewrite the JSONL mirror so the message line's content is replaced with the
    // redaction marker. Required by plan.md §109 ("the mirror never holds plaintext
    // after a forget either") and spec §3.2 invariant 1 ("real erasure, not a soft hide").
    this.store.redactMirrorMessage(threadId, messageId);
    // Append the redaction event line so the audit trail records that a forget occurred.
    this.store.mirrorEvent(threadId, { event: "forget", target_message_id: messageId, actor: ctx.actor, created_at: now });
    // purge any live distilled_facts rows referencing the forgotten content (grill S2)
    // Both message-level provenance (DumbTail shape) and thread-level provenance (FixedMarker shape).
    this.store.dropDistilledFactsByProvenance(messageId);
    this.store.dropDistilledFactsForThread(threadId);
    // N1: any quarantine_markers row for this messageId is intentionally left — the tombstone
    // already hard-redacts the content, making the quarantine marker harmless (a dead filter
    // on a tombstoned message). Dropping it would require a new store method for ~zero benefit.
  }

  /**
   * forgetFact — forget a distilled fact by its text + provenance (chunk 04 / ADR-0015).
   *
   * New signature: (factText, provenance, ctx, reason?) — intent-based.
   * No longer receives a bare provenance as first arg; the caller provides the FACT TEXT
   * so we can key the forgotten_facts record on normalized text (the load-bearing match key).
   *
   * Three steps (SEPARATE-TABLE path — never touches messages or mutations):
   *   1. recordForgottenFact: durable entry in forgotten_facts keyed on normalizeFactText(factText)
   *   2. purgeLiveMachineFactsByForget: delete live machine rows by provenance OR normalized text
   *      (both checks ensure a re-derived fact with different provenance is still caught)
   *
   * DOES NOT call tombstoneFact — the isMessageId throw stays on the message path (ADR-0015 decision 1).
   * DOES NOT call dropDistilledFactsByProvenance/dropDistilledFactsForThread — those are message-path.
   * NO scrub of messages.content, NO mutations row (B1 structural invariant).
   *
   * 5e guard: purgeLiveMachineFactsByForget carries authored_by != 'human' guard.
   */
  forgetFact(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
    const norm = normalizeFactText(factText);
    // 1. Durable record (keyed on normalized text — the Layer-T match key)
    this.store.recordForgottenFact({
      raw_text: factText,
      provenance,
      actor: ctx.actor,
      reason,
      authored_by: ctx.authored_by,
    });
    // 2. Immediate purge of live machine rows (no-window; 5e guard is inside purgeLiveMachineFactsByForget)
    this.store.purgeLiveMachineFactsByForget(provenance, norm);
  }

  /**
   * forgetFactAndSources — fact-forget + option-B hard escape (chunk 04 / ADR-0015 decision 3).
   *
   * All-or-nothing atomicity (MINOR-1 fix): pre-validate ALL isMessageId components exist
   * BEFORE any mutation. If any component is unknown, throw WITHOUT scrubbing anything.
   * This prevents the partial-irreversible-scrub + misleading "not found" defect.
   *
   * Cannot use a DB transaction to wrap forget() because forget() also rewrites the
   * JSONL mirror (a filesystem side-effect a DB tx cannot roll back). Pre-validate instead.
   *
   * 1. Compute isMessageId components (empty for thread:<id> prefix).
   * 2. Pre-validate ALL components resolve (threadOf throws for unknown ids).
   * 3. Only then: forgetFact(...) + scrub loop.
   *    thread:<id> provenance → no specific source messages to scrub (never a whole-thread scrub).
   */
  forgetFactAndSources(factText: string, provenance: string, ctx: WriteContext, reason?: string): void {
    // Step 1: compute isMessageId components (empty for thread:<id> provenance)
    if (provenance.startsWith("thread:")) {
      // No source messages to scrub; still record the fact-forget.
      this.forgetFact(factText, provenance, ctx, reason);
      return;
    }
    const comps = provenance
      .split(",")
      .map((p) => p.trim())
      .filter((p) => isMessageId(p));

    // Step 2: pre-validate ALL components (threadOf throws for unknown ids, already 404-mapped).
    // Do this BEFORE any mutation so a failure leaves NOTHING changed.
    for (const comp of comps) {
      this.threadOf(comp); // throws if unknown — aborts before any write
    }

    // Step 3: all validated — now mutate (all-or-nothing guarantee satisfied pre-step).
    // Durable fact-forget record + live purge (no scrub of its own).
    this.forgetFact(factText, provenance, ctx, reason);
    // Option B: hard-scrub each validated component via the existing message path.
    for (const comp of comps) {
      this.forget(comp, ctx, reason); // reuse WriteGate.forget (HARD scrub)
    }
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
    // v2-02: bump the per-thread mutation marker on the human edit path
    this.store.bumpThreadMarker(threadId);
    this.store.mirrorEvent(threadId, { event: "edit", target_message_id: messageId, replacement, actor: ctx.actor, created_at: now });
    // Un-forget (ADR-0015 decision 4 — human precedence cuts both ways):
    // when a human edits a message whose replacement text normalizes to the same text as
    // a forgotten fact, clear that forgotten_facts row. This is the deliberate inverse of D6.
    // Load-bearing un-forget path: human-fact authoring (human-pin route). The message-edit
    // clear fires only when the edited content normalizes to a forgotten fact's text (rare,
    // but correct per spec §2 D-B). It is always scoped to ctx.authored_by === 'human'.
    if (ctx.authored_by === "human") {
      this.store.clearForgottenByNormalizedText(normalizeFactText(replacement));
    }
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
