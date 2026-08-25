// Builds the `position` payload GitLab requires for a diff note.
//
// This is the highest-risk detail of the whole review flow: GitLab answers a
// malformed position with a flat `400 Bad Request` and no field-level reason, so
// a wrong shape looks like "submit is broken" rather than "line 40 is on the
// wrong side of the diff". The rules encoded here:
//
//   * `base_sha` / `start_sha` / `head_sha` must all come from the SAME version
//     of the merge request. They travel as one `diffRefs` unit for that reason.
//   * `old_path` and `new_path` are both always sent. For an added file they are
//     equal; for a rename they differ and GitLab needs both to locate the line.
//   * An added line carries `new_line` only, a removed line `old_line` only, and
//     an unchanged (context) line carries both. Sending both on an added line is
//     rejected, because no `old_line` exists to anchor to.
//   * A multi-line note additionally needs `line_range`, whose endpoints carry a
//     `line_code` — `sha1(new_path)_<old_line>_<new_line>` — and a `type` naming
//     the side. A range without `line_code` is another silent 400.
import { createHash } from "node:crypto";

import type { RuntimeGitlabDiffRefs, RuntimeGitlabNotePosition } from "../core/api-contract";

export interface GitlabLineRangeEndpoint {
	line_code: string;
	type: "new" | "old";
	old_line?: number;
	new_line?: number;
}

export interface GitlabLineRange {
	start: GitlabLineRangeEndpoint;
	end: GitlabLineRangeEndpoint;
}

export interface GitlabTextPosition {
	position_type: "text";
	base_sha: string;
	start_sha: string;
	head_sha: string;
	old_path: string;
	new_path: string;
	old_line?: number;
	new_line?: number;
	line_range?: GitlabLineRange;
}

export type GitlabPositionResult = { ok: true; position: GitlabTextPosition } | { ok: false; error: string };

/**
 * GitLab's line code: the SHA1 of the file path, then the pair of line numbers with
 * a missing side written as 0. The path is always the post-image one, matching
 * GitLab's own `Gitlab::Git` helper — using the pre-image path for an old-side
 * endpoint produces a code GitLab cannot resolve.
 */
function buildLineCode(newPath: string, oldLine: number | null, newLine: number | null): string {
	const digest = createHash("sha1").update(newPath).digest("hex");
	return `${digest}_${oldLine ?? 0}_${newLine ?? 0}`;
}

/** Which side of the diff a range endpoint hangs off. A context line counts as new. */
function resolveEndpointSide(oldLine: number | null, newLine: number | null): "new" | "old" {
	return newLine !== null ? "new" : "old";
}

function buildLineRangeEndpoint(
	newPath: string,
	oldLine: number | null,
	newLine: number | null,
): GitlabLineRangeEndpoint {
	return {
		line_code: buildLineCode(newPath, oldLine, newLine),
		type: resolveEndpointSide(oldLine, newLine),
		...(oldLine !== null ? { old_line: oldLine } : {}),
		...(newLine !== null ? { new_line: newLine } : {}),
	};
}

export function buildTextPosition(input: {
	diffRefs: RuntimeGitlabDiffRefs;
	position: RuntimeGitlabNotePosition;
}): GitlabPositionResult {
	const { diffRefs, position } = input;
	if (!diffRefs.baseSha || !diffRefs.startSha || !diffRefs.headSha) {
		return {
			ok: false,
			error: "The merge request has no diff refs yet — reload it before commenting.",
		};
	}
	const newPath = position.newPath ?? position.oldPath;
	const oldPath = position.oldPath ?? position.newPath;
	if (!newPath || !oldPath) {
		return { ok: false, error: "A diff note needs a file path." };
	}
	if (position.oldLine === null && position.newLine === null) {
		return { ok: false, error: "A diff note needs a line number." };
	}

	const range = buildLineRange({ newPath, position });
	if (!range.ok) {
		return range;
	}

	return {
		ok: true,
		position: {
			position_type: "text",
			base_sha: diffRefs.baseSha,
			start_sha: diffRefs.startSha,
			head_sha: diffRefs.headSha,
			old_path: oldPath,
			new_path: newPath,
			...(position.oldLine !== null ? { old_line: position.oldLine } : {}),
			...(position.newLine !== null ? { new_line: position.newLine } : {}),
			...(range.range ? { line_range: range.range } : {}),
		},
	};
}

/**
 * The `line_range` for a dragged multi-line note, or none for a single line.
 *
 * A range that spans both sides of the diff has no meaning to GitLab — the two
 * endpoints would name lines in different revisions of the file — so it is refused
 * here rather than sent and rejected with a bare 400. A start that equals the end
 * degrades to a plain single-line note instead of erroring: that is what a click
 * (mousedown and mouseup on one row) produces.
 */
function buildLineRange(input: {
	newPath: string;
	position: RuntimeGitlabNotePosition;
}): { ok: true; range?: GitlabLineRange } | { ok: false; error: string } {
	const { newPath, position } = input;
	const lineRange = position.lineRange;
	if (!lineRange) {
		return { ok: true };
	}
	const { startOldLine, startNewLine } = lineRange;
	if (startOldLine === null && startNewLine === null) {
		return { ok: false, error: "A multi-line diff note needs a start line." };
	}

	const startSide = resolveEndpointSide(startOldLine, startNewLine);
	const endSide = resolveEndpointSide(position.oldLine, position.newLine);
	if (startSide !== endSide) {
		return {
			ok: false,
			error: "A multi-line diff note has to stay on one side of the diff.",
		};
	}

	const startLine = startSide === "new" ? startNewLine : startOldLine;
	const endLine = endSide === "new" ? position.newLine : position.oldLine;
	if (startLine === null || endLine === null) {
		return { ok: false, error: "A multi-line diff note needs a line number on both ends." };
	}
	if (startLine > endLine) {
		return { ok: false, error: "A multi-line diff note cannot end before it starts." };
	}
	if (startLine === endLine) {
		return { ok: true };
	}

	return {
		ok: true,
		range: {
			start: buildLineRangeEndpoint(newPath, startOldLine, startNewLine),
			end: buildLineRangeEndpoint(newPath, position.oldLine, position.newLine),
		},
	};
}

export interface PatchLinePair {
	oldLine: number | null;
	newLine: number | null;
}

/**
 * Walks a unified patch to recover the `old_line` that pairs with a post-image
 * line number. AI findings and the UI's line gutter only know the new-side line;
 * an unchanged line still needs its old-side twin, or GitLab anchors the note to
 * the wrong revision of the file.
 *
 * Returns null when the line is not present in the patch at all (context that
 * GitLab elided), which the caller reports rather than guessing at.
 */
export function resolveLinePairFromPatch(patch: string, targetNewLine: number): PatchLinePair | null {
	if (!patch) {
		return null;
	}
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;

	for (const raw of patch.split("\n")) {
		if (raw.startsWith("@@")) {
			const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (match) {
				oldLine = Number.parseInt(match[1] ?? "0", 10);
				newLine = Number.parseInt(match[2] ?? "0", 10);
				inHunk = true;
			}
			continue;
		}
		if (!inHunk) {
			continue;
		}
		// `\ No newline at end of file` is metadata, not a line on either side.
		if (raw.startsWith("\\")) {
			continue;
		}
		if (raw.startsWith("+")) {
			if (newLine === targetNewLine) {
				return { oldLine: null, newLine };
			}
			newLine += 1;
			continue;
		}
		if (raw.startsWith("-")) {
			oldLine += 1;
			continue;
		}
		if (raw.startsWith(" ") || raw === "") {
			if (newLine === targetNewLine) {
				return { oldLine, newLine };
			}
			oldLine += 1;
			newLine += 1;
		}
	}
	return null;
}

/**
 * Counts additions and deletions in a patch. GitLab's diff endpoint sends no
 * per-file line stats, and the file list's ± counters are what tell the reviewer
 * which file to open first.
 */
export function countPatchLines(patch: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const raw of patch.split("\n")) {
		if (raw.startsWith("+++") || raw.startsWith("---")) {
			continue;
		}
		if (raw.startsWith("+")) {
			additions += 1;
		} else if (raw.startsWith("-")) {
			deletions += 1;
		}
	}
	return { additions, deletions };
}
