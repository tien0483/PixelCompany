import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentOneShotEvent, RunAgentOneShotInput } from "../../../src/terminal/agent-oneshot";

/** Events the fake agent emits for every run. Set per test. */
let scriptedEvents: AgentOneShotEvent[] = [];
/**
 * Per-attempt scripts, consumed in order and taking priority over
 * `scriptedEvents`. Needed because the resume path can spawn the agent twice for
 * one request, and the two attempts have to be able to behave differently.
 */
let scriptedRuns: AgentOneShotEvent[][] = [];
/** Every input the route handed the agent, so a test can assert on the argv it implies. */
let runInputs: RunAgentOneShotInput[] = [];

vi.mock("../../../src/terminal/agent-oneshot", () => ({
	runAgentOneShot: async (input: RunAgentOneShotInput) => {
		runInputs.push(input);
		for (const event of scriptedRuns.length > 0 ? (scriptedRuns.shift() ?? []) : scriptedEvents) {
			input.onEvent(event);
		}
		return { code: 0 };
	},
}));

const { handleAgentStreamRoute } = await import("../../../src/review/review-stream-route");

interface FakeResponse {
	res: ServerResponse;
	status: number | null;
	body: string;
}

function fakeRequest(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
	const stream = Readable.from([Buffer.from(JSON.stringify(body), "utf-8")]);
	// A real POST from the client carries this; the route refuses anything else,
	// because a CORS-simple content type makes the route reachable by a
	// preflight-free cross-site POST.
	Object.assign(stream, { headers: { "content-type": "application/json", ...headers } });
	return stream as unknown as IncomingMessage;
}

function fakeResponse(): FakeResponse {
	const state: FakeResponse = { res: null as unknown as ServerResponse, status: null, body: "" };
	state.res = {
		writableEnded: false,
		writeHead(status: number) {
			state.status = status;
			return this;
		},
		write(chunk: string) {
			state.body += chunk;
			return true;
		},
		end(chunk?: string) {
			if (typeof chunk === "string") {
				state.body += chunk;
			}
			(this as { writableEnded: boolean }).writableEnded = true;
		},
	} as unknown as ServerResponse;
	return state;
}

const PASSTHROUGH_SCHEMA = {
	safeParse: (value: unknown) => ({ success: true as const, data: value as { keep: boolean } }),
};

describe("handleAgentStreamRoute onComplete", () => {
	beforeEach(() => {
		scriptedEvents = [];
		scriptedRuns = [];
		runInputs = [];
	});

	it("hands the agent's full output to the route so it can persist the result", async () => {
		scriptedEvents = [
			{ type: "delta", text: "[{" },
			{ type: "delta", text: '"id":"R-1"}]' },
			{ type: "done", code: 0 },
		];
		const seen: string[] = [];
		const response = fakeResponse();

		await handleAgentStreamRoute(fakeRequest({ keep: true }), response.res, {
			schema: PASSTHROUGH_SCHEMA,
			buildRun: async () => ({
				ok: true,
				prompt: "extract",
				allowedTools: ["Read"],
				onComplete: async (text) => {
					seen.push(text);
				},
			}),
		});

		expect(seen).toEqual(['[{"id":"R-1"}]']);
		expect(response.status).toBe(200);
	});

	it("skips the persist when the run reported an error", async () => {
		scriptedEvents = [
			{ type: "delta", text: "partial" },
			{ type: "error", message: "Claude Code binary is not available on PATH." },
			{ type: "done", code: 1 },
		];
		const seen: string[] = [];
		const response = fakeResponse();

		await handleAgentStreamRoute(fakeRequest({ keep: true }), response.res, {
			schema: PASSTHROUGH_SCHEMA,
			buildRun: async () => ({
				ok: true,
				prompt: "extract",
				allowedTools: ["Read"],
				onComplete: async (text) => {
					seen.push(text);
				},
			}),
		});

		// Half a stream parses to a partial result; writing it would replace a good
		// bundle with the fragment of a run the reviewer already saw fail.
		expect(seen).toEqual([]);
	});

	it("reports a persist failure as a stream error rather than swallowing it", async () => {
		scriptedEvents = [
			{ type: "delta", text: "[]" },
			{ type: "done", code: 0 },
		];
		const response = fakeResponse();

		await handleAgentStreamRoute(fakeRequest({ keep: true }), response.res, {
			schema: PASSTHROUGH_SCHEMA,
			buildRun: async () => ({
				ok: true,
				prompt: "extract",
				allowedTools: ["Read"],
				onComplete: async () => {
					throw new Error("EACCES: rules directory is read-only");
				},
			}),
		});

		// The headers are long gone by then, so this cannot become a 500.
		expect(response.status).toBe(200);
		expect(response.body).toContain("EACCES: rules directory is read-only");
	});

	it("rejects before the stream opens when buildRun refuses", async () => {
		const response = fakeResponse();

		await handleAgentStreamRoute(fakeRequest({ keep: true }), response.res, {
			schema: PASSTHROUGH_SCHEMA,
			buildRun: async () => ({ ok: false, status: 409, error: "No rules have been extracted yet." }),
		});

		expect(response.status).toBe(409);
		expect(response.body).toContain("No rules have been extracted yet.");
	});
});

describe("handleAgentStreamRoute content type", () => {
	// Every caller of this helper spawns an agent turn on the user's seat. The
	// body was parsed as JSON whatever the content type claimed, which made the
	// route CORS-simple: reachable by a cross-site POST with no preflight.
	it("refuses the CORS-simple content types with 415 and spawns nothing", async () => {
		for (const contentType of [
			"text/plain",
			"application/x-www-form-urlencoded",
			"multipart/form-data; boundary=x",
		]) {
			runInputs = [];
			const response = fakeResponse();
			await handleAgentStreamRoute(fakeRequest({ keep: true }, { "content-type": contentType }), response.res, {
				schema: PASSTHROUGH_SCHEMA,
				buildRun: async () => ({ ok: true, prompt: "hello", allowedTools: ["Read"] }),
			});

			expect(response.status).toBe(415);
			expect(runInputs).toHaveLength(0);
		}
	});

	it("accepts application/json with parameters", async () => {
		scriptedEvents = [{ type: "done", code: 0 }];
		runInputs = [];
		const response = fakeResponse();
		await handleAgentStreamRoute(
			fakeRequest({ keep: true }, { "content-type": "application/json; charset=utf-8" }),
			response.res,
			{
				schema: PASSTHROUGH_SCHEMA,
				buildRun: async () => ({ ok: true, prompt: "hello", allowedTools: ["Read"] }),
			},
		);

		expect(response.status).not.toBe(415);
		expect(runInputs).toHaveLength(1);
	});
});

describe("handleAgentStreamRoute resume", () => {
	beforeEach(() => {
		scriptedEvents = [];
		scriptedRuns = [];
		runInputs = [];
	});

	const runChat = async (plan: { resumeSessionId?: string }): Promise<FakeResponse> => {
		const response = fakeResponse();
		await handleAgentStreamRoute(fakeRequest({ keep: true }), response.res, {
			schema: PASSTHROUGH_SCHEMA,
			buildRun: async () => ({
				ok: true,
				prompt: "hello",
				allowedTools: ["Read"],
				appendSystemPrompt: "be an assistant",
				...plan,
			}),
		});
		return response;
	};

	it("passes the persona and the session id through to the agent", async () => {
		scriptedEvents = [
			{ type: "delta", text: "hi" },
			{ type: "done", code: 0 },
		];

		await runChat({ resumeSessionId: "sess-1" });

		expect(runInputs).toHaveLength(1);
		expect(runInputs[0]?.appendSystemPrompt).toBe("be an assistant");
		expect(runInputs[0]?.resumeSessionId).toBe("sess-1");
	});

	it("retries without the session id when the session is gone", async () => {
		// A stale id fails instantly and produces nothing — routine after a runtime
		// restart. Without the retry the panel would be permanently broken by an id it
		// can never satisfy.
		scriptedRuns = [
			[
				{ type: "error", message: "No conversation found with session ID: sess-old" },
				{ type: "done", code: 1 },
			],
			[
				{ type: "delta", text: "hi again" },
				{ type: "done", code: 0 },
			],
		];

		const response = await runChat({ resumeSessionId: "sess-old" });

		expect(runInputs.map((input) => input.resumeSessionId)).toEqual(["sess-old", undefined]);
		expect(response.body).toContain("hi again");
		// The failed attempt's error must never reach the reviewer: the turn recovered,
		// and an error frame would leave the panel showing a failure that did not happen.
		expect(response.body).not.toContain("No conversation found");
		expect(response.body).toContain("could not be resumed");
	});

	it("keeps a real failure on a resumed turn instead of retrying it away", async () => {
		// Distinguished from a dead session by having produced output: the session was
		// fine, the run failed for its own reasons, and re-running would bill a second
		// turn to hide the first one's error.
		scriptedEvents = [
			{ type: "delta", text: "partial answer" },
			{ type: "error", message: "Rate limited upstream" },
			{ type: "done", code: 1 },
		];

		const response = await runChat({ resumeSessionId: "sess-live" });

		expect(runInputs).toHaveLength(1);
		expect(response.body).toContain("Rate limited upstream");
	});

	it("never spawns twice when no session was being resumed", async () => {
		scriptedEvents = [
			{ type: "error", message: "Claude Code binary is not available on PATH." },
			{ type: "done", code: 1 },
		];

		const response = await runChat({});

		expect(runInputs).toHaveLength(1);
		expect(response.body).toContain("Claude Code binary is not available on PATH.");
	});
});
