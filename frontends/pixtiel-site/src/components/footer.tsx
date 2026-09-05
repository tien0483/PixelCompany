import Link from "next/link";
import { cn } from "@/lib/utils";

export function Footer({ className }: { className?: string }) {
	return (
		<footer
			className={cn(
				"w-full border-t border-border bg-surface-0 py-12 text-text-secondary",
				className,
			)}
		>
			<div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2.5 text-text-primary">
						<img src="/pixtiel-logo.svg" alt="PIXTiel" className="h-7 w-auto" />
					</div>
					<p className="text-xs text-text-tertiary max-w-sm">
						Multi-agent coordination and workspace runtime for autonomous software engineering.
					</p>
					<p className="text-xs text-text-tertiary">Distributed under the MIT License.</p>
				</div>

				<div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 sm:gap-8 text-sm">
					<Link href="/products" className="hover:text-text-primary transition-colors">
						Products
					</Link>
					<Link href="/docs/getting-started" className="hover:text-text-primary transition-colors">
						Docs
					</Link>
					<Link href="/blog" className="hover:text-text-primary transition-colors">
						Blog
					</Link>
					<a href="/#install" className="hover:text-text-primary transition-colors">
						Install
					</a>
					<Link href="/rss.xml" className="hover:text-text-primary transition-colors">
						RSS
					</Link>
					<a
						href="https://github.com/tien0483/PixelCompany"
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-text-primary transition-colors"
					>
						GitHub
					</a>
				</div>
			</div>

			<div className="max-w-6xl mx-auto px-4 sm:px-6 mt-8 pt-6 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between text-xs text-text-tertiary gap-4">
				<span>&copy; 2026 Tiến Nguyễn. All rights reserved.</span>
				<span>Built with Next.js &amp; Tailwind CSS</span>
			</div>
		</footer>
	);
}
