import { test, expect } from "bun:test";
import { Envelope, SessionEndReason, Trigger, parseEnvelope } from "./envelope.js";

test("valid session_start (trigger: user) parses", () => {
  const r = parseEnvelope({ type: "session_start", trigger: "user", text: "hi" });
  expect(r.kind).toBe("ok");
});

test("session_ack parses (D3 — in the frozen union)", () => {
  const r = parseEnvelope({ type: "session_ack", session_id: "s1", client_session_id: "c1" });
  expect(r.kind).toBe("ok");
});

test("session_end with KNOWN reason parses", () => {
  expect(parseEnvelope({ type: "session_end", session_id: "s1", reason: "completed" }).kind).toBe("ok");
});

test("session_end with UNKNOWN reason tolerated (open/degradable, D1)", () => {
  expect(SessionEndReason.safeParse("rate_limited").success).toBe(true);
  expect(parseEnvelope({ type: "session_end", session_id: "s1", reason: "rate_limited" }).kind).toBe("ok");
});

test("trigger is a CLOSED enum (D1)", () => {
  expect(Trigger.safeParse("user").success).toBe(true);
  expect(Trigger.safeParse("cron").success).toBe(true);
  expect(Trigger.safeParse("external").success).toBe(true);
  expect(Trigger.safeParse("webhook").success).toBe(false);
});

test("session_start with UNKNOWN trigger ⇒ invalid (known type, bad body), no throw", () => {
  const r = parseEnvelope({ type: "session_start", trigger: "webhook" });
  expect(r.kind).toBe("invalid"); // known type, closed-enum violation — daemon must not crash
});

test("unknown message type ⇒ graceful 'unknown', no throw", () => {
  const r = parseEnvelope({ type: "telepathy", foo: 1 });
  expect(r.kind).toBe("unknown");
  if (r.kind === "unknown") expect(r.type).toBe("telepathy");
});

test("totally malformed input ⇒ unknown/invalid, never throws", () => {
  expect(() => parseEnvelope(null)).not.toThrow();
  expect(() => parseEnvelope(42)).not.toThrow();
  expect(parseEnvelope({}).kind).toBe("unknown");
});

test("tool_call envelope with valid payload parses", () => {
  const r = parseEnvelope({
    type: "tool_call",
    session_id: "s1",
    call_id: "c1",
    payload: {
      tool: "show_color_picker",
      args: { picker: { primitive: "color-picker", question: "q", palette: [{ label: "Navy", hex: "#1A2B3C" }] } },
    },
  });
  expect(r.kind).toBe("ok");
});

test("Envelope union has exactly 6 known message types", () => {
  // discriminatedUnion options length is the structural witness of the count.
  expect(Envelope.options.length).toBe(6);
});
