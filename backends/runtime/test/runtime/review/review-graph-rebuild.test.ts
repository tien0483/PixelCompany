import { describe, expect, it } from "vitest";

import { parseAgyLine, makeParser, type ParseState } from "../../../src/html/html-stream-parser";
import {
	buildGraphRebuildPrompt,
	GRAPH_REBUILD_IDLE_TIMEOUT_MS,
	GRAPH_REBUILD_TIMEOUT_MS,
	resolveGraphRebuildPrompt,
} from "../../../src/review/review-graph-rebuild";
import { buildAgyArgv, buildAgyStdinPayload } from "../../../src/terminal/agent-oneshot";

describe("buildAgyArgv", () => {
	it("writes -p as a value flag, last", () => {
		const argv = buildAgyArgv({});

		// `-p` is a Go value flag: a bare `-p` would swallow whatever follows it as the
		// prompt, so it has to be `-p=` and nothing may come after it.
		expect(argv.at(-1)).toBe("-p=");
		expect(argv).not.toContain("-p");
	});

	it("requires both stream-json formats, because stdin only carries a prompt with them", () => {
		const argv = buildAgyArgv({});

		expect(argv).toContain("--input-format=stream-json");
		expect(argv).toContain("--output-format=stream-json");
	});

	it("converts the caller's hard timeout into agy's own print timeout", () => {
		// agy kills its own run at --print-timeout (default 5m), so a long job that
		// does not raise it gets cut off mid-phase no matter what the caller allows.
		expect(buildAgyArgv({ printTimeoutMs: 90_000 })).toContain("--print-timeout=90s");
		expect(buildAgyArgv({ printTimeoutMs: GRAPH_REBUILD_TIMEOUT_MS })).toContain("--print-timeout=10800s");
	});

	it("omits every optional flag when its input is absent", () => {
		expect(buildAgyArgv({})).toEqual(["--input-format=stream-json", "--output-format=stream-json", "-p="]);
	});

	it("passes model, effort and permission opt-in as agy-style value flags", () => {
		const argv = buildAgyArgv({
			model: "gemini-3.7-flash-medium",
			effort: "low",
			skipPermissions: true,
		});

		expect(argv).toContain("--model=gemini-3.7-flash-medium");
		expect(argv).toContain("--effort=low");
		expect(argv).toContain("--dangerously-skip-permissions");
	});
});

describe("buildAgyStdinPayload", () => {
	it("emits a single newline-terminated user event", () => {
		const payload = buildAgyStdinPayload("hello");

		expect(payload.endsWith("\n")).toBe(true);
		// Any other `event` value makes agy print "ignoring unsupported stream input
		// message event" and exit without running a turn.
		expect(JSON.parse(payload.trim())).toEqual({
			event: "user",
			message: { role: "user", content: "hello" },
		});
	});
});

describe("parseAgyLine", () => {
	const parse = (line: string, state: ParseState = {}): ReturnType<typeof parseAgyLine> => parseAgyLine(line, state);

	it("reports the conversation id under the same key as Claude's session id", () => {
		const out = parse('{"event":"init","conversation_id":"abc","init":{"cwd":"/repo"}}');

		expect(out).toEqual([
			{ kind: "meta", key: "session", value: "abc" },
			{ kind: "meta", key: "cwd", value: "/repo" },
		]);
	});

	it("turns an agent_response step's text_delta into a delta", () => {
		const out = parse(
			'{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"OK\\n"}}',
		);

		expect(out).toEqual([{ kind: "delta", text: "OK\n" }]);
	});

	it("reports a textless step as progress, which is the only signal a long run has", () => {
		const out = parse('{"event":"step_update","step_update":{"state":"RUNNING","step_type":"run_command"}}');

		expect(out).toEqual([{ kind: "meta", key: "step", value: { stepType: "run_command", state: "RUNNING" } }]);
	});

	it("rescues the whole answer from the result when nothing streamed", () => {
		const out = parse('{"event":"result","result":{"status":"SUCCESS","response":"done","duration_seconds":1.5}}');

		expect(out).toContainEqual({ kind: "delta", text: "done" });
		expect(out).toContainEqual({ kind: "meta", key: "duration_ms", value: 1500 });
		expect(out).toContainEqual({ kind: "meta", key: "result", value: "success" });
	});

	it("does not repeat the answer when it already streamed", () => {
		const state: ParseState = {};
		parse('{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"done"}}', state);
		const out = parse('{"event":"result","result":{"status":"SUCCESS","response":"done"}}', state);

		expect(out.filter((part) => part.kind === "delta")).toEqual([]);
	});

	it("treats a non-JSON line as noise rather than throwing", () => {
		expect(parse("not json at all")).toEqual([{ kind: "noise" }]);
	});
});

describe("makeParser", () => {
	it("dispatches on the agent, which it used to ignore", () => {
		const agy = makeParser("gemini");
		const claude = makeParser("claude");
		const agyLine = '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hi"}}';
		const claudeLine =
			'{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}';

		expect(agy(agyLine)).toEqual([{ kind: "delta", text: "hi" }]);
		expect(claude(claudeLine)).toEqual([{ kind: "delta", text: "hi" }]);
		// Each engine's frames are invisible to the other's parser.
		expect(claude(agyLine)).toEqual([]);
		expect(agy(claudeLine)).toEqual([]);
	});
});

describe("buildGraphRebuildPrompt", () => {
	it("pins the project and the skill's own directory, which an inlined skill cannot infer", () => {
		const prompt = buildGraphRebuildPrompt({
			projectPath: "/home/u/repo",
			skillDir: "/plugin/skills/understand",
			skillText: "# /understand\n\nPhase 1…",
		});

		expect(prompt).toContain("`/home/u/repo`");
		// The skill invokes sibling scripts by relative path; against the wrong root
		// they do not exist and the agent invents its own analysis instead.
		expect(prompt).toContain("/plugin/skills/understand/scan-project.mjs");
		expect(prompt).toContain("Phase 1…");
		// The skill text has to come last, so its own instructions are not truncated
		// by anything the preamble adds.
		expect(prompt.indexOf("Phase 1…")).toBeGreaterThan(prompt.indexOf("Fixed parameters"));
	});

	it("forbids widening the analysis or editing the repository", () => {
		const prompt = buildGraphRebuildPrompt({
			projectPath: "/home/u/repo",
			skillDir: "/plugin/skills/understand",
			skillText: "skill",
		});

		expect(prompt).toContain("Do not analyze any other directory.");
		expect(prompt).toContain("Do not touch the repository's source files.");
	});
});

describe("resolveGraphRebuildPrompt", () => {
	it("inlines the real skill from the installed plugin", async () => {
		const resolved = await resolveGraphRebuildPrompt({ projectPath: "/home/u/repo" });

		// Skipped rather than failed when the plugin is absent: this suite must pass on
		// a checkout that has never installed the agent stack.
		if (!resolved.ok) {
			expect(resolved.error).toMatch(/Understand Anything plugin|\/understand skill/);
			return;
		}
		expect(resolved.skillDir.endsWith("/skills/understand")).toBe(true);
		expect(resolved.prompt).toContain("`/home/u/repo`");
		// Proof the skill itself is in there, not just the preamble.
		expect(resolved.prompt).toContain("knowledge-graph.json");
		expect(resolved.prompt.length).toBeGreaterThan(10_000);
	});
});

describe("rebuild watchdog budgets", () => {
	it("allows far longer quiet stretches than a review turn", () => {
		// The skill shells out to scan-project.mjs and merge-batch-graphs.py; silence
		// while one of those runs is progress, not the stalled permission prompt the
		// review routes' 120s idle timeout exists to catch.
		expect(GRAPH_REBUILD_IDLE_TIMEOUT_MS).toBeGreaterThan(120_000);
		expect(GRAPH_REBUILD_TIMEOUT_MS).toBeGreaterThan(GRAPH_REBUILD_IDLE_TIMEOUT_MS);
	});
});
