import { readFileSync } from "node:fs";

export function assertSupportedPlatform(repoRoot) {
	if (process.platform !== "linux") {
		throw new Error("PIXTiel installs on Ubuntu Linux or WSL only. For Windows, see scripts/windows/README.md.");
	}
	if (repoRoot.startsWith("/mnt/")) {
		throw new Error(`Repo is on ${repoRoot} — a 9p Windows mount. Clone to the native Linux filesystem (e.g. ~/pixtiel); node_modules on /mnt hangs forever.`);
	}
}

export function isWsl() {
	try {
		return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
	} catch {
		return false;
	}
}
