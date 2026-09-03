import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { deriveTaskTitleFromPrompt } from "@runtime-task-title";
import { ArrowBigUp, Check, Command, CornerDownLeft } from "lucide-react";
import {
	type Dispatch,
	type ReactElement,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { BranchSelectDropdown, type BranchSelectOption } from "@/components/branch-select-dropdown";
import { PlanPickerSelect } from "@/components/plan-picker-select";
import { TaskAgentModelPicker, useTaskAgentModelPicker } from "@/components/task-agent-model-picker";
import { TaskLaunchSettingsPicker } from "@/components/task-launch-settings";
import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
	TaskAccountPicker,
	applyTaskSeatSelection,
	applyTaskSubagentSeatSelection,
	filterManagerAccountsForAgent,
} from "@/manager/task-account-picker";
import { useClineApiSeats } from "@/runtime/use-cline-api-seats";
import type {
	RuntimeAgentId,
	RuntimeClineReasoningEffort,
	RuntimeManagerAccount,
	RuntimeSavedPlan,
	RuntimeSeatPreset,
	RuntimeTaskClineSettings,
	RuntimeTaskLaunchSettings,
} from "@/runtime/types";
import type { TaskImage } from "@/types";
import { pasteShortcutLabel } from "@/utils/platform";
import { useDocumentEvent, useMeasure } from "@/utils/react-use";

export type TaskInlineCardMode = "create" | "edit";

export type TaskBranchOption = BranchSelectOption;

const COMPACT_ACTIONS_WIDTH_THRESHOLD_PX = 280;

function ButtonShortcut({ includeShift = false }: { includeShift?: boolean }): ReactElement {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 2,
				marginLeft: 6,
			}}
			aria-hidden
		>
			<Command size={12} />
			{includeShift ? <ArrowBigUp size={12} /> : null}
			<CornerDownLeft size={12} />
		</span>
	);
}

export function TaskInlineCreateCard({
	title,
	onTitleChange,
	prompt,
	onPromptChange,
	images,
	onImagesChange,
	onCreate,
	onCreateAndStart,
	onCancel,
	startInPlanMode,
	onStartInPlanModeChange,
	planFilePath = null,
	onPlanFilePathChange,
	savedPlans = [],
	autoReviewEnabled = false,
	onAutoReviewEnabledChange,
	showAutoCommitOptIn = false,
	startInPlanModeDisabled = false,
	workspaceId,
	branchRef,
	branchOptions,
	onBranchRefChange,
	branchSelectDisabled = false,
	branchSelectDisabledReason,
	enabled = true,
	mode = "create",
	idPrefix = "inline-task",
	agentId,
	onAgentIdChange,
	clineSettings,
	onClineSettingsChange,
	taskLaunchSettings,
	onTaskLaunchSettingsChange,
	defaultAgentId,
	defaultProviderId,
	defaultModelId,
	defaultReasoningEffort,
	managerAccounts = [],
	managerActiveAccountId = null,
	managerAccountId,
	onManagerAccountIdChange,
	seatPreset,
	onSeatPresetChange,
	autoRunDelayMinutes = 0,
	onAutoRunDelayMinutesChange,
	autoResumeOnUsageLimit = false,
	onAutoResumeOnUsageLimitChange,
	autoFailoverOnUsageLimit = false,
	onAutoFailoverOnUsageLimitChange,
}: {
	title?: string;
	onTitleChange?: (value: string) => void;
	prompt: string;
	onPromptChange: (value: string) => void;
	images?: TaskImage[];
	onImagesChange?: Dispatch<SetStateAction<TaskImage[]>>;
	onCreate: () => void;
	onCreateAndStart?: () => void;
	onCancel?: () => void;
	startInPlanMode: boolean;
	onStartInPlanModeChange: (value: boolean) => void;
	planFilePath?: string | null;
	onPlanFilePathChange?: (value: string | null) => void;
	savedPlans?: RuntimeSavedPlan[];
	/** Chain-edit only: when true, show the auto-commit checkbox. */
	showAutoCommitOptIn?: boolean;
	autoReviewEnabled?: boolean;
	onAutoReviewEnabledChange?: (value: boolean) => void;
	startInPlanModeDisabled?: boolean;
	workspaceId: string | null;
	branchRef: string;
	branchOptions: TaskBranchOption[];
	onBranchRefChange: (value: string) => void;
	branchSelectDisabled?: boolean;
	branchSelectDisabledReason?: string;
	enabled?: boolean;
	mode?: TaskInlineCardMode;
	idPrefix?: string;
	agentId?: RuntimeAgentId | undefined;
	onAgentIdChange?: (value: RuntimeAgentId | undefined) => void;
	clineSettings?: RuntimeTaskClineSettings | undefined;
	onClineSettingsChange?: (value: RuntimeTaskClineSettings | undefined) => void;
	taskLaunchSettings?: RuntimeTaskLaunchSettings | undefined;
	onTaskLaunchSettingsChange?: (value: RuntimeTaskLaunchSettings | undefined) => void;
	/** Default agent ID (active Manager seat / Settings), used for "Default (AgentName)" */
	defaultAgentId?: RuntimeAgentId | null;
	/** Default Cline provider ID from runtimeConfig.clineProviderSettings.providerId */
	defaultProviderId?: string | null;
	/** Default Cline model ID from runtimeConfig.clineProviderSettings.modelId */
	defaultModelId?: string | null;
	/** Default Cline reasoning effort from runtimeConfig.clineProviderSettings.reasoningEffort */
	defaultReasoningEffort?: RuntimeClineReasoningEffort | null;
	managerAccounts?: RuntimeManagerAccount[];
	managerActiveAccountId?: number | null;
	managerAccountId?: number | undefined;
	onManagerAccountIdChange?: (value: number | undefined) => void;
	/** Omit both to hide the seat-preset options; `null` means "supported, none chosen". */
	seatPreset?: RuntimeSeatPreset | null;
	onSeatPresetChange?: (value: RuntimeSeatPreset | undefined) => void;
	/** Minutes until the backlog card auto-starts; 0 = off. Omit the callback to hide the field. */
	autoRunDelayMinutes?: number;
	onAutoRunDelayMinutesChange?: (value: number) => void;
	autoResumeOnUsageLimit?: boolean;
	onAutoResumeOnUsageLimitChange?: (value: boolean) => void;
	autoFailoverOnUsageLimit?: boolean;
	onAutoFailoverOnUsageLimitChange?: (value: boolean) => void;
}): ReactElement {
	const promptId = `${idPrefix}-prompt-input`;
	const planModeId = `${idPrefix}-plan-mode-toggle`;
	const autoCommitOptInId = `${idPrefix}-auto-commit-opt-in`;
	const autoResumeOnUsageLimitId = `${idPrefix}-auto-resume-usage-limit`;
	const autoFailoverOnUsageLimitId = `${idPrefix}-auto-failover-usage-limit`;
	const teamworkPreviewId = `${idPrefix}-teamwork-preview`;
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;
	const branchSelectId = `${idPrefix}-branch-select`;
	const actionLabel = mode === "edit" ? "Save" : "Create";
	const [measureRef, cardRect] = useMeasure<HTMLDivElement>();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [isBranchPopoverOpen, setIsBranchPopoverOpen] = useState(false);
	const [isModelPickerPopoverOpen, setIsModelPickerPopoverOpen] = useState(false);
	const setCardRef = useCallback(
		(node: HTMLDivElement | null) => {
			containerRef.current = node;
			if (node) {
				measureRef(node);
			}
		},
		[measureRef],
	);
	const isCompactActions = cardRect.width > 0 && cardRect.width < COMPACT_ACTIONS_WIDTH_THRESHOLD_PX;
	const hideCancelShortcut = isCompactActions;
	const hideCreateShortcut = mode === "create" && isCompactActions;
	const cancelLabel = hideCancelShortcut ? "Cancel" : "Cancel (esc)";
	const cardMarginBottom = mode === "create" ? 6 : 0;
	const canShowAutoCommitOptIn =
		mode === "edit" && showAutoCommitOptIn && typeof onAutoReviewEnabledChange === "function";
	const { seats: apiSeats } = useClineApiSeats(workspaceId);

	const {
		agentOptions,
		clineProviderOptions,
		clineModelOptions,
		effectiveDefaultModelId,
		providerModels,
		isLoadingProviders,
		isLoadingModels,
		providerDefaultModels,
	} = useTaskAgentModelPicker({
		active: true,
		workspaceId,
		agentId,
		clineSettings,
		defaultAgentId,
		defaultProviderId,
		defaultModelId,
		apiSeats,
	});

	const eligibleManagerAccounts = useMemo(
		() =>
			filterManagerAccountsForAgent(managerAccounts, effectiveAgentId, {
				kanbanEligibleOnly: true,
			}),
		[effectiveAgentId, managerAccounts],
	);

	useEffect(() => {
		if (managerAccountId === undefined || !onManagerAccountIdChange) {
			return;
		}
		if (!eligibleManagerAccounts.some((account) => account.id === managerAccountId)) {
			onManagerAccountIdChange(undefined);
		}
	}, [eligibleManagerAccounts, managerAccountId, onManagerAccountIdChange]);

	useHotkeys(
		"escape",
		(event) => {
			if (!onCancel) {
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
				return;
			}
			onCancel();
		},
		{
			enabled: enabled && Boolean(onCancel),
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[enabled, mode, onCancel],
	);

	useDocumentEvent(
		"pointerdown",
		(event) => {
			if (!enabled || mode !== "edit" || isBranchPopoverOpen || isModelPickerPopoverOpen) {
				return;
			}
			const container = containerRef.current;
			if (!container) {
				return;
			}
			if (event.target instanceof Node && container.contains(event.target)) {
				return;
			}
			onCreate();
		},
		true,
	);

	return (
		<div
			ref={setCardRef}
			className="rounded-md border border-border-bright bg-surface-2 p-3"
			style={{ flexShrink: 0, marginBottom: cardMarginBottom, fontSize: 12 }}
		>
			<div>
				{onTitleChange ? (
					<div className="mb-2">
						<label htmlFor={`${idPrefix}-title-input`} className="mb-1 block text-[11px] text-text-secondary">
							Title
						</label>
						<input
							id={`${idPrefix}-title-input`}
							value={title ?? ""}
							onChange={(event) => onTitleChange(event.currentTarget.value)}
							placeholder={deriveTaskTitleFromPrompt(prompt) || "Auto-generated from prompt"}
							className="h-8 w-full rounded-md border border-border-bright bg-surface-2 px-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</div>
				) : null}
				<TaskPromptComposer
					id={promptId}
					value={prompt}
					onValueChange={onPromptChange}
					images={images}
					onImagesChange={onImagesChange}
					onSubmit={onCreate}
					onSubmitAndStart={onCreateAndStart}
					onEscape={onCancel}
					placeholder="Describe the task..."
					enabled={enabled}
					autoFocus
					workspaceId={workspaceId}
					showAttachImageButton={false}
				/>
				<p className="text-[11px] text-text-tertiary mt-1 mb-0">
					Use <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">@file</code> to reference
					files. Drag and drop or{" "}
					<code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">{pasteShortcutLabel}</code> to
					add images — each one is inserted at the cursor as{" "}
					<code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">[image: name]</code>.
				</p>
			</div>

			<div className="flex flex-col gap-2 mt-3">
				{onPlanFilePathChange ? (
					<PlanPickerSelect
						id={`${planModeId}-plan-file`}
						plans={savedPlans}
						value={planFilePath}
						onChange={onPlanFilePathChange}
						disabled={!enabled}
					/>
				) : null}
				<label
					htmlFor={planModeId}
					className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
				>
					<RadixCheckbox.Root
						id={planModeId}
						aria-label="Start in plan mode"
						checked={startInPlanMode}
						onCheckedChange={(checked) => onStartInPlanModeChange(checked === true)}
						disabled={startInPlanModeDisabled || !enabled}
						className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					<span>Start in plan mode</span>
				</label>

				{effectiveAgentId === "gemini" && onTaskLaunchSettingsChange ? (
					<label
						htmlFor={teamworkPreviewId}
						className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
						data-testid="task-inline-teamwork-preview"
					>
						<RadixCheckbox.Root
							id={teamworkPreviewId}
							aria-label="Teamwork preview"
							checked={taskLaunchSettings?.teamworkPreview === true}
							disabled={!enabled}
							onCheckedChange={(checked) =>
								onTaskLaunchSettingsChange({
									...(taskLaunchSettings ?? {}),
									teamworkPreview: checked === true ? true : undefined,
								})
							}
							className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						<span>
							Teamwork preview (<code className="rounded bg-surface-3 px-1 py-px font-mono text-[11px]">/teamwork-preview</code>)
						</span>
					</label>
				) : null}

				<div>
					<span className="text-[11px] text-text-secondary block mb-1">Worktree base ref</span>
					{branchSelectDisabled && branchSelectDisabledReason ? (
						<Tooltip content={branchSelectDisabledReason} side="top">
							<span className="block w-full">
								<BranchSelectDropdown
									id={branchSelectId}
									options={branchOptions}
									selectedValue={branchRef}
									onSelect={onBranchRefChange}
									onPopoverOpenChange={setIsBranchPopoverOpen}
									fill
									size="sm"
									emptyText="No branches detected"
									disabled
								/>
							</span>
						</Tooltip>
					) : (
						<BranchSelectDropdown
							id={branchSelectId}
							options={branchOptions}
							selectedValue={branchRef}
							onSelect={onBranchRefChange}
							onPopoverOpenChange={setIsBranchPopoverOpen}
							fill
							size="sm"
							emptyText="No branches detected"
							disabled={branchSelectDisabled || !enabled}
						/>
					)}
				</div>

				{onAutoRunDelayMinutesChange ? (
					<label className="flex items-center gap-2 text-[12px] text-text-primary select-none">
						Auto-run after
						<input
							type="number"
							min={0}
							step={1}
							value={autoRunDelayMinutes}
							disabled={!enabled}
							onChange={(event) => {
								const parsed = Number(event.currentTarget.value);
								onAutoRunDelayMinutesChange(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0);
							}}
							className="w-16 rounded-sm border border-border-bright bg-surface-3 px-2 py-1 text-[12px] text-text-primary"
						/>
						min <span className="text-text-tertiary">(0 = off)</span>
					</label>
				) : null}

				{onAutoResumeOnUsageLimitChange ? (
					<label
						htmlFor={autoResumeOnUsageLimitId}
						className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
						title="If this task hits the Claude usage limit, park it and auto-continue once the window resets."
					>
						<RadixCheckbox.Root
							id={autoResumeOnUsageLimitId}
							aria-label="Auto-resume on usage limit"
							checked={autoResumeOnUsageLimit}
							disabled={!enabled}
							onCheckedChange={(checked) => onAutoResumeOnUsageLimitChange(checked === true)}
							className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						<span>Auto-resume on usage limit</span>
					</label>
				) : null}

				{onAutoFailoverOnUsageLimitChange ? (
					<label
						htmlFor={autoFailoverOnUsageLimitId}
						className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
						title="If this task hits the Claude usage limit, restart on another healthy seat with --continue before waiting for a reset."
					>
						<RadixCheckbox.Root
							id={autoFailoverOnUsageLimitId}
							aria-label="Auto-failover on usage limit"
							checked={autoFailoverOnUsageLimit}
							disabled={!enabled}
							onCheckedChange={(checked) => onAutoFailoverOnUsageLimitChange(checked === true)}
							className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						<span>Auto-failover on usage limit</span>
					</label>
				) : null}

				{canShowAutoCommitOptIn ? (
					<label
						htmlFor={autoCommitOptInId}
						className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none"
					>
						<RadixCheckbox.Root
							id={autoCommitOptInId}
							aria-label="Automatically make commit"
							checked={autoReviewEnabled}
							onCheckedChange={(checked) => onAutoReviewEnabledChange?.(checked === true)}
							className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						<span>Automatically make commit</span>
					</label>
				) : null}
				{onAgentIdChange && onClineSettingsChange ? (
					<>
						<TaskAgentModelPicker
							agentId={agentId}
							onAgentIdChange={onAgentIdChange}
							clineSettings={clineSettings}
							onClineSettingsChange={onClineSettingsChange}
							agentOptions={agentOptions}
							clineProviderOptions={clineProviderOptions}
							clineModelOptions={clineModelOptions}
							effectiveDefaultModelId={effectiveDefaultModelId}
							providerModels={providerModels}
							isLoadingProviders={isLoadingProviders}
							isLoadingModels={isLoadingModels}
							defaultAgentId={defaultAgentId}
							defaultProviderId={defaultProviderId}
							defaultReasoningEffort={defaultReasoningEffort}
							providerDefaultModels={providerDefaultModels}
							onPopoverOpenChange={setIsModelPickerPopoverOpen}
						/>
					</>
				) : null}
				{onManagerAccountIdChange && (eligibleManagerAccounts.length > 0 || apiSeats.length > 0) ? (
					<TaskAccountPicker
						accounts={eligibleManagerAccounts}
						allAccounts={managerAccounts}
						apiSeats={apiSeats}
						value={managerAccountId}
						{...(onSeatPresetChange ? { seatPreset: seatPreset ?? null } : {})}
						clineProviderId={clineSettings?.providerId ?? null}
						activeAccountId={managerActiveAccountId}
						agentId={effectiveAgentId}
						onChange={(selection) => {
							applyTaskSeatSelection(selection, {
								onManagerAccountIdChange,
								onAgentIdChange,
								onClineSettingsChange,
								onSeatPresetChange,
								currentAgentId: effectiveAgentId,
							});
						}}
						subagentSeatProviderId={taskLaunchSettings?.subagentSeatProviderId ?? null}
						{...(onTaskLaunchSettingsChange
							? {
									onSubagentSeatChange: (selection) => {
										onTaskLaunchSettingsChange(
											applyTaskSubagentSeatSelection(selection, taskLaunchSettings),
										);
									},
								}
							: {})}
					/>
				) : null}
				{onTaskLaunchSettingsChange ? (
					<TaskLaunchSettingsPicker
						active
						agentId={agentId}
						defaultAgentId={defaultAgentId}
						workspaceId={workspaceId}
						value={taskLaunchSettings}
						seatPreset={seatPreset ?? null}
						onChange={onTaskLaunchSettingsChange}
					/>
				) : null}
			</div>

			<div className={`flex gap-2 mt-3 ${mode === "edit" ? "justify-end" : "justify-between"}`}>
				{mode === "create" && onCancel ? (
					<Button variant="default" size="sm" className="whitespace-nowrap" onClick={onCancel}>
						{cancelLabel}
					</Button>
				) : null}
				<div className="flex gap-2">
					<Button
						size="sm"
						className="whitespace-nowrap"
						onClick={onCreate}
						disabled={!prompt.trim() || !branchRef}
					>
						<span className="inline-flex items-center">
							<span>{actionLabel}</span>
							{hideCreateShortcut ? null : <ButtonShortcut />}
						</span>
					</Button>
					{onCreateAndStart ? (
						<Button
							variant="primary"
							size="sm"
							className="whitespace-nowrap"
							onClick={onCreateAndStart}
							disabled={!prompt.trim() || !branchRef}
						>
							<span className="inline-flex items-center">
								<span>Start</span>
								<ButtonShortcut includeShift />
							</span>
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
