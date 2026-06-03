import { test, expect } from "bun:test";
import { statusForEndReason } from "./session-end-reason.js";

// Task 4.1 — D1: statusForEndReason pure unit tests.
// SessionEndReason is an OPEN enum — the function must never throw for unknown values.

test("statusForEndReason returns an error status for reason='error'", () => {
  const result = statusForEndReason("error");
  expect(result).not.toBeUndefined();
  expect(result!.variant).toBe("error");
  expect(result!.message).toBe("Something went wrong. Try again.");
  expect(result!.ms).toBe(2000);
});

test("statusForEndReason returns a timeout status for reason='timeout'", () => {
  const result = statusForEndReason("timeout");
  expect(result).not.toBeUndefined();
  expect(result!.variant).toBe("timeout");
  expect(result!.message).toBe("No response — the model is taking too long. Try again.");
  expect(result!.ms).toBe(2500);
});

test("statusForEndReason returns undefined for reason='completed'", () => {
  expect(statusForEndReason("completed")).toBeUndefined();
});

test("statusForEndReason returns undefined for reason='cancelled'", () => {
  expect(statusForEndReason("cancelled")).toBeUndefined();
});

test("statusForEndReason returns undefined for unknown reasons (open enum — never throw)", () => {
  expect(statusForEndReason("future_reason_from_daemon")).toBeUndefined();
  expect(statusForEndReason("")).toBeUndefined();
  expect(statusForEndReason("some_new_variant_v2")).toBeUndefined();
});
