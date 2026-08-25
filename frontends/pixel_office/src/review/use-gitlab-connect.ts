import { useCallback, useEffect, useRef, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeGitlabConnection } from "@/runtime/types";

/** How often the browser-based flow is polled while a flow is outstanding. */
const CONNECT_POLL_INTERVAL_MS = 1500;

export interface GitlabConnectController {
	connection: RuntimeGitlabConnection | null;
	isConnected: boolean;
	/** Last connect failure, cleared by the next attempt. Panels render it inline. */
	error: string | null;
	setError: (error: string | null) => void;
	/** True while either path is in flight. */
	isConnecting: boolean;
	/** Set while the browser round-trip is outstanding, so the panel can offer Cancel. */
	connectAuthorizeUrl: string | null;
	hasPendingFlow: boolean;
	reload: () => Promise<void>;
	connectWithBrowser: () => Promise<void>;
	connectWithToken: (token: string) => Promise<boolean>;
	cancelConnect: () => Promise<void>;
}

/**
 * Owns the GitLab connection for the sidebar panel and the merge-request screen,
 * which offer the same two paths in different chrome. Both a browser
 * authorization and a pasted token are handled here because they share every
 * piece of state around them — the connection itself, the in-flight flag, and
 * the error line.
 */
export function useGitlabConnect(workspaceId: string | null): GitlabConnectController {
	const [connection, setConnection] = useState<RuntimeGitlabConnection | null>(null);
	const [connectFlowId, setConnectFlowId] = useState<string | null>(null);
	const [connectAuthorizeUrl, setConnectAuthorizeUrl] = useState<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Read inside `cancelConnect` so it does not change identity on every poll tick;
	// the panels pass it straight to an onClick.
	const flowIdRef = useRef<string | null>(null);
	flowIdRef.current = connectFlowId;

	const reload = useCallback(async () => {
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			setConnection(await client.gitlab.status.query());
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		}
	}, [workspaceId]);

	useEffect(() => {
		void reload();
	}, [reload]);

	// Poll only while a flow is outstanding. The browser round-trip finishes out of
	// band, so there is nothing else to tell the UI the token has landed.
	useEffect(() => {
		if (!connectFlowId) {
			return;
		}
		let cancelled = false;
		const timer = setInterval(async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const status = await client.gitlab.connectStatus.query({ flowId: connectFlowId });
				if (cancelled || status.state === "pending") {
					return;
				}
				setConnectFlowId(null);
				setConnectAuthorizeUrl(null);
				setIsConnecting(false);
				if (status.state === "connected") {
					setConnection(status.connection);
					setError(null);
				} else {
					setError(status.error ?? "GitLab authorization failed.");
				}
			} catch {
				// A transient poll failure is not worth surfacing; the next tick retries.
			}
		}, CONNECT_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [connectFlowId, workspaceId]);

	const connectWithBrowser = useCallback(async () => {
		setIsConnecting(true);
		setError(null);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.gitlab.connect.mutate({});
			if (!response.ok || !response.flowId) {
				setIsConnecting(false);
				setError(response.error ?? "Could not start the GitLab authorization.");
				return;
			}
			setConnectFlowId(response.flowId);
			setConnectAuthorizeUrl(response.authorizeUrl ?? null);
		} catch (connectError) {
			setIsConnecting(false);
			setError(connectError instanceof Error ? connectError.message : String(connectError));
		}
	}, [workspaceId]);

	const connectWithToken = useCallback(
		async (token: string): Promise<boolean> => {
			setIsConnecting(true);
			setError(null);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.gitlab.connectToken.mutate({ token });
				if (!response.ok || !response.connection) {
					setError(response.error ?? "GitLab rejected the token.");
					return false;
				}
				setConnection(response.connection);
				return true;
			} catch (connectError) {
				setError(connectError instanceof Error ? connectError.message : String(connectError));
				return false;
			} finally {
				setIsConnecting(false);
			}
		},
		[workspaceId],
	);

	const cancelConnect = useCallback(async () => {
		const flowId = flowIdRef.current;
		setConnectFlowId(null);
		setConnectAuthorizeUrl(null);
		setIsConnecting(false);
		if (!flowId) {
			return;
		}
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			await client.gitlab.cancelConnect.mutate({ flowId });
		} catch {
			// Best-effort: the UI has already reset regardless of whether the callback
			// port freed cleanly.
		}
	}, [workspaceId]);

	return {
		connection,
		isConnected: connection?.connected === true,
		error,
		setError,
		isConnecting,
		connectAuthorizeUrl,
		hasPendingFlow: connectFlowId !== null,
		reload,
		connectWithBrowser,
		connectWithToken,
		cancelConnect,
	};
}
