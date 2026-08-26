/**
 * The tool and cwd decisions the three review one-shot agents need. Separated
 * from the server handler so they can be tested without booting a server (the
 * house pattern — see `html-agent-args.ts`).
 */

/**
 * The rules extractor reads guideline docs and lint configs and writes nothing:
 * its output is the SSE stream itself. Grep is included because a 20 000-line
 * `ruff.toml` is faster to mine by rule id than to read end to end.
 */
export const REVIEW_RULES_EXTRACT_ALLOWED_TOOLS = ["Read", "Glob", "Grep"] as const;

/**
 * The audit pass is handed the patches inline, so it needs no file access at all.
 * The allowlist is still explicit and non-empty: a one-shot `claude -p` run has no
 * UI to answer a permission prompt with, so an omitted `--allowedTools` turns a
 * stray tool call into a stalled stream instead of an immediate denial.
 */
export const REVIEW_AUDIT_ALLOWED_TOOLS = ["Read"] as const;

/**
 * The chat pass is the one surface where the reviewer deliberately reaches past
 * the diff — `/understand-diff` walks the knowledge graph, `/security-review`
 * reads neighbouring modules — so it gets read plus the skill-running tools, and
 * still no writes: nothing in a review should edit the working tree.
 */
export const REVIEW_CHAT_ALLOWED_TOOLS = [
	"Read",
	"Glob",
	"Grep",
	"Task",
	"Skill",
	// Read-only git, enumerated one subcommand at a time rather than as `Bash(git:*)`.
	// A project's own `.claude/commands/review.md` is typically written against a
	// terminal — `git diff master...$BRANCH`, `git show $BRANCH:<path>` — and with no
	// Bash at all those runs do not fail loudly: a one-shot `-p` has no UI to answer
	// the permission prompt with, so the panel just sits there until the idle watchdog
	// cancels it. Nothing here can write to the repository or move HEAD, which keeps
	// the "reading, not editing" rule in REVIEW_CHAT_SYSTEM_PROMPT true.
	"Bash(git diff:*)",
	"Bash(git show:*)",
	"Bash(git log:*)",
	"Bash(git status:*)",
	"Bash(git merge-base:*)",
	"Bash(git rev-parse:*)",
	"Bash(git ls-files:*)",
	// Deliberately absent: `git branch`, which reads with no flags but deletes with
	// `-D`. `git rev-parse --abbrev-ref HEAD` covers what a review command needs.
] as const;

/**
 * Rewriting a note into a review comment is a text transformation on text the
 * caller already supplied. `Read` is here only so the pass can look at the line it
 * is commenting on when the caller sends an excerpt reference rather than the code;
 * it needs nothing else, and a non-empty allowlist is what keeps a stray tool call
 * from stalling a `-p` run that has no UI to answer a permission prompt.
 */
export const REVIEW_SUGGEST_ALLOWED_TOOLS = ["Read"] as const;

/**
 * Working directory for a review agent. The reviewer's own repo checkout is the
 * useful default — that is what makes `/understand-diff` and codebase questions
 * resolve — and an explicit `cwd` from the caller always wins.
 */
export function resolveReviewAgentCwd(input: { cwd?: string; projectPath?: string | null }): string | undefined {
	if (input.cwd) {
		return input.cwd;
	}
	return input.projectPath ?? undefined;
}
