import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspaces = new Map<string, { repoPath: string }>();
const recordedFeatures: Array<{ workspaceId: string; featureKey: string; enabled: boolean }> = [];

vi.mock("../../../src/state/workspace-state", () => ({
	loadWorkspaceContextById: async (workspaceId: string) => workspaces.get(workspaceId) ?? null,
	setWorkspaceManagerFeature: async (workspaceId: string, featureKey: string, enabled: boolean) => {
		recordedFeatures.push({ workspaceId, featureKey, enabled });
		return [featureKey];
	},
}));

import { createManagerApi } from "../../../src/trpc/manager-api";

function createDeps() {
	const monitor = {
		getState: vi.fn(() => null),
		refresh: vi.fn(async () => null),
	};
	const client = {
		setFeatureEnabled: vi.fn(async () => ({ ok: true })),
		fetchSnapshot: vi.fn(async () => null),
	};
	return { monitor, client, api: createManagerApi({ monitor: monitor as never, client: client as never }) };
}

describe("createManagerApi project-scoped features", () => {
	let repoPath: string;

	beforeEach(async () => {
		repoPath = await mkdtemp(join(tmpdir(), "manager-scope-"));
		workspaces.clear();
		workspaces.set("ws-a", { repoPath });
		recordedFeatures.length = 0;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("resolves a workspace id to its repo path when toggling", async () => {
		const { api, client } = createDeps();

		await api.setFeatureEnabled({ category: "agents", name: "qa-bot", enabled: true, workspaceId: "ws-a" });

		expect(client.setFeatureEnabled).toHaveBeenCalledWith("agents", "qa-bot", true, repoPath);
	});

	it("installs globally when no workspace is supplied", async () => {
		const { api, client } = createDeps();

		await api.setFeatureEnabled({ category: "agents", name: "qa-bot", enabled: true });

		expect(client.setFeatureEnabled).toHaveBeenCalledWith("agents", "qa-bot", true, null);
		expect(recordedFeatures).toEqual([]);
	});

	it("records the enabled entry against the workspace", async () => {
		const { api } = createDeps();

		await api.setFeatureEnabled({ category: "commands", name: "ship", enabled: true, workspaceId: "ws-a" });

		expect(recordedFeatures).toEqual([{ workspaceId: "ws-a", featureKey: "commands/ship", enabled: true }]);
	});

	it("does not record hook toggles — those stay machine-wide", async () => {
		const { api, client } = createDeps();

		await api.setFeatureEnabled({ category: "hooks", name: "sounds", enabled: true, workspaceId: "ws-a" });

		expect(client.setFeatureEnabled).toHaveBeenCalledWith("hooks", "sounds", true, repoPath);
		expect(recordedFeatures).toEqual([]);
	});

	it("does not record when Manager refuses the toggle", async () => {
		const { api, client } = createDeps();
		client.setFeatureEnabled.mockResolvedValueOnce({ ok: false, error: "nope" } as never);

		const result = await api.setFeatureEnabled({
			category: "agents",
			name: "qa-bot",
			enabled: true,
			workspaceId: "ws-a",
		});

		expect(result.ok).toBe(false);
		expect(recordedFeatures).toEqual([]);
	});

	it("reads features scoped to the workspace's repo", async () => {
		const { api, client } = createDeps();
		client.fetchSnapshot.mockResolvedValueOnce({
			features: [{ category: "agents", name: "qa-bot", displayName: "QA Bot", description: "", installed: true }],
			featuresScope: {
				repoPath,
				claudeDir: join(repoPath, ".claude"),
				projectScopedCategories: ["agents", "commands", "knowledge"],
			},
		} as never);

		const result = await api.features({ workspaceId: "ws-a" });

		expect(client.fetchSnapshot).toHaveBeenCalledWith(repoPath);
		expect(result.features).toHaveLength(1);
		expect(result.claudeDir).toBe(join(repoPath, ".claude"));
		expect(result.repoPath).toBe(repoPath);
	});

	it("returns an empty, unscoped reading when Manager is offline", async () => {
		const { api } = createDeps();

		const result = await api.features({ workspaceId: "ws-a" });

		expect(result).toEqual({ features: [], claudeDir: null, repoPath });
	});

	it("treats an unknown workspace id as global rather than guessing a path", async () => {
		const { api, client } = createDeps();

		await api.features({ workspaceId: "ws-missing" });

		expect(client.fetchSnapshot).toHaveBeenCalledWith(null);
	});
});
