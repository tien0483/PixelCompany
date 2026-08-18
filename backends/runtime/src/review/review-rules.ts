// The reviewer's rules knowledge base: the team's anti-patterns, lint rules and
// guidelines, extracted once from their docs and cached as structured JSON.
//
// Cached under `agent-data/` rather than the runtime home because these are
// project assets, not user state: two people reviewing the same repo should read
// the same rules, and the extraction is expensive enough that re-running it per
// machine is waste. When `agent-data/` cannot be located (the standalone package
// ships no repo), the runtime home is used instead so the feature still works.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
	type RuntimeReviewRule,
	type RuntimeReviewRulesBundle,
	type RuntimeReviewRulesConfig,
	runtimeReviewRulesBundleSchema,
	runtimeReviewRuleSchema,
	runtimeReviewRulesConfigSchema,
} from "../core/api-contract";
import { findAgentDataRoot } from "../state/agent-data-manifest";
import { getRuntimeHomePath } from "../state/workspace-state";

/** Bump when the extraction prompt or the rule shape changes materially. */
export const REVIEW_RULES_BUNDLE_VERSION = 1;

export const REVIEW_RULES_DIR_SEGMENTS = ["review", "rules"] as const;

/**
 * A project key is a directory name, and it comes from a user-typed project path
 * or GitLab namespace, so it is sanitized rather than trusted. Without this a key
 * of `../../etc` would write outside the rules directory.
 */
export function toProjectKeyFileName(projectKey: string): string {
	// Dots are disallowed rather than merely trimmed: keeping them would let
	// `../../etc/passwd` sanitize to `.._.._etc_passwd`, which is contained but
	// unreadable, and one regex change away from escaping again.
	const safe = projectKey
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
	return `${safe.length > 0 ? safe : "default"}.json`;
}

export function getReviewRulesDir(): string {
	const agentDataRoot = findAgentDataRoot();
	return agentDataRoot
		? join(agentDataRoot, ...REVIEW_RULES_DIR_SEGMENTS)
		: join(getRuntimeHomePath(), ...REVIEW_RULES_DIR_SEGMENTS);
}

export function getReviewRulesPath(projectKey: string): string {
	return join(getReviewRulesDir(), toProjectKeyFileName(projectKey));
}

export function getReviewRulesConfigPath(projectKey: string): string {
	return join(getReviewRulesDir(), "config", toProjectKeyFileName(projectKey));
}

export async function readReviewRulesBundle(projectKey: string): Promise<RuntimeReviewRulesBundle | null> {
	try {
		const text = await readFile(getReviewRulesPath(projectKey), "utf-8");
		const parsed = runtimeReviewRulesBundleSchema.safeParse(JSON.parse(text) as unknown);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export async function writeReviewRulesBundle(bundle: RuntimeReviewRulesBundle): Promise<void> {
	const path = getReviewRulesPath(bundle.projectKey);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, "utf-8");
}

export async function readReviewRulesConfig(projectKey: string): Promise<RuntimeReviewRulesConfig | null> {
	try {
		const text = await readFile(getReviewRulesConfigPath(projectKey), "utf-8");
		const parsed = runtimeReviewRulesConfigSchema.safeParse(JSON.parse(text) as unknown);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export async function writeReviewRulesConfig(config: RuntimeReviewRulesConfig): Promise<void> {
	const path = getReviewRulesConfigPath(config.projectKey);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

/**
 * Locates a JSON array inside agent output. The agents are told to emit a bare
 * array, but CLI output routinely arrives wrapped in a ```json fence or trailed by
 * a sentence, and a strict `JSON.parse` of the raw stream would throw away a
 * perfectly good result over prose that changed nothing.
 */
function extractJsonArray(text: string): unknown[] {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const bodies = [fenced?.[1], text].filter((value): value is string => typeof value === "string");
	for (const body of bodies) {
		const start = body.indexOf("[");
		const end = body.lastIndexOf("]");
		if (start < 0 || end <= start) {
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(body.slice(start, end + 1));
			if (Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// Try the next body shape.
		}
	}
	return [];
}

/**
 * Pulls the rules array out of whatever the extraction agent streamed. The agent
 * is told to emit a bare JSON array, but CLI output routinely arrives wrapped in
 * a ```json fence or trailed by a sentence, so the object is located rather than
 * assumed — a strict `JSON.parse` of the raw stream fails on prose that changed
 * nothing about the rules themselves.
 *
 * Rules that do not validate are dropped individually: one malformed entry in
 * thirty should cost that entry, not the extraction run.
 */
export function parseExtractedRules(text: string): { rules: RuntimeReviewRule[]; dropped: number } {
	const candidates = extractJsonArray(text);
	const rules: RuntimeReviewRule[] = [];
	let dropped = 0;
	const seenIds = new Set<string>();
	for (const candidate of candidates) {
		const parsed = runtimeReviewRuleSchema.safeParse(candidate);
		if (!parsed.success) {
			dropped += 1;
			continue;
		}
		// Duplicate ids would make "Cite in comment" ambiguous.
		if (seenIds.has(parsed.data.id)) {
			dropped += 1;
			continue;
		}
		seenIds.add(parsed.data.id);
		rules.push(parsed.data);
	}
	return { rules, dropped };
}

export function buildRulesBundle(input: {
	projectKey: string;
	sourceRoots: string[];
	rules: RuntimeReviewRule[];
}): RuntimeReviewRulesBundle {
	return {
		version: REVIEW_RULES_BUNDLE_VERSION,
		projectKey: input.projectKey,
		generatedAt: new Date().toISOString(),
		sourceRoots: input.sourceRoots,
		rules: input.rules,
	};
}

/**
 * Parses the audit agent's findings. Same tolerance as the rules parser, and the
 * same reason: a finding that fails to validate is one missing warning, not a
 * failed review pass.
 */
export interface ParsedAuditFinding {
	newPath: string;
	newLine: number | null;
	ruleId: string | null;
	severity: RuntimeReviewRule["severity"];
	message: string;
}

export function parseAuditFindings(text: string): ParsedAuditFinding[] {
	const findings: ParsedAuditFinding[] = [];
	for (const item of extractJsonArray(text)) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const newPath = typeof record.newPath === "string" ? record.newPath : null;
		const message = typeof record.message === "string" ? record.message : null;
		if (!newPath || !message) {
			continue;
		}
		const severityRaw = typeof record.severity === "string" ? record.severity.toUpperCase() : "MEDIUM";
		findings.push({
			newPath,
			newLine: typeof record.newLine === "number" && Number.isFinite(record.newLine) ? record.newLine : null,
			ruleId: typeof record.ruleId === "string" && record.ruleId.length > 0 ? record.ruleId : null,
			// An unrecognized severity lands on MEDIUM rather than dropping the finding:
			// a real problem reported at the wrong weight still beats silence.
			severity:
				severityRaw === "CRITICAL" || severityRaw === "HIGH" || severityRaw === "LOW" ? severityRaw : "MEDIUM",
			message,
		});
	}
	return findings;
}
