import type { ReactElement } from "react";

/**
 * "Have I already spent tokens on this pass?"
 *
 * Every control that carries one of these runs over the *whole* merge request, which
 * is the expensive thing in this panel — and nothing about the panel used to say
 * whether a pass had run, so the honest way to find out was to run it again.
 *
 * `stale` exists because "done" is not a property of the button, it is a property of
 * a commit: a review that ran three pushes ago is not the same answer as one that ran
 * against what is on screen, and collapsing the two into a green dot would be a lie
 * that costs a re-read rather than a re-run.
 */
export type ReviewRunState = "unrun" | "done" | "stale";

const DOT_CLASS: Record<ReviewRunState, string> = {
	unrun: "bg-status-red",
	done: "bg-status-green",
	stale: "bg-status-orange",
};

export function ReviewRunDot({ state, label }: { state: ReviewRunState; label: string }): ReactElement {
	return (
		<span
			// Both a title and an aria-label: the dot is 6px of colour, so a reviewer who
			// cannot hover — or cannot distinguish red from green — has no other way to read
			// it. `role="img"` is what makes the label reach a screen reader on a `span`.
			role="img"
			aria-label={label}
			title={label}
			className={`inline-block size-1.5 shrink-0 rounded-full ${DOT_CLASS[state]}`}
		/>
	);
}
