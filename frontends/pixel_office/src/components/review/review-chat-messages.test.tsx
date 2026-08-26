import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReviewChatMessages } from "@/components/review/review-chat-messages";
import type { RuntimeReviewChatMessage, RuntimeReviewFinding } from "@/runtime/types";

function finding(id: string, message: string): RuntimeReviewFinding {
	return {
		id,
		newPath: "src/pay.ts",
		newLine: 42,
		severity: "HIGH",
		message,
		ruleId: null,
	};
}

function assistantTurn(suggestions: RuntimeReviewFinding[]): RuntimeReviewChatMessage {
	return {
		id: "assistant-1",
		role: "assistant",
		text: "Two things stood out.",
		contextLabel: null,
		suggestions,
		createdAt: "2026-08-26T00:00:00.000Z",
	};
}

describe("ReviewChatMessages", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	async function renderMessages(input: {
		messages: RuntimeReviewChatMessage[];
		triagedFindingIds: ReadonlySet<string>;
	}): Promise<void> {
		await act(async () => {
			root.render(
				<ReviewChatMessages
					messages={input.messages}
					streamingText=""
					status="done"
					error={null}
					log={[]}
					notices={[]}
					canRequestChange={true}
					triagedFindingIds={input.triagedFindingIds}
					onRequestChange={() => {}}
					onAcceptSuggestion={() => {}}
					onDismissSuggestion={() => {}}
				/>,
			);
		});
	}

	it("lists every suggestion while none has been triaged", async () => {
		await renderMessages({
			messages: [assistantTurn([finding("f1", "Unbounded retry loop."), finding("f2", "Missing null guard.")])],
			triagedFindingIds: new Set(),
		});

		expect(container.textContent).toContain("2 suggestions to triage");
		expect(container.textContent).toContain("Unbounded retry loop.");
		expect(container.textContent).toContain("Missing null guard.");
	});

	// The bug this covers: a transcript message is immutable, so accepting or dismissing
	// a suggestion cannot remove it from the message — the row stayed on screen with its
	// buttons live, and clicking Accept twice produced two identical drafts.
	it("drops a triaged suggestion and recounts the rest", async () => {
		await renderMessages({
			messages: [assistantTurn([finding("f1", "Unbounded retry loop."), finding("f2", "Missing null guard.")])],
			triagedFindingIds: new Set(["f1"]),
		});

		expect(container.textContent).not.toContain("Unbounded retry loop.");
		expect(container.textContent).toContain("Missing null guard.");
		expect(container.textContent).toContain("1 suggestion to triage");
	});

	it("hides the whole block once the last suggestion is triaged", async () => {
		await renderMessages({
			messages: [assistantTurn([finding("f1", "Unbounded retry loop.")])],
			triagedFindingIds: new Set(["f1"]),
		});

		expect(container.textContent).not.toContain("to triage");
		// The answer itself is not triage state and has to survive.
		expect(container.textContent).toContain("Two things stood out.");
	});
});
