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
 *
 * TWO SEPARATE FORGET ARTIFACTS (ADR-0015 decision 2 / spec §0):
 *   `mutations` (kind='tombstone') — the MESSAGE-redaction artifact. Written by
 *     WriteGate.forget; hard-scrubs messages.content. The isMessageId throw in
 *     store.tombstoneFact stays as the defensive seam guard.
 *   `forgotten_facts` — the FACT-suppression artifact. Written by WriteGate.forgetFact;
 *     keyed on normalized fact text (not a messages.id). The smart distiller's
 *     Layer-T suppression reads from this table. These two artifacts NEVER cross.
 *
 * v2-02 (spec §3.4/§3.5): adds fact_topics + fact_fts (FTS5, matched on a
 * canonical key supplied in code) + an AFTER DELETE sync trigger + the additive
 * thread_distill_state mutation-marker table + replaced_facts audit. All
 * CREATE IF NOT EXISTS — additive, no ALTER. The fact store is now a STATEFUL
 * derived store (ADR-0012 Amendment 2026-06-13).
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
  target_id    TEXT NOT NULL UNIQUE,             -- one marker per target; INSERT OR IGNORE makes repeat quarantines idempotent
  rule         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quarantine_target ON quarantine_markers(target_id);

CREATE TABLE IF NOT EXISTS forgotten_facts (
  id               TEXT PRIMARY KEY,
  normalized_text  TEXT NOT NULL,   -- normalizeFactText(raw) — the load-bearing match key (Layer-T)
  raw_text         TEXT NOT NULL,   -- what the user saw + forgot (Layer-X exclusion + display)
  provenance       TEXT,            -- as-forgotten (opportunistic Layer-P + audit)
  actor            TEXT,
  reason           TEXT,
  authored_by      TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forgotten_norm ON forgotten_facts(normalized_text);

-- ── v2-02: incremental store foundation (spec §3.4/§3.5/§3.3/§3.2) ──────────
-- Topic-tags join (one fact → many tags), keyed on the now-stable distilled_facts.id.
CREATE TABLE IF NOT EXISTS fact_topics (
  fact_id TEXT NOT NULL,
  topic   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fact_topics_fact ON fact_topics(fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_topics_topic ON fact_topics(topic);

-- FTS5 similarity layer. Match on \`canonical\` (LLM-normalized key, supplied in code at
-- insert/update — a SQL trigger cannot compute it). Display text stays in distilled_facts.fact.
-- Default unicode61 tokenizer (NOT trigram): facts are LLM-canonicalized so whole-token
-- overlap holds, and this avoids the unverified trigram-availability risk in bun:sqlite.
CREATE VIRTUAL TABLE IF NOT EXISTS fact_fts USING fts5(
  fact_id UNINDEXED,
  canonical,
  topic
);

-- The ONE structural sync point: every delete path on distilled_facts mops up BOTH
-- derived tables here, so no call site is trusted to remember (spec §3.4 D-V4d / §7.1 M2).
CREATE TRIGGER IF NOT EXISTS trg_distilled_facts_ad
AFTER DELETE ON distilled_facts
BEGIN
  DELETE FROM fact_fts WHERE fact_id = old.id;
  DELETE FROM fact_topics WHERE fact_id = old.id;
END;

-- Per-thread mutation marker (bumped on append/edit/forget — NOT last_active_at) +
-- distilled_through (the marker the distiller last covered). Additive side table, NO ALTER on threads.
CREATE TABLE IF NOT EXISTS thread_distill_state (
  thread_id         TEXT PRIMARY KEY,
  marker            INTEGER NOT NULL DEFAULT 0,
  distilled_through INTEGER NOT NULL DEFAULT 0
);

-- Durable audit of REPLACE-overwritten fact text (spec §3.2 m4 auditability).
CREATE TABLE IF NOT EXISTS replaced_facts (
  id            TEXT PRIMARY KEY,
  fact_id       TEXT NOT NULL,   -- the surviving fact id that overwrote this text
  replaced_text TEXT NOT NULL,   -- the prior display text, recoverable in History
  actor         TEXT,
  reason        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replaced_facts_fact ON replaced_facts(fact_id);
`;
