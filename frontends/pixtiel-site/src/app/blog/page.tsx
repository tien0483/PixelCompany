import Link from "next/link";
import type { Metadata } from "next";
import { listPosts } from "@/lib/content";

export const metadata: Metadata = {
	title: "Blog",
	description:
		"Engineering notes from building PIXTiel: worktree isolation, seat management, token cost and the traps found along the way.",
};

const dateFormat = new Intl.DateTimeFormat("en", {
	year: "numeric",
	month: "long",
	day: "numeric",
});

export default function BlogIndexPage() {
	const posts = listPosts();
	const [featured, ...rest] = posts;

	return (
		<>
			<section className="border-b border-border">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
					<p className="text-xs font-mono uppercase tracking-widest text-accent mb-4">Blog</p>
					<h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-text-primary">
						Engineering notes
					</h1>
					<p className="mt-5 text-base sm:text-lg text-text-secondary max-w-2xl leading-relaxed">
						How PIXTiel is built and why it is built that way — the decisions, the measurements, and the
						traps that only show up once agents run in parallel on real repositories.
					</p>
					<Link
						href="/rss.xml"
						className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono text-text-secondary hover:text-text-primary transition-colors"
					>
						<svg
							className="w-3.5 h-3.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M4 11a9 9 0 0 1 9 9"></path>
							<path d="M4 4a16 16 0 0 1 16 16"></path>
							<circle cx="5" cy="19" r="1"></circle>
						</svg>
						RSS
					</Link>
				</div>
			</section>

			<div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
				{posts.length === 0 ? (
					<p className="text-sm text-text-secondary">No posts yet.</p>
				) : (
					<div className="space-y-10">
						{featured ? (
							<Link
								href={`/blog/${featured.slug}`}
								className="block group rounded-2xl border border-border bg-surface-1 p-6 sm:p-8 hover:border-border-bright transition-colors"
							>
								<div className="flex flex-wrap items-center gap-3 text-xs font-mono text-text-secondary">
									<time dateTime={featured.frontmatter.date.toISOString()}>
										{dateFormat.format(featured.frontmatter.date)}
									</time>
									{featured.frontmatter.tags.map((tag) => (
										<span key={tag} className="px-2 py-0.5 rounded border border-border bg-surface-0">
											{tag}
										</span>
									))}
								</div>
								<h2 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-text-primary group-hover:text-white transition-colors">
									{featured.frontmatter.title}
								</h2>
								<p className="mt-3 text-sm sm:text-base text-text-secondary leading-relaxed">
									{featured.frontmatter.description}
								</p>
								<span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
									Read the post
									<svg
										className="w-4 h-4"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
									>
										<line x1="5" y1="12" x2="19" y2="12"></line>
										<polyline points="12 5 19 12 12 19"></polyline>
									</svg>
								</span>
							</Link>
						) : null}

						{rest.length > 0 ? (
							<div className="divide-y divide-border border-t border-border">
								{rest.map((post) => (
									<Link
										key={post.slug}
										href={`/blog/${post.slug}`}
										className="block group py-7 hover:bg-surface-1/30 transition-colors -mx-4 px-4 rounded-lg"
									>
										<div className="flex flex-wrap items-center gap-3 text-xs font-mono text-text-secondary">
											<time dateTime={post.frontmatter.date.toISOString()}>
												{dateFormat.format(post.frontmatter.date)}
											</time>
											{post.frontmatter.tags.map((tag) => (
												<span
													key={tag}
													className="px-2 py-0.5 rounded border border-border bg-surface-0"
												>
													{tag}
												</span>
											))}
										</div>
										<h3 className="mt-2.5 text-lg sm:text-xl font-semibold text-text-primary group-hover:text-white transition-colors">
											{post.frontmatter.title}
										</h3>
										<p className="mt-2 text-sm text-text-secondary leading-relaxed">
											{post.frontmatter.description}
										</p>
									</Link>
								))}
							</div>
						) : null}
					</div>
				)}
			</div>
		</>
	);
}
