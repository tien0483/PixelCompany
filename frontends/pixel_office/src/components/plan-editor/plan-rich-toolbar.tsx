import * as RadixPopover from "@radix-ui/react-popover";
import type { Editor } from "@tiptap/react";
import {
	Bold,
	Code,
	Heading1,
	Heading2,
	Highlighter,
	ImagePlus,
	Italic,
	Link2,
	List,
	ListOrdered,
	Palette,
	Quote,
	Redo2,
	Strikethrough,
	Undo2,
} from "lucide-react";
import { type ChangeEvent, type ReactElement, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";

const COLOR_SWATCHES: ReadonlyArray<{ label: string; value: string }> = [
	{ label: "Red", value: "#F85149" },
	{ label: "Orange", value: "#D29922" },
	{ label: "Gold", value: "#D4A72C" },
	{ label: "Green", value: "#3FB950" },
	{ label: "Blue", value: "#4C9AFF" },
	{ label: "Purple", value: "#A371F7" },
];

const ACCEPTED_IMAGE_INPUT_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

export interface PlanRichToolbarProps {
	editor: Editor;
	disabled?: boolean;
	onInsertImage: (file: File) => void;
}

function ToolbarButton({
	icon,
	label,
	onClick,
	disabled,
	active,
}: {
	icon: ReactElement;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	active?: boolean;
}): ReactElement {
	return (
		<Tooltip content={label}>
			<Button
				variant="ghost"
				size="sm"
				icon={icon}
				aria-label={label}
				aria-pressed={active}
				onClick={onClick}
				disabled={disabled}
				className={cn(active ? "bg-surface-3 text-text-primary" : undefined)}
			/>
		</Tooltip>
	);
}

export function PlanRichToolbar({ editor, disabled, onInsertImage }: PlanRichToolbarProps): ReactElement {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isColorOpen, setIsColorOpen] = useState(false);
	const [, setTick] = useState(0);

	useEffect(() => {
		const refresh = () => setTick((value) => value + 1);
		editor.on("selectionUpdate", refresh);
		editor.on("transaction", refresh);
		return () => {
			editor.off("selectionUpdate", refresh);
			editor.off("transaction", refresh);
		};
	}, [editor]);

	const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (file) {
			onInsertImage(file);
		}
	};

	const setLink = () => {
		const previous = editor.getAttributes("link").href as string | undefined;
		const url = window.prompt("URL", previous ?? "https://");
		if (url === null) {
			return;
		}
		if (url.trim() === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
	};

	return (
		<div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-2 px-2 py-1" data-testid="plan-rich-toolbar">
			<ToolbarButton
				icon={<Undo2 size={14} />}
				label="Undo"
				disabled={disabled || !editor.can().undo()}
				onClick={() => editor.chain().focus().undo().run()}
			/>
			<ToolbarButton
				icon={<Redo2 size={14} />}
				label="Redo"
				disabled={disabled || !editor.can().redo()}
				onClick={() => editor.chain().focus().redo().run()}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<Bold size={14} />}
				label="Bold"
				disabled={disabled}
				active={editor.isActive("bold")}
				onClick={() => editor.chain().focus().toggleBold().run()}
			/>
			<ToolbarButton
				icon={<Italic size={14} />}
				label="Italic"
				disabled={disabled}
				active={editor.isActive("italic")}
				onClick={() => editor.chain().focus().toggleItalic().run()}
			/>
			<ToolbarButton
				icon={<Strikethrough size={14} />}
				label="Strikethrough"
				disabled={disabled}
				active={editor.isActive("strike")}
				onClick={() => editor.chain().focus().toggleStrike().run()}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<Quote size={14} />}
				label="Blockquote"
				disabled={disabled}
				active={editor.isActive("blockquote")}
				onClick={() => editor.chain().focus().toggleBlockquote().run()}
			/>
			<ToolbarButton
				icon={<Code size={14} />}
				label="Inline code"
				disabled={disabled}
				active={editor.isActive("code")}
				onClick={() => editor.chain().focus().toggleCode().run()}
			/>
			<ToolbarButton
				icon={<Link2 size={14} />}
				label="Link"
				disabled={disabled}
				active={editor.isActive("link")}
				onClick={setLink}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<Heading1 size={14} />}
				label="Heading 1"
				disabled={disabled}
				active={editor.isActive("heading", { level: 1 })}
				onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
			/>
			<ToolbarButton
				icon={<Heading2 size={14} />}
				label="Heading 2"
				disabled={disabled}
				active={editor.isActive("heading", { level: 2 })}
				onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<List size={14} />}
				label="Bullet list"
				disabled={disabled}
				active={editor.isActive("bulletList")}
				onClick={() => editor.chain().focus().toggleBulletList().run()}
			/>
			<ToolbarButton
				icon={<ListOrdered size={14} />}
				label="Numbered list"
				disabled={disabled}
				active={editor.isActive("orderedList")}
				onClick={() => editor.chain().focus().toggleOrderedList().run()}
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
										editor.chain().focus().setColor(swatch.value).run();
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
				active={editor.isActive("highlight")}
				onClick={() => editor.chain().focus().toggleHighlight().run()}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<ImagePlus size={14} />}
				label="Insert image"
				disabled={disabled}
				onClick={() => fileInputRef.current?.click()}
			/>
			<input
				ref={fileInputRef}
				type="file"
				accept={ACCEPTED_IMAGE_INPUT_ACCEPT}
				className="hidden"
				onChange={handleFileChange}
			/>
		</div>
	);
}
