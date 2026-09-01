// Settings dialog composition for Kanban.
// Generic app settings live here, while Cline-specific provider state and
// side effects should stay in use-runtime-settings-cline-controller.ts.
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixPopover from "@radix-ui/react-popover";
import * as RadixSwitch from "@radix-ui/react-switch";
import { getRuntimeAgentCatalogEntry, getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import {
	areAgentLaunchOptionsEqual,
	buildAgentLaunchPreviewArgs,
	createDefaultAgentLaunchOptions,
	getAgentLaunchOptionEntry,
	normalizeAgentLaunchOptions,
} from "@runtime-agent-launch-options";
import { areRuntimeProjectShortcutsEqual } from "@runtime-shortcuts";
import {
	Bell,
	Bot,
	Check,
	ChevronDown,
	ExternalLink,
	FolderOpen,
	GitCommit,
	Palette,
	Plus,
	Settings,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { DEFAULT_MAX_RUNNING_TASKS } from "@/storage/local-storage-store";
import { AccountOrganizationSection } from "@/components/shared/account-organization-section";
import { ClineSetupSection } from "@/components/shared/cline-setup-section";
import { apiSeatLabel } from "@/manager/task-account-picker";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
	type RuntimeShortcutIconOption,
	type RuntimeShortcutPickerIconId,
} from "@/components/shared/runtime-shortcut-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { ThemeSelect } from "@/components/theme-select";
import {
	TASK_GIT_BASE_REF_PROMPT_VARIABLE,
	TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE,
	TASK_GIT_SEAM_AGENT_NAME_PROMPT_VARIABLE,
	TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE,
	TASK_GIT_SEAM_TICKET_ID_PROMPT_VARIABLE,
	TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE,
	type TaskGitAction,
	type TaskGitCommitTrailerMode,
} from "@/git-actions/build-task-git-action-prompt";
import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import { useRuntimeSettingsClineMcpController } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import { previewThemeId, readStoredThemeId, saveThemeId, type ThemeId } from "@/hooks/use-theme";
import { useLayoutCustomizations } from "@/resize/layout-customizations";
import { openFileOnHost } from "@/runtime/runtime-config-query";
import { notifySkillInventoryChanged } from "@/runtime/skill-inventory-events";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useClineApiSeats } from "@/runtime/use-cline-api-seats";
import type {
	RuntimeAgentId,
	RuntimeAgentLaunchOptionEntry,
	RuntimeAgentLaunchOptions,
	RuntimeClineApiSeat,
	RuntimeClineMcpServerAuthStatus,
	RuntimeConfigResponse,
	RuntimeProjectShortcut,
	ClaudeLaunchPermissionSetting,
	GeminiLaunchModeSetting,
} from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";
import {
	type BrowserNotificationPermission,
	getBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/utils/notification-permission";
import { formatPathForDisplay } from "@/utils/path-display";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

interface RuntimeSettingsAgentRowModel {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	command: string;
	installed: boolean | null;
}

function quoteCommandPartForDisplay(part: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) {
		return part;
	}
	return JSON.stringify(part);
}

function buildDisplayedAgentCommand(
	agentId: RuntimeAgentId,
	binary: string,
	agentLaunchOptions: RuntimeAgentLaunchOptions,
): string {
	if (agentId === "cline") {
		return "";
	}
	const args = buildAgentLaunchPreviewArgs(agentId, agentLaunchOptions);
	return [binary, ...args.map(quoteCommandPartForDisplay)].join(" ");
}

function cloneAgentLaunchOptions(options: RuntimeAgentLaunchOptions): RuntimeAgentLaunchOptions {
	return normalizeAgentLaunchOptions(options);
}

function patchAgentLaunchOption(
	options: RuntimeAgentLaunchOptions,
	agentId: RuntimeAgentId,
	patch: RuntimeAgentLaunchOptionEntry,
): RuntimeAgentLaunchOptions {
	return {
		...options,
		[agentId]: {
			...getAgentLaunchOptionEntry(agentId, options),
			...patch,
		},
	};
}

function normalizeTemplateForComparison(value: string): string {
	return value.replaceAll("\r\n", "\n").trim();
}

/** Repo-relative roots a project's local assets can come from. */
type RuntimeWorkspaceLocalAssetRoot = "claude" | "agent";

const ALL_LOCAL_ASSET_ROOTS: readonly RuntimeWorkspaceLocalAssetRoot[] = ["claude", "agent"];

const LOCAL_ASSET_ROOT_LABELS: Record<RuntimeWorkspaceLocalAssetRoot, string> = {
	claude: ".claude",
	agent: ".agent",
};

function describeLocalAssetRoots(roots: readonly RuntimeWorkspaceLocalAssetRoot[]): string {
	return roots.map((root) => LOCAL_ASSET_ROOT_LABELS[root]).join(" + ");
}

const GIT_PROMPT_VARIANT_OPTIONS: Array<{ value: TaskGitAction; label: string }> = [
	{ value: "commit", label: "Commit" },
	{ value: "pr", label: "Make PR" },
];

const GIT_TRAILER_MODE_OPTIONS: Array<{ value: TaskGitCommitTrailerMode; label: string }> = [
	{ value: "omit", label: "Omit" },
	{ value: "include", label: "Include" },
];

export type RuntimeSettingsSection = "shortcuts";

const SETTINGS_AGENT_ORDER: readonly RuntimeAgentId[] = [
	"cline",
	"claude",
	"cursor",
	"gemini",
	"orchestrator",
	"codex",
	"droid",
	"kiro",
	"opencode",
];

type SettingsNavId = "general" | "cline" | "git-prompts" | "notifications" | "appearance" | "project";

const SETTINGS_NAV_ITEMS: ReadonlyArray<{
	id: SettingsNavId;
	label: string;
	icon: React.ReactNode;
	clineOnly?: boolean;
}> = [
	{ id: "general", label: "General", icon: <SlidersHorizontal size={16} /> },
	{ id: "cline", label: "Cline", icon: <Bot size={16} />, clineOnly: true },
	{ id: "git-prompts", label: "Git Prompts", icon: <GitCommit size={16} /> },
	{ id: "notifications", label: "Notifications", icon: <Bell size={16} /> },
	{ id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
	{ id: "project", label: "Project", icon: <FolderOpen size={16} /> },
];

function getShortcutIconOption(icon: string | undefined): RuntimeShortcutIconOption {
	return getRuntimeShortcutPickerOption(icon);
}

function ShortcutIconComponent({ icon, size = 14 }: { icon: string | undefined; size?: number }): React.ReactElement {
	const Component = getRuntimeShortcutIconComponent(icon);
	return <Component size={size} />;
}

function formatNotificationPermissionStatus(permission: BrowserNotificationPermission): string {
	if (permission === "default") {
		return "not requested yet";
	}
	return permission;
}

function getNextShortcutLabel(shortcuts: RuntimeProjectShortcut[], baseLabel: string): string {
	const normalizedTakenLabels = new Set(
		shortcuts.map((shortcut) => shortcut.label.trim().toLowerCase()).filter((label) => label.length > 0),
	);
	const normalizedBaseLabel = baseLabel.trim().toLowerCase();
	if (!normalizedTakenLabels.has(normalizedBaseLabel)) {
		return baseLabel;
	}

	let suffix = 2;
	while (normalizedTakenLabels.has(`${normalizedBaseLabel} ${suffix}`)) {
		suffix += 1;
	}
	return `${baseLabel} ${suffix}`;
}

function AgentLaunchOptionsPanel({
	agentId,
	options,
	onChange,
	disabled,
	apiSeats = [],
	defaultSubagentSeatProviderId,
	onDefaultSubagentSeatProviderIdChange,
}: {
	agentId: RuntimeAgentId;
	options: RuntimeAgentLaunchOptions;
	onChange: (next: RuntimeAgentLaunchOptions) => void;
	disabled: boolean;
	apiSeats?: RuntimeClineApiSeat[];
	defaultSubagentSeatProviderId?: string | null;
	onDefaultSubagentSeatProviderIdChange?: (next: string | null) => void;
}): React.ReactElement | null {
	const entry = getAgentLaunchOptionEntry(agentId, options);
	if (agentId === "claude") {
		const mode = entry.claudePermissionMode ?? "auto";
		return (
			<div className="mt-2.5 ml-6 border-l border-border pl-3 flex flex-col gap-2.5">
				<label className="flex flex-col gap-1 text-[12px] text-text-secondary">
					<span>Claude permission mode</span>
					<NativeSelect
						size="sm"
						disabled={disabled}
						value={mode}
						onChange={(event) => {
							onChange(
								patchAgentLaunchOption(options, "claude", {
									claudePermissionMode: event.target.value as ClaudeLaunchPermissionSetting,
								}),
							);
						}}
					>
						<option value="off">Off — prompt before each tool</option>
						<option value="auto">Auto — approve tools automatically</option>
						<option value="plan">Plan — plan before edits</option>
						<option value="acceptEdits">Accept edits — approve file edits only</option>
					</NativeSelect>
				</label>
				<label className="flex flex-col gap-1 text-[12px] text-text-secondary">
					<span>Default subagent seat</span>
					<NativeSelect
						size="sm"
						aria-label="Default API seat this task's subagents run on"
						disabled={disabled || apiSeats.length === 0}
						value={defaultSubagentSeatProviderId ?? ""}
						onChange={(event) => {
							onDefaultSubagentSeatProviderIdChange?.(event.target.value || null);
						}}
					>
						<option value="">Same seat as the task (no split)</option>
						{apiSeats.map((seat) => (
							<option key={seat.providerId} value={seat.providerId}>
								{apiSeatLabel(seat)}
							</option>
						))}
					</NativeSelect>
					<span className="text-[11px] text-text-tertiary">
						Applies to Claude Code tasks when no card pins a subagent seat.
					</span>
				</label>
			</div>
		);
	}
	if (agentId === "gemini") {
		const mode = entry.geminiMode ?? "accept-edits";
		const skipPermissions = entry.geminiSkipPermissions ?? true;
		return (
			<div className="mt-2.5 ml-6 border-l border-border pl-3 flex flex-col gap-2">
				<label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
					<RadixCheckbox.Root
						checked={skipPermissions}
						disabled={disabled}
						onCheckedChange={(checked) => {
							onChange(
								patchAgentLaunchOption(options, "gemini", {
									geminiSkipPermissions: checked === true,
								}),
							);
						}}
						className="flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
					>
						<RadixCheckbox.Indicator>
							<Check size={12} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					<span>Skip permission prompts (--dangerously-skip-permissions)</span>
				</label>
				<label className="flex flex-col gap-1 text-[12px] text-text-secondary">
					<span>Antigravity mode</span>
					<NativeSelect
						size="sm"
						disabled={disabled}
						value={mode}
						onChange={(event) => {
							onChange(
								patchAgentLaunchOption(options, "gemini", {
									geminiMode: event.target.value as GeminiLaunchModeSetting,
								}),
							);
						}}
					>
						<option value="off">Off</option>
						<option value="accept-edits">Accept edits</option>
						<option value="plan">Plan</option>
					</NativeSelect>
				</label>
			</div>
		);
	}
	if (agentId === "cursor" || agentId === "codex" || agentId === "cline" || agentId === "droid" || agentId === "kiro") {
		const catalogEntry = getRuntimeAgentCatalogEntry(agentId);
		if (!catalogEntry || catalogEntry.autonomousArgs.length === 0) {
			return null;
		}
		const enabled = entry.autonomousEnabled ?? true;
		const argsLabel = catalogEntry.autonomousArgs.join(" ");
		return (
			<div className="mt-2.5 ml-6 border-l border-border pl-3">
				<label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
					<RadixCheckbox.Root
						checked={enabled}
						disabled={disabled}
						onCheckedChange={(checked) => {
							onChange(
								patchAgentLaunchOption(options, agentId, {
									autonomousEnabled: checked === true,
								}),
							);
						}}
						className="flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
					>
						<RadixCheckbox.Indicator>
							<Check size={12} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					<span>
						Append autonomous launch flags {argsLabel ? <span className="font-mono text-xs text-text-secondary">({argsLabel})</span> : null}
					</span>
				</label>
			</div>
		);
	}
	return null;
}

function AgentRow({
	agent,
	isSelected,
	onSelect,
	disabled,
	showCommandPreview,
}: {
	agent: RuntimeSettingsAgentRowModel;
	isSelected: boolean;
	onSelect: () => void;
	disabled: boolean;
	showCommandPreview: boolean;
}): React.ReactElement {
	const installUrl = getRuntimeAgentCatalogEntry(agent.id)?.installUrl;
	const isNativeCline = agent.id === "cline";
	const isInstalled = agent.installed === true;
	const isInstallStatusPending = !isNativeCline && agent.installed === null;
	const radioId = `runtime-settings-agent-${agent.id}`;

	return (
		<div className="flex items-center justify-between gap-3 py-1.5">
			<div className="flex items-start gap-2 min-w-0">
				<input
					id={radioId}
					type="radio"
					name="runtime-settings-default-agent"
					checked={isSelected}
					disabled={!isInstalled || disabled}
					onChange={() => {
						if (isInstalled && !disabled) {
							onSelect();
						}
					}}
					className="mt-1 shrink-0 cursor-pointer disabled:cursor-default disabled:opacity-40"
				/>
				<label htmlFor={radioId} className="min-w-0 cursor-pointer" style={{ cursor: isInstalled ? "pointer" : "default" }}>
					<div className="flex items-center gap-2">
						<span className="text-[13px] text-text-primary">{agent.label}</span>
						{isNativeCline ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-status-green/10 text-status-green">
								Installed
							</span>
						) : isInstalled ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-status-green/10 text-status-green">
								Installed
							</span>
						) : isInstallStatusPending ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-surface-3 text-text-secondary">
								Checking...
							</span>
						) : null}
					</div>
					{showCommandPreview && agent.command ? (
						<p className="text-text-secondary font-mono text-xs mt-0.5 m-0">{agent.command}</p>
					) : null}
				</label>
			</div>
			{!isNativeCline && agent.installed === false && installUrl ? (
				<a
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
					className="inline-flex items-center justify-center rounded-md font-medium duration-150 cursor-default select-none h-7 px-2 text-xs bg-surface-2 border border-border text-text-primary hover:bg-surface-3 hover:border-border-bright"
				>
					Install
				</a>
			) : !isNativeCline && agent.installed === false ? (
				<Button size="sm" disabled>
					Install
				</Button>
			) : null}
		</div>
	);
}

function InlineUtilityButton({
	text,
	onClick,
	disabled,
	monospace,
	widthCh,
}: {
	text: string;
	onClick: () => void;
	disabled?: boolean;
	monospace?: boolean;
	widthCh?: number;
}): React.ReactElement {
	return (
		<Button
			size="sm"
			disabled={disabled}
			onClick={onClick}
			className={cn(monospace && "font-mono")}
			style={{
				fontSize: 10,
				verticalAlign: "middle",
				...(typeof widthCh === "number"
					? {
							width: `${widthCh}ch`,
							justifyContent: "center",
						}
					: {}),
			}}
		>
			{text}
		</Button>
	);
}

function ShortcutIconPicker({
	value,
	onSelect,
}: {
	value: string | undefined;
	onSelect: (icon: RuntimeShortcutPickerIconId) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const selectedOption = getShortcutIconOption(value);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					type="button"
					aria-label={`Shortcut icon: ${selectedOption.label}`}
					className="inline-flex items-center gap-1 h-7 px-1.5 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-surface-3"
				>
					<ShortcutIconComponent icon={value} size={14} />
					<ChevronDown size={12} />
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 rounded-md border border-border bg-surface-2 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="flex gap-0.5">
						{RUNTIME_SHORTCUT_ICON_OPTIONS.map((option) => {
							const IconComponent = getRuntimeShortcutIconComponent(option.value);
							return (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									className={cn(
										"p-1.5 rounded hover:bg-surface-3",
										selectedOption.value === option.value && "bg-surface-3",
									)}
									onClick={() => {
										onSelect(option.value);
										setOpen(false);
									}}
								>
									<IconComponent size={14} />
								</button>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

function SettingsNav({
	items,
	activeId,
	onSelect,
	className,
}: {
	items: ReadonlyArray<{ id: SettingsNavId; label: string; icon: React.ReactNode }>;
	activeId: SettingsNavId;
	onSelect: (id: SettingsNavId) => void;
	className?: string;
}): React.ReactElement {
	return (
		<nav className={cn("flex shrink-0 flex-col gap-0.5 border-r border-border bg-surface-1 p-3 overflow-y-auto", className)}>
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={() => onSelect(item.id)}
					className={cn(
						"flex items-center gap-2.5 text-left px-3 py-2 rounded-md text-[13px] font-medium cursor-pointer",
						activeId === item.id
							? "bg-surface-3 text-text-primary"
							: "text-text-secondary hover:text-text-primary hover:bg-surface-2",
					)}
				>
					<span className="shrink-0 opacity-80">{item.icon}</span>
					<span>{item.label}</span>
				</button>
			))}
		</nav>
	);
}

export function RuntimeSettingsDialog({
	open,
	workspaceId,
	initialConfig = null,
	liveMcpAuthStatuses = null,
	onOpenChange,
	onSaved,
	onAccountSwitched,
	initialSection,
	maxRunningTasks = DEFAULT_MAX_RUNNING_TASKS,
	onMaxRunningTasksChange,
}: {
	open: boolean;
	workspaceId: string | null;
	initialConfig?: RuntimeConfigResponse | null;
	liveMcpAuthStatuses?: RuntimeClineMcpServerAuthStatus[] | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
	onAccountSwitched?: () => void;
	initialSection?: RuntimeSettingsSection | null;
	/** Concurrent-running cap for the backlog auto-run scheduler (localStorage-backed, live). */
	maxRunningTasks?: number;
	onMaxRunningTasksChange?: (value: number) => void;
}): React.ReactElement {
	const { config, isLoading, isSaving, save, refresh } = useRuntimeConfig(open, workspaceId, initialConfig);
	const { resetLayoutCustomizations } = useLayoutCustomizations();
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [defaultSubagentSeatProviderId, setDefaultSubagentSeatProviderId] = useState<string | null>(null);
	const [agentLaunchOptions, setAgentLaunchOptions] = useState<RuntimeAgentLaunchOptions>(() =>
		createDefaultAgentLaunchOptions(true),
	);
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [initialThemeId, setInitialThemeId] = useState<ThemeId>(readStoredThemeId);
	const [draftThemeId, setDraftThemeId] = useState<ThemeId>(readStoredThemeId);
	const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>("unsupported");
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [commitPromptTemplate, setCommitPromptTemplate] = useState("");
	const [openPrPromptTemplate, setOpenPrPromptTemplate] = useState("");
	const [agentDisplayName, setAgentDisplayName] = useState("");
	const [seamCommentTagTemplate, setSeamCommentTagTemplate] = useState("");
	const [commitTrailerMode, setCommitTrailerMode] = useState<TaskGitCommitTrailerMode>("omit");
	const [commitTrailerTemplate, setCommitTrailerTemplate] = useState("");
	const [selectedPromptVariant, setSelectedPromptVariant] = useState<TaskGitAction>("commit");
	const [copiedVariableToken, setCopiedVariableToken] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	// Read from the backend on open so the switch shows the selected project's saved
	// state. It used to default to off every time, which read as "this project has
	// local assets disabled" even when the project had enabled them.
	const [localAssetsEnabled, setLocalAssetsEnabled] = useState(false);
	const [localAssetsRoots, setLocalAssetsRoots] = useState<RuntimeWorkspaceLocalAssetRoot[]>([
		...ALL_LOCAL_ASSET_ROOTS,
	]);
	const [localAssetsBusy, setLocalAssetsBusy] = useState(false);
	const [syncCatalogBusy, setSyncCatalogBusy] = useState(false);
	const [pendingShortcutScrollIndex, setPendingShortcutScrollIndex] = useState<number | null>(null);
	const copiedVariableResetTimerRef = useRef<number | null>(null);
	const shortcutsSectionRef = useRef<HTMLHeadingElement | null>(null);
	const shortcutRowRefs = useRef<Array<HTMLDivElement | null>>([]);
	const bodyRef = useRef<HTMLDivElement>(null);
	const isScrollingProgrammatically = useRef(false);
	const [activeSection, setActiveSection] = useState<SettingsNavId>("general");
	const controlsDisabled = isLoading || isSaving || config === null;
	const commitPromptTemplateDefault = config?.commitPromptTemplateDefault ?? "";
	const openPrPromptTemplateDefault = config?.openPrPromptTemplateDefault ?? "";
	const isCommitPromptAtDefault =
		normalizeTemplateForComparison(commitPromptTemplate) ===
		normalizeTemplateForComparison(commitPromptTemplateDefault);
	const isOpenPrPromptAtDefault =
		normalizeTemplateForComparison(openPrPromptTemplate) ===
		normalizeTemplateForComparison(openPrPromptTemplateDefault);
	const seamCommentTagTemplateDefault = config?.seamCommentTagTemplateDefault ?? "";
	const isSeamCommentTagTemplateAtDefault =
		normalizeTemplateForComparison(seamCommentTagTemplate) ===
		normalizeTemplateForComparison(seamCommentTagTemplateDefault);
	const commitTrailerTemplateDefault = config?.commitTrailerTemplateDefault ?? "";
	const isCommitTrailerTemplateAtDefault =
		normalizeTemplateForComparison(commitTrailerTemplate) ===
		normalizeTemplateForComparison(commitTrailerTemplateDefault);
	const selectedPromptValue = selectedPromptVariant === "commit" ? commitPromptTemplate : openPrPromptTemplate;
	const selectedPromptDefaultValue =
		selectedPromptVariant === "commit" ? commitPromptTemplateDefault : openPrPromptTemplateDefault;
	const isSelectedPromptAtDefault =
		selectedPromptVariant === "commit" ? isCommitPromptAtDefault : isOpenPrPromptAtDefault;
	const selectedPromptPlaceholder =
		selectedPromptVariant === "commit" ? "Commit prompt template" : "PR prompt template";
	const refreshNotificationPermission = useCallback(() => {
		setNotificationPermission(getBrowserNotificationPermission());
	}, []);

	const supportedAgents = useMemo<RuntimeSettingsAgentRowModel[]>(() => {
		const agents =
			config?.agents.map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: agent.id === "cline" ? true : agent.installed,
			})) ??
			getRuntimeLaunchSupportedAgentCatalog().map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: agent.id === "cline" ? true : null,
			}));
		const orderIndexByAgentId = new Map(SETTINGS_AGENT_ORDER.map((agentId, index) => [agentId, index] as const));
		const orderedAgents = [...agents].sort((left, right) => {
			const leftOrderIndex = orderIndexByAgentId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
			const rightOrderIndex = orderIndexByAgentId.get(right.id) ?? Number.MAX_SAFE_INTEGER;
			return leftOrderIndex - rightOrderIndex;
		});
		return orderedAgents.map((agent) => ({
			...agent,
			command: buildDisplayedAgentCommand(agent.id, agent.binary, agentLaunchOptions),
		}));
	}, [agentLaunchOptions, config?.agents]);
	const displayedAgents = useMemo(() => supportedAgents, [supportedAgents]);
	const navItems = useMemo(() => SETTINGS_NAV_ITEMS, []);
	const configuredAgentId = config?.selectedAgentId ?? null;
	const firstInstalledAgentId = displayedAgents.find((agent) => agent.installed)?.id;
	const fallbackAgentId = firstInstalledAgentId ?? displayedAgents[0]?.id ?? "claude";
	const initialSelectedAgentId = configuredAgentId ?? fallbackAgentId;
	const { seats: apiSeats } = useClineApiSeats(workspaceId, open);
	const initialDefaultSubagentSeatProviderId = config?.defaultSubagentSeatProviderId ?? null;
	const initialAgentLaunchOptions = normalizeAgentLaunchOptions(
		config?.agentLaunchOptions,
		config?.agentAutonomousModeEnabled,
	);
	const initialReadyForReviewNotificationsEnabled = config?.readyForReviewNotificationsEnabled ?? true;
	const initialShortcuts = config?.shortcuts ?? [];
	const initialCommitPromptTemplate = config?.commitPromptTemplate ?? "";
	const initialOpenPrPromptTemplate = config?.openPrPromptTemplate ?? "";
	const initialAgentDisplayName = config?.agentDisplayName ?? "";
	const initialSeamCommentTagTemplate = config?.seamCommentTagTemplate ?? "";
	const initialCommitTrailerMode = config?.commitTrailerMode ?? "omit";
	const initialCommitTrailerTemplate = config?.commitTrailerTemplate ?? "";
	const clineSettings = useRuntimeSettingsClineController({
		open,
		workspaceId,
		selectedAgentId,
		config,
	});
	const clineMcpSettings = useRuntimeSettingsClineMcpController({
		open,
		workspaceId,
		selectedAgentId,
		liveAuthStatuses: liveMcpAuthStatuses,
	});
	const hasUnsavedChanges = useMemo(() => {
		if (!config) {
			return false;
		}
		if (selectedAgentId !== initialSelectedAgentId) {
			return true;
		}
		if (defaultSubagentSeatProviderId !== initialDefaultSubagentSeatProviderId) {
			return true;
		}
		if (!areAgentLaunchOptionsEqual(agentLaunchOptions, initialAgentLaunchOptions)) {
			return true;
		}
		if (readyForReviewNotificationsEnabled !== initialReadyForReviewNotificationsEnabled) {
			return true;
		}
		if (clineSettings.hasUnsavedChanges) {
			return true;
		}
		if (clineMcpSettings.hasUnsavedChanges) {
			return true;
		}
		if (draftThemeId !== initialThemeId) {
			return true;
		}
		if (!areRuntimeProjectShortcutsEqual(shortcuts, initialShortcuts)) {
			return true;
		}
		if (
			normalizeTemplateForComparison(commitPromptTemplate) !==
			normalizeTemplateForComparison(initialCommitPromptTemplate)
		) {
			return true;
		}
		if (
			normalizeTemplateForComparison(openPrPromptTemplate) !==
			normalizeTemplateForComparison(initialOpenPrPromptTemplate)
		) {
			return true;
		}
		if (agentDisplayName !== initialAgentDisplayName) {
			return true;
		}
		if (commitTrailerMode !== initialCommitTrailerMode) {
			return true;
		}
		if (
			normalizeTemplateForComparison(commitTrailerTemplate) !==
			normalizeTemplateForComparison(initialCommitTrailerTemplate)
		) {
			return true;
		}
		return (
			normalizeTemplateForComparison(seamCommentTagTemplate) !==
			normalizeTemplateForComparison(initialSeamCommentTagTemplate)
		);
	}, [
		agentLaunchOptions,
		agentDisplayName,
		clineMcpSettings.hasUnsavedChanges,
		clineSettings.hasUnsavedChanges,
		commitPromptTemplate,
		commitTrailerMode,
		commitTrailerTemplate,
		config,
		defaultSubagentSeatProviderId,
		draftThemeId,
		initialAgentLaunchOptions,
		initialAgentDisplayName,
		initialCommitPromptTemplate,
		initialCommitTrailerMode,
		initialCommitTrailerTemplate,
		initialDefaultSubagentSeatProviderId,
		initialOpenPrPromptTemplate,
		initialReadyForReviewNotificationsEnabled,
		initialSeamCommentTagTemplate,
		initialSelectedAgentId,
		initialShortcuts,
		initialThemeId,
		openPrPromptTemplate,
		readyForReviewNotificationsEnabled,
		seamCommentTagTemplate,
		selectedAgentId,
		shortcuts,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		setSelectedAgentId(configuredAgentId ?? fallbackAgentId);
		setDefaultSubagentSeatProviderId(config?.defaultSubagentSeatProviderId ?? null);
		setAgentLaunchOptions(
			normalizeAgentLaunchOptions(config?.agentLaunchOptions, config?.agentAutonomousModeEnabled),
		);
		setReadyForReviewNotificationsEnabled(config?.readyForReviewNotificationsEnabled ?? true);
		setShortcuts(config?.shortcuts ?? []);
		setCommitPromptTemplate(config?.commitPromptTemplate ?? "");
		setOpenPrPromptTemplate(config?.openPrPromptTemplate ?? "");
		setAgentDisplayName(config?.agentDisplayName ?? "");
		setSeamCommentTagTemplate(config?.seamCommentTagTemplate ?? "");
		setCommitTrailerMode(config?.commitTrailerMode ?? "omit");
		setCommitTrailerTemplate(config?.commitTrailerTemplate ?? "");
		setSaveError(null);
	}, [
		config?.agentAutonomousModeEnabled,
		config?.agentDisplayName,
		config?.commitPromptTemplate,
		config?.commitTrailerMode,
		config?.commitTrailerTemplate,
		config?.defaultSubagentSeatProviderId,
		config?.openPrPromptTemplate,
		config?.readyForReviewNotificationsEnabled,
		config?.seamCommentTagTemplate,
		config?.selectedAgentId,
		config?.shortcuts,
		fallbackAgentId,
		open,
	]);

	useEffect(() => {
		if (!open || !workspaceId) {
			return;
		}
		let cancelled = false;
		void getRuntimeTrpcClient(workspaceId)
			.runtime.getWorkspaceLocalAssets.query({ workspaceId })
			.then((setting) => {
				if (cancelled) {
					return;
				}
				setLocalAssetsEnabled(setting.enabled);
				setLocalAssetsRoots(setting.roots);
			})
			.catch(() => {
				// A failed read must not claim the project has assets enabled.
				if (!cancelled) {
					setLocalAssetsEnabled(false);
					setLocalAssetsRoots([...ALL_LOCAL_ASSET_ROOTS]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId]);

	/** Persist enabled + roots together; the backend normalizes an empty root list. */
	const saveLocalAssets = useCallback(
		(nextEnabled: boolean, nextRoots: RuntimeWorkspaceLocalAssetRoot[]) => {
			if (!workspaceId) {
				return;
			}
			setLocalAssetsBusy(true);
			void getRuntimeTrpcClient(workspaceId)
				.runtime.setWorkspaceLocalAssets.mutate({ workspaceId, enabled: nextEnabled, roots: nextRoots })
				.then((result) => {
					setLocalAssetsEnabled(result.enabled);
					setLocalAssetsRoots(result.roots);
					notifySkillInventoryChanged();
					showAppToast({
						intent: "success",
						message: result.enabled
							? `Now loading this project's ${describeLocalAssetRoots(result.roots)} assets.`
							: "Stopped loading this project's local assets.",
						timeout: 4000,
					});
				})
				.catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
				})
				.finally(() => {
					setLocalAssetsBusy(false);
				});
		},
		[workspaceId],
	);

	const handleLocalAssetsToggle = useCallback(
		(nextEnabled: boolean) => {
			saveLocalAssets(nextEnabled, localAssetsRoots);
		},
		[localAssetsRoots, saveLocalAssets],
	);

	/**
	 * Reinstall every Manager catalog entry this project has enabled. Useful after a
	 * fresh clone or a `git clean`, when the recorded set is intact but the files under
	 * `<repo>/.claude` are gone.
	 */
	const handleSyncCatalogToProject = useCallback(() => {
		if (!workspaceId) {
			return;
		}
		setSyncCatalogBusy(true);
		void getRuntimeTrpcClient(null)
			.manager.syncFeaturesToProject.mutate({ workspaceId })
			.then((result) => {
				notifySkillInventoryChanged();
				if (result.ok) {
					showAppToast({
						intent: "success",
						message:
							result.applied === 0
								? "Nothing to sync — this project has no Manager entries enabled."
								: `Reinstalled ${result.applied} Manager ${result.applied === 1 ? "entry" : "entries"} into this project.`,
						timeout: 4000,
					});
					return;
				}
				showAppToast({
					intent: "warning",
					icon: "warning-sign",
					message: result.error ?? `Could not reinstall: ${result.failed.join(", ")}`,
					timeout: 7000,
				});
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			})
			.finally(() => {
				setSyncCatalogBusy(false);
			});
	}, [workspaceId]);

	const handleLocalAssetRootToggle = useCallback(
		(root: RuntimeWorkspaceLocalAssetRoot, checked: boolean) => {
			const next = ALL_LOCAL_ASSET_ROOTS.filter((candidate) =>
				candidate === root ? checked : localAssetsRoots.includes(candidate),
			);
			// Clearing both roots would silently re-enable both on the backend, so treat
			// "no roots" as turning the whole feature off instead.
			if (next.length === 0) {
				saveLocalAssets(false, [...ALL_LOCAL_ASSET_ROOTS]);
				return;
			}
			saveLocalAssets(localAssetsEnabled, next);
		},
		[localAssetsEnabled, localAssetsRoots, saveLocalAssets],
	);

	useEffect(() => {
		if (!open) {
			return;
		}
		const persistedThemeId = readStoredThemeId();
		setInitialThemeId(persistedThemeId);
		setDraftThemeId(persistedThemeId);
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		refreshNotificationPermission();
	}, [open, refreshNotificationPermission]);
	useWindowEvent("focus", open ? refreshNotificationPermission : null);

	useEffect(() => {
		if (!open || initialSection !== "shortcuts") {
			return;
		}
		const timeout = window.setTimeout(() => {
			shortcutsSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
		}, 500);
		return () => {
			window.clearTimeout(timeout);
		};
	}, [initialSection, open]);

	useEffect(() => {
		if (pendingShortcutScrollIndex === null) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			const target = shortcutRowRefs.current[pendingShortcutScrollIndex] ?? null;
			if (target) {
				target.scrollIntoView({ block: "nearest", behavior: "smooth" });
				const firstInput = target.querySelector("input");
				firstInput?.focus();
				setPendingShortcutScrollIndex(null);
			}
		});
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [pendingShortcutScrollIndex, shortcuts]);

	useUnmount(() => {
		if (copiedVariableResetTimerRef.current !== null) {
			window.clearTimeout(copiedVariableResetTimerRef.current);
			copiedVariableResetTimerRef.current = null;
		}
	});

	const handleBodyScroll = useCallback(() => {
		if (isScrollingProgrammatically.current) return;
		const body = bodyRef.current;
		if (!body) return;
		const headings = body.querySelectorAll<HTMLElement>("[data-settings-section]");
		const bodyRect = body.getBoundingClientRect();
		let current: SettingsNavId = "general";

		for (const heading of headings) {
			const rect = heading.getBoundingClientRect();
			if (rect.top - bodyRect.top <= 40) {
				const id = heading.getAttribute("data-settings-section");
				if (id) current = id as SettingsNavId;
			}
		}

		setActiveSection(current);
	}, []);

	const handleNavSelect = useCallback((id: SettingsNavId) => {
		setActiveSection(id);
		isScrollingProgrammatically.current = true;
		const body = bodyRef.current;
		if (!body) return;
		const target = body.querySelector(`[data-settings-section="${id}"]`);
		if (target) {
			const bodyRect = body.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			body.scrollTo({
				top: targetRect.top - bodyRect.top + body.scrollTop,
				behavior: "smooth",
			});
		}
		window.setTimeout(() => {
			isScrollingProgrammatically.current = false;
		}, 600);
	}, []);

	const handleCopyVariableToken = (token: string) => {
		void (async () => {
			try {
				await navigator.clipboard.writeText(token);
				setCopiedVariableToken(token);
				if (copiedVariableResetTimerRef.current !== null) {
					window.clearTimeout(copiedVariableResetTimerRef.current);
				}
				copiedVariableResetTimerRef.current = window.setTimeout(() => {
					setCopiedVariableToken((current) => (current === token ? null : current));
					copiedVariableResetTimerRef.current = null;
				}, 2000);
			} catch {
				// Ignore clipboard failures.
			}
		})();
	};

	const handleSelectedPromptChange = (value: string) => {
		if (selectedPromptVariant === "commit") {
			setCommitPromptTemplate(value);
			return;
		}
		setOpenPrPromptTemplate(value);
	};

	const handleResetSelectedPrompt = () => {
		handleSelectedPromptChange(selectedPromptDefaultValue);
	};

	const handleResetSeamCommentTagTemplate = () => {
		setSeamCommentTagTemplate(seamCommentTagTemplateDefault);
	};

	const handleResetCommitTrailerTemplate = () => {
		setCommitTrailerTemplate(commitTrailerTemplateDefault);
	};

	const handleSave = async () => {
		setSaveError(null);
		if (!config) {
			setSaveError("Runtime settings are still loading. Try again in a moment.");
			return;
		}
		const selectedAgent = displayedAgents.find((agent) => agent.id === selectedAgentId);
		if (!selectedAgent || selectedAgent.installed !== true) {
			setSaveError("Selected agent is not installed. Install it first or choose an installed agent.");
			return;
		}
		const shouldRequestNotificationPermission =
			!initialReadyForReviewNotificationsEnabled &&
			readyForReviewNotificationsEnabled &&
			notificationPermission === "default";
		if (shouldRequestNotificationPermission) {
			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
		}
		if (selectedAgentId === "cline" && clineSettings.providerId.trim().length === 0) {
			setSaveError("Choose a Cline provider before saving.");
			return;
		}
		if (selectedAgentId === "cline") {
			const clineProviderSaveResult = await clineSettings.saveProviderSettings();
			if (!clineProviderSaveResult.ok) {
				setSaveError(clineProviderSaveResult.message ?? "Could not save Cline provider settings.");
				return;
			}
			const clineMcpSaveResult = await clineMcpSettings.saveMcpSettings();
			if (!clineMcpSaveResult.ok) {
				setSaveError(clineMcpSaveResult.message ?? "Could not save Cline MCP settings.");
				return;
			}
		}
		const saved = await save({
			selectedAgentId,
			defaultSubagentSeatProviderId,
			agentLaunchOptions,
			readyForReviewNotificationsEnabled,
			shortcuts,
			commitPromptTemplate,
			openPrPromptTemplate,
			agentDisplayName,
			seamCommentTagTemplate,
			commitTrailerMode,
			commitTrailerTemplate,
		});
		if (!saved) {
			setSaveError("Could not save runtime settings. Check runtime logs and try again.");
			return;
		}
		if (draftThemeId !== initialThemeId) {
			saveThemeId(draftThemeId);
			setInitialThemeId(draftThemeId);
		}
		onSaved?.();
		handleDialogOpenChange(false);
	};

	const handleRequestPermission = () => {
		void (async () => {
			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
		})();
	};

	const handleOpenFilePath = useCallback(
		(filePath: string) => {
			setSaveError(null);
			void openFileOnHost(workspaceId, filePath).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				setSaveError(`Could not open file on host: ${message}`);
			});
		},
		[workspaceId],
	);

	const handleClineSetupSaved = useCallback(() => {
		refresh();
		onSaved?.();
	}, [onSaved, refresh]);

	const handleDialogOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) {
				const persistedThemeId = readStoredThemeId();
				if (draftThemeId !== persistedThemeId) {
					previewThemeId(persistedThemeId);
				}
				setDraftThemeId(persistedThemeId);
				setInitialThemeId(persistedThemeId);
			}
			onOpenChange(nextOpen);
		},
		[draftThemeId, onOpenChange],
	);

	return (
		<Dialog
			open={open}
			onOpenChange={handleDialogOpenChange}
			size="custom"
			contentClassName="w-[90vw] max-w-[780px] max-h-[85vh]"
		>
			<DialogHeader title="Settings" icon={<Settings size={16} />} />
			<div className="flex flex-col h-[min(480px,60vh)]">
				<div className="md:hidden border-b border-border bg-surface-1 px-3 py-2">
					<NativeSelect
						aria-label="Settings section"
						value={activeSection}
						onChange={(event) => {
							handleNavSelect(event.target.value as SettingsNavId);
						}}
					>
						{navItems.map((item) => (
							<option key={item.id} value={item.id}>
								{item.label}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex flex-1 min-h-0">
				<SettingsNav items={navItems} activeId={activeSection} onSelect={handleNavSelect} className="hidden md:flex w-[180px]" />
				<div
					ref={bodyRef}
					onScroll={handleBodyScroll}
					className="px-5 pb-5 overflow-y-auto overscroll-contain flex-1 min-h-0 bg-surface-1"
				>
					{/* ---- General ---- */}
					<div data-settings-section="general" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<SlidersHorizontal size={16} className="text-text-secondary" />
							General
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<div className="flex items-center justify-between gap-2 mb-1">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
								Default agent for new tasks
							</h6>
							<span className="text-[10px] text-text-tertiary uppercase tracking-wide">Global</span>
						</div>
						<p className="text-text-secondary text-[13px] mt-0 mb-3">
							Each task can override this on the card. Running sessions keep their launch flags until
							restart.
						</p>
						<div role="radiogroup" aria-label="Default agent for new tasks" className="flex flex-col divide-y divide-border/40">
						{displayedAgents.map((agent) => (
							<div key={agent.id} className="py-2.5 first:pt-0 last:pb-0">
								<AgentRow
									agent={agent}
									isSelected={agent.id === selectedAgentId}
									onSelect={() => setSelectedAgentId(agent.id)}
									disabled={controlsDisabled}
									showCommandPreview={Boolean(agent.command)}
								/>
								<AgentLaunchOptionsPanel
									agentId={agent.id}
									options={agentLaunchOptions}
									onChange={setAgentLaunchOptions}
									disabled={controlsDisabled}
									apiSeats={apiSeats}
									defaultSubagentSeatProviderId={defaultSubagentSeatProviderId}
									onDefaultSubagentSeatProviderIdChange={setDefaultSubagentSeatProviderId}
								/>
							</div>
						))}
						</div>
						{config === null ? (
							<p className="text-text-secondary py-2">Checking which CLIs are installed for this project...</p>
						) : null}
					</div>

					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<label className="flex items-center gap-2 text-[13px] text-text-primary select-none">
							Max tasks running at once
							<input
								type="number"
								min={1}
								step={1}
								value={maxRunningTasks}
								onChange={(e) => {
									const parsed = Number(e.currentTarget.value);
									onMaxRunningTasksChange?.(Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1);
								}}
								className="w-16 rounded-sm border border-border-bright bg-surface-3 px-2 py-1 text-[13px] text-text-primary"
							/>
						</label>
						<p className="text-text-secondary text-[12px] m-0 mt-2">
							Backlog cards with an auto-run countdown wait for a free slot when this many are already
							running. Saved immediately on this device.
						</p>
					</div>

					{/* ---- Cline ---- */}
					<div data-settings-section="cline" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<Bot size={16} className="text-text-secondary" />
							Cline
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<ClineSetupSection
									controller={clineSettings}
									mcpController={clineMcpSettings}
									controlsDisabled={controlsDisabled}
									workspaceId={workspaceId}
									accountSection={
										clineSettings.providerId.trim() === "cline" ? (
											<AccountOrganizationSection
												workspaceId={workspaceId}
												open={open}
												onAccountSwitched={onAccountSwitched}
											/>
										) : null
									}
									onError={setSaveError}
									onSaved={handleClineSetupSaved}
								/>
					</div>

					{/* ---- Git Prompts ---- */}
					<div data-settings-section="git-prompts" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<GitCommit size={16} className="text-text-secondary" />
							Git Prompts
							<span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary ml-1">
								Global
							</span>
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<p className="text-text-secondary text-[13px] mt-0 mb-2">
							Modify the prompts sent to the agent when using Commit or Make PR on tasks in Review.
						</p>
						<div className="mb-3">
							<label
								htmlFor="runtime-settings-agent-display-name"
								className="block text-[12px] font-semibold uppercase tracking-wider text-text-secondary mb-1"
							>
								Your name (for seam tags)
							</label>
							<input
								id="runtime-settings-agent-display-name"
								type="text"
								value={agentDisplayName}
								onChange={(event) => setAgentDisplayName(event.target.value)}
								placeholder="e.g. Tien"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
							/>
							<p className="text-text-secondary text-[13px] mt-1 mb-0">
								Used to tag concurrent edits to shared/seam files when multiple agents or tasks touch the same
								files across branches.
							</p>
						</div>
						<div className="mb-3">
							<div className="flex items-center justify-between gap-2 mb-2">
								<label
									htmlFor="runtime-settings-seam-comment-tag-template"
									className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary"
								>
									Seam comment tag
								</label>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleResetSeamCommentTagTemplate}
									disabled={controlsDisabled || isSeamCommentTagTemplateAtDefault}
								>
									Reset
								</Button>
							</div>
							<textarea
								id="runtime-settings-seam-comment-tag-template"
								rows={2}
								value={seamCommentTagTemplate}
								onChange={(event) => setSeamCommentTagTemplate(event.target.value)}
								placeholder="Seam comment tag template"
								disabled={controlsDisabled}
								className="w-full rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none disabled:opacity-40"
							/>
							<p className="text-text-secondary text-[13px] mt-2 mb-0">
								Use{" "}
								<InlineUtilityButton
									text={
										copiedVariableToken === TASK_GIT_SEAM_TICKET_ID_PROMPT_VARIABLE.token
											? "Copied!"
											: TASK_GIT_SEAM_TICKET_ID_PROMPT_VARIABLE.token
									}
									monospace
									widthCh={Math.max(TASK_GIT_SEAM_TICKET_ID_PROMPT_VARIABLE.token.length, "Copied!".length) + 2}
									onClick={() => {
										handleCopyVariableToken(TASK_GIT_SEAM_TICKET_ID_PROMPT_VARIABLE.token);
									}}
									disabled={controlsDisabled}
								/>{" "}
								<InlineUtilityButton
									text={
										copiedVariableToken === TASK_GIT_SEAM_AGENT_NAME_PROMPT_VARIABLE.token
											? "Copied!"
											: TASK_GIT_SEAM_AGENT_NAME_PROMPT_VARIABLE.token
									}
									monospace
									widthCh={Math.max(TASK_GIT_SEAM_AGENT_NAME_PROMPT_VARIABLE.token.length, "Copied!".length) + 2}
									onClick={() => {
										handleCopyVariableToken(TASK_GIT_SEAM_AGENT_NAME_PROMPT_VARIABLE.token);
									}}
									disabled={controlsDisabled}
								/>{" "}
								and{" "}
								<InlineUtilityButton
									text={
										copiedVariableToken === TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE.token
											? "Copied!"
											: TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE.token
									}
									monospace
									widthCh={
										Math.max(TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE.token.length, "Copied!".length) + 2
									}
									onClick={() => {
										handleCopyVariableToken(TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE.token);
									}}
									disabled={controlsDisabled}
								/>{" "}
								to reference {TASK_GIT_SEAM_COMMENT_TAG_PROMPT_VARIABLE.description} inside the commit/PR prompts
								below.
							</p>
						</div>
						<div className="mb-3">
							<label
								htmlFor="runtime-settings-commit-trailer-mode"
								className="block text-[12px] font-semibold uppercase tracking-wider text-text-secondary mb-1"
							>
								Trailer behaviour
							</label>
							<NativeSelect
								id="runtime-settings-commit-trailer-mode"
								value={commitTrailerMode}
								onChange={(event) => setCommitTrailerMode(event.target.value as TaskGitCommitTrailerMode)}
								disabled={controlsDisabled}
								style={{ minWidth: 220 }}
							>
								{GIT_TRAILER_MODE_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</NativeSelect>
							<p className="text-text-secondary text-[13px] mt-1 mb-0">
								Omit tells Commit/Make PR agents not to add trailers. Include appends the trailer text below to
								the commit message.
							</p>
						</div>
						<div className="mb-3">
							<div className="flex items-center justify-between gap-2 mb-2">
								<label
									htmlFor="runtime-settings-commit-trailer-template"
									className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary"
								>
									Trailer text
								</label>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleResetCommitTrailerTemplate}
									disabled={controlsDisabled || isCommitTrailerTemplateAtDefault}
								>
									Reset
								</Button>
							</div>
							<textarea
								id="runtime-settings-commit-trailer-template"
								rows={2}
								value={commitTrailerTemplate}
								onChange={(event) => setCommitTrailerTemplate(event.target.value)}
								placeholder="Commit trailer text"
								disabled={controlsDisabled}
								className={cn(
									"w-full rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none disabled:opacity-40",
									commitTrailerMode === "omit" && "opacity-60",
								)}
							/>
							<p className="text-text-secondary text-[13px] mt-2 mb-0">
								Use{" "}
								<InlineUtilityButton
									text={
										copiedVariableToken === TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE.token
											? "Copied!"
											: TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE.token
									}
									monospace
									widthCh={
										Math.max(TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE.token.length, "Copied!".length) + 2
									}
									onClick={() => {
										handleCopyVariableToken(TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE.token);
									}}
									disabled={controlsDisabled}
								/>{" "}
								to reference {TASK_GIT_COMMIT_TRAILER_PROMPT_VARIABLE.description} inside the commit/PR prompts
								below.
							</p>
						</div>
						<div className="flex items-center justify-between gap-2 mb-2">
							<NativeSelect
								value={selectedPromptVariant}
								onChange={(event) => setSelectedPromptVariant(event.target.value as TaskGitAction)}
								disabled={controlsDisabled}
								style={{ minWidth: 220 }}
							>
								{GIT_PROMPT_VARIANT_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</NativeSelect>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleResetSelectedPrompt}
								disabled={controlsDisabled || isSelectedPromptAtDefault}
							>
								Reset
							</Button>
						</div>
						<textarea
							rows={5}
							value={selectedPromptValue}
							onChange={(event) => handleSelectedPromptChange(event.target.value)}
							placeholder={selectedPromptPlaceholder}
							disabled={controlsDisabled}
							className="w-full rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none disabled:opacity-40"
						/>
						<p className="text-text-secondary text-[13px] mt-2 mb-0">
							Use{" "}
							<InlineUtilityButton
								text={
									copiedVariableToken === TASK_GIT_BASE_REF_PROMPT_VARIABLE.token
										? "Copied!"
										: TASK_GIT_BASE_REF_PROMPT_VARIABLE.token
								}
								monospace
								widthCh={Math.max(TASK_GIT_BASE_REF_PROMPT_VARIABLE.token.length, "Copied!".length) + 2}
								onClick={() => {
									handleCopyVariableToken(TASK_GIT_BASE_REF_PROMPT_VARIABLE.token);
								}}
								disabled={controlsDisabled}
							/>{" "}
							to reference {TASK_GIT_BASE_REF_PROMPT_VARIABLE.description}
						</p>
						{selectedPromptVariant === "commit" ? (
							<p className="text-text-secondary text-[13px] mt-1 mb-0">
								Use{" "}
								<InlineUtilityButton
									text={
										copiedVariableToken === TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.token
											? "Copied!"
											: TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.token
									}
									monospace
									widthCh={
										Math.max(TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.token.length, "Copied!".length) + 2
									}
									onClick={() => {
										handleCopyVariableToken(TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.token);
									}}
									disabled={controlsDisabled}
								/>{" "}
								to reference {TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.description}. Commits stay on this branch
								until you merge it into the base from the task card.
							</p>
						) : null}
					</div>

					{/* ---- Notifications ---- */}
					<div data-settings-section="notifications" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<Bell size={16} className="text-text-secondary" />
							Notifications
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<div className="flex items-center gap-2">
							<RadixSwitch.Root
								checked={readyForReviewNotificationsEnabled}
								disabled={controlsDisabled}
								onCheckedChange={setReadyForReviewNotificationsEnabled}
								className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
							>
								<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
							</RadixSwitch.Root>
							<span className="text-[13px] text-text-primary">Notify when a task is ready for review</span>
						</div>
						<div className="flex items-center gap-2 mt-2">
							<p className="text-text-secondary text-[13px] m-0">
								Browser permission: {formatNotificationPermissionStatus(notificationPermission)}
							</p>
							{notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
								<InlineUtilityButton
									text="Request permission"
									onClick={handleRequestPermission}
									disabled={controlsDisabled}
								/>
							) : null}
						</div>
					</div>

					{/* ---- Notifications ---- */}
					<div data-settings-section="appearance" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<Palette size={16} className="text-text-secondary" />
							Appearance
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
							Theme
						</h6>
						<p className="text-text-secondary text-[12px] mt-0 mb-2">
							Preview updates live. Click Save to keep a theme change; Cancel reverts it.
						</p>
						<div className="min-w-0 w-1/2 max-w-full">
							<ThemeSelect variant="field" value={draftThemeId} onValueChange={setDraftThemeId} />
						</div>

						<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary mt-5 mb-2">
							Layout
						</h6>
						<Button size="sm" onClick={resetLayoutCustomizations}>
							Reset layout
						</Button>
						<p className="text-text-secondary text-[13px] mt-2 mb-0">
							Reset sidebar, split pane, and terminal resize customizations back to their defaults.
						</p>
					</div>
					<div data-settings-section="project" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<FolderOpen size={16} className="text-text-secondary" />
							Project
						</h2>
					</div>
					<p
						className="text-text-secondary font-mono text-xs m-0 mb-3 break-all"
						style={{ cursor: config?.projectConfigPath ? "pointer" : undefined }}
						onClick={() => {
							if (config?.projectConfigPath) {
								handleOpenFilePath(config.projectConfigPath);
							}
						}}
					>
						{config?.projectConfigPath
							? formatPathForDisplay(config.projectConfigPath)
							: "<project>/.agent/kanban/config.json"}
						{config?.projectConfigPath ? <ExternalLink size={12} className="inline ml-1.5 align-middle" /> : null}
					</p>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<div className="flex items-center justify-between mb-2">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
								Local assets
								<span className="ml-2 text-[10px] font-medium normal-case tracking-normal text-text-tertiary">
									Project · saved immediately
								</span>
							</h6>
							<Button
								variant="ghost"
								size="sm"
								disabled={syncCatalogBusy || !workspaceId}
								onClick={handleSyncCatalogToProject}
							>
								{syncCatalogBusy ? "Syncing…" : "Sync catalog to this project"}
							</Button>
						</div>
						<div className="flex items-start gap-2">
							<RadixSwitch.Root
								checked={localAssetsEnabled}
								disabled={localAssetsBusy || !workspaceId}
								onCheckedChange={handleLocalAssetsToggle}
								aria-label="Load this project's local skills, agents, commands and workflows"
								className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
							>
								<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
							</RadixSwitch.Root>
							<div className="min-w-0">
								<span className="text-[13px] text-text-primary">
									Load this project's local skills, agents, commands &amp; workflows
								</span>
								<p className="text-text-secondary text-[13px] mt-0.5 mb-0">
									Surfaces this repo's own <code>.claude</code> and <code>.agent</code> assets in the task
									launch card. Off by default so an attached repo can't expose its skills to run without
									opt-in.
								</p>
								{localAssetsEnabled ? (
									<div className="mt-2 flex flex-wrap items-center gap-3">
										{ALL_LOCAL_ASSET_ROOTS.map((root) => (
											<label
												key={root}
												className="flex items-center gap-1.5 text-[12px] text-text-secondary cursor-pointer"
											>
												<input
													type="checkbox"
													className="cursor-pointer"
													checked={localAssetsRoots.includes(root)}
													disabled={localAssetsBusy || !workspaceId}
													onChange={(event) => {
														handleLocalAssetRootToggle(root, event.target.checked);
													}}
												/>
												<code>{LOCAL_ASSET_ROOT_LABELS[root]}</code>
											</label>
										))}
									</div>
								) : null}
							</div>
						</div>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<div className="flex items-center justify-between mb-2">
							<h6
								ref={shortcutsSectionRef}
								className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0"
							>
								Script shortcuts
								<span className="ml-2 text-[10px] font-medium normal-case tracking-normal text-text-tertiary">
									Project
								</span>
							</h6>
							<Button
								variant="ghost"
								size="sm"
								icon={<Plus size={14} />}
								onClick={() => {
									setShortcuts((current) => {
										const nextLabel = getNextShortcutLabel(current, "Run");
										setPendingShortcutScrollIndex(current.length);
										return [
											...current,
											{
												label: nextLabel,
												command: "",
												icon: "play",
											},
										];
									});
								}}
								disabled={controlsDisabled}
							>
								Add
							</Button>
						</div>

						{shortcuts.map((shortcut, shortcutIndex) => (
							<div
								key={shortcutIndex}
								ref={(node) => {
									shortcutRowRefs.current[shortcutIndex] = node;
								}}
								className="grid gap-2 mb-1"
								style={{
									gridTemplateColumns: "max-content 1fr 2fr auto",
								}}
							>
								<ShortcutIconPicker
									value={shortcut.icon}
									onSelect={(icon) =>
										setShortcuts((current) =>
											current.map((item, itemIndex) =>
												itemIndex === shortcutIndex ? { ...item, icon } : item,
											),
										)
									}
								/>
								<input
									value={shortcut.label}
									onChange={(event) =>
										setShortcuts((current) =>
											current.map((item, itemIndex) =>
												itemIndex === shortcutIndex ? { ...item, label: event.target.value } : item,
											),
										)
									}
									placeholder="Label"
									className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								/>
								<input
									value={shortcut.command}
									onChange={(event) =>
										setShortcuts((current) =>
											current.map((item, itemIndex) =>
												itemIndex === shortcutIndex ? { ...item, command: event.target.value } : item,
											),
										)
									}
									placeholder="Command"
									className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								/>
								<Button
									variant="ghost"
									size="sm"
									icon={<X size={14} />}
									aria-label={`Remove shortcut ${shortcut.label}`}
									onClick={() =>
										setShortcuts((current) => current.filter((_, itemIndex) => itemIndex !== shortcutIndex))
									}
								/>
							</div>
						))}
						{shortcuts.length === 0 ? (
							<p className="text-text-secondary text-[13px]">No shortcuts configured.</p>
						) : null}
					</div>

					{saveError ? (
						<div className="flex gap-2 rounded-md border border-status-red/30 bg-status-red/5 p-3 text-[13px]">
							<span className="text-text-primary">{saveError}</span>
						</div>
					) : null}
				</div>
				</div>
			</div>
			<DialogFooter>
				<Button
					size="sm"
					variant="ghost"
					className="mr-auto mt-[3px]"
					icon={<ExternalLink size={14} />}
					onClick={() => window.open("https://github.com/PixelOffice-v2/PixelOffice", "_blank")}
				>
					Read the docs
				</Button>
				<Button onClick={() => handleDialogOpenChange(false)} disabled={controlsDisabled}>
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={() => void handleSave()}
					disabled={controlsDisabled || !hasUnsavedChanges}
				>
					Save
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
