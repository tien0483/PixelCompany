import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewAnnotationVerdictResult } from "@/review/review-findings-parse";
import type { RuntimeReviewChatMessage } from "@/runtime/types";
import { type ReviewChatApi, useReviewChat } from "./use-review-chat";

/**
 * A stand-in for `useHtmlAgentStream` that lets a test drive the run by hand: emit a
 * meta frame, stream some text, finish. The chat hook's own behaviour — the
 * transcript, the captured session id, what the next turn resumes into — is what is
 * under test, not the SSE parser.
 */
const streamMocks = vi.hoisted(() => ({
	run: vi.fn<(request: Record<string, unknown>) => Promise<void>>(),
	cancel: vi.fn(),
	reset: vi.fn(),
	state: {
		status: "idle" as "idle" | "running" | "done" | "error",
		text: "",
		error: null as string | null,
		log: [] as string[],
		notices: [] as string[],
	},
	onMeta: null as ((key: string, value: unknown) => void) | null,
	rerender: null as (() => void) | null,
}));

vi.mock("@/html/use-html-agent-stream", () => ({
	useHtmlAgentStream: (_endpoint: string, onMeta?: (key: string, value: unknown) => void) => {
		streamMocks.onMeta = onMeta ?? null;
		return {
			...streamMocks.state,
			startedAt: null,
			firstByteAt: null,
			doneAt: null,
			run: streamMocks.run,
			cancel: streamMocks.cancel,
			reset: streamMocks.reset,
		};
	},
}));

const EMPTY_REQUEST = {
	host: "code.example.com",
	projectId: 1,
	iid: 2,
	changedPaths: ["a.py"],
	projectKey: "example/repo",
};

describe("useReviewChat", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let persisted: Array<{ messages: RuntimeReviewChatMessage[]; sessionId: string | null }>;
	let reportedVerdicts: ReviewAnnotationVerdictResult[][];

	beforeEach(() => {
		streamMocks.run.mockReset();
		streamMocks.run.mockResolvedValue(undefined);
		streamMocks.cancel.mockReset();
		streamMocks.reset.mockReset();
		streamMocks.state = { status: "idle", text: "", error: null, log: [], notices: [] };
		streamMocks.onMeta = null;
		persisted = [];
		reportedVerdicts = [];
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
			return;
		}
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	async function renderChat(
		initial: { messages?: RuntimeReviewChatMessage[]; sessionId?: string | null } = {},
	): Promise<{ getState: () => ReviewChatApi; rerender: () => Promise<void> }> {
		let hookResult: ReviewChatApi | null = null;
		const messages = initial.messages ?? [];
		const sessionId = initial.sessionId ?? null;

		function HookHarness(): null {
			hookResult = useReviewChat({
				initialMessages: messages,
				initialSessionId: sessionId,
				onPersist: (update) => {
					persisted.push(update);
				},
				onAnnotationVerdicts: (verdicts) => {
					reportedVerdicts.push(verdicts);
				},
			});
			return null;
		}

		const rerender = async (): Promise<void> => {
			await act(async () => {
				root.render(<HookHarness />);
				await Promise.resolve();
			});
		};

		await rerender();
		return {
			getState: () => {
				if (!hookResult) {
					throw new Error("Hook state not available");
				}
				return hookResult;
			},
			rerender,
		};
	}

	it("appends the reviewer's message immediately, before any answer", async () => {
		const { getState } = await renderChat();

		await act(async () => {
			getState().send({ prompt: "hello", contextLabel: null, request: EMPTY_REQUEST });
		});

		expect(getState().messages).toHaveLength(1);
		expect(getState().messages[0]?.role).toBe("user");
		expect(getState().messages[0]?.text).toBe("hello");
	});

	it("sends no session id on the first turn, which is what asks for the MR context", async () => {
		const { getState } = await renderChat();

		await act(async () => {
			getState().send({ prompt: "hello", contextLabel: null, request: EMPTY_REQUEST });
		});

		expect(streamMocks.run).toHaveBeenCalledTimes(1);
		expect(streamMocks.run.mock.calls[0]?.[0]).not.toHaveProperty("resumeSessionId");
	});

	it("resumes into the session the previous turn reported", async () => {
		const { getState, rerender } = await renderChat();

		await act(async () => {
			getState().send({ prompt: "hello", contextLabel: null, request: EMPTY_REQUEST });
		});
		// The CLI reports its session id as a meta frame; that is the only place it
		// appears, and the notice allowlist used to drop it.
		await act(async () => {
			streamMocks.onMeta?.("session", "sess-1");
		});
		await rerender();

		await act(async () => {
			getState().send({ prompt: "and now?", contextLabel: null, request: EMPTY_REQUEST });
		});

		expect(streamMocks.run.mock.calls[1]?.[0]).toMatchObject({ resumeSessionId: "sess-1" });
	});

	it("freezes a finished answer into the transcript and resets the stream", async () => {
		const { getState, rerender } = await renderChat();

		streamMocks.state = { ...streamMocks.state, status: "done", text: "  it clamps the offset  " };
		await rerender();

		expect(getState().messages).toHaveLength(1);
		expect(getState().messages[0]?.role).toBe("assistant");
		expect(getState().messages[0]?.text).toBe("it clamps the offset");
		// Safe only because the transcript holds the text now — that is the whole reason
		// this hook exists on top of the single-answer stream hook.
		expect(streamMocks.reset).toHaveBeenCalled();
	});

	it("splits a slash-command answer into prose and triage rows", async () => {
		const { getState, rerender } = await renderChat();

		streamMocks.state = {
			...streamMocks.state,
			status: "done",
			text: 'Looks wrong.\n\n```suggestions\n[{"newPath":"a.py","newLine":4,"message":"guard it"}]\n```',
		};
		await rerender();

		const assistant = getState().messages[0];
		expect(assistant?.text).toBe("Looks wrong.");
		expect(assistant?.suggestions).toHaveLength(1);
		expect(assistant?.suggestions[0]?.newLine).toBe(4);
	});

	it("reports annotation verdicts out of the same block, without leaking them into the transcript", async () => {
		const { getState, rerender } = await renderChat();

		streamMocks.state = {
			...streamMocks.state,
			status: "done",
			text: [
				"Your hunch holds.",
				"",
				"```suggestions",
				"[",
				'  {"newPath":"a.py","newLine":4,"message":"guard it"},',
				'  {"annotationId":"ann-1","verdict":"confirmed","reasoning":"the index can go negative"}',
				"]",
				"```",
			].join("\n"),
		};
		await rerender();

		// The verdicts belong to the annotations, not the message: the transcript keeps
		// the prose and the triage rows only.
		expect(reportedVerdicts).toEqual([
			[{ annotationId: "ann-1", verdict: "confirmed", reasoning: "the index can go negative" }],
		]);
		expect(getState().messages[0]?.text).toBe("Your hunch holds.");
		expect(getState().messages[0]?.suggestions).toHaveLength(1);
	});

	it("does not report verdicts for an answer that has none", async () => {
		const { rerender } = await renderChat();

		streamMocks.state = { ...streamMocks.state, status: "done", text: "Nothing wrong in these lines." };
		await rerender();

		expect(reportedVerdicts).toEqual([]);
	});

	it("does not record an empty answer as a turn", async () => {
		const { getState, rerender } = await renderChat();

		streamMocks.state = { ...streamMocks.state, status: "done", text: "   " };
		await rerender();

		expect(getState().messages).toEqual([]);
	});

	it("persists every append so a reload resumes the conversation", async () => {
		const { getState } = await renderChat();

		await act(async () => {
			getState().send({ prompt: "hello", contextLabel: "a.py:40-60", request: EMPTY_REQUEST });
		});

		expect(persisted).toHaveLength(1);
		expect(persisted[0]?.messages[0]?.contextLabel).toBe("a.py:40-60");
	});

	it("hydrates from the stored session", async () => {
		const stored: RuntimeReviewChatMessage[] = [
			{
				id: "m-1",
				role: "user",
				text: "earlier question",
				contextLabel: null,
				suggestions: [],
				createdAt: "2026-08-25T00:00:00.000Z",
			},
		];

		const { getState } = await renderChat({ messages: stored, sessionId: "sess-old" });

		expect(getState().messages).toHaveLength(1);
		expect(getState().sessionId).toBe("sess-old");
	});

	it("clearing drops the session id as well as the transcript", async () => {
		const { getState, rerender } = await renderChat({ sessionId: "sess-1" });

		await act(async () => {
			getState().clear();
		});
		await rerender();

		expect(getState().messages).toEqual([]);
		// A cleared transcript that still resumed the old CLI session would answer from
		// history the reviewer can no longer see.
		expect(getState().sessionId).toBeNull();
		expect(persisted.at(-1)).toEqual({ messages: [], sessionId: null });
	});

	it("only exposes streaming text while a run is in flight", async () => {
		const { getState, rerender } = await renderChat();

		streamMocks.state = { ...streamMocks.state, status: "running", text: "partial" };
		await rerender();
		expect(getState().streamingText).toBe("partial");

		streamMocks.state = { ...streamMocks.state, status: "done", text: "partial answer" };
		await rerender();
		// Otherwise the finished answer would render twice: once as the live bubble and
		// once as the transcript entry it just became.
		expect(getState().streamingText).toBe("");
	});
});
