import { test, expect, jest } from "bun:test";
import { HideScheduler } from "./hide-scheduler.js";

test("a pending hide does NOT fire after a new session supersedes it", () => {
  jest.useFakeTimers();
  try {
    const fired: string[] = [];
    const s = new HideScheduler();
    s.scheduleHide(1200, () => fired.push("session-A"));
    s.cancelPending();                       // a new session starts
    s.scheduleHide(1200, () => fired.push("session-B"));
    jest.advanceTimersByTime(1200);
    expect(fired).toEqual(["session-B"]);    // A's hide was cancelled
  } finally {
    jest.useRealTimers();
  }
});

test("cancelPending before the timer elapses fires nothing", () => {
  jest.useFakeTimers();
  try {
    let fired = false;
    const s = new HideScheduler();
    s.scheduleHide(1200, () => { fired = true; });
    s.cancelPending();
    jest.advanceTimersByTime(5000);
    expect(fired).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
