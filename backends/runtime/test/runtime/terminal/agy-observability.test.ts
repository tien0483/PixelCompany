import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import { buildAgyArgv } from "../../../src/terminal/agent-oneshot";
import {
	describeAgyTranscriptLine,
	resolveAgyBrainTranscriptPath,
} from "../../../src/terminal/agy-brain-transcript";
import { classifyAgyLogLine, readAgyAuthenticatedAccount } from "../../../src/terminal/agy-log-file";

/**
 * Fixtures are verbatim lines from a real rebuild: the run that analyzed 552
 * changed files and wrote a 25 MB graph. Nothing here is invented, because the
 * whole point of these modules is that agy's actual formats are not documented
 * anywhere.
 */
const TOOL_CALL_RECORD = JSON.stringify({
	step_index: 3,
	source: "MODEL",
	type: "PLANNER_RESPONSE",
	status: "DONE",
	thinking: "Deciding what to run next.\n\n",
	tool_calls: [
		{
			name: "run_command",
			args: {
				CommandLine:
					'"PROJECT_ROOT=\\"/home/ubuntu/work/akselos-master\\"\\nLAST_COMMIT=\\"650b4007\\"\\ngit -C \\"$PROJECT_ROOT\\" diff \\"$LAST_COMMIT..HEAD\\" --name-only"',
			},
		},
	],
});

const TOOL_RESULT_RECORD = JSON.stringify({
	step_index: 2,
	source: "MODEL",
	type: "GENERIC",
	status: "DONE",
	content:
		"Created At: 2026-09-04T09:21:26+07:00\nCompleted At: 2026-09-04T09:21:26+07:00\n\nThe command exited with code 0.\nOutput:\nPROJECT_ROOT=/home/ubuntu/work/akselos-master\r\nUA_DIR=/home/ubuntu/work/akselos-master/.ua\r\nEXISTS_GRAPH=true\r\nEXISTS_META=true\r\nCOMMIT_HASH=f5f838ae\r\n",
});

const PHASE_RECORD = JSON.stringify({
	step_index: 107,
	source: "MODEL",
	type: "PLANNER_RESPONSE",
	status: "DONE",
	content: "[Phase 0/7] Running pre-flight checks…\nPhase 0 complete. Detected incremental update.",
});

describe("resolveAgyBrainTranscriptPath", () => {
	it("points at the conversation's transcript under the CLI app data dir", () => {
		expect(resolveAgyBrainTranscriptPath("abc-123")).toBe(
			`${homedir()}/.gemini/antigravity-cli/brain/abc-123/.system_generated/logs/transcript.jsonl`,
		);
	});
});

describe("describeAgyTranscriptLine", () => {
	it("reports a tool call as the command a person would recognize", () => {
		const lines = describeAgyTranscriptLine(TOOL_CALL_RECORD);

		expect(lines).toHaveLength(1);
		expect(lines[0]?.kind).toBe("command");
		// One layer of JSON quoting is unwrapped, or the log shows the encoding
		// rather than the command.
		expect(lines[0]?.line).toContain('git -C "$PROJECT_ROOT" diff');
		expect(lines[0]?.line.startsWith("run_command: ")).toBe(true);
		expect(lines[0]?.line).not.toContain("\\\"");
	});

	it("drops the timing header from a tool result and keeps the exit line", () => {
		const lines = describeAgyTranscriptLine(TOOL_RESULT_RECORD);

		expect(lines.every((line) => line.kind === "output")).toBe(true);
		expect(lines.map((line) => line.line).join("\n")).not.toContain("Created At:");
		expect(lines[0]?.line).toBe("The command exited with code 0.");
		// Bounded, with the remainder counted rather than silently dropped.
		expect(lines.at(-1)?.line).toMatch(/more output line\(s\)$/);
	});

	it("keeps planner prose one line per phase", () => {
		const lines = describeAgyTranscriptLine(PHASE_RECORD);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toEqual({ kind: "phase", line: "[Phase 0/7] Running pre-flight checks…" });
	});

	it("ignores the run's own prompt, which is the whole inlined skill", () => {
		const record = JSON.stringify({
			step_index: 0,
			source: "USER_EXPLICIT",
			type: "USER_INPUT",
			content: "<USER_REQUEST>\nYou are running the Understand Anything /understand analysis…",
		});

		expect(describeAgyTranscriptLine(record)).toEqual([]);
	});

	it("survives the partial writes a tail can catch", () => {
		expect(describeAgyTranscriptLine('{"step_index":4,"type":"GENE')).toEqual([]);
		expect(describeAgyTranscriptLine("")).toEqual([]);
		expect(describeAgyTranscriptLine("not json at all")).toEqual([]);
	});
});

describe("readAgyAuthenticatedAccount", () => {
	it("reads the account a run is actually billed to", () => {
		const line =
			"ERROR: logging before google.Init: I0904 09:32:43.759538       1 server_oauth.go:197] OAuth: authenticated successfully as someone@example.com";

		expect(readAgyAuthenticatedAccount(line)).toBe("someone@example.com");
	});

	it("returns null for every other line", () => {
		expect(readAgyAuthenticatedAccount("I0904 09:32:43.423236 1 common.go:172] CLI app data directory: /x")).toBe(
			null,
		);
	});
});

describe("classifyAgyLogLine", () => {
	it("drops the pre-authentication churn that every successful run logs", () => {
		// This is `E` severity and reads like a fatal auth failure, but the same run
		// authenticates a few milliseconds later. Forwarding it would raise a false
		// alarm on every build.
		const line =
			"ERROR: logging before google.Init: E0904 09:32:43.409502      66 errorreport.go:224] error getting token source: You are not logged into Antigravity.";

		expect(classifyAgyLogLine(line)).toBe(null);
	});

	it("keeps a genuine error from a source that is not chatty", () => {
		const line =
			"ERROR: logging before google.Init: E0904 09:32:43.423221       1 launchsteps.go:84] Failed to resolve GeminiDir: path is not absolute";
		const classified = classifyAgyLogLine(line);

		expect(classified?.kind).toBe("error");
		// Prefix and goroutine id stripped: the message is what a reader needs.
		expect(classified?.line).toBe("Failed to resolve GeminiDir: path is not absolute");
	});

	it("treats print-mode milestones as progress, not failure", () => {
		const classified = classifyAgyLogLine(
			'ERROR: logging before google.Init: I0904 09:32:43.424478       1 printmode.go:173] Print mode: starting (promptLength=0, model="gemini-3.7-flash")',
		);

		expect(classified?.kind).toBe("notice");
		expect(classified?.line).toContain("Print mode: starting");
	});

	it("surfaces a quota refusal whatever severity glog gave it", () => {
		const classified = classifyAgyLogLine(
			"ERROR: logging before google.Init: I0904 09:32:43.000000       1 backend.go:12] RESOURCE_EXHAUSTED: quota exceeded for this account",
		);

		expect(classified?.kind).toBe("notice");
		expect(classified?.line).toContain("RESOURCE_EXHAUSTED");
	});

	it("drops the request-per-model-call spam", () => {
		expect(
			classifyAgyLogLine(
				"ERROR: logging before google.Init: I0904 09:23:13.136722     142 http_helpers.go:296] URL: https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent",
			),
		).toBe(null);
	});
});

describe("buildAgyArgv with a log file", () => {
	it("adds --log-file without disturbing the flags every other caller relies on", () => {
		const withLog = buildAgyArgv({ model: "gemini-3.7-flash", logFilePath: "/tmp/agy.log" });

		expect(withLog).toContain("--log-file=/tmp/agy.log");
		// Still last and still empty: a bare `-p` swallows the next flag.
		expect(withLog.at(-1)).toBe("-p=");
	});

	it("produces byte-identical argv for a caller that does not ask for one", () => {
		expect(buildAgyArgv({ model: "gemini-3.7-flash", effort: "medium", skipPermissions: true })).toEqual([
			"--input-format=stream-json",
			"--output-format=stream-json",
			"--model=gemini-3.7-flash",
			"--effort=medium",
			"--dangerously-skip-permissions",
			"-p=",
		]);
	});
});
