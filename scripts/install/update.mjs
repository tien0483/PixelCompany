#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ensureNode22 } from "../lib/ensure-node22.mjs";
import { assertSupportedPlatform } from "./platform.mjs";
import { formatVersion, readProductVersion } from "./banner.mjs";
import { FEATURES, installFeature } from "./features.mjs";

const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

// 1. Ensure Node >= 22 and platform guard
ensureNode22();
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
assertSupportedPlatform(repoRoot);

// 2. Fetch latest tags
try {
	execSync("git fetch --tags --quiet", { cwd: repoRoot, stdio: ["ignore", "ignore", "ignore"] });
} catch {
	// Non-fatal if offline or no remote
}

// 3. Find latest release tag
function parseVersionTag(tag) {
	const m = String(tag).trim().match(/^v(\d+)\.(\d+)\.(\d+)$/);
	if (!m) return null;
	return {
		tag: tag.trim(),
		major: Number.parseInt(m[1], 10),
		minor: Number.parseInt(m[2], 10),
		patch: Number.parseInt(m[3], 10),
	};
}

function parseSemver(ver) {
	const m = String(ver).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
	if (!m) return { major: 0, minor: 0, patch: 0 };
	return {
		major: Number.parseInt(m[1], 10),
		minor: Number.parseInt(m[2], 10),
		patch: Number.parseInt(m[3], 10),
	};
}

function compareParsed(a, b) {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	return a.patch - b.patch;
}

let tagLines = [];
try {
	const out = execSync("git tag -l 'v*'", { cwd: repoRoot, encoding: "utf8" });
	tagLines = out.split("\n").map((s) => s.trim()).filter(Boolean);
} catch {
	tagLines = [];
}

const parsedTags = tagLines.map(parseVersionTag).filter(Boolean);
let latestTag = null;
for (const pt of parsedTags) {
	if (!latestTag || compareParsed(pt, latestTag) > 0) {
		latestTag = pt;
	}
}

const currentRawVersion = readProductVersion(repoRoot);
const currentParsed = parseSemver(currentRawVersion);
const currentFormatted = formatVersion(currentRawVersion);

const latestFormatted = latestTag
	? formatVersion(`${latestTag.major}.${latestTag.minor}.${latestTag.patch}`)
	: currentFormatted;

const isNewer = latestTag && compareParsed(latestTag, currentParsed) > 0;

if (!isNewer) {
	console.log(`Already up to date: ${currentFormatted} (latest: ${latestFormatted})`);
	process.exit(0);
}

// 4. Working tree check before pulling
let statusOut = "";
try {
	statusOut = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).trim();
} catch {
	console.error(`${RED}Error: Failed to check git status.${RESET}`);
	process.exit(1);
}

const dirtyTracked = statusOut
	.split("\n")
	.map((l) => l.trim())
	.filter((l) => l.length > 0 && !l.startsWith("??"));

if (dirtyTracked.length > 0) {
	console.error(`\n${RED}Error: Working tree contains uncommitted changes.${RESET}`);
	console.error("Please commit or stash your changes before updating.\n");
	process.exit(1);
}

// 5. Pull fast-forward
console.log(`Pulling update to ${latestFormatted}...`);
try {
	execSync("git pull --ff-only", { cwd: repoRoot, stdio: "inherit" });
} catch {
	console.error(`\n${RED}Error: Fast-forward pull failed.${RESET}`);
	console.error("Your branch may have diverged. Please check 'git status' and resolve conflicts manually.\n");
	process.exit(1);
}

// 6. Submodule updates & reinstall ok features from manifest
const manifestPath = join(repoRoot, ".pixtiel", "install-manifest.json");
let priorManifest = null;
if (existsSync(manifestPath)) {
	try {
		priorManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		priorManifest = null;
	}
}

const okFeatureIds = new Set();
if (priorManifest && priorManifest.features && typeof priorManifest.features === "object") {
	for (const [id, val] of Object.entries(priorManifest.features)) {
		if (val && val.ok) {
			okFeatureIds.add(id);
		}
	}
} else {
	for (const feat of FEATURES) {
		if (feat.default) {
			okFeatureIds.add(feat.id);
		}
	}
}
okFeatureIds.add("kanban");

// Update submodules for submodule-backed features marked ok
for (const feat of FEATURES) {
	if (!okFeatureIds.has(feat.id)) continue;
	for (const step of feat.steps ?? []) {
		if (typeof step.run === "string" && step.run.includes("git submodule update --init")) {
			try {
				execSync(step.run, { cwd: repoRoot, stdio: "inherit" });
			} catch {
				console.warn(`${YELLOW}Warning: Submodule update step failed for ${feat.id}: ${step.run}${RESET}`);
			}
		}
	}
}

// Re-run installFeature for each ok feature
const results = new Map();
for (const feat of FEATURES) {
	if (okFeatureIds.has(feat.id)) {
		const res = installFeature(feat, { repoRoot, log: console.log });
		results.set(feat.id, res);
	}
}

// Update .pixtiel/install-manifest.json with new version
const newRawVersion = readProductVersion(repoRoot);
const newFormatted = formatVersion(newRawVersion);
const now = new Date().toISOString();
const updatedFeatures = {};
for (const id of okFeatureIds) {
	const res = results.get(id);
	updatedFeatures[id] = {
		ok: Boolean(res?.ok ?? true),
		at: now,
	};
}

const pixtielDir = join(repoRoot, ".pixtiel");
mkdirSync(pixtielDir, { recursive: true });
const targetManifest = join(pixtielDir, "install-manifest.json");
const tempManifest = join(pixtielDir, `.install-manifest.json.tmp.${process.pid}.${Date.now()}`);
const manifestData = {
	version: newRawVersion,
	installedAt: now,
	features: updatedFeatures,
};
writeFileSync(tempManifest, JSON.stringify(manifestData, null, 2) + "\n", "utf8");
renameSync(tempManifest, targetManifest);

// 7. Print old -> new and the start reminder
console.log(`\nUpdated PIXTiel: ${currentFormatted} → ${newFormatted}\n`);
console.log("Next step:");
console.log(`  ${CYAN}pnpm start${RESET}\n`);
process.exit(0);
