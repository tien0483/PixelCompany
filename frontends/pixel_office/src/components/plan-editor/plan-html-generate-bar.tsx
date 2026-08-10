import { ListChecks, Sparkles, Wand2, Zap } from "lucide-react";
import { type ReactElement, useMemo } from "react";

import { showAppToast } from "@/components/app-toaster";
import { PlanClaudeUsageChip } from "@/components/plan-editor/plan-claude-usage-chip";
import { PlanHtmlRunMetrics } from "@/components/plan-editor/plan-html-run-metrics";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import type { HtmlStreamStatus } from "@/html/use-html-agent-stream";
import type { HtmlTemplateMeta } from "@/html/use-html-templates";

export interface PlanHtmlGenerateBarProps {
	status: HtmlStreamStatus;
	/** Brief expansion runs on its own stream; the bar only needs its liveness. */
	briefStatus: HtmlStreamStatus;
	startedAt: number | null;
	firstByteAt: number | null;
	doneAt: number | null;
	htmlSizeBytes: number;
	/**
	 * Template state is owned by the editor view and shared with the left rail, which
	 * is where templates are actually picked; the bar only reports and acts on it.
	 */
	templates: HtmlTemplateMeta[];
	selectedTemplateId: string | null;
	/** Reflects the html_anything sidecar, not the Claude account. */
	online: boolean;
	templatesLoading: boolean;
	/** False until the plan has a generated HTML sibling to edit. */
	canRefine: boolean;
	/** False for an unsaved plan, whose images are not on disk yet. */
	canExpand: boolean;
	disabled?: boolean;
	onExpand: (templateId: string | null) => void;
	onGenerate: (templateId: string) => void;
	onRefine: (templateId: string) => void;
	onCancel: () => void;
}

/**
 * Claude status + Generate/Cancel for the plan editor's rendered pane. The template
 * itself is picked in the left rail (`PlanTemplateRail`); generation state is owned by
 * the editor view so the pane can stream the result.
 */
export function PlanHtmlGenerateBar({
	status,
	briefStatus,
	startedAt,
	firstByteAt,
	doneAt,
	htmlSizeBytes,
	templates,
	selectedTemplateId: selectedId,
	online,
	templatesLoading: loading,
	canRefine,
	canExpand,
	disabled,
	onExpand,
	onGenerate,
	onRefine,
	onCancel,
}: PlanHtmlGenerateBarProps): ReactElement {
	const isRunning = status === "running";
	const isExpanding = briefStatus === "running";

	const selectedTemplate = useMemo(
		() => templates.find((t) => t.id === selectedId) ?? null,
		[templates, selectedId],
	);

	const handleGenerate = () => {
		if (!selectedId) {
			showAppToast({ intent: "warning", message: HTML_LABELS.pickTemplate });
			return;
		}
		onGenerate(selectedId);
	};

	const handleRefine = () => {
		if (!selectedId) {
			showAppToast({ intent: "warning", message: HTML_LABELS.pickTemplate });
			return;
		}
		onRefine(selectedId);
	};

	return (
		<div className="flex flex-wrap items-center gap-2" data-testid="plan-html-generate-bar">
			<span
				className="hidden shrink-0 items-center gap-1 rounded-md border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary lg:inline-flex"
				title="HTML generation always runs on the Claude agent"
			>
				<Sparkles size={11} className="text-accent" aria-hidden />
				Claude
			</span>
			<span
				className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", online ? "bg-status-green" : "bg-status-red")}
				title={online ? HTML_LABELS.online : HTML_LABELS.offlineHint}
				aria-label={online ? HTML_LABELS.online : HTML_LABELS.offlineShort}
			/>
			<PlanClaudeUsageChip />
			{selectedTemplate ? (
				<span className="hidden max-w-[160px] truncate text-[11px] text-text-secondary lg:inline">
					{selectedTemplate.emoji ? `${selectedTemplate.emoji} ` : ""}
					{selectedTemplate.enName || selectedTemplate.zhName || selectedTemplate.id}
				</span>
			) : (
				<span className="hidden text-[11px] text-text-tertiary lg:inline">
					{online ? HTML_LABELS.pickTemplate : HTML_LABELS.offline}
				</span>
			)}
			{selectedTemplate?.aspectHint ? (
				<span className="hidden text-[10px] text-text-tertiary xl:inline">{selectedTemplate.aspectHint}</span>
			) : null}
			{isRunning ? (
				<>
					<span className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
						<Spinner size={11} />
						{HTML_LABELS.streaming}
					</span>
					<Button variant="ghost" size="sm" onClick={onCancel} data-testid="plan-html-generate-cancel">
						Cancel
					</Button>
				</>
			) : (
				<>
					{/* Expansion never touches the sidecar, so it stays usable while templates are offline. */}
					<Button
						variant="default"
						size="sm"
						icon={isExpanding ? <Spinner size={13} /> : <ListChecks size={13} />}
						disabled={!canExpand || isExpanding || disabled}
						onClick={() => onExpand(selectedId)}
						title={canExpand ? HTML_LABELS.expandHint : HTML_LABELS.expandNeedsPlan}
						data-testid="plan-html-brief-run"
					>
						{isExpanding ? HTML_LABELS.expanding : HTML_LABELS.expand}
					</Button>
					<Button
						variant="primary"
						size="sm"
						icon={<Zap size={13} />}
						disabled={!selectedId || !online || loading || disabled}
						onClick={handleGenerate}
						data-testid="plan-html-generate-run"
					>
						{HTML_LABELS.convert}
					</Button>
					<Button
						variant="default"
						size="sm"
						icon={<Wand2 size={13} />}
						disabled={!canRefine || !selectedId || !online || loading || disabled}
						onClick={handleRefine}
						title={canRefine ? HTML_LABELS.refineHint : HTML_LABELS.refineNeedsHtml}
						data-testid="plan-html-refine-run"
					>
						{HTML_LABELS.refine}
					</Button>
				</>
			)}
			<PlanHtmlRunMetrics
				running={isRunning}
				startedAt={startedAt}
				firstByteAt={firstByteAt}
				doneAt={doneAt}
				htmlSizeBytes={htmlSizeBytes}
			/>
		</div>
	);
}
