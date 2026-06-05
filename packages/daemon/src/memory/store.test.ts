import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "mf01-"));
  return { store: new MemoryStore({ dataDir: dir }), dir };
}

test("createThread + appendMessages persist to SQLite and the JSONL mirror", () => {
  const { store, dir } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "deploy script is yeet.sh" }], "sess-1");
  const tail = store.readThreadTail(t, 10);
  expect(tail).toEqual([{ role: "user", content: "deploy script is yeet.sh" }]);
  const mirror = join(dir, "threads", `${t}.jsonl`);
  expect(existsSync(mirror)).toBe(true);
  expect(readFileSync(mirror, "utf8")).toContain("yeet.sh");
  store.close();
});

test("appendMessages assigns monotonic turn_index across calls", () => {
  const { store } = freshStore();
  const t = store.createThread();
  store.appendMessages(t, [{ role: "user", content: "a" }], "s1");
  store.appendMessages(t, [{ role: "user", content: "b" }, { role: "assistant", content: "c" }], "s2");
  expect(store.readThreadTail(t, 10)).toEqual([
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
  ]);
  store.close();
});

test("readThreadTail respects the limit and returns the most recent N in order", () => {
  const { store } = freshStore();
  const t = store.createThread();
  for (let i = 0; i < 5; i++) store.appendMessages(t, [{ role: "user", content: `m${i}` }], "s");
  expect(store.readThreadTail(t, 2)).toEqual([
    { role: "user", content: "m3" },
    { role: "user", content: "m4" },
  ]);
  store.close();
});

test("threadExists distinguishes a minted thread from an unknown id", () => {
  const { store } = freshStore();
  const t = store.createThread();
  expect(store.threadExists(t)).toBe(true);
  expect(store.threadExists("nope")).toBe(false);
  store.close();
});
