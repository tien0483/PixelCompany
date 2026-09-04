// The feature ⇄ artifact map (DESIGN P-6). Probes mirror the runtime supervisors —
// if a supervisor's probe changes, this file is the other half to update.
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export const FEATURES = [
	{
		id: "kanban",
		label: "Kanban board + runtime (core)",
		default: true,
		locked: true,
		probe: "frontends/pixel_office/dist/index.html",
		steps: [
			{ run: "pnpm install", cwd: "." },
			{ run: "pnpm --filter @kanban/web build", cwd: "." },
			{ run: "uv sync", cwd: "backends/manager", needs: ["uv"] },
		],
	},
	{
		id: "agent-stack",
		label: "Agent Stack (Understand-Anything, rtk, headroom)",
		default: true,
		parent: "kanban",
		probe: "backends/agent_stack/.venv/bin/headroom",
		steps: [
			{ run: "uv sync", cwd: "backends/agent_stack", needs: ["uv"] },
			{ run: "pnpm install", cwd: "backends/agent_stack" },
		],
	},
	{
		id: "plan-editor",
		label: "Plan editor",
		default: true,
		parent: "kanban",
		probe: "backends/html_anything/next/.next/BUILD_ID",
		steps: [
			{
				run: "pnpm --dir backends/html_anything/next install && pnpm --dir backends/html_anything/next exec next build",
				cwd: ".",
			},
		],
	},
	{
		id: "omniroute",
		label: "OmniRoute",
		default: false,
		parent: "kanban",
		probe: "backends/OmniRoute/bin/omniroute.mjs",
		steps: [
			{ run: "git submodule update --init backends/OmniRoute", cwd: "." },
			{ run: "pnpm install", cwd: "backends/OmniRoute" },
		],
	},
	{
		id: "review",
		label: "Review",
		default: false,
		parent: "kanban",
		probe: null, // in-tree; ships with the runtime
		steps: [],
		note: "Review ships with the core runtime; nothing extra to install.",
	},
	{
		id: "agent-creation",
		label: "Agent creation (Flowise studio)",
		default: false,
		parent: "kanban",
		probe: "backends/flowise/packages/server/dist/index.js",
		needsNode: 24,
		noWorktree: true,
		steps: [
			{ run: "git submodule update --init backends/flowise", cwd: "." },
			{ run: "npx pnpm@10.26.0 install", cwd: "backends/flowise" },
			{ run: "npx pnpm@10.26.0 build", cwd: "backends/flowise" },
		],
	},
	// The two standalone packages come last: both builders shell to binaries under the
	// workspace node_modules that the core feature's `pnpm install` step provides.
	{
		id: "plan-editor-standalone",
		label: "Plan editor standalone",
		default: false,
		probe: "plan-editor-standalone/start.sh",
		steps: [
			// --slim ships ~50 MB instead of ~490 MB; the package's own build.sh installs
			// the sidecar's prod deps once on the target machine.
			{ run: "node scripts/build-plan-editor-standalone.mjs --slim", cwd: ".", needs: ["pnpm"] },
		],
	},
	{
		id: "review-standalone",
		label: "Review Standalone",
		default: false,
		probe: "review-standalone/start.sh",
		steps: [{ run: "node scripts/build-review-standalone.mjs", cwd: "." }],
	},
];

/**
 * Checks if a required Node.js major version is available in the current environment
 * or installed in ~/.nvm/versions/node.
 */
function hasAvailableNodeVersion(minMajor) {
	const currentMajor = parseInt(process.versions.node.split(".")[0], 10);
	if (currentMajor >= minMajor) {
		return true;
	}
	const nvmDir = process.env.NVM_DIR || join(os.homedir(), ".nvm");
	const versionsDir = join(nvmDir, "versions", "node");
	if (existsSync(versionsDir)) {
		try {
			const entries = readdirSync(versionsDir);
			for (const entry of entries) {
				const m = entry.match(/^v?(\d+)/);
				if (m && parseInt(m[1], 10) >= minMajor) {
					return true;
				}
			}
		} catch {
			// fall through
		}
	}
	return false;
}

/**
 * Probes the artifact state for a given feature.
 * Returns 'fresh' if probe exists, 'missing' if probe is missing, or 'in-tree' if probe is null.
 */
export function probeFeature(feature, repoRoot = process.cwd()) {
	if (!feature.probe) {
		return "in-tree";
	}
	const probePath = resolve(repoRoot, feature.probe);
	return existsSync(probePath) ? "fresh" : "missing";
}

/**
 * Installs a feature by executing its steps sequentially.
 * Degrades gracefully on errors without throwing (PXT-9).
 */
export function installFeature(feature, { repoRoot = process.cwd(), log = console.log } = {}) {
	try {
		if (!feature) {
			return { ok: false, error: "No feature specified" };
		}

		// 1. Probe check: if artifact exists, skip
		if (feature.probe) {
			const probePath = resolve(repoRoot, feature.probe);
			if (existsSync(probePath)) {
				log(`  [${feature.id}] already built (${feature.probe}); skipping.`);
				return { ok: true, skipped: true };
			}
		}

		// 2. Worktree check
		if (feature.noWorktree) {
			const res = spawnSync("git", ["rev-parse", "--git-common-dir"], {
				cwd: repoRoot,
				encoding: "utf8",
				stdio: "pipe",
			});
			const commonDir = (res.stdout || "").trim();
			if (commonDir && commonDir !== ".git") {
				const msg = `[${feature.id}] cannot install in a git worktree; submodule builds must run in the home repo.`;
				console.warn(`${RED}${msg}${RESET}`);
				return { ok: false, error: msg };
			}
		}

		// 3. Node version check
		if (feature.needsNode && !hasAvailableNodeVersion(feature.needsNode)) {
			const hint = `nvm install ${feature.needsNode}`;
			console.warn(`${RED}[${feature.id}] requires Node.js >= ${feature.needsNode}. Hint: ${hint}${RESET}`);
			return { ok: false, hint };
		}

		// 4. Run steps sequentially
		for (const step of feature.steps || []) {
			// Check prerequisites
			if (step.needs) {
				for (const need of step.needs) {
					if (need === "uv") {
						const uv = spawnSync("command", ["-v", "uv"], { shell: true, stdio: "pipe" });
						if (uv.status !== 0) {
							const hint = "curl -LsSf https://astral.sh/uv/install.sh | sh";
							console.warn(`${RED}[${feature.id}] uv is required but not found in PATH. Hint: ${hint}${RESET}`);
							return { ok: false, hint };
						}
					} else {
						const toolCheck = spawnSync("command", ["-v", need], { shell: true, stdio: "pipe" });
						if (toolCheck.status !== 0) {
							const msg = `[${feature.id}] required tool "${need}" not found in PATH.`;
							console.warn(`${RED}${msg}${RESET}`);
							return { ok: false, error: msg };
						}
					}
				}
			}

			const cwd = resolve(repoRoot, step.cwd || ".");
			log(`${CYAN}▸ [${feature.id}]${RESET} ${step.run} ${DIM}(in ${step.cwd || "."})${RESET}`);
			const res = spawnSync(step.run, {
				shell: true,
				stdio: "inherit",
				cwd,
			});

			if (res.status !== 0) {
				const code = res.status ?? (res.signal ? `signal ${res.signal}` : "unknown");
				const msg = `[${feature.id}] step failed with exit code ${code}: ${step.run}`;
				console.warn(`${RED}${msg}${RESET}`);
				return { ok: false, error: msg, exitCode: res.status };
			}
		}

		return { ok: true, skipped: false };
	} catch (err) {
		const msg = `[${feature?.id ?? "unknown"}] unexpected error: ${err.message || String(err)}`;
		console.warn(`${RED}${msg}${RESET}`);
		return { ok: false, error: msg };
	}
}

/**
 * Atomically writes the complete stack flags object to backends/agent_stack/stack-flags.json (PXT-11).
 */
export function writeStackFlags(repoRootOrFlags, maybeFlags) {
	let repoRoot;
	let flagsObject;
	if (typeof repoRootOrFlags === "string") {
		repoRoot = repoRootOrFlags;
		flagsObject = maybeFlags;
	} else {
		repoRoot = process.cwd();
		flagsObject = repoRootOrFlags;
	}

	const targetDir = resolve(repoRoot, "backends", "agent_stack");
	mkdirSync(targetDir, { recursive: true });
	const targetFile = join(targetDir, "stack-flags.json");
	const tempFile = join(targetDir, `.stack-flags.json.tmp.${process.pid}.${Date.now()}`);
	const content = JSON.stringify(flagsObject, null, 2) + "\n";
	writeFileSync(tempFile, content, "utf8");
	renameSync(tempFile, targetFile);
}

// CLI execution
const isMain = process.argv[1] && (
	resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
	fileURLToPath(import.meta.url).endsWith(process.argv[1])
);

if (isMain) {
	if (process.argv.includes("--list")) {
		const repoRoot = process.cwd();
		console.log("\nPIXTIEL Feature Manifest:\n");
		// Wide enough for the longest id plus a space; recomputed so adding a feature
		// with a longer id cannot silently break the columns.
		const idWidth = Math.max(4, ...FEATURES.map((f) => f.id.length)) + 2;
		console.log(
			"ID".padEnd(idWidth) +
			"DEFAULT".padEnd(10) +
			"STATE".padEnd(12) +
			"LABEL"
		);
		console.log("─".repeat(idWidth + 52));
		for (const feat of FEATURES) {
			const state = probeFeature(feat, repoRoot);
			const def = feat.default ? (feat.locked ? "yes (req)" : "yes") : "no";
			const label = feat.parent ? `  ${feat.label}` : feat.label;
			console.log(
				feat.id.padEnd(idWidth) +
				def.padEnd(10) +
				state.padEnd(12) +
				label
			);
		}
		console.log("");
	}
}
