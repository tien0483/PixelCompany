---
name: spawn-subagent
description: "Spawn Claude Code subagents that bill the card's pinned Subagents seat instead of the parent's OAuth seat. Use when delegating execution or exploration to a subagent, spawning parallel agents, or when a task is large enough that context isolation matters. Covers reading the card's subagent config, the seat's real concurrency and prompt budget, and how to write a prompt the subagent can execute without asking questions."
---

# Spawn Subagent

## Purpose

Launch a Claude Code subagent to execute a specific piece of work. The subagent gets its own context
window while the parent keeps coordinating — and, when the card pins a **Subagents** seat, the
subagent's tokens are billed to that seat instead of the parent's 5h/7d OAuth cap.

That seat split is the reason this skill exists. Orchestration-heavy tasks otherwise burn the main
account's cap on work that a cheaper API key could have done.

## Critical: Unsupervised Execution

**Subagents run without user supervision.** There is no way for a user to watch a subagent's output
while it runs. Users cannot:

- See what the subagent is doing
- Correct mistakes in real time
- Answer questions or clarify requirements
- Provide feedback during execution

**All decision-making MUST happen in the parent before spawning.** The prompt must be complete enough
that execution is mechanical — following explicit instructions, making no judgment calls.

---

## Read the card's subagent config FIRST

Before any spawn, determine which seat the subagents will bill. The whole signal is one environment
variable.

```bash
echo "${CLAUDE_CODE_SUBAGENT_MODEL:-<unset>}"    # ccr-3460,<modelId>  → seat pinned
echo "${ANTHROPIC_BASE_URL:-<unset>}"            # http://127.0.0.1:<switchboard>
echo "${CLAUDE_CONFIG_DIR:-<unset>}"             # ~/.agent/task-launch/<task-slug>
```

| `CLAUDE_CODE_SUBAGENT_MODEL` | Meaning | How to spawn |
|---|---|---|
| Matches `^ccr-(\d+),(.+)$` | The card pins a Subagents seat. Every subagent turn is rewritten to `<modelId>` and proxied to that seat's router on `<port>`; the parent's own turns keep going to Anthropic on its OAuth bearer. | Delegate freely, inside the budget below. This is the case the skill is built for. |
| Unset / anything else | No seat pinned (or the runtime degraded — an unreachable switchboard, a seat with no usable key, and a failed router all fall back silently). | Subagents bill the **same** seat as the parent. Delegation buys context isolation only, not cap relief. Spawn fewer, and prefer doing small work inline. |

How the split works, end to end:

```
claude  ANTHROPIC_BASE_URL=http://127.0.0.1:<switchboard>   (no ANTHROPIC_API_KEY, so Claude Code
        CLAUDE_CODE_SUBAGENT_MODEL=ccr-<port>,<modelId>      keeps sending its own OAuth bearer)
           │
           ├─ parent turns   → a normal Anthropic model id → switchboard forwards upstream, bearer untouched
           └─ subagent turns → the marker string above      → switchboard rewrites the model to <modelId>
                                                              and proxies to that seat's router
```

Claude Code sends `CLAUDE_CODE_SUBAGENT_MODEL` verbatim as the `model` field of every subagent
request, and nothing else. **The model field is the only per-turn signal that separates a subagent
from its parent.**

**Therefore: never set a per-spawn model override.** Replacing the model replaces the marker, and the
turn silently leaves the seat — landing on the parent's OAuth cap, which is precisely what pinning the
seat was meant to avoid.

### Which `subagent_type` values are legal

A card can carry a Staff (agents) allowlist. When it does, the runtime builds a task-scoped config dir
and only the allowlisted agents exist inside it:

```bash
ls "${CLAUDE_CONFIG_DIR}/agents" 2>/dev/null   # the card's Staff allowlist, one .md per agent
```

Empty or missing means the card inherits every installed agent. Naming a `subagent_type` outside that
listing fails the spawn — check before you write three prompts against an agent that is not there.

---

## Budget

A seat is one third-party API key with its own rate limit and its own (usually smaller) context
window, and **every subagent of every task sharing that seat hits it at once**. Two independent
mechanisms enforce that, one at spawn time and one per request.

| Limit | Value | Enforced by | Knob |
|---|---|---|---|
| Parallel subagents | 2 | spawn-time hook | `SUBAGENT_SEAT_MAX_CONCURRENCY` |
| Gap between spawns | 3 s | spawn-time hook | `SUBAGENT_SEAT_MIN_GAP_MS` |
| Prompt size per spawn | 40 000 chars | spawn-time hook | `SUBAGENT_SEAT_MAX_PROMPT_CHARS` |
| Concurrent seat-routed turns | 2, then queue | switchboard | `STACK_SEAT_MAX_CONCURRENCY` |
| Queue wait before giving up | 120 s | switchboard | `STACK_SEAT_QUEUE_TIMEOUT_S` |
| Prompt tokens per turn | ~180 000 (estimated at ~4 chars/token) | switchboard | `STACK_SEAT_CONTEXT_TOKENS` |
| Upstream retries | 3, exponential, on 429/503/529 | switchboard | `STACK_SEAT_MAX_RETRIES` |

**The 40 000-character prompt cap is the one that binds.** It is roughly 10 000 tokens — far under the
switchboard's 180 000 — so a prompt refused at spawn time never even reaches the seat. Plan prompts
around characters, not the context window.

These limits apply *only* to seat-routed turns. An ordinary parent turn streams straight through,
unbuffered and unthrottled, so the parent's OAuth traffic never queues behind its own subagents.

### Sequencing

Two at a time, three seconds apart. For a five-task fan-out that means three waves, not one burst.
Spawning the third concurrently does not queue — it is **refused**, and you have burned a turn finding
out.

---

## Error taxonomy

| What you see | Where from | What it means | Do this |
|---|---|---|---|
| `Seat <port> already has 2 subagent(s) running, which is its concurrency limit` | spawn-time hook | You tried a third parallel spawn. | Wait for one to finish, or do that step inline. |
| `stack_seat_context_overflow` (HTTP 413), `subagent prompt is ~N tokens, over the M limit` | switchboard | The turn's prompt exceeds the seat's window. | Split the work across more, smaller turns. Do not retry as-is. |
| `stack_seat_busy` (HTTP 429), `seat <port> stayed at its 2-turn limit for 120s` | switchboard | The seat was saturated for the whole queue window. | Spawn fewer at once. Other tasks may share this seat. |
| `Unknown model …, using default` in `backends/agent_stack/logs/ccr*.log` | vendored CCR | The seat router did not recognise the model; it fell back to its default provider. | The seat's router config is wrong — a `"provider,model"` string will not route; CCR routes by category. |
| `400 Request format not supported` on **every** turn, including the parent's first | vendored CCR | Not a subagent problem. Read `stack-daemon-args-freeze-but-flags-do-not` in `backends/runtime/AGENTS.md`. | Check whether the failing request is the parent's or a subagent's *before* investigating the seat path. Instant failure ("Brewed for 0s") means the parent died before any subagent existed. |

Every runtime-side failure to set up the seat **degrades rather than blocks**: the task still launches,
its subagents just bill the card's own seat. So a missing marker is never proof of a bug — check the
card's Account picker first.

---

## Isolation model

**Subagents share the task's working directory. Do not create a worktree per subagent.**

The task already runs in its own git worktree, created by the runtime. Two reasons not to add more:

1. Task worktrees get reset and purged. Multiplying them multiplies what is lost.
2. `git worktree add` performs a checkout, which fires the repo's `post-checkout` hook **before** any
   dependency symlinks exist. A hook that assumes `node_modules` fails, and the failure aborts the
   worktree creation. See `worktree-hooks-fire-before-symlinks` in `backends/runtime/AGENTS.md`.

If two subagents would genuinely edit the same file, that is a sequencing problem, not an isolation
problem: run them in order and hand the second the first's result.

### What serialises spawns

There is no lock file to acquire or verify. Two real mechanisms already serialise the work:

- The switchboard holds one semaphore per seat port, created on first use.
- The spawn-time hook keeps per-session state under a directory lock:

```bash
ls "${TMPDIR:-/tmp}/claude-subagent-seat-guard-$(id -u)/"     # <session-id>.json per session
```

Read that state or read the refusal message. Do not invent a lock protocol on top.

---

## Hooks the subagent inherits

Subagents inherit project hooks automatically when running in the same project directory. They may not
*follow* hook guidance unless reminded, and a hook can only block a command — the subagent will then
try alternatives and waste the turn. State prohibitions in the prompt.

**Include this block in every implementation prompt, edited to the task:**

```
CRITICAL REQUIREMENTS (enforced by hooks and repo rules):
- Do NOT add a Co-Authored-By or "Generated with" trailer to commits or PR descriptions.
- Do NOT run `biome --write` on frontends/pixel_office — there is no config there, so the
  defaults reformat lines nobody touched. Biome config lives in backends/runtime only.
- Do NOT edit any package.json. Dependency and manifest changes go through the pnpm/npm CLI.
- Use pnpm, not npm, for installs — the content-addressable store is what keeps worktrees cheap.
- Include tests for a bugfix in the SAME commit as the fix.
- Do NOT commit unless the user asked for a commit.

These are absolute. Violating them will be caught and will cost you the turn.
```

---

## When to Use

- The work is well defined and all ambiguities are resolved
- The work is independent enough to execute in isolation
- The parent needs to keep coordinating
- Context isolation is worth a round trip
- **A Subagents seat is pinned** — then delegation also moves the spend off the parent's cap

## Subagent Types and Two-Stage Planning

**Planning subagent — two stages, because a full spec is expensive to produce and often thrown away:**

| Stage | Purpose | Output | Rough cost |
|---|---|---|---|
| Stage 1 | High-level approach outlines | 3 brief options | ~5K tokens |
| Stage 2 | Detailed implementation spec | Full plan for the selected approach | ~20K tokens |

**Stage 1 prompt:**

```
Analyze the task and produce HIGH-LEVEL outlines (1-2 sentences each) for:
- Conservative approach: [minimal scope, low risk]
- Balanced approach: [moderate scope, medium risk]
- Aggressive approach: [comprehensive, high risk]

Do NOT produce detailed execution steps yet. Keep the outlines brief.
```

**Stage 2** resumes that agent rather than starting fresh, so the exploration is not repeated:

```
resume: {the planning agent}
prompt: "The user selected [approach]. Now produce the DETAILED spec:
- Specific files to modify (exact paths)
- Exact code changes
- Step-by-step execution order
- Verification commands and their expected output"
```

**Implementation subagent:** receives the completed spec and executes it mechanically.

---

## Prompt Requirements: Zero Decision Delegation

**MANDATORY.** Before spawning, make sure the prompt contains everything needed for mechanical
execution.

### What the prompt MUST include

| Element | Why required |
|---|---|
| Clear task type | "Explore and report" OR "Execute these steps" — never both |
| Fail-fast conditions | When to stop and report BLOCKED |
| Exact file paths | For implementation work |
| Specific code changes | Before/after examples, not descriptions |
| Verification steps | Explicit commands, explicit expected output |
| Edge cases | The subagent will not discover these on its own |
| Commit message text | Exact text, if a commit was asked for |

### Fail-fast requirements

Every prompt needs them:

```
FAIL-FAST CONDITIONS:
- If [specific condition], report "BLOCKED: [reason]" and stop
- Report status and return to the parent for decisions
- The parent handles all workarounds and fallback choices
```

Subagents fail fast: report BLOCKED and stop. Choosing a fallback is a decision, and decisions need
oversight the subagent cannot get.

### Parent responsibilities BEFORE spawning

1. **Read the relevant code** — finish exploring before spawning an implementation
2. **Make the architectural decisions** — which pattern, which API, which approach
3. **Resolve ambiguities** — "handle errors appropriately" is not an instruction; decide HOW
4. **Identify edge cases** — the subagent executes the happy path unless told otherwise
5. **Write explicit examples** — code snippets, not prose
6. **Specify verification** — exact commands, exact expected output

### Prompt completeness checklist

- [ ] Is this exploration/research OR implementation? (never both)
- [ ] What are the fail-fast conditions?
- [ ] What files to create/modify? (exact paths)
- [ ] What code to write? (actual code, not a description)
- [ ] What to run to verify? (exact commands)
- [ ] What does success look like? (specific, checkable)
- [ ] What if the build fails? (fail-fast, not recovery)
- [ ] Is the prompt under 40 000 characters?
- [ ] Is this the 1st or 2nd concurrent spawn, at least 3 s after the last?

---

## Calibrating the prompt to the card

This repo has no separate agent-preferences file. The card's own launch settings are the source of
truth: **Model**, **Effort**, the **Skills / Staff / Playbooks** allowlists, and the **Subagents**
seat. Read them off the card (and off `$CLAUDE_CONFIG_DIR`, which materialises the allowlists) and set
the prompt's autonomy accordingly.

**Trust — how much choice a PLANNING subagent gets. Derive from the card's Effort setting:**

| Effort | Include in the planning prompt |
|---|---|
| low | "Present multiple options for the user to choose from: conservative, balanced, and comprehensive." |
| medium | "Present options where the trade-off is meaningful. For routine decisions, proceed with the balanced approach." |
| high | "Make autonomous decisions. Present options only when the choice has significant architectural implications." |

**Curiosity — how far an IMPLEMENTATION subagent looks beyond its task. Derive from scope: a card
scoped to a handful of files is `low`, a refactor card is `medium` or `high`:**

| Curiosity | Include in the implementation prompt |
|---|---|
| low | "Focus ONLY on the assigned task. Report only task-related issues." |
| medium | "While working, NOTE obvious issues in code you touch (same function/class). Report them in your summary. Fixing them is the parent's call." |
| high | "Actively look for quality issues and improvement opportunities in files you touch. Report ALL findings in your summary. Fixing them is the parent's call." |

Discovered issues come back in the subagent's **returned summary**. Do not have subagents write to a
side-channel file — a returned result is what the parent actually reads.

**Patience — what the PARENT does with returned issues. Never put this in a subagent prompt:**

| Patience | Parent's action on returned issues |
|---|---|
| low | Resume the planning subagent to fold fixes into the plan, then continue |
| medium | Create cards for the discovered issues in the current board |
| high | Create cards in a later backlog, ordered by benefit/cost |

### Issue return format

Have the subagent close with a block the parent can parse from the returned text:

```json
{
  "status": "success",
  "summary": "Implemented the parser with full test coverage",
  "discoveredIssues": [
    {
      "file": "backends/runtime/src/terminal/agent-session-adapters.ts",
      "line": 770,
      "type": "code-quality",
      "severity": "medium",
      "description": "Duplicate env-merge logic could be extracted",
      "benefitCost": 2.5
    }
  ]
}
```

`discoveredIssues` is empty when curiosity is low.

---

## Card status is the runtime's, not the subagent's

CAT-style workflows have the subagent mark its own task complete. **Do not do that here.** Card state
lives in the runtime's board (under the runtime home, `~/.agent/kanban/`), owned by the runtime and
mutated through the UI and its API. A subagent writing there races the runtime and loses.

```
# ❌ WRONG
Prompt: "…then set the card's status to completed and commit it with the implementation."

# ✅ CORRECT
Prompt: "…then report: files changed, tests run and their output, and status
         (success | partial | BLOCKED). Do not touch board or card state."
```

The parent moves the card after reading the result.

---

## Token and cost tracking

**The parent must include the session id in the prompt** if the subagent is expected to measure
anything — subagents do not receive the parent's session context automatically.

```
TOKEN MEASUREMENT (optional, only when explicitly asked for):
Session id: {the parent's actual session id}
Session file: ~/.claude/projects/{cwd-slug}/{SESSION_ID}.jsonl

TOKENS=$(jq -s '[.[] | select(.type == "assistant") | .message.usage |
  select(. != null) | (.input_tokens + .output_tokens)] | add // 0' "$SESSION_FILE")
```

Rules that matter more than the exact number:

- Track cumulative usage across the whole session
- If context compaction occurs, **preserve the pre-compaction count** and add it to post-compaction
  usage — the pre-compaction tokens were spent, and the transcript no longer shows them
- Report input, output, total, and the compaction count

Seat-side spend is visible in the switchboard and router logs under `backends/agent_stack/logs/`.
For shell-output savings, `rtk gain` reports what the proxy stripped.

---

## Context limits

**Parent (Claude Code, 200K window):**

| Limit | % | Tokens | Purpose |
|---|---|---|---|
| Soft target | 40% | 80 000 | Recommended task size for good output quality |
| Hard limit | 80% | 160 000 | Decompose above this |
| Context limit | 100% | 200 000 | Compaction happens |

**Seat-routed subagent — tighter, and enforced:** ~180 000 prompt tokens at the switchboard, and
40 000 characters at the spawn hook. The character cap wins.

**Pre-spawn validation:**

1. Estimate the task's tokens (files created ×5K, files modified ×3K, test files ×4K, plan steps ×2K,
   +10K if exploration is still needed)
2. If the estimate ≥ 160 000: decompose, do not spawn
3. If it is over the soft target but under the hard limit: decomposition is advisable
4. Otherwise: spawn — after checking the prompt is under 40 000 chars

**Post-execution:** if the subagent reports usage at or above the hard limit, the task was too big; say
so, and decompose next time rather than repeating it.

### Verification before invoking the spawn tool

| Check | Required for |
|---|---|
| CRITICAL REQUIREMENTS block present | All tasks |
| Fail-fast conditions present | All tasks |
| Exact code examples | Non-trivial changes |
| Verification commands with expected output | All implementation tasks |
| No `model:` override | All tasks with a pinned seat |
| `subagent_type` exists in the card's Staff allowlist | All tasks |
| Prompt < 40 000 chars | All tasks |
| ≤ 2 in flight, ≥ 3 s since the last spawn | All tasks |
| Estimated size < 160 000 tokens | All tasks |

**Anti-pattern:** spawning without running this checklist against the prompt you actually wrote.

---

## Examples

### Exploration task (gather info, take no action)

**❌ WRONG — explores AND decides:**

```
Find the best place to add caching and implement it.
```

**✅ CORRECT — explores, returns findings:**

```
Find every tRPC procedure in backends/runtime/src/trpc/ that reads git state.

Return for each:
- File path and line number
- Procedure name and its input schema
- Whether it awaits a git call on the request path

FAIL-FAST:
- If backends/runtime/src/trpc/ does not exist, report BLOCKED
- Do NOT add caching — return findings only
```

### Implementation task (execute, decide nothing)

**❌ WRONG — requires decisions:**

```
Implement the seat resolver following the plan.
Add appropriate error handling.
Write tests for the main functionality.
```

**✅ CORRECT — mechanical:**

```
Edit backends/runtime/src/terminal/subagent-seat-launch.ts:

At line 94, the port probe currently reads:
  if (!(await probePort(SWITCHBOARD_HOST, stackPort))) {

Change the warning on line 95-98 to include the resolved seat name:
  FROM: `Agent stack switchboard is not listening on ...`
  TO:   `Agent stack switchboard is not listening on ... — seat ${seat.name} unused, ...`

Add a case to test/runtime/terminal/subagent-seat-launch.test.ts asserting the
warning contains the seat name when the probe fails.

VERIFICATION:
1. Run: node scripts/pm.mjs dir backends/runtime test:fast
2. Expected: all tests pass, including the new case
3. Run: node scripts/pm.mjs dir backends/runtime typecheck
4. Expected: no output (tsc --noEmit clean)

FAIL-FAST:
- If any test outside the one you added fails, report BLOCKED with the output
- Do NOT modify other code to make tests pass — report and stop

Do NOT commit.
```

---

## Anti-Patterns

### Make all decisions before spawning

```
# ❌ WRONG
Prompt: "Implement error handling for the seat resolver. Choose appropriate error types."

# ✅ CORRECT
Prompt: |
  Add error handling to subagent-seat-launch.ts:
  - Line 78: the .catch already warns; leave it
  - Line 84: when seat is null, warn and return null — never throw. A failure here
    must degrade to "subagents share the task's seat", never block the launch.
```

### Give a concrete plan reference, not a topic

```
# ❌ WRONG
Prompt: "Work on the seat routing"

# ✅ CORRECT
Prompt: |
  Execute steps 3-5 of the plan at .plan/docs/<name>.md.
  Working directory: this task's worktree (do not create a new one).
```

### Provide explicit code examples for required changes

```
# ❌ WRONG — the subagent will find some other solution
Prompt: "Remove the unnecessary non-null assertion in officeState.port.test.ts"

# ✅ CORRECT
Prompt: |
  Change officeState.port.test.ts line 42:
    FROM: const first = panes[0]!;
    TO:   const [first] = panes;
          expect(first).toBeDefined();
```

Subagents optimise for making the build pass. Without an explicit example they may reach for a
suppression that technically works and is not what you meant.

### Require expected values to be derived, not copied

```
# ❌ WRONG
Prompt: "Add tests for the new marker parser"

# ✅ CORRECT
Prompt: |
  Add tests for buildSubagentModelMarker.

  CRITICAL: derive the expected values manually.
  1. Read the function and work out the exact output string for each input
  2. Write that literal into the assertion
  3. Do NOT run the test first and paste its actual output as the expectation
```

Copying actual output into an expectation produces a test that passes and validates nothing.

### Assert structure, not just success

```
# ❌ WRONG — only checks nothing threw
expect(() => resolveSubagentSeatEnv(settings, deps)).not.toThrow();

# ✅ CORRECT — checks the shape that matters
const env = await resolveSubagentSeatEnv(settings, deps);
expect(env).toEqual({
  ANTHROPIC_BASE_URL: "http://127.0.0.1:8788",
  CLAUDE_CODE_SUBAGENT_MODEL: "ccr-3460,cohere/north-mini-code:free",
});
```

A test that only checks "it worked" gives false confidence: the call can succeed and still produce the
wrong marker, which fails much later and much less legibly.

### Sequence dependent work

```
# ❌ WRONG — B needs A's output
spawn: task-a
spawn: task-b

# ✅ CORRECT
spawn: task-a
# … wait for task-a's result, read it …
spawn: task-b
```

This is also the concurrency budget: two in flight, three seconds apart.

### Do not spawn worktrees

```
# ❌ WRONG
git worktree add .worktrees/sub-a1b2c3d4

# ✅ CORRECT
# The task's worktree is already isolated. Subagents run in it.
```

### Subagents do not spawn subagents

If the work needs further decomposition, report back to the parent. A nested spawn is also invisible to
the concurrency budget the parent is managing.

### Separate exploration from implementation

Subagents *may* explore — they just return findings for the parent to act on.

```
# ❌ WRONG — explores AND acts
Prompt: "Find where the switchboard reads flags and add a cache"

# ✅ CORRECT — explores, returns
Prompt: |
  Find every place backends/agent_stack/server.py reads stack-flags.json.
  Return: line number, the surrounding function, and whether it is per-request or at import.
  FAIL-FAST: if the file is missing, report BLOCKED. Do NOT change anything.

# ✅ ALSO CORRECT — parent already explored, gives exact instructions
Prompt: |
  In backends/agent_stack/server.py, at the flag read inside resolve_route:
  [exact before/after]
```

### Give verification steps, not a standard to judge against

```
# ❌ WRONG
Prompt: "Make sure the seat routing still works correctly"

# ✅ CORRECT
Prompt: |
  Verify:
  1. Run: node scripts/pm.mjs dir backends/runtime test:fast
  2. All tests pass
  3. Run: node scripts/pm.mjs dir backends/runtime typecheck
  4. No output
  FAIL-FAST: if anything fails, report BLOCKED with the output. Do NOT fix it.
```

### Fail fast instead of falling back

```
# ❌ WRONG — the fallback is a decision
Prompt: "Try the seat router. If it doesn't work, fall back to the direct route."

# ✅ CORRECT
Prompt: |
  Use the seat router at http://127.0.0.1:<port>.
  FAIL-FAST:
  - If it errors, report BLOCKED with the error body
  - Do NOT fall back to the direct route
  - Do NOT try alternative approaches
```

### Verify findings by delegating, not by investigating

When a subagent returns a finding — especially "DUPLICATE" or "NOT FOUND" — the parent must not go read
the code itself.

```
# ❌ WRONG
Subagent: "DUPLICATE: this fix already landed in commit c2da15e"
Parent:   "Let me read the file to check…"
Parent:   "Let me run the test to confirm…"

# ✅ CORRECT
Subagent: "DUPLICATE: this fix already landed in commit c2da15e"
Parent:
  1. ACCEPT it and proceed (mark the card duplicate), or
  2. SPAWN a verification subagent with specific questions:
     "Verify the fix exists:
      1. Does commit c2da15e touch backends/runtime/src/terminal/subagent-seat-launch.ts?
      2. Run: node scripts/pm.mjs dir backends/runtime test:fast
      3. Report VERIFIED or NOT_VERIFIED with evidence"
```

Decision tree for a returned finding:

1. Clear and actionable → accept, proceed
2. Uncertain → spawn a structured re-verification
3. Never → read the code or run the commands yourself and re-derive it

The point is not ceremony: re-deriving the finding in the parent's context spends the parent's cap on
work the seat already paid for, which inverts the reason for delegating.

---

## Expanded Exploration Subagent

An exploration subagent can absorb three phases internally, keeping noisy tool calls out of the user's
view and returning one structured result.

| Phase | Responsibilities | Output |
|---|---|---|
| **Preparation** | Read the plan, estimate task size | `preparation` object with the estimate |
| **Exploration** | Search the codebase, locate code, check for duplicates | `findings` object |
| **Verification** | Confirm the findings exist and are accurate | `verification` object |

**Phase 1 — Preparation.** Read the plan to understand scope; estimate size (files created ×5K, files
modified ×3K, test files ×4K, plan steps ×2K, +10K if still uncertain); compare against the thresholds
above. **No worktree creation** — the task's worktree is the working directory.

**Phase 2 — Exploration.** Search for relevant patterns; identify files and locations; check for
duplicate functionality; map dependencies; note blockers.

**Phase 3 — Verification.** Confirm every reported path exists; confirm the quoted patterns are
accurate; run cheap preliminary checks; confirm no gaps.

### Return format

```json
{
  "status": "READY|OVERSIZED|DUPLICATE|BLOCKED",
  "preparation": {
    "estimatedTokens": 45000,
    "percentOfHardLimit": 28
  },
  "findings": {
    "filesToModify": [
      {"path": "backends/runtime/src/terminal/subagent-seat-launch.ts", "lines": "94-99", "reason": "Probe warning"},
      {"path": "backends/agent_stack/server.py", "lines": "595-641", "reason": "Seat guardrails"}
    ],
    "filesToCreate": [],
    "patterns": ["Degrade-to-null, never throw", "Marker parsed by regex at the switchboard"],
    "duplicateCheck": "NOT_DUPLICATE",
    "blockers": []
  },
  "verification": {
    "allPathsExist": true,
    "patternsConfirmed": true,
    "preliminaryChecks": "PASSED",
    "notes": []
  }
}
```

| Status | Meaning | Parent's action |
|---|---|---|
| `READY` | Within threshold | Continue to approach selection |
| `OVERSIZED` | Estimate over the hard limit | Decompose |
| `DUPLICATE` | Already implemented elsewhere | Mark duplicate, skip |
| `BLOCKED` | Cannot proceed | Surface the blocker to the user |

### Anti-patterns

```
# ❌ WRONG — the parent does preparation inline
Parent: "Let me read the plan…"
Parent: "Now let me estimate the size…"
# The user watches all of it, and the parent's cap pays for all of it

# ✅ CORRECT
Parent: "Spawning exploration subagent…"
[subagent does preparation + exploration + verification internally, on the seat]
Parent receives: {"status": "READY", "preparation": {...}, ...}
Parent shows:    "✓ Task size OK: ~45K tokens (28% of the hard limit)"
```

```
# ❌ WRONG — the parent re-investigates after the subagent returns
Subagent returns: {"filesToModify": ["subagent-seat-launch.ts"]}
Parent: "Let me read subagent-seat-launch.ts to understand it…"

# ✅ CORRECT
Subagent returns: {"filesToModify": [{"path": "...", "lines": "94-99"}]}
Parent: "Exploration complete. Spawning the implementation subagent…"
```

---

## Progress output

Show spawning with visible, consistent feedback:

**At spawn start**

```
◆ Spawning subagent: {what it will do}…
  → Seat: {ccr-<port>,<model> | none — shares this task's seat}
  → In flight: {n}/2
```

**On successful launch**

```
✓ Subagent launched
  → Estimated tokens: {N}K
  → Prompt: {N} chars / 40 000
```

**On failure**

```
✗ Spawn refused: {error-reason}
  → {the hint from the error, verbatim}
```

---

## Related

- **`understand-chat`** — for questions spanning three or more files, when `.ua/knowledge-graph.json`
  exists. Cheaper and more accurate than sending a subagent to read files one by one.
- **`superpowers:dispatching-parallel-agents`** — the general case for independent parallel work; this
  skill is the seat-aware version of it.
- **`caveman:cavecrew`** — compressed subagent output, when the returned result is what costs you.
- **`pixeloffice-review`** — review of the diff a subagent produced.
