import { Database } from "bun:sqlite";
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_DDL, REDACTION_MARKER } from "./schema.js";
import type { SessionMessage } from "../providers/provider.js";
import type { DistilledFact } from "./memory-provider.js";

export interface MemoryStoreOptions {
  /** Directory for the SQLite file + the threads/ JSONL mirror. */
  dataDir: string;
}

/** Minimal input to record a quarantine marker (MF-03 5d). */
export interface QuarantineMarkerInput {
  target_id: string;
  rule: string;
}

interface TailRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tombstoned: number;
  correction: string | null;
}

export interface DistilledFactRow {
  fact: string;
  provenance: string;
  scope: string;
  expiry: number | null;
  confidence: number;
  authored_by: string;
}

export interface DistillationEventRow {
  facts_produced: number;
  trigger: string;
  distiller_version: string;
}

export interface MessageForDistillRow {
  id: string;
  role: string;
  content: string;
}

/**
 * Returns true if `s` is UUID-shaped (the format used for messages.id).
 * Used by WriteGate and MemoryStore to enforce the seam invariant:
 * forgetFact / tombstoneFact must never receive a messages.id — callers
 * must use forget() to tombstone+scrub a message (the two operations must
 * always travel together).
 */
export function isMessageId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
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

  /** Tombstone-honoring within-thread tail (REDACT): tombstone ⇒ marker; correction ⇒ replacement.
   * MF-03 5e: "latest HUMAN correction wins, else latest correction" — a machine correction
   * can never silently clobber a human's edited content.
   *
   * IMPORTANT — this COALESCE is NOT a second line of defense for role='user' rows.
   * When no human correction row exists, it falls through to "latest any correction",
   * so any machine correction that reached the mutations table WOULD surface.
   * The 5e guarantee for role='user' entries rests entirely on WriteGate.edit/forget
   * being the SOLE mutations writer and its isHumanAuthored() check refusing machine
   * writes. Any future code adding a second mutations writer MUST replicate that check
   * or it silently reopens the 5e hole. Ref: MF-03 §5e, ADR-0012 decision 5e. */
  readThreadTail(threadId: string, limit: number): SessionMessage[] {
    const rows = this.db
      .query(
        `SELECT m.id AS id, m.role AS role, m.content AS content,
                MAX(CASE WHEN x.kind = 'tombstone' THEN 1 ELSE 0 END) AS tombstoned,
                COALESCE(
                  (SELECT replacement_content FROM mutations
                     WHERE target_message_id = m.id AND kind = 'correction' AND authored_by = 'human'
                     ORDER BY created_at DESC LIMIT 1),
                  (SELECT replacement_content FROM mutations
                     WHERE target_message_id = m.id AND kind = 'correction'
                     ORDER BY created_at DESC LIMIT 1)
                ) AS correction
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

  // ---- MF-02: distilled_facts + distillation_events SQL methods ----

  /** INSERT each DistilledFact into distilled_facts with derived_at = now. */
  insertDistilledFacts(facts: DistilledFact[], distillerVersion: string): void {
    const insert = this.db.query(
      "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const tx = this.db.transaction(() => {
      for (const f of facts) {
        insert.run(crypto.randomUUID(), f.fact, f.provenance, f.scope, f.expiry ?? null, f.confidence, f.authored_by, Date.now(), distillerVersion);
      }
    });
    tx();
  }

  /** SELECT all distilled_facts ordered by derived_at DESC, limited to `limit` rows. */
  readDistilledFacts(limit: number): DistilledFactRow[] {
    return this.db
      .query("SELECT fact, provenance, scope, expiry, confidence, authored_by FROM distilled_facts ORDER BY derived_at DESC LIMIT ?")
      .all(limit) as DistilledFactRow[];
  }

  /**
   * MF-04 (5f, spec §3.3; ADR-0012 decision 5f). Scope-filtered projection read —
   * the thread-isolation enforcement point. A fact is injectable into `forThreadId` iff:
   *   scope IN ('cross-thread','global')                              -- shared facts cross
   *   OR (scope = 'thread-local' AND originThread(fact) = forThreadId) -- private stays home
   * originThread is derived from provenance with NO new column (frozen write-path):
   *   - message-level provenance (a messages.id): JOIN messages → thread_id
   *   - thread-level provenance ('thread:<id>'): substr after the prefix
   * NULL/unknown scope defaults to cross-thread (the v0 reality; never throws).
   * `readDistilledFacts` (all-rows) is intentionally kept for swap-proof / non-injection callers.
   */
  readDistilledFactsForThread(forThreadId: string, limit: number): DistilledFactRow[] {
    return this.db
      .query(
        `SELECT df.fact AS fact, df.provenance AS provenance, df.scope AS scope,
                df.expiry AS expiry, df.confidence AS confidence, df.authored_by AS authored_by
         FROM distilled_facts df
         LEFT JOIN messages m ON m.id = df.provenance
         WHERE
           COALESCE(df.scope, 'cross-thread') IN ('cross-thread', 'global')
           OR (
             df.scope = 'thread-local'
             AND (
               m.thread_id = ?
               OR (df.provenance LIKE 'thread:%' AND substr(df.provenance, 8) = ?)
             )
           )
         ORDER BY df.derived_at DESC
         LIMIT ?`,
      )
      .all(forThreadId, forThreadId, limit) as DistilledFactRow[];
  }

  /** Returns true if a tombstone mutation exists for the given messageId. */
  isMessageTombstoned(messageId: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM mutations WHERE target_message_id = ? AND kind = 'tombstone'")
      .get(messageId);
    return row !== null;
  }

  /**
   * Append a fact-level tombstone to the mutations table (MF-05 T1.2, projection-tombstone).
   * target_message_id accepts TEXT — message UUIDs AND thread-level provenance strings
   * ("thread:<uuid>") are both valid. This is a strict superset of isMessageTombstoned.
   *
   * 5e guard: a machine-authored tombstone is refused if the targeted distilled fact
   * is `authored_by:'human'`. Returns false if the operation was refused.
   *
   * NOTE: `mutations.target_message_id` has a REFERENCES messages(id) FK in the DDL.
   * Thread-level provenance ("thread:<uuid>") is NOT a messages.id — SQLite's FK
   * enforcement is OFF by default (PRAGMA foreign_keys = OFF), so this write succeeds
   * without a schema migration. The FK is advisory in v0; this is the accepted trade-off
   * per the projection-tombstone design (plan §62-71).
   */
  tombstoneFact(provenance: string, ctx: { actor: string; authored_by: "human" | "machine" }, reason?: string): boolean {
    // Seam invariant: tombstoneFact is for distilled-fact provenances ONLY.
    // If the caller passes a UUID-shaped string (a messages.id), they must use
    // WriteGate.forget() instead — forget() performs BOTH the tombstone AND the
    // content hard-scrub atomically. Accepting a UUID here would write a tombstone
    // row keyed on a real messages.id WITHOUT scrubbing messages.content → the view
    // says "forgotten" but plaintext remains on disk (security invariant breach).
    if (isMessageId(provenance)) {
      throw new Error(
        `[MemoryStore] tombstoneFact received a UUID-shaped provenance ("${provenance}"). ` +
        `Use forget() to tombstone+scrub a message; forgetFact is for distilled-fact provenances only (e.g. "thread:<uuid>").`,
      );
    }
    // 5e guard: refuse machine-tombstone of a human-authored distilled fact
    if (ctx.authored_by === "machine") {
      const factRow = this.db
        .query("SELECT authored_by FROM distilled_facts WHERE provenance = ? AND authored_by = 'human' LIMIT 1")
        .get(provenance) as { authored_by: string } | null;
      if (factRow !== null) {
        return false; // refused — human-authored fact survives machine tombstone
      }
    }
    this.db
      .query(
        "INSERT INTO mutations (id, target_message_id, kind, actor, reason, replacement_content, authored_by, created_at) VALUES (?, ?, 'tombstone', ?, ?, NULL, ?, ?)",
      )
      .run(crypto.randomUUID(), provenance, ctx.actor, reason ?? null, ctx.authored_by, Date.now());
    return true;
  }

  /**
   * Returns true if a tombstone mutation exists for the given provenance string.
   * Generalizes isMessageTombstoned: message-id UUIDs are a subset.
   * Thread-level provenance ("thread:<uuid>") is also checked here (MF-05 T1.2).
   */
  isFactTombstoned(provenance: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM mutations WHERE target_message_id = ? AND kind = 'tombstone'")
      .get(provenance);
    return row !== null;
  }

  // ---- MF-03: quarantine markers (5d mechanism — distiller skip-filter) ----

  /** Record a minimal quarantine marker so the distiller can skip a flagged message
   *  at distill time (a later thread-dismiss). The marker is the MECHANISM the
   *  skip-filter needs for cross-time durability — not an MF-05 audit feed (Q2-minimal).
   *  INSERT OR IGNORE makes repeat quarantines idempotent: the UNIQUE(target_id) constraint
   *  in the DDL means a second scan of the same message/provenance is silently dropped,
   *  preventing unbounded row growth on repeated dismiss cycles. */
  recordQuarantine(e: QuarantineMarkerInput): void {
    this.db
      .query("INSERT OR IGNORE INTO quarantine_markers (id, target_id, rule, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), e.target_id, e.rule, Date.now());
  }

  /** Returns true if a quarantine marker exists for the given messageId.
   *  Used by the distiller to skip quarantined messages, exactly as tombstoned ones are skipped. */
  isMessageQuarantined(messageId: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM quarantine_markers WHERE target_id = ? LIMIT 1")
      .get(messageId);
    return row !== null;
  }

  /** Returns all quarantine markers ordered by created_at ASC.
   *  Minimal read — used by the DoD#1 assertion and nothing else in v0. */
  readQuarantineMarkers(): { target_id: string; rule: string }[] {
    return this.db
      .query("SELECT target_id, rule FROM quarantine_markers ORDER BY created_at ASC")
      .all() as { target_id: string; rule: string }[];
  }

  /** DELETE distilled_facts rows by exact provenance match; returns changed row count.
   * MF-03 5e guard: never deletes a human-authored distilled fact. */
  dropDistilledFactsByProvenance(provenance: string): number {
    const result = this.db.query("DELETE FROM distilled_facts WHERE provenance = ? AND authored_by != 'human' RETURNING id").all(provenance);
    return result.length;
  }

  /** DELETE distilled_facts rows with provenance "thread:<threadId>"; returns changed count.
   * MF-03 5e guard: never deletes a human-authored distilled fact. */
  dropDistilledFactsForThread(threadId: string): number {
    const provenance = `thread:${threadId}`;
    const result = this.db.query("DELETE FROM distilled_facts WHERE provenance = ? AND authored_by != 'human' RETURNING id").all(provenance);
    return result.length;
  }

  /** DELETE all rows from distilled_facts (used for swap-proof test / machine rebuild).
   * MF-03 5e guard: never deletes a human-authored distilled fact — human-pinned facts
   * survive a full machine re-derive cycle. */
  dropAllDistilledFacts(): void {
    this.db.query("DELETE FROM distilled_facts WHERE authored_by != 'human'").run();
  }

  /** INSERT a distillation event row into distillation_events. */
  insertDistillationEvent(threadId: string, trigger: string, factsProduced: number, distillerVersion: string): void {
    this.db
      .query(
        "INSERT INTO distillation_events (id, thread_id, trigger, facts_produced, distiller_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(crypto.randomUUID(), threadId, trigger, factsProduced, distillerVersion, Date.now());
  }

  /** SELECT distillation_events for a thread, ordered by created_at ASC. */
  readDistillationEvents(threadId: string): DistillationEventRow[] {
    return this.db
      .query("SELECT facts_produced, trigger, distiller_version FROM distillation_events WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId) as DistillationEventRow[];
  }

  /**
   * Full archive read for a thread — returns ALL messages, ordered by turn_index ASC.
   * Honors tombstones (tombstoned rows surface as REDACTION_MARKER) and the same
   * "latest HUMAN correction wins, else latest correction" COALESCE as readThreadTail.
   * Used by Hatch.view (MF-05 T1.1) — additive SELECT only, no write-path change.
   *
   * IMPORTANT — same 5e caveat as readThreadTail: the COALESCE is NOT a second line of
   * defense; the guarantee rests entirely on WriteGate being the SOLE mutations writer.
   */
  readThreadArchive(threadId: string): { id: string; role: string; content: string }[] {
    const rows = this.db
      .query(
        `SELECT m.id AS id, m.role AS role, m.content AS content,
                MAX(CASE WHEN x.kind = 'tombstone' THEN 1 ELSE 0 END) AS tombstoned,
                COALESCE(
                  (SELECT replacement_content FROM mutations
                     WHERE target_message_id = m.id AND kind = 'correction' AND authored_by = 'human'
                     ORDER BY created_at DESC LIMIT 1),
                  (SELECT replacement_content FROM mutations
                     WHERE target_message_id = m.id AND kind = 'correction'
                     ORDER BY created_at DESC LIMIT 1)
                ) AS correction
         FROM messages m
         LEFT JOIN mutations x ON x.target_message_id = m.id
         WHERE m.thread_id = ?
         GROUP BY m.id
         ORDER BY m.turn_index ASC`,
      )
      .all(threadId) as TailRow[];
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.tombstoned ? REDACTION_MARKER : (r.correction ?? r.content),
    }));
  }

  /**
   * Like readThreadTail but returns message `id` field and honors tombstones
   * (redacts content to REDACTION_MARKER rather than omitting the row).
   * DumbTailProvider uses `id` for provenance and filters redacted rows itself.
   * MF-03 5e: same "latest HUMAN correction wins, else latest correction" precedence
   * as readThreadTail — the distiller sees the same human-wins content the tail does.
   *
   * IMPORTANT — same caveat as readThreadTail: this COALESCE is NOT a second line of
   * defense for role='user' rows. The 5e guarantee depends entirely on WriteGate being
   * the SOLE mutations writer and isHumanAuthored() refusing machine writes. Any future
   * second writer MUST replicate that check or it silently reopens the 5e hole.
   * Ref: MF-03 §5e, ADR-0012 decision 5e. */
  readThreadMessagesForDistill(threadId: string): MessageForDistillRow[] {
    const rows = this.db
      .query(
        `SELECT m.id AS id, m.role AS role, m.content AS content,
                MAX(CASE WHEN x.kind = 'tombstone' THEN 1 ELSE 0 END) AS tombstoned,
                COALESCE(
                  (SELECT replacement_content FROM mutations
                     WHERE target_message_id = m.id AND kind = 'correction' AND authored_by = 'human'
                     ORDER BY created_at DESC LIMIT 1),
                  (SELECT replacement_content FROM mutations
                     WHERE target_message_id = m.id AND kind = 'correction'
                     ORDER BY created_at DESC LIMIT 1)
                ) AS correction
         FROM messages m
         LEFT JOIN mutations x ON x.target_message_id = m.id
         WHERE m.thread_id = ?
         GROUP BY m.id
         ORDER BY m.turn_index ASC`,
      )
      .all(threadId) as TailRow[];
    return rows.map((r) => ({
      id: r.id,
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

  /**
   * Rewrite the per-thread JSONL mirror so the message line for `messageId`
   * has its `content` replaced by REDACTION_MARKER.
   *
   * Called by WriteGate.forget() to enforce ARCHIVE-AS-TRUTH / spec §3.2
   * invariant 1: "the mirror never holds plaintext after a forget either."
   * This makes forget a rewrite (not purely append-only) for the mirror —
   * required by the plan's own contract, not a new design decision.
   */
  redactMirrorMessage(threadId: string, messageId: string): void {
    const mirrorPath = join(this.threadsDir, `${threadId}.jsonl`);
    if (!existsSync(mirrorPath)) return;
    const lines = readFileSync(mirrorPath, "utf8").split("\n");
    const rewritten = lines.map((line) => {
      if (!line) return line; // preserve trailing newline's empty string
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return line; // unparseable line — leave intact
      }
      if (parsed["event"] === "message" && parsed["id"] === messageId) {
        return JSON.stringify({ ...parsed, content: REDACTION_MARKER });
      }
      return line;
    });
    writeFileSync(mirrorPath, rewritten.join("\n"));
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
