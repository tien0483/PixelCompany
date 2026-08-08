# Agent Team Design Patterns

## Execution Modes: Agent Teams vs. Sub-agents

Understand the core difference between the two execution modes and choose the one that fits.

### Agent Teams — Default Mode

The team leader assembles a team with `TeamCreate`, and the members run as independent Claude Code instances. Members communicate directly via `SendMessage` and coordinate among themselves through a shared task list (`TaskCreate`/`TaskUpdate`).

```
[Leader] ←→ [Member A] ←→ [Member B]
  ↕            ↕             ↕
  └──────── Shared Task List ────────┘
```

**Core tools:**
- `TeamCreate`: create the team + spawn members
- `SendMessage({to: name})`: message a specific member
- `SendMessage({to: "all"})`: broadcast (expensive, use rarely)
- `TaskCreate`/`TaskUpdate`: manage the shared task list

**Characteristics:**
- Members can talk, challenge, and verify each other directly
- Information is exchanged between members without going through the leader
- Self-coordination via the shared task list (members can request work themselves)
- The leader is automatically notified when a member becomes idle
- Plan-approval mode allows review before dangerous operations

**Constraints:**
- Only one team can be **active** per session (though a team can be dismantled and a new one formed between phases)
- No nested teams (a member cannot create their own team)
- The leader is fixed (cannot be transferred)
- High token cost

**Team reconfiguration pattern:**
When different phases need different mixes of specialists, proceed in this order: save the previous team's outputs to files → tear down the team → create a new team. The previous team's outputs are preserved in `_workspace/`, so the new team can access them with Read.

### Sub-agents — Lightweight Mode

The main agent creates sub-agents with the `Agent` tool. Sub-agents return their results only to the main agent and do not communicate with one another.

```
[Main] → [Sub A] → returns result
       → [Sub B] → returns result
       → [Sub C] → returns result
```

**Core tools:**
- `Agent(prompt, subagent_type, run_in_background)`: create a sub-agent

**Characteristics:**
- Lightweight and fast
- Results are summarized back into the main context
- Token-efficient

**Constraints:**
- No communication between sub-agents
- The main agent handles all coordination
- No real-time collaboration or challenging

### Mode Selection Decision Tree

```
Are there two or more agents?
├── Yes → Do the agents need to communicate?
│         ├── Yes → Agent Teams (default)
│         │         Cross-verification, shared discovery, and real-time feedback improve quality.
│         │
│         └── No → Sub-agents are also viable
│                  E.g. producer-reviewer or expert pools that only need to hand off results.
│
└── No (one) → Sub-agents
              A single agent does not need a team.
```

> **Key principle:** Agent teams are the default. When choosing sub-agents, ask yourself: "Is communication between members truly unnecessary?"

---

## Agent Team Architecture Types

### 1. Pipeline
Sequential work flow. Each agent's output is the next agent's input.

```
[Analyze] → [Design] → [Implement] → [Verify]
```

**When it fits:** Each stage depends strongly on the previous stage's output
**Example:** Novel writing — worldbuilding → characters → plot → drafting → editing
**Caution:** A bottleneck delays the entire pipeline. Design each stage to be as independent as possible.
**Team-mode suitability:** Because sequential dependency is strong, the benefits of team mode are limited. However, team mode is useful if there are parallel segments within the pipeline.

### 2. Fan-out/Fan-in
Parallel processing followed by integration. Independent tasks run concurrently.

```
         ┌→ [Expert A] ─┐
[Distribute] → ├→ [Expert B] ─┼→ [Integrate]
         └→ [Expert C] ─┘
```

**When it fits:** The same input needs analysis from different perspectives/domains
**Example:** Comprehensive research — investigate official/media/community/background sources concurrently → integrated report
**Caution:** The quality of the integration stage determines the overall quality.
**Team-mode suitability:** The most natural pattern for agent teams. **This must be built as an agent team.** Members share and challenge each other's findings, and one agent's discovery can revise another agent's investigation direction in real time, greatly improving quality compared to solo investigation.

### 3. Expert Pool
Select and invoke the appropriate expert depending on the situation.

```
[Router] → { Expert A | Expert B | Expert C }
```

**When it fits:** Different inputs require different handling
**Example:** Code review — invoke only the relevant expert among security/performance/architecture specialists
**Caution:** The router's classification accuracy is critical.
**Team-mode suitability:** Sub-agents are a better fit. Since only the needed expert is invoked, a standing team is unnecessary.

### 4. Producer-Reviewer
A producing agent and a reviewing agent operate as a pair.

```
[Produce] → [Review] → (if problems) → re-run [Produce]
```

**When it fits:** Output quality assurance is important and objective verification criteria exist
**Example:** Webtoon — artist produces → reviewer inspects → problematic panels are regenerated
**Caution:** Setting a maximum retry count (2–3) is essential to prevent infinite loops.
**Team-mode suitability:** Agent teams are useful. Use SendMessage to exchange real-time feedback between producer and reviewer.

### 5. Supervisor
A central agent manages task state and dynamically distributes work to subordinate agents.

```
         ┌→ [Worker A]
[Supervisor] ─┼→ [Worker B]    ← the supervisor distributes dynamically based on state
         └→ [Worker C]
```

**When it fits:** Workload is variable or work distribution must be decided at runtime
**Example:** Large-scale code migration — the supervisor analyzes the file list and assigns batches to workers
**Difference from fan-out:** Fan-out distributes work in a fixed way up front; the supervisor adjusts dynamically based on progress
**Caution:** Set delegation units large enough so the supervisor does not become a bottleneck.
**Team-mode suitability:** The agent team's shared task list matches the supervisor pattern naturally. Register work with TaskCreate, and members claim it themselves.

### 6. Hierarchical Delegation
A higher-level agent delegates recursively to lower-level agents, decomposing a complex problem step by step.

```
[Overall Lead] → [Team Lead A] → [Worker A1]
                                → [Worker A2]
               → [Team Lead B] → [Worker B1]
```

**When it fits:** The problem decomposes naturally into a hierarchical structure
**Example:** Full-stack app development — overall lead → frontend lead → (UI/logic/tests) + backend lead → (API/DB/tests)
**Caution:** Depth of 3 or more levels incurs large latency and context loss. Two levels or fewer is recommended.
**Team-mode suitability:** Agent teams cannot nest (a member cannot create a team). Implement level 1 as a team and level 2 as sub-agents, or flatten it into a single team.

## Composite Patterns

In practice, composite patterns are more common than single patterns:

| Composite Pattern | Composition | Example |
|----------|------|------|
| **Fan-out + Producer-Reviewer** | Parallel production, then verify each | Multilingual translation — 4 languages translated in parallel → each reviewed by a native reviewer |
| **Pipeline + Fan-out** | Parallelize part of a sequential set of stages | Analysis (sequential) → implementation (parallel) → integration testing (sequential) |
| **Supervisor + Expert Pool** | The supervisor dynamically invokes experts | Customer inquiry handling — the supervisor classifies the inquiry, then assigns a suitable expert |

### Execution Mode in Composite Patterns

**By default, use agent teams for all composite patterns.** Active communication between members is the key driver of output quality.

| Scenario | Recommended Mode | Reason |
|---------|----------|------|
| **Research + Analysis** | Agent Teams | Investigators share findings and discuss conflicting information in real time |
| **Design + Implementation + Verification** | Agent Teams | Feedback loop among designer ↔ implementer ↔ verifier |
| **Supervisor + Workers** | Agent Teams | Dynamic allocation via the shared task list, progress shared among workers |
| **Production + Verification** | Agent Teams | Real-time feedback between producer ↔ verifier minimizes rework |

> Mixing in sub-agents should only be considered when a single agent performs a fully isolated, one-off task.

## Choosing the Agent Type

When invoking an agent, specify the type via the `subagent_type` parameter of the Agent tool. Members of an agent team can also use custom agent definitions.

### Built-in Types

| Type | Tool Access | When to Use |
|------|----------|-----------|
| `general-purpose` | Full (including WebSearch, WebFetch) | Web research, general-purpose work |
| `Explore` | Read-only (no Edit/Write) | Codebase exploration, analysis |
| `Plan` | Read-only (no Edit/Write) | Architecture design, planning |

### Custom Types

If you define an agent in `.claude/agents/{name}.md`, you can invoke it with `subagent_type: "{name}"`. Custom agents have access to the full tool set.

### Selection Criteria

| Situation | Recommendation | Reason |
|------|------|------|
| Role is complex and reused across multiple sessions | **Custom type** (`.claude/agents/`) | Manage persona and working principles as a file |
| Simple investigation/collection, and a prompt alone suffices | **`general-purpose`** + detailed prompt | No agent file needed; put instructions in the prompt |
| Only need to read code (analysis/review) | **`Explore`** | Prevents accidental file modification |
| Only need design/planning | **`Plan`** | Focuses on analysis, prevents code changes |
| Implementation work that requires file modification | **Custom type** | Full tool access + specialized instructions |

**Principle:** Every agent must be defined as a `.claude/agents/{name}.md` file. Even for built-in types, create an agent definition file that spells out the role, principles, and protocols. Existing as a file makes it reusable in the next session, and the team communication protocol must be spelled out to guarantee collaboration quality.

**Model:** Every agent uses `model: "opus"`. When calling the Agent tool, always specify the `model: "opus"` parameter.

## Agent Definition Structure

```markdown
---
name: agent-name
description: "1-2 sentence role description. List trigger keywords."
---

# Agent Name — one-line role summary

You are a [role] expert in [domain].

## Core Responsibilities
1. Responsibility 1
2. Responsibility 2

## Working Principles
- Principle 1
- Principle 2

## Input/Output Protocol
- Input: [where and what you receive]
- Output: [where and what you write]
- Format: [file format, structure]

## Team Communication Protocol (Agent Team Mode)
- Receiving messages: [from whom and what messages you receive]
- Sending messages: [to whom and what messages you send]
- Task requests: [what type of work you request from the shared task list]

## Error Handling
- [behavior on failure]
- [behavior on timeout]

## Collaboration
- Relationship with other agents
```

## Agent Separation Criteria

| Criterion | Separate | Combine |
|------|------|------|
| Expertise | Separate if the domains differ | Combine if the domains overlap |
| Parallelism | Separate if they can run independently | Consider combining if sequentially dependent |
| Context | Separate if the context burden is large | Combine if lightweight and fast |
| Reusability | Separate if used by other teams too | Consider combining if used only by this team |

## Agent Reuse Design

Before creating a new agent, check for overlap with existing agents. As you build harnesses repeatedly, agents with overlapping roles tend to accumulate under different names.

| Situation | Action |
|------|------|
| An existing agent fully covers the new role | Do not create a new one — reuse the existing agent |
| An existing agent partially covers it and can be generalized | Generalize and extend the existing agent |
| Partial overlap where domain specialization is intended | Proceed with creating a new one — keep it as a separate agent |
| The role scope is completely different | Proceed with creating a new one |

**Principle:** The more a single agent focuses on a single role, the higher its reusability and the lower the duplication. If a role covers two or more responsibilities, first examine whether it can be split.

**When generalizing an existing agent:** The behavior of orchestrators and team configurations that depend on that agent may change. Check dependencies before extending, and after generalizing, do a dry run to confirm existing behavior is preserved.

## Distinguishing Skills vs. Agents

| Aspect | Skill | Agent |
|------|-------------|-----------------|
| Definition | Procedural knowledge + tool bundle | Expert persona + behavioral principles |
| Location | `.claude/skills/` | `.claude/agents/` |
| Trigger | Keyword match on user request | Explicit invocation via the Agent tool |
| Size | Small to large (workflow) | Small (role definition) |
| Purpose | "How it is done" | "Who does it" |

A skill is a **procedural guide** that an agent references while performing work.
An agent is an **expert role definition** that makes use of skills.

## Ways to Connect Skills ↔ Agents

Three ways an agent can make use of a skill:

| Method | Implementation | When It Fits |
|------|------|-----------|
| **Skill tool invocation** | Specify in the agent prompt: `invoke /skill-name via the Skill tool` | When the skill is a standalone workflow and can be invoked by the user |
| **Inline in the prompt** | Include the skill content directly within the agent definition | When the skill is short (50 lines or fewer) and specific to this agent |
| **Reference loading** | Load the skill's references/ files on demand with `Read` | When the skill content is large and only conditionally needed |

Recommendation: use the Skill tool if reusability is high, inline if it is agent-specific, and reference loading if it is large.
