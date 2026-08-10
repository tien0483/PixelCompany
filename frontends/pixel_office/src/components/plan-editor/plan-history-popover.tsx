import * as RadixPopover from "@radix-ui/react-popover";
import { FileCode2, FileText, History, RotateCcw } from "lucide-react";
import { type ReactElement, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import type { RuntimePlanHistoryEntry, RuntimePlanHistoryLabel } from "@/runtime/types";

const LABEL_TEXT: Record<RuntimePlanHistoryLabel, string> = {
	generate: "Generated",
	refine: "Refined",
	expand: "Brief expanded",
	"ai-edit": "AI edit",
	autosave: "Edited",
	manual: "Marked",
};

function relativeTime(timestamp: number): string {
	const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return new Date(timestamp).toLocaleDateString();
}

function formatBytes(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

export interface PlanHistoryPopoverProps {
	/** Newest last, both documents — the list is grouped by target in the UI. */
	entries: RuntimePlanHistoryEntry[];
	disabled?: boolean;
	onRestore: (entryId: string) => void;
	onDiff: (entryId: string) => Promise<{ diff: string; changed: boolean } | null>;
}

/**
 * The version list behind the editor's History button: every recorded state of the markdown and of
 * the generated page, with restore, and a diff of any markdown version against the current file.
 *
 * The diff is fetched per entry rather than up front — a plan can hold a hundred versions, and
 * diffing all of them to render a list nobody scrolled would be work for nothing.
 */
export function PlanHistoryPopover({ entries, disabled, onRestore, onDiff }: PlanHistoryPopoverProps): ReactElement {
	const [open, setOpen] = useState(false);
	const [diffFor, setDiffFor] = useState<string | null>(null);
	const [diffText, setDiffText] = useState<string | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);

	const newestFirst = [...entries].reverse();

	const toggleDiff = (entryId: string) => {
		if (diffFor === entryId) {
			setDiffFor(null);
			setDiffText(null);
			return;
		}
		setDiffFor(entryId);
		setDiffText(null);
		setDiffLoading(true);
		void (async () => {
			try {
				const result = await onDiff(entryId);
				setDiffText(
					result === null
						? HTML_LABELS.historyDiffUnavailable
						: result.changed
							? result.diff
							: HTML_LABELS.historyNoChanges,
				);
			} catch (error) {
				setDiffText(error instanceof Error ? error.message : String(error));
			} finally {
				setDiffLoading(false);
			}
		})();
	};

	return (
		<RadixPopover.Root
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setDiffFor(null);
					setDiffText(null);
				}
			}}
		>
			<RadixPopover.Trigger asChild>
				<Button
					variant="default"
					size="sm"
					icon={<History size={13} />}
					disabled={disabled}
					title={HTML_LABELS.historyHint}
					data-testid="plan-history-open"
				>
					{HTML_LABELS.history}
				</Button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					className="z-50 max-h-[60vh] w-[380px] overflow-y-auto rounded-lg border border-border bg-surface-2 p-1 shadow-xl"
					sideOffset={5}
					align="end"
					data-testid="plan-history-list"
				>
					{newestFirst.length === 0 ? (
						<div className="px-2.5 py-3 text-center text-[11px] text-text-tertiary">
							{HTML_LABELS.historyEmpty}
						</div>
					) : (
						newestFirst.map((entry) => (
							<div key={entry.id} className="rounded-md px-1 py-0.5">
								<div
									className={cn(
										"flex items-center gap-2 rounded-md px-1.5 py-1",
										entry.isCurrent ? "bg-surface-3" : "hover:bg-surface-3",
									)}
								>
									{entry.target === "html" ? (
										<FileCode2 size={13} className="shrink-0 text-text-tertiary" aria-hidden />
									) : (
										<FileText size={13} className="shrink-0 text-text-tertiary" aria-hidden />
									)}
									<span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">
										{LABEL_TEXT[entry.label]}
										{entry.isCurrent ? ` · ${HTML_LABELS.historyCurrent}` : ""}
									</span>
									<span className="shrink-0 text-[10px] text-text-tertiary">
										{relativeTime(entry.createdAt)} · {formatBytes(entry.bytes)}
									</span>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => toggleDiff(entry.id)}
										title={HTML_LABELS.historyDiffHint}
										data-testid={`plan-history-diff-${entry.id}`}
									>
										{HTML_LABELS.historyDiff}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										icon={<RotateCcw size={13} />}
										disabled={entry.isCurrent}
										aria-label={HTML_LABELS.historyRestore}
										title={HTML_LABELS.historyRestore}
										onClick={() => {
											onRestore(entry.id);
											setOpen(false);
										}}
										data-testid={`plan-history-restore-${entry.id}`}
									/>
								</div>
								{diffFor === entry.id ? (
									<pre className="mx-1.5 mb-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-1 px-2 py-1.5 font-mono text-[10px] leading-4 text-text-secondary">
										{diffLoading ? <Spinner size={11} /> : diffText}
									</pre>
								) : null}
							</div>
						))
					)}
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
