import { MessageSquare, Search } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { cn } from "@/components/ui/cn";
import type { ReviewNewCommentsOnPath } from "@/review/review-comment-recency";
import { resolveFileStatus } from "@/review/review-target";
import type { RuntimeGitlabDiffFile } from "@/runtime/types";

const STATUS_LABEL: Record<ReturnType<typeof resolveFileStatus>, string> = {
	added: "A",
	deleted: "D",
	renamed: "R",
	modified: "M",
};

const STATUS_TONE: Record<ReturnType<typeof resolveFileStatus>, string> = {
	added: "bg-status-green/20 text-status-green",
	deleted: "bg-status-red/20 text-status-red",
	renamed: "bg-status-purple/20 text-status-purple",
	modified: "bg-status-orange/20 text-status-orange",
};

export function ReviewFilesPanel({
	files,
	activePath,
	reviewedPaths,
	draftCountByPath,
	newCommentsByPath,
	onSelectPath,
	onToggleReviewed,
}: {
	files: RuntimeGitlabDiffFile[];
	activePath: string | null;
	reviewedPaths: string[];
	draftCountByPath: Map<string, number>;
	/** Reviewed files somebody else has commented on since — candidates to unmark. */
	newCommentsByPath: Map<string, ReviewNewCommentsOnPath>;
	onSelectPath: (path: string) => void;
	onToggleReviewed: (path: string) => void;
}): ReactElement {
	const [filter, setFilter] = useState("");
	const reviewed = useMemo(() => new Set(reviewedPaths), [reviewedPaths]);

	const visibleFiles = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (needle.length === 0) {
			return files;
		}
		return files.filter((file) => file.newPath.toLowerCase().includes(needle));
	}, [files, filter]);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="review-files-panel">
			<div className="border-b border-border p-2">
				<div className="relative">
					<Search size={12} className="absolute left-2 top-2 text-text-tertiary" />
					<input
						type="text"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Filter changed files…"
						aria-label="Filter changed files"
						className="w-full rounded border border-border bg-surface-2 py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
				{visibleFiles.length === 0 ? (
					<p className="px-1.5 py-3 text-xs text-text-tertiary">
						{files.length === 0 ? "This merge request changes no files." : "No file matches that filter."}
					</p>
				) : null}

				{visibleFiles.map((file) => {
					const status = resolveFileStatus(file);
					const isActive = file.newPath === activePath;
					const isReviewed = reviewed.has(file.newPath);
					const draftCount = draftCountByPath.get(file.newPath) ?? 0;
					const newComments = newCommentsByPath.get(file.newPath) ?? null;
					return (
						<div
							key={file.newPath}
							className={cn(
								"group flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1",
								isActive ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2",
							)}
							role="button"
							tabIndex={0}
							onClick={() => onSelectPath(file.newPath)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onSelectPath(file.newPath);
								}
							}}
						>
							<input
								type="checkbox"
								checked={isReviewed}
								aria-label={`Mark ${file.newPath} reviewed`}
								className="shrink-0 accent-status-green"
								onClick={(event) => event.stopPropagation()}
								onChange={() => onToggleReviewed(file.newPath)}
							/>
							<span
								className={cn("shrink-0 rounded px-1 font-mono text-[10px] font-semibold", STATUS_TONE[status])}
								title={status}
							>
								{STATUS_LABEL[status]}
							</span>
							{/* A file with new comments keeps its tick but loses the strike-through:
							    it is no longer settled, and reading as settled is the bug. */}
							<span
								className={cn(
									"min-w-0 flex-1 truncate font-mono text-[11px]",
									isReviewed && newComments === null && "text-text-tertiary line-through",
								)}
								title={file.renamedFile ? `${file.oldPath} → ${file.newPath}` : file.newPath}
							>
								{file.newPath}
							</span>
							{newComments !== null ? (
								<span
									data-testid="review-file-new-comments-badge"
									className="flex shrink-0 items-center gap-0.5 rounded-full bg-status-orange/20 px-1.5 text-[10px] font-medium text-status-orange"
									title={`${newComments.count} new comment${newComments.count === 1 ? "" : "s"} since you marked this reviewed — untick to review it again`}
								>
									<MessageSquare size={10} />
									{newComments.count}
								</span>
							) : null}
							{draftCount > 0 ? (
								<span
									className="shrink-0 rounded-full bg-accent/20 px-1.5 text-[10px] font-medium text-accent"
									title={`${draftCount} draft comment${draftCount === 1 ? "" : "s"}`}
								>
									{draftCount}
								</span>
							) : null}
							<span className="shrink-0 font-mono text-[10px]">
								<span className="text-status-green">+{file.additions}</span>{" "}
								<span className="text-status-red">-{file.deletions}</span>
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
