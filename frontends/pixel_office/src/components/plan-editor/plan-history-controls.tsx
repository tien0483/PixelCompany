import { Redo2, Undo2 } from "lucide-react";
import type { ReactElement } from "react";

import { PlanHistoryPopover } from "@/components/plan-editor/plan-history-popover";
import { Button } from "@/components/ui/button";
import { HTML_LABELS } from "@/html/html-labels";
import type { RuntimePlanHistoryEntry } from "@/runtime/types";

export interface PlanHistoryControlsProps {
	/** Both documents' versions, oldest first. */
	entries: RuntimePlanHistoryEntry[];
	canUndo: boolean;
	canRedo: boolean;
	disabled?: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onRestore: (entryId: string) => void;
	onDiff: (entryId: string) => Promise<{ diff: string; changed: boolean } | null>;
}

/**
 * Undo / Redo / History for the document on screen.
 *
 * Lives in the preview pane's header rather than in the generate bar, because the generate bar only
 * exists on the markdown side and undoing a generated page is exactly what you want to do while
 * looking at that page.
 */
export function PlanHistoryControls({
	entries,
	canUndo,
	canRedo,
	disabled,
	onUndo,
	onRedo,
	onRestore,
	onDiff,
}: PlanHistoryControlsProps): ReactElement {
	return (
		<div className="flex shrink-0 items-center gap-1" data-testid="plan-history-controls">
			<Button
				variant="ghost"
				size="sm"
				icon={<Undo2 size={13} />}
				disabled={disabled || !canUndo}
				aria-label={HTML_LABELS.undo}
				title={HTML_LABELS.undoHint}
				onClick={onUndo}
				data-testid="plan-history-undo"
			/>
			<Button
				variant="ghost"
				size="sm"
				icon={<Redo2 size={13} />}
				disabled={disabled || !canRedo}
				aria-label={HTML_LABELS.redo}
				title={HTML_LABELS.redoHint}
				onClick={onRedo}
				data-testid="plan-history-redo"
			/>
			<PlanHistoryPopover entries={entries} disabled={disabled} onRestore={onRestore} onDiff={onDiff} />
		</div>
	);
}
