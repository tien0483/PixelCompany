import { describe, expect, it } from "vitest";

import { buildFreestyleHtmlPrompt } from "../../../src/html/html-freestyle";

const base = {
	content: "# Launch plan\n\n- Phase 1: beta\n- Phase 2: GA",
	assetPaths: [] as string[],
	unresolvedLinks: [] as string[],
};

describe("buildFreestyleHtmlPrompt — generate", () => {
	it("carries the user's markdown last, so pasted text cannot override the rules", () => {
		const prompt = buildFreestyleHtmlPrompt(base);

		expect(prompt).toContain(base.content);
		expect(prompt.indexOf("HARD TECHNICAL REQUIREMENTS")).toBeLessThan(prompt.indexOf(base.content));
	});

	it("states the stdout contract the stream parser depends on", () => {
		const prompt = buildFreestyleHtmlPrompt(base);

		expect(prompt).toContain("<!DOCTYPE html>");
		expect(prompt).toContain("no markdown code fence");
		expect(prompt).toContain("Write / Edit / MultiEdit / Bash");
	});

	it("makes the markdown itself the spec instead of a template", () => {
		const prompt = buildFreestyleHtmlPrompt(base);

		expect(prompt).toContain("No template is selected");
		expect(prompt).toContain("Never invent data");
		expect(prompt).toContain("same language the user wrote in");
	});

	it("asks for real design work rather than rendered markdown", () => {
		expect(buildFreestyleHtmlPrompt(base)).toContain("VISUAL ENHANCEMENT");
	});

	it("defaults the input format to markdown and echoes an explicit one", () => {
		expect(buildFreestyleHtmlPrompt(base)).toContain("[INPUT FORMAT]: markdown");
		expect(buildFreestyleHtmlPrompt({ ...base, format: "text" })).toContain("[INPUT FORMAT]: text");
	});

	it("tells the agent to open every image it was granted, before writing HTML", () => {
		const assetPaths = ["/plans/launch.assets/hero.png", "/plans/launch.assets/chart.png"];

		const prompt = buildFreestyleHtmlPrompt({ ...base, assetPaths });

		for (const path of assetPaths) {
			expect(prompt).toContain(path);
		}
		expect(prompt).toContain("Read tool");
	});

	it("requires the markdown's own relative link, not an absolute path or a data URI", () => {
		const prompt = buildFreestyleHtmlPrompt({ ...base, assetPaths: ["/plans/launch.assets/hero.png"] });

		expect(prompt).toContain("exact relative path written in the markdown link");
		expect(prompt).toContain("`data:` URI");
	});

	it("forbids inventing a screenshot when the plan has none", () => {
		const prompt = buildFreestyleHtmlPrompt(base);

		expect(prompt).toContain("references no images");
		expect(prompt).not.toContain("Read tool");
	});

	it("flags links it could not resolve as do-not-read", () => {
		const prompt = buildFreestyleHtmlPrompt({
			...base,
			unresolvedLinks: ["launch.assets/missing.png"],
		});

		expect(prompt).toContain("could not be opened");
		expect(prompt).toContain("launch.assets/missing.png");
		expect(prompt).toContain("Do NOT attempt to read them");
	});

	it("says nothing about unresolved links when there are none", () => {
		expect(buildFreestyleHtmlPrompt(base)).not.toContain("could not be opened");
	});
});

describe("buildFreestyleHtmlPrompt — refine", () => {
	const oldHtml = "<!DOCTYPE html><html><head></head><body>old</body></html>";

	it("switches to a diff-edit prompt carrying the diff and the existing HTML", () => {
		const prompt = buildFreestyleHtmlPrompt({
			...base,
			editFromHtml: oldHtml,
			editDiff: "@@ -1 +1 @@\n-Phase 2: GA\n+Phase 2: GA in March",
		});

		expect(prompt).toContain("minimal diff-edit");
		expect(prompt).toContain("REQUIREMENT DIFF");
		expect(prompt).toContain("Phase 2: GA in March");
		expect(prompt).toContain(oldHtml);
		expect(prompt).not.toContain("VISUAL ENHANCEMENT");
	});

	it("falls back to the old/new markdown pair when no diff is available", () => {
		const prompt = buildFreestyleHtmlPrompt({
			...base,
			editFromHtml: oldHtml,
			editFromContent: "# Launch plan\n\n- Phase 1: beta",
		});

		expect(prompt).toContain("[OLD MARKDOWN]");
		expect(prompt).toContain("[NEW MARKDOWN]");
		expect(prompt).toContain(base.content);
		expect(prompt).not.toContain("REQUIREMENT DIFF");
	});

	it("keeps existing image links byte for byte", () => {
		const prompt = buildFreestyleHtmlPrompt({ ...base, editFromHtml: oldHtml, editDiff: "@@" });

		expect(prompt).toContain("byte for byte");
	});

	it("generates from scratch when the prior HTML is blank", () => {
		expect(buildFreestyleHtmlPrompt({ ...base, editFromHtml: "   " })).toContain("VISUAL ENHANCEMENT");
	});
});
