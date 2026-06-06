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

CREATE TABLE IF NOT EXISTS quarantine_markers (
  id           TEXT PRIMARY KEY,
  target_id    TEXT NOT NULL,
  rule         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quarantine_target ON quarantine_markers(target_id);
`;
