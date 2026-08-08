// Client for the docs-pipeline sidecar on 127.0.0.1:8323.
// Optional companion: every call resolves to null / a typed failure instead
// of throwing when the port is closed, matching html-client.ts's contract.

const DEFAULT_BASE_URL = "http://127.0.0.1:8323";
const REQUEST_TIMEOUT_MS = 4000;
// The sidecar's own build timeout is 120s server-side; give it headroom so a
// slow-but-succeeding build isn't cut off client-side first.
export const BUILD_REQUEST_TIMEOUT_MS = 130_000;

/**
 * Why this is a discriminated union rather than `null`: an unreachable port, a
 * timeout and a `400` are three different operator problems, and collapsing
 * them into one message sends people hunting for a dead port when the sidecar
 * was up and answering. Callers map each `kind` to its own status and text.
 */
export type DocSkillFailure =
	| { kind: "unreachable"; baseUrl: string; message: string }
	| { kind: "timeout"; baseUrl: string; timeoutMs: number }
	| { kind: "http"; status: number; body: string }
	| { kind: "malformed"; body: string };

export type DocSkillResult<T> = { ok: true; value: T } | { ok: false; failure: DocSkillFailure };

export interface DocSkillProjectSummary {
	id: string;
	name: string;
	targetRepo: string;
	workspaceDir: string;
	tagline: string;
	createdAt: string;
	hasSite: boolean;
	docCount: number;
	lastBuildAt: string | null;
}

export interface DocSkillClient {
	baseUrl: string;
	status: () => Promise<{ online: boolean; version?: string }>;
	listProjects: () => Promise<DocSkillProjectSummary[] | null>;
	createProject: (input: {
		name: string;
		targetRepo: string;
		workspaceDir: string;
		sources: string[];
		tagline?: string;
	}) => Promise<DocSkillResult<DocSkillProjectSummary>>;
	proxyRequest: (
		method: string,
		path: string,
		body?: string | null,
		contentType?: string | null,
		timeoutMs?: number,
	) => Promise<{ status: number; body: string; contentType: string }>;
}

export interface CreateDocSkillClientDependencies {
	baseUrl?: string;
	warn: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === "string" ? value : null;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
	return source[key] === true;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseProjectSummary(raw: unknown): DocSkillProjectSummary | null {
	if (!isRecord(raw)) {
		return null;
	}
	const id = readString(raw, "id");
	const name = readString(raw, "name");
	const targetRepo = readString(raw, "targetRepo");
	const workspaceDir = readString(raw, "workspaceDir");
	const createdAt = readString(raw, "createdAt");
	if (!id || !name || !targetRepo || !workspaceDir || !createdAt) {
		return null;
	}
	return {
		id,
		name,
		targetRepo,
		workspaceDir,
		tagline: readString(raw, "tagline") ?? "",
		createdAt,
		hasSite: readBoolean(raw, "hasSite"),
		docCount: readNumber(raw, "docCount") ?? 0,
		lastBuildAt: readString(raw, "lastBuildAt"),
	};
}

export function createDocSkillClient(deps: CreateDocSkillClientDependencies): DocSkillClient {
	const baseUrl = (deps.baseUrl ?? process.env.PIXELOFFICE_DOCSKILL_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");

	type RequestOptions = {
		body?: string | null;
		contentType?: string | null;
		timeoutMs?: number;
	};
	type RequestOutcome =
		| { ok: true; status: number; body: string; contentType: string }
		| { ok: false; timedOut: boolean; message: string };

	const requestDetailed = async (method: string, path: string, options?: RequestOptions): Promise<RequestOutcome> => {
		const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const headers: Record<string, string> = {};
			if (options?.body != null && options.contentType) {
				headers["Content-Type"] = options.contentType;
			}
			const response = await fetch(`${baseUrl}${path}`, {
				method,
				headers,
				body: options?.body ?? undefined,
				signal: controller.signal,
			});
			const contentType = response.headers.get("content-type") ?? "application/json; charset=utf-8";
			const body = await response.text();
			return { ok: true, status: response.status, body, contentType };
		} catch (error) {
			const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
			const message = error instanceof Error ? error.message : String(error);
			const timedOut = controller.signal.aborted;
			if (!timedOut) {
				deps.warn(`Docs sidecar request ${method} ${path} failed: ${cause ?? message}`);
			}
			return { ok: false, timedOut, message: cause ?? message };
		} finally {
			clearTimeout(timeout);
		}
	};

	const request = async (
		method: string,
		path: string,
		options?: RequestOptions,
	): Promise<{ status: number; body: string; contentType: string } | null> => {
		const outcome = await requestDetailed(method, path, options);
		return outcome.ok ? { status: outcome.status, body: outcome.body, contentType: outcome.contentType } : null;
	};

	return {
		baseUrl,
		status: async () => {
			const result = await request("GET", "/api/health");
			if (!result || result.status < 200 || result.status >= 300) {
				return { online: false };
			}
			try {
				const parsed: unknown = JSON.parse(result.body);
				const version = isRecord(parsed) ? readString(parsed, "version") : null;
				return { online: true, ...(version ? { version } : {}) };
			} catch {
				return { online: true };
			}
		},
		listProjects: async () => {
			const result = await request("GET", "/api/projects");
			if (!result || result.status < 200 || result.status >= 300) {
				return null;
			}
			try {
				const parsed: unknown = JSON.parse(result.body);
				if (!Array.isArray(parsed)) {
					return null;
				}
				const projects: DocSkillProjectSummary[] = [];
				for (const item of parsed) {
					const project = parseProjectSummary(item);
					if (project) {
						projects.push(project);
					}
				}
				return projects;
			} catch {
				return null;
			}
		},
		createProject: async (input) => {
			const outcome = await requestDetailed("POST", "/api/projects", {
				body: JSON.stringify(input),
				contentType: "application/json",
			});
			if (!outcome.ok) {
				return {
					ok: false,
					failure: outcome.timedOut
						? { kind: "timeout", baseUrl, timeoutMs: REQUEST_TIMEOUT_MS }
						: { kind: "unreachable", baseUrl, message: outcome.message },
				};
			}
			if (outcome.status < 200 || outcome.status >= 300) {
				return {
					ok: false,
					failure: { kind: "http", status: outcome.status, body: outcome.body.slice(0, 500) },
				};
			}
			try {
				const parsed: unknown = JSON.parse(outcome.body);
				const project = parseProjectSummary(parsed);
				if (!project) {
					return { ok: false, failure: { kind: "malformed", body: outcome.body.slice(0, 500) } };
				}
				return { ok: true, value: project };
			} catch {
				return { ok: false, failure: { kind: "malformed", body: outcome.body.slice(0, 500) } };
			}
		},
		proxyRequest: async (method, path, body, contentType, timeoutMs) => {
			const result = await request(method, path, {
				body,
				contentType,
				timeoutMs: timeoutMs ?? REQUEST_TIMEOUT_MS,
			});
			if (!result) {
				return {
					status: 502,
					body: JSON.stringify({ error: "Docs sidecar unreachable" }),
					contentType: "application/json; charset=utf-8",
				};
			}
			return result;
		},
	};
}
