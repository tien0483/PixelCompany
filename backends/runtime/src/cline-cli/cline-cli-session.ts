// Drives one Cline session for `kanban cline-agent`.
//
// Almost nothing here is new: `InMemoryClineSessionRuntime` already owns the SDK host, the MCP
// tool bundle, the model catalog and the taskId↔sessionId binding, and `createClineRuntimeSetup`
// already owns rules, skills and workflow slash-commands. This file supplies the two things a PTY
// needs that the in-process service supplied differently — a terminal renderer instead of chat
// messages, and the `--hooks-dir` scripts instead of direct summary emission.
import { createClineProviderService } from "../cline-sdk/cline-provider-service";
import { createClineRuntimeSetup } from "../cline-sdk/cline-runtime-setup";
import { createInMemoryClineSessionRuntime } from "../cline-sdk/cline-session-runtime";
import { buildClineStartPrompt } from "../cline-sdk/cline-task-session-service";
import { resolveClineSdkSystemPrompt } from "../cline-sdk/sdk-runtime-boundary";
import type { RuntimeClineReasoningEffort } from "../core/api-contract";
import { KANBAN_HOOK_TASK_ID_ENV } from "../terminal/hook-runtime-context";
import { createAutoApproveToolApproval, createInteractiveToolApproval } from "./cline-cli-approvals";
import { classifyClineCliEvent } from "./cline-cli-events";
import { createClineCliHookRunner } from "./cline-cli-hooks";
import { createClineCliInput } from "./cline-cli-input";
import { createClineCliRenderer } from "./cline-cli-renderer";

export interface RunClineCliSessionOptions {
	cwd: string;
	prompt: string;
	autoApproveAll: boolean;
	planMode: boolean;
	continueSession: boolean;
	hooksDir: string | null;
	providerId?: string | null;
	modelId?: string | null;
	reasoningEffort?: RuntimeClineReasoningEffort | null;
	showReasoning: boolean;
	/** Overrides the task id; defaults to the launching card's, then to a per-process id. */
	sessionId?: string | null;
	/** Forced off for a piped stdin; a card's PTY is always interactive. */
	interactive: boolean;
	write?: (text: string) => void;
}

/**
 * The task id is the join between this process and everything else that knows about the card: the
 * SDK persists sessions under a `<taskId>` prefix, so reusing the launching card's id is what lets
 * `--continue` pick up a conversation the in-process path started (and vice versa).
 */
function resolveCliTaskId(explicit: string | null | undefined): string {
	const fromOption = explicit?.trim();
	if (fromOption) {
		return fromOption;
	}
	const fromCard = process.env[KANBAN_HOOK_TASK_ID_ENV]?.trim();
	if (fromCard) {
		return fromCard;
	}
	return `cline-cli-${process.pid}`;
}

export async function runClineCliSession(options: RunClineCliSessionOptions): Promise<number> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const renderer = createClineCliRenderer({
		write,
		showReasoning: options.showReasoning,
		color: process.stdout.isTTY === true,
	});
	const hooks = createClineCliHookRunner(options.hooksDir);
	const taskId = resolveCliTaskId(options.sessionId);

	const providerService = createClineProviderService();
	const launchConfig = await providerService.resolveLaunchConfig({
		...(options.providerId ? { providerIdOverride: options.providerId } : {}),
		...(options.modelId ? { modelIdOverride: options.modelId } : {}),
		...(options.reasoningEffort !== undefined ? { reasoningEffortOverride: options.reasoningEffort } : {}),
	});
	for (const warning of launchConfig.warnings ?? []) {
		renderer.warn(warning);
	}
	if (!launchConfig.modelId) {
		renderer.fail("No model is configured for this Cline seat. Pick a model in Settings and try again.");
		return 1;
	}

	const input = options.interactive ? createClineCliInput() : null;
	const runtimeSetup = await createClineRuntimeSetup(options.cwd);
	const requestToolApproval =
		options.autoApproveAll || !input
			? createAutoApproveToolApproval()
			: createInteractiveToolApproval({ ask: (question) => input.ask(question), write });

	let lastTurnStatus: "completed" | "aborted" | "failed" = "completed";
	let sessionEnded = false;
	// `tool-finished` does not always repeat the input, and the label would degrade to a bare tool
	// name; the started event is the only place it is guaranteed to appear.
	const toolInputByName = new Map<string, unknown>();

	const sessionRuntime = createInMemoryClineSessionRuntime({
		onTaskEvent: (_taskId, event) => {
			const observation = classifyClineCliEvent(event);
			if (!observation) {
				return;
			}
			if (observation.kind === "tool-started") {
				if (observation.toolName) {
					toolInputByName.set(observation.toolName, observation.toolInput);
				}
				renderer.render(observation);
				void hooks.fire("PreToolUse", { toolName: observation.toolName, toolInput: observation.toolInput });
				if (observation.userAttention) {
					void hooks.fire("Notification", { event: "user_attention", toolName: observation.toolName });
				}
				return;
			}
			if (observation.kind === "tool-finished") {
				const toolInput =
					observation.toolInput ?? (observation.toolName ? toolInputByName.get(observation.toolName) : undefined);
				renderer.render({ ...observation, toolInput });
				void hooks.fire("PostToolUse", {
					toolName: observation.toolName,
					toolInput,
					error: observation.error,
				});
				return;
			}
			if (observation.kind === "turn-finished") {
				lastTurnStatus = observation.status;
				renderer.render(observation);
				renderer.resetTurn();
				return;
			}
			if (observation.kind === "ended") {
				sessionEnded = true;
			}
			if (observation.kind === "error" && !observation.recoverable) {
				lastTurnStatus = "failed";
			}
			renderer.render(observation);
		},
	});

	const rules = runtimeSetup.loadRules();
	const systemPrompt = await resolveClineSdkSystemPrompt({
		cwd: options.cwd,
		providerId: launchConfig.providerId,
		seatProviderId: launchConfig.seatProviderId,
		rules,
	});

	// `--continue` resumes whatever the card last ran, including a conversation the in-process SDK
	// path owned. A miss is not an error: it just means this is the first run for that id.
	const resumeSnapshot = options.continueSession
		? await sessionRuntime.readPersistedTaskSession(taskId).catch(() => null)
		: null;
	if (options.continueSession && !resumeSnapshot) {
		renderer.note("No previous Cline session found for this task — starting a new one.");
	}

	let exitCode = 0;
	try {
		const startPrompt = runtimeSetup.resolvePrompt(buildClineStartPrompt(options.prompt, options.planMode));
		if (startPrompt.trim().length > 0) {
			await hooks.fire("UserPromptSubmit");
		}
		const startResult = await sessionRuntime.startTaskSession({
			taskId,
			cwd: options.cwd,
			prompt: startPrompt,
			...(resumeSnapshot ? { initialMessages: resumeSnapshot.messages } : {}),
			providerId: launchConfig.providerId,
			modelId: launchConfig.modelId,
			mode: "act",
			apiKey: launchConfig.apiKey,
			baseUrl: launchConfig.baseUrl,
			reasoningEffort: launchConfig.reasoningEffort ?? null,
			systemPrompt,
			userInstructionService: runtimeSetup.userInstructionService,
			requestToolApproval,
		});
		for (const warning of startResult.warnings ?? []) {
			renderer.warn(warning);
		}
		renderer.closeLine();
		await hooks.fire("TaskComplete");

		if (input) {
			// First Ctrl+C cancels the running turn, second exits — same contract as the other CLIs
			// on this board, and the reason abort is not wired straight to process exit.
			let interrupts = 0;
			input.onInterrupt(() => {
				interrupts += 1;
				if (interrupts === 1) {
					renderer.warn("\ninterrupting turn — press Ctrl+C again to exit");
					void sessionRuntime.abortTaskSession(taskId).catch(() => undefined);
					return;
				}
				input.close();
			});

			while (!sessionEnded) {
				const nextPrompt = await input.ask("\n> ");
				if (nextPrompt === null) {
					break;
				}
				const trimmed = nextPrompt.trim();
				if (trimmed.length === 0) {
					continue;
				}
				if (trimmed === "/exit" || trimmed === "/quit") {
					break;
				}
				interrupts = 0;
				renderer.resetTurn();
				await hooks.fire("UserPromptSubmit");
				try {
					await sessionRuntime.sendTaskSessionInput(taskId, runtimeSetup.resolvePrompt(trimmed));
				} catch (error) {
					renderer.fail(error instanceof Error ? error.message : String(error));
					lastTurnStatus = "failed";
					break;
				}
				renderer.closeLine();
				await hooks.fire("TaskComplete");
			}
		}

		exitCode = lastTurnStatus === "failed" ? 1 : 0;
	} catch (error) {
		renderer.fail(error instanceof Error ? error.message : String(error));
		exitCode = 1;
	} finally {
		input?.close();
		await sessionRuntime.stopTaskSession(taskId).catch(() => undefined);
		await sessionRuntime.dispose().catch(() => undefined);
		await runtimeSetup.dispose().catch(() => undefined);
		// Board transitions are spawned processes; exiting before they run loses the column move.
		await hooks.drain();
	}

	return exitCode;
}
