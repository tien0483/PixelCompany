import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PRODUCT_SUBAGENT_MARKER = join("node_modules", "@deepseek-ai", "dsh-tool-subagent", "package.json");

const DSH_PRODUCT_PACKAGES = [
	"@deepseek-ai/dsh-tool-subagent",
	"@deepseek-ai/dsh-subagent-claude-code",
	"@deepseek-ai/dsh-subagent-codex",
	"@deepseek-ai/dsh-subagent-acp",
] as const;

export async function probeDshProductSubagentsInstalled(dshHome: string): Promise<boolean> {
	try {
		await access(join(dshHome, PRODUCT_SUBAGENT_MARKER));
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

/** Best-effort npm install of dsh product-subagent packages into DSH_HOME (background-safe). */
export async function ensureDshProductSubagents(input: EnsureDshProductSubagentsInput): Promise<boolean> {
	if (await probeDshProductSubagentsInstalled(input.dshHome)) {
		return true;
	}

	await mkdir(input.dshHome, { recursive: true });
	const packageJsonPath = join(input.dshHome, "package.json");
	let packageJson: Record<string, unknown> = {
		name: "pixeloffice-dsh-home",
		private: true,
	};
	try {
		packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
	} catch {
		// Fresh DSH_HOME — seed a minimal package.json below.
	}

	const dependencies =
		packageJson.dependencies && typeof packageJson.dependencies === "object" && !Array.isArray(packageJson.dependencies)
			? { ...(packageJson.dependencies as Record<string, string>) }
			: {};
	for (const pkg of DSH_PRODUCT_PACKAGES) {
		dependencies[pkg] = "latest";
	}
	packageJson.name = typeof packageJson.name === "string" && packageJson.name.length > 0 ? packageJson.name : "pixeloffice-dsh-home";
	packageJson.private = true;
	packageJson.dependencies = dependencies;
	await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");

	input.log?.(`Installing dsh product subagents in ${input.dshHome}…`);

	const exitCode = await runNpmInstall(input.dshHome);
	if (exitCode !== 0) {
		input.warn?.(
			`dsh product subagent install failed (exit ${exitCode}). Orchestrator delegation may be limited — see backends/runtime/docs/multi-agent-orchestration.md.`,
		);
		return false;
	}

	const installed = await probeDshProductSubagentsInstalled(input.dshHome);
	if (installed) {
		input.log?.("dsh product subagents ready.");
	}
	return installed;
}

function runNpmInstall(cwd: string): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn("npm", ["install", "--legacy-peer-deps", "--omit=dev", "--no-audit", "--no-fund"], {
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
