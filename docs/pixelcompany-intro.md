# PixelCompany

## Motivation

Three moments, one root cause:

1. **3D Papp.** One long session, one repo. By the last third of the task the agent had forgotten decisions it made in the first third. Context rot — not fixable by prompting harder.
2. **AI Agent UI.** Four genuinely independent sub-features. I ran them as four chats over one working tree and they overwrote each other.
3. **The 5h cap.** Hit it mid-task, twice. Not "wait a bit" — session state is gone, and re-explaining it burns the next window too.

None of these are model-quality problems. All three are *workspace* problems. So I built the workspace.

## What it is

A kanban board where each card is a real dev environment, not a chat.

- **Card = git worktree = sandboxed agent session.** Isolation is the default, so 3–4 cards run at once without touching each other. Cards can also be **chained** — you declare which run in parallel and which depend on which. You own the dependency graph, not the AI.
- **Every card is configured before it runs:** plan, model + reasoning effort, allowed skills / commands / MCP servers / sub-agents, which account seat it bills, which seat its *subagents* bill, base branch, and auto-resume when that seat hits the cap.
- **Planning is its own phase.** Plan is an HTML document with live preview, versions, templates and AI-assisted refine — not a `.md` in scrollback. Split it into per-agent sub-plans and keep the big picture yourself.
- **Review copies the GitLab MR "Changes" tab.** Whole-branch diff, click a line, leave a comment — the comment goes to that card's agent as scoped work on that hunk. Then merge to base or push to remote from the same view.
- **Harness is swappable.** Claude Code, Cursor, and Cline (API key) all launch today; the board behaves the same behind any of them. That's the escape hatch from a single subscription.

## Result

Measured on this machine, this repo:

| | |
|---|---|
| **RTK** | **7.9M of 8.9M tokens saved across 3,812 shell calls — 88.9%.** Test output compresses 96%, file/dir listing 60–78%. |
| **Headroom** | **8,843 requests, 17.8M tokens stripped by compression (~$53).** Over the same window 647M cache-read tokens carried a **$1,942 discount** against a $2,521 nominal input bill — but most of that is provider-native prefix caching, which Headroom *improves* rather than owns. Don't credit it all to the proxy. |
| **Parallelism** | 3–4 cards at once, no cross-contamination, vs. one serialized chat before. |
| **Rate limits** | A card that hits the 5h wall parks itself, re-checks the live usage snapshot, and resumes with `--continue` when the window clears — escalating backoff so it never wakes straight into another wall. Stalls stopped being fatal. |
| **Review** | Plan and review became things a human actually reviews, because they're a document and a diff instead of scrollback. |

## Remaining / rough

- **Headroom is currently seeing zero traffic.** Live `/stats` reads all zeros since the last restart — agents aren't routed through it right now. The lifetime numbers are real; the wiring is not always on.
- **Headroom can cost you.** Sessions here run 97–99% prompt-cache hit rate, and a rewritten prefix turns a 0.1× cache *read* into a 1.25× cache *write*. Measure before/after on your own workload.
- **Harness coverage is partial.** Claude Code is solid, Cursor and Cline launch. Codex, Gemini, Droid, Kiro, OpenCode exist in the catalog but are commented out.
- **Worktree lifecycle is the sharp edge.** Task worktrees have been reset/purged out from under live work. Mitigation today: commit to a named branch early; checkpoints and trashed-task patches exist for recovery. A real fix isn't in.
- **Open question — plan granularity.** How small should a sub-plan get before hand-off overhead eats the parallelism? No data yet.
- **Setup is not one-command.** Native Linux filesystem only — WSL `/mnt/<drive>` deadlocks on dependency resolution.

---

## Feature table

### Take today, no PixelCompany needed

| Feature | What it does | Status | Adopt now as-is? |
|---|---|---|---|
| **RTK** | Low-token replacements for grep / ls / find / read / test output | Working — 88.9% saved over 3.8k calls | **Yes** — one binary + a hook. Best value/effort here. |
| **Caveman** | Kills agent filler commentary; ~75% off response tokens | Working | **Yes** — drop-in skill, no infra |
| **Understand-Anything** | Pre-indexes a repo into a knowledge graph so multi-file questions cost one lookup, not ten file reads | Working | **Yes, per repo** — initial build reads the whole repo and is expensive. Build once, share it. |
| **Skill catalog** | 30 ready skills (QA, review, docs-sync, recover, spawn-subagent, …), toggled per project | Working | **Yes** — copy the skill folder |
| **Headroom** | Proxy that compresses the request before it reaches the API | Working, **but see caveat** | **Measure first** — can break prompt cache and cost more than it saves |

### Board & execution

| Feature | What it does | Status | Adopt now as-is? |
|---|---|---|---|
| Card = worktree = sandboxed session | branch → worktree → WSL → sandboxed agent per card | Working | Needs full system |
| Parallel cards | 3–4 isolated tasks at once | Working | Needs full system |
| Sequential chains | Declare card dependencies; followers inherit the root's base | Working | Needs full system |
| Locked base ref | Base branch written once per worktree, survives purge/restart; refuses detached HEAD | Working | Needs full system |
| Turn checkpoints + trash recovery | Recover work from a purged worktree | Working, imperfect | Needs full system |

### Plan phase

| Feature | What it does | Status | Adopt now as-is? |
|---|---|---|---|
| HTML plan + live preview | Plan as an interactive doc, not markdown | Working | Needs full system |
| Plan versions & history | Roll back / diff plan revisions | Working | Needs full system |
| AI refine with diff | Ask for a plan edit, review it as a diff before accepting | Working | Needs full system |
| Templates + snippets + saved plans | Reusable plan scaffolds across cards | Working | Needs full system |
| Split into per-agent sub-plans | Fan a plan out to multiple cards | Working | Needs full system |

### Review phase

| Feature | What it does | Status | Adopt now as-is? |
|---|---|---|---|
| Whole-branch diff viewer | GitLab MR "Changes" equivalent | Working | Needs full system |
| Inline line comments → agent | Comment a hunk; agent gets it as scoped work | Working | Needs full system |
| Git history / commits / refs | Browse commits and refs per card | Working | Needs full system |
| Merge to base / push to remote | Land the card without leaving the board | Working | Needs full system |

### Seats & harness control

| Feature | What it does | Status | Adopt now as-is? |
|---|---|---|---|
| Multi-account seats | Pin which account a card bills; per-account git identity | Working | Needs full system |
| Subagent seats | Subagents bill a separate API seat so orchestration doesn't burn the main OAuth cap | Working | Needs full system |
| Auto-resume on rate limit | Park on the 5h wall, wake when it clears, backoff | Working | Needs full system |
| Multi-harness | Claude Code / Cursor / Cline launchable, same board behaviour | Working (3 of 8) | Needs full system |
| API-key providers (Cline) | Escape the Claude subscription; swap provider later | Working | Needs full system |
| Per-card allowlists | Restrict skills, commands, MCP servers, sub-agents, model, effort | Working | Needs full system |
| Stack switchboard | 6 toggles (RTK / Caveman / UA / Headroom / CCR / DevTools) per project | Working | Needs full system |

**Suggested first step for the team:** take RTK and Caveman. Both are ~10 minutes, neither requires PixelCompany, and RTK alone is the 88.9%.

---

*Idea and earlier draft previously shown to Chitsanu, Son Le, Trong Luong.*
