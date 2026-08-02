import { Fzf } from "fzf";
import {
	AlertCircle,
	ArrowDown,
	ArrowUp,
	ArrowRightLeft,
	Cloud,
	FileText,
	GitBranch,
	Info,
	Locate,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { renderFuzzyHighlightedText } from "@/components/shared/render-fuzzy-highlighted-text";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { RuntimeGitRef } from "@/runtime/types";

const ROW_HEIGHT = 30;
const SELECTED_SUBTLE_TEXT_COLOR = "rgba(255, 255, 255, 0.64)";
const MATCHED_TEXT_STYLE = {
	color: "var(--color-status-blue)",
	fontWeight: 600,
} as const;
const MATCHED_TEXT_STYLE_SELECTED = {
	color: "rgba(255, 255, 255, 0.92)",
	fontWeight: 600,
} as const;
const HEAD_BADGE_BACKGROUND = "color-mix(in srgb, var(--color-status-blue) 15%, transparent)";
const HEAD_BADGE_BACKGROUND_SELECTED = "color-mix(in srgb, white 18%, transparent)";
const isMacPlatform =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

function AheadBehindIndicator({
	ahead,
	behind,
	isSelected = false,
}: {
	ahead?: number;
	behind?: number;
	isSelected?: boolean;
}): React.ReactElement | null {
	if (!ahead && !behind) {
		return null;
	}
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 3,
				fontSize: 10,
				color: isSelected ? SELECTED_SUBTLE_TEXT_COLOR : "var(--color-text-tertiary)",
				flexShrink: 0,
			}}
		>
			{ahead ? (
				<span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
					<ArrowUp size={9} />
					{ahead}
				</span>
			) : null}
			{behind ? (
				<span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
					<ArrowDown size={9} />
					{behind}
				</span>
			) : null}
		</span>
	);
}

export function GitRefsPanel({
	refs,
	selectedRefName,
	isLoading,
	errorMessage,
	panelWidth,
	workingCopyChanges,
	isWorkingCopySelected,
	onSelectRef,
	onSelectWorkingCopy,
	onCheckoutRef,
	onDeleteRef,
	onRefresh,
	isRefreshing,
}: {
	refs: RuntimeGitRef[];
	selectedRefName: string | null;
	isLoading: boolean;
	errorMessage?: string | null;
	panelWidth: number;
	workingCopyChanges: number | null;
	isWorkingCopySelected?: boolean;
	onSelectRef: (ref: RuntimeGitRef) => void;
	onSelectWorkingCopy?: () => void;
	onCheckoutRef?: (branchName: string) => void;
	onDeleteRef?: (branchName: string) => void;
	onRefresh?: () => void;
	isRefreshing?: boolean;
}): React.ReactElement {
	const [searchQuery, setSearchQuery] = useState("");
	const [contextMenu, setContextMenu] = useState<{ branch: string; x: number; y: number } | null>(null);

	useEffect(() => {
		if (!contextMenu) {
			return;
		}
		const close = (): void => setContextMenu(null);
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				setContextMenu(null);
			}
		};
		window.addEventListener("resize", close);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("resize", close);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [contextMenu]);

	const openBranchContextMenu = (branch: string, event: React.MouseEvent): void => {
		if (!onCheckoutRef && !onDeleteRef) {
			return;
		}
		event.preventDefault();
		setContextMenu({ branch, x: event.clientX, y: event.clientY });
	};

	const detachedRef = refs.find((r) => r.type === "detached");
	const branchRefs = refs.filter((r) => r.type === "branch");
	const remoteRefs = refs.filter((r) => r.type === "remote");
	const headBranch = branchRefs.find((r) => r.isHead);
	const otherBranches = branchRefs.filter((r) => !r.isHead);
	const searchableRefs = useMemo(() => [...otherBranches, ...remoteRefs], [otherBranches, remoteRefs]);
	const branchFinder = useMemo(() => new Fzf(searchableRefs, { selector: (ref) => ref.name }), [searchableRefs]);

	const fuzzyBranchResults = useMemo(() => {
		if (!searchQuery.trim()) {
			return [] as ReturnType<Fzf<typeof searchableRefs>["find"]>;
		}
		return branchFinder.find(searchQuery);
	}, [branchFinder, searchQuery]);
	const filteredRefs = useMemo(() => {
		if (!searchQuery.trim()) {
			return searchableRefs;
		}
		return fuzzyBranchResults.map((result) => result.item);
	}, [fuzzyBranchResults, searchableRefs, searchQuery]);
	const filteredOtherBranches = useMemo(() => filteredRefs.filter((ref) => ref.type === "branch"), [filteredRefs]);
	const filteredRemoteRefs = useMemo(() => filteredRefs.filter((ref) => ref.type === "remote"), [filteredRefs]);
	const fuzzyBranchResultsByName = useMemo(
		() => new Map(fuzzyBranchResults.map((result) => [result.item.name, result])),
		[fuzzyBranchResults],
	);

	const showSearch = searchableRefs.length > 0;
	const isHeadBranchSelected =
		!isWorkingCopySelected &&
		(selectedRefName === headBranch?.name || (selectedRefName === null && headBranch?.isHead === true));
	const closeShortcutLabel = isMacPlatform ? "Command G" : "Control G";

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: panelWidth,
				minWidth: 180,
				flexShrink: 0,
				overflow: "hidden",
				background: "var(--color-surface-1)",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "8px 8px 8px 12px",
				}}
			>
				<span
					style={{
						flex: 1,
						fontSize: 14,
						fontWeight: 600,
						color: "var(--color-text-primary)",
					}}
				>
					Git History
				</span>
				{onRefresh ? (
					<Tooltip content="Refresh git history" side="bottom">
						<Button
							variant="ghost"
							size="sm"
							icon={<RefreshCw size={14} className={isRefreshing ? "kb-spin" : undefined} />}
							aria-label="Refresh git history"
							disabled={isRefreshing}
							onClick={onRefresh}
						/>
					</Tooltip>
				) : null}
				<Tooltip
					content={
						<div style={{ maxWidth: 260, whiteSpace: "normal", lineHeight: 1.5 }}>
							<div style={{ fontWeight: 600, marginBottom: 4 }}>Git History</div>
							<div>• Click a branch to inspect its commits.</div>
							<div>• Double-click a branch to switch to it.</div>
							<div>• Right-click a local branch to switch or delete it.</div>
							<div>• Refresh reloads branches, commits, and working copy.</div>
							<div style={{ marginTop: 4 }}>Press {closeShortcutLabel} or Escape to close.</div>
						</div>
					}
					side="bottom"
				>
					<Button variant="ghost" size="sm" icon={<Info size={14} />} aria-label="Git history help" />
				</Tooltip>
			</div>
			<div style={{ overflowY: "auto", overscrollBehavior: "contain", padding: "8px 6px" }}>
				{isLoading ? (
					<div style={{ padding: "4px 6px" }}>
						<div
							className="animate-pulse rounded bg-surface-3"
							style={{ height: ROW_HEIGHT - 4, width: "100%", marginBottom: 4 }}
						/>
						<div
							className="animate-pulse rounded bg-surface-3"
							style={{ height: ROW_HEIGHT - 4, width: "100%", marginBottom: 4 }}
						/>
						<div
							className="animate-pulse rounded bg-surface-3"
							style={{ height: ROW_HEIGHT - 4, width: "100%" }}
						/>
					</div>
				) : errorMessage ? (
					<div
						className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary"
						style={{ minHeight: 180, padding: 12 }}
					>
						<AlertCircle size={48} />
						<h3 className="font-semibold text-text-primary">Could not load refs</h3>
						<p className="text-text-secondary">{errorMessage}</p>
					</div>
				) : (
					<>
						{workingCopyChanges !== null && onSelectWorkingCopy ? (
							<RefRow
								isSelected={isWorkingCopySelected ?? false}
								selectedClassName="kb-git-ref-row-selected-warning"
								onSelect={onSelectWorkingCopy}
							>
								<FileText size={12} style={{ color: "var(--color-status-gold)" }} />
								<span style={{ flex: 1 }}>Working Copy</span>
								<span
									className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs bg-surface-3 text-text-secondary"
									style={{ fontSize: 10 }}
								>
									{workingCopyChanges}
								</span>
							</RefRow>
						) : null}

						{detachedRef ? (
							<RefRow
								isSelected={!isWorkingCopySelected && selectedRefName === detachedRef.name}
								onSelect={() => onSelectRef(detachedRef)}
							>
								<Locate size={12} />
								<span className="kb-line-clamp-1" style={{ flex: 1 }}>
									HEAD ({detachedRef.name})
								</span>
							</RefRow>
						) : null}

						{headBranch ? (
							<RefRow isSelected={isHeadBranchSelected} onSelect={() => onSelectRef(headBranch)}>
								<GitBranch size={12} />
								<span className="kb-line-clamp-1" style={{ flex: 1 }}>
									{headBranch.name}
								</span>
								<AheadBehindIndicator
									ahead={headBranch.ahead}
									behind={headBranch.behind}
									isSelected={isHeadBranchSelected}
								/>
								<span
									className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium"
									style={{
										fontSize: 10,
										backgroundColor: isHeadBranchSelected
											? HEAD_BADGE_BACKGROUND_SELECTED
											: HEAD_BADGE_BACKGROUND,
										color: isHeadBranchSelected ? SELECTED_SUBTLE_TEXT_COLOR : "var(--color-status-blue)",
									}}
								>
									HEAD
								</span>
							</RefRow>
						) : null}

						{showSearch ? (
							<div style={{ padding: "6px 0 4px" }}>
								<div className="relative">
									<Search
										size={14}
										className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
									/>
									<input
										className="h-7 w-full rounded-md border border-border bg-surface-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
										placeholder="Filter refs..."
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
									/>
								</div>
							</div>
						) : null}

						{filteredOtherBranches.map((ref) => {
							const isSelected = !isWorkingCopySelected && selectedRefName === ref.name;
							return (
								<RefRow
									key={ref.name}
									isSelected={isSelected}
									onSelect={() => onSelectRef(ref)}
									onDoubleClick={onCheckoutRef ? () => onCheckoutRef(ref.name) : undefined}
									onContextMenu={
										onCheckoutRef || onDeleteRef
											? (event) => openBranchContextMenu(ref.name, event)
											: undefined
									}
								>
									<GitBranch size={12} />
									<span className="kb-line-clamp-1" style={{ flex: 1 }}>
										{renderFuzzyHighlightedText(
											ref.name,
											fuzzyBranchResultsByName.get(ref.name)?.positions,
											isSelected ? MATCHED_TEXT_STYLE_SELECTED : MATCHED_TEXT_STYLE,
										)}
									</span>
									<AheadBehindIndicator ahead={ref.ahead} behind={ref.behind} isSelected={isSelected} />
								</RefRow>
							);
						})}

						{filteredRemoteRefs.length > 0 ? (
							<>
								<SectionLabel>Remotes</SectionLabel>
								{filteredRemoteRefs.map((ref) => {
									const isSelected = !isWorkingCopySelected && selectedRefName === ref.name;
									return (
										<RefRow key={ref.name} isSelected={isSelected} onSelect={() => onSelectRef(ref)}>
											<Cloud size={12} />
											<span className="kb-line-clamp-1" style={{ flex: 1 }}>
												{renderFuzzyHighlightedText(
													ref.name,
													fuzzyBranchResultsByName.get(ref.name)?.positions,
													isSelected ? MATCHED_TEXT_STYLE_SELECTED : MATCHED_TEXT_STYLE,
												)}
											</span>
										</RefRow>
									);
								})}
							</>
						) : null}

						{searchQuery && filteredRefs.length === 0 ? (
							<div
								style={{
									padding: "8px 8px",
									fontSize: 12,
									color: "var(--color-text-tertiary)",
									textAlign: "center",
								}}
							>
								No matching branches
							</div>
						) : null}
					</>
				)}
			</div>
			{contextMenu ? (
				<BranchContextMenu
					branch={contextMenu.branch}
					x={contextMenu.x}
					y={contextMenu.y}
					onCheckout={
						onCheckoutRef
							? () => {
									onCheckoutRef(contextMenu.branch);
									setContextMenu(null);
								}
							: undefined
					}
					onDelete={
						onDeleteRef
							? () => {
									onDeleteRef(contextMenu.branch);
									setContextMenu(null);
								}
							: undefined
					}
					onClose={() => setContextMenu(null)}
				/>
			) : null}
		</div>
	);
}

function BranchContextMenu({
	branch,
	x,
	y,
	onCheckout,
	onDelete,
	onClose,
}: {
	branch: string;
	x: number;
	y: number;
	onCheckout?: () => void;
	onDelete?: () => void;
	onClose: () => void;
}): React.ReactElement {
	return (
		<>
			{/* Full-viewport backdrop closes the menu on any outside click or right-click. */}
			<div
				style={{ position: "fixed", inset: 0, zIndex: 60 }}
				onClick={onClose}
				onContextMenu={(event) => {
					event.preventDefault();
					onClose();
				}}
			/>
			<div
				role="menu"
				className="kb-branch-context-menu"
				style={{
					position: "fixed",
					top: y,
					left: x,
					zIndex: 61,
					minWidth: 176,
					padding: 4,
					borderRadius: 6,
					border: "1px solid var(--color-border)",
					background: "var(--color-surface-2)",
					boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
				}}
			>
				<div
					style={{
						padding: "4px 8px 6px",
						fontSize: 10,
						fontWeight: 600,
						letterSpacing: "0.03em",
						color: "var(--color-text-tertiary)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{branch}
				</div>
				{onCheckout ? (
					<button type="button" role="menuitem" className="kb-branch-context-menu-item" onClick={onCheckout}>
						<ArrowRightLeft size={13} aria-hidden />
						<span>Switch to branch</span>
					</button>
				) : null}
				{onDelete ? (
					<button
						type="button"
						role="menuitem"
						className="kb-branch-context-menu-item kb-branch-context-menu-item-danger"
						onClick={onDelete}
					>
						<Trash2 size={13} aria-hidden />
						<span>Delete branch</span>
					</button>
				) : null}
			</div>
		</>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
	return (
		<div
			style={{
				padding: "10px 8px 4px",
				fontSize: 10,
				fontWeight: 600,
				letterSpacing: "0.05em",
				textTransform: "uppercase",
				color: "var(--color-text-tertiary)",
			}}
		>
			{children}
		</div>
	);
}

function RefRow({
	isSelected,
	selectedClassName,
	onSelect,
	onDoubleClick,
	onContextMenu,
	children,
}: {
	isSelected: boolean;
	selectedClassName?: string;
	onSelect: () => void;
	onDoubleClick?: () => void;
	onContextMenu?: (event: React.MouseEvent) => void;
	children: React.ReactNode;
}): React.ReactElement {
	const resolvedSelectedClass = selectedClassName ?? "kb-git-ref-row-selected";
	return (
		<div
			className={isSelected ? `kb-git-ref-row ${resolvedSelectedClass}` : "kb-git-ref-row"}
			onContextMenu={onContextMenu}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				width: "100%",
				height: ROW_HEIGHT,
				paddingLeft: 8,
				paddingRight: 4,
				overflow: "hidden",
				borderRadius: 4,
				color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
			}}
		>
			<button
				type="button"
				onClick={onSelect}
				onDoubleClick={onDoubleClick}
				className="kb-git-ref-row-main"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					flex: 1,
					minWidth: 0,
					height: "100%",
					padding: 0,
					border: "none",
					background: "transparent",
					color: "inherit",
					textAlign: "left",
					fontFamily: "inherit",
					fontSize: 12,
					cursor: "pointer",
				}}
			>
				{children}
			</button>
		</div>
	);
}
