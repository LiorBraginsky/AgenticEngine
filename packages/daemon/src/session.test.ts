import { test, expect } from "bun:test";
import { handleSessionStart } from "./session.js";

test("session_start ⇒ [session_ack(minted id, echoed client id), session_end(completed)]", () => {
  const replies = handleSessionStart({
    type: "session_start",
    trigger: "user",
    text: "hello",
    client_session_id: "c-123",
  });
  expect(replies).toHaveLength(2);

  const ack = replies[0]!;
  expect(ack.type).toBe("session_ack");
  if (ack.type === "session_ack") {
    expect(typeof ack.session_id).toBe("string");
    expect(ack.session_id.length).toBeGreaterThan(0);
    expect(ack.client_session_id).toBe("c-123");
  }

  const end = replies[1]!;
  expect(end.type).toBe("session_end");
  if (end.type === "session_end") {
    expect(end.reason).toBe("completed");
    if (ack.type === "session_ack") expect(end.session_id).toBe(ack.session_id);
  }
});

test("daemon mints a fresh session_id per call (crypto.randomUUID)", () => {
  const a = handleSessionStart({ type: "session_start", trigger: "user" });
  const b = handleSessionStart({ type: "session_start", trigger: "user" });
  const idA = a[0]!.type === "session_ack" ? a[0]!.session_id : "";
  const idB = b[0]!.type === "session_ack" ? b[0]!.session_id : "";
  expect(idA).not.toBe(idB);
});
