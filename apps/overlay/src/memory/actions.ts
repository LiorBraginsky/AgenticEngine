/**
 * actions (chunk-03, memory-transparency-ui) — DOM builders for the ACT affordances.
 * XSS discipline (chunk-02 / history.html / text-reply.ts): textContent + createElement ONLY,
 * NEVER innerHTML. No fetch here (memory-write.ts) — these builders only emit DOM + callbacks.
 *
 * Forget = "release the reference": a two-step confirm (arm → confirm). The copy frames it as the
 * agent releasing its reference to the fact — the source conversation is UNTOUCHED (ADR-0015
 * durable fact-delete; decision 5 "also forget sources" is SUPERSEDED — no such option here).
 * Durable by design; no undo window — the confirm IS the safety.
 * Edit = an inline textarea over a MESSAGE → Save/Cancel (MUTATION-AS-APPEND human correction).
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
