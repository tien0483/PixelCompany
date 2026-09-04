import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactElement, useState } from "react";

import { cn } from "@/components/ui/cn";
import { loadBooleanResizePreference, persistBooleanResizePreference } from "@/resize/resize-preferences";
import { type ReviewTag, reviewTagColor } from "@/review/review-tags";
import { LocalStorageKey } from "@/storage/local-storage-store";

const TAG_STRIP_EXPANDED_PREFERENCE = {
	key: LocalStorageKey.ReviewTagStripExpanded,
	defaultValue: true,
} as const;

const DRAG_HINT = "Drag a tag onto a diff line to mark a suspect spot.";

export interface ReviewTagStripProps {
	tags: ReviewTag[];
	onTagDragStart: (tag: ReviewTag) => void;
	onTagDragEnd: () => void;
}

/**
 * The drag source for line tags, kept beside the rows it drops onto rather than
 * inside a sidebar tab — the sidebar shows one tab at a time, so a palette there
 * costs a switch away from the file list and back for every single tag.
 */
export function ReviewTagStrip({ tags, onTagDragStart, onTagDragEnd }: ReviewTagStripProps): ReactElement {
	const [isExpanded, setIsExpanded] = useState(() =>
		loadBooleanResizePreference(TAG_STRIP_EXPANDED_PREFERENCE),
	);

	return (
		<div className="flex shrink-0 items-start gap-2 border-b border-border bg-surface-1 px-3 py-1.5">
			<button
				type="button"
				aria-expanded={isExpanded}
				title={DRAG_HINT}
				className="flex shrink-0 cursor-pointer items-center gap-1 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
				onClick={() =>
					setIsExpanded((current) => persistBooleanResizePreference(TAG_STRIP_EXPANDED_PREFERENCE, !current))
				}
			>
				{isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
				Tags ({tags.length})
			</button>
			{isExpanded ? (
				<div className="flex flex-wrap gap-1">
					{tags.map((tag) => (
						<button
							key={`${tag.kind}-${tag.label}`}
							type="button"
							draggable
							// The browser builds the drag image out of this element, so the chip's
							// own color is what the reviewer sees following the cursor.
							className={cn(
								"cursor-grab rounded border px-2 py-0.5 text-[10px] hover:brightness-125",
								reviewTagColor(tag).chip,
							)}
							onDragStart={(event) => {
								event.dataTransfer.effectAllowed = "copy";
								event.dataTransfer.setData("text/plain", tag.label);
								onTagDragStart(tag);
							}}
							onDragEnd={onTagDragEnd}
						>
							{tag.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
