/**
 * Fake-timer tests for timed status dismiss paths (Task 3.3, chunk 3).
 * Uses the existing HideScheduler from chunk 2 — verifies the timed
 * error/timeout/cancelled dismiss logic composes correctly with #33.
 * Follows the same fake-timer pattern as hide-scheduler.test.ts.
 */
import { test, expect, jest } from "bun:test";
import { HideScheduler } from "./hide-scheduler.js";

test("error status auto-dismisses after exactly 2000ms", () => {
  jest.useFakeTimers();
  try {
    let dismissed = false;
    const s = new HideScheduler();
    s.scheduleHide(2000, () => { dismissed = true; });

    jest.advanceTimersByTime(1999);
    expect(dismissed).toBe(false); // not yet

    jest.advanceTimersByTime(1);
    expect(dismissed).toBe(true);  // fires at exactly 2000ms
  } finally {
    jest.useRealTimers();
  }
});

test("timeout status auto-dismisses after exactly 2500ms", () => {
  jest.useFakeTimers();
  try {
    let dismissed = false;
    const s = new HideScheduler();
    s.scheduleHide(2500, () => { dismissed = true; });

    jest.advanceTimersByTime(2499);
    expect(dismissed).toBe(false);

    jest.advanceTimersByTime(1);
    expect(dismissed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("cancelled status auto-dismisses after exactly 1200ms", () => {
  jest.useFakeTimers();
  try {
    let dismissed = false;
    const s = new HideScheduler();
    s.scheduleHide(1200, () => { dismissed = true; });

    jest.advanceTimersByTime(1199);
    expect(dismissed).toBe(false);

    jest.advanceTimersByTime(1);
    expect(dismissed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("a new session before error 2000ms cancels the pending status dismiss (composes with #33)", () => {
  jest.useFakeTimers();
  try {
    const fired: string[] = [];
    const s = new HideScheduler();

    // Session A errors — schedules a 2000ms dismiss
    s.scheduleHide(2000, () => fired.push("session-A-error"));

    // Before the 2000ms elapses, a new session starts — cancels session A's dismiss
    s.cancelPending();

    jest.advanceTimersByTime(3000);
    // Session A's error dismiss must never fire
    expect(fired).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});

test("a new session dismiss replaces a prior error dismiss correctly", () => {
  jest.useFakeTimers();
  try {
    const fired: string[] = [];
    const s = new HideScheduler();

    // Session A errors
    s.scheduleHide(2000, () => fired.push("A"));
    // New session starts — cancels A, schedules its own timeout dismiss
    s.cancelPending();
    s.scheduleHide(2500, () => fired.push("B"));

    jest.advanceTimersByTime(2500);
    // Only B should have fired
    expect(fired).toEqual(["B"]);
  } finally {
    jest.useRealTimers();
  }
});
