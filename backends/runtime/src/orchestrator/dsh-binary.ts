import { isBinaryAvailableOnPath } from "../terminal/command-discovery";

export interface ResolvedDshBinary {
	path: string;
	viaNpx: boolean;
}

/** Resolves the DeepSeek Harness CLI for orchestrator task launches. */
export function resolveDshBinary(): ResolvedDshBinary | null {
	const override = process.env.PIXELOFFICE_DSH_BINARY?.trim();
	if (override && isBinaryAvailableOnPath(override)) {
		return { path: override, viaNpx: false };
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
