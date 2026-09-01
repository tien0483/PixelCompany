// Supervises Headroom (the context-compression proxy the switchboard fronts) so
// that "the stack is up" stops depending on which shell launched Kanban.
//
// Before this, headroom was started *only* by an interactive
// `source backends/agent_stack/activate-stack.sh`, while the runtime spawned the
// switchboard itself (`stack-process.ts`). Every runtime restart therefore lost
// headroom for good: `server.py`'s `resolve_route` found 8787 closed, appended
// `headroom:8787 DOWN (skipped)` to the chain and routed straight to
// api.anthropic.com — correct behaviour, silently degraded forever.
//
// Whether a task agent's traffic actually crosses this proxy is a separate
// decision, made by `scripts/solo.mjs` (`--no-proxy-env`): agents only reach the
// chain when `ANTHROPIC_BASE_URL` points at the switchboard.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	createNoopProcess,
	isStackFlagEnabled,
	readStackFlags,
	resolveStackDaemonPort,
	type StackDaemonDependencies,
	type StackProcess,
	superviseStackDaemon,
} from "./stack-daemon";
import { findStackRoot } from "./stack-paths";

const DEFAULT_HEADROOM_HOST = "127.0.0.1";
const DEFAULT_HEADROOM_PORT = 8787;
const DEFAULT_CCR_PORT = 3456;

export interface StartHeadroomProcessDependencies extends StackDaemonDependencies {
	/** Overrides `backends/agent_stack` discovery; mainly for tests. */
	stackRoot?: string | null;
	host?: string;
	port?: number;
}

export function resolveHeadroomPort(configured?: number | undefined): number {
	return resolveStackDaemonPort("STACK_HEADROOM_PORT", DEFAULT_HEADROOM_PORT, configured);
}

const DEFAULT_HEADROOM_PROTECT_TOOLS = ["Read", "Grep", "Glob", "Bash", "Write", "Edit"];

function readHeadroomProxyConfig(stackRoot: string): { mode: string; protectToolResults: string[] } {
	const configPath = join(stackRoot, "config", "headroom-proxy.json");
	if (!existsSync(configPath)) {
		return { mode: "cache", protectToolResults: DEFAULT_HEADROOM_PROTECT_TOOLS };
	}
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
			mode?: unknown;
			protectToolResults?: unknown;
		};
		return {
			mode: typeof parsed.mode === "string" ? parsed.mode : "cache",
			protectToolResults: Array.isArray(parsed.protectToolResults)
				? parsed.protectToolResults.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
				: DEFAULT_HEADROOM_PROTECT_TOOLS,
		};
	} catch {
		return { mode: "cache", protectToolResults: DEFAULT_HEADROOM_PROTECT_TOOLS };
	}
}

/**
 * Mirrors `activate-stack.sh`: headroom proxies to Anthropic itself, and only
 * chains through CCR when `--anthropic-api-url` says so. The per-seat routers on
 * 3460+ are a different mechanism (`ccr-process.ts`) and are never chained here.
 *
 * Cache mode + protected tool results keep Headroom from lossy-compressing code
 * blocks and agent tool output when Ponytail/Caveman are also active — see
 * `config/headroom-proxy.json` and `rules/stack-compression-coexistence.mdc`.
 */
export function buildHeadroomArgs(options: {
	host: string;
	port: number;
	chainToCcr: boolean;
	stackRoot?: string;
}): string[] {
	const proxyConfig = readHeadroomProxyConfig(options.stackRoot ?? findStackRoot() ?? "");
	const args = ["proxy", "--host", options.host, "--port", String(options.port), "--mode", proxyConfig.mode];
	if (proxyConfig.protectToolResults.length > 0) {
		args.push("--protect-tool-results", proxyConfig.protectToolResults.join(","));
	}
	if (options.chainToCcr) {
		const ccrPort = resolveStackDaemonPort("STACK_CCR_PORT", DEFAULT_CCR_PORT);
		args.push("--anthropic-api-url", `http://127.0.0.1:${String(ccrPort)}`);
	}
	return args;
}

/** Same venv-first reasoning as `resolveStackPython`: headroom lives in the stack's `.venv`. */
function resolveHeadroomBinary(stackRoot: string): string | null {
	const configured = process.env.STACK_HEADROOM_BIN?.trim();
	if (configured) {
		return existsSync(configured) ? configured : null;
	}
	const venvBinary =
		process.platform === "win32"
			? join(stackRoot, ".venv", "Scripts", "headroom.exe")
			: join(stackRoot, ".venv", "bin", "headroom");
	return existsSync(venvBinary) ? venvBinary : null;
}

/**
 * Starts headroom unless the flags say otherwise or it is already listening, and
 * keeps it alive with a backoff restart.
 */
export async function startHeadroomProcess(deps: StartHeadroomProcessDependencies): Promise<StackProcess> {
	const host = deps.host ?? DEFAULT_HEADROOM_HOST;
	const port = resolveHeadroomPort(deps.port);
	const log = deps.log ?? (() => {});

	const stackRoot = deps.stackRoot === undefined ? findStackRoot() : deps.stackRoot;
	if (stackRoot === null) {
		// Not a warning: most checkouts never install the stack.
		log("Agent stack not installed next to the runtime — Headroom stays offline.");
		return createNoopProcess(false);
	}

	const flags = readStackFlags(stackRoot);
	if (!isStackFlagEnabled(flags, "ENABLE_HEADROOM")) {
		log("Headroom is disabled in stack-flags.json — the switchboard will route around it.");
		return createNoopProcess(false);
	}

	const binary = resolveHeadroomBinary(stackRoot);
	if (binary === null) {
		deps.warn(`Headroom binary missing in ${join(stackRoot, ".venv")} — the switchboard will route around it.`);
		deps.warn(`  Install it with: cd ${stackRoot} && uv sync`);
		return createNoopProcess(false);
	}

	const chainToCcr = isStackFlagEnabled(flags, "ENABLE_CCR");
	return superviseStackDaemon(
		{
			name: "headroom",
			label: "Headroom",
			stackRoot,
			host,
			port,
			binary,
			args: buildHeadroomArgs({ host, port, chainToCcr, stackRoot }),
			// Published so `server.py` can tell a headroom that really reaches CCR from one
			// that does not, rather than inferring it from a flag this process cannot re-read.
			chainState: chainToCcr ? "ccr" : "direct",
			readinessHint: " — the switchboard will route around it.",
		},
		deps,
	);
}
