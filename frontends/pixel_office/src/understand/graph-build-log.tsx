import { type ReactElement, useEffect, useRef } from "react";

import { Spinner } from "@/components/ui/spinner";
import type { RuntimeAgentProgressLine } from "@/runtime/types";

/**
 * The live log of a knowledge-graph build.
 *
 * Exists because a rebuild used to render as a single overwriting line —
 * `run_command (ACTIVE)` — for minutes on end. That is genuinely all the
 * Antigravity CLI puts on its stream for a tool step; the commands it runs and
 * their output come from its brain transcript, which the runtime now follows and
 * forwards as `progress` lines. Rendering them as an append-only list is the
 * whole difference between "the button did nothing" and a visible pipeline.
 *
 * Owns its own scrolling, since two call sites (the centre view while building,
 * the bottom panel afterwards) want identical behaviour.
 */
export interface GraphBuildLogProps {
	/** Append-only, oldest first. */
	progress: RuntimeAgentProgressLine[];
	/** Failures, rendered last so they are never scrolled past. */
	errors: string[];
	/** The agent's closing prose, streamed as `delta`. */
	summary: string;
	/** The current step from the wire, shown as the spinner caption. */
	currentStep: string | null;
	isPaused: boolean;
	/** Shown while nothing has arrived yet. */
	pendingLabel: string;
	className?: string;
}

/**
 * `command` is a tool call, `output` its result, `phase` the agent's own
 * narration, `notice` something informational from agy's log. Muting `output`
 * matters: a single tool result can be four lines of a directory listing, and it
 * must not compete with the phase line above it.
 */
const PROGRESS_LINE_CLASS: Record<RuntimeAgentProgressLine["kind"], string> = {
	command: "text-status-blue/90",
	output: "text-text-tertiary",
	phase: "text-text-primary",
	notice: "text-status-orange/90",
	error: "text-status-red/90",
};

export function GraphBuildLog({
	progress,
	errors,
	summary,
	currentStep,
	isPaused,
	pendingLabel,
	className,
}: GraphBuildLogProps): ReactElement {
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) {
			return;
		}
		// `scrollTo` is absent in jsdom, which is where this component is asserted on.
		if (typeof element.scrollTo === "function") {
			element.scrollTo({ top: element.scrollHeight });
		} else {
			element.scrollTop = element.scrollHeight;
		}
	}, [progress.length, summary, errors.length]);

	const isEmpty = progress.length === 0 && summary.length === 0 && errors.length === 0;

	return (
		<div ref={scrollRef} className={className}>
			{isEmpty ? (
				<div className="flex items-center gap-2 py-2 text-text-tertiary">
					<Spinner size={12} />
					<span>{pendingLabel}</span>
				</div>
			) : (
				<div className="flex flex-col gap-0.5">
					{progress.map((line, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: progress is append-only.
						<div key={index} className={`break-words ${PROGRESS_LINE_CLASS[line.kind]}`}>
							{line.kind === "command" ? `$ ${line.line}` : line.line}
						</div>
					))}
					{summary ? <div className="whitespace-pre-wrap break-words pt-1">{summary}</div> : null}
					{errors.map((line, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only.
						<div key={index} className="break-words text-status-red/90">
							{line}
						</div>
					))}
					{!isPaused && currentStep ? (
						<div className="flex items-center gap-1.5 pt-1 text-text-tertiary">
							<Spinner size={10} />
							<span>{currentStep}</span>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}
