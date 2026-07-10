/**
 * Unit tests for system-prompt.ts — prompt-composition (TDD: test-first).
 *
 * D1 frozen requirements (spec §3.1) — these target the capability-ABSENT variant
 * (spec §3.8 amendment: the capability-PRESENT variant flips D1-6; see the
 * "capability-conditional composition (2c §3.8)" describe block below):
 *   (1) truthful + unconditional "one persistent agent with memory across conversations with this user"
 *   (2) [remembered]=PAST-conversations vs unlabelled=THIS-conversation discriminator (unambiguous)
 *   (3) never-claim-stateless / "nothing relevant" framing when no [remembered] messages
 *   (4) user can view/edit/delete via the History page
 *   (5) no-fabricated-links rule (link attached automatically post-reply)
 *   (6) cannot-self-forget (spec §3.6 D-V6d) — capability-ABSENT variant ONLY
 */
import { test, expect, describe } from "bun:test";
import {
  BASE_SYSTEM_PROMPT,
  MEMORY_SELF_CONCEPT,
  COMPOSED_SYSTEM_PROMPT,
  REMEMBERED_LABEL,
  MEMORY_SELF_CONCEPT_WITH_ACTIONS,
  COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS,
  composeSystemPrompt,
} from "./system-prompt.js";

// ── Module shape ───────────────────────────────────────────────────────────

describe("REMEMBERED_LABEL", () => {
  test('equals "[remembered] " exactly (bracket word + one trailing space)', () => {
    expect(REMEMBERED_LABEL).toBe("[remembered] ");
  });
});

// ── Composition formula ────────────────────────────────────────────────────

describe("COMPOSED_SYSTEM_PROMPT", () => {
  test("equals BASE_SYSTEM_PROMPT + double-newline + MEMORY_SELF_CONCEPT", () => {
    expect(COMPOSED_SYSTEM_PROMPT).toBe(
      BASE_SYSTEM_PROMPT + "\n\n" + MEMORY_SELF_CONCEPT,
    );
  });

  test("contains BASE_SYSTEM_PROMPT", () => {
    expect(COMPOSED_SYSTEM_PROMPT.includes(BASE_SYSTEM_PROMPT)).toBe(true);
  });

  test("contains MEMORY_SELF_CONCEPT", () => {
    expect(COMPOSED_SYSTEM_PROMPT.includes(MEMORY_SELF_CONCEPT)).toBe(true);
  });
});

// ── D1 requirement (1): truthful + unconditional persistent-agent phrasing ─

describe("D1 requirement 1 — truthful persistent-agent ownership", () => {
  test('MEMORY_SELF_CONCEPT contains "one persistent agent" phrasing', () => {
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("one persistent agent");
  });

  test('MEMORY_SELF_CONCEPT contains "memory across conversations" phrasing', () => {
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain(
      "memory across conversations",
    );
  });

  test('MEMORY_SELF_CONCEPT references "this user"', () => {
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("this user");
  });
});

// ── D1 requirement (2): [remembered]=PAST vs unlabelled=THIS discriminator ─

describe("D1 requirement 2 — [remembered]/THIS-conversation discriminator", () => {
  test("MEMORY_SELF_CONCEPT contains the [remembered] label (trimmed)", () => {
    // REMEMBERED_LABEL.trim() strips the trailing space for the content test
    expect(MEMORY_SELF_CONCEPT.includes(REMEMBERED_LABEL.trim())).toBe(true);
  });

  test("MEMORY_SELF_CONCEPT references THIS conversation / current conversation context", () => {
    // Must explicitly call out that unlabelled messages are part of THIS conversation
    const lower = MEMORY_SELF_CONCEPT.toLowerCase();
    const hasCurrent =
      lower.includes("this conversation") ||
      lower.includes("current conversation") ||
      lower.includes("this current conversation");
    expect(hasCurrent).toBe(true);
  });

  test('MEMORY_SELF_CONCEPT distinguishes past vs current via "past" or "past conversations"', () => {
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("past");
  });
});

// ── D1 requirement (3): never-claim-stateless clause ──────────────────────

describe("D1 requirement 3 — never-claim-stateless + nothing-relevant framing", () => {
  test('MEMORY_SELF_CONCEPT instructs not to claim stateless', () => {
    const lower = MEMORY_SELF_CONCEPT.toLowerCase();
    const hasNeverStateless =
      lower.includes("never claim") ||
      lower.includes("do not claim") ||
      lower.includes("don't claim");
    expect(hasNeverStateless).toBe(true);
  });

  test('MEMORY_SELF_CONCEPT contains "nothing relevant" framing for absent memories', () => {
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("nothing relevant");
  });

  test('MEMORY_SELF_CONCEPT references no [remembered] messages scenario', () => {
    // The text uses: 'If no "[remembered] " messages are present'
    // Match the actual format used in the constant (quotes around the label)
    const lower = MEMORY_SELF_CONCEPT.toLowerCase();
    const hasAbsenceCoverage =
      lower.includes('no "[remembered]') ||
      lower.includes("no '[remembered]") ||
      lower.includes("no `[remembered]") ||
      lower.includes("no [remembered]") ||
      lower.includes("if no");
    // Must include "nothing relevant" AND reference absence of [remembered]
    expect(hasAbsenceCoverage && lower.includes("nothing relevant")).toBe(true);
  });
});

// ── D1 requirement (4): view/edit/delete + History page ───────────────────

describe("D1 requirement 4 — user can view/edit/delete via History page", () => {
  test('MEMORY_SELF_CONCEPT contains "view, edit, and delete" phrasing', () => {
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain(
      "view, edit, and delete",
    );
  });

  test('MEMORY_SELF_CONCEPT references "History page"', () => {
    expect(MEMORY_SELF_CONCEPT).toContain("History page");
  });
});

// ── D1 requirement (5): no-fabricated-links rule ──────────────────────────

describe("D1 requirement 5 — never invent or write out a History link", () => {
  test('MEMORY_SELF_CONCEPT instructs never to invent or fabricate a History link', () => {
    const lower = MEMORY_SELF_CONCEPT.toLowerCase();
    const hasNeverInvent =
      lower.includes("never invent") ||
      lower.includes("never fabricate") ||
      lower.includes("do not invent") ||
      lower.includes("don't invent");
    expect(hasNeverInvent).toBe(true);
  });

  test('MEMORY_SELF_CONCEPT says the link is attached automatically (after reply)', () => {
    // The spec/plan says: "the link to its source is attached for you automatically after your reply"
    // Test both the "attached" + "automatically" keywords appear together
    const lower = MEMORY_SELF_CONCEPT.toLowerCase();
    expect(lower.includes("attached") && lower.includes("automatically")).toBe(
      true,
    );
  });
});

// ── D1 requirement (6): cannot self-forget (spec §3.6 D-V6d) ─────────────

describe("D-V6d — self-concept cannot self-forget (capability-ABSENT variant; spec §3.8 amendment: the capability-PRESENT variant flips D1-6)", () => {
  test('MEMORY_SELF_CONCEPT contains "You cannot modify, delete, or forget your own memory."', () => {
    expect(MEMORY_SELF_CONCEPT).toContain(
      "You cannot modify, delete, or forget your own memory.",
    );
  });

  test("MEMORY_SELF_CONCEPT contains the full second sentence verbatim (with em-dash)", () => {
    expect(MEMORY_SELF_CONCEPT).toContain(
      "Never claim to have forgotten, changed, or deleted something you remember — only the user can, via the History page.",
    );
  });

  test('ADDITIVE guard: "view, edit, and delete" (D1-4) still co-exists with the new clause', () => {
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("view, edit, and delete");
  });

  test("COMPOSED_SYSTEM_PROMPT carries the cannot-self-forget clause through composition", () => {
    expect(COMPOSED_SYSTEM_PROMPT).toContain(
      "You cannot modify, delete, or forget your own memory.",
    );
  });
});

// ── D1-7: A′ recall-usage instruction (v2-07) ─────────────────────────────

describe("D1-7 — A′ recall-usage: FIRST check [remembered], USE it, NEVER say you lack info", () => {
  test('MEMORY_SELF_CONCEPT contains "FIRST check" recall-usage directive', () => {
    expect(MEMORY_SELF_CONCEPT).toContain("FIRST check");
  });

  test('MEMORY_SELF_CONCEPT contains a "USE it" directive', () => {
    expect(MEMORY_SELF_CONCEPT).toContain("USE it");
  });

  test('MEMORY_SELF_CONCEPT contains a NEVER-say-you-lack-info directive referencing "[remembered]"', () => {
    expect(MEMORY_SELF_CONCEPT).toContain(
      'NEVER say you do not have, do not know, or cannot find information that appears in a "[remembered] " message.',
    );
  });
});

// ── D1-8: over-correction nuance instruction (v2-07) ──────────────────────

describe("D1-8 — over-correction nuance: do NOT redirect user to History for just-given info", () => {
  test('MEMORY_SELF_CONCEPT contains the do-NOT-tell-History instruction for just-given info (v2-09 tightened)', () => {
    // v2-09: "Do NOT tell the user to update, change, or fix the old information in the History page"
    expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain(
      "do not tell the user to update",
    );
  });

  test('MEMORY_SELF_CONCEPT restricts History-page mentions to "viewing, editing, or forgetting EXISTING" memories (v2-09 tightened)', () => {
    // v2-09: "Only mention the History page for viewing, editing, or forgetting EXISTING remembered facts the user did NOT just change"
    expect(MEMORY_SELF_CONCEPT).toContain("EXISTING");
    expect(MEMORY_SELF_CONCEPT).toContain("did NOT just change");
  });
});

// ── v2-09: over-correction clause re-tightened ────────────────────────────

test("v2-09: over-correction clause re-tightened — never redirect to History for a change/correction the user just stated", () => {
  // The v2-09 tightened phrasing: "STATES a change" (not just "new things"):
  expect(MEMORY_SELF_CONCEPT).toContain("STATES a change");
  // The v2-09 tightened directive: "a stated change is saved for you":
  expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("a stated change is saved for you");
  // The v2-09 "did NOT just change" restriction on when to mention History:
  expect(MEMORY_SELF_CONCEPT).toContain("did NOT just change");
  // "captured automatically" must survive (the core over-correction clause):
  expect(MEMORY_SELF_CONCEPT).toContain("captured automatically");
  // "do not tell the user to update" must survive in lowercase:
  expect(MEMORY_SELF_CONCEPT.toLowerCase()).toContain("do not tell the user to update");
  // History only for EXISTING memories:
  expect(MEMORY_SELF_CONCEPT).toContain("EXISTING");
  // D1 clauses must all SURVIVE (don't drop one while tightening another):
  expect(MEMORY_SELF_CONCEPT).toContain("[remembered] ");          // D1-2
  expect(MEMORY_SELF_CONCEPT).toContain("not a stateless model");  // D1-1
  expect(MEMORY_SELF_CONCEPT).toContain("FIRST check");            // D1-7 (A′)
  expect(MEMORY_SELF_CONCEPT).toContain("cannot modify, delete, or forget your own memory"); // D1-6
  expect(MEMORY_SELF_CONCEPT).toContain("attached for you automatically"); // D1-5
});

// ── capability-conditional composition (2c §3.8) ──────────────────────────
//
// D8: system-prompt composition becomes a function of memory-action-port
// capability. Capability-ABSENT stays byte-identical to today's
// COMPOSED_SYSTEM_PROMPT (asserted mechanically below — the chunk's DoD
// line). Capability-PRESENT flips D1-6 to honest tool-ownership with
// boundaries (ADR-0016 decision 3).

describe("capability-conditional composition (2c §3.8)", () => {
  test("composeSystemPrompt(false) is byte-identical to today's COMPOSED_SYSTEM_PROMPT", () => {
    expect(composeSystemPrompt(false)).toBe(COMPOSED_SYSTEM_PROMPT);
  });

  test("composeSystemPrompt(true) equals COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS", () => {
    expect(composeSystemPrompt(true)).toBe(COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS);
  });

  test("COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS === BASE_SYSTEM_PROMPT + double-newline + MEMORY_SELF_CONCEPT_WITH_ACTIONS", () => {
    expect(COMPOSED_SYSTEM_PROMPT_WITH_ACTIONS).toBe(
      BASE_SYSTEM_PROMPT + "\n\n" + MEMORY_SELF_CONCEPT_WITH_ACTIONS,
    );
  });

  test("present-variant FLIPS D1-6: does NOT contain the cannot-self-forget clauses", () => {
    expect(MEMORY_SELF_CONCEPT_WITH_ACTIONS).not.toContain(
      "You cannot modify, delete, or forget your own memory.",
    );
    expect(MEMORY_SELF_CONCEPT_WITH_ACTIONS).not.toContain(
      "Never claim to have forgotten, changed, or deleted something you remember",
    );
  });

  test("present-variant owns the capability + boundaries (robust substrings)", () => {
    const lower = MEMORY_SELF_CONCEPT_WITH_ACTIONS.toLowerCase();
    expect(lower).toContain("forget");
    expect(lower).toContain("remember");
    expect(lower).toContain("this turn");
    expect(lower).toContain("memory window");
    expect(lower).toContain("history page");
    expect(lower).toContain("pinned");
    expect(lower).toContain("do not keep using");
    expect(lower).toContain("near-duplicate");
    expect(lower).toContain("never claim");
  });

  test("present-variant KEEPS the still-true clauses (D1-1..5, D1-7, D1-8 carry — spec §3.8)", () => {
    expect(MEMORY_SELF_CONCEPT_WITH_ACTIONS.toLowerCase()).toContain("one persistent agent");
    expect(MEMORY_SELF_CONCEPT_WITH_ACTIONS).toContain("[remembered] ");
    expect(MEMORY_SELF_CONCEPT_WITH_ACTIONS).toContain("FIRST check");
    expect(MEMORY_SELF_CONCEPT_WITH_ACTIONS).toContain("attached");
    expect(MEMORY_SELF_CONCEPT_WITH_ACTIONS).toContain("automatically");
  });
});
