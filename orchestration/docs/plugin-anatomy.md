---
title: Plugin Anatomy
status: draft
last-major-update: 2026-05-25
tags: [plugins, anatomy, specification]
---

# Plugin Anatomy

This document specifies **what a plugin is**, **how it's composed**, and **how its pieces connect during a request**.

It is the answer to the question: *"How do all these pieces (manifest, tools, UI, agent hints, auth) fit together when an actual plugin runs?"*

---

## A plugin is a composition of 5 layers

```
┌──────────────────────────────────────────────────────────────────┐
│           ONE PLUGIN — example: "agentic-plugin-medscan"          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│   LAYER 1 — MANIFEST                                              │
│   ─────────────                                                   │
│   package.json with the `agentic-engine` field:                  │
│     - name, version, description                                  │
│     - pricing: "free" | "freemium" | "paid"                       │
│     - auth: "none" | "api-key" | "oauth"                          │
│     - billing: "user-provided-api-key" | "platform-managed"       │
│     - permissions: declarative list (network, files, ...)         │
│     - tools, ui-tools, agent-hints paths                          │
│                                                                   │
│   LAYER 2 — BACKEND TOOLS (what the agent calls)                  │
│   ─────────────                                                   │
│   A plugin typically has SEVERAL backend tools, not just one.     │
│   Example for MedScan:                                            │
│     - parse_medical_doc                                           │
│     - search_medical_history                                      │
│     - compare_reports                                             │
│     - share_with_doctor                                           │
│                                                                   │
│   Each tool: typed args, typed returns, async runner function.    │
│   Tools can be local code OR proxied to hosted MCP server (B3).   │
│                                                                   │
│   LAYER 3 — UI TOOLS (how results are shown)                      │
│   ─────────────                                                   │
│   A plugin typically has SEVERAL widget templates, not just one.  │
│   Example for MedScan:                                            │
│     - show_doc_detail                                             │
│     - show_history_chart                                          │
│     - show_comparison_view                                        │
│     - show_share_dialog                                           │
│     - show_list_result                                            │
│                                                                   │
│   Each ui-tool: pure function `(args) → widget JSON`.             │
│   Composed using engine's primitives (closed set).                │
│                                                                   │
│   LAYER 4 — AGENT HINTS (how the agent learns)                    │
│   ─────────────                                                   │
│   A markdown file that gets injected into the system prompt when  │
│   the plugin is installed. Explains:                              │
│     - When to use which tool                                      │
│     - Which ui-tool follows which backend tool                    │
│     - Example user prompts that should trigger this plugin        │
│                                                                   │
│   LAYER 5 — AUTH / ONBOARDING                                     │
│   ─────────────                                                   │
│   Declared in manifest. Engine implements the flow at install:    │
│     - Show install dialog with permission list                    │
│     - For api-key auth: prompt user to input key                  │
│     - For oauth: kick off OAuth flow in browser                   │
│     - Secret stored in macOS Keychain scoped to plugin ID         │
│     - Plugin code receives secret via `auth.*` runtime argument   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## The "is UI generated on the fly?" question — answered

**No.** A common misconception is that the LLM "generates UI" by emitting React or HTML at runtime. We **explicitly reject this** because:

- It's slow (token-by-token streaming markup).
- It's unstable (LLMs occasionally produce broken syntax).
- It's untestable (every render is a new generation).
- It blocks native renderers (a Swift overlay can't execute generated React).

### Instead: plugin ships templates, LLM ships data

```
LLM decision:  "I'll call show_doc_detail with this parsed data"
                                │
                                ▼
Plugin's ui-tool:  pure function (args) → widget JSON
                                │
                                ▼
                   { type: 'card', sections: [...] }
                                │
                                ▼
Engine's renderer:  reads JSON, renders using native primitives
```

| Property | Value |
|----------|-------|
| **LLM generates UI?** | ❌ No |
| **LLM picks WHICH UI?** | ✅ Yes — by choosing which ui-tool to call |
| **Plugin author writes UI code?** | ✅ Yes — but as **declarative templates**, composed from primitives |
| **Templates are tested?** | ✅ Yes — they're pure functions, unit-testable |
| **Frontend has full rendering control?** | ✅ Yes — theming, a11y, i18n, animations all live in renderer |
| **Native frontends can render same widgets?** | ✅ Yes — they implement same primitives in native APIs |

**The mental model:** treat the engine's primitive set as a **UI Kit** (closed-set, defined by engine). Plugin authors write **widget templates** (open-set, composed of primitives). The LLM acts as a **router** that picks which template to call.

This is the same pattern as **React props + components**, except the "components" are deterministic and the "parent" is an LLM passing structured data.

---

## Lifecycle of one request

How the 5 layers connect in time:

```
┌──────────────────────────────────────────────────────────────────┐
│                  LIFECYCLE OF ONE REQUEST                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ⏱ t=0      User: "Parse the photos in ~/Pictures/medical/"      │
│                                                                   │
│  ⏱ t=10ms    Engine starts session.                              │
│              Gathers system prompt:                               │
│                - Base prompt                                      │
│                - + agent-hints from ALL installed plugins         │
│                - + available tools list (manifest registry)       │
│                                                                   │
│  ⏱ t=300ms   LLM decides plan:                                   │
│              "I'll call read_dir, then parse_medical_doc x3,      │
│               then show_doc_detail x3."                           │
│                                                                   │
│  ⏱ t=400ms   LLM calls read_dir('~/Pictures/medical/')           │
│              → built-in filesystem tool                           │
│              → returns ['scan1.jpg', 'scan2.jpg', 'scan3.jpg']    │
│                                                                   │
│  ⏱ t=600ms   LLM calls parse_medical_doc x3 in parallel          │
│              → Plugin's Layer 2 code runs                         │
│              → Reads files, calls medscan.io with user key        │
│              → Returns 3 structured objects                       │
│                                                                   │
│  ⏱ t=2.5s    LLM calls show_doc_detail x3                        │
│              → Layer 3 ui-tool generates widget descriptions      │
│              → Engine wraps in tool-call messages                 │
│              → Sends over WebSocket to connected frontend         │
│              → macOS overlay renders 3 widgets top-right          │
│                                                                   │
│  ⏱ t=2.7s    User sees three widgets, clicks "Save to CSV"       │
│              → Frontend sends widget-event back to engine         │
│              → Engine forwards to LLM as tool_result              │
│                                                                   │
│  ⏱ t=2.8s    LLM reacts: "I'll save them to a file."             │
│              → Calls write_csv built-in tool                      │
│              → Done                                               │
│                                                                   │
│  ⏱ t=3.0s    Session closes                                      │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Plugin complexity spectrum

Not all plugins look the same. The architecture supports:

| Tier | Example | Backend | UI | MVP-ready? |
|------|---------|---------|-----|------------|
| **Trivial** | quick-search | calls `web_search` | one `markdown` primitive | yes |
| **Lightweight** | weather | calls free API | composed primitives | yes |
| **Standard** | spotify | OAuth + own API | multiple widgets | yes |
| **Mini-SaaS** | medscan | hosted MCP server, paid API | domain widgets | yes (post-Phase 5) |
| **Complex** | figma-plugin | may need embedded WebView for design canvas | `custom_content` escape hatch + Tauri WebView | **post-MVP** |

The **Complex tier** — where a plugin needs a fully embedded web view (Electron-style) — is **out of scope for MVP**. The architecture's `custom_content` primitive ([[adr/0005-ui-contract-closed-set]]) leaves the door open, but implementing safe sandboxed WebViews per plugin is multi-month work.

---

## Plugin SDK shape (preview — not implemented yet)

```typescript
import { defineTool, defineUITool, p, z } from '@agentic/sdk';

// Layer 2: backend tool
export const parseMedicalDoc = defineTool({
  name: 'parse_medical_doc',
  description: 'Extract structured data from a medical document image or PDF',
  args: z.object({ filePath: z.string() }),
  returns: z.object({
    patient: z.object({ name: z.string(), dob: z.string() }),
    diagnoses: z.array(z.string()),
    date: z.string(),
  }),
  async run({ filePath }, { auth, abortSignal }) {
    const file = await Bun.file(filePath).bytes();
    const result = await fetch('https://medscan.io/parse', {
      method: 'POST',
      headers: { 'X-API-Key': auth.apiKey },
      body: file,
      signal: abortSignal,
    });
    if (!result.ok) throw new Error(`MedScan API failed: ${result.status}`);
    return await result.json();
  },
});

// Layer 3: ui-tool
export const showDocDetail = defineUITool({
  name: 'show_doc_detail',
  description: 'Render parsed medical document as a detail widget',
  args: z.object({
    doc: z.object({
      patient: z.object({ name: z.string(), dob: z.string() }),
      diagnoses: z.array(z.string()),
      date: z.string(),
    }),
  }),
  ui: ({ args }) => p.card({
    title: args.doc.patient.name,
    sections: [
      p.section('Patient', [
        p.row('Name', args.doc.patient.name),
        p.row('DOB', args.doc.patient.dob),
      ]),
      p.section('Diagnoses', [
        p.table({ rows: args.doc.diagnoses.map(d => [d]) }),
      ]),
    ],
    actions: [
      p.button('Compare', { intent: 'compare_reports' }),
      p.button('Share', { intent: 'share_with_doctor' }),
      p.button('Export PDF', { intent: 'export' }),
    ],
  }),
});
```

---

## Related

- [[concept]] — Pillar 5 and complexity spectrum
- [[architecture]] — where plugins fit in the system
- [[adr/0002-ui-as-tool-calls]] — UI tools mechanism
- [[adr/0005-ui-contract-closed-set]] — primitives and escape hatch
- [[adr/0008-plugin-distribution-economic-model]] — economic model
- [[known-gotchas]] — open implementation pitfalls
