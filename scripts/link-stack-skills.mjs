/**
 * Links the agent stack's skills into this checkout's `.claude/skills`.
 *
 * This is the filesystem half of `backends/agent_stack/activate-stack.sh`, split
 * out so it can run from a Node process. The activator itself refuses to be
 * executed (it hard-guards on `${BASH_SOURCE[0]} = $0`) because the rest of what
 * it does — PATH, the sandbox venv, `ANTHROPIC_BASE_URL`, the CCR/headroom
 * daemons — is shell- and session-scoped and would be discarded by a subprocess.
 * Symlinking skills is the one part with no such constraint: it is idempotent,
 * touches only this repo, and is exactly what makes `/understand` and friends
 * resolvable to an agent started in this directory.
 *
 * Deliberately NOT ported here: the env exports (they would silently route every
 * runtime-spawned agent through the switchboard proxy and downgrade subagents).
 * `scripts/ensure-agent-stack.mjs` (called from `pnpm start`) handles shallow
 * clones, venv sync, skill links, and on `--restart` stops stack daemons and frees
 * stack ports so the runtime spawns fresh headroom/ccr/switchboard instances.
 * Keep sourcing the activator in your own shell for session-scoped env exports.
 *
 * Usage:
 *   node scripts/link-stack-skills.mjs            # link, print a summary
 *   node scripts/link-stack-skills.mjs --quiet    # only print problems
 *   STACK_SANDBOX=/path/to/sandbox node scripts/link-stack-skills.mjs
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	buildHeadroomProxyArgs,
	wrapCompressionProtected,
	wrapPonytailRuleDocument,
} from "../backends/agent_stack/lib/compression-coexistence.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

/** Windows cannot create directory symlinks without elevation, but junctions are unprivileged. */
const DIR_LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

/**
 * The stack lives in-tree at `backends/agent_stack`. `~/agent-stack-sandbox` is
 * still probed second: that was the original location, and a checkout that has
 * not run the installer yet may only have the out-of-tree copy.
 */
export function resolveSandboxDir() {
	const fromEnv = process.env.STACK_SANDBOX?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	const inRepo = join(repoRoot, "backends", "agent_stack");
	return existsSync(inRepo) ? inRepo : join(homedir(), "agent-stack-sandbox");
}

/**
 * Mirrors the activator's `stack_flag`: a missing or corrupt flags file defaults
 * every tool ON, so a half-installed sandbox fails loudly rather than silently
 * skipping the link and leaving `/understand` unresolvable for no stated reason.
 */
export function readStackFlags(sandboxDir) {
	try {
		return JSON.parse(readFileSync(join(sandboxDir, "stack-flags.json"), "utf8"));
	} catch {
		return null;
	}
}

function flagEnabled(flags, key) {
	return flags === null ? true : Boolean(flags[key]);
}

const UA_DATA_DIR_CANDIDATES = [".understand-anything", ".ua"];
const UA_KNOWLEDGE_GRAPH = "knowledge-graph.json";
const UA_SKILL_NAME_PREFIX = "understand";

/** True when this checkout has a built Understand Anything graph. */
export function hasUnderstandAnythingGraph(checkoutRoot) {
	for (const dir of UA_DATA_DIR_CANDIDATES) {
		if (existsSync(join(checkoutRoot, dir, UA_KNOWLEDGE_GRAPH))) {
			return true;
		}
	}
	return false;
}

function isUnderstandAnythingSkillName(name) {
	return name === UA_SKILL_NAME_PREFIX || name.startsWith(`${UA_SKILL_NAME_PREFIX}-`);
}

/** Drops stack-linked UA skill symlinks when the project has no graph. */
function unlinkUnderstandAnythingSkills(destDirs) {
	const removed = [];
	for (const destDir of destDirs) {
		if (!existsSync(destDir)) {
			continue;
		}
		for (const name of readdirSync(destDir)) {
			if (!isUnderstandAnythingSkillName(name)) {
				continue;
			}
			const dest = join(destDir, name);
			try {
				if (lstatSync(dest).isSymbolicLink()) {
					rmSync(dest, { force: true });
					removed.push(`${name} [${destDir.split(/[/\\]/).slice(-2).join("/")}]`);
				}
			} catch {
				// Entry vanished between readdir and lstat — skip.
			}
		}
	}
	return removed;
}

/** `existsSync` follows symlinks, so a link pointing at a deleted target reads as absent. */
function entryPresent(path) {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Never clobbers a real entry: an existing directory or a live link is reported
 * and left alone, matching the activator's `stack_link_skill`. A repo-local skill
 * of the same name always wins.
 *
 * The one thing it does replace is a *dangling* symlink — a link whose target no
 * longer exists can only be a stale link from an earlier sandbox location (the
 * move from `~/agent-stack-sandbox` to `backends/agent_stack` left ten of them),
 * and leaving it in place makes the skill unresolvable with no way to self-heal.
 */
function linkSkill(source, destDir, name) {
	const dest = join(destDir, name);
	if (entryPresent(dest)) {
		if (existsSync(dest)) {
			return "exists";
		}
		if (!lstatSync(dest).isSymbolicLink()) {
			return "broken";
		}
		rmSync(dest, { force: true });
	}
	mkdirSync(destDir, { recursive: true });
	symlinkSync(source, dest, DIR_LINK_TYPE);
	return "linked";
}

function linkRuleFile(source, dest, label) {
	if (!existsSync(source)) {
		return "missing";
	}
	if (entryPresent(dest)) {
		if (existsSync(dest)) {
			return "exists";
		}
		if (!lstatSync(dest).isSymbolicLink()) {
			return "broken";
		}
		rmSync(dest, { force: true });
	}
	mkdirSync(dirname(dest), { recursive: true });
	symlinkSync(source, dest);
	return "linked";
}

/** Writes a generated rule file (used for compression-protected Ponytail rules). */
function writeRuleFile(source, dest, transform) {
	if (!existsSync(source)) {
		return "missing";
	}
	if (entryPresent(dest)) {
		if (lstatSync(dest).isSymbolicLink()) {
			rmSync(dest, { force: true });
		} else if (existsSync(dest)) {
			return "exists";
		} else {
			return "broken";
		}
	}
	mkdirSync(dirname(dest), { recursive: true });
	const content = transform(readFileSync(source, "utf8"));
	writeFileSync(dest, content.endsWith("\n") ? content : `${content}\n`, "utf8");
	return "linked";
}

function collectSources(sandboxDir, flags, repoRootPath) {
	const sources = [];
	const linkUa =
		flagEnabled(flags, "ENABLE_UA") && hasUnderstandAnythingGraph(repoRootPath);
	if (linkUa) {
		const uaSkills = join(sandboxDir, "src-understand-anything", "understand-anything-plugin", "skills");
		if (existsSync(uaSkills)) {
			for (const name of readdirSync(uaSkills)) {
				const dir = join(uaSkills, name);
				if (lstatSync(dir).isDirectory()) {
					sources.push({ label: "UA", name, path: dir });
				}
			}
		}
	}
	if (flagEnabled(flags, "ENABLE_CAVEMAN")) {
		const caveman = join(sandboxDir, "skills", "caveman");
		if (existsSync(caveman)) {
			sources.push({ label: "Caveman", name: "caveman", path: caveman });
		}
	}
	if (flagEnabled(flags, "ENABLE_PONYTAIL")) {
		const ponytailSkills = join(sandboxDir, "src-ponytail", "skills");
		if (existsSync(ponytailSkills)) {
			for (const name of readdirSync(ponytailSkills)) {
				const dir = join(ponytailSkills, name);
				if (lstatSync(dir).isDirectory()) {
					sources.push({ label: "Ponytail", name, path: dir });
				}
			}
		}
	}
	return sources;
}

function collectPonytailRules(sandboxDir, flags, repoRoot) {
	const rules = [];
	if (!flagEnabled(flags, "ENABLE_PONYTAIL")) {
		return rules;
	}
	const ponytailRoot = join(sandboxDir, "src-ponytail");
	if (!existsSync(ponytailRoot)) {
		return rules;
	}
	const cursorRule = join(ponytailRoot, ".cursor", "rules", "ponytail.mdc");
	if (existsSync(cursorRule)) {
		rules.push({
			label: "Ponytail",
			source: cursorRule,
			dest: join(repoRoot, ".cursor", "rules", "ponytail.mdc"),
			write: true,
			transform: wrapPonytailRuleDocument,
		});
	}
	const agentsRule = join(ponytailRoot, ".agents", "rules", "ponytail.md");
	if (existsSync(agentsRule)) {
		rules.push({
			label: "Ponytail",
			source: agentsRule,
			dest: join(repoRoot, ".agents", "rules", "ponytail.md"),
			write: true,
			transform: (body) => `${wrapCompressionProtected(body)}\n`,
		});
	}
	return rules;
}

function shouldLinkCompressionCoexistence(flags) {
	return (
		flagEnabled(flags, "ENABLE_CAVEMAN") ||
		flagEnabled(flags, "ENABLE_PONYTAIL") ||
		flagEnabled(flags, "ENABLE_HEADROOM")
	);
}

function collectCompressionCoexistenceRules(sandboxDir, flags, repoRoot) {
	if (!shouldLinkCompressionCoexistence(flags)) {
		return [];
	}
	const source = join(sandboxDir, "rules", "stack-compression-coexistence.mdc");
	if (!existsSync(source)) {
		return [];
	}
	return [
		{
			label: "Stack",
			source,
			dest: join(repoRoot, ".cursor", "rules", "stack-compression-coexistence.mdc"),
			write: false,
		},
		{
			label: "Stack",
			source,
			dest: join(repoRoot, ".agents", "rules", "stack-compression-coexistence.md"),
			transform: (body) => body.replace(/^---[\s\S]*?---\s*/, ""),
			write: true,
		},
	];
}

/**
 * Understand-Anything resolves its own plugin root at runtime, probing
 * `$CLAUDE_PLUGIN_ROOT`, `~/.understand-anything-plugin`, the realpath of
 * `~/.agents/skills/understand`, and a few `$HOME` clone paths. It never looks in
 * `.claude/skills`, so the skill links this script creates are not enough on
 * their own: without `~/.understand-anything-plugin`, `/understand` exits with
 * "Cannot find the understand-anything plugin root".
 *
 * That link is the one thing the stack owns outside its own directory, and it
 * points at a checkout inside this repo — so moving or deleting the repo breaks
 * `/understand` in *every* project on the machine. Repairing it here is what
 * keeps that from being a silent, permanent break: the next `pnpm start` fixes
 * it. Only ever created or repaired, never repointed away from a link that
 * already resolves — a second checkout that got there first keeps ownership.
 */
function ensurePluginRootLink(pluginRoot) {
	const link = join(homedir(), ".understand-anything-plugin");
	if (!entryPresent(link)) {
		symlinkSync(pluginRoot, link, DIR_LINK_TYPE);
		return { status: "linked", link };
	}
	const isSymlink = lstatSync(link).isSymbolicLink();
	if (existsSync(link)) {
		const current = isSymlink ? realpathSync(link) : link;
		return current === realpathSync(pluginRoot)
			? { status: "ok", link }
			: { status: "foreign", link, current };
	}
	if (!isSymlink) {
		return { status: "foreign", link, current: link };
	}
	// Dangling: the only way here is a checkout that moved or was deleted.
	rmSync(link, { force: true });
	symlinkSync(pluginRoot, link, DIR_LINK_TYPE);
	return { status: "repaired", link };
}

/**
 * Repairs what can be repaired and reports what cannot. Anything left in
 * `warnings` needs a human: a build step, or a conflicting install.
 */
function ensureUnderstandAnything(sandboxDir, flags, repoRootPath) {
	const warnings = [];
	if (!flagEnabled(flags, "ENABLE_UA") || !hasUnderstandAnythingGraph(repoRootPath)) {
		return warnings;
	}
	const pluginRoot = join(sandboxDir, "src-understand-anything", "understand-anything-plugin");
	if (!existsSync(pluginRoot)) {
		return warnings;
	}
	try {
		const result = ensurePluginRootLink(pluginRoot);
		if (result.status === "foreign") {
			warnings.push(
				`${result.link} already points at ${result.current} — leaving it alone. ` +
					"/understand will use that checkout, not this one.",
			);
		} else if (result.status === "repaired") {
			warnings.push(`${result.link} was dangling and has been repointed at ${pluginRoot}.`);
		}
	} catch (error) {
		warnings.push(
			`could not create ${join(homedir(), ".understand-anything-plugin")} (${error.code ?? error.message}) — ` +
				`/understand cannot find its plugin root. Fix: ln -s ${pluginRoot} ~/.understand-anything-plugin`,
		);
	}
	if (!existsSync(join(pluginRoot, "packages", "core", "dist"))) {
		warnings.push(`UA core not built — run 'pnpm run build' in ${join(pluginRoot, "packages", "core")}`);
	}
	return warnings;
}

export const DEFAULT_SKILL_DEST_DIRS = [
	join(repoRoot, ".claude", "skills"),
	join(repoRoot, ".agent", "skills"),
	join(repoRoot, ".cursor", "skills"),
];

/**
 * Returns a summary instead of exiting, so callers (solo.mjs) can treat a missing
 * sandbox as a non-event: this repo has to stay runnable on a machine that never
 * installed the stack.
 */
export function linkStackSkills({
	sandboxDir = resolveSandboxDir(),
	destDir,
	destDirs = destDir ? [destDir] : DEFAULT_SKILL_DEST_DIRS,
	repoRootPath = repoRoot,
} = {}) {
	if (!existsSync(sandboxDir)) {
		return {
			sandboxDir,
			present: false,
			linked: [],
			existing: [],
			broken: [],
			removed: [],
			understandAnythingActive: false,
			warnings: [],
		};
	}
	const flags = readStackFlags(sandboxDir);
	const linked = [];
	const existing = [];
	const broken = [];
	const removed = [];
	const destDirList = destDirs ?? (destDir ? [destDir] : DEFAULT_SKILL_DEST_DIRS);
	const sources = collectSources(sandboxDir, flags, repoRootPath);

	if (!flagEnabled(flags, "ENABLE_UA") || !hasUnderstandAnythingGraph(repoRootPath)) {
		removed.push(...unlinkUnderstandAnythingSkills(destDirList));
	}

	for (const targetDir of destDirList) {
		for (const source of sources) {
			let result;
			try {
				result = linkSkill(source.path, targetDir, source.name);
			} catch (error) {
				broken.push(`${source.name} -> ${targetDir} (${error.code ?? error.message})`);
				continue;
			}
			const record = `${source.name} [${targetDir.split(/[/\\]/).slice(-2).join("/")}]`;
			if (result === "linked") {
				linked.push(record);
			} else if (result === "broken") {
				broken.push(`${record} (existing link has no target)`);
			} else {
				existing.push(record);
			}
		}
	}

	for (const rule of [...collectPonytailRules(sandboxDir, flags, repoRootPath), ...collectCompressionCoexistenceRules(sandboxDir, flags, repoRootPath)]) {
		let result;
		try {
			if (rule.write) {
				result = writeRuleFile(rule.source, rule.dest, rule.transform ?? ((body) => body));
			} else {
				result = linkRuleFile(rule.source, rule.dest, rule.label);
			}
		} catch (error) {
			broken.push(`${rule.dest} (${error.code ?? error.message})`);
			continue;
		}
		const record = `${rule.dest.split(/[/\\]/).slice(-3).join("/")}`;
		if (result === "linked") {
			linked.push(record);
		} else if (result === "broken") {
			broken.push(`${record} (existing link has no target)`);
		} else if (result === "exists") {
			existing.push(record);
		}
	}

	return {
		sandboxDir,
		present: true,
		linked,
		existing,
		broken,
		removed,
		understandAnythingActive:
			flagEnabled(flags, "ENABLE_UA") && hasUnderstandAnythingGraph(repoRootPath),
		warnings: ensureUnderstandAnything(sandboxDir, flags, repoRootPath),
	};
}

export function reportStackSkills(summary, { quiet = false } = {}) {
	if (!summary.present) {
		if (!quiet) {
			console.log(`Agent stack: no sandbox at ${summary.sandboxDir} — skipping skill links.`);
		}
		return;
	}
	if (!quiet && summary.removed?.length > 0) {
		console.log(`Agent stack skills: removed ${summary.removed.length} UA link(s) (no .ua graph in this project)`);
	}
	if (!quiet && (summary.linked.length > 0 || summary.existing.length > 0)) {
		const parts = [];
		if (summary.linked.length > 0) {
			parts.push(`${summary.linked.length} linked (${summary.linked.join(", ")})`);
		}
		if (summary.existing.length > 0) {
			parts.push(`${summary.existing.length} already present`);
		}
		console.log(`Agent stack skills: ${parts.join(", ")}`);
	}
	for (const name of summary.broken) {
		console.warn(`  Agent stack: could not link ${name}`);
	}
	for (const warning of summary.warnings) {
		console.warn(`  Agent stack: ${warning}`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
	reportStackSkills(linkStackSkills(), { quiet: process.argv.includes("--quiet") });
}
