import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ReactElement, useEffect, useRef } from "react";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";

import { resolvePlanAssetUrl } from "@/components/plan-editor/plan-markdown-preview";

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** `tiptap-markdown` doesn't ship a `Storage` module augmentation, so read its slot explicitly. */
function getMarkdownFromEditor(editor: Editor): string {
	return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown();
}

/** Rewrite `![alt](relative/path.png)` to the `/api/plans/asset` URL so TipTap's Image node can load it. */
function toEditorMarkdown(markdown: string, planId: string | null): string {
	if (!planId) {
		return markdown;
	}
	return markdown.replaceAll(MARKDOWN_IMAGE_PATTERN, (match, alt: string, src: string) => {
		const resolved = resolvePlanAssetUrl(planId, src);
		return resolved && resolved !== src ? `![${alt}](${resolved})` : match;
	});
}

/** Reverse of {@link toEditorMarkdown} — restores the relative asset path before saving. */
function fromEditorMarkdown(markdown: string, planId: string | null): string {
	if (!planId) {
		return markdown;
	}
	const prefix = `/api/plans/asset?planId=${encodeURIComponent(planId)}&path=`;
	return markdown.replaceAll(MARKDOWN_IMAGE_PATTERN, (match, alt: string, src: string) => {
		if (!src.startsWith(prefix)) {
			return match;
		}
		const relativePath = decodeURIComponent(src.slice(prefix.length));
		return `![${alt}](${relativePath})`;
	});
}

export interface PlanRichEditorProps {
	content: string;
	onChange: (markdown: string) => void;
	planId: string | null;
	disabled?: boolean;
}

export default function PlanRichEditor({ content, onChange, planId, disabled }: PlanRichEditorProps): ReactElement | null {
	const skipNextSyncRef = useRef(false);

	const editor = useEditor({
		extensions: [
			StarterKit,
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
			onChange(fromEditorMarkdown(markdown, planId));
		},
	});

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
			editor.commands.setContent(toEditorMarkdown(content, planId), { emitUpdate: false });
		}
	}, [content, editor, planId]);

	useEffect(() => {
		editor?.setEditable(!disabled);
	}, [disabled, editor]);

	if (!editor) {
		return null;
	}

	return (
		<div className="kb-markdown min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="plan-rich-editor">
			<EditorContent editor={editor} />
		</div>
	);
}
