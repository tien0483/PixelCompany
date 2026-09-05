"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const installCommand =
	"curl -fsSL https://raw.githubusercontent.com/tien0483/PixelCompany/main/install.sh | bash";

export function TerminalMockup({ className = "" }: { className?: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		let ok = false;
		try {
			await navigator.clipboard.writeText(installCommand);
			ok = true;
		} catch {
			try {
				const ta = document.createElement("textarea");
				ta.value = installCommand;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				ok = document.execCommand("copy");
				document.body.removeChild(ta);
			} catch {
				ok = false;
			}
		}
		if (ok) {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}

	return (
		<div
			className={cn(
				"w-full max-w-3xl mx-auto rounded-xl border border-border bg-[#1F2428] overflow-hidden shadow-2xl",
				className,
			)}
		>
			<div className="px-4 py-3 bg-surface-1 border-b border-border flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="w-3 h-3 rounded-full bg-[#FF5F56]/80 inline-block"></span>
					<span className="w-3 h-3 rounded-full bg-[#FFBD2E]/80 inline-block"></span>
					<span className="w-3 h-3 rounded-full bg-[#27C93F]/80 inline-block"></span>
				</div>
				<div className="text-xs font-mono text-text-secondary flex items-center gap-2">
					<svg
						className="w-3.5 h-3.5 text-text-tertiary"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					>
						<polyline points="4 17 10 11 4 5"></polyline>
						<line x1="12" y1="19" x2="20" y2="19"></line>
					</svg>
					<span>pixtiel-installer — bash</span>
				</div>
				<div className="w-12"></div>
			</div>

			<div className="p-6 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto text-text-primary bg-[#191D21]">
				<pre className="text-[#0084FF] font-bold text-[10px] sm:text-xs leading-none select-none mb-6">{`██████╗ ██╗██╗  ██╗████████╗██╗███████╗██╗     
██╔══██╗██║╚██╗██╔╝╚══██╔══╝██║██╔════╝██║     
██████╔╝██║ ╚███╔╝    ██║   ██║█████╗  ██║     
██╔═══╝ ██║ ██╔██╗    ██║   ██║██╔══╝  ██║     
██║     ██║██╔╝ ██╗   ██║   ██║███████╗███████╗
╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚══════╝╚══════╝`}</pre>

				<div className="text-text-secondary mb-4">
					<span className="text-[#3FB950]">✔</span> Select modular components to install:
				</div>

				<div className="space-y-1.5 pl-2 mb-6 border-l-2 border-border">
					<div className="flex items-center gap-2 text-[#3FB950]">
						<span className="font-bold">[x]</span>
						<span className="text-text-primary font-semibold">Agent Stack</span>
						<span className="text-xs text-text-tertiary">— Multi-agent runtime & CLI orchestration</span>
					</div>
					<div className="flex items-center gap-2 text-[#3FB950]">
						<span className="font-bold">[x]</span>
						<span className="text-text-primary font-semibold">Kanban</span>
						<span className="text-xs text-text-tertiary">— Isolated git worktree board interface</span>
					</div>
					<div className="flex items-center gap-2 text-[#3FB950]">
						<span className="font-bold">[x]</span>
						<span className="text-text-primary font-semibold">Plan editor</span>
						<span className="text-xs text-text-tertiary">— Interactive HTML design & plan refinement</span>
					</div>
					<div className="flex items-center gap-2 text-text-tertiary">
						<span className="font-bold">[ ]</span>
						<span className="text-text-secondary">OmniRoute</span>
						<span className="text-xs text-text-tertiary">— Multi-provider proxy & token budget optimizer</span>
					</div>
					<div className="flex items-center gap-2 text-text-tertiary">
						<span className="font-bold">[ ]</span>
						<span className="text-text-secondary">Review</span>
						<span className="text-xs text-text-tertiary">— GitLab MR changes viewer & automated review</span>
					</div>
					<div className="flex items-center gap-2 text-text-tertiary">
						<span className="font-bold">[ ]</span>
						<span className="text-text-secondary">Agent creation</span>
						<span className="text-xs text-text-tertiary">— Flowise visual agent canvas</span>
					</div>
				</div>

				<div className="mt-6 pt-4 border-t border-border/60">
					<div className="text-xs text-text-secondary mb-2 flex items-center justify-between">
						<span>Quick Install One-Liner (Ubuntu &amp; WSL):</span>
						<span className="text-[10px] text-text-tertiary">Bash</span>
					</div>
					<div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-1 border border-border text-text-primary">
						<code className="text-xs sm:text-sm font-mono text-[#4C9AFF] break-all select-all">
							{installCommand}
						</code>
						<button
							type="button"
							onClick={copy}
							className="p-1.5 rounded-md hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors shrink-0 relative group cursor-pointer"
							title="Copy to clipboard"
							aria-label="Copy install command"
						>
							<svg
								className={cn("w-4 h-4 copy-icon", copied && "hidden")}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
								<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
							</svg>
							<svg
								className={cn("w-4 h-4 check-icon text-[#3FB950]", !copied && "hidden")}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
							>
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							<span
								className={cn(
									"copied-tooltip absolute -top-8 right-0 px-2 py-0.5 rounded bg-surface-3 border border-border text-[10px] text-text-primary font-sans pointer-events-none transition-opacity duration-150",
									copied ? "opacity-100" : "opacity-0",
								)}
							>
								Copied!
							</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
