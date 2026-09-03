/**
 * Bootstraps the in-tree agent stack for `pnpm start`: optional shallow clones,
 * venv sync, skill/rule links, and on `--restart` a clean daemon cycle so runtime
 * spawns headroom/ccr/switchboard with current config instead of adopting stale
 * processes from an old `activate-stack.sh` session.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
	linkStackSkills,
	readStackFlags,
	reportStackSkills,
	resolveSandboxDir,
} from "./link-stack-skills.mjs";

const PONYTAIL_REPO = "https://github.com/DietrichGebert/ponytail.git";

export const STACK_DAEMON_PORTS = {
	switchboard: Number(process.env.STACK_UI_PORT ?? 8000),
	headroom: 8787,
	ccr: 3456,
	devtools: 3001,
};

function flagEnabled(flags, key) {
	return flags === null ? true : Boolean(flags[key]);
}

function ensureVenv(sandboxDir) {
	const headroomBin = join(sandboxDir, ".venv", "bin", "headroom");
	if (existsSync(headroomBin) || !existsSync(join(sandboxDir, "pyproject.toml"))) {
		return null;
	}
	const uv = spawnSync("uv", ["sync"], { cwd: sandboxDir, encoding: "utf8", stdio: "pipe" });
	if (uv.status !== 0) {
		const detail = (uv.stderr || uv.stdout || "").trim().split("\n").pop();
		return `uv sync failed in ${sandboxDir}${detail ? `: ${detail}` : ""}`;
	}
	return null;
}

function ensurePonytailCheckout(sandboxDir, flags) {
	if (!flagEnabled(flags, "ENABLE_PONYTAIL")) {
		return null;
	}
	const ponytailDir = join(sandboxDir, "src-ponytail");
	if (existsSync(join(ponytailDir, "skills", "ponytail", "SKILL.md"))) {
		return null;
	}
	const clone = spawnSync("git", ["clone", "--depth", "1", PONYTAIL_REPO, ponytailDir], {
		encoding: "utf8",
		stdio: "pipe",
	});
	if (clone.status !== 0) {
		const detail = (clone.stderr || clone.stdout || "").trim().split("\n").pop();
		return `ponytail clone failed${detail ? `: ${detail}` : ""}`;
	}
	return null;
}

/**
 * Stops pidfile-tracked stack daemons and frees their ports so the runtime can
 * bind fresh instances on the next boot.
 */
export function restartAgentStackDaemons({ sandboxDir = resolveSandboxDir(), freePortFn } = {}) {
	if (!existsSync(sandboxDir)) {
		return;
	}
	const stopScript = join(sandboxDir, "stop-stack.sh");
	if (existsSync(stopScript)) {
		spawnSync("bash", [stopScript], { cwd: sandboxDir, stdio: "pipe" });
	}
	if (typeof freePortFn === "function") {
		for (const port of Object.values(STACK_DAEMON_PORTS)) {
			freePortFn(port);
		}
	}
}

export function ensureAgentStack({
	sandboxDir = resolveSandboxDir(),
	repoRoot,
	skipLink = false,
	quiet = false,
} = {}) {
	if (!existsSync(sandboxDir)) {
		const summary = {
			sandboxDir,
			present: false,
			linked: [],
			existing: [],
			broken: [],
			removed: [],
			understandAnythingActive: false,
			warnings: [],
		};
		reportStackSkills(summary, { quiet });
		return summary;
	}

	const flags = readStackFlags(sandboxDir);
	const bootstrapWarnings = [ensureVenv(sandboxDir), ensurePonytailCheckout(sandboxDir, flags)].filter(Boolean);

	if (skipLink) {
		return { sandboxDir, present: true, skipLink: true, bootstrapWarnings };
	}

	const summary = linkStackSkills({ sandboxDir, repoRootPath: repoRoot });
	summary.bootstrapWarnings = bootstrapWarnings;
	reportStackSkills(summary, { quiet });
	for (const warning of bootstrapWarnings) {
		console.warn(`  Agent stack: ${warning}`);
	}
	return summary;
}
