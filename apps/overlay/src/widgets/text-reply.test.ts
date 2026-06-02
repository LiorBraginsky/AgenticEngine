/**
 * DOM-harness tests for renderTextReply (C3-2).
 * Uses the same happy-dom environment as the color-picker renderer tests.
 */
import { test, expect } from "bun:test";
import { renderTextReply } from "./text-reply.js";

function makeHost(): HTMLElement {
  const host = document.createElement("div");
  host.id = "widget-host";
  document.body.appendChild(host);
  return host;
}

test("renderTextReply produces a .text-reply-card inside the host", () => {
  const host = makeHost();
  renderTextReply(host, "hello world");
  const card = host.querySelector(".text-reply-card");
  expect(card).not.toBeNull();
});

test("renderTextReply produces a .text-reply-content inside the card with textContent equal to the input", () => {
  const host = makeHost();
  renderTextReply(host, "hello world");
  const content = host.querySelector(".text-reply-content");
  expect(content).not.toBeNull();
  expect(content!.textContent).toBe("hello world");
});

test("renderTextReply card also carries the .color-picker-widget base class (dark-card chrome reuse)", () => {
  const host = makeHost();
  renderTextReply(host, "hello world");
  const card = host.querySelector(".color-picker-widget.text-reply-card");
  expect(card).not.toBeNull();
});

test("renderTextReply sets text via textContent, not innerHTML — unconstrained string is safe", () => {
  const host = makeHost();
  const xssAttempt = '<script>alert("xss")</script>';
  renderTextReply(host, xssAttempt);
  const content = host.querySelector(".text-reply-content");
  expect(content).not.toBeNull();
  // textContent must equal the raw string — no HTML interpretation
  expect(content!.textContent).toBe(xssAttempt);
  // Must NOT have parsed it into a script element
  expect(host.querySelector("script")).toBeNull();
});

test("renderTextReply replaces previous content on successive calls (host is cleared)", () => {
  const host = makeHost();
  renderTextReply(host, "first");
  renderTextReply(host, "second");
  // Only one card should exist
  expect(host.querySelectorAll(".text-reply-card").length).toBe(1);
  expect(host.querySelector(".text-reply-content")!.textContent).toBe("second");
});
