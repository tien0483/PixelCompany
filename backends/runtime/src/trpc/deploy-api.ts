import type {
	RuntimeDeployConfigUpdateRequest,
	RuntimeDeployLoginCodeRequest,
	RuntimeDeployLoginStartRequest,
	RuntimeDeployLoginStatus,
	RuntimeDeployOpenUrlRequest,
	RuntimeDeployOpenUrlResponse,
	RuntimeDeployRunRequest,
	RuntimeDeployRunResponse,
	RuntimeDeployStatusRequest,
	RuntimeDeployStatusResponse,
} from "../core/api-contract";
import { deployPlanHtml } from "../deploy/apps-script-deploy";
import {
	type ClaspLoginStatus,
	getClaspLoginStatus,
	isClaspLoggedIn,
	readClaspAccountEmail,
	startClaspLogin,
	submitClaspLoginCode,
} from "../deploy/clasp-login";
import { openDeployUrl } from "../deploy/deploy-browser";
import { loadPlanDeployConfig, savePlanDeployConfig } from "../deploy/deploy-config";
import { readPlanDeployState } from "../deploy/deploy-state";
import { findSavedPlanById } from "../state/saved-plans";
import type { RuntimeTrpcContext } from "./app-router";

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toLoginStatus(status: ClaspLoginStatus, usedProfile: boolean): RuntimeDeployLoginStatus {
	return {
		ok: status.state !== "failed",
		state: status.state,
		url: status.url,
		awaitingCode: status.awaitingCode,
		usedProfile,
		loggedIn: status.loggedIn,
		account: status.account,
		error: status.error,
		failure: status.failure,
		log: status.log,
	};
}

/**
 * Publishing side of the plan editor: sign-in state, the browser-profile settings the
 * sign-in needs, and the deploy itself. Split out of `plansApi` because it is the only part
 * of the plan surface that reaches outside the machine.
 */
export function createDeployApi(): RuntimeTrpcContext["deployApi"] {
	return {
		status: async (input: RuntimeDeployStatusRequest) => {
			try {
				const config = await loadPlanDeployConfig();
				const loggedIn = await isClaspLoggedIn();
				const entry = input.planId ? await findSavedPlanById(input.planId) : null;
				return {
					ok: true,
					config,
					loggedIn,
					account: loggedIn ? await readClaspAccountEmail() : null,
					planState: entry ? await readPlanDeployState(entry) : null,
				} satisfies RuntimeDeployStatusResponse;
			} catch (error) {
				return {
					ok: false,
					config: { chromePath: null, chromeProfile: null, domain: "" },
					loggedIn: false,
					account: null,
					planState: null,
					error: toErrorMessage(error),
				} satisfies RuntimeDeployStatusResponse;
			}
		},
		setConfig: async (input: RuntimeDeployConfigUpdateRequest) => {
			try {
				const config = await savePlanDeployConfig(input);
				const loggedIn = await isClaspLoggedIn();
				return {
					ok: true,
					config,
					loggedIn,
					account: loggedIn ? await readClaspAccountEmail() : null,
					planState: null,
				} satisfies RuntimeDeployStatusResponse;
			} catch (error) {
				return {
					ok: false,
					config: { chromePath: null, chromeProfile: null, domain: "" },
					loggedIn: false,
					account: null,
					planState: null,
					error: toErrorMessage(error),
				} satisfies RuntimeDeployStatusResponse;
			}
		},
		login: async (input: RuntimeDeployLoginStartRequest) => {
			const status = await startClaspLogin({ noLocalhost: input.noLocalhost === true });
			if (!status.url) {
				return toLoginStatus(status, false);
			}
			// Opened here rather than in the browser tab that asked: the consent has to land in
			// the profile signed in as the Workspace user, which only the runtime can choose.
			const opened = await openDeployUrl(status.url, await loadPlanDeployConfig());
			return toLoginStatus(status, opened.usedProfile);
		},
		loginStatus: async () => {
			return toLoginStatus(await getClaspLoginStatus(), false);
		},
		loginSubmitCode: async (input: RuntimeDeployLoginCodeRequest) => {
			return toLoginStatus(await submitClaspLoginCode(input.code), false);
		},
		run: async (input: RuntimeDeployRunRequest) => {
			const result = await deployPlanHtml({ planId: input.planId });
			return {
				ok: result.ok,
				webAppUrl: result.webAppUrl,
				scriptId: result.scriptId,
				deploymentId: result.deploymentId,
				log: result.log,
				error: result.error,
				failure: result.failure,
			} satisfies RuntimeDeployRunResponse;
		},
		openUrl: async (input: RuntimeDeployOpenUrlRequest) => {
			const result = await openDeployUrl(input.url, await loadPlanDeployConfig());
			return {
				ok: result.ok,
				usedProfile: result.usedProfile,
				...(result.error ? { error: result.error } : {}),
			} satisfies RuntimeDeployOpenUrlResponse;
		},
	};
}
