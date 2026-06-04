import { Database } from "bun:sqlite";
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
