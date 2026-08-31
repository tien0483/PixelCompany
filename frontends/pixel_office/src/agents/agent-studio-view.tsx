import { Bot, ExternalLink, X } from "lucide-react";
import type { ReactElement } from "react";

import type { AgentStudioTarget } from "@/components/home-sidebar-agents";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

import { buildFlowiseStudioUrl } from "./flowise-studio-url";

export interface AgentStudioViewProps {
	target: AgentStudioTarget;
	onClose: () => void;
}

/**
 * Hosts the forked Flowise canvas in the center pane.
 *
 * The frame is **cross-origin** on the studio's own port rather than same-origin through an
 * `/api/*-proxy/` route, and that is not an oversight: the runtime's proxy handlers buffer
 * responses to text (no streaming, no binary assets, no header passthrough) and its
 * WS-upgrade handler destroys every path but its own — the studio serves a SPA bundle and
 * streams over sockets, so neither would survive. `CORS_ORIGINS`/`IFRAME_ORIGINS` on the
 * fork are what scope the embed to this origin. Same shape as the DevTools frame in the
 * card detail view.
 */
export function AgentStudioView({ target, onClose }: AgentStudioViewProps): ReactElement {
	const studioUrl = buildFlowiseStudioUrl(target.baseUrl, target.flow);
	const title = target.flow?.name ?? "New agent";

	if (studioUrl.length === 0) {
		return (
			<div className="flex flex-1 h-full w-full min-h-0 flex-col items-center justify-center gap-2 bg-surface-0 text-text-tertiary">
				<Bot size={40} strokeWidth={1} />
				<p className="text-sm text-text-secondary">The agent studio has no address to open.</p>
			</div>
		);
	}

	return (
		<div className="flex flex-1 min-h-0 min-w-0 flex-col bg-surface-0">
			<div className="flex items-center gap-2 border-b border-border bg-surface-1 px-3 py-1.5">
				<Bot size={14} className="shrink-0 text-text-secondary" />
				<span className="flex-1 truncate text-[13px] font-medium text-text-primary">{title}</span>
				<Tooltip content="Open the studio in a browser tab">
					<Button
						variant="ghost"
						size="sm"
						icon={<ExternalLink size={14} />}
						aria-label="Open studio in a new tab"
						onClick={() => {
							window.open(studioUrl, "_blank", "noopener,noreferrer");
						}}
					/>
				</Tooltip>
				<Tooltip content="Close">
					<Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close agent studio" onClick={onClose} />
				</Tooltip>
			</div>
			{/* Keyed on the flow so switching agents remounts instead of swapping a prop: the
			    studio keeps unsaved canvas state inside the frame, and a src swap on a live
			    frame would carry one agent's editor session into the next. */}
			<iframe
				key={target.flow?.id ?? "new"}
				src={studioUrl}
				title={`Agent studio — ${title}`}
				className="flex-1 w-full h-full border-0"
			/>
		</div>
	);
}
