import { ArrowUp, Bot, Check, Network, Trash2, X } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import {
	REVIEW_AGENT_MODEL_OPTIONS,
	type ReviewAgentModelId,
	normalizeReviewAgentModel,
} from "@/review/review-agent-model";
import type { RuntimeReviewDraftComment, RuntimeReviewFinding, RuntimeReviewRuleSeverity } from "@/runtime/types";

/**
 * Slash commands that exist as real skills in this stack. They are prefilled into
 * the input rather than sent immediately, so the reviewer can add a target before
 * spending a turn — a bare `/security-review` on a 40-file MR is rarely what they
 * meant.
 */
export const REVIEW_QUICK_PROMPTS = [
	{ command: "/understand-diff", hint: "What does this change touch?" },
	{ command: "/security-review", hint: "Security pass over the diff" },
	{ command: "/code-review", hint: "General correctness review" },
	{ command: "/simplify", hint: "Simplification opportunities" },
] as const;

const SEVERITY_TONE: Record<RuntimeReviewRuleSeverity, string> = {
	CRITICAL: "bg-status-red/20 text-status-red",
	HIGH: "bg-status-orange/20 text-status-orange",
	MEDIUM: "bg-status-gold/20 text-status-gold",
	LOW: "bg-surface-4 text-text-secondary",
};

export function ReviewClaudePanel({
	chatText,
	chatStatus,
	chatError,
	pendingFindings,
	draftComments,
	isAuditing,
	model,
	onModelChange,
	onSend,
	onCancel,
	onAcceptFinding,
	onDismissFinding,
	onRemoveDraft,
	onJumpToDraft,
}: {
	chatText: string;
	chatStatus: "idle" | "running" | "done" | "error";
	chatError: string | null;
	pendingFindings: RuntimeReviewFinding[];
	draftComments: RuntimeReviewDraftComment[];
	isAuditing: boolean;
	/** Model every review pass runs on — chat, audit and rules extraction alike. */
	model: ReviewAgentModelId;
	onModelChange: (model: ReviewAgentModelId) => void;
	onSend: (prompt: string) => void;
	onCancel: () => void;
	onAcceptFinding: (finding: RuntimeReviewFinding) => void;
	onDismissFinding: (id: string) => void;
	onRemoveDraft: (id: string) => void;
	onJumpToDraft: (draft: RuntimeReviewDraftComment) => void;
}): ReactElement {
	const [input, setInput] = useState("");
	const streamRef = useRef<HTMLDivElement | null>(null);

	// Follow the stream as it grows; a review answer is long and the interesting part
	// is at the bottom.
	useEffect(() => {
		const node = streamRef.current;
		if (node) {
			node.scrollTop = node.scrollHeight;
		}
	}, [chatText]);

	const submit = (): void => {
		const prompt = input.trim();
		if (prompt.length === 0 || chatStatus === "running") {
			return;
		}
		onSend(prompt);
		setInput("");
	};

	return (
		<div className="flex min-h-0 flex-col bg-surface-1" data-testid="review-claude-panel">
			<div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
				<div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
					<Bot size={13} className="text-accent" />
					<span>Claude</span>
					{chatStatus === "running" || isAuditing ? <Spinner size={11} /> : null}
				</div>
				<div className="flex items-center gap-2">
					{/* Switching mid-run would not move the running process, so the control is
					    locked while one is in flight rather than silently lying about it. */}
					<select
						value={model}
						aria-label="Review model"
						title={REVIEW_AGENT_MODEL_OPTIONS.find((option) => option.id === model)?.hint}
						disabled={chatStatus === "running" || isAuditing}
						onChange={(event) => onModelChange(normalizeReviewAgentModel(event.target.value))}
						className="cursor-pointer rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary focus:border-border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
					>
						{REVIEW_AGENT_MODEL_OPTIONS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
					{chatStatus === "running" ? (
						<Button variant="default" size="sm" onClick={onCancel}>
							Stop
						</Button>
					) : null}
				</div>
			</div>

			<div className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2">
				{REVIEW_QUICK_PROMPTS.map((prompt) => (
					<button
						key={prompt.command}
						type="button"
						title={prompt.hint}
						onClick={() => setInput(`${prompt.command} `)}
						className="cursor-pointer rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary hover:text-text-primary"
					>
						{prompt.command}
					</button>
				))}
				<button
					type="button"
					title="Explain how these changes affect the broader codebase"
					disabled={chatStatus === "running"}
					onClick={() =>
						onSend(
							`Analyze how the changes in this merge request affect the broader codebase — without relying on any pre-built knowledge graph.\n\nFor each changed file:\n1. Use Grep to find all files that import or require it (search for the filename and any exported symbols that were modified).\n2. Use Grep to find callers of any functions or classes that were changed.\n3. Note which modules are downstream consumers and whether the changes are breaking, additive, or purely internal.\n\nSummarize: which parts of the codebase are affected, what the risk surface is, and whether any callers need updates.`,
						)
					}
					className="flex cursor-pointer items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
				>
					<Network size={10} />
					Understand changes
				</button>
			</div>

			{pendingFindings.length > 0 ? (
				<div className="shrink-0 space-y-1.5 border-b border-border bg-surface-2 p-2">
					<div className="flex items-center justify-between text-[11px]">
						<span className="font-semibold text-text-primary">Findings to triage</span>
						<span className="rounded bg-surface-4 px-1.5 text-[10px] text-text-secondary">
							{pendingFindings.length} pending
						</span>
					</div>
					<div className="max-h-56 space-y-1.5 overflow-y-auto">
						{pendingFindings.map((finding) => (
							<div key={finding.id} className="space-y-1 rounded border border-border bg-surface-1 p-2 text-xs">
								<div className="flex items-start justify-between gap-1">
									<span className="truncate font-mono text-[10px] text-accent">
										{finding.newPath}
										{finding.newLine !== null ? `:${finding.newLine}` : ""}
									</span>
									<div className="flex shrink-0 items-center gap-1">
										{finding.ruleId ? (
											<span className="rounded border border-border-bright bg-surface-2 px-1 text-[9px] text-text-secondary">
												{finding.ruleId}
											</span>
										) : null}
										<span className={cn("rounded px-1 text-[9px] font-semibold", SEVERITY_TONE[finding.severity])}>
											{finding.severity}
										</span>
									</div>
								</div>
								<p className="text-[11px] leading-snug text-text-secondary">{finding.message}</p>
								<div className="flex justify-end gap-1">
									<Button
										variant="default"
										size="sm"
										icon={<X size={11} />}
										onClick={() => onDismissFinding(finding.id)}
									>
										Dismiss
									</Button>
									<Button
										variant="primary"
										size="sm"
										icon={<Check size={11} />}
										// A finding with no line cannot be positioned as a diff note, so
										// accepting it would create a draft that can never be published.
										disabled={finding.newLine === null}
										title={
											finding.newLine === null
												? "This finding names no line, so it cannot become an inline note"
												: undefined
										}
										onClick={() => onAcceptFinding(finding)}
									>
										Accept to draft
									</Button>
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}

			<div ref={streamRef} className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
				{chatText.length === 0 && chatStatus !== "running" ? (
					<p className="text-text-tertiary">
						Ask about this diff, or run a skill command. Claude sees the changed file list and the file you
						are looking at.
					</p>
				) : null}
				{chatText.length > 0 ? (
					<pre className="whitespace-pre-wrap break-words font-sans text-text-primary">{chatText}</pre>
				) : null}
				{chatError ? <p className="mt-2 text-status-red">{chatError}</p> : null}
			</div>

			{draftComments.length > 0 ? (
				<div className="shrink-0 space-y-1 border-t border-border bg-surface-2 p-2">
					<div className="text-[11px] font-semibold text-text-primary">
						Draft comments ({draftComments.length})
					</div>
					<div className="max-h-32 space-y-1 overflow-y-auto">
						{draftComments.map((draft) => (
							<div
								key={draft.id}
								className="flex items-start justify-between gap-2 rounded border border-border bg-surface-1 p-1.5"
							>
								<button
									type="button"
									className="min-w-0 flex-1 cursor-pointer text-left"
									onClick={() => onJumpToDraft(draft)}
								>
									<div className="truncate font-mono text-[10px] text-accent">
										{draft.newPath}
										{draft.newLine !== null ? `:${draft.newLine}` : draft.oldLine !== null ? `:-${draft.oldLine}` : ""}
									</div>
									<div className="truncate text-[11px] text-text-secondary">{draft.text}</div>
								</button>
								<button
									type="button"
									aria-label="Delete draft comment"
									className="shrink-0 cursor-pointer text-text-tertiary hover:text-status-red"
									onClick={() => onRemoveDraft(draft.id)}
								>
									<Trash2 size={11} />
								</button>
							</div>
						))}
					</div>
				</div>
			) : null}

			<div className="shrink-0 border-t border-border p-2">
				<div className="relative">
					<textarea
						value={input}
						onChange={(event) => setInput(event.target.value)}
						rows={2}
						aria-label="Ask Claude about this merge request"
						placeholder="Ask about this diff, or type a slash command…"
						className="w-full resize-none rounded border border-border bg-surface-0 p-2 pr-9 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								submit();
							}
						}}
					/>
					<button
						type="button"
						aria-label="Send"
						disabled={input.trim().length === 0 || chatStatus === "running"}
						onClick={submit}
						className="absolute bottom-2 right-2 cursor-pointer rounded bg-accent p-1 text-accent-fg disabled:opacity-40"
					>
						<ArrowUp size={12} />
					</button>
				</div>
				<div className="mt-1 px-1 text-[10px] text-text-tertiary">Enter sends · Shift+Enter for a newline</div>
			</div>
		</div>
	);
}
