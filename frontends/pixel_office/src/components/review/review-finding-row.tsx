import { Check, X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RuntimeReviewFinding, RuntimeReviewRuleSeverity } from "@/runtime/types";

const SEVERITY_TONE: Record<RuntimeReviewRuleSeverity, string> = {
	CRITICAL: "bg-status-red/20 text-status-red",
	HIGH: "bg-status-orange/20 text-status-orange",
	MEDIUM: "bg-status-gold/20 text-status-gold",
	LOW: "bg-surface-4 text-text-secondary",
};

/**
 * One triage row: where the problem is, how bad, and the two things the reviewer can
 * do about it. Shared by the audit pass (which produces nothing but findings) and a
 * chat turn that ran a review slash command, so the two cannot drift into looking
 * like different features.
 */
export function ReviewFindingRow({
	finding,
	onAccept,
	onDismiss,
}: {
	finding: RuntimeReviewFinding;
	onAccept: (finding: RuntimeReviewFinding) => void;
	onDismiss: (id: string) => void;
}): ReactElement {
	return (
		<div className="space-y-1 rounded border border-border bg-surface-1 p-2 text-xs">
			<div className="flex items-start justify-between gap-1">
				<span className="truncate font-mono text-[10px] text-accent">
					{finding.newPath}
					{finding.newLine !== null ? `:${finding.newLine}` : ""}
				</span>
				<div className="flex shrink-0 items-center gap-1">
					{finding.ruleId ? (
						<span className="rounded border border-border-bright bg-surface-2 px-1 text-[9px] text-text-secondary">
							{finding.ruleId}
						</span>
					) : null}
					<span className={cn("rounded px-1 text-[9px] font-semibold", SEVERITY_TONE[finding.severity])}>
						{finding.severity}
					</span>
				</div>
			</div>
			<p className="text-[11px] leading-snug text-text-secondary">{finding.message}</p>
			<div className="flex justify-end gap-1">
				<Button variant="default" size="sm" icon={<X size={11} />} onClick={() => onDismiss(finding.id)}>
					Dismiss
				</Button>
				<Button
					variant="primary"
					size="sm"
					icon={<Check size={11} />}
					// A finding with no line cannot be positioned as a diff note, so accepting
					// it would create a draft that can never be published.
					disabled={finding.newLine === null}
					title={finding.newLine === null ? "This finding names no line, so it cannot become an inline note" : undefined}
					onClick={() => onAccept(finding)}
				>
					Accept to draft
				</Button>
			</div>
		</div>
	);
}
