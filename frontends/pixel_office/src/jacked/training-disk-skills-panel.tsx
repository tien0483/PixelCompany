import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { MANAGER_LABELS } from "@/jacked/manager-labels";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { SKILL_INVENTORY_CHANGED_EVENT } from "@/runtime/skill-inventory-events";
import type { RuntimeSkillInventoryItem } from "@/runtime/types";

/**
 * Read-only list of skills actually present on disk (~/.claude/skills and
 * ~/.agents/skills). Complements Jacked Training toggles + packs so newly
 * installed / user-authored skills show up in Manager without a restart.
 */
export function TrainingDiskSkillsPanel({ online }: { online: boolean }): ReactElement {
	const [skills, setSkills] = useState<RuntimeSkillInventoryItem[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const inventory = await getRuntimeTrpcClient(null).runtime.listSkillInventory.query();
			setSkills(inventory.skills);
		} catch (err) {
			setSkills(null);
			setError(err instanceof Error ? err.message : "Could not load installed skills.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!online) {
			setSkills(null);
			return;
		}
		void load();
	}, [load, online]);

	useEffect(() => {
		const onChanged = () => {
			if (online) {
				void load();
			}
		};
		window.addEventListener(SKILL_INVENTORY_CHANGED_EVENT, onChanged);
		window.addEventListener("focus", onChanged);
		return () => {
			window.removeEventListener(SKILL_INVENTORY_CHANGED_EVENT, onChanged);
			window.removeEventListener("focus", onChanged);
		};
	}, [load, online]);

	return (
		<section className="mb-2" data-testid="training-disk-skills-panel">
			<div className="mb-1 flex items-center justify-between gap-2">
				<p className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
					{MANAGER_LABELS.diskSkills.title}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={!online || loading}
					icon={<RefreshCw size={12} className={cn(loading && "animate-spin")} />}
					onClick={() => {
						void load();
					}}
					aria-label="Refresh installed skills"
				/>
			</div>
			<p className="mb-1.5 text-[10px] text-text-tertiary">{MANAGER_LABELS.diskSkills.description}</p>
			{error ? <p className="mb-1.5 text-[10px] text-status-red">{error}</p> : null}
			{!online ? (
				<p className="text-[10px] text-text-tertiary">{MANAGER_LABELS.offlineHint}</p>
			) : null}
			{online && skills && skills.length === 0 ? (
				<p className="text-[10px] text-text-tertiary">{MANAGER_LABELS.diskSkills.empty}</p>
			) : null}
			{skills && skills.length > 0 ? (
				<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
					{skills.map((skill) => (
						<li
							key={skill.id}
							className="rounded-md border border-border bg-surface-2 px-2 py-1.5"
							title={skill.description ?? skill.id}
						>
							<div className="truncate text-[12px] text-text-primary">{skill.displayName}</div>
							{skill.description ? (
								<div className="mt-0.5 line-clamp-2 text-[10px] text-text-tertiary">{skill.description}</div>
							) : (
								<div className="mt-0.5 truncate text-[10px] text-text-tertiary">{skill.id}</div>
							)}
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
