import { EditorContent, useEditor } from "@tiptap/react";
import { type ReactElement, useEffect } from "react";

import { createPlanEditorExtensions } from "@/components/plan-editor/plan-rich-extensions";
import { toEditorMarkdown } from "@/components/plan-editor/plan-rich-markdown";
import { Spinner } from "@/components/ui/spinner";

export interface PlanRichPreviewProps {
	content: string;
	planId: string | null;
}

/**
 * Read-only mirror of `PlanRichEditor` — same extensions/parser, so preview
 * can never drift from what rich-mode editing shows (unlike the prior
 * react-markdown preview, which re-parsed the saved markdown with a
 * differently-configured parser).
 */
export default function PlanRichPreview({ content, planId }: PlanRichPreviewProps): ReactElement {
	const editor = useEditor(
		{
			extensions: createPlanEditorExtensions(),
			content: toEditorMarkdown(content, planId),
			editable: false,
		},
		[planId],
	);

	useEffect(() => {
		if (!editor) {
			return;
		}
		const nextContent = toEditorMarkdown(content, planId);
		editor.commands.setContent(nextContent, { emitUpdate: false });
	}, [content, editor, planId]);

	if (!editor) {
		return (
			<div
				className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-3 text-sm text-text-secondary"
				data-testid="plan-rich-preview-loading"
			>
				<Spinner size={20} />
			</div>
		);
	}

	return (
		<div className="kb-markdown min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-2" data-testid="plan-rich-preview">
			<EditorContent editor={editor} />
		</div>
	);
}
