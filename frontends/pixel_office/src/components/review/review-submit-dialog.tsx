import { type ReactElement, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeReviewDraftComment } from "@/runtime/types";

export type ReviewSubmitAction = "approve" | "comment" | "request_changes";

export interface ReviewSubmitOutcome {
	action: ReviewSubmitAction;
	summary: string;
}

const ACTION_OPTIONS: Array<{ value: ReviewSubmitAction; label: string; tone: string; description: string }> = [
	{
		value: "comment",
		label: "Comment",
		tone: "border-border-bright text-text-primary",
		description: "Publish the notes without a verdict.",
	},
	{
		value: "approve",
		label: "Approve",
		tone: "border-status-green/60 text-status-green",
		description: "Publish the notes and approve the merge request.",
	},
	{
		value: "request_changes",
		label: "Request changes",
		tone: "border-status-red/60 text-status-red",
		description: "Publish the notes and remove any approval of yours.",
	},
];

export function ReviewSubmitDialog({
	open,
	draftComments,
	isSubmitting,
	submitError,
	unreviewedCount,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	draftComments: RuntimeReviewDraftComment[];
	isSubmitting: boolean;
	submitError: string | null;
	unreviewedCount: number;
	onOpenChange: (open: boolean) => void;
	onSubmit: (outcome: ReviewSubmitOutcome) => void;
}): ReactElement {
	const [action, setAction] = useState<ReviewSubmitAction>("comment");
	const [summary, setSummary] = useState("");

	const hasNothingToDo = draftComments.length === 0 && summary.trim().length === 0 && action === "comment";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// Refuse to close mid-publish: half the notes may already be posted, and
				// dismissing the dialog would hide which ones.
				if (!isSubmitting) {
					onOpenChange(next);
				}
			}}
		>
			<DialogHeader title="Submit review to GitLab" />
			<DialogBody>
				<div className="space-y-4 text-xs">
					<div className="space-y-1.5">
						<span className="font-medium text-text-secondary">Verdict</span>
						<div className="grid grid-cols-3 gap-2">
							{ACTION_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									title={option.description}
									onClick={() => setAction(option.value)}
									className={cn(
										"cursor-pointer rounded border p-2 text-center font-medium",
										action === option.value ? `bg-surface-3 ${option.tone}` : "border-border text-text-secondary",
									)}
								>
									{option.label}
								</button>
							))}
						</div>
						<p className="text-[11px] text-text-tertiary">
							{ACTION_OPTIONS.find((option) => option.value === action)?.description}
						</p>
					</div>

					<div className="space-y-1.5">
						<span className="font-medium text-text-secondary">Summary note (optional)</span>
						<textarea
							value={summary}
							onChange={(event) => setSummary(event.target.value)}
							rows={3}
							aria-label="Summary note"
							placeholder="A sentence on the overall state of the change."
							className="w-full rounded border border-border bg-surface-2 p-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</div>

					<div className="space-y-1 rounded border border-border bg-surface-2 p-2.5 text-[11px]">
						<div className="font-medium text-text-primary">
							{draftComments.length === 0
								? "No inline notes queued"
								: `${draftComments.length} inline note${draftComments.length === 1 ? "" : "s"} will be published`}
						</div>
						{draftComments.slice(0, 5).map((draft) => (
							<div key={draft.id} className="truncate font-mono text-[10px] text-text-tertiary">
								{draft.newPath}
								{draft.newLine !== null ? `:${draft.newLine}` : draft.oldLine !== null ? `:-${draft.oldLine}` : ""}
							</div>
						))}
						{draftComments.length > 5 ? (
							<div className="text-[10px] text-text-tertiary">…and {draftComments.length - 5} more</div>
						) : null}
						{unreviewedCount > 0 ? (
							<div className="text-status-orange">
								{unreviewedCount} file{unreviewedCount === 1 ? "" : "s"} not marked reviewed yet.
							</div>
						) : null}
					</div>

					{submitError ? <p className="text-status-red">{submitError}</p> : null}
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="default" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
				<Button
					variant="primary"
					disabled={isSubmitting || hasNothingToDo}
					title={hasNothingToDo ? "Add a note or pick a verdict first" : undefined}
					onClick={() => onSubmit({ action, summary: summary.trim() })}
				>
					{isSubmitting ? (
						<>
							<Spinner size={12} /> Publishing…
						</>
					) : (
						"Publish to GitLab"
					)}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
