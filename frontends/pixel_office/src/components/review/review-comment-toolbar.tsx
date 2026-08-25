import type { Editor } from "@tiptap/react";
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * The formatting strip above the review comment editor.
 *
 * Deliberately shorter than the plan editor's: a review note is a paragraph, so
 * headings, colours, highlights and images are noise here. GitLab's own strip also
 * offers a table and an attachment button, which would need `@tiptap/extension-table`
 * and an upload endpoint that this app does not have.
 */
export function ReviewCommentToolbar({
	editor,
	disabled,
}: {
	editor: Editor;
	disabled?: boolean;
}): ReactElement {
	const [, setTick] = useState(0);

	// TipTap mutates the editor in place, so active-mark state changes without a React
	// update — the same subscription the plan toolbar uses.
	useEffect(() => {
		const refresh = () => setTick((value) => value + 1);
		editor.on("selectionUpdate", refresh);
		editor.on("transaction", refresh);
		return () => {
			editor.off("selectionUpdate", refresh);
			editor.off("transaction", refresh);
		};
	}, [editor]);

	const setLink = (): void => {
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
		<div
			className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-surface-2 px-1 py-0.5"
			data-testid="review-comment-toolbar"
		>
			<ToolbarButton
				icon={<Bold size={13} />}
				label="Bold"
				disabled={disabled}
				active={editor.isActive("bold")}
				onClick={() => editor.chain().focus().toggleBold().run()}
			/>
			<ToolbarButton
				icon={<Italic size={13} />}
				label="Italic"
				disabled={disabled}
				active={editor.isActive("italic")}
				onClick={() => editor.chain().focus().toggleItalic().run()}
			/>
			<ToolbarButton
				icon={<Strikethrough size={13} />}
				label="Strikethrough"
				disabled={disabled}
				active={editor.isActive("strike")}
				onClick={() => editor.chain().focus().toggleStrike().run()}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<Quote size={13} />}
				label="Quote"
				disabled={disabled}
				active={editor.isActive("blockquote")}
				onClick={() => editor.chain().focus().toggleBlockquote().run()}
			/>
			<ToolbarButton
				icon={<Code size={13} />}
				label="Code"
				disabled={disabled}
				active={editor.isActive("code")}
				onClick={() => editor.chain().focus().toggleCode().run()}
			/>
			<ToolbarButton
				icon={<Link2 size={13} />}
				label="Link"
				disabled={disabled}
				active={editor.isActive("link")}
				onClick={setLink}
			/>
			<div className="mx-1 h-4 w-px bg-border" />
			<ToolbarButton
				icon={<List size={13} />}
				label="Bullet list"
				disabled={disabled}
				active={editor.isActive("bulletList")}
				onClick={() => editor.chain().focus().toggleBulletList().run()}
			/>
			<ToolbarButton
				icon={<ListOrdered size={13} />}
				label="Numbered list"
				disabled={disabled}
				active={editor.isActive("orderedList")}
				onClick={() => editor.chain().focus().toggleOrderedList().run()}
			/>
		</div>
	);
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
