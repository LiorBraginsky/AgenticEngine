import { test, expect } from "bun:test";
import { dismissPolicy } from "./dismiss-policy.js";

test("content (text) persists — no timer", () => {
  expect(dismissPolicy("text")).toEqual({ kind: "persist" });
});

test("picker persists — user-driven settle", () => {
  expect(dismissPolicy("picker")).toEqual({ kind: "persist" });
});

test("loader is until-replaced — no timer, replaced when content arrives", () => {
  expect(dismissPolicy("loader")).toEqual({ kind: "until-replaced" });
});

test("error status auto-dismisses after 2000ms", () => {
  expect(dismissPolicy("error")).toEqual({ kind: "timed", ms: 2000 });
});

test("timeout status auto-dismisses after 2500ms (longer — friendly message needs reading time)", () => {
  expect(dismissPolicy("timeout")).toEqual({ kind: "timed", ms: 2500 });
});

test("cancelled status auto-dismisses after 1200ms", () => {
  expect(dismissPolicy("cancelled")).toEqual({ kind: "timed", ms: 1200 });
});

test("picker confirmation auto-dismisses after 1200ms (ADR-0006 2026-06-01 unchanged)", () => {
  expect(dismissPolicy("confirmation")).toEqual({ kind: "timed", ms: 1200 });
});
