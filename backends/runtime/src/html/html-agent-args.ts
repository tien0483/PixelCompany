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
 * Narrow, still-explicit allowlist for a one-shot pass that has no files to
 * read. Passing this instead of `undefined` means `--allowedTools` is always
 * present on the command line, so a stray tool call the model reaches for
 * anyway is denied immediately instead of stalling on a permission prompt
 * the `-p` run has no UI to answer.
 */
export const HTML_NO_TOOLS = ["Read"] as const;

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
 * than relying on `--permission-mode auto` to decide for them.
 *
 * `whenDenied` lets a caller that cannot tolerate an absent `--allowedTools`
 * flag at all (the brief pass — see `HTML_NO_TOOLS`) supply a fallback
 * allowlist instead of `undefined`. Callers that omit it keep the original
 * behaviour: a template that did not ask for `allow_read` gets no allowlist,
 * so nothing is loosened by default.
 */
export function resolveHtmlAllowedTools(
	allowRead: boolean | undefined,
	whenDenied?: readonly string[],
): string[] | undefined {
	if (allowRead === true) {
		return [...HTML_READ_TOOLS];
	}
	return whenDenied ? [...whenDenied] : undefined;
}
