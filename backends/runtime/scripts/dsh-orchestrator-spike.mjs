#!/usr/bin/env node
/**
 * Manual spike: run dsh headless in a worktree with the PixelOffice orchestrator patch.
 *
 * Usage:
 *   node backends/runtime/scripts/dsh-orchestrator-spike.mjs --cwd /path/to/worktree --prompt "Hello"
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function resolvePatchPath() {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(here, "../config/orchestrator/pixeloffice.patch.yml"),
		resolve(here, "../../config/orchestrator/pixeloffice.patch.yml"),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveDshCommand() {
	const override = process.env.PIXELOFFICE_DSH_BINARY?.trim();
	if (override) {
		return { command: override, prefix: [] };
	}
	return { command: "dsh", prefix: [] };
}

const { values } = parseArgs({
	options: {
		cwd: { type: "string", default: process.cwd() },
		prompt: {
			type: "string",
			default: "List files in the working directory and summarize the repo.",
		},
		provider: {
			type: "string",
			default: process.env.PIXELOFFICE_DSH_LLM_PROVIDER || "cursor",
		},
	},
});

const patchPath = resolvePatchPath();
if (patchPath === null) {
	process.stderr.write("Missing config/orchestrator/pixeloffice.patch.yml\n");
	process.exit(1);
}

const dshHome = process.env.PIXELOFFICE_DSH_HOME?.trim() || `${process.env.HOME}/.agent/dsh`;
const { command, prefix } = resolveDshCommand();

let llmPatchFile = null;
let cleanup = async () => {};
const provider = values.provider?.toLowerCase() || "cursor";

if (provider !== "deepseek") {
	const proxyUrl = process.env.PIXELOFFICE_FLOWISE_LLM_PROXY_URL?.trim() || "http://127.0.0.1:3484/api/flowise-llm-proxy";
	const model = process.env.PIXELOFFICE_DSH_LLM_MODEL?.trim() || "auto/best-coding";
	const baseURL = `${proxyUrl}/${provider}/v1`;

	const rows = [
		{
			id: "llm-pi-ai",
			config: {
				providers: {
					openai: {
						apiKeyEnv: "PIXELOFFICE_DSH_LLM_PROXY_TOKEN",
						baseURL,
						models: [{ id: model, name: `PixelOffice ${provider} seat`, contextWindow: 1_000_000, maxTokens: 384_000 }],
					},
				},
			},
		},
		{ id: "agent-default-model", config: { provider: "openai", model } },
	];

	const dir = await mkdtemp(join(tmpdir(), "pixeloffice-dsh-spike-"));
	llmPatchFile = join(dir, "llm.patch.json");
	await writeFile(llmPatchFile, JSON.stringify(rows, null, 2), "utf8");
	cleanup = async () => {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	};
}

const args = [...prefix, "--profile", "headless", "--patch", patchPath];
if (llmPatchFile) {
	args.push("--patch", llmPatchFile);
}
args.push(values.prompt);

process.stderr.write(`DSH_HOME=${dshHome}\n`);
process.stderr.write(`patch=${patchPath}\n`);
if (llmPatchFile) process.stderr.write(`llmPatch=${llmPatchFile}\n`);
process.stderr.write(`exec: ${command} ${args.join(" ")}\n`);

const child = spawn(command, args, {
	cwd: values.cwd,
	env: {
		...process.env,
		DSH_HOME: dshHome,
		PIXELOFFICE_ORCHESTRATOR: "1",
		PIXELOFFICE_DSH_LLM_PROXY_TOKEN: "pixeloffice-seat-proxy",
	},
	stdio: "inherit",
});

child.on("exit", async (code) => {
	await cleanup();
	process.exit(code ?? 1);
});

