import { test, expect } from "bun:test";
import { isOriginAllowed } from "./origin.js";

test("ALLOW: Tauri prod origin (macOS/Linux)", () => {
  expect(isOriginAllowed("tauri://localhost")).toBe(true);
});
test("ALLOW: Tauri prod origin (Windows/Android)", () => {
  expect(isOriginAllowed("http://tauri.localhost")).toBe(true);
});
test("ALLOW: tauri dev Vite default", () => {
  expect(isOriginAllowed("http://localhost:1420")).toBe(true);
});
test("REJECT: arbitrary cross-site origin", () => {
  expect(isOriginAllowed("https://evil.example.com")).toBe(false);
});
test("REJECT: wrong localhost port", () => {
  expect(isOriginAllowed("http://localhost:3000")).toBe(false);
});
test("REJECT: missing origin", () => {
  expect(isOriginAllowed(null)).toBe(false);
});
