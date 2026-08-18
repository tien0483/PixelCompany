import { X } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * The inline composer that opens under a diff line. Rendered by the diff pane
 * rather than owning its own state: the cited rule ids arrive from the Rules panel
 * on the far side of the workspace, so the text and citations live in the parent.
 */
export function ReviewCommentComposer({
	lineLabel,
	text,
	citedRuleIds,
	onTextChange,
	onRemoveCitation,
	onCancel,
	onSave,
}: {
	lineLabel: string;
	text: string;
	citedRuleIds: string[];
	onTextChange: (text: string) => void;
	onRemoveCitation: (ruleId: string) => void;
	onCancel: () => void;
	onSave: () => void;
}): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	// Focus on open: the composer is opened by a deliberate click on a gutter, so
	// making the reviewer click again to type is pure friction.
	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const canSave = text.trim().length > 0 || citedRuleIds.length > 0;

	return (
		<div className="space-y-1.5 border-y-2 border-accent bg-surface-1 p-2.5">
			<div className="flex items-center justify-between text-[11px] font-medium text-accent">
				<span>Review note on {lineLabel}</span>
				<button
					type="button"
					aria-label="Close comment composer"
					className="cursor-pointer text-text-tertiary hover:text-text-primary"
					onClick={onCancel}
				>
					<X size={12} />
				</button>
			</div>

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
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSave) {
						event.preventDefault();
						onSave();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
			/>

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

			<div className="flex items-center justify-between">
				<span className="text-[10px] text-text-tertiary">
					Cite a rule from the Rules tab to attach it. ⌘/Ctrl+Enter saves.
				</span>
				<div className="flex gap-1">
					<Button variant="default" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="primary" size="sm" disabled={!canSave} onClick={onSave}>
						Save note
					</Button>
				</div>
			</div>
		</div>
	);
}
