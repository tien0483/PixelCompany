# Agent Team Examples

---

## Example 1: Research Team (Agent Team Mode)

### Team Architecture: Fan-out/Fan-in
### Execution Mode: Agent Team

```
[Leader/Orchestrator]
    ├── TeamCreate(research-team)
    ├── TaskCreate(4 research tasks)
    ├── Team members self-coordinate (SendMessage)
    ├── Collect results (Read)
    └── Produce synthesis report
```

### Agent Composition

| Member | Agent Type | Role | Output |
|------|-------------|------|------|
| official-researcher | general-purpose | Official docs/blogs | research_official.md |
| media-researcher | general-purpose | Media/investment | research_media.md |
| community-researcher | general-purpose | Community/social media | research_community.md |
| background-researcher | general-purpose | Background/competition/academic | research_background.md |
| (Leader = orchestrator) | — | Integrated report | synthesis-report.md |

> The research agents use the `general-purpose` built-in type, but must be defined as `.claude/agents/{name}.md` files. Each file specifies the role, research scope, and team communication protocol to ensure reusability and collaboration quality.

### Orchestrator Workflow (Agent Team)

```
Phase 1: Preparation
  - Analyze user input (identify topic and research mode)
  - Create _workspace/

Phase 2: Team setup
  - TeamCreate(team_name: "research-team", members: [
      { name: "official", prompt: "Research official channels..." },
      { name: "media", prompt: "Research media/investment trends..." },
      { name: "community", prompt: "Research community reactions..." },
      { name: "background", prompt: "Research background/competitive landscape..." }
    ])
  - TaskCreate(tasks: [
      { title: "Research official channels", assignee: "official" },
      { title: "Research media trends", assignee: "media" },
      { title: "Research community reactions", assignee: "community" },
      { title: "Research background environment", assignee: "background" }
    ])

Phase 3: Conduct research
  - The 4 team members research independently
  - Share interesting findings between members via SendMessage
    (e.g., media forwards investment news it found to background)
  - When conflicting information is found, members debate directly
  - On completion, each member saves its file and notifies the leader

Phase 4: Integration
  - The leader Reads the 4 outputs
  - Produce the synthesis report
  - Cite sources for conflicting information

Phase 5: Cleanup
  - Request team members to shut down
  - Tear down the team
  - Preserve _workspace/ (for post-hoc verification and audit trail)
```

### Team Communication Pattern

```
official ──SendMessage──→ background  (share relevant official announcements)
media ────SendMessage──→ background  (share investment/acquisition info)
community ─SendMessage──→ media      (media-related info from community reactions)
all members ──TaskUpdate──→ shared task list  (progress updates)
leader ←───── idle notification ──── completed member   (automatic)
```

---

## Example 2: Sci-Fi Novel Writing Team (Agent Team Mode)

### Team Architecture: Pipeline + Fan-out
### Execution Mode: Agent Team

```
Phase 1 (parallel — agent team): worldbuilder + character-designer + plot-architect
  → coordinate consistency with each other via SendMessage
Phase 2 (sequential): prose-stylist (writing)
Phase 3 (parallel — agent team): science-consultant + continuity-manager (review)
  → share findings with each other via SendMessage
Phase 4 (sequential): prose-stylist (revise per review)
```

### Agent Composition

| Member | Agent Type | Role | Skill |
|------|-------------|------|------|
| worldbuilder | Custom | Worldbuilding | world-setting |
| character-designer | Custom | Character design | character-profile |
| plot-architect | Custom | Plot structure | outline |
| prose-stylist | Custom | Prose editing + writing | write-scene, review-chapter |
| science-consultant | Custom | Scientific verification | science-check |
| continuity-manager | Custom | Consistency checking | consistency-check |

### Full Agent File Example: `worldbuilder.md`

```markdown
---
name: worldbuilder
description: "An expert who builds the world of a sci-fi novel. Designs physical laws, social structures, technology level, and history."
---

# Worldbuilder — Sci-Fi Worldbuilding Expert

You are an expert in designing the worlds of sci-fi novels. Grounded in scientific fact yet expanding on imagination, you build the physical, social, and technological foundations of the world in which the story unfolds.

## Core Responsibilities
1. Define the world's physical laws and technology level
2. Design social structures, political systems, and economic systems
3. Establish historical context and the current conflict structure
4. Describe the environment and atmosphere of each location

## Working Principles
- Internal consistency first — there must be no contradictions between settings
- Reason through the world's ripple effects with chained "what if this technology existed?" questions
- A world that serves the story — avoid excessive worldbuilding that hinders the plot

## Input/Output Protocol
- Input: the user's world concept and genre requirements
- Output: `_workspace/01_worldbuilder_setting.md`
- Format: Markdown, organized by section (physics/society/technology/history/locations)

## Team Communication Protocol
- To character-designer: SendMessage with social structure, class system, and occupation info
- To plot-architect: SendMessage with the world's main conflict structure and crisis elements
- From science-consultant: receive scientific-error feedback → revise settings
- When the world changes, broadcast to all relevant team members

## Error Handling
- If the concept is ambiguous, propose 3 directions and ask for a choice
- When a scientific error is found, present alternatives alongside it

## Collaboration
- Provide social structure info to character-designer
- Provide conflict structure info to plot-architect
- Revise settings based on science-consultant's feedback
```

### Team Workflow Details

```
Phase 1: TeamCreate(team_name: "novel-team", members: [worldbuilder, character-designer, plot-architect])
         TaskCreate([worldbuilding, character design, plot structure])
         → members self-coordinate and work in parallel
         → when worldbuilder finishes the social structure, SendMessage to character-designer
         → when character-designer defines the protagonist, SendMessage to plot-architect

Phase 2: Tear down the Phase 1 team → invoke prose-stylist as a subagent (no team needed since writing is solo)
         prose-stylist Reads the 3 outputs in _workspace/ and writes
         → save the result to _workspace/02_prose_draft.md

Phase 3: Create a new team — TeamCreate(team_name: "review-team", members: [science-consultant, continuity-manager])
         (only one team is active per session, but a new team can be created since the Phase 1 team was torn down)
         → the two reviewers examine the draft and share findings with each other
         → when science-consultant finds a physics error, it also notifies continuity-manager
         → tear down the team after the review is complete

Phase 4: Invoke prose-stylist as a subagent and make final revisions reflecting the review results
```

---

## Example 3: Webtoon Production Team (Subagent Mode)

### Team Architecture: Generate-Verify
### Execution Mode: Subagent

> In the generate-verify pattern there are only 2 agents, and passing results matters more than communication, so subagents are a good fit.

```
Phase 1: Agent(webtoon-artist) → generate panels
Phase 2: Agent(webtoon-reviewer) → inspect
Phase 3: Agent(webtoon-artist) → regenerate problem panels (up to 2 times)
```

### Agent Composition

| Agent | subagent_type | Role | Skill |
|---------|--------------|------|------|
| webtoon-artist | Custom | Panel image generation | generate-webtoon |
| webtoon-reviewer | Custom | Quality inspection | review-webtoon, fix-webtoon-panel |

### Full Agent File Example: `webtoon-reviewer.md`

```markdown
---
name: webtoon-reviewer
description: "An expert who inspects the quality of webtoon panels. Evaluates composition, character consistency, text readability, and direction."
---

# Webtoon Reviewer — Webtoon Quality Inspection Expert

You are an expert who inspects the quality of webtoon panels. You evaluate panels based on visual polish, storytelling effectiveness, and character consistency.

## Core Responsibilities
1. Evaluate the composition and visual polish of each panel
2. Verify consistency of character appearance across panels
3. Evaluate the readability and placement of speech-bubble text
4. Review the directional flow and pacing of the whole episode

## Working Principles
- Judge clearly on a 3-level scale: PASS/FIX/REDO
- FIX is when a partial edit can resolve it; REDO requires full regeneration
- Judge by objective criteria (consistency, readability, composition), not subjective taste

## Input/Output Protocol
- Input: the panel images in the `_workspace/panels/` directory
- Output: `_workspace/review_report.md`
- Format:
  ```
  ## Panel {N}
  - Verdict: PASS | FIX | REDO
  - Reason: [specific reason]
  - Fix instructions: [specific fix direction for FIX/REDO]
  ```

## Error Handling
- If an image fails to load, mark that panel as REDO
- A panel still marked REDO after 2 regenerations is passed with a warning

## Collaboration
- Hand fix instructions to webtoon-artist (based on the result file)
- Re-inspect regenerated panels (loop up to 2 times)
```

### Error Handling

```
Retry policy:
- Panels judged REDO → request regeneration from the artist (with specific fix instructions)
- Force PASS after looping up to 2 times
- If more than 50% of all panels are REDO, suggest the user revise the prompt
```

---

## Example 4: Code Review Team (Agent Team Mode)

### Team Architecture: Fan-out/Fan-in + Debate
### Execution Mode: Agent Team

> Code review is a prime example where agent teams shine. Reviewers with different perspectives share and challenge each other's findings, enabling a deeper review.

```
[Leader] → TeamCreate(review-team)
    ├── security-reviewer: check for security vulnerabilities
    ├── performance-reviewer: analyze performance impact
    └── test-reviewer: verify test coverage
    → reviewers share findings with each other (SendMessage)
    → leader synthesizes the results
```

### Team Communication Pattern

```
security ──SendMessage──→ performance  ("this SQL query is injectable, needs a performance-side check too")
performance ──SendMessage──→ test      ("found an N+1 query, please check whether there is a related test")
test ────SendMessage──→ security      ("no tests for the auth module, your opinion on priority from a security standpoint?")
```

Key point: reviewers communicate directly **without going through the leader**, quickly catching cross-cutting issues.

---

## Example 5: Supervisor Pattern — Code Migration Team (Agent Team Mode)

### Team Architecture: Supervisor
### Execution Mode: Agent Team

```
[supervisor/leader] → analyze file list → assign batches
    ├→ [migrator-1] (batch A)
    ├→ [migrator-2] (batch B)
    └→ [migrator-3] (batch C)
    ← receive TaskUpdate → assign additional batches or reassign
```

### Agent Composition

| Member | Role |
|------|------|
| (Leader = migration-supervisor) | File analysis, batch distribution, progress management |
| migrator-1~3 | Migrate the assigned file batches |

### Supervisor's Dynamic Distribution Logic (Using an Agent Team)

```
1. Collect the full list of target files
2. Estimate complexity (file size, number of imports, dependencies)
3. Register file batches as tasks via TaskCreate (including dependencies)
4. Team members claim tasks on their own
5. When a member reports completion via TaskUpdate:
   - Success → automatically request the next task
   - Failure → the leader checks the cause via SendMessage → reassign or assign to another member
6. All tasks complete → the leader runs integration tests
```

Difference from fan-out: tasks are **assigned dynamically at runtime** rather than fixed in advance. The shared task list's self-claim feature matches naturally with the supervisor pattern.

---

## Deliverable Pattern Summary

### Agent Definition File
Location: `project/.claude/agents/{agent-name}.md`
Required sections: Core Responsibilities, Working Principles, Input/Output Protocol, Error Handling, Collaboration
Additional section for team mode: **Team Communication Protocol** (message receive/send, task-claim scope)

### Skill File Structure
Location: `project/.claude/skills/{skill-name}/SKILL.md` (project level)
Or: `~/.claude/skills/{skill-name}/SKILL.md` (global level)

### Integration Skill (Orchestrator)
A top-level skill that orchestrates the whole team. Defines the agent composition and workflow per scenario.
Template: see `references/orchestrator-template.md`.
**Always specify the execution mode** — agent team (default) or subagent.
