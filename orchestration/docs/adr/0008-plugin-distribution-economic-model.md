---
status: accepted
date: 2026-05-25
deciders: [lior]
tags: [adr, plugins, distribution, economics, marketplace]
---

# ADR-0008: Plugin Distribution and Economic Model

## Status

`accepted` for MVP; long-term scenarios documented but not committed.

## Context

AgenticEngine's plugin ecosystem can be more than a developer-contribution channel — it can be a **two-sided marketplace** where:

- **Side A (end-users)** install plugins to extend their AI.
- **Side B (SaaS providers)** ship paid mini-SaaS as plugins, gaining distribution into desktop workflows.

This reframes the platform: it's not just "agent + plugins"; it's also "distribution channel for AI-powered services". This decision controls:

- How money flows (does the platform handle billing? user pays whom?).
- How providers technically integrate (local npm code? hosted MCP servers?).
- How plugins are discovered.
- What the operational burden is for the platform.

This decision interacts with [[../open-questions]] Q3 (plugin distribution), Q4 (plugin security), Q8 (monetization).

## Decision

**For MVP: A3 (user-provided API keys) + B3 (npm package + hosted MCP hybrid). Free and paid plugins coexist via the `pricing` field in the plugin manifest. Long-term monetization scenarios captured but deferred to post-PMF.**

Concretely:

### MVP — payment flow (A3)

1. Platform is **not** in the money flow.
2. User registers directly with the SaaS provider (e.g., MedScan.io), gets an API key.
3. User installs the plugin (e.g., `agentic-plugin-medscan`).
4. During plugin onboarding, user pastes the API key.
5. Plugin code calls SaaS API directly using user's key.
6. SaaS provider bills user directly (out of band).
7. Platform earns: $0.

**Trade-off accepted:** zero revenue for now, but zero operational burden (no PCI compliance, no billing infra, no refunds, no tax handling). MVP scope is realistic.

### MVP — provider integration (B3 hybrid)

1. Provider ships an npm package with:
   - **Manifest** declaring the plugin's surface.
   - **UI tools** (widget templates) declared in JavaScript/TypeScript — these must be local because they need to render in the engine's frontend.
   - **Auth flow logic** (capture API key from user, store in Keychain).
2. Provider optionally hosts an **MCP server** at their endpoint (e.g., `https://medscan.io/mcp`). Backend tools can be proxied through this hosted server — provider controls the heavy lifting.
3. The plugin manifest declares whether each backend tool is `local` or `hosted` (B3 hybrid).

**Trade-off accepted:** dual integration mode is more complex than pure-local or pure-hosted, but it lets providers update business logic without re-publishing the plugin while keeping UI declarations local for fast rendering.

### Pricing field in manifest

```json
{
  "agentic-engine": {
    "pricing": "free" | "freemium" | "paid",
    "auth": "none" | "api-key" | "oauth",
    "billing": "user-provided-api-key" | "platform-managed"
  }
}
```

In MVP, the engine UI surfaces a 💰 indicator for paid plugins. The actual payment happens outside the platform (provider handles it).

### Long-term scenarios (NOT committed, captured for memory)

When product-market fit is observed, evaluate any combination of:

**Scenario A — Marketplace cut on paid plugins** (5-10%, not 30%)
- Platform-managed billing, platform takes cut.
- Requires PCI compliance, tax, refunds → ~3-6 months of infrastructure work.
- Realistic cut: 5-10% (matching Patreon, Substack tier, well below Apple's 30%).
- Worthwhile **only** if marketplace becomes a meaningful revenue source.

**Scenario B — Platform Pro tier subscription ($5-10/month)**
- Free tier: full local engine + plugin install + voice + rituals.
- Pro tier: cloud sync, history search, AI provider abstraction (managed LLM credits), priority plugin support.
- This is the Notion / Linear / Figma model.
- **Only works once there are platform-level features that warrant paying.** In MVP there are none.

**Scenario C — Affiliate model**
- Provider pays a per-acquisition referral fee.
- One-time, not recurring.
- Lower revenue, zero billing burden.

The actual choice will depend on early user + provider feedback. Likely **a layered combination** of all three.

## Consequences

### Positive

- **MVP ships fast** — no payment infrastructure, no PCI compliance, no tax/refund handling.
- **Trust easier** — users only have to trust their providers, not us as a billing intermediary.
- **Provider attraction** — providers get distribution without giving up revenue share (A3).
- **Free + paid plugins coexist** — same plugin manifest format for both; no second-class citizens.
- **B3 hybrid is the industry trend** — hosted MCP servers becoming common; we align with where ecosystem is going.
- **Architectural flexibility** — protocol designed such that A3 → A1/A2 is additive (we can add platform billing later without breaking existing plugins).

### Negative

- **No platform revenue in MVP** — entire monetization is deferred. Need other revenue path (consulting, eventual subscriptions) or accept "early stage = no income."
- **Plugin discovery is a side problem** — without a marketplace UI, users must find plugins via README/blog/word-of-mouth. Solvable post-MVP.
- **Trust outsourced to providers** — if a provider mishandles user data or scams, we have no direct accountability. Mitigation: clear permission model + curation + reviews post-MVP.
- **Provider lock-in to specific plugins is weak** — without billing relationships, switching costs are low.

### Trade-offs accepted

- We accept **zero MVP revenue** in exchange for **zero billing complexity**.
- We accept **plugin trust is decentralized** in exchange for **platform neutrality**.
- We accept **discovery is unsolved** in exchange for **getting to validation faster**.

### What we'll regret in 6 months (predict it now)

> [TODO: Lior — your prediction. Possible regrets: "we should have built a curated marketplace UI from day one, or no one finds the plugins" or "providers wanted platform billing from day one, A3 was a non-starter for serious mini-SaaS."]

## Alternatives Considered

### Option A1 — App Store model (platform takes 30%) — REJECTED for MVP

Platform-managed billing; platform takes 30% cut.

**Why not for MVP:**
- 30% is **monopoly tax**, not industry default. Apple/Google can charge it because of distribution lock-in. New platforms cannot.
- Requires 3-6 months of PCI/billing/tax work before any provider can sell anything.
- Providers will resist 30% absent enormous user base.

**Future:** consider 5-10% cut as Scenario A above, post-PMF.

### Option A2 — Stripe Apps model (transactional fee only) — REJECTED for MVP

Platform takes a small transactional fee per payment, billing goes through us but we don't take revenue share.

**Why not for MVP:**
- Still requires payment infrastructure.
- Still need partnership terms with each provider.
- Deferred to long-term.

### Option B1 — Pure local code in plugins — REJECTED

All plugin code is local TypeScript, no hosted MCP.

**Why not:**
- Providers can't update their business logic without users re-installing.
- Heavy backend logic (medical doc parsing, image processing) doesn't fit in local execution.
- Disallows business reality where providers want full control of their service.

### Option B2 — Pure hosted MCP only — REJECTED

All plugin functionality lives on provider's server; the plugin is just a thin manifest pointing to MCP server.

**Why not:**
- UI rendering must be local (latency, native rendering).
- Trivial / lightweight plugins (e.g., a weather widget) don't need hosted infrastructure — forcing it is overkill.
- Forces every plugin author to run servers, blocking hobbyists.

## Related

- [[../concept]] — Pillar 5 (marketplace) and plugin complexity spectrum
- [[../plugin-anatomy]] — concrete shape of a plugin
- [[../architecture]] — where plugins fit in the system
- [[../open-questions]] Q3, Q4, Q8 — related questions
- [[../known-gotchas]] — implementation pitfalls for plugin system
