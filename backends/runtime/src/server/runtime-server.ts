import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { join } from "node:path";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { handleClineMcpOauthCallback } from "../cline-sdk/cline-mcp-runtime-service";
import { createClineProviderService } from "../cline-sdk/cline-provider-service";
import {
	type ClineTaskSessionService,
	createInMemoryClineTaskSessionService,
} from "../cline-sdk/cline-task-session-service";
import { createClineWatcherRegistry } from "../cline-sdk/cline-watcher-registry";
import type {
	RuntimeCommandRunResponse,
	RuntimeHostEnvironmentResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import {
	RuntimeDocAuditRequestSchema,
	RuntimeDocRoundRequestSchema,
	RuntimeHtmlBriefRequestSchema,
	RuntimeHtmlDraftRequestSchema,
	RuntimeHtmlGenerateRequestSchema,
	runtimeReviewAuditRequestSchema,
	runtimeReviewChatRequestSchema,
	runtimeReviewGraphRebuildRequestSchema,
	runtimeReviewRulesExtractRequestSchema,
	runtimeReviewSuggestCommentRequestSchema,
} from "../core/api-contract";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeTls,
	isKanbanRemoteHost,
} from "../core/runtime-endpoint";
import { DOC_SKILL_ALLOWED_TOOLS, resolveDocSkillAgentCwd } from "../doc-skill/doc-skill-agent-args";
import { BUILD_REQUEST_TIMEOUT_MS, type DocSkillClient } from "../doc-skill/doc-skill-client";
import { findDocSkillRoot } from "../doc-skill/doc-skill-process";
import { buildDocAuditPrompt, buildDocRoundPrompt, loadDocSkillText } from "../doc-skill/doc-skill-prompts";
import type { FlowiseClient } from "../flowise/flowise-client";
import { createFlowiseLlmProxyHandler } from "../flowise/flowise-llm-proxy";
import { handleOpenmaicAgentModelsRequest } from "../openmaic/openmaic-agent-models-route";
import type { OrchestratorClient } from "../orchestrator/orchestrator-client";
import { createGitlabClient } from "../gitlab/gitlab-client";
import { createGitlabOauthSession } from "../gitlab/gitlab-oauth";
import { HTML_NO_TOOLS, resolveHtmlAgentCwd, resolveHtmlAllowedTools } from "../html/html-agent-args";
import { buildBriefPrompt, loadPromptMasterBody } from "../html/html-brief";
import type { HtmlClient, HtmlPromptFailure } from "../html/html-client";
import { buildDraftPrompt } from "../html/html-draft";
import { resolveFreestyleGenerateRun } from "../html/html-freestyle";
import {
	createUsageResumeScheduler,
	isUsageResumeCandidate,
	type PausableSession,
} from "../jacked/usage-resume-scheduler";
import {
	buildAuthFailoverRequest,
	createAuthFailoverGuard,
} from "../terminal/auth-failover";
import {
	pickDefaultClaudeAccountId,
	pickDefaultCursorAccountId,
	pickFableClaudeAccountId,
	pickLeastUsedClaudeAccountId,
	toManagerDonateAccount,
} from "../manager/manager-account-pin";
import type { AutoSeatFleetContext } from "../manager/claude-auto-seat-ranking";
import { buildClaudeSeatLoadFromSummaries, toAutoSeatFleetContext } from "../manager/manager-seat-load";
import type { ManagerClient } from "../manager/manager-client";
import type { ManagerMonitor } from "../manager/manager-monitor";
import {
	REVIEW_AUDIT_ALLOWED_TOOLS,
	REVIEW_CHAT_ALLOWED_TOOLS,
	REVIEW_RULES_EXTRACT_ALLOWED_TOOLS,
	REVIEW_SUGGEST_ALLOWED_TOOLS,
	resolveReviewAgentCwd,
} from "../review/review-agent-args";
import { reviewCommandNeedsGraphImpact, reviewCommandNeedsRules } from "../review/review-command-expansion";
import { buildReviewGraphPromptSection } from "../review/review-graph-brief";
import { reviewGraphRebuildService } from "../review/review-graph-rebuild-service";
import {
	buildAuditPrompt,
	buildChatPrompt,
	buildRulesExtractPrompt,
	buildSuggestionRewritePrompt,
	REVIEW_CHAT_SYSTEM_PROMPT,
} from "../review/review-prompts";
import { persistExtractedRules, readReviewRulesBundle } from "../review/review-rules";
import { handleAgentStreamRoute } from "../review/review-stream-route";
import {
	checkRateLimit,
	clearRateLimit,
	deleteSession,
	extractBearerToken,
	extractSessionTokenFromCookie,
	getSessionSubject,
	isPasscodeEnabled,
	issueSession,
	issueSessionForSubject,
	recordFailedAttempt,
	validateInternalToken,
	validatePasscode,
	validateSession,
} from "../security/passcode-manager";
import {
	type GoogleAuthConfig,
	resolveAuthMode,
	validateGoogleConfig,
} from "../security/auth-mode";
import {
	createAuthorizationUrl,
	handleCallback,
} from "../security/google-oidc";
import { findSavedPlanById, readSavedPlanAsset, resolvePlanImageAssets } from "../state/saved-plans";
import { loadWorkspaceContextById, loadWorkspaceState } from "../state/workspace-state";
import { runAgentOneShot } from "../terminal/agent-oneshot";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { resolveHostPath } from "../terminal/task-launch-settings";
import { createTerminalWebSocketBridge } from "../terminal/ws-server";
import { type RuntimeTrpcContext, type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "../trpc/app-router";
import { createClaudeUsageApi } from "../trpc/claude-usage-api";
import { createDeployApi } from "../trpc/deploy-api";
import { createDocSkillApi } from "../trpc/doc-skill-api";
import { createFlowiseApi } from "../trpc/flowise-api";
import { createOpenmaicApi } from "../trpc/openmaic-api";
import { createOrchestratorApi } from "../trpc/orchestrator-api";
import { createSiteApi } from "../trpc/site-api";
import { createGitlabApi } from "../trpc/gitlab-api";
import { createHooksApi } from "../trpc/hooks-api";
import { createHtmlApi } from "../trpc/html-api";
import { createManagerApi } from "../trpc/manager-api";
import { createPlansApi } from "../trpc/plans-api";
import { createProjectsApi } from "../trpc/projects-api";
import { createReviewApi } from "../trpc/review-api";
import { createRuntimeApi } from "../trpc/runtime-api";
import { createWorkspaceApi } from "../trpc/workspace-api";
import { getWebUiDir, isWebUiServedExternally, normalizeRequestPath, readAsset } from "./assets";
import { openGitlabAuthUrl } from "./browser";
import { handleHttpRequest, handleSocketUpgrade } from "./middleware";
import type { RuntimeStateHub } from "./runtime-state-hub";
import type { WorkspaceRegistry } from "./workspace-registry";

interface DisposeTrackedWorkspaceResult {
	terminalManager: TerminalSessionManager | null;
	workspacePath: string | null;
}

export interface CreateRuntimeServerDependencies {
	workspaceRegistry: WorkspaceRegistry;
	runtimeStateHub: RuntimeStateHub;
	manager: { client: ManagerClient; monitor: ManagerMonitor };
	html: { client: HtmlClient };
	docSkill: { client: DocSkillClient };
	flowise: { client: FlowiseClient };
	orchestrator: { client: OrchestratorClient };
	warn: (message: string) => void;
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	resolveProjectInputPath: (inputPath: string, basePath: string) => string;
	assertPathIsDirectory: (targetPath: string) => Promise<void>;
	hasGitRepository: (path: string) => boolean;
	disposeWorkspace: (
		workspaceId: string,
		options?: {
			stopTerminalSessions?: boolean;
			flushSessionSummaries?: boolean;
		},
	) => DisposeTrackedWorkspaceResult;
	collectProjectWorktreeTaskIdsForRemoval: (board: RuntimeWorkspaceStateResponse["board"]) => Set<string>;
	pickDirectoryPathFromSystemDialog: () => string | null | Promise<string | null>;
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	getHostEnvironment: () => RuntimeHostEnvironmentResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
}

export interface RuntimeServer {
	url: string;
	close: () => Promise<void>;
}

/**
 * Turns a sidecar prompt failure into a status + message the UI can act on.
 * The sidecar's own body is passed through for HTTP failures because it names
 * the problem (`unknown template: <id>`), which the previous catch-all 502 hid.
 */
function describeHtmlPromptFailure(failure: HtmlPromptFailure): { status: number; error: string } {
	switch (failure.kind) {
		case "unreachable":
			return {
				status: 502,
				error: `HTML sidecar unreachable at ${failure.baseUrl}: ${failure.message}`,
			};
		case "timeout":
			return {
				status: 504,
				error: `HTML sidecar timed out after ${failure.timeoutMs}ms at ${failure.baseUrl}`,
			};
		case "http":
			return {
				status: failure.status,
				error: `HTML sidecar returned ${failure.status}: ${failure.body || "(empty body)"}`,
			};
		case "malformed":
			return {
				status: 502,
				error: `HTML sidecar returned an unexpected prompt payload: ${failure.body || "(empty body)"}`,
			};
	}
}

function readWorkspaceIdFromRequest(request: IncomingMessage, requestUrl: URL): string | null {
	const headerValue = request.headers["x-kanban-workspace-id"];
	const headerWorkspaceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (typeof headerWorkspaceId === "string") {
		const normalized = headerWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	const queryWorkspaceId = requestUrl.searchParams.get("workspaceId");
	if (typeof queryWorkspaceId === "string") {
		const normalized = queryWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	return null;
}

export async function createRuntimeServer(deps: CreateRuntimeServerDependencies): Promise<RuntimeServer> {
	const webUiDir = getWebUiDir();
	const externalWebUi = isWebUiServedExternally();

	try {
		await readFile(join(webUiDir, "index.html"));
	} catch {
		if (!externalWebUi) {
			throw new Error("Could not find web UI assets. Run `npm run build` to generate and package the web UI.");
		}
	}

	const resolveWorkspaceScopeFromRequest = async (
		request: IncomingMessage,
		requestUrl: URL,
	): Promise<{
		requestedWorkspaceId: string | null;
		workspaceScope: RuntimeTrpcWorkspaceScope | null;
	}> => {
		const requestedWorkspaceId = readWorkspaceIdFromRequest(request, requestUrl);
		if (!requestedWorkspaceId) {
			return {
				requestedWorkspaceId: null,
				workspaceScope: null,
			};
		}
		const requestedWorkspaceContext = await loadWorkspaceContextById(requestedWorkspaceId);
		if (!requestedWorkspaceContext) {
			return {
				requestedWorkspaceId,
				workspaceScope: null,
			};
		}
		return {
			requestedWorkspaceId,
			workspaceScope: {
				workspaceId: requestedWorkspaceContext.workspaceId,
				workspacePath: requestedWorkspaceContext.repoPath,
			},
		};
	};

	const getScopedTerminalManager = async (scope: RuntimeTrpcWorkspaceScope): Promise<TerminalSessionManager> =>
		await deps.ensureTerminalManagerForWorkspace(scope.workspaceId, scope.workspacePath);
	const clineTaskSessionServiceByWorkspaceId = new Map<string, ClineTaskSessionService>();
	const clineWatcherRegistry = createClineWatcherRegistry();
	const clineProviderServiceForRestart = createClineProviderService();
	const getScopedClineTaskSessionService = async (
		scope: RuntimeTrpcWorkspaceScope,
	): Promise<ClineTaskSessionService> => {
		let service = clineTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
		if (!service) {
			service = createInMemoryClineTaskSessionService({
				watcherRegistry: clineWatcherRegistry,
				resolveTaskLaunchConfig: async (taskId) => {
					const launchConfig = await clineProviderServiceForRestart.resolveLaunchConfig().catch(() => null);
					if (!launchConfig) {
						return null;
					}
					const workspaceState = await loadWorkspaceState(scope.workspacePath).catch(() => null);
					const card =
						workspaceState?.board.columns.flatMap((column) => column.cards).find((c) => c.id === taskId) ?? null;
					return {
						providerId: launchConfig.providerId,
						seatProviderId: launchConfig.seatProviderId,
						modelId: launchConfig.modelId,
						apiKey: launchConfig.apiKey,
						baseUrl: launchConfig.baseUrl,
						reasoningEffort: launchConfig.reasoningEffort,
						taskLaunchSettings: card?.taskLaunchSettings,
					};
				},
			});
			clineTaskSessionServiceByWorkspaceId.set(scope.workspaceId, service);
			deps.runtimeStateHub.trackClineTaskSessionService(scope.workspaceId, scope.workspacePath, service);
		}
		return service;
	};
	const disposeClineTaskSessionServiceAsync = async (workspaceId: string): Promise<void> => {
		const service = clineTaskSessionServiceByWorkspaceId.get(workspaceId);
		if (!service) {
			return;
		}
		clineTaskSessionServiceByWorkspaceId.delete(workspaceId);
		await service.dispose();
	};
	const disposeClineTaskSessionService = (workspaceId: string): void => {
		void disposeClineTaskSessionServiceAsync(workspaceId);
	};
	const collectClaudeFleetContext = (): AutoSeatFleetContext => {
		const merged: Record<number, number> = {};
		for (const { terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
			const partial = buildClaudeSeatLoadFromSummaries(terminalManager.listSummaries());
			for (const [accountId, count] of Object.entries(partial)) {
				const id = Number(accountId);
				merged[id] = (merged[id] ?? 0) + count;
			}
		}
		return toAutoSeatFleetContext(merged);
	};
	const reportClaudeSeatLoad = (fleetContext: AutoSeatFleetContext): void => {
		const load = fleetContext.seatLoad ?? {};
		void deps.manager.client.pushSeatLoad(load).catch(() => undefined);
	};
	const prepareForStateReset = async (): Promise<void> => {
		const workspaceIds = new Set<string>();
		for (const { workspaceId } of deps.workspaceRegistry.listManagedWorkspaces()) {
			workspaceIds.add(workspaceId);
		}
		for (const workspaceId of clineTaskSessionServiceByWorkspaceId.keys()) {
			workspaceIds.add(workspaceId);
		}
		const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
		if (activeWorkspaceId) {
			workspaceIds.add(activeWorkspaceId);
		}
		for (const workspaceId of workspaceIds) {
			await disposeClineTaskSessionServiceAsync(workspaceId);
			// Same resurrection hazard as project removal (see workspace-registry.ts /
			// projects-api.ts): `resetAllState` rm -rf's the entire runtime home right
			// after this returns, so flush the real pending state now and then discard
			// (rather than flush) whatever `disposeWorkspace`'s own
			// `markInterruptedAndStopAll` races in afterward.
			await deps.workspaceRegistry.flushWorkspaceSessionPersistence(workspaceId);
			deps.disposeWorkspace(workspaceId, {
				stopTerminalSessions: true,
				flushSessionSummaries: false,
			});
		}
		deps.workspaceRegistry.clearActiveWorkspace();
	};

	// Stateless over the jacked client/monitor, so one instance serves every request
	// and the runtime API can reuse its Claude-only account guards.
	const managerApi = createManagerApi({
		client: deps.manager.client,
		monitor: deps.manager.monitor,
	});
	const htmlApi = createHtmlApi({
		client: deps.html.client,
	});
	// Reads the local Claude credential directly rather than the Manager's cached
	// columns, so the embedded and standalone plan editors show identical numbers.
	const claudeUsageApi = createClaudeUsageApi();
	const docSkillApi = createDocSkillApi({
		client: deps.docSkill.client,
	});
	const flowiseSeatDeps = {
		monitor: deps.manager.monitor,
		getAccountLaunchDir: async (accountId: number) => {
			const launchDir = await managerApi.getAccountLaunchDir({ accountId });
			return launchDir ? { configDir: launchDir.configDir } : null;
		},
		getAccountLaunchCredential: async (accountId: number) => {
			const credential = await managerApi.getAccountLaunchCredential({ accountId });
			return credential ? { apiKey: credential.apiKey } : null;
		},
		useManagerAccount: async (accountId: number) => {
			const result = await deps.manager.client.useAccount(accountId);
			return result.ok;
		},
		resolveApiSeatCredentials: async (providerId: string) =>
			await clineProviderServiceForRestart.resolveApiSeatCredentials({ providerId }),
	};
	const flowiseApi = createFlowiseApi({
		client: deps.flowise.client,
		...flowiseSeatDeps,
	});
	const flowiseLlmProxy = createFlowiseLlmProxyHandler({
		...flowiseSeatDeps,
		warn: deps.warn,
	});
	const orchestratorApi = createOrchestratorApi({
		client: deps.orchestrator.client,
	});
	// No dependencies: "is the site built" is a file check and "is it up" is a TCP probe.
	const siteApi = createSiteApi();
	// No dependencies: the Learning tab's whole question is "is the submodule there, built,
	// and listening", all of which are answered from disk and a TCP probe. Health now also
	// reports Gemini seat-route readiness from the same manager monitor used by Flowise.
	const openmaicApi = createOpenmaicApi({
		monitor: deps.manager.monitor,
		resolveApiSeatCredentials: async (providerId: string) =>
			await clineProviderServiceForRestart.resolveApiSeatCredentials({ providerId }),
	});
	// One GitLab identity serves the whole runtime, so the client and the OAuth flow
	// registry are singletons here rather than per request: a flow started by one
	// request is polled by the next, and the client caches the credential in process.
	const gitlabClient = createGitlabClient({ warn: deps.warn });
	const gitlabOauthSession = createGitlabOauthSession();
	const gitlabApi = createGitlabApi({
		client: gitlabClient,
		oauth: gitlabOauthSession,
		openInBrowser: (url) => openGitlabAuthUrl(url, { warn: deps.warn }),
		warn: deps.warn,
	});
	const reviewApi = createReviewApi();

	/**
	 * Account-pin wiring shared by every one-shot HTML agent route (`/api/html/brief`,
	 * `/api/html/generate`, `/api/html/draft`). They all spend the same Claude seat, so
	 * they all resolve it the same way — pinned account when the caller names one, the
	 * Manager's active Claude account otherwise.
	 */
	const buildHtmlAgentPinInput = (
		managerAccountId?: number,
	): NonNullable<Parameters<typeof runAgentOneShot>[0]["pinInput"]> => ({
		managerAccountId,
		getAccountLaunchDir: async (accountId) => (await managerApi.getAccountLaunchDir({ accountId })) ?? null,
		getAccountProvider: async (accountId) => await managerApi.getAccountProvider(accountId),
		resolveActiveClaudeAccountId: async () => {
			const snapshot = deps.manager.monitor.getState();
			if (!snapshot) return null;
			return pickDefaultClaudeAccountId({
				accounts: snapshot.accounts,
				activeAccountId: snapshot.activeAccountId,
			});
		},
		resolveLiveActiveClaudeAccountId: async () => deps.manager.monitor.getState()?.activeAccountId ?? null,
		getPinnedAccount: async (accountId) => {
			const snapshot = deps.manager.monitor.getState();
			const account = snapshot?.accounts.find((entry) => entry.id === accountId);
			return account ? toManagerDonateAccount(account) : null;
		},
	});

	/**
	 * Watchdog shared by every one-shot HTML agent route (`/api/html/brief`,
	 * `/api/html/generate` and `/api/html/draft`). Cancels a run that goes quiet (a
	 * stray permission prompt the one-shot `-p` process cannot answer) and puts a hard
	 * ceiling on the whole request regardless of output. The routes share one constant
	 * pair rather than duplicating the numbers, since they hang for the exact same
	 * reason: a `-p` run has no UI to answer a permission prompt with.
	 */
	const HTML_AGENT_IDLE_TIMEOUT_MS = 120_000;
	const HTML_AGENT_HARD_TIMEOUT_MS = 10 * 60_000;

	/**
	 * Sized for the sidecar's template-import route: an 8 MB zip carried as base64 in JSON, since
	 * the proxy forwards string bodies only. The previous 1 MB ceiling rejected any real template
	 * archive with a bare "Request body too large".
	 */
	const HTML_PROXY_MAX_BODY_BYTES = 12 * 1024 * 1024;

	/**
	 * Which images the brief pass may open, and where to run it.
	 *
	 * Generation gets its cwd from `resolveHtmlAgentCwd` and its Read grant from
	 * the template's `allow_read`; expansion has no template to ask, and its whole
	 * job is to look at the screenshots, so it names the paths explicitly. A plan
	 * that has gone missing must not sink the run — the notes alone still expand.
	 */
	const resolveBriefPlanContext = async (
		planId: string,
		content: string,
	): Promise<{ cwd?: string; assetPaths: string[]; unresolvedLinks: string[] }> => {
		try {
			const { planDir, assetPaths, unresolvedLinks } = await resolvePlanImageAssets(planId, content);
			return { cwd: planDir, assetPaths, unresolvedLinks };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Brief expansion could not resolve plan ${planId}: ${message}`);
			return { assetPaths: [], unresolvedLinks: [] };
		}
	};

	const runtimeApiDeps: Parameters<typeof createRuntimeApi>[0] = {
		getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
		getActiveRuntimeConfig: deps.workspaceRegistry.getActiveRuntimeConfig,
		loadScopedRuntimeConfig: deps.workspaceRegistry.loadScopedRuntimeConfig,
		setActiveRuntimeConfig: deps.workspaceRegistry.setActiveRuntimeConfig,
		getScopedTerminalManager,
		getScopedClineTaskSessionService,
		// Lets a board task pin itself to one Claude account. Goes through the
		// Manager API so the Claude-only guard applies, and resolves to null
		// (unpinned, global credential) whenever Manager is unreachable.
		getManagerAccountLaunchDir: async (accountId) => await managerApi.getAccountLaunchDir({ accountId }),
		getManagerAccountLaunchCredential: async (accountId) => {
			const credential = await managerApi.getAccountLaunchCredential({ accountId });
			return credential ? { apiKey: credential.apiKey } : null;
		},
		getManagerAccountProvider: async (accountId) => await managerApi.getAccountProvider(accountId),
		resolveDefaultCursormanagerAccountId: async () => {
			const snapshot = deps.manager.monitor.getState();
			if (!snapshot) {
				return null;
			}
			return pickDefaultCursorAccountId({
				accounts: snapshot.accounts,
				activeAccountId: snapshot.activeAccountId,
			});
		},
		resolveActiveClaudemanagerAccountId: async () => {
			const snapshot = deps.manager.monitor.getState();
			if (!snapshot) {
				return null;
			}
			const fleetContext = collectClaudeFleetContext();
			reportClaudeSeatLoad(fleetContext);
			return pickDefaultClaudeAccountId({
				accounts: snapshot.accounts,
				activeAccountId: snapshot.activeAccountId,
				fleetContext,
			});
		},
		// Auto (unpinned) board tasks: the least-used healthy seat, chosen without
		// reference to jacked's global active seat so task load stops landing on
		// whichever seat the Plans and Review tabs are also using.
		resolveAutoClaudemanagerAccountId: async () => {
			const snapshot = deps.manager.monitor.getState();
			if (!snapshot) {
				return null;
			}
			const fleetContext = collectClaudeFleetContext();
			reportClaudeSeatLoad(fleetContext);
			return pickLeastUsedClaudeAccountId({ accounts: snapshot.accounts, fleetContext });
		},
		// `seatPreset: "fable"` cards: the seat with the most spendable extra usage credit,
		// preferring seats whose subscription windows are already capped (that is where credit
		// actually bills). Ranks over a different pool than Auto — see pickFableClaudeAccountId.
		resolveFableClaudemanagerAccountId: async () => {
			const snapshot = deps.manager.monitor.getState();
			if (!snapshot) {
				return null;
			}
			return pickFableClaudeAccountId({ accounts: snapshot.accounts });
		},
		resolveLiveActiveClaudemanagerAccountId: async () => deps.manager.monitor.getState()?.activeAccountId ?? null,
		getPinnedManagerAccount: async (accountId) => {
			const snapshot = deps.manager.monitor.getState();
			const account = snapshot?.accounts.find((candidate) => candidate.id === accountId);
			if (!account) {
				return null;
			}
			return toManagerDonateAccount(account);
		},
		resolveInteractiveShellCommand: deps.resolveInteractiveShellCommand,
		runCommand: deps.runCommand,
		broadcastClineMcpAuthStatusesUpdated: deps.runtimeStateHub.broadcastClineMcpAuthStatusesUpdated,
		broadcastTaskChatCleared: deps.runtimeStateHub.broadcastTaskChatCleared,
		bumpClineSessionContextVersion: deps.runtimeStateHub.bumpClineSessionContextVersion,
		prepareForStateReset,
		getUpdateStatus: deps.getUpdateStatus,
		getHostEnvironment: deps.getHostEnvironment,
		runUpdateNow: deps.runUpdateNow,
		flowiseClient: deps.flowise.client,
	};

	// One long-lived runtimeApi instance the usage-resume scheduler uses to relaunch
	// (--continue) a task whose Claude usage window has reset. Separate from the
	// per-request instances so it never depends on an inbound HTTP request being in flight.
	const usageResumeRuntimeApi = createRuntimeApi(runtimeApiDeps);

	const usageFailoverGuard = createAuthFailoverGuard();

	const resumeUsagePausedTask = async (scope: RuntimeTrpcWorkspaceScope, taskId: string): Promise<void> => {
		// The resume needs the card's baseRef (+ its pin/flag so they persist across the relaunch).
		const workspaceState = await loadWorkspaceState(scope.workspacePath).catch(() => null);
		const card = workspaceState?.board.columns.flatMap((column) => column.cards).find((c) => c.id === taskId) ?? null;
		const response = await usageResumeRuntimeApi.startTaskSession(scope, {
			taskId,
			prompt: "",
			baseRef: card?.baseRef ?? "HEAD",
			resumeFromTrash: true,
			...(card?.agentId ? { agentId: card.agentId } : {}),
			...(card?.managerAccountId ? { managerAccountId: card.managerAccountId } : {}),
			autoResumeOnUsageLimit: card?.autoResumeOnUsageLimit ?? true,
			autoFailoverOnUsageLimit: card?.autoFailoverOnUsageLimit ?? false,
			taskLaunchSettings: card?.taskLaunchSettings,
		});
		if (!response.ok) {
			throw new Error(response.error ?? "usage-resume relaunch failed");
		}
	};

	const failoverUsageLimitedTask = async (
		scope: RuntimeTrpcWorkspaceScope,
		taskId: string,
		nextAccountId: number,
	): Promise<void> => {
		if (!usageFailoverGuard.shouldAttempt(taskId, Date.now())) {
			throw new Error("usage failover cap reached");
		}
		const terminalManager = await deps.ensureTerminalManagerForWorkspace(
			scope.workspaceId,
			scope.workspacePath,
		);
		const retryRequest = terminalManager.getRestartRequest(taskId);
		const launchDir = await deps.manager.client.fetchAccountLaunchDir(nextAccountId).catch(() => null);
		if (!launchDir || launchDir.configDir.trim().length === 0) {
			throw new Error("seat prep failed");
		}
		const workspaceState = await loadWorkspaceState(scope.workspacePath).catch(() => null);
		const card = workspaceState?.board.columns.flatMap((column) => column.cards).find((c) => c.id === taskId) ?? null;
		const rebuilt = buildAuthFailoverRequest(
			retryRequest,
			nextAccountId,
			resolveHostPath(launchDir.configDir),
		);
		if (rebuilt === null) {
			throw new Error("no restart request for failover");
		}
		usageFailoverGuard.recordAttempt(taskId, Date.now());
		await terminalManager.startTaskSession({
			...rebuilt,
			autoResumeOnUsageLimit: card?.autoResumeOnUsageLimit ?? true,
			autoFailoverOnUsageLimit: card?.autoFailoverOnUsageLimit ?? false,
		});
	};

	const usageResumeScheduler = createUsageResumeScheduler({
		now: () => Date.now(),
		refreshSnapshot: async () => await deps.manager.monitor.refresh(),
		log: deps.warn,
		collectSessions: () => {
			const out: PausableSession[] = [];
			const seen = new Set<string>();
			const addFrom = (
				scope: RuntimeTrpcWorkspaceScope,
				summaries: RuntimeTaskSessionSummary[],
				mark: (taskId: string, resumeAt: number) => void,
				withFailover: boolean,
			): void => {
				for (const summary of summaries) {
					if (seen.has(summary.taskId) || !isUsageResumeCandidate(summary)) {
						continue;
					}
					seen.add(summary.taskId);
					out.push({
						taskId: summary.taskId,
						summary,
						markUsagePaused: (resumeAt: number) => mark(summary.taskId, resumeAt),
						resume: () => resumeUsagePausedTask(scope, summary.taskId),
						...(withFailover
							? {
									failover: (nextAccountId: number) =>
										failoverUsageLimitedTask(scope, summary.taskId, nextAccountId),
								}
							: {}),
					});
				}
			};
			for (const { workspaceId, workspacePath, terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
				if (!workspacePath) {
					continue;
				}
				const scope: RuntimeTrpcWorkspaceScope = { workspaceId, workspacePath };
				addFrom(
					scope,
					terminalManager.listSummaries(),
					(taskId, resumeAt) => terminalManager.markUsagePaused(taskId, resumeAt),
					true,
				);
				const clineService = clineTaskSessionServiceByWorkspaceId.get(workspaceId);
				if (clineService) {
					addFrom(
						scope,
						clineService.listSummaries(),
						(taskId, resumeAt) => clineService.markUsagePaused(taskId, resumeAt),
						false,
					);
				}
			}
			return out;
		},
	});

	const createTrpcContext = async (req: IncomingMessage): Promise<RuntimeTrpcContext> => {
		const requestUrl = new URL(req.url ?? "/", "http://localhost");
		const scope = await resolveWorkspaceScopeFromRequest(req, requestUrl);
		return {
			requestedWorkspaceId: scope.requestedWorkspaceId,
			workspaceScope: scope.workspaceScope,
			runtimeApi: createRuntimeApi(runtimeApiDeps),
			workspaceApi: createWorkspaceApi({
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				getScopedClineTaskSessionService,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastRuntimeProjectsUpdated: deps.runtimeStateHub.broadcastRuntimeProjectsUpdated,
				buildWorkspaceStateSnapshot: deps.workspaceRegistry.buildWorkspaceStateSnapshot,
			}),
			projectsApi: createProjectsApi({
				getActiveWorkspacePath: deps.workspaceRegistry.getActiveWorkspacePath,
				getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
				rememberWorkspace: deps.workspaceRegistry.rememberWorkspace,
				setActiveWorkspace: deps.workspaceRegistry.setActiveWorkspace,
				clearActiveWorkspace: deps.workspaceRegistry.clearActiveWorkspace,
				resolveProjectInputPath: deps.resolveProjectInputPath,
				assertPathIsDirectory: deps.assertPathIsDirectory,
				hasGitRepository: deps.hasGitRepository,
				summarizeProjectTaskCounts: deps.workspaceRegistry.summarizeProjectTaskCounts,
				createProjectSummary: deps.workspaceRegistry.createProjectSummary,
				broadcastRuntimeProjectsUpdated: deps.runtimeStateHub.broadcastRuntimeProjectsUpdated,
				getTerminalManagerForWorkspace: deps.workspaceRegistry.getTerminalManagerForWorkspace,
				disposeWorkspace: (workspaceId, options) => {
					disposeClineTaskSessionService(workspaceId);
					return deps.disposeWorkspace(workspaceId, options);
				},
				flushWorkspaceSessionPersistence: deps.workspaceRegistry.flushWorkspaceSessionPersistence,
				collectProjectWorktreeTaskIdsForRemoval: deps.collectProjectWorktreeTaskIdsForRemoval,
				warn: deps.warn,
				buildProjectsPayload: deps.workspaceRegistry.buildProjectsPayload,
				pickDirectoryPathFromSystemDialog: deps.pickDirectoryPathFromSystemDialog,
				serverCwd: process.cwd(),
			}),
			plansApi: createPlansApi({
				serverCwd: process.cwd(),
			}),
			deployApi: createDeployApi(),
			hooksApi: createHooksApi({
				getWorkspacePathById: deps.workspaceRegistry.getWorkspacePathById,
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastTaskReadyForReview: deps.runtimeStateHub.broadcastTaskReadyForReview,
			}),
			managerApi,
			htmlApi,
			claudeUsageApi,
			docSkillApi,
			flowiseApi,
			openmaicApi,
			orchestratorApi,
			siteApi,
			gitlabApi,
			reviewApi,
		};
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => await createTrpcContext(req),
	});

	const isRemoteMode = isKanbanRemoteHost();
	const authMode = resolveAuthMode({ isRemote: isRemoteMode });
	let googleConfig: GoogleAuthConfig | null = null;
	const getGoogleConfig = async (): Promise<GoogleAuthConfig | null> => {
		if (googleConfig) return googleConfig;
		const validation = await validateGoogleConfig();
		if (validation.valid && validation.config) {
			googleConfig = validation.config;
			return googleConfig;
		}
		return null;
	};

	const readRequestBody = (req: IncomingMessage, maxBytes = 4096): Promise<string> =>
		new Promise((resolve, reject) => {
			let body = "";
			let size = 0;
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > maxBytes) {
					reject(new Error("Request body too large"));
					return;
				}
				body += chunk.toString("utf8");
			});
			req.on("end", () => resolve(body));
			req.on("error", reject);
		});

	const getRemoteIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? "unknown";

	const tlsConfig = getKanbanRuntimeTls();
	const requestHandler = async (req: IncomingMessage, res: import("node:http").ServerResponse) => {
		try {
			if (handleHttpRequest(req, res).end) {
				return;
			}

			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);

			// Loopback-only; Flowise has no session cookie when calling Anthropic through us.
			if (await flowiseLlmProxy(req, res, pathname)) {
				return;
			}

			if (await handleOpenmaicAgentModelsRequest(req, res, pathname, requestUrl.searchParams)) {
				return;
			}

			// ── Auth gate (off | passcode | google) ───────────────────────────
			if (pathname === "/api/auth/status" || pathname === "/api/passcode/status") {
				if (authMode === "off") {
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({
						mode: "off",
						required: false,
						authenticated: true,
						passcodeAvailable: false,
						google: { configured: false },
					}));
				} else {
					const sessionToken = extractSessionTokenFromCookie(req.headers.cookie);
					const sessionAuth = sessionToken !== null && validateSession(sessionToken);
					const bearerToken = extractBearerToken(req.headers.authorization);
					const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
					const authenticated = sessionAuth || internalAuth;
					const subject = sessionToken ? getSessionSubject(sessionToken) ?? undefined : undefined;
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({
						mode: authMode,
						required: true,
						authenticated,
						passcodeAvailable: isPasscodeEnabled(),
						google: { configured: authMode === "google" },
						...(subject ? { subject } : {}),
					}));
				}
				return;
			}

			if (pathname === "/api/auth/google/start") {
				if (authMode !== "google") {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google authentication is not enabled." }));
					return;
				}
				const config = await getGoogleConfig();
				if (!config) {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google OAuth configuration is incomplete." }));
					return;
				}
				try {
					const { url } = await createAuthorizationUrl(config);
					res.writeHead(302, {
						Location: url,
						"Cache-Control": "no-store",
					});
					res.end();
				} catch {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Failed to initiate Google login." }));
				}
				return;
			}

			if (pathname === "/api/auth/google/callback") {
				const ip = getRemoteIp(req);
				const rateLimit = checkRateLimit(ip);
				if (!rateLimit.allowed) {
					const retryAfterSec = rateLimit.lockedUntilMs
						? Math.ceil((rateLimit.lockedUntilMs - Date.now()) / 1000)
						: 30;
					res.writeHead(429, {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
						"Retry-After": String(retryAfterSec),
					});
					res.end(JSON.stringify({ error: "Too many attempts. Please wait before trying again." }));
					return;
				}

				if (authMode !== "google") {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google authentication is not enabled." }));
					return;
				}

				const config = await getGoogleConfig();
				if (!config) {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Google OAuth configuration is incomplete." }));
					return;
				}

				const error = requestUrl.searchParams.get("error");
				if (error) {
					recordFailedAttempt(ip);
					res.writeHead(302, {
						Location: `/?auth_error=${encodeURIComponent(error)}`,
						"Cache-Control": "no-store",
					});
					res.end();
					return;
				}

				const code = requestUrl.searchParams.get("code");
				const state = requestUrl.searchParams.get("state");
				if (!code || !state) {
					recordFailedAttempt(ip);
					res.writeHead(302, {
						Location: "/?auth_error=missing_code_or_state",
						"Cache-Control": "no-store",
					});
					res.end();
					return;
				}

				try {
					const user = await handleCallback({ code, state, config });
					clearRateLimit(ip);
					const token = issueSessionForSubject(user);
					const cookieFlags = [
						`kanban_session=${token}`,
						"HttpOnly",
						"SameSite=Strict",
						"Path=/",
						`Max-Age=${24 * 60 * 60}`,
						...(tlsConfig !== null ? ["Secure"] : []),
					].join("; ");
					res.writeHead(302, {
						Location: "/",
						"Set-Cookie": cookieFlags,
						"Cache-Control": "no-store",
					});
					res.end();
				} catch (err) {
					recordFailedAttempt(ip);
					const reason = err instanceof Error ? err.message : "auth_failed";
					res.writeHead(302, {
						Location: `/?auth_error=${encodeURIComponent(reason)}`,
						"Cache-Control": "no-store",
					});
					res.end();
				}
				return;
			}

			if (req.method === "POST" && pathname === "/api/auth/logout") {
				const sessionToken = extractSessionTokenFromCookie(req.headers.cookie);
				if (sessionToken) {
					deleteSession(sessionToken);
				}
				const cookieFlags = [
					"kanban_session=",
					"HttpOnly",
					"SameSite=Strict",
					"Path=/",
					"Max-Age=0",
					...(tlsConfig !== null ? ["Secure"] : []),
				].join("; ");
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store",
					"Set-Cookie": cookieFlags,
				});
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			if (authMode !== "off" && isPasscodeEnabled() && req.method === "POST" && pathname === "/api/passcode/verify") {
				const ip = getRemoteIp(req);
				const rateLimit = checkRateLimit(ip);
				if (!rateLimit.allowed) {
					const retryAfterSec = rateLimit.lockedUntilMs
						? Math.ceil((rateLimit.lockedUntilMs - Date.now()) / 1000)
						: 30;
					res.writeHead(429, {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
						"Retry-After": String(retryAfterSec),
					});
					res.end(JSON.stringify({ error: "Too many attempts. Please wait before trying again." }));
					return;
				}
				let body: string;
				try {
					body = await readRequestBody(req);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Invalid request body." }));
					return;
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(body);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Invalid JSON." }));
					return;
				}
				const submitted =
					parsed !== null &&
					typeof parsed === "object" &&
					"passcode" in parsed &&
					typeof (parsed as Record<string, unknown>).passcode === "string"
						? ((parsed as Record<string, unknown>).passcode as string)
						: "";
				if (!validatePasscode(submitted)) {
					recordFailedAttempt(ip);
					res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Invalid passcode." }));
					return;
				}
				clearRateLimit(ip);
				const token = issueSession();
				const cookieFlags = [
					`kanban_session=${token}`,
					"HttpOnly",
					"SameSite=Strict",
					"Path=/",
					`Max-Age=${24 * 60 * 60}`,
					...(tlsConfig !== null ? ["Secure"] : []),
				].join("; ");
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store",
					"Set-Cookie": cookieFlags,
				});
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			if (authMode !== "off") {
				// Check session cookie (browser flow) first, then internal bearer token (CLI flow).
				const sessionToken = extractSessionTokenFromCookie(req.headers.cookie);
				const sessionAuth = sessionToken !== null && validateSession(sessionToken);
				const bearerToken = extractBearerToken(req.headers.authorization);
				const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
				const authenticated = sessionAuth || internalAuth;
				if (!authenticated) {
					// Static assets (JS, CSS, images, fonts, icons, manifest) are served
					// freely even when unauthenticated. They contain no user data and are
					// required for the React app to boot and render the passcode gate.
					// Only API routes are hard-blocked; index.html is served normally so
					// PasscodeGateProvider in React can intercept before any API calls.
					if (pathname.startsWith("/api/")) {
						res.writeHead(401, {
							"Content-Type": "application/json; charset=utf-8",
							"Cache-Control": "no-store",
						});
						res.end(JSON.stringify({ error: "Authentication required." }));
						return;
					}
					// Fall through — let the normal asset/index.html serving below handle it.
					// PasscodeGateProvider in main.tsx will render the gate before any
					// authenticated API calls are made.
				}
			}
			// ── End auth gate ──────────────────────────────────────────────────

			const oauthCallbackResponse = await handleClineMcpOauthCallback(requestUrl);
			if (oauthCallbackResponse) {
				res.writeHead(oauthCallbackResponse.statusCode, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(oauthCallbackResponse.body);
				return;
			}
			if (pathname.startsWith("/api/trpc")) {
				await trpcHttpHandler(req, res);
				return;
			}
			if (pathname.startsWith("/api/manager-proxy/")) {
				const jackedPath = pathname.slice("/api/manager-proxy".length) || "/";
				const query = requestUrl.search;
				const method = (req.method ?? "GET").toUpperCase();
				let body: string | null = null;
				if (method !== "GET" && method !== "HEAD") {
					try {
						body = await readRequestBody(req, 1024 * 1024);
					} catch {
						res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ error: "Request body too large" }));
						return;
					}
				}
				const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;
				const proxied = await deps.manager.client.proxyRequest(method, `${jackedPath}${query}`, body, contentType);
				res.writeHead(proxied.status, {
					"Content-Type": proxied.contentType,
					"Cache-Control": "no-store",
				});
				res.end(proxied.body);
				return;
			}
			if (pathname.startsWith("/api/html-proxy/")) {
				const htmlPath = pathname.slice("/api/html-proxy".length) || "/";
				const query = requestUrl.search;
				const method = (req.method ?? "GET").toUpperCase();
				let body: string | null = null;
				if (method !== "GET" && method !== "HEAD") {
					try {
						body = await readRequestBody(req, HTML_PROXY_MAX_BODY_BYTES);
					} catch {
						res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ error: "Request body too large" }));
						return;
					}
				}
				const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;
				const proxied = await deps.html.client.proxyRequest(method, `${htmlPath}${query}`, body, contentType);
				res.writeHead(proxied.status, {
					"Content-Type": proxied.contentType,
					"Cache-Control": "no-store",
				});
				res.end(proxied.body);
				return;
			}
			if (pathname === "/api/html/generate" && (req.method ?? "GET").toUpperCase() === "POST") {
				let rawBody: string;
				try {
					rawBody = await readRequestBody(req, 2 * 1024 * 1024);
				} catch {
					res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}
				let parsedBody: unknown;
				try {
					parsedBody = JSON.parse(rawBody);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "invalid JSON body" }));
					return;
				}
				const parsed = RuntimeHtmlGenerateRequestSchema.safeParse(parsedBody);
				if (!parsed.success) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: parsed.error.message }));
					return;
				}
				const input = parsed.data;
				let prompt: string;
				let agentCwd: string | undefined;
				let allowedTools: string[] | undefined;
				if (input.templateId) {
					const promptResult = await deps.html.client.fetchPrompt({
						templateId: input.templateId,
						content: input.content,
						format: input.format,
						editFromHtml: input.editFromHtml,
						editFromContent: input.editFromContent,
						editDiff: input.editDiff,
					});
					if (!promptResult.ok) {
						const { status, error } = describeHtmlPromptFailure(promptResult.failure);
						res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ error }));
						return;
					}
					prompt = promptResult.value.prompt;
					// Resolved before the SSE headers go out so a plan-lookup failure can
					// still answer with JSON instead of corrupting the stream.
					const plan = input.planId ? await findSavedPlanById(input.planId).catch(() => null) : null;
					agentCwd = resolveHtmlAgentCwd({ cwd: input.cwd, planPath: plan?.path });
					// Same reasoning as the brief route: a one-shot `-p` run has no UI to
					// answer a permission prompt, so the grant is explicit — and falls back
					// to HTML_NO_TOOLS rather than undefined when the template didn't declare
					// `allow_read`, so --allowedTools is always present on the command line
					// instead of leaving the run to hang on a stray permission prompt.
					allowedTools = resolveHtmlAllowedTools(promptResult.value.template.allowRead, HTML_NO_TOOLS);
				} else {
					// No template picked: the markdown is the spec and the prompt is built
					// here, so this path never touches the sidecar — freestyle generation
					// keeps working with the template registry offline.
					const run = await resolveFreestyleGenerateRun({
						...(input.planId === undefined ? {} : { planId: input.planId }),
						content: input.content,
						...(input.format === undefined ? {} : { format: input.format }),
						...(input.editFromHtml === undefined ? {} : { editFromHtml: input.editFromHtml }),
						...(input.editDiff === undefined ? {} : { editDiff: input.editDiff }),
						...(input.editFromContent === undefined ? {} : { editFromContent: input.editFromContent }),
						warn: deps.warn,
					});
					prompt = run.prompt;
					// An explicit caller `cwd` still wins; otherwise the plan's own folder, which is
					// what makes the markdown's relative image links resolvable agent-side.
					agentCwd = input.cwd ?? run.cwd;
					allowedTools = run.allowedTools;
				}

				res.writeHead(200, {
					"Content-Type": "text/event-stream; charset=utf-8",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});

				const abortCtl = new AbortController();
				req.on("close", () => abortCtl.abort());
				const send = (event: string, data: unknown) => {
					if (res.writableEnded) return;
					res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				};

				await runAgentOneShot({
					agentId: "claude",
					prompt,
					cwd: agentCwd,
					model: input.model,
					allowedTools,
					// Watchdog for the same stall class the brief route guards against: a
					// stray permission prompt (or a template whose --allowedTools grant
					// still leaves an opening for one) has no UI to answer it, and without
					// a timeout it would hang the SSE stream until the client gives up.
					idleTimeoutMs: HTML_AGENT_IDLE_TIMEOUT_MS,
					timeoutMs: HTML_AGENT_HARD_TIMEOUT_MS,
					signal: abortCtl.signal,
					onEvent: (event) => {
						send(event.type, event);
					},
					pinInput: buildHtmlAgentPinInput(input.managerAccountId),
				});
				if (!res.writableEnded) {
					res.end();
				}
				return;
			}
			if (pathname === "/api/html/brief" && (req.method ?? "GET").toUpperCase() === "POST") {
				let rawBody: string;
				try {
					rawBody = await readRequestBody(req, 2 * 1024 * 1024);
				} catch {
					res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}
				let parsedBody: unknown;
				try {
					parsedBody = JSON.parse(rawBody);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "invalid JSON body" }));
					return;
				}
				const parsed = RuntimeHtmlBriefRequestSchema.safeParse(parsedBody);
				if (!parsed.success) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: parsed.error.message }));
					return;
				}
				const input = parsed.data;
				// No sidecar round-trip: expansion runs before a template is involved,
				// so a dead sidecar must not block it.
				let briefPrompt: string;
				let briefCwd: string | undefined;
				let briefAssetCount = 0;
				try {
					const planContext = await resolveBriefPlanContext(input.planId, input.content);
					briefCwd = planContext.cwd;
					briefAssetCount = planContext.assetPaths.length;
					briefPrompt = buildBriefPrompt({
						promptMasterBody: await loadPromptMasterBody(),
						content: input.content,
						assetPaths: planContext.assetPaths,
						unresolvedLinks: planContext.unresolvedLinks,
						...(input.templateId ? { templateId: input.templateId } : {}),
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: message }));
					return;
				}

				res.writeHead(200, {
					"Content-Type": "text/event-stream; charset=utf-8",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});

				const abortCtl = new AbortController();
				req.on("close", () => abortCtl.abort());
				const send = (event: string, data: unknown) => {
					if (res.writableEnded) return;
					res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				};

				await runAgentOneShot({
					agentId: "claude",
					prompt: briefPrompt,
					cwd: briefCwd,
					model: input.model,
					// Same reasoning as a template's `allow_read`: a one-shot `-p` run has
					// no UI to answer a permission prompt, so the grant is explicit — and
					// falls back to HTML_NO_TOOLS rather than undefined when there is no
					// image to open, so --allowedTools is always present on the command
					// line and a stray tool call is denied fast instead of prompting.
					allowedTools: resolveHtmlAllowedTools(briefAssetCount > 0, HTML_NO_TOOLS),
					// Watchdog for the stall this route exists to prevent: a plan whose
					// image link cannot be resolved still shows the model an `![](…)`
					// link in the prompt text, and without a timeout a stray permission
					// prompt would hang the SSE stream until the client gives up.
					idleTimeoutMs: HTML_AGENT_IDLE_TIMEOUT_MS,
					timeoutMs: HTML_AGENT_HARD_TIMEOUT_MS,
					signal: abortCtl.signal,
					onEvent: (event) => {
						send(event.type, event);
					},
					pinInput: buildHtmlAgentPinInput(input.managerAccountId),
				});
				if (!res.writableEnded) {
					res.end();
				}
				return;
			}
			if (pathname === "/api/html/draft" && (req.method ?? "GET").toUpperCase() === "POST") {
				let rawBody: string;
				try {
					rawBody = await readRequestBody(req, 2 * 1024 * 1024);
				} catch {
					res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}
				let parsedBody: unknown;
				try {
					parsedBody = JSON.parse(rawBody);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "invalid JSON body" }));
					return;
				}
				const parsed = RuntimeHtmlDraftRequestSchema.safeParse(parsedBody);
				if (!parsed.success) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: parsed.error.message }));
					return;
				}
				const input = parsed.data;
				// Only for the cwd: a missing plan is not fatal here, since the
				// instruction and the document both travel in the prompt.
				const plan = await findSavedPlanById(input.planId).catch(() => null);
				const draftPrompt = buildDraftPrompt({
					instruction: input.instruction,
					context: input.context,
					...(input.selection === undefined ? {} : { selection: input.selection }),
				});

				res.writeHead(200, {
					"Content-Type": "text/event-stream; charset=utf-8",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});

				const abortCtl = new AbortController();
				req.on("close", () => abortCtl.abort());
				const send = (event: string, data: unknown) => {
					if (res.writableEnded) return;
					res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				};

				await runAgentOneShot({
					agentId: "claude",
					prompt: draftPrompt,
					cwd: resolveHtmlAgentCwd({ planPath: plan?.path }),
					model: input.model,
					// Unlike the brief route, this pass opens nothing: it is handed the
					// document it edits. HTML_NO_TOOLS still goes on the command line so a
					// stray tool call is denied fast instead of prompting into a void.
					allowedTools: resolveHtmlAllowedTools(false, HTML_NO_TOOLS),
					idleTimeoutMs: HTML_AGENT_IDLE_TIMEOUT_MS,
					timeoutMs: HTML_AGENT_HARD_TIMEOUT_MS,
					signal: abortCtl.signal,
					onEvent: (event) => {
						send(event.type, event);
					},
					pinInput: buildHtmlAgentPinInput(input.managerAccountId),
				});
				if (!res.writableEnded) {
					res.end();
				}
				return;
			}
			if (pathname.startsWith("/api/doc-skill-proxy/")) {
				const docSkillPath = pathname.slice("/api/doc-skill-proxy".length) || "/";
				const query = requestUrl.search;
				const method = (req.method ?? "GET").toUpperCase();
				let body: string | null = null;
				if (method !== "GET" && method !== "HEAD") {
					try {
						body = await readRequestBody(req, 1024 * 1024);
					} catch {
						res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ error: "Request body too large" }));
						return;
					}
				}
				const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;
				// Build proxies (POST .../build) can take up to ~120s server-side; give this
				// passthrough enough headroom rather than the client's default short timeout.
				const timeoutMs = docSkillPath.endsWith("/build") ? BUILD_REQUEST_TIMEOUT_MS : undefined;
				const proxied = await deps.docSkill.client.proxyRequest(
					method,
					`${docSkillPath}${query}`,
					body,
					contentType,
					timeoutMs,
				);
				res.writeHead(proxied.status, {
					"Content-Type": proxied.contentType,
					"Cache-Control": "no-store",
				});
				res.end(proxied.body);
				return;
			}
			if (pathname === "/api/doc-skill/audit" && (req.method ?? "GET").toUpperCase() === "POST") {
				let rawBody: string;
				try {
					rawBody = await readRequestBody(req, 1024 * 1024);
				} catch {
					res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}
				let parsedBody: unknown;
				try {
					parsedBody = JSON.parse(rawBody);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "invalid JSON body" }));
					return;
				}
				const parsed = RuntimeDocAuditRequestSchema.safeParse(parsedBody);
				if (!parsed.success) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: parsed.error.message }));
					return;
				}
				const input = parsed.data;

				const docSkillRoot = findDocSkillRoot();
				const skillText = docSkillRoot ? loadDocSkillText(docSkillRoot) : null;
				if (!skillText) {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Docs skill bundle not found next to the runtime." }));
					return;
				}
				const prompt = buildDocAuditPrompt({
					skillText,
					targetRepo: input.targetRepo,
					workspaceDir: input.workspaceDir,
					focus: input.focus,
				});

				res.writeHead(200, {
					"Content-Type": "text/event-stream; charset=utf-8",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});

				const abortCtl = new AbortController();
				req.on("close", () => abortCtl.abort());
				const send = (event: string, data: unknown) => {
					if (res.writableEnded) return;
					res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				};

				await runAgentOneShot({
					agentId: "claude",
					prompt,
					cwd: resolveDocSkillAgentCwd({ targetRepo: input.targetRepo }),
					model: input.model,
					allowedTools: DOC_SKILL_ALLOWED_TOOLS,
					signal: abortCtl.signal,
					onEvent: (event) => {
						send(event.type, event);
					},
					pinInput: buildHtmlAgentPinInput(input.managerAccountId),
				});
				if (!res.writableEnded) {
					res.end();
				}
				return;
			}
			if (pathname === "/api/doc-skill/round" && (req.method ?? "GET").toUpperCase() === "POST") {
				let rawBody: string;
				try {
					rawBody = await readRequestBody(req, 1024 * 1024);
				} catch {
					res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}
				let parsedBody: unknown;
				try {
					parsedBody = JSON.parse(rawBody);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "invalid JSON body" }));
					return;
				}
				const parsed = RuntimeDocRoundRequestSchema.safeParse(parsedBody);
				if (!parsed.success) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: parsed.error.message }));
					return;
				}
				const input = parsed.data;

				const docSkillRoot = findDocSkillRoot();
				const skillText = docSkillRoot ? loadDocSkillText(docSkillRoot) : null;
				if (!skillText) {
					res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Docs skill bundle not found next to the runtime." }));
					return;
				}
				const prompt = buildDocRoundPrompt({
					skillText,
					targetRepo: input.targetRepo,
					workspaceDir: input.workspaceDir,
				});

				res.writeHead(200, {
					"Content-Type": "text/event-stream; charset=utf-8",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});

				const abortCtl = new AbortController();
				req.on("close", () => abortCtl.abort());
				const send = (event: string, data: unknown) => {
					if (res.writableEnded) return;
					res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				};

				await runAgentOneShot({
					agentId: "claude",
					prompt,
					cwd: resolveDocSkillAgentCwd({ targetRepo: input.targetRepo }),
					model: input.model,
					allowedTools: DOC_SKILL_ALLOWED_TOOLS,
					signal: abortCtl.signal,
					onEvent: (event) => {
						send(event.type, event);
					},
					pinInput: buildHtmlAgentPinInput(input.managerAccountId),
				});
				if (!res.writableEnded) {
					res.end();
				}
				return;
			}
			if (pathname === "/api/review/rules-extract" && (req.method ?? "GET").toUpperCase() === "POST") {
				await handleAgentStreamRoute(req, res, {
					buildPinInput: buildHtmlAgentPinInput,
					schema: runtimeReviewRulesExtractRequestSchema,
					buildRun: async (input) => ({
						ok: true,
						prompt: buildRulesExtractPrompt({ sourceRoots: input.sourceRoots }),
						// No cwd: the source roots are absolute paths into another repo
						// entirely, so there is no single directory to anchor to.
						model: input.model,
						allowedTools: REVIEW_RULES_EXTRACT_ALLOWED_TOOLS,
						managerAccountId: input.managerAccountId,
						// The stream is the reviewer's progress view; this is what the audit
						// actually reads back.
						onComplete: async (text) => {
							await persistExtractedRules({
								projectKey: input.projectKey,
								sourceRoots: input.sourceRoots,
								text,
							});
						},
					}),
				});
				return;
			}
			if (pathname === "/api/review/audit" && (req.method ?? "GET").toUpperCase() === "POST") {
				await handleAgentStreamRoute(req, res, {
					buildPinInput: buildHtmlAgentPinInput,
					schema: runtimeReviewAuditRequestSchema,
					// Patches travel inline, so this body is the largest of the three.
					maxBodyBytes: 8 * 1024 * 1024,
					buildRun: async (input) => {
						const bundle = await readReviewRulesBundle(input.projectKey);
						if (!bundle || bundle.rules.length === 0) {
							// Auditing with no rules would produce generic review commentary
							// under a banner that claims it checked the team's rules.
							return {
								ok: false,
								status: 409,
								error: "No rules have been extracted for this project yet. Refresh the rules first.",
							};
						}
						const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
						// The audit used to run with no cwd at all — the rules were inline and the
						// patches were inline, so there was nothing to anchor to. The knowledge
						// graph is the thing that changed that: it lives in the checkout, so the
						// pass needs to know which checkout.
						const cwd = resolveReviewAgentCwd({
							cwd: input.cwd,
							projectPath: activeWorkspaceId
								? deps.workspaceRegistry.getWorkspacePathById(activeWorkspaceId)
								: null,
						});
						// The audit is the reviewer pressing a button on a specific merge request,
						// so it is also the right moment to refresh the dashboard's overlay.
						const graphImpact = await buildReviewGraphPromptSection({
							projectPath: cwd,
							changedPaths: input.files.map((file) => file.newPath),
							baseBranch: input.targetBranch,
							writeDiffOverlay: true,
						});
						return {
							ok: true,
							prompt: buildAuditPrompt({
								title: input.title,
								sourceBranch: input.sourceBranch,
								targetBranch: input.targetBranch,
								rules: bundle.rules,
								files: input.files,
								...(graphImpact === undefined ? {} : { graphImpact }),
								...(input.annotations === undefined ? {} : { annotations: input.annotations }),
							}),
							...(cwd === undefined ? {} : { cwd }),
							model: input.model,
							allowedTools: REVIEW_AUDIT_ALLOWED_TOOLS,
							managerAccountId: input.managerAccountId,
						};
					},
				});
				return;
			}
			if (pathname === "/api/review/chat" && (req.method ?? "GET").toUpperCase() === "POST") {
				await handleAgentStreamRoute(req, res, {
					buildPinInput: buildHtmlAgentPinInput,
					schema: runtimeReviewChatRequestSchema,
					buildRun: async (input) => {
						const isFirstTurn = input.resumeSessionId === undefined;
						// Skipped entirely on a resumed turn: the merge-request context is already
						// in the CLI session, so this round trip would buy nothing.
						const mergeRequest = isFirstTurn
							? (await gitlabApi.getMergeRequest({ projectId: input.projectId, iid: input.iid })).mergeRequest
							: null;
						const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
						const cwd = resolveReviewAgentCwd({
							cwd: input.cwd,
							// The active project's checkout, so the project's own `.claude/commands`
							// and codebase questions resolve against the repo the reviewer is
							// looking at. It is *not* where the branch under review lives — that is
							// only in the prompt, which is why the built-in review commands are
							// expanded locally instead (`review-command-expansion.ts`).
							projectPath: activeWorkspaceId
								? deps.workspaceRegistry.getWorkspacePathById(activeWorkspaceId)
								: null,
						});
						// First turn, like the diff below it — re-sending it per message is what
						// made this panel expensive in the first place — plus any turn running a
						// command whose answer is meant to be read off the brief. The walk itself
						// is deterministic TypeScript, so the only cost is prompt characters. The
						// chat never writes the overlay: the reviewer did not ask for a file to
						// change.
						const graphImpact =
							isFirstTurn || reviewCommandNeedsGraphImpact(input.prompt)
								? await buildReviewGraphPromptSection({
										projectPath: cwd,
										changedPaths: input.changedPaths,
										baseBranch: mergeRequest?.targetBranch ?? "unknown",
									})
								: undefined;
						// Only the whole-merge-request review asks for these. A missing bundle is
						// not an error: the expansion says "no house style to check against"
						// instead, which is the honest instruction.
						const rules = reviewCommandNeedsRules(input.prompt)
							? ((await readReviewRulesBundle(input.projectKey))?.rules ?? undefined)
							: undefined;
						return {
							ok: true,
							prompt: buildChatPrompt({
								prompt: input.prompt,
								// Falling back rather than failing: a chat turn about the diff is
								// still useful when GitLab is briefly unreachable.
								title: mergeRequest?.title ?? `!${input.iid}`,
								sourceBranch: mergeRequest?.sourceBranch ?? "unknown",
								targetBranch: mergeRequest?.targetBranch ?? "unknown",
								changedPaths: input.changedPaths,
								activeDiff: input.activeDiff,
								allDiffs: input.allDiffs,
								screen: input.screen,
								visible: input.visible,
								isFirstTurn,
								expectSuggestions: input.expectSuggestions,
								...(graphImpact === undefined ? {} : { graphImpact }),
								...(rules === undefined ? {} : { rules }),
								...(input.annotations === undefined ? {} : { annotations: input.annotations }),
							}),
							...(cwd === undefined ? {} : { cwd }),
							model: input.model,
							allowedTools: REVIEW_CHAT_ALLOWED_TOOLS,
							managerAccountId: input.managerAccountId,
							appendSystemPrompt: REVIEW_CHAT_SYSTEM_PROMPT,
							resumeSessionId: input.resumeSessionId,
						};
					},
				});
				return;
			}
			if (pathname === "/api/review/graph-rebuild" && (req.method ?? "GET").toUpperCase() === "POST") {
				// Hand-rolled rather than `handleAgentStreamRoute`, because the stream
				// belongs to a background job and not to this request: the job outlives
				// the connection, and closing the browser must not cancel a build.
				let rawBody: string;
				try {
					// Same cap as this file's other review routes. The body is a path and
					// two optional ids; before this it had no cap at all.
					rawBody = await readRequestBody(req, 1024 * 1024);
				} catch {
					res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}

				let parsedBody: unknown;
				try {
					parsedBody = JSON.parse(rawBody || "{}");
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "invalid JSON body" }));
					return;
				}

				const parsed = runtimeReviewGraphRebuildRequestSchema.safeParse(parsedBody);
				if (!parsed.success) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: parsed.error.message }));
					return;
				}

				try {
					const started = reviewGraphRebuildService.startOrAttachJob({
						projectPath: parsed.data.projectPath,
						model: parsed.data.model,
						effort: parsed.data.effort,
						managerAccountId: parsed.data.managerAccountId,
						...(parsed.data.force === undefined ? {} : { force: parsed.data.force }),
						buildPinInput: buildHtmlAgentPinInput,
					});

					res.writeHead(200, {
						"Content-Type": "text/event-stream; charset=utf-8",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
						"X-Accel-Buffering": "no",
					});

					const write = (event: string, data: unknown): void => {
						if (res.writableEnded) {
							return;
						}
						res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
					};

					// Sent before the replay so the client knows whether it owns this
					// build or joined one already in flight — the difference between
					// "starting…" and a job that has been paused since before the tab
					// was opened, which used to be indistinguishable.
					write("meta", {
						type: "meta",
						key: "rebuild_attached",
						value: {
							attached: started.attached,
							status: started.job.status,
							startedAt: started.job.startedAt,
							pausedAt: started.job.pausedAt,
						},
					});

					const unsubscribe = reviewGraphRebuildService.subscribe(parsed.data.projectPath, (event, data) => {
						write(event, data);
						if (event === "done" && !res.writableEnded) {
							res.end();
						}
					});

					req.on("close", () => {
						unsubscribe();
					});
				} catch (error) {
					if (!res.headersSent) {
						res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
					}
				}
				return;
			}
			if (pathname === "/api/review/suggest-comment" && (req.method ?? "GET").toUpperCase() === "POST") {
				await handleAgentStreamRoute(req, res, {
					buildPinInput: buildHtmlAgentPinInput,
					schema: runtimeReviewSuggestCommentRequestSchema,
					buildRun: async (input) => {
						const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
						return {
							ok: true,
							prompt: buildSuggestionRewritePrompt({
								rawText: input.rawText,
								newPath: input.newPath,
								line: input.line,
								diffExcerpt: input.diffExcerpt,
							}),
							cwd: resolveReviewAgentCwd({
								cwd: input.cwd,
								projectPath: activeWorkspaceId
									? deps.workspaceRegistry.getWorkspacePathById(activeWorkspaceId)
									: null,
							}),
							model: input.model,
							allowedTools: REVIEW_SUGGEST_ALLOWED_TOOLS,
							managerAccountId: input.managerAccountId,
						};
					},
				});
				return;
			}
			if (pathname === "/api/plans/asset") {
				const planId = requestUrl.searchParams.get("planId");
				const relativePath = requestUrl.searchParams.get("path");
				if (!planId || !relativePath) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end('{"error":"Missing planId or path"}');
					return;
				}
				try {
					const asset = await readSavedPlanAsset(planId, relativePath);
					res.writeHead(200, {
						"Content-Type": asset.contentType,
						"Cache-Control": "no-store",
					});
					res.end(asset.content);
				} catch {
					res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
					res.end('{"error":"Not found"}');
				}
				return;
			}
			// Path-style twin of `/api/plans/asset`, so the plan editor's HTML preview can carry
			// a `<base href="/api/plans/<planId>/file/">`: a `srcDoc` iframe resolves relative
			// URLs against `about:srcdoc`, which breaks every relative image the generated HTML
			// references. A query-string route cannot serve as a base URL.
			const planFileMatch = /^\/api\/plans\/([^/]+)\/file\/(.+)$/.exec(pathname);
			if (planFileMatch) {
				const planId = decodeURIComponent(planFileMatch[1] ?? "");
				const relativePath = decodeURIComponent(planFileMatch[2] ?? "");
				if (!planId || !relativePath) {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end('{"error":"Missing planId or path"}');
					return;
				}
				try {
					const planFile = await readSavedPlanAsset(planId, relativePath);
					res.writeHead(200, {
						"Content-Type": planFile.contentType,
						"Cache-Control": "no-store",
					});
					res.end(planFile.content);
				} catch {
					res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
					res.end('{"error":"Not found"}');
				}
				return;
			}
			if (pathname.startsWith("/api/")) {
				res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
				res.end('{"error":"Not found"}');
				return;
			}

			const asset = await readAsset(webUiDir, pathname);
			res.writeHead(200, {
				"Content-Type": asset.contentType,
				"Cache-Control": "no-store",
			});
			res.end(asset.content);
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Not Found");
		}
	};
	const server = tlsConfig
		? createHttpsServer({ key: tlsConfig.key, cert: tlsConfig.cert }, requestHandler)
		: createServer(requestHandler);
	server.on("upgrade", (request, socket, head) => {
		if (handleSocketUpgrade(request, socket).end) {
			return;
		}

		let requestUrl: URL;
		try {
			requestUrl = new URL(request.url ?? "/", getKanbanRuntimeOrigin());
		} catch {
			socket.destroy();
			return;
		}
		if (normalizeRequestPath(requestUrl.pathname) !== "/api/runtime/ws") {
			return;
		}
		// ── Auth gate for WebSocket upgrades ─────────────────────────────────
		if (authMode !== "off") {
			const sessionToken = extractSessionTokenFromCookie(request.headers.cookie);
			const sessionAuth = sessionToken !== null && validateSession(sessionToken);
			const bearerToken = extractBearerToken(request.headers.authorization);
			const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
			if (!sessionAuth && !internalAuth) {
				socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
		}
		// ── End auth gate ───────────────────────────────────────────────────
		(request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled = true;
		const requestedWorkspaceId = requestUrl.searchParams.get("workspaceId")?.trim() || null;
		deps.runtimeStateHub.handleUpgrade(request, socket, head, { requestedWorkspaceId });
	});
	const terminalWebSocketBridge = createTerminalWebSocketBridge({
		server,
		resolveTerminalManager: (workspaceId) => deps.workspaceRegistry.getTerminalManagerForWorkspace(workspaceId),
		isTerminalIoWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/io",
		isTerminalControlWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/control",
		validateUpgradeSession:
			authMode !== "off"
				? (cookieHeader) => {
						const token = extractSessionTokenFromCookie(cookieHeader);
						return token !== null && validateSession(token);
					}
				: undefined,
	});
	server.on("upgrade", (request, socket) => {
		const handled = (request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled;
		if (handled) {
			return;
		}
		socket.destroy();
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(getKanbanRuntimePort(), getKanbanRuntimeHost(), () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to start local server.");
	}
	// Drive auto-pause/continue for usage-limited tasks. Safe no-op when nothing opts in:
	// the poll skips jacked entirely on ticks with no candidate sessions.
	usageResumeScheduler.start();
	const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
	const url = activeWorkspaceId
		? buildKanbanRuntimeUrl(`/${encodeURIComponent(activeWorkspaceId)}`)
		: getKanbanRuntimeOrigin();

	return {
		url,
		close: async () => {
			usageResumeScheduler.stop();
			await Promise.all(
				Array.from(clineTaskSessionServiceByWorkspaceId.values()).map(async (service) => {
					await service.dispose();
				}),
			);
			clineTaskSessionServiceByWorkspaceId.clear();
			await clineWatcherRegistry.close();
			await deps.runtimeStateHub.close();
			deps.manager.monitor.close();
			await terminalWebSocketBridge.close();
			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => {
					if (error) {
						rejectClose(error);
						return;
					}
					resolveClose();
				});
			});
		},
	};
}
