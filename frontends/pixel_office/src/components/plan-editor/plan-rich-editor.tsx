import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	type ClipboardEvent,
	type DragEvent,
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { Markdown } from "tiptap-markdown";

import {
	fromEditorMarkdown,
	getMarkdownFromEditor,
	toEditorMarkdown,
} from "@/components/plan-editor/plan-rich-markdown";
import { PlanRichToolbar } from "@/components/plan-editor/plan-rich-toolbar";

export interface PlanRichEditorProps {
	content: string;
	onChange: (markdown: string) => void;
	planId: string | null;
	disabled?: boolean;
	onInsertImage: (file: File) => void;
	onPaste?: (event: ClipboardEvent) => void;
	onDrop?: (event: DragEvent) => void;
	onDragOver?: (event: DragEvent) => void;
	/** Called when the TipTap editor instance is ready (and cleared on destroy). */
	onEditorReady?: (editor: Editor | null) => void;
}

export default function PlanRichEditor({
	content,
	onChange,
	planId,
	disabled,
	onInsertImage,
	onPaste,
	onDrop,
	onDragOver,
	onEditorReady,
}: PlanRichEditorProps): ReactElement | null {
	const skipNextSyncRef = useRef(false);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const editor = useEditor(
		{
			extensions: [
				StarterKit.configure({ link: false }),
				TextStyle,
				Color,
				Highlight,
				Link.configure({ openOnClick: false }),
				Image.configure({ inline: false }),
				Markdown.configure({ html: true, transformPastedText: true }),
			],
			content: toEditorMarkdown(content, planId),
			editable: !disabled,
			onUpdate: ({ editor: updatedEditor }) => {
				skipNextSyncRef.current = true;
				const markdown = getMarkdownFromEditor(updatedEditor);
				onChangeRef.current(fromEditorMarkdown(markdown, planId));
			},
		},
		[planId],
	);

	useEffect(() => {
		onEditorReady?.(editor ?? null);
		return () => {
			onEditorReady?.(null);
		};
	}, [editor, onEditorReady]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		if (skipNextSyncRef.current) {
			skipNextSyncRef.current = false;
			return;
		}
		const currentMarkdown = fromEditorMarkdown(getMarkdownFromEditor(editor), planId);
		if (currentMarkdown !== content) {
			// External load / plain→rich handoff — replace content without emitting onUpdate.
			// This resets History, which is intentional for non-local changes.
			editor.commands.setContent(toEditorMarkdown(content, planId), { emitUpdate: false });
		}
	}, [content, editor, planId]);

	useEffect(() => {
		editor?.setEditable(!disabled);
	}, [disabled, editor]);

	const handleInsertImageFile = useCallback(
		(file: File) => {
			onInsertImage(file);
		},
		[onInsertImage],
	);

	if (!editor) {
		return null;
	}

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			data-testid="plan-rich-editor"
			onPaste={onPaste}
			onDrop={onDrop}
			onDragOver={onDragOver}
		>
			<PlanRichToolbar editor={editor} disabled={disabled} onInsertImage={handleInsertImageFile} />
			<div className="kb-markdown min-h-0 flex-1 overflow-y-auto px-3 py-2">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}
