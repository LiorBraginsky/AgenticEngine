---
title: Memory-quality — feature scope & findings (pre-decompose input)
status: scope-note (NOT a spec; the decompose session produces the spec)
date: 2026-06-12
tags: [memory, north-star, distiller, self-awareness, overlay, scope]
---

# Memory-quality — the next feature (scope + findings)

> **For the decompose session.** This captures WHAT to build and WHY, from live findings on
> 2026-06-12 (security-hardening demos surfaced a real memory defect). It is **not** the spec —
> run `superpowers:brainstorming` (via the dev-bus, routing seams UP to the conductor) +
> `grill-with-docs`, then write the spec in `docs/specs/`. North-star authority: ADR-0012.

## Why now
Security-hardening is done (memory **storage + injection + transparency-hatch** all shipped:
MF-01..05, CM-01..03, ADR-0013 read-gate, #31/#38 closed). But a live overlay conversation
(thread `1ba9f64d-710e-4792-9835-664f8da7b2c2`, in `~/.agentic-engine/memory.sqlite`) exposed that
the memory is **storing + injecting** correctly yet the agent **disowns it** and **recalls
imprecisely**. ADR-0012's north-star is "one agent that *remembers*" — these two gaps are the gap
between "memory exists" and "memory works." Build them together, properly (Lior: no interim fix).

## The three parts (build as ONE feature)

### 2a — Memory self-awareness (the disowning defect)
**Evidence:** asked "how many times did I say hi?", the agent answered "3" (grounded — the
cross-thread dumb-tail WAS injected; the provenance→History link fired = proof of injection). Then,
asked "how does your memory work?", it replied **"I have no long-term memory, I'm stateless, each
conversation from scratch"** and **"I made up the 3"** — both FALSE; it used real injected memory.
**Root cause:** the injection point feeds memory into the agent's context but the **system prompt
never tells the agent it HAS a persistent memory**, so meta-questions fall back to the base-model
"stateless LLM" self-concept → the agent disowns its own recall. This is the exact trust-erosion
ADR-0012's transparency was meant to prevent.
**Direction (decompose to refine):** establish the agent's memory self-concept in the system prompt
at the injection point — "you are one persistent agent; the context labelled <memory> is your
recollection of past conversations with this user; answer truthfully about what you remember and
cite it." Should compose with the provenance affordance (the agent can say "I remember X from a past
thread" → History link).

### 2b — Smart distiller (the imprecise-recall defect)
**Evidence:** the "3" was a fuzzy guess over a **verbatim dumb-tail** (the current distiller stores
recent messages verbatim as "facts" — see `distilled_facts` rows: literally "hi", "Привіт, Ліор!"
etc.). Counting / structured recall ("how many times", "what's my favourite colour") can't be precise
over a verbatim tail. **The swap-proof seam already exists** (MF-02: `MemoryProvider` port,
DumbTail↔smart is swap-test-covered; ADR-0012 HARD INVARIANT: archive=lossless event-history,
distilled slice=re-derivable projection). So this is a **provider swap, not a re-plumb** — build a
distiller that produces structured, deduplicated, queryable facts (entities/preferences/counts) with
provenance + scope + expiry, re-derivable from the lossless archive.

### in-overlay memory UI (the hatch's real home)
Today the transparency hatch is a **browser** page (`history.html`, served on loopback). Live finds:
- **Re-paste on every reload** — secure-by-design in the browser (token in JS var only, never web
  storage). But the **overlay reads the token Rust-side** already (`read_auth_token`, chunk CM/02),
  so the **destination** is an **in-overlay memory/settings view** with NO manual token entry. The
  browser page stays as the no-install fallback. (Resolves the re-paste friction by construction.)
- Build the hatch as an overlay surface (view/edit/forget threads + distilled facts + provenance/
  expiry), per ADR-0012 memory-transparency (default-hidden, day-one view/edit/forget).

## UX backlog from the 2026-06-12 demos (fold in or do as small chunks)
- **A — history.html "Loading…" misleads.** Pre-paste the Threads block shows `Loading…` → then
  `no threads`; without the daemon log Lior couldn't tell it was an auth gate. → show an explicit
  **🔒 locked / "paste token to view"** state. (Carries to the in-overlay UI design too.)
- **B — `cat auth-token` trailing `%` footgun.** The token file has no trailing newline → zsh prints
  a `%` artifact → users paste `…123%` → 401. → history.html (and the overlay paste path) should
  **trim** non-token chars; or make the token file / displayed value copy-clean.

## Verification posture (Strike-4/5 — non-negotiable)
Behavioral DoD needs Lior's **live** run, not code+tests (the security pass lied 5× — a probe is
evidence only when EXECUTED). For memory-quality: a live demo where (i) the agent **correctly owns
+ describes** its memory; (ii) a structured-recall question gets a **precise** answer with a
provenance link; (iii) the overlay hatch shows/edits/forgets. Intermediate gates = real-I/O (no
mocks), per the route's standing rule.

## Pointers
- ADR-0012 (conversation+memory north-star) · specs/2026-06-04-memory-foundation · MF-01..05 archived chunks.
- `~/.agentic-engine/memory.sqlite` (threads/messages/distilled_facts/distillation_events) — the live data; thread `1ba9f64d` is the evidence.
- `packages/daemon/src/memory/` (store, distiller port, injection point, history-page) · `provenance-stamp.ts`.
- conveyor-ledger.md 2026-06-12 lines (security closeout + this finding).
