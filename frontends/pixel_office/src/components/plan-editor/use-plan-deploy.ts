import { useCallback, useEffect, useRef, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeDeployLoginStatus,
	RuntimeDeployRunResponse,
	RuntimeDeployStatusResponse,
} from "@/runtime/types";

/** Where a Google account turns the Apps Script API on — the one manual step clasp cannot do. */
export const APPS_SCRIPT_USER_SETTINGS_URL = "https://script.google.com/home/usersettings";

/** How often the loopback sign-in is re-checked while the consent page is open in the browser. */
const LOGIN_POLL_INTERVAL_MS = 2_000;

export interface PlanDeployController {
	status: RuntimeDeployStatusResponse | null;
	statusLoading: boolean;
	login: RuntimeDeployLoginStatus | null;
	signingIn: boolean;
	deploying: boolean;
	result: RuntimeDeployRunResponse | null;
	refresh: () => Promise<void>;
	signIn: (options: { noLocalhost: boolean }) => Promise<void>;
	submitCode: (code: string) => Promise<void>;
	saveConfig: (update: { chromePath?: string | null; chromeProfile?: string | null }) => Promise<void>;
	deploy: () => Promise<RuntimeDeployRunResponse | null>;
	openUrl: (url: string) => Promise<void>;
}

/**
 * Client side of the `deploy` router: sign-in state, the browser-profile settings that
 * sign-in needs, and the run itself.
 *
 * `planId` is the *HTML* plan (the generated `<stem>.html`), which is the only thing that
 * can be published; `enabled` is what keeps this quiet until the deploy dialog is opened.
 */
export function usePlanDeploy(
	planId: string | null,
	workspaceId: string | null,
	enabled: boolean,
): PlanDeployController {
	const [status, setStatus] = useState<RuntimeDeployStatusResponse | null>(null);
	const [statusLoading, setStatusLoading] = useState(false);
	const [login, setLogin] = useState<RuntimeDeployLoginStatus | null>(null);
	const [signingIn, setSigningIn] = useState(false);
	const [deploying, setDeploying] = useState(false);
	const [result, setResult] = useState<RuntimeDeployRunResponse | null>(null);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const refresh = useCallback(async () => {
		setStatusLoading(true);
		try {
			const next = await getRuntimeTrpcClient(workspaceId).deploy.status.query({ planId });
			if (mountedRef.current) {
				setStatus(next);
			}
		} finally {
			if (mountedRef.current) {
				setStatusLoading(false);
			}
		}
	}, [planId, workspaceId]);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		void refresh();
	}, [enabled, refresh]);

	/**
	 * The loopback flow finishes in the browser, not in a response we are awaiting, so the
	 * only way to learn it worked is to ask. Stops as soon as clasp exits either way.
	 */
	useEffect(() => {
		if (!enabled || login?.state !== "awaiting-consent" || login.url === null) {
			return;
		}
		let cancelled = false;
		const timer = setInterval(() => {
			void (async () => {
				try {
					const next = await getRuntimeTrpcClient(workspaceId).deploy.loginStatus.query();
					if (cancelled || !mountedRef.current) {
						return;
					}
					setLogin(next);
					if (next.state === "done") {
						await refresh();
					}
				} catch {
					// A failed poll is not a failed sign-in; the next tick tries again.
				}
			})();
		}, LOGIN_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [enabled, login?.state, login?.url, refresh, workspaceId]);

	const signIn = useCallback(
		async (options: { noLocalhost: boolean }) => {
			setSigningIn(true);
			try {
				const next = await getRuntimeTrpcClient(workspaceId).deploy.login.mutate({
					noLocalhost: options.noLocalhost,
				});
				if (mountedRef.current) {
					setLogin(next);
				}
				if (next.state === "done") {
					await refresh();
				}
			} finally {
				if (mountedRef.current) {
					setSigningIn(false);
				}
			}
		},
		[refresh, workspaceId],
	);

	const submitCode = useCallback(
		async (code: string) => {
			setSigningIn(true);
			try {
				const next = await getRuntimeTrpcClient(workspaceId).deploy.loginSubmitCode.mutate({ code });
				if (mountedRef.current) {
					setLogin(next);
				}
				await refresh();
			} finally {
				if (mountedRef.current) {
					setSigningIn(false);
				}
			}
		},
		[refresh, workspaceId],
	);

	const saveConfig = useCallback(
		async (update: { chromePath?: string | null; chromeProfile?: string | null }) => {
			await getRuntimeTrpcClient(workspaceId).deploy.setConfig.mutate(update);
			await refresh();
		},
		[refresh, workspaceId],
	);

	const deploy = useCallback(async () => {
		if (!planId) {
			return null;
		}
		setDeploying(true);
		setResult(null);
		try {
			const next = await getRuntimeTrpcClient(workspaceId).deploy.run.mutate({ planId });
			if (mountedRef.current) {
				setResult(next);
			}
			// Picks up the newly recorded deployment so a second deploy updates it in place.
			await refresh();
			return next;
		} finally {
			if (mountedRef.current) {
				setDeploying(false);
			}
		}
	}, [planId, refresh, workspaceId]);

	const openUrl = useCallback(
		async (url: string) => {
			await getRuntimeTrpcClient(workspaceId).deploy.openUrl.mutate({ url });
		},
		[workspaceId],
	);

	return {
		status,
		statusLoading,
		login,
		signingIn,
		deploying,
		result,
		refresh,
		signIn,
		submitCode,
		saveConfig,
		deploy,
		openUrl,
	};
}
