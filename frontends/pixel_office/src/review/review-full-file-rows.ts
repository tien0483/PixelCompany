// Reconstructs a whole file as diff rows, so the "Full file" toggle can reuse the
// diff pane's row pipeline instead of rendering plain text beside it.
//
// A unified patch is the file with everything unchanged elided. Filling those gaps
// back in from the fetched post-image turns "full file" into "the diff with every
// context line present" — which means selection, drag-to-range, the comment composer
// and the existing thread/draft annotations all keep working, because every one of
// them is expressed over `UnifiedDiffRow`.
//
// The gap rows are the reason `UnifiedDiffRow.oldLineNumber` exists: an unchanged line
// outside any hunk still has a pre-image twin, and GitLab needs both numbers to anchor
// a note to it (see `backends/runtime/src/gitlab/gitlab-position.ts`).

import { parsePatchToRows, type UnifiedDiffRow } from "@/components/shared/diff-renderer";

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface HunkSpan {
	oldStart: number;
	newStart: number;
	/** Rows `parsePatchToRows` emits for this hunk, in order. */
	rowCount: number;
	/** New-side lines the hunk covers: its added plus its context rows. */
	newCount: number;
	/** Old-side lines the hunk covers: its removed plus its context rows. */
	oldCount: number;
}

/**
 * The hunks of a patch, measured with exactly the predicate `parsePatchToRows` uses,
 * so `rowCount` can slice its output. A line the parser skips (`\ No newline at end
 * of file`, or a bare empty line some servers emit for an empty context line) is
 * skipped here too — the counts stay in step with the rows, and the resulting
 * old/new drift is caught by the text check in `buildFullFileRows` instead.
 */
function measureHunks(patch: string): HunkSpan[] {
	const spans: HunkSpan[] = [];
	let current: HunkSpan | null = null;

	for (const raw of patch.split("\n")) {
		const header = raw.match(HUNK_HEADER);
		if (header) {
			current = {
				oldStart: Number.parseInt(header[1] ?? "0", 10),
				newStart: Number.parseInt(header[2] ?? "0", 10),
				rowCount: 0,
				newCount: 0,
				oldCount: 0,
			};
			spans.push(current);
			continue;
		}
		if (!current) {
			continue;
		}
		if (raw.startsWith("+")) {
			current.rowCount += 1;
			current.newCount += 1;
		} else if (raw.startsWith("-")) {
			current.rowCount += 1;
			current.oldCount += 1;
		} else if (raw.startsWith(" ")) {
			current.rowCount += 1;
			current.newCount += 1;
			current.oldCount += 1;
		}
	}
	return spans;
}

/**
 * Splits the post-image into lines. A file served over the API ends with a newline
 * that is a terminator, not an empty last line — splitting it verbatim is what made
 * every full file render one line longer than it is.
 */
export function splitFileContent(content: string): string[] {
	const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
	return normalized.split("\n");
}

/**
 * The whole file as rows: the patch's own rows where a hunk covers the file, and
 * synthesized `context` rows everywhere else.
 *
 * Returns `null` when the patch and the content disagree — a hunk's own text not
 * matching the file at the line the hunk claims means the two came from different
 * revisions. Rendering that would anchor notes to lines the reviewer never saw, so
 * the caller falls back to the plain diff instead.
 */
export function buildFullFileRows(input: { patch: string; content: string }): UnifiedDiffRow[] | null {
	const { patch, content } = input;
	const fileLines = splitFileContent(content);
	const patchRows = parsePatchToRows(patch);
	const hunks = measureHunks(patch);

	if (hunks.length === 0) {
		// No hunks to splice: the file is unchanged in this MR, or the patch was
		// withheld. Either way the fetched content is still the file.
		return fileLines.map((text, index) => buildGapRow(index + 1, 0, text));
	}

	const rows: UnifiedDiffRow[] = [];
	let rowCursor = 0;
	/** Last new-side line number already emitted. */
	let newCursor = 0;
	let delta = 0;

	for (const hunk of hunks) {
		// Lines between the previous hunk and this one are unchanged, so the old/new
		// offset over the whole gap is the one this hunk's header states.
		delta = hunk.oldStart - hunk.newStart;
		for (let line = newCursor + 1; line < hunk.newStart; line += 1) {
			const text = fileLines[line - 1];
			if (text === undefined) {
				return null;
			}
			rows.push(buildGapRow(line, delta, text));
		}

		const hunkRows = patchRows.slice(rowCursor, rowCursor + hunk.rowCount);
		if (hunkRows.length !== hunk.rowCount) {
			return null;
		}
		for (const row of hunkRows) {
			if (row.variant !== "removed" && row.lineNumber != null && fileLines[row.lineNumber - 1] !== row.text) {
				return null;
			}
			rows.push(row);
		}
		rowCursor += hunk.rowCount;
		newCursor = Math.max(newCursor, hunk.newStart + hunk.newCount - 1);
		delta = hunk.oldStart + hunk.oldCount - (hunk.newStart + hunk.newCount);
	}

	for (let line = newCursor + 1; line <= fileLines.length; line += 1) {
		// `fileLines[line - 1]` is in range by the loop bound.
		rows.push(buildGapRow(line, delta, fileLines[line - 1] ?? ""));
	}

	return rows;
}

/** `f-` keys the parser never mints, so a gap row cannot collide with a hunk row. */
function buildGapRow(newLine: number, delta: number, text: string): UnifiedDiffRow {
	return {
		key: `f-${newLine}`,
		lineNumber: newLine,
		oldLineNumber: newLine + delta,
		variant: "context",
		text,
	};
}
