import { Code2, FileCode2, ScrollText, Sparkles, Zap } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	Dialog,
	DialogBody,
	DialogFooter,
	DialogHeader,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import { useHtmlGenerate } from "@/html/use-html-generate";
import { useHtmlTemplates } from "@/html/use-html-templates";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface HtmlGenerateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	planId: string;
	content: string;
	format?: string;
	workspaceId: string | null;
	onSaved?: () => void;
}

type PreviewTab = "preview" | "source" | "log";

function formatElapsed(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

export function HtmlGenerateDialog({
	open,
	onOpenChange,
	planId,
	content,
	format = "markdown",
	workspaceId,
	onSaved,
}: HtmlGenerateDialogProps): ReactElement | null {
	const { online, templates, loading } = useHtmlTemplates();
	const { status, html, error, log, startedAt, firstByteAt, doneAt, run, cancel } =
		useHtmlGenerate();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [tab, setTab] = useState<PreviewTab>("preview");
	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (status !== "running") return;
		const id = window.setInterval(() => setTick((n) => n + 1), 100);
		return () => window.clearInterval(id);
	}, [status]);

	useEffect(() => {
		if (templates.length > 0 && selectedId === null) {
			setSelectedId(templates[0]?.id ?? null);
		}
	}, [templates, selectedId]);

	const selectedTemplate = useMemo(
		() => templates.find((t) => t.id === selectedId) ?? null,
		[templates, selectedId],
	);

	if (!open) {
		return null;
	}

	void tick;
	const elapsedMs = startedAt ? (doneAt ?? Date.now()) - startedAt : null;
	const ttfbMs = startedAt && firstByteAt ? firstByteAt - startedAt : null;
	const sizeBytes = new TextEncoder().encode(html).length;

	const handleGenerate = () => {
		if (!selectedId) {
			showAppToast({ intent: "warning", message: HTML_LABELS.pickTemplate });
			return;
		}
		setTab("preview");
		void run({
			templateId: selectedId,
			content,
			format,
			planId,
		});
	};

	const handleSave = async () => {
		if (!html.trim()) {
			return;
		}
		setSaving(true);
		try {
			const result = await getRuntimeTrpcClient(workspaceId).plans.writeSibling.mutate({
				planId,
				ext: ".html",
				content: html,
			});
			if (!result.ok) {
				showAppToast({
					intent: "danger",
					message: result.error ?? "Could not save HTML plan.",
				});
				return;
			}
			showAppToast({ intent: "success", message: HTML_LABELS.saveSibling });
			onSaved?.();
			onOpenChange(false);
		} catch (err) {
			showAppToast({
				intent: "danger",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-6xl w-[95vw]">
			<DialogHeader title={HTML_LABELS.generate} icon={<FileCode2 size={15} />}>
				<div className="flex min-w-0 flex-1 items-center justify-end gap-2 px-2">
					<span
						className="hidden shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-3 px-2 py-1 text-[11px] font-medium text-text-secondary sm:inline-flex"
						title="HTML generation always runs on the Claude agent"
					>
						<Sparkles size={12} className="text-accent" aria-hidden />
						Claude
					</span>
					<NativeSelect
						size="sm"
						value={selectedId ?? ""}
						disabled={loading || !online || status === "running" || templates.length === 0}
						onChange={(e) => setSelectedId(e.target.value || null)}
						aria-label={HTML_LABELS.pickTemplate}
						className="max-w-[220px]"
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
					{status === "running" ? (
						<Button variant="ghost" size="sm" onClick={cancel}>
							Cancel
						</Button>
					) : (
						<Button
							variant="primary"
							size="sm"
							icon={<Zap size={14} />}
							disabled={!selectedId || !online || loading}
							onClick={handleGenerate}
						>
							{HTML_LABELS.convert}
						</Button>
					)}
				</div>
			</DialogHeader>
			<div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-tertiary">
				<div className="flex items-center gap-2">
					<span
						className={cn(
							"inline-block h-1.5 w-1.5 rounded-full",
							online ? "bg-status-green" : "bg-status-red",
						)}
						aria-hidden
					/>
					{online ? HTML_LABELS.online : HTML_LABELS.offlineShort}
					{selectedTemplate?.aspectHint ? (
						<span className="text-text-tertiary/80">· {selectedTemplate.aspectHint}</span>
					) : null}
				</div>
				<div>{content.length.toLocaleString()} chars</div>
			</div>
			<DialogBody className="flex min-h-[460px] gap-0 p-0">
				<div className="flex min-w-0 flex-1 flex-col border-r border-border">
					<div className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
						{HTML_LABELS.source}
					</div>
					<pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-surface-1 p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
						{content || " "}
					</pre>
				</div>
				<div className="flex min-w-0 flex-[1.2] flex-col">
					<div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
						<div className="inline-flex items-center gap-0.5 rounded-md p-0.5">
							{(
								[
									{ id: "preview" as const, label: HTML_LABELS.preview, icon: <FileCode2 size={12} /> },
									{ id: "source" as const, label: HTML_LABELS.plain, icon: <Code2 size={12} /> },
									{
										id: "log" as const,
										label: `${HTML_LABELS.log}${log.length > 0 ? ` (${log.length})` : ""}`,
										icon: <ScrollText size={12} />,
									},
								]
							).map((t) => (
								<Button
									key={t.id}
									variant="ghost"
									size="sm"
									icon={t.icon}
									aria-pressed={tab === t.id}
									className="h-6 rounded-sm text-xs"
									style={
										tab === t.id
											? {
													backgroundColor:
														"color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))",
													color: "var(--color-text-primary)",
												}
											: undefined
									}
									onClick={() => setTab(t.id)}
								>
									{t.label}
								</Button>
							))}
						</div>
						{status === "running" ? (
							<div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
								<Spinner size={12} />
								{HTML_LABELS.streaming}
							</div>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
						<span>
							{HTML_LABELS.elapsed} {elapsedMs !== null ? formatElapsed(elapsedMs) : "—"}
						</span>
						<span>
							{HTML_LABELS.ttfb} {ttfbMs !== null ? formatElapsed(ttfbMs) : "—"}
						</span>
						<span>
							{HTML_LABELS.size} {html ? formatBytes(sizeBytes) : "—"}
						</span>
					</div>
					{error ? <div className="shrink-0 px-3 py-1 text-xs text-status-red">{error}</div> : null}
					<div className="min-h-0 flex-1">
						{tab === "preview" ? (
							<iframe
								title={HTML_LABELS.preview}
								sandbox="allow-scripts"
								srcDoc={
									html ||
									"<!doctype html><html><body style='font:14px sans-serif;color:#888;padding:16px'>Preview</body></html>"
								}
								className="h-full w-full border-0 bg-white"
								data-testid="html-generate-preview"
							/>
						) : null}
						{tab === "source" ? (
							<pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-surface-1 p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
								{html || " "}
							</pre>
						) : null}
						{tab === "log" ? (
							<div className="h-full overflow-auto bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
								{log.length === 0 ? (
									<div className="text-text-tertiary">{HTML_LABELS.noLog}</div>
								) : (
									log.map((line, i) => (
										// eslint-disable-next-line react/no-array-index-key
										<div key={i} className="whitespace-pre-wrap break-words">
											{line}
										</div>
									))
								)}
							</div>
						) : null}
					</div>
				</div>
			</DialogBody>
			<DialogFooter>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						cancel();
						onOpenChange(false);
					}}
				>
					Close
				</Button>
				<Button
					variant="default"
					size="sm"
					disabled={!html.trim() || saving || status === "running"}
					onClick={() => void handleSave()}
				>
					{saving ? "Saving…" : HTML_LABELS.saveSibling}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
