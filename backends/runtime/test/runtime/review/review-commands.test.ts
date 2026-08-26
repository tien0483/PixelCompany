import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildCommandName,
	listProjectSlashCommands,
	readCommandDescription,
} from "../../../src/review/review-commands";

async function makeProject(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "review-commands-"));
	for (const [relativePath, contents] of Object.entries(files)) {
		const absolute = join(root, relativePath);
		await mkdir(join(absolute, ".."), { recursive: true });
		await writeFile(absolute, contents, "utf8");
	}
	return root;
}

describe("buildCommandName", () => {
	it("namespaces a subdirectory with a colon, the way Claude Code does", () => {
		// `.claude/commands/frontend/component.md` is `/frontend:component`, not a path.
		expect(buildCommandName(["frontend", "component.md"])).toBe("/frontend:component");
		expect(buildCommandName(["review.md"])).toBe("/review");
	});
});

describe("readCommandDescription", () => {
	it("prefers frontmatter, unquoted", () => {
		const text = [
			"---",
			'description: "Security pass over the diff"',
			"allowed-tools: Read",
			"---",
			"",
			"# Ignored",
		].join("\n");

		expect(readCommandDescription(text)).toBe("Security pass over the diff");
	});

	it("falls back to the first heading when there is no frontmatter", () => {
		expect(readCommandDescription("# Code Review\n\nAccept an optional branch name.")).toBe("Code Review");
	});

	it("returns null for a file with no prose at all", () => {
		expect(readCommandDescription("\n\n   \n")).toBeNull();
	});
});

describe("listProjectSlashCommands", () => {
	it("lists a project's commands with their descriptions and source paths", async () => {
		const root = await makeProject({
			".claude/commands/review.md": "# Code Review\n\nReview the branch.",
			".claude/commands/mr-summary.md": "---\ndescription: Write the MR description\n---\n\nSteps:",
		});

		const listed = await listProjectSlashCommands({ projectPath: root });

		expect(listed.commands).toEqual([
			{
				command: "/mr-summary",
				description: "Write the MR description",
				source: join(".claude", "commands", "mr-summary.md"),
			},
			{ command: "/review", description: "Code Review", source: join(".claude", "commands", "review.md") },
		]);
		expect(listed.omitted).toBe(0);
	});

	it("ignores non-markdown files and dotfiles", async () => {
		const root = await makeProject({
			".claude/commands/review.md": "# Review",
			".claude/commands/notes.txt": "not a command",
			".claude/commands/.hidden.md": "# Hidden",
		});

		const listed = await listProjectSlashCommands({ projectPath: root });

		expect(listed.commands.map((entry) => entry.command)).toEqual(["/review"]);
	});

	it("reports what the display cap dropped instead of silently truncating", async () => {
		const root = await makeProject({
			".claude/commands/a.md": "# A",
			".claude/commands/b.md": "# B",
			".claude/commands/c.md": "# C",
		});

		const listed = await listProjectSlashCommands({ projectPath: root, limit: 2 });

		expect(listed.commands).toHaveLength(2);
		expect(listed.omitted).toBe(1);
	});

	it("resolves to an empty list for a project with no commands directory", async () => {
		// The normal case, and not an error: every project without `.claude/commands`
		// must still open its review panel.
		const root = await makeProject({ "README.md": "# Nothing here" });

		await expect(listProjectSlashCommands({ projectPath: root })).resolves.toEqual({ commands: [], omitted: 0 });
	});
});
