import { test, expect } from "bun:test";
import { parseEnvelope } from "@agentic/protocol";
import { buildSessionStart } from "./session-client.js";

// CM-03 (carry-forward 1): the free per-turn-socket runSession was retired —
// ConnectionManager.runSession is the ONE socket-lifetime contract, and its
// suite (connection-manager.test.ts) carries the lifetime + routeInbound
// coverage (including the assertions migrated from this file). What remains
// here are the pure-export tests for buildSessionStart.

test("buildSessionStart produces a valid frozen-contract session_start (trigger:user)", () => {
  const { msg } = buildSessionStart("hello");
  const parsed = parseEnvelope(msg);
  expect(parsed.kind).toBe("ok");
  expect(msg.type).toBe("session_start");
  expect(msg.trigger).toBe("user");
  expect(msg.text).toBe("hello");
  expect(typeof msg.client_session_id).toBe("string");
});

// ---------------------------------------------------------------------------
// Task 3 (CM-01): threadId option — continuation turn vs new conversation
// ---------------------------------------------------------------------------
test("buildSessionStart includes thread_id when supplied (continuation turn)", () => {
  const tid = "11111111-2222-4333-8444-555555555555";
  const { msg } = buildSessionStart("hello", tid);
  expect(msg.thread_id).toBe(tid);
  expect(parseEnvelope(msg).kind).toBe("ok"); // still a valid frozen-contract session_start
});

test("buildSessionStart omits thread_id when not supplied (first turn / new conversation)", () => {
  const { msg } = buildSessionStart("hello");
  expect(msg.thread_id).toBeUndefined();
});
