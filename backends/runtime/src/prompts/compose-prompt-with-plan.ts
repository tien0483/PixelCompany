import { access } from "node:fs/promises";
import { resolve } from "node:path";

export function normalizePlanFilePath(planFilePath: string | null | undefined): string | null {
	if (typeof planFilePath !== "string") {
		return null;
	}
	const trimmed = planFilePath.trim();
	if (!trimmed) {
		return null;
	}
	return resolve(trimmed);
}

export function buildPlanFilePromptPrefix(planFilePath: string): string {
	return [
		`Read and follow the implementation plan at: ${planFilePath}`,
		"Do not skip steps in that plan unless the user overrides.",
		"",
	].join("\n");
}

/**
 * Prepends a short "read and follow this plan" instruction when a plan file is attached.
 * Verifies the file exists before composing; throws if missing.
 */
export async function composePromptWithAttachedPlan(input: {
	prompt: string;
	planFilePath?: string | null;
}): Promise<string> {
	const planFilePath = normalizePlanFilePath(input.planFilePath);
	if (!planFilePath) {
		return input.prompt;
	}
	try {
		await access(planFilePath);
	} catch {
		throw new Error(`Attached plan file is missing: ${planFilePath}`);
	}
	const prefix = buildPlanFilePromptPrefix(planFilePath);
	const trimmedPrompt = input.prompt.trim();
	if (!trimmedPrompt) {
		return prefix.trimEnd();
	}
	return `${prefix}${trimmedPrompt}`;
}
