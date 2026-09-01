// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed Cline, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { createClineMcpRuntimeService } from "../cline-sdk/cline-mcp-runtime-service";
import { createClineMcpSettingsService } from "../cline-sdk/cline-mcp-settings-service";
import { createClineProviderService } from "../cline-sdk/cline-provider-service";
import { isClineClearSlashCommand } from "../cline-sdk/cline-slash-commands";
import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import type { RuntimeConfigState } from "../config/runtime-config";
import { updateGlobalRuntimeConfig, updateRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeClineReasoningEffort,
	RuntimeCommandRunResponse,
	RuntimeHostEnvironmentResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskClineSettings,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
	RuntimeUpdateStatusResponse,
} from "../core/api-contract";
import {
	parseClineAccountSwitchRequest,
	parseClineAddProviderRequest,
	parseClineDeleteProviderRequest,
	parseClineDeviceAuthCompleteRequest,
	parseClineMcpOAuthRequest,
	parseClineMcpSettingsSaveRequest,
	parseClineOauthLoginRequest,
	parseClineProviderModelsRequest,
	parseClineProviderSettingsSaveRequest,
	parseClineTestProviderRequest,
	parseClineUpdateProviderRequest,
	parseCommandRunRequest,
	parseRuntimeConfigSaveRequest,
	parseShellSessionStartRequest,
	parseTaskChatAbortRequest,
	parseTaskChatCancelRequest,
	parseTaskChatMessagesRequest,
	parseTaskChatModelRequest,
	parseTaskChatReloadRequest,
	parseTaskChatSendRequest,
	parseTaskSessionInputRequest,
	parseTaskSessionPauseRequest,
	parseTaskSessionStagePasteImagesRequest,
	parseTaskSessionStartRequest,
	parseTaskSessionStopRequest,
} from "../core/api-validation";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { resolveTaskTitle } from "../core/task-title.js";
import { type ManagerDonateAccountLike, resolveManagerAccountPin } from "../manager/manager-account-pin";
import { loadWorkspaceState } from "../state/workspace-state";
import { composePromptWithAttachedPlan } from "../prompts/compose-prompt-with-plan";
import { openInBrowser } from "../server/browser";
import {
	getWorkspaceLocalAssetsSetting,
	getWorkspaceManagerFeatures,
	loadWorkspaceContextById,
	setWorkspaceLocalAssets,
} from "../state/workspace-state";
import { writeTaskSessionPasteImages } from "../terminal/task-image-prompt";
import { listAgentModelInventory } from "../terminal/agent-model-inventory";
import { buildRuntimeConfigResponse, resolveAgentCommand } from "../terminal/agent-registry";
import type { TerminalSessionManager } from "../terminal/session-manager";
import {
	applyFableSeatLaunchSettings,
	hasClaudeScopedConfigAllowlist,
	listClaudeMcpInventory,
	listClaudeSkillInventory,
} from "../terminal/task-launch-settings";
import { readClaudeOrgMcpPolicy } from "../terminal/claude-org-mcp-policy";
import { cleanClaudeCache, getClaudeCacheStatus } from "../workspace/claude-cache-cleanup";
import { resolveTaskCwd } from "../workspace/task-worktree";
import { LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, RUNTIME_HOME_PARENT_DIR_NAME } from "../workspace/task-worktree-path";
import type { FlowiseClient } from "../flowise/flowise-client";
import { captureTaskTurnCheckpoint } from "../workspace/turn-checkpoints";
import { measureTaskStartSpan } from "../workspace/task-start-timing";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router";

export interface CreateRuntimeApiDependencies {
	getActiveWorkspaceId: () => string | null;
	getActiveRuntimeConfig?: () => RuntimeConfigState;
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
	getScopedTerminalManager: (scope: RuntimeTrpcWorkspaceScope) => Promise<TerminalSessionManager>;
	getScopedClineTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<ClineTaskSessionService>;
	/**
	 * Prepares the per-account CLAUDE_CONFIG_DIR for a task pinned to a Claude account.
	 */
	getManagerAccountLaunchDir?: (accountId: number) => Promise<{ configDir: string } | null>;
	/** Reads the Cursor API key snapshot for a pinned Cursor task. */
	getManagerAccountLaunchCredential?: (accountId: number) => Promise<{ apiKey: string } | null>;
	getManagerAccountProvider?: (
		accountId: number,
	) => Promise<import("../core/api-contract").RuntimeManagerProvider | null>;
	/** Auto (unpinned) Cursor tasks: pick a Cursor jacked account for CURSOR_API_KEY. */
	resolveDefaultCursormanagerAccountId?: () => Promise<number | null>;
	/** Active Claude Jacked seat — used to prep CC creds for skill/MCP-tagged launches. */
	resolveActiveClaudemanagerAccountId?: () => Promise<number | null>;
	/** Auto (unpinned) Claude tasks: the least-used healthy seat, pinned like an explicit one. */
	resolveAutoClaudemanagerAccountId?: () => Promise<number | null>;
	/** `seatPreset: "fable"` tasks: the Claude seat with the most spendable extra usage credit. */
	resolveFableClaudemanagerAccountId?: () => Promise<number | null>;
	/** Jacked's live active Claude seat, unfiltered — used to detect a revoked live seat and redirect Auto launches. */
	resolveLiveActiveClaudemanagerAccountId?: () => Promise<number | null>;
	/** Donate state of a pinned account — lets a locked over-cap seat hard-block the launch. */
	getPinnedManagerAccount?: (accountId: number) => Promise<ManagerDonateAccountLike | null>;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	broadcastClineMcpAuthStatusesUpdated?: (
		statuses: Awaited<ReturnType<ReturnType<typeof createClineMcpRuntimeService>["getAuthStatuses"]>>,
	) => void;
	broadcastTaskChatCleared?: (workspaceId: string, taskId: string) => void;
	bumpClineSessionContextVersion?: () => void;
	prepareForStateReset?: () => Promise<void>;
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	getHostEnvironment: () => RuntimeHostEnvironmentResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
	/** Deployed Flowise flows are merged into the MCP picker as synthetic `flowise-*` ids. */
	flowiseClient?: FlowiseClient | null;
}

/**
 * Card-level Cline pins in the shape `resolveLaunchConfig` expects. Shared by every launch
 * path — start, home-chat reload, and home-chat send — because a pin that only the start
 * path honored meant a restarted session silently reverted to the seat default.
 *
 * The presence check on the whole object (not just `reasoningEffort`) is what distinguishes
 * "no override supplied" from "override that clears the reasoning effort".
 */
function toClineLaunchOverrides(clineSettings: RuntimeTaskClineSettings | undefined): {
	providerIdOverride?: string;
	modelIdOverride?: string;
	modelPinned: boolean;
	reasoningEffortOverride?: RuntimeClineReasoningEffort | null;
} {
	return {
		providerIdOverride: clineSettings?.providerId ?? undefined,
		modelIdOverride: clineSettings?.modelId ?? undefined,
		modelPinned: (clineSettings?.modelId?.trim().length ?? 0) > 0,
		...(clineSettings !== undefined ? { reasoningEffortOverride: clineSettings.reasoningEffort ?? null } : {}),
	};
}

async function resolveExistingTaskCwdOrEnsure(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<string> {
	try {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: false,
		});
	} catch {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: true,
		});
	}
}

function scheduleTurnCheckpointCapture(options: {
	cwd: string;
	taskId: string;
	turn: number;
	applyCheckpoint: (checkpoint: RuntimeTaskTurnCheckpoint) => RuntimeTaskSessionSummary | null;
}): void {
	void measureTaskStartSpan("startTaskSession.turnCheckpoint", async () => {
		try {
			const checkpoint = await captureTaskTurnCheckpoint({
				cwd: options.cwd,
				taskId: options.taskId,
				turn: options.turn,
			});
			options.applyCheckpoint(checkpoint);
		} catch {
			// Best effort checkpointing only.
		}
	});
}

export function createRuntimeApi(deps: CreateRuntimeApiDependencies): RuntimeTrpcContext["runtimeApi"] {
	const clineProviderService = createClineProviderService();
	const clineMcpSettingsService = createClineMcpSettingsService();
	const clineMcpRuntimeService = createClineMcpRuntimeService({
		onAuthStatusesChanged: (statuses) => {
			deps.broadcastClineMcpAuthStatusesUpdated?.(statuses);
		},
	});
	// Both homes: state written before the directory rename still exists on disk, and
	// a "reset all state" that left it behind would resurrect old boards on next load.
	const debugResetTargetPaths = [
		join(homedir(), LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, "data"),
		join(homedir(), LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, "kanban"),
		join(homedir(), LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, "worktrees"),
		join(homedir(), RUNTIME_HOME_PARENT_DIR_NAME, "kanban"),
		join(homedir(), RUNTIME_HOME_PARENT_DIR_NAME, "worktrees"),
	] as const;

	const buildConfigResponse = (runtimeConfig: RuntimeConfigState) =>
		buildRuntimeConfigResponse(runtimeConfig, clineProviderService.getProviderSettingsSummary());

	return {
		loadConfig: async (workspaceScope) => {
			const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
			if (!workspaceScope && !activeRuntimeConfig) {
				throw new Error("No active runtime config provider is available.");
			}
			let scopedRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			} else if (activeRuntimeConfig) {
				scopedRuntimeConfig = activeRuntimeConfig;
			} else {
				throw new Error("No active runtime config provider is available.");
			}
			return buildConfigResponse(scopedRuntimeConfig);
		},
		saveConfig: async (workspaceScope, input) => {
			const parsed = parseRuntimeConfigSaveRequest(input);
			let nextRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				nextRuntimeConfig = await updateRuntimeConfig(workspaceScope.workspacePath, parsed);
			} else {
				const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
				if (!activeRuntimeConfig) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "No active runtime config is available.",
					});
				}
				nextRuntimeConfig = await updateGlobalRuntimeConfig(activeRuntimeConfig, parsed);
			}
			if (workspaceScope && workspaceScope.workspaceId === deps.getActiveWorkspaceId()) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			if (!workspaceScope) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			return buildConfigResponse(nextRuntimeConfig);
		},
		saveClineProviderSettings: async (_workspaceScope, input) => {
			const body = parseClineProviderSettingsSaveRequest(input);
			const response = clineProviderService.saveProviderSettings(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		addClineProvider: async (_workspaceScope, input) => {
			const body = parseClineAddProviderRequest(input);
			const response = await clineProviderService.addCustomProvider(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		updateClineProvider: async (_workspaceScope, input) => {
			const body = parseClineUpdateProviderRequest(input);
			const response = await clineProviderService.updateCustomProvider(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		deleteClineProvider: async (_workspaceScope, input) => {
			const body = parseClineDeleteProviderRequest(input);
			const response = await clineProviderService.deleteCustomProvider(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		getClineCustomProviders: async (_workspaceScope) => {
			return await clineProviderService.listCustomProviders();
		},
		listClineApiSeats: async (_workspaceScope) => {
			return await clineProviderService.listApiSeats();
		},
		testClineProvider: async (_workspaceScope, input) => {
			const body = parseClineTestProviderRequest(input);
			return await clineProviderService.testProvider(body);
		},
		startTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStartRequest(input);
				if (body.resumeFromTrash) {
					deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
				}
				let launchPrompt = body.prompt;
				try {
					launchPrompt = await composePromptWithAttachedPlan({
						prompt: body.prompt,
						planFilePath: body.resumeFromTrash ? null : body.planFilePath,
					});
				} catch (error) {
					return {
						ok: false,
						summary: null,
						error: error instanceof Error ? error.message : String(error),
					};
				}
				const requestedClineTaskMode = body.mode ?? "act";
				const scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
				// Chain followers run in their chain root's worktree: resolve the cwd from
				// worktreeTaskId when present so the shared working tree is reused instead of
				// a fresh per-task worktree. The session itself stays keyed on body.taskId.
				const worktreeTaskId = body.worktreeTaskId?.trim() || body.taskId;
				const taskCwd = isHomeAgentSessionId(body.taskId)
					? workspaceScope.workspacePath
					: await resolveExistingTaskCwdOrEnsure({
							cwd: workspaceScope.workspacePath,
							taskId: worktreeTaskId,
							baseRef: body.baseRef,
						});
				const shouldCaptureTurnCheckpoint = !body.resumeFromTrash && !isHomeAgentSessionId(body.taskId);

				// Per-task config source-of-truth precedence:
				//
				// agentId resolution (which agent runtime to use):
				//   1. previousTerminalAgentId — persisted in the terminal session summary from
				//      the last run; ensures trash-restore resumes with the same agent runtime.
				//   2. body.agentId — the card's current per-task agent override.
				//   3. scopedRuntimeConfig.selectedAgentId — the workspace-level default.
				//
				// clineSettings (which LLM model and reasoning profile the Cline agent uses):
				//   Always taken from the card's current override object. There is no
				//   session-level persistence for these;
				//   if the user changes the model on the card, the next session launch
				//   (including trash-restore) uses the updated values.
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const previousTerminalAgentId = body.resumeFromTrash
					? (terminalManager.getSummary(body.taskId)?.agentId ?? null)
					: null;
				const effectiveAgentId = previousTerminalAgentId ?? body.agentId ?? scopedRuntimeConfig.selectedAgentId;
				let useClinePath = effectiveAgentId === "cline";
				const shouldProbePersistedClineSession =
					body.resumeFromTrash && !useClinePath && previousTerminalAgentId === null;
				if (shouldProbePersistedClineSession) {
					// If the terminal summary already has a concrete non-Cline agentId,
					// skip Cline persisted-session probing. That probe can cold-start the
					// Cline session host and adds multi-second latency to Codex restores.
					const clineSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
					const persistedSession = await clineSessionService
						.rebindPersistedTaskSession(body.taskId)
						.catch(() => null);
					if (persistedSession) {
						useClinePath = true;
					}
				}

				if (useClinePath) {
					const clineLaunchConfig = await clineProviderService.resolveLaunchConfig(
						toClineLaunchOverrides(body.clineSettings),
					);
					const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
					const resolvedClineTitle = resolveTaskTitle(body.taskTitle?.trim(), body.prompt);
					const summary = await clineTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: taskCwd,
						prompt: launchPrompt,
						taskTitle: resolvedClineTitle.length > 0 ? resolvedClineTitle : undefined,
						images: body.images,
						resumeFromTrash: body.resumeFromTrash,
						resumeFromPersistence: body.resumeFromPersistence,
						autoResumeOnUsageLimit: body.autoResumeOnUsageLimit ?? false,
						autoFailoverOnUsageLimit: body.autoFailoverOnUsageLimit ?? false,
						providerId: clineLaunchConfig.providerId,
						seatProviderId: clineLaunchConfig.seatProviderId,
						modelId: clineLaunchConfig.modelId,
						mode: requestedClineTaskMode,
						startInPlanMode: body.startInPlanMode,
						apiKey: clineLaunchConfig.apiKey,
						baseUrl: clineLaunchConfig.baseUrl,
						reasoningEffort: clineLaunchConfig.reasoningEffort,
						launchWarnings: clineLaunchConfig.warnings,
					});

					let nextSummary = summary;
					if (shouldCaptureTurnCheckpoint) {
						const nextTurn = (summary.latestTurnCheckpoint?.turn ?? 0) + 1;
						scheduleTurnCheckpointCapture({
							cwd: taskCwd,
							taskId: body.taskId,
							turn: nextTurn,
							applyCheckpoint: (checkpoint) =>
								clineTaskSessionService.applyTurnCheckpoint(body.taskId, checkpoint),
						});
					}

					return {
						ok: true,
						summary: nextSummary,
					};
				}

				const resolvedConfig =
					effectiveAgentId !== scopedRuntimeConfig.selectedAgentId
						? { ...scopedRuntimeConfig, selectedAgentId: effectiveAgentId }
						: scopedRuntimeConfig;
				const resolved = resolveAgentCommand(resolvedConfig);
				if (!resolved) {
					return {
						ok: false,
						summary: null,
						error: "No runnable agent command is configured. Open Settings, install a supported CLI, and select it.",
					};
				}
				// Every Claude card runs on its own credential directory so concurrent
				// tasks can hold different accounts — a pinned card on the seat it names,
				// an Auto card on the least-used healthy one. Neither reads or writes
				// jacked's global active seat, which the Plans and Review tabs use.
				const accountPin = await measureTaskStartSpan("startTaskSession.accountPin", () =>
					resolveManagerAccountPin({
						agentId: resolved.agentId,
						managerAccountId: body.managerAccountId,
						getAccountLaunchDir: deps.getManagerAccountLaunchDir ?? (async () => null),
						getAccountLaunchCredential: deps.getManagerAccountLaunchCredential ?? (async () => null),
						getAccountProvider: async (accountId) => (await deps.getManagerAccountProvider?.(accountId)) ?? null,
						resolveDefaultCursorAccountId: deps.resolveDefaultCursormanagerAccountId,
						resolveActiveClaudeAccountId: deps.resolveActiveClaudemanagerAccountId,
						resolveAutoClaudeAccountId: deps.resolveAutoClaudemanagerAccountId,
						seatPreset: body.seatPreset,
						resolveFableClaudeAccountId: deps.resolveFableClaudemanagerAccountId,
						resolveLiveActiveClaudeAccountId: deps.resolveLiveActiveClaudemanagerAccountId,
						getPinnedAccount: deps.getPinnedManagerAccount,
						needsClaudeConfigDirForLaunchTags:
							resolved.agentId === "claude" && hasClaudeScopedConfigAllowlist(body.taskLaunchSettings),
					}),
				);
				// Locked donate cap over limit: abort before starting the session.
				if (accountPin.blocked) {
					return {
						ok: false,
						summary: null,
						error: accountPin.warning ?? "This seat is over its locked donate cap; the task was not launched.",
					};
				}
				// The Fable preset's model/effort are imposed here rather than trusted from the
				// card, so a card stored before the preset existed — or a CLI `start` that never
				// opened the picker — still launches the model the seat's credit was chosen for.
				const launchSettings =
					body.seatPreset === "fable" && resolved.agentId === "claude"
						? applyFableSeatLaunchSettings(body.taskLaunchSettings)
						: body.taskLaunchSettings;
				// Cursor Auto: no CURSOR_API_KEY injection — same auth as interactive
				// `agent` (`agent login`). Explicit seat pins still inject a key.
				const summary = await measureTaskStartSpan("startTaskSession.ptyPrepare", () =>
					terminalManager.startTaskSession({
						taskId: body.taskId,
						agentId: resolved.agentId,
						binary: resolved.binary,
						args: resolved.args,
						autonomousModeEnabled: scopedRuntimeConfig.agentAutonomousModeEnabled,
						cwd: taskCwd,
						prompt: launchPrompt,
						images: body.images,
						startInPlanMode: body.startInPlanMode,
						resumeFromTrash: body.resumeFromTrash,
						resumeFromPersistence: body.resumeFromPersistence,
						cols: body.cols,
						rows: body.rows,
						workspaceId: workspaceScope.workspaceId,
						taskLaunchSettings: launchSettings,
						autoResumeOnUsageLimit: body.autoResumeOnUsageLimit ?? false,
						autoFailoverOnUsageLimit: body.autoFailoverOnUsageLimit ?? false,
						...(Object.keys(accountPin.env).length > 0 ? { env: accountPin.env } : {}),
						...(accountPin.accountId === null ? {} : { managerAccountId: accountPin.accountId }),
					}),
				);

				const nextSummary = summary;
				if (shouldCaptureTurnCheckpoint) {
					const nextTurn = (summary.latestTurnCheckpoint?.turn ?? 0) + 1;
					scheduleTurnCheckpointCapture({
						cwd: taskCwd,
						taskId: body.taskId,
						turn: nextTurn,
						applyCheckpoint: (checkpoint) => terminalManager.applyTurnCheckpoint(body.taskId, checkpoint),
					});
				}
				return {
					ok: true,
					summary: nextSummary,
					...(accountPin.warning ? { warning: accountPin.warning } : {}),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		stopTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStopRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.stopTaskSession(body.taskId);
				if (clineSummary) {
					return {
						ok: true,
						summary: clineSummary,
					};
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = await terminalManager.stopTaskSession(body.taskId);
				return {
					ok: Boolean(summary),
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		pauseTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionPauseRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.pauseTaskSession(body.taskId);
				if (clineSummary) {
					return { ok: true, summary: clineSummary };
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.pauseTaskSession(body.taskId);
				if (!summary) {
					return { ok: false, summary: null, error: "Task session is not running." };
				}
				return { ok: true, summary };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, summary: null, error: message };
			}
		},
		resumeTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionPauseRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.resumeTaskSession(body.taskId);
				if (clineSummary) {
					return { ok: true, summary: clineSummary };
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.resumeTaskSession(body.taskId);
				if (!summary) {
					return { ok: false, summary: null, error: "Task session is not running." };
				}
				return { ok: true, summary };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, summary: null, error: message };
			}
		},
		sendTaskSessionInput: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionInputRequest(input);
				const payloadText = body.appendNewline ? `${body.text}\n` : body.text;
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.sendTaskSessionInput(body.taskId, payloadText);
				if (clineSummary) {
					return {
						ok: true,
						summary: clineSummary,
					};
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.writeInput(body.taskId, Buffer.from(payloadText, "utf8"));
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task session is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		stageTaskSessionPasteImages: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStagePasteImagesRequest(input);
				const paths = await writeTaskSessionPasteImages(body.taskId, body.images);
				return {
					ok: true,
					paths,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					paths: [],
					error: message,
				};
			}
		},
		getTaskChatMessages: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatMessagesRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = clineTaskSessionService.getSummary(body.taskId);
				const messages = await clineTaskSessionService.loadTaskSessionMessages(body.taskId);
				if (!summary && messages.length === 0) {
					return {
						ok: false,
						messages: [],
						error: "Task chat session is not available.",
					};
				}
				return {
					ok: true,
					messages,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					messages: [],
					error: message,
				};
			}
		},
		getClineSlashCommands: async (workspaceScope) => {
			if (!workspaceScope) {
				return {
					commands: [],
				};
			}
			const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
			return {
				commands: await clineTaskSessionService.listSlashCommands(workspaceScope.workspacePath),
			};
		},
		listSkillInventory: async (input) => {
			const workspaceId = input.workspaceId?.trim();
			if (!workspaceId) {
				return listClaudeSkillInventory();
			}
			const context = await loadWorkspaceContextById(workspaceId);
			if (!context) {
				return listClaudeSkillInventory();
			}
			const setting = await getWorkspaceLocalAssetsSetting(workspaceId);
			// Manager shelf installs land in `<repo>/.claude`; surface those ids even when
			// the project has not opted into loading its own local assets.
			const managerFeatures = await getWorkspaceManagerFeatures(workspaceId);
			return listClaudeSkillInventory(context.repoPath, {
				localAssetsEnabled: setting.enabled,
				roots: setting.roots,
				managerFeatures,
			});
		},
		getWorkspaceLocalAssets: async (input) => await getWorkspaceLocalAssetsSetting(input.workspaceId),
		setWorkspaceLocalAssets: async (input) =>
			setWorkspaceLocalAssets(input.workspaceId, {
				enabled: input.enabled,
				...(input.roots ? { roots: input.roots } : {}),
			}),
		listMcpInventory: async () => listClaudeMcpInventory(deps.flowiseClient ?? null),
		getClaudeOrgMcpPolicy: async () => {
			const policy = await readClaudeOrgMcpPolicy();
			return {
				detected: policy.detected,
				allowManagedMcpServersOnly: policy.allowManagedMcpServersOnly,
				organizationName: policy.organizationName,
				allowedServerNames: policy.allowedServerNames,
				allowedServerUrls: policy.allowedServerUrls,
				hints: policy.detected
					? [
							policy.allowManagedMcpServersOnly
								? "Org MCP allowlist active — flowise-* and unlisted servers are blocked on Claude Code cards."
								: "Org remote settings detected — Claude MCP is not restricted to IT allowlist only.",
						]
					: [],
			};
		},
		listAgentModels: async (input) => listAgentModelInventory(input.agentId),
		reloadTaskChatSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatReloadRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				let summary = await clineTaskSessionService.reloadTaskSession(body.taskId);
				if (!summary && isHomeAgentSessionId(body.taskId)) {
					const clineLaunchConfig = await clineProviderService.resolveLaunchConfig(
						toClineLaunchOverrides(body.clineSettings),
					);
					// Load the card to get taskLaunchSettings for subagent seat
					const workspaceState = await loadWorkspaceState(workspaceScope.workspacePath).catch(() => null);
					const card =
						workspaceState?.board.columns.flatMap((column) => column.cards).find((c) => c.id === body.taskId) ??
						null;
					summary = await clineTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: workspaceScope.workspacePath,
						prompt: "",
						resumeFromPersistence: true,
						providerId: clineLaunchConfig.providerId,
						seatProviderId: clineLaunchConfig.seatProviderId,
						modelId: clineLaunchConfig.modelId,
						apiKey: clineLaunchConfig.apiKey,
						baseUrl: clineLaunchConfig.baseUrl,
						reasoningEffort: clineLaunchConfig.reasoningEffort,
						taskLaunchSettings: card?.taskLaunchSettings,
						launchWarnings: clineLaunchConfig.warnings,
					});
				}
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session is not available.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		abortTaskChatTurn: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatAbortRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = await clineTaskSessionService.abortTaskSession(body.taskId);
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		cancelTaskChatTurn: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatCancelRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = await clineTaskSessionService.cancelTaskTurn(body.taskId);
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session turn is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		setTaskChatModel: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatModelRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const result = await clineTaskSessionService.setTaskSessionModel({
					taskId: body.taskId,
					modelId: body.modelId,
					seatProviderId: body.providerId ?? null,
				});
				if (!result.summary) {
					return {
						ok: false,
						summary: null,
						applied: false,
						error: "Task chat session is not available.",
					};
				}
				return {
					ok: true,
					summary: result.summary,
					applied: result.applied,
					warning: result.warning,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					applied: false,
					error: message,
				};
			}
		},
		getClineProviderCatalog: async (_workspaceScope) => {
			return await clineProviderService.getProviderCatalog();
		},
		getClineAccountProfile: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountProfile();
		},
		getClineKanbanAccess: async (_workspaceScope) => {
			return await clineProviderService.getClineKanbanAccess();
		},
		getFeaturebaseToken: async (_workspaceScope) => {
			return await clineProviderService.getFeaturebaseToken();
		},
		getClineAccountBalance: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountBalance();
		},
		getClineAccountOrganizations: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountOrganizations();
		},
		switchClineAccount: async (_workspaceScope, input) => {
			const body = parseClineAccountSwitchRequest(input);
			return await clineProviderService.switchClineAccount(body.organizationId);
		},
		getClineProviderModels: async (_workspaceScope, input) => {
			const body = parseClineProviderModelsRequest(input);
			return await clineProviderService.getProviderModels(body.providerId);
		},
		getClineMcpAuthStatuses: async (_workspaceScope) => {
			const statuses = await clineMcpRuntimeService.getAuthStatuses();
			return {
				statuses,
			};
		},
		runClineMcpServerOAuth: async (_workspaceScope, input) => {
			const body = parseClineMcpOAuthRequest(input);
			const response = await clineMcpRuntimeService.authorizeServer({
				serverName: body.serverName,
				onAuthorizationUrl: (url: string) => {
					openInBrowser(url);
				},
			});
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		getClineMcpSettings: async (_workspaceScope) => {
			return clineMcpSettingsService.loadSettings();
		},
		saveClineMcpSettings: async (_workspaceScope, input) => {
			const body = parseClineMcpSettingsSaveRequest(input);
			const response = await clineMcpSettingsService.saveSettings(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		runClineProviderOAuthLogin: async (_workspaceScope, input) => {
			const body = parseClineOauthLoginRequest(input);
			const response = await clineProviderService.runOauthLogin({
				providerId: body.provider,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpClineSessionContextVersion?.();
			}
			return response;
		},
		startClineDeviceAuth: async () => {
			return await clineProviderService.startDeviceAuth();
		},
		completeClineDeviceAuth: async (_workspaceScope, input) => {
			const body = parseClineDeviceAuthCompleteRequest(input);
			const response = await clineProviderService.completeDeviceAuth({
				deviceCode: body.deviceCode,
				expiresInSeconds: body.expiresInSeconds,
				pollIntervalSeconds: body.pollIntervalSeconds,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpClineSessionContextVersion?.();
			}
			return response;
		},
		sendTaskChatMessage: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatSendRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				if (isClineClearSlashCommand(body.text)) {
					const summary = await clineTaskSessionService.clearTaskSession(body.taskId);
					deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
					return {
						ok: true,
						summary,
						message: null,
					};
				}
				const requestedMode = body.mode;
				let summary = await clineTaskSessionService.sendTaskSessionInput(
					body.taskId,
					body.text,
					requestedMode,
					body.images,
				);
				if (!summary) {
					if (!isHomeAgentSessionId(body.taskId)) {
						const reboundSummary = await clineTaskSessionService.rebindPersistedTaskSession(body.taskId);
						if (reboundSummary) {
							summary = await clineTaskSessionService.sendTaskSessionInput(
								body.taskId,
								body.text,
								requestedMode,
								body.images,
							);
						}
						if (!summary) {
							return {
								ok: false,
								summary: null,
								error: "Task chat session is not running.",
							};
						}
					} else {
						const clineLaunchConfig = await clineProviderService.resolveLaunchConfig(
							toClineLaunchOverrides(body.clineSettings),
						);
						// Load the card to get taskLaunchSettings for subagent seat
						const workspaceState = await loadWorkspaceState(workspaceScope.workspacePath).catch(() => null);
						const card =
							workspaceState?.board.columns
								.flatMap((column) => column.cards)
								.find((c) => c.id === body.taskId) ?? null;
						summary = await clineTaskSessionService.startTaskSession({
							taskId: body.taskId,
							cwd: workspaceScope.workspacePath,
							prompt: body.text,
							images: body.images,
							resumeFromPersistence: true,
							providerId: clineLaunchConfig.providerId,
							seatProviderId: clineLaunchConfig.seatProviderId,
							modelId: clineLaunchConfig.modelId,
							mode: requestedMode,
							apiKey: clineLaunchConfig.apiKey,
							baseUrl: clineLaunchConfig.baseUrl,
							reasoningEffort: clineLaunchConfig.reasoningEffort,
							taskLaunchSettings: card?.taskLaunchSettings,
							launchWarnings: clineLaunchConfig.warnings,
						});
					}
				}
				const latestMessage = clineTaskSessionService.listMessages(body.taskId).at(-1) ?? null;
				return {
					ok: true,
					summary,
					message: latestMessage,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		startShellSession: async (workspaceScope, input) => {
			try {
				const body = parseShellSessionStartRequest(input);
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const shell = deps.resolveInteractiveShellCommand();
				const shellCwd = body.workspaceTaskId
					? await resolveTaskCwd({
							cwd: workspaceScope.workspacePath,
							taskId: body.workspaceTaskId,
							baseRef: body.baseRef,
							ensure: true,
						})
					: workspaceScope.workspacePath;
				const summary = await terminalManager.startShellSession({
					taskId: body.taskId,
					cwd: shellCwd,
					cols: body.cols,
					rows: body.rows,
					binary: shell.binary,
					args: shell.args,
				});
				return {
					ok: true,
					summary,
					shellBinary: shell.binary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					shellBinary: null,
					error: message,
				};
			}
		},
		runCommand: async (workspaceScope, input) => {
			try {
				const body = parseCommandRunRequest(input);
				return await deps.runCommand(body.command, workspaceScope.workspacePath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message,
				});
			}
		},
		resetAllState: async (_workspaceScope) => {
			await deps.prepareForStateReset?.();
			await Promise.all(
				debugResetTargetPaths.map(async (path) => {
					await rm(path, { recursive: true, force: true });
				}),
			);
			return {
				ok: true,
				clearedPaths: [...debugResetTargetPaths],
			};
		},
		openFile: async (input) => {
			const filePath = input.filePath.trim();
			if (!filePath) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "File path cannot be empty.",
				});
			}
			openInBrowser(filePath);
			return { ok: true };
		},
		getUpdateStatus: async () => {
			return deps.getUpdateStatus();
		},
		getHostEnvironment: async () => {
			return deps.getHostEnvironment();
		},
		runUpdateNow: async () => {
			return await deps.runUpdateNow();
		},
		getClaudeCacheStatus: async (input) => {
			return await getClaudeCacheStatus(input);
		},
		cleanClaudeCache: async (input) => {
			return await cleanClaudeCache(input);
		},
	};
}
