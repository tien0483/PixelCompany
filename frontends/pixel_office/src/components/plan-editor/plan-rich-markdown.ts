import type { Editor } from "@tiptap/react";

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

type MarkdownStorageSlot = {
	getMarkdown: () => string;
	serializer?: { serialize: (doc: unknown) => string };
};

export class PlanMarkdownStorageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlanMarkdownStorageError";
	}
}

function isRelativeAssetPath(src: string): boolean {
	return !/^([a-z][a-z0-9+.-]*:|\/)/i.test(src);
}

export function resolvePlanAssetUrl(
	planId: string | null,
	src: string | undefined,
): string | undefined {
	if (!src || !planId || !isRelativeAssetPath(src)) {
		return src;
	}
	return `/api/plans/asset?planId=${encodeURIComponent(planId)}&path=${encodeURIComponent(src)}`;
}

function readMarkdownStorage(editor: Editor): MarkdownStorageSlot {
	const markdown = (
		editor.storage as unknown as { markdown?: MarkdownStorageSlot | undefined }
	).markdown;
	if (!markdown || typeof markdown.getMarkdown !== "function") {
		throw new PlanMarkdownStorageError(
			"tiptap-markdown storage is missing getMarkdown. Rich mode cannot serialize this editor.",
		);
	}
	return markdown;
}

/** `tiptap-markdown` doesn't ship a `Storage` module augmentation, so read its slot explicitly. */
export function getMarkdownFromEditor(editor: Editor): string {
	return readMarkdownStorage(editor).getMarkdown();
}

/**
 * Capture a stable serializer callback from the markdown storage slot.
 * Prefer this over re-reading `editor.storage.markdown` on every keystroke.
 */
export function captureMarkdownSerializer(editor: Editor): () => string {
	const slot = readMarkdownStorage(editor);
	if (slot.serializer && typeof slot.serializer.serialize === "function") {
		const { serializer } = slot;
		return () => serializer.serialize(editor.state.doc);
	}
	return () => slot.getMarkdown();
}

/** Rewrite `![alt](relative/path.png)` to the `/api/plans/asset` URL so TipTap's Image node can load it. */
export function toEditorMarkdown(
	markdown: string,
	planId: string | null,
): string {
	if (!planId) {
		return markdown;
	}
	return markdown.replaceAll(
		MARKDOWN_IMAGE_PATTERN,
		(match, alt: string, src: string) => {
			const resolved = resolvePlanAssetUrl(planId, src);
			return resolved && resolved !== src ? `![${alt}](${resolved})` : match;
		},
	);
}

/** Reverse of {@link toEditorMarkdown} — restores the relative asset path before saving. */
export function fromEditorMarkdown(
	markdown: string,
	planId: string | null,
): string {
	if (!planId) {
		return markdown;
	}
	const prefix = `/api/plans/asset?planId=${encodeURIComponent(planId)}&path=`;
	return markdown.replaceAll(
		MARKDOWN_IMAGE_PATTERN,
		(match, alt: string, src: string) => {
			if (!src.startsWith(prefix)) {
				return match;
			}
			const relativePath = decodeURIComponent(src.slice(prefix.length));
			return `![${alt}](${relativePath})`;
		},
	);
}

/** Insert a markdown image at the current selection, rewriting relative asset paths for TipTap. */
export function insertMarkdownImage(
	editor: Editor,
	markdown: string,
	planId: string | null,
): void {
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
