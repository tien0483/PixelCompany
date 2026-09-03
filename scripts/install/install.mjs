import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ensureNode22 } from "../lib/ensure-node22.mjs";
import { assertSupportedPlatform, isWsl } from "./platform.mjs";
import { readProductVersion, renderBanner } from "./banner.mjs";
import { checkboxSelect } from "./tui.mjs";
import { FEATURES, installFeature, writeStackFlags } from "./features.mjs";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// 1. Ensure Node >= 22
ensureNode22();

// 2. Platform guard
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
assertSupportedPlatform(repoRoot);
if (isWsl()) {
	console.log("WSL detected");
}

// 3. Render banner
const version = readProductVersion(repoRoot);
console.log(renderBanner(version));

// 4. Load prior install manifest if present
const manifestPath = join(repoRoot, ".pixtiel", "install-manifest.json");
let priorManifest = null;
if (existsSync(manifestPath)) {
	try {
		priorManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		priorManifest = null;
	}
}

const items = FEATURES.map((feat) => {
	let checked = feat.default;
	if (priorManifest && priorManifest.features && typeof priorManifest.features === "object") {
		checked = Boolean(priorManifest.features[feat.id]);
	}
	return {
		id: feat.id,
		label: feat.label,
		checked: feat.id === "kanban" ? true : checked,
		locked: feat.id === "kanban" || Boolean(feat.locked),
	};
});

// 5. Checkbox selection or CLI override
const validIds = FEATURES.map((f) => f.id);
let selectedIds = null;
let hasFeaturesFlag = false;
let featuresArgValue = null;
/** null = ask when interactive; true/false = forced by --start / --no-start. */
let startAfterInstall = null;

for (let i = 2; i < process.argv.length; i++) {
	const arg = process.argv[i];
	if (arg === "--features") {
		hasFeaturesFlag = true;
		if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith("-")) {
			featuresArgValue = process.argv[i + 1];
			i++;
		} else {
			featuresArgValue = "";
		}
	} else if (arg.startsWith("--features=")) {
		hasFeaturesFlag = true;
		featuresArgValue = arg.slice("--features=".length);
	} else if (arg === "--start") {
		startAfterInstall = true;
	} else if (arg === "--no-start") {
		startAfterInstall = false;
	}
}

if (hasFeaturesFlag) {
	const requested = (featuresArgValue || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const unknown = requested.filter((id) => !validIds.includes(id));
	if (unknown.length > 0) {
		console.error(`Unknown feature: ${unknown.join(", ")}`);
		console.error(`Valid features are: ${validIds.join(", ")}`);
		process.exit(2);
	}
	selectedIds = new Set(requested);
} else if (!process.stdin.isTTY) {
	selectedIds = new Set(items.filter((it) => it.checked).map((it) => it.id));
} else {
	const selection = await checkboxSelect(items);
	if (selection === null) {
		process.exit(130);
	}
	selectedIds = selection;
}

// 6. Install features in FEATURES order
const results = new Map();
for (const feat of FEATURES) {
	if (selectedIds.has(feat.id)) {
		const res = installFeature(feat, { repoRoot, log: console.log });
		results.set(feat.id, res);
	}
}

// 7. Shipped stack flags defaults for agent-stack if selected
if (selectedIds.has("agent-stack")) {
	const flagsPath = join(repoRoot, "backends", "agent_stack", "stack-flags.json");
	if (!existsSync(flagsPath)) {
		const defaultFlags = {
			ENABLE_UA: true,
			ENABLE_RTK: true,
			ENABLE_CAVEMAN: true,
			ENABLE_PONYTAIL: true,
			ENABLE_HEADROOM: true,
			ENABLE_CCR: false,
			ENABLE_DEVTOOLS: false,
		};
		writeStackFlags(repoRoot, defaultFlags);
	}
}

// 8. Write .pixtiel/install-manifest.json
const now = new Date().toISOString();
const manifestFeatures = {};
for (const [id, res] of results.entries()) {
	manifestFeatures[id] = {
		ok: Boolean(res?.ok),
		at: now,
	};
}

const pixtielDir = join(repoRoot, ".pixtiel");
mkdirSync(pixtielDir, { recursive: true });
const targetManifest = join(pixtielDir, "install-manifest.json");
const tempManifest = join(pixtielDir, `.install-manifest.json.tmp.${process.pid}.${Date.now()}`);
const manifestData = {
	version,
	installedAt: now,
	features: manifestFeatures,
};
writeFileSync(tempManifest, JSON.stringify(manifestData, null, 2) + "\n", "utf8");
renameSync(tempManifest, targetManifest);

// 9. Summary table & next step
console.log("\nInstallation Summary:\n");
for (const feat of FEATURES) {
	if (!selectedIds.has(feat.id)) continue;
	const res = results.get(feat.id);
	if (!res) continue;

	if (res.ok && res.skipped) {
		console.log(`  ${YELLOW}↷${RESET} ${feat.label.padEnd(45)} ${DIM}(skipped - already built)${RESET}`);
	} else if (res.ok) {
		console.log(`  ${GREEN}✓${RESET} ${feat.label.padEnd(45)} ${GREEN}installed${RESET}`);
	} else {
		const detail = res.hint ? `Hint: ${res.hint}` : (res.error || "failed");
		console.log(`  ${RED}✗${RESET} ${feat.label.padEnd(45)} ${RED}${detail}${RESET}`);
	}
}

const kanbanResult = results.get("kanban");
const coreInstalled = Boolean(kanbanResult && kanbanResult.ok);

/** One keypress-free y/n read on the controlling terminal. Defaults to yes on Enter. */
async function confirmStart() {
	process.stdout.write(`\n${CYAN}Start PIXTiel now?${RESET} ${DIM}[Y/n]${RESET} `);
	process.stdin.setEncoding("utf8");
	process.stdin.resume();
	const answer = await new Promise((resolveAnswer) => {
		const onData = (chunk) => {
			process.stdin.off("data", onData);
			process.stdin.pause();
			resolveAnswer(String(chunk).trim().toLowerCase());
		};
		process.stdin.on("data", onData);
	});
	return answer === "" || answer === "y" || answer === "yes";
}

if (!coreInstalled) {
	// A failed core install has nothing to start; say what to do and fail.
	console.log("\nNext step:");
	console.log(`  ${CYAN}pnpm run setup${RESET}   ${DIM}(re-run once the error above is fixed)${RESET}\n`);
	process.exit(1);
}

const wantsStart = startAfterInstall === null ? process.stdin.isTTY && (await confirmStart()) : startAfterInstall;

if (!wantsStart) {
	console.log("\nNext step:");
	console.log(`  ${CYAN}pnpm start${RESET}\n`);
	process.exit(0);
}

// Hand over to the server. `pm.mjs run` picks whichever client invoked us, so a
// pnpm install keeps using pnpm.
console.log(`\n${DIM}Starting… (Ctrl+C to stop)${RESET}\n`);
const handoff = spawnSync(process.execPath, [join(repoRoot, "scripts", "pm.mjs"), "run", "start"], {
	cwd: repoRoot,
	stdio: "inherit",
	windowsHide: true,
});
process.exit(handoff.status ?? 1);
