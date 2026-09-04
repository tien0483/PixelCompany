/**
 * Caps for the workspace git reads.
 *
 * Every value here exists because the corresponding read was unbounded and a
 * large repository (98k commits, 600+ refs, or a vendor-drop commit) turned it
 * into a multi-second, multi-hundred-megabyte request that blocked the board.
 * The two limits the wire protocol also needs live in `core/api-contract.ts`
 * and are re-exported below so callers have a single import.
 */
import { GIT_LOG_MAX_COUNT_LIMIT, GIT_LOG_MAX_SKIP } from "../core/api-contract.js";

export { GIT_LOG_MAX_COUNT_LIMIT, GIT_LOG_MAX_SKIP };

/** Wall-clock ceiling for a single git invocation on a read path. */
export const GIT_READ_TIMEOUT_MS = 15_000;

export const GIT_LOG_DEFAULT_MAX_COUNT = 200;

/**
 * `git rev-list --count` walks the whole history. Capping the walk makes the
 * count a lower bound on big repos, which the response reports through
 * `totalCountIsExact`.
 */
export const GIT_LOG_TOTAL_COUNT_PROBE_LIMIT = 10_000;

/**
 * How far the selected-vs-upstream divergence walk goes. Only feeds per-row
 * tinting, so a cap costs colour on ancient rows, never correctness.
 */
export const GIT_LOG_RELATION_MAX_COMMITS = 1_000;

/** Most recently updated refs to return. A CI-heavy remote can carry thousands. */
export const GIT_REFS_MAX_COUNT = 300;

export const COMMIT_DIFF_MAX_FILES = 300;

/**
 * Files with more changed lines than this ship without a patch. Chosen well
 * above the UI's own `LARGE_FILE_DIFF_LINE_THRESHOLD` (400, in
 * `frontends/pixel_office/src/components/shared/diff-renderer.tsx`) so every
 * file the UI would auto-expand still arrives with its diff.
 */
export const COMMIT_DIFF_PATCH_LINE_LIMIT = 2_000;

export const COMMIT_DIFF_MAX_FILE_PATCH_BYTES = 256 * 1024;
export const COMMIT_DIFF_MAX_TOTAL_PATCH_BYTES = 4 * 1024 * 1024;

/** `git show --patch` for a whole commit needs more room than the 10 MB default. */
export const COMMIT_DIFF_GIT_MAX_BUFFER_BYTES = 48 * 1024 * 1024;

/**
 * Per-side cap for a conflicted file. The resolver ships four copies of it (base,
 * ours, theirs, and the marker-bearing working-tree merge), so the effective cost
 * is four times this. Matched to `WORKSPACE_CHANGES_MAX_FILE_BYTES` below, which is
 * the comparable read; past it the file arrives with `contentOmitted` and the UI
 * offers only a whole-file pick.
 */
export const CONFLICT_FILE_MAX_BYTES = 512 * 1024;

export const WORKSPACE_CHANGES_MAX_FILES = 500;
export const WORKSPACE_CHANGES_MAX_FILE_BYTES = 512 * 1024;
export const WORKSPACE_CHANGES_CONCURRENCY = 8;

/** Untracked files read whole just to count their lines for the `+N` badge. */
export const UNTRACKED_ADDITION_SCAN_MAX_FILES = 200;
export const UNTRACKED_ADDITION_MAX_FILE_BYTES = 1024 * 1024;

/** Paths that get a `stat()` per poll tick to detect working-tree changes. */
export const UNTRACKED_FINGERPRINT_MAX_PATHS = 500;

export const PATH_FINGERPRINT_CONCURRENCY = 16;
