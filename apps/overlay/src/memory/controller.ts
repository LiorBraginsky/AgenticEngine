/**
 * controller (chunk-02, memory-transparency-ui) — list<->detail navigation glue.
 * Thin: no DOM building of its own (render.ts) and no fetch mechanics (memory-api.ts).
 * Honest states throughout (locked / daemon-down / empty) — never a stuck "Loading…".
 * Provenance jump reuses openThread -> the same detail-load path (DoD box 2).
 *
 * Demo-1 fix (item 4, state-sync): the top-of-window liveness banner (memory.ts ->
 * createMemoryLiveness) and these content sections were two uncoordinated state machines —
 * the banner polls every 3s while the content only re-fetched on explicit nav, so a daemon
 * kill left a stale list under an "unreachable" banner (they contradicted) and a later start
 * left the content stuck on "unreachable" until a full restart (no restart-free recovery).
 * `onLivenessState` couples them: memory.ts forwards the banner's EXISTING per-poll onState
 * result here (memory-liveness.ts is unchanged). Repeated same-state polls are a no-op, so
 * content is NOT re-fetched every 3s (no flicker/waste); on a transition INTO `connected`
 * from a non-connected state it re-fetches the current view (restart-free recovery); on a
 * transition into a non-connected state it clears the current view to the SAME honest
 * down/locked state the banner shows (clear-to-unreachable — plan "## The decision").
 */
import type { ShellState } from "../memory-liveness.js";
import type { MemoryApiDeps } from "./memory-api.js";
import { fetchThreads, fetchThread } from "./memory-api.js";
import { renderThreadList, renderMessages, renderFacts, renderEvents, renderAuditEvents, renderState } from "./render.js";
import { forgetFact, editFact, type WriteResult } from "./memory-write.js";

export interface MemoryControllerEls {
  listView: HTMLElement;
  detailView: HTMLElement;
  threadListEl: HTMLElement;
  messagesEl: HTMLElement;
  factsEl: HTMLElement;
  eventsEl: HTMLElement;
  actionsEl: HTMLElement; // 2c chunk-04 (D9b): render-only agent memory-action audit list
  backBtn: HTMLElement;
}
export interface MemoryControllerDeps {
  api: MemoryApiDeps;
  els: MemoryControllerEls;
}
export interface MemoryController {
  start(): void;
  /** Coupling hook — called by memory.ts on EVERY liveness poll result (per-poll, not
   *  per-transition). De-dupes internally -> content re-fetches only on a down->up transition. */
  onLivenessState(state: ShellState): void;
}

type ViewState = { kind: "list" } | { kind: "detail"; threadId: string };

const LOCKED = "🔒 Token rejected — the engine did not accept this token.";
const DOWN = "Daemon unreachable — is the engine running?";

export function createMemoryController(deps: MemoryControllerDeps): MemoryController {
  const { els } = deps;

  // The two facts onLivenessState needs: WHICH view to refresh on recovery, and the last
  // observed state so repeated same-state polls are a no-op (never re-fetch every 3s).
  let currentView: ViewState = { kind: "list" };
  let lastLiveness: ShellState | undefined;

  // Generation guard (reviewer minor, Demo-1 fix follow-up): loads are async but
  // applyDownState writes synchronously. Without this, a stale loadThread/loadList that
  // resolves AFTER a down transition can overwrite the honest "Daemon unreachable" render
  // with stale content. Bumped at the start of every load (captured locally) and on every
  // down transition -> a load whose captured gen no longer matches skips its render writes.
  let loadGen = 0;

  function showList(): void { els.detailView.style.display = "none"; els.listView.style.display = "block"; }
  function showDetail(): void { els.listView.style.display = "none"; els.detailView.style.display = "block"; }

  async function loadList(): Promise<void> {
    const gen = ++loadGen;
    renderState(els.threadListEl, "Loading…", "li");
    const r = await fetchThreads(deps.api);
    if (gen !== loadGen) return; // stale load, invalidated by a down transition -> skip
    if (r.kind === "unauthorized") { renderState(els.threadListEl, LOCKED, "li"); return; }
    if (r.kind === "unreachable") { renderState(els.threadListEl, DOWN, "li"); return; }
    renderThreadList(els.threadListEl, r.data.threads ?? [], openThread);
  }

  async function loadThread(threadId: string): Promise<void> {
    const gen = ++loadGen;
    renderState(els.messagesEl, "Loading…");
    renderState(els.factsEl, "Loading…");
    renderState(els.eventsEl, "Loading…");
    renderState(els.actionsEl, "Loading…");
    const r = await fetchThread(deps.api, threadId);
    if (gen !== loadGen) return; // stale load, invalidated by a down transition -> skip
    if (r.kind === "unauthorized") {
      renderState(els.messagesEl, LOCKED); renderState(els.factsEl, LOCKED);
      renderState(els.eventsEl, LOCKED); renderState(els.actionsEl, LOCKED);
      return;
    }
    if (r.kind === "unreachable") {
      renderState(els.messagesEl, DOWN); renderState(els.factsEl, DOWN);
      renderState(els.eventsEl, DOWN); renderState(els.actionsEl, DOWN);
      return;
    }
    renderMessages(els.messagesEl, r.data.messages ?? []);
    renderFacts(els.factsEl, r.data.distilledFacts ?? [], openThread, {
      onForget: (factId) => void forgetAction(factId),
      onEditFact: (factId, newText) => void editFactAction(factId, newText), // chunk-05
    });
    renderEvents(els.eventsEl, r.data.distillationEvents ?? []);
    renderAuditEvents(els.actionsEl, r.data.memoryActionEvents ?? []); // 2c chunk-04 (D9b)
  }

  function openThread(threadId: string): void { currentView = { kind: "detail", threadId }; showDetail(); void loadThread(threadId); }
  function backToList(): void { currentView = { kind: "list" }; showList(); void loadList(); }

  /** Re-fetch whatever the user is currently looking at (list or the open thread). */
  function refreshCurrentView(): void {
    if (currentView.kind === "detail") void loadThread(currentView.threadId);
    else void loadList();
  }

  /** Clear the current view to the banner's honest state (clear-to-unreachable). Same
   *  DOWN/LOCKED constants + tags the nav path uses, applied to whichever view is up.
   *
   *  Reviewer minor fix: also re-couples lastLiveness. The write path (handleWriteResult) calls
   *  this directly on a POST unreachable/unauthorized WITHOUT going through onLivenessState, so
   *  without this, lastLiveness would stay whatever the liveness poll last reported (e.g.
   *  "connected") while the content is actually DOWN — the next "connected" poll would then see
   *  prev === state, de-dupe as a repeat, and never call refreshCurrentView(), stranding the view
   *  on DOWN until a manual nav. Setting it here re-arms the next same-value poll as a real
   *  transition. Idempotent/redundant on the liveness-driven call (onLivenessState already set
   *  lastLiveness = state right before calling this). */
  function applyDownState(state: ShellState): void {
    loadGen++; // invalidate any in-flight load so a stale response can't clobber this render
    lastLiveness = state;
    const msg = state === "unauthorized" ? LOCKED : DOWN;
    if (currentView.kind === "detail") {
      renderState(els.messagesEl, msg);
      renderState(els.factsEl, msg);
      renderState(els.eventsEl, msg);
      renderState(els.actionsEl, msg);
    } else {
      renderState(els.threadListEl, msg, "li");
    }
  }

  /** Map a write result to an honest state — NEVER a fake success (DoD box 3). */
  function handleWriteResult(r: WriteResult): void {
    switch (r.kind) {
      case "ok":            // the mutation landed → re-fetch so the change is visible
      case "stale":         // target already gone → a refresh reconciles the view honestly
        refreshCurrentView(); return;
      case "unauthorized":  applyDownState("unauthorized"); return; // 🔒 LOCKED
      case "unreachable":   applyDownState("unreachable"); return;  // DOWN — no fake success
      case "bad_request":   renderActionError(); return;            // client contract bug (unexpected)
    }
  }

  /** Honest inline error for a 400 (should not happen with correct bodies) — never fake success. */
  function renderActionError(): void {
    const msg = "Action rejected by the engine — please refresh and retry.";
    if (currentView.kind === "detail") {
      renderState(els.messagesEl, msg);
      renderState(els.factsEl, msg);
      renderState(els.eventsEl, msg);
      renderState(els.actionsEl, msg);
    } else {
      renderState(els.threadListEl, msg, "li");
    }
  }

  async function forgetAction(factId: string): Promise<void> {
    handleWriteResult(await forgetFact(deps.api, factId));
  }

  // chunk-05 (FACT-EDIT): NO session set for the badge — data-driven. On `ok`, refreshCurrentView()
  // re-fetches and the fact returns authored_by:"human" from the daemon, so the "yours" badge is
  // durable (survives restart). Facts are the ONLY editable surface post message-edit-removal
  // (hybrid-retrieval chunk-01, spec §3.7 R1).
  async function editFactAction(factId: string, newText: string): Promise<void> {
    handleWriteResult(await editFact(deps.api, factId, newText));
  }

  function onLivenessState(state: ShellState): void {
    const prev = lastLiveness;
    lastLiveness = state;
    if (prev === state) return; // repeated same-state poll -> no-op (never re-fetch every 3s)

    if (state === "connected") {
      // Down->up transition -> recover content without a restart. The initial connect
      // (prev === undefined) is already covered by start()'s loadList -> skip the double-fetch.
      if (prev !== undefined) refreshCurrentView();
      return;
    }
    // Transition into a non-connected state -> clear to the banner's honest state (never contradict).
    applyDownState(state);
  }

  function start(): void {
    els.backBtn.addEventListener("click", backToList);
    currentView = { kind: "list" };
    showList();
    void loadList();
  }
  return { start, onLivenessState };
}
