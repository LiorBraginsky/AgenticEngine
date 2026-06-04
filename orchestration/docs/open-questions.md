---
title: Open Questions
status: living-document
last-major-update: 2026-06-04
tags: [open-questions, decisions]
---

# Open Questions

Questions that are **not yet decided** but need to be — eventually. This is a **living document**: when a question gets answered, it moves to an ADR and is removed (or struck through) here.

Format per question:
- **Status:** `open` / `proposed` / `decided` → ADR-XXXX
- **Blocks:** what milestone or work is blocked by this
- **Notes:** current thinking, alternatives

---

## Q1: LLM provider strategy

- **Status:** ✅ `decided` 2026-06-03 → **[[adr/0010-pluggable-llm-provider-abstraction]] (`accepted`)**
- **Blocks:** Phase 3 (real LLM integration)
- **Current thinking:** Default to Anthropic Claude. Use a provider-abstraction layer (Vercel AI SDK or custom) to allow OpenAI / local Ollama later. Single provider in MVP keeps things simple; the abstraction is the futureproofing.
- **Alternatives:**
  - **Multi-provider from day one:** flexible but premature; complicates streaming & tool-calling differences across providers.
  - **Local-first via Ollama:** quality gap for tool use is still significant in mid-2026; tool-calling reliability is the bottleneck for an agentic product.
- **To decide before Phase 3.**

> ✅ **DECIDED 2026-06-03 by [[adr/0010-pluggable-llm-provider-abstraction]] (`accepted`).** Resolved **early** via the `llm-text-slice` slice (chunks 02+03, merged PR #10): a thin swappable `AgentProvider` port + `llm-injector`, single-provider-first (API-key Anthropic, Sonnet 4.6) behind a futureproofing abstraction; auth is an adapter property; agent-harness providers deferred to a future sub-seam. Auth/subscription strategy is the sibling decision [[adr/0011-llm-auth-and-subscription-strategy]] (`accepted`). The original thinking/alternatives above are preserved as historical record. **No longer open.**

---

## Q2: UI primitives — exact list and versioning

- **Status:** `open` (deferred by Lior — "let's settle architecture first")
- **Blocks:** Phase 2 (first frontend) — partially. We need ~5 primitives for Phase 2 MVP.
- **Current thinking:** Start with a minimal set (~5-10) for Phase 2. Grow to ~20-25 based on observed plugin needs. Version primitives in lockstep with engine; new ones = minor bump.
- **Alternatives:**
  - **Each primitive as its own npm package:** more granular versioning but heavier toolchain.
  - **Open-ended primitive registry (plugins can register their own):** maximum flexibility, but breaks cross-frontend rendering.
- **First-pass shortlist (for Phase 2):** `text`, `button`, `input`, `color-picker`, `image`. Then expand.

---

## Q3: Plugin distribution

- **Status:** `open`
- **Blocks:** Phase 5 (plugin system) and Phase 7 (public release)
- **Current thinking:** Plugins as npm packages, scanned from `~/.agentic-engine/plugins/`. Possibly with a discovery layer (curated registry) on top. Reuses existing infrastructure (semver, dependency resolution).
- **Alternatives:**
  - **Own registry:** more control, but extra build-out and worse discovery.
  - **Bundled-only plugins (no third party at first):** safer for security, but kills the ecosystem pillar.
- **To decide during Phase 5.**

---

## Q4: Plugin code execution security

- **Status:** `open` — important
- **Blocks:** anything where third-party plugins run (Phase 5+)
- **Current thinking:** Plugins run in daemon process by default. For untrusted plugins, consider:
  - Worker threads with limited capabilities,
  - Permission manifests (plugins declare what they need: filesystem? network? specific origins?),
  - User approval flow at install time.
- **Alternatives:**
  - **No sandboxing (trust-on-install):** simplest, but a malicious plugin reads your API keys.
  - **Process isolation per plugin:** robust but heavy on resources.
- **To decide during Phase 5.**

---

## Q5: Cron ritual declarative syntax

- **Status:** `open`
- **Blocks:** Phase 6 (rituals)
- **Current thinking:** YAML files with `cron`, `prompt`, `name`, `created-from` fields. Stored in `~/.agentic-engine/rituals/`. Editable in admin web tab.
- **Open sub-questions:**
  - How does the agent **modify** an existing ritual via voice? "Change my morning brief to start at 9am instead."
  - Can rituals **depend on each other** (ritual A's output feeds ritual B)?
  - **Conditional rituals**: "every morning at 8am, BUT only if I'm not on vacation"?
- **To decide during Phase 6.**

---

## Q6: Hot vs cold daemon startup behavior

- **Status:** `open`
- **Blocks:** Phase 1 (engine skeleton)
- **Current thinking:** Use launchd `KeepAlive=true` for always-on (simpler), or `KeepAlive=Adaptive` for on-demand activation triggered by socket connection (better resource use, but more complex).
- **Trade-off:** Always-on uses ~50-100MB RAM continuously. On-demand startup adds ~200ms latency on first request after idle.
- **To decide during Phase 1.**

---

## Q7: Multi-user / shared rituals

- **Status:** `open` — post-MVP
- **Blocks:** any cloud-sync feature
- **Notes:** Single-user assumption for MVP. Shared rituals would require identity, conflict resolution, and probably a cloud component. Defer until users actually ask.

---

## Q8: Pricing / monetization

- **Status:** `proposed` — MVP decided; long-term scenarios captured
- **Blocks:** Phase 7+ (public release)

### MVP (decided)

- Engine permissively licensed (MIT/Apache).
- **Plugins use A3 model:** user supplies their own API keys for paid mini-SaaS plugins. Platform is not in the money flow. Zero billing infrastructure needed.
- See [[adr/0008-plugin-distribution-economic-model]] for full reasoning.

### Post-MVP scenarios (none committed)

When product-market fit is demonstrated, evaluate these three scenarios — not mutually exclusive:

**Scenario A: Marketplace cut on paid plugins**
- Platform-managed billing for paid plugins; we take a cut.
- Realistic floor: **5-10%** for a new marketplace. 30% (Apple/Google) is monopoly tax, not industry default. Stripe Apps takes 0% on revenue; Patreon 5-12%; Substack 10%.
- Requires PCI compliance, refunds, tax handling — substantial operational investment.

**Scenario B: Platform Pro tier subscription ($5-10/month)**
- Free tier: full local engine + plugin install + voice + rituals.
- Pro tier: cloud sync (rituals across devices), history search, AI provider abstraction (platform manages LLM credits for the user), priority plugin support.
- This is the Notion / Linear / Figma model — base subscription + extension marketplace.
- **Only works once there are platform features that warrant paying.** In MVP there are none.

**Scenario C: Affiliate model on plugin installs**
- SaaS provider pays us a referral fee for new users acquired through our marketplace.
- One-time payment per acquisition, not recurring.
- Lower revenue but zero PCI burden.

**Defer the decision** until early users + early plugin authors give signal. The choice may be all three layered.

---

## Q9: Mobile

- **Status:** `open` — post-MVP
- **Notes:** Mobile is hostile to OS-overlay paradigm. iOS/Android won't allow free-floating windows. Mobile would have to be a "thin client" pointing to remote engine (requires Q1 cloud architecture).
- **Defer indefinitely until desktop product proves itself.**

---

## Q10: Naming — Engine, Tool, Widget, Ritual, ... — final terminology

- **Status:** `proposed` (see [[glossary]])
- **Blocks:** documentation consistency
- **Notes:** Lior to finalize terminology in [[glossary]].

---

## Q11: External / third-party rich-widget rendering

- **Status:** `open` (surfaced 2026-06-04 by Lior)
- **Blocks:** Phase 5 (plugins) / any external-widget support
- **Current thinking:** [[adr/0005-ui-contract-closed-set]]'s closed-set cleanly covers widgets **we** draw. But third-party **rich** widgets that are **not** composed of our primitives — a Spotify widget, a weather mini-app, "calling a little program into the overlay" — are only weakly served by ADR-0005's `custom_content` sanitized-HTML escape hatch. How should an external rich widget render in the overlay, cross-frontend, **without** the arbitrary-code/XSS footgun?
- **Candidates:**
  - **A2UI** (Google, open agent-UI interchange format; some competitors render it) — as the format for *external* widgets only, NOT replacing our own primitive protocol.
  - **Sandboxed mini-app** (iframe-like isolated surface with a capability boundary).
  - **Extend `custom_content`** (richer but still sanitized) — least new infra, least power.
- **Why it's not "closed by ADR-0005":** ADR-0005 decided OUR primitives; this is the *external* case it doesn't fully answer. Per the standing rule, research this when the plugin/external-widget layer is tackled rather than reflex-rejecting it. See [[adr/0012-conversation-and-memory-model]] Option E.
- **Relates:** Q2 (our primitive list), Q4 (plugin/untrusted-code security — external widgets are exactly that surface).
- **To research/decide during Phase 5 (plugins).**

---

## Q12: "Do work" / long-running agent tasks (coding-agent capability)

- **Status:** `open` — post-personal-assistant-v1 horizon
- **Blocks:** nothing now — a deliberate scope question for later
- **The question:** should the agent host long-running **"do work"** tasks — e.g. "build me a React app and host it" — the capability Hermes / OpenClaw / Claude Code / Cursor target? Lior doesn't want to write off that whole class of users.
- **Reframe (not a pivot):** this is **not** "become a coding agent." It is a **background-task tier** (see [[known-gotchas]] #45) driven *from the overlay command surface*, via **MCP work-tools** (filesystem / shell / git / deploy) + **sandboxing** + a progress/result surface. The architecture already accommodates it ([[adr/0004-typescript-bun-mcp]] MCP, [[adr/0010-pluggable-llm-provider-abstraction]] agent-port, the #45 background model).
- **Tensions to design around:**
  - **Security:** arbitrary code execution is the exact footgun behind "don't run X on your workstation" — it fights the **"safe install" security moat**. Any such capability must be **sandboxed / opt-in / explicit-grant**, never default.
  - **Identity / focus:** the moat is the **interaction surface** (overlay/voice/widgets), not being a better coding agent (a crowded, well-funded space). Don't compete on capability.
  - **Sequencing:** pre-v1, solo; the personal-assistant overlay + memory layer come first.
- **Possible differentiated entry (if/when we go there):** kick off a long task by **voice/overlay command** and **glance progress** — a different UX from a terminal/IDE agent.
- **Stance:** **don't close the door** (the seams support it); **don't walk through it yet.** Revisit after the personal-assistant v1.
- **Relates:** [[adr/0004-typescript-bun-mcp]], [[adr/0010-pluggable-llm-provider-abstraction]], [[known-gotchas]] #45, project memory `prior-art-findings`.

---

## How to use this doc

When you (Lior) come back to this project after time away, **start here**. Each open question is essentially a "branch in the design tree" we haven't closed. Pick one, think about it, decide, write an ADR, remove from this list.

To trigger a focused grilling on a specific question, you can run:
- `/grill-with-docs` — uses existing docs as the domain model, grills your proposal against them and updates docs inline.

---

## Related

- [[vision]]
- [[concept]]
- [[architecture]]
- [[roadmap]]
