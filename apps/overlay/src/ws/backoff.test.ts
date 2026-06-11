import { test, expect } from "bun:test";
import { backoffCeilingMs, backoffDelayMs } from "./backoff.js";

test("backoff ceiling: base, doubles, caps at 10s, no overflow", () => {
  expect(backoffCeilingMs(0, 500, 10_000)).toBe(500);
  expect(backoffCeilingMs(1, 500, 10_000)).toBe(1000);
  expect(backoffCeilingMs(2, 500, 10_000)).toBe(2000);
  expect(backoffCeilingMs(3, 500, 10_000)).toBe(4000);
  expect(backoffCeilingMs(4, 500, 10_000)).toBe(8000);
  expect(backoffCeilingMs(5, 500, 10_000)).toBe(10_000);
  expect(backoffCeilingMs(50, 500, 10_000)).toBe(10_000);
});

test("backoff full jitter: delay = floor(random * ceiling)", () => {
  expect(backoffDelayMs(5, { baseMs: 500, capMs: 10_000, random: () => 0.5 })).toBe(5000);
  expect(backoffDelayMs(0, { baseMs: 500, capMs: 10_000, random: () => 0.9 })).toBe(450);
  expect(backoffDelayMs(5, { baseMs: 500, capMs: 10_000, random: () => 0 })).toBe(0);
});

test("backoff: result is always a non-negative integer", () => {
  for (let n = 0; n < 12; n++) {
    const d = backoffDelayMs(n, { baseMs: 500, capMs: 10_000, random: Math.random });
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
  }
});
