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
 * The body of the ```suggestions fence, or null when there is none.
 *
 * Only that fence counts. A chat answer is mostly prose and routinely contains code
 * samples, so scanning the whole message for the first `[` — the way the audit parser
 * can safely do — would happily turn a TypeScript array literal in an explanation
 * into a list of review comments. An answer with no such fence carries nothing
 * structured, which is the common and correct case.
 */
function suggestionsFenceBody(text: string): string | null {
	const fenced = new RegExp(`\`\`\`${SUGGESTIONS_FENCE}\\s*([\\s\\S]*?)\`\`\``).exec(text);
	return typeof fenced?.[1] === "string" ? fenced[1] : null;
}

/** Suggestions appended to a chat answer. */
export function parseSuggestionsFromChat(text: string): RuntimeReviewFinding[] {
	const body = suggestionsFenceBody(text);
	if (body === null) {
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

export interface ReviewAnnotationVerdictResult {
	annotationId: string;
	verdict: "confirmed" | "not_an_issue" | "partial";
	reasoning: string;
}

/**
 * Verdict elements out of a parsed array. Strict about shape — an unknown verdict
 * value is dropped, not defaulted, because a wrong verdict is worse than none. A
 * findings element has no `annotationId` and so falls out here, which is what lets
 * both kinds share one array.
 */
function coerceVerdicts(parsed: unknown): ReviewAnnotationVerdictResult[] {
	if (!Array.isArray(parsed)) {
		return [];
	}
	const verdicts: ReviewAnnotationVerdictResult[] = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const annotationId = typeof record.annotationId === "string" ? record.annotationId : null;
		const verdict = record.verdict;
		if (!annotationId || (verdict !== "confirmed" && verdict !== "not_an_issue" && verdict !== "partial")) {
			continue;
		}
		verdicts.push({
			annotationId,
			verdict,
			reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
		});
	}
	return verdicts;
}

/**
 * Verdict elements mixed into the audit's findings array. Same lenient extraction as
 * `parseFindingsFromStream`, because the audit's whole answer is meant to be JSON.
 */
export function parseVerdictsFromStream(text: string): ReviewAnnotationVerdictResult[] {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	for (const body of [fenced?.[1], text]) {
		if (typeof body !== "string") {
			continue;
		}
		const parsed = parseFirstArray(body);
		if (parsed === null || !Array.isArray(parsed)) {
			continue;
		}
		return coerceVerdicts(parsed);
	}
	return [];
}

/**
 * Verdicts mixed into a chat turn's suggestions block, answering the spots the
 * reviewer flagged before running the command. Fence-only for the same reason
 * `parseSuggestionsFromChat` is: a chat answer is prose, and an id-shaped object in
 * an explanation must never become review state.
 */
export function parseVerdictsFromChat(text: string): ReviewAnnotationVerdictResult[] {
	const body = suggestionsFenceBody(text);
	if (body === null) {
		return [];
	}
	return coerceVerdicts(parseFirstArray(body));
}
