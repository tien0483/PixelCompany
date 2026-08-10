import { PanelLeftClose, PanelLeftOpen, Upload } from "lucide-react";
import { type ReactElement, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import type { HtmlTemplateMeta } from "@/html/use-html-templates";

/**
 * The thumbnail is the template's own `example.html`, rendered live at desktop width
 * and scaled down — the sidecar ships no images. Route goes through the runtime's
 * catch-all sidecar proxy, which both the full server and the standalone package mount.
 */
const THUMBNAIL_SCALE = 0.22;
const THUMBNAIL_HEIGHT_PX = 96;

function previewSrc(templateId: string): string {
	return `/api/html-proxy/api/templates/${encodeURIComponent(templateId)}/preview`;
}

function TemplateThumbnail({ template }: { template: HtmlTemplateMeta }): ReactElement {
	if (!template.example?.hasHtml) {
		return (
			<div
				className="flex items-center justify-center bg-surface-2 text-2xl"
				style={{ height: `${THUMBNAIL_HEIGHT_PX}px` }}
			>
				<span aria-hidden>{template.emoji || "🗒"}</span>
				<span className="sr-only">{HTML_LABELS.noPreview}</span>
			</div>
		);
	}
	return (
		<div className="relative overflow-hidden bg-white" style={{ height: `${THUMBNAIL_HEIGHT_PX}px` }}>
			<iframe
				title={`${template.enName || template.id} preview`}
				src={previewSrc(template.id)}
				sandbox=""
				loading="lazy"
				tabIndex={-1}
				className="pointer-events-none absolute left-0 top-0 border-0"
				style={{
					transform: `scale(${THUMBNAIL_SCALE})`,
					transformOrigin: "top left",
					width: `${100 / THUMBNAIL_SCALE}%`,
					height: `${THUMBNAIL_HEIGHT_PX / THUMBNAIL_SCALE}px`,
				}}
			/>
		</div>
	);
}

export interface PlanTemplateRailProps {
	templates: HtmlTemplateMeta[];
	selectedId: string | null;
	online: boolean;
	loading: boolean;
	/** True while HTML is streaming, or when the pane is showing generated HTML. */
	disabled: boolean;
	collapsed: boolean;
	widthPx: number;
	/** True while an imported zip is being installed. */
	importing: boolean;
	onSelect: (templateId: string) => void;
	onToggleCollapsed: () => void;
	onImport: (file: File) => void;
}

/**
 * Left "open pane" of template cards, each with a live thumbnail — replaces the
 * dropdown that used to sit in the generate bar, where a template could only be told
 * apart from its neighbours by name.
 */
export function PlanTemplateRail({
	templates,
	selectedId,
	online,
	loading,
	disabled,
	collapsed,
	widthPx,
	importing,
	onSelect,
	onToggleCollapsed,
	onImport,
}: PlanTemplateRailProps): ReactElement {
	const fileInputRef = useRef<HTMLInputElement>(null);

	if (collapsed) {
		return (
			<div
				className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-1 py-1"
				data-testid="plan-template-rail"
				data-collapsed="true"
			>
				<Button
					variant="ghost"
					size="sm"
					icon={<PanelLeftOpen size={14} />}
					aria-label={HTML_LABELS.expandTemplates}
					title={HTML_LABELS.expandTemplates}
					onClick={onToggleCollapsed}
				/>
			</div>
		);
	}

	const body = (): ReactElement => {
		if (loading) {
			return (
				<div className="flex flex-col gap-2 p-2">
					<div className="kb-skeleton h-24 w-full" />
					<div className="kb-skeleton h-24 w-full" />
				</div>
			);
		}
		if (templates.length === 0) {
			return (
				<div className="px-3 py-4 text-center text-[11px] text-text-tertiary">
					{online ? HTML_LABELS.emptyTemplates : HTML_LABELS.offlineHint}
				</div>
			);
		}
		return (
			<div className="flex flex-col gap-2 p-2">
				{templates.map((template) => {
					const isSelected = template.id === selectedId;
					return (
						<button
							key={template.id}
							type="button"
							disabled={disabled}
							aria-pressed={isSelected}
							onClick={() => onSelect(template.id)}
							title={template.description || template.enName || template.id}
							className={cn(
								"flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border bg-surface-2 p-0 text-left transition-colors",
								"hover:border-border-bright disabled:cursor-not-allowed disabled:opacity-50",
								isSelected ? "border-accent bg-surface-3" : "border-border",
							)}
							data-testid={`plan-template-card-${template.id}`}
						>
							<TemplateThumbnail template={template} />
							<span className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
								<span className="truncate text-[11px] font-medium text-text-primary">
									{template.emoji ? `${template.emoji} ` : ""}
									{template.enName || template.zhName || template.id}
								</span>
								{template.aspectHint ? (
									<span className="truncate text-[10px] text-text-tertiary">{template.aspectHint}</span>
								) : null}
							</span>
						</button>
					);
				})}
			</div>
		);
	};

	return (
		<div
			className="flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-surface-1"
			style={{ width: `${widthPx}px` }}
			data-testid="plan-template-rail"
			data-collapsed="false"
		>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-2 py-1">
				<span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
					{HTML_LABELS.templates}
				</span>
				<div className="flex shrink-0 items-center gap-0.5">
					{/*
					 * The picker is disk-backed — a template is a folder under
					 * `agent-data/templates/skills/` — so importing one is an upload, not a marketplace
					 * fetch. The zip carries SKILL.md plus its example pair.
					 */}
					<input
						ref={fileInputRef}
						type="file"
						accept=".zip,application/zip"
						className="hidden"
						data-testid="plan-template-import-input"
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							// Reset first: picking the same file twice in a row must still fire `change`.
							event.currentTarget.value = "";
							if (file) {
								onImport(file);
							}
						}}
					/>
					<Button
						variant="ghost"
						size="sm"
						icon={importing ? <Spinner size={13} /> : <Upload size={14} />}
						disabled={importing || !online}
						aria-label={HTML_LABELS.importTemplate}
						title={online ? HTML_LABELS.importTemplateHint : HTML_LABELS.offlineHint}
						onClick={() => fileInputRef.current?.click()}
						data-testid="plan-template-import"
					/>
					<Button
						variant="ghost"
						size="sm"
						icon={<PanelLeftClose size={14} />}
						aria-label={HTML_LABELS.collapseTemplates}
						title={HTML_LABELS.collapseTemplates}
						onClick={onToggleCollapsed}
					/>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">{body()}</div>
		</div>
	);
}
