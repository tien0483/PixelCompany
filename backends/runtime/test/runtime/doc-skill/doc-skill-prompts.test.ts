import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findDocSkillRoot } from "../../../src/doc-skill/doc-skill-process";
import {
	buildDocAuditPrompt,
	buildDocRoundPrompt,
	type DocSkillText,
	loadDocSkillText,
} from "../../../src/doc-skill/doc-skill-prompts";

describe("loadDocSkillText", () => {
	it("reads the real vendored SKILL.md and workflow.md", () => {
		const root = findDocSkillRoot();
		expect(root).not.toBeNull();
		const text = loadDocSkillText(root as string);
		expect(text).not.toBeNull();
		expect(text?.skillMd.length).toBeGreaterThan(0);
		expect(text?.workflowMd.length).toBeGreaterThan(0);
		expect(text?.skillMd).toContain("harness_doc_site");
	});

	it("returns null when the skill files are missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "doc-skill-prompts-empty-"));
		expect(loadDocSkillText(root)).toBeNull();
	});

	it("returns null when only one of the two files is present", async () => {
		const root = await mkdtemp(join(tmpdir(), "doc-skill-prompts-partial-"));
		await mkdir(join(root, "skills", "harness_doc_site"), { recursive: true });
		await writeFile(join(root, "skills", "harness_doc_site", "SKILL.md"), "# Skill\n", "utf8");
		// references/workflow.md intentionally absent
		expect(loadDocSkillText(root)).toBeNull();
	});
});

const SKILL_TEXT: DocSkillText = {
	skillMd: "# Doc Site Skill\n\nEvery status claim must carry a file:line citation.",
	workflowMd: "# Workflow\n\nRounds are append-only.",
};

describe("buildDocAuditPrompt", () => {
	const base = {
		skillText: SKILL_TEXT,
		targetRepo: "/repo/target",
		workspaceDir: "/repo/.doc-workspace",
	};

	it("embeds the skill text verbatim", () => {
		const prompt = buildDocAuditPrompt(base);
		expect(prompt).toContain(SKILL_TEXT.skillMd);
		expect(prompt).toContain(SKILL_TEXT.workflowMd);
	});

	it("names the target repo and workspace dir", () => {
		const prompt = buildDocAuditPrompt(base);
		expect(prompt).toContain(base.targetRepo);
		expect(prompt).toContain(base.workspaceDir);
	});

	it("includes the focus line only when focus is provided", () => {
		expect(buildDocAuditPrompt(base)).not.toContain("Focus your investigation on");
		expect(buildDocAuditPrompt({ ...base, focus: "the auth module" })).toContain(
			"Focus your investigation on: the auth module",
		);
	});

	it("restates the file:line citation invariant", () => {
		expect(buildDocAuditPrompt(base)).toContain("file:line");
	});

	it("shows the docs array's 3-element shape", () => {
		const prompt = buildDocAuditPrompt(base);
		expect(prompt).toContain("site.json");
		expect(prompt).toContain('["doc_01_audit_topic.html", "Audit: Topic", "01_audit_topic.md"]');
	});

	it("tells the agent not to build the site itself or touch files outside the workspace", () => {
		const prompt = buildDocAuditPrompt(base);
		expect(prompt).toContain("build_site.py");
		expect(prompt).toContain("Do not modify any file outside");
		expect(prompt).toContain("skills/");
	});
});

describe("buildDocRoundPrompt", () => {
	const base = {
		skillText: SKILL_TEXT,
		targetRepo: "/repo/target",
		workspaceDir: "/repo/.doc-workspace",
	};

	it("embeds the skill text verbatim", () => {
		const prompt = buildDocRoundPrompt(base);
		expect(prompt).toContain(SKILL_TEXT.skillMd);
		expect(prompt).toContain(SKILL_TEXT.workflowMd);
	});

	it("names the target repo and workspace dir", () => {
		const prompt = buildDocRoundPrompt(base);
		expect(prompt).toContain(base.targetRepo);
		expect(prompt).toContain(base.workspaceDir);
	});

	it("gives the round_tool.py open and check invocations", () => {
		const prompt = buildDocRoundPrompt(base);
		expect(prompt).toContain("round_tool.py open --at");
		expect(prompt).toContain("round_tool.py check --doc");
		expect(prompt).toContain("CONFIRMED|STALE|WRONG|ADDED|SCOPE");
	});

	it("states the never-edit-markdown-directly invariant", () => {
		const prompt = buildDocRoundPrompt(base);
		expect(prompt).toContain("Never edit the markdown docs directly");
		expect(prompt).toContain("append-only");
	});
});
