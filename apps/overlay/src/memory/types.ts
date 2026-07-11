/** Wire shapes the memory window fetches (frontend-local; mirrors daemon hatch.ts/store.ts).
 *  Do NOT import daemon types — the overlay is a separate bundle. */
export interface ThreadSummary {
  thread_id: string;
  title: string | null;
  last_active_at: number;
  status?: string; // "active" | "dismissed" — present iff Step 1 landed; optional by design
}
export interface ThreadMessage { id: string; role: string; content: string } // content may be "[forgotten]"
export interface DistilledFactView {
  id: string;
  fact: string;
  provenance: string; // "thread:<uuid>" | "<msgId>,<msgId>" | legacy
  scope: string;      // "thread-local" | "cross-thread" | "global"
  expiry: number | null;
  confidence: number;
  authored_by: string;
}
export interface DistillationEventView {
  facts_produced: number;
  trigger: string;
  distiller_version: string;
  created_at: number;
}
// 2c chunk-04 (D9b): frontend-local mirror of daemon store.ts MemoryActionEventRow.
// Render-only audit trail — additive-on-type is what makes the wire field type-checked.
export interface MemoryActionEventView {
  action: string;   // "forget" | "remember" | "reassert"
  outcome: string;  // "applied" | "refused-<code>"
  fact_text: string;
  actor: string;    // "agent"
  created_at: number;
}
export interface HatchView {
  messages: ThreadMessage[];
  distilledFacts: DistilledFactView[];
  distillationEvents: DistillationEventView[];
  memoryActionEvents: MemoryActionEventView[]; // 2c D9b — render-only audit trail
}
