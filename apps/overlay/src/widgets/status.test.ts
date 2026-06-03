/**
 * DOM-harness tests for status renderers (Task 3.2).
 * Follows the text-reply.test.ts makeHost() pattern.
 */
import { test, expect } from "bun:test";
import { renderLoader, renderStatus } from "./status.js";

function makeHost(): HTMLElement {
  const host = document.createElement("div");
  host.id = "widget-host";
  document.body.appendChild(host);
  return host;
}

// ---------------------------------------------------------------------------
// renderLoader
// ---------------------------------------------------------------------------
test("renderLoader produces a .status-loader inside the host", () => {
  const host = makeHost();
  renderLoader(host);
  const loader = host.querySelector(".status-loader");
  expect(loader).not.toBeNull();
});

test("renderLoader wraps content in .color-picker-widget dark-card chrome", () => {
  const host = makeHost();
  renderLoader(host);
  const card = host.querySelector(".color-picker-widget");
  expect(card).not.toBeNull();
});

test("renderLoader replaces previous content (host is cleared)", () => {
  const host = makeHost();
  renderLoader(host);
  renderLoader(host);
  // Only one .color-picker-widget should exist
  expect(host.querySelectorAll(".color-picker-widget").length).toBe(1);
});

// ---------------------------------------------------------------------------
// renderStatus — error variant
// ---------------------------------------------------------------------------
test("renderStatus error produces .status-card.status-error with textContent containing the message", () => {
  const host = makeHost();
  renderStatus(host, "error", "Something went wrong");
  const card = host.querySelector(".status-card.status-error");
  expect(card).not.toBeNull();
  expect(card!.textContent).toContain("Something went wrong");
});

test("renderStatus error wraps in .color-picker-widget dark-card chrome", () => {
  const host = makeHost();
  renderStatus(host, "error", "boom");
  expect(host.querySelector(".color-picker-widget")).not.toBeNull();
});

// ---------------------------------------------------------------------------
// renderStatus — timeout variant
// ---------------------------------------------------------------------------
test("renderStatus timeout produces .status-card.status-timeout with the message", () => {
  const host = makeHost();
  renderStatus(host, "timeout", "No response — the model is taking too long. Try again.");
  const card = host.querySelector(".status-card.status-timeout");
  expect(card).not.toBeNull();
  expect(card!.textContent).toContain("No response");
});

// ---------------------------------------------------------------------------
// renderStatus — cancelled variant
// ---------------------------------------------------------------------------
test("renderStatus cancelled produces .status-card.status-cancelled with the message", () => {
  const host = makeHost();
  renderStatus(host, "cancelled", "Cancelled");
  const card = host.querySelector(".status-card.status-cancelled");
  expect(card).not.toBeNull();
  expect(card!.textContent).toBe("Cancelled");
});

// ---------------------------------------------------------------------------
// XSS safety — textContent, NEVER innerHTML
// ---------------------------------------------------------------------------
test("renderStatus uses textContent not innerHTML (XSS safety)", () => {
  const host = makeHost();
  const xss = '<script>alert("xss")</script>';
  renderStatus(host, "error", xss);
  expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector(".status-error")!.textContent).toBe(xss);
});

// ---------------------------------------------------------------------------
// replaceChildren
// ---------------------------------------------------------------------------
test("renderStatus replaces previous content on successive calls", () => {
  const host = makeHost();
  renderStatus(host, "error", "first");
  renderStatus(host, "cancelled", "second");
  expect(host.querySelectorAll(".color-picker-widget").length).toBe(1);
  expect(host.querySelector(".status-cancelled")).not.toBeNull();
});
