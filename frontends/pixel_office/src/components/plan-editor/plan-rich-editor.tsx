import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import {
	type ClipboardEvent,
	type DragEvent,
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { createPlanEditorExtensions } from "@/components/plan-editor/plan-rich-extensions";
import {
	captureMarkdownSerializer,
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
}: PlanRichEditorProps): ReactElement {
	/** Markdown most recently emitted via onUpdate — lets the sync effect skip its own echo. */
	const lastEmittedMarkdownRef = useRef<string | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const readMarkdownRef = useRef<(() => string) | null>(null);
	const [bridgeError, setBridgeError] = useState<Error | null>(null);

	const readMarkdown = useCallback((editorInstance: Editor): string => {
		if (readMarkdownRef.current) {
			return readMarkdownRef.current();
		}
		return getMarkdownFromEditor(editorInstance);
	}, []);

	const editor = useEditor(
		{
			extensions: createPlanEditorExtensions(),
			content: toEditorMarkdown(content, planId),
			editable: !disabled,
			onUpdate: ({ editor: updatedEditor }) => {
				try {
					const markdown = fromEditorMarkdown(readMarkdown(updatedEditor), planId);
					lastEmittedMarkdownRef.current = markdown;
					onChangeRef.current(markdown);
				} catch (error) {
					setBridgeError(
						error instanceof Error
							? error
							: new Error("Rich editor failed while serializing markdown."),
					);
				}
			},
			onDestroy: () => {
				readMarkdownRef.current = null;
			},
		},
		[planId],
	);

	useEffect(() => {
		if (!editor) {
			return;
		}
		lastEmittedMarkdownRef.current = null;
		try {
			readMarkdownRef.current = captureMarkdownSerializer(editor);
			setBridgeError(null);
		} catch (error) {
			readMarkdownRef.current = null;
			setBridgeError(
				error instanceof Error
					? error
					: new Error(
							"Rich editor failed to initialize markdown serialization.",
						),
			);
		}
	}, [editor]);

	useEffect(() => {
		onEditorReady?.(editor ?? null);
		return () => {
			onEditorReady?.(null);
		};
	}, [editor, onEditorReady]);

	useEffect(() => {
		if (!editor || bridgeError) {
			return;
		}
		if (lastEmittedMarkdownRef.current === content) {
			// This content update is just our own onUpdate echoing back through the parent
			// (e.g. autosave round-trip) — nothing external changed, skip the sync.
			return;
		}
		try {
			const currentMarkdown = fromEditorMarkdown(readMarkdown(editor), planId);
			if (currentMarkdown !== content) {
				// External load / plain→rich handoff — replace content without emitting onUpdate.
				// This resets History, which is intentional for non-local changes.
				editor.commands.setContent(toEditorMarkdown(content, planId), {
					emitUpdate: false,
				});
			}
		} catch (error) {
			setBridgeError(
				error instanceof Error
					? error
					: new Error("Rich editor failed while syncing markdown content."),
			);
		}
	}, [bridgeError, content, editor, planId, readMarkdown]);

	useEffect(() => {
		// `setEditable` emits `update` unless told not to, and TipTap serializes whatever
		// the doc holds at that moment — on mount that is still the empty doc, which the
		// parent would then autosave over the real plan file. Toggling editability is not
		// a content change, so it must never emit.
		editor?.setEditable(!disabled, false);
	}, [disabled, editor]);

	const handleInsertImageFile = useCallback(
		(file: File) => {
			onInsertImage(file);
		},
		[onInsertImage],
	);

	if (bridgeError) {
		throw bridgeError;
	}

	if (!editor) {
		return (
			<div
				className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-3 text-sm text-text-secondary"
				data-testid="plan-rich-editor-loading"
			>
				Starting rich editor…
			</div>
		);
	}

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			data-testid="plan-rich-editor"
			onPaste={onPaste}
			onDrop={onDrop}
			onDragOver={onDragOver}
		>
			<PlanRichToolbar
				editor={editor}
				disabled={disabled}
				onInsertImage={handleInsertImageFile}
			/>
			<div className="kb-markdown kb-prose min-h-0 flex-1 overflow-y-auto px-3 py-2">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}
