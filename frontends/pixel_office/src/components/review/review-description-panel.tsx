import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import {
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactElement,
	useCallback,
	useState,
} from "react";

import { ClineMarkdownContent } from "@/components/detail-panels/cline-markdown-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { ResizeHandle } from "@/resize/resize-handle";
import { useResizeDrag } from "@/resize/use-resize-drag";

/** One line of the body, for the collapsed strip. */
function firstLine(description: string): string {
	const line = description
		.split("\n")
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.length > 0);
	return line ?? "";
}

/**
 * The merge request's own body, above the three-column review body.
 *
 * Full width rather than a fourth column: this is prose the author wrote for a
 * reader, and the two asides are resizable columns of their own. Editable because a
 * description is routinely wrong or empty by the time anyone reviews the branch,
 * and fixing it in GitLab means leaving the review.
 */
export function ReviewDescriptionPanel({
	description,
	isOpen,
	bodyHeight,
	onToggle,
	onBodyHeightChange,
	onSave,
}: {
	description: string;
	isOpen: boolean;
	/** Height of the rendered body, dragged from the handle on its bottom edge. */
	bodyHeight: number;
	onToggle: () => void;
	onBodyHeightChange: (height: number) => void;
	/** Resolves false when GitLab refused the write, which keeps the editor open. */
	onSave: (description: string) => Promise<boolean>;
}): ReactElement {
	const [draft, setDraft] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const isEditing = draft !== null;
	const { startDrag: startBodyResize } = useResizeDrag();

	const handleBodySeparatorMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const startY = event.clientY;
			const startHeight = bodyHeight;
			// The handle sits below the body, so dragging down grows it.
			const nextHeight = (pointerY: number): number => startHeight + (pointerY - startY);
			startBodyResize(event, {
				axis: "y",
				cursor: "ns-resize",
				onMove: (pointerY) => onBodyHeightChange(nextHeight(pointerY)),
				onEnd: (pointerY) => onBodyHeightChange(nextHeight(pointerY)),
			});
		},
		[bodyHeight, onBodyHeightChange, startBodyResize],
	);

	const startEditing = useCallback(() => {
		setDraft(description);
	}, [description]);

	const save = useCallback(async () => {
		if (draft === null || isSaving) {
			return;
		}
		setIsSaving(true);
		const saved = await onSave(draft);
		setIsSaving(false);
		if (saved) {
			// Only on success: a rejected write must not throw away what was typed.
			setDraft(null);
		}
	}, [draft, isSaving, onSave]);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void save();
			}
		},
		[save],
	);

	const preview = firstLine(description);

	return (
		<section className="shrink-0 border-b border-border bg-surface-1" data-testid="review-description-panel">
			<div className="flex h-8 items-center gap-2 px-3">
				<button
					type="button"
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-[11px] text-text-secondary hover:text-text-primary"
					onClick={onToggle}
					aria-expanded={isOpen}
				>
					{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
					<span className="shrink-0 font-medium">Description</span>
					{!isOpen ? (
						<span className={cn("truncate", preview ? "text-text-tertiary" : "text-text-tertiary italic")}>
							{preview || "No description"}
						</span>
					) : null}
				</button>
				{isOpen && !isEditing ? (
					<Button variant="ghost" size="sm" icon={<Pencil size={12} />} onClick={startEditing}>
						Edit
					</Button>
				) : null}
			</div>

			{isOpen ? (
				<div className="border-t border-border px-3 py-2">
					{isEditing ? (
						<div className="flex flex-col gap-2">
							<textarea
								// biome-ignore lint/a11y/noAutofocus: the editor is opened by an explicit click on Edit.
								autoFocus
								rows={12}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								onKeyDown={handleKeyDown}
								className="w-full resize-y rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-border-focus"
								placeholder="Describe this merge request. Markdown supported."
							/>
							<div className="flex items-center justify-between gap-2 text-[10px] text-text-tertiary">
								<span>Markdown supported. ⌘/Ctrl+Enter saves. Saving edits the merge request on GitLab.</span>
								<div className="flex shrink-0 gap-1">
									<Button variant="default" size="sm" disabled={isSaving} onClick={() => setDraft(null)}>
										Cancel
									</Button>
									<Button
										variant="primary"
										size="sm"
										disabled={isSaving}
										icon={isSaving ? <Spinner size={12} /> : undefined}
										onClick={() => void save()}
									>
										{isSaving ? "Saving…" : "Save"}
									</Button>
								</div>
							</div>
						</div>
					) : description.trim().length > 0 ? (
						<>
							<div className="overflow-auto text-xs text-text-primary" style={{ height: bodyHeight }}>
								<ClineMarkdownContent content={description} />
							</div>
							{/* Only the rendered body. The editor's textarea keeps its own native
							    `resize-y` grabber, and a second mechanism on the same box would
							    fight it. */}
							<ResizeHandle
								orientation="horizontal"
								ariaLabel="Resize the merge request description"
								onMouseDown={handleBodySeparatorMouseDown}
								showBaseLine={false}
								className="mt-1"
							/>
						</>
					) : (
						<p className="text-[11px] text-text-tertiary italic">
							This merge request has no description.
						</p>
					)}
				</div>
			) : null}
		</section>
	);
}
