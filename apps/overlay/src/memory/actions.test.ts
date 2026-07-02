/**
 * actions — DOM builders for forget-confirm + inline-edit. happy-dom via the root bunfig.toml
 * preload (same as render/controller tests). XSS: textContent/createElement only.
 */
import { test, expect } from "bun:test";
import { buildForgetControl, buildEditControl } from "./actions.js";

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
