import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

import { openInBrowser } from "../server/browser";
import type { PlanDeployConfig } from "./deploy-config";

export interface DeployBrowserOpenResult {
	ok: boolean;
	/** True when the URL went to the configured Chrome profile rather than the OS default. */
	usedProfile: boolean;
	error?: string;
}

async function pathExists(value: string): Promise<boolean> {
	try {
		await access(value);
		return true;
	} catch {
		return false;
	}
}

/**
 * Open `url` in the browser profile that is signed in as the workspace user.
 *
 * `openInBrowser` (and `xdg-open` behind it) hands the URL to whatever profile Chrome
 * happens to have open, which on a machine with several Google accounts is a coin flip —
 * and an Apps Script consent screen accepted by the wrong account deploys to the wrong
 * Workspace. So when a profile is configured the binary is launched directly with
 * `--profile-directory`; everything else degrades to the default handler rather than
 * failing the deploy.
 */
export async function openDeployUrl(url: string, config: PlanDeployConfig): Promise<DeployBrowserOpenResult> {
	const { chromePath, chromeProfile } = config;
	if (!chromePath || !chromeProfile) {
		openInBrowser(url);
		return { ok: true, usedProfile: false };
	}
	if (!(await pathExists(chromePath))) {
		openInBrowser(url);
		return { ok: true, usedProfile: false, error: `Browser not found at ${chromePath}; used the default browser.` };
	}
	try {
		// Detached + unref: Chrome outlives the runtime request, and on WSL the Windows
		// binary keeps its console attached to the parent unless it is let go.
		const child = spawn(chromePath, [`--profile-directory=${chromeProfile}`, url], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return { ok: true, usedProfile: true };
	} catch (error) {
		openInBrowser(url);
		return {
			ok: true,
			usedProfile: false,
			error: `${error instanceof Error ? error.message : String(error)} — used the default browser instead.`,
		};
	}
}
