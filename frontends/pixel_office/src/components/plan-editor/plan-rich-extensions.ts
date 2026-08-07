import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import type { Mark } from "@tiptap/pm/model";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

/**
 * `tiptap-markdown` only ships serializers for StarterKit's built-in marks, so
 * Highlight/Color fall through to its generic HTML-fallback serializer, which
 * extracts open/close tags from a rendered fragment and isn't rank-aware
 * across overlapping marks — it can misplace tags relative to the actual mark
 * range. Register explicit serializers so the saved markdown is exact.
 */
const PlanHighlight = Highlight.extend({
	addStorage() {
		return {
			markdown: {
				serialize: {
					open: "<mark>",
					close: "</mark>",
					mixable: true,
					expelEnclosingWhitespace: true,
				},
			},
		};
	},
});

/**
 * `@tiptap/extension-color` doesn't add its own mark type — it adds a `color`
 * attribute onto the `textStyle` mark, so the serializer lives here and is a
 * no-op when no color is set.
 */
const PlanTextStyle = TextStyle.extend({
	addStorage() {
		return {
			markdown: {
				serialize: {
					open: (_state: unknown, mark: Mark) =>
						mark.attrs.color ? `<span style="color: ${mark.attrs.color}">` : "",
					close: (_state: unknown, mark: Mark) => (mark.attrs.color ? "</span>" : ""),
					mixable: true,
					expelEnclosingWhitespace: true,
				},
			},
		};
	},
});

/** Exact TipTap extension list used by the plan rich editor. */
export function createPlanEditorExtensions(): Extensions {
	return [
		StarterKit.configure({ link: false }),
		PlanTextStyle,
		Color,
		PlanHighlight,
		Link.configure({ openOnClick: false }),
		Image.configure({ inline: false }),
		Markdown.configure({ html: true, transformPastedText: true }),
	];
}
