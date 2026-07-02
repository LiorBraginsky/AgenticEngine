/**
 * controller (chunk-02, memory-transparency-ui) — list↔detail navigation glue.
 * Thin: no DOM building of its own (render.ts) and no fetch mechanics (memory-api.ts).
 * Honest states throughout (locked / daemon-down / empty) — never a stuck "Loading…".
 * Provenance jump reuses openThread → the same detail-load path (DoD box 2).
 */
import type { MemoryApiDeps } from "./memory-api.js";
import { fetchThreads, fetchThread } from "./memory-api.js";
import { renderThreadList, renderMessages, renderFacts, renderEvents, renderState } from "./render.js";

export interface MemoryControllerEls {
  listView: HTMLElement;
  detailView: HTMLElement;
  threadListEl: HTMLElement;
  messagesEl: HTMLElement;
  factsEl: HTMLElement;
  eventsEl: HTMLElement;
  backBtn: HTMLElement;
}
export interface MemoryControllerDeps {
  api: MemoryApiDeps;
  els: MemoryControllerEls;
}

const LOCKED = "🔒 Token rejected — the engine did not accept this token.";
const DOWN = "Daemon unreachable — is the engine running?";

export function createMemoryController(deps: MemoryControllerDeps): { start(): void } {
  const { els } = deps;

  function showList(): void { els.detailView.style.display = "none"; els.listView.style.display = "block"; }
  function showDetail(): void { els.listView.style.display = "none"; els.detailView.style.display = "block"; }

  async function loadList(): Promise<void> {
    renderState(els.threadListEl, "Loading…", "li");
    const r = await fetchThreads(deps.api);
    if (r.kind === "unauthorized") { renderState(els.threadListEl, LOCKED, "li"); return; }
    if (r.kind === "unreachable") { renderState(els.threadListEl, DOWN, "li"); return; }
    renderThreadList(els.threadListEl, r.data.threads ?? [], openThread);
  }

  async function loadThread(threadId: string): Promise<void> {
    renderState(els.messagesEl, "Loading…");
    renderState(els.factsEl, "Loading…");
    renderState(els.eventsEl, "Loading…");
    const r = await fetchThread(deps.api, threadId);
    if (r.kind === "unauthorized") { renderState(els.messagesEl, LOCKED); renderState(els.factsEl, LOCKED); renderState(els.eventsEl, LOCKED); return; }
    if (r.kind === "unreachable") { renderState(els.messagesEl, DOWN); renderState(els.factsEl, DOWN); renderState(els.eventsEl, DOWN); return; }
    renderMessages(els.messagesEl, r.data.messages ?? []);
    renderFacts(els.factsEl, r.data.distilledFacts ?? [], openThread);
    renderEvents(els.eventsEl, r.data.distillationEvents ?? []);
  }

  function openThread(threadId: string): void { showDetail(); void loadThread(threadId); }

  function start(): void {
    els.backBtn.addEventListener("click", () => { showList(); void loadList(); });
    showList();
    void loadList();
  }
  return { start };
}
