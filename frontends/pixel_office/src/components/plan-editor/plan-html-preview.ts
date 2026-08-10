/**
 * A `srcDoc` iframe resolves relative URLs against `about:srcdoc`, so every
 * `<img src="notes.assets/shot.png">` in a plan's HTML fails to load in the preview even
 * though the file is right next to it on disk. Injecting a `<base>` pointed at the
 * runtime's per-plan file route fixes the preview without touching the saved bytes —
 * the file keeps its relative links and stays portable when opened directly.
 */
export function planPreviewBaseHref(planId: string): string {
	return `/api/plans/${encodeURIComponent(planId)}/file/`;
}

const HEAD_OPEN_PATTERN = /<head\b[^>]*>/i;
const HTML_OPEN_PATTERN = /<html\b[^>]*>/i;

export function withPreviewBase(html: string, planId: string | null): string {
	if (!planId || html.trim() === "") {
		return html;
	}
	// Respect a document that already declares its own base rather than fighting it.
	if (/<base\b/i.test(html)) {
		return html;
	}
	const baseTag = `<base href="${planPreviewBaseHref(planId)}">`;
	const head = HEAD_OPEN_PATTERN.exec(html);
	if (head?.index !== undefined) {
		const insertAt = head.index + head[0].length;
		return `${html.slice(0, insertAt)}${baseTag}${html.slice(insertAt)}`;
	}
	const htmlOpen = HTML_OPEN_PATTERN.exec(html);
	if (htmlOpen?.index !== undefined) {
		const insertAt = htmlOpen.index + htmlOpen[0].length;
		return `${html.slice(0, insertAt)}<head>${baseTag}</head>${html.slice(insertAt)}`;
	}
	return `${baseTag}${html}`;
}
