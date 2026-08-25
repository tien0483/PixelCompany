import { FolderTree, Plus, Quote, RefreshCw, Search, Trash2 } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeReviewRule, RuntimeReviewRuleSeverity } from "@/runtime/types";

const SEVERITY_TONE: Record<RuntimeReviewRuleSeverity, string> = {
	CRITICAL: "bg-status-red/20 text-status-red",
	HIGH: "bg-status-orange/20 text-status-orange",
	MEDIUM: "bg-status-gold/20 text-status-gold",
	LOW: "bg-surface-4 text-text-secondary",
};

export function ReviewRulesPanel({
	rules,
	generatedAt,
	isExtracting,
	canCite,
	sourceRoots,
	isSavingSourceRoots,
	suggestedSourceRoot,
	onCite,
	onRefresh,
	onSaveSourceRoots,
}: {
	rules: RuntimeReviewRule[];
	generatedAt: string | null;
	isExtracting: boolean;
	/** False when no comment composer is open, so "Cite" would have nowhere to land. */
	canCite: boolean;
	/** Guideline paths the extraction agent reads. Extraction cannot run while empty. */
	sourceRoots: string[];
	isSavingSourceRoots: boolean;
	/** The reviewer's local checkout, offered as the first path. Absent in the standalone app. */
	suggestedSourceRoot?: string;
	onCite: (ruleId: string) => void;
	onRefresh: () => void;
	onSaveSourceRoots: (sourceRoots: string[]) => void;
}): ReactElement {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<string | null>(null);
	const [draftRoot, setDraftRoot] = useState("");
	// Open by default when nothing is configured: that is the state in which the
	// panel is otherwise a dead end, and the section is the only way out of it.
	const [isSourcesOpen, setIsSourcesOpen] = useState(sourceRoots.length === 0);

	const addDraftRoot = (): void => {
		const root = draftRoot.trim();
		if (root.length === 0 || sourceRoots.includes(root)) {
			setDraftRoot("");
			return;
		}
		onSaveSourceRoots([...sourceRoots, root]);
		setDraftRoot("");
	};

	const categories = useMemo(() => {
		const seen = new Set<string>();
		for (const rule of rules) {
			seen.add(rule.category);
		}
		return [...seen].sort((left, right) => left.localeCompare(right));
	}, [rules]);

	const visibleRules = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return rules.filter((rule) => {
			if (category !== null && rule.category !== category) {
				return false;
			}
			if (needle.length === 0) {
				return true;
			}
			return (
				rule.id.toLowerCase().includes(needle) ||
				rule.title.toLowerCase().includes(needle) ||
				rule.summary.toLowerCase().includes(needle) ||
				rule.antiPattern.toLowerCase().includes(needle)
			);
		});
	}, [category, query, rules]);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="review-rules-panel">
			<div className="space-y-2 border-b border-border p-2">
				<div className="relative">
					<Search size={12} className="absolute left-2 top-2 text-text-tertiary" />
					<input
						type="text"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search guidelines, lint & anti-patterns…"
						aria-label="Search rules"
						className="w-full rounded border border-border bg-surface-2 py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>
				{categories.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						<CategoryChip label="All" active={category === null} onSelect={() => setCategory(null)} />
						{categories.map((name) => (
							<CategoryChip
								key={name}
								label={name}
								active={category === name}
								onSelect={() => setCategory(name)}
							/>
						))}
					</div>
				) : null}
			</div>

			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
				<div className="rounded-md border border-border bg-surface-2">
					<button
						type="button"
						onClick={() => setIsSourcesOpen((open) => !open)}
						className="flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-semibold text-text-primary"
					>
						<span className="flex items-center gap-1.5">
							<FolderTree size={11} className="text-accent" />
							Rule sources
						</span>
						<span className="text-[10px] font-normal text-text-tertiary">
							{sourceRoots.length === 0 ? "none set" : `${sourceRoots.length} path${sourceRoots.length === 1 ? "" : "s"}`}
						</span>
					</button>

					{isSourcesOpen ? (
						<div className="space-y-1.5 border-t border-border p-2">
							<p className="text-[10px] leading-snug text-text-tertiary">
								Guideline documents and lint configuration the extraction agent reads. Files or
								directories, absolute paths.
							</p>

							{sourceRoots.map((root) => (
								<div
									key={root}
									className="flex items-center justify-between gap-1 rounded border border-border bg-surface-1 px-1.5 py-1"
								>
									<span className="truncate font-mono text-[10px] text-text-secondary" title={root}>
										{root}
									</span>
									<button
										type="button"
										aria-label={`Remove ${root}`}
										disabled={isSavingSourceRoots}
										className="shrink-0 cursor-pointer text-text-tertiary hover:text-status-red disabled:opacity-40"
										onClick={() => onSaveSourceRoots(sourceRoots.filter((entry) => entry !== root))}
									>
										<Trash2 size={11} />
									</button>
								</div>
							))}

							<div className="flex gap-1">
								<input
									type="text"
									value={draftRoot}
									onChange={(event) => setDraftRoot(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											addDraftRoot();
										}
									}}
									placeholder="/path/to/docs or CONTRIBUTING.md"
									aria-label="Add a rule source path"
									className="min-w-0 flex-1 rounded border border-border bg-surface-0 px-1.5 py-1 font-mono text-[10px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								/>
								<Button
									variant="default"
									size="sm"
									icon={<Plus size={11} />}
									disabled={isSavingSourceRoots || draftRoot.trim().length === 0}
									onClick={addDraftRoot}
								>
									Add
								</Button>
							</div>

							{/* One click for the common case — the repo the reviewer already has open. */}
							{suggestedSourceRoot && !sourceRoots.includes(suggestedSourceRoot) ? (
								<button
									type="button"
									disabled={isSavingSourceRoots}
									onClick={() => onSaveSourceRoots([...sourceRoots, suggestedSourceRoot])}
									className="w-full cursor-pointer truncate rounded border border-dashed border-border px-1.5 py-1 text-left font-mono text-[10px] text-text-tertiary hover:text-text-primary disabled:opacity-40"
									title={suggestedSourceRoot}
								>
									+ this project: {suggestedSourceRoot}
								</button>
							) : null}
						</div>
					) : null}
				</div>

				{rules.length === 0 ? (
					<div className="space-y-2 px-1 py-2">
						<p className="text-xs text-text-tertiary">
							No rules have been extracted for this project yet. Extraction reads your team's guideline
							documents and lint configuration and turns them into citable rules.
							{sourceRoots.length === 0 ? " Add a rule source above to enable it." : ""}
						</p>
					</div>
				) : null}

				{rules.length > 0 && visibleRules.length === 0 ? (
					<p className="px-1 py-2 text-xs text-text-tertiary">No rule matches that search.</p>
				) : null}

				{visibleRules.map((rule) => (
					<div key={rule.id} className="space-y-1.5 rounded-md border border-border bg-surface-2 p-2">
						<div className="flex items-start justify-between gap-1">
							<span className="font-mono text-[11px] font-semibold text-accent">{rule.id}</span>
							<span
								className={cn(
									"shrink-0 rounded px-1.5 text-[9px] font-semibold",
									SEVERITY_TONE[rule.severity],
								)}
							>
								{rule.severity}
							</span>
						</div>
						<div className="text-xs font-semibold text-text-primary">{rule.title}</div>
						<p className="text-[11px] leading-snug text-text-secondary">{rule.summary}</p>
						<div className="space-y-0.5 rounded bg-surface-0 p-1.5 font-mono text-[10px]">
							<div className="truncate text-status-red" title={rule.antiPattern}>
								✗ {rule.antiPattern}
							</div>
							<div className="truncate text-status-green" title={rule.bestPractice}>
								✓ {rule.bestPractice}
							</div>
						</div>
						<div
							className="truncate text-[10px] text-text-tertiary"
							title={`${rule.sourcePath}${rule.sourceAnchor ? ` — ${rule.sourceAnchor}` : ""}`}
						>
							{rule.sourcePath}
							{rule.sourceAnchor ? ` — ${rule.sourceAnchor}` : ""}
						</div>
						<Button
							variant="default"
							size="sm"
							fill
							icon={<Quote size={11} />}
							disabled={!canCite}
							// Disabled rather than hidden, with the reason in the tooltip: the
							// button vanishing when no composer is open reads as a broken panel.
							title={canCite ? `Cite ${rule.id} in the open comment` : "Open a line comment first"}
							onClick={() => onCite(rule.id)}
						>
							Cite in comment
						</Button>
					</div>
				))}
			</div>

			<div className="flex items-center justify-between gap-2 border-t border-border p-2">
				<span className="truncate text-[10px] text-text-tertiary">
					{generatedAt ? `Extracted ${new Date(generatedAt).toLocaleDateString()}` : "Never extracted"}
					{rules.length > 0 ? ` · ${rules.length} rules` : ""}
				</span>
				<Button
					variant="default"
					size="sm"
					icon={isExtracting ? <Spinner size={12} /> : <RefreshCw size={12} />}
					// Disabled rather than failing on click: extraction with no source roots
					// has nothing to read, and the reason belongs on the control, not in a
					// toast that points at a panel the reviewer is already looking at.
					disabled={isExtracting || sourceRoots.length === 0}
					title={sourceRoots.length === 0 ? "Add a rule source first" : undefined}
					onClick={onRefresh}
				>
					{isExtracting ? "Extracting…" : rules.length === 0 ? "Extract rules" : "Refresh"}
				</Button>
			</div>
		</div>
	);
}

function CategoryChip({
	label,
	active,
	onSelect,
}: {
	label: string;
	active: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"cursor-pointer rounded border px-2 py-0.5 text-[10px]",
				active
					? "border-border-bright bg-surface-4 text-text-primary"
					: "border-border bg-surface-2 text-text-secondary hover:text-text-primary",
			)}
		>
			{label}
		</button>
	);
}
