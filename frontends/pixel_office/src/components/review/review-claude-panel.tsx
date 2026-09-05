import { Bot, Eraser, Trash2 } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactElement, useCallback } from "react";

import { ResizeHandle } from "@/resize/resize-handle";
import { clampBetween } from "@/resize/resize-persistence";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { MIN_REVIEW_DRAFTS_HEIGHT, MIN_REVIEW_FINDINGS_HEIGHT } from "@/resize/use-review-layout";
import { hasRunReviewCommand, ReviewChatComposer } from "@/components/review/review-chat-composer";
import { ReviewChatMessages } from "@/components/review/review-chat-messages";
import { ReviewFindingRow } from "@/components/review/review-finding-row";
import { ReviewRunDot } from "@/components/review/review-run-dot";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	REVIEW_AGENT_MODEL_OPTIONS,
	type ReviewAgentModelId,
	normalizeReviewAgentModel,
} from "@/review/review-agent-model";
import { REVIEW_INLINE_PROMPTS } from "@/review/review-inline-prompts";
import { formatDraftLineLabel } from "@/review/review-target";
import type { ReviewProjectCommand } from "@/review/use-review-project-commands";
import type { RuntimeReviewChatMessage, RuntimeReviewDraftComment, RuntimeReviewFinding } from "@/runtime/types";

export { REVIEW_QUICK_PROMPTS } from "@/components/review/review-chat-composer";

export function ReviewClaudePanel({
	messages,
	streamingText,
	chatStatus,
	chatError,
	chatLog,
	chatNotices,
	contextLabel,
	canRequestChange,
	projectCommands,
	polishComments,
	pendingFindings,
	triagedFindingIds,
	draftComments,
	isAuditing,
	model,
	terseAnswers,
	findingsHeight,
	draftsHeight,
	composerHeight,
	maxFindingsHeight,
	maxDraftsHeight,
	maxComposerHeight,
	onFindingsHeightChange,
	onDraftsHeightChange,
	onComposerHeightChange,
	onTerseAnswersChange,
	onModelChange,
	onSend,
	onCancel,
	onClearChat,
	onClearContext,
	onTogglePolish,
	onRequestChange,
	onAcceptFinding,
	onDismissFinding,
	onRemoveDraft,
	onJumpToDraft,
}: {
	messages: RuntimeReviewChatMessage[];
	/** The in-flight answer, rendered as the last bubble while it streams. */
	streamingText: string;
	chatStatus: "idle" | "running" | "done" | "error";
	chatError: string | null;
	/** The run's stderr. Only shown once a run has failed — it explains the failure. */
	chatLog: string[];
	/** Non-fatal things the run reported, e.g. which seat it was redirected onto. */
	chatNotices: string[];
	/** What the next turn will be able to see, e.g. `src/a.ts:40-60`. */
	contextLabel: string | null;
	/** False when no diff line is selected, so a comment could not be anchored. */
	canRequestChange: boolean;
	/** Slash commands the selected checkout ships in `.claude/commands`. */
	projectCommands: readonly ReviewProjectCommand[];
	polishComments: boolean;
	pendingFindings: RuntimeReviewFinding[];
	/** Accepted or dismissed ids, so a triaged suggestion leaves the transcript too. */
	triagedFindingIds: ReadonlySet<string>;
	draftComments: RuntimeReviewDraftComment[];
	isAuditing: boolean;
	/** Model every review pass runs on — chat, audit and rules extraction alike. */
	model: ReviewAgentModelId;
	/**
	 * Compressed answers: verdict first, no narration of the assistant revising itself.
	 * Chat only — published comment text is never compressed.
	 */
	terseAnswers: boolean;
	/**
	 * The three dragged rows of this column. The transcript between them is the elastic
	 * remainder, so it is the only one with no height of its own.
	 */
	findingsHeight: number;
	draftsHeight: number;
	composerHeight: number;
	/** What each row may grow to in the column as it stands, so a drag cannot overshoot. */
	maxFindingsHeight: number;
	maxDraftsHeight: number;
	maxComposerHeight: number;
	onFindingsHeightChange: (height: number) => void;
	onDraftsHeightChange: (height: number) => void;
	onComposerHeightChange: (height: number) => void;
	onTerseAnswersChange: (next: boolean) => void;
	onModelChange: (model: ReviewAgentModelId) => void;
	/**
	 * `expectSuggestions` is an override for the inline prompt buttons, whose text has
	 * no leading slash for the caller to recognise. Omitted, the caller decides.
	 */
	onSend: (prompt: string, options?: { expectSuggestions?: boolean }) => void;
	onCancel: () => void;
	onClearChat: () => void;
	onClearContext: () => void;
	onTogglePolish: (next: boolean) => void;
	onRequestChange: (text: string) => void;
	onAcceptFinding: (finding: RuntimeReviewFinding) => void;
	onDismissFinding: (id: string) => void;
	onRemoveDraft: (id: string) => void;
	onJumpToDraft: (draft: RuntimeReviewDraftComment) => void;
}): ReactElement {
	const { startDrag: startFindingsResize } = useResizeDrag();
	const { startDrag: startDraftsResize } = useResizeDrag();

	const handleFindingsSeparatorMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const startY = event.clientY;
			const startHeight = findingsHeight;
			// Handle on the bottom edge: dragging down grows the list.
			const nextHeight = (pointerY: number): number =>
				clampBetween(startHeight + (pointerY - startY), MIN_REVIEW_FINDINGS_HEIGHT, maxFindingsHeight, true);
			startFindingsResize(event, {
				axis: "y",
				cursor: "ns-resize",
				onMove: (pointerY) => onFindingsHeightChange(nextHeight(pointerY)),
				onEnd: (pointerY) => onFindingsHeightChange(nextHeight(pointerY)),
			});
		},
		[findingsHeight, maxFindingsHeight, onFindingsHeightChange, startFindingsResize],
	);

	const handleDraftsSeparatorMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const startY = event.clientY;
			const startHeight = draftsHeight;
			// Handle on the top edge: dragging up grows the list.
			const nextHeight = (pointerY: number): number =>
				clampBetween(startHeight - (pointerY - startY), MIN_REVIEW_DRAFTS_HEIGHT, maxDraftsHeight, true);
			startDraftsResize(event, {
				axis: "y",
				cursor: "ns-resize",
				onMove: (pointerY) => onDraftsHeightChange(nextHeight(pointerY)),
				onEnd: (pointerY) => onDraftsHeightChange(nextHeight(pointerY)),
			});
		},
		[draftsHeight, maxDraftsHeight, onDraftsHeightChange, startDraftsResize],
	);

	// `flex-1` like every sibling panel: without it the panel is content-height, so the
	// transcript's own `min-h-0 flex-1 overflow-y-auto` has nothing to resolve against and a
	// long chat is clipped by the column instead of scrolling.
	return (
		<div className="flex min-h-0 flex-1 flex-col bg-surface-1" data-testid="review-claude-panel">
			<div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
				<div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
					<Bot size={13} className="text-accent" />
					<span>Claude</span>
					{chatStatus === "running" || isAuditing ? <Spinner size={11} /> : null}
				</div>
				<div className="flex items-center gap-2">
					{/* Switching mid-run would not move the running process, so the control is
					    locked while one is in flight rather than silently lying about it. */}
					<select
						value={model}
						aria-label="Review model"
						title={REVIEW_AGENT_MODEL_OPTIONS.find((option) => option.id === model)?.hint}
						disabled={chatStatus === "running" || isAuditing}
						onChange={(event) => onModelChange(normalizeReviewAgentModel(event.target.value))}
						className="cursor-pointer rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary focus:border-border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
					>
						{REVIEW_AGENT_MODEL_OPTIONS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
					{/* Locked mid-run for the same reason the model picker is: the style is a
					    launch flag on the turn already in flight, so flipping it now would
					    claim a change it cannot make. */}
					<button
						type="button"
						aria-label="Terse answers"
						aria-pressed={terseAnswers}
						title={
							terseAnswers
								? "Terse answers: verdict first, no prose. Published comment text is unaffected."
								: "Full-prose answers"
						}
						disabled={chatStatus === "running" || isAuditing}
						onClick={() => onTerseAnswersChange(!terseAnswers)}
						className={`cursor-pointer rounded border px-1.5 py-0.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40 ${
							terseAnswers
								? "border-accent bg-surface-2 text-accent"
								: "border-border bg-surface-2 text-text-tertiary hover:text-text-primary"
						}`}
					>
						Terse
					</button>
					{messages.length > 0 && chatStatus !== "running" ? (
						<button
							type="button"
							aria-label="Clear the conversation"
							title="Clear the conversation and start a new session"
							onClick={onClearChat}
							className="cursor-pointer text-text-tertiary hover:text-text-primary"
						>
							<Eraser size={12} />
						</button>
					) : null}
					{chatStatus === "running" ? (
						<Button variant="default" size="sm" onClick={onCancel}>
							Stop
						</Button>
					) : null}
				</div>
			</div>

			{/* The whole-merge-request passes. Buttons rather than chips because they read
			    every patch and cost accordingly, and each carries a dot saying whether this
			    conversation has already paid for it. */}
			<div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2">
				{REVIEW_INLINE_PROMPTS.map((entry) => {
					const Icon = entry.icon;
					const hasRun = hasRunReviewCommand(messages, entry.prompt);
					return (
						<button
							key={entry.id}
							type="button"
							title={entry.hint}
							disabled={chatStatus === "running"}
							onClick={() => onSend(entry.prompt, { expectSuggestions: entry.expectSuggestions })}
							className="flex cursor-pointer items-center gap-1.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
						>
							<ReviewRunDot
								state={hasRun ? "done" : "unrun"}
								label={
									hasRun
										? `${entry.label} — already run in this conversation, clear the chat to reset`
										: `${entry.label} — not run yet`
								}
							/>
							<Icon size={10} />
							{entry.label}
						</button>
					);
				})}
			</div>

			{pendingFindings.length > 0 ? (
				<div className="flex shrink-0 flex-col border-b border-border bg-surface-2">
					<div className="flex shrink-0 items-center justify-between px-2 pt-2 pb-1.5 text-[11px]">
						<span className="font-semibold text-text-primary">Findings to triage</span>
						<span className="rounded bg-surface-4 px-1.5 text-[10px] text-text-secondary">
							{pendingFindings.length} pending
						</span>
					</div>
					<div className="space-y-1.5 overflow-y-auto px-2 pb-2" style={{ height: findingsHeight }}>
						{pendingFindings.map((finding) => (
							<ReviewFindingRow
								key={finding.id}
								finding={finding}
								onAccept={onAcceptFinding}
								onDismiss={onDismissFinding}
							/>
						))}
					</div>
					<ResizeHandle
						orientation="horizontal"
						ariaLabel="Resize the findings list"
						onMouseDown={handleFindingsSeparatorMouseDown}
						showBaseLine={false}
					/>
				</div>
			) : null}

			<ReviewChatMessages
				messages={messages}
				streamingText={streamingText}
				status={chatStatus}
				error={chatError}
				log={chatLog}
				notices={chatNotices}
				canRequestChange={canRequestChange}
				triagedFindingIds={triagedFindingIds}
				onRequestChange={onRequestChange}
				onAcceptSuggestion={onAcceptFinding}
				onDismissSuggestion={onDismissFinding}
			/>

			{draftComments.length > 0 ? (
				<div className="flex shrink-0 flex-col border-t border-border bg-surface-2">
					<ResizeHandle
						orientation="horizontal"
						ariaLabel="Resize the draft comments list"
						onMouseDown={handleDraftsSeparatorMouseDown}
						showBaseLine={false}
					/>
					<div className="shrink-0 px-2 pt-2 pb-1 text-[11px] font-semibold text-text-primary">
						Draft comments ({draftComments.length})
					</div>
					<div className="space-y-1 overflow-y-auto px-2 pb-2" style={{ height: draftsHeight }}>
						{draftComments.map((draft) => (
							<div
								key={draft.id}
								className="flex items-start justify-between gap-2 rounded border border-border bg-surface-1 p-1.5"
							>
								<button
									type="button"
									className="min-w-0 flex-1 cursor-pointer text-left"
									onClick={() => onJumpToDraft(draft)}
								>
									<div className="truncate font-mono text-[10px] text-accent">
										{draft.newPath}
										{formatDraftLineLabel(draft)}
									</div>
									<div className="truncate text-[11px] text-text-secondary">{draft.text}</div>
								</button>
								<button
									type="button"
									aria-label="Delete draft comment"
									className="shrink-0 cursor-pointer text-text-tertiary hover:text-status-red"
									onClick={() => onRemoveDraft(draft.id)}
								>
									<Trash2 size={11} />
								</button>
							</div>
						))}
					</div>
				</div>
			) : null}

			<ReviewChatComposer
				contextLabel={contextLabel}
				isRunning={chatStatus === "running"}
				projectCommands={projectCommands}
				polishComments={polishComments}
				textareaHeight={composerHeight}
				maxTextareaHeight={maxComposerHeight}
				onTogglePolish={onTogglePolish}
				onClearContext={onClearContext}
				onTextareaHeightChange={onComposerHeightChange}
				onSend={onSend}
			/>
		</div>
	);
}
