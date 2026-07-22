/**
 * DOM-harness tests for the memory read-UI renderers (happy-dom via test-setup/dom-preload).
 * Covers the load-bearing DoD bits: 0-fact event label, per-fact provenance jump-link +
 * callback, and the expiry/confidence "shown only when non-default" rule.
 */
import { test, expect } from "bun:test";
import { renderFacts, renderEvents, renderAuditEvents, renderThreadList, renderMessages, renderForgottenBanner } from "./render.js";
import type { DistilledFactView, DistillationEventView, MemoryActionEventView, ThreadSummary } from "./types.js";

function host(): HTMLElement { const d = document.createElement("div"); document.body.appendChild(d); return d; }
const baseFact: DistilledFactView = {
  id: "f1", fact: "likes blue", provenance: "thread:T1", scope: "cross-thread",
  expiry: null, confidence: 1, authored_by: "machine",
};

test("renderEvents: a 0-fact event renders the 'deliberately retained nothing' label", () => {
  const el = host();
  const ev: DistillationEventView = { facts_produced: 0, trigger: "dismiss", distiller_version: "v", created_at: 1 };
  renderEvents(el, [ev]);
  expect(el.textContent).toContain("deliberately retained nothing");
});

test("renderFacts: thread:<id> provenance is a jump-link firing onOpenThread(id)", () => {
  const el = host();
  let opened = ""; // sentinel: no valid thread id is ever "" (avoids TS narrowing a `null` sentinel across the closure boundary)
  renderFacts(el, [baseFact], (id) => { opened = id; });
  const link = el.querySelector<HTMLElement>(".prov-link");
  expect(link).not.toBeNull();
  link!.click();
  expect(opened).toBe("T1");
});

test("renderFacts: non-thread provenance renders as text, no jump-link", () => {
  const el = host();
  renderFacts(el, [{ ...baseFact, provenance: "id1,id2" }], () => {});
  expect(el.querySelector(".prov-link")).toBeNull();
  expect(el.textContent).toContain("id1,id2");
});

test("renderFacts: default expiry/confidence → NO expiry/confidence chrome", () => {
  const el = host();
  renderFacts(el, [baseFact], () => {});
  expect(el.querySelector(".fact-expiry")).toBeNull();
  expect(el.querySelector(".fact-confidence")).toBeNull();
});

test("renderFacts: non-default expiry/confidence ARE shown", () => {
  const el = host();
  renderFacts(el, [{ ...baseFact, expiry: 1730000000000, confidence: 0.5 }], () => {});
  expect(el.querySelector(".fact-expiry")).not.toBeNull();
  expect(el.querySelector(".fact-confidence")).not.toBeNull();
});

test("renderThreadList: click fires onOpen(thread_id); status shown when present", () => {
  const el = host();
  let opened = ""; // sentinel: no valid thread id is ever "" (avoids TS narrowing a `null` sentinel across the closure boundary)
  const t: ThreadSummary = { thread_id: "T9", title: "Hi", last_active_at: 1, status: "dismissed" };
  renderThreadList(el, [t], (id) => { opened = id; });
  expect(el.textContent).toContain("dismissed");
  el.querySelector<HTMLElement>(".thread-list-item")!.click();
  expect(opened).toBe("T9");
});

test("chunk-03: renderFacts with onForget appends a forget control; arm→confirm passes the fact id", () => {
  const el = document.createElement("div");
  let forgot = ""; // sentinel: no valid fact id is ever "" (avoids TS narrowing a `null` sentinel across the closure boundary)
  renderFacts(
    el,
    [{ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    () => { /* onOpenThread */ },
    { onForget: (id) => { forgot = id; } },
  );
  const btn = el.querySelector<HTMLButtonElement>(".act-forget")!;
  btn.click(); // arm
  expect(forgot).toBe(""); // not yet fired
  btn.click(); // confirm
  expect(forgot).toBe("F1");
});

test("hybrid-retrieval chunk-01: renderMessages never renders an edit control (message-edit removed; archive is read-only)", () => {
  const el = document.createElement("div");
  renderMessages(el, [{ id: "M1", role: "user", content: "hi" }]);
  expect(el.querySelector(".act-edit")).toBeNull();
  expect(el.textContent).not.toContain("edited by you");
});

test("renderFacts: onEditFact attaches an Edit control that saves the fact id + new text", () => {
  const el = document.createElement("div");
  const saved: { id: string; text: string }[] = [];
  renderFacts(el, [{ id: "F1", fact: "colour blue", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }],
    () => {}, { onEditFact: (id, text) => saved.push({ id, text }) });
  (el.querySelector(".act-edit") as HTMLButtonElement).click();      // open inline editor
  const ta = el.querySelector(".inline-editor textarea") as HTMLTextAreaElement;
  expect(ta.value).toBe("colour blue");                              // prefilled with current text
  ta.value = "colour green";
  (el.querySelector(".act-save") as HTMLButtonElement).click();
  expect(saved).toEqual([{ id: "F1", text: "colour green" }]);
});
test("renderFacts: persistent 'yours' badge iff authored_by==='human' (data-driven, not session)", () => {
  const el = document.createElement("div");
  renderFacts(el, [
    { id: "H", fact: "human fact", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "human" },
    { id: "M", fact: "machine fact", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" },
  ], () => {});
  const rows = el.querySelectorAll(".fact-row");
  const badge = rows[0]!.querySelector(".human-badge");
  expect(badge).not.toBeNull();     // human → badge
  expect(rows[1]!.querySelector(".human-badge")).toBeNull();          // machine → no badge
  // inline placement: badge is appended INTO the fact-text element (same line), not a
  // sibling block of .fact-row — i.e. its parent is the row's first child (factEl), not the row itself.
  const factTextEl = rows[0]!.children[0] as HTMLElement;
  expect(badge!.parentElement).toBe(factTextEl);
  expect(badge!.parentElement).not.toBe(rows[0]);
});

// thread-forget 2e (§3.5): the erased-husk banner.
test("renderForgottenBanner: renders the neutral erased banner, no content-derived string", () => {
  const el = host();
  renderForgottenBanner(el);
  const banner = el.querySelector(".erased-banner")!;
  expect(banner).not.toBeNull();
  expect(banner.textContent).toBe("You erased this conversation's content. Distilled facts remain.");
});

test("renderForgottenBanner: replaces prior content (message list → banner), no leak of prior text", () => {
  const el = host();
  renderMessages(el, [{ id: "m1", role: "user", content: "my secret plaintext" }]); // pre-erase render
  expect(el.textContent).toContain("my secret plaintext");
  renderForgottenBanner(el); // erase → banner replaces the message list
  expect(el.textContent).not.toContain("my secret plaintext"); // no-content-leak (q#019 rider 1)
  expect(el.querySelector(".message-row")).toBeNull();
});

// chunk-04 (2c D9b): render-only agent memory-action audit trail.
const baseAuditEvent: MemoryActionEventView = {
  action: "forget", outcome: "applied", fact_text: "likes tea", actor: "agent", created_at: 1,
};

test("renderAuditEvents: an applied forget row renders action + outcome + fact_text + agent attribution", () => {
  const el = host();
  renderAuditEvents(el, [baseAuditEvent]);
  expect(el.textContent).toContain("forget");
  expect(el.textContent).toContain("applied");
  expect(el.textContent).toContain("likes tea");
  expect(el.textContent).toContain("agent");
});

test("renderAuditEvents: a refused row renders its outcome", () => {
  const el = host();
  renderAuditEvents(el, [{ ...baseAuditEvent, outcome: "refused-refused_human_fact" }]);
  expect(el.textContent).toContain("refused-refused_human_fact");
});

test("renderAuditEvents: empty array renders the honest 'No memory actions.' state", () => {
  const el = host();
  renderAuditEvents(el, []);
  expect(el.textContent).toContain("No memory actions.");
});

test("renderAuditEvents: render-only guard — NO interaction affordances in the rendered subtree", () => {
  const el = host();
  renderAuditEvents(el, [baseAuditEvent]);
  expect(el.querySelector(".act-btn")).toBeNull();
  expect(el.querySelector(".act-forget")).toBeNull();
  expect(el.querySelector(".act-edit")).toBeNull();
  expect(el.querySelector(".inline-editor")).toBeNull();
});
