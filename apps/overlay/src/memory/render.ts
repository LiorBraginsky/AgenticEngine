/**
 * render (chunk-02, memory-transparency-ui) — DOM builders for the memory read UI.
 * XSS discipline (history.html / text-reply.ts): all API-derived strings via textContent/
 * createElement — NEVER innerHTML. Uses the pure fact-view helpers for the display rules.
 */
import type { ThreadSummary, ThreadMessage, DistilledFactView, DistillationEventView } from "./types.js";
import {
  parseProvenance, shouldShowExpiry, shouldShowConfidence, eventLabel, formatTs,
} from "./fact-view.js";
import { buildForgetControl, buildEditControl } from "./actions.js";

/** chunk-03 (ACT): optional per-row actions. Absent → chunk-02 read-only behavior (existing callers). */
export interface MessageActions {
  /** Attach an inline Edit control per message → POST /memory/edit (WriteGate.edit human correction). */
  onEdit?: (messageId: string, newText: string) => void;
  /** Message ids edited THIS session → shown with an "edited by you" tag. The wire carries no
   *  persistent per-message correction flag (see plan "## Reality check" §2), so this is an honest
   *  optimistic marker; the corrected TEXT itself is persistent via readThreadArchive COALESCE. */
  editedIds?: ReadonlySet<string>;
}
export interface FactActions {
  /** Attach a "release the reference" Forget control per fact → POST /memory/forget (durable delete). */
  onForget?: (factId: string) => void;
}

function clear(el: HTMLElement): void { el.replaceChildren(); }

/** Honest per-view state (empty / locked / daemon-down), reusing the chunk-01 tone. */
export function renderState(el: HTMLElement, message: string, tag: keyof HTMLElementTagNameMap = "p"): void {
  clear(el);
  const p = document.createElement(tag);
  p.className = "empty";
  p.textContent = message;
  el.appendChild(p);
}

export function renderThreadList(listEl: HTMLElement, threads: ThreadSummary[], onOpen: (id: string) => void): void {
  clear(listEl);
  if (threads.length === 0) { renderState(listEl, "No threads yet.", "li"); return; }
  for (const t of threads) {
    const li = document.createElement("li");
    li.className = "thread-list-item";
    const title = document.createElement("div");
    title.className = "thread-title";
    title.textContent = t.title || t.thread_id;
    const meta = document.createElement("div");
    meta.className = "thread-meta";
    const status = t.status ? ` · ${t.status}` : "";
    meta.textContent = `${t.thread_id} · ${formatTs(t.last_active_at)}${status}`;
    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener("click", () => onOpen(t.thread_id));
    listEl.appendChild(li);
  }
}

export function renderMessages(el: HTMLElement, messages: ThreadMessage[], actions?: MessageActions): void {
  clear(el);
  if (messages.length === 0) { renderState(el, "No messages."); return; }
  messages.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = `message-row role-${m.role || "unknown"}`;
    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = `${m.role || "?"} · turn ${i + 1}`;
    if (actions?.editedIds?.has(m.id)) {
      const tag = document.createElement("span");
      tag.className = "edited-tag";
      tag.textContent = " · edited by you";
      role.appendChild(tag);
    }
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = m.content || ""; // may be "[forgotten]" for a tombstoned message
    row.appendChild(role);
    row.appendChild(content);
    if (actions?.onEdit) {
      const onEdit = actions.onEdit;
      row.appendChild(buildEditControl(m.content || "", (newText) => onEdit(m.id, newText)));
    }
    el.appendChild(row);
  });
}

export function renderFacts(
  el: HTMLElement,
  facts: DistilledFactView[],
  onOpenThread: (id: string) => void,
  actions?: FactActions,
): void {
  clear(el);
  if (facts.length === 0) { renderState(el, "No distilled facts."); return; }
  for (const f of facts) {
    const row = document.createElement("div");
    row.className = "fact-row";

    const factEl = document.createElement("div");
    factEl.textContent = f.fact || "";
    row.appendChild(factEl);

    // Provenance (ADR-0012 5c) — thread:<id> is a jump-link; else plain text.
    const prov = document.createElement("div");
    prov.className = "fact-meta";
    const label = document.createElement("span");
    label.textContent = "from: ";
    prov.appendChild(label);
    const ref = parseProvenance(f.provenance || "");
    if (ref.kind === "thread") {
      const link = document.createElement("a");
      link.className = "prov-link";
      link.href = "#";
      link.textContent = f.provenance;
      link.addEventListener("click", (e) => { e.preventDefault(); onOpenThread(ref.threadId); });
      prov.appendChild(link);
    } else {
      const txt = document.createElement("span");
      txt.textContent = ref.raw || "(unknown)";
      prov.appendChild(txt);
    }
    const extra = document.createElement("span");
    extra.textContent = ` · scope: ${f.scope} · ${f.authored_by}`;
    prov.appendChild(extra);
    row.appendChild(prov);

    // Expiry / confidence — SHOWN ONLY WHEN NON-DEFAULT (spec ruling 2026-07-02).
    if (shouldShowExpiry(f)) {
      const exp = document.createElement("div");
      exp.className = "fact-meta fact-expiry";
      exp.textContent = `expires: ${formatTs(f.expiry)}`;
      row.appendChild(exp);
    }
    if (shouldShowConfidence(f)) {
      const conf = document.createElement("div");
      conf.className = "fact-meta fact-confidence";
      conf.textContent = `confidence: ${f.confidence}`;
      row.appendChild(conf);
    }

    // chunk-03 (ACT): "release the reference" forget control (ADR-0015 durable fact-delete).
    if (actions?.onForget) {
      const onForget = actions.onForget;
      row.appendChild(buildForgetControl(() => onForget(f.id)));
    }
    el.appendChild(row);
  }
}

export function renderEvents(el: HTMLElement, events: DistillationEventView[]): void {
  clear(el);
  if (events.length === 0) { renderState(el, "No distillation events."); return; }
  for (const e of events) {
    const row = document.createElement("div");
    row.className = "event-row";
    const line = document.createElement("div");
    const trig = document.createElement("span");
    trig.textContent = `trigger: ${e.trigger || "?"} · `;
    const count = document.createElement("span");
    count.className = "facts-count" + (e.facts_produced === 0 ? " zero-count" : "");
    count.textContent = eventLabel(e);
    line.appendChild(trig);
    line.appendChild(count);
    const date = document.createElement("div");
    date.className = "event-date";
    date.textContent = formatTs(e.created_at);
    row.appendChild(line);
    row.appendChild(date);
    el.appendChild(row);
  }
}
