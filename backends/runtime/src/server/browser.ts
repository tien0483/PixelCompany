import { spawn } from "node:child_process";
import open from "open";
import { detectHostEnvironment } from "../core/host-environment";
import { isBinaryAvailableOnPath } from "../terminal/command-discovery";

type BrowserOpenDeps = {
	warn?: (message: string) => void;
	openUrl?: typeof open;
	platform?: NodeJS.Platform;
	isBinaryAvailable?: (binary: string) => boolean;
	env?: NodeJS.ProcessEnv;
	spawnFn?: typeof spawn;
};

export function openInBrowser(url: string, deps?: BrowserOpenDeps): void {
	const warn = deps?.warn ?? (() => {});
	const openUrl = deps?.openUrl ?? open;
	const platform = deps?.platform ?? process.platform;
	const isBinaryAvailable = deps?.isBinaryAvailable ?? isBinaryAvailableOnPath;
	const env = deps?.env ?? process.env;
	const spawnFn = deps?.spawnFn ?? spawn;

	// `process.platform` reports "linux" for WSL too, so an unpatched Linux branch here
	// launches an X11/xdg-open browser inside WSL instead of the user's actual Windows
	// browser. Hand the URL to Windows via cmd.exe's `start`, which is what resolves the
	// OS default browser there. The URL is passed as its own argv entry (spawn without a
	// shell), so WSL's exe-interop layer quotes it for Windows rather than a shell
	// splitting on `&` in the OAuth query string.
	if (isBinaryAvailable("cmd.exe") && detectHostEnvironment(platform, env).isWsl) {
		try {
			const child = spawnFn("cmd.exe", ["/c", "start", "", url], { stdio: "ignore", detached: true });
			child.on("error", () => {
				warn(`Could not open browser automatically. Open this URL manually: ${url}`);
			});
			child.unref();
			return;
		} catch {
			warn(`Could not open browser automatically. Open this URL manually: ${url}`);
			return;
		}
	}

	// On Linux the `open` package ships a bundled xdg-open fallback.
	// Prefer system xdg-open when present so PATH-based overrides still work.
	const options = platform === "linux" && isBinaryAvailable("xdg-open") ? { app: { name: "xdg-open" } } : undefined;

	void openUrl(url, options).catch(() => {
		warn(`Could not open browser automatically. Open this URL manually: ${url}`);
	});
}
