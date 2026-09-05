import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const CONTENT_ROOT = path.join(process.cwd(), "src/content");

export type DocFrontmatter = {
	title: string;
	description?: string;
	order: number;
};

export type BlogFrontmatter = {
	title: string;
	description: string;
	date: Date;
	author: string;
	tags: string[];
	draft: boolean;
};

export type DocEntry = {
	slug: string;
	frontmatter: DocFrontmatter;
	content: string;
};

export type BlogEntry = {
	slug: string;
	frontmatter: BlogFrontmatter;
	content: string;
};

function listMdxFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
		.map((f) => path.join(dir, f));
}

function slugFromFile(filePath: string): string {
	return path.basename(filePath).replace(/\.mdx?$/, "");
}

function parseDoc(filePath: string): DocEntry {
	const raw = fs.readFileSync(filePath, "utf8");
	const { data, content } = matter(raw);
	return {
		slug: slugFromFile(filePath),
		frontmatter: {
			title: String(data.title ?? ""),
			description: data.description ? String(data.description) : undefined,
			order: typeof data.order === "number" ? data.order : 99,
		},
		content,
	};
}

function parsePost(filePath: string): BlogEntry {
	const raw = fs.readFileSync(filePath, "utf8");
	const { data, content } = matter(raw);
	const date = data.date instanceof Date ? data.date : new Date(String(data.date ?? ""));
	return {
		slug: slugFromFile(filePath),
		frontmatter: {
			title: String(data.title ?? ""),
			description: String(data.description ?? ""),
			date,
			author: String(data.author ?? "Tiến Nguyễn"),
			tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
			draft: Boolean(data.draft ?? false),
		},
		content,
	};
}

export function listDocs(): DocEntry[] {
	return listMdxFiles(path.join(CONTENT_ROOT, "docs"))
		.map(parseDoc)
		.sort((a, b) => a.frontmatter.order - b.frontmatter.order);
}

export function getDoc(slug: string): DocEntry | null {
	const docs = listDocs();
	return docs.find((d) => d.slug === slug) ?? null;
}

export function listPosts(includeDrafts = false): BlogEntry[] {
	return listMdxFiles(path.join(CONTENT_ROOT, "blog"))
		.map(parsePost)
		.filter((p) => includeDrafts || !p.frontmatter.draft)
		.sort((a, b) => b.frontmatter.date.valueOf() - a.frontmatter.date.valueOf());
}

export function getPost(slug: string): BlogEntry | null {
	const fileMd = path.join(CONTENT_ROOT, "blog", `${slug}.md`);
	const fileMdx = path.join(CONTENT_ROOT, "blog", `${slug}.mdx`);
	const filePath = fs.existsSync(fileMdx) ? fileMdx : fs.existsSync(fileMd) ? fileMd : null;
	if (!filePath) return null;
	return parsePost(filePath);
}
