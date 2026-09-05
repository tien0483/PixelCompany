import { readBrandEnv } from "../brand";
import { isBinaryAvailableOnPath } from "../terminal/command-discovery";
import { resolveRepoLocalDshBinary } from "./dsh-endpoint";

export interface ResolvedDshBinary {
	path: string;
	viaNpx: boolean;
}

/**
 * Resolves the DeepSeek Harness CLI for orchestrator task launches.
 *
 * Order is deliberate: an explicit pin, then the repo-local install (so a clone that ran
 * `scripts/install-dsh.mjs` is self-contained and version-pinned), then whatever the machine has
 * globally, and only then npx.
 *
 * The npx entry is a *reporting* fallback, not a launch path: `npx --yes @deepseek-ai/dsh` resolves
 * a ~100-package tree before running anything — measured at 219 s to a V8 heap OOM under the
 * default cap. Callers that spawn on a hot path must check `viaNpx` and refuse.
 */
export function resolveDshBinary(): ResolvedDshBinary | null {
	const override = readBrandEnv("DSH_BINARY")?.trim();
	if (override && isBinaryAvailableOnPath(override)) {
		return { path: override, viaNpx: false };
	}
	const repoLocal = resolveRepoLocalDshBinary();
	if (repoLocal) {
		return { path: repoLocal, viaNpx: false };
	}
	if (isBinaryAvailableOnPath("dsh")) {
		return { path: "dsh", viaNpx: false };
	}
	if (isBinaryAvailableOnPath("npx")) {
		return { path: "npx", viaNpx: true };
	}
	return null;
}

export function buildDshArgv(binary: ResolvedDshBinary, headlessArgs: string[]): { command: string; args: string[] } {
	if (!binary.viaNpx) {
		return { command: binary.path, args: headlessArgs };
	}
	return { command: binary.path, args: ["--yes", "@deepseek-ai/dsh", ...headlessArgs] };
}
