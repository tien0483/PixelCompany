import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

/** Exact TipTap extension list used by the plan rich editor. */
export function createPlanEditorExtensions(): Extensions {
	return [
		StarterKit.configure({ link: false }),
		TextStyle,
		Color,
		Highlight,
		Link.configure({ openOnClick: false }),
		Image.configure({ inline: false }),
		Markdown.configure({ html: true, transformPastedText: true }),
	];
}
