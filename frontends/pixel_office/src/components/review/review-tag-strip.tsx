import { ChevronDown, ChevronRight, X } from "lucide-react";
import { type ReactElement, useState } from "react";

import { cn } from "@/components/ui/cn";
import {
	loadBooleanResizePreference,
	persistBooleanResizePreference,
	type ResizeBooleanPreference,
} from "@/resize/resize-preferences";
import {
	countTags,
	type ReviewTag,
	type ReviewTagSection,
	type ReviewTagSectionId,
	reviewTagColor,
} from "@/review/review-tags";
import { LocalStorageKey } from "@/storage/local-storage-store";

/**
 * The curated tags open as they always have. The two catalog sections do not: together
 * they are ~90 chips, which is not what should sit between the file toolbar and the
 * first line of the diff.
 */
const SECTION_PREFERENCES: Record<ReviewTagSectionId, ResizeBooleanPreference> = {
	tags: { key: LocalStorageKey.ReviewTagStripExpanded, defaultValue: true },
	smells: { key: LocalStorageKey.ReviewSmellSectionExpanded, defaultValue: false },
	refactorings: { key: LocalStorageKey.ReviewRefactoringSectionExpanded, defaultValue: false },
};

const DRAG_HINT = "Drag a tag onto a diff line to mark a suspect spot.";

export interface ReviewTagStripProps {
	sections: ReviewTagSection[];
	onTagDragStart: (tag: ReviewTag) => void;
	onTagDragEnd: () => void;
}

function matchesFilter(tag: ReviewTag, filter: string): boolean {
	return filter === "" || tag.label.toLowerCase().includes(filter);
}

/**
 * The drag source for line tags, kept beside the rows it drops onto rather than
 * inside a sidebar tab — the sidebar shows one tab at a time, so a palette there
 * costs a switch away from the file list and back for every single tag.
 */
export function ReviewTagStrip({ sections, onTagDragStart, onTagDragEnd }: ReviewTagStripProps): ReactElement {
	const [expanded, setExpanded] = useState<Record<ReviewTagSectionId, boolean>>(() => ({
		tags: loadBooleanResizePreference(SECTION_PREFERENCES.tags),
		smells: loadBooleanResizePreference(SECTION_PREFERENCES.smells),
		refactorings: loadBooleanResizePreference(SECTION_PREFERENCES.refactorings),
	}));
	const [filter, setFilter] = useState("");

	const toggle = (id: ReviewTagSectionId): void => {
		setExpanded((current) => ({
			...current,
			[id]: persistBooleanResizePreference(SECTION_PREFERENCES[id], !current[id]),
		}));
	};

	// The filter only earns its row once a catalog section is open: with just the ten
	// curated tags on screen there is nothing to search for.
	const isFilterable = expanded.smells || expanded.refactorings;
	const normalizedFilter = isFilterable ? filter.trim().toLowerCase() : "";

	return (
		<div className="flex shrink-0 flex-col gap-1 border-b border-border bg-surface-1 px-3 py-1.5">
			{isFilterable ? (
				<div className="flex items-center gap-1">
					<input
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Filter tags…"
						aria-label="Filter tags"
						className="w-48 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-primary focus:border-border-focus focus:outline-none"
					/>
					{filter.length > 0 ? (
						<button
							type="button"
							aria-label="Clear tag filter"
							className="cursor-pointer text-text-tertiary hover:text-text-primary"
							onClick={() => setFilter("")}
						>
							<X size={12} />
						</button>
					) : null}
				</div>
			) : null}

			{sections.map((section) => {
				const isExpanded = expanded[section.id];
				const groups = isExpanded
					? section.groups
							.map((group) => ({ ...group, tags: group.tags.filter((tag) => matchesFilter(tag, normalizedFilter)) }))
							.filter((group) => group.tags.length > 0)
					: [];
				const shownCount = groups.reduce((total, group) => total + group.tags.length, 0);
				const totalCount = countTags(section);

				return (
					<div key={section.id} className="flex items-start gap-2">
						<button
							type="button"
							aria-expanded={isExpanded}
							title={DRAG_HINT}
							className="flex w-28 shrink-0 cursor-pointer items-center gap-1 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
							onClick={() => toggle(section.id)}
						>
							{isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
							{section.title} (
							{isExpanded && normalizedFilter !== "" ? `${shownCount}/${totalCount}` : totalCount})
						</button>
						{isExpanded ? (
							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
								{groups.length === 0 ? (
									<span className="py-0.5 text-[10px] text-text-tertiary">No match</span>
								) : (
									groups.map((group) => (
										<div key={group.title} className="flex flex-wrap items-center gap-1">
											{group.title.length > 0 ? (
												<span className="py-0.5 text-[9px] text-text-tertiary uppercase tracking-wide">
													{group.title}
												</span>
											) : null}
											{group.tags.map((tag) => (
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
									))
								)}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
