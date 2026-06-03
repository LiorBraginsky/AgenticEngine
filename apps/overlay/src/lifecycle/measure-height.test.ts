import { test, expect } from "bun:test";
import {
  clampWidgetHeight,
  WIDGET_MIN_HEIGHT,
  MAX_HEIGHT_FRACTION,
} from "./measure-height.js";

// Task 4.3 — height auto-resize (#44 core).
// clampWidgetHeight is pure and DOM-free — fully testable in isolation.

test("clampWidgetHeight clamps content below WIDGET_MIN_HEIGHT up to WIDGET_MIN_HEIGHT", () => {
  expect(clampWidgetHeight(20, 1000)).toBe(WIDGET_MIN_HEIGHT);
  expect(clampWidgetHeight(0, 1000)).toBe(WIDGET_MIN_HEIGHT);
  expect(clampWidgetHeight(WIDGET_MIN_HEIGHT - 1, 1000)).toBe(WIDGET_MIN_HEIGHT);
});

test("clampWidgetHeight passes through content within the valid range", () => {
  expect(clampWidgetHeight(300, 1000)).toBe(300);
  expect(clampWidgetHeight(WIDGET_MIN_HEIGHT, 1000)).toBe(WIDGET_MIN_HEIGHT);
  expect(clampWidgetHeight(200, 1000)).toBe(200);
});

test("clampWidgetHeight caps at floor(screenHeight * MAX_HEIGHT_FRACTION) for very tall content", () => {
  const ceiling = Math.floor(1000 * MAX_HEIGHT_FRACTION);
  expect(clampWidgetHeight(2000, 1000)).toBe(ceiling);
  expect(clampWidgetHeight(ceiling + 1, 1000)).toBe(ceiling);
  expect(clampWidgetHeight(ceiling, 1000)).toBe(ceiling);
});

test("MAX_HEIGHT_FRACTION is between 0.6 and 0.7 (65vh intent)", () => {
  expect(MAX_HEIGHT_FRACTION).toBeGreaterThanOrEqual(0.6);
  expect(MAX_HEIGHT_FRACTION).toBeLessThanOrEqual(0.7);
});

test("WIDGET_MIN_HEIGHT is 64", () => {
  expect(WIDGET_MIN_HEIGHT).toBe(64);
});
