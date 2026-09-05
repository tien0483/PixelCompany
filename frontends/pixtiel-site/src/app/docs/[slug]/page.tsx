import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getDoc, listDocs } from "@/lib/content";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
	return listDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	const doc = getDoc(slug);
	if (!doc) return {};
	return {
		title: doc.frontmatter.title,
		description: doc.frontmatter.description,
	};
}

export default async function DocPage({ params }: Props) {
	const { slug } = await params;
	const allDocs = listDocs();
	const entry = getDoc(slug);
	if (!entry) notFound();

	const currentIndex = allDocs.findIndex((d) => d.slug === slug);
	const prevDoc = currentIndex > 0 ? allDocs[currentIndex - 1] : null;
	const nextDoc = currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : null;

	return (
		<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 docs-layout-container">
			<div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
				<aside className="w-full lg:w-64 shrink-0">
					<div className="sticky top-24 space-y-6 docs-sidebar-sticky">
						<div>
							<h5 className="text-xs font-mono uppercase tracking-wider text-text-secondary px-3 mb-3 font-semibold">
								Documentation
							</h5>
							<nav className="space-y-1">
								{allDocs.map((doc) => {
									const isActive = doc.slug === slug;
									return (
										<Link
											key={doc.slug}
											href={`/docs/${doc.slug}`}
											className={`flex items-center px-3 py-2 text-sm rounded-lg transition-colors font-medium ${
												isActive
													? "bg-surface-2 text-text-primary font-semibold border-l-2 border-accent border-y border-r border-border shadow-xs"
													: "text-text-secondary hover:text-text-primary hover:bg-surface-1 border border-transparent"
											}`}
										>
											<span>{doc.frontmatter.title}</span>
										</Link>
									);
								})}
							</nav>
						</div>

						<div className="p-4 rounded-xl border border-border bg-surface-1 text-xs text-text-secondary space-y-2">
							<div className="font-semibold text-text-primary flex items-center gap-1.5">
								<svg
									className="w-4 h-4 text-accent"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<circle cx="12" cy="12" r="10"></circle>
									<line x1="12" y1="16" x2="12" y2="12"></line>
									<line x1="12" y1="8" x2="12.01" y2="8"></line>
								</svg>
								<span>Open Source</span>
							</div>
							<p>Need help or want to contribute? Check our repository on GitHub.</p>
							<a
								href="https://github.com/tien0483/PixelCompany"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-block text-accent hover:text-accent-hover font-medium"
							>
								View Repository &rarr;
							</a>
						</div>
					</div>
				</aside>

				<main className="min-w-0 flex-1 max-w-4xl">
					<div className="flex items-center gap-2 text-xs font-mono text-text-secondary mb-6">
						<Link href="/" className="hover:text-text-primary transition-colors">
							Home
						</Link>
						<span>/</span>
						<Link href="/docs/getting-started" className="hover:text-text-primary transition-colors">
							Docs
						</Link>
						<span>/</span>
						<span className="text-text-primary">{entry.frontmatter.title}</span>
					</div>

					<article className="docs-content text-text-primary leading-relaxed">
						<MDXRemote source={entry.content} />
					</article>

					<div className="mt-16 pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
						{prevDoc ? (
							<Link
								href={`/docs/${prevDoc.slug}`}
								className="p-4 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors group flex flex-col items-start"
							>
								<span className="text-xs text-text-secondary group-hover:text-accent transition-colors">
									&larr; Previous
								</span>
								<span className="text-sm font-semibold text-text-primary mt-1">
									{prevDoc.frontmatter.title}
								</span>
							</Link>
						) : (
							<div />
						)}

						{nextDoc ? (
							<Link
								href={`/docs/${nextDoc.slug}`}
								className="p-4 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors group flex flex-col items-end sm:text-right"
							>
								<span className="text-xs text-text-secondary group-hover:text-accent transition-colors">
									Next &rarr;
								</span>
								<span className="text-sm font-semibold text-text-primary mt-1">
									{nextDoc.frontmatter.title}
								</span>
							</Link>
						) : (
							<div />
						)}
					</div>
				</main>
			</div>
		</div>
	);
}
