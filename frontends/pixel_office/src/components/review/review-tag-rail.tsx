import { AlertTriangle, Pin, PinOff, Recycle, Tag, X } from "lucide-react";
import { type ReactElement, useState } from "react";

import { ReviewTagPalette, TAG_DRAG_HINT } from "@/components/review/review-tag-palette";
import { cn } from "@/components/ui/cn";
import {
	loadBooleanResizePreference,
	persistBooleanResizePreference,
	type ResizeBooleanPreference,
} from "@/resize/resize-preferences";
import { countTags, type ReviewTag, type ReviewTagSection, type ReviewTagSectionId } from "@/review/review-tags";
import { LocalStorageKey } from "@/storage/local-storage-store";

const SECTION_ICONS: Record<ReviewTagSectionId, typeof Tag> = {
	tags: Tag,
	smells: AlertTriangle,
	refactorings: Recycle,
};

const PIN_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.ReviewTagFlyoutPinned,
	defaultValue: false,
};

export interface ReviewTagRailProps {
	sections: ReviewTagSection[];
	/** True while a chip is being dragged, which is when an unpinned flyout gets out of the way. */
	isDraggingTag: boolean;
	onTagDragStart: (tag: ReviewTag) => void;
	onTagDragEnd: () => void;
}

/**
 * The tag palette as a rail down the diff's left edge, opening a flyout over the rows.
 *
 * It used to be a horizontal strip between the file toolbar and the first line of the
 * diff, which cost three rows of height even fully collapsed and far more open. A rail
 * costs 32px of width, which the diff has to spare and its line lengths do not miss.
 */
export function ReviewTagRail({
	sections,
	isDraggingTag,
	onTagDragStart,
	onTagDragEnd,
}: ReviewTagRailProps): ReactElement {
	const [openSectionId, setOpenSectionId] = useState<ReviewTagSectionId | null>(null);
	const [isPinned, setIsPinned] = useState(() => loadBooleanResizePreference(PIN_PREFERENCE));

	// A flyout wide enough to hold 66 chips covers the rows the chip has to land on, so
	// unless it is pinned it stands aside for the drag and the rail brings it back.
	const isFlyoutOpen = openSectionId !== null && (isPinned || !isDraggingTag);

	return (
		<>
			<div className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-1 py-1.5">
				{sections.map((section) => {
					const Icon = SECTION_ICONS[section.id];
					const isOpen = openSectionId === section.id;
					return (
						<button
							key={section.id}
							type="button"
							aria-pressed={isOpen}
							aria-label={`${section.title} (${countTags(section)})`}
							title={`${section.title} — ${TAG_DRAG_HINT}`}
							data-testid={`review-tag-rail-${section.id}`}
							className={cn(
								"flex w-7 cursor-pointer flex-col items-center gap-0.5 rounded py-1 text-[9px]",
								isOpen
									? "bg-surface-2 text-text-primary"
									: "text-text-tertiary hover:bg-surface-2 hover:text-text-primary",
							)}
							onClick={() => setOpenSectionId(isOpen ? null : section.id)}
						>
							<Icon size={14} />
							{countTags(section)}
						</button>
					);
				})}
			</div>

			{isFlyoutOpen && openSectionId !== null ? (
				<div
					data-testid="review-tag-flyout"
					// `left-8`: flush against the rail, so the chips read as belonging to the icon
					// that opened them. Above the rows but below the comment composer's own layer.
					className="absolute top-0 bottom-0 left-8 z-20 flex w-[360px] flex-col border-r border-border bg-surface-1 shadow-lg"
				>
					<div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1 text-[10px] text-text-secondary">
						<span>Tags</span>
						<div className="flex items-center gap-1">
							<button
								type="button"
								aria-label={isPinned ? "Unpin tag palette" : "Pin tag palette open during a drag"}
								aria-pressed={isPinned}
								title={
									isPinned
										? "Pinned: the palette stays open while a chip is dragged."
										: "Pin the palette so it stays open while a chip is dragged."
								}
								className="cursor-pointer text-text-tertiary hover:text-text-primary"
								onClick={() => setIsPinned(persistBooleanResizePreference(PIN_PREFERENCE, !isPinned))}
							>
								{isPinned ? <Pin size={12} /> : <PinOff size={12} />}
							</button>
							<button
								type="button"
								aria-label="Close tag palette"
								className="cursor-pointer text-text-tertiary hover:text-text-primary"
								onClick={() => setOpenSectionId(null)}
							>
								<X size={12} />
							</button>
						</div>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						<ReviewTagPalette
							// Remounting per section is what lets the rail open a closed catalog: the
							// palette seeds its expanded set once, from the reviewer's saved preferences
							// plus whichever section was just asked for.
							key={openSectionId}
							sections={sections}
							initialSectionId={openSectionId}
							onTagDragStart={onTagDragStart}
							onTagDragEnd={onTagDragEnd}
						/>
					</div>
				</div>
			) : null}
		</>
	);
}
