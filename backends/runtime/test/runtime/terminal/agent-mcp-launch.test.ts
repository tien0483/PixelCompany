import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareProjectMcpConfig, resolveMcpAllowlistServers } from "../../../src/terminal/agent-mcp-launch";

const originalHome = process.env.HOME;
let tempHome: string | null = null;

function setupTempHome(): string {
	tempHome = mkdtempSync(join(tmpdir(), "kanban-agent-mcp-"));
	process.env.HOME = tempHome;
	return tempHome;
}

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (tempHome) {
		rmSync(tempHome, { recursive: true, force: true });
		tempHome = null;
	}
});

describe("agent-mcp-launch", () => {
	it("resolveMcpAllowlistServers reads global Cursor MCP entries", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".cursor"), { recursive: true });
		writeFileSync(
			join(home, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
					github: { command: "uvx" },
				},
			}),
			"utf8",
		);

		const resolved = await resolveMcpAllowlistServers({
			mcpServerIds: ["filesystem"],
			globalConfigPath: join(home, ".cursor", "mcp.json"),
		});
		expect(Object.keys(resolved)).toEqual(["filesystem"]);
	});

	it("prepareProjectMcpConfig writes worktree .cursor/mcp.json and restores on cleanup", async () => {
		const home = setupTempHome();
		const cwd = mkdtempSync(join(tmpdir(), "kanban-cursor-cwd-"));
		mkdirSync(join(home, ".cursor"), { recursive: true });
		writeFileSync(
			join(home, ".cursor", "mcp.json"),
			JSON.stringify({ mcpServers: { filesystem: { command: "npx" } } }),
			"utf8",
		);

		const prepared = await prepareProjectMcpConfig({
			cwd,
			mcpServerIds: ["filesystem"],
			format: "cursor",
		});
		expect(prepared).not.toBeNull();
		expect(existsSync(join(cwd, ".cursor", "mcp.json"))).toBe(true);
		const parsed = JSON.parse(readFileSync(join(cwd, ".cursor", "mcp.json"), "utf8")) as {
			mcpServers: Record<string, unknown>;
		};
		expect(parsed.mcpServers.filesystem).toEqual({ command: "npx" });

		await prepared!.cleanup();
		expect(existsSync(join(cwd, ".cursor", "mcp.json"))).toBe(false);
		rmSync(cwd, { recursive: true, force: true });
	});

	it("prepareProjectMcpConfig injects vault secrets into the server env and keeps the file 0600", async () => {
		const home = setupTempHome();
		const cwd = mkdtempSync(join(tmpdir(), "kanban-cursor-vault-cwd-"));
		mkdirSync(join(home, ".cursor"), { recursive: true });
		writeFileSync(
			join(home, ".cursor", "mcp.json"),
			JSON.stringify({ mcpServers: { postgres: { command: "uvx", env: { PGHOST: "localhost" } } } }),
			"utf8",
		);
		mkdirSync(join(home, ".agent", "kanban", "vault"), { recursive: true });
		writeFileSync(
			join(home, ".agent", "kanban", "vault", "mcp:postgres.json"),
			JSON.stringify({
				env: { DATABASE_URL: "postgres://secret@localhost/db" },
				updatedAt: "2026-09-02T00:00:00.000Z",
			}),
			"utf8",
		);

		const prepared = await prepareProjectMcpConfig({
			cwd,
			mcpServerIds: ["postgres"],
			format: "cursor",
		});
		expect(prepared).not.toBeNull();

		const file = join(cwd, ".cursor", "mcp.json");
		const parsed = JSON.parse(readFileSync(file, "utf8")) as {
			mcpServers: Record<string, { env?: Record<string, string> }>;
		};
		// Vault value present, and the globally configured env is not clobbered.
		expect(parsed.mcpServers.postgres?.env).toEqual({
			PGHOST: "localhost",
			DATABASE_URL: "postgres://secret@localhost/db",
		});
		expect(statSync(file).mode & 0o777).toBe(0o600);

		await prepared!.cleanup();
		expect(existsSync(file)).toBe(false);
		rmSync(cwd, { recursive: true, force: true });
	});

	it("prepareProjectMcpConfig merges Gemini settings without dropping other keys", async () => {
		const home = setupTempHome();
		const cwd = mkdtempSync(join(tmpdir(), "kanban-gemini-cwd-"));
		mkdirSync(join(cwd, ".gemini"), { recursive: true });
		writeFileSync(join(cwd, ".gemini", "settings.json"), JSON.stringify({ theme: "dark" }), "utf8");
		mkdirSync(join(home, ".gemini"), { recursive: true });
		writeFileSync(
			join(home, ".gemini", "settings.json"),
			JSON.stringify({ mcpServers: { mytool: { url: "http://127.0.0.1:1" } } }),
			"utf8",
		);

		const prepared = await prepareProjectMcpConfig({
			cwd,
			mcpServerIds: ["mytool"],
			format: "gemini",
		});
		expect(prepared).not.toBeNull();
		const parsed = JSON.parse(readFileSync(join(cwd, ".gemini", "settings.json"), "utf8")) as {
			theme?: string;
			mcpServers: Record<string, unknown>;
		};
		expect(parsed.theme).toBe("dark");
		expect(parsed.mcpServers.mytool).toEqual({ url: "http://127.0.0.1:1" });

		await prepared!.cleanup();
		expect(JSON.parse(readFileSync(join(cwd, ".gemini", "settings.json"), "utf8"))).toEqual({ theme: "dark" });
		rmSync(cwd, { recursive: true, force: true });
	});
});
