import { Database } from "bun:sqlite";
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_DDL, REDACTION_MARKER } from "./schema.js";
import type { SessionMessage } from "../providers/provider.js";
import type { DistilledFact } from "./memory-provider.js";
import { normalizeFactText, dedupConnectorKey } from "./normalize-fact-text.js";

export interface MemoryStoreOptions {
  /** Directory for the SQLite file + the threads/ JSONL mirror. */
  dataDir: string;
}

/** Named build-time constants (spec §9 — dogfood scale). */
export const CANDIDATE_TOP_K = 10;
export const APPEND_LIST_CAP = 8;

/** Input to insert one fact + its derived FTS/topic rows (v2-02). `canonical` and
 * `topics` are SUPPLIED by the caller (v2-03 distiller) — the store stores+matches,
 * never computes them. */
export interface InsertFactInput {
  fact: string;            // user-language display text
  canonical: string;       // LLM-normalized match key (→ fact_fts)
  provenance: string;
  scope: "thread-local" | "cross-thread" | "global";
  expiry: number | null;
  confidence: number;
  authored_by: "human" | "machine";
  topics: string[];
}

export interface UpdateFactInput {
  fact: string;
  canonical: string;
  confidence: number;
  topics: string[];
}

export interface ReplacedFactRow {
  replaced_text: string;
  actor: string | null;
  reason: string | null;
  created_at: number;
}

export interface FactCandidate {
  id: string;        // the stable distilled_facts.id
  fact: string;      // user-language display text (from distilled_facts)
  topics: string[];  // the fact's tags (from fact_topics)
}

export interface ThreadDistillState {
  marker: number;
  distilled_through: number;
  distilled_through_turn: number;
}

/** Minimal input to record a quarantine marker (MF-03 5d). */
export interface QuarantineMarkerInput {
  target_id: string;
  rule: string;
}

/** Minimal input to record a forgotten fact (chunk 04 — ADR-0015 decision 2). */
export interface ForgottenFactInput {
  raw_text: string;
  provenance: string | null;
  actor: string;
  reason?: string;
  authored_by: "human" | "machine";
}

/** Row returned by readForgottenFacts — the suppression layer's read surface. */
export interface ForgottenFactRow {
  normalized_text: string;
  raw_text: string;
  provenance: string | null;
}

interface TailRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tombstoned: number;
  correction: string | null;
}

export interface DistilledFactRow {
  /** Stable uuid for this fact row — used by forgetFactById (v2-06 C-fix). */
  id: string;
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
  created_at: number;
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

/**
 * Returns true if `s` is UUID-shaped — the validation gate for client-minted
 * thread-id adoption (CM-01, spec §3.3). A non-UUID-shaped thread_id is NOT
 * adopted (gotcha #9 discipline: no garbage durable keys). Same regex as
 * isMessageId; named distinctly so the thread-adoption intent is explicit and
 * not coupled to the messages.id seam invariant.
 */
export function isUuidShaped(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Turn arbitrary caller text into a safe FTS5 MATCH expression: lowercase, strip
 * everything but word chars + spaces, drop empties, quote each token, OR-join.
 * "deployment: the (script)?" → '"deployment" OR "the" OR "script"'. Returns ""
 * when no usable token survives (caller treats "" as "no candidates").
 */
export function toFtsOrQuery(raw: string): string {
  const tokens = raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
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

  /**
   * Mint a new durable thread. `adoptId` (CM-01, spec §3.3): when the overlay
   * supplied a client-minted, UUID-shaped, unknown thread_id, the caller passes
   * it here so the new thread is created WITH that id (the daemon "adopts" it).
   * Absent ⇒ the daemon mints a fresh UUID (MF-01 degenerate path, unchanged).
   * This is still the ONE thread-write path — no second INSERT.
   * The caller (ThreadLifecycle) is responsible for the UUID-shape + uniqueness
   * check (isUuidShaped + !threadExists) BEFORE adopting; this method trusts it.
   */
  createThread(title?: string, adoptId?: string): string {
    const id = adoptId ?? crypto.randomUUID();
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
      // v2-02: bump the per-thread mutation marker atomically with the message insert
      // (NOT tied to last_active_at — the marker tracks ALL mutations: append/edit/forget)
      // v2-03: also carries distilled_through_turn in the INSERT (sentinel -1 = never distilled yet).
      // ON CONFLICT: only bump marker — never modify distilled_through_turn (only
      // advanceDistilledThroughTurn writes it).
      this.db.query(
        `INSERT INTO thread_distill_state (thread_id, marker, distilled_through, distilled_through_turn) VALUES (?, 1, 0, -1)
         ON CONFLICT(thread_id) DO UPDATE SET marker = marker + 1`,
      ).run(threadId);
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

  /**
   * SELECT all distilled_facts ordered by derived_at DESC, limited to `limit` rows.
   *
   * v2-04: provider-agnostic read-side suppression REMOVED (Ruling 1-b).
   * Under durable-delete + no-re-derivation, forgotten facts are gone from the table —
   * the per-dismiss forgotten_facts suppression defended a resurrection that can no longer happen.
   * Returns rows directly.
   */
  readDistilledFacts(limit: number): DistilledFactRow[] {
    const rows = this.db
      .query("SELECT id, fact, provenance, scope, expiry, confidence, authored_by FROM distilled_facts ORDER BY derived_at DESC LIMIT ?")
      .all(limit) as DistilledFactRow[];
    return rows;
  }

  // ---- forgotten_facts primitives (v2-04 Ruling 1-b: dormant substrate) ----
  //
  // dormant — retained for v2-05 optional ordered-replay Layer-T; no live per-dismiss consumer.
  //
  // Under durable-delete + no-re-derivation (v2-04), a forgotten fact is gone from
  // distilled_facts and does NOT come back on a normal dismiss. The per-dismiss suppression
  // machinery (recordForgottenFact write on forgetFact; buildForgottenNormSet/keepRow/
  // suppressForgottenMachineRows on read; isForgottenNormalizedText in retrieve()) has been
  // retired. These low-level primitives are kept so v2-05 can optionally use them in the
  // ordered-replay migration path (Layer-T consulted during replay, NOT per-dismiss).
  // If v2-05 ships "wipe + re-distill forward" as the default, this block is removable.

  /**
   * Record a durable fact-forget entry in `forgotten_facts`.
   * Keyed on `normalizeFactText(raw_text)` — the load-bearing match key for Layer-T.
   * The provenance is stored as-forgotten for Layer-P (opportunistic) + audit.
   * dormant — retained for v2-05 optional ordered-replay Layer-T; no live per-dismiss consumer.
   */
  recordForgottenFact(e: ForgottenFactInput): void {
    const normalized = normalizeFactText(e.raw_text);
    this.db
      .query(
        "INSERT INTO forgotten_facts (id, normalized_text, raw_text, provenance, actor, reason, authored_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        crypto.randomUUID(),
        normalized,
        e.raw_text,
        e.provenance ?? null,
        e.actor,
        e.reason ?? null,
        e.authored_by,
        Date.now(),
      );
  }

  /**
   * Read all forgotten facts.
   * Returns normalized_text (Layer-T match key), raw_text (Layer-X nudge), provenance (Layer-P).
   * dormant — retained for v2-05 optional ordered-replay Layer-T; no live per-dismiss consumer.
   */
  readForgottenFacts(): ForgottenFactRow[] {
    return this.db
      .query("SELECT normalized_text, raw_text, provenance FROM forgotten_facts")
      .all() as ForgottenFactRow[];
  }

  /**
   * Returns true if ANY forgotten_facts row has the given normalized text.
   * dormant — retained for v2-05 optional ordered-replay Layer-T; no live per-dismiss consumer.
   */
  isForgottenNormalizedText(norm: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM forgotten_facts WHERE normalized_text = ? LIMIT 1")
      .get(norm);
    return row !== null;
  }

  /**
   * Remove all forgotten_facts rows with the given normalized text.
   * Returns the number of rows deleted.
   * dormant — retained for v2-05 optional ordered-replay Layer-T; no live per-dismiss consumer.
   */
  clearForgottenByNormalizedText(norm: string): number {
    const result = this.db
      .query("DELETE FROM forgotten_facts WHERE normalized_text = ? RETURNING id")
      .all(norm);
    return result.length;
  }

  /**
   * Durable-delete of machine-authored distilled_facts whose provenance OR normalized fact text
   * matches the given arguments (AND authored_by != 'human' — 5e guard).
   *
   * Calls deleteFactById (which fires the AFTER DELETE trigger cleaning fact_fts + fact_topics)
   * for each matching row, all in one db.transaction. Returns the count deleted.
   *
   * Both provenance match and text match are checked so a re-derived fact with a
   * DIFFERENT provenance shape (unstable across re-projections) is still caught by text.
   * 5e guard: authored_by != 'human' — never deletes a human-authored row.
   */
  deleteMachineFactsByForget(provenance: string, normalizedText: string): number {
    const tx = this.db.transaction((): number => {
      const candidates = this.db
        .query("SELECT id, fact, provenance FROM distilled_facts WHERE authored_by != 'human'")
        .all() as { id: string; fact: string; provenance: string }[];

      const toDelete = candidates.filter(
        (c) => c.provenance === provenance || normalizeFactText(c.fact) === normalizedText,
      );

      if (toDelete.length === 0) return 0;

      // deleteFactById fires the AFTER DELETE trigger for each row (cleans fact_fts + fact_topics)
      for (const row of toDelete) {
        this.deleteFactById(row.id);
      }
      return toDelete.length;
    });
    return tx();
  }

  /**
   * Returns true if ANY human-authored distilled_fact has a normalized text matching `norm`.
   * dormant — retained for v2-05 optional ordered-replay Layer-T; no live per-dismiss consumer.
   */
  hasHumanFactWithNormalizedText(norm: string): boolean {
    const rows = this.db
      .query("SELECT id, fact FROM distilled_facts WHERE authored_by = 'human'")
      .all() as { id: string; fact: string }[];
    return rows.some((r) => normalizeFactText(r.fact) === norm);
  }

  /**
   * Given a provenance string, return the set of origin thread ids.
   * MINOR-1 helper (D-D): resolves comma-joined message-id provenances in code
   * rather than via the m.id = df.provenance SQL join that fails for multi-source provenance.
   *   - "thread:<id>"       → [id]
   *   - "msgId1,msgId2,…"  → look up thread_id for each isMessageId component, dedupe
   */
  originThreadsForProvenance(provenance: string): string[] {
    if (provenance.startsWith("thread:")) {
      return [provenance.slice("thread:".length)];
    }
    const components = provenance
      .split(",")
      .map((p) => p.trim())
      .filter((p) => isMessageId(p));
    if (components.length === 0) return [];
    const seen = new Set<string>();
    for (const msgId of components) {
      const row = this.db
        .query("SELECT thread_id FROM messages WHERE id = ?")
        .get(msgId) as { thread_id: string } | null;
      if (row) seen.add(row.thread_id);
    }
    return Array.from(seen);
  }

  /**
   * MF-04 (5f, spec §3.3; ADR-0012 decision 5f). Scope-filtered projection read —
   * the thread-isolation enforcement point. A fact is injectable into `forThreadId` iff:
   *   scope IN ('cross-thread','global')                              -- shared facts cross
   *   OR (scope = 'thread-local' AND originThread(fact) = forThreadId) -- private stays home
   *
   * MINOR-1 (D-D, chunk 04): origin-thread is now resolved IN CODE via
   * `originThreadsForProvenance`, handling comma-joined multi-source provenances
   * that the old `m.id = df.provenance` JOIN could not match.
   * The `thread:<id>` shape is handled uniformly via the same helper.
   *
   * Two-phase: SELECT candidates with expiry filter + ordering (preserving D6 ordering and
   * existing LIMIT semantics), then filter thread-local rows in code. LIMIT is applied AFTER
   * in-code filter so the returned slice is full.
   *
   * NULL/unknown scope defaults to cross-thread (the v0 reality; never throws).
   * `readDistilledFacts` (all-rows) is intentionally kept for swap-proof / non-injection callers.
   */
  readDistilledFactsForThread(forThreadId: string, limit: number): DistilledFactRow[] {
    // Phase 1: fetch all non-expired candidates (no thread-local filtering in SQL).
    // The large fetch is acceptable: the projection is bounded (chunk 02 RETRIEVE_SLICE_N).
    // We over-fetch and apply in-code filter, then re-apply limit.
    const now = Date.now();
    const candidates = this.db
      .query(
        `SELECT df.id AS id, df.fact AS fact, df.provenance AS provenance, df.scope AS scope,
                df.expiry AS expiry, df.confidence AS confidence, df.authored_by AS authored_by
         FROM distilled_facts df
         WHERE (df.expiry IS NULL OR df.expiry > ?)
         ORDER BY (df.authored_by = 'human') DESC, df.derived_at DESC, df.rowid ASC`,
      )
      .all(now) as DistilledFactRow[];

    // Phase 2: in-code thread-local filter (MINOR-1).
    // v2-04: forgotten suppression REMOVED (Ruling 1-b) — durable-delete makes it dead.
    const filtered: DistilledFactRow[] = [];
    for (const row of candidates) {
      const scope = row.scope ?? "cross-thread";
      if (scope === "cross-thread" || scope === "global" || scope === null) {
        filtered.push(row);
      } else if (scope === "thread-local") {
        // Resolve origin threads in code (handles comma-joined provenances)
        const origins = this.originThreadsForProvenance(row.provenance ?? "");
        if (origins.includes(forThreadId)) {
          filtered.push(row);
        }
      }
      // Unknown scopes treated as cross-thread (defensive default)
      else {
        filtered.push(row);
      }
      if (filtered.length >= limit) break;
    }

    return filtered;
  }

  /**
   * v2-08 refined-B dedup (bus q#013): true iff ANY existing fact matches `text` on
   * EITHER the normalized key (symmetric base — fact_fts.canonical is stored VERBATIM
   * by writeFactDerived, so we normalizeFactText the STORED side too) OR the connector
   * key (closed function-word strip; collapses "is blue"/"blue", never negations). The
   * connector clause subsumes the base; both kept explicit for legibility. Scans the
   * bounded fact corpus (dogfood scale). READ-ONLY: callers use it to SUPPRESS a new
   * insert only — it never mutates a row (STABILITY untouched by construction).
   */
  factExistsByDedupKey(text: string): boolean {
    const norm = normalizeFactText(text);
    if (norm === "") return false;
    const conn = dedupConnectorKey(text);
    const rows = this.db
      .query(
        `SELECT COALESCE(f.canonical, d.fact) AS key
           FROM distilled_facts d
           LEFT JOIN fact_fts f ON f.fact_id = d.id`,
      )
      .all() as { key: string }[];
    return rows.some((r) => normalizeFactText(r.key) === norm || dedupConnectorKey(r.key) === conn);
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

  /**
   * ONE-TIME MIGRATION ONLY (v2-05 §3.8). NOT a per-dismiss path.
   * DELETE all machine-authored rows from distilled_facts (5e guard: human-pinned
   * facts survive). Used exclusively by the explicit migration script — never by the
   * incremental distiller's per-dismiss flow.
   */
  dropAllDistilledFacts(): void {
    this.db.query("DELETE FROM distilled_facts WHERE authored_by != 'human'").run();
  }

  /**
   * DEAD as of v2-03 (no live caller in the incremental path); slated for a follow-up dead-code pass, NOT removed in v2-05 (still has unit tests).
   *
   * Atomic replace of the machine projection (chunk 02, spec D5/D6/D7).
   *
   * ONE flat synchronous `db.transaction`:
   *   1. DELETE machine facts (authored_by != 'human') — 5e guard inline.
   *   2. INSERT each fact in `clean` into distilled_facts.
   *   3. INSERT one row per entry in `events` into distillation_events.
   *
   * IMPORTANT:
   * - No `await` inside — pure synchronous SQLite; the daemon's single connection
   *   never stalls mid-transaction (grill #6 seam; chunk 03 LLM call lives OUTSIDE).
   * - Does NOT call `insertDistilledFacts` or `dropAllDistilledFacts` (both wrap
   *   their own transactions — nested tx with bun:sqlite uses SAVEPOINT and must be
   *   avoided; this keeps it one flat tx).
   * - `facts_produced` recorded in each event row equals `clean.length` (the RESULTING
   *   projection size after this call, same value across all event rows in a run).
   */
  replaceProjection(
    clean: DistilledFact[],
    distillerVersion: string,
    events: { threadId: string; trigger: string; factsProduced: number }[],
  ): void {
    // Capture one timestamp for the entire atomic rebuild (MAJOR-1 fix part 1).
    // A single `now` means all machine fact rows share the same derived_at, which
    // makes the rowid ASC tie-breaker in readDistilledFactsForThread the sole
    // determinant of order within the machine projection. Because a full DELETE +
    // INSERT assigns rowids monotonically in insertion order, rowid ASC = the
    // provider's intended newest-first order. Per-row Date.now() caused later-
    // inserted (= older) facts to get a larger derived_at → DESC ranked them first
    // → LIMIT 20 filled with the oldest conversations.
    const now = Date.now();
    const insertFact = this.db.query(
      "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertEvent = this.db.query(
      "INSERT INTO distillation_events (id, thread_id, trigger, facts_produced, distiller_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const tx = this.db.transaction(() => {
      // 5e guard — inline: authored_by != 'human' (byte-for-byte meaning preserved)
      this.db.query("DELETE FROM distilled_facts WHERE authored_by != 'human'").run();
      for (const f of clean) {
        insertFact.run(
          crypto.randomUUID(),
          f.fact,
          f.provenance,
          f.scope,
          f.expiry ?? null,
          f.confidence,
          f.authored_by,
          now,
          distillerVersion,
        );
      }
      for (const e of events) {
        insertEvent.run(
          crypto.randomUUID(),
          e.threadId,
          e.trigger,
          e.factsProduced,
          distillerVersion,
          now,
        );
      }
    });
    tx();
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
      .query("SELECT facts_produced, trigger, distiller_version, created_at FROM distillation_events WHERE thread_id = ? ORDER BY created_at ASC")
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

  /**
   * List all threads ordered by last_active_at DESC (T2.1a — additive SELECT only).
   * Used by GET /memory/threads to populate the History page thread list.
   */
  listThreads(): { thread_id: string; title: string | null; last_active_at: number }[] {
    return this.db
      .query("SELECT thread_id, title, last_active_at FROM threads ORDER BY last_active_at DESC")
      .all() as { thread_id: string; title: string | null; last_active_at: number }[];
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

  // ── v2-02: stable-id delta primitives ─────────────────────────────────────

  /**
   * Insert ONE fact with a stable id, writing its derived rows in the SAME tx:
   *   distilled_facts (display text) + fact_fts (canonical match key) + fact_topics (tags).
   * Returns the stable id. v2-02 delta-apply primitive (spec §3.3) — the id stays put
   * across dismisses (no DELETE-all). `canonical`/`topics` come from the caller.
   */
  insertFact(f: InsertFactInput, distillerVersion: string): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db.query(
        "INSERT INTO distilled_facts (id, fact, provenance, scope, expiry, confidence, authored_by, derived_at, distiller_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, f.fact, f.provenance, f.scope, f.expiry ?? null, f.confidence, f.authored_by, now, distillerVersion);
      this.writeFactDerived(id, f.canonical, f.topics);
    });
    tx();
    return id;
  }

  /** Durably record a fact's prior text for audit (spec §3.2 m4). STANDALONE primitive
   * (chunk scope) — callable independently of updateFactById; updateFactById calls it. */
  recordReplacedFact(factId: string, replacedText: string, ctx: { actor: string; reason?: string }): void {
    this.db.query(
      "INSERT INTO replaced_facts (id, fact_id, replaced_text, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(crypto.randomUUID(), factId, replacedText, ctx.actor, ctx.reason ?? null, Date.now());
  }

  /**
   * REPLACE a fact's content in place (id UNCHANGED — stability), refreshing its
   * fact_fts + fact_topics rows and DURABLY recording the prior text (recordReplacedFact)
   * for audit (spec §3.2 m4). All in one tx. Returns false if `id` does not exist.
   * Does NOT do the 5e human-precedence / concurrency gating — that is the v2-03
   * delta-apply caller's job; this primitive is the unconditional in-place REPLACE.
   */
  updateFactById(id: string, u: UpdateFactInput, ctx: { actor: string; reason?: string }, distillerVersion: string): boolean {
    const tx = this.db.transaction((): boolean => {
      const prior = this.db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string } | null;
      if (prior === null) return false;
      this.recordReplacedFact(id, prior.fact, ctx);
      this.db.query(
        "UPDATE distilled_facts SET fact = ?, confidence = ?, distiller_version = ?, derived_at = ? WHERE id = ?",
      ).run(u.fact, u.confidence, distillerVersion, Date.now(), id);
      this.db.query("DELETE FROM fact_fts WHERE fact_id = ?").run(id);
      this.db.query("DELETE FROM fact_topics WHERE fact_id = ?").run(id);
      this.writeFactDerived(id, u.canonical, u.topics);
      return true;
    });
    return tx();
  }

  /**
   * APPEND a same-kind item to a fact's display list (spec §3.2 m1, capped at
   * APPEND_LIST_CAP). The fact's `fact` text becomes prior + "; " + item; its fact_fts
   * canonical is REPLACED with `appendedCanonical` — the CALLER (v2-03) must pass the
   * FULL merged canonical (all items) so BM25 can still find the fact by its earlier
   * items. Returns false (refuse) if the fact already holds >= APPEND_LIST_CAP items
   * (the v2-03 distiller then emits a `new` fact instead) or if id absent.
   * List length counted by "; " separators + 1.
   */
  appendToFactById(id: string, item: string, appendedCanonical: string): boolean {
    const tx = this.db.transaction((): boolean => {
      const row = this.db.query("SELECT fact FROM distilled_facts WHERE id = ?").get(id) as { fact: string } | null;
      if (row === null) return false;
      const itemCount = row.fact.split("; ").length;
      if (itemCount >= APPEND_LIST_CAP) return false;
      const merged = `${row.fact}; ${item}`;
      this.db.query("UPDATE distilled_facts SET fact = ?, derived_at = ? WHERE id = ?").run(merged, Date.now(), id);
      this.db.query("UPDATE fact_fts SET canonical = ? WHERE fact_id = ?").run(appendedCanonical, id);
      return true;
    });
    return tx();
  }

  /** Read the durable replaced-text audit trail for a fact id (spec §3.2 m4). */
  readReplacedFacts(factId: string): ReplacedFactRow[] {
    return this.db.query(
      "SELECT replaced_text, actor, reason, created_at FROM replaced_facts WHERE fact_id = ? ORDER BY created_at ASC",
    ).all(factId) as ReplacedFactRow[];
  }

  /**
   * v2-05 migration (§3.8): rebuild fact_fts + fact_topics for every SURVIVING
   * human-authored fact. Human facts predate v2-02's derived tables, so they may
   * have NO fact_fts/fact_topics rows → invisible to fetchCandidates (BM25). The
   * AFTER DELETE trigger cannot ADD rows; only insertFact/updateFactById (private
   * writeFactDerived) do, neither reached by the wipe. This is the public,
   * migration-only path to (re)index human rows.
   * Idempotent: clears then re-writes derived rows per human id. canonical =
   * normalizeFactText(fact) (D-V4c: match on canonical; display stays the row's fact);
   * topics = [] (human facts carry no LLM tags). Returns the count of human rows reindexed.
   * distillerVersion param omitted: human rows are not associated with a distiller version
   * (they have no LLM-assigned version to overwrite), and the migration version string has
   * no target column to persist it to.
   */
  rebuildDerivedForHumanFacts(): number {
    const tx = this.db.transaction((): number => {
      const humans = this.db
        .query("SELECT id, fact FROM distilled_facts WHERE authored_by = 'human'")
        .all() as { id: string; fact: string }[];
      for (const h of humans) {
        this.db.query("DELETE FROM fact_fts WHERE fact_id = ?").run(h.id);
        this.db.query("DELETE FROM fact_topics WHERE fact_id = ?").run(h.id);
        this.db.query("INSERT INTO fact_fts (fact_id, canonical, topic) VALUES (?, ?, ?)")
          .run(h.id, normalizeFactText(h.fact), "");
      }
      return humans.length;
    });
    return tx();
  }

  /**
   * v2-05 migration (§3.8) — the ONLY sanctioned live-store ALTER (spec §9 forbids
   * ALTER on the per-dismiss path; this is the deliberate one-time migration touch
   * v2-03's R2 forward-flag named). Adds `distilled_through_turn INTEGER NOT NULL
   * DEFAULT -1` to a pre-v2-03 live thread_distill_state. Idempotent: PRAGMA-guards
   * so a v2-03+ fresh store is a no-op. Returns true if the column was added. Resets
   * the column-presence cache so subsequent reads see it.
   */
  ensureDistilledThroughTurnColumn(): boolean {
    const cols = this.db.query("PRAGMA table_info(thread_distill_state)").all() as { name: string }[];
    if (cols.some((c) => c.name === "distilled_through_turn")) return false;
    this.db.exec("ALTER TABLE thread_distill_state ADD COLUMN distilled_through_turn INTEGER NOT NULL DEFAULT -1;");
    this._distilledThroughTurnColumnPresent = null;
    return true;
  }

  /** Delete one fact by id. The AFTER DELETE trigger cleans fact_fts + fact_topics.
   * Returns true if a row was deleted. v2-04's fact-forget reuses this. */
  deleteFactById(id: string): boolean {
    const result = this.db.query("DELETE FROM distilled_facts WHERE id = ? RETURNING id").all(id);
    return result.length > 0;
  }

  /**
   * BM25 candidate-fetch over the FULL distilled_facts corpus (spec §3.4 D-V4b — the
   * FROZEN B1 invariant: tags WIDEN recall, they NEVER reduce the candidate set).
   * Matches on fact_fts.canonical; returns the top CANDIDATE_TOP_K by BM25 rank, with
   * the user-language display `fact` (joined from distilled_facts) + topics (from
   * fact_topics). The caller (v2-03) passes a free-text `query` (the new fact's canonical).
   * `query` is sanitized into a safe OR-of-quoted-terms (toFtsOrQuery) so punctuation
   * can never produce a MATCH syntax error.
   */
  fetchCandidates(query: string): FactCandidate[] {
    const ftsQuery = toFtsOrQuery(query);
    if (ftsQuery === "") return [];
    const rows = this.db.query(
      `SELECT f.fact_id AS id, d.fact AS fact
         FROM fact_fts f
         JOIN distilled_facts d ON d.id = f.fact_id
         WHERE fact_fts MATCH ?
         ORDER BY bm25(fact_fts)
         LIMIT ?`,
    ).all(ftsQuery, CANDIDATE_TOP_K) as { id: string; fact: string }[];
    return rows.map((r) => ({
      id: r.id,
      fact: r.fact,
      topics: (this.db.query("SELECT topic FROM fact_topics WHERE fact_id = ? ORDER BY topic").all(r.id) as { topic: string }[]).map((t) => t.topic),
    }));
  }

  // ── v2-02: thread mutation marker ─────────────────────────────────────────

  /** Bump the per-thread mutation marker (spec §3.3 D-V3b). Upserts the side-table
   * row so threads created before v2-02 get one lazily. Called on append/edit/forget —
   * NOT tied to last_active_at (which only append touches). Returns the new marker.
   * ON CONFLICT: only bumps marker — never modifies distilled_through_turn (sentinel -1
   * is preserved until advanceDistilledThroughTurn writes the real value). */
  bumpThreadMarker(threadId: string): number {
    this.db.query(
      `INSERT INTO thread_distill_state (thread_id, marker, distilled_through, distilled_through_turn) VALUES (?, 1, 0, -1)
       ON CONFLICT(thread_id) DO UPDATE SET marker = marker + 1`,
    ).run(threadId);
    return this.readThreadMarker(threadId);
  }

  /** Current mutation marker for a thread (0 if no state row yet). */
  readThreadMarker(threadId: string): number {
    const row = this.db.query("SELECT marker FROM thread_distill_state WHERE thread_id = ?").get(threadId) as { marker: number } | null;
    return row?.marker ?? 0;
  }

  /** Record the marker value the distiller has covered (v2-03 reads marker vs this to skip). */
  advanceDistilledThrough(threadId: string, marker: number): void {
    this.db.query(
      `INSERT INTO thread_distill_state (thread_id, marker, distilled_through, distilled_through_turn) VALUES (?, ?, ?, -1)
       ON CONFLICT(thread_id) DO UPDATE SET distilled_through = excluded.distilled_through`,
    ).run(threadId, marker, marker);
  }

  /**
   * Read all three markers (0/0/0 if no row yet).
   *
   * R2 RESILIENT READ: on a pre-v2-03 live store the `distilled_through_turn` column
   * may not exist in `thread_distill_state` (the table was created without it and
   * `CREATE TABLE IF NOT EXISTS` is a no-op). A naive `SELECT distilled_through_turn`
   * would CRASH. Guard: PRAGMA table_info to detect absence; if absent, default to -1
   * — meaning the WHOLE thread is "new tail" (sentinel "never distilled yet") until
   * v2-05 adds the column via migration. Any interim duplicates from default-(-1)
   * whole-thread reads are wiped by v2-05 §3.8.
   */
  readThreadDistillState(threadId: string): ThreadDistillState {
    if (!this._hasDistilledThroughTurnColumn()) {
      const row = this.db.query("SELECT marker, distilled_through FROM thread_distill_state WHERE thread_id = ?").get(threadId) as { marker: number; distilled_through: number } | null;
      return row ? { ...row, distilled_through_turn: -1 } : { marker: 0, distilled_through: 0, distilled_through_turn: -1 };
    }
    const row = this.db.query("SELECT marker, distilled_through, distilled_through_turn FROM thread_distill_state WHERE thread_id = ?").get(threadId) as ThreadDistillState | null;
    return row ?? { marker: 0, distilled_through: 0, distilled_through_turn: -1 };
  }

  /**
   * Returns messages with turn_index > sinceTurn, tombstone/quarantine-honored,
   * applying the same "latest HUMAN correction wins, else latest correction" COALESCE
   * as readThreadMessagesForDistill. Ordered ASC by turn_index.
   * sinceTurn = 0 ⇒ whole thread (first distill of a thread).
   * Used by v2-03 SmartDistillerProvider + DumbTailProvider for new-tail incremental reads.
   */
  readNewTailSince(threadId: string, sinceTurn: number): MessageForDistillRow[] {
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
         WHERE m.thread_id = ? AND m.turn_index > ?
         GROUP BY m.id
         ORDER BY m.turn_index ASC`,
      )
      .all(threadId, sinceTurn) as TailRow[];
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.tombstoned ? REDACTION_MARKER : (r.correction ?? r.content),
    }));
  }

  /** COALESCE(MAX(turn_index), 0) for a thread — the highest turn_index stored, or 0. */
  maxTurnIndex(threadId: string): number {
    const row = this.db
      .query("SELECT COALESCE(MAX(turn_index), 0) AS n FROM messages WHERE thread_id = ?")
      .get(threadId) as { n: number };
    return row.n;
  }

  /**
   * Advance the distilled_through_turn watermark (upsert).
   * R2: only written on stores that have the column (fresh v2-03+); never called
   * on pre-v2-03 live stores in the per-dismiss path (column guard in readThreadDistillState).
   * INSERT initializes distilled_through_turn to the supplied value; ON CONFLICT only
   * updates distilled_through_turn (not marker or distilled_through).
   */
  advanceDistilledThroughTurn(threadId: string, turn: number): void {
    if (!this._hasDistilledThroughTurnColumn()) return; // R2: no-op on pre-v2-03 store shape
    this.db.query(
      `INSERT INTO thread_distill_state (thread_id, marker, distilled_through, distilled_through_turn) VALUES (?, 0, 0, ?)
       ON CONFLICT(thread_id) DO UPDATE SET distilled_through_turn = excluded.distilled_through_turn`,
    ).run(threadId, turn);
  }

  /**
   * R2 column-presence cache: PRAGMA table_info to check whether the `distilled_through_turn`
   * column exists in `thread_distill_state`. Cached after first check — schema cannot change
   * at runtime. Returns true for fresh v2-03+ stores; false for pre-v2-03 live stores.
   */
  private _distilledThroughTurnColumnPresent: boolean | null = null;
  private _hasDistilledThroughTurnColumn(): boolean {
    if (this._distilledThroughTurnColumnPresent !== null) {
      return this._distilledThroughTurnColumnPresent;
    }
    const cols = this.db.query("PRAGMA table_info(thread_distill_state)").all() as { name: string }[];
    this._distilledThroughTurnColumnPresent = cols.some((c) => c.name === "distilled_through_turn");
    return this._distilledThroughTurnColumnPresent;
  }

  /** Write the derived fact_fts + fact_topics rows for a fact id: one fact_fts row
   * carrying the space-joined topics string; one fact_topics row PER topic.
   * Private; called inside insertFact/updateFactById txns. */
  private writeFactDerived(id: string, canonical: string, topics: string[]): void {
    this.db.query("INSERT INTO fact_fts (fact_id, canonical, topic) VALUES (?, ?, ?)")
      .run(id, canonical, topics.join(" "));
    const insTopic = this.db.query("INSERT INTO fact_topics (fact_id, topic) VALUES (?, ?)");
    for (const t of topics) insTopic.run(id, t);
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
