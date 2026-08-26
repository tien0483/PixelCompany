/**
 * The slash commands a project ships for itself.
 *
 * The review chat runs `claude -p` with the reviewer's checkout as cwd, so Claude
 * Code already resolves `<checkout>/.claude/commands/*.md` on its own — what was
 * missing is any way to *see* them: the chip row above the composer was a hardcoded
 * list of stack-wide skills, so a project's own `/review` existed but looked like it
 * did not. This module is the discovery half, and it deliberately mirrors Claude
 * Code's own rules rather than inventing a format, so a command that appears as a
 * chip is one the CLI will actually expand.
 *
 * User-level commands (`~/.claude/commands`) are *not* listed. A review run is
 * pinned to a Manager seat, and a pinned seat launches with its own
 * `CLAUDE_CONFIG_DIR` — so the user-level directory the run would read is the
 * seat's, not the one this process can see, and listing ours would advertise
 * commands the run cannot resolve.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReviewProjectCommand {
	/** Includes the leading slash and any `dir:` namespace, e.g. `/frontend:audit`. */
	command: string;
	/** Frontmatter `description`, else the first prose line. Null when the file is bare. */
	description: string | null;
	/** Repo-relative path, so the reviewer can find the file the chip came from. */
	source: string;
}

/** Where Claude Code looks, relative to the checkout. */
const PROJECT_COMMANDS_DIR = join(".claude", "commands");

/**
 * The chip row is one line above a composer, not a command palette. A repo with
 * eighty commands should not push the diff off screen, so the list is capped and
 * the cap is reported rather than silently applied.
 */
export const REVIEW_PROJECT_COMMANDS_LIMIT = 24;

/** Namespacing nests, but not far — this is a guard against a symlink loop, not a feature. */
const MAX_DEPTH = 3;

/** A command file is a prompt. Anything this size is not one, and reading it would be waste. */
const MAX_COMMAND_FILE_BYTES = 64 * 1024;

interface DiscoveredFile {
	/** Path segments below the commands dir, last one still carrying `.md`. */
	segments: string[];
	absolutePath: string;
}

async function walkCommandFiles(root: string, segments: string[], depth: number): Promise<DiscoveredFile[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(join(root, ...segments), { withFileTypes: true });
	} catch {
		// An unreadable subdirectory drops its own subtree and nothing else: a
		// permissions problem three levels down must not empty the whole chip row.
		return [];
	}
	const found: DiscoveredFile[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		if (entry.isDirectory()) {
			if (depth < MAX_DEPTH) {
				found.push(...(await walkCommandFiles(root, [...segments, entry.name], depth + 1)));
			}
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".md")) {
			found.push({ segments: [...segments, entry.name], absolutePath: join(root, ...segments, entry.name) });
		}
	}
	return found;
}

/**
 * `frontend/component.md` is `/frontend:component` — the directory is a namespace,
 * not a path, which is why this joins with `:` and never with a separator.
 */
export function buildCommandName(segments: string[]): string {
	const parts = [...segments];
	const last = parts.pop();
	const name = (last ?? "").replace(/\.md$/, "");
	return `/${[...parts, name].join(":")}`;
}

/**
 * What the chip's tooltip says. Frontmatter wins because it was written to be read;
 * the first prose line is the fallback Claude Code itself falls back to, and a file
 * that opens with its own title gets that title rather than nothing.
 */
export function readCommandDescription(text: string): string | null {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (frontmatter?.[1]) {
		const described = /^description:\s*(.+)$/m.exec(frontmatter[1]);
		const value = described?.[1]?.trim().replace(/^["']|["']$/g, "");
		if (value) {
			return value;
		}
	}
	const body = frontmatter ? text.slice(frontmatter[0].length) : text;
	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		const candidate = (heading?.[1] ?? line).trim();
		if (candidate.length === 0) {
			continue;
		}
		return candidate.length > 140 ? `${candidate.slice(0, 139)}…` : candidate;
	}
	return null;
}

/**
 * Never throws and never rejects for a project that has no commands directory: an
 * absent `.claude/commands` is the normal case, and the panel treats "no commands"
 * and "lookup failed" differently only when there is a real error to show.
 */
export async function listProjectSlashCommands(input: {
	projectPath: string;
	limit?: number;
}): Promise<{ commands: ReviewProjectCommand[]; omitted: number }> {
	const root = join(input.projectPath, PROJECT_COMMANDS_DIR);
	const files = await walkCommandFiles(root, [], 0);
	files.sort((left, right) => left.segments.join("/").localeCompare(right.segments.join("/")));

	const limit = input.limit ?? REVIEW_PROJECT_COMMANDS_LIMIT;
	const kept = files.slice(0, limit);
	const commands: ReviewProjectCommand[] = [];
	for (const file of kept) {
		let description: string | null = null;
		try {
			const text = await readFile(file.absolutePath, "utf8");
			description = text.length > MAX_COMMAND_FILE_BYTES ? null : readCommandDescription(text);
		} catch {
			// The name is the useful half of a chip. A file we could not read still
			// exists, and Claude Code will still expand it.
		}
		commands.push({
			command: buildCommandName(file.segments),
			description,
			source: join(PROJECT_COMMANDS_DIR, ...file.segments),
		});
	}
	return { commands, omitted: files.length - kept.length };
}
