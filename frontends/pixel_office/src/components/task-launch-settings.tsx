import { X } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
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

const CLAUDE_MODEL_OPTIONS = [
	{ value: "sonnet", label: "Sonnet" },
	{ value: "opus", label: "Opus" },
	{ value: "haiku", label: "Haiku" },
];

const CURSOR_MODEL_OPTIONS = [
	{ value: "composer-2", label: "Composer 2" },
	{ value: "composer-1.5", label: "Composer 1.5" },
	{ value: "gpt-5.2", label: "GPT-5.2" },
	{ value: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet" },
	{ value: "claude-4.6-opus", label: "Claude 4.6 Opus" },
];

function cloneLaunchSettings(settings?: RuntimeTaskLaunchSettings): RuntimeTaskLaunchSettings | undefined {
	if (settings === undefined) {
		return undefined;
	}
	const next: RuntimeTaskLaunchSettings = {
		...(settings.modelId ? { modelId: settings.modelId } : {}),
		...(settings.effort ? { effort: settings.effort } : {}),
		...(settings.skillIds && settings.skillIds.length > 0 ? { skillIds: [...settings.skillIds] } : {}),
		...(settings.mcpServerIds && settings.mcpServerIds.length > 0
			? { mcpServerIds: [...settings.mcpServerIds] }
			: {}),
	};
	if (
		next.modelId === undefined &&
		next.effort === undefined &&
		next.skillIds === undefined &&
		next.mcpServerIds === undefined
	) {
		return undefined;
	}
	return next;
}

function emitSettings(
	next: RuntimeTaskLaunchSettings | undefined,
	onChange: (value: RuntimeTaskLaunchSettings | undefined) => void,
): void {
	onChange(cloneLaunchSettings(next));
}

function TagChip({
	label,
	onRemove,
}: {
	label: string;
	onRemove: () => void;
}): ReactElement {
	return (
		<span className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-primary">
			{label}
			<button
				type="button"
				aria-label={`Remove ${label}`}
				className="rounded-sm p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
				onClick={onRemove}
			>
				<X size={12} />
			</button>
		</span>
	);
}

export function TaskLaunchSettingsPicker({
	active,
	agentId,
	defaultAgentId,
	value,
	onChange,
}: {
	active: boolean;
	agentId: RuntimeAgentId | undefined;
	defaultAgentId?: RuntimeAgentId | null;
	value?: RuntimeTaskLaunchSettings;
	onChange: (value: RuntimeTaskLaunchSettings | undefined) => void;
}): ReactElement | null {
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;
	const showForAgent = effectiveAgentId === "claude" || effectiveAgentId === "cursor";
	const [skills, setSkills] = useState<RuntimeSkillInventoryItem[]>([]);
	const [mcpServers, setMcpServers] = useState<RuntimeMcpInventoryItem[]>([]);
	const [skillPick, setSkillPick] = useState("");
	const [mcpPick, setMcpPick] = useState("");

	useEffect(() => {
		if (!active || !showForAgent) {
			return;
		}
		let cancelled = false;
		const client = getRuntimeTrpcClient(null);
		void Promise.all([client.runtime.listSkillInventory.query(), client.runtime.listMcpInventory.query()])
			.then(([skillInventory, mcpInventory]) => {
				if (cancelled) {
					return;
				}
				setSkills(skillInventory.skills);
				setMcpServers(mcpInventory.servers);
			})
			.catch(() => {
				if (!cancelled) {
					setSkills([]);
					setMcpServers([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, showForAgent]);

	const modelOptions = useMemo(() => {
		if (effectiveAgentId === "cursor") {
			return CURSOR_MODEL_OPTIONS;
		}
		return CLAUDE_MODEL_OPTIONS;
	}, [effectiveAgentId]);

	const attachedSkillIds = value?.skillIds ?? [];
	const attachedMcpIds = value?.mcpServerIds ?? [];
	const availableSkills = skills.filter((skill) => !attachedSkillIds.includes(skill.id));
	const availableMcp = mcpServers.filter((server) => !attachedMcpIds.includes(server.id));

	if (!showForAgent) {
		return null;
	}

	const update = (patch: Partial<RuntimeTaskLaunchSettings> | null) => {
		if (patch === null) {
			emitSettings(undefined, onChange);
			return;
		}
		const current = cloneLaunchSettings(value) ?? {};
		const next: RuntimeTaskLaunchSettings = { ...current, ...patch };
		if (patch.modelId === "") {
			delete next.modelId;
		}
		emitSettings(next, onChange);
	};

	const removeSkill = (skillId: string) => {
		const nextIds = attachedSkillIds.filter((id) => id !== skillId);
		update({ skillIds: nextIds.length > 0 ? nextIds : undefined });
	};

	const removeMcp = (serverId: string) => {
		const nextIds = attachedMcpIds.filter((id) => id !== serverId);
		update({ mcpServerIds: nextIds.length > 0 ? nextIds : undefined });
	};

	return (
		<div className="flex flex-col gap-2" data-testid="task-launch-settings">
			<p className="text-[10px] text-text-tertiary">
				Manager installs globally; tags on this card limit what this task can use.
			</p>
			<div className="grid grid-cols-2 gap-2">
				<label className="flex flex-col gap-1 text-[11px] text-text-secondary">
					Model
					<NativeSelect
						value={value?.modelId ?? ""}
						onChange={(event) => {
							const next = event.target.value;
							update(next ? { modelId: next } : { modelId: "" });
						}}
					>
						<option value="">Default</option>
						{modelOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</NativeSelect>
				</label>
				<label className="flex flex-col gap-1 text-[11px] text-text-secondary">
					Effort
					<NativeSelect
						value={value?.effort ?? ""}
						onChange={(event) => {
							const next = event.target.value as RuntimeTaskLaunchEffort | "";
							const current = cloneLaunchSettings(value) ?? {};
							if (next) {
								current.effort = next;
							} else {
								delete current.effort;
							}
							emitSettings(current, onChange);
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

			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between gap-2">
					<span className="text-[11px] text-text-secondary">Skills</span>
					<span className="text-[10px] text-text-tertiary">
						{attachedSkillIds.length === 0 ? "All installed (Manager)" : "Allowlist"}
					</span>
				</div>
				<div className="flex flex-wrap gap-1">
					{attachedSkillIds.map((skillId) => (
						<TagChip key={skillId} label={skillId} onRemove={() => removeSkill(skillId)} />
					))}
				</div>
				{availableSkills.length > 0 ? (
					<NativeSelect
						value={skillPick}
						onChange={(event) => {
							const nextId = event.target.value;
							setSkillPick("");
							if (!nextId || attachedSkillIds.includes(nextId)) {
								return;
							}
							update({ skillIds: [...attachedSkillIds, nextId] });
						}}
					>
						<option value="">Add skill…</option>
						{availableSkills.map((skill) => (
							<option key={skill.id} value={skill.id}>
								{skill.displayName}
							</option>
						))}
					</NativeSelect>
				) : null}
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between gap-2">
					<span className="text-[11px] text-text-secondary">MCP</span>
					<span className="text-[10px] text-text-tertiary">
						{attachedMcpIds.length === 0 ? "All configured" : "Allowlist"}
					</span>
				</div>
				<div className="flex flex-wrap gap-1">
					{attachedMcpIds.map((serverId) => (
						<TagChip key={serverId} label={serverId} onRemove={() => removeMcp(serverId)} />
					))}
				</div>
				{availableMcp.length > 0 ? (
					<NativeSelect
						value={mcpPick}
						onChange={(event) => {
							const nextId = event.target.value;
							setMcpPick("");
							if (!nextId || attachedMcpIds.includes(nextId)) {
								return;
							}
							update({ mcpServerIds: [...attachedMcpIds, nextId] });
						}}
					>
						<option value="">Add MCP server…</option>
						{availableMcp.map((server) => (
							<option key={server.id} value={server.id}>
								{server.displayName}
							</option>
						))}
					</NativeSelect>
				) : null}
			</div>

			{(value?.modelId || value?.effort || attachedSkillIds.length > 0 || attachedMcpIds.length > 0) && (
				<button
					type="button"
					className={cn("self-start text-[11px] text-text-tertiary hover:text-text-secondary")}
					onClick={() => update(null)}
				>
					Clear launch tags
				</button>
			)}
		</div>
	);
}
