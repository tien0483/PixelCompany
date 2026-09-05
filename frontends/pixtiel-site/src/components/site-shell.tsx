import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";

export function SiteShell({ children }: { children: React.ReactNode }) {
	return (
		<>
			<div id="site-nav-container">
				<Nav />
			</div>
			<main className="flex-1">{children}</main>
			<div id="site-footer-container">
				<Footer />
			</div>
		</>
	);
}
