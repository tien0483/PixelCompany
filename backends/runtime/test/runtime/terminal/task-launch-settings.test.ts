import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	applyModelAndEffortArgs,
	buildCursorLaunchTagPreface,
	buildLaunchTagAllowlistUpdateNotice,
	cloneTaskLaunchSettings,
	ensureLinkedPath,
	hasMcpAllowlist,
	hasSkillAllowlist,
	listClaudeMcpInventory,
	listClaudeSkillInventory,
	prepareClaudeMcpAllowlistConfig,
	prepareClaudeSkillScopedConfigDir,
	resolveHostPath,
} from "../../../src/terminal/task-launch-settings";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHome: string | null = null;

function setupTempHome(): string {
	tempHome = mkdtempSync(join(tmpdir(), "kanban-task-launch-"));
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	return tempHome;
}

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (originalUserProfile === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = originalUserProfile;
	}
	if (tempHome) {
		rmSync(tempHome, { recursive: true, force: true });
		tempHome = null;
	}
});

describe("cloneTaskLaunchSettings", () => {
	it("normalizes empty allowlists to omitted fields", () => {
		expect(
			cloneTaskLaunchSettings({
				modelId: "  sonnet  ",
				skillIds: ["", "  "],
				mcpServerIds: [],
			}),
		).toEqual({ modelId: "sonnet" });
	});

	it("returns undefined for empty settings", () => {
		expect(cloneTaskLaunchSettings({})).toBeUndefined();
		expect(cloneTaskLaunchSettings(null)).toBeUndefined();
	});

	it("normalizes workflowIds like the other allowlists", () => {
		expect(cloneTaskLaunchSettings({ workflowIds: ["", "  "] })).toBeUndefined();
		expect(cloneTaskLaunchSettings({ workflowIds: ["  deploy  ", "deploy", "release"] })).toEqual({
			workflowIds: ["deploy", "release"],
		});
	});
});

describe("allowlist helpers", () => {
	it("treats empty arrays as inherit-all", () => {
		expect(hasSkillAllowlist({ skillIds: [] })).toBe(false);
		expect(hasMcpAllowlist({ mcpServerIds: [] })).toBe(false);
		expect(hasSkillAllowlist({ skillIds: ["review"] })).toBe(true);
	});
});

describe("applyModelAndEffortArgs", () => {
	it("appends model and effort when unset", () => {
		const args: string[] = [];
		applyModelAndEffortArgs(args, { modelId: "opus", effort: "high" }, { effortFlag: "--effort" });
		expect(args).toEqual(["--model", "opus", "--effort", "high"]);
	});

	it("skips effort when flag is null", () => {
		const args: string[] = [];
		applyModelAndEffortArgs(args, { modelId: "composer-2", effort: "max" }, { effortFlag: null });
		expect(args).toEqual(["--model", "composer-2"]);
	});

	it("does not duplicate existing --model", () => {
		const args = ["--model", "sonnet"];
		applyModelAndEffortArgs(args, { modelId: "opus" }, { effortFlag: "--effort" });
		expect(args).toEqual(["--model", "sonnet"]);
	});
});

describe("buildCursorLaunchTagPreface", () => {
	it("returns null when no tags", () => {
		expect(buildCursorLaunchTagPreface({})).toBeNull();
	});

	it("lists skill and mcp allowlists", () => {
		const preface = buildCursorLaunchTagPreface({
			skillIds: ["chain-of-command"],
			mcpServerIds: ["filesystem"],
		});
		expect(preface).toContain("Skills: chain-of-command.");
		expect(preface).toContain("MCP servers: filesystem.");
	});

	it("lists agents and slash commands", () => {
		const preface = buildCursorLaunchTagPreface({
			agentIds: ["code-reviewer"],
			commandIds: ["pr"],
		});
		expect(preface).toContain("Agents: code-reviewer.");
		expect(preface).toContain("Slash commands: pr.");
	});

	it("lists workflows", () => {
		const preface = buildCursorLaunchTagPreface({ workflowIds: ["deploy"] });
		expect(preface).toContain("Workflows: deploy.");
	});
});

describe("buildLaunchTagAllowlistUpdateNotice", () => {
	it("returns null when skill/mcp lists are unchanged", () => {
		expect(
			buildLaunchTagAllowlistUpdateNotice(
				{ skillIds: ["alpha"], modelId: "sonnet" },
				{ skillIds: ["alpha"], modelId: "opus" },
			),
		).toBeNull();
	});

	it("names removed skills when the allowlist shrinks", () => {
		const notice = buildLaunchTagAllowlistUpdateNotice(
			{ skillIds: ["pixeloffice-manual-alpha", "pixeloffice-manual-beta"] },
			{ skillIds: ["pixeloffice-manual-beta"] },
		);
		expect(notice).toContain("Skills allowlist (current): pixeloffice-manual-beta.");
		expect(notice).toContain("No longer allowed skills: pixeloffice-manual-alpha.");
	});

	it("clears allowlists when tags are removed", () => {
		const notice = buildLaunchTagAllowlistUpdateNotice({ skillIds: ["alpha"] }, null);
		expect(notice).toContain("All resource allowlists cleared");
	});

	it("names removed workflows when the workflow allowlist shrinks", () => {
		const notice = buildLaunchTagAllowlistUpdateNotice(
			{ workflowIds: ["deploy", "release"] },
			{ workflowIds: ["deploy"] },
		);
		expect(notice).toContain("Workflows allowlist (current): deploy.");
		expect(notice).toContain("No longer allowed workflows: release.");
	});
});

describe("resolveHostPath", () => {
	it("keeps absolute POSIX paths", () => {
		expect(resolveHostPath("/home/u/.claude/accounts/1")).toBe("/home/u/.claude/accounts/1");
	});

	it("maps Windows drive paths to /mnt/<drive> off win32", () => {
		if (process.platform === "win32") {
			expect(resolveHostPath("C:\\Users\\u\\.claude")).toMatch(/^[A-Za-z]:\\/);
			return;
		}
		expect(resolveHostPath("C:\\Users\\u\\.claude")).toBe("/mnt/c/Users/u/.claude");
		expect(resolveHostPath("D:/manager/accounts/2")).toBe("/mnt/d/manager/accounts/2");
	});
});

describe("ensureLinkedPath portability", () => {
	it("preferCopy materializes a real file (sandbox / no-symlink)", async () => {
		const root = mkdtempSync(join(tmpdir(), "kanban-link-"));
		try {
			const source = join(root, "source.json");
			const target = join(root, "target.json");
			writeFileSync(source, JSON.stringify({ ok: true }), "utf8");
			expect(await ensureLinkedPath(source, target, { isDirectory: false, preferCopy: true })).toBe(true);
			expect(lstatSync(target).isSymbolicLink()).toBe(false);
			expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ ok: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("falls back to recursive directory copy when needed", async () => {
		const root = mkdtempSync(join(tmpdir(), "kanban-link-dir-"));
		try {
			const source = join(root, "skills", "keep");
			const target = join(root, "scoped", "keep");
			mkdirSync(source, { recursive: true });
			mkdirSync(join(root, "scoped"), { recursive: true });
			writeFileSync(join(source, "SKILL.md"), "# keep\n", "utf8");
			// preferCopy forces the sandbox-safe path used when symlink fails
			expect(await ensureLinkedPath(source, target, { isDirectory: true, preferCopy: true })).toBe(true);
			expect(lstatSync(target).isDirectory()).toBe(true);
			expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain("# keep");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("Claude inventory + scoped launch config", () => {
	it("lists skills from ~/.claude/skills", async () => {
		const home = setupTempHome();
		expect(homedir()).toBe(home);
		mkdirSync(join(home, ".claude", "skills", "review"), { recursive: true });
		mkdirSync(join(home, ".claude", "skills", "plan"), { recursive: true });
		// Empty leftover dir (Manager toggle-off before rmtree fix) must be ignored.
		mkdirSync(join(home, ".claude", "skills", "ghost"), { recursive: true });
		mkdirSync(join(home, ".claude", "skills", "pixeloffice-manual-alpha"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "skills", "review", "SKILL.md"),
			["---", "name: review", "description: Review pull requests carefully.", "---", "", "# Review"].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(home, ".claude", "skills", "plan", "SKILL.md"),
			["---", "name: plan", "description: Plan before coding.", "---"].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(home, ".claude", "skills", "pixeloffice-manual-alpha", "SKILL.md"),
			[
				"---",
				"name: pixeloffice-manual-alpha",
				"description: Harmless PixelOffice manual-test skill (alpha). Safe to ignore.",
				"---",
			].join("\n"),
			"utf8",
		);
		mkdirSync(join(home, ".claude", "agents"), { recursive: true });
		mkdirSync(join(home, ".claude", "commands"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "agents", "code-reviewer.md"),
			["---", "name: code-reviewer", "description: Reviews PRs.", "---"].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(home, ".claude", "commands", "pr.md"),
			["---", "name: pr", "description: Open a pull request.", "---"].join("\n"),
			"utf8",
		);
		const inventory = await listClaudeSkillInventory();
		expect(inventory.skills.map((skill) => skill.id).sort()).toEqual(["plan", "review"]);
		expect(inventory.skills.find((skill) => skill.id === "review")?.description).toBe(
			"Review pull requests carefully.",
		);
		expect(inventory.agents.map((agent) => agent.id)).toEqual(["code-reviewer"]);
		expect(inventory.commands.map((command) => command.id)).toEqual(["pr"]);
	});

	it("merges ~/.agents/skills and prefers ~/.claude/skills duplicates", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude", "skills", "shared"), { recursive: true });
		mkdirSync(join(home, ".agents", "skills", "shared"), { recursive: true });
		mkdirSync(join(home, ".agents", "skills", "pack-only"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "skills", "shared", "SKILL.md"),
			["---", "name: shared", "description: From Claude home.", "---"].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(home, ".agents", "skills", "shared", "SKILL.md"),
			["---", "name: shared", "description: From agents home.", "---"].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(home, ".agents", "skills", "pack-only", "SKILL.md"),
			["---", "name: pack-only", "description: Pack skill.", "---"].join("\n"),
			"utf8",
		);
		const inventory = await listClaudeSkillInventory();
		expect(inventory.skills.map((skill) => skill.id).sort()).toEqual(["pack-only", "shared"]);
		expect(inventory.skills.find((skill) => skill.id === "shared")?.description).toBe("From Claude home.");
		expect(inventory.skills.find((skill) => skill.id === "pack-only")?.source).toBe("pack");
	});

	it("lists mcp servers from settings.json", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({
				mcpServers: {
					filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
					github: {},
					"pixeloffice-manual-test-mcp": { command: "node", args: ["-e", "0"] },
				},
			}),
			"utf8",
		);
		const inventory = await listClaudeMcpInventory();
		expect(inventory.servers.map((server) => server.id).sort()).toEqual(["filesystem", "github"]);
		expect(inventory.servers.find((server) => server.id === "filesystem")?.description).toBe(
			"npx -y @modelcontextprotocol/server-filesystem",
		);
	});

	it("scopes skills into a task CLAUDE_CONFIG_DIR", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude", "skills", "keep"), { recursive: true });
		mkdirSync(join(home, ".claude", "skills", "drop"), { recursive: true });
		writeFileSync(join(home, ".claude", "skills", "keep", "SKILL.md"), "# keep\n", "utf8");
		writeFileSync(join(home, ".claude", "skills", "drop", "SKILL.md"), "# drop\n", "utf8");
		writeFileSync(join(home, ".claude", "settings.json"), "{}", "utf8");
		writeFileSync(
			join(home, ".claude.json"),
			JSON.stringify({
				hasCompletedOnboarding: true,
				oauthAccount: { emailAddress: "tester@example.com" },
			}),
			"utf8",
		);
		writeFileSync(
			join(home, ".claude", ".credentials.json"),
			JSON.stringify({ claudeAiOauth: { accessToken: "tok" } }),
			"utf8",
		);

		const scoped = await prepareClaudeSkillScopedConfigDir({
			taskId: "task-scope-1",
			skillIds: ["keep", "skill_also"],
		});
		expect(scoped.configDir).toContain("task-launch");
		const skillsRoot = join(scoped.configDir, "skills");
		expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe("{}");
		// keep should be linked; skill_also folder may be missing (non-fatal)
		const listed = await import("node:fs/promises").then((fs) => fs.readdir(skillsRoot));
		expect(listed).toContain("keep");
		expect(listed).not.toContain("drop");
		const seeded = JSON.parse(readFileSync(join(scoped.configDir, ".claude.json"), "utf8")) as {
			hasCompletedOnboarding?: boolean;
			oauthAccount?: { emailAddress?: string };
		};
		expect(seeded.hasCompletedOnboarding).toBe(true);
		expect(seeded.oauthAccount?.emailAddress).toBe("tester@example.com");
		await scoped.cleanup();
	});

	it("scopes staff agents and playbook commands", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude", "agents"), { recursive: true });
		mkdirSync(join(home, ".claude", "commands"), { recursive: true });
		writeFileSync(join(home, ".claude", "agents", "keep.md"), "# keep agent\n", "utf8");
		writeFileSync(join(home, ".claude", "agents", "drop.md"), "# drop agent\n", "utf8");
		writeFileSync(join(home, ".claude", "commands", "ship.md"), "# ship\n", "utf8");
		writeFileSync(join(home, ".claude", "commands", "skip.md"), "# skip\n", "utf8");
		writeFileSync(join(home, ".claude", "settings.json"), "{}", "utf8");
		writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }), "utf8");

		const scoped = await prepareClaudeSkillScopedConfigDir({
			taskId: "task-scope-staff",
			agentIds: ["keep"],
			commandIds: ["ship"],
		});
		const agents = await import("node:fs/promises").then((fs) => fs.readdir(join(scoped.configDir, "agents")));
		const commands = await import("node:fs/promises").then((fs) =>
			fs.readdir(join(scoped.configDir, "commands")),
		);
		expect(agents).toEqual(["keep.md"]);
		expect(commands).toEqual(["ship.md"]);
		await scoped.cleanup();
	});

	it("strips mcpServers from scoped settings when MCP allowlist is set", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({
				theme: "dark",
				mcpServers: { filesystem: {}, github: {} },
			}),
			"utf8",
		);
		writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }), "utf8");

		const scoped = await prepareClaudeSkillScopedConfigDir({
			taskId: "task-mcp-settings",
			mcpServerIds: ["filesystem"],
		});
		const settings = JSON.parse(readFileSync(join(scoped.configDir, "settings.json"), "utf8")) as {
			theme?: string;
			mcpServers?: unknown;
		};
		expect(settings.theme).toBe("dark");
		expect(settings.mcpServers).toBeUndefined();
		await scoped.cleanup();
	});

	it("writes mcp allowlist config for selected servers", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({
				mcpServers: {
					filesystem: { command: "npx" },
					github: { command: "uvx" },
				},
			}),
			"utf8",
		);
		const mcp = await prepareClaudeMcpAllowlistConfig({
			taskId: "task-mcp-1",
			mcpServerIds: ["filesystem"],
		});
		expect(mcp).not.toBeNull();
		const parsed = JSON.parse(readFileSync(mcp!.mcpConfigPath, "utf8")) as {
			mcpServers: Record<string, unknown>;
		};
		expect(Object.keys(parsed.mcpServers)).toEqual(["filesystem"]);
		await mcp!.cleanup();
	});

	it("inherits pin credentials while limiting skills", async () => {
		const home = setupTempHome();
		const pinDir = join(home, "jacked-accounts", "7");
		mkdirSync(pinDir, { recursive: true });
		mkdirSync(join(home, ".claude", "skills", "keep"), { recursive: true });
		mkdirSync(join(home, ".claude", "skills", "drop"), { recursive: true });
		writeFileSync(join(home, ".claude", "skills", "keep", "SKILL.md"), "# keep\n", "utf8");
		writeFileSync(join(home, ".claude", "skills", "drop", "SKILL.md"), "# drop\n", "utf8");
		writeFileSync(join(pinDir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "pin-token" } }), "utf8");
		writeFileSync(
			join(pinDir, ".claude.json"),
			JSON.stringify({
				hasCompletedOnboarding: true,
				oauthAccount: { emailAddress: "pin@example.com" },
			}),
			"utf8",
		);
		writeFileSync(join(home, ".claude", "settings.json"), "{}", "utf8");

		const scoped = await prepareClaudeSkillScopedConfigDir({
			taskId: "task-pin-skills",
			skillIds: ["keep"],
			baseConfigDir: pinDir,
		});

		const listedSkills = await import("node:fs/promises").then((fs) => fs.readdir(join(scoped.configDir, "skills")));
		expect(listedSkills).toContain("keep");
		expect(listedSkills).not.toContain("drop");

		const creds = JSON.parse(readFileSync(join(scoped.configDir, ".credentials.json"), "utf8")) as {
			claudeAiOauth: { accessToken: string };
		};
		expect(creds.claudeAiOauth.accessToken).toBe("pin-token");
		// Credentials must be a real file so Windows (no Developer Mode) and
		// sandboxes without symlink CAP still authenticate.
		expect(lstatSync(join(scoped.configDir, ".credentials.json")).isSymbolicLink()).toBe(false);
		expect(lstatSync(join(scoped.configDir, ".claude.json")).isSymbolicLink()).toBe(false);
		expect(lstatSync(join(scoped.configDir, "settings.json")).isSymbolicLink()).toBe(false);
		const seeded = JSON.parse(readFileSync(join(scoped.configDir, ".claude.json"), "utf8")) as {
			oauthAccount?: { emailAddress?: string };
		};
		expect(seeded.oauthAccount?.emailAddress).toBe("pin@example.com");
		await scoped.cleanup();
	});

	it("returns empty mcp allowlist file when selected servers are missing", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({ mcpServers: { filesystem: { command: "npx" } } }),
			"utf8",
		);
		const mcp = await prepareClaudeMcpAllowlistConfig({
			taskId: "task-mcp-empty",
			mcpServerIds: ["missing-server"],
		});
		expect(mcp).not.toBeNull();
		const parsed = JSON.parse(readFileSync(mcp!.mcpConfigPath, "utf8")) as {
			mcpServers: Record<string, unknown>;
		};
		expect(parsed.mcpServers).toEqual({});
		await mcp!.cleanup();
	});
});

function writeAsset(path: string, name: string, description: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, ["---", `name: ${name}`, `description: ${description}`, "---", ""].join("\n"), "utf8");
}

function makeProjectRepo(): string {
	return mkdtempSync(join(tmpdir(), "kanban-project-"));
}

describe("project-local inventory + bridge", () => {
	it("DISCOVERY: lists .claude and .agent local assets (origin=project) when enabled", async () => {
		setupTempHome();
		const repo = makeProjectRepo();
		try {
			mkdirSync(join(repo, ".claude", "skills", "foo"), { recursive: true });
			writeAsset(join(repo, ".claude", "skills", "foo", "SKILL.md"), "foo", "Claude-native local skill.");
			mkdirSync(join(repo, ".agent", "skills", "bar"), { recursive: true });
			writeAsset(join(repo, ".agent", "skills", "bar", "SKILL.md"), "bar", "Agent-convention local skill.");
			writeAsset(join(repo, ".agent", "agents", "auditor.md"), "auditor", "Local staff agent.");
			writeAsset(join(repo, ".claude", "commands", "ship.md"), "ship", "Local command.");
			writeAsset(join(repo, ".agent", "workflows", "deploy.md"), "deploy", "Local workflow.");

			const inv = await listClaudeSkillInventory(repo, { localAssetsEnabled: true });
			expect(inv.skills.map((s) => s.id).sort()).toEqual(["bar", "foo"]);
			expect(inv.skills.every((s) => s.origin === "project")).toBe(true);
			expect(inv.agents.map((a) => a.id)).toEqual(["auditor"]);
			expect(inv.commands.map((c) => c.id)).toEqual(["ship"]);
			expect(inv.workflows.map((w) => w.id)).toEqual(["deploy"]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it("GATE: project assets are hidden when localAssetsEnabled is false", async () => {
		setupTempHome();
		const repo = makeProjectRepo();
		try {
			mkdirSync(join(repo, ".claude", "skills", "foo"), { recursive: true });
			writeAsset(join(repo, ".claude", "skills", "foo", "SKILL.md"), "foo", "Local skill.");
			const inv = await listClaudeSkillInventory(repo, { localAssetsEnabled: false });
			expect(inv.skills.map((s) => s.id)).toEqual([]);
			expect(inv.workflows).toEqual([]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it("PRECEDENCE: project skill overrides a same-id global skill", async () => {
		const home = setupTempHome();
		const repo = makeProjectRepo();
		try {
			mkdirSync(join(home, ".claude", "skills", "review"), { recursive: true });
			writeAsset(join(home, ".claude", "skills", "review", "SKILL.md"), "review", "Global review.");
			mkdirSync(join(repo, ".claude", "skills", "review"), { recursive: true });
			writeAsset(join(repo, ".claude", "skills", "review", "SKILL.md"), "review", "Project review.");
			const inv = await listClaudeSkillInventory(repo, { localAssetsEnabled: true });
			const review = inv.skills.find((s) => s.id === "review");
			expect(review?.origin).toBe("project");
			expect(review?.description).toBe("Project review.");
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it("BRIDGE: allowlisted .agent skill is linked into the task CLAUDE_CONFIG_DIR", async () => {
		const home = setupTempHome();
		const repo = makeProjectRepo();
		try {
			writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }), "utf8");
			mkdirSync(join(home, ".claude"), { recursive: true });
			writeFileSync(join(home, ".claude", "settings.json"), "{}", "utf8");
			mkdirSync(join(repo, ".agent", "skills", "bar"), { recursive: true });
			writeFileSync(join(repo, ".agent", "skills", "bar", "SKILL.md"), "# bar\n", "utf8");

			const scoped = await prepareClaudeSkillScopedConfigDir({
				taskId: "task-bridge-agent",
				skillIds: ["bar"],
				repoPath: repo,
			});
			expect(readdirSync(join(scoped.configDir, "skills"))).toContain("bar");
			await scoped.cleanup();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it("BRIDGE: allowlisted .agent workflow lands in the scoped commands dir (invokable as slash-command)", async () => {
		const home = setupTempHome();
		const repo = makeProjectRepo();
		try {
			writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }), "utf8");
			mkdirSync(join(home, ".claude"), { recursive: true });
			writeFileSync(join(home, ".claude", "settings.json"), "{}", "utf8");
			writeAsset(join(repo, ".agent", "workflows", "deploy.md"), "deploy", "Deploy workflow.");

			const scoped = await prepareClaudeSkillScopedConfigDir({
				taskId: "task-bridge-workflow",
				workflowIds: ["deploy"],
				repoPath: repo,
			});
			const commands = readdirSync(join(scoped.configDir, "commands"));
			expect(commands.some((f) => f === "deploy.md" || f === "wf-deploy.md")).toBe(true);
			await scoped.cleanup();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it("BRIDGE: .claude/* project assets are NOT re-linked (native cwd discovery owns them)", async () => {
		const home = setupTempHome();
		const repo = makeProjectRepo();
		try {
			writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }), "utf8");
			mkdirSync(join(home, ".claude"), { recursive: true });
			writeFileSync(join(home, ".claude", "settings.json"), "{}", "utf8");
			mkdirSync(join(repo, ".claude", "skills", "foo"), { recursive: true });
			writeFileSync(join(repo, ".claude", "skills", "foo", "SKILL.md"), "# foo\n", "utf8");

			const scoped = await prepareClaudeSkillScopedConfigDir({
				taskId: "task-no-double-bridge",
				skillIds: ["foo"],
				repoPath: repo,
			});
			expect(readdirSync(join(scoped.configDir, "skills"))).not.toContain("foo");
			await scoped.cleanup();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it("WORKFLOW/COMMAND COLLISION: same base name resolves per precedence, both remain invokable", async () => {
		const home = setupTempHome();
		const repo = makeProjectRepo();
		try {
			writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }), "utf8");
			mkdirSync(join(home, ".claude"), { recursive: true });
			writeFileSync(join(home, ".claude", "settings.json"), "{}", "utf8");
			writeAsset(join(repo, ".agent", "commands", "deploy.md"), "deploy", "Command deploy.");
			writeAsset(join(repo, ".agent", "workflows", "deploy.md"), "deploy", "Workflow deploy.");

			const scoped = await prepareClaudeSkillScopedConfigDir({
				taskId: "task-collision",
				commandIds: ["deploy"],
				workflowIds: ["deploy"],
				repoPath: repo,
			});
			const commands = readdirSync(join(scoped.configDir, "commands"));
			expect(commands).toContain("deploy.md");
			expect(commands).toContain("wf-deploy.md");
			await scoped.cleanup();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it("EMPTY: project with no .claude/.agent yields only global, no throw", async () => {
		const home = setupTempHome();
		const repo = makeProjectRepo();
		try {
			mkdirSync(join(home, ".claude", "skills", "g"), { recursive: true });
			writeAsset(join(home, ".claude", "skills", "g", "SKILL.md"), "g", "Global only.");
			const inv = await listClaudeSkillInventory(repo, { localAssetsEnabled: true });
			expect(inv.skills.map((s) => s.id)).toEqual(["g"]);
			expect(inv.skills[0]?.origin).toBe("global");
			expect(inv.workflows).toEqual([]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});
