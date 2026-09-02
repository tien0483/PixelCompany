import type { ReactElement } from "react";
import { cn } from "@/components/ui/cn";
import type { RuntimeReviewAnnotation } from "@/runtime/types";
import type { ReviewTag } from "@/review/review-tags";

export interface ReviewTagPaletteProps {
	tags: ReviewTag[];
	annotations: RuntimeReviewAnnotation[];
	staleAnnotationIds: Set<string>;
	onTagDragStart: (tag: ReviewTag) => void;
	onTagDragEnd: () => void;
	onJumpToAnnotation: (annotation: RuntimeReviewAnnotation) => void;
	onRemoveAnnotation: (id: string) => void;
}

function formatAnnotationLineLabel(annotation: RuntimeReviewAnnotation): string {
	const isOldSide = annotation.newLine === null && annotation.oldLine !== null;
	const end = isOldSide ? annotation.oldLine : annotation.newLine;
	if (end === null) {
		return "";
	}
	const start = isOldSide ? annotation.lineRange?.startOldLine : annotation.lineRange?.startNewLine;
	const prefix = isOldSide ? ":-" : ":";
	return start != null && start !== end ? `${prefix}${start}-${end}` : `${prefix}${end}`;
}

export function ReviewTagPalette({
	tags,
	annotations,
	staleAnnotationIds,
	onTagDragStart,
	onTagDragEnd,
	onJumpToAnnotation,
	onRemoveAnnotation,
}: ReviewTagPaletteProps): ReactElement {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
			<div className="space-y-1.5">
				<div className="text-[10px] text-text-tertiary">
					Drag a tag onto a diff line to mark a suspect spot.
				</div>
				<div className="flex flex-wrap gap-1">
					{tags.map((tag) => (
						<button
							key={`${tag.kind}-${tag.label}`}
							type="button"
							draggable
							className="cursor-grab rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
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
			</div>

			<div className="mt-3 flex-1 space-y-1.5">
				<div className="text-[11px] font-semibold text-text-primary">
					Annotations ({annotations.length})
				</div>
				{annotations.length === 0 ? (
					<div className="py-2 text-[11px] text-text-tertiary">No annotations yet.</div>
				) : (
					<div className="space-y-1">
						{annotations.map((annotation) => {
							const isStale = staleAnnotationIds.has(annotation.id);
							return (
								<div
									key={annotation.id}
									className="flex items-start justify-between gap-2 rounded border border-border bg-surface-1 p-1.5 text-[11px]"
								>
									<button
										type="button"
										className="min-w-0 flex-1 cursor-pointer text-left"
										onClick={() => onJumpToAnnotation(annotation)}
									>
										<div className="flex items-center gap-1">
											<span className="rounded border border-border-bright bg-surface-2 px-1 text-[9px] text-text-secondary">
												{annotation.tag.label}
											</span>
											{annotation.verdict ? (
												<span
													title={annotation.verdict.reasoning}
													className={cn(
														"rounded px-1 text-[9px]",
														annotation.verdict.verdict === "confirmed" && "bg-status-red/20 text-status-red",
														annotation.verdict.verdict === "partial" && "bg-status-orange/20 text-status-orange",
														annotation.verdict.verdict === "not_an_issue" && "bg-status-green/20 text-status-green",
													)}
												>
													{annotation.verdict.verdict === "confirmed"
														? "Confirmed"
														: annotation.verdict.verdict === "partial"
															? "Partial"
															: "Not an issue"}
												</span>
											) : null}
											{isStale ? (
												<span
													className="inline-block h-1.5 w-1.5 rounded-full bg-status-orange"
													title="Added against an earlier revision"
												/>
											) : null}
										</div>
										<div className="mt-0.5 truncate font-mono text-[10px] text-accent">
											{annotation.newPath}
											{formatAnnotationLineLabel(annotation)}
										</div>
										{annotation.note.length > 0 ? (
											<div className="truncate text-[10px] text-text-secondary" title={annotation.note}>
												{annotation.note}
											</div>
										) : null}
									</button>
									<button
										type="button"
										aria-label="Delete annotation"
										className="shrink-0 cursor-pointer text-text-tertiary hover:text-status-red"
										onClick={(event) => {
											event.stopPropagation();
											onRemoveAnnotation(annotation.id);
										}}
									>
										×
									</button>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
