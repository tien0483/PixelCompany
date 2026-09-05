import { listPosts } from "@/lib/content";

const SITE_TITLE = "PIXTiel";
const SITE_DESCRIPTION =
	"Engineering notes from building PIXTiel, a local multi-agent coding workspace.";
const ORIGIN = "https://pixtiel.vercel.app";

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function GET() {
	const posts = listPosts();

	const items = posts
		.map((post) => {
			const link = `${ORIGIN}/blog/${post.slug}`;
			return [
				"    <item>",
				`      <title>${escapeXml(post.frontmatter.title)}</title>`,
				`      <description>${escapeXml(post.frontmatter.description)}</description>`,
				`      <link>${escapeXml(link)}</link>`,
				`      <guid isPermaLink="false">${escapeXml(`pixtiel:blog:${post.slug}`)}</guid>`,
				`      <pubDate>${post.frontmatter.date.toUTCString()}</pubDate>`,
				`      <author>${escapeXml(post.frontmatter.author)}</author>`,
				...post.frontmatter.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
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
		`    <link>${escapeXml(ORIGIN)}</link>`,
		"    <language>en</language>",
		items,
		"  </channel>",
		"</rss>",
	].join("\n");

	return new Response(xml, {
		headers: { "Content-Type": "application/xml; charset=utf-8" },
	});
}
