import { X } from "lucide-react";
import { type ReactElement, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { PlanEditorErrorBoundary } from "@/components/plan-editor/plan-editor-error-boundary";
import { Button } from "@/components/ui/button";
import {
	type ReviewCommentEditorMode,
	readStoredReviewCommentEditorMode,
	writeStoredReviewCommentEditorMode,
} from "@/review/review-comment-editor-mode";

const ReviewCommentEditor = lazy(() => import("@/components/review/review-comment-editor"));

/**
 * The inline composer that opens under a diff line — or under the last line of a
 * dragged run. Rendered by the diff pane rather than owning its own state: the cited
 * rule ids arrive from the Rules panel on the far side of the workspace, so the text
 * and citations live in the parent.
 */
export function ReviewCommentComposer({
	path,
	startLabel,
	endLabel,
	text,
	citedRuleIds,
	onTextChange,
	onRemoveCitation,
	onCancel,
	onSave,
}: {
	path: string;
	/** `+26` / `-12` — the first line of the run this note covers. */
	startLabel: string;
	/** The last line of the run. Equal to `startLabel` for a single-line note. */
	endLabel: string;
	text: string;
	citedRuleIds: string[];
	onTextChange: (text: string) => void;
	onRemoveCitation: (ruleId: string) => void;
	onCancel: () => void;
	onSave: () => void;
}): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [mode, setMode] = useState<ReviewCommentEditorMode>(() => readStoredReviewCommentEditorMode());
	/**
	 * Set when the rich editor's markdown bridge throws. Kept separate from `mode` so
	 * the failure does not overwrite the reviewer's stored preference — the next note
	 * still opens rich, and only this one falls back.
	 */
	const [richFailed, setRichFailed] = useState(false);
	const isRich = mode === "rich" && !richFailed;

	// Focus on open: the composer is opened by a deliberate gesture on the diff, so
	// making the reviewer click again to type is pure friction. The rich editor
	// autofocuses itself.
	useEffect(() => {
		if (!isRich) {
			textareaRef.current?.focus();
		}
	}, [isRich]);

	const canSave = text.trim().length > 0 || citedRuleIds.length > 0;
	const isRange = startLabel !== endLabel;

	const switchMode = useCallback((next: ReviewCommentEditorMode) => {
		setMode(next);
		writeStoredReviewCommentEditorMode(next);
		setRichFailed(false);
	}, []);

	const handleRichError = useCallback((error: Error) => {
		setRichFailed(true);
		showAppToast({
			intent: "danger",
			message: error.message || "Rich editing failed — switched this note to plain text.",
		});
	}, []);

	// `canSave` is read at call time rather than captured in the editor, which would
	// otherwise refuse the first save of a note whose only content is a citation.
	const handleSubmit = useCallback(() => {
		if (canSave) {
			onSave();
		}
	}, [canSave, onSave]);

	return (
		<div className="space-y-1.5 border-y-2 border-accent bg-surface-1 p-2.5">
			<div className="flex items-center justify-between gap-2 text-[11px] font-medium text-accent">
				<span className="min-w-0 truncate">
					{isRange ? (
						<>
							Commenting on lines <code className="font-mono">{startLabel}</code> to{" "}
							<code className="font-mono">{endLabel}</code>
						</>
					) : (
						<>
							Commenting on line <code className="font-mono">{endLabel}</code>
						</>
					)}
					<span className="ml-1 font-normal text-text-tertiary">{path}</span>
				</span>
				<button
					type="button"
					aria-label="Close comment composer"
					className="shrink-0 cursor-pointer text-text-tertiary hover:text-text-primary"
					onClick={onCancel}
				>
					<X size={12} />
				</button>
			</div>

			{isRich ? (
				<PlanEditorErrorBoundary onError={handleRichError}>
					<Suspense
						fallback={
							<div className="rounded border border-border bg-surface-0 px-2 py-3 text-[11px] text-text-tertiary">
								Loading editor…
							</div>
						}
					>
						<ReviewCommentEditor
							markdown={text}
							onChange={onTextChange}
							onSubmit={handleSubmit}
							onCancel={onCancel}
						/>
					</Suspense>
				</PlanEditorErrorBoundary>
			) : (
				<textarea
					ref={textareaRef}
					value={text}
					onChange={(event) => onTextChange(event.target.value)}
					rows={3}
					aria-label="Review note"
					placeholder="What is wrong here, and what should it be instead?"
					className="w-full rounded border border-border bg-surface-0 p-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					onKeyDown={(event) => {
						// Enter alone inserts a newline: review notes are routinely multi-line,
						// so submit is the modified chord, not the bare key.
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							handleSubmit();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							onCancel();
						}
					}}
				/>
			)}

			{citedRuleIds.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{citedRuleIds.map((ruleId) => (
						<span
							key={ruleId}
							className="inline-flex items-center gap-1 rounded border border-border-bright bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary"
						>
							{ruleId}
							<button
								type="button"
								aria-label={`Remove citation ${ruleId}`}
								className="cursor-pointer text-text-tertiary hover:text-status-red"
								onClick={() => onRemoveCitation(ruleId)}
							>
								<X size={9} />
							</button>
						</span>
					))}
				</div>
			) : null}

			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 flex-col text-[10px] text-text-tertiary">
					<button
						type="button"
						className="w-fit cursor-pointer text-accent hover:text-accent-hover"
						onClick={() => switchMode(isRich ? "plain" : "rich")}
					>
						{isRich ? "Switch to plain text editing" : "Switch to rich text editing"}
					</button>
					<span className="truncate">
						Markdown supported. Cite a rule from the Rules tab to attach it. ⌘/Ctrl+Enter saves.
					</span>
				</div>
				<div className="flex shrink-0 gap-1">
					<Button variant="default" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="primary" size="sm" disabled={!canSave} onClick={handleSubmit}>
						Add to review
					</Button>
				</div>
			</div>
		</div>
	);
}
