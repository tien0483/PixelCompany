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
import type { RuntimeGitlabDiffRefs, RuntimeGitlabNotePosition } from "../core/api-contract";

export interface GitlabTextPosition {
	position_type: "text";
	base_sha: string;
	start_sha: string;
	head_sha: string;
	old_path: string;
	new_path: string;
	old_line?: number;
	new_line?: number;
}

export type GitlabPositionResult =
	| { ok: true; position: GitlabTextPosition }
	| { ok: false; error: string };

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
