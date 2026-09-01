import { mkdir } from "node:fs/promises";

import type { RuntimeTaskLaunchSettings } from "../core/api-contract";
import { createFlowiseClient } from "../flowise/flowise-client";
import { isFlowiseMcpServerId } from "../flowise/flowise-mcp";
import { prepareProjectMcpConfig } from "../terminal/agent-mcp-launch";
import { resolveSubagentSeatEnv } from "../terminal/subagent-seat-launch";
import { hasMcpAllowlist } from "../terminal/task-launch-settings";
import { buildDshArgv, resolveDshBinary } from "./dsh-binary";
import { resolveDefaultDshHome, resolveOrchestratorPatchPath } from "./dsh-endpoint";
import { prepareOrchestratorFlowisePatch } from "./orchestrator-flowise-patch";
import { prepareOrchestratorLlmPatch } from "./orchestrator-llm-patch";

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

const CUSTOM_AGENT_PREFACE = [
	"PixelOffice Custom Agent session (DeepSeek Harness headless).",
	"You may delegate to product subagents when appropriate:",
	"- cursor_agent — Cursor CLI (ACP); use for repo edits and Cursor MCP.",
	"- subagent_claude_code — Claude Code CLI; org MCP policy applies to the child.",
	"- subagent_codex — OpenAI Codex CLI.",
	"Implement final changes in the task worktree. Prefer cursor_agent for coding when Cursor MCP is configured.",
].join("\n");

/** Appended only when the card actually wired a Flowise flow, so the names are never invented. */
function renderFlowToolGuidance(toolNames: string[]): string {
	if (toolNames.length === 0) {
		return "";
	}
	const list = toolNames.map((name) => `- ${name}`).join("\n");
	return [
		"",
		"This card is backed by a Flowise custom agent. These tools each run a whole canvas —",
		"several agent nodes start together and coordinate inside Flowise, and you get their",
		"combined answer back as one tool result:",
		list,
		"Call one of them for work the canvas was built for instead of re-deriving it yourself.",
	].join("\n");
}

/** `flowise-*` ids to wire into dsh: the card's Custom Agent flows plus any picked as plain MCP. */
export function collectCustomAgentFlowIds(settings?: RuntimeTaskLaunchSettings | null): string[] {
	const ids = new Set<string>();
	for (const id of settings?.customAgentFlowIds ?? []) {
		const trimmed = id.trim();
		if (trimmed) {
			ids.add(trimmed);
		}
	}
	for (const id of settings?.mcpServerIds ?? []) {
		const trimmed = id.trim();
		if (trimmed && isFlowiseMcpServerId(trimmed)) {
			ids.add(trimmed);
		}
	}
	return [...ids];
}

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
		input.warn?.("Custom Agent patch missing (config/orchestrator/pixeloffice.patch.yml).");
		return null;
	}
	const prompt = input.prompt.trim();
	if (prompt.length === 0) {
		// The headless runner rejects a blank task before activating and exits nonzero with no
		// output, which reads as "dsh is broken" rather than "this card has no prompt".
		input.warn?.("Custom Agent needs a prompt — dsh headless runs exactly one task and rejects an empty one.");
		return null;
	}
	const dshHome = resolveDefaultDshHome();
	await ensureDshHome(dshHome);

	const cleanups: Array<() => Promise<void>> = [];

	const flowiseServerIds = collectCustomAgentFlowIds(input.taskLaunchSettings);
	let flowisePatchPath: string | null = null;
	let flowToolNames: string[] = [];
	if (flowiseServerIds.length > 0) {
		const flowisePatch = await prepareOrchestratorFlowisePatch({
			flowiseServerIds,
			client: createFlowiseClient({
				warn: (message) => {
					input.warn?.(message);
				},
			}),
			warn: (message) => input.warn?.(message),
			log: (message) => input.log?.(message),
		});
		if (flowisePatch !== null) {
			flowisePatchPath = flowisePatch.patchPath;
			flowToolNames = flowisePatch.toolNames;
			cleanups.push(flowisePatch.cleanup);
		}
	}

	// The dsh launcher parses only its own flags and hands everything from the first token it
	// does not recognize to the booted profile, where the headless app reads the *positional*
	// argument as its task. So the prompt goes last and bare; there is no --prompt, no --cwd
	// (the PTY already spawns in the worktree) and no --force.
	// Points dsh's own LLM at the seat-backed proxy so the card needs no DeepSeek key. Null when
	// the operator asked for dsh's shipped DeepSeek route or the proxy is disabled.
	const llmPatch = await prepareOrchestratorLlmPatch({ log: (message) => input.log?.(message) });
	if (llmPatch !== null) {
		cleanups.push(llmPatch.cleanup);
	}

	const headlessArgs = ["--profile", "headless", "--patch", patchPath];
	if (llmPatch !== null) {
		headlessArgs.push("--patch", llmPatch.patchPath);
	}
	if (flowisePatchPath !== null) {
		headlessArgs.push("--patch", flowisePatchPath);
	}
	if (input.autonomousModeEnabled) {
		// Autonomy is a composition concern for dsh, not a CLI flag — approval behaviour comes
		// from the profile's own rows. Passing an unknown flag here would silently become the task.
		input.log?.("Custom Agent: autonomous mode is governed by the dsh profile, not a launch flag.");
	}
	headlessArgs.push(`${CUSTOM_AGENT_PREFACE}${renderFlowToolGuidance(flowToolNames)}\n\n${prompt}`);

	const { command, args } = buildDshArgv(binary, headlessArgs);
	const env: Record<string, string | undefined> = {
		DSH_HOME: dshHome,
		PIXELOFFICE_ORCHESTRATOR: "1",
		...(llmPatch?.env ?? {}),
	};

	// Subagent seat env applies when the Custom Agent delegates to Claude Code children.
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

	if (hasMcpAllowlist(input.taskLaunchSettings)) {
		// Kept alongside the dsh-native wiring above: a `cursor_agent` child reads this, and it
		// is the only path for non-Flowise MCP servers the card selected.
		const mcpConfig = await prepareProjectMcpConfig({
			cwd: input.cwd,
			mcpServerIds: input.taskLaunchSettings?.mcpServerIds ?? [],
			format: "cursor",
			warn: (message) => input.warn?.(message),
		});
		if (mcpConfig) {
			cleanups.push(mcpConfig.cleanup);
		}
	}

	const cleanup =
		cleanups.length === 0
			? undefined
			: async (): Promise<void> => {
					for (const run of cleanups) {
						await run();
					}
				};

	return { command, args, env, patchPath, dshHome, cleanup };
}
