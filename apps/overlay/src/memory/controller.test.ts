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

test("chunk-03 forget: 204 → re-fetch, fact gone; unreachable → DOWN (no fake success)", async () => {
  const facts = [{ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    const body = url.includes("/memory/thread/")
      ? { messages: [], distilledFacts: facts.slice(), distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  expect(els.factsEl.querySelector(".fact-row")).not.toBeNull();

  const forgetBtn = els.factsEl.querySelector<HTMLButtonElement>(".act-forget")!;
  forgetBtn.click();          // arm
  facts.length = 0;           // server now returns 0 facts on the re-fetch
  forgetBtn.click(); await flush(); // confirm → POST 204 → re-fetch
  expect(els.factsEl.textContent).toContain("No distilled facts"); // gone on reload — real, not faked
});

test("chunk-03 forget: POST rejected (daemon down) → DOWN, never a fake success", async () => {
  const postMode: "ok" | "down" = "down";
  const facts = [{ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") {
      if (postMode === "down") return Promise.reject(new Error("refused"));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const body = url.includes("/memory/thread/")
      ? { messages: [], distilledFacts: facts.slice(), distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  const btn = els.factsEl.querySelector<HTMLButtonElement>(".act-forget")!;
  btn.click(); btn.click(); await flush(); // arm + confirm → POST rejected
  expect(els.factsEl.textContent).toContain("Daemon unreachable"); // honest, no "gone"/success
});

// Reviewer minor: a write-triggered applyDownState (POST unreachable/unauthorized) did NOT update
// lastLiveness, desyncing it from the liveness poll. Repro: liveness last reported "connected", a
// write fails -> content goes DOWN, then the NEXT "connected" poll sees prev===state==="connected"
// -> de-duped as a repeat -> never calls refreshCurrentView() -> content is stuck on DOWN forever
// even though the daemon is back up (exact banner/content contradiction Demo-1 fixed, now via the
// write path instead of the liveness path). Fix: applyDownState sets lastLiveness = state too, so
// a write-triggered down state re-arms the NEXT same-value "connected" poll as a real transition.
test("chunk-03 write-path down-state re-couples liveness: a POST-triggered DOWN recovers on the next 'connected' poll (not stuck)", async () => {
  let postShouldFail = true;
  const facts = [{ id: "F1", fact: "x", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") {
      if (postShouldFail) return Promise.reject(new Error("refused"));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const body = url.includes("/memory/thread/")
      ? { messages: [], distilledFacts: facts.slice(), distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  c.onLivenessState("connected"); // liveness baseline: banner says connected
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  expect(els.factsEl.querySelector(".fact-row")).not.toBeNull();

  const forgetBtn = els.factsEl.querySelector<HTMLButtonElement>(".act-forget")!;
  forgetBtn.click(); forgetBtn.click(); await flush(); // arm + confirm → POST rejected → content DOWN
  expect(els.factsEl.textContent).toContain("Daemon unreachable");

  // Daemon is actually fine again; the NEXT poll reports the SAME "connected" value the banner
  // already had before the write failure. Without the fix this is de-duped (prev === state) and
  // the view stays stuck on "Daemon unreachable" forever. With the fix it is a real transition.
  postShouldFail = false;
  c.onLivenessState("connected");
  await flush();
  expect(els.factsEl.querySelector(".fact-row")).not.toBeNull(); // recovered — not stuck on DOWN
});

test("chunk-05 fact-edit: 204 → POST target_type:fact + re-fetch shows the human-authored text", async () => {
  const facts = [{ id: "F1", fact: "colour blue", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }];
  const postCalls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") {
      postCalls.push({ url, init });
      facts[0] = { ...facts[0]!, fact: "colour green", authored_by: "human" };
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const body = url.includes("/memory/thread/")
      ? { messages: [], distilledFacts: facts.slice(), distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  els.factsEl.querySelector<HTMLButtonElement>(".act-edit")!.click(); // open editor
  const ta = els.factsEl.querySelector("textarea")!;
  ta.value = "colour green";
  els.factsEl.querySelector<HTMLButtonElement>(".act-save")!.click(); await flush(); // POST → re-fetch

  expect(postCalls.length).toBe(1);
  expect(postCalls[0]!.url).toBe("http://127.0.0.1:7777/memory/edit");
  const body = JSON.parse(postCalls[0]!.init!.body as string) as { target_type: string; fact_id: string; replacement: string; reason: string };
  expect(body).toEqual({ target_type: "fact", fact_id: "F1", replacement: "colour green", reason: "hatch-fact-edit" });
  expect(els.factsEl.textContent).toContain("colour green"); // new text visible on reload
  expect(els.factsEl.querySelector(".human-badge")).not.toBeNull(); // data-driven badge, no session set
});

test("chunk-05 fact-edit: POST rejected (daemon down) → DOWN, never a fake success", async () => {
  const facts = [{ id: "F1", fact: "colour blue", provenance: "thread:t", scope: "cross-thread", expiry: null, confidence: 1, authored_by: "machine" }];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") return Promise.reject(new Error("refused"));
    const body = url.includes("/memory/thread/")
      ? { messages: [], distilledFacts: facts.slice(), distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  els.factsEl.querySelector<HTMLButtonElement>(".act-edit")!.click(); // open editor
  const ta = els.factsEl.querySelector("textarea")!;
  ta.value = "colour green";
  els.factsEl.querySelector<HTMLButtonElement>(".act-save")!.click(); await flush(); // POST rejected

  expect(els.factsEl.textContent).toContain("Daemon unreachable"); // honest, no "colour green"/fake success
});

test("chunk-03 edit: 204 → re-fetch, corrected text shown + 'edited by you' tag", async () => {
  let content = "hi";
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") { content = "corrected"; return Promise.resolve(new Response(null, { status: 204 })); }
    const body = url.includes("/memory/thread/")
      ? { messages: [{ id: "M1", role: "user", content }], distilledFacts: [], distillationEvents: [] }
      : { threads: [{ thread_id: "T1", title: "One", last_active_at: 1, status: "active" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const els = makeEls();
  const c = createMemoryController({ api: { fetchFn, baseUrl: "http://127.0.0.1:7777", token: "TOK" }, els });
  c.start(); await flush();
  els.threadListEl.querySelector<HTMLElement>(".thread-list-item")!.click(); await flush();
  els.messagesEl.querySelector<HTMLButtonElement>(".act-edit")!.click(); // open editor
  const ta = els.messagesEl.querySelector("textarea")!;
  ta.value = "corrected";
  els.messagesEl.querySelector<HTMLButtonElement>(".act-save")!.click(); await flush(); // POST → re-fetch
  expect(els.messagesEl.textContent).toContain("corrected"); // new text visible on reload
  expect(els.messagesEl.textContent).toContain("edited by you"); // session marker
});
