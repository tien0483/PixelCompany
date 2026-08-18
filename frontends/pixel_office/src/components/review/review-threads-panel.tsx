import { Check, CornerDownRight } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RuntimeGitlabDiscussion } from "@/runtime/types";

type ThreadFilter = "all" | "unresolved" | "resolved";

/**
 * GitLab's own discussions on this merge request. Distinct from the draft-comment
 * tray: these are already published, they can be replied to and resolved, and they
 * survive independently of the local session.
 */
export function ReviewThreadsPanel({
	discussions,
	onReply,
	onToggleResolved,
	onJumpToThread,
}: {
	discussions: RuntimeGitlabDiscussion[];
	onReply: (discussionId: string, body: string) => Promise<void>;
	onToggleResolved: (discussionId: string, resolved: boolean) => Promise<void>;
	onJumpToThread: (path: string, line: number | null) => void;
}): ReactElement {
	const [filter, setFilter] = useState<ThreadFilter>("unresolved");
	const [replyingTo, setReplyingTo] = useState<string | null>(null);
	const [replyText, setReplyText] = useState("");
	const [busyId, setBusyId] = useState<string | null>(null);

	// System notes ("changed the description", "added 2 commits") are noise in a
	// review pane, so a thread made only of them is dropped entirely.
	const humanDiscussions = useMemo(
		() => discussions.filter((discussion) => discussion.notes.some((note) => !note.system)),
		[discussions],
	);

	const counts = useMemo(() => {
		let resolved = 0;
		for (const discussion of humanDiscussions) {
			if (discussion.resolved) {
				resolved += 1;
			}
		}
		return { resolved, unresolved: humanDiscussions.length - resolved, all: humanDiscussions.length };
	}, [humanDiscussions]);

	const visible = useMemo(() => {
		if (filter === "all") {
			return humanDiscussions;
		}
		return humanDiscussions.filter((discussion) =>
			filter === "resolved" ? discussion.resolved : !discussion.resolved,
		);
	}, [filter, humanDiscussions]);

	const submitReply = async (discussionId: string): Promise<void> => {
		const body = replyText.trim();
		if (body.length === 0) {
			return;
		}
		setBusyId(discussionId);
		try {
			await onReply(discussionId, body);
			setReplyText("");
			setReplyingTo(null);
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="review-threads-panel">
			<div className="flex gap-1 border-b border-border p-2">
				<FilterChip label={`All (${counts.all})`} active={filter === "all"} onSelect={() => setFilter("all")} />
				<FilterChip
					label={`Unresolved (${counts.unresolved})`}
					active={filter === "unresolved"}
					onSelect={() => setFilter("unresolved")}
				/>
				<FilterChip
					label={`Resolved (${counts.resolved})`}
					active={filter === "resolved"}
					onSelect={() => setFilter("resolved")}
				/>
			</div>

			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
				{visible.length === 0 ? (
					<p className="px-1 py-2 text-xs text-text-tertiary">
						{counts.all === 0 ? "No discussions on this merge request yet." : "Nothing in this filter."}
					</p>
				) : null}

				{visible.map((discussion) => {
					const positioned = discussion.notes.find((note) => note.position !== null);
					const position = positioned?.position ?? null;
					const humanNotes = discussion.notes.filter((note) => !note.system);
					const isBusy = busyId === discussion.id;
					return (
						<div key={discussion.id} className="space-y-1.5 rounded-md border border-border bg-surface-2 p-2">
							{position ? (
								<button
									type="button"
									className="w-full cursor-pointer truncate text-left font-mono text-[10px] text-accent hover:underline"
									onClick={() =>
										onJumpToThread(position.newPath ?? position.oldPath ?? "", position.newLine ?? position.oldLine)
									}
								>
									{position.newPath ?? position.oldPath}:{position.newLine ?? position.oldLine}
								</button>
							) : (
								<span className="text-[10px] text-text-tertiary">Merge request comment</span>
							)}

							{humanNotes.map((note) => (
								<div key={note.id} className="space-y-0.5">
									<div className="text-[10px] font-semibold text-text-secondary">
										{note.authorName ?? note.authorUsername ?? "Unknown"}
									</div>
									<p className="whitespace-pre-wrap text-[11px] leading-snug text-text-primary">{note.body}</p>
								</div>
							))}

							{replyingTo === discussion.id ? (
								<div className="space-y-1">
									<textarea
										value={replyText}
										onChange={(event) => setReplyText(event.target.value)}
										rows={2}
										aria-label="Reply"
										className="w-full rounded border border-border bg-surface-0 p-1.5 text-[11px] text-text-primary focus:border-border-focus focus:outline-none"
									/>
									<div className="flex justify-end gap-1">
										<Button
											variant="default"
											size="sm"
											onClick={() => {
												setReplyingTo(null);
												setReplyText("");
											}}
										>
											Cancel
										</Button>
										<Button
											variant="primary"
											size="sm"
											disabled={isBusy || replyText.trim().length === 0}
											onClick={() => void submitReply(discussion.id)}
										>
											Reply
										</Button>
									</div>
								</div>
							) : (
								<div className="flex justify-end gap-1">
									<Button
										variant="ghost"
										size="sm"
										icon={<CornerDownRight size={11} />}
										onClick={() => {
											setReplyingTo(discussion.id);
											setReplyText("");
										}}
									>
										Reply
									</Button>
									{/* Individual notes are not resolvable in GitLab, so no toggle for them. */}
									{!discussion.individualNote ? (
										<Button
											variant={discussion.resolved ? "default" : "primary"}
											size="sm"
											icon={<Check size={11} />}
											disabled={isBusy}
											onClick={() => void onToggleResolved(discussion.id, !discussion.resolved)}
										>
											{discussion.resolved ? "Unresolve" : "Resolve"}
										</Button>
									) : null}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function FilterChip({
	label,
	active,
	onSelect,
}: {
	label: string;
	active: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"flex-1 cursor-pointer rounded border px-1 py-1 text-[10px]",
				active
					? "border-border-bright bg-surface-4 text-text-primary"
					: "border-border bg-surface-2 text-text-secondary hover:text-text-primary",
			)}
		>
			{label}
		</button>
	);
}
