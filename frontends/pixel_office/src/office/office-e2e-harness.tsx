import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { Building2, FolderGit2, GitBranch, LayoutGrid, Terminal } from "lucide-react";

import type { RuntimeManagerSnapshot, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";
import { HomeSidebarManagerPanel, HomeSidebarManagerTab } from "@/components/home-sidebar-manager";
import { ManagerAccountsView } from "@/manager/manager-accounts-view";
import { OfficeView } from "./office-view.js";

/**
 * Deterministic fixture used by Playwright visual tests.
 *
 * Mounted only when the page is opened with `?officeE2e=1`, so production users
 * never see it. It does not need the Kanban runtime or Manager: the office
 * renders from this in-memory board/sessions/jacked snapshot alone.
 *
 * The chrome mirrors the three-pane home: sidebar + board center + right
 * Accounts|Office column.
 */
function buildFixtureBoard(): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "in_progress",
				title: "In Progress",
				cards: [
					{
						id: "e2e-task-claude",
						title: "Wire office canvas",
						prompt: "Port PixelOffice into Kanban",
						startInPlanMode: false,
						agentId: "claude",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
					{
						id: "e2e-task-cursor",
						title: "Add cursor agent",
						prompt: "Launch cursor-agent from Kanban",
						startInPlanMode: false,
						agentId: "cursor",
						baseRef: "main",
						createdAt: 2,
						updatedAt: 2,
					},
				],
			},
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: "e2e-task-review",
						title: "Review jacked bridge",
						prompt: "Check manager_state_updated stream",
						startInPlanMode: false,
						agentId: "codex",
						baseRef: "main",
						createdAt: 3,
						updatedAt: 3,
					},
				],
			},
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [
			{
				id: "dep-1",
				fromTaskId: "e2e-task-claude",
				toTaskId: "e2e-task-cursor",
				createdAt: 1,
			},
		],
	};
}

function buildEmptyBoard(): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function buildFixtureSessions(): Record<string, RuntimeTaskSessionSummary> {
	return {
		"e2e-task-claude": {
			taskId: "e2e-task-claude",
			state: "running",
			agentId: "claude",
			workspacePath: null,
			pid: 11,
			startedAt: 1,
			updatedAt: 1,
			activeRunMs: 0,
			runningSince: null,
			pausedAt: null,
			pauseReason: null,
			lastOutputAt: 1,
			reviewReason: null,
			exitCode: null,
			lastHookAt: 1,
			latestHookActivity: {
				activityText: "Editing board-to-office.ts",
				toolName: "Edit",
				toolInputSummary: null,
				finalMessage: null,
				hookEventName: null,
				notificationType: null,
				source: null,
				planText: null,
			},
		},
		"e2e-task-cursor": {
			taskId: "e2e-task-cursor",
			state: "running",
			agentId: "cursor",
			workspacePath: null,
			pid: 12,
			startedAt: 2,
			updatedAt: 2,
			activeRunMs: 0,
			runningSince: null,
			pausedAt: null,
			pauseReason: null,
			lastOutputAt: 2,
			reviewReason: null,
			exitCode: null,
			lastHookAt: 2,
			latestHookActivity: {
				activityText: "Reading agent catalog",
				toolName: "Read",
				toolInputSummary: null,
				finalMessage: null,
				hookEventName: null,
				notificationType: null,
				source: null,
				planText: null,
			},
		},
		"e2e-task-review": {
			taskId: "e2e-task-review",
			state: "awaiting_review",
			agentId: "codex",
			workspacePath: null,
			pid: null,
			startedAt: 3,
			updatedAt: 3,
			activeRunMs: 0,
			runningSince: null,
			pausedAt: null,
			pauseReason: null,
			lastOutputAt: 3,
			reviewReason: "attention",
			exitCode: 0,
			lastHookAt: 3,
			latestHookActivity: {
				activityText: "Ready for review",
				toolName: null,
				toolInputSummary: null,
				finalMessage: "Diff looks good",
				hookEventName: null,
				notificationType: null,
				source: null,
				planText: null,
			},
		},
	};
}

function buildFixtureManager(pressure: number): RuntimeManagerSnapshot {
	const clamp = Math.min(1, Math.max(0, pressure));
	const account = (
		id: number,
		email: string,
		accountPressure: number,
		canAutoSwap: boolean,
		isActive: boolean,
		provider: "claude" | "cursor" = "claude",
	) => ({
		id,
		email,
		provider,
		displayName: email.split("@")[0] ?? email,
		organizationName: null as string | null,
		isActive,
		fiveHourPercent: Math.round(accountPressure * 100),
		sevenDayPercent: Math.round(accountPressure * 80),
		fiveHourResetsAt: null as string | null,
		sevenDayResetsAt: null as string | null,
		usageCachedAt: null as number | null,
		subscriptionType: null as string | null,
		donateLimitPercent: 100,
		pressure: accountPressure,
		nextRefreshAt: null as number | null,
		canAutoSwap,
		canTrackUsage: true,
		hasCcToken: provider === "claude",
		isActiveForProvider: provider === "cursor" ? id === 3 : id === 1,
		validationStatus: "valid",
		lastError: null,
	});
	return {
		version: "e2e",
		pressure: clamp,
		accounts: [
			// A realistic fleet: two Claude seats plus one Cursor import.
			account(1, "claude@example.com", clamp * 0.9, true, true),
			account(2, "claude-spare@example.com", clamp * 0.45, true, true),
			account(3, "cursor@example.com", clamp * 0.2, false, true, "cursor"),
		],
		activeAccountId: 1,
		autoSwapEnabled: true,
		fetchedAt: 1_700_000_000_000,
		stale: false,
		// Spread across all four categories so the Manager shelves (Staff / Playbooks /
		// Training / Handbook) each have enough entries to exercise sorting and filtering.
		// jacked returns skills inside `knowledge` with a `skill_` prefix; Training keys
		// off that prefix and Handbook takes the remainder.
		features: [
			{
				category: "commands",
				name: "night-shift",
				displayName: "Night shift",
				description: "Dim palette while draining the queue",
				installed: clamp >= 0.75,
			},
			{
				category: "commands",
				name: "release",
				displayName: "release",
				description: "Cut a release",
				installed: false,
			},
			{
				category: "hooks",
				name: "memory_capture",
				displayName: "Memory capture",
				description: "Vault hook",
				installed: true,
			},
			{
				category: "agents",
				name: "security-reviewer",
				displayName: "Security reviewer",
				description: "Review room NPC",
				installed: true,
			},
			{
				category: "agents",
				name: "test-coverage-engineer",
				displayName: "test-coverage-engineer",
				description: "Adds missing tests",
				installed: true,
			},
			{
				category: "agents",
				name: "code-simplicity-reviewer",
				displayName: "code-simplicity-reviewer",
				description: "Reviews changes for simplicity",
				installed: false,
			},
			{
				category: "knowledge",
				name: "skill_apple-design",
				displayName: "/apple-design Skill",
				description: "Apple design review skill",
				installed: false,
			},
			{
				category: "knowledge",
				name: "rules",
				displayName: "Behavioral Rules",
				description: "Coding habits added to CLAUDE.md",
				installed: true,
			},
			{
				category: "knowledge",
				name: "office-playbook",
				displayName: "Office playbook",
				description: "Library shelf",
				installed: false,
			},
		],
		latestSwap: {
			at: 1_700_000_000_000,
			fromEmail: "claude-spare@example.com",
			toEmail: "claude@example.com",
			reason: "pressure",
		},
		swapPausedUntil: null,
		lessonsActive: 7,
	};
}

export function isOfficeE2eHarnessEnabled(): boolean {
	return new URLSearchParams(window.location.search).get("officeE2e") === "1";
}

function KanbanShellChrome({
	officeOpen,
	onToggleOffice,
	manager,
	children,
}: {
	officeOpen: boolean;
	onToggleOffice: () => void;
	/** Fixture snapshot, so the real Manager section renders without a live manager. */
	manager: RuntimeManagerSnapshot;
	children: ReactElement;
}): ReactElement {
	const [sidebarSection, setSidebarSection] = useState<"projects" | "manager" | "plans">("projects");
	return (
		<div className="flex min-h-0 flex-1" data-testid="office-e2e-kanban-shell">
			{/* Project sidebar — matches Kanban home layout */}
			<aside
				data-testid="office-e2e-sidebar"
				className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface-1"
			>
				<div className="flex h-10 items-center gap-1 border-b border-border px-2 text-[12px] font-medium text-text-primary">
					<button
						type="button"
						onClick={() => setSidebarSection("projects")}
						className={
							sidebarSection === "projects"
								? "flex items-center gap-1.5 rounded-sm bg-surface-4 px-1.5 py-1 text-[11px] text-text-primary"
								: "flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-[11px] text-text-secondary"
						}
					>
						<FolderGit2 size={12} className="text-text-secondary" />
						Projects
					</button>
					{/* The real tab component, so its label and test id stay under test. */}
					<HomeSidebarManagerTab
						active={sidebarSection === "manager"}
						onSelect={() => setSidebarSection("manager")}
					/>
					<button
						type="button"
						data-testid="sidebar-plans-tab"
						onClick={() => setSidebarSection("plans")}
						className={
							sidebarSection === "plans"
								? "rounded-sm bg-surface-4 px-1.5 py-1 text-[11px] text-text-primary"
								: "rounded-sm px-1.5 py-1 text-[11px] text-text-secondary"
						}
					>
						Plans
					</button>
				</div>
				{sidebarSection === "manager" ? (
					<HomeSidebarManagerPanel online manager={manager} />
				) : sidebarSection === "plans" ? (
					<div className="p-2 text-[11px] text-text-tertiary" data-testid="sidebar-plans-panel">
						Plans
					</div>
				) : (
				<div className="flex flex-col gap-1 p-2">
					<button
						type="button"
						className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-left text-[12px] text-text-primary"
					>
						<span className="truncate">~/Desktop/pixel-office</span>
					</button>
					<div className="mt-2 px-2 text-[10px] uppercase tracking-wide text-text-tertiary">
						Board columns
					</div>
					<div className="px-2 text-[11px] text-text-secondary">Backlog · 0</div>
					<div className="px-2 text-[11px] text-text-secondary">In Progress · 2</div>
					<div className="px-2 text-[11px] text-text-secondary">Review · 1</div>
				</div>
				)}
			</aside>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{/* Top bar — mirrors real Kanban TopBar Office toggle */}
				<header
					data-testid="office-e2e-topbar"
					className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3"
				>
					<span className="truncate text-[13px] font-medium text-text-primary">
						~/Desktop/pixel-office
					</span>
					<span className="kb-navbar-tag inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary">
						<GitBranch size={12} />
						main
					</span>
					<span className="text-[11px] text-text-tertiary">(npx kanban · e2e shell)</span>
					<div className="ml-auto flex items-center gap-1">
						<button
							type="button"
							className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-text-secondary hover:bg-surface-2"
							aria-label="Board view"
						>
							<LayoutGrid size={14} />
							<span className="hidden sm:inline">Board</span>
						</button>
						<button
							type="button"
							data-testid="toggle-office-button"
							className={
								officeOpen
									? "inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2 text-[12px] text-text-primary"
									: "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-text-secondary hover:bg-surface-2"
							}
							aria-label={officeOpen ? "Hide watch and office column" : "Show watch and office column"}
							onClick={onToggleOffice}
						>
							<Building2 size={14} />
							<span className="hidden sm:inline">Office</span>
						</button>
						<button
							type="button"
							className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-text-secondary hover:bg-surface-2"
							aria-label="Terminal"
						>
							<Terminal size={14} />
						</button>
					</div>
				</header>
				<div className="flex min-h-0 flex-1 flex-col">{children}</div>
			</div>
		</div>
	);
}

export function OfficeE2eHarness(): ReactElement {
	const staffedBoard = useMemo(() => buildFixtureBoard(), []);
	const emptyBoard = useMemo(() => buildEmptyBoard(), []);
	const staffedSessions = useMemo(() => buildFixtureSessions(), []);
	const [floorMode, setFloorMode] = useState<"staffed" | "empty">("staffed");
	const board = floorMode === "staffed" ? staffedBoard : emptyBoard;
	const sessions = floorMode === "staffed" ? staffedSessions : {};
	const [pressure, setPressure] = useState(0.35);
	const manager = useMemo(() => buildFixtureManager(pressure), [pressure]);
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [officeOpen, setOfficeOpen] = useState(true);

	return (
		<div className="flex h-screen w-screen flex-col bg-surface-0" data-testid="office-e2e-harness">
			<div
				data-testid="office-e2e-chrome"
				className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-1 px-4 py-1.5 text-[11px] text-text-secondary"
			>
				<span className="font-medium text-text-primary">E2E controls</span>
				<label className="flex items-center gap-2">
					Pressure
					<input
						data-testid="office-e2e-pressure"
						type="range"
						min={0}
						max={100}
						value={Math.round(pressure * 100)}
						onChange={(event) => setPressure(Number(event.target.value) / 100)}
					/>
					<span data-testid="office-e2e-pressure-value">{Math.round(pressure * 100)}%</span>
				</label>
				<label className="flex items-center gap-2">
					Floor
					<select
						data-testid="office-e2e-floor-mode"
						value={floorMode}
						onChange={(event) => setFloorMode(event.target.value as "staffed" | "empty")}
					>
						<option value="staffed">staffed</option>
						<option value="empty">empty</option>
					</select>
				</label>
				<button
					type="button"
					data-testid="office-e2e-select-sample"
					className="rounded border border-border px-2 py-0.5 text-text-primary hover:bg-surface-2"
					onClick={() => setSelectedTaskId("e2e-task-claude")}
				>
					Select sample task
				</button>
				<span data-testid="office-e2e-selected-task">
					selected: {selectedTaskId ?? "none"}
				</span>
			</div>

			<KanbanShellChrome
				officeOpen={officeOpen}
				onToggleOffice={() => setOfficeOpen((value) => !value)}
				manager={manager}
			>
				<div className="flex min-h-0 flex-1" data-testid="home-triple-pane">
					<div
						data-testid="office-e2e-board-placeholder"
						className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-8 bg-surface-0 p-6 text-[13px] text-text-secondary"
					>
						<div className="rounded-lg border border-border bg-surface-1 p-4">
							<div className="mb-2 font-semibold text-text-primary">Backlog</div>
							<p>Create task (c)</p>
						</div>
						<div className="rounded-lg border border-border bg-surface-1 p-4">
							<div className="mb-2 font-semibold text-text-primary">In Progress</div>
							<p>2 staffed sessions → office</p>
						</div>
						<div className="rounded-lg border border-border bg-surface-1 p-4">
							<div className="mb-2 font-semibold text-text-primary">Review</div>
							<p>1 awaiting review</p>
						</div>
					</div>
					{officeOpen ? (
						<aside
							data-testid="home-right-column"
							className="flex w-[360px] shrink-0 flex-col border-l border-border bg-surface-1"
						>
							<div
								data-testid="home-manager-watch-pane"
								className="flex h-[40%] min-h-0 flex-col overflow-hidden border-b border-border"
							>
								<ManagerAccountsView online manager={manager} />
							</div>
							<div data-testid="home-office-pane" className="flex min-h-0 flex-1 flex-col overflow-hidden">
								<OfficeView
									board={board}
									sessions={sessions}
									workspaceId="e2e-workspace"
									manager={manager}
									onSelectTask={setSelectedTaskId}
								/>
							</div>
						</aside>
					) : null}
				</div>
			</KanbanShellChrome>
		</div>
	);
}
