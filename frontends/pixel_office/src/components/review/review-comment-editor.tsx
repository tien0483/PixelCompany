import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { type KeyboardEvent, type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { createPlanEditorExtensions } from "@/components/plan-editor/plan-rich-extensions";
import { captureMarkdownSerializer, getMarkdownFromEditor } from "@/components/plan-editor/plan-rich-markdown";
import { ReviewCommentToolbar } from "@/components/review/review-comment-toolbar";

export interface ReviewCommentEditorProps {
	/** Markdown the composer holds. Read once on mount; see the note on syncing below. */
	markdown: string;
	onChange: (markdown: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}

/**
 * The rich half of the review comment composer: TipTap in, markdown out.
 *
 * Reuses the plan editor's extension set and markdown bridge — a review note and a
 * plan are both GitLab-flavoured markdown, and a second serializer would be a second
 * thing to keep in step. It does *not* use `toEditorMarkdown`/`fromEditorMarkdown`,
 * which rewrite plan asset URLs against a plan id that does not exist here.
 *
 * Content is seeded on mount and never synced back down: the parent's markdown is
 * only ever changed by this editor or by a mode switch, and a mode switch remounts.
 * That keeps the caret out of the fight a two-way markdown sync would start.
 *
 * Default-exported so the composer can `lazy()` it — TipTap is a large chunk, and a
 * reviewer who stays in plain text should never download it.
 */
export default function ReviewCommentEditor({
	markdown,
	onChange,
	onSubmit,
	onCancel,
}: ReviewCommentEditorProps): ReactElement {
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const readMarkdownRef = useRef<(() => string) | null>(null);
	const [bridgeError, setBridgeError] = useState<Error | null>(null);
	/** Seeded once: `markdown` is deliberately not a dependency of the editor. */
	const initialMarkdownRef = useRef(markdown);

	const readMarkdown = useCallback((instance: Editor): string => {
		if (readMarkdownRef.current) {
			return readMarkdownRef.current();
		}
		return getMarkdownFromEditor(instance);
	}, []);

	const editor = useEditor({
		extensions: createPlanEditorExtensions(),
		content: initialMarkdownRef.current,
		autofocus: "end",
		onUpdate: ({ editor: updatedEditor }) => {
			try {
				onChangeRef.current(readMarkdown(updatedEditor));
			} catch (error) {
				setBridgeError(
					error instanceof Error ? error : new Error("Rich editor failed while serializing markdown."),
				);
			}
		},
		onDestroy: () => {
			readMarkdownRef.current = null;
		},
	});

	useEffect(() => {
		if (!editor) {
			return;
		}
		try {
			readMarkdownRef.current = captureMarkdownSerializer(editor);
			setBridgeError(null);
		} catch (error) {
			readMarkdownRef.current = null;
			setBridgeError(
				error instanceof Error
					? error
					: new Error("Rich editor failed to initialize markdown serialization."),
			);
		}
	}, [editor]);

	// Thrown for the composer's error boundary, which falls back to the plain textarea.
	if (bridgeError) {
		throw bridgeError;
	}

	if (!editor) {
		return (
			<div className="px-2 py-3 text-[11px] text-text-tertiary" data-testid="review-comment-editor-loading">
				Starting rich editor…
			</div>
		);
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		// The chords live on the wrapper because TipTap owns the keymap inside the
		// contenteditable; by the time the event bubbles here ProseMirror is done with it.
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			onSubmit();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
		}
	};

	return (
		<div
			className="overflow-hidden rounded border border-border bg-surface-0 focus-within:border-border-focus"
			data-testid="review-comment-editor"
			onKeyDown={handleKeyDown}
		>
			<ReviewCommentToolbar editor={editor} />
			<div className="kb-markdown kb-prose max-h-64 min-h-16 overflow-y-auto px-2 py-1.5 text-xs">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}
