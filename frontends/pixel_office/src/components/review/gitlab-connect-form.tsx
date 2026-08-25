import { KeyRound, LogIn, X } from "lucide-react";
import { type ReactElement, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GitlabConnectController } from "@/review/use-gitlab-connect";

/**
 * Mirrors `DEFAULT_GITLAB_HOST` in the runtime. It cannot be imported: only the
 * *types* of the api contract are aliased into this app, so a value import from
 * there would typecheck and then fail to resolve in the bundle.
 */
const DEFAULT_GITLAB_HOST = "https://code.akselos.com/repo";

/** Pre-ticks the one scope reviewing needs on GitLab's token form. */
function tokenPageUrl(host: string | null): string {
	return `${(host ?? DEFAULT_GITLAB_HOST).replace(/\/+$/, "")}/-/user_settings/personal_access_tokens?scopes=api`;
}

/**
 * The token paste is the primary path, not a fallback: the OAuth application
 * this instance exposes can only be granted the `mcp` scope, which does not
 * authorize the REST API every screen here uses. Browser authorization stays
 * behind a disclosure for instances that do offer a properly scoped app.
 */
export function GitlabConnectForm({
	controller,
	onConnected,
	size = "md",
}: {
	controller: GitlabConnectController;
	onConnected?: () => void;
	/** `sm` fits the sidebar column; `md` is the full-width empty state. */
	size?: "sm" | "md";
}): ReactElement {
	const [token, setToken] = useState("");
	const [showBrowserPath, setShowBrowserPath] = useState(false);
	const { connection, error, isConnecting, connectAuthorizeUrl, hasPendingFlow } = controller;
	const isSmall = size === "sm";

	const submit = async (): Promise<void> => {
		if (token.trim().length === 0 || isConnecting) {
			return;
		}
		const connected = await controller.connectWithToken(token);
		if (connected) {
			// Dropped as soon as it is stored: the field is the only place the raw
			// token lives in this app, and it has no further use once accepted.
			setToken("");
			onConnected?.();
		}
	};

	return (
		<div className={isSmall ? "space-y-2" : "space-y-3"} data-testid="gitlab-connect-form">
			<p className={isSmall ? "text-[12px] text-text-tertiary" : "text-xs text-text-secondary"}>
				Paste a GitLab personal access token with the{" "}
				<code className="rounded-sm bg-surface-2 px-1 text-text-primary">api</code> scope. One token serves every
				project here.
			</p>

			{connection?.reauthRequired ? (
				<p className={isSmall ? "text-[11px] text-status-orange" : "text-xs text-status-orange"}>
					The stored token for {connection.username} was rejected. Paste a new one to continue.
				</p>
			) : null}

			<input
				type="password"
				value={token}
				data-testid="gitlab-token-input"
				placeholder="glpat-…"
				autoComplete="off"
				spellCheck={false}
				onChange={(event) => setToken(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void submit();
					}
				}}
				className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
			/>

			<div className={isSmall ? "flex items-center gap-2" : "flex items-center justify-center gap-2"}>
				<Button
					variant="primary"
					size={isSmall ? "sm" : "md"}
					icon={isConnecting && !hasPendingFlow ? <Spinner size={12} /> : <KeyRound size={12} />}
					disabled={isConnecting || token.trim().length === 0}
					onClick={() => void submit()}
				>
					Connect with token
				</Button>
				<a
					href={tokenPageUrl(connection?.host ?? null)}
					target="_blank"
					rel="noopener noreferrer"
					className={isSmall ? "text-[11px] text-accent underline" : "text-xs text-accent underline"}
				>
					Generate one
				</a>
			</div>

			{error ? (
				<p className={isSmall ? "text-[11px] text-status-red" : "text-xs text-status-red"} role="alert">
					{error}
				</p>
			) : null}

			{showBrowserPath ? (
				<div className={isSmall ? "space-y-1.5" : "space-y-2"}>
					<p className={isSmall ? "text-[11px] text-text-tertiary" : "text-xs text-text-tertiary"}>
						Browser authorization works only on instances with a GitLab application scoped for the REST API.
						On this one it returns a token limited to <code>mcp</code>, which cannot read merge requests.
					</p>
					<div className={isSmall ? "flex items-center gap-2" : "flex items-center justify-center gap-2"}>
						<Button
							variant="default"
							size={isSmall ? "sm" : "md"}
							icon={hasPendingFlow ? <Spinner size={12} /> : <LogIn size={12} />}
							disabled={isConnecting}
							onClick={() => void controller.connectWithBrowser()}
						>
							{hasPendingFlow ? "Waiting for browser…" : "Authorize in browser"}
						</Button>
						{hasPendingFlow ? (
							<Button
								variant="default"
								size={isSmall ? "sm" : "md"}
								icon={<X size={12} />}
								onClick={() => void controller.cancelConnect()}
							>
								Cancel
							</Button>
						) : null}
					</div>
					{hasPendingFlow && connectAuthorizeUrl ? (
						<p className={isSmall ? "text-[11px] text-text-tertiary" : "text-xs text-text-tertiary"}>
							Browser did not open?{" "}
							<a
								href={connectAuthorizeUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-accent underline"
							>
								Open authorization page
							</a>
						</p>
					) : null}
				</div>
			) : (
				<button
					type="button"
					onClick={() => setShowBrowserPath(true)}
					className={`cursor-pointer text-text-tertiary underline hover:text-text-secondary ${
						isSmall ? "text-[11px]" : "text-xs"
					}`}
				>
					Use browser authorization instead
				</button>
			)}
		</div>
	);
}
