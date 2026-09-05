import type { Metadata } from "next";
import Link from "next/link";
import { ScreenshotFrame } from "@/components/screenshot-frame";
import { TerminalMockup } from "@/components/terminal-mockup";
import { listPosts } from "@/lib/content";

export const metadata: Metadata = {
	title: "Autonomous Agent Workspace",
	description:
		"PIXTiel is a Kanban board where Claude, Cursor, Cline and Antigravity agents pick up cards, work in isolated git worktrees, and hand back reviewable merge requests.",
};

const dateFormat = new Intl.DateTimeFormat("en", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

export default function HomePage() {
	const posts = listPosts().slice(0, 3);

	return (
		<>
			<section className="relative pt-20 pb-24 md:pt-28 md:pb-32 px-4 sm:px-6 max-w-6xl mx-auto text-center flex flex-col items-center">
				<div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-medium bg-surface-1 border border-border text-text-secondary mb-8 shadow-sm">
					<span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
					<span>Next-Generation Autonomous Engineering Workspace</span>
				</div>

				<h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-text-primary max-w-4xl leading-[1.1] mb-6">
					Your AI engineering office, on one board.
				</h1>

				<p className="text-lg sm:text-xl text-text-secondary max-w-3xl leading-relaxed mb-10">
					PIXTiel is a Kanban board where Claude, Cursor, Cline and Antigravity agents pick up cards, work
					in isolated git worktrees, and hand back reviewable merge requests — with multi-account seat
					management built in.
				</p>

				<div className="flex flex-wrap items-center justify-center gap-4 mb-16">
					<a
						href="#install"
						className="px-7 py-3.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-semibold text-base shadow-lg shadow-accent/20 transition-all duration-150 transform hover:-translate-y-0.5"
					>
						Install PIXTiel
					</a>
					<Link
						href="/products"
						className="px-7 py-3.5 rounded-lg bg-surface-1 hover:bg-surface-2 border border-border text-text-primary font-semibold text-base transition-colors"
					>
						Explore the products
					</Link>
					<Link
						href="/docs/getting-started"
						className="px-7 py-3.5 rounded-lg text-text-secondary hover:text-text-primary font-semibold text-base transition-colors"
					>
						Read the docs &rarr;
					</Link>
				</div>

				<div className="w-full max-w-5xl mx-auto">
					<ScreenshotFrame
						id="slot-hero-board"
						src="/screenshots/board-hero.png"
						alt="PIXTiel Multi-Agent Kanban Board"
						title="PIXTiel Kanban Board — Multi-Agent Workspace"
						aspectRatio="aspect-16/10"
						loading="eager"
					/>
				</div>
			</section>

			<section className="border-y border-border bg-surface-1 py-12 px-4 sm:px-6">
				<div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
					<div className="flex flex-col items-center">
						<div className="text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight mb-1">3+</div>
						<div className="text-xs sm:text-sm font-medium text-text-secondary">Agent CLIs supported</div>
					</div>
					<div className="flex flex-col items-center">
						<div className="text-3xl sm:text-4xl font-extrabold text-status-green tracking-tight mb-1">
							Multi-seat
						</div>
						<div className="text-xs sm:text-sm font-medium text-text-secondary">
							Claude seats managed with auto-failover
						</div>
					</div>
					<div className="flex flex-col items-center">
						<div className="text-3xl sm:text-4xl font-extrabold text-accent tracking-tight mb-1">6</div>
						<div className="text-xs sm:text-sm font-medium text-text-secondary">Services in the stack</div>
					</div>
					<div className="flex flex-col items-center">
						<div className="text-3xl sm:text-4xl font-extrabold text-status-purple tracking-tight mb-1">0</div>
						<div className="text-xs sm:text-sm font-medium text-text-secondary">
							Cloud dependencies — runs on your machine
						</div>
					</div>
				</div>
			</section>

			<section className="py-24 px-4 sm:px-6 max-w-6xl mx-auto" id="why-pixtiel">
				<div className="text-center max-w-3xl mx-auto mb-16">
					<h2 className="text-xs font-mono uppercase tracking-widest text-accent mb-3">
						Architected for Autonomy
					</h2>
					<h3 className="text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight">
						Built for serious multi-agent engineering
					</h3>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
					<div className="p-8 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors">
						<div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent mb-5">
							<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
								<circle cx="9" cy="7" r="4"></circle>
								<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
								<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
							</svg>
						</div>
						<h4 className="text-xl font-bold text-text-primary mb-2">Seats that never idle</h4>
						<p className="text-sm text-text-secondary leading-relaxed">
							Multi-account management, usage-aware swapping, and auto-failover keep agents working without
							hitting the 5-hour rate limit wall. Subagent seats bill separately to protect your primary
							OAuth quota.
						</p>
					</div>

					<div className="p-8 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors">
						<div className="w-10 h-10 rounded-lg bg-status-green/10 border border-status-green/30 flex items-center justify-center text-status-green mb-5">
							<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<line x1="6" y1="3" x2="6" y2="15"></line>
								<circle cx="18" cy="6" r="3"></circle>
								<circle cx="6" cy="18" r="3"></circle>
								<path d="M18 9a9 9 0 0 1-9 9"></path>
							</svg>
						</div>
						<h4 className="text-xl font-bold text-text-primary mb-2">Every task in its own worktree</h4>
						<p className="text-sm text-text-secondary leading-relaxed">
							Isolated git branches, pinned base refs, and clean merges mean 3–4 agents work concurrently
							without overwriting each other. Workspace state survives supervisor restarts.
						</p>
					</div>

					<div className="p-8 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors">
						<div className="w-10 h-10 rounded-lg bg-status-purple/10 border border-status-purple/30 flex items-center justify-center text-status-purple mb-5">
							<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<circle cx="18" cy="18" r="3"></circle>
								<circle cx="6" cy="6" r="3"></circle>
								<path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
								<line x1="6" y1="9" x2="6" y2="21"></line>
							</svg>
						</div>
						<h4 className="text-xl font-bold text-text-primary mb-2">Review before it lands</h4>
						<p className="text-sm text-text-secondary leading-relaxed">
							GitLab-style MR diffs, inline comments piped back to agents as scoped work, and blast-radius
							impact analysis from codebase knowledge graphs ensure quality before merge.
						</p>
					</div>

					<div className="p-8 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors">
						<div className="w-10 h-10 rounded-lg bg-status-orange/10 border border-status-orange/30 flex items-center justify-center text-status-orange mb-5">
							<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<circle cx="12" cy="12" r="10"></circle>
								<path d="M12 6v6l4 2"></path>
							</svg>
						</div>
						<h4 className="text-xl font-bold text-text-primary mb-2">Tokens are a budget</h4>
						<p className="text-sm text-text-secondary leading-relaxed">
							Built-in RTK shell compression, headroom proxy routing, and local knowledge graphs cut token
							spend up to 88.9%. Run larger batches without ballooning API costs.
						</p>
					</div>
				</div>
			</section>

			<section className="py-24 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border" id="features">
				<div className="text-center max-w-3xl mx-auto mb-20">
					<h2 className="text-xs font-mono uppercase tracking-widest text-accent mb-3">Feature Suite</h2>
					<h3 className="text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight">
						End-to-end control from plan to merge
					</h3>
				</div>

				<div className="space-y-24">
					<div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
						<div className="lg:col-span-5 space-y-4">
							<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-accent/10 text-accent text-xs font-semibold">
								01 · Execution
							</div>
							<h4 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">
								Board + task agents
							</h4>
							<p className="text-sm sm:text-base text-text-secondary leading-relaxed">
								Visual kanban cards dispatch isolated background agents in dedicated git worktrees with
								full terminal and lifecycle tracking. Dependency chaining and locked base refs guarantee
								reproducible execution across parallel tasks.
							</p>
						</div>
						<div className="lg:col-span-7">
							<ScreenshotFrame
								id="slot-feature-board"
								src="/screenshots/board-feature.png"
								alt="Board and Task Agents"
								title="Board & Sandboxed Task Agents"
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
						<div className="lg:col-span-7 order-2 lg:order-1">
							<ScreenshotFrame
								id="slot-feature-plan-editor"
								src="/screenshots/plan-editor.png"
								alt="Interactive Plan Editor"
								title="Interactive Plan Editor"
							/>
						</div>
						<div className="lg:col-span-5 space-y-4 order-1 lg:order-2">
							<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-status-green/10 text-status-green text-xs font-semibold">
								02 · Architecture
							</div>
							<h4 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">
								Plan editor
							</h4>
							<p className="text-sm sm:text-base text-text-secondary leading-relaxed">
								Rich interactive HTML planning interface with live preview, revision history, and
								AI-assisted diff refinement. Split architectural plans into per-agent sub-plans before a
								single line of code is written.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
						<div className="lg:col-span-5 space-y-4">
							<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-status-purple/10 text-status-purple text-xs font-semibold">
								03 · Quality Gate
							</div>
							<h4 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">
								Review tab
							</h4>
							<p className="text-sm sm:text-base text-text-secondary leading-relaxed">
								Full branch diff viewer modeled on GitLab merge requests with inline hunk commenting and
								instant push-to-remote. Line comments route directly back to the responsible agent
								session as targeted revision instructions.
							</p>
						</div>
						<div className="lg:col-span-7">
							<ScreenshotFrame
								id="slot-feature-review-tab"
								src="/screenshots/review-tab.png"
								alt="GitLab-Style Review Diff Viewer"
								title="GitLab-Style Review Diff Viewer"
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
						<div className="lg:col-span-7 order-2 lg:order-1">
							<ScreenshotFrame
								id="slot-feature-agent-studio"
								src="/screenshots/agent-studio.png"
								alt="Flowise Agent Studio"
								title="Flowise Agent Studio"
							/>
						</div>
						<div className="lg:col-span-5 space-y-4 order-1 lg:order-2">
							<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-status-orange/10 text-status-orange text-xs font-semibold">
								04 · Custom Pipelines
							</div>
							<h4 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">
								Agent Studio (Flowise)
							</h4>
							<p className="text-sm sm:text-base text-text-secondary leading-relaxed">
								Visual drag-and-drop workflow canvas for wiring custom multi-agent chains, LLM nodes, and
								tool integrations. Seamlessly binds custom visual pipelines to your local codebase and
								kanban execution runtime.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
						<div className="lg:col-span-5 space-y-4">
							<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-status-cyan/10 text-status-cyan text-xs font-semibold">
								05 · Knowledge
							</div>
							<h4 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">
								Learning classroom (OpenMAIC)
							</h4>
							<p className="text-sm sm:text-base text-text-secondary leading-relaxed">
								Multi-agent collaborative classroom for continuous training, knowledge indexing, and
								shared repo understanding. Links domain knowledge graphs directly into agent execution
								contexts to eliminate redundant context exploration.
							</p>
						</div>
						<div className="lg:col-span-7">
							<ScreenshotFrame
								id="slot-feature-learning"
								src="/screenshots/learning.png"
								alt="OpenMAIC Learning Classroom"
								title="OpenMAIC Learning Classroom"
							/>
						</div>
					</div>
				</div>
			</section>

			<section className="py-24 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border" id="install">
				<div className="text-center max-w-3xl mx-auto mb-12">
					<h2 className="text-xs font-mono uppercase tracking-widest text-accent mb-3">One-Line Setup</h2>
					<h3 className="text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight mb-4">
						Install PIXTiel
					</h3>
					<p className="text-base text-text-secondary">
						Ubuntu &amp; WSL. Pick your components; add more anytime with{" "}
						<code className="px-1.5 py-0.5 rounded bg-surface-1 border border-border text-text-primary text-xs font-mono">
							pnpm run setup
						</code>
						.
					</p>
				</div>
				<TerminalMockup />
			</section>

			<section className="py-24 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border">
				<div className="text-center max-w-3xl mx-auto mb-16">
					<h2 className="text-xs font-mono uppercase tracking-widest text-accent mb-3">Deployment Freedom</h2>
					<h3 className="text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight">
						Run it your way
					</h3>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
					<div className="p-8 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors">
						<div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent mb-5">
							<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
								<path d="M9 18c-4.51 2-5-2-7-2"></path>
							</svg>
						</div>
						<h4 className="text-xl font-bold text-text-primary mb-2">Open source</h4>
						<p className="text-sm text-text-secondary leading-relaxed">
							Fully transparent codebase under the MIT License. Fork, audit, extend, or contribute on
							GitHub with complete freedom.
						</p>
					</div>
					<div className="p-8 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors">
						<div className="w-10 h-10 rounded-lg bg-status-green/10 border border-status-green/30 flex items-center justify-center text-status-green mb-5">
							<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<rect width="20" height="8" x="2" y="2" rx="2" ry="2"></rect>
								<rect width="20" height="8" x="2" y="14" rx="2" ry="2"></rect>
								<line x1="6" y1="6" x2="6.01" y2="6"></line>
								<line x1="6" y1="18" x2="6.01" y2="18"></line>
							</svg>
						</div>
						<h4 className="text-xl font-bold text-text-primary mb-2">Self-hosted</h4>
						<p className="text-sm text-text-secondary leading-relaxed">
							Runs entirely on your local machine or private server. Your keys, your code, and your
							session data never leave your loopback network.
						</p>
					</div>
				</div>
			</section>

			<section className="py-24 px-4 sm:px-6 max-w-4xl mx-auto border-t border-border" id="faq">
				<div className="text-center mb-16">
					<h2 className="text-xs font-mono uppercase tracking-widest text-accent mb-3">
						Questions &amp; Answers
					</h2>
					<h3 className="text-3xl sm:text-4xl font-extrabold text-text-primary tracking-tight">
						Frequently Asked Questions
					</h3>
				</div>
				<div className="space-y-4">
					{(
						[
							[
								"What agents are supported?",
								"PIXTiel supports Claude Code, Cursor, and Cline out of the box, with extensible harnesses for additional agent CLIs and custom sub-agents.",
							],
							[
								"What is a seat and how does failover work?",
								"A seat represents an individual API or OAuth account. When an active agent encounters a provider rate limit (such as the 5-hour window cap), PIXTiel automatically parks the task, preserves its workspace state, and fails over to an available standby seat or backs off gracefully.",
							],
							[
								"Can I access it remotely?",
								"Yes. PIXTiel includes built-in security with loopback isolation by default, a secure passcode gate for network binds, and Google OIDC authentication support for remote team access.",
							],
							[
								"Where does my data live?",
								"All project data, workspace configurations, and task checkpoints reside locally on your disk under ~/.agent and your repository worktrees. There are zero remote cloud telemetry or database dependencies.",
							],
							[
								"What does the installer change on my system?",
								"The installer operates strictly in user space using user-local Node (via NVM) and Python (via uv). It requires no sudo privileges and makes no modifications to system-level directories.",
							],
						] as const
					).map(([q, a]) => (
						<details
							key={q}
							className="group rounded-xl border border-border bg-surface-1 p-6 transition-colors open:bg-surface-2/50"
						>
							<summary className="flex items-center justify-between cursor-pointer font-semibold text-text-primary list-none select-none">
								<span>{q}</span>
								<span className="text-text-secondary group-open:rotate-180 transition-transform duration-200">
									<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<polyline points="6 9 12 15 18 9"></polyline>
									</svg>
								</span>
							</summary>
							<p className="mt-4 text-sm text-text-secondary leading-relaxed">{a}</p>
						</details>
					))}
				</div>
			</section>

			{posts.length > 0 ? (
				<section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border">
					<div className="flex flex-wrap items-end justify-between gap-4 mb-10">
						<div>
							<p className="text-xs font-mono uppercase tracking-widest text-accent mb-3">Blog</p>
							<h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
								How it is built, and why
							</h2>
						</div>
						<Link href="/blog" className="text-sm font-semibold text-accent hover:text-[#339DFF]">
							All posts &rarr;
						</Link>
					</div>
					<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{posts.map((post) => (
							<Link
								key={post.slug}
								href={`/blog/${post.slug}`}
								className="group flex flex-col p-6 rounded-xl border border-border bg-surface-1 hover:border-border-bright transition-colors"
							>
								<time
									dateTime={post.frontmatter.date.toISOString()}
									className="text-xs font-mono text-text-tertiary"
								>
									{dateFormat.format(post.frontmatter.date)}
								</time>
								<h3 className="mt-3 text-lg font-semibold text-text-primary group-hover:text-white transition-colors leading-snug">
									{post.frontmatter.title}
								</h3>
								<p className="mt-2.5 text-sm text-text-secondary leading-relaxed line-clamp-3">
									{post.frontmatter.description}
								</p>
							</Link>
						))}
					</div>
				</section>
			) : null}

			<section className="py-24 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border text-center">
				<div className="max-w-3xl mx-auto">
					<h3 className="text-3xl sm:text-5xl font-extrabold text-text-primary tracking-tight mb-6">
						Put your agents to work.
					</h3>
					<p className="text-lg text-text-secondary mb-10 leading-relaxed max-w-2xl mx-auto">
						Start orchestrating autonomous coding agents with real git worktrees and multi-seat management
						today.
					</p>
					<div className="flex flex-wrap items-center justify-center gap-4">
						<a
							href="#install"
							className="px-7 py-3.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-semibold text-base shadow-lg shadow-accent/20 transition-all duration-150 transform hover:-translate-y-0.5"
						>
							Install PIXTiel
						</a>
						<Link
							href="/docs/getting-started"
							className="px-7 py-3.5 rounded-lg bg-surface-1 hover:bg-surface-2 border border-border text-text-primary font-semibold text-base transition-colors"
						>
							Read the docs
						</Link>
					</div>
				</div>
			</section>
		</>
	);
}
