/**
 * MF-05 T2.1b — TokenStore unit tests.
 *
 * TDD: tests written FIRST (RED), then minimal impl to go GREEN.
 *
 * Uses mkdtempSync per test — no shared state between tests.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { statSync } from "node:fs";
import { TokenStore } from "./token-store.js";

// ─── Test 1: mints a 0o600 token file on first construction ──────────────────

test("T2.1b-1: first construction mints an auth-token file with 0o600 perms and token length ≥ 32", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf05-tok-"));
  const ts = new TokenStore(dir);

  const tokenPath = join(dir, "auth-token");
  const stat = statSync(tokenPath);
  // unix perm bits only
  expect(stat.mode & 0o777).toBe(0o600);

  const tok = ts.token();
  expect(typeof tok).toBe("string");
  expect(tok.length).toBeGreaterThanOrEqual(32);
});

// ─── Test 2: second construction reuses the SAME token ───────────────────────

test("T2.1b-2: second TokenStore on the same dir returns the same token (not re-minted)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf05-tok-"));
  const ts1 = new TokenStore(dir);
  const first = ts1.token();

  const ts2 = new TokenStore(dir);
  const second = ts2.token();

  expect(second).toBe(first);
});

// ─── Test 3: verify() accepts "Bearer <minted>" ───────────────────────────────

test("T2.1b-3: verify() accepts the correctly-prefixed minted token", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf05-tok-"));
  const ts = new TokenStore(dir);
  expect(ts.verify(`Bearer ${ts.token()}`)).toBe(true);
});

// ─── Test 4: verify() rejects "Bearer <wrong>" ───────────────────────────────

test("T2.1b-4: verify() rejects Bearer with a wrong value", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf05-tok-"));
  const ts = new TokenStore(dir);
  expect(ts.verify("Bearer wrongtoken")).toBe(false);
});

// ─── Test 5: verify() rejects undefined ──────────────────────────────────────

test("T2.1b-5: verify() rejects undefined auth header", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf05-tok-"));
  const ts = new TokenStore(dir);
  expect(ts.verify(undefined)).toBe(false);
});

// ─── Test 6: verify() rejects null ───────────────────────────────────────────

test("T2.1b-6: verify() rejects null auth header", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf05-tok-"));
  const ts = new TokenStore(dir);
  expect(ts.verify(null)).toBe(false);
});

// ─── Test 7: verify() rejects bare token without "Bearer " scheme ─────────────

test("T2.1b-7: verify() rejects bare token without the Bearer scheme", () => {
  const dir = mkdtempSync(join(tmpdir(), "mf05-tok-"));
  const ts = new TokenStore(dir);
  // Pass the raw token string with no prefix — must be rejected
  expect(ts.verify(ts.token())).toBe(false);
});
