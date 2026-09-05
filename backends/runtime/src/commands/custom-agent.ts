// `kanban custom-agent` — the DeepSeek Harness (dsh) harness.
//
// dsh was already a CLI on a PTY; what it lacked was a single place that composes a run. The argv
// (shipped patch + generated LLM overlay + generated Flowise overlay + DSH_HOME + the Custom Agent
// preface) was built inside the runtime, so a card's run could not be reproduced by hand. This
// command wraps `prepareOrchestratorLaunch` unchanged, and `orchestratorAdapter` now launches it,
// so board runs and terminal runs are byte-identical argv.
import { spawn } from "node:child_process";
import type { Command } from "commander";
import type { RuntimeTaskLaunchSettings } from "../core/api-contract";
import { prepareOrchestratorLaunch } from "../orchestrator/orchestrator-launch";

interface CustomAgentCommandOptions {
	flow?: string[];
	mcp?: string[];
	cwd?: string;
	autonomous?: boolean;
}

/**
 * Spawns dsh with the terminal attached and forwards signals.
 *
 * Node cannot exec-replace itself, so this process stays in the tree as dsh's parent. Under a PTY
 * that is invisible — but the signal forwarding is not optional: without it Ctrl+C kills the
 * wrapper and orphans the harness, which then keeps writing into a terminal nobody owns.
 */
function runDsh(
	command: string,
	args: string[],
	env: Record<string, string | undefined>,
	cwd: string,
): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd,
			stdio: "inherit",
			env: { ...process.env, ...env },
		});

		const forward = (signal: NodeJS.Signals) => () => {
			child.kill(signal);
		};
		const onSigint = forward("SIGINT");
		const onSigterm = forward("SIGTERM");
		process.on("SIGINT", onSigint);
		process.on("SIGTERM", onSigterm);

		child.on("error", (error) => {
			process.stderr.write(`custom-agent: could not start ${command}: ${error.message}\n`);
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
			resolve(1);
		});
		child.on("close", (code, signal) => {
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
			// A signal death reports `code === null`; treating that as success would mark an
			// interrupted card green.
			resolve(signal ? 1 : (code ?? 1));
		});
	});
}

export function registerCustomAgentCommand(program: Command): void {
	program
		.command("custom-agent [task...]")
		.description("Run the DeepSeek Harness (dsh) headless profile. The task is the trailing bare argument.")
		.option(
			"--flow <id>",
			"Flowise flow to mount as a dsh MCP tool (repeatable).",
			(value: string, previous: string[] = []) => [...previous, value],
		)
		.option(
			"--mcp <id>",
			"MCP server id to expose to delegated children (repeatable).",
			(value: string, previous: string[] = []) => [...previous, value],
		)
		.option("--cwd <dir>", "Workspace directory (defaults to the current one).")
		.option("--autonomous", "Report autonomous intent; dsh governs approvals from its profile.")
		.action(async (task: string[] | undefined, options: CustomAgentCommandOptions) => {
			const prompt = (task ?? []).join(" ").trim();
			const cwd = options.cwd?.trim() || process.cwd();
			const taskLaunchSettings = {
				...(options.flow && options.flow.length > 0 ? { customAgentFlowIds: options.flow } : {}),
				...(options.mcp && options.mcp.length > 0 ? { mcpServerIds: options.mcp } : {}),
			} as RuntimeTaskLaunchSettings;

			const launch = await prepareOrchestratorLaunch({
				cwd,
				prompt,
				taskLaunchSettings,
				autonomousModeEnabled: options.autonomous === true,
				warn: (message) => process.stderr.write(`custom-agent: ${message}\n`),
				log: (message) => process.stderr.write(`custom-agent: ${message}\n`),
			});
			if (launch === null) {
				process.exitCode = 1;
				return;
			}

			try {
				process.exitCode = await runDsh(launch.command, launch.args, launch.env, cwd);
			} finally {
				await launch.cleanup?.();
			}
		});
}
