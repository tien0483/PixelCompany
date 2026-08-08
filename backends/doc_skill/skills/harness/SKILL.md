---
name: harness
description: "Builds a harness. A meta-skill that defines specialized agents and creates the skills those agents use. Use it (1) on requests like 'build me a harness' / 'set up a harness', (2) on 'harness design' / 'harness engineering' requests, (3) when standing up a harness-based automation system for a new domain/project, (4) when restructuring or extending an existing harness, (5) on operations/maintenance requests for an existing harness such as 'audit the harness', 'harness status', 'sync the agents/skills'."
---

# Harness — Agent Team & Skill Architect

A meta-skill that builds a harness for a domain/project, defines each agent's role, and creates the skills the agents use.

**Core principles:**
1. Create agent definitions (`.claude/agents/`) and skills (`.claude/skills/`).
2. **Use the agent team as the default execution mode.**
3. **Register a harness pointer in CLAUDE.md.** — Record only a minimal pointer (trigger rule + change log) so the orchestrator skill triggers in new sessions.
4. **A harness is an evolving system, not a fixed artifact.** — Fold in feedback after every run and keep the agents, skills, and CLAUDE.md continuously updated.

## Workflow

### Phase 0: Status Audit

When the harness skill triggers, the first step is to check the existing harness status.

1. Read `project/.claude/agents/`, `project/.claude/skills/`, and `project/CLAUDE.md`.
2. Branch the execution mode based on status:
   - **New build**: agent/skill directories are missing or empty → run the full sequence from Phase 1.
   - **Extend existing**: a harness exists and the request adds a new agent/skill → run only the phases required by the Phase Selection Matrix below.
   - **Operations/maintenance**: a request to audit, modify, or sync an existing harness → jump to the Phase 7-5 operations/maintenance workflow.

   **Phase Selection Matrix when extending:**
   | Change type | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
   |----------|---------|---------|---------|---------|---------|---------|
   | Add agent | Skip (reuse Phase 0 results) | Placement decision only | Required (incl. 3-0) | If a dedicated skill is needed (incl. 4-0) | Update orchestrator | Required |
   | Add/modify skill | Skip | Skip | Skip | Required (incl. 4-0) | If wiring changes | Required |
   | Architecture change | Skip | Required | Affected agents only (incl. 3-0) | Affected skills only (incl. 4-0) | Required | Required |
3. Cross-check the existing agent/skill list against the CLAUDE.md record to detect drift.
4. Summarize the audit for the user and confirm the execution plan.

### Phase 1: Domain Analysis
1. Identify the domain/project from the user's request.
2. Identify the core task types (create, verify, edit, analyze, etc.).
3. Based on the Phase 0 audit, analyze conflicts/overlap with existing agents/skills.
4. Explore the project codebase — identify the tech stack, data models, and key modules.
5. **Detect user proficiency** — infer the user's technical level from context cues in the conversation (terminology used, question depth), and tune your communication tone accordingly. Do not use terms like "assertion" or "JSON schema" without explanation for users with little coding experience.

### Phase 2: Team Architecture Design

#### 2-1. Choose the Execution Mode

**The agent team is the top-priority default.** Whenever two or more agents collaborate, review the agent team option first. Team members self-coordinate through direct communication (SendMessage) and a shared task list (TaskCreate); sharing findings, debating conflicts, and covering gaps raises output quality.

| Mode | When to use | Characteristics |
|------|----------|------|
| **Agent team** (default) | 2+ collaborators, real-time coordination/feedback needed, intermediate artifacts referenced by each other | Self-coordinates via `TeamCreate` + `SendMessage` + `TaskCreate` |
| **Sub-agent** (alternative) | Single-agent work, returning only the result to main is enough, team-communication overhead would be excessive | Call the `Agent` tool directly; parallelize with `run_in_background` |
| **Hybrid** | Phases with different characteristics — e.g. parallel collection (sub) → consensus-based integration (team) | Mix team/sub per phase |

**Decision order:**
1. First check whether the design can be done as an agent team — if 2+ agents, that's the default.
2. Choose sub-agents only when team communication is structurally unnecessary (result hand-off only) and the team overhead outweighs the benefit.
3. If phase characteristics differ markedly, consider hybrid — state each phase's execution mode in the orchestrator.

> For the detailed comparison table and per-pattern decision trees, see "Execution Modes" in `references/agent-design-patterns.md`.

#### 2-2. Choose the Architecture Pattern

1. Decompose the work into specialized domains.
2. Decide the agent team structure (see `references/agent-design-patterns.md` for architecture patterns):
   - **Pipeline**: sequentially dependent tasks
   - **Fan-out/fan-in**: parallel independent tasks
   - **Expert pool**: context-driven selective invocation
   - **Generate-verify**: generate, then quality-check
   - **Supervisor**: a central agent manages state and distributes dynamically
   - **Hierarchical delegation**: a higher-level agent recursively delegates to lower ones

#### 2-3. Agent Separation Criteria

Judge along four axes: specialization, parallelism, context, and reusability. See "Agent Separation Criteria" in `references/agent-design-patterns.md` for the detailed table. Overlap/reuse review against existing agents is handled in Phase 3-0.

### Phase 3: Create Agent Definitions

#### 3-0. Review Overlap with Existing Agents

Before creating a new agent, check for overlap with existing agents in `project/.claude/agents/`. Repeatedly building harnesses tends to accumulate role-overlapping agents under different names.

> For the overlap classification criteria and reuse design, see "Agent Reuse Design" in `references/agent-design-patterns.md`.

**Every agent must be defined as a `project/.claude/agents/{name}.md` file.** Putting a role directly into the Agent tool's prompt without a definition file is forbidden. Why:
- The agent definition must exist as a file to be reusable in the next session.
- The team communication protocol must be stated to guarantee inter-agent collaboration quality.
- The core value of a harness is the separation of agent (who) and skill (how).

Even when using a built-in type (`general-purpose`, `Explore`, `Plan`), still create the agent definition file. Specify the built-in type via the Agent tool's `subagent_type` parameter, and put the role, principles, and protocol in the agent definition file.

**Model setting:** Every agent uses `model: "opus"`. Always specify `model: "opus"` when calling the Agent tool. A harness's quality is tied directly to the agents' reasoning ability, and opus guarantees the best quality.

**Team reconfiguration:** Only one agent team can be active per session, but you can disband a team between phases and form a new one. When a pattern like pipeline needs a different expert mix per phase, save the previous team's artifacts to files, clean up the team, and create a new one.

Define each agent in `project/.claude/agents/{name}.md`. Required sections: core role, working principles, input/output protocol, error handling, collaboration. In agent-team mode, add a `## Team Communication Protocol` section stating message send/receive targets and the scope of task requests.

> For the definition template and full example files, see "Agent Definition Structure" in `references/agent-design-patterns.md` + `references/team-examples.md`.

**Requirements when including a QA agent:**
- The QA agent must use the `general-purpose` type (`Explore` is read-only and cannot run verification scripts).
- The heart of QA is not "existence checking" but **"cross-boundary comparison"** — read the API response and the frontend hook at the same time and compare their shapes.
- QA runs not once after full completion, but **incrementally, right after each module is completed** (incremental QA).
- Detailed guide: see `references/qa-agent-guide.md`.

### Phase 4: Create Skills

Create the skills each agent uses in `project/.claude/skills/{name}/SKILL.md`. See `references/skill-writing-guide.md` for the detailed writing guide.

#### 4-0. Review Overlap with Existing Skills

Before creating a new skill, check for overlap with existing skills in `project/.claude/skills/`. Repeatedly building harnesses tends to accumulate function-overlapping skills under different names.

> For the overlap classification criteria and generalization patterns, see "Skill Reuse Design" in `references/skill-writing-guide.md`.

#### 4-1. Skill Structure

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown body
└── Bundled Resources (optional)
    ├── scripts/    - executable code for repetitive/deterministic tasks
    ├── references/ - reference docs loaded conditionally
    └── assets/     - files used in output (templates, images, etc.)
```

#### 4-2. Writing the Description — Drive Triggering Aggressively

The description is a skill's only trigger mechanism. Claude tends to judge triggers conservatively, so write the description **aggressively ("pushy")**.

**Bad:** `"A skill that processes PDF documents"`
**Good:** `"Performs all PDF work — reading PDF files, extracting text/tables, merging, splitting, rotating, watermarking, encryption, OCR, and more. Whenever a .pdf file is mentioned or a PDF deliverable is requested, this skill MUST be used."`

Key: describe both what the skill does + the concrete trigger situations, and write it so it's distinguished from similar cases that should NOT trigger.

#### 4-3. Body-Writing Principles

| Principle | Description |
|------|------|
| **Explain the Why** | Instead of coercive directives like "ALWAYS/NEVER," convey the reason it should be done that way. When the LLM understands the reason, it judges correctly even in edge cases. |
| **Stay lean** | The context window is a commons. Aim for under 500 lines in the SKILL.md body; delete or move to references/ anything that doesn't earn its weight. |
| **Generalize** | Instead of narrow rules that fit only a specific example, explain the principle so it handles varied inputs. No overfitting. |
| **Bundle repeated code** | When test runs reveal a script agents commonly write, pre-bundle it under `scripts/`. |
| **Write imperatively** | Use an imperative/directive tone ("do", "state", "verify"). |

#### 4-4. Progressive Disclosure

A skill manages context with a 3-stage loading system:

| Stage | Load timing | Size target |
|------|----------|----------|
| **Metadata** (name + description) | Always in context | ~100 words |
| **SKILL.md body** | On skill trigger | <500 lines |
| **references/** | Only when needed | Unlimited (scripts can run without loading) |

**Size-management rules:**
- When SKILL.md approaches 500 lines, split details into references/ and leave a pointer in the body for "when to read this file."
- Include a **table of contents (ToC)** at the top of any reference file over 300 lines.
- When there are domain/framework variants, split them by domain under references/ so only the relevant file loads.

```
cloud-deploy/
├── SKILL.md (workflow + selection guide)
└── references/
    ├── aws.md    ← loads only when AWS is chosen
    ├── gcp.md
    └── azure.md
```

#### 4-5. Skill–Agent Linking Principles

- 1 agent ↔ 1..N skills (1:1 or 1:many)
- A skill shared by multiple agents is also possible.
- The skill holds "how it's done," the agent holds "who does it."

> For detailed writing patterns, examples, and the data-schema standard, see `references/skill-writing-guide.md`.

### Phase 5: Integration and Orchestration

The orchestrator is a special form of skill that weaves individual agents and skills into a single workflow to coordinate the whole team. If the individual skills created in Phase 4 define "what each agent does and how," the orchestrator defines "who collaborates, when, and in what order." See `references/orchestrator-template.md` for the concrete template.

**Modifying the orchestrator when extending:** When extending an existing harness rather than building new, modify the existing orchestrator instead of creating a new one. When adding an agent, reflect it in team composition, task allocation, and data flow, and add trigger keywords for the new agent to the description.

The orchestrator pattern depends on the execution mode chosen in Phase 2-1:

#### 5-0. Orchestrator Patterns (by mode)

**Agent team pattern (default):**
The orchestrator forms a team with `TeamCreate` and allocates work with `TaskCreate`. Members communicate directly via `SendMessage` and self-coordinate. The leader (orchestrator) monitors progress and synthesizes results.

```
[Orchestrator/Leader]
    ├── TeamCreate(team_name, members)
    ├── TaskCreate(tasks with dependencies)
    ├── members self-coordinate (SendMessage)
    ├── collect and synthesize results
    └── clean up team
```

**Sub-agent pattern (alternative):**
The orchestrator calls sub-agents directly with the `Agent` tool. Parallelize with `run_in_background: true`; results return only to main. Use it when team communication is unnecessary and you want to reduce overhead.

```
[Orchestrator]
    ├── Agent(agent-1, run_in_background=true)
    ├── Agent(agent-2, run_in_background=true)
    ├── await and collect results
    └── produce the integrated artifact
```

**Hybrid pattern:**
Mix a different mode per phase. Common combinations:
- **Parallel collection (sub) → consensus integration (team)**: Phase 2 collects independent material in parallel with sub-agents → Phase 3 forms a team for debate/consensus-based integration.
- **Team generation (team) → verification (sub)**: Phase 2 has a team produce a draft → Phase 3 has a single sub-agent verify independently.
- **Inter-phase team reconfiguration**: `TeamDelete` then a fresh `TeamCreate` each phase, with a sub-agent call inserted between.

When choosing hybrid, state the execution mode at the top of each phase section in the orchestrator (e.g. `**Execution mode:** agent team`).

#### 5-1. Data-Passing Protocol

State the inter-agent data-passing method inside the orchestrator:

| Strategy | Method | Applicable modes | Suits |
|------|------|----------|-----------|
| **Message-based** | Direct member-to-member via `SendMessage` | Team | Real-time coordination, feedback exchange, light state passing |
| **Task-based** | Share task state via `TaskCreate`/`TaskUpdate` | Team | Progress tracking, dependency management, requesting work itself |
| **File-based** | Write and read files at agreed paths | Team + Sub | Large data, structured artifacts, audit trail needed |
| **Return-value-based** | The `Agent` tool's return message | Sub | Main collects sub-agent results directly |

**Recommended combo (team mode):** task-based (coordination) + file-based (artifacts) + message-based (real-time communication)
**Recommended combo (sub mode):** return-value-based (result collection) + file-based (large artifacts)
**Hybrid:** apply the matching combo per phase's execution mode.

Rules for file-based passing:
- Create a `_workspace/` folder under the working directory to store intermediate artifacts.
- Filename convention: `{phase}_{agent}_{artifact}.{ext}` (e.g. `01_analyst_requirements.md`).
- Output only the final artifact to the user-specified path; preserve intermediate files (`_workspace/`) for post-hoc verification/audit trail.

#### 5-2. Error Handling

Include an error-handling policy in the orchestrator. Core principles: retry once, and on a second failure proceed without that result (note the omission in the report); do not delete conflicting data, annotate it with its source.

> For the per-error-type strategy table and implementation details, see "Error Handling" in `references/orchestrator-template.md`.

#### 5-3. Team-Size Guidelines

| Work scale | Recommended members | Tasks per member |
|----------|------------|--------------|
| Small (5–10 tasks) | 2–3 | 3–5 |
| Medium (10–20 tasks) | 3–5 | 4–6 |
| Large (20+ tasks) | 5–7 | 4–5 |

> The more members, the higher the coordination overhead. Three focused members beat five scattered ones.

#### 5-4. Register the Harness Pointer in CLAUDE.md

After the harness is built, register a minimal pointer in the project's `CLAUDE.md`. Since CLAUDE.md loads every new session, recording only the harness's existence and trigger rule lets the orchestrator skill handle the rest.

**CLAUDE.md template:**

````markdown
## Harness: {domain name}

**Goal:** {one line on the harness's core goal}

**Trigger:** For work related to {domain}, use the `{orchestrator-skill-name}` skill. Simple questions can be answered directly.

**Change log:**
| Date | Change | Target | Reason |
|------|----------|------|------|
| {YYYY-MM-DD} | Initial build | All | - |
````

**What NOT to put in CLAUDE.md:** the agent list, the skill list, the directory structure, detailed execution rules. Why: the agent/skill lists are managed by the orchestrator skill and by `.claude/agents/` and `.claude/skills/`, so they'd be duplicated. The directory structure is verifiable directly from the filesystem. CLAUDE.md holds only the **pointer (trigger rule) + change log**.

#### 5-5. Follow-up Support

The orchestrator must handle not just the initial run but follow-up work. Guarantee these three:

**1. Include follow-up keywords in the orchestrator description:**
Initial-build keywords alone won't trigger follow-up requests. Follow-up phrasings the description must include:
- "run again," "re-run," "update," "modify," "supplement"
- "just the {sub-task} of {domain} again"
- "based on the previous result," "improve the result"

**2. Add a context-check step to orchestrator Phase 1:**
At workflow start, check whether prior artifacts exist to decide the execution mode:
- `_workspace/` exists + user requests a partial fix → **partial re-run** (re-invoke only that agent)
- `_workspace/` exists + user provides new input → **fresh run** (move existing `_workspace` to `_workspace_prev/`)
- `_workspace/` absent → **initial run**

**3. Include re-invocation guidance in agent definitions:**
State "behavior when a prior artifact exists" in each agent `.md` file:
- If a prior result file exists, read it and fold in improvements.
- If user feedback is given, modify only that part.

> See the "Phase 0: Context Check" section of the orchestrator template: `references/orchestrator-template.md`

### Phase 6: Verification and Testing

Verify the built harness. See `references/skill-testing-guide.md` for the detailed test methodology.

#### 6-1. Structure Verification

- Confirm every agent file is in the correct location.
- Verify the skill frontmatter (name, description).
- Confirm cross-agent reference consistency.
- Confirm no commands were created.

#### 6-2. Per-Mode Verification

- **Agent team**: check inter-member communication paths, task dependencies, and team-size appropriateness.
- **Sub-agent**: check each agent's I/O wiring, `run_in_background` settings, and return-value collection logic.
- **Hybrid**: check that each phase's execution mode is stated in the orchestrator and that data passing isn't broken at phase boundaries (when switching team → sub, that the team's artifact connects to the sub's input).

#### 6-3. Skill Execution Testing

Run an actual execution test for each created skill:

1. **Write test prompts** — write 2–3 realistic test prompts per skill. Use concrete, natural sentences an actual user might type.

2. **With-skill vs without-skill comparison** — if possible, run with-skill and without-skill in parallel to confirm the skill's added value. Spawn two agents each:
   - **With-skill**: read the skill and do the work.
   - **Without-skill (baseline)**: do the same prompt without the skill.

3. **Evaluate results** — evaluate artifact quality qualitatively (user review) + quantitatively (assertion-based). When the artifact is objectively verifiable (file creation, data extraction, etc.), define assertions; when subjective (style, design), rely on user feedback.

4. **Iterative improvement loop** — when the test reveals a problem:
   - **Generalize** the feedback and fix the skill (no narrow fix that fits only one example).
   - Re-test after the fix.
   - Repeat until the user is satisfied or there's no meaningful improvement left.

5. **Bundle repeated patterns** — when test runs reveal code agents commonly write (e.g. the same helper script generated in every test), pre-bundle it under `scripts/`.

#### 6-4. Trigger Verification

Verify each skill's description triggers correctly:

1. **Should-trigger queries** (8–10) — varied phrasings that should trigger the skill (formal/casual, explicit/implicit).
2. **Should-NOT-trigger queries** (8–10) — "near-miss" queries with similar keywords for which a different tool/skill is the right fit.

**Key to writing near-misses:** an obviously unrelated query like "write a Fibonacci function" has no test value. A **borderline query** — like "extract this Excel file's chart to PNG" (xlsx skill vs image conversion) — makes a good test case.

Also check trigger conflicts with existing skills at this step.

#### 6-5. Dry-Run Test

- Review whether the orchestrator skill's phase order is logical.
- Confirm there are no dead links in the data-passing path.
- Confirm every agent's input matches a prior phase's output.
- Confirm the fallback path per error scenario is executable.

#### 6-6. Write Test Scenarios

- Add a `## Test Scenarios` section to the orchestrator skill.
- Describe at least one normal flow + one error flow.

### Phase 7: Harness Evolution

A harness is not a static artifact you make once and finish. It's a system that keeps evolving with user feedback.

#### 7-1. Collect Feedback After Each Run

After every harness run completes, ask the user for feedback:
- "Anything to improve in the result?"
- "Anything you'd like to change in the team composition or workflow?"

If there's no feedback, move on. Don't force it, but always offer the chance.

#### 7-2. Feedback Routing

The modification target differs by feedback type:

| Feedback type | Modify | Example |
|-----------|----------|------|
| Output quality | that agent's skill | "analysis too shallow" → add depth criteria to the skill |
| Agent role | agent definition `.md` | "need a security review too" → add a new agent |
| Workflow order | orchestrator skill | "should verify first" → change phase order |
| Team composition | orchestrator + agents | "these two could merge" → merge agents |
| Missing trigger | skill description | "this phrasing doesn't work" → expand the description |

#### 7-3. Change Log

Record every change in the **change log** table in CLAUDE.md (same table as the "Change log" section of the Phase 5-4 template):

```markdown
**Change log:**
| Date | Change | Target | Reason |
|------|----------|------|------|
| 2026-04-05 | Initial build | All | - |
| 2026-04-07 | Added QA agent | agents/qa.md | feedback: insufficient output-quality verification |
| 2026-04-10 | Added tone guide | skills/content-creator | feedback: "too stiff" |
```

This log lets you track how the harness evolved and prevents regression.

#### 7-4. Evolution Triggers

Propose evolution not only when the user explicitly says "modify the harness," but also when:
- The same type of feedback recurs 2+ times.
- A pattern of an agent repeatedly failing is found.
- The user is observed doing work manually, bypassing the orchestrator.

#### 7-5. Operations/Maintenance Workflow

Systematically audit, modify, and sync an existing harness. Follow this workflow when Phase 0 branched into "operations/maintenance."

**Step 1: Status audit**
- Compare the `.claude/agents/` file list against the orchestrator skill's agent composition → produce a mismatch list.
- Compare the `.claude/skills/` directory list against the orchestrator skill's skill composition → produce a mismatch list.
- Report the audit result to the user.

**Step 2: Incremental add/modify**
- Add/modify/delete agents and skills per the user's request.
- Change one at a time; run Step 3 (sync) immediately after each change.

**Step 3: Update the CLAUDE.md change log**
- Record date, change, target, and reason in the change-log table.

**Step 4: Verify the change**
- Structure-verify the modified agent/skill (per Phase 6-1).
- If the change scope affects triggers, do trigger verification (per Phase 6-4).
- For large changes (architecture change, adding/deleting 3+ agents), go through Phase 6-3 (execution test) and 6-5 (dry-run).
- Finally confirm CLAUDE.md matches the actual files.

## Deliverable Checklist

Confirm after creation:

- [ ] `project/.claude/agents/` — **agent definition files created (required)** (file required even for built-in types)
- [ ] `project/.claude/skills/` — skill files (SKILL.md + references/)
- [ ] 1 orchestrator skill (includes data flow + error handling + test scenarios)
- [ ] Execution mode stated (agent team / sub-agent / hybrid; if hybrid, per-phase mode noted)
- [ ] `model: "opus"` specified on every Agent call
- [ ] Overlap review against existing agents done before creating a new agent (Phase 3-0)
- [ ] Overlap review against existing skills done before creating a new skill (Phase 4-0)
- [ ] `.claude/commands/` — nothing created
- [ ] No conflict with existing agents/skills
- [ ] Skill descriptions written aggressively ("pushy") — **including follow-up keywords**
- [ ] SKILL.md body under 500 lines; if exceeded, split into references/
- [ ] Execution verified with 2–3 test prompts
- [ ] Trigger verification done (should-trigger + should-NOT-trigger)
- [ ] **Harness pointer registered in CLAUDE.md** (trigger rule + change log)
- [ ] **Agent/skill add/delete/modify recorded in the CLAUDE.md change log**
- [ ] **Context-check step in orchestrator Phase 1** (distinguish initial/follow-up/partial re-run)

## References

- Harness patterns: `references/agent-design-patterns.md`
- Existing harness examples (with full example files): `references/team-examples.md`
- Orchestrator template: `references/orchestrator-template.md`
- **Skill writing guide**: `references/skill-writing-guide.md` — writing patterns, examples, data-schema standard
- **Skill testing guide**: `references/skill-testing-guide.md` — test/evaluation/iterative-improvement methodology
- **QA agent guide**: `references/qa-agent-guide.md` — reference when including a QA agent in a build harness. Includes integration-consistency verification methodology, boundary bug patterns, and a QA agent definition template. Based on 7 real bugs found in an actual project.
