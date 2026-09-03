// Runtime hook for scripts/link-stack-skills.mjs — keeps UA, Caveman, and Ponytail
// resolvable in the home repo and in every task worktree without requiring a
// sourced activate-stack.sh or a prior `pnpm start`.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { findStackRoot } from "./stack-paths";

type LinkStackSkillsModule = {
	linkStackSkills: (options?: {
		sandboxDir?: string;
		destDir?: string;
		destDirs?: string[];
		repoRootPath?: string;
	}) => {
		present: boolean;
		warnings: string[];
		broken: string[];
	};
};

function resolveLinkStackSkillsScript(checkoutRoot: string): string | null {
	const script = join(checkoutRoot, "scripts", "link-stack-skills.mjs");
	return existsSync(script) ? script : null;
}

/** Monorepo root when agent_stack is in-tree; null when the stack is absent. */
export function resolveStackRepoRoot(): string | null {
	const stackRoot = findStackRoot();
	if (stackRoot === null) {
		return null;
	}
	return resolve(stackRoot, "../..");
}

function skillDestDirs(checkoutRoot: string): string[] {
	return [
		join(checkoutRoot, ".claude", "skills"),
		join(checkoutRoot, ".agent", "skills"),
		join(checkoutRoot, ".cursor", "skills"),
	];
}

/**
 * Symlinks stack skills (and Ponytail rules) into a checkout — home repo or task
 * worktree. Non-fatal: a missing sandbox or script is a no-op.
 */
export async function linkStackSkillsForCheckout(
	checkoutRoot: string,
	options?: { quiet?: boolean },
): Promise<void> {
	const script = resolveLinkStackSkillsScript(checkoutRoot);
	const sandboxDir = findStackRoot();
	if (script === null || sandboxDir === null) {
		return;
	}

	let mod: LinkStackSkillsModule;
	try {
		mod = (await import(pathToFileURL(script).href)) as LinkStackSkillsModule;
	} catch (error) {
		if (!options?.quiet) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[kanban] Agent stack: could not load link-stack-skills.mjs — ${message}`);
		}
		return;
	}

	const summary = mod.linkStackSkills({
		sandboxDir,
		destDirs: skillDestDirs(checkoutRoot),
		repoRootPath: checkoutRoot,
	});
	if (!summary.present) {
		return;
	}
	if (!options?.quiet) {
		for (const warning of summary.warnings) {
			console.warn(`[kanban] Agent stack: ${warning}`);
		}
		for (const broken of summary.broken) {
			console.warn(`[kanban] Agent stack: could not link ${broken}`);
		}
	}
}

/** Links stack skills into the home repo at runtime boot. */
export async function linkStackSkillsAtStartup(options?: { quiet?: boolean }): Promise<void> {
	const repoRoot = resolveStackRepoRoot();
	if (repoRoot === null) {
		return;
	}
	await linkStackSkillsForCheckout(repoRoot, options);
}
