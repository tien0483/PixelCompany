import { Paperclip, Sparkles } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, type ReactElement, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { ACCEPTED_TASK_IMAGE_INPUT_ACCEPT } from "@/components/task-image-input-utils";
import { HTML_LABELS } from "@/html/html-labels";
import type { HtmlStreamStatus } from "@/html/use-html-agent-stream";

/**
 * `edit` when the raw pane has a live text selection (the answer replaces it),
 * `draft` otherwise (the answer is appended below the notes).
 */
export type PlanAiPromptMode = "draft" | "edit";

export interface PlanAiPromptBarProps {
	mode: PlanAiPromptMode;
	status: HtmlStreamStatus;
	disabled?: boolean;
	error?: string | null;
	onSubmit: (instruction: string) => void;
	onCancel: () => void;
	onAttachFile: (file: File) => void;
}

/**
 * Sticky one-line prompt input under the markdown source pane. Owns only the
 * text being typed: the document splice, the streaming and the undo toast all
 * live in `PlanEditorView`, which is what actually holds the file.
 *
 * The paperclip goes through the same image pipeline as paste and drop
 * (`usePlanImagePaste` → `PlanImageButton`'s accept list), so an attachment
 * lands in the plan's own `<stem>.assets/` folder as a markdown image link
 * rather than being uploaded anywhere the exported HTML could not reach.
 */
export function PlanAiPromptBar({
	mode,
	status,
	disabled,
	error,
	onSubmit,
	onCancel,
	onAttachFile,
}: PlanAiPromptBarProps): ReactElement {
	const [value, setValue] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isRunning = status === "running";
	const isEdit = mode === "edit";
	const canSubmit = value.trim() !== "" && !isRunning && !disabled;

	const handleSubmit = () => {
		if (isRunning) {
			onCancel();
			return;
		}
		if (!canSubmit) {
			return;
		}
		const instruction = value.trim();
		setValue("");
		onSubmit(instruction);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			handleSubmit();
			return;
		}
		// The editor's own Escape closes the whole plan; while the user is typing an
		// instruction, Escape should only clear the instruction.
		if (event.key === "Escape" && value !== "") {
			event.preventDefault();
			event.stopPropagation();
			setValue("");
		}
	};

	const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (file) {
			onAttachFile(file);
		}
	};

	return (
		<div
			className="shrink-0 border-t border-border bg-surface-1 px-2 py-1.5"
			data-testid="plan-ai-prompt-bar"
			data-mode={mode}
		>
			<div className="flex items-center gap-1.5">
				<Sparkles size={14} className={cn("shrink-0", isEdit ? "text-accent" : "text-text-tertiary")} aria-hidden />
				<input
					type="text"
					value={value}
					onChange={(event) => setValue(event.currentTarget.value)}
					onKeyDown={handleKeyDown}
					placeholder={isEdit ? HTML_LABELS.aiPlaceholderSelection : HTML_LABELS.aiPlaceholder}
					disabled={disabled || isRunning}
					aria-label={isEdit ? HTML_LABELS.aiSubmitSelection : HTML_LABELS.aiSubmit}
					className="min-w-0 flex-1 rounded-full border border-border-bright bg-surface-2 px-3 py-1 text-[12.5px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-50"
					data-testid="plan-ai-prompt-input"
				/>
				<Tooltip content={HTML_LABELS.aiAttach}>
					<Button
						variant="ghost"
						size="sm"
						icon={<Paperclip size={14} />}
						aria-label={HTML_LABELS.aiAttach}
						disabled={disabled || isRunning}
						onClick={() => fileInputRef.current?.click()}
					/>
				</Tooltip>
				<input
					ref={fileInputRef}
					type="file"
					accept={ACCEPTED_TASK_IMAGE_INPUT_ACCEPT}
					className="hidden"
					onChange={handleFileChange}
				/>
				<Tooltip content={isEdit ? HTML_LABELS.aiHint : HTML_LABELS.aiSelectionHint}>
					<Button
						variant={isRunning ? "danger" : "primary"}
						size="sm"
						className="rounded-full"
						disabled={!isRunning && !canSubmit}
						onClick={handleSubmit}
						data-testid="plan-ai-prompt-submit"
					>
						{isRunning ? HTML_LABELS.aiStop : isEdit ? HTML_LABELS.aiSubmitSelection : HTML_LABELS.aiSubmit}
					</Button>
				</Tooltip>
			</div>
			{error ? <div className="mt-1 px-1 text-[11px] text-status-red">{error}</div> : null}
		</div>
	);
}
