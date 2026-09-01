import { access, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type {
	RuntimeAgentId,
	RuntimeHookEvent,
	RuntimeTaskImage,
	RuntimeTaskLaunchSettings,
	RuntimeTaskSessionSummary,
} from "../core/api-contract";
import type { ClaudeLaunchPermissionSetting, GeminiLaunchModeSetting } from "../config/agent-launch-options";
import { buildKanbanCommandParts } from "../core/kanban-command";
import { quoteShellArg } from "../core/shell";
import { lockedFileSystem } from "../fs/locked-file-system";
import { CLAUDE_CONFIG_DIR_ENV } from "../manager/manager-account-pin";
import { resolveHomeAgentAppendSystemPrompt } from "../prompts/append-system-prompt";
import {
	getRuntimeHomePath,
	getWorkspaceLocalAssetsSetting,
	getWorkspaceManagerFeatures,
	loadWorkspaceContextById,
} from "../state/workspace-state";
import {
	claudePermissionModeArgs,
	readLastClaudePermissionMode,
	resolveClaudeLaunchPermissionMode,
} from "./claude-permission-mode";
import { configureCodexHooks, hasCodexConfigOverride } from "./codex-hook-config";
import { createHookRuntimeEnv } from "./hook-runtime-context";
import {
	getOpenCodeAuthPathCandidates,
	getOpenCodeConfigPathCandidates,
	getOpenCodeModelStatePathCandidates,
} from "./opencode-paths";
import {
	createCursorOutputTransitionDetector,
	cursorOutputTransitionInspection,
} from "./cursor-output-transition";
import { stripAnsi } from "./output-utils";
import type { SessionTransitionEvent } from "./session-state-machine";
import { prepareOrchestratorLaunch } from "../orchestrator/orchestrator-launch";
import { resolveSubagentSeatEnv } from "./subagent-seat-launch";
import { prepareProjectMcpConfig } from "./agent-mcp-launch";
import { prepareTaskPromptWithImages } from "./task-image-prompt";
import {
	applyModelAndEffortArgs,
	buildCursorLaunchTagPreface,
	hasAgentAllowlist,
	hasCommandAllowlist,
	hasManagerFeatureIds,
	hasMcpAllowlist,
	hasSkillAllowlist,
	hasWorkflowAllowlist,
	managerFeatureInventoryIds,
	prepareClaudeMcpAllowlistConfig,
	prepareClaudeSkillScopedConfigDir,
} from "./task-launch-settings";

export interface AgentAdapterLaunchInput {
	taskId: string;
	agentId: RuntimeAgentId;
	binary?: string;
	args: string[];
	autonomousModeEnabled?: boolean;
	configuredClaudePermissionMode?: ClaudeLaunchPermissionSetting;
	geminiLaunch?: {
		skipPermissions: boolean;
		mode: GeminiLaunchModeSetting;
	};
	cwd: string;
	prompt: string;
	images?: RuntimeTaskImage[];
	startInPlanMode?: boolean;
	resumeFromTrash?: boolean;
	/** Hydrate the CLI's own prior conversation via --continue on a normal (non-trash) start. */
	resumeFromPersistence?: boolean;
	env?: Record<string, string | undefined>;
	workspaceId?: string;
	taskLaunchSettings?: RuntimeTaskLaunchSettings;
}

export type AgentOutputTransitionDetector = (
	data: string,
	summary: RuntimeTaskSessionSummary,
) => SessionTransitionEvent | null;

export type AgentOutputTransitionInspectionPredicate = (summary: RuntimeTaskSessionSummary) => boolean;

export interface PreparedAgentLaunch {
	binary?: string;
	args: string[];
	env: Record<string, string | undefined>;
	cleanup?: () => Promise<void>;
	deferredStartupInput?: string;
	detectOutputTransition?: AgentOutputTransitionDetector;
	shouldInspectOutputForTransition?: AgentOutputTransitionInspectionPredicate;
}

interface HookContext {
	taskId: string;
	workspaceId: string;
}

interface HookCommandMetadata {
	source?: string;
	activityText?: string;
	hookEventName?: string;
	notificationType?: string;
}

interface AgentSessionAdapter {
	prepare(input: AgentAdapterLaunchInput): Promise<PreparedAgentLaunch>;
}

function escapeForTemplateLiteral(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

function powerShellQuote(value: string): string {
	return `"${value.replaceAll("`", "``").replaceAll('"', '`"')}"`;
}

function resolveHookContext(input: AgentAdapterLaunchInput): HookContext | null {
	const workspaceId = input.workspaceId?.trim();
	if (!workspaceId) {
		return null;
	}
	return {
		taskId: input.taskId,
		workspaceId,
	};
}

function buildHookCommand(event: RuntimeHookEvent, metadata?: HookCommandMetadata): string {
	const parts = buildHooksCommandParts(["ingest", "--event", event]);
	if (metadata?.source) {
		parts.push("--source", metadata.source);
	}
	if (metadata?.activityText) {
		parts.push("--activity-text", metadata.activityText);
	}
	if (metadata?.hookEventName) {
		parts.push("--hook-event-name", metadata.hookEventName);
	}
	if (metadata?.notificationType) {
		parts.push("--notification-type", metadata.notificationType);
	}
	return parts.map(quoteShellArg).join(" ");
}

function buildHooksCommandParts(args: string[]): string[] {
	return buildKanbanCommandParts(["hooks", ...args]);
}

function buildHooksCommand(args: string[]): string {
	return buildHooksCommandParts(args).map(quoteShellArg).join(" ");
}

function hasCliOption(args: string[], optionName: string): boolean {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === optionName || arg.startsWith(`${optionName}=`)) {
			return true;
		}
	}
	return false;
}

function getClineHookScriptPath(
	hooksDir: string,
	hookName: "Notification" | "TaskComplete" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse",
): string {
	if (process.platform === "win32") {
		return join(hooksDir, `${hookName}.ps1`);
	}
	return join(hooksDir, hookName);
}

function buildClineHookScriptContent(event: RuntimeHookEvent): string {
	const commandParts = buildHooksCommandParts(["notify", "--event", event, "--source", "cline"]);
	if (process.platform === "win32") {
		const command = commandParts.map(powerShellQuote).join(" ");
		return `$inputText = [Console]::In.ReadToEnd()
try {
  $inputText | & ${command} | Out-Null
} catch {
}
Write-Output '{"cancel":false}'
exit 0
`;
	}
	const command = commandParts.map(quoteShellArg).join(" ");
	return `#!/usr/bin/env bash
INPUT="$(cat || true)"
printf '%s' "$INPUT" | ${command} >/dev/null 2>&1 || true
echo '{"cancel":false}'
`;
}

function buildClineNotificationHookScriptContent(): string {
	const commandParts = buildHooksCommandParts(["notify", "--event", "to_review", "--source", "cline"]);
	if (process.platform === "win32") {
		const command = commandParts.map(powerShellQuote).join(" ");
		return `$inputText = [Console]::In.ReadToEnd()
if (
  $inputText -match '"event"\\s*:\\s*"user_attention"' -and
  $inputText -notmatch '"source"\\s*:\\s*"completion_result"'
) {
  try {
    $inputText | & ${command} | Out-Null
  } catch {
  }
}
Write-Output '{"cancel":false}'
exit 0
`;
	}
	const command = commandParts.map(quoteShellArg).join(" ");
	return `#!/usr/bin/env bash
INPUT="$(cat || true)"
if printf '%s' "$INPUT" | grep -Eq '"event"[[:space:]]*:[[:space:]]*"user_attention"' &&
  ! printf '%s' "$INPUT" | grep -Eq '"source"[[:space:]]*:[[:space:]]*"completion_result"'; then
  printf '%s' "$INPUT" | ${command} >/dev/null 2>&1 || true
fi
echo '{"cancel":false}'
`;
}

function buildClinePreToolUseHookScriptContent(): string {
	const activityCommand = buildHooksCommandParts(["notify", "--event", "activity", "--source", "cline"]);
	const reviewCommand = buildHooksCommandParts(["notify", "--event", "to_review", "--source", "cline"]);
	const inProgressCommand = buildHooksCommandParts(["notify", "--event", "to_in_progress", "--source", "cline"]);
	if (process.platform === "win32") {
		const activity = activityCommand.map(powerShellQuote).join(" ");
		const review = reviewCommand.map(powerShellQuote).join(" ");
		const inProgress = inProgressCommand.map(powerShellQuote).join(" ");
		return `$inputText = [Console]::In.ReadToEnd()
$isUserQuestionTool = $inputText -match '"(toolName|tool)"\\s*:\\s*"(ask_followup_question|plan_mode_respond)"'
try {
  $inputText | & ${activity} | Out-Null
} catch {
}
if ($isUserQuestionTool) {
  try {
    $inputText | & ${review} | Out-Null
  } catch {
  }
} else {
  try {
    $inputText | & ${inProgress} | Out-Null
  } catch {
  }
}
Write-Output '{"cancel":false}'
exit 0
`;
	}
	const activity = activityCommand.map(quoteShellArg).join(" ");
	const review = reviewCommand.map(quoteShellArg).join(" ");
	const inProgress = inProgressCommand.map(quoteShellArg).join(" ");
	return `#!/usr/bin/env bash
INPUT="$(cat || true)"
printf '%s' "$INPUT" | ${activity} >/dev/null 2>&1 || true
if printf '%s' "$INPUT" | grep -Eq '"(toolName|tool)"[[:space:]]*:[[:space:]]*"(ask_followup_question|plan_mode_respond)"'; then
  printf '%s' "$INPUT" | ${review} >/dev/null 2>&1 || true
else
  printf '%s' "$INPUT" | ${inProgress} >/dev/null 2>&1 || true
fi
echo '{"cancel":false}'
`;
}

function buildClinePostToolUseHookScriptContent(): string {
	const activityCommand = buildHooksCommandParts(["notify", "--event", "activity", "--source", "cline"]);
	const inProgressCommand = buildHooksCommandParts(["notify", "--event", "to_in_progress", "--source", "cline"]);
	if (process.platform === "win32") {
		const activity = activityCommand.map(powerShellQuote).join(" ");
		const inProgress = inProgressCommand.map(powerShellQuote).join(" ");
		return `$inputText = [Console]::In.ReadToEnd()
$isUserQuestionTool = $inputText -match '"(toolName|tool)"\\s*:\\s*"(ask_followup_question|plan_mode_respond)"'
try {
  $inputText | & ${activity} | Out-Null
} catch {
}
if ($isUserQuestionTool) {
  try {
    $inputText | & ${inProgress} | Out-Null
  } catch {
  }
}
Write-Output '{"cancel":false}'
exit 0
`;
	}
	const activity = activityCommand.map(quoteShellArg).join(" ");
	const inProgress = inProgressCommand.map(quoteShellArg).join(" ");
	return `#!/usr/bin/env bash
INPUT="$(cat || true)"
printf '%s' "$INPUT" | ${activity} >/dev/null 2>&1 || true
if printf '%s' "$INPUT" | grep -Eq '"(toolName|tool)"[[:space:]]*:[[:space:]]*"(ask_followup_question|plan_mode_respond)"'; then
  printf '%s' "$INPUT" | ${inProgress} >/dev/null 2>&1 || true
fi
echo '{"cancel":false}'
`;
}

function buildOpenCodePluginContent(
	reviewCommand: string,
	toInProgressCommand: string,
	activityCommand: string,
): string {
	const reviewCmd = escapeForTemplateLiteral(reviewCommand);
	const toInProgressCmd = escapeForTemplateLiteral(toInProgressCommand);
	const activityCmd = escapeForTemplateLiteral(activityCommand);
	return `export const KanbanPlugin = async ({ $, client }) => {
  if (globalThis.__kanbanOpencodePluginV3) return {};
  globalThis.__kanbanOpencodePluginV3 = true;

  if (!process?.env?.KANBAN_HOOK_TASK_ID) return {};

  let currentState = "idle";
  let rootSessionID = null;
  const childSessionCache = new Map();
  const messageRoleByID = new Map();
  const assistantTextByMessageID = new Map();
  const latestAssistantBySessionID = new Map();
  const toolInputByCallID = new Map();

  const asRecord = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  };

  const getMessageKey = (sessionID, messageID) => String(sessionID) + ":" + String(messageID);
  const getToolCallKey = (sessionID, callID) => String(sessionID) + ":" + String(callID);

  const encodePayload = (payload) => {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    try {
      return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    } catch {
      return "";
    }
  };

	const notify = async (kind, payload) => {
		try {
			const encoded = encodePayload(payload);
			if (kind === "review") {
				if (encoded) {
					await $\`${reviewCmd} --metadata-base64 \${encoded}\`;
				} else {
					await $\`${reviewCmd}\`;
				}
				return;
			}
			if (kind === "in_progress") {
				if (encoded) {
					await $\`${toInProgressCmd} --metadata-base64 \${encoded}\`;
				} else {
					await $\`${toInProgressCmd}\`;
				}
				return;
			}
			if (encoded) {
				await $\`${activityCmd} --metadata-base64 \${encoded}\`;
			} else {
				await $\`${activityCmd}\`;
			}
		} catch {
			// Best effort: hook errors should never break OpenCode event handling.
		}
	};

  const notifyReview = async (sessionID, payload = {}) => {
    const mergedPayload = {
      ...payload,
      last_assistant_message:
        typeof payload.last_assistant_message === "string"
          ? payload.last_assistant_message
          : (latestAssistantBySessionID.get(sessionID) ?? undefined),
    };
		await notify("review", mergedPayload);
  };

  const notifyInProgress = async (payload = {}) => {
		await notify("in_progress", payload);
  };

  const notifyActivity = async (payload = {}) => {
		await notify("activity", payload);
  };

  const isChildSession = async (sessionID) => {
    if (!sessionID) return true;
    if (!client?.session?.list) return true;
    if (childSessionCache.has(sessionID)) {
      return childSessionCache.get(sessionID);
    }
    try {
      const sessions = await client.session.list();
      const session = sessions.data?.find((candidate) => candidate.id === sessionID);
      const isChild = !!session?.parentID;
      childSessionCache.set(sessionID, isChild);
      return isChild;
    } catch {
      return true;
    }
  };

  const handleBusy = async (sessionID) => {
    if (!sessionID) {
      return;
    }
    if (!rootSessionID) {
      rootSessionID = sessionID;
    }
    if (sessionID !== rootSessionID) {
      return;
    }
    if (currentState === "idle") {
      currentState = "busy";
      await notifyInProgress({
        hook_event_name: "session.status",
      });
    }
  };

  const handleReview = async (sessionID, payload = {}, force = false) => {
    if (!sessionID) {
      return;
    }
    if (!rootSessionID) {
      rootSessionID = sessionID;
    }
    if (rootSessionID && sessionID !== rootSessionID) {
      return;
    }

    const shouldNotify = force || currentState === "busy";
    if (shouldNotify) {
      currentState = "idle";
      await notifyReview(sessionID, payload);
      rootSessionID = null;
    }
  };

  return {
    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = asRecord(event.properties?.info);
        const sessionID = typeof info?.sessionID === "string" ? info.sessionID : null;
        if (await isChildSession(sessionID)) {
          return;
        }

        const messageID = typeof info?.id === "string" ? info.id : null;
        const role = typeof info?.role === "string" ? info.role : null;
        if (messageID && role) {
          messageRoleByID.set(getMessageKey(sessionID, messageID), role);
          if (role === "assistant" && !assistantTextByMessageID.has(getMessageKey(sessionID, messageID))) {
            assistantTextByMessageID.set(getMessageKey(sessionID, messageID), "");
          }
        }
        return;
      }

      if (event.type === "message.part.updated") {
        const part = asRecord(event.properties?.part);
        if (!part) {
          return;
        }

        const sessionID = typeof part.sessionID === "string" ? part.sessionID : null;
        if (await isChildSession(sessionID)) {
          return;
        }

        if (part.type !== "text") {
          return;
        }

        const messageID = typeof part.messageID === "string" ? part.messageID : null;
        if (!messageID) {
          return;
        }

        const messageKey = getMessageKey(sessionID, messageID);
        if (messageRoleByID.get(messageKey) !== "assistant") {
          return;
        }

        const delta = typeof event.properties?.delta === "string" ? event.properties.delta : "";
        const fullText = typeof part.text === "string" ? part.text : "";
        const previousText = assistantTextByMessageID.get(messageKey) ?? "";
        const nextText = delta ? previousText + delta : (fullText || previousText);
        const normalized = nextText.trim();
        if (!normalized) {
          return;
        }

        assistantTextByMessageID.set(messageKey, normalized);
        latestAssistantBySessionID.set(sessionID, normalized);
        return;
      }

      const sessionID = event.properties?.sessionID;
      if (await isChildSession(sessionID)) {
        return;
      }

      if (event.type === "session.status") {
        const status = event.properties?.status;
        if (status?.type === "busy") {
          await handleBusy(sessionID);
        } else if (status?.type === "idle") {
          await handleReview(sessionID, {
            hook_event_name: "session.status",
          });
        }
      }

      if (event.type === "session.busy") {
        await handleBusy(sessionID);
      }
      if (event.type === "session.idle") {
        await handleReview(sessionID, {
          hook_event_name: "session.idle",
        });
      }
      if (event.type === "session.error") {
        await handleReview(
          sessionID,
          {
            hook_event_name: "session.error",
          },
          true,
        );
      }
    },
    "tool.execute.before": async (input, output) => {
      const sessionID = typeof input?.sessionID === "string" ? input.sessionID : null;
      if (await isChildSession(sessionID)) {
        return;
      }

      await handleBusy(sessionID);

      const toolName = typeof input?.tool === "string" ? input.tool : undefined;
      const callID = typeof input?.callID === "string" ? input.callID : "";
      const toolInput = asRecord(output?.args);
      if (callID) {
        toolInputByCallID.set(getToolCallKey(sessionID, callID), toolInput);
      }

      await notifyActivity({
        hook_event_name: "BeforeTool",
        tool_name: toolName,
        tool_input: toolInput ?? undefined,
      });
    },
    "tool.execute.after": async (input) => {
      const sessionID = typeof input?.sessionID === "string" ? input.sessionID : null;
      if (await isChildSession(sessionID)) {
        return;
      }

      const toolName = typeof input?.tool === "string" ? input.tool : undefined;
      const callID = typeof input?.callID === "string" ? input.callID : "";
      const toolInput = callID ? toolInputByCallID.get(getToolCallKey(sessionID, callID)) : null;
      if (callID) {
        toolInputByCallID.delete(getToolCallKey(sessionID, callID));
      }

      await notifyActivity({
        hook_event_name: "AfterTool",
        tool_name: toolName,
        tool_input: toolInput ?? undefined,
      });
    },
    "permission.ask": async (_permission, output) => {
      if (output?.status === "ask") {
        const sessionID = typeof _permission?.sessionID === "string" ? _permission.sessionID : null;
        if (await isChildSession(sessionID)) {
          return;
        }
        await handleReview(
          sessionID,
          {
            hook_event_name: "PermissionRequest",
            notification_type: "permission.asked",
          },
          true,
        );
      }
    },
  };
};
`;
}

function getHookAgentDirectory(agentId: RuntimeAgentId): string {
	return join(getRuntimeHomePath(), "hooks", agentId);
}

/** Session ids contain ":" (home-agent ids especially), which is illegal in Windows paths. */
function toSessionFileSlug(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "session";
}

const KIRO_KANBAN_AGENT_NAME = "kanban";

function getKiroAgentConfigPath(): string {
	return join(homedir(), ".kiro", "agents", `${KIRO_KANBAN_AGENT_NAME}.json`);
}

async function ensureTextFile(filePath: string, content: string, executable = false): Promise<void> {
	await lockedFileSystem.writeTextFileAtomic(filePath, content, {
		executable,
	});
}

async function readOptionalTextFile(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

function mergeCursorPromptWithHomeSystemPrompt(prompt: string, appendedSystemPrompt: string | null): string {
	if (!appendedSystemPrompt) {
		return prompt;
	}
	const trimmedPrompt = prompt.trim();
	if (!trimmedPrompt) {
		return appendedSystemPrompt;
	}
	return `${appendedSystemPrompt}\n\n# User Request\n\n${trimmedPrompt}`;
}

function removeCursorPlanModeConflicts(args: string[]): string[] {
	const filtered: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--force" || arg === "-f" || arg === "--yolo" || arg === "--plan") {
			continue;
		}
		if (arg === "--mode") {
			index += 1;
			continue;
		}
		if (arg.startsWith("--mode=")) {
			continue;
		}
		filtered.push(arg);
	}
	return filtered;
}

function withPrompt(args: string[], prompt: string, mode: "append" | "flag", flag?: string): PreparedAgentLaunch {
	const trimmed = prompt.trim();
	if (!trimmed) {
		return {
			args,
			env: {},
		};
	}
	if (mode === "flag" && flag) {
		args.push(flag, trimmed);
	} else {
		args.push(trimmed);
	}
	return {
		args,
		env: {},
	};
}

function toBracketedPasteSubmission(command: string): string {
	return `\u001b[200~${command}\u001b[201~\r`;
}

const claudeAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {
			FORCE_HYPERLINK: "1",
		};
		const launchCleanups: Array<() => Promise<void>> = [];
		const launchSettings = input.taskLaunchSettings;
		applyModelAndEffortArgs(args, launchSettings, { effortFlag: "--effort" });
		const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(input.taskId);
		// A caller-supplied `--continue` is a resume too, even without the resume flags.
		const resumesConversation = Boolean(
			input.resumeFromTrash || input.resumeFromPersistence || hasCliOption(args, "--continue"),
		);
		const hasExplicitModeArg =
			hasCliOption(args, "--permission-mode") || hasCliOption(args, "--dangerously-skip-permissions");
		// A resume replays the *original* start request, so without this the session re-enters
		// the configured default and loses a mode the user cycled into with shift+tab. Claude
		// Code never restores it on `--continue` — the flag is the only way back in.
		const recordedMode =
			resumesConversation && !hasExplicitModeArg
				? await readLastClaudePermissionMode({
						cwd: input.cwd,
						claudeConfigDir: input.env?.[CLAUDE_CONFIG_DIR_ENV],
					})
				: null;
		const permissionMode = resolveClaudeLaunchPermissionMode({
			recordedMode,
			startInPlanMode: input.startInPlanMode === true,
			autonomousModeEnabled: input.autonomousModeEnabled === true,
			configuredPermissionMode: input.configuredClaudePermissionMode,
			hasExplicitModeArg,
		});
		if (input.autonomousModeEnabled || permissionMode === "auto") {
			// Auto mode is gated behind this env var on Bedrock/Vertex/Foundry; the Anthropic API ignores it.
			env.CLAUDE_CODE_ENABLE_AUTO_MODE = "1";
		}
		if ((input.resumeFromTrash || input.resumeFromPersistence) && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}
		if (permissionMode !== null) {
			if (permissionMode !== "bypassPermissions") {
				// Any prompting mode is contradicted by an immediate bypass flag, so the flag goes.
				const withoutImmediateBypass = args.filter((arg) => arg !== "--dangerously-skip-permissions");
				args.length = 0;
				args.push(...withoutImmediateBypass);
			}
			args.push(...claudePermissionModeArgs(permissionMode));
		}

		const skillAllowlist = hasSkillAllowlist(launchSettings);
		const agentAllowlist = hasAgentAllowlist(launchSettings);
		const commandAllowlist = hasCommandAllowlist(launchSettings);
		const workflowAllowlist = hasWorkflowAllowlist(launchSettings);
		const mcpAllowlist = hasMcpAllowlist(launchSettings);
		// Project `.agent/*` assets (and workflows) are only bridged when the workspace
		// has local assets enabled — the card only surfaces project items in that case,
		// but the bridge keys off ids + repoPath, so gate here too to avoid pulling a
		// disabled project's `.agent/*` into the scoped dir.
		const workspaceId = input.workspaceId?.trim();
		const localAssetsEnabled = workspaceId
			? (await getWorkspaceLocalAssetsSetting(workspaceId)).enabled
			: false;
		const bridgeProjectAssets = localAssetsEnabled && Boolean(input.cwd?.trim());
		// Manager installs live in the attached repo's `.claude`, not in the task
		// worktree (they are untracked there), so bridge them from the repo path.
		// Only skills/agents/commands are bridgeable — `knowledge/rules` writes into
		// CLAUDE.md and `hooks/*` are machine-wide, so neither needs a scoped dir.
		const managerFeatures = workspaceId ? await getWorkspaceManagerFeatures(workspaceId) : [];
		const managerRepoPath =
			workspaceId && hasManagerFeatureIds(managerFeatureInventoryIds(managerFeatures))
				? ((await loadWorkspaceContextById(workspaceId))?.repoPath ?? null)
				: null;
		// Any allowlist needs a task-scoped CLAUDE_CONFIG_DIR so we can keep CC
		// credentials/onboarding while filtering skills/agents/commands and
		// stripping mcpServers from settings.json (otherwise Claude still
		// discovers every global Manager install / MCP). A workflow-only selection
		// only needs the scoped dir when its project assets are actually bridged.
		// A recorded Manager intent is on its own enough: the install lives in the
		// repo's `.claude` and is untracked in the task worktree, so without the scoped
		// dir it never reaches the session — enabling the feature for the project *is*
		// the opt-in, no card allowlist required.
		const needsScopedConfig =
			skillAllowlist ||
			agentAllowlist ||
			commandAllowlist ||
			mcpAllowlist ||
			managerRepoPath !== null ||
			(workflowAllowlist && bridgeProjectAssets);
		if (needsScopedConfig) {
			const scoped = await prepareClaudeSkillScopedConfigDir({
				taskId: input.taskId,
				skillIds: skillAllowlist ? launchSettings?.skillIds : undefined,
				agentIds: agentAllowlist ? launchSettings?.agentIds : undefined,
				commandIds: commandAllowlist ? launchSettings?.commandIds : undefined,
				mcpServerIds: mcpAllowlist ? launchSettings?.mcpServerIds : undefined,
				repoPath: bridgeProjectAssets ? input.cwd : undefined,
				workflowIds: bridgeProjectAssets && workflowAllowlist ? launchSettings?.workflowIds : undefined,
				...(managerRepoPath ? { managerRepoPath, managerFeatures } : {}),
				baseConfigDir: input.env?.[CLAUDE_CONFIG_DIR_ENV] ?? null,
			});
			env[CLAUDE_CONFIG_DIR_ENV] = scoped.configDir;
			launchCleanups.push(scoped.cleanup);
		}

		// Subagent seat: routes only the session's subagent turns onto an API seat, leaving
		// the parent on whatever seat the card already resolved. Degrades to "no split"
		// rather than blocking the launch — see `resolveSubagentSeatEnv`.
		const subagentSeatEnv = await resolveSubagentSeatEnv(launchSettings, {
			warn: (message) => {
				console.warn(`[kanban] ${message}`);
			},
			log: (message) => {
				console.log(`[kanban] ${message}`);
			},
		});
		if (subagentSeatEnv) {
			// ANTHROPIC_API_KEY is deliberately not set: Claude Code falls back to it instead
			// of its OAuth credential, which would move the *parent* off the card's seat too.
			env.ANTHROPIC_BASE_URL = subagentSeatEnv.ANTHROPIC_BASE_URL;
			env.CLAUDE_CODE_SUBAGENT_MODEL = subagentSeatEnv.CLAUDE_CODE_SUBAGENT_MODEL;
		}

		if (mcpAllowlist && launchSettings?.mcpServerIds) {
			const mcpConfig = await prepareClaudeMcpAllowlistConfig({
				taskId: input.taskId,
				mcpServerIds: launchSettings.mcpServerIds,
			});
			if (mcpConfig && !hasCliOption(args, "--mcp-config")) {
				args.push("--mcp-config", mcpConfig.mcpConfigPath, "--strict-mcp-config");
				launchCleanups.push(mcpConfig.cleanup);
			}
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const settingsPath = join(getHookAgentDirectory("claude"), "settings.json");
			const hooksSettings = {
				hooks: {
					Stop: [{ hooks: [{ type: "command", command: buildHookCommand("to_review", { source: "claude" }) }] }],
					SubagentStop: [
						{ hooks: [{ type: "command", command: buildHookCommand("activity", { source: "claude" }) }] },
					],
					PreToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("activity", { source: "claude" }) }],
						},
					],
					PermissionRequest: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("to_review", { source: "claude" }) }],
						},
					],
					PostToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("to_in_progress", { source: "claude" }) }],
						},
					],
					PostToolUseFailure: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("to_in_progress", { source: "claude" }) }],
						},
					],
					Notification: [
						{
							matcher: "permission_prompt",
							hooks: [{ type: "command", command: buildHookCommand("to_review", { source: "claude" }) }],
						},
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("activity", { source: "claude" }) }],
						},
					],
					UserPromptSubmit: [
						{
							hooks: [{ type: "command", command: buildHookCommand("to_in_progress", { source: "claude" }) }],
						},
					],
				},
			};
			await ensureTextFile(settingsPath, JSON.stringify(hooksSettings, null, 2));
			args.push("--settings", settingsPath);
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
		}

		let cleanupAppendedPromptFile: (() => Promise<void>) | null = null;
		if (
			appendedSystemPrompt &&
			!hasCliOption(args, "--append-system-prompt") &&
			!hasCliOption(args, "--append-system-prompt-file") &&
			!hasCliOption(args, "--system-prompt")
		) {
			// The sidebar-agent prompt is ~14k characters. Inlined, it produces a command
			// line far past cmd.exe's 8191-character limit on Windows, so the launch dies
			// with "The command line is too long." before Claude Code ever starts. Passing
			// it by file keeps the command line short on every platform.
			const promptPath = join(
				getHookAgentDirectory("claude"),
				`append-system-prompt-${toSessionFileSlug(input.taskId)}.md`,
			);
			await ensureTextFile(promptPath, appendedSystemPrompt);
			args.push("--append-system-prompt-file", promptPath);
			cleanupAppendedPromptFile = async () => {
				// Best effort: a leftover prompt file is harmless and gets overwritten.
				await rm(promptPath, { force: true }).catch(() => {});
			};
		}

		const withPromptLaunch = withPrompt(args, input.prompt, "append");
		const promptFileCleanup = cleanupAppendedPromptFile;
		const existingCleanup = withPromptLaunch.cleanup;
		// A skill-scoped dir (set above) wins, then whatever seat the card resolved to
		// (`input.env`), and only an unpinned session falls through to `$HOME/.claude.json`.
		// Reading `env` alone missed the pinned-seat case entirely, so trust was written to
		// the one file that session would not read.
		await ensureClaudeTrustedFolder(
			input.cwd,
			env[CLAUDE_CONFIG_DIR_ENV] ?? input.env?.[CLAUDE_CONFIG_DIR_ENV] ?? null,
		);

		const runCleanups = async () => {
			await existingCleanup?.();
			await promptFileCleanup?.();
			for (const cleanup of launchCleanups) {
				await cleanup();
			}
		};
		return {
			...withPromptLaunch,
			env: {
				...withPromptLaunch.env,
				...env,
			},
			cleanup: runCleanups,
		};
	},
};

function codexPromptDetector(data: string, summary: RuntimeTaskSessionSummary): SessionTransitionEvent | null {
	if (summary.state !== "awaiting_review") {
		return null;
	}
	if (summary.reviewReason !== "attention" && summary.reviewReason !== "hook") {
		return null;
	}
	const stripped = stripAnsi(data);
	if (/(?:^|\n)\s*›/.test(stripped)) {
		return { type: "agent.prompt-ready" };
	}
	return null;
}

function shouldInspectCodexOutputForTransition(summary: RuntimeTaskSessionSummary): boolean {
	return (
		summary.state === "awaiting_review" &&
		(summary.reviewReason === "attention" || summary.reviewReason === "hook" || summary.reviewReason === "error")
	);
}

const codexAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const codexArgs = [...input.args];
		const env: Record<string, string | undefined> = {};
		const binary = input.binary;
		let deferredStartupInput: string | undefined;
		const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(input.taskId);

		if (!hasCodexConfigOverride(codexArgs, "check_for_update_on_startup")) {
			codexArgs.push("-c", "check_for_update_on_startup=false");
		}

		if (input.autonomousModeEnabled && !hasCliOption(codexArgs, "--dangerously-bypass-approvals-and-sandbox")) {
			codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
		}

		if (input.resumeFromTrash) {
			if (!codexArgs.includes("resume")) {
				codexArgs.push("resume");
			}
			if (!hasCliOption(codexArgs, "--last")) {
				codexArgs.push("--last");
			}
		}

		if (appendedSystemPrompt && !hasCodexConfigOverride(codexArgs, "developer_instructions")) {
			codexArgs.push("-c", `developer_instructions=${JSON.stringify(appendedSystemPrompt)}`);
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			configureCodexHooks(codexArgs);
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
		}

		const trimmed = input.prompt.trim();
		if (input.startInPlanMode) {
			const planCommand = trimmed ? `/plan ${trimmed}` : "/plan";
			deferredStartupInput = toBracketedPasteSubmission(planCommand);
		} else if (trimmed) {
			codexArgs.push(trimmed);
		}

		if (hooks) {
			return {
				binary,
				args: codexArgs,
				env,
				deferredStartupInput,
				detectOutputTransition: codexPromptDetector,
				shouldInspectOutputForTransition: shouldInspectCodexOutputForTransition,
			};
		}

		return {
			binary,
			args: codexArgs,
			env,
			deferredStartupInput,
			detectOutputTransition: codexPromptDetector,
			shouldInspectOutputForTransition: shouldInspectCodexOutputForTransition,
		};
	},
};

interface ClaudeProjectTrustEntry {
	hasTrustDialogAccepted?: boolean;
	hasCompletedProjectOnboarding?: boolean;
	projectOnboardingSeenCount?: number;
}

interface ClaudeConfigFile {
	projects?: Record<string, ClaudeProjectTrustEntry | undefined>;
	[key: string]: unknown;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/**
 * Pre-accepts Claude Code's folder-trust prompt for `cwd` so a task session does not
 * stall on it.
 *
 * Writes exactly ONE file: the config the session will actually launch with. Touching
 * `$HOME/.claude.json` *in addition* to a pinned seat's copy was pure risk — that file is
 * Claude Code's live config and it rewrites the whole thing continuously, so a
 * read-modify-write races the user's own running sessions and an atomic replace built
 * from a stale read silently drops whatever landed in between (history, MCP config,
 * onboarding state). The seat dir is the file the CLI reads, so the home write had no
 * effect there anyway.
 */
async function ensureClaudeTrustedFolder(cwd: string, configDir?: string | null): Promise<void> {
	const targetPath = cwd?.trim();
	if (!targetPath) {
		return;
	}
	const scopedConfigDir = configDir?.trim();
	const configPath = join(scopedConfigDir ? scopedConfigDir : homedir(), ".claude.json");
	try {
		// One lock spanning read *and* write: two task launches racing each other would
		// otherwise each write from its own pre-read snapshot and lose the other's entry.
		await lockedFileSystem.withLock({ path: configPath, type: "file" }, async () => {
			const raw = await readOptionalTextFile(configPath);
			const current = (raw === null ? null : asPlainObject(JSON.parse(raw) as unknown)) ?? {};
			const projects = (asPlainObject(current.projects) as ClaudeConfigFile["projects"]) ?? {};
			const existing = projects[targetPath] ?? {};
			if (existing.hasTrustDialogAccepted === true && existing.hasCompletedProjectOnboarding === true) {
				return;
			}
			const next: ClaudeConfigFile = {
				...current,
				projects: {
					...projects,
					[targetPath]: {
						...existing,
						hasTrustDialogAccepted: true,
						hasCompletedProjectOnboarding: true,
						projectOnboardingSeenCount: Math.max(existing.projectOnboardingSeenCount ?? 0, 1),
					},
				},
			};
			// The lock is already held for this path — re-locking it here would deadlock.
			await lockedFileSystem.writeTextFileAtomic(configPath, JSON.stringify(next, null, 2), { lock: null });
		});
	} catch {
		// Best effort: failure to pre-accept trust should not block CLI startup.
	}
}

async function ensureGeminiTrustedFolder(cwd: string): Promise<void> {
	const targetPath = cwd?.trim();
	if (!targetPath) {
		return;
	}
	try {
		const trustedFoldersPath = join(homedir(), ".gemini", "trustedFolders.json");
		let current: Record<string, string> = {};
		try {
			const raw = await readFile(trustedFoldersPath, "utf8");
			current = JSON.parse(raw) as Record<string, string>;
		} catch {
			current = {};
		}
		let changed = false;
		if (current[targetPath] !== "TRUST_FOLDER") {
			current[targetPath] = "TRUST_FOLDER";
			changed = true;
		}
		for (const [folder, status] of Object.entries(current)) {
			if (status === "DO_NOT_TRUST" && (targetPath === folder || targetPath.startsWith(folder.endsWith("/") ? folder : `${folder}/`))) {
				current[folder] = "TRUST_FOLDER";
				changed = true;
			}
		}
		if (changed) {
			await ensureTextFile(trustedFoldersPath, JSON.stringify(current, null, 2));
		}
	} catch {
		// Best effort: failure to update trustedFolders should not block CLI startup
	}
}

const geminiAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};
		const launchSettings = input.taskLaunchSettings;
		applyModelAndEffortArgs(args, launchSettings, {
			effortFlag: "--effort",
			allowedEfforts: ["low", "medium", "high"],
		});

		// Gemini and Antigravity both keep folder trust in `~/.gemini/trustedFolders.json`
		// (agy's own state lives under `~/.gemini/antigravity-cli/`). Neither reads
		// `~/.claude.json`, so writing it here only put the user's live Claude Code config
		// at risk for no gain.
		await ensureGeminiTrustedFolder(input.cwd);

		const binaryPath = input.binary ?? "";
		const isAgy =
			binaryPath === "agy" ||
			binaryPath === "antigravity" ||
			binaryPath.endsWith("/agy") ||
			binaryPath.endsWith("/antigravity");

		if (isAgy) {
			// Translate any explicit or preset --yolo flag to agy's native YOLO mode
			const yoloIdx = args.indexOf("--yolo");
			if (yoloIdx !== -1) {
				args.splice(yoloIdx, 1);
				if (!hasCliOption(args, "--dangerously-skip-permissions")) {
					args.push("--dangerously-skip-permissions");
				}
				if (!hasCliOption(args, "--mode")) {
					args.push("--mode", "accept-edits");
				}
			}
		}

		if (input.startInPlanMode) {
			const withoutBypass = args.filter(
				(arg) => arg !== "--dangerously-skip-permissions" && arg !== "--yolo" && arg !== "-y",
			);
			args.length = 0;
			args.push(...withoutBypass);
			if (isAgy) {
				if (!hasCliOption(args, "--mode")) {
					args.push("--mode", "plan");
				}
			} else {
				if (!hasCliOption(args, "--approval-mode")) {
					args.push("--approval-mode=plan");
				}
			}
		} else if (isAgy) {
			const geminiLaunch = input.geminiLaunch ?? {
				skipPermissions: input.autonomousModeEnabled === true,
				mode: "accept-edits" as const,
			};
			if (geminiLaunch.skipPermissions && !hasCliOption(args, "--dangerously-skip-permissions")) {
				args.push("--dangerously-skip-permissions");
			}
			if (geminiLaunch.mode === "accept-edits" && !hasCliOption(args, "--mode")) {
				args.push("--mode", "accept-edits");
			} else if (geminiLaunch.mode === "plan" && !hasCliOption(args, "--mode")) {
				args.push("--mode", "plan");
			}
		} else if (input.autonomousModeEnabled) {
			if (!hasCliOption(args, "--yolo") && !hasCliOption(args, "-y")) {
				args.push("--yolo");
			}
		}

		const isResuming = Boolean(input.resumeFromTrash || input.resumeFromPersistence);
		if (
			isResuming &&
			!hasCliOption(args, "--continue") &&
			!hasCliOption(args, "-c") &&
			!hasCliOption(args, "--resume") &&
			!hasCliOption(args, "-r")
		) {
			if (isAgy) {
				args.push("--continue");
			} else {
				args.push("--resume", "latest");
			}
		}

		if (isAgy && launchSettings?.agentIds && launchSettings.agentIds.length > 0 && !hasCliOption(args, "--agent")) {
			const selectedAgent = launchSettings.agentIds[0];
			if (selectedAgent) {
				args.push("--agent", selectedAgent);
			}
		}

		const launchCleanups: Array<() => Promise<void>> = [];
		const mcpAllowlist = hasMcpAllowlist(launchSettings);
		if (mcpAllowlist && launchSettings?.mcpServerIds) {
			const mcpConfig = await prepareProjectMcpConfig({
				cwd: input.cwd,
				mcpServerIds: launchSettings.mcpServerIds,
				format: "gemini",
				warn: (message) => {
					console.warn(`[kanban] ${message}`);
				},
			});
			if (mcpConfig) {
				launchCleanups.push(mcpConfig.cleanup);
			}
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const configPath = join(getHookAgentDirectory("gemini"), "settings.json");
			const geminiHookCommand = buildHooksCommand(["gemini-hook"]);

			const config = {
				hooks: {
					BeforeTool: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
					AfterTool: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
					AfterAgent: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
					BeforeAgent: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
					Notification: [
						{
							hooks: [{ type: "command", command: geminiHookCommand }],
						},
					],
				},
			};
			await ensureTextFile(configPath, JSON.stringify(config, null, 2));
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
			env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = configPath;
		}

		const trimmed = input.prompt.trim();
		if (trimmed && !isResuming) {
			args.push("-i", trimmed);
			return {
				args,
				env,
				cleanup:
					launchCleanups.length > 0
						? async () => {
								for (const fn of launchCleanups) {
									await fn();
								}
							}
						: undefined,
			};
		}

		return {
			args,
			env,
			cleanup:
				launchCleanups.length > 0
					? async () => {
							for (const fn of launchCleanups) {
								await fn();
							}
						}
					: undefined,
		};
	},
};

async function resolveOpenCodeBaseConfigPath(explicitPath: string | undefined): Promise<string | null> {
	const candidates = getOpenCodeConfigPathCandidates({ explicitPath });
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Keep searching.
		}
	}
	return null;
}

function hasOpenCodeModelArg(args: string[]): boolean {
	for (const arg of args) {
		if (arg === "--model" || arg === "-m") {
			return true;
		}
		if (arg.startsWith("--model=") || arg.startsWith("-m=")) {
			return true;
		}
	}
	return false;
}

function hasOpenCodeAgentArg(args: string[]): boolean {
	for (const arg of args) {
		if (arg === "--agent") {
			return true;
		}
		if (arg.startsWith("--agent=")) {
			return true;
		}
	}
	return false;
}

function normalizeOpenCodeModel(providerId: string, modelId: string): string {
	if (modelId.startsWith(`${providerId}/`)) {
		return modelId;
	}
	return `${providerId}/${modelId}`;
}

function stripJsonComments(input: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < input.length; i += 1) {
		const current = input[i];
		const next = i + 1 < input.length ? input[i + 1] : "";

		if (inLineComment) {
			if (current === "\n") {
				inLineComment = false;
				output += current;
			}
			continue;
		}
		if (inBlockComment) {
			if (current === "*" && next === "/") {
				inBlockComment = false;
				i += 1;
			}
			continue;
		}
		if (!inString && current === "/" && next === "/") {
			inLineComment = true;
			i += 1;
			continue;
		}
		if (!inString && current === "/" && next === "*") {
			inBlockComment = true;
			i += 1;
			continue;
		}

		output += current;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (current === "\\") {
				escaped = true;
			} else if (current === '"') {
				inString = false;
			}
			continue;
		}
		if (current === '"') {
			inString = true;
		}
	}
	return output;
}

function tryExtractOpenCodeModelFromConfig(rawConfig: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawConfig);
	} catch {
		try {
			parsed = JSON.parse(stripJsonComments(rawConfig));
		} catch {
			return null;
		}
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const root = parsed as Record<string, unknown>;

	const directModel = root.model;
	if (typeof directModel === "string" && directModel.trim()) {
		return directModel.trim();
	}

	const mode = root.mode;
	if (mode && typeof mode === "object" && !Array.isArray(mode)) {
		const build = (mode as Record<string, unknown>).build;
		if (build && typeof build === "object" && !Array.isArray(build)) {
			const model = (build as Record<string, unknown>).model;
			if (typeof model === "string" && model.trim()) {
				return model.trim();
			}
		}
	}

	const agent = root.agent;
	if (agent && typeof agent === "object" && !Array.isArray(agent)) {
		const build = (agent as Record<string, unknown>).build;
		if (build && typeof build === "object" && !Array.isArray(build)) {
			const model = (build as Record<string, unknown>).model;
			if (typeof model === "string" && model.trim()) {
				return model.trim();
			}
		}
	}

	return null;
}

async function resolveOpenCodePreferredModelArg(configPath: string | null): Promise<string | null> {
	if (configPath) {
		try {
			const rawConfig = await readFile(configPath, "utf8");
			const modelFromConfig = tryExtractOpenCodeModelFromConfig(rawConfig);
			if (modelFromConfig) {
				return modelFromConfig;
			}
		} catch {
			// Fall through to state-based fallback.
		}
	}

	const modelStateCandidates = getOpenCodeModelStatePathCandidates();
	let recentModels: Array<{ providerID?: unknown; modelID?: unknown }> = [];
	for (const modelStatePath of modelStateCandidates) {
		try {
			const raw = await readFile(modelStatePath, "utf8");
			const parsed = JSON.parse(raw) as { recent?: Array<{ providerID?: unknown; modelID?: unknown }> };
			if (Array.isArray(parsed.recent)) {
				recentModels = parsed.recent;
				break;
			}
		} catch {
			// Keep searching through candidate state paths.
		}
	}
	if (recentModels.length === 0) {
		return null;
	}

	const configuredProviders = new Set<string>();
	for (const authPath of getOpenCodeAuthPathCandidates()) {
		try {
			const raw = await readFile(authPath, "utf8");
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			for (const [provider, value] of Object.entries(parsed)) {
				if (!value || typeof value !== "object" || Array.isArray(value)) {
					continue;
				}
				const key = (value as Record<string, unknown>).key;
				if (typeof key === "string" && key.trim()) {
					configuredProviders.add(provider);
				}
			}
			break;
		} catch {
			// Keep searching through candidate auth paths.
		}
	}

	const candidates: Array<{ providerId: string; model: string }> = [];
	for (const entry of recentModels) {
		const providerId = typeof entry.providerID === "string" ? entry.providerID.trim() : "";
		const modelId = typeof entry.modelID === "string" ? entry.modelID.trim() : "";
		if (!providerId || !modelId) {
			continue;
		}
		candidates.push({ providerId, model: normalizeOpenCodeModel(providerId, modelId) });
	}
	if (candidates.length === 0) {
		return null;
	}

	const preferredProviderOrder = ["openrouter", "anthropic", "openai", "opencode", "google", "amazon-bedrock"];
	for (const providerId of preferredProviderOrder) {
		const match = candidates.find((candidate) => candidate.providerId === providerId);
		if (!match) {
			continue;
		}
		if (configuredProviders.size === 0 || configuredProviders.has(providerId)) {
			return match.model;
		}
	}

	const configuredMatch = candidates.find((candidate) => configuredProviders.has(candidate.providerId));
	if (configuredMatch) {
		return configuredMatch.model;
	}

	return candidates[0].model;
}

const opencodeAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};
		const baseConfigPath = await resolveOpenCodeBaseConfigPath(input.env?.OPENCODE_CONFIG);
		if (input.resumeFromTrash && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}

		if (input.startInPlanMode) {
			env.OPENCODE_EXPERIMENTAL_PLAN_MODE = "true";
			if (!hasOpenCodeAgentArg(args)) {
				args.push("--agent", "plan");
			}
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const pluginPath = join(getHookAgentDirectory("opencode"), "kanban.js");
			const configPath = join(getHookAgentDirectory("opencode"), "opencode.json");

			const pluginContent = buildOpenCodePluginContent(
				buildHookCommand("to_review", { source: "opencode" }),
				buildHookCommand("to_in_progress", { source: "opencode" }),
				buildHookCommand("activity", { source: "opencode" }),
			);
			await ensureTextFile(pluginPath, pluginContent);
			const pluginFileUrl = pathToFileURL(pluginPath).href;
			const config = {
				plugin: [pluginFileUrl],
			};
			await ensureTextFile(configPath, JSON.stringify(config));
			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
			env.OPENCODE_CONFIG = configPath;
		}

		// Workaround: with --prompt, OpenCode can pick an unexpected provider/model.
		// Explicitly pass the user's preferred model so prompt runs stay on their usual provider.
		if (!hasOpenCodeModelArg(args)) {
			const preferredModel = await resolveOpenCodePreferredModelArg(baseConfigPath);
			if (preferredModel) {
				args.push("--model", preferredModel);
			}
		}

		const trimmed = input.prompt.trim();
		if (trimmed) {
			args.push("--prompt", trimmed);
			return {
				args,
				env,
			};
		}

		return {
			args,
			env,
		};
	},
};

const droidAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};

		if (input.resumeFromTrash && !hasCliOption(args, "--resume") && !hasCliOption(args, "-r")) {
			args.push("--resume");
		}

		const hooks = resolveHookContext(input);
		const shouldWriteSettings = Boolean(hooks) || input.startInPlanMode || input.autonomousModeEnabled !== undefined;
		if (shouldWriteSettings) {
			const settingsPath = join(getHookAgentDirectory("droid"), "settings.json");
			const settings: Record<string, unknown> = {
				autonomyMode: input.startInPlanMode ? "spec" : input.autonomousModeEnabled ? "auto-high" : "normal",
			};

			if (hooks) {
				const droidActiveToolMatcher = "Read|Grep|Glob|FetchUrl|WebSearch|Execute|Task|Edit|Create";
				const reviewNotifyCommand = buildHooksCommand(["notify", "--event", "to_review", "--source", "droid"]);
				const inProgressNotifyCommand = buildHooksCommand([
					"notify",
					"--event",
					"to_in_progress",
					"--source",
					"droid",
				]);
				const activityNotifyCommand = buildHooksCommand(["notify", "--event", "activity", "--source", "droid"]);
				settings.hooks = {
					Stop: [{ hooks: [{ type: "command", command: reviewNotifyCommand }] }],
					Notification: [
						{ hooks: [{ type: "command", command: activityNotifyCommand }] },
						{ hooks: [{ type: "command", command: reviewNotifyCommand }] },
					],
					PreToolUse: [
						{ matcher: "*", hooks: [{ type: "command", command: activityNotifyCommand }] },
						{ matcher: droidActiveToolMatcher, hooks: [{ type: "command", command: inProgressNotifyCommand }] },
						{ matcher: "AskUser", hooks: [{ type: "command", command: reviewNotifyCommand }] },
					],
					PostToolUse: [
						{ matcher: "*", hooks: [{ type: "command", command: activityNotifyCommand }] },
						{ matcher: "AskUser", hooks: [{ type: "command", command: inProgressNotifyCommand }] },
					],
					PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: activityNotifyCommand }] }],
					UserPromptSubmit: [{ hooks: [{ type: "command", command: inProgressNotifyCommand }] }],
				};

				Object.assign(
					env,
					createHookRuntimeEnv({
						taskId: hooks.taskId,
						workspaceId: hooks.workspaceId,
					}),
				);
			}

			await ensureTextFile(settingsPath, JSON.stringify(settings, null, 2));
			if (!hasCliOption(args, "--settings")) {
				args.push("--settings", settingsPath);
			}
		}

		const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(input.taskId);
		if (
			appendedSystemPrompt &&
			!hasCliOption(args, "--append-system-prompt") &&
			!hasCliOption(args, "--system-prompt")
		) {
			args.push("--append-system-prompt", appendedSystemPrompt);
		}

		const withPromptLaunch = withPrompt(args, input.prompt, "append");
		return {
			...withPromptLaunch,
			env: {
				...withPromptLaunch.env,
				...env,
			},
		};
	},
};

const kiroAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};

		if (input.autonomousModeEnabled && !hasCliOption(args, "--trust-all-tools")) {
			args.push("--trust-all-tools");
		}

		if (input.resumeFromTrash && !hasCliOption(args, "--resume") && !hasCliOption(args, "-r")) {
			args.push("--resume");
		}

		const hooks = resolveHookContext(input);
		const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(input.taskId);
		if (hooks || appendedSystemPrompt) {
			const configPath = getKiroAgentConfigPath();
			const config: Record<string, unknown> = {
				name: KIRO_KANBAN_AGENT_NAME,
				description: "Kanban-managed Kiro agent with hook forwarding.",
				tools: ["*"],
			};

			if (hooks) {
				config.hooks = {
					agentSpawn: [
						{
							command: buildHookCommand("to_in_progress", {
								source: "kiro",
								hookEventName: "agentSpawn",
							}),
						},
					],
					userPromptSubmit: [
						{
							command: buildHookCommand("to_in_progress", {
								source: "kiro",
								hookEventName: "userPromptSubmit",
							}),
						},
					],
					preToolUse: [
						{
							command: buildHookCommand("activity", {
								source: "kiro",
								hookEventName: "preToolUse",
							}),
						},
						{
							command: buildHookCommand("to_in_progress", {
								source: "kiro",
								hookEventName: "preToolUse",
							}),
						},
					],
					postToolUse: [
						{
							command: buildHookCommand("activity", {
								source: "kiro",
								hookEventName: "postToolUse",
							}),
						},
					],
					stop: [
						{
							command: buildHookCommand("to_review", {
								source: "kiro",
								hookEventName: "stop",
								activityText: "Waiting for review",
							}),
						},
					],
				};
				Object.assign(
					env,
					createHookRuntimeEnv({
						taskId: hooks.taskId,
						workspaceId: hooks.workspaceId,
					}),
				);
			}

			if (appendedSystemPrompt) {
				config.prompt = appendedSystemPrompt;
			}

			await ensureTextFile(configPath, JSON.stringify(config, null, 2));
			if (!hasCliOption(args, "--agent")) {
				args.push("--agent", KIRO_KANBAN_AGENT_NAME);
			}
		}

		const trimmedPrompt = input.prompt.trim();
		const planPrompt = input.startInPlanMode
			? [
					"First, inspect the codebase and produce a clear implementation plan only.",
					"Do not modify files, do not use write tools, and do not implement anything yet.",
					"After you present the plan, ask for approval before making changes.",
					trimmedPrompt
						? `\n\nTask:\n${trimmedPrompt}`
						: " Ask the user what they want planned if the task is unclear.",
				].join(" ")
			: input.prompt;
		const withPromptLaunch = withPrompt(args, planPrompt, "append");
		return {
			...withPromptLaunch,
			env: {
				...withPromptLaunch.env,
				...env,
			},
		};
	},
};

const clineAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {};

		if (input.autonomousModeEnabled && !hasCliOption(args, "--auto-approve-all")) {
			args.push("--auto-approve-all");
		}

		if (input.resumeFromTrash && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}

		if (input.startInPlanMode) {
			args.push("--plan");
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const hooksDir = getHookAgentDirectory("cline");
			const notificationHookPath = getClineHookScriptPath(hooksDir, "Notification");
			const taskCompleteHookPath = getClineHookScriptPath(hooksDir, "TaskComplete");
			const userPromptSubmitHookPath = getClineHookScriptPath(hooksDir, "UserPromptSubmit");
			const preToolUseHookPath = getClineHookScriptPath(hooksDir, "PreToolUse");
			const postToolUseHookPath = getClineHookScriptPath(hooksDir, "PostToolUse");
			const executable = process.platform !== "win32";

			await ensureTextFile(notificationHookPath, buildClineNotificationHookScriptContent(), executable);
			await ensureTextFile(taskCompleteHookPath, buildClineHookScriptContent("to_review"), executable);
			await ensureTextFile(userPromptSubmitHookPath, buildClineHookScriptContent("to_in_progress"), executable);
			await ensureTextFile(preToolUseHookPath, buildClinePreToolUseHookScriptContent(), executable);
			await ensureTextFile(postToolUseHookPath, buildClinePostToolUseHookScriptContent(), executable);

			if (!hasCliOption(args, "--hooks-dir")) {
				args.push("--hooks-dir", hooksDir);
			}

			Object.assign(
				env,
				createHookRuntimeEnv({
					taskId: hooks.taskId,
					workspaceId: hooks.workspaceId,
				}),
			);
		}

		const withPromptLaunch = withPrompt(args, input.prompt, "append");
		return {
			...withPromptLaunch,
			env: {
				...withPromptLaunch.env,
				...env,
			},
		};
	},
};

/**
 * Cursor Agent CLI (`cursor-agent` / `agent`).
 *
 * Explicit seat pins inject CURSOR_API_KEY. Unpinned tasks leave auth alone so
 * the CLI uses the same `agent login` session as an interactive terminal.
 *
 * Do not write `.cursor/hooks.json`: `buildKanbanCommandParts` embeds absolute
 * node/entrypoint paths from the current machine, which break WSL and shipped
 * copies on other hosts. Review/in-progress transitions use TUI output detection.
 */
const cursorAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = { ...input.env };
		const launchSettings = input.taskLaunchSettings;
		const launchCleanups: Array<() => Promise<void>> = [];
		// Cursor Agent accepts --model; effort is stored on the card and applied
		// only when a dedicated flag becomes available (null = UI-only for now).
		applyModelAndEffortArgs(args, launchSettings, { effortFlag: null });

		// Only honor an explicitly pinned key from the task pin. Do not fall back
		// to process.env.CURSOR_API_KEY here — a stale shell export would override
		// a working `agent login` the same way a bad Seats snapshot did.
		const pinnedApiKey = input.env?.CURSOR_API_KEY?.trim();
		if (pinnedApiKey && pinnedApiKey.length > 0) {
			env.CURSOR_API_KEY = pinnedApiKey;
		} else {
			delete env.CURSOR_API_KEY;
		}

		if (input.startInPlanMode) {
			const filteredArgs = removeCursorPlanModeConflicts(args);
			args.length = 0;
			args.push(...filteredArgs, "--plan");
		} else if (
			input.autonomousModeEnabled &&
			!hasCliOption(args, "--force") &&
			!hasCliOption(args, "-f") &&
			!hasCliOption(args, "--yolo")
		) {
			args.push("--force");
		}

		if (input.autonomousModeEnabled && !hasCliOption(args, "--trust")) {
			args.push("--trust");
		}

		if (input.resumeFromTrash && !hasCliOption(args, "--resume") && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}

		const mcpAllowlist = hasMcpAllowlist(launchSettings);
		if (mcpAllowlist && launchSettings?.mcpServerIds) {
			const mcpConfig = await prepareProjectMcpConfig({
				cwd: input.cwd,
				mcpServerIds: launchSettings.mcpServerIds,
				format: "cursor",
				warn: (message) => {
					console.warn(`[kanban] ${message}`);
				},
			});
			if (mcpConfig) {
				launchCleanups.push(mcpConfig.cleanup);
			}
			if (
				input.autonomousModeEnabled &&
				!hasCliOption(args, "--approve-mcps") &&
				!hasCliOption(args, "--no-approve-mcps")
			) {
				args.push("--approve-mcps");
			}
		}

		const tagPreface = buildCursorLaunchTagPreface(launchSettings);
		const promptWithTags = tagPreface
			? `${tagPreface}\n\n${input.prompt}`.trim()
			: input.prompt;
		const prompt = mergeCursorPromptWithHomeSystemPrompt(
			promptWithTags,
			resolveHomeAgentAppendSystemPrompt(input.taskId),
		);
		const withPromptLaunch = withPrompt(args, prompt, "append");
		return {
			...withPromptLaunch,
			env: {
				...withPromptLaunch.env,
				...env,
			},
			cleanup:
				launchCleanups.length > 0
					? async () => {
							for (const fn of launchCleanups) {
								await fn();
							}
						}
					: undefined,
			detectOutputTransition: createCursorOutputTransitionDetector(),
			shouldInspectOutputForTransition: cursorOutputTransitionInspection,
		};
	},
};

const orchestratorAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const launch = await prepareOrchestratorLaunch({
			cwd: input.cwd,
			prompt: input.prompt,
			taskLaunchSettings: input.taskLaunchSettings,
			autonomousModeEnabled: input.autonomousModeEnabled,
			warn: (message) => {
				console.warn(`[kanban] ${message}`);
			},
			log: (message) => {
				console.log(`[kanban] ${message}`);
			},
		});
		if (launch === null) {
			throw new Error(
				"Custom Agent (dsh) could not launch — install DeepSeek Harness (or set PIXELOFFICE_DSH_BINARY), and give the card a prompt.",
			);
		}
		return {
			binary: launch.command,
			args: launch.args,
			env: {
				...input.env,
				...launch.env,
			},
			cleanup: launch.cleanup,
		};
	},
};

const ADAPTERS: Record<RuntimeAgentId, AgentSessionAdapter> = {
	claude: claudeAdapter,
	codex: codexAdapter,
	gemini: geminiAdapter,
	opencode: opencodeAdapter,
	droid: droidAdapter,
	kiro: kiroAdapter,
	cline: clineAdapter,
	cursor: cursorAdapter,
	orchestrator: orchestratorAdapter,
};

export async function prepareAgentLaunch(input: AgentAdapterLaunchInput): Promise<PreparedAgentLaunch> {
	const preparedPrompt = await prepareTaskPromptWithImages({
		prompt: input.prompt,
		images: input.images,
	});
	return await ADAPTERS[input.agentId].prepare({
		...input,
		prompt: preparedPrompt,
	});
}
