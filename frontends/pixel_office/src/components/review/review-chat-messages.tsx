import { MessageSquarePlus } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { ReviewFindingRow } from "@/components/review/review-finding-row";
import { cn } from "@/components/ui/cn";
import type { RuntimeReviewChatMessage, RuntimeReviewFinding } from "@/runtime/types";

/**
 * The transcript. Each assistant turn is a source the reviewer can lift a comment
 * out of — either the whole answer, or whatever they highlight inside it — which is
 * why the "Request change" affordance lives per message here rather than once at the
 * bottom of the panel.
 */
export function ReviewChatMessages({
	messages,
	streamingText,
	status,
	error,
	log,
	notices,
	canRequestChange,
	onRequestChange,
	onAcceptSuggestion,
	onDismissSuggestion,
}: {
	messages: RuntimeReviewChatMessage[];
	streamingText: string;
	status: "idle" | "running" | "done" | "error";
	error: string | null;
	/** The run's stderr. Only shown once a run has failed — it explains the failure. */
	log: string[];
	/** Non-fatal things the run reported, e.g. which seat it was redirected onto. */
	notices: string[];
	/** False when nothing in the diff is selected, so a comment could not be anchored. */
	canRequestChange: boolean;
	onRequestChange: (text: string) => void;
	onAcceptSuggestion: (finding: RuntimeReviewFinding) => void;
	onDismissSuggestion: (id: string) => void;
}): ReactElement {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	/** The message whose text is currently highlighted, and what of it. */
	const [highlight, setHighlight] = useState<{ messageId: string; text: string } | null>(null);

	// Follow the stream as it grows; a review answer is long and the interesting part
	// is at the bottom.
	useEffect(() => {
		const node = scrollRef.current;
		if (node) {
			node.scrollTop = node.scrollHeight;
		}
	}, [messages.length, streamingText]);

	const captureHighlight = useCallback((messageId: string) => {
		const selected = window.getSelection()?.toString().trim() ?? "";
		setHighlight(selected.length > 0 ? { messageId, text: selected } : null);
	}, []);

	const requestChangeLabel = canRequestChange
		? "Turn this into a draft comment on the selected line"
		: "Select a line in the diff first — a comment needs a line to attach to";

	return (
		<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 text-xs" data-testid="review-chat-messages">
			{messages.length === 0 && status !== "running" ? (
				<p className="text-text-tertiary">
					Ask anything about this merge request. Claude sees the lines you select in the diff — it will not
					review unless you ask it to.
				</p>
			) : null}

			<div className="space-y-2">
				{messages.map((message) => {
					const isUser = message.role === "user";
					const highlighted = highlight?.messageId === message.id ? highlight.text : null;
					return (
						<div key={message.id} className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
							{message.contextLabel ? (
								<span className="max-w-full truncate rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-tertiary">
									{message.contextLabel}
								</span>
							) : null}
							<div
								onMouseUp={isUser ? undefined : () => captureHighlight(message.id)}
								className={cn(
									"max-w-[92%] rounded px-2 py-1.5 leading-snug",
									isUser
										? "bg-accent/15 text-text-primary"
										: "bg-surface-2 text-text-primary selection:bg-accent/40",
								)}
							>
								<pre className="whitespace-pre-wrap break-words font-sans">{message.text}</pre>
							</div>

							{!isUser ? (
								<button
									type="button"
									title={requestChangeLabel}
									disabled={!canRequestChange}
									onClick={() => onRequestChange(highlighted ?? message.text)}
									className="flex cursor-pointer items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
								>
									<MessageSquarePlus size={10} />
									{highlighted ? "Request change on highlighted text" : "Request change"}
								</button>
							) : null}

							{message.suggestions.length > 0 ? (
								<div className="w-full space-y-1.5 pt-1">
									<div className="text-[10px] font-semibold text-text-secondary">
										{message.suggestions.length} suggestion
										{message.suggestions.length === 1 ? "" : "s"} to triage
									</div>
									{message.suggestions.map((suggestion) => (
										<ReviewFindingRow
											key={suggestion.id}
											finding={suggestion}
											onAccept={onAcceptSuggestion}
											onDismiss={onDismissSuggestion}
										/>
									))}
								</div>
							) : null}
						</div>
					);
				})}

				{streamingText.length > 0 ? (
					<div className="flex flex-col items-start gap-1">
						<div className="max-w-[92%] rounded bg-surface-2 px-2 py-1.5 leading-snug text-text-primary">
							<pre className="whitespace-pre-wrap break-words font-sans">{streamingText}</pre>
						</div>
					</div>
				) : null}
			</div>

			{error ? <p className="mt-2 text-status-red">{error}</p> : null}
			{/* Shown on healthy runs too: "launched on account N instead" is exactly the
			    kind of thing that has to be visible while the answer still looks fine. */}
			{notices.map((notice) => (
				<p key={notice} className="mt-2 text-status-orange">
					{notice}
				</p>
			))}
			{/* Stderr is only an explanation once something failed; on a good run it is
			    startup chatter nobody asked for. */}
			{status === "error" && log.length > 0 ? (
				<pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-0 p-1.5 text-[10px] text-text-tertiary">
					{log.join("\n")}
				</pre>
			) : null}
		</div>
	);
}
