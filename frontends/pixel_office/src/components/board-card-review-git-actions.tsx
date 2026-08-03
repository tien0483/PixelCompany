import * as RadixPopover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import {
	branchExistsInRefNames,
	normalizeOfficialBranchName,
	type ReviewCommitExistingMode,
} from "@/git-actions/review-commit-branch";

export type ReviewGitFormMode = "commit-with-branch" | "commit-and-push";

export type ReviewGitBranchedSubmit = {
	mode: ReviewGitFormMode;
	officialBranch: string;
	existingMode: ReviewCommitExistingMode | null;
};

const INPUT_CLASS =
	"w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none";

function stopEvent(event: { stopPropagation: () => void; preventDefault: () => void }): void {
	event.stopPropagation();
	event.preventDefault();
}

export function BoardCardReviewGitActions({
	disabled,
	isCommitLoading,
	statusMessage = null,
	canRetryFollowOn = false,
	baseRefHint,
	branchSuggestions,
	initialFormMode = null,
	onCommit,
	onSubmitBranched,
	onCancelForm,
	onRetryFollowOn,
}: {
	disabled: boolean;
	isCommitLoading: boolean;
	statusMessage?: string | null;
	canRetryFollowOn?: boolean;
	baseRefHint: string;
	branchSuggestions: readonly string[];
	initialFormMode?: ReviewGitFormMode | null;
	onCommit: () => void;
	onSubmitBranched: (input: ReviewGitBranchedSubmit) => void;
	onCancelForm: () => void;
	onRetryFollowOn?: () => void;
}): React.ReactElement {
	const [menuOpen, setMenuOpen] = useState(false);
	const [formMode, setFormMode] = useState<ReviewGitFormMode | null>(initialFormMode);
	const [officialBranch, setOfficialBranch] = useState(baseRefHint);
	const [existingMode, setExistingMode] = useState<ReviewCommitExistingMode | null>(null);

	const normalizedBranch = normalizeOfficialBranchName(officialBranch);
	const branchExists = branchExistsInRefNames(normalizedBranch, branchSuggestions);
	const filteredSuggestions = useMemo(() => {
		const query = normalizedBranch.toLowerCase();
		return branchSuggestions
			.filter((name) => (query.length === 0 ? true : name.toLowerCase().includes(query)))
			.slice(0, 6);
	}, [branchSuggestions, normalizedBranch]);

	const canSubmit =
		normalizedBranch.length > 0 && (!branchExists || existingMode !== null) && !disabled && !isCommitLoading;

	const openForm = (mode: ReviewGitFormMode): void => {
		setMenuOpen(false);
		setFormMode(mode);
		setOfficialBranch(baseRefHint);
		setExistingMode(null);
	};

	const closeForm = (): void => {
		setFormMode(null);
		setOfficialBranch(baseRefHint);
		setExistingMode(null);
		onCancelForm();
	};

	const submit = (): void => {
		if (!formMode || !canSubmit) {
			return;
		}
		onSubmitBranched({
			mode: formMode,
			officialBranch: normalizedBranch,
			existingMode: branchExists ? existingMode : null,
		});
	};

	return (
		<div className="flex flex-col gap-1.5 mt-1.5">
			<div className="flex gap-0">
				<Button
					variant="primary"
					size="sm"
					icon={isCommitLoading ? <Spinner size={12} /> : undefined}
					disabled={disabled}
					style={{ flex: "1 1 0" }}
					className="rounded-r-none"
					onMouseDown={stopEvent}
					onClick={(event) => {
						stopEvent(event);
						onCommit();
					}}
				>
					Commit
				</Button>
				<RadixPopover.Root open={menuOpen} onOpenChange={setMenuOpen}>
					<RadixPopover.Trigger asChild>
						<Button
							variant="primary"
							size="sm"
							disabled={disabled}
							className="rounded-l-none border-l border-white/20 px-1"
							aria-label="More commit options"
							onMouseDown={stopEvent}
						>
							<ChevronDown size={12} />
						</Button>
					</RadixPopover.Trigger>
					<RadixPopover.Portal>
						<RadixPopover.Content
							side="bottom"
							align="end"
							sideOffset={4}
							className="z-50 min-w-[200px] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
						>
							<button
								type="button"
								className="flex w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-3"
								onMouseDown={stopEvent}
								onClick={(event) => {
									stopEvent(event);
									openForm("commit-with-branch");
								}}
							>
								Commit with branch name…
							</button>
							<button
								type="button"
								className="flex w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-3"
								onMouseDown={stopEvent}
								onClick={(event) => {
									stopEvent(event);
									openForm("commit-and-push");
								}}
							>
								Commit and push…
							</button>
						</RadixPopover.Content>
					</RadixPopover.Portal>
				</RadixPopover.Root>
			</div>

			{formMode ? (
				<div className="rounded-md border border-border bg-surface-1 p-2">
					<p className="mb-1 text-[11px] text-text-secondary">
						{formMode === "commit-and-push" ? "Commit and push" : "Commit with branch name"}
					</p>
					<input
						className={INPUT_CLASS}
						placeholder={baseRefHint || "official-branch"}
						value={officialBranch}
						onMouseDown={stopEvent}
						onClick={stopEvent}
						onChange={(event) => {
							setOfficialBranch(event.target.value);
							setExistingMode(null);
						}}
					/>
					{filteredSuggestions.length > 0 ? (
						<div className="mt-1 flex flex-wrap gap-1">
							{filteredSuggestions.map((name) => (
								<button
									type="button"
									key={name}
									className={cn(
										"rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-3",
										name === normalizedBranch && "border-accent text-text-primary",
									)}
									onMouseDown={stopEvent}
									onClick={(event) => {
										stopEvent(event);
										setOfficialBranch(name);
										setExistingMode(null);
									}}
								>
									{name}
								</button>
							))}
						</div>
					) : null}
					{branchExists ? (
						<div className="mt-2 flex flex-col gap-1">
							<p className="text-[11px] text-text-secondary">Branch already exists:</p>
							<button
								type="button"
								className={cn(
									"rounded-sm px-2 py-1 text-left text-[12px] hover:bg-surface-3",
									existingMode === "onto-branch" && "bg-surface-3",
								)}
								onMouseDown={stopEvent}
								onClick={(event) => {
									stopEvent(event);
									setExistingMode("onto-branch");
								}}
							>
								Commit onto that branch
							</button>
							<button
								type="button"
								className={cn(
									"rounded-sm px-2 py-1 text-left text-[12px] hover:bg-surface-3",
									existingMode === "cherry-pick-from-task" && "bg-surface-3",
								)}
								onMouseDown={stopEvent}
								onClick={(event) => {
									stopEvent(event);
									setExistingMode("cherry-pick-from-task");
								}}
							>
								Commit on task branch, then cherry-pick
							</button>
						</div>
					) : null}
					<div className="mt-2 flex gap-1.5">
						<Button
							size="sm"
							variant="default"
							onMouseDown={stopEvent}
							onClick={(event) => {
								stopEvent(event);
								closeForm();
							}}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="primary"
							disabled={!canSubmit}
							onMouseDown={stopEvent}
							onClick={(event) => {
								stopEvent(event);
								submit();
							}}
						>
							Go
						</Button>
					</div>
				</div>
			) : null}

			{statusMessage ? <p className="text-[11px] text-text-secondary">{statusMessage}</p> : null}
			{canRetryFollowOn && onRetryFollowOn ? (
				<Button
					size="sm"
					variant="default"
					onMouseDown={stopEvent}
					onClick={(event) => {
						stopEvent(event);
						onRetryFollowOn();
					}}
				>
					Retry
				</Button>
			) : null}
		</div>
	);
}
