// The two remaining `activate-stack.sh` daemons: CCR (:3456) and Claude DevTools
// (:3001). Both are flag-gated and both are OFF in the shipped
// `stack-flags.json`, so on a default checkout these supervisors resolve to
// no-ops — they exist so that flipping a flag in Stack Control actually does
// something without a sourced shell.
//
// Deliberately separate from `ccr-process.ts`: that file runs *per-seat* routers
// on 3460+ for the subagent-seat split. This is the single user-facing CCR the
// activator starts, and the two must not share a port or a config.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	isStackFlagEnabled,
	readStackFlags,
	resolveStackDaemonPort,
	type StackDaemonDependencies,
	superviseStackDaemon,
} from "./stack-daemon";
import { findStackRoot } from "./stack-paths";
import { createNoopProcess, type StackProcess } from "./stack-process";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_CCR_PORT = 3456;
/** Not CCR's own default of 3456: the standalone DevTools server would collide with it. */
const DEFAULT_DEVTOOLS_PORT = 3001;
/** CCR generates its router config on first start and can take a while to bind. */
const CCR_STARTUP_TIMEOUT_MS = 30_000;

export interface StartStackDaemonDependencies extends StackDaemonDependencies {
	/** Overrides `backends/agent_stack` discovery; mainly for tests. */
	stackRoot?: string | null;
	host?: string;
	port?: number;
}

function resolveStackRoot(configured: string | null | undefined): string | null {
	return configured === undefined ? findStackRoot() : configured;
}

/**
 * CCR hardcodes `os.homedir()/.claude-code-router` for its config, auth files and
 * logs — there is no env override in the vendored bundle. Pointing HOME at
 * `ccr-home/` is what keeps it out of the real `~` and away from any global CCR
 * install, exactly as the activator does.
 */
export async function startCcrProcess(deps: StartStackDaemonDependencies): Promise<StackProcess> {
	const log = deps.log ?? (() => {});
	const stackRoot = resolveStackRoot(deps.stackRoot);
	if (stackRoot === null) {
		log("Agent stack not installed next to the runtime — CCR stays offline.");
		return createNoopProcess(false);
	}

	if (!isStackFlagEnabled(readStackFlags(stackRoot), "ENABLE_CCR")) {
		log("CCR is disabled in stack-flags.json — the switchboard will route around it.");
		return createNoopProcess(false);
	}

	const binary = join(stackRoot, "node_modules", ".bin", process.platform === "win32" ? "ccr.cmd" : "ccr");
	if (!existsSync(binary)) {
		deps.warn(`CCR is flagged on but not installed at ${binary} — the switchboard will route around it.`);
		deps.warn(`  Install it with: cd ${stackRoot} && pnpm install`);
		return createNoopProcess(false);
	}

	const ccrHome = join(stackRoot, "ccr-home");
	try {
		mkdirSync(join(ccrHome, ".claude-code-router"), { recursive: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warn(`Could not prepare ${ccrHome}: ${message} — CCR stays offline.`);
		return createNoopProcess(false);
	}

	return superviseStackDaemon(
		{
			name: "ccr",
			label: "CCR",
			stackRoot,
			host: deps.host ?? DEFAULT_HOST,
			port: resolveStackDaemonPort("STACK_CCR_PORT", DEFAULT_CCR_PORT, deps.port),
			binary,
			args: ["start"],
			env: { HOME: ccrHome },
			startupTimeoutMs: CCR_STARTUP_TIMEOUT_MS,
			readinessHint: " — configure providers in ccr-home/.claude-code-router/config-router.json.",
		},
		deps,
	);
}

/**
 * npm's `claude-devtools` ships prebuilt binaries with no linux asset, so its
 * postinstall fails on this box; the upstream repo does have a non-Electron
 * "standalone" server target, which the activator prefers when built. Same order
 * here. The standalone server reads `$PORT` and defaults to 3456 — CCR's port —
 * so PORT is always set explicitly.
 */
export async function startDevToolsProcess(deps: StartStackDaemonDependencies): Promise<StackProcess> {
	const log = deps.log ?? (() => {});
	const stackRoot = resolveStackRoot(deps.stackRoot);
	if (stackRoot === null) {
		log("Agent stack not installed next to the runtime — DevTools stays offline.");
		return createNoopProcess(false);
	}

	if (!isStackFlagEnabled(readStackFlags(stackRoot), "ENABLE_DEVTOOLS")) {
		log("DevTools is disabled in stack-flags.json — not starting it.");
		return createNoopProcess(false);
	}

	const host = deps.host ?? DEFAULT_HOST;
	const port = resolveStackDaemonPort("STACK_DEVTOOLS_PORT", DEFAULT_DEVTOOLS_PORT, deps.port);
	const standalone = join(stackRoot, "src-claude-devtools", "dist-standalone", "index.cjs");
	const packaged = join(
		stackRoot,
		"node_modules",
		".bin",
		process.platform === "win32" ? "claude-devtools.cmd" : "claude-devtools",
	);

	const spec = existsSync(standalone)
		? { binary: process.execPath, args: [standalone], env: { PORT: String(port), HOST: host } }
		: existsSync(packaged)
			? { binary: packaged, args: ["--port", String(port)], env: undefined }
			: null;
	if (spec === null) {
		deps.warn(`DevTools is flagged on but neither ${standalone} nor ${packaged} exists — not starting it.`);
		return createNoopProcess(false);
	}

	return superviseStackDaemon(
		{
			name: "devtools",
			label: "DevTools",
			stackRoot,
			host,
			port,
			binary: spec.binary,
			args: spec.args,
			...(spec.env ? { env: spec.env } : {}),
		},
		deps,
	);
}
