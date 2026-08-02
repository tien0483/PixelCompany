import { readFileSync } from "node:fs";

import type { RuntimeHostEnvironmentResponse } from "./api-contract.js";

type HostPlatform = RuntimeHostEnvironmentResponse["platform"];

function resolveHostPlatform(nodePlatform: NodeJS.Platform): HostPlatform {
	if (nodePlatform === "darwin") {
		return "mac";
	}
	if (nodePlatform === "win32") {
		return "windows";
	}
	return "linux";
}

function readProcVersion(): string {
	try {
		return readFileSync("/proc/version", "utf8");
	} catch {
		return "";
	}
}

/**
 * Detects whether the running Linux kernel is the WSL interop kernel. Windows
 * Subsystem for Linux sets `WSL_DISTRO_NAME`/`WSL_INTEROP` in the environment and
 * ships a kernel whose `/proc/version` advertises "microsoft"/"WSL". Any one signal
 * is sufficient — env vars can be stripped by a bare shell, and `/proc/version`
 * is unreadable in some sandboxes.
 */
function detectWsl(env: NodeJS.ProcessEnv, procVersion: string): boolean {
	if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
		return true;
	}
	const normalized = procVersion.toLowerCase();
	return normalized.includes("microsoft") || normalized.includes("wsl");
}

/**
 * Reports the environment of the runtime *host* — the machine that actually
 * executes shell commands via `runCommand`. The browser's platform (from
 * `navigator`) is unreliable for this: in WSL the browser is Windows but the host
 * is Linux, so commands must be built for Linux/WSL, not Windows.
 */
export function detectHostEnvironment(
	nodePlatform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	procVersion: string = readProcVersion(),
): RuntimeHostEnvironmentResponse {
	const platform = resolveHostPlatform(nodePlatform);
	const isWsl = platform === "linux" && detectWsl(env, procVersion);
	return { platform, isWsl };
}
