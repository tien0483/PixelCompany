# Orchestrator Skill Template

An orchestrator is a top-level skill that coordinates an entire team. It provides three templates, one per execution mode:

- **Template A: Agent Team Mode (default)** — the first choice when two or more agents collaborate
- **Template B: Sub-Agent Mode (alternative)** — for cases where team communication is unnecessary
- **Template C: Hybrid Mode** — mixes modes on a per-phase basis

---

## Template A: Agent Team Mode (default · first choice)

The **default mode you evaluate first** when two or more agents collaborate. It builds a team with `TeamCreate` and coordinates through a shared task list and `SendMessage`.

```markdown
---
name: {domain}-orchestrator
description: "Orchestrator that coordinates the {domain} agent team. {initial trigger keywords}. Follow-up work: always use this skill for editing {domain} results, partial re-runs, updates, refinements, re-runs, or requests to improve previous results."
---

# {Domain} Orchestrator

An integrated skill that coordinates the {domain} agent team to produce {final deliverable}.

## Execution Mode: Agent Team

## Agent Composition

| Member | Agent Type | Role | Skill | Output |
|------|-------------|------|------|------|
| {teammate-1} | {custom or built-in} | {role} | {skill} | {output-file} |
| {teammate-2} | {custom or built-in} | {role} | {skill} | {output-file} |
| ... | | | | |

## Workflow

### Phase 0: Context Check (follow-up support)

Determine the execution mode by checking whether prior deliverables exist:

1. Check whether the `_workspace/` directory exists
2. Decide the execution mode:
   - **`_workspace/` does not exist** → initial run. Proceed to Phase 1
   - **`_workspace/` exists + user requests a partial edit** → partial re-run. Re-invoke only the relevant agent(s), and overwrite only the deliverables targeted for editing
   - **`_workspace/` exists + new input provided** → new run. Move the existing `_workspace/` to `_workspace_{YYYYMMDD_HHMMSS}/`, then proceed to Phase 1
3. On a partial re-run: include the paths to the previous deliverables in the agent prompt so the agent reads the existing results and incorporates the feedback

### Phase 1: Preparation
1. Analyze user input — {what is being determined}
2. Create `_workspace/` in the working directory
   - **Initial run**: create a fresh `_workspace/`
   - **New run**: recreate a fresh `_workspace/` immediately after moving the existing `_workspace/` to `_workspace_{YYYYMMDD_HHMMSS}/`
3. Save the input data to `_workspace/00_input/`

### Phase 2: Team Setup

1. Create the team:
   ```
   TeamCreate(
     team_name: "{domain}-team",
     members: [
       { name: "{teammate-1}", agent_type: "{type}", model: "opus", prompt: "{role description and task instructions}" },
       { name: "{teammate-2}", agent_type: "{type}", model: "opus", prompt: "{role description and task instructions}" },
       ...
     ]
   )
   ```

2. Register tasks:
   ```
   TaskCreate(tasks: [
     { title: "{task1}", description: "{details}", assignee: "{teammate-1}" },
     { title: "{task2}", description: "{details}", assignee: "{teammate-2}" },
     { title: "{task3}", description: "{details}", depends_on: ["{task1}"] },
     ...
   ])
   ```

   > 5–6 tasks per teammate is about right. Declare dependent tasks with `depends_on`.

### Phase 3: {main work — e.g. research/generation/analysis}

**Execution style:** teammates self-coordinate

Teammates claim tasks from the shared task list and carry them out independently.
The leader monitors progress and steps in when needed.

**Inter-teammate communication rules:**
- {teammate-1} passes {what information} to {teammate-2} via SendMessage
- On completing a task, {teammate-2} saves the result to a file and notifies the leader
- When a teammate needs another teammate's result, it requests it via SendMessage

**Deliverable storage:**

| Member | Output Path |
|------|----------|
| {teammate-1} | `_workspace/{phase}_{teammate-1}_{artifact}.md` |
| {teammate-2} | `_workspace/{phase}_{teammate-2}_{artifact}.md` |

**Leader monitoring:**
- Receive an automatic notification when a teammate goes idle
- When a specific teammate is blocked, give instructions or reassign the task via SendMessage
- Check overall progress with TaskGet

### Phase 4: {follow-up work — e.g. verification/integration}
1. Wait for all teammates to complete their tasks (check status with TaskGet)
2. Collect each teammate's deliverable with Read
3. {integration/verification logic}
4. Produce the final deliverable: `{output-path}/{filename}`

### Phase 5: Cleanup
1. Ask teammates to shut down (SendMessage)
2. Tear down the team (TeamDelete)
3. Preserve the `_workspace/` directory (do not delete intermediate deliverables — they support post-hoc verification and audit trails)
4. Report a summary of the results to the user

> **When team reconfiguration is needed:** if different phases require different specialist combinations, tear down the current team with TeamDelete, then build the next phase's team with a new TeamCreate. The previous team's deliverables are preserved in `_workspace/`, so the new team can access them with Read.

## Data Flow

```
[leader] → TeamCreate → [teammate-1] ←SendMessage→ [teammate-2]
                          │                           │
                          ↓                           ↓
                    artifact-1.md              artifact-2.md
                          │                           │
                          └───────── Read ────────────┘
                                     ↓
                              [leader: integrate]
                                     ↓
                              final deliverable
```

## Error Handling

| Situation | Strategy |
|------|------|
| One teammate fails/stops | Leader detects → checks status via SendMessage → restarts or creates a replacement teammate |
| Majority of teammates fail | Notify the user and confirm whether to proceed |
| Timeout | Use the partial results collected so far; shut down unfinished teammates |
| Data conflict between teammates | Cite the sources and keep both; do not delete |
| Stale task status | Leader verifies with TaskGet, then updates manually with TaskUpdate |

## Test Scenarios

### Normal flow
1. User provides {input}
2. Phase 1 derives {analysis result}
3. Phase 2 builds the team ({N} teammates + {M} tasks)
4. In Phase 3, teammates self-coordinate and carry out the work
5. Phase 4 integrates the deliverables into the final result
6. Phase 5 tears down the team
7. Expected result: `{output-path}/{filename}` is created

### Error flow
1. In Phase 3, {teammate-2} stops with an error
2. The leader receives an idle notification
3. Checks status via SendMessage → attempts a restart
4. If the restart fails, reassign {teammate-2}'s task to {teammate-1}
5. Proceed to Phase 4 with the remaining results
6. Note in the final report that "part of the {teammate-2} area is uncollected"
```

---

## Template B: Sub-Agent Mode (alternative)

For cases where the overhead of team communication is unnecessary. Invoke agents directly with the `Agent` tool and collect results from the return values.

```markdown
---
name: {domain}-orchestrator
description: "Orchestrator that coordinates {domain} agents. {initial trigger keywords}. Includes follow-up work keywords."
---

## Execution Mode: Sub-Agent

## Agent Composition

| Agent | subagent_type | Role | Skill | Output |
|---------|--------------|------|------|------|
| {agent-1} | {built-in or custom} | {role} | {skill} | {output-file} |
| {agent-2} | ... | ... | ... | ... |

## Workflow

### Phase 0: Context Check
(Same as Template A — branch on whether `_workspace/` exists)

### Phase 1: Preparation
1. Analyze input
2. Create `_workspace/` (on an initial run, or immediately after moving the existing `_workspace/` to an archive directory on a new run)

### Phase 2: Parallel Execution
Invoke N Agent tools concurrently in a single message:

| Agent | Input | Output | model | run_in_background |
|---------|------|------|-------|-------------------|
| {agent-1} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` | opus | true |
| {agent-2} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` | opus | true |

### Phase 3: Integration
1. Collect each agent's return value
2. Collect file-based deliverables with Read
3. Apply integration logic → final deliverable

### Phase 4: Cleanup
1. Preserve `_workspace/`
2. Report a summary of the results

## Error Handling
- One agent fails: retry once. If it fails again, note the omission and proceed
- Majority fail: notify the user and confirm whether to proceed
- Timeout: use the partial results collected so far
```

---

## Template C: Hybrid Mode

Uses a different execution mode in each phase. Declare `**Execution Mode:** {team | sub}` at the top of each phase.

```markdown
---
name: {domain}-orchestrator
description: "{domain} orchestrator (hybrid). {keywords}. Includes follow-up work keywords."
---

## Execution Mode: Hybrid

| Phase | Mode | Reason |
|-------|------|------|
| Phase 2 (parallel collection) | Sub-agent | Independent data collection, no team communication needed |
| Phase 3 (consensus integration) | Agent team | Conflicting data needs discussion and consensus |
| Phase 4 (independent verification) | Sub-agent | A single QA agent verifies objectively |

## Workflow

### Phase 2: Parallel Data Collection
**Execution Mode:** Sub-agent

Invoke N agents in parallel with the Agent tool in a single message (`run_in_background: true`).
Save each result to `_workspace/02_{agent}_raw.md`.

### Phase 3: Consensus-Based Integration
**Execution Mode:** Agent team

1. Build the integration team with `TeamCreate` (editor + fact-checker + synthesizer)
2. Distribute tasks with `TaskCreate` — everyone Reads the `_workspace/02_*` files from Phase 2
3. Teammates discuss conflicting data via `SendMessage` and reach a file-based consensus
4. Produce the final integrated version `_workspace/03_integrated.md`
5. Tear down the team with `TeamDelete`

### Phase 4: Independent Verification
**Execution Mode:** Sub-agent

A single QA sub-agent takes `_workspace/03_integrated.md` as input and produces a verification report.
```

**Hybrid transition rules:**
- Team → sub: always tear down the team with `TeamDelete` before invoking the Agent tool
- Sub → team: pass the sub-agent's file deliverables to teammates as Read paths
- Team → team: tear down the previous team before a new `TeamCreate` (only one team can be active per session)

---

## Authoring Principles

1. **Declare the execution mode first** — at the top of the orchestrator, state one of "Agent Team" / "Sub-Agent" / "Hybrid". For hybrid, a per-phase mode table is mandatory
2. **For team mode, be concrete about how to use TeamCreate/SendMessage/TaskCreate** — team composition, task registration, communication rules
3. **For sub mode, fully specify the Agent tool parameters** — name, subagent_type, prompt, run_in_background, model
4. **Keep file paths absolute** — no relative paths; use clear paths anchored at `_workspace/`
5. **Declare inter-phase dependencies** — which phase depends on which phase's results. For hybrid, emphasize the mode-transition points in particular
6. **Handle errors realistically** — do not assume "everything succeeds"
7. **Test scenarios are mandatory** — at least 1 normal + 1 error

## Follow-Up Work Keywords in the description

An orchestrator description is not enough with initial-trigger keywords alone. Be sure to include the following follow-up expressions:

- re-run / run again / update / edit / refine
- "just redo the {part} of {domain}"
- "based on the previous result", "improve the result"
- everyday domain-related requests (e.g. for a launch-strategy harness: "launch", "promotion", "trending", etc.)

Without follow-up keywords, the harness effectively becomes dead code after the first run.

## Reference to a Real Orchestrator

Basic structure of a fan-out/fan-in orchestrator:
preparation → Phase 0 (context check) → TeamCreate + TaskCreate → N teammates run in parallel → Read + integrate → cleanup.
See the research team example in `references/team-examples.md`.
