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
    ctx: WriteContext, // MF-03 reads ctx to apply policy; MF-01 is a pass-through
  ): string[] {
    void ctx; // pass-through: MF-03 fills policy here without re-plumbing
    return this.store.appendMessages(threadId, messages, sessionId);
  }

  /** forget = appended tombstone + hard-scrub of the referenced message content. */
  forget(messageId: string, ctx: WriteContext, reason?: string): void {
    const db = this.store.rawDb();
    const now = Date.now();
    const threadId = this.threadOf(messageId);
    const tx = db.transaction(() => {
      db.query(
        "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'tombstone', ?, ?, NULL, ?, ?)",
      ).run(crypto.randomUUID(), messageId, ctx.actor, reason ?? null, ctx.authored_by, now);
      db.query("UPDATE messages SET content = ? WHERE id = ?").run(REDACTION_MARKER, messageId);
    });
    tx();
    // Rewrite the JSONL mirror so the message line's content is replaced with the
    // redaction marker. Required by plan.md §109 ("the mirror never holds plaintext
    // after a forget either") and spec §3.2 invariant 1 ("real erasure, not a soft hide").
    // This makes forget a mirror-rewrite, not purely append-only — the plan's own contract.
    this.store.redactMirrorMessage(threadId, messageId);
    // Append the redaction event line so the audit trail records that a forget occurred.
    this.store.mirrorEvent(threadId, { event: "forget", target_message_id: messageId, actor: ctx.actor, created_at: now });
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
