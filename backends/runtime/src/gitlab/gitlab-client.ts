// GitLab REST v4 client for the Review surface.
//
// Failure shape is deliberately the same discriminated union `doc-skill-client.ts`
// uses: an unreachable host, a timeout, a 401 and a 422 are four different
// operator problems, and collapsing them into one string sends people to the
// wrong fix. `reauth` is the one addition — it is the only failure the UI can
// resolve by itself (show Connect again).
import {
	type RuntimeGitlabDiffFile,
	type RuntimeGitlabDiffRefs,
	type RuntimeGitlabDiscussion,
	type RuntimeGitlabMergeRequestDetail,
	type RuntimeGitlabMergeRequestSummary,
	type RuntimeGitlabMergeRequestVersion,
	type RuntimeGitlabNote,
	type RuntimeGitlabNotePosition,
	type RuntimeGitlabPipelineStatus,
	type RuntimeGitlabProject,
	runtimeGitlabPipelineStatusSchema,
} from "../core/api-contract";
import { type GitlabCredential, markGitlabCredentialReauthRequired, readGitlabCredential } from "./gitlab-credentials";
import { refreshGitlabCredential } from "./gitlab-oauth";
import { buildTextPosition, countPatchLines } from "./gitlab-position";

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 50;
/**
 * Cap on `/diffs` pages. A 4000-file MR is not reviewable in this UI anyway, and
 * an uncapped walk would hold the request open for minutes; the caller surfaces
 * `truncated` so the limit is visible instead of silent.
 */
const MAX_DIFF_PAGES = 20;
/** Refresh proactively inside this window so a long review does not 401 mid-submit. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

export type GitlabFailure =
	| { kind: "disconnected" }
	| { kind: "reauth"; message: string }
	| { kind: "scope"; accepted: string[] }
	| { kind: "unreachable"; host: string; message: string }
	| { kind: "timeout"; host: string; timeoutMs: number }
	| { kind: "http"; status: number; body: string }
	| { kind: "malformed"; body: string };

export type GitlabResult<T> = { ok: true; value: T } | { ok: false; failure: GitlabFailure };

export function describeGitlabFailure(failure: GitlabFailure): string {
	switch (failure.kind) {
		case "disconnected":
			return "No GitLab account is connected.";
		case "reauth":
			return failure.message;
		case "scope":
			return `The connected GitLab token lacks the scope this needs${
				failure.accepted.length > 0 ? ` (GitLab accepts: ${failure.accepted.join(", ")})` : ""
			}. Reconnect with a personal access token carrying the \`api\` scope.`;
		case "unreachable":
			return `GitLab at ${failure.host} is unreachable: ${failure.message}`;
		case "timeout":
			return `GitLab at ${failure.host} did not respond within ${failure.timeoutMs} ms.`;
		case "http":
			return `GitLab rejected the request (${failure.status}): ${failure.body}`;
		case "malformed":
			return `GitLab returned an unexpected response: ${failure.body}`;
	}
}

/**
 * A 403 carrying `insufficient_scope` is not a permission problem with the
 * project — it is the token being categorically unable to reach the REST API,
 * and the recovery is a different credential rather than a retry. GitLab names
 * the scopes it would have accepted in the body, which is the one useful thing
 * in it, so that is what gets carried forward.
 */
export function toHttpFailure(status: number, body: string): GitlabFailure {
	if (status === 403 && body.includes("insufficient_scope")) {
		let accepted: string[] = [];
		try {
			const parsed: unknown = JSON.parse(body);
			if (isRecord(parsed) && typeof parsed.scope === "string") {
				accepted = parsed.scope.split(/\s+/).filter((scope) => scope.length > 0);
			}
		} catch {
			// A non-JSON body still identified itself as insufficient_scope above; the
			// scope list is a nicety, not the signal.
		}
		return { kind: "scope", accepted };
	}
	return { kind: "http", status, body: body.slice(0, 500) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === "string" ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
	return source[key] === true;
}

function readNestedString(source: Record<string, unknown>, key: string, nested: string): string | null {
	const value = source[key];
	return isRecord(value) ? readString(value, nested) : null;
}

function normalizeHost(host: string): string {
	return host.replace(/\/+$/, "");
}

function parsePipelineStatus(raw: unknown): RuntimeGitlabPipelineStatus | null {
	if (!isRecord(raw)) {
		return null;
	}
	const status = readString(raw, "status");
	if (!status) {
		return null;
	}
	const parsed = runtimeGitlabPipelineStatusSchema.safeParse(status);
	// A status GitLab adds later should read as "unknown", not drop the whole MR.
	return parsed.success ? parsed.data : "unknown";
}

export function parseProject(raw: unknown): RuntimeGitlabProject | null {
	if (!isRecord(raw)) {
		return null;
	}
	const id = readNumber(raw, "id");
	const pathWithNamespace = readString(raw, "path_with_namespace");
	if (id === null || !pathWithNamespace) {
		return null;
	}
	return {
		id,
		pathWithNamespace,
		name: readString(raw, "name") ?? pathWithNamespace,
		webUrl: readString(raw, "web_url") ?? "",
		defaultBranch: readString(raw, "default_branch"),
		lastActivityAt: readString(raw, "last_activity_at"),
	};
}

export function parseMergeRequestSummary(raw: unknown): RuntimeGitlabMergeRequestSummary | null {
	if (!isRecord(raw)) {
		return null;
	}
	const projectId = readNumber(raw, "project_id");
	const iid = readNumber(raw, "iid");
	const sourceBranch = readString(raw, "source_branch");
	const targetBranch = readString(raw, "target_branch");
	if (projectId === null || iid === null || !sourceBranch || !targetBranch) {
		return null;
	}
	return {
		projectId,
		iid,
		title: readString(raw, "title") ?? `!${iid}`,
		description: readString(raw, "description") ?? "",
		state: readString(raw, "state") ?? "unknown",
		// GitLab renamed `work_in_progress` to `draft`; older instances send only the former.
		draft: readBoolean(raw, "draft") || readBoolean(raw, "work_in_progress"),
		authorUsername: readNestedString(raw, "author", "username"),
		sourceBranch,
		targetBranch,
		webUrl: readString(raw, "web_url") ?? "",
		updatedAt: readString(raw, "updated_at"),
		pipelineStatus: parsePipelineStatus(raw.head_pipeline) ?? parsePipelineStatus(raw.pipeline),
		changesCount: readString(raw, "changes_count"),
		userNotesCount: readNumber(raw, "user_notes_count"),
	};
}

function parseDiffRefs(raw: unknown): RuntimeGitlabDiffRefs | null {
	if (!isRecord(raw)) {
		return null;
	}
	const baseSha = readString(raw, "base_sha");
	const startSha = readString(raw, "start_sha");
	const headSha = readString(raw, "head_sha");
	if (!baseSha || !startSha || !headSha) {
		return null;
	}
	return { baseSha, startSha, headSha };
}

export function parseDiffFile(raw: unknown): RuntimeGitlabDiffFile | null {
	if (!isRecord(raw)) {
		return null;
	}
	const newPath = readString(raw, "new_path");
	const oldPath = readString(raw, "old_path");
	if (!newPath && !oldPath) {
		return null;
	}
	const diff = readString(raw, "diff") ?? "";
	const { additions, deletions } = countPatchLines(diff);
	return {
		oldPath: oldPath ?? newPath ?? "",
		newPath: newPath ?? oldPath ?? "",
		newFile: readBoolean(raw, "new_file"),
		renamedFile: readBoolean(raw, "renamed_file"),
		deletedFile: readBoolean(raw, "deleted_file"),
		diff,
		// A binary file has no patch to render; the UI shows a placeholder row.
		binary: diff.length === 0 && !readBoolean(raw, "too_large"),
		additions,
		deletions,
		tooLarge: readBoolean(raw, "too_large"),
	};
}

export function parseNote(raw: unknown): RuntimeGitlabNote | null {
	if (!isRecord(raw)) {
		return null;
	}
	const id = readNumber(raw, "id");
	if (id === null) {
		return null;
	}
	const rawPosition = raw.position;
	const position: RuntimeGitlabNotePosition | null = isRecord(rawPosition)
		? {
				oldPath: readString(rawPosition, "old_path"),
				newPath: readString(rawPosition, "new_path"),
				oldLine: readNumber(rawPosition, "old_line"),
				newLine: readNumber(rawPosition, "new_line"),
			}
		: null;
	return {
		id,
		body: readString(raw, "body") ?? "",
		authorUsername: readNestedString(raw, "author", "username"),
		authorName: readNestedString(raw, "author", "name"),
		createdAt: readString(raw, "created_at"),
		system: readBoolean(raw, "system"),
		resolvable: readBoolean(raw, "resolvable"),
		resolved: readBoolean(raw, "resolved"),
		position,
	};
}

export function parseDiscussion(raw: unknown): RuntimeGitlabDiscussion | null {
	if (!isRecord(raw)) {
		return null;
	}
	const id = readString(raw, "id");
	if (!id) {
		return null;
	}
	const rawNotes = Array.isArray(raw.notes) ? raw.notes : [];
	const notes: RuntimeGitlabNote[] = [];
	for (const item of rawNotes) {
		const note = parseNote(item);
		if (note) {
			notes.push(note);
		}
	}
	const resolvable = notes.filter((note) => note.resolvable);
	return {
		id,
		individualNote: readBoolean(raw, "individual_note"),
		// A thread counts as resolved only when every resolvable note in it is;
		// GitLab reports resolution per note, not per discussion.
		resolved: resolvable.length > 0 && resolvable.every((note) => note.resolved),
		notes,
	};
}

export function parseVersion(raw: unknown): RuntimeGitlabMergeRequestVersion | null {
	if (!isRecord(raw)) {
		return null;
	}
	const id = readNumber(raw, "id");
	const headSha = readString(raw, "head_commit_sha");
	const baseSha = readString(raw, "base_commit_sha");
	const startSha = readString(raw, "start_commit_sha");
	if (id === null || !headSha || !baseSha || !startSha) {
		return null;
	}
	return { id, headSha, baseSha, startSha, createdAt: readString(raw, "created_at") };
}

export interface GitlabClient {
	getCredential: () => Promise<GitlabCredential | null>;
	/**
	 * Drops the in-process credential cache. Anything that writes or deletes the
	 * credential file behind this client's back has to call it, or the client keeps
	 * serving the credential it read first — a disconnect that still reports
	 * "connected", or a freshly pasted token that never gets used.
	 */
	invalidateCredential: () => void;
	listProjects: (input: {
		search?: string;
		membership?: boolean;
		limit?: number;
	}) => Promise<GitlabResult<RuntimeGitlabProject[]>>;
	listMergeRequests: (input: {
		projectId?: number;
		state?: string;
		scope?: string;
		search?: string;
		limit?: number;
	}) => Promise<GitlabResult<RuntimeGitlabMergeRequestSummary[]>>;
	getMergeRequest: (input: {
		projectId: number;
		iid: number;
	}) => Promise<GitlabResult<RuntimeGitlabMergeRequestDetail>>;
	getMergeRequestDiffs: (input: {
		projectId: number;
		iid: number;
	}) => Promise<
		GitlabResult<{ files: RuntimeGitlabDiffFile[]; diffRefs: RuntimeGitlabDiffRefs | null; truncated: boolean }>
	>;
	getMergeRequestVersions: (input: {
		projectId: number;
		iid: number;
	}) => Promise<GitlabResult<RuntimeGitlabMergeRequestVersion[]>>;
	getRawFile: (input: { projectId: number; path: string; ref: string }) => Promise<GitlabResult<string>>;
	listDiscussions: (input: { projectId: number; iid: number }) => Promise<GitlabResult<RuntimeGitlabDiscussion[]>>;
	createDiffDiscussion: (input: {
		projectId: number;
		iid: number;
		body: string;
		diffRefs: RuntimeGitlabDiffRefs;
		position: RuntimeGitlabNotePosition;
	}) => Promise<GitlabResult<true>>;
	createNote: (input: {
		projectId: number;
		iid: number;
		body: string;
		discussionId?: string;
	}) => Promise<GitlabResult<true>>;
	resolveDiscussion: (input: {
		projectId: number;
		iid: number;
		discussionId: string;
		resolved: boolean;
	}) => Promise<GitlabResult<true>>;
	setApproval: (input: { projectId: number; iid: number; approved: boolean }) => Promise<GitlabResult<true>>;
}

export interface CreateGitlabClientDependencies {
	warn?: (message: string) => void;
	/** Injected in tests. Defaults to the global credential file. */
	loadCredential?: () => Promise<GitlabCredential | null>;
	refreshCredential?: (credential: GitlabCredential) => Promise<GitlabCredential | null>;
	markReauthRequired?: () => Promise<void>;
	fetchImpl?: typeof fetch;
}

interface RawResponse {
	status: number;
	body: string;
	headers: Headers;
}

export function createGitlabClient(deps?: CreateGitlabClientDependencies): GitlabClient {
	const warn = deps?.warn ?? (() => {});
	const loadCredential = deps?.loadCredential ?? readGitlabCredential;
	const refreshCredential = deps?.refreshCredential ?? ((credential) => refreshGitlabCredential(credential));
	const markReauth = deps?.markReauthRequired ?? markGitlabCredentialReauthRequired;
	const fetchImpl = deps?.fetchImpl ?? fetch;

	/** In-process cache so a burst of panel loads does not re-read the file each time. */
	let cached: GitlabCredential | null = null;

	const resolveCredential = async (): Promise<GitlabCredential | null> => {
		if (!cached) {
			cached = await loadCredential();
		}
		if (!cached) {
			return null;
		}
		// A personal access token has no refresh grant; its expiry is the user's to
		// renew in GitLab, so probing for one here is a guaranteed wasted round-trip.
		if (
			cached.authKind === "oauth" &&
			cached.expiresAt !== null &&
			cached.expiresAt - Date.now() < TOKEN_REFRESH_SKEW_MS
		) {
			const refreshed = await refreshCredential(cached);
			if (refreshed) {
				cached = refreshed;
			}
		}
		return cached;
	};

	const rawRequest = async (
		credential: GitlabCredential,
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ ok: true; response: RawResponse } | { ok: false; failure: GitlabFailure }> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const headers: Record<string, string> = { Authorization: `Bearer ${credential.accessToken}` };
			if (body !== undefined) {
				headers["Content-Type"] = "application/json";
			}
			const response = await fetchImpl(`${normalizeHost(credential.host)}/api/v4${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: controller.signal,
			});
			return {
				ok: true,
				response: { status: response.status, body: await response.text(), headers: response.headers },
			};
		} catch (error) {
			if (controller.signal.aborted) {
				return { ok: false, failure: { kind: "timeout", host: credential.host, timeoutMs: REQUEST_TIMEOUT_MS } };
			}
			const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
			const message = cause ?? (error instanceof Error ? error.message : String(error));
			warn(`GitLab request ${method} ${path} failed: ${message}`);
			return { ok: false, failure: { kind: "unreachable", host: credential.host, message } };
		} finally {
			clearTimeout(timeout);
		}
	};

	/**
	 * One retry on 401 after a refresh: an expired access token is the common case
	 * mid-review, and a silent single retry is the difference between "it just
	 * works" and "click Connect again for no visible reason". A second 401 is
	 * final and flips the stored credential to `reauthRequired`.
	 */
	const request = async (
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ ok: true; response: RawResponse } | { ok: false; failure: GitlabFailure }> => {
		const credential = await resolveCredential();
		if (!credential) {
			return { ok: false, failure: { kind: "disconnected" } };
		}
		let outcome = await rawRequest(credential, method, path, body);
		if (outcome.ok && outcome.response.status === 401) {
			// Only an OAuth credential has anything to refresh with; a rejected PAT is
			// final on the first 401, and the recovery names pasting a new one.
			const refreshed = credential.authKind === "oauth" ? await refreshCredential(credential) : null;
			if (!refreshed) {
				cached = { ...credential, reauthRequired: true };
				await markReauth();
				return {
					ok: false,
					failure: {
						kind: "reauth",
						message:
							credential.authKind === "pat"
								? "GitLab rejected the stored personal access token. It was probably revoked or has expired — paste a new one."
								: "GitLab rejected the stored token. Connect GitLab again.",
					},
				};
			}
			cached = refreshed;
			outcome = await rawRequest(refreshed, method, path, body);
			if (outcome.ok && outcome.response.status === 401) {
				cached = { ...refreshed, reauthRequired: true };
				await markReauth();
				return {
					ok: false,
					failure: { kind: "reauth", message: "GitLab rejected the refreshed token. Connect GitLab again." },
				};
			}
		}
		return outcome;
	};

	const requestJson = async (method: string, path: string, body?: unknown): Promise<GitlabResult<unknown>> => {
		const outcome = await request(method, path, body);
		if (!outcome.ok) {
			return { ok: false, failure: outcome.failure };
		}
		const { status, body: text } = outcome.response;
		if (status < 200 || status >= 300) {
			return { ok: false, failure: toHttpFailure(status, text) };
		}
		if (text.length === 0) {
			return { ok: true, value: null };
		}
		try {
			return { ok: true, value: JSON.parse(text) as unknown };
		} catch {
			return { ok: false, failure: { kind: "malformed", body: text.slice(0, 500) } };
		}
	};

	const requestArray = async <T>(
		method: string,
		path: string,
		parse: (raw: unknown) => T | null,
	): Promise<GitlabResult<T[]>> => {
		const result = await requestJson(method, path);
		if (!result.ok) {
			return result;
		}
		if (!Array.isArray(result.value)) {
			return { ok: false, failure: { kind: "malformed", body: JSON.stringify(result.value).slice(0, 500) } };
		}
		const parsed: T[] = [];
		for (const item of result.value) {
			const value = parse(item);
			if (value) {
				parsed.push(value);
			}
		}
		return { ok: true, value: parsed };
	};

	const mutate = async (method: string, path: string, body?: unknown): Promise<GitlabResult<true>> => {
		const outcome = await request(method, path, body);
		if (!outcome.ok) {
			return { ok: false, failure: outcome.failure };
		}
		const { status, body: text } = outcome.response;
		if (status < 200 || status >= 300) {
			return { ok: false, failure: toHttpFailure(status, text) };
		}
		return { ok: true, value: true };
	};

	return {
		getCredential: resolveCredential,

		invalidateCredential: () => {
			cached = null;
		},

		listProjects: async ({ search, membership = true, limit = DEFAULT_PAGE_SIZE }) => {
			const params = new URLSearchParams({
				per_page: String(Math.min(limit, 100)),
				order_by: "last_activity_at",
				simple: "true",
			});
			if (membership) {
				params.set("membership", "true");
			}
			if (search) {
				params.set("search", search);
			}
			return await requestArray("GET", `/projects?${params.toString()}`, parseProject);
		},

		listMergeRequests: async ({ projectId, state = "opened", scope, search, limit = DEFAULT_PAGE_SIZE }) => {
			const params = new URLSearchParams({
				state,
				per_page: String(Math.min(limit, 100)),
				order_by: "updated_at",
				// Without this the list endpoint omits pipeline info entirely, and the
				// list's pipeline badge is one of the reasons to look at the list.
				with_labels_details: "false",
			});
			if (search) {
				params.set("search", search);
			}
			if (projectId === undefined) {
				params.set("scope", scope ?? "created_by_me");
			} else if (scope) {
				params.set("scope", scope);
			}
			const path =
				projectId === undefined
					? `/merge_requests?${params.toString()}`
					: `/projects/${projectId}/merge_requests?${params.toString()}`;
			return await requestArray("GET", path, parseMergeRequestSummary);
		},

		getMergeRequest: async ({ projectId, iid }) => {
			const result = await requestJson("GET", `/projects/${projectId}/merge_requests/${iid}`);
			if (!result.ok) {
				return result;
			}
			const summary = parseMergeRequestSummary(result.value);
			if (!summary || !isRecord(result.value)) {
				return { ok: false, failure: { kind: "malformed", body: JSON.stringify(result.value).slice(0, 500) } };
			}
			const raw = result.value;
			const credential = await resolveCredential();
			// `approved_by` is only present on instances with the approvals feature; its
			// absence means "cannot tell", which the UI renders as not-approved rather
			// than claiming an approval that does not exist.
			const approvedBy = Array.isArray(raw.approved_by) ? raw.approved_by : [];
			const approvedByMe =
				credential !== null &&
				approvedBy.some(
					(entry) => isRecord(entry) && readNestedString(entry, "user", "username") === credential.username,
				);
			return {
				ok: true,
				value: {
					...summary,
					diffRefs: parseDiffRefs(raw.diff_refs),
					approvedByMe,
					approvalsRequired: readNumber(raw, "approvals_required"),
					approvalsLeft: readNumber(raw, "approvals_left"),
				} satisfies RuntimeGitlabMergeRequestDetail,
			};
		},

		getMergeRequestDiffs: async ({ projectId, iid }) => {
			const files: RuntimeGitlabDiffFile[] = [];
			let truncated = false;
			let diffRefs: RuntimeGitlabDiffRefs | null = null;

			for (let page = 1; page <= MAX_DIFF_PAGES; page += 1) {
				const params = new URLSearchParams({ page: String(page), per_page: String(DEFAULT_PAGE_SIZE) });
				const outcome = await request(
					"GET",
					`/projects/${projectId}/merge_requests/${iid}/diffs?${params.toString()}`,
				);
				if (!outcome.ok) {
					return { ok: false, failure: outcome.failure };
				}
				const { status, body, headers } = outcome.response;
				if (status < 200 || status >= 300) {
					return { ok: false, failure: toHttpFailure(status, body) };
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(body) as unknown;
				} catch {
					return { ok: false, failure: { kind: "malformed", body: body.slice(0, 500) } };
				}
				if (!Array.isArray(parsed)) {
					return { ok: false, failure: { kind: "malformed", body: body.slice(0, 500) } };
				}
				for (const item of parsed) {
					const file = parseDiffFile(item);
					if (file) {
						files.push(file);
					}
				}
				const nextPage = headers.get("x-next-page");
				if (!nextPage) {
					break;
				}
				if (page === MAX_DIFF_PAGES) {
					truncated = true;
				}
			}

			// `/diffs` carries no diff refs, and a note cannot be positioned without
			// them, so the MR itself is consulted for the SHAs.
			const detail = await requestJson("GET", `/projects/${projectId}/merge_requests/${iid}`);
			if (detail.ok && isRecord(detail.value)) {
				diffRefs = parseDiffRefs(detail.value.diff_refs);
			}
			return { ok: true, value: { files, diffRefs, truncated } };
		},

		getMergeRequestVersions: async ({ projectId, iid }) =>
			await requestArray("GET", `/projects/${projectId}/merge_requests/${iid}/versions`, parseVersion),

		getRawFile: async ({ projectId, path, ref }) => {
			const params = new URLSearchParams({ ref });
			const outcome = await request(
				"GET",
				`/projects/${projectId}/repository/files/${encodeURIComponent(path)}/raw?${params.toString()}`,
			);
			if (!outcome.ok) {
				return { ok: false, failure: outcome.failure };
			}
			const { status, body } = outcome.response;
			if (status < 200 || status >= 300) {
				return { ok: false, failure: toHttpFailure(status, body) };
			}
			return { ok: true, value: body };
		},

		listDiscussions: async ({ projectId, iid }) => {
			const params = new URLSearchParams({ per_page: "100" });
			return await requestArray(
				"GET",
				`/projects/${projectId}/merge_requests/${iid}/discussions?${params.toString()}`,
				parseDiscussion,
			);
		},

		createDiffDiscussion: async ({ projectId, iid, body, diffRefs, position }) => {
			const built = buildTextPosition({ diffRefs, position });
			if (!built.ok) {
				// A local validation failure, reported as `http 422` so the caller's
				// single error path covers it without a second failure kind.
				return { ok: false, failure: { kind: "http", status: 422, body: built.error } };
			}
			return await mutate("POST", `/projects/${projectId}/merge_requests/${iid}/discussions`, {
				body,
				position: built.position,
			});
		},

		createNote: async ({ projectId, iid, body, discussionId }) =>
			discussionId
				? await mutate("POST", `/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}/notes`, {
						body,
					})
				: await mutate("POST", `/projects/${projectId}/merge_requests/${iid}/notes`, { body }),

		resolveDiscussion: async ({ projectId, iid, discussionId, resolved }) =>
			await mutate("PUT", `/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}`, {
				resolved,
			}),

		setApproval: async ({ projectId, iid, approved }) =>
			await mutate("POST", `/projects/${projectId}/merge_requests/${iid}/${approved ? "approve" : "unapprove"}`),
	};
}
