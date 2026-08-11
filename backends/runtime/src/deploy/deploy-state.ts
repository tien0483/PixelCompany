import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { PLAN_DEPLOY_STATE_SUFFIX, type SavedPlanEntry } from "../state/saved-plans";
import { isPathWithinRoot } from "../workspace/path-sandbox";

export interface PlanDeployState {
	scriptId: string;
	deploymentId: string | null;
	webAppUrl: string | null;
	deployedAt: number | null;
}

export function resolvePlanDeployStatePath(entry: SavedPlanEntry): string {
	const parentDir = dirname(entry.path);
	const statePath = join(parentDir, `${basename(entry.path)}${PLAN_DEPLOY_STATE_SUFFIX}`);
	if (!isPathWithinRoot(parentDir, statePath)) {
		throw new Error("Access denied: deploy state path is outside the plan directory.");
	}
	return statePath;
}

/** `null` when this plan has never been deployed (or its record is unreadable). */
export async function readPlanDeployState(entry: SavedPlanEntry): Promise<PlanDeployState | null> {
	try {
		const raw = await readFile(resolvePlanDeployStatePath(entry), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		const scriptId = typeof record.scriptId === "string" ? record.scriptId.trim() : "";
		if (!scriptId) {
			return null;
		}
		return {
			scriptId,
			deploymentId: typeof record.deploymentId === "string" ? record.deploymentId : null,
			webAppUrl: typeof record.webAppUrl === "string" ? record.webAppUrl : null,
			deployedAt: typeof record.deployedAt === "number" ? record.deployedAt : null,
		};
	} catch {
		return null;
	}
}

export async function writePlanDeployState(entry: SavedPlanEntry, state: PlanDeployState): Promise<string> {
	const statePath = resolvePlanDeployStatePath(entry);
	await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return statePath;
}
