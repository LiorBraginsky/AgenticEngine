# Notes on locally accumulated AgenticEngine memory

Review date: 2026-10-09.

This is a standalone informational note for the team. It does not establish working rules, change the roadmap, or specify a future system.

## Where the material lives

Lior's machine contains `~/.claude/projects/-Users-lior-WebstormProjects-playground-AgenticEngine/memory/`. At the time of review, this directory contained 26 Markdown files, including the `MEMORY.md` index.

The files contain lessons from agent execution, conveyor history, decision rationale, deferred questions, research notes, and Lior's personal working preferences. This was a selective review, not a complete export or an audit of all Claude Code sessions. A stored entry establishes that a claim was recorded; it does not independently establish that the claim is true.

The sections below include the substantive lessons in English so teammates do not need access to the local files. Filenames identify provenance; they are not required reading.

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

## Substantive lessons preserved from the local records

The following is an edited digest, not a verbatim dump. Historical incidents are attributed to their records. Implications for a future cloud agent are suggestions, not claims that those safeguards already exist.

### 1. Test the production boundary, not only the logic around it

The recorded API-client incident had two independent causes. The production provider constructed its SDK client with an empty API key when no explicit options were supplied. Unit tests supplied an injected client, so they never executed the faulty constructor. Separately, the overlay allowed only two seconds for a handshake while the provider waited for generation before emitting its outbound events. Fast mocks could not expose that timing problem.

The lesson is specific: dependency injection can remove the very configuration and timing behavior that needs verification. A useful check constructs the real client through the production configuration path and exercises the actual transport. Passing mocked tests remains useful evidence for the tested logic, but does not establish that authentication, startup, or network timing works.

The later probe incident sharpened this lesson. A probe intended to simulate a clean production environment re-executed itself, but Bun reloaded `.env` from its working directory. The API-key environment variable reappeared and triggered another re-execution. The recorded fix used a temporary working directory and a once-only sentinel that failed explicitly instead of looping. The probe's existence and successful typecheck had not exposed the defect because it had not been run end to end.

Source: `feedback_behavioral_dod_needs_runtime_proof.md`. The incidents were not rerun for this note. PIPELINE §6.1 confirms the corresponding evidence requirement.

Potential cloud-agent application: success checks should exercise the actual delivery path. Preparing an email does not prove delivery; generating a file does not prove that the requesting user can retrieve it. Each task needs an observable completion condition appropriate to its tools.

### 2. Independent files do not mean independent tasks

One recorded pair of chunks changed different directories. The mock-agent chunk changed the daemon's response to `session_start` from an acknowledgement followed by completion to an acknowledgement followed by a tool call awaiting a user selection. The overlay chunk expected the earlier behavior, so its round trip stopped working despite the unchanged envelope schema.

Another incident widened a shared discriminated union. The protocol package compiled, but consumers that read picker-specific arguments without checking the tool discriminator no longer typechecked. A third incident treated every resolved session promise as success, although `session_end` could carry an error reason. The UI's rejection handler therefore never displayed the provider error.

The preserved lesson is to inspect shared state, exported types, event ordering, and terminal outcomes when assessing dependencies. Integration checks must use the baseline that actually exists after other work lands.

Source: `feedback_decompose_check_runtime_coupling.md`; the reducer example is also documented in PIPELINE §7.1.

Potential cloud-agent application: two agents touching different files can still interfere through shared credentials, browser sessions, databases, queues, or external accounts. Parallel execution needs a resource-dependency check, not merely a file-overlap check.

### 3. Recoverable work needs an explicit persisted handoff

The pilot report records a conductor failure during HTTP 529 errors, a worker stopped by a token limit, and a branch-switch disruption. It reports no lost work across those three disruptions. The recovery material lived in repository files, generated briefs, and the ledger rather than only in chat context.

The report also records the limitation: the conductor died before persisting some findings, so those findings had to be reconstructed. Persisting source changes alone does not preserve pending decisions, why a task is blocked, or what verification remains.

Sources: `project_pipeline_automation.md` and the pilot report's findings and metrics sections.

Potential cloud-agent application: persist the task's progress, outputs, blockers, and evidence needed for continuation. This pilot does not establish crash-safe handling of external side effects. Avoiding duplicate sends, payments, or writes after a retry requires additional design and verification.

### 4. Separate conversations do not isolate resources

The pilot's workers and conductor initially shared a checkout. A worker could switch the branch underneath the conductor. The report also records a conductor commit landing on local main after a human changed the branch between steps; it was corrected without pushing main.

The operational response was one worker per shared tree, checking the branch before commits, and independent verification on a clean checkout. Separate worktrees were identified as the isolation mechanism for concurrent workers.

Sources: `project_pipeline_automation.md` and the pilot report, findings on shared trees and branch switching.

Potential cloud-agent application: isolate each task's mutable execution resources explicitly. A new model session is not an isolation boundary for a filesystem or account. Worktree isolation addresses repository state; it does not automatically isolate databases, browser profiles, or remote services.

### 5. The executor must not redefine success to match its output

The local authority note explains two reasons for keeping scope and acceptance criteria outside the executor's unilateral control. First, the executor may lack the planner's rationale for deliberately excluding work. Second, allowing it to edit its own acceptance criteria creates a way to make incomplete work appear complete.

The recorded approach separates reporting a problem from deciding a change. Workers can flag contradictions and propose corrections. New scope or contract changes return to the layer authorized to make that decision. The handoff should preserve boundary rationale, such as why work is excluded or deferred, rather than supplying only a task list.

The escalation discriminator is concrete: cite the conflicting requirement or identify a decision that would be expensive to reverse. Routine, reversible assumptions without such a conflict need not become a user interruption.

Source: `feedback_orchestrator_plan_edit_authority.md`, cross-checked against PIPELINE §7.2. Its repository-specific approval rules are historical context for this note, not an authorization model for a future service.

Potential cloud-agent application: preserve the user's requested outcome separately from the agent's execution plan. An agent can revise its approach without silently weakening what counts as completion.

### 6. Autonomy should be measured by interventions and outcomes

The pilot report covers six chunks and records zero bad-main events, zero manual brief relays, and three recoverable disruptions. It records human involvement in architectural decisions, sequencing, a chunk split, and the live demo. The local note explicitly says this demonstrated supervised autonomy, not unattended operation.

Those qualifications matter. A system that works while its owner promptly answers escalations has not yet demonstrated that it can remain safe and make progress when nobody is watching. Likewise, eliminating manual brief copying does not establish that agents can resolve arbitrary cross-task dependencies.

Sources: `project_pipeline_automation.md` and the pilot report. These are reported historical measurements, not a fresh benchmark.

Potential cloud-agent application: measure required interventions, verified completion, failed or duplicated actions, recovery behavior, and cost per completed task. Agent count and tool-call count alone do not measure autonomy.

### 7. Persistent memory needs stability and user control

The local index records a memory implementation that repeatedly rebuilt the complete fact projection from the archive. ADR-0012's accepted 2026-06-13 amendment independently confirms the problem: rerunning global projection could change unrelated existing facts. The design moved to incremental accumulation, with existing facts retained unless explicitly replaced or forgotten.

The accepted ADR also records a searchable archive separate from a bounded set of facts used as prompt context, provenance, user access to view/edit/forget memory, and protection against silent overwrites of human-authored entries. These are documented design decisions, not a fresh audit of the current implementation.

A later accepted rider makes an important product-specific distinction: deleting a source conversation does not automatically delete the facts extracted from it. Facts have their own edit and forget operations. This can preserve a user's correction, but the distinction must be visible to the user. It is not a universal deletion policy to apply to another product without deciding its semantics.

Sources: `MEMORY.md`, `project_conversational_interaction_model.md`, and ADR-0012's accepted amendment and 2026-07-10 rider. Older memory proposals also mention expiry and confidence; their active enforcement is not established by this review.

Potential cloud-agent application: decide separately what is retained as history, what becomes reusable memory, who owns it, and what deletion removes. A remembered statement should remain attributable and correctable rather than silently becoming permanent authority.

### 8. Historical decisions should be revisitable without silent overrides

One feedback entry records an assistant rejecting a new widget idea too quickly because an existing ADR appeared to rule it out. The correction was to examine what the ADR actually covered, identify the genuinely new case, and reconsider the decision explicitly when justified.

The useful lesson is a balance: an old decision is neither an eternal prohibition nor permission to change behavior silently. Preserve its rationale and conditions so the team can determine whether the new requirement warrants a revision.

Source: `feedback_dont_dogmatically_reject_evolving_vision.md`. This records Lior's feedback and its trigger, not a claim about which widget technology the team should adopt now.

### 9. Model APIs and complete agent runtimes have different responsibilities

The provider-direction note anticipated two integration shapes: a model API called by a tool loop owned by AgenticEngine, and an external agent runtime that owns its own planning and tool loop. These should not be treated as interchangeable merely because both produce text.

The reusable design question is ownership: who executes tools, retains state, handles cancellation, requests approval, and declares completion? The note preserves that question, but its historical SDK and authentication recommendations are not validated here.

Source: `project_llm_provider_abstraction_direction.md`.

Potential cloud-agent application: describe each executor's capabilities and control boundaries. Supporting several model names does not by itself establish support for several independently managed agent runtimes.

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
