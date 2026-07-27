/**
 * actions (chunk-03, memory-transparency-ui) — DOM builders for the ACT affordances.
 * XSS discipline (chunk-02 / history.html / text-reply.ts): textContent + createElement ONLY,
 * NEVER innerHTML. No fetch here (memory-write.ts) — these builders only emit DOM + callbacks.
 *
 * Forget = "release the reference": a two-step confirm (arm → confirm). The copy frames it as the
 * agent releasing its reference to the fact — the source conversation is UNTOUCHED (ADR-0015
 * durable fact-delete; decision 5 "also forget sources" is SUPERSEDED — no such option here).
 * Durable by design; no undo window — the confirm IS the safety.
 * Edit = an inline textarea → Save/Cancel. Generic over its caller's text/id; used by fact-edit
 * (render.ts, ADR-0012 5a). The message-edit call site was REMOVED (hybrid-retrieval chunk-01,
 * spec §3.7 R1) — this builder itself stays (shared primitive; do not remove).
 */

const RELEASE_LABEL = "Release the reference? (the agent forgets this — your conversation stays)";

/** Two-step forget button. First click arms (danger style + release-the-reference copy); the
 *  second click disables the button and calls onConfirm(). Returns the button element. */
export function buildForgetControl(onConfirm: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "act-btn act-forget";
  btn.textContent = "Forget fact";
  btn.addEventListener("click", () => {
    if (btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.classList.add("armed");
      btn.textContent = RELEASE_LABEL;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Releasing…";
    onConfirm();
  });
  return btn;
}

/** thread-forget 2e (§3.4) — the whole-conversation content-erase control (detail view only).
 *  A richer two-step than buildForgetControl: arm → {confirm | CANCEL} (demo item 6 needs a real
 *  disarm). Arming reveals the FROZEN §0.2 confirm copy [q#019 rider 3] — verbatim, with the REAL
 *  message count wired at render time (in scope in the caller's loaded view, not controller state
 *  [critic m6]). onConfirm fires exactly once, on the Erase click. Returns the container element. */
const THREAD_FORGET_LABEL = "Forget conversation…";
export function buildForgetThreadControl(messageCount: number, onConfirm: () => void): HTMLElement {
  const container = document.createElement("div");
  container.className = "thread-forget";

  const armBtn = document.createElement("button");
  armBtn.type = "button";
  armBtn.className = "act-btn act-forget";
  armBtn.textContent = THREAD_FORGET_LABEL;
  armBtn.addEventListener("click", arm);

  function disarm(): void { container.replaceChildren(armBtn); }

  function arm(): void {
    const hint = document.createElement("div");
    hint.className = "thread-forget-hint";
    // FROZEN §0.2 copy [q#019 rider 3] — verbatim; the ONLY user-facing contract string here.
    hint.textContent = `Erase this conversation's content (${messageCount} messages)? Distilled facts remain. Cannot be undone.`;

    const erase = document.createElement("button");
    erase.type = "button";
    erase.className = "act-btn act-forget armed";
    erase.textContent = "Erase conversation";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "act-btn act-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", disarm);

    erase.addEventListener("click", () => {
      erase.disabled = true;
      cancel.disabled = true;
      erase.textContent = "Erasing…";
      onConfirm();
    });

    container.replaceChildren(hint, erase, cancel);
  }

  disarm(); // initial state = the arm button alone
  return container;
}

/** Inline edit control for a message. The "Edit" button swaps in a textarea + Save/Cancel. Save
 *  calls onSave(newText) (the caller re-fetches → the fresh render replaces the editor). Cancel
 *  closes the editor. Returns the "Edit" button element. */
export function buildEditControl(current: string, onSave: (newText: string) => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "act-btn act-edit";
  btn.textContent = "Edit";
  btn.addEventListener("click", () => {
    const host = btn.parentElement;
    if (host === null || host.querySelector(".inline-editor") !== null) return; // already open
    btn.disabled = true;

    const editor = document.createElement("div");
    editor.className = "inline-editor";
    const ta = document.createElement("textarea");
    ta.value = current;
    ta.rows = 3;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "act-btn act-save";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "act-btn act-cancel";
    cancel.textContent = "Cancel";

    const close = (): void => { editor.remove(); btn.disabled = false; };
    cancel.addEventListener("click", close);
    save.addEventListener("click", () => {
      save.disabled = true;
      cancel.disabled = true;
      save.textContent = "Saving…";
      onSave(ta.value);
    });

    editor.appendChild(ta);
    editor.appendChild(save);
    editor.appendChild(cancel);
    host.appendChild(editor);
  });
  return btn;
}
