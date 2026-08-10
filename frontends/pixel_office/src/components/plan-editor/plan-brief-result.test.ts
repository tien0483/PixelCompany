import { describe, expect, it } from "vitest";

import { splitBriefResult } from "@/components/plan-editor/plan-brief-result";

describe("splitBriefResult", () => {
	it("splits a compliant answer into the reorganized plan and the brief", () => {
		const result = splitBriefResult(
			["# Plan", "", "## Context", "notes", "", "# Brief", "", "## Goal", "ship it"].join("\n"),
		);

		expect(result.plan).toBe("# Plan\n\n## Context\nnotes");
		expect(result.brief).toBe("# Brief\n\n## Goal\nship it");
	});

	it("keeps image links and their narratives inside the plan half", () => {
		const result = splitBriefResult(
			["# Plan", "", "![shot](p.assets/pasted-1.png)", "", "*Shows a pie chart.*", "", "# Brief", "", "## Goal", "x"].join(
				"\n",
			),
		);

		expect(result.plan).toContain("![shot](p.assets/pasted-1.png)");
		expect(result.plan).toContain("*Shows a pie chart.*");
		expect(result.brief).not.toContain("pasted-1.png");
	});

	it("reports no plan when the answer is a bare brief, so the caller appends instead of overwriting", () => {
		const text = "# Brief\n\n## Goal\nship it";

		expect(splitBriefResult(text)).toEqual({ plan: null, brief: text });
	});

	it("reports no plan when the answer has no Brief heading at all", () => {
		const text = "# Plan\n\n## Context\nnotes";

		expect(splitBriefResult(text)).toEqual({ plan: null, brief: text });
	});

	it("does not treat a mid-line '# Brief' as the section boundary", () => {
		const text = "# Plan\n\nsee the # Brief below\n\n# Brief\n\n## Goal\nx";

		expect(splitBriefResult(text).plan).toBe("# Plan\n\nsee the # Brief below");
	});

	it("ignores a deeper heading that merely ends in Brief", () => {
		const text = "# Plan\n\n## Brief history\n\nnotes";

		expect(splitBriefResult(text).plan).toBeNull();
	});
});
