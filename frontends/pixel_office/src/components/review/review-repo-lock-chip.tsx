import { Lock, Unlock } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/components/ui/cn";
import type { RuntimeProjectSummary } from "@/runtime/types";

/** The select's "no pin" option. Empty rather than a sentinel: it is never persisted. */
const FOLLOW_SHELL_VALUE = "";

/** Last path segment of a checkout, for labelling a project that is no longer listed. */
function basename(path: string): string {
	const segments = path.split(/[/\\]/).filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? path;
}

/**
 * Which local checkout this review reads — its knowledge graph, its slash commands, the
 * chat agent's cwd.
 *
 * It exists because that repository used to be an invisible consequence of the sidebar's
 * project selection: a merge request opened while another project was selected answered
 * every impact question about the wrong repository, and nothing on screen said so. The
 * pin makes the choice explicit and durable; this chip makes it visible and correctable.
 *
 * A plain `<select>` for the same reason `SeatPicker` is one — a header control with a
 * handful of options does not need a menu primitive.
 */
export function ReviewRepoLockChip({
	projects,
	lockedPath,
	shellRepoPath,
	onLock,
	onUnlock,
}: {
	projects: RuntimeProjectSummary[];
	lockedPath: string | null;
	/** The project the shell currently points at, used only to flag a mismatch. */
	shellRepoPath: string | undefined;
	onLock: (path: string) => void;
	onUnlock: () => void;
}): ReactElement | null {
	// The standalone Review package has no project list and no local checkout at all,
	// so there is nothing to pin and nothing to say about it.
	if (projects.length === 0 && lockedPath === null) {
		return null;
	}

	// A pinned project that has since been removed from the sidebar is still honoured —
	// the runtime takes any path — so it is offered as its own option rather than
	// silently resolving back to the shell's project, which is the bug this fixes.
	const isListed = lockedPath !== null && projects.some((project) => project.path === lockedPath);
	const isMismatched =
		lockedPath !== null && shellRepoPath !== undefined && shellRepoPath.length > 0 && lockedPath !== shellRepoPath;

	const title =
		lockedPath === null
			? "This review follows the project selected in the sidebar. Pin a repository to stop it moving."
			: isMismatched
				? `Review is reading ${lockedPath}, not your selected project ${shellRepoPath}.`
				: `Review is reading ${lockedPath}.`;

	return (
		<span className="flex shrink-0 items-center gap-1" data-testid="review-repo-lock-chip" title={title}>
			{lockedPath === null ? (
				<Unlock size={11} className="text-text-tertiary" />
			) : (
				<Lock size={11} className={isMismatched ? "text-status-orange" : "text-text-secondary"} />
			)}
			<select
				aria-label="Local repository this review reads"
				data-testid="review-repo-lock-select"
				value={lockedPath ?? FOLLOW_SHELL_VALUE}
				onChange={(event) => {
					const next = event.target.value;
					if (next === FOLLOW_SHELL_VALUE) {
						onUnlock();
						return;
					}
					onLock(next);
				}}
				className={cn(
					"max-w-44 truncate rounded border bg-surface-2 px-1.5 py-0.5 text-[11px] focus:border-border-focus focus:outline-none",
					isMismatched ? "border-status-orange text-status-orange" : "border-border text-text-secondary",
				)}
			>
				<option value={FOLLOW_SHELL_VALUE}>Follow sidebar project</option>
				{projects.map((project) => (
					<option key={project.id} value={project.path}>
						{project.name}
					</option>
				))}
				{lockedPath !== null && !isListed ? (
					<option value={lockedPath}>{basename(lockedPath)} (not in project list)</option>
				) : null}
			</select>
		</span>
	);
}
