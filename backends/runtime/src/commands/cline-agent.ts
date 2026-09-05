// `kanban cline-agent` — the PTY harness for the Cline SDK.
//
// The first four options are not a free choice: `clineAdapter`
// (`terminal/agent-session-adapters.ts`) has emitted exactly them since before this command
// existed, and the board launches this binary with that argv. The task is the last bare
// positional, so a flag added here that the parser does not know would be swallowed into the
// prompt instead of erroring — same trap as the dsh headless app.
import type { Command } from "commander";
import { runClineCliSession } from "../cline-cli/cline-cli-session";
import type { RuntimeClineReasoningEffort } from "../core/api-contract";

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "max"]);

interface ClineAgentCommandOptions {
	autoApproveAll?: boolean;
	continue?: boolean;
	plan?: boolean;
	hooksDir?: string;
	provider?: string;
	model?: string;
	reasoningEffort?: string;
	reasoning?: boolean;
	cwd?: string;
	sessionId?: string;
}

function parseReasoningEffort(value: string | undefined): RuntimeClineReasoningEffort | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0 || normalized === "none") {
		return null;
	}
	if (!REASONING_EFFORTS.has(normalized)) {
		throw new Error(`Invalid reasoning effort "${value}". Must be one of: ${[...REASONING_EFFORTS].join(", ")}`);
	}
	return normalized as RuntimeClineReasoningEffort;
}

export function registerClineAgentCommand(program: Command): void {
	program
		.command("cline-agent [task...]")
		.description("Run the Cline agent in this terminal. The task is the trailing bare argument.")
		.option("--auto-approve-all", "Approve every tool call without asking.")
		.option("--continue", "Resume this task's previous Cline conversation.")
		.option("--plan", "Plan first: inspect and propose, do not edit.")
		.option("--hooks-dir <dir>", "Directory holding the Kanban hook scripts to fire.")
		.option("--provider <id>", "Cline provider / API seat id.")
		.option("--model <id>", "Model id for the chosen seat.")
		.option("--reasoning-effort <effort>", "none | minimal | low | medium | high | max")
		.option("--reasoning", "Print reasoning text as it streams.")
		.option("--cwd <dir>", "Workspace directory (defaults to the current one).")
		.option("--session-id <id>", "Task id used for session persistence. Defaults to the launching card's.")
		.action(async (task: string[] | undefined, options: ClineAgentCommandOptions) => {
			const prompt = (task ?? []).join(" ").trim();
			const reasoningEffort = parseReasoningEffort(options.reasoningEffort);
			const exitCode = await runClineCliSession({
				cwd: options.cwd?.trim() || process.cwd(),
				prompt,
				autoApproveAll: options.autoApproveAll === true,
				planMode: options.plan === true,
				continueSession: options.continue === true,
				hooksDir: options.hooksDir?.trim() || null,
				providerId: options.provider?.trim() || null,
				modelId: options.model?.trim() || null,
				...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
				showReasoning: options.reasoning === true,
				sessionId: options.sessionId?.trim() || null,
				// A piped stdin cannot answer an approval prompt or a follow-up turn, so the run is
				// one-shot there. Under a card the PTY is always a tty.
				interactive: process.stdin.isTTY === true,
			});
			process.exitCode = exitCode;
		});
}
