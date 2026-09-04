import { useCallback, useEffect, useRef, useState } from "react";

import { useHtmlAgentStream } from "@/html/use-html-agent-stream";
import {
	parseSuggestionsFromChat,
	parseVerdictsFromChat,
	type ReviewAnnotationVerdictResult,
	stripSuggestionsBlock,
} from "@/review/review-findings-parse";
import type { RuntimeReviewChatMessage, RuntimeReviewChatRequest } from "@/runtime/types";

/**
 * Turns the review chat's one-shot SSE endpoint into a conversation.
 *
 * `useHtmlAgentStream` is a single answer box: `run()` clears `text`, so the previous
 * answer is gone the moment the next question is asked. That is right for the HTML
 * routes, which produce one document, and wrong for a chat. This hook adds the two
 * things a conversation needs and the stream hook has no business knowing about:
 *
 * - a transcript, so an answer survives the next question
 * - the CLI session id, captured from the `session` meta frame, so the next turn can
 *   `--resume` into the same conversation instead of starting over
 *
 * Both are persisted by the caller, which owns the review session document.
 */

export interface ReviewChatSendInput {
	prompt: string;
	/** What the assistant could see, for the transcript's context chip. */
	contextLabel: string | null;
	/** Everything the route needs except the fields this hook owns. */
	request: Omit<RuntimeReviewChatRequest, "prompt" | "resumeSessionId">;
}

export interface ReviewChatApi {
	messages: RuntimeReviewChatMessage[];
	sessionId: string | null;
	/** The in-flight answer, rendered as the last bubble while it streams. */
	streamingText: string;
	status: "idle" | "running" | "done" | "error";
	error: string | null;
	log: string[];
	notices: string[];
	send: (input: ReviewChatSendInput) => void;
	cancel: () => void;
	clear: () => void;
}

function nextMessageId(role: "user" | "assistant"): string {
	// Not cryptographic — this only has to be unique within one reviewer's transcript.
	return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useReviewChat(input: {
	/** Restored from the persisted session, once it loads. */
	initialMessages: RuntimeReviewChatMessage[];
	initialSessionId: string | null;
	/** Persists the transcript. Called on every append, not on a timer. */
	onPersist: (update: { messages: RuntimeReviewChatMessage[]; sessionId: string | null }) => void;
	/**
	 * Verdicts the turn returned on the spots the reviewer had flagged. They belong to
	 * the annotations, not the transcript, so they leave through here instead of being
	 * stored on the message — which is also why they are parsed at the same moment the
	 * suggestions are, once, rather than per render.
	 */
	onAnnotationVerdicts: (verdicts: ReviewAnnotationVerdictResult[]) => void;
}): ReviewChatApi {
	const [messages, setMessages] = useState<RuntimeReviewChatMessage[]>(input.initialMessages);
	const [sessionId, setSessionId] = useState<string | null>(input.initialSessionId);
	/** True once the reviewer has sent something, so a late hydrate cannot clobber it. */
	const hasLocalHistory = useRef(false);

	const sessionIdRef = useRef(sessionId);
	sessionIdRef.current = sessionId;
	const onPersistRef = useRef(input.onPersist);
	onPersistRef.current = input.onPersist;
	const onAnnotationVerdictsRef = useRef(input.onAnnotationVerdicts);
	onAnnotationVerdictsRef.current = input.onAnnotationVerdicts;

	const stream = useHtmlAgentStream<RuntimeReviewChatRequest>("/api/review/chat", (key, value) => {
		// The id of the session this turn ran in. On a resumed turn the CLI reports the
		// same id back, so storing it unconditionally is both correct and idempotent —
		// and after the stale-session retry it is a *new* id, which is exactly the one
		// the next turn has to use.
		if (key === "session" && typeof value === "string" && value.length > 0) {
			setSessionId(value);
		}
	});

	// Hydration: the session document arrives after the first render. Adopting it is
	// only safe while the reviewer has not typed anything — otherwise a slow load
	// would delete a conversation already in progress.
	const { initialMessages, initialSessionId } = input;
	useEffect(() => {
		if (hasLocalHistory.current) {
			return;
		}
		setMessages(initialMessages);
		setSessionId(initialSessionId);
	}, [initialMessages, initialSessionId]);

	const appendMessage = useCallback((message: RuntimeReviewChatMessage) => {
		setMessages((current) => {
			const next = [...current, message];
			onPersistRef.current({ messages: next, sessionId: sessionIdRef.current });
			return next;
		});
	}, []);

	// An answer is frozen into the transcript when the run finishes, then the stream is
	// reset — safe only because the transcript now holds the text, which is the whole
	// reason this hook exists. Keyed on the primitives, not the hook object: that gets
	// a fresh identity every render and would re-run this each time.
	const { status, text, reset } = stream;
	useEffect(() => {
		if (status !== "done") {
			return;
		}
		const answer = text.trim();
		if (answer.length > 0) {
			appendMessage({
				id: nextMessageId("assistant"),
				role: "assistant",
				text: stripSuggestionsBlock(answer),
				contextLabel: null,
				// Parsed once, here, rather than per render: the fence is gone from the
				// displayed text and the rows are what the reviewer triages.
				suggestions: parseSuggestionsFromChat(answer),
				createdAt: new Date().toISOString(),
			});
			const verdicts = parseVerdictsFromChat(answer);
			if (verdicts.length > 0) {
				onAnnotationVerdictsRef.current(verdicts);
			}
		}
		reset();
	}, [appendMessage, reset, status, text]);

	const streamRun = stream.run;
	const send = useCallback(
		(sendInput: ReviewChatSendInput) => {
			hasLocalHistory.current = true;
			appendMessage({
				id: nextMessageId("user"),
				role: "user",
				text: sendInput.prompt,
				contextLabel: sendInput.contextLabel,
				suggestions: [],
				createdAt: new Date().toISOString(),
			});
			void streamRun({
				...sendInput.request,
				prompt: sendInput.prompt,
				// Absent on the first turn, which is also what tells the runtime to send
				// the merge-request context.
				...(sessionIdRef.current ? { resumeSessionId: sessionIdRef.current } : {}),
			});
		},
		[appendMessage, streamRun],
	);

	const clear = useCallback(() => {
		hasLocalHistory.current = true;
		stream.reset();
		setMessages([]);
		// Dropping the id is the point: a cleared transcript that still resumed the old
		// CLI session would answer from history the reviewer can no longer see.
		setSessionId(null);
		onPersistRef.current({ messages: [], sessionId: null });
	}, [stream]);

	return {
		messages,
		sessionId,
		streamingText: stream.status === "running" ? stream.text : "",
		status: stream.status,
		error: stream.error,
		log: stream.log,
		notices: stream.notices,
		send,
		cancel: stream.cancel,
		clear,
	};
}
