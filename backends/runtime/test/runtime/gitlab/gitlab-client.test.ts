import { describe, expect, it, vi } from "vitest";

import {
	createGitlabClient,
	describeGitlabFailure,
	parseDiffFile,
	parseDiscussion,
	parseMergeRequestSummary,
} from "../../../src/gitlab/gitlab-client";
import type { GitlabCredential } from "../../../src/gitlab/gitlab-credentials";

const CREDENTIAL: GitlabCredential = {
	host: "https://code.example.com/repo",
	authKind: "oauth",
	accessToken: "token-1",
	refreshToken: "refresh-1",
	expiresAt: null,
	username: "hoangtien.nguyen",
	name: "Hoang Tien Nguyen",
	userId: 7,
};

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
	return new Response(JSON.stringify(body), {
		status: init?.status ?? 200,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
	});
}

function createHarness(
	responses: Array<() => Response>,
	overrides?: Partial<Parameters<typeof createGitlabClient>[0]>,
) {
	const calls: Array<{ url: string; method: string; token: string | null }> = [];
	let index = 0;
	const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		calls.push({
			url: String(input),
			method: init?.method ?? "GET",
			token: headers.get("Authorization"),
		});
		const next = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return next ? next() : new Response("", { status: 500 });
	}) as unknown as typeof fetch;

	const client = createGitlabClient({
		loadCredential: async () => CREDENTIAL,
		refreshCredential: async () => null,
		markReauthRequired: async () => {},
		fetchImpl,
		...overrides,
	});
	return { client, calls };
}

describe("createGitlabClient", () => {
	it("lists merge requests through the global endpoint when no project is given", async () => {
		const { client, calls } = createHarness([
			() =>
				jsonResponse([
					{
						project_id: 102,
						iid: 142,
						title: "Refactor payment processing",
						state: "opened",
						source_branch: "feature/payment-retry",
						target_branch: "main",
						author: { username: "dev_alex" },
						head_pipeline: { status: "success" },
					},
				]),
		]);

		const result = await client.listMergeRequests({});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.value).toHaveLength(1);
		expect(result.value[0]?.pipelineStatus).toBe("success");
		expect(calls[0]?.url).toContain("/api/v4/merge_requests?");
		expect(calls[0]?.url).toContain("scope=created_by_me");
	});

	it("scopes to a project endpoint when a project id is given", async () => {
		const { client, calls } = createHarness([() => jsonResponse([])]);
		await client.listMergeRequests({ projectId: 102, state: "all" });
		expect(calls[0]?.url).toContain("/api/v4/projects/102/merge_requests?");
		expect(calls[0]?.url).toContain("state=all");
	});

	it("refreshes once on a 401 and retries with the new token", async () => {
		const refreshed: GitlabCredential = { ...CREDENTIAL, accessToken: "token-2" };
		const { client, calls } = createHarness(
			[
				() => jsonResponse({ message: "401 Unauthorized" }, { status: 401 }),
				() => jsonResponse([{ id: 5, path_with_namespace: "team/app" }]),
			],
			{ refreshCredential: async () => refreshed },
		);

		const result = await client.listProjects({});
		expect(result.ok).toBe(true);
		expect(calls.map((call) => call.token)).toEqual(["Bearer token-1", "Bearer token-2"]);
	});

	it("reports reauth and marks the credential when the refresh fails", async () => {
		const markReauthRequired = vi.fn(async () => {});
		const { client, calls } = createHarness(
			[() => jsonResponse({ message: "401 Unauthorized" }, { status: 401 })],
			{ refreshCredential: async () => null, markReauthRequired },
		);

		const result = await client.listProjects({});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.failure.kind).toBe("reauth");
		expect(markReauthRequired).toHaveBeenCalledOnce();
		// No retry without a fresh token — a second identical 401 teaches nothing.
		expect(calls).toHaveLength(1);
	});

	it("never tries to refresh a personal access token, and says so on a 401", async () => {
		const refreshCredential = vi.fn(async () => null);
		const markReauthRequired = vi.fn(async () => {});
		const { client, calls } = createHarness([() => jsonResponse({ message: "401 Unauthorized" }, { status: 401 })], {
			loadCredential: async () => ({ ...CREDENTIAL, authKind: "pat", refreshToken: null }),
			refreshCredential,
			markReauthRequired,
		});

		const result = await client.listProjects({});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.failure.kind).toBe("reauth");
		expect(refreshCredential).not.toHaveBeenCalled();
		expect(markReauthRequired).toHaveBeenCalledOnce();
		expect(calls).toHaveLength(1);
	});

	it("reports an insufficient_scope 403 as a scope failure carrying the accepted scopes", async () => {
		const { client } = createHarness([
			() =>
				jsonResponse(
					{
						error: "insufficient_scope",
						error_description: "The request requires higher privileges than provided by the access token.",
						scope: "read_user ai_workflows api read_api",
					},
					{ status: 403 },
				),
		]);

		const result = await client.listProjects({});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.failure).toEqual({
			kind: "scope",
			accepted: ["read_user", "ai_workflows", "api", "read_api"],
		});
		expect(describeGitlabFailure(result.failure)).toContain("api");
	});

	it("leaves an ordinary 403 as an http failure", async () => {
		const { client } = createHarness([() => jsonResponse({ message: "403 Forbidden" }, { status: 403 })]);
		const result = await client.listProjects({});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.failure.kind).toBe("http");
	});

	it("re-reads the credential file after it is invalidated", async () => {
		const loadCredential = vi.fn(async () => CREDENTIAL);
		const { client } = createHarness([() => jsonResponse([])], { loadCredential });

		await client.listProjects({});
		await client.listProjects({});
		expect(loadCredential).toHaveBeenCalledOnce();

		client.invalidateCredential();
		await client.listProjects({});
		expect(loadCredential).toHaveBeenCalledTimes(2);
	});

	it("reports disconnected rather than calling out when no credential exists", async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const client = createGitlabClient({ loadCredential: async () => null, fetchImpl });
		const result = await client.listProjects({});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.failure.kind).toBe("disconnected");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("walks diff pages while x-next-page is set and then reads the diff refs", async () => {
		const { client, calls } = createHarness([
			() => jsonResponse([{ new_path: "a.py", old_path: "a.py", diff: "@@ -1 +1 @@\n-a\n+b\n" }], { headers: { "x-next-page": "2" } }),
			() => jsonResponse([{ new_path: "b.py", old_path: "b.py", diff: "@@ -0,0 +1 @@\n+x\n" }]),
			() => jsonResponse({ project_id: 1, iid: 2, source_branch: "s", target_branch: "t", diff_refs: { base_sha: "b", start_sha: "s", head_sha: "h" } }),
		]);

		const result = await client.getMergeRequestDiffs({ projectId: 1, iid: 2 });
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.value.files.map((file) => file.newPath)).toEqual(["a.py", "b.py"]);
		expect(result.value.diffRefs).toEqual({ baseSha: "b", startSha: "s", headSha: "h" });
		expect(result.value.truncated).toBe(false);
		expect(calls).toHaveLength(3);
	});

	it("rejects a diff note whose position has no line before calling GitLab", async () => {
		const { client, calls } = createHarness([() => jsonResponse({})]);
		const result = await client.createDiffDiscussion({
			projectId: 1,
			iid: 2,
			body: "note",
			diffRefs: { baseSha: "b", startSha: "s", headSha: "h" },
			position: { oldPath: "a.py", newPath: "a.py", oldLine: null, newLine: null },
		});
		expect(result.ok).toBe(false);
		expect(calls).toHaveLength(0);
	});

	it("posts approve and unapprove to distinct endpoints", async () => {
		const { client, calls } = createHarness([() => jsonResponse({}), () => jsonResponse({})]);
		await client.setApproval({ projectId: 1, iid: 2, approved: true });
		await client.setApproval({ projectId: 1, iid: 2, approved: false });
		expect(calls[0]?.url).toMatch(/\/merge_requests\/2\/approve$/);
		expect(calls[1]?.url).toMatch(/\/merge_requests\/2\/unapprove$/);
	});

	it("detects the signed-in user's own approval", async () => {
		const { client } = createHarness([
			() =>
				jsonResponse({
					project_id: 1,
					iid: 2,
					source_branch: "s",
					target_branch: "t",
					approved_by: [{ user: { username: "hoangtien.nguyen" } }],
					approvals_left: 0,
				}),
		]);
		const result = await client.getMergeRequest({ projectId: 1, iid: 2 });
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.value.approvedByMe).toBe(true);
	});
});

describe("gitlab parsers", () => {
	it("treats work_in_progress as draft on older instances", () => {
		const summary = parseMergeRequestSummary({
			project_id: 1,
			iid: 2,
			source_branch: "s",
			target_branch: "t",
			work_in_progress: true,
		});
		expect(summary?.draft).toBe(true);
	});

	it("counts patch lines into the file summary", () => {
		const file = parseDiffFile({ new_path: "a.py", old_path: "a.py", diff: "@@ -1 +1,2 @@\n-a\n+b\n+c\n" });
		expect(file).toMatchObject({ additions: 2, deletions: 1, binary: false, tooLarge: false });
	});

	it("marks an empty non-truncated patch as binary", () => {
		expect(parseDiffFile({ new_path: "logo.png", old_path: "logo.png", diff: "" })?.binary).toBe(true);
		expect(parseDiffFile({ new_path: "huge.bin", old_path: "huge.bin", diff: "", too_large: true })?.binary).toBe(false);
	});

	it("resolves a thread only when every resolvable note is resolved", () => {
		const partly = parseDiscussion({
			id: "d1",
			notes: [
				{ id: 1, resolvable: true, resolved: true },
				{ id: 2, resolvable: true, resolved: false },
			],
		});
		expect(partly?.resolved).toBe(false);

		const done = parseDiscussion({
			id: "d2",
			notes: [{ id: 1, resolvable: true, resolved: true }],
		});
		expect(done?.resolved).toBe(true);
	});

	it("leaves a comment-only thread unresolved rather than claiming resolution", () => {
		const discussion = parseDiscussion({ id: "d3", individual_note: true, notes: [{ id: 1 }] });
		expect(discussion?.resolved).toBe(false);
	});
});

describe("describeGitlabFailure", () => {
	it("names the host for a transport failure and the status for a rejection", () => {
		expect(describeGitlabFailure({ kind: "unreachable", host: "https://g", message: "ECONNREFUSED" })).toContain(
			"https://g",
		);
		expect(describeGitlabFailure({ kind: "http", status: 422, body: "bad position" })).toContain("422");
	});
});
