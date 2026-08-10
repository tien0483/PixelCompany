import { ListChecks, Sparkles, Wand2, Zap } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { PlanHtmlRunMetrics } from "@/components/plan-editor/plan-html-run-metrics";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import type { HtmlStreamStatus } from "@/html/use-html-agent-stream";
import { useHtmlTemplates } from "@/html/use-html-templates";

export interface PlanHtmlGenerateBarProps {
	status: HtmlStreamStatus;
	/** Brief expansion runs on its own stream; the bar only needs its liveness. */
	briefStatus: HtmlStreamStatus;
	startedAt: number | null;
	firstByteAt: number | null;
	doneAt: number | null;
	htmlSizeBytes: number;
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
 * Template picker + Generate/Cancel for the plan editor's rendered pane.
 * Generation state is owned by the editor view so the pane can stream the result.
 */
export function PlanHtmlGenerateBar({
	status,
	briefStatus,
	startedAt,
	firstByteAt,
	doneAt,
	htmlSizeBytes,
	canRefine,
	canExpand,
	disabled,
	onExpand,
	onGenerate,
	onRefine,
	onCancel,
}: PlanHtmlGenerateBarProps): ReactElement {
	const { online, templates, loading } = useHtmlTemplates();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const isRunning = status === "running";
	const isExpanding = briefStatus === "running";

	useEffect(() => {
		if (templates.length > 0 && selectedId === null) {
			setSelectedId(templates[0]?.id ?? null);
		}
	}, [templates, selectedId]);

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
			<NativeSelect
				size="sm"
				value={selectedId ?? ""}
				disabled={loading || !online || isRunning || templates.length === 0 || disabled}
				onChange={(e) => setSelectedId(e.target.value || null)}
				aria-label={HTML_LABELS.pickTemplate}
				className="max-w-[180px]"
			>
				{templates.length === 0 ? (
					<option value="">{online ? HTML_LABELS.emptyTemplates : HTML_LABELS.offline}</option>
				) : (
					templates.map((t) => (
						<option key={t.id} value={t.id}>
							{t.emoji ? `${t.emoji} ` : ""}
							{t.enName || t.zhName || t.id}
						</option>
					))
				)}
			</NativeSelect>
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
