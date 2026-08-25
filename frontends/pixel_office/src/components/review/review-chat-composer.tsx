import { ArrowUp, Crosshair, X } from "lucide-react";
import { type ReactElement, useState } from "react";

/**
 * Slash commands that exist as real skills in this stack. They are prefilled into
 * the input rather than sent immediately, so the reviewer can add a target before
 * spending a turn — a bare `/security-review` on a 40-file MR is rarely what they
 * meant.
 */
export const REVIEW_QUICK_PROMPTS = [
	{ command: "/understand-diff", hint: "What does this change touch?" },
	{ command: "/security-review", hint: "Security pass over the diff" },
	{ command: "/code-review", hint: "General correctness review" },
	{ command: "/simplify", hint: "Simplification opportunities" },
] as const;

/** True when a prompt is one of the review skills, which are a request for findings. */
export function isReviewCommandPrompt(prompt: string): boolean {
	const trimmed = prompt.trimStart();
	return REVIEW_QUICK_PROMPTS.some((entry) => trimmed === entry.command || trimmed.startsWith(`${entry.command} `));
}

export function ReviewChatComposer({
	contextLabel,
	isRunning,
	polishComments,
	onTogglePolish,
	onClearContext,
	onSend,
}: {
	/** What the next turn will be able to see. Null when nothing is selected. */
	contextLabel: string | null;
	isRunning: boolean;
	polishComments: boolean;
	onTogglePolish: (next: boolean) => void;
	onClearContext: () => void;
	onSend: (prompt: string) => void;
}): ReactElement {
	const [input, setInput] = useState("");

	const submit = (): void => {
		const prompt = input.trim();
		if (prompt.length === 0 || isRunning) {
			return;
		}
		onSend(prompt);
		setInput("");
	};

	return (
		<div className="shrink-0 border-t border-border p-2">
			<div className="mb-1.5 flex flex-wrap gap-1">
				{REVIEW_QUICK_PROMPTS.map((prompt) => (
					<button
						key={prompt.command}
						type="button"
						title={prompt.hint}
						onClick={() => setInput(`${prompt.command} `)}
						className="cursor-pointer rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary hover:text-text-primary"
					>
						{prompt.command}
					</button>
				))}
			</div>

			{/* Always rendered, including the empty case: "what can it see" must never be
			    something the reviewer has to infer from whether a chip appeared. */}
			<div className="mb-1.5 flex items-center gap-1 text-[10px]">
				{contextLabel ? (
					<span className="flex min-w-0 items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent">
						<Crosshair size={9} className="shrink-0" />
						<span className="truncate font-mono">{contextLabel}</span>
						<button
							type="button"
							aria-label="Clear the selected lines"
							onClick={onClearContext}
							className="shrink-0 cursor-pointer text-accent/70 hover:text-accent"
						>
							<X size={9} />
						</button>
					</span>
				) : (
					<span className="text-text-tertiary">Nothing selected — click a line number in the diff to focus it.</span>
				)}
			</div>

			<div className="relative">
				<textarea
					value={input}
					onChange={(event) => setInput(event.target.value)}
					rows={2}
					aria-label="Ask Claude about this merge request"
					placeholder="Ask about this diff, or type a slash command…"
					className="w-full resize-none rounded border border-border bg-surface-0 p-2 pr-9 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
				/>
				<button
					type="button"
					aria-label="Send"
					disabled={input.trim().length === 0 || isRunning}
					onClick={submit}
					className="absolute bottom-2 right-2 cursor-pointer rounded bg-accent p-1 text-accent-fg disabled:opacity-40"
				>
					<ArrowUp size={12} />
				</button>
			</div>

			<div className="mt-1 flex items-center justify-between px-1 text-[10px] text-text-tertiary">
				<span>Enter sends · Shift+Enter for a newline</span>
				<label className="flex cursor-pointer items-center gap-1" title="Rewrite a requested change into review-comment wording before it becomes a draft. Costs one extra turn.">
					<input
						type="checkbox"
						checked={polishComments}
						onChange={(event) => onTogglePolish(event.target.checked)}
						className="cursor-pointer accent-accent"
					/>
					Polish comments
				</label>
			</div>
		</div>
	);
}
