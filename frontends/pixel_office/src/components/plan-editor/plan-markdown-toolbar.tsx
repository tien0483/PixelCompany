import * as RadixPopover from "@radix-ui/react-popover";
import {
	Bold,
	Code,
	Heading1,
	Heading2,
	Highlighter,
	Italic,
	Link2,
	List,
	ListOrdered,
	Palette,
	Strikethrough,
} from "lucide-react";
import { type ReactElement, useState } from "react";

import type { TextSelectionState } from "@/components/plan-editor/markdown-selection-commands";
import { togglePrefix, toggleWrap } from "@/components/plan-editor/markdown-selection-commands";
import { PlanImageButton } from "@/components/plan-editor/plan-image-button";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

const COLOR_SWATCHES: ReadonlyArray<{ label: string; value: string }> = [
	{ label: "Red", value: "#F85149" },
	{ label: "Orange", value: "#D29922" },
	{ label: "Gold", value: "#D4A72C" },
	{ label: "Green", value: "#3FB950" },
	{ label: "Blue", value: "#4C9AFF" },
	{ label: "Purple", value: "#A371F7" },
];

export interface PlanMarkdownToolbarProps {
	disabled?: boolean;
	onCommand: (transform: (state: TextSelectionState) => TextSelectionState) => void;
	onInsertImage: (file: File) => void;
}

function ToolbarButton({
	icon,
	label,
	onClick,
	disabled,
}: {
	icon: ReactElement;
	label: string;
	onClick: () => void;
	disabled?: boolean;
}): ReactElement {
	return (
		<Tooltip content={label}>
			<Button variant="ghost" size="sm" icon={icon} aria-label={label} onClick={onClick} disabled={disabled} />
		</Tooltip>
	);
}

export function PlanMarkdownToolbar({ disabled, onCommand, onInsertImage }: PlanMarkdownToolbarProps): ReactElement {
	const [isColorOpen, setIsColorOpen] = useState(false);

	return (
		<div className="flex items-center gap-0.5 border-b border-border bg-surface-2 px-2 py-1">
			<ToolbarButton
				icon={<Bold size={14} />}
				label="Bold"
				disabled={disabled}
				onClick={() => onCommand((s) => toggleWrap(s, "**"))}
			/>
			<ToolbarButton
				icon={<Italic size={14} />}
				label="Italic"
				disabled={disabled}
				onClick={() => onCommand((s) => toggleWrap(s, "*"))}
			/>
			<ToolbarButton
				icon={<Strikethrough size={14} />}
				label="Strikethrough"
				disabled={disabled}
				onClick={() => onCommand((s) => toggleWrap(s, "~~"))}
			/>
			<ToolbarButton
				icon={<Code size={14} />}
				label="Inline code"
				disabled={disabled}
				onClick={() => onCommand((s) => toggleWrap(s, "`"))}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<Heading1 size={14} />}
				label="Heading 1"
				disabled={disabled}
				onClick={() => onCommand((s) => togglePrefix(s, "# "))}
			/>
			<ToolbarButton
				icon={<Heading2 size={14} />}
				label="Heading 2"
				disabled={disabled}
				onClick={() => onCommand((s) => togglePrefix(s, "## "))}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<List size={14} />}
				label="Bullet list"
				disabled={disabled}
				onClick={() => onCommand((s) => togglePrefix(s, "- "))}
			/>
			<ToolbarButton
				icon={<ListOrdered size={14} />}
				label="Numbered list"
				disabled={disabled}
				onClick={() => onCommand((s) => togglePrefix(s, "1. "))}
			/>
			<ToolbarButton
				icon={<Link2 size={14} />}
				label="Link"
				disabled={disabled}
				onClick={() => onCommand((s) => toggleWrap(s, "[", "](https://)"))}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<RadixPopover.Root open={isColorOpen} onOpenChange={setIsColorOpen}>
				<RadixPopover.Trigger asChild>
					<Button
						variant="ghost"
						size="sm"
						icon={<Palette size={14} />}
						aria-label="Text color"
						disabled={disabled}
					/>
				</RadixPopover.Trigger>
				<RadixPopover.Portal>
					<RadixPopover.Content
						className="z-50 rounded-lg border border-border bg-surface-2 p-2 shadow-xl"
						style={{ animation: "kb-tooltip-show 100ms ease" }}
						sideOffset={5}
						align="start"
					>
						<div className="flex gap-1.5">
							{COLOR_SWATCHES.map((swatch) => (
								<button
									key={swatch.value}
									type="button"
									aria-label={swatch.label}
									title={swatch.label}
									className="h-6 w-6 rounded-full border border-border-bright cursor-pointer"
									style={{ backgroundColor: swatch.value }}
									onClick={() => {
										onCommand((s) => toggleWrap(s, `<span style="color:${swatch.value}">`, "</span>"));
										setIsColorOpen(false);
									}}
								/>
							))}
						</div>
					</RadixPopover.Content>
				</RadixPopover.Portal>
			</RadixPopover.Root>
			<ToolbarButton
				icon={<Highlighter size={14} />}
				label="Highlight"
				disabled={disabled}
				onClick={() => onCommand((s) => toggleWrap(s, "<mark>", "</mark>"))}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<PlanImageButton disabled={disabled} onSelectFile={onInsertImage} />
		</div>
	);
}
