import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildDshArgv, resolveDshBinary } from "./dsh-binary";
import { DSH_TASK_PROFILE_NAME, resolveDshProfileDir } from "./dsh-endpoint";

const PRODUCT_SUBAGENT_MARKER = join("node_modules", "@deepseek-ai", "dsh-tool-subagent", "package.json");

const DSH_PRODUCT_PACKAGES = [
	"@deepseek-ai/dsh-tool-subagent",
	"@deepseek-ai/dsh-subagent-claude-code",
	"@deepseek-ai/dsh-subagent-codex",
	"@deepseek-ai/dsh-subagent-acp",
	// Lets the harness itself hold a Flowise flow as a tool — see orchestrator-flowise-patch.ts.
	"@deepseek-ai/dsh-mcp-client",
] as const;

export async function probeDshProductSubagentsInstalled(dshHome: string): Promise<boolean> {
	try {
		await access(join(resolveDshProfileDir(dshHome), PRODUCT_SUBAGENT_MARKER));
		return true;
	} catch {
		return false;
	}
}

export interface EnsureDshProductSubagentsInput {
	dshHome: string;
	log?: (message: string) => void;
	warn?: (message: string) => void;
}

/**
 * Best-effort install of the dsh product-subagent + MCP-client plugins into the task profile
 * (`$DSH_HOME/profiles/headless`), which is the only out-of-tree location dsh resolves from.
 * Background-safe: a failure degrades the Custom Agent's delegation, it never blocks startup.
 */
export async function ensureDshProductSubagents(input: EnsureDshProductSubagentsInput): Promise<boolean> {
	if (await probeDshProductSubagentsInstalled(input.dshHome)) {
		return true;
	}

	const profileDir = resolveDshProfileDir(input.dshHome);
	input.log?.(`Installing dsh product plugins in ${profileDir}…`);

	// `dsh plugin --profile <name> <pnpm args>` is the supported entry point and forwards to pnpm
	// inside the profile directory, seeding the profile from its shipped template when absent.
	if (await runDshPluginAdd(input.dshHome)) {
		if (await probeDshProductSubagentsInstalled(input.dshHome)) {
			input.log?.("dsh product plugins ready.");
			return true;
		}
	}

	// Fallback for a dsh whose `plugin` subcommand is unavailable: write the manifest ourselves.
	await mkdir(profileDir, { recursive: true });
	await seedProfileManifest(profileDir);

	const exitCode = await runNpmInstall(profileDir);
	if (exitCode !== 0) {
		input.warn?.(
			`dsh product plugin install failed (exit ${exitCode}). Custom Agent delegation may be limited — see backends/runtime/docs/multi-agent-orchestration.md.`,
		);
		return false;
	}

	const installed = await probeDshProductSubagentsInstalled(input.dshHome);
	if (installed) {
		input.log?.("dsh product plugins ready.");
	}
	return installed;
}

/** Adds the packages to the profile's own manifest without clobbering dsh's `dsh.profile` block. */
async function seedProfileManifest(profileDir: string): Promise<void> {
	const packageJsonPath = join(profileDir, "package.json");
	let packageJson: Record<string, unknown> = {
		name: "pixeloffice-dsh-headless-profile",
		private: true,
	};
	try {
		packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
	} catch {
		// Fresh profile dir — seed a minimal package.json below.
	}

	const dependencies =
		packageJson.dependencies &&
		typeof packageJson.dependencies === "object" &&
		!Array.isArray(packageJson.dependencies)
			? { ...(packageJson.dependencies as Record<string, string>) }
			: {};
	for (const pkg of DSH_PRODUCT_PACKAGES) {
		dependencies[pkg] = "latest";
	}
	packageJson.name =
		typeof packageJson.name === "string" && packageJson.name.length > 0
			? packageJson.name
			: "pixeloffice-dsh-headless-profile";
	packageJson.private = true;
	packageJson.dependencies = dependencies;
	await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");
}

function runDshPluginAdd(dshHome: string): Promise<boolean> {
	const binary = resolveDshBinary();
	if (binary === null) {
		return Promise.resolve(false);
	}
	if (binary.viaNpx) {
		// `npx --yes @deepseek-ai/dsh` resolves the harness's ~100-package dependency tree before
		// running anything: measured here at 219 s to a V8 heap OOM under the default 2 GB cap, and
		// still unfinished after 10 min with 5 GB. This function runs unawaited on every runtime
		// boot, so taking that path would burn minutes and gigabytes in the background of every
		// start on a machine that has no dsh. Fall through to the bounded npm install instead.
		return Promise.resolve(false);
	}
	const { command, args } = buildDshArgv(binary, [
		"plugin",
		"--profile",
		DSH_TASK_PROFILE_NAME,
		"add",
		...DSH_PRODUCT_PACKAGES,
	]);
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd: dshHome,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, DSH_HOME: dshHome },
		});
		child.on("error", () => {
			resolve(false);
		});
		child.on("close", (code) => {
			resolve(code === 0);
		});
	});
}

function runNpmInstall(cwd: string): Promise<number> {
	return new Promise((resolve) => {
		// No `--legacy-peer-deps`: the dsh plugin graph wires itself through *peer* dependencies
		// (`dsh-app-boot` peer-depends on `@deepseek-ai/cordis-plugin-group`, `-loader`, `-include`,
		// `cordis`), and that flag makes npm skip peers entirely. Verified here: an install carrying
		// it produced a tree whose `dsh --version` died with
		// `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis-plugin-group'`.
		const child = spawn("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		child.on("error", () => {
			resolve(1);
		});
		child.on("close", (code) => {
			resolve(code ?? 1);
		});
	});
}
