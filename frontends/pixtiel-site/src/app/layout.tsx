import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { ThemeScript } from "@/components/theme-script";
import "@/styles/global.css";
import "@/styles/prose.css";

const siteUrl = "https://pixtiel.vercel.app";

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: {
		default: "PIXTiel",
		template: "%s · PIXTiel",
	},
	description: "Autonomous agent workspace & multi-agent coordination platform.",
	openGraph: {
		type: "website",
		title: "PIXTiel",
		description: "Autonomous agent workspace & multi-agent coordination platform.",
		images: ["/screenshots/board-hero.png"],
	},
	twitter: {
		card: "summary_large_image",
		title: "PIXTiel",
		description: "Autonomous agent workspace & multi-agent coordination platform.",
		images: ["/screenshots/board-hero.png"],
	},
	icons: {
		icon: "/favicon.svg",
	},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<ThemeScript />
			</head>
			<body className="min-h-screen flex flex-col bg-surface-0 text-text-primary antialiased">
				<SiteShell>{children}</SiteShell>
			</body>
		</html>
	);
}
