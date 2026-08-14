import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { type ReactElement, useCallback } from "react";

import type { RuntimeCleanMergedWorktreesSkippedEntry, RuntimeWorktreeReclaimEntry } from "@/runtime/types";
import { formatBytes } from "@/utils/format-bytes";

/**
 * Display order and copy for the reclaim categories. Ordered by how confidently
 * a worktree can be removed, so the safest choices read first.
 */
const CATEGORY_LABELS: {
	category: RuntimeWorktreeReclaimEntry["category"];
	label: string;
	hint: string;
}[] = [
	{
		category: "merged",
		label: "Merged",
		hint: "Every commit is already in the base branch.",
	},
	{
		category: "unused",
		label: "Never used",
		hint: "Clean and still on the base commit — nothing was written.",
	},
	{
		category: "orphaned",
		label: "Orphaned",
		hint: "No card on any board owns these.",
	},
	{
		category: "missing",
		label: "Stale registrations",
		hint: "Registry entries whose worktree is already gone.",
	},
	{
		category: "unregistered",
		label: "Unregistered directories",
		hint: "Not claimed by any registry — remove these by hand.",
	},
];

function entryKey(entry: RuntimeWorktreeReclaimEntry): string {
	return `${entry.taskId}:${entry.repoLabel}`;
}

function CheckboxBox({
	checked,
	indeterminate,
	onCheckedChange,
	testId,
}: {
	checked: boolean;
	indeterminate?: boolean;
	onCheckedChange: (checked: boolean) => void;
	testId?: string;
}): ReactElement {
	return (
		<RadixCheckbox.Root
			data-testid={testId}
			checked={indeterminate ? "indeterminate" : checked}
			onCheckedChange={(next) => onCheckedChange(next === true)}
			className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent"
		>
			<RadixCheckbox.Indicator>
				{indeterminate ? (
					<span className="block h-0.5 w-2 bg-white" />
				) : (
					<Check size={10} className="text-white" />
				)}
			</RadixCheckbox.Indicator>
		</RadixCheckbox.Root>
	);
}

/**
 * Category rows for reclaimable task worktrees, each expandable to per-worktree
 * checkboxes. Individual selection matters here because a single worktree can be
 * several GB on its own — being able to drop just that one is the difference
 * between a useful control and an all-or-nothing button.
 */
export function CleanupWorktreeSection({
	reclaimable,
	kept,
	selectedKeys,
	expandedCategories,
	onToggleEntry,
	onToggleCategory,
	onToggleExpanded,
}: {
	reclaimable: RuntimeWorktreeReclaimEntry[];
	kept: RuntimeCleanMergedWorktreesSkippedEntry[];
	selectedKeys: ReadonlySet<string>;
	expandedCategories: ReadonlySet<string>;
	onToggleEntry: (entry: RuntimeWorktreeReclaimEntry, checked: boolean) => void;
	onToggleCategory: (
		entries: RuntimeWorktreeReclaimEntry[],
		checked: boolean,
	) => void;
	onToggleExpanded: (category: string) => void;
}): ReactElement {
	const renderCategory = useCallback(
		({ category, label, hint }: (typeof CATEGORY_LABELS)[number]) => {
			const entries = reclaimable.filter(
				(entry) => entry.category === category,
			);
			if (entries.length === 0) {
				return null;
			}
			const totalBytes = entries.reduce(
				(sum, entry) => sum + entry.sizeBytes,
				0,
			);
			const selectedCount = entries.filter((entry) =>
				selectedKeys.has(entryKey(entry)),
			).length;
			const isExpanded = expandedCategories.has(category);

			return (
				<div
					key={category}
					className="rounded-md border border-border bg-surface-2"
				>
					<div className="flex items-center gap-2 px-2.5 py-2">
						<CheckboxBox
							testId={`cleanup-worktree-category-${category}`}
							checked={selectedCount === entries.length}
							indeterminate={
								selectedCount > 0 && selectedCount < entries.length
							}
							onCheckedChange={(checked) => onToggleCategory(entries, checked)}
						/>
						<button
							type="button"
							className="flex flex-1 items-center gap-1.5 text-left text-[13px] text-text-primary"
							onClick={() => onToggleExpanded(category)}
							aria-expanded={isExpanded}
						>
							{isExpanded ? (
								<ChevronDown size={14} />
							) : (
								<ChevronRight size={14} />
							)}
							<span>{label}</span>
							<span className="text-text-secondary">
								({entries.length}, {formatBytes(totalBytes)})
							</span>
						</button>
					</div>
					<p className="px-2.5 pb-2 pl-9 text-[11px] text-text-tertiary">
						{hint}
					</p>
					{isExpanded ? (
						<ul className="max-h-56 space-y-0.5 overflow-y-auto border-t border-border px-2.5 py-2">
							{entries.map((entry) => {
								const key = entryKey(entry);
								return (
									<li key={key}>
										<label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-secondary">
											<CheckboxBox
												checked={selectedKeys.has(key)}
												onCheckedChange={(checked) =>
													onToggleEntry(entry, checked)
												}
											/>
											<span className="font-mono text-text-primary">
												{entry.taskId}
											</span>
											<span>· {entry.repoLabel}</span>
											<span className="ml-auto shrink-0">
												{formatBytes(entry.sizeBytes)}
											</span>
										</label>
										<p
											className="ml-[22px] truncate text-[11px] text-text-tertiary"
											title={entry.reason}
										>
											{entry.reason}
										</p>
									</li>
								);
							})}
						</ul>
					) : null}
				</div>
			);
		},
		[
			reclaimable,
			selectedKeys,
			expandedCategories,
			onToggleCategory,
			onToggleEntry,
			onToggleExpanded,
		],
	);

	return (
		<div className="space-y-2">
			{CATEGORY_LABELS.map(renderCategory)}
			{reclaimable.length === 0 ? (
				<p className="text-[12px] text-text-secondary">
					No reclaimable worktrees.
				</p>
			) : null}
			{kept.length > 0 ? (
				<div className="rounded-md border border-border bg-surface-2 p-2.5">
					<p className="text-[12px] text-text-primary">Kept ({kept.length})</p>
					<ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
						{kept.map((item) => (
							<li
								key={`${item.taskId}:${item.repoLabel ?? ""}`}
								className="text-[11px] text-text-tertiary"
							>
								<span className="font-mono text-text-secondary">
									{item.branch || item.taskId}
								</span>
								{typeof item.sizeBytes === "number"
									? ` · ${formatBytes(item.sizeBytes)}`
									: ""}{" "}
								— {item.reason}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}

export { entryKey as worktreeEntryKey };
