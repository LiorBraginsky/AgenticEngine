# Notes on locally accumulated AgenticEngine memory

Review date: 2026-10-09.

This is a standalone informational note for the team. It does not establish working rules, change the roadmap, or specify a future system.

## Where the material lives

Lior's machine contains `~/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/`. At the time of review, this directory contained 26 Markdown files, including the `MEMORY.md` index.

The files contain lessons from agent execution, conveyor history, decision rationale, deferred questions, research notes, and Lior's personal working preferences. This was a selective review, not a complete export or an audit of all Claude Code sessions. A stored entry establishes that a claim was recorded; it does not independently establish that the claim is true.

## Material worth preserving for future design work

### Verifying actual behavior

`feedback_behavioral_dod_needs_runtime_proof.md` records specific gaps between passing tests and a working product:

- Injecting a test client bypassed construction of the real API client, hiding an API-key configuration problem.
- Instant mock responses hid a race between the handshake timeout and response generation.
- A production-path probe had been written and typechecked, but actually running it exposed an infinite re-execution loop caused by reloading `.env`.

These details are recorded in local memory; the incidents were not reproduced during this review. The requirement for runtime evidence is independently confirmed in the current `orchestration/docs/PIPELINE.md`, §6.1. The material can inform verification scenarios; it does not prove that the current version works.

### Hidden dependencies between tasks

`feedback_decompose_check_runtime_coupling.md` describes dependencies despite separate files: a shared reducer, changes to response ordering, widening a discriminated union, and treating `session_end{reason:"error"}` as successful promise resolution.

Runtime coupling and its historical example are also documented in PIPELINE §7.1. The detailed examples of shared types and terminal reasons in memory provide additional context for future decomposition and integration checks.

### Recovery and execution isolation

`project_pipeline_automation.md` records separate-session execution, recovery from files, and shared-working-tree hazards.

This was cross-checked against `orchestration/docs/experiments/2026-06-06-conveyor-pilot.md`: the report records three disruptions, no lost work, and a requirement for one worker per shared tree. This is a historical pilot result, not a guarantee for a future cloud system.

### Limits of demonstrated autonomy

Local memory explicitly distinguishes supervised from unattended autonomy. The pilot ran with Lior available and with independent verification by the conductor.

The pilot report records six chunks, zero bad-main events, zero manual brief relays, and the need for further hardening through CI and branch protection. These results should not be presented as a test of a fully autonomous cloud agent.

### History of architectural intent

Entries discuss swappable providers, concurrent contexts, background tasks, result routing, and a later reconsideration of product direction. They explain which questions have already been discussed. They do not establish that those capabilities were implemented or choose a new direction on the team's behalf.

## What the review established about currency

The directory is not uniformly outdated, and overlaps with repository documentation are not necessarily accidental duplicates. Specific findings follow:

| Entry | Finding | How to interpret it |
|---|---|---|
| `reference_folder_conventions.md` | Explicitly marked as a pointer after rules moved into PIPELINE; includes a summary and the local memory location | An intentional reference, not a separate authoritative version |
| `feedback_orchestrator_per_task_commits.md` | The older entry prohibits pushing without a separate instruction; current conveyor rules authorize pushing a feature branch | Historical policy, not current authority |
| `feedback_behavioral_dod_needs_runtime_proof.md` | Describes codifying runtime proof as future work; the rule already exists in PIPELINE §6.1 | Useful incidents; the TODO does not reflect the current state |
| `feedback_decompose_check_runtime_coupling.md` | Contains a deferred TODO to name coupling through shared types; PIPELINE §3.1 already explicitly mentions type surface and widening unions, although §7.1 mainly describes runtime coupling | Check the specific documentation section before repeating the TODO |
| `project_llm_provider_abstraction_direction.md` | Dated 2026-06-02; describes the first post-v0 build and pending decisions | Design history, not an inventory of implemented capabilities |
| `project_pipeline_automation.md` | Contains assumptions about subagent nesting limits in a particular execution environment | Do not treat these as universal agent limitations |
| `reference_claude_code_automation_billing.md` | Contains dates, prices, and billing claims; the entry itself limits its empirical test to the period before a claimed billing change | Current billing was not verified in this review; do not use it for cost calculations |
| `project_prior_art_findings.md` | Explicitly labels specific figures and CVEs as unverified | Do not carry competitor claims forward as established facts |

The `MEMORY.md` index also contains a long status history and older next-step recommendations. It is useful for finding entries; the current backlog should be determined from repository documents and team decisions.

## Practical value for the team

Local memory contains material for regression scenarios, recovery and worker-isolation requirements, and explanations of how process rules arose. Some rules have already moved into the repository. Memory adds incident details and decision context.

Before using an entry, distinguish historical observations, current rules, and unverified assumptions. Lior's personal preferences are not global requirements for a future multi-user agent.

The local memory files were not modified during this review. Raw chat histories, account configuration, and credentials were not exported into this note.
