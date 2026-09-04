import type { ReactElement, ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { reviewTagDescription, reviewTagDescriptionHeadings } from "@/review/review-tag-descriptions";
import { type ReviewTag, reviewTagColor } from "@/review/review-tags";

/**
 * Wraps whatever renders a tag — the palette's draggable button, or the static chip
 * below — in its hover explanation. ~90 of these labels are catalog names the reviewer
 * is not expected to have memorised, and the label alone teaches nothing.
 *
 * A tag with no description (a rules-bundle category) passes through untouched, since
 * `Tooltip` returns its children unwrapped when the content is falsy.
 */
export function ReviewTagTooltip({
	tag,
	children,
	side,
}: {
	tag: ReviewTag;
	children: ReactNode;
	side?: "top" | "right" | "bottom" | "left";
}): ReactElement {
	const description = reviewTagDescription(tag);
	if (!description) {
		return <>{children}</>;
	}
	const headings = reviewTagDescriptionHeadings(tag);
	return (
		<Tooltip
			side={side}
			content={
				<div className="max-w-xs space-y-1">
					<div className={cn("font-semibold", reviewTagColor(tag).text)}>{tag.label}</div>
					<p className="text-text-secondary">
						<span className="text-text-tertiary">{headings.what}: </span>
						{description.what}
					</p>
					<p className="text-text-secondary">
						<span className="text-text-tertiary">{headings.then}: </span>
						{description.then}
					</p>
				</div>
			}
		>
			{children}
		</Tooltip>
	);
}

/**
 * The small read-only chip shown wherever a tag has already been placed: on the row, in
 * the pending-note composer, and in the annotations panel.
 */
export function ReviewTagChip({ tag, className }: { tag: ReviewTag; className?: string }): ReactElement {
	return (
		<ReviewTagTooltip tag={tag}>
			<span className={cn("rounded border px-1 text-[9px]", reviewTagColor(tag).chip, className)}>{tag.label}</span>
		</ReviewTagTooltip>
	);
}
