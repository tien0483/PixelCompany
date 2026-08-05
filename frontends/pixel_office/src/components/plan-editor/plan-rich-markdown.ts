import type { Editor } from "@tiptap/react";

import { resolvePlanAssetUrl } from "@/components/plan-editor/plan-markdown-preview";

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** `tiptap-markdown` doesn't ship a `Storage` module augmentation, so read its slot explicitly. */
export function getMarkdownFromEditor(editor: Editor): string {
	return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
}

/** Rewrite `![alt](relative/path.png)` to the `/api/plans/asset` URL so TipTap's Image node can load it. */
export function toEditorMarkdown(markdown: string, planId: string | null): string {
	if (!planId) {
		return markdown;
	}
	return markdown.replaceAll(MARKDOWN_IMAGE_PATTERN, (match, alt: string, src: string) => {
		const resolved = resolvePlanAssetUrl(planId, src);
		return resolved && resolved !== src ? `![${alt}](${resolved})` : match;
	});
}

/** Reverse of {@link toEditorMarkdown} — restores the relative asset path before saving. */
export function fromEditorMarkdown(markdown: string, planId: string | null): string {
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

/** Insert a markdown image at the current selection, rewriting relative asset paths for TipTap. */
export function insertMarkdownImage(editor: Editor, markdown: string, planId: string | null): void {
	const match = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(markdown);
	if (!match) {
		editor.chain().focus().insertContent(markdown).run();
		return;
	}
	const alt = match[1] ?? "";
	const src = match[2] ?? "";
	const resolved = planId ? (resolvePlanAssetUrl(planId, src) ?? src) : src;
	editor.chain().focus().setImage({ src: resolved, alt }).run();
}
