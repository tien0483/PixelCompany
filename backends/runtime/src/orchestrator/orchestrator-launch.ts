import { mkdir } from "node:fs/promises";

import type { RuntimeTaskLaunchSettings } from "../core/api-contract";
import { prepareProjectMcpConfig } from "../terminal/agent-mcp-launch";
import { hasMcpAllowlist } from "../terminal/task-launch-settings";
import { resolveSubagentSeatEnv } from "../terminal/subagent-seat-launch";
import { buildDshArgv, resolveDshBinary } from "./dsh-binary";
import { resolveDefaultDshHome, resolveOrchestratorPatchPath } from "./dsh-endpoint";

export interface PrepareOrchestratorLaunchInput {
	cwd: string;
	prompt: string;
	taskLaunchSettings?: RuntimeTaskLaunchSettings | null;
	autonomousModeEnabled?: boolean;
	warn?: (message: string) => void;
	log?: (message: string) => void;
}

export interface PreparedOrchestratorLaunch {
	command: string;
	args: string[];
	env: Record<string, string | undefined>;
	patchPath: string | null;
	dshHome: string;
	cleanup?: () => Promise<void>;
}

const ORCHESTRATOR_PREFACE = [
	"PixelOffice orchestrator session (DeepSeek Harness headless).",
	"You may delegate to product subagents when appropriate:",
	"- cursor_agent — Cursor CLI (ACP); use for repo edits and Cursor MCP (e.g. Flowise run_agent).",
	"- subagent_claude_code — Claude Code CLI; org MCP policy applies to the child.",
	"- subagent_codex — OpenAI Codex CLI.",
	"Implement final changes in the task worktree. Prefer cursor_agent for coding when Cursor MCP is configured.",
].join("\n");

export async function ensureDshHome(dshHome: string): Promise<void> {
	await mkdir(dshHome, { recursive: true });
}

export async function prepareOrchestratorLaunch(
	input: PrepareOrchestratorLaunchInput,
): Promise<PreparedOrchestratorLaunch | null> {
	const binary = resolveDshBinary();
	if (binary === null) {
		input.warn?.(
			"DeepSeek Harness (dsh) not found on PATH. Install from https://github.com/deepseek-ai/deepseek-harness or set PIXELOFFICE_DSH_BINARY.",
		);
		return null;
	}
	const patchPath = resolveOrchestratorPatchPath();
	if (patchPath === null) {
		input.warn?.("Orchestrator patch missing (config/orchestrator/pixeloffice.patch.yml).");
		return null;
	}
	const dshHome = resolveDefaultDshHome();
	await ensureDshHome(dshHome);

	const headlessArgs = ["--profile", "headless", "--patch", patchPath, "--cwd", input.cwd];
	if (input.autonomousModeEnabled) {
		headlessArgs.push("--force");
	}

	const mergedPrompt = `${ORCHESTRATOR_PREFACE}\n\n${input.prompt}`.trim();
	headlessArgs.push("--prompt", mergedPrompt);

	const { command, args } = buildDshArgv(binary, headlessArgs);
	const env: Record<string, string | undefined> = {
		DSH_HOME: dshHome,
		PIXELOFFICE_ORCHESTRATOR: "1",
	};

	// Subagent seat env applies when the orchestrator delegates to Claude Code children.
	const subagentSeatEnv = await resolveSubagentSeatEnv(input.taskLaunchSettings ?? undefined, {
		warn: (message) => input.warn?.(message),
		log: (message) => input.log?.(message),
	});
	if (subagentSeatEnv) {
		env.ANTHROPIC_BASE_URL = subagentSeatEnv.ANTHROPIC_BASE_URL;
		env.CLAUDE_CODE_SUBAGENT_MODEL = subagentSeatEnv.CLAUDE_CODE_SUBAGENT_MODEL;
	}

	// Never pass solo's task-agent Anthropic key/url into dsh wholesale — same rule as Flowise.
	delete env.ANTHROPIC_API_KEY;

	let cleanup: (() => Promise<void>) | undefined;
	if (hasMcpAllowlist(input.taskLaunchSettings)) {
		const mcpConfig = await prepareProjectMcpConfig({
			cwd: input.cwd,
			mcpServerIds: input.taskLaunchSettings?.mcpServerIds ?? [],
			format: "cursor",
			warn: (message) => input.warn?.(message),
		});
		if (mcpConfig) {
			cleanup = mcpConfig.cleanup;
		}
	}

	return { command, args, env, patchPath, dshHome, cleanup };
}
