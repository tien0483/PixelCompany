// PIXTIEL half-block banner (P-5). Version comes from the runtime package —
// the single version source (DESIGN P-10).
import { readFileSync } from "node:fs";

export function formatVersion(version) {
	const [major = "0", minor = "0", patch = "0"] = String(version ?? "0.0.0").split(".");
	return `v${major}.${minor}.${patch.padStart(4, "0")}`;
}

export function readProductVersion(repoRoot) {
	const path = repoRoot ? `${repoRoot}/backends/runtime/package.json` : new URL("../../backends/runtime/package.json", import.meta.url);
	const pkg = JSON.parse(readFileSync(path, "utf8"));
	return pkg.version ?? "0.0.0";
}

const CYAN = "\x1b[36m", DIM = "\x1b[2m", RESET = "\x1b[0m";

export function renderBanner(version) {
	const art = [
		"█▀█ █ ▀▄▀ ▀█▀ █ █▀▀ █  ",
		"█▀▀ █ █ █  █  █ ██▄ █▄▄",
	];
	const rule = "─".repeat(29);
	return [
		"",
		...art.map((l) => ` ${CYAN}${l}${RESET}`),
		` ${DIM}${rule}${RESET}`,
		` AUTHOR: Tiến Nguyễn | ${formatVersion(version)}`,
		` ${DIM}${rule}${RESET}`,
		"",
	].join("\n");
}

if (process.argv.includes("--demo")) {
	const version = readProductVersion();
	console.log(renderBanner(version));
}
