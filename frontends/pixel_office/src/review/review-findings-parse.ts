import type { RuntimeReviewFinding } from "@/runtime/types";

/**
 * Parsing for the two places an agent hands the panel positionable findings: the
 * audit route, whose whole answer is a JSON array, and a chat turn that ran a review
 * slash command and appended a fenced block.
 *
 * Both are lenient about a code fence and surrounding prose for the same reason the
 * runtime's own parsers are: one stray sentence should not throw away a whole review
 * pass. They are strict about the *shape* of each element, because a finding without
 * a path and a message cannot be rendered, and one without a line cannot be posted.
 */

/** The fence the chat asks for suggestions in. Mirrors `REVIEW_SUGGESTIONS_FENCE`. */
const SUGGESTIONS_FENCE = "suggestions";

function coerceFindings(parsed: unknown, idPrefix: string): RuntimeReviewFinding[] {
	if (!Array.isArray(parsed)) {
		return [];
	}
	const findings: RuntimeReviewFinding[] = [];
	parsed.forEach((item, index) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			return;
		}
		const record = item as Record<string, unknown>;
		const newPath = typeof record.newPath === "string" ? record.newPath : null;
		const message = typeof record.message === "string" ? record.message : null;
		if (!newPath || !message) {
			return;
		}
		const severityRaw = typeof record.severity === "string" ? record.severity.toUpperCase() : "MEDIUM";
		findings.push({
			// Derived from position and content, not the array index alone, so a re-run
			// that finds the same problem reuses the id the reviewer already dismissed
			// instead of resurrecting it.
			id: `${idPrefix}-${newPath}-${String(record.newLine ?? "x")}-${index}`,
			newPath,
			newLine: typeof record.newLine === "number" && Number.isFinite(record.newLine) ? record.newLine : null,
			ruleId: typeof record.ruleId === "string" && record.ruleId.length > 0 ? record.ruleId : null,
			severity:
				severityRaw === "CRITICAL" || severityRaw === "HIGH" || severityRaw === "LOW" ? severityRaw : "MEDIUM",
			message,
		});
	});
	return findings;
}

/** The first bracketed array in a body, parsed. Null when there is nothing parseable. */
function parseFirstArray(body: string): unknown | null {
	const start = body.indexOf("[");
	const end = body.lastIndexOf("]");
	if (start < 0 || end <= start) {
		return null;
	}
	try {
		return JSON.parse(body.slice(start, end + 1)) as unknown;
	} catch {
		return null;
	}
}

/**
 * Findings from an audit stream, whose entire answer is meant to be a JSON array.
 * Tries a fenced body first, then the raw text.
 */
export function parseFindingsFromStream(text: string): RuntimeReviewFinding[] {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	for (const body of [fenced?.[1], text]) {
		if (typeof body !== "string") {
			continue;
		}
		const parsed = parseFirstArray(body);
		if (parsed !== null) {
			return coerceFindings(parsed, "finding");
		}
	}
	return [];
}

/**
 * Suggestions appended to a chat answer.
 *
 * Only the ```suggestions fence counts. A chat answer is mostly prose and routinely
 * contains code samples, so scanning the whole message for the first `[` — the way
 * the audit parser can safely do — would happily turn a TypeScript array literal in
 * an explanation into a list of review comments. An answer with no such fence has no
 * suggestions, which is the common and correct case.
 */
export function parseSuggestionsFromChat(text: string): RuntimeReviewFinding[] {
	const fenced = new RegExp(`\`\`\`${SUGGESTIONS_FENCE}\\s*([\\s\\S]*?)\`\`\``).exec(text);
	const body = fenced?.[1];
	if (typeof body !== "string") {
		return [];
	}
	const parsed = parseFirstArray(body);
	return parsed === null ? [] : coerceFindings(parsed, "suggestion");
}

/**
 * The answer with its suggestions fence removed, for display. The block is rendered
 * as triage rows instead, and leaving the raw JSON in the transcript would make every
 * slash command look like it malfunctioned.
 */
export function stripSuggestionsBlock(text: string): string {
	return text.replace(new RegExp(`\`\`\`${SUGGESTIONS_FENCE}[\\s\\S]*?\`\`\``, "g"), "").trimEnd();
}
