// Filesystem discovery for the in-tree agent stack (backends/agent_stack),
// shared by the switchboard supervisor and the terminal environment builder.
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locates the `backends/agent_stack` package next to the runtime.
 *
 * Mirrors `findManagerRoot()`'s candidate walk so the bundled `dist/cli.js`
 * layout and the monorepo source layout both resolve. `STACK_SANDBOX` overrides
 * it, matching `scripts/link-stack-skills.mjs` and `activate-stack.sh`, so a
 * stack kept outside the repo still works.
 */
export function findStackRoot(): string | null {
	const fromEnv = process.env.STACK_SANDBOX?.trim();
	if (fromEnv) {
		return existsSync(join(fromEnv, "server.py")) ? fromEnv : null;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// Dev / monorepo: backends/runtime/src/stack → backends/agent_stack
		resolve(here, "../../../agent_stack"),
		// tsc output: backends/runtime/dist/stack → backends/agent_stack
		resolve(here, "../../../../agent_stack"),
		// Bundled dist/cli.js sitting in backends/runtime/dist
		resolve(here, "../../agent_stack"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "server.py"))) {
			return candidate;
		}
	}
	return null;
}

/** Null when no stack is installed, or when it is installed without `bin/`. */
export function findStackBinDir(): string | null {
	const stackRoot = findStackRoot();
	if (stackRoot === null) {
		return null;
	}
	const binDir = join(stackRoot, "bin");
	return existsSync(binDir) ? binDir : null;
}

/**
 * Puts the stack's binaries (today: `rtk`) on PATH for a session the runtime is
 * about to spawn.
 *
 * `activate-stack.sh` does this for the shell it is sourced in, which covers a
 * developer's own terminal but not an agent the runtime starts — those inherit
 * the runtime's environment, so unless Kanban itself was launched from an
 * activated shell, a task agent could only reach `rtk` by relative path. Doing
 * it here makes a task's tooling independent of how Kanban was launched.
 *
 * Only PATH: the rest of what the activator exports (`ANTHROPIC_BASE_URL`, the
 * dummy API key) must never reach a spawned agent — see the header of
 * `stack-process.ts`.
 *
 * Prepended, matching the activator, and skipped when already present so
 * repeated calls cannot grow PATH without bound.
 */
export function withStackBinOnPath<T extends Record<string, string | undefined>>(env: T): T {
	const binDir = findStackBinDir();
	if (binDir === null) {
		return env;
	}
	const currentPath = env.PATH ?? "";
	if (currentPath.split(delimiter).includes(binDir)) {
		return env;
	}
	return {
		...env,
		PATH: currentPath ? `${binDir}${delimiter}${currentPath}` : binDir,
	};
}
