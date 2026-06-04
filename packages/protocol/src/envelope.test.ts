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

// ── Task 3: show_text envelope round-trip + RC-1 guard ────────────────────────

test("tool_call envelope with show_text payload parses (display-only primitive)", () => {
  const r = parseEnvelope({
    type: "tool_call",
    session_id: "s1",
    call_id: "c2",
    payload: { tool: "show_text", args: { text: { primitive: "text", content: "Sunset orange is #FF5E3A." } } },
  });
  expect(r.kind).toBe("ok");
});

test("Envelope union STILL has exactly 6 known message types (show_text is a TOOL, not an envelope variant)", () => {
  // RC-1: show_text is additive to the TOOL union, never the envelope union.
  expect(Envelope.options.length).toBe(6);
});

test("session_start with optional thread_id parses (additive field, MF-01)", () => {
  const r = parseEnvelope({ type: "session_start", trigger: "user", text: "hi", thread_id: "t-1" });
  expect(r.kind).toBe("ok");
  if (r.kind === "ok" && r.message.type === "session_start") {
    expect(r.message.thread_id).toBe("t-1");
  }
});

test("session_start WITHOUT thread_id still parses (field is optional)", () => {
  expect(parseEnvelope({ type: "session_start", trigger: "user", text: "hi" }).kind).toBe("ok");
});

test("adding thread_id does NOT grow the envelope union (still 6 variants)", () => {
  expect(Envelope.options.length).toBe(6);
});
