import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { join } from "node:path";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { handleClineMcpOauthCallback } from "../cline-sdk/cline-mcp-runtime-service";
import {
	type ClineTaskSessionService,
	createInMemoryClineTaskSessionService,
} from "../cline-sdk/cline-task-session-service";
import { createClineWatcherRegistry } from "../cline-sdk/cline-watcher-registry";
import type {
	RuntimeCommandRunResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskSessionSummary,
	RuntimeHostEnvironmentResponse,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { RuntimeHtmlBriefRequestSchema, RuntimeHtmlGenerateRequestSchema } from "../core/api-contract";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeTls,
	isKanbanRemoteHost,
} from "../core/runtime-endpoint";
import { buildBriefPrompt, loadPromptMasterBody } from "../html/html-brief";
import type { HtmlClient, HtmlPromptFailure } from "../html/html-client";
import {
	createUsageResumeScheduler,
	isUsageResumeCandidate,
	type PausableSession,
} from "../jacked/usage-resume-scheduler";
import type { ManagerClient } from "../manager/manager-client";
import {
	pickDefaultClaudeAccountId,
	pickDefaultCursorAccountId,
	toManagerDonateAccount,
} from "../manager/manager-account-pin";
import type { ManagerMonitor } from "../manager/manager-monitor";
import {
	checkRateLimit,
	clearRateLimit,
	extractBearerToken,
	extractSessionTokenFromCookie,
	isPasscodeEnabled,
	issueSession,
	recordFailedAttempt,
	validateInternalToken,
	validatePasscode,
	validateSession,
} from "../security/passcode-manager";
import { findSavedPlanById, readSavedPlanAsset, resolvePlanImageAssets } from "../state/saved-plans";
import { loadWorkspaceContextById, loadWorkspaceState } from "../state/workspace-state";
import { runAgentOneShot } from "../terminal/agent-oneshot";
import { HTML_NO_TOOLS, resolveHtmlAgentCwd, resolveHtmlAllowedTools } from "../html/html-agent-args";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { createTerminalWebSocketBridge } from "../terminal/ws-server";
import { type RuntimeTrpcContext, type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "../trpc/app-router";
import { createHooksApi } from "../trpc/hooks-api";
import { createHtmlApi } from "../trpc/html-api";
import { createManagerApi } from "../trpc/manager-api";
import { createPlansApi } from "../trpc/plans-api";
import { createProjectsApi } from "../trpc/projects-api";
import { createRuntimeApi } from "../trpc/runtime-api";
import { createWorkspaceApi } from "../trpc/workspace-api";
import { getWebUiDir, isWebUiServedExternally, normalizeRequestPath, readAsset } from "./assets";
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
	const getScopedClineTaskSessionService = async (
		scope: RuntimeTrpcWorkspaceScope,
	): Promise<ClineTaskSessionService> => {
		let service = clineTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
		if (!service) {
			service = createInMemoryClineTaskSessionService({
				watcherRegistry: clineWatcherRegistry,
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

	/**
	 * Account-pin wiring shared by every one-shot HTML agent route (`/api/html/brief`,
	 * `/api/html/generate`). Both spend the same Claude seat, so both resolve it the
	 * same way — pinned account when the caller names one, the Manager's active
	 * Claude account otherwise.
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
	 * Watchdog shared by every one-shot HTML agent route (`/api/html/brief` and
	 * `/api/html/generate`). Cancels a run that goes quiet (a stray permission
	 * prompt the one-shot `-p` process cannot answer) and puts a hard ceiling on
	 * the whole request regardless of output. Both routes share one constant pair
	 * rather than duplicating the numbers, since both hang for the exact same
	 * reason: a `-p` run has no UI to answer a permission prompt with.
	 */
	const HTML_AGENT_IDLE_TIMEOUT_MS = 120_000;
	const HTML_AGENT_HARD_TIMEOUT_MS = 10 * 60_000;

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
			return pickDefaultClaudeAccountId({
				accounts: snapshot.accounts,
				activeAccountId: snapshot.activeAccountId,
			});
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
	};

	// One long-lived runtimeApi instance the usage-resume scheduler uses to relaunch
	// (--continue) a task whose Claude usage window has reset. Separate from the
	// per-request instances so it never depends on an inbound HTTP request being in flight.
	const usageResumeRuntimeApi = createRuntimeApi(runtimeApiDeps);

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
			taskLaunchSettings: card?.taskLaunchSettings,
		});
		if (!response.ok) {
			throw new Error(response.error ?? "usage-resume relaunch failed");
		}
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
					});
				}
			};
			for (const { workspaceId, workspacePath, terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
				if (!workspacePath) {
					continue;
				}
				const scope: RuntimeTrpcWorkspaceScope = { workspaceId, workspacePath };
				addFrom(scope, terminalManager.listSummaries(), (taskId, resumeAt) =>
					terminalManager.markUsagePaused(taskId, resumeAt),
				);
				const clineService = clineTaskSessionServiceByWorkspaceId.get(workspaceId);
				if (clineService) {
					addFrom(scope, clineService.listSummaries(), (taskId, resumeAt) =>
						clineService.markUsagePaused(taskId, resumeAt),
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
			hooksApi: createHooksApi({
				getWorkspacePathById: deps.workspaceRegistry.getWorkspacePathById,
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastTaskReadyForReview: deps.runtimeStateHub.broadcastTaskReadyForReview,
			}),
			managerApi,
			htmlApi,
		};
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => await createTrpcContext(req),
	});

	const isRemoteMode = isKanbanRemoteHost();

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

			// ── Passcode gate (remote mode only) ──────────────────────────────
			const passcodeActive = isRemoteMode && isPasscodeEnabled();
			if (pathname === "/api/passcode/status") {
				if (passcodeActive) {
					const token = extractSessionTokenFromCookie(req.headers.cookie);
					const authenticated = token !== null && validateSession(token);
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ required: true, authenticated }));
				} else {
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ required: false, authenticated: true }));
				}
				return;
			}
			if (passcodeActive && req.method === "POST" && pathname === "/api/passcode/verify") {
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
			if (passcodeActive) {
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
			// ── End passcode gate ──────────────────────────────────────────────

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
				const contentType =
					typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;
				const proxied = await deps.manager.client.proxyRequest(
					method,
					`${jackedPath}${query}`,
					body,
					contentType,
				);
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
						body = await readRequestBody(req, 1024 * 1024);
					} catch {
						res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ error: "Request body too large" }));
						return;
					}
				}
				const contentType =
					typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;
				const proxied = await deps.html.client.proxyRequest(
					method,
					`${htmlPath}${query}`,
					body,
					contentType,
				);
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
				const promptResult = await deps.html.client.fetchPrompt({
					templateId: input.templateId,
					content: input.content,
					format: input.format,
					editFromHtml: input.editFromHtml,
					editFromContent: input.editFromContent,
				});
				if (!promptResult.ok) {
					const { status, error } = describeHtmlPromptFailure(promptResult.failure);
					res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error }));
					return;
				}
				// Resolved before the SSE headers go out so a plan-lookup failure can
				// still answer with JSON instead of corrupting the stream.
				const plan = input.planId ? await findSavedPlanById(input.planId).catch(() => null) : null;
				const agentCwd = resolveHtmlAgentCwd({ cwd: input.cwd, planPath: plan?.path });
				// Same reasoning as the brief route: a one-shot `-p` run has no UI to
				// answer a permission prompt, so the grant is explicit — and falls back
				// to HTML_NO_TOOLS rather than undefined when the template didn't declare
				// `allow_read`, so --allowedTools is always present on the command line
				// instead of leaving the run to hang on a stray permission prompt.
				const allowedTools = resolveHtmlAllowedTools(
					promptResult.value.template.allowRead,
					HTML_NO_TOOLS,
				);

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
					prompt: promptResult.value.prompt,
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
		// ── Passcode gate for WebSocket upgrades (remote mode only) ──────────
		const passcodeActive = isRemoteMode && isPasscodeEnabled();
		if (passcodeActive) {
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
		// ── End passcode gate ─────────────────────────────────────────────────
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
			isRemoteMode && isPasscodeEnabled()
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
