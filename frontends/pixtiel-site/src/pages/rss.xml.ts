import { getCollection } from "astro:content";
import type { APIRoute } from "astro";

const SITE_TITLE = "PIXTiel";
const SITE_DESCRIPTION = "Engineering notes from building PIXTiel, a local multi-agent coding workspace.";

/** Minimal XML text escaping — enough for titles, descriptions and URLs. */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export const GET: APIRoute = async ({ site }) => {
	// `site` is unset when astro.config has no `site` — fall back to a relative feed.
	const origin = site ? site.origin : "";
	const base = import.meta.env.BASE_URL.replace(/\/$/, "");
	const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
		(a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
	);

	const items = posts
		.map((post) => {
			const slug = post.id.replace(/\.mdx?$/, "");
			const link = `${origin}${base}/blog/${slug}`;
			return [
				"    <item>",
				`      <title>${escapeXml(post.data.title)}</title>`,
				`      <description>${escapeXml(post.data.description)}</description>`,
				`      <link>${escapeXml(link)}</link>`,
				`      <guid isPermaLink="false">${escapeXml(`pixtiel:blog:${slug}`)}</guid>`,
				`      <pubDate>${post.data.date.toUTCString()}</pubDate>`,
				`      <author>${escapeXml(post.data.author)}</author>`,
				...post.data.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
				"    </item>",
			].join("\n");
		})
		.join("\n");

	const xml = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0">',
		"  <channel>",
		`    <title>${escapeXml(SITE_TITLE)}</title>`,
		`    <description>${escapeXml(SITE_DESCRIPTION)}</description>`,
		`    <link>${escapeXml(origin ? `${origin}${base || "/"}` : "/")}</link>`,
		"    <language>en</language>",
		items,
		"  </channel>",
		"</rss>",
	].join("\n");

	return new Response(xml, {
		headers: { "Content-Type": "application/xml; charset=utf-8" },
	});
};
