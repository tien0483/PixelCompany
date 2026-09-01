import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PONYTAIL_PROTECT_TAG = "system_rules";
export const PONYTAIL_PROTECT_ATTR = 'do_not_compress="true"';

const DEFAULT_HEADROOM = {
	mode: "cache",
	protectToolResults: ["Read", "Grep", "Glob", "Bash", "Write", "Edit"],
};

export function readHeadroomProxyConfig(stackRoot) {
	const configPath = join(stackRoot, "config", "headroom-proxy.json");
	if (!existsSync(configPath)) {
		return DEFAULT_HEADROOM;
	}
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		return {
			mode: typeof parsed.mode === "string" ? parsed.mode : DEFAULT_HEADROOM.mode,
			protectToolResults: Array.isArray(parsed.protectToolResults)
				? parsed.protectToolResults.filter((entry) => typeof entry === "string" && entry.length > 0)
				: DEFAULT_HEADROOM.protectToolResults,
		};
	} catch {
		return DEFAULT_HEADROOM;
	}
}

export function buildHeadroomProxyArgs(config) {
	const resolved = config ?? DEFAULT_HEADROOM;
	const args = ["--mode", resolved.mode || "cache"];
	if (resolved.protectToolResults.length > 0) {
		args.push("--protect-tool-results", resolved.protectToolResults.join(","));
	}
	return args;
}

/** Wrap Ponytail ladder/rules so Caveman + Headroom skip them. */
export function wrapCompressionProtected(body) {
	const trimmed = String(body ?? "").trim();
	if (trimmed.length === 0) {
		return trimmed;
	}
	if (trimmed.includes(`<${PONYTAIL_PROTECT_TAG}`)) {
		return trimmed;
	}
	return `<${PONYTAIL_PROTECT_TAG} ${PONYTAIL_PROTECT_ATTR}>\n${trimmed}\n</${PONYTAIL_PROTECT_TAG}>`;
}

/** Keep Cursor/Antigravity frontmatter outside the protected block. */
export function wrapPonytailRuleDocument(content) {
	const text = String(content ?? "");
	const match = text.match(/^---[\s\S]*?---\s*/);
	if (!match) {
		return `${wrapCompressionProtected(text)}\n`;
	}
	const frontmatter = match[0];
	const body = text.slice(match[0].length);
	return `${frontmatter}${wrapCompressionProtected(body)}\n`;
}
