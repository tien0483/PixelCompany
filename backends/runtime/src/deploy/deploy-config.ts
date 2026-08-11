import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getRuntimeHomePath } from "../state/workspace-state";

export const PLAN_DEPLOY_CONFIG_FILENAME = "plan-deploy.json";

/** The Google Workspace the deployed web app is restricted to (`"access": "DOMAIN"`). */
export const DEFAULT_DEPLOY_DOMAIN = "akselos.com";

/**
 * Where Windows Chrome lives as seen from WSL. The deploy flow needs a *specific* Chrome
 * profile — the one already signed in as the workspace user — and `xdg-open` cannot pick
 * one, so the binary is invoked directly.
 */
export const DEFAULT_WSL_CHROME_PATH = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

export interface PlanDeployConfig {
	/** Absolute path to the browser binary, or null to fall back to the OS default handler. */
	chromePath: string | null;
	/** Chrome's profile *directory* name — `Default`, `Profile 1`, … — not its display name. */
	chromeProfile: string | null;
	domain: string;
}

export interface PlanDeployConfigUpdate {
	chromePath?: string | null;
	chromeProfile?: string | null;
	domain?: string | null;
}

function configPath(): string {
	return join(getRuntimeHomePath(), PLAN_DEPLOY_CONFIG_FILENAME);
}

async function pathExists(value: string): Promise<boolean> {
	try {
		await access(value);
		return true;
	} catch {
		return false;
	}
}

function trimmedOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** WSL exposes the Windows kernel build string here; the marker is stable across releases. */
async function isWsl(): Promise<boolean> {
	if (process.platform !== "linux") {
		return false;
	}
	try {
		const version = await readFile("/proc/version", "utf8");
		return version.toLowerCase().includes("microsoft");
	} catch {
		return false;
	}
}

async function defaultChromePath(): Promise<string | null> {
	if (!(await isWsl())) {
		return null;
	}
	return (await pathExists(DEFAULT_WSL_CHROME_PATH)) ? DEFAULT_WSL_CHROME_PATH : null;
}

async function readStoredConfig(): Promise<PlanDeployConfigUpdate> {
	try {
		const raw = await readFile(configPath(), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return {};
		}
		const record = parsed as Record<string, unknown>;
		return {
			chromePath: trimmedOrNull(record.chromePath),
			chromeProfile: trimmedOrNull(record.chromeProfile),
			domain: trimmedOrNull(record.domain),
		};
	} catch {
		// A missing or unparseable config is not an error: everything below has a default.
		return {};
	}
}

/**
 * Env wins over the stored file so a launch can be pinned without touching state; the
 * file is what the deploy dialog writes, and the defaults cover the common WSL install.
 */
export async function loadPlanDeployConfig(): Promise<PlanDeployConfig> {
	const stored = await readStoredConfig();
	const chromePath =
		trimmedOrNull(process.env.PLAN_DEPLOY_CHROME_PATH) ?? stored.chromePath ?? (await defaultChromePath());
	const chromeProfile = trimmedOrNull(process.env.PLAN_DEPLOY_CHROME_PROFILE) ?? stored.chromeProfile ?? null;
	const domain = trimmedOrNull(process.env.PLAN_DEPLOY_DOMAIN) ?? stored.domain ?? DEFAULT_DEPLOY_DOMAIN;
	return { chromePath, chromeProfile, domain };
}

/** Partial update: an omitted key keeps its stored value, an explicit `null` clears it. */
export async function savePlanDeployConfig(update: PlanDeployConfigUpdate): Promise<PlanDeployConfig> {
	const stored = await readStoredConfig();
	const next = {
		chromePath: update.chromePath === undefined ? (stored.chromePath ?? null) : trimmedOrNull(update.chromePath),
		chromeProfile:
			update.chromeProfile === undefined ? (stored.chromeProfile ?? null) : trimmedOrNull(update.chromeProfile),
		domain: update.domain === undefined ? (stored.domain ?? null) : trimmedOrNull(update.domain),
	};
	await mkdir(getRuntimeHomePath(), { recursive: true });
	await writeFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return await loadPlanDeployConfig();
}
