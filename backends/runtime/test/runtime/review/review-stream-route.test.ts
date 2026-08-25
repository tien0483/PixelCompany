import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentOneShotEvent, RunAgentOneShotInput } from "../../../src/terminal/agent-oneshot";

/** Events the fake agent emits for the next run. Set per test. */
let scriptedEvents: AgentOneShotEvent[] = [];

vi.mock("../../../src/terminal/agent-oneshot", () => ({
	runAgentOneShot: async (input: RunAgentOneShotInput) => {
		for (const event of scriptedEvents) {
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

function fakeRequest(body: unknown): IncomingMessage {
	const stream = Readable.from([Buffer.from(JSON.stringify(body), "utf-8")]);
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
