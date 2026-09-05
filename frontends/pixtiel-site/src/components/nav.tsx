"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemePicker } from "@/components/theme-picker";
import { cn } from "@/lib/utils";

const links = [
	{ href: "/products", label: "Products", match: /^\/products/ },
	{ href: "/docs/getting-started", label: "Docs", match: /^\/docs/ },
	{ href: "/blog", label: "Blog", match: /^\/blog/ },
];

export function Nav({ className }: { className?: string }) {
	const pathname = usePathname() ?? "/";

	return (
		<nav
			className={cn(
				"w-full border-b border-border bg-surface-0/80 backdrop-blur-md sticky top-0 z-50",
				className,
			)}
		>
			<div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
				<Link
					href="/"
					className="flex items-center gap-2.5 text-text-primary hover:opacity-80 transition-opacity group"
				>
					<img src="/pixtiel-logo.svg" alt="PIXTiel" className="h-8 w-auto" />
				</Link>

				<div className="flex items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium text-text-secondary">
					{links.map((link) => {
						const active = link.match.test(pathname);
						return (
							<Link
								key={link.href}
								href={link.href}
								aria-current={active ? "page" : undefined}
								className={cn(
									"transition-colors",
									active ? "text-text-primary" : "hover:text-text-primary",
								)}
							>
								{link.label}
							</Link>
						);
					})}
					<a href="/#install" className="hidden sm:inline-block hover:text-text-primary transition-colors">
						Install
					</a>
					<a
						href="https://github.com/tien0483/PixelCompany"
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-text-primary transition-colors inline-flex items-center gap-1"
					>
						GitHub
						<svg
							className="w-3.5 h-3.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
							<polyline points="15 3 21 3 21 9"></polyline>
							<line x1="10" y1="14" x2="21" y2="3"></line>
						</svg>
					</a>
					<ThemePicker />
				</div>
			</div>
		</nav>
	);
}
