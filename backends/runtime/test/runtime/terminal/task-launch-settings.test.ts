import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	applyModelAndEffortArgs,
	buildCursorLaunchTagPreface,
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
		expect(resolveHostPath("D:/jacked/accounts/2")).toBe("/mnt/d/jacked/accounts/2");
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
		const inventory = await listClaudeSkillInventory();
		expect(inventory.skills.map((skill) => skill.id).sort()).toEqual(["plan", "review"]);
	});

	it("lists mcp servers from settings.json", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({ mcpServers: { filesystem: {}, github: {} } }),
			"utf8",
		);
		const inventory = await listClaudeMcpInventory();
		expect(inventory.servers.map((server) => server.id).sort()).toEqual(["filesystem", "github"]);
	});

	it("scopes skills into a task CLAUDE_CONFIG_DIR", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude", "skills", "keep"), { recursive: true });
		mkdirSync(join(home, ".claude", "skills", "drop"), { recursive: true });
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
