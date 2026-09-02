/**
 * Shared Node.js >= 22 bootstrap check.
 * Formerly duplicated verbatim across:
 *   - scripts/solo.mjs
 *   - scripts/start-stack.mjs
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readBrandEnv } from "./brand-env.mjs";

const MIN_NODE_MAJOR = 22;

function nodeMajor(version = process.version) {
	return Number(version.slice(1).split(".")[0]);
}

function probeNodeBinary(nodePath) {
	if (!existsSync(nodePath)) {
		return null;
	}
	const result = spawnSync(nodePath, ["-p", "process.versions.node"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (result.status !== 0) {
		return null;
	}
	const version = String(result.stdout ?? "").trim();
	return nodeMajor(`v${version}`) >= MIN_NODE_MAJOR ? nodePath : null;
}

function resolveNode22Candidates() {
	const fromEnv = readBrandEnv("NODE")?.trim() || process.env.KANBAN_NODE?.trim();
	const candidates = [];
	if (fromEnv) {
		candidates.push(fromEnv);
	}
	if (process.platform === "win32") {
		const localApp = process.env.LOCALAPPDATA ?? "";
		candidates.push(
			join(localApp, "Programs", "cursor", "resources", "app", "resources", "helpers", "node.exe"),
			"C:\\Program Files\\nodejs\\node.exe",
		);
		const nvmHome = process.env.NVM_HOME ?? join(process.env.APPDATA ?? "", "nvm");
		for (const version of ["22.22.1", "22.12.0", "22.11.0", "22.10.0", "22.9.0", "22.0.0"]) {
			candidates.push(join(nvmHome, `v${version}`, "node.exe"));
		}
	} else {
		candidates.push("/usr/local/bin/node", join(homedir(), ".nvm/versions/node/v22.22.1/bin/node"));
	}
	return candidates;
}

export function ensureNode22() {
	if (nodeMajor() >= MIN_NODE_MAJOR) {
		return;
	}
	const entryScript = process.argv[1];
	for (const candidate of resolveNode22Candidates()) {
		const node22 = probeNodeBinary(candidate);
		if (node22) {
			console.warn(`PIXTiel requires Node >= ${MIN_NODE_MAJOR} (found ${process.version}).`);
			console.warn(`Re-launching with ${node22}`);
			const result = spawnSync(node22, [entryScript, ...process.argv.slice(2)], {
				stdio: "inherit",
				env: process.env,
			});
			process.exit(result.status ?? 1);
		}
	}
	console.error(`PIXTiel requires Node.js >= ${MIN_NODE_MAJOR} (current: ${process.version}).`);
	console.error("Install Node 22 (nvm install 22 && nvm use 22) or set PIXTIEL_NODE to a Node 22 binary.");
	process.exit(1);
}
