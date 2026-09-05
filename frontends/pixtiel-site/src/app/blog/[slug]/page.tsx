import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getPost, listPosts } from "@/lib/content";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
	return listPosts(true).map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	const post = getPost(slug);
	if (!post) return {};
	return {
		title: post.frontmatter.title,
		description: post.frontmatter.description,
	};
}

const dateFormat = new Intl.DateTimeFormat("en", {
	year: "numeric",
	month: "long",
	day: "numeric",
});

export default async function BlogPostPage({ params }: Props) {
	const { slug } = await params;
	const entry = getPost(slug);
	if (!entry) notFound();

	const published = listPosts();
	const index = published.findIndex((p) => p.slug === slug);
	const newer = index > 0 ? published[index - 1] : null;
	const older = index >= 0 && index < published.length - 1 ? published[index + 1] : null;

	return (
		<article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
			<div className="flex items-center gap-2 text-xs font-mono text-text-secondary mb-8">
				<Link href="/" className="hover:text-text-primary transition-colors">
					Home
				</Link>
				<span>/</span>
				<Link href="/blog" className="hover:text-text-primary transition-colors">
					Blog
				</Link>
			</div>

			<header className="pb-8 border-b border-border">
				<div className="flex flex-wrap items-center gap-3 text-xs font-mono text-text-secondary">
					<time dateTime={entry.frontmatter.date.toISOString()}>
						{dateFormat.format(entry.frontmatter.date)}
					</time>
					<span>·</span>
					<span>{entry.frontmatter.author}</span>
					{entry.frontmatter.tags.map((tag) => (
						<span key={tag} className="px-2 py-0.5 rounded border border-border bg-surface-1">
							{tag}
						</span>
					))}
					{entry.frontmatter.draft ? (
						<span className="px-2 py-0.5 rounded bg-accent/15 text-accent">draft</span>
					) : null}
				</div>
				<h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-text-primary leading-tight">
					{entry.frontmatter.title}
				</h1>
				<p className="mt-4 text-base sm:text-lg text-text-secondary leading-relaxed">
					{entry.frontmatter.description}
				</p>
			</header>

			<div className="docs-content text-text-secondary leading-relaxed mt-10">
				<MDXRemote source={entry.content} />
			</div>

			<div className="mt-16 pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
				{older ? (
					<Link
						href={`/blog/${older.slug}`}
						className="p-4 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors group flex flex-col items-start"
					>
						<span className="text-xs text-text-secondary group-hover:text-accent transition-colors">
							&larr; Older
						</span>
						<span className="text-sm font-semibold text-text-primary mt-1">
							{older.frontmatter.title}
						</span>
					</Link>
				) : (
					<div />
				)}
				{newer ? (
					<Link
						href={`/blog/${newer.slug}`}
						className="p-4 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors group flex flex-col items-end sm:text-right"
					>
						<span className="text-xs text-text-secondary group-hover:text-accent transition-colors">
							Newer &rarr;
						</span>
						<span className="text-sm font-semibold text-text-primary mt-1">
							{newer.frontmatter.title}
						</span>
					</Link>
				) : (
					<div />
				)}
			</div>

			<div className="mt-10 p-6 rounded-2xl border border-border bg-surface-1">
				<h2 className="text-lg font-semibold text-text-primary">Run it yourself</h2>
				<p className="mt-2 text-sm text-text-secondary">
					One command installs PIXTiel on Ubuntu or WSL2 and offers to start it.
				</p>
				<pre className="mt-4 px-4 py-3 rounded-lg border border-border bg-surface-0 text-xs font-mono text-text-primary overflow-x-auto">
					<code>
						curl -fsSL https://raw.githubusercontent.com/tien0483/PixelCompany/main/install.sh | bash
					</code>
				</pre>
				<Link
					href="/docs/getting-started"
					className="mt-4 inline-block text-sm font-semibold text-accent hover:text-[#339DFF]"
				>
					Getting started &rarr;
				</Link>
			</div>
		</article>
	);
}
