/**
 * Installs the DeepSeek Harness (dsh) into `backends/dsh`, plus the product plugins the Custom
 * Agent delegates through, into the headless task profile.
 *
 * Why repo-local rather than `npm i -g`: the Custom Agent card was only launchable on a machine
 * where someone had run a global install by hand, and `resolveDshBinary`'s npx fallback is not a
 * usable launch path (`npx --yes @deepseek-ai/dsh` resolves a ~100-package tree before running
 * anything — measured at 219 s to a V8 heap OOM under the default cap). A pinned tree under
 * `backends/dsh` makes a fresh clone self-contained, and the whole directory is gitignored: npm
 * authors the package.json and lockfile there, nothing in it is written by hand.
 *
 * Usage:
 *   node scripts/install-dsh.mjs              # install if missing
 *   node scripts/install-dsh.mjs --force      # reinstall even when present
 *   PIXTIEL_DSH_VERSION=0.1.3 node scripts/install-dsh.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DSH_DIR = join(REPO_ROOT, "backends", "dsh");
const DSH_BIN = join(DSH_DIR, "node_modules", ".bin", "dsh");

/**
 * Pinned rather than `latest`: the harness is pre-1.0 and its plugin graph is wired through peer
 * dependencies, so a surprise minor bump can change what resolves under an existing profile.
 * Override with PIXTIEL_DSH_VERSION when moving the pin deliberately.
 */
const DEFAULT_DSH_VERSION = "0.1.2-rc.1";

/** Kept in step with DSH_PRODUCT_PACKAGES in backends/runtime/src/orchestrator/dsh-home-setup.ts. */
const DSH_PRODUCT_PACKAGES = [
	"@deepseek-ai/dsh-tool-subagent",
	"@deepseek-ai/dsh-subagent-claude-code",
	"@deepseek-ai/dsh-subagent-codex",
	"@deepseek-ai/dsh-subagent-acp",
	"@deepseek-ai/dsh-mcp-client",
];

const DSH_TASK_PROFILE_NAME = "headless";

function resolveDshHome() {
	const override = process.env.PIXTIEL_DSH_HOME?.trim() || process.env.DSH_HOME?.trim();
	if (override) {
		return override;
	}
	const agentHome = process.env.AGENT_HOME?.trim() || join(process.env.HOME ?? "", ".agent");
	return join(agentHome, "dsh");
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	if (result.error) {
		return { ok: false, detail: result.error.message };
	}
	return { ok: result.status === 0, detail: `exit ${result.status ?? "signal"}` };
}

function installHarness(force) {
	if (existsSync(DSH_BIN) && !force) {
		console.log(`dsh already installed at ${DSH_BIN}`);
		return true;
	}
	mkdirSync(DSH_DIR, { recursive: true });
	const version = process.env.PIXTIEL_DSH_VERSION?.trim() || DEFAULT_DSH_VERSION;
	console.log(`Installing @deepseek-ai/dsh@${version} into ${DSH_DIR}…`);
	// NEVER add --legacy-peer-deps here. The dsh plugin graph wires itself through *peer*
	// dependencies (dsh-app-boot peer-depends on @deepseek-ai/cordis-plugin-group, -loader,
	// -include and cordis), and that flag makes npm skip peers outright: the tree installs
	// cleanly, exits 0, and then every dsh invocation dies with
	// `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis-plugin-group'`.
	const install = run("npm", ["install", "--no-audit", "--no-fund", `@deepseek-ai/dsh@${version}`], {
		cwd: DSH_DIR,
	});
	if (!install.ok) {
		console.error(`dsh install failed (${install.detail}).`);
		return false;
	}
	if (!existsSync(DSH_BIN)) {
		console.error(`dsh install finished but ${DSH_BIN} is missing.`);
		return false;
	}
	return true;
}

function installProductPlugins() {
	const dshHome = resolveDshHome();
	mkdirSync(dshHome, { recursive: true });
	console.log(`Installing dsh product plugins into ${join(dshHome, "profiles", DSH_TASK_PROFILE_NAME)}…`);
	// `dsh plugin --profile <name> add <pkgs>` forwards to pnpm inside the profile directory and
	// seeds the profile from its shipped template when absent. Out-of-tree plugins resolve from the
	// dsh installation first and then from the *profile's* own node_modules — never from $DSH_HOME
	// itself, which is why installing into $DSH_HOME looks successful and changes nothing.
	const result = run(DSH_BIN, ["plugin", "--profile", DSH_TASK_PROFILE_NAME, "add", ...DSH_PRODUCT_PACKAGES], {
		cwd: dshHome,
		env: { ...process.env, DSH_HOME: dshHome },
	});
	if (!result.ok) {
		console.error(
			`dsh plugin install failed (${result.detail}). Custom Agent delegation will be limited — see backends/runtime/docs/multi-agent-orchestration.md.`,
		);
		return false;
	}
	return true;
}

const force = process.argv.includes("--force");
if (!installHarness(force)) {
	process.exit(1);
}
// A failed plugin install degrades delegation but leaves a runnable harness, so it is reported
// and not fatal — same posture as `ensureDshProductSubagents` at runtime boot.
installProductPlugins();
console.log(`dsh ready: ${DSH_BIN}`);
