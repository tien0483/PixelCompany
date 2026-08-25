import { describe, expect, it } from "vitest";

import { buildClaudeArgv } from "../../../src/terminal/agent-oneshot";

/**
 * Separate from `agent-oneshot.test.ts` because this needs no spawn mocking at all —
 * the argv builder is a pure function, and the point of these assertions is that the
 * review chat's two new flags did not change the command every other caller runs.
 */
describe("buildClaudeArgv", () => {
	it("omits both review-chat flags when neither is asked for", () => {
		const argv = buildClaudeArgv("sonnet", ["Read"]);

		expect(argv).not.toContain("--append-system-prompt");
		expect(argv).not.toContain("--resume");
		// The HTML, audit and rules-extract routes all land here. A change to this shape
		// is a change to their behaviour, so it should have to be deliberate.
		expect(argv).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--include-partial-messages",
			"--permission-mode",
			"auto",
			"--allowedTools",
			"Read",
			"--model",
			"sonnet",
		]);
	});

	it("appends the persona when one is given", () => {
		const argv = buildClaudeArgv(undefined, undefined, { appendSystemPrompt: "be an assistant" });

		expect(argv.slice(-2)).toEqual(["--append-system-prompt", "be an assistant"]);
	});

	it("resumes a session when an id is given", () => {
		const argv = buildClaudeArgv(undefined, undefined, { resumeSessionId: "sess-1" });

		expect(argv.slice(-2)).toEqual(["--resume", "sess-1"]);
	});

	it("carries both together, since a resumed chat turn still needs its persona", () => {
		const argv = buildClaudeArgv("opus", ["Read", "Grep"], {
			appendSystemPrompt: "be an assistant",
			resumeSessionId: "sess-2",
		});

		expect(argv).toContain("--append-system-prompt");
		expect(argv).toContain("--resume");
		expect(argv).toContain("Read,Grep");
	});

	it("treats an empty string as absent rather than passing an empty flag value", () => {
		const argv = buildClaudeArgv(undefined, [], { appendSystemPrompt: "", resumeSessionId: "" });

		expect(argv).not.toContain("--append-system-prompt");
		expect(argv).not.toContain("--resume");
		expect(argv).not.toContain("--allowedTools");
	});
});
