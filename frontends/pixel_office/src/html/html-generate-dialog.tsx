import { FileCode2 } from "lucide-react";
import { type ReactElement, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogFooter,
	DialogHeader,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import { TemplatePicker } from "@/html/template-picker";
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
	const { status, html, error, run, cancel } = useHtmlGenerate();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	if (!open) {
		return null;
	}

	const handleGenerate = () => {
		if (!selectedId) {
			showAppToast({ intent: "warning", message: HTML_LABELS.pickTemplate });
			return;
		}
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
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-5xl w-[95vw]">
			<DialogHeader title={HTML_LABELS.generate} />
			<DialogBody className="flex min-h-[420px] gap-3">
				<div className="flex w-[280px] shrink-0 flex-col gap-2 border-r border-border pr-3">
					<div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
						{HTML_LABELS.pickTemplate}
					</div>
					{loading ? (
						<div className="flex flex-1 items-center justify-center">
							<Spinner size={18} />
						</div>
					) : (
						<TemplatePicker
							templates={templates}
							selectedId={selectedId}
							onSelect={setSelectedId}
							online={online}
							disabled={status === "running"}
						/>
					)}
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					{status === "running" ? (
						<div className="flex items-center gap-2 text-sm text-text-secondary">
							<Spinner size={14} />
							{HTML_LABELS.streaming}
						</div>
					) : null}
					{error ? <div className="text-sm text-status-red">{error}</div> : null}
					<iframe
						title={HTML_LABELS.preview}
						sandbox="allow-scripts"
						srcDoc={html || "<!doctype html><html><body style='font:14px sans-serif;color:#888;padding:16px'>Preview</body></html>"}
						className="min-h-0 flex-1 w-full rounded-md border border-border bg-white"
						data-testid="html-generate-preview"
					/>
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
				{status === "running" ? (
					<Button variant="ghost" size="sm" onClick={cancel}>
						Cancel
					</Button>
				) : (
					<Button
						variant="primary"
						size="sm"
						icon={<FileCode2 size={14} />}
						disabled={!selectedId || !online}
						onClick={handleGenerate}
					>
						{HTML_LABELS.generate}
					</Button>
				)}
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
