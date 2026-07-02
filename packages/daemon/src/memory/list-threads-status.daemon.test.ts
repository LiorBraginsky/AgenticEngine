/**
 * listThreads status field — chunk-02 (memory-transparency-ui), additive read gap.
 * Real store, no mocks. Asserts each row carries `status`, and a dismissed thread
 * reports 'dismissed'. Additive-only: existing keys (thread_id/title/last_active_at)
 * unchanged. history.html (parity target) ignores the extra key.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

test("listThreads returns status for each thread; dismissed reflected", () => {
  const store = new MemoryStore({ dataDir: mkdtempSync(join(tmpdir(), "lt-")) });
  const active = store.createThread("Active one");
  const dismissed = store.createThread("Dismissed one");
  store.rawDb().query("UPDATE threads SET status = 'dismissed' WHERE thread_id = ?").run(dismissed);

  const rows = store.listThreads();
  const byId = new Map(rows.map((r) => [r.thread_id, r]));
  expect(byId.get(active)?.status).toBe("active");
  expect(byId.get(dismissed)?.status).toBe("dismissed");
  // additive: original fields intact
  expect(typeof byId.get(active)?.last_active_at).toBe("number");
  store.close();
});
