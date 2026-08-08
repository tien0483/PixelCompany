import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	BRIEF_HEADINGS,
	BRIEF_MAX_OPEN_QUESTIONS,
	buildBriefPrompt,
	loadPromptMasterBody,
	PROMPT_MASTER_SKILL_RELATIVE_PATH,
	stripFrontmatter,
} from "../../../src/html/html-brief";

const SKILL_BODY = "# Prompt Master\n\nExtract intent across 9 dimensions.";

async function repoRootWithSkill(body: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kanban-brief-"));
	const skillPath = join(root, PROMPT_MASTER_SKILL_RELATIVE_PATH);
	await mkdir(dirname(skillPath), { recursive: true });
	await writeFile(skillPath, `---\nname: prompt-master\ndescription: x\n---\n\n${body}\n`, "utf8");
	return root;
}

describe("loadPromptMasterBody", () => {
	it("reads the vendored skill and drops its frontmatter", async () => {
		const root = await repoRootWithSkill(SKILL_BODY);

		await expect(loadPromptMasterBody(root)).resolves.toBe(`${SKILL_BODY}\n`);
	});

	it("names the path it looked for when the skill is missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "kanban-brief-empty-"));

		await expect(loadPromptMasterBody(root)).rejects.toThrow(PROMPT_MASTER_SKILL_RELATIVE_PATH);
	});

	it("leaves a body without frontmatter untouched", () => {
		expect(stripFrontmatter("# Heading\n\nBody")).toBe("# Heading\n\nBody");
	});
});

describe("buildBriefPrompt", () => {
	const base = {
		promptMasterBody: SKILL_BODY,
		content: "Customer hates the dashboard. Wants KPI cards.",
		assetPaths: [] as string[],
		unresolvedLinks: [] as string[],
	};

	it("carries the skill body, the user's plan and every heading of the output contract", () => {
		const prompt = buildBriefPrompt(base);

		expect(prompt).toContain(SKILL_BODY);
		expect(prompt).toContain(base.content);
		for (const heading of BRIEF_HEADINGS) {
			expect(prompt).toContain(heading);
		}
	});

	it("restates prompt-master's clarifying-question cap", () => {
		expect(buildBriefPrompt(base)).toContain(String(BRIEF_MAX_OPEN_QUESTIONS));
	});

	it("orders the plan last so the skill body cannot be overridden by pasted text", () => {
		const prompt = buildBriefPrompt(base);

		expect(prompt.indexOf(SKILL_BODY)).toBeLessThan(prompt.indexOf(base.content));
	});

	it("bans the write tools the Read grant sits next to", () => {
		expect(buildBriefPrompt({ ...base, assetPaths: ["/plans/a.png"] })).toContain(
			"Write / Edit / MultiEdit / Bash",
		);
	});

	it("instructs the agent to read every image it was given", () => {
		const assetPaths = ["/plans/roadmap.assets/old-dashboard.png", "/plans/roadmap.assets/notes.png"];

		const prompt = buildBriefPrompt({ ...base, assetPaths });

		for (const path of assetPaths) {
			expect(prompt).toContain(path);
		}
		expect(prompt).toContain("Read tool");
	});

	it("tells the agent not to imagine a screenshot when the plan has none", () => {
		expect(buildBriefPrompt(base)).toContain("references no images");
	});

	it("names the selected template so the brief is shaped for it", () => {
		expect(buildBriefPrompt({ ...base, templateId: "live-dashboard" })).toContain("live-dashboard");
	});

	it("emits a could-not-be-opened block when unresolvedLinks is non-empty", () => {
		const prompt = buildBriefPrompt({
			...base,
			unresolvedLinks: ["roadmap.assets/missing.png", "roadmap.assets/escaped.png"],
		});

		expect(prompt).toContain("could not be opened");
		expect(prompt).toContain("roadmap.assets/missing.png");
		expect(prompt).toContain("roadmap.assets/escaped.png");
		expect(prompt).toContain("Do NOT attempt to read them");
		expect(prompt).toContain("referenced image not available");
	});

	it("says nothing about unresolved links when there are none", () => {
		expect(buildBriefPrompt(base)).not.toContain("could not be opened");
	});
});
