/**
 * controller — list<->detail nav + the Demo-1 (item 4) state-sync coupling.
 * happy-dom via test-setup/dom-preload. Fake fetchFn with a switchable up/down mode + a call
 * counter. Reproduces the demo defect: a daemon kill must CLEAR content to the banner's honest
 * state (never contradict), a later start must RECOVER content without a restart, and repeated
 * same-state polls must NOT re-fetch (no every-3s flicker/waste). This is the test that would
 * have caught item 4 — the controller shipped with no unit test.
 */
import { test, expect } from "bun:test";
import {
  createMemoryController,
  type MemoryController,
  type MemoryControllerEls,
} from "./controller.js";

function host(): HTMLElement { const d = document.createElement("div"); document.body.appendChild(d); return d; }
function makeEls(): MemoryControllerEls {
  return {
    listView: host(), detailView: host(),
    threadListEl: host(), messagesEl: host(), factsEl: host(), eventsEl: host(),
    backBtn: host(),
  };
}

interface FakeFetch {
  fn: (url: string, init?: RequestInit) => Promise<Response>;
  setMode: (m: "up" | "down") => void;
  calls: () => number;
}
function makeFetch(): FakeFetch {
  let mode: "up" | "down" = "up";
  let calls = 0;
  const fn = (url: string): Promise<Response> => {
    calls += 1;
    if (mode === "down") return Promise.reject(new Error("connection refused"));
    const body = url.includes("/memory/thread/")
      ? { messages: [{ id: "m1", role: "user", content: "hi" }], distilledFacts: [], distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { fn, setMode: (m) => { mode = m; }, calls: () => calls };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
function make(f: FakeFetch): { c: MemoryController; els: MemoryControllerEls } {
  const els = makeEls();
  const c = createMemoryController({
    api: { fetchFn: f.fn, baseUrl: "http://127.0.0.1:7777", token: "TOK" },
    els,
  });
  return { c, els };
}

test("item 4a: daemon-down transition CLEARS the list to the banner's honest 'unreachable' (never contradict)", async () => {
  const f = makeFetch();
  const { c, els } = make(f);
  c.start();
  await flush();
  expect(els.threadListEl.querySelector(".thread-list-item")).not.toBeNull(); // rendered while up

  c.onLivenessState("connected");   // initial connect baseline (prev undefined -> no re-fetch)
  f.setMode("down");
  c.onLivenessState("unreachable"); // the daemon-kill transition (synchronous down-render)
  expect(els.threadListEl.textContent).toContain("Daemon unreachable");
  expect(els.threadListEl.querySelector(".thread-list-item")).toBeNull(); // stale list cleared
});

test("item 4c: connected transition RE-FETCHES and recovers the list WITHOUT a restart", async () => {
  const f = makeFetch();
  const { c, els } = make(f);
  c.start();
  await flush();
  c.onLivenessState("connected");   // baseline
  f.setMode("down");
  c.onLivenessState("unreachable"); // down
  expect(els.threadListEl.textContent).toContain("Daemon unreachable");

  f.setMode("up");
  c.onLivenessState("connected");   // recovery transition (unreachable -> connected)
  await flush();
  expect(els.threadListEl.querySelector(".thread-list-item")).not.toBeNull(); // recovered, no restart
});

test("item 4: repeated same-state 'connected' polls do NOT re-fetch (no every-3s flicker/waste)", async () => {
  const f = makeFetch();
  const { c } = make(f);
  c.start();
  await flush();
  const afterStart = f.calls();     // start()'s single loadList
  c.onLivenessState("connected");   // initial connect -> no re-fetch (prev undefined)
  c.onLivenessState("connected");   // repeat -> de-duped
  c.onLivenessState("connected");   // repeat -> de-duped
  await flush();
  expect(f.calls()).toBe(afterStart); // zero extra fetches from the poll
});

test("item 4: down->up while viewing a thread clears AND recovers the detail view consistently", async () => {
  const f = makeFetch();
  const { c, els } = make(f);
  c.start();
  await flush();
  c.onLivenessState("connected");   // baseline
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); // open thread
  await flush();
  expect(els.messagesEl.textContent).toContain("hi"); // detail rendered while up

  f.setMode("down");
  c.onLivenessState("unreachable"); // kill while in detail
  expect(els.messagesEl.textContent).toContain("Daemon unreachable");
  expect(els.factsEl.textContent).toContain("Daemon unreachable");
  expect(els.eventsEl.textContent).toContain("Daemon unreachable");

  f.setMode("up");
  c.onLivenessState("connected");   // recover -> re-fetch the SAME open thread
  await flush();
  expect(els.messagesEl.textContent).toContain("hi"); // detail recovered, still on the same thread
});

// Reviewer minor (Demo-1 state-sync fix): a stale in-flight loadThread that resolves AFTER a
// down transition must NOT overwrite the honest "Daemon unreachable" render with its stale
// content. Fake fetchFn defers the /memory/thread/ response until resolveThread() is called
// manually, so we control exactly when the "daemon served the response then died" race lands.
interface DeferredThreadFetch {
  fn: (url: string, init?: RequestInit) => Promise<Response>;
  resolveThread: (body: unknown) => void;
}
function makeDeferredThreadFetch(): DeferredThreadFetch {
  let resolve!: (res: Response) => void;
  const fn = (url: string): Promise<Response> => {
    if (url.includes("/memory/thread/")) {
      return new Promise<Response>((r) => { resolve = r; });
    }
    const body = { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return {
    fn,
    resolveThread: (body: unknown) => resolve(new Response(JSON.stringify(body), { status: 200 })),
  };
}

test("race guard: a stale in-flight loadThread resolving AFTER a down transition does NOT overwrite the honest 'Daemon unreachable' with stale content", async () => {
  const f = makeDeferredThreadFetch();
  const els = makeEls();
  const c = createMemoryController({
    api: { fetchFn: f.fn, baseUrl: "http://127.0.0.1:7777", token: "TOK" },
    els,
  });
  c.start();
  await flush();
  c.onLivenessState("connected"); // baseline

  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); // open thread -> loadThread in flight, deferred
  await flush();
  expect(els.messagesEl.textContent).toContain("Loading"); // thread fetch not resolved yet

  c.onLivenessState("unreachable"); // down transition WHILE the stale loadThread is in flight
  expect(els.messagesEl.textContent).toContain("Daemon unreachable");

  // The stale in-flight response now lands (daemon served it, then died).
  f.resolveThread({ messages: [{ id: "m1", role: "user", content: "hi" }], distilledFacts: [], distillationEvents: [] });
  await flush();

  // Must STAY "Daemon unreachable" — the stale response must not clobber the honest down-state.
  expect(els.messagesEl.textContent).toContain("Daemon unreachable");
  expect(els.messagesEl.textContent).not.toContain("hi");
  expect(els.factsEl.textContent).toContain("Daemon unreachable");
  expect(els.eventsEl.textContent).toContain("Daemon unreachable");
});

test("unauthorized branch: applyDownState renders the LOCKED message and unauthorized -> connected recovers (re-fetches)", async () => {
  const f = makeFetch();
  const { c, els } = make(f);
  c.start();
  await flush();
  expect(els.threadListEl.querySelector(".thread-list-item")).not.toBeNull(); // rendered while up

  c.onLivenessState("connected");     // baseline
  c.onLivenessState("unauthorized");  // token rejected while content rendered
  expect(els.threadListEl.textContent).toContain("🔒 Token rejected");
  expect(els.threadListEl.querySelector(".thread-list-item")).toBeNull(); // stale list cleared

  c.onLivenessState("connected");     // unauthorized -> connected recovers (re-fetches)
  await flush();
  expect(els.threadListEl.querySelector(".thread-list-item")).not.toBeNull();
});
