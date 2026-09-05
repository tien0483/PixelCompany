export type ClineExecutionMode = "cli" | "sdk";

/**
 * Which Cline runtime a card gets.
 *
 * `cli` is the default: Cline runs as a PTY through `kanban cline-agent`, like every other agent
 * on this board. `sdk` restores the in-process `ClineTaskSessionService` path and its chat panel —
 * kept because it is the only way back for a persisted chat session, and because a bad harness
 * turn must be one environment variable away from recovery, not a redeploy.
 */
export function resolveClineExecutionMode(env: NodeJS.ProcessEnv = process.env): ClineExecutionMode {
	const requested = (env.PIXTIEL_CLINE_MODE ?? env.PIXELOFFICE_CLINE_MODE)?.trim().toLowerCase();
	return requested === "sdk" ? "sdk" : "cli";
}
