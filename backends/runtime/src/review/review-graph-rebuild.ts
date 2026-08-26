/**
 * Rebuilds a project's knowledge graph from the review tab, on the Antigravity
 * seat.
 *
 * The seat choice is the point. A rebuild analyzes the whole repository, and doing
 * it on the same Claude seat the reviewer is spending on the review itself is how
 * you lose a 5-hour window to housekeeping. Antigravity seats are a separate quota
 * pool (`api-contract.ts`: "a quota pool with no Kanban CLI"), so this runs `agy`.
 *
 * Note what pinning does and does not do here. `resolveManagerAccountPin` returns
 * no environment for `gemini` — Antigravity credentials are machine-wide in
 * `~/.gemini`, and Manager rotates which account is active. So the pin is honoured
 * for its *refusals* (a seat over its donate cap blocks the run) while the
 * credential comes from agy itself. That is the whole mechanism; there is no
 * per-process seat to hand over.
 *
 * The prompt is the `/understand` skill's own text, inlined.
 * `agy` expands slash commands in print mode, but it does not see the skill: its
 * skills live under `~/.gemini/antigravity-cli/{builtin,plugins}/*​/skills`, and the
 * Understand Anything plugin is not one of them — a live probe answered "the only
 * skills currently configured are agy-customizations and antigravity-guide", and
 * the repo's layout (`understand-anything-plugin/skills/`, no root `plugin.json`)
 * is not what `agy plugin install` accepts. Sending `/understand` would therefore
 * arrive as two literal words, which with `--dangerously-skip-permissions` is a
 * much worse failure than a long prompt.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { findUnderstandPluginRoot } from "./review-dashboard-process";

/**
 * A whole-repository analysis on a large project is not a chat turn.
 * `akselos-dev` is 6 952 files and produced a 24 MB graph, and `--print-timeout`
 * defaults to five minutes — which would kill every real rebuild mid-phase.
 */
export const GRAPH_REBUILD_TIMEOUT_MS = 3 * 60 * 60_000;
/**
 * Far longer than the review routes' 120 s. The skill's own phases shell out to
 * `scan-project.mjs` and `merge-batch-graphs.py`, and a quiet stretch while one of
 * those runs is normal progress, not the stalled permission prompt the idle
 * watchdog exists to catch.
 */
export const GRAPH_REBUILD_IDLE_TIMEOUT_MS = 15 * 60_000;

/** Where the skill text lives inside the plugin. */
const UNDERSTAND_SKILL_RELATIVE_PATH = join("skills", "understand", "SKILL.md");

export type ResolveGraphRebuildPromptResult =
	| { ok: true; prompt: string; skillDir: string }
	| { ok: false; error: string };

/**
 * Builds the rebuild prompt: a preamble that pins down what the skill would
 * otherwise infer from its harness, then the skill verbatim.
 *
 * The preamble carries the two things an inlined skill cannot know. The project
 * directory, because the skill reads it from `$ARGUMENTS` or the working
 * directory, and a rebuild started from the review tab must not depend on where
 * the runtime happens to be. And the skill's own directory, because its phases
 * invoke sibling scripts (`scan-project.mjs`, `compute-batches.mjs`,
 * `merge-batch-graphs.py`) by relative path — resolved against the wrong root they
 * simply do not exist, and the run degrades into the agent inventing its own
 * analysis.
 */
export function buildGraphRebuildPrompt(input: { projectPath: string; skillDir: string; skillText: string }): string {
	return `You are running the Understand Anything \`/understand\` analysis as a one-shot job. The full skill definition follows this preamble; treat it as your instructions.

Fixed parameters for this run — these override anything the skill says about inferring them:

- The project to analyze is \`${input.projectPath}\`. Treat it as \`$ARGUMENTS\` and as the project root for every phase. Do not analyze any other directory.
- \`$ARGUMENTS\` contains no other flags. This is an ordinary incremental run: reuse the existing graph and fingerprints if they are there, and do not force a full rebuild.
- The skill's own directory is \`${input.skillDir}\`. Its helper scripts are inside it, so invoke them by absolute path — for example \`node ${join(input.skillDir, "scan-project.mjs")}\` — never by a path relative to your working directory.
- Write the graph into the project's data directory exactly as the skill specifies: the legacy \`.understand-anything/\` when that directory already exists, otherwise \`.ua/\`.

How to run it:

- Follow the skill's phases in order. Report each phase transition as it starts, in one short line, so the person watching the stream can see progress.
- Nothing is going to answer a permission prompt for you, and nothing is going to answer a question. If a decision is genuinely ambiguous, take the conservative option, say which you took in one line, and keep going.
- Do not touch the repository's source files. This job reads the project and writes only inside the data directory.
- When you are done, print one final line: the data directory you wrote, the number of files analyzed, and the number of nodes in the graph.

---

${input.skillText}`;
}

/**
 * Reads the skill off disk and assembles the prompt. Fails loudly: the alternative
 * to a resolvable skill is an agent improvising a knowledge graph, and a wrong
 * graph is worse than none — every review prompt would then quote it as fact.
 */
export async function resolveGraphRebuildPrompt(input: {
	projectPath: string;
}): Promise<ResolveGraphRebuildPromptResult> {
	const pluginRoot = findUnderstandPluginRoot();
	if (pluginRoot === null) {
		return {
			ok: false,
			error:
				"The Understand Anything plugin was not found, so the /understand instructions cannot be read. Expected " +
				"~/.understand-anything-plugin or backends/agent_stack/src-understand-anything.",
		};
	}
	const skillPath = join(pluginRoot, UNDERSTAND_SKILL_RELATIVE_PATH);
	let skillText: string;
	try {
		skillText = await readFile(skillPath, "utf8");
	} catch (error) {
		return {
			ok: false,
			error: `Could not read the /understand skill at ${skillPath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
	if (skillText.trim().length === 0) {
		return { ok: false, error: `The /understand skill at ${skillPath} is empty.` };
	}
	const skillDir = join(pluginRoot, "skills", "understand");
	return {
		ok: true,
		prompt: buildGraphRebuildPrompt({ projectPath: input.projectPath, skillDir, skillText }),
		skillDir,
	};
}
