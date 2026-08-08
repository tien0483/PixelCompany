import { dirname } from "node:path";

/**
 * The two decisions the HTML generate handler makes before it hands the prompt
 * to the agent. They live here rather than inline in `runtime-server.ts` so
 * they can be tested without booting a server (the house pattern — see
 * `test/runtime/server/ws-upgrade-passcode.test.ts`).
 */

/** Tools granted to a template that declared `allow_read` in its SKILL.md. */
export const HTML_READ_TOOLS = ["Read", "Glob"] as const;

/**
 * Working directory for the agent.
 *
 * A template that reads its input's images needs somewhere to read them
 * relative to: plan markdown references assets as `<plan-stem>.assets/<file>`,
 * which only resolves next to the plan file itself. An explicit `cwd` from the
 * caller always wins; an unknown or absent plan leaves it undefined, which is
 * the pre-existing behaviour (the agent inherits the runtime's cwd).
 */
export function resolveHtmlAgentCwd(input: {
	cwd?: string;
	planPath?: string | null;
}): string | undefined {
	if (input.cwd) {
		return input.cwd;
	}
	return input.planPath ? dirname(input.planPath) : undefined;
}

/**
 * Tools the agent may use without a permission prompt.
 *
 * A one-shot `claude -p` run has no UI to answer a permission prompt with, so
 * an unexpected one would stall the SSE stream until the request is cancelled.
 * Templates that need file access therefore pass an explicit allowlist rather
 * than relying on `--permission-mode auto` to decide for them. Templates that
 * did not ask get no allowlist at all, so nothing is loosened by default.
 */
export function resolveHtmlAllowedTools(allowRead: boolean | undefined): string[] | undefined {
	return allowRead === true ? [...HTML_READ_TOOLS] : undefined;
}
