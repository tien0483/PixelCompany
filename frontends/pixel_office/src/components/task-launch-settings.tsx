import { X } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SearchSelectDropdown } from "@/components/search-select-dropdown";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { Tooltip } from "@/components/ui/tooltip";
import { SKILL_INVENTORY_CHANGED_EVENT } from "@/runtime/skill-inventory-events";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
	RuntimeAgentModelInventoryItem,
	RuntimeMcpInventoryItem,
	RuntimeSkillInventoryItem,
	RuntimeTaskLaunchEffort,
	RuntimeTaskLaunchSettings,
} from "@/runtime/types";

const EFFORT_OPTIONS: Array<{ value: RuntimeTaskLaunchEffort; label: string }> = [
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra high" },
	{ value: "max", label: "Max" },
];

const CLAUDE_MODEL_FALLBACK: RuntimeAgentModelInventoryItem[] = [
	{ id: "sonnet", label: "Sonnet (latest alias)" },
	{ id: "opus", label: "Opus (latest alias)" },
	{ id: "haiku", label: "Haiku (latest alias)" },
];

const CURSOR_MODEL_FALLBACK: RuntimeAgentModelInventoryItem[] = [
	{ id: "auto", label: "Auto" },
	{ id: "composer-2.5", label: "Composer 2.5" },
	{ id: "gpt-5.2", label: "GPT-5.2" },
];

type AllowlistKey = "skillIds" | "agentIds" | "commandIds" | "workflowIds" | "mcpServerIds";

function cloneLaunchSettings(settings?: RuntimeTaskLaunchSettings | null): RuntimeTaskLaunchSettings | undefined {
	if (settings === undefined || settings === null) {
		return undefined;
	}
	const next: RuntimeTaskLaunchSettings = {
		...(settings.modelId ? { modelId: settings.modelId } : {}),
		...(settings.effort ? { effort: settings.effort } : {}),
		...(settings.skillIds && settings.skillIds.length > 0 ? { skillIds: [...settings.skillIds] } : {}),
		...(settings.agentIds && settings.agentIds.length > 0 ? { agentIds: [...settings.agentIds] } : {}),
		...(settings.commandIds && settings.commandIds.length > 0 ? { commandIds: [...settings.commandIds] } : {}),
		...(settings.workflowIds && settings.workflowIds.length > 0 ? { workflowIds: [...settings.workflowIds] } : {}),
		...(settings.mcpServerIds && settings.mcpServerIds.length > 0
			? { mcpServerIds: [...settings.mcpServerIds] }
			: {}),
	};
	if (
		next.modelId === undefined &&
		next.effort === undefined &&
		next.skillIds === undefined &&
		next.agentIds === undefined &&
		next.commandIds === undefined &&
		next.workflowIds === undefined &&
		next.mcpServerIds === undefined
	) {
		return undefined;
	}
	return next;
}

function launchSettingsKey(settings?: RuntimeTaskLaunchSettings | null): string {
	return JSON.stringify(cloneLaunchSettings(settings) ?? null);
}

function emitSettings(
	next: RuntimeTaskLaunchSettings | undefined,
	onChange: (value: RuntimeTaskLaunchSettings | undefined) => void,
): void {
	onChange(cloneLaunchSettings(next));
}

function TagChip({
	label,
	description,
	badge,
	onRemove,
}: {
	label: string;
	description?: string;
	badge?: string;
	onRemove: () => void;
}): ReactElement {
	const labelNode = description ? (
		<Tooltip content={<span className="max-w-xs whitespace-pre-wrap break-words">{description}</span>}>
			<span className="truncate" title={description}>
				{label}
			</span>
		</Tooltip>
	) : (
		<span className="truncate">{label}</span>
	);

	return (
		<span className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-primary">
			{labelNode}
			{badge ? (
				<span
					data-testid="task-launch-project-badge"
					className="shrink-0 rounded-sm bg-status-purple/15 px-1 text-[9px] font-medium uppercase tracking-wide text-status-purple"
				>
					{badge}
				</span>
			) : null}
			<button
				type="button"
				aria-label={`Remove ${label}`}
				className="shrink-0 rounded-sm p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
				onClick={(event) => {
					// Keep remove outside the tooltip trigger so hover tooltips cannot
					// swallow the click (regression when descriptions were added).
					event.preventDefault();
					event.stopPropagation();
					onRemove();
				}}
			>
				<X size={12} />
			</button>
		</span>
	);
}

function ResourceAllowlistSection({
	title,
	allLabel,
	addLabel,
	attachedIds,
	items,
	pick,
	setPick,
	onAdd,
	onRemove,
}: {
	title: string;
	allLabel: string;
	addLabel: string;
	attachedIds: string[];
	items: Array<{ id: string; displayName: string; description?: string; origin?: "global" | "project" }>;
	pick: string;
	setPick: (value: string) => void;
	onAdd: (id: string) => void;
	onRemove: (id: string) => void;
}): ReactElement {
	const available = items.filter((item) => !attachedIds.includes(item.id));
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[11px] text-text-secondary">{title}</span>
				<span className="text-[10px] text-text-tertiary">
					{attachedIds.length === 0 ? allLabel : "Allowlist"}
				</span>
			</div>
			<div className="flex flex-wrap gap-1">
				{attachedIds.map((id) => {
					const item = items.find((entry) => entry.id === id);
					return (
						<TagChip
							key={id}
							label={item?.displayName ?? id}
							description={item?.description}
							badge={item?.origin === "project" ? "This project" : undefined}
							onRemove={() => onRemove(id)}
						/>
					);
				})}
			</div>
			{available.length > 0 ? (
				<NativeSelect
					value={pick}
					onChange={(event) => {
						const nextId = event.target.value;
						setPick("");
						if (!nextId) {
							return;
						}
						onAdd(nextId);
					}}
				>
					<option value="">{addLabel}</option>
					{available.map((item) => (
						<option key={item.id} value={item.id}>
							{item.origin === "project" ? `${item.displayName} · this project` : item.displayName}
						</option>
					))}
				</NativeSelect>
			) : null}
		</div>
	);
}

export function TaskLaunchSettingsPicker({
	active,
	agentId,
	defaultAgentId,
	workspaceId,
	value,
	onChange,
	sessionAppliesOnRestart = false,
}: {
	active: boolean;
	agentId: RuntimeAgentId | undefined;
	defaultAgentId?: RuntimeAgentId | null;
	/** Active project whose local `.claude`/`.agent` assets should be surfaced (subject to the per-project toggle). */
	workspaceId?: string | null;
	value?: RuntimeTaskLaunchSettings;
	onChange: (value: RuntimeTaskLaunchSettings | undefined) => void;
	/** When true, show that skill/MCP/model tags apply on the next session start. */
	sessionAppliesOnRestart?: boolean;
}): ReactElement | null {
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;
	const showForAgent = effectiveAgentId === "claude" || effectiveAgentId === "cursor";
	const [skills, setSkills] = useState<RuntimeSkillInventoryItem[]>([]);
	const [agents, setAgents] = useState<RuntimeSkillInventoryItem[]>([]);
	const [commands, setCommands] = useState<RuntimeSkillInventoryItem[]>([]);
	const [workflows, setWorkflows] = useState<RuntimeSkillInventoryItem[]>([]);
	const [mcpServers, setMcpServers] = useState<RuntimeMcpInventoryItem[]>([]);
	const [models, setModels] = useState<RuntimeAgentModelInventoryItem[]>([]);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [skillPick, setSkillPick] = useState("");
	const [agentPick, setAgentPick] = useState("");
	const [commandPick, setCommandPick] = useState("");
	const [workflowPick, setWorkflowPick] = useState("");
	const [mcpPick, setMcpPick] = useState("");
	// Optimistic draft so rapid "Add skill" selections accumulate even before the
	// parent re-renders with the persisted board value.
	const [draft, setDraft] = useState<RuntimeTaskLaunchSettings | undefined>(() => cloneLaunchSettings(value));
	const draftKeyRef = useRef(launchSettingsKey(value));

	useEffect(() => {
		const nextKey = launchSettingsKey(value);
		if (nextKey === draftKeyRef.current) {
			return;
		}
		draftKeyRef.current = nextKey;
		setDraft(cloneLaunchSettings(value));
	}, [value]);

	const refreshInventories = useCallback(() => {
		if (!active || !showForAgent) {
			return;
		}
		const client = getRuntimeTrpcClient(null);
		void Promise.all([
			client.runtime.listSkillInventory.query(workspaceId ? { workspaceId } : {}),
			client.runtime.listMcpInventory.query(),
		])
			.then(([skillInventory, mcpInventory]) => {
				setSkills(skillInventory.skills);
				setAgents(skillInventory.agents ?? []);
				setCommands(skillInventory.commands ?? []);
				setWorkflows(skillInventory.workflows ?? []);
				setMcpServers(mcpInventory.servers);
			})
			.catch(() => {
				setSkills([]);
				setAgents([]);
				setCommands([]);
				setWorkflows([]);
				setMcpServers([]);
			});
	}, [active, showForAgent, workspaceId]);

	useEffect(() => {
		refreshInventories();
	}, [refreshInventories]);

	useEffect(() => {
		if (!active || !showForAgent) {
			return;
		}
		const onChanged = () => {
			refreshInventories();
		};
		window.addEventListener(SKILL_INVENTORY_CHANGED_EVENT, onChanged);
		window.addEventListener("focus", onChanged);
		return () => {
			window.removeEventListener(SKILL_INVENTORY_CHANGED_EVENT, onChanged);
			window.removeEventListener("focus", onChanged);
		};
	}, [active, refreshInventories, showForAgent]);

	useEffect(() => {
		if (!active || (effectiveAgentId !== "claude" && effectiveAgentId !== "cursor")) {
			setModels([]);
			return;
		}
		let cancelled = false;
		setModelsLoading(true);
		const fallback = effectiveAgentId === "cursor" ? CURSOR_MODEL_FALLBACK : CLAUDE_MODEL_FALLBACK;
		void getRuntimeTrpcClient(null)
			.runtime.listAgentModels.query({ agentId: effectiveAgentId })
			.then((inventory) => {
				if (cancelled) {
					return;
				}
				setModels(inventory.models.length > 0 ? inventory.models : fallback);
			})
			.catch(() => {
				if (!cancelled) {
					setModels(fallback);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setModelsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, effectiveAgentId]);

	const modelOptions = useMemo(
		() => [
			{ value: "", label: "Default" },
			...models.map((model) => ({ value: model.id, label: model.label })),
		],
		[models],
	);

	const selectedModelLabel = useMemo(() => {
		const selected = draft?.modelId;
		if (!selected) {
			return "Default";
		}
		return models.find((model) => model.id === selected)?.label ?? selected;
	}, [draft?.modelId, models]);

	const attachedSkillIds = draft?.skillIds ?? [];
	const attachedAgentIds = draft?.agentIds ?? [];
	const attachedCommandIds = draft?.commandIds ?? [];
	const attachedWorkflowIds = draft?.workflowIds ?? [];
	const attachedMcpIds = draft?.mcpServerIds ?? [];

	if (!showForAgent) {
		return null;
	}

	const commit = (next: RuntimeTaskLaunchSettings | undefined) => {
		const cloned = cloneLaunchSettings(next);
		draftKeyRef.current = launchSettingsKey(cloned);
		setDraft(cloned);
		emitSettings(cloned, onChange);
	};

	const update = (patch: Partial<RuntimeTaskLaunchSettings> | null) => {
		if (patch === null) {
			commit(undefined);
			return;
		}
		const current = cloneLaunchSettings(draft) ?? {};
		const next: RuntimeTaskLaunchSettings = { ...current, ...patch };
		if (patch.modelId === "") {
			delete next.modelId;
		}
		for (const key of ["skillIds", "agentIds", "commandIds", "workflowIds", "mcpServerIds"] as const) {
			if (patch[key] !== undefined && (patch[key]?.length ?? 0) === 0) {
				delete next[key];
			}
		}
		commit(next);
	};

	const addAllowlistId = (key: AllowlistKey, id: string) => {
		setDraft((currentDraft) => {
			const currentIds = currentDraft?.[key] ?? [];
			if (currentIds.includes(id)) {
				return currentDraft;
			}
			const next = cloneLaunchSettings({
				...(currentDraft ?? {}),
				[key]: [...currentIds, id],
			});
			draftKeyRef.current = launchSettingsKey(next);
			emitSettings(next, onChange);
			return next;
		});
	};

	const removeAllowlistId = (key: AllowlistKey, id: string) => {
		setDraft((currentDraft) => {
			const currentIds = currentDraft?.[key] ?? [];
			const nextIds = currentIds.filter((entry) => entry !== id);
			const next = cloneLaunchSettings({
				...(currentDraft ?? {}),
				[key]: nextIds,
			});
			draftKeyRef.current = launchSettingsKey(next);
			emitSettings(next, onChange);
			return next;
		});
	};

	const hasAnyTags =
		Boolean(draft?.modelId) ||
		Boolean(draft?.effort) ||
		attachedSkillIds.length > 0 ||
		attachedAgentIds.length > 0 ||
		attachedCommandIds.length > 0 ||
		attachedWorkflowIds.length > 0 ||
		attachedMcpIds.length > 0;

	return (
		<div className="flex flex-col gap-2" data-testid="task-launch-settings">
			<p className="text-[10px] text-text-tertiary">
				Manager installs globally; tags on this card limit what this task can use.
			</p>
			{sessionAppliesOnRestart ? (
				<p className="text-[10px] text-text-tertiary" data-testid="task-launch-settings-restart-hint">
					Agent/Skill/Slash command/MCP allowlist changes are sent to the running session. Model changes
					apply on restart.
				</p>
			) : null}
			<div className="grid grid-cols-2 gap-2">
				<label className="flex flex-col gap-1 text-[11px] text-text-secondary">
					Model
					<SearchSelectDropdown
						fill
						size="sm"
						options={modelOptions}
						selectedValue={draft?.modelId ?? ""}
						buttonText={modelsLoading ? "Loading models…" : selectedModelLabel}
						placeholder="Search models…"
						emptyText="No models available"
						allowCustomValue
						customValueLabel={(query) => `Use model id “${query}”`}
						onSelect={(next) => {
							update(next ? { modelId: next } : { modelId: "" });
						}}
					/>
				</label>
				<label className="flex flex-col gap-1 text-[11px] text-text-secondary">
					Effort
					<NativeSelect
						value={draft?.effort ?? ""}
						onChange={(event) => {
							const next = event.target.value as RuntimeTaskLaunchEffort | "";
							const current = cloneLaunchSettings(draft) ?? {};
							if (next) {
								current.effort = next;
							} else {
								delete current.effort;
							}
							commit(current);
						}}
					>
						<option value="">Default</option>
						{EFFORT_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</NativeSelect>
				</label>
			</div>

			<ResourceAllowlistSection
				title="Agent"
				allLabel="All installed"
				addLabel="Add agent…"
				attachedIds={attachedAgentIds}
				items={agents}
				pick={agentPick}
				setPick={setAgentPick}
				onAdd={(id) => addAllowlistId("agentIds", id)}
				onRemove={(id) => removeAllowlistId("agentIds", id)}
			/>

			<ResourceAllowlistSection
				title="Skill"
				allLabel="All installed"
				addLabel="Add skill…"
				attachedIds={attachedSkillIds}
				items={skills}
				pick={skillPick}
				setPick={setSkillPick}
				onAdd={(id) => addAllowlistId("skillIds", id)}
				onRemove={(id) => removeAllowlistId("skillIds", id)}
			/>

			<ResourceAllowlistSection
				title="Slash command"
				allLabel="All installed"
				addLabel="Add slash command…"
				attachedIds={attachedCommandIds}
				items={commands}
				pick={commandPick}
				setPick={setCommandPick}
				onAdd={(id) => addAllowlistId("commandIds", id)}
				onRemove={(id) => removeAllowlistId("commandIds", id)}
			/>

			{workflows.length > 0 ? (
				<ResourceAllowlistSection
					title="Workflow"
					allLabel="All available"
					addLabel="Add workflow…"
					attachedIds={attachedWorkflowIds}
					items={workflows}
					pick={workflowPick}
					setPick={setWorkflowPick}
					onAdd={(id) => addAllowlistId("workflowIds", id)}
					onRemove={(id) => removeAllowlistId("workflowIds", id)}
				/>
			) : null}

			<ResourceAllowlistSection
				title="MCP"
				allLabel="All configured"
				addLabel="Add MCP server…"
				attachedIds={attachedMcpIds}
				items={mcpServers}
				pick={mcpPick}
				setPick={setMcpPick}
				onAdd={(id) => addAllowlistId("mcpServerIds", id)}
				onRemove={(id) => removeAllowlistId("mcpServerIds", id)}
			/>

			{hasAnyTags ? (
				<button
					type="button"
					className={cn("self-start text-[11px] text-text-tertiary hover:text-text-secondary")}
					onClick={() => update(null)}
				>
					Clear launch tags
				</button>
			) : null}
		</div>
	);
}
