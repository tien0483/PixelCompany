import { ArrowLeft, BookOpen, ExternalLink, RefreshCw, X } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSiteStatus } from "@/runtime/types";
import { alignEmbedHostForBrowser } from "@/site/site-embed-url";

export interface SiteDocsViewProps {
	/** Selects which runtime the tRPC client talks to. The website itself is global. */
	workspaceId: string | null;
	onClose: () => void;
}

/** Matches the other embedded sidecars' poll; only runs while the site is down. */
const POLL_INTERVAL_MS = 5_000;

/**
 * Frames the product website — the same Astro build that ships to the public site — in the
 * center pane, opened at its documentation section.
 *
 * Served root-mounted on its own loopback port by `site-server.ts` rather than under a path
 * on :3484, because Astro emits absolute internal URLs (`/docs/…`, `/_astro/…`): a path
 * mount would need every link in the site rewritten through `import.meta.env.BASE_URL`,
 * including the ones inside MDX content, which are plain strings. A port keeps the
 * published site and the embedded one byte-identical.
 *
 * The frame is cross-origin for the same reason the Agents and Learning frames are: the
 * `/api/*-proxy/` handlers buffer to text and the WS-upgrade allowlist drops every path but
 * the runtime's own. The site sends a `frame-ancestors` CSP scoped to this PIXTiel's
 * origins, so it is embeddable here and nowhere else.
 */
export function SiteDocsView({ workspaceId, onClose }: SiteDocsViewProps): ReactElement {
	const [status, setStatus] = useState<RuntimeSiteStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const frameRef = useRef<HTMLIFrameElement | null>(null);

	const isOnline = status?.online === true && status.built;

	useEffect(() => {
		let cancelled = false;
		const poll = async (): Promise<void> => {
			try {
				const response = await getRuntimeTrpcClient(workspaceId).site.status.query();
				if (!cancelled) {
					setStatus(response);
					setError(null);
				}
			} catch (caught) {
				if (!cancelled) {
					setError(caught instanceof Error ? caught.message : String(caught));
				}
			}
		};
		void poll();
		// Stop polling once it is up: the frame owns the surface from then on.
		if (isOnline) {
			return () => {
				cancelled = true;
			};
		}
		const timer = window.setInterval(() => {
			void poll();
		}, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [isOnline, workspaceId]);

	const embedUrl =
		status === null ? "" : `${alignEmbedHostForBrowser(status.baseUrl)}${status.docsPath}`;

	const reload = useCallback(() => {
		setReloadKey((key) => key + 1);
	}, []);

	const goHome = useCallback(() => {
		// Cross-origin: the frame's history is not reachable, so remount at the docs entry.
		reload();
	}, [reload]);

	const header = (
		<div className="flex items-center gap-2 border-b border-border bg-surface-1 px-3 py-1.5">
			<BookOpen size={14} className="shrink-0 text-text-secondary" />
			<span className="flex-1 truncate text-[13px] font-medium text-text-primary">Docs</span>
			{isOnline ? (
				<>
					<Tooltip content="Back to the documentation index">
						<Button
							variant="ghost"
							size="sm"
							icon={<ArrowLeft size={14} />}
							aria-label="Back to the documentation index"
							onClick={goHome}
						/>
					</Tooltip>
					<Tooltip content="Reload">
						<Button
							variant="ghost"
							size="sm"
							icon={<RefreshCw size={14} />}
							aria-label="Reload the documentation"
							onClick={reload}
						/>
					</Tooltip>
					<Tooltip content="Open the docs in a browser tab">
						<Button
							variant="ghost"
							size="sm"
							icon={<ExternalLink size={14} />}
							aria-label="Open the docs in a new tab"
							onClick={() => {
								window.open(embedUrl, "_blank", "noopener,noreferrer");
							}}
						/>
					</Tooltip>
				</>
			) : null}
			<Tooltip content="Close">
				<Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close docs" onClick={onClose} />
			</Tooltip>
		</div>
	);

	if (status === null) {
		return (
			<div className="flex h-full min-h-0 w-full flex-col" data-testid="site-docs-view">
				{header}
				<div className="flex flex-1 items-center justify-center bg-surface-0">
					<Spinner size={24} />
				</div>
			</div>
		);
	}

	if (!status.built) {
		return (
			<div className="flex h-full min-h-0 w-full flex-col" data-testid="site-docs-view">
				{header}
				<div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center">
					<BookOpen size={40} strokeWidth={1} className="text-text-tertiary" />
					<p className="text-sm text-text-secondary">The documentation site has not been built yet.</p>
					<p className="max-w-md text-xs text-text-tertiary">
						The Docs tab frames the same site that ships publicly. Build it once and it stays
						available offline.
					</p>
					<code className="rounded border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-text-primary">
						{status.buildCommand}
					</code>
					<p className="text-[11px] text-text-tertiary">This view picks it up automatically.</p>
				</div>
			</div>
		);
	}

	if (!status.online) {
		return (
			<div className="flex h-full min-h-0 w-full flex-col" data-testid="site-docs-view">
				{header}
				<div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center">
					<Spinner size={20} />
					<p className="text-sm text-text-secondary">Waiting for the documentation server…</p>
					<p className="max-w-md text-xs text-text-tertiary">
						It is built but nothing is listening on <code className="font-mono">{status.baseUrl}</code>.
						Restarting PIXTiel brings it up: <code className="font-mono">pnpm start -- --restart</code>.
					</p>
					{error !== null ? <p className="text-[11px] text-status-red">{error}</p> : null}
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 w-full flex-col" data-testid="site-docs-view">
			{header}
			<iframe
				key={reloadKey}
				ref={frameRef}
				src={embedUrl}
				title="PIXTiel documentation"
				className="min-h-0 w-full flex-1 border-0 bg-surface-0"
				// The site is first-party content on loopback; it needs scripts for its own
				// navigation, and same-origin for nothing else on this machine.
				sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
			/>
		</div>
	);
}
