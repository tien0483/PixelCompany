import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	buildClaudeOrgMcpPolicyHints,
	listBlockedClaudeMcpServerIds,
	readClaudeOrgMcpPolicy,
} from "../../../src/terminal/claude-org-mcp-policy";

const originalHome = process.env.HOME;
let tempHome: string | null = null;

function setupTempHome(): string {
	tempHome = mkdtempSync(join(tmpdir(), "kanban-org-mcp-"));
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

describe("claude-org-mcp-policy", () => {
	it("reads allowManagedMcpServersOnly from remote-settings.json", async () => {
		const home = setupTempHome();
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "remote-settings.json"),
			JSON.stringify({
				organizationName: "Akselos",
				allowManagedMcpServersOnly: true,
				allowedMcpServers: [{ serverName: "gitlab" }, { serverUrl: "https://example.com/mcp" }],
			}),
			"utf8",
		);

		const policy = await readClaudeOrgMcpPolicy();
		expect(policy.detected).toBe(true);
		expect(policy.allowManagedMcpServersOnly).toBe(true);
		expect(policy.organizationName).toBe("Akselos");
		expect(policy.allowedServerNames).toEqual(["gitlab"]);
		expect(policy.allowedServerUrls).toEqual(["https://example.com/mcp"]);
	});

	it("lists flowise and unlisted servers as blocked under org allowlist", async () => {
		const policy = {
			detected: true,
			allowManagedMcpServersOnly: true,
			organizationName: "Akselos",
			allowedServerNames: ["gitlab"],
			allowedServerUrls: [],
		};
		const blocked = listBlockedClaudeMcpServerIds(["flowise-abc", "gitlab", "filesystem"], policy);
		expect(blocked).toEqual(["flowise-abc", "filesystem"]);
		expect(buildClaudeOrgMcpPolicyHints(policy, blocked).length).toBeGreaterThan(0);
	});
});
