/**
 * actions — DOM builders for forget-confirm + inline-edit. happy-dom via the root bunfig.toml
 * preload (same as render/controller tests). XSS: textContent/createElement only.
 */
import { test, expect } from "bun:test";
import { buildForgetControl, buildEditControl, buildForgetThreadControl } from "./actions.js";

function host(child: HTMLElement): HTMLElement {
  const d = document.createElement("div");
  d.appendChild(child);
  document.body.appendChild(d);
  return d;
}

test("forget: first click ARMS (does not confirm), second click confirms exactly once", () => {
  let confirmed = 0;
  const btn = buildForgetControl(() => { confirmed += 1; });
  host(btn);
  btn.click();
  expect(confirmed).toBe(0); // armed, not fired
  expect(btn.textContent).toContain("Release the reference");
  btn.click();
  expect(confirmed).toBe(1); // fired on confirm
  expect(btn.disabled).toBe(true); // locked after confirm — no double-fire
});

test("edit: opens a textarea seeded with current text; Save emits the edited text", () => {
  let saved = ""; // sentinel: onSave always passes non-empty textarea content (avoids TS narrowing a `null` sentinel across the closure boundary)
  const btn = buildEditControl("old", (t) => { saved = t; });
  const parent = host(btn);
  btn.click();
  const ta = parent.querySelector("textarea")!;
  expect(ta.value).toBe("old");
  ta.value = "corrected";
  parent.querySelector<HTMLButtonElement>(".act-save")!.click();
  expect(saved).toBe("corrected");
});

test("edit: Cancel closes the editor and re-enables the Edit button", () => {
  const btn = buildEditControl("old", () => { /* noop */ });
  const parent = host(btn);
  btn.click();
  expect(btn.disabled).toBe(true);
  const cancel = Array.from(parent.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
  cancel.click();
  expect(parent.querySelector(".inline-editor")).toBeNull();
  expect(btn.disabled).toBe(false);
});

test("edit: does not open a second editor on repeated Edit clicks", () => {
  const btn = buildEditControl("old", () => { /* noop */ });
  const parent = host(btn);
  btn.click();
  btn.click(); // ignored — editor already open (and btn is disabled)
  expect(parent.querySelectorAll(".inline-editor").length).toBe(1);
});

// thread-forget 2e (§3.4): the whole-conversation content-erase control.
test("forget-thread: initial state is the 'Forget conversation…' arm button, nothing armed", () => {
  const ctl = buildForgetThreadControl(3, () => { /* noop */ });
  host(ctl);
  const arm = ctl.querySelector<HTMLButtonElement>(".act-forget")!;
  expect(arm.textContent).toBe("Forget conversation…");
  expect(ctl.querySelector(".thread-forget-hint")).toBeNull(); // not armed yet
});

test("forget-thread: arming reveals the FROZEN §0.2 copy verbatim with the REAL message count", () => {
  const ctl = buildForgetThreadControl(7, () => { /* noop */ });
  host(ctl);
  ctl.querySelector<HTMLButtonElement>(".act-forget")!.click(); // arm
  const hint = ctl.querySelector(".thread-forget-hint")!;
  // Verbatim frozen copy — a user-facing contract (q#019 rider 3); N wired at build time.
  expect(hint.textContent).toBe("Erase this conversation's content (7 messages)? Distilled facts remain. Cannot be undone.");
});

test("forget-thread: Cancel disarms back to the arm button, onConfirm NOT called", () => {
  let confirmed = 0;
  const ctl = buildForgetThreadControl(2, () => { confirmed += 1; });
  host(ctl);
  ctl.querySelector<HTMLButtonElement>(".act-forget")!.click(); // arm
  ctl.querySelector<HTMLButtonElement>(".act-cancel")!.click(); // cancel
  expect(confirmed).toBe(0);
  expect(ctl.querySelector(".thread-forget-hint")).toBeNull();       // disarmed
  expect(ctl.querySelector<HTMLButtonElement>(".act-forget")!.textContent).toBe("Forget conversation…");
});

test("forget-thread: arm → Erase fires onConfirm exactly once and locks the button", () => {
  let confirmed = 0;
  const ctl = buildForgetThreadControl(1, () => { confirmed += 1; });
  host(ctl);
  ctl.querySelector<HTMLButtonElement>(".act-forget")!.click(); // arm
  const erase = Array.from(ctl.querySelectorAll<HTMLButtonElement>(".act-forget")).find((b) => b.textContent === "Erase conversation")!;
  erase.click(); // confirm
  expect(confirmed).toBe(1);
  expect(erase.disabled).toBe(true);   // locked — no double-fire
  erase.click();                       // second click is a no-op (disabled)
  expect(confirmed).toBe(1);
});
