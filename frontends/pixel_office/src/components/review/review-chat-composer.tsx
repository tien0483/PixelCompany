import { ArrowUp, Crosshair, X } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactElement, useCallback, useState } from "react";

import { ResizeHandle } from "@/resize/resize-handle";
import { clampBetween } from "@/resize/resize-persistence";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { MIN_REVIEW_COMPOSER_HEIGHT } from "@/resize/use-review-layout";
import type { ReviewProjectCommand } from "@/review/use-review-project-commands";

/**
 * The chips: review commands scoped to what the reviewer has on screen. Prefilled
 * into the input rather than sent immediately, so a target can be added before a turn
 * is spent — a bare `/security-review` on a 40-file MR is rarely what they meant.
 *
 * All of these are expanded by the runtime into a scoped instruction and never reach
 * the CLI as slash commands (`review-command-expansion.ts` explains why each had to
 * be: one was not installed in the reviewed checkout, the others went to `git` for a
 * branch that is not checked out). `/simplify` is the exception in the other
 * direction — a real built-in skill, passed through, because it already scopes itself
 * to the code it is shown.
 *
 * `/understand-diff` is deliberately not a chip any more: it asked the same question
 * as the "Understand changes" button at a narrower scope, and two answers to one
 * question is worse than one. The runtime still accepts it as an alias of the button.
 *
 * Stack-wide only. A project's own commands are discovered from its checkout and
 * arrive as `projectCommands` — hardcoding those here is what made a repo's `/review`
 * look unavailable when the CLI could expand it all along.
 */
export const REVIEW_QUICK_PROMPTS = [
	{ command: "/security-review", hint: "Security pass over every patch in the MR — reads the whole change" },
	{ command: "/code-review", hint: "Correctness review of the selected lines or the file on screen only" },
	{ command: "/simplify", hint: "Simplification opportunities in what is on screen" },
] as const;

/**
 * The commands the panel's buttons send, and the one chip that shares their scope.
 *
 * This is the frontend's copy of the merge-request-scoped set, because the decision
 * it drives is made here: whether to put every patch in the merge request on the
 * request body. It must stay in step with `reviewCommandScope` in
 * `backends/runtime/src/review/review-command-expansion.ts`, which is where the
 * matching prompt scope lives. A name in one list and not the other means either a
 * pass reading "every patch below" was sent none, or a screen-scoped turn is paying
 * for the whole merge request.
 */
export const REVIEW_UNDERSTAND_CHANGES_COMMAND = "/understand-changes";
export const REVIEW_CODE_REVIEW_DIFF_COMMAND = "/code-review-diff";
const REVIEW_MERGE_REQUEST_SCOPED_COMMANDS = [
	REVIEW_UNDERSTAND_CHANGES_COMMAND,
	REVIEW_CODE_REVIEW_DIFF_COMMAND,
	"/understand-diff",
	"/security-review",
] as const;

function matchesCommand(prompt: string, name: string): boolean {
	const trimmed = prompt.trimStart();
	return trimmed === name || trimmed.startsWith(`${name} `);
}

/**
 * True when a prompt is a slash command, which is a request for findings rather than
 * a question. `projectCommands` is passed so a repo's own `/review` counts too —
 * without it the panel would ask the stack skills for a suggestions block and leave
 * the project's command answering in prose nobody can turn into a comment.
 */
export function isReviewCommandPrompt(prompt: string, projectCommands: readonly ReviewProjectCommand[] = []): boolean {
	const names = [
		...REVIEW_QUICK_PROMPTS.map((entry) => entry.command),
		...REVIEW_MERGE_REQUEST_SCOPED_COMMANDS,
		...projectCommands.map((entry) => entry.command),
	];
	return names.some((name) => matchesCommand(prompt, name));
}

/** Whether this turn needs every patch in the merge request attached to it. */
export function isMergeRequestScopedPrompt(prompt: string): boolean {
	return REVIEW_MERGE_REQUEST_SCOPED_COMMANDS.some((name) => matchesCommand(prompt, name));
}

/**
 * Whether one of the button commands has already been run in this conversation.
 *
 * Derived from the transcript rather than stored: it costs no schema, it survives a
 * reload for free, and "Clear conversation" resets it — which is exactly the scope
 * the indicator claims, since a cleared chat is a new CLI session that has never
 * seen the answer.
 */
export function hasRunReviewCommand(
	messages: readonly { role: "user" | "assistant"; text: string }[],
	command: string,
): boolean {
	return messages.some((message) => message.role === "user" && matchesCommand(message.text, command));
}

export function ReviewChatComposer({
	contextLabel,
	isRunning,
	projectCommands,
	polishComments,
	textareaHeight,
	maxTextareaHeight,
	onTogglePolish,
	onClearContext,
	onTextareaHeightChange,
	onSend,
}: {
	/** What the next turn will be able to see. Null when nothing is selected. */
	contextLabel: string | null;
	isRunning: boolean;
	/** `.claude/commands` of the selected checkout. Empty for a project that ships none. */
	projectCommands: readonly ReviewProjectCommand[];
	polishComments: boolean;
	/**
	 * Height of the prompt box alone — the chips, the context line and the footer stay
	 * intrinsic, so the persisted number means what its name says.
	 */
	textareaHeight: number;
	/** What the box may grow to in the column as it stands, so a drag cannot overshoot. */
	maxTextareaHeight: number;
	onTogglePolish: (next: boolean) => void;
	onClearContext: () => void;
	onTextareaHeightChange: (height: number) => void;
	onSend: (prompt: string) => void;
}): ReactElement {
	const [input, setInput] = useState("");
	const { startDrag: startComposerResize } = useResizeDrag();

	const submit = (): void => {
		const prompt = input.trim();
		if (prompt.length === 0 || isRunning) {
			return;
		}
		onSend(prompt);
		setInput("");
	};

	const handleComposerSeparatorMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const startY = event.clientY;
			const startHeight = textareaHeight;
			// The handle is on the composer's top edge, so dragging up grows the box.
			const nextHeight = (pointerY: number): number =>
				clampBetween(startHeight - (pointerY - startY), MIN_REVIEW_COMPOSER_HEIGHT, maxTextareaHeight, true);
			startComposerResize(event, {
				axis: "y",
				cursor: "ns-resize",
				onMove: (pointerY) => onTextareaHeightChange(nextHeight(pointerY)),
				onEnd: (pointerY) => onTextareaHeightChange(nextHeight(pointerY)),
			});
		},
		[maxTextareaHeight, onTextareaHeightChange, startComposerResize, textareaHeight],
	);

	return (
		<div className="shrink-0 border-t border-border p-2">
			<ResizeHandle
				orientation="horizontal"
				ariaLabel="Resize the prompt box"
				onMouseDown={handleComposerSeparatorMouseDown}
				showBaseLine={false}
				className="-mt-2 mb-1"
			/>
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
				{/* The project's own commands, tinted so it stays obvious which chips come
				    from this repository and would disappear if another project were selected. */}
				{projectCommands.map((prompt) => (
					<button
						key={prompt.command}
						type="button"
						title={`${prompt.source}${prompt.description ? ` — ${prompt.description}` : ""}`}
						onClick={() => setInput(`${prompt.command} `)}
						className="cursor-pointer rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:text-accent-hover"
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
					style={{ height: textareaHeight }}
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
