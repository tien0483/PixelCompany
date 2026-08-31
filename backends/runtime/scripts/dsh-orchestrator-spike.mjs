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
	},
});

const patchPath = resolvePatchPath();
if (patchPath === null) {
	process.stderr.write("Missing config/orchestrator/pixeloffice.patch.yml\n");
	process.exit(1);
}

const dshHome = process.env.PIXELOFFICE_DSH_HOME?.trim() || `${process.env.HOME}/.agent/dsh`;
const { command, prefix } = resolveDshCommand();
const args = [
	...prefix,
	"--profile",
	"headless",
	"--patch",
	patchPath,
	"--cwd",
	values.cwd,
	"--force",
	"--prompt",
	values.prompt,
];

process.stderr.write(`DSH_HOME=${dshHome}\n`);
process.stderr.write(`patch=${patchPath}\n`);
process.stderr.write(`exec: ${command} ${args.join(" ")}\n`);

const child = spawn(command, args, {
	cwd: values.cwd,
	env: {
		...process.env,
		DSH_HOME: dshHome,
		PIXELOFFICE_ORCHESTRATOR: "1",
	},
	stdio: "inherit",
});

child.on("exit", (code) => {
	process.exit(code ?? 1);
});
