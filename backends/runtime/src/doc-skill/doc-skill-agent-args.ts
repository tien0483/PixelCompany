/**
 * The two decisions the docs-pipeline one-shot agent needs before it runs.
 * They live here rather than inline so they can be tested without booting a
 * server (the house pattern — see `html-agent-args.ts`).
 */

/**
 * Tools granted to the docs-pipeline agent. `Bash(python3:*)` is scoped so the
 * agent can run `round_tool.py`/`build_site.py` without a broad Bash grant.
 */
export const DOC_SKILL_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash(python3:*)"];

/**
 * Working directory for the agent: the target repo it is auditing/verifying,
 * so relative paths in its own investigation resolve naturally.
 */
export function resolveDocSkillAgentCwd(input: { targetRepo: string }): string {
	return input.targetRepo;
}
